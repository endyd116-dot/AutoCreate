/**
 * lib/ad-eligibility.ts — 수익 매체 «신청 가능» 판정·알림·«가입 완료» 자기 신고(계약 §1.5·§1.4b · DESIGN §9.0).
 *
 *   🔴 **조건 수치(THRESHOLDS)·신청 주소(LINKS)는 여기 한 곳**이다. 화면은 `ad-eligibility` 응답의 `thresholds`·`links` 만 쓴다
 *      (A 가 50·300 을 화면에 박으면 정책이 바뀔 때 두 곳을 고쳐야 한다 — 계약 §1.4b(1)(2)).
 *   상태 저장(계약 v3.3 §1.5b): `accounts.monetize` jsonb — `adpostState`·`yppState`("none"|"pending"|"approved") ·
 *     `eligibilityNotifiedAt:{ adpost?, ypp? }` · `ypp:{ subs, views, at }`(캐시). 클립 모집은 `channel_registry.monetize`(key naver_clip) `{ clipOpen:{ from, to } }`.
 *   판정 재료: 애드포스트 = 그 계정의 누적 글 수(posts) + 방문(posts.stats.views 합 · 러너 `revenue.stats` 가 채운다) ·
 *     YPP = 채널 통계(YouTube Data API `channels?part=statistics&mine=true` · 토큰은 수익 소스 youtube → 없으면 계정 oauth) ·
 *     클립 = 모집 창 D-7.
 *   알림은 **계정당 1회**(처음 충족한 날) — `eligibilityNotifiedAt` 이 문지기다.
 *   jsonb 쓰기는 `jsonb()` + 직후 `jsonb_typeof` 확인(PITFALLS #1).
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { decryptObj } from "./creds-crypto";
import { jsonb, utcDate } from "./db-util";
import { httpJson } from "./revenue/common";
import { ensureFresh } from "./revenue/google-oauth";
import type { OAuthToken } from "./oauth-providers";

const n = (v: unknown) => Number(v || 0);

/** 🔴 정책 수치 정본. */
export const THRESHOLDS = {
  adpost: { posts: 50, visitors: 300 },
  ypp: { subs: 1000, views: 10_000_000 },   // 구독 1,000 + 쇼츠 조회 1,000만/90일(DESIGN §9.0)
} as const;
/** 🔴 «신청하러 가기» 주소 정본(운영자가 바꿀 수 있어야 한다 — 화면은 이 값만 쓴다). */
export const LINKS = {
  adpost: "https://adpost.naver.com/",
  adsense: "https://www.google.com/adsense/start/",
  ypp: "https://www.youtube.com/account_monetization",
  coupang: "https://partners.coupang.com/",
  clip: "https://clip.naver.com/creator",
} as const;
/** 클립 모집 알림을 며칠 전에 보내나. */
export const CLIP_NOTICE_DAYS = 7;

export type MediaState = "none" | "pending" | "approved";
export interface AccountEligibility {
  accountId: number; handle: string; channel: string;
  adpost: { state: MediaState; posts: number; visitors: number; ready: boolean };
  ypp?: { state: MediaState; subs: number; views: number; ready: boolean; at?: string };
  clip?: { open: boolean; deadline?: string; from?: string };
  /** 글 채널(티스토리·블로거·WP)의 애드센스 자기 신고 상태(화면 카드용). */
  adsense?: { state: MediaState };
}

const stateOf = (v: unknown): MediaState => (v === "pending" || v === "approved" ? v : "none");

/** 클립 모집 창(운영자 입력 · channel_registry.monetize.clipOpen). 없으면 null. */
export async function clipWindow(): Promise<{ from: string; to: string } | null> {
  try {
    const [r] = await q(sql`SELECT monetize->'clipOpen' AS w FROM channel_registry WHERE key = 'naver_clip'`);
    const w = (r?.w && typeof r.w === "object" ? r.w : null) as { from?: unknown; to?: unknown } | null;
    if (!w) return null;
    const from = String(w.from ?? ""), to = String(w.to ?? "");
    return /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to) ? { from, to } : null;
  } catch { return null; }
}

