/**
 * lib/auth.ts — 인증 코어. AM 원본: ../AutoMarketing/lib/auth.ts (복사 2026-09-14 · AC 구조로 개작)
 *   AM과의 차이(DESIGN §11.0): 고객(users)·운영자(operators)를 **다른 토큰·다른 쿠키**로 분리한다.
 *     - 고객  쿠키 `ac_user` · 클레임 UserClaims  { uid, tid, role: owner|member }
 *     - 운영자 쿠키 `ac_ops`  · 클레임 OpsClaims   { oid, role: super_admin|admin|operator, imp? }
 *   유지한 것: httpOnly 쿠키 · 2시간 유휴(슬라이딩) · 액션 토큰 분리 시크릿(typ:"action") · 허브 SSO 검증(iss/aud 필수).
 *   추가: 30일 리프레시 토큰(DB 저장·해시·회전) — «로그인 유지».
 */
import jwt from "jsonwebtoken";
import { createHash, randomBytes } from "node:crypto";

const SECRET = process.env.JWT_SECRET || "";
const ACTION_SECRET = process.env.ACTION_TOKEN_SECRET || SECRET;
const EXPIRES = process.env.SESSION_EXPIRES_IN || "2h";
const SESSION_MAX_AGE = Number(process.env.SESSION_MAX_AGE_SEC) || 7200;
export const REFRESH_DAYS = 30;

const SSO_SECRET = process.env.SSO_SHARED_SECRET || "";
const SSO_ISS = "siren-hub";
const SSO_AUD = process.env.SSO_AUD || "autocreate";

export const USER_COOKIE = "ac_user";
export const OPS_COOKIE = "ac_ops";
export const REFRESH_COOKIE = "ac_refresh";

export type UserRole = "owner" | "member";
export type OpsRole = "super_admin" | "admin" | "operator";

export type UserClaims = { typ: "user"; uid: number; tid: number; role: UserRole; email?: string; name?: string };
export type OpsClaims = {
  typ: "ops"; oid: number; role: OpsRole; email?: string; name?: string;
  /** 원격접속(impersonation) — 운영자가 고객 화면을 볼 때만. 고객 토큰에 얹어 발급한다(§11.4). */
  imp?: { by: number; byName?: string; tid: number; tenantKey: string; at?: number; until?: number } | null;
};
/** 원격접속 세션 상한(분 · 계약 §2.3 «세션 60분 상한»). 토큰 만료 = 쿠키 만료 — 지나면 고객 API 가 401 을 내 화면이 로그인으로 돌아간다. */
export const IMPERSONATION_MAX_MIN = 60;

if (!SECRET) console.warn("[auth] JWT_SECRET 미설정 — 토큰 서명 불가");

/* ───────── 서명·검증 ───────── */
export function signUserToken(c: Omit<UserClaims, "typ">): string {
  return jwt.sign({ ...c, typ: "user" }, SECRET, { expiresIn: EXPIRES } as jwt.SignOptions);
}
export function signOpsToken(c: Omit<OpsClaims, "typ">): string {
  return jwt.sign({ ...c, typ: "ops" }, SECRET, { expiresIn: EXPIRES } as jwt.SignOptions);
}
/** 원격접속 세션 = 고객 토큰 모양 + imp 정보(감사·배너·결제 차단 판정용). */
export function signImpersonationToken(c: Omit<UserClaims, "typ"> & { imp: NonNullable<OpsClaims["imp"]> }): string {
  return jwt.sign({ ...c, typ: "user" }, SECRET, { expiresIn: `${IMPERSONATION_MAX_MIN}m` } as jwt.SignOptions);
}

function verify<T extends { typ: string }>(token: string | null, typ: T["typ"]): T | null {
  if (!token || !SECRET) return null;
  try {
    const p = jwt.verify(token, SECRET) as T & { purpose?: string };
    if (p.typ !== typ || p.purpose) return null;   // 액션 토큰·타 종류 토큰 승격 차단
    return p;
  } catch { return null; }
}

export function verifyUser(req: Request): (UserClaims & { imp?: OpsClaims["imp"] }) | null {
  return verify<UserClaims & { imp?: OpsClaims["imp"] }>(readCookie(req, USER_COOKIE) || bearer(req), "user");
}
export function verifyOps(req: Request): OpsClaims | null {
  return verify<OpsClaims>(readCookie(req, OPS_COOKIE) || bearer(req), "ops");
}

/* ───────── 쿠키 ───────── */
function secureFlag(): string {
  return (process.env.SITE_URL || "").startsWith("https") ? "; Secure" : "";
}
export function userCookie(token: string, maxAgeSec: number = SESSION_MAX_AGE): string {
  return `${USER_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAgeSec))}${secureFlag()}`;
}
export function opsCookie(token: string): string {
  return `${OPS_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secureFlag()}`;
}
export function refreshCookie(raw: string): string {
  return `${REFRESH_COOKIE}=${encodeURIComponent(raw)}; HttpOnly; Path=/api/auth-refresh; SameSite=Lax; Max-Age=${REFRESH_DAYS * 86400}${secureFlag()}`;
}
export function clearCookie(name: string, path = "/"): string {
  return `${name}=; HttpOnly; Path=${path}; SameSite=Lax; Max-Age=0${secureFlag()}`;
}
export function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie") || "";
  for (const part of raw.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}
function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/* ───────── 리프레시 토큰(«로그인 유지») — 원문은 쿠키에만, DB엔 sha256 ───────── */
export function newRefreshToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString("base64url");
  return { raw, hash: hashToken(raw), expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400_000) };
}
export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/* ───────── 단명 액션 토큰(이메일 인증·비밀번호 재설정) — 세션과 분리 시크릿·typ:"action" ───────── */
export type ActionPurpose = "verify" | "reset" | "ops_reset";
export function signActionToken(c: { id: number; purpose: ActionPurpose; nonce: string }, expiresIn: string): string {
  return jwt.sign({ ...c, typ: "action" }, ACTION_SECRET, { expiresIn } as jwt.SignOptions);
}
export function verifyActionToken(token: string): { id: number; purpose: ActionPurpose; nonce: string } | null {
  try {
    const p = jwt.verify(token, ACTION_SECRET) as { id?: number; purpose?: ActionPurpose; nonce?: string; typ?: string };
    if (p.typ !== "action" || p.id == null || !p.purpose || !p.nonce) return null;
    return { id: Number(p.id), purpose: p.purpose, nonce: p.nonce };
  } catch { return null; }
}
export function newNonce(): string { return randomBytes(16).toString("hex"); }

/* ───────── 허브(싸이렌MIS) SSO — AM 계약 그대로(iss·aud 필수·60초) ───────── */
export type SsoClaims = { sub: string; name?: string; email?: string; role?: string; phone?: string; iss?: string; aud?: string };
export function verifySsoToken(token: string): SsoClaims | null {
  if (!SSO_SECRET || !SSO_AUD || !token) return null;
  try {
    const p = jwt.verify(token, SSO_SECRET) as SsoClaims;
    if (!p?.sub || p.iss !== SSO_ISS || p.aud !== SSO_AUD) return null;
    return p;
  } catch { return null; }
}

/* ───────── 요청 메타 ───────── */
export function clientIp(req: Request): string | null {
  return (req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
}
export function userAgent(req: Request): string | null {
  return (req.headers.get("user-agent") || "").slice(0, 200) || null;
}
