/**
 * lib/publish/tokens.ts — OAuth 토큰 보관·갱신(B2-5 · 계약 §3 «OAuth 토큰 · 리프레시 자동»).
 *   순수 갱신 로직은 `lib/oauth-providers.ts refreshAccessToken`(네트워크만) · 이 파일은 **저장·재암호화·실패 처치**를 맡는다.
 *
 *   실패 처치(DESIGN §7.1 상태 어휘): 갱신이 안 되면 계정 `disconnected` + 알림 «다시 연결해 주세요».
 *   조용히 0건 금지 — 발행이 안 되는데 아무 말도 없는 상태를 만들지 않는다.
 *   🔴 토큰 평문은 이 파일 안에서만 다룬다(반환값은 발행 커넥터로만 · 로그·응답 0).
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "../../db/index";
import { encryptObj, decryptObj } from "../creds-crypto";
import { writeAudit } from "../audit";
import { refreshAccessToken, tokenNeedsRefresh, isOAuthChannel, type OAuthToken, type OAuthChannel } from "../oauth-providers";

type Row = Record<string, unknown>;
const q = async (s: SQL): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

export type TokenResult =
  | { ok: true; token: OAuthToken; refreshed: boolean }
  | { ok: false; reason: "no_creds" | "provider_not_configured" | "auth_failed"; detail?: string };

/** 저장된 OAuth 토큰 읽기(가장 최근 · purge 안 된 것). */
export async function loadOAuthToken(accountId: number): Promise<OAuthToken | null> {
  const [row] = await q(sql`SELECT enc FROM account_creds
    WHERE account_id = ${accountId} AND kind = 'oauth' AND purged_at IS NULL ORDER BY id DESC LIMIT 1`);
  if (!row) return null;
  return decryptObj<OAuthToken>(String(row.enc ?? ""));
}

/** 갱신값 저장 — 재암호화 후 기존 행은 purge(자격 이력은 남기고 «현재»는 하나). */
export async function saveOAuthToken(tid: number, accountId: number, token: OAuthToken): Promise<void> {
  const enc = encryptObj({ ...token } as unknown as Record<string, unknown>);
  await q(sql`UPDATE account_creds SET purged_at = NOW() WHERE account_id = ${accountId} AND kind = 'oauth' AND purged_at IS NULL`);
  await q(sql`INSERT INTO account_creds (tenant_id, account_id, kind, enc, expires_at, verified_at)
    VALUES (${tid}, ${accountId}, 'oauth', ${enc},
            ${token.expiresAt ? sql`${token.expiresAt}::timestamptz AT TIME ZONE 'UTC'` : null}, NOW())`);
}

/** 갱신 실패 — 계정을 끊고 사람에게 말한다. */
async function markDisconnected(tid: number, accountId: number, handle: string, reason: string): Promise<void> {
  await q(sql`UPDATE accounts SET status = 'disconnected', last_error_kind = 'login_fail', updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${accountId}`);
  try {
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      VALUES (${tid}, 'account_disconnected', ${"계정 연결이 끊겼어요"},
              ${`@${handle} 의 연결이 만료됐어요. 다시 연결해 주세요 — 그때까지 이 계정 예약은 올라가지 않아요.`}, ${"/app/accounts.html"})`);
  } catch (e) { console.error("[tokens] notify failed", e); }
  await writeAudit({ tenantId: tid, action: "account_token_refresh_fail", actorType: "system", target: `account:${accountId}`, detail: { reason: reason.slice(0, 160) }, riskLevel: "medium" });
}

/**
 * ensureFreshToken — 발행 직전에 쓸 수 있는 access token 을 준다.
 *   만료가 임박했으면(10분) 갱신하고 재암호화 저장 · 갱신 실패면 계정 disconnected + 알림.
 *   ⚠️ 만료 시각을 모르는 토큰은 그냥 써 본다 — 401 이 나면 커넥터가 `forceRefresh` 로 한 번 더 부른다.
 */
export async function ensureFreshToken(tid: number, accountId: number, channel: string, handle: string, forceRefresh = false): Promise<TokenResult> {
  if (!isOAuthChannel(channel)) return { ok: false, reason: "no_creds", detail: "not_oauth_channel" };
  const token = await loadOAuthToken(accountId);
  if (!token?.accessToken) return { ok: false, reason: "no_creds" };
  if (!forceRefresh && !tokenNeedsRefresh(token)) return { ok: true, token, refreshed: false };

  const r = await refreshAccessToken(channel as OAuthChannel, token);
  if (!r.ok) {
    if (r.reason === "provider_not_configured") return { ok: false, reason: "provider_not_configured" };
    await markDisconnected(tid, accountId, handle, r.reason);
    return { ok: false, reason: "auth_failed", detail: r.reason };
  }
  await saveOAuthToken(tid, accountId, r.token);
  await writeAudit({ tenantId: tid, action: "account_token_refreshed", actorType: "system", target: `account:${accountId}`, detail: { channel }, riskLevel: "low" });
  return { ok: true, token: r.token, refreshed: true };
}

/** 워드프레스 App Password 자격(kind 'app_password'). 🔴 반환값은 커넥터 안에서만. */
export interface WpCreds { siteUrl: string; loginId: string; appPassword: string }
export async function loadWpCreds(accountId: number): Promise<WpCreds | null> {
  const [row] = await q(sql`SELECT enc FROM account_creds
    WHERE account_id = ${accountId} AND kind = 'app_password' AND purged_at IS NULL ORDER BY id DESC LIMIT 1`);
  if (!row) return null;
  const o = decryptObj<Partial<WpCreds>>(String(row.enc ?? ""));
  if (!o?.siteUrl || !o?.loginId || !o?.appPassword) return null;
  return { siteUrl: String(o.siteUrl).replace(/\/$/, ""), loginId: String(o.loginId), appPassword: String(o.appPassword) };
}
