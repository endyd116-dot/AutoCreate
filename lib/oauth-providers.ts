/**
 * lib/oauth-providers.ts — OAuth 채널 연결(인가 URL · 토큰 교환 · 장기 토큰 · 프로필). AM 원본: ../AutoMarketing/lib/publish-threads.ts(인가·교환 관례 2026-09-14 이식) + publish-instagram(Meta 장기 토큰)
 *   채널 → 앱: blogger·youtube_shorts = Google(GOOGLE_OAUTH_CLIENT_ID/SECRET) · instagram·reels = Meta(META_APP_ID/SECRET) ·
 *              threads = Threads(THREADS_APP_ID/SECRET) · tiktok = TikTok(TIKTOK_CLIENT_KEY/SECRET).
 *   env 앱 키가 없으면 configured=false → 핸들러가 step:"provider_not_configured"(코드 완성 · 키 꽂으면 가동 · CLAUDE §8).
 *   state = HMAC 서명(JWT_SECRET) — tid·channel·nonce·만료 10분. 콜백 = `${SITE_URL}/api/accounts-oauth-return`(각 앱 대시보드의 Redirect URI 와 글자 하나까지 같아야 한다).
 *   규격(공식 문서 2026-09 확인치 · 실 왕복은 R2 실증):
 *     Google  authorize accounts.google.com/o/oauth2/v2/auth · token oauth2.googleapis.com/token · blogger v3 users/self/blogs · youtube v3 channels?mine=true
 *     Meta    authorize facebook.com/v21.0/dialog/oauth · token graph.facebook.com/v21.0/oauth/access_token(+fb_exchange_token 60일) · me/accounts?fields=instagram_business_account
 *     Threads authorize threads.net/oauth/authorize · token graph.threads.net/oauth/access_token · th_exchange_token(60일) · v1.0/me?fields=id,username
 *     TikTok  authorize tiktok.com/v2/auth/authorize · token open.tiktokapis.com/v2/oauth/token · v2/user/info
 *   graceful: throw 금지 — 실패 { ok:false, reason }.
 */
import crypto from "node:crypto";

export type OAuthChannel = "blogger" | "youtube_shorts" | "instagram" | "reels" | "threads" | "tiktok";
export const OAUTH_CHANNELS: ReadonlySet<string> = new Set(["blogger", "youtube_shorts", "instagram", "reels", "threads", "tiktok"]);
export function isOAuthChannel(ch: string): ch is OAuthChannel { return OAUTH_CHANNELS.has(ch); }

type ProviderKey = "google" | "meta" | "threads" | "tiktok";
const PROVIDER_OF: Record<OAuthChannel, ProviderKey> = { blogger: "google", youtube_shorts: "google", instagram: "meta", reels: "meta", threads: "threads", tiktok: "tiktok" };

const env = (k: string) => String(process.env[k] ?? "").trim();
const SITE = () => env("SITE_URL").replace(/\/$/, "");
export function oauthRedirectUri(): string { return `${SITE()}/api/accounts-oauth-return`; }

function appCreds(p: ProviderKey): { id: string; secret: string } | null {
  const m: Record<ProviderKey, [string, string]> = {
    google: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"], meta: ["META_APP_ID", "META_APP_SECRET"],
    threads: ["THREADS_APP_ID", "THREADS_APP_SECRET"], tiktok: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
  };
  const [a, b] = m[p];
  return env(a) && env(b) ? { id: env(a), secret: env(b) } : null;
}
/** 채널의 앱 키가 있는가(accounts-list channels[].configured). */
export function providerConfigured(channel: string): boolean {
  if (!isOAuthChannel(channel)) return true;
  return !!appCreds(PROVIDER_OF[channel]) && !!SITE();
}

/* ───────── state 서명 ───────── */
const STATE_TTL_MS = 10 * 60_000;
function stateSecret(): string { return env("JWT_SECRET"); }
export function signState(p: { tid: number; channel: OAuthChannel; uid: number }): string {
  const body = Buffer.from(JSON.stringify({ ...p, n: crypto.randomBytes(8).toString("hex"), exp: Date.now() + STATE_TTL_MS })).toString("base64url");
  const sig = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyState(state: string): { tid: number; channel: OAuthChannel; uid: number } | null {
  const [body, sig] = String(state || "").split(".");
  if (!body || !sig) return null;
  const want = crypto.createHmac("sha256", stateSecret()).update(body).digest("base64url");
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { tid: number; channel: OAuthChannel; uid: number; exp: number };
    if (!p.exp || p.exp < Date.now() || !isOAuthChannel(p.channel)) return null;
    return { tid: Number(p.tid), channel: p.channel, uid: Number(p.uid) };
  } catch { return null; }
}

