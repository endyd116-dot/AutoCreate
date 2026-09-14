/**
 * lib/accounts.ts — 계정 행 투영(AccountRow · 계약 §1 v1.1) + 채널 연결 방식 + 공용 조회. DESIGN §7.1.
 *   🔴 응답·로그 어디에도 자격 평문 0 — hasCreds(boolean)·monetize 불리언만. proxyUrl 은 호스트만.
 *   «삭제»는 소프트: status disconnected + last_error_kind 'removed'(자격 purged_at). 같은 핸들 재연결 시 그 행을 되살린다.
 */
import { db } from "../db/index";
import { sql, type SQL } from "drizzle-orm";
import { utcDate } from "./db-util";
import { maskProxyUrl } from "./creds-crypto";
import { providerConfigured } from "./oauth-providers";
import { videoChannelSpec } from "./writing-contracts";   // [P1R6 §2.3] 영상 채널 규격 정본(순수 표 · 순환 0 — writing-contracts 는 db·drizzle 만 본다)

type Row = Record<string, unknown>;
export const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

export type ConnectMethod = "session" | "app_password" | "oauth";
export const ALL_CHANNELS = ["naver_blog", "tistory", "blogger", "wordpress", "threads", "instagram", "youtube_shorts", "naver_clip", "reels", "tiktok"] as const;
export type ChannelKey = typeof ALL_CHANNELS[number];
export function isChannel(v: unknown): v is ChannelKey { return ALL_CHANNELS.includes(String(v) as ChannelKey); }

/** 연결 방식(계약 §0): naver_blog·tistory·naver_clip = session · wordpress = app_password · 나머지 = oauth. */
export function connectMethodOf(channel: string): ConnectMethod {
  if (channel === "naver_blog" || channel === "tistory" || channel === "naver_clip") return "session";
  if (channel === "wordpress") return "app_password";
  return "oauth";
}
/** 글 채널(이 라운드 생성 대상). */
export const TEXT_CHANNELS: ReadonlySet<string> = new Set(["naver_blog", "tistory", "blogger", "wordpress", "threads"]);

export interface AccountRow {
  id: number; channel: string; handle: string; displayName: string | null; avatar: null; status: string;
  healthScore: number; postsToday: number; dailyCap: number; minGapMin: number;
  goldenHours?: number[]; lastPostAt?: string; lastErrorKind?: string; groupId?: number; personaId?: number;
  proxyUrl?: string; browserProfileKey: string; hasCreds: boolean;
  monetize: { coupang: boolean; adpost: boolean; adsense: boolean };
}

/** SELECT 조각 — accounts a + 자격 존재 여부 서브쿼리. */
export const ACCOUNT_SELECT = sql`
  a.id, a.channel, a.handle, a.display_name, a.status, a.health_score, a.posts_today, a.daily_cap, a.min_gap_min, a.golden_hours,
  a.last_post_at, a.last_error_kind, a.group_id, a.persona_id, a.proxy_url, a.browser_profile_key, a.monetize,
  EXISTS(SELECT 1 FROM account_creds c WHERE c.account_id = a.id AND c.purged_at IS NULL AND c.kind IN ('password','app_password','oauth','cookies')) AS has_creds,
  EXISTS(SELECT 1 FROM account_creds c WHERE c.account_id = a.id AND c.purged_at IS NULL AND c.kind = 'coupang') AS has_coupang`;

export function toAccountRow(r: Row): AccountRow {
  const mon = (r.monetize && typeof r.monetize === "object" ? r.monetize : {}) as Record<string, unknown>;
  const o: AccountRow = {
    id: Number(r.id), channel: String(r.channel), handle: String(r.handle), displayName: (r.display_name as string) ?? null, avatar: null,
    status: String(r.status), healthScore: Number(r.health_score ?? 100), postsToday: Number(r.posts_today ?? 0), dailyCap: Number(r.daily_cap ?? 2), minGapMin: Number(r.min_gap_min ?? 180),
    browserProfileKey: String(r.browser_profile_key || `t0-a${r.id}`), hasCreds: r.has_creds === true,
    monetize: { coupang: r.has_coupang === true, adpost: !!mon.adpostMediaId, adsense: !!mon.adsensePub },
  };
  if (Array.isArray(r.golden_hours) && r.golden_hours.length) o.goldenHours = (r.golden_hours as unknown[]).map(Number).filter((n) => Number.isFinite(n));
  const lp = utcDate(r.last_post_at); if (lp) o.lastPostAt = lp.toISOString();
  if (r.last_error_kind) o.lastErrorKind = String(r.last_error_kind);
  if (r.group_id) o.groupId = Number(r.group_id);
  if (r.persona_id) o.personaId = Number(r.persona_id);
  const px = maskProxyUrl(r.proxy_url as string); if (px) o.proxyUrl = px;
  return o;
}

/** 테넌트의 살아 있는 계정(삭제 표식 제외). */
export async function listAccounts(tid: number, channel?: string): Promise<AccountRow[]> {
  const rows = await q(sql`SELECT ${ACCOUNT_SELECT} FROM accounts a WHERE a.tenant_id = ${tid}
    AND COALESCE(a.last_error_kind,'') <> 'removed' ${channel ? sql`AND a.channel = ${channel}` : sql``} ORDER BY a.channel, a.id`);
  return rows.map(toAccountRow);
}
export async function getAccount(tid: number, id: number): Promise<AccountRow | null> {
  const rows = await q(sql`SELECT ${ACCOUNT_SELECT} FROM accounts a WHERE a.tenant_id = ${tid} AND a.id = ${id} LIMIT 1`);
  return rows[0] ? toAccountRow(rows[0]) : null;
}

export interface ChannelInfo {
  key: string; label: string; category: string; publishVia: string; status: string; connectMethod: ConnectMethod; configured: boolean;
  /** [P1R6 §2.3] 영상 채널이면 규격 — 🔴 **화면이 숫자를 갖지 않는다**(«클립은 30초까지» 를 화면에 적지 않는다).
   *  `maxSeconds` = 채널 상한(naver_clip 30 · 나머지 60 · 릴스 90 은 Phase 5) · `formats[].maxSeconds` = 채널·포맷 상한 중 작은 쪽.
   *  정본은 `lib/writing-contracts.ts VIDEO_CHANNEL_MAX_SEC`·`VIDEO_FORMAT_MAX_SEC` 한 곳. */
  video?: { maxSeconds: 15 | 30 | 60; formats: { key: string; label: string; maxSeconds: 15 | 30 | 60 }[] };
}
/** channel_registry + 연결 방식 + 앱 키 존재. 레지스트리가 비어 있으면 코드 목록으로. */
export async function listChannels(): Promise<ChannelInfo[]> {
  let rows: Row[] = [];
  try { rows = await q(sql`SELECT key, label, category, publish_via, status FROM channel_registry ORDER BY sort, key`); } catch { rows = []; }
  if (!rows.length) rows = ALL_CHANNELS.map((k) => ({ key: k, label: k, category: /shorts|clip|reels|tiktok/.test(k) ? "video" : "text", publish_via: connectMethodOf(k) === "session" ? "runner" : "api", status: "planned" }));
  return rows.map((r) => {
    const key = String(r.key);
    const video = videoChannelSpec(key);
    return { key, label: String(r.label), category: String(r.category), publishVia: String(r.publish_via), status: String(r.status),
      connectMethod: connectMethodOf(key), configured: providerConfigured(key), ...(video ? { video } : {}) };
  });
}