/** 계정별 판정(읽기 전용 — 알림은 judgeAndNotify 가). */
export async function judgeAccounts(tid: number): Promise<AccountEligibility[]> {
  const accounts = await q(sql`SELECT a.id, a.handle, a.channel, a.monetize,
      (SELECT COUNT(*) FROM posts p WHERE p.tenant_id = a.tenant_id AND p.account_id = a.id) AS posts,
      (SELECT COALESCE(SUM((p.stats->>'views')::numeric), 0) FROM posts p WHERE p.tenant_id = a.tenant_id AND p.account_id = a.id AND (p.stats->>'views') IS NOT NULL) AS visitors
    FROM accounts a WHERE a.tenant_id = ${tid} AND COALESCE(a.last_error_kind,'') <> 'removed' ORDER BY a.channel, a.id`);
  const clip = await clipWindow();
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  return accounts.map((a) => {
    const m = (a.monetize && typeof a.monetize === "object" && !Array.isArray(a.monetize) ? a.monetize : {}) as Record<string, unknown>;
    const posts = n(a.posts), visitors = Math.round(n(a.visitors));
    const out: AccountEligibility = {
      accountId: n(a.id), handle: String(a.handle), channel: String(a.channel),
      adpost: { state: stateOf(m.adpostState), posts, visitors, ready: posts >= THRESHOLDS.adpost.posts && visitors >= THRESHOLDS.adpost.visitors },
    };
    if (String(a.channel) === "youtube_shorts") {
      const y = (m.ypp && typeof m.ypp === "object" ? m.ypp : {}) as Record<string, unknown>;
      const subs = n(y.subs), views = n(y.views);
      out.ypp = { state: stateOf(m.yppState), subs, views, ready: subs >= THRESHOLDS.ypp.subs && views >= THRESHOLDS.ypp.views, ...(y.at ? { at: String(y.at) } : {}) };
    }
    if (["tistory", "blogger", "wordpress"].includes(String(a.channel))) out.adsense = { state: stateOf(m.adsenseState) };
    if (String(a.channel) === "naver_clip") {
      const open = !!clip && todayKst >= clip.from && todayKst <= clip.to;
      out.clip = { open, ...(clip ? { deadline: clip.to, from: clip.from } : {}) };
    }
    return out;
  });
}

/**
 * refreshYppStats — 유튜브 계정의 구독·조회수를 채널 API 로 받아 `accounts.monetize.ypp` 에 캐시(하루 1회 · revenue.sync 06:00).
 *   토큰: 수익 소스 youtube(cred_enc) → 없으면 계정 oauth 자격. 둘 다 없으면 건너뛴다(0 으로 적지 않는다 · AC-9).
 */
