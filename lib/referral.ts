/**
 * lib/referral.ts — 추천인(DESIGN §19 · 계약 P1R6 §1.1). 코드 발급 · 가입 검증/연결 · 첫 결제 보상 · 내 추천 현황.
 *   ① 코드: 테넌트당 1개 `tenants.referral_code`(8자 대문자+숫자 · 혼동 글자 0/O/1/I 제외 · 부분 유니크) — 처음 `GET /api/referral` 때 발급 · 충돌은 재시도.
 *   ② 가입: `auth-register` body `referralCode` → 테넌트가 만들어지기 **전에** 검증(400 이면 흔적 0) · 만들어진 뒤 `referred_by` 1회 연결(바꾸지 않는다).
 *      400 `step:"referral"` 사람말: 없는 코드 · 내 코드(같은 메일 · 같은 별칭(+태그·gmail 점) · 같은 회사 도메인) · 이미 추천받은 계정.
 *   ③ 보상: **피추천인 첫 유료 결제 성공 시**(구독 청구 성공 `applyChargeResult` · 코인 충전 정산 `settle` 두 훅 · 어느 쪽이 먼저든 1회) 양쪽에 grant.
 *      코인 수 = `ops-promotions kind:"referral"` 활성 이벤트 값(없으면 0 = 비활성 · 아무 표시도 남기지 않아 나중에 켜지면 그때 첫 결제부터 준다).
 *      멱등 ref `referral:{inviterTid}:{inviteeTid}`(coin_ledger 유니크 (tenant,kind,ref,bucket) · 양쪽 테넌트가 같은 ref) · 감사 2행(양쪽) · 알림 2행.
 *   ④ 🔴 남용: 같은 `card_fp`(빌키 지문 · trial_fp) 가 양쪽에 있으면 보상 0 + `referral_blocked_at`(한 번 막히면 끝) · 이메일 자기추천은 가입 때 400.
 *      체험만 하고 안 낸 초대는 «첫 결제 전»(rewarded false) 그대로 — 결제 성공이 조건.
 *   🔴 결제 경로에서 부르는 `rewardReferralOnPaid` 는 **절대 던지지 않는다**(결제는 이미 성공 · 추천 실패가 청구 장부를 깨면 안 된다).
 *   🔎 출처: AC 신규(계약 P1R6-B §1.1~§1.4 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { utcDate } from "./db-util";
import { grant } from "./coin-ledger";
import { activePromotions } from "./billing/promotions";

const n = (v: unknown) => Number(v || 0);
/** 혼동 글자(0/O/1/I) 를 뺀 대문자+숫자 32자 — 화면(register.html)이 대문자로 올려 보낸다. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const REFERRAL_CODE_LEN = 8;
export function generateReferralCode(): string {
  const bytes = new Uint8Array(REFERRAL_CODE_LEN); crypto.getRandomValues(bytes);
  let s = ""; for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}
/** 입력 정규화 — 대문자 · 영숫자만 · 8자가 아니면 null(«없는 코드» 로 취급). */
export function normalizeReferralCode(v: unknown): string | null {
  const s = String(v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === REFERRAL_CODE_LEN ? s : null;
}

/** 내 코드(없으면 발급 · 충돌 재시도 6회 · 동시 요청은 «먼저 넣은 쪽» 이 이긴다). */
export async function ensureReferralCode(tid: number): Promise<string> {
  const [t] = await q(sql`SELECT referral_code FROM tenants WHERE id = ${tid}`);
  if (t?.referral_code) return String(t.referral_code);
  for (let i = 0; i < 6; i++) {
    const code = generateReferralCode();
    try {
      const r = await q(sql`UPDATE tenants SET referral_code = ${code}, updated_at = NOW() WHERE id = ${tid} AND referral_code IS NULL RETURNING referral_code`);
      if (r.length) return String(r[0].referral_code);
      break;   // 다른 요청이 먼저 넣었다
    } catch (e) { if ((e as { code?: string })?.code !== "23505") throw e; }   // 충돌 → 다시 뽑는다
  }
  const [t2] = await q(sql`SELECT referral_code FROM tenants WHERE id = ${tid}`);
  if (t2?.referral_code) return String(t2.referral_code);
  throw new Error("referral_code_exhausted");
}

/* ───────── 이메일 자기추천 판정 ───────── */
/** 공개 메일 서비스 — 여기 도메인은 «같은 도메인» 만으로 막지 않는다(gmail 끼리 추천이 정상). 별칭(+태그 · gmail 점)이 같으면 막는다. */
const PUBLIC_MAIL: ReadonlySet<string> = new Set(["gmail.com", "googlemail.com", "naver.com", "daum.net", "hanmail.net", "kakao.com", "nate.com", "outlook.com", "outlook.kr", "hotmail.com", "hotmail.co.kr", "live.com", "live.co.kr", "msn.com",
  "yahoo.com", "yahoo.co.kr", "icloud.com", "me.com", "mac.com", "protonmail.com", "proton.me", "pm.me", "zoho.com", "aol.com", "yandex.com", "yandex.ru", "mail.com", "gmx.com", "gmx.de", "tutanota.com", "fastmail.com", "hey.com", "dreamwiz.com", "lycos.co.kr", "korea.com", "empal.com", "paran.com", "chol.com", "hanmir.com"]);
export type SelfReferralReason = "email_same" | "email_alias" | "email_domain";
function mailIdentity(email: string): { local: string; domain: string; isPublic: boolean } {
  const s = String(email || "").trim().toLowerCase(); const at = s.lastIndexOf("@");
  const domain = at >= 0 ? s.slice(at + 1) : ""; let local = at >= 0 ? s.slice(0, at) : s;
  local = local.replace(/\+.*$/, "");                                           // me+ac1@ → me
  if (domain === "gmail.com" || domain === "googlemail.com") local = local.replace(/\./g, "");   // gmail 은 점을 무시한다
  return { local, domain, isPublic: PUBLIC_MAIL.has(domain) };
}
/** 두 메일이 «같은 사람» 으로 보이는가(계약 §1.1 🔴 같은 이메일 도메인 자기추천 차단). null = 문제 없음. */
export function selfReferralReason(inviterEmail: string | null, inviteeEmail: string): SelfReferralReason | null {
  if (!inviterEmail) return null;
  const a = mailIdentity(inviterEmail), b = mailIdentity(inviteeEmail);
  if (!a.domain || !b.domain) return null;
  if (a.domain !== b.domain) return null;
  if (a.local === b.local) return String(inviterEmail).trim().toLowerCase() === String(inviteeEmail).trim().toLowerCase() ? "email_same" : "email_alias";
  return a.isPublic ? null : "email_domain";                                     // 회사 도메인끼리는 통째로 막는다
}
export const REFERRAL_MESSAGES = {
  not_found: "그런 추천 코드는 없어요. 다시 확인해 주세요.",
  self: "내 코드는 쓸 수 없어요.",
  domain: "같은 회사 메일끼리는 추천이 안 돼요.",
  used: "이미 추천을 받은 계정이에요.",
} as const;

/* ───────── 가입 검증 · 연결 ───────── */
export type SignupReferralCheck = { ok: true; inviterTid: number; inviterName: string } | { ok: false; error: string; reason: "not_found" | SelfReferralReason };
/** 가입 **전** 검증 — 테넌트가 아직 없으니 «자기 코드» 는 메일로 본다. 통과해도 연결은 `attachReferral` 이 한다. */
export async function checkSignupReferral(codeIn: unknown, email: string): Promise<SignupReferralCheck> {
  const code = normalizeReferralCode(codeIn);
  if (!code) return { ok: false, error: REFERRAL_MESSAGES.not_found, reason: "not_found" };
  const [t] = await q(sql`SELECT t.id, t.name, t.status, (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS email
    FROM tenants t WHERE t.referral_code = ${code} LIMIT 1`);
  if (!t) return { ok: false, error: REFERRAL_MESSAGES.not_found, reason: "not_found" };
  const why = selfReferralReason(t.email ? String(t.email) : null, email);
  if (why) return { ok: false, error: why === "email_domain" ? REFERRAL_MESSAGES.domain : REFERRAL_MESSAGES.self, reason: why };
  return { ok: true, inviterTid: n(t.id), inviterName: String(t.name ?? "") };
}
/** 가입 **뒤** 연결(1회 · referred_by 가 비어 있을 때만 · 자기 자신 금지). 감사 2행(피추천인 `referral_attached` · 추천인 `referral_invited`). */
export async function attachReferral(tid: number, inviterTid: number, ctx: { actorId?: number | null; ip?: string | null; code?: string | null } = {}): Promise<{ applied: boolean; error?: string }> {
  if (!tid || !inviterTid || tid === inviterTid) return { applied: false, error: REFERRAL_MESSAGES.self };
  const r = await q(sql`UPDATE tenants SET referred_by = ${inviterTid}, updated_at = NOW() WHERE id = ${tid} AND referred_by IS NULL AND id <> ${inviterTid} RETURNING id`);
  if (!r.length) return { applied: false, error: REFERRAL_MESSAGES.used };
  await writeAudit({ tenantId: tid, action: "referral_attached", actorType: "user", actorId: ctx.actorId ?? null, ip: ctx.ip ?? null, target: `tenant:${inviterTid}`, detail: { inviterTid, code: ctx.code ?? null } });
  await writeAudit({ tenantId: inviterTid, action: "referral_invited", actorType: "system", target: `tenant:${tid}`, detail: { inviteeTid: tid } });
  return { applied: true };
}

/* ───────── 보상(첫 유료 결제 성공) ───────── */
export interface ReferralRewardResult { status: "none" | "already" | "blocked" | "inactive" | "rewarded" | "failed"; coins: number; inviterTid?: number; reason?: string }
/** 지금 활성인 추천 이벤트의 코인 수(없으면 0) + 이벤트 id. */
export async function referralRewardCoins(): Promise<{ coins: number; promoId: number | null }> {
  try {
    const [p] = await activePromotions("referral");
    const coins = p ? Math.max(0, Math.trunc(n(p.config?.coins ?? p.value))) : 0;
    return { coins, promoId: p ? p.id : null };
  } catch (e) { console.warn("[referral] promotions 읽기 실패", String((e as Error)?.message ?? e).slice(0, 100)); return { coins: 0, promoId: null }; }
}
async function cardFpsOf(tid: number): Promise<Set<string>> {
  const rows = await q(sql`SELECT card_fp AS fp FROM billing_keys WHERE tenant_id = ${tid} AND card_fp IS NOT NULL
    UNION SELECT trial_fp AS fp FROM tenants WHERE id = ${tid} AND trial_fp IS NOT NULL`);
  return new Set(rows.map((r) => String(r.fp)));
}
/**
 * rewardReferralOnPaid(tid, ctx) — 피추천인 tid 의 유료 결제가 **성공한 직후** 부른다(구독·코인 두 훅). 절대 던지지 않는다.
 *   referred_by 없음 → none · 이미 줌 → already · 막힘 → blocked · 이벤트 없음(0코인) → inactive(표시 안 남김) · 같은 card_fp → blocked(기록) · 아니면 양쪽 grant → rewarded.
 */
export async function rewardReferralOnPaid(tid: number, ctx: { orderNo?: string | null; invoiceId?: number | null; source: string }): Promise<ReferralRewardResult> {
  try {
    const [t] = await q(sql`SELECT id, name, referred_by, referral_rewarded_at, referral_blocked_at FROM tenants WHERE id = ${tid}`);
    const inviterTid = n(t?.referred_by);
    if (!t || !inviterTid || inviterTid === tid) return { status: "none", coins: 0 };
    if (t.referral_rewarded_at) return { status: "already", coins: 0, inviterTid };
    if (t.referral_blocked_at) return { status: "blocked", coins: 0, inviterTid };
    const { coins, promoId } = await referralRewardCoins();
    if (!coins) return { status: "inactive", coins: 0, inviterTid };
    const [inv] = await q(sql`SELECT id, name FROM tenants WHERE id = ${inviterTid}`);
    if (!inv) return { status: "none", coins: 0, inviterTid };
    // 🔴 남용 — 같은 카드 지문이 양쪽에 있으면 «한 사람» 으로 본다. 카드번호는 어디에도 없다(지문만).
    const [a, b] = await Promise.all([cardFpsOf(tid), cardFpsOf(inviterTid)]);
    const shared = [...a].some((fp) => b.has(fp));
    if (shared) {
      await q(sql`UPDATE tenants SET referral_blocked_at = NOW(), referral_block_reason = ${"card_fp"}, updated_at = NOW() WHERE id = ${tid} AND referral_blocked_at IS NULL`);
      await writeAudit({ tenantId: tid, action: "referral_blocked", actorType: "system", riskLevel: "medium", target: `tenant:${inviterTid}`, detail: { reason: "card_fp", inviterTid, orderNo: ctx.orderNo ?? null, source: ctx.source } });
      await writeAudit({ tenantId: inviterTid, action: "referral_blocked", actorType: "system", riskLevel: "medium", target: `tenant:${tid}`, detail: { reason: "card_fp", inviteeTid: tid, source: ctx.source } });
      return { status: "blocked", coins: 0, inviterTid, reason: "card_fp" };
    }
    const ref = `referral:${inviterTid}:${tid}`;
    const inviteeName = String(t.name ?? "").slice(0, 40) || "친구";
    const g1 = await grant(inviterTid, coins, `추천 보상 · ${inviteeName} 첫 결제`, null, ref);
    const g2 = await grant(tid, coins, "추천 가입 보상 · 첫 결제", null, ref);
    if (!g1.ok || !g2.ok) {
      await writeAudit({ tenantId: tid, action: "referral_reward_failed", actorType: "system", riskLevel: "medium", target: `tenant:${inviterTid}`, detail: { ref, coins, inviterOk: g1.ok, inviteeOk: g2.ok, source: ctx.source } });
      return { status: "failed", coins: 0, inviterTid, reason: "grant" };
    }
    await q(sql`UPDATE tenants SET referral_rewarded_at = NOW(), updated_at = NOW() WHERE id = ${tid} AND referral_rewarded_at IS NULL`);
    if (promoId) { try { await q(sql`UPDATE promotions SET uses = uses + 1, updated_at = NOW() WHERE id = ${promoId}`); } catch { /* 통계 실패는 보상을 막지 않는다 */ } }
    const detail = { ref, coins, promoId, orderNo: ctx.orderNo ?? null, invoiceId: ctx.invoiceId ?? null, source: ctx.source, inviterGranted: g1.granted, inviteeGranted: g2.granted };
    await writeAudit({ tenantId: inviterTid, action: "referral_reward", actorType: "system", target: `tenant:${tid}`, detail: { ...detail, role: "inviter", inviteeTid: tid } });
    await writeAudit({ tenantId: tid, action: "referral_reward", actorType: "system", target: `tenant:${inviterTid}`, detail: { ...detail, role: "invitee", inviterTid } });
    const coinsTxt = coins.toLocaleString("ko-KR");
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES
      (${inviterTid}, ${"referral_reward"}, ${`${inviteeName}님이 첫 결제를 했어요`}, ${`추천 보상으로 ${coinsTxt}코인을 받았어요.`}, ${"/app/coins.html"}),
      (${tid}, ${"referral_reward"}, ${"추천 가입 코인이 들어왔어요"}, ${`첫 결제가 끝나서 ${coinsTxt}코인을 받았어요.`}, ${"/app/coins.html"})`);
    return { status: "rewarded", coins, inviterTid };
  } catch (e) {
    console.error("[referral] reward 실패", String((e as Error)?.message ?? e).slice(0, 200));
    try { await writeAudit({ tenantId: tid, action: "referral_reward_failed", actorType: "system", riskLevel: "medium", detail: { error: String((e as Error)?.message ?? e).slice(0, 200), source: ctx.source } }); } catch { /* */ }
    return { status: "failed", coins: 0, reason: "exception" };
  }
}

/* ───────── 내 추천 현황(GET /api/referral) ───────── */
export interface ReferralView { code: string; invited: { tenantName: string; at: string; rewarded: boolean }[]; rewardCoins: number }
export async function referralView(tid: number): Promise<ReferralView> {
  const code = await ensureReferralCode(tid);
  const rows = await q(sql`SELECT name, created_at, referral_rewarded_at FROM tenants WHERE referred_by = ${tid} ORDER BY created_at DESC, id DESC LIMIT 200`);
  const invited = rows.map((r) => ({ tenantName: String(r.name ?? ""), at: utcDate(r.created_at)?.toISOString() ?? "", rewarded: !!r.referral_rewarded_at }));
  const { coins } = await referralRewardCoins();
  return { code, invited, rewardCoins: coins };
}