/* ───────── 인가 URL ───────── */
const SCOPES: Record<OAuthChannel, string> = {
  blogger: "https://www.googleapis.com/auth/blogger",
  /* [P1R3 v3.5 §1.4d(2)] yt-analytics-monetary.readonly 를 함께 받는다 — 한 번의 동의로 업로드+수익 회수.
     이미 연결된 토큰은 이 스코프가 없으므로 «다시 연결하기»(accounts-oauth-start) 로 재동의해야 한다(새 화면 불필요). */
  youtube_shorts: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/yt-analytics-monetary.readonly",
  instagram: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management",
  reels: "instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,business_management",
  threads: "threads_basic,threads_content_publish",
  tiktok: "user.info.basic,video.publish,video.upload",
};

export function authorizeUrl(channel: OAuthChannel, state: string): string | null {
  const p = PROVIDER_OF[channel];
  const app = appCreds(p);
  if (!app || !SITE()) return null;
  const redirect = oauthRedirectUri();
  switch (p) {
    case "google": {
      const q = new URLSearchParams({ client_id: app.id, redirect_uri: redirect, response_type: "code", scope: SCOPES[channel], access_type: "offline", prompt: "consent", include_granted_scopes: "true", state });
      return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
    }
    case "meta": {
      const q = new URLSearchParams({ client_id: app.id, redirect_uri: redirect, response_type: "code", scope: SCOPES[channel], state });
      return `https://www.facebook.com/v21.0/dialog/oauth?${q}`;
    }
    case "threads": {
      const q = new URLSearchParams({ client_id: app.id, redirect_uri: redirect, response_type: "code", scope: SCOPES[channel], state });
      return `https://threads.net/oauth/authorize?${q}`;
    }
    case "tiktok": {
      const q = new URLSearchParams({ client_key: app.id, redirect_uri: redirect, response_type: "code", scope: SCOPES[channel], state });
      return `https://www.tiktok.com/v2/auth/authorize/?${q}`;
    }
  }
}

/* ───────── 토큰 교환 + 프로필 ───────── */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  /** ISO · 모르면 없음. */
  expiresAt?: string;
  externalId: string;
  handle: string;
  displayName?: string;
  /** 채널별 부가(블로거 blogId·유튜브 channelId·IG ig_user_id·페이지 토큰 등). */
  extra?: Record<string, unknown>;
}
export type ExchangeResult = { ok: true; token: OAuthToken } | { ok: false; reason: string };

async function jfetch(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<{ ok: boolean; status: number; json: any }> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    let json: any = null; try { json = await r.json(); } catch { /* 본문 없음 */ }
    return { ok: r.ok, status: r.status, json };
  } catch (e) { return { ok: false, status: 0, json: { error: String((e as Error)?.message ?? e).slice(0, 120) } }; }
  finally { clearTimeout(t); }
}
const form = (o: Record<string, string>) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const isoIn = (sec: unknown) => Number.isFinite(Number(sec)) && Number(sec) > 0 ? new Date(Date.now() + Number(sec) * 1000).toISOString() : undefined;