export async function refreshYppStats(tid: number): Promise<{ refreshed: number; skipped: number }> {
  const out = { refreshed: 0, skipped: 0 };
  const yt = await q(sql`SELECT id, monetize FROM accounts WHERE tenant_id = ${tid} AND channel = 'youtube_shorts' AND COALESCE(last_error_kind,'') <> 'removed'`);
  if (!yt.length) return out;
  const [srcTok] = await q(sql`SELECT cred_enc FROM revenue_sources WHERE tenant_id = ${tid} AND source = 'youtube' AND cred_enc IS NOT NULL ORDER BY id DESC LIMIT 1`);
  for (const a of yt) {
    const aid = n(a.id);
    let enc: string | null = srcTok?.cred_enc ? String(srcTok.cred_enc) : null;
    if (!enc) { const [c] = await q(sql`SELECT enc FROM account_creds WHERE tenant_id = ${tid} AND account_id = ${aid} AND kind = 'oauth' AND purged_at IS NULL ORDER BY id DESC LIMIT 1`); enc = c?.enc ? String(c.enc) : null; }
    const token = enc ? decryptObj<OAuthToken>(enc) : null;
    if (!token?.accessToken) { out.skipped++; continue; }
    const fr = await ensureFresh(token); if (!fr.ok) { out.skipped++; continue; }
    const r = await httpJson("https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true", { headers: { Authorization: `Bearer ${fr.token.accessToken}` } });
    const st = r.ok ? r.json?.items?.[0]?.statistics : null;
    if (!st) { out.skipped++; continue; }
    const subs = n(st.subscriberCount), views = n(st.viewCount);
    if (!Number.isFinite(subs) || !Number.isFinite(views)) { out.skipped++; continue; }
    await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ ypp: { subs, views, at: new Date().toISOString() } })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${aid}`);
    out.refreshed++;
  }
  if (out.refreshed) { const [chk] = await q(sql`SELECT jsonb_typeof(monetize) AS t FROM accounts WHERE tenant_id = ${tid} AND channel = 'youtube_shorts' LIMIT 1`); if (chk?.t !== "object") console.error("[ad-eligibility] monetize jsonb_typeof !== object", chk); }
  return out;
}

/**
 * judgeAndNotify — 처음 충족한 날 알림 1건(계정당 · 매체당). 클립은 모집 시작 D-7 이내면 1건.
 *   문지기 = monetize.eligibilityNotifiedAt.{adpost|ypp|clip:<from>}.
 */
export async function judgeAndNotify(tid: number): Promise<{ notified: number }> {
  let notified = 0;
  const list = await judgeAccounts(tid);
  const clip = await clipWindow();
  const todayMs = Date.now() + 9 * 3600_000;
  for (const a of list) {
    const [row] = await q(sql`SELECT monetize FROM accounts WHERE tenant_id = ${tid} AND id = ${a.accountId}`);
    const m = (row?.monetize && typeof row.monetize === "object" ? row.monetize : {}) as Record<string, unknown>;
    const done = (m.eligibilityNotifiedAt && typeof m.eligibilityNotifiedAt === "object" ? m.eligibilityNotifiedAt : {}) as Record<string, string>;
    const patch: Record<string, string> = {};
    const push = async (kind: string, title: string, body: string) => {
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${kind}, ${title.slice(0, 160)}, ${body.slice(0, 2000)}, ${"/app/ad-media.html"})`);
      notified++;
    };
    if (a.channel === "naver_blog" && a.adpost.ready && a.adpost.state === "none" && !done.adpost) {
      await push("adpost_ready", `@${a.handle} 이제 애드포스트를 신청할 수 있어요`, `글 ${a.adpost.posts}편 · 방문 ${a.adpost.visitors.toLocaleString()}회로 조건을 채웠어요. «수익 매체»에서 신청하러 가 보세요.`);
      patch.adpost = new Date().toISOString();
    }
    if (a.ypp && a.ypp.ready && a.ypp.state === "none" && !done.ypp) {
      await push("ypp_ready", `@${a.handle} 유튜브 수익 신청 조건을 채웠어요`, `구독 ${a.ypp.subs.toLocaleString()} · 조회 ${a.ypp.views.toLocaleString()}. «수익 매체»에서 신청하러 가 보세요.`);
      patch.ypp = new Date().toISOString();
    }
    if (a.channel === "naver_clip" && clip) {
      const fromMs = Date.parse(`${clip.from}T00:00:00+09:00`);
      const key = `clip:${clip.from}`;
      if (Number.isFinite(fromMs) && fromMs - todayMs <= CLIP_NOTICE_DAYS * 86400_000 && todayMs <= Date.parse(`${clip.to}T23:59:59+09:00`) && !done[key]) {
        await push("clip_open", `클립 크리에이터 모집이 ${clip.from.slice(5).replace("-", "/")}에 시작해요`, `@${a.handle} 로 지원할 수 있어요. ${clip.to.slice(5).replace("-", "/")}까지예요.`);
        patch[key] = new Date().toISOString();
      }
    }
    if (Object.keys(patch).length) {
      await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ eligibilityNotifiedAt: { ...done, ...patch } })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${a.accountId}`);
    }
  }
  return { notified };
}

/** «가입 완료했어요» 자기 신고(계약 §1.4b(3)): applied = none→pending · approved = pending→approved. 감사 1행. 다음 수집에서 서버 판정이 이긴다. */
export type ClaimSource = "adpost" | "ypp" | "adsense" | "clip";
const STATE_KEY: Record<ClaimSource, string> = { adpost: "adpostState", ypp: "yppState", adsense: "adsenseState", clip: "clipState" };
export async function claimMediaState(tid: number, uid: number, source: ClaimSource, accountId: number, action: "applied" | "approved"): Promise<boolean> {
  const key = STATE_KEY[source];
  const [row] = await q(sql`SELECT monetize FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`);
  if (!row) return false;
  const m = (row.monetize && typeof row.monetize === "object" ? row.monetize : {}) as Record<string, unknown>;
  const cur = stateOf(m[key]);
  const next: MediaState = action === "applied" ? (cur === "none" ? "pending" : cur) : "approved";
  await q(sql`UPDATE accounts SET monetize = monetize || ${jsonb({ [key]: next })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${accountId}`);
  const [chk] = await q(sql`SELECT jsonb_typeof(monetize) AS t FROM accounts WHERE tenant_id = ${tid} AND id = ${accountId}`);
  if (chk?.t !== "object") console.error("[ad-eligibility] monetize jsonb_typeof !== object", chk);
  await writeAudit({ tenantId: tid, action: "ad_media_state_claimed", actorType: "user", actorId: uid, target: `account:${accountId}`, detail: { source, from: cur, to: next, action } });
  return true;
}

/** 표시용 KST ISO(캐시 시각). */
export function isoOf(v: unknown): string | undefined { const d = utcDate(v); return d ? d.toISOString() : undefined; }
