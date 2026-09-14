/**
 * lib/revenue/google-oauth.ts — 수익 소스용 구글 OAuth(애드센스 · 유튜브 애널리틱스). 계약 §1.2 · DESIGN §9.1.
 *
 *   ══ 왜 따로 있나 ══
 *     R2 의 `lib/oauth-providers.ts`(B2 소유 · import 만)는 **채널 연결** 스코프만 받는다:
 *       blogger = `auth/blogger` · youtube_shorts = `youtube.upload youtube.readonly`.
 *     수익 회수에는 `adsense.readonly` · `yt-analytics-monetary.readonly` 가 필요한데 그 토큰들엔 없다 —
 *     그래서 «업로드 토큰 재사용»(계약 §1.2 youtube 행)은 **현재 스코프로는 불가**하고, 수익 소스는 자기 스코프로 따로 동의를 받는다.
 *     (B2 가 SCOPES 에 애널리틱스 스코프를 더하면 그때부터 한 번의 동의로 둘 다 된다 — 메인에 보고함.)
 *   재사용하는 것: 앱 키(같은 env `GOOGLE_OAUTH_CLIENT_ID/SECRET`) · **토큰 갱신은 `refreshAccessToken("blogger", …)`**(구글 공통 · import 만).
 *   저장: `revenue_sources.cred_enc`(AES-256-GCM) · 러너에 내려보내지 않는다(평문 표면 0).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { refreshAccessToken, tokenNeedsRefresh, type OAuthToken } from "../oauth-providers";
import { httpJson } from "./common";

export type RevenueGoogleKind = "adsense" | "youtube";
const SCOPES: Record<RevenueGoogleKind, string> = {
  adsense: "https://www.googleapis.com/auth/adsense.readonly",
  youtube: "https://www.googleapis.com/auth/yt-analytics-monetary.readonly https://www.googleapis.com/auth/yt-analytics.readonly https://www.googleapis.com/auth/youtube.readonly",
};
const env = (k: string) => String(process.env[k] ?? "").trim();
const SITE = () => env("SITE_URL").replace(/\/$/, "");
export function revenueOauthRedirectUri(): string { return `${SITE()}/api/revenue-oauth-return`; }
export function googleAppConfigured(): boolean { return !!env("GOOGLE_OAUTH_CLIENT_ID") && !!env("GOOGLE_OAUTH_CLIENT_SECRET") && !!SITE(); }

/* ───────── state(서명 · 10분) ───────── */
const STATE_TTL_MS = 10 * 60_000;
function b64u(s: string | Buffer): string { return Buffer.from(s).toString("base64url"); }
export function signRevenueState(p: { tid: number; uid: number; kind: RevenueGoogleKind; accountId: number | null }): string {
  const body = b64u(JSON.stringify({ ...p, exp: Date.now() + STATE_TTL_MS }));
  const mac = createHmac("sha256", env("JWT_SECRET")).update(body).digest("base64url");
  return `${body}.${mac}`;
}
export function verifyRevenueState(state: string): { tid: number; uid: number; kind: RevenueGoogleKind; accountId: number | null } | null {
  const [body, mac] = String(state ?? "").split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", env("JWT_SECRET")).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(want);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const o = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!o || typeof o.exp !== "number" || o.exp < Date.now()) return null;
    if (o.kind !== "adsense" && o.kind !== "youtube") return null;
    return { tid: Number(o.tid), uid: Number(o.uid), kind: o.kind, accountId: o.accountId ? Number(o.accountId) : null };
  } catch { return null; }
}

/** 동의 URL. 앱 키·SITE_URL 없으면 null(= not_configured — 화면은 «키를 넣으면 바로 가져와요»). */
export function revenueAuthorizeUrl(kind: RevenueGoogleKind, state: string): string | null {
  if (!googleAppConfigured()) return null;
  const q = new URLSearchParams({
    client_id: env("GOOGLE_OAUTH_CLIENT_ID"), redirect_uri: revenueOauthRedirectUri(), response_type: "code",
    scope: SCOPES[kind], access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

/** code → 토큰(+ 구글 계정 식별). 실패 사유는 사람말. */
export async function exchangeRevenueCode(code: string): Promise<{ ok: true; token: OAuthToken } | { ok: false; reason: string }> {
  if (!googleAppConfigured()) return { ok: false, reason: "구글 앱 키가 아직 없어요." };
  const t = await httpJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env("GOOGLE_OAUTH_CLIENT_ID"), client_secret: env("GOOGLE_OAUTH_CLIENT_SECRET"), redirect_uri: revenueOauthRedirectUri(), grant_type: "authorization_code" }).toString(),
  });
  if (!t.ok || !t.json?.access_token) return { ok: false, reason: `구글 토큰 교환 실패(${t.status})` };
  const expiresAt = Number.isFinite(Number(t.json.expires_in)) ? new Date(Date.now() + Number(t.json.expires_in) * 1000).toISOString() : undefined;
  // 누구의 동의인지(표시용) — userinfo 는 실패해도 치명 아님.
  let externalId = "", handle = "";
  const u = await httpJson("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${t.json.access_token}` } });
  if (u.ok && u.json) { externalId = String(u.json.sub ?? ""); handle = String(u.json.email ?? u.json.name ?? ""); }
  return { ok: true, token: { accessToken: String(t.json.access_token), refreshToken: t.json.refresh_token ? String(t.json.refresh_token) : undefined, ...(expiresAt ? { expiresAt } : {}), externalId, handle } };
}

/**
 * ensureFresh — 만료 임박이면 갱신(구글 공통 갱신기 재사용). 갱신됐으면 `changed:true` → 호출부가 cred_enc 를 다시 저장한다.
 *   갱신 실패(refresh_token 없음·revoked)는 auth(고객 재연결) 이다.
 */
export async function ensureFresh(token: OAuthToken): Promise<{ ok: true; token: OAuthToken; changed: boolean } | { ok: false; reason: string }> {
  if (!tokenNeedsRefresh(token)) return { ok: true, token, changed: false };
  const r = await refreshAccessToken("blogger", token);   // provider=google — 채널 이름은 갱신 엔드포인트 선택용일 뿐이다
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, token: r.token, changed: true };
}