export async function exchangeCode(channel: OAuthChannel, code: string): Promise<ExchangeResult> {
  const p = PROVIDER_OF[channel];
  const app = appCreds(p);
  if (!app || !SITE()) return { ok: false, reason: "provider_not_configured" };
  const redirect = oauthRedirectUri();
  try {
    switch (p) {
      case "google": {
        const t = await jfetch("https://oauth2.googleapis.com/token", form({ code, client_id: app.id, client_secret: app.secret, redirect_uri: redirect, grant_type: "authorization_code" }));
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `google_token_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        const at = String(t.json.access_token);
        const bearer = { headers: { Authorization: `Bearer ${at}` } };
        if (channel === "blogger") {
          const b = await jfetch("https://www.googleapis.com/blogger/v3/users/self/blogs", bearer);
          const blog = b.json?.items?.[0];
          if (!blog?.id) return { ok: false, reason: "blogger_no_blog" };
          return { ok: true, token: { accessToken: at, refreshToken: t.json.refresh_token, expiresAt: isoIn(t.json.expires_in), externalId: String(blog.id), handle: String(blog.url || blog.name || blog.id).replace(/^https?:\/\//, "").replace(/\/$/, ""), displayName: String(blog.name || ""), extra: { blogId: String(blog.id), blogUrl: blog.url } } };
        }
        const c = await jfetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", bearer);
        const ch = c.json?.items?.[0];
        if (!ch?.id) return { ok: false, reason: "youtube_no_channel" };
        return { ok: true, token: { accessToken: at, refreshToken: t.json.refresh_token, expiresAt: isoIn(t.json.expires_in), externalId: String(ch.id), handle: String(ch.snippet?.customUrl || ch.snippet?.title || ch.id).replace(/^@/, ""), displayName: String(ch.snippet?.title || ""), extra: { channelId: String(ch.id) } } };
      }
      case "meta": {
        const q = new URLSearchParams({ client_id: app.id, client_secret: app.secret, redirect_uri: redirect, code });
        const t = await jfetch(`https://graph.facebook.com/v21.0/oauth/access_token?${q}`);
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `meta_token_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        let at = String(t.json.access_token); let expiresAt = isoIn(t.json.expires_in);
        const lq = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: app.id, client_secret: app.secret, fb_exchange_token: at });
        const l = await jfetch(`https://graph.facebook.com/v21.0/oauth/access_token?${lq}`);
        if (l.ok && l.json?.access_token) { at = String(l.json.access_token); expiresAt = isoIn(l.json.expires_in) ?? expiresAt; }
        const pages = await jfetch(`https://graph.facebook.com/v21.0/me/accounts?fields=id,name,access_token,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(at)}`);
        const page = (pages.json?.data as any[] | undefined)?.find((x) => x?.instagram_business_account?.id);
        if (!page) return { ok: false, reason: "instagram_no_business_account" };
        const ig = page.instagram_business_account;
        return { ok: true, token: { accessToken: at, expiresAt, externalId: String(ig.id), handle: String(ig.username || ig.id), displayName: String(ig.name || page.name || ""), extra: { igUserId: String(ig.id), pageId: String(page.id), pageAccessToken: page.access_token } } };
      }
      case "threads": {
        const t = await jfetch("https://graph.threads.net/oauth/access_token", form({ client_id: app.id, client_secret: app.secret, grant_type: "authorization_code", redirect_uri: redirect, code }));
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `threads_token_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        let at = String(t.json.access_token); let expiresAt: string | undefined;
        const l = await jfetch(`https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(app.secret)}&access_token=${encodeURIComponent(at)}`);
        if (l.ok && l.json?.access_token) { at = String(l.json.access_token); expiresAt = isoIn(l.json.expires_in); }
        const me = await jfetch(`https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=${encodeURIComponent(at)}`);
        const id = String(me.json?.id || t.json.user_id || "");
        if (!id) return { ok: false, reason: "threads_no_profile" };
        return { ok: true, token: { accessToken: at, expiresAt, externalId: id, handle: String(me.json?.username || id), displayName: String(me.json?.name || ""), extra: { userId: id } } };
      }
      case "tiktok": {
        const t = await jfetch("https://open.tiktokapis.com/v2/oauth/token/", form({ client_key: app.id, client_secret: app.secret, code, grant_type: "authorization_code", redirect_uri: redirect }));
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `tiktok_token_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        const at = String(t.json.access_token);
        const u = await jfetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username", { headers: { Authorization: `Bearer ${at}` } });
        const user = u.json?.data?.user;
        const id = String(user?.open_id || t.json.open_id || "");
        if (!id) return { ok: false, reason: "tiktok_no_profile" };
        return { ok: true, token: { accessToken: at, refreshToken: t.json.refresh_token, expiresAt: isoIn(t.json.expires_in), externalId: id, handle: String(user?.username || user?.display_name || id), displayName: String(user?.display_name || ""), extra: { openId: id, refreshExpiresIn: t.json.refresh_expires_in } } };
      }
    }
  } catch (e) { return { ok: false, reason: `exchange_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
}

/* ───────── 토큰 갱신(B2-5 · 2026-09-14) ─────────
 *   access token 만료 시 재발급. 저장·재암호화는 `lib/publish/tokens.ts` 가 한다(이 파일은 순수 — DB 접근 0).
 *   · Google(blogger·youtube): refresh_token 으로 재발급(refresh_token 은 그대로 유지 — 응답에 없다).
 *   · Meta/Threads: refresh_token 이 없다. 장기 토큰을 **만료 전에 교환**해 연장한다(threads th_refresh_token · meta fb_exchange_token).
 *   · TikTok: refresh_token 회전(새 refresh_token 이 응답에 온다 — 반드시 저장).
 *   graceful: throw 금지. 실패 { ok:false, reason } — 호출자가 계정 disconnected + 알림.
 */
export type RefreshResult = { ok: true; token: OAuthToken } | { ok: false; reason: string };

/** 만료까지 이 시간보다 적게 남았으면 갱신한다(클록 스큐·왕복 여유). */
export const TOKEN_REFRESH_MARGIN_MS = 10 * 60_000;
export function tokenNeedsRefresh(token: { expiresAt?: string } | null | undefined): boolean {
  const e = String(token?.expiresAt ?? "").trim();
  if (!e) return false;                       // 만료를 모르면 그냥 써 본다(401 이면 그때 갱신)
  const t = Date.parse(e);
  return Number.isFinite(t) && t - Date.now() < TOKEN_REFRESH_MARGIN_MS;
}

export async function refreshAccessToken(channel: OAuthChannel, token: OAuthToken): Promise<RefreshResult> {
  const p = PROVIDER_OF[channel];
  const app = appCreds(p);
  if (!app) return { ok: false, reason: "provider_not_configured" };
  try {
    switch (p) {
      case "google": {
        if (!token.refreshToken) return { ok: false, reason: "no_refresh_token" };
        const t = await jfetch("https://oauth2.googleapis.com/token", form({ client_id: app.id, client_secret: app.secret, refresh_token: token.refreshToken, grant_type: "refresh_token" }));
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `google_refresh_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        // refresh_token 은 응답에 없다 — 기존 것을 유지한다(지우면 다음 갱신이 영영 불가).
        return { ok: true, token: { ...token, accessToken: String(t.json.access_token), expiresAt: isoIn(t.json.expires_in), refreshToken: t.json.refresh_token ? String(t.json.refresh_token) : token.refreshToken } };
      }
      case "meta": {
        const q = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: app.id, client_secret: app.secret, fb_exchange_token: token.accessToken });
        const t = await jfetch(`https://graph.facebook.com/v21.0/oauth/access_token?${q}`);
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `meta_refresh_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        return { ok: true, token: { ...token, accessToken: String(t.json.access_token), expiresAt: isoIn(t.json.expires_in) } };
      }
      case "threads": {
        const t = await jfetch(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token.accessToken)}`);
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `threads_refresh_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        return { ok: true, token: { ...token, accessToken: String(t.json.access_token), expiresAt: isoIn(t.json.expires_in) } };
      }
      case "tiktok": {
        if (!token.refreshToken) return { ok: false, reason: "no_refresh_token" };
        const t = await jfetch("https://open.tiktokapis.com/v2/oauth/token/", form({ client_key: app.id, client_secret: app.secret, grant_type: "refresh_token", refresh_token: token.refreshToken }));
        if (!t.ok || !t.json?.access_token) return { ok: false, reason: `tiktok_refresh_${t.status}: ${JSON.stringify(t.json ?? "").slice(0, 120)}` };
        // ⚠️ TikTok 은 refresh_token 이 회전한다 — 새 값을 저장하지 않으면 다음 갱신이 실패한다.
        return { ok: true, token: { ...token, accessToken: String(t.json.access_token), refreshToken: t.json.refresh_token ? String(t.json.refresh_token) : token.refreshToken, expiresAt: isoIn(t.json.expires_in) } };
      }
    }
  } catch (e) { return { ok: false, reason: `refresh_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
}
