/**
 * lib/auth-service.ts — 가입·로그인·세션 발급·잠금·리프레시(고객 + 운영자). DESIGN §11.0.
 *   원칙: 핸들러는 얇게, 규칙은 여기 한 곳(잠금 5회/15분 · 리프레시 회전 · 감사).
 *   jsonb 쓰기 없음. timestamp = UTC(PITFALLS #4).
 *   🔎 출처: AC 신규(계약 phase0 · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import bcrypt from "bcryptjs";
import { sql } from "drizzle-orm";
import { jsonb, utcDate } from "./db-util";
import { db } from "../db/index";
import {
  signUserToken, signOpsToken, userCookie, opsCookie, refreshCookie, clearCookie, newRefreshToken, hashToken,
  USER_COOKIE, OPS_COOKIE, REFRESH_COOKIE, type UserClaims, type OpsClaims, type OpsRole, type UserRole,
} from "./auth";
import { writeAudit } from "./audit";
import { currentTrialPromo } from "./plans";
import { tenantKeyFrom } from "./validate";

const BCRYPT_COST = 12;
const LOCK_AFTER = 5;
const LOCK_MIN = 15;

type Row = Record<string, unknown>;
const rows = async (q: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(q)) as unknown as Row[];

/* ═══════════ 고객 ═══════════ */
export interface UserRow { id: number; tenant_id: number; email: string; password_hash: string; name: string | null; role: UserRole;
  email_verified_at: Date | null; must_change_password: boolean; failed_logins: number; locked_until: Date | null }

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  const r = await rows(sql`SELECT * FROM users WHERE email = ${email} LIMIT 1`);
  return (r[0] as unknown as UserRow) || null;
}

/** 가입 = 테넌트 생성(체험 N일) + owner 사용자. 반환 user·tenant·verifyNonce. */
export async function registerUser(input: { email: string; password: string; name?: string; ip?: string | null }) {
  const { days: trialDays, promoId } = await currentTrialPromo();
  const hash = await bcrypt.hash(input.password, BCRYPT_COST);
  const key = tenantKeyFrom(input.email);
  const nonce = hashToken(`${input.email}:${Date.now()}:${Math.random()}`).slice(0, 48);
  const t = await rows(sql`
    INSERT INTO tenants (key, name, plan_key, status, trial_ends_at, settings)
    VALUES (${key}, ${input.name || input.email.split("@")[0]}, ${"trial"}, ${"trial"}, NOW() + (${trialDays} || ' days')::interval, ${jsonb({ trialDays })})
    RETURNING id, key, trial_ends_at`);
  const tenant = t[0];
  const u = await rows(sql`
    INSERT INTO users (tenant_id, email, password_hash, name, role, verify_nonce)
    VALUES (${Number(tenant.id)}, ${input.email}, ${hash}, ${input.name || null}, ${"owner"}, ${nonce})
    RETURNING id, tenant_id, email, name, role`);
  const user = u[0];
  await writeAudit({ tenantId: Number(tenant.id), action: "user_register", actorType: "user", actorId: Number(user.id), ip: input.ip ?? null, detail: { trialDays, promoId } });
  if (promoId) {   // 체험 기간 이벤트 성과(계약 §2.1 ops-promotions stats.used/converted) — 실패해도 가입은 정상
    try {
      await rows(sql`UPDATE promotions SET uses = uses + 1, updated_at = NOW() WHERE id = ${promoId}`);
      await writeAudit({ tenantId: Number(tenant.id), action: "promo_applied", actorType: "system", target: `promotion:${promoId}`, detail: { kind: "trial_days", days: trialDays } });
    } catch (e) { console.warn("[auth-service] promo uses 실패", String((e as Error)?.message ?? e).slice(0, 100)); }
  }
  return { user, tenant, verifyNonce: nonce, trialDays };
}

export type LoginResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: "invalid" | "locked"; lockedUntil?: Date | null };

export async function loginUser(email: string, password: string, ip: string | null): Promise<LoginResult> {
  const user = await findUserByEmail(email);
  if (!user) { await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv"); return { ok: false, reason: "invalid" }; }
  if (user.locked_until && new Date(user.locked_until) > new Date()) return { ok: false, reason: "locked", lockedUntil: user.locked_until };
  const good = await bcrypt.compare(password, user.password_hash);
  if (!good) {
    const n = (user.failed_logins || 0) + 1;
    if (n >= LOCK_AFTER) {
      await rows(sql`UPDATE users SET failed_logins = 0, locked_until = NOW() + (${LOCK_MIN} || ' minutes')::interval WHERE id = ${user.id}`);
      await writeAudit({ tenantId: user.tenant_id, action: "user_login_locked", actorType: "user", actorId: user.id, ip, riskLevel: "medium" });
      return { ok: false, reason: "locked" };
    }
    await rows(sql`UPDATE users SET failed_logins = ${n} WHERE id = ${user.id}`);
    return { ok: false, reason: "invalid" };
  }
  await rows(sql`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ${user.id}`);
  await writeAudit({ tenantId: user.tenant_id, action: "user_login", actorType: "user", actorId: user.id, ip });
  return { ok: true, user };
}

/** 세션 발급 — Set-Cookie 헤더 배열. remember=true 면 리프레시 토큰(30일·DB 해시) 동반. */
export async function issueUserSession(u: { id: number; tenant_id: number; email: string; name?: string | null; role: UserRole },
  opts: { remember?: boolean; ua?: string | null; ip?: string | null } = {}): Promise<string[]> {
  const token = signUserToken({ uid: u.id, tid: u.tenant_id, role: u.role, email: u.email, name: u.name || undefined });
  const headers = [userCookie(token)];
  if (opts.remember) {
    const rt = newRefreshToken();
    await rows(sql`INSERT INTO refresh_tokens (subject_type, subject_id, token_hash, expires_at, ua, ip)
      VALUES (${"user"}, ${u.id}, ${rt.hash}, ${rt.expiresAt.toISOString()}::timestamptz AT TIME ZONE ${"UTC"}, ${opts.ua ?? null}, ${opts.ip ?? null})`);
    headers.push(refreshCookie(rt.raw));
  }
  return headers;
}

/** 리프레시 토큰으로 새 세션 + 토큰 회전. 실패 null. */
export async function refreshUserSession(raw: string, meta: { ua?: string | null; ip?: string | null }): Promise<string[] | null> {
  const h = hashToken(raw);
  const r = await rows(sql`SELECT rt.id, u.id AS uid, u.tenant_id, u.email, u.name, u.role FROM refresh_tokens rt
    JOIN users u ON u.id = rt.subject_id WHERE rt.subject_type = ${"user"} AND rt.token_hash = ${h} AND rt.revoked_at IS NULL AND rt.expires_at > NOW() LIMIT 1`);
  const row = r[0];
  if (!row) return null;
  await rows(sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ${Number(row.id)}`);   // 회전
  return issueUserSession({ id: Number(row.uid), tenant_id: Number(row.tenant_id), email: String(row.email), name: row.name as string | null, role: row.role as UserRole }, { remember: true, ...meta });
}

export async function revokeRefresh(raw: string | null): Promise<void> {
  if (!raw) return;
  await rows(sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ${hashToken(raw)} AND revoked_at IS NULL`);
}
export async function revokeAllRefresh(subjectType: "user" | "operator", subjectId: number): Promise<number> {
  const r = await rows(sql`UPDATE refresh_tokens SET revoked_at = NOW() WHERE subject_type = ${subjectType} AND subject_id = ${subjectId} AND revoked_at IS NULL RETURNING id`);
  return r.length;
}

export function logoutHeaders(): string[] {
  return [clearCookie(USER_COOKIE), clearCookie(REFRESH_COOKIE, "/api/auth-refresh")];
}

export async function setUserPassword(userId: number, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await rows(sql`UPDATE users SET password_hash = ${hash}, reset_nonce = NULL, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = ${userId}`);
}
export async function verifyPassword(hash: string, password: string): Promise<boolean> { return bcrypt.compare(password, hash); }

/** /api/auth-me 응답 재료 — 사용자·테넌트·플랜·체험 남은 일·코인 잔액(원장 합산 · AM 규율 «잔액 컬럼 없음»). */
export async function userContext(uid: number, tid: number) {
  const [u] = await rows(sql`SELECT id, email, name, role, email_verified_at, must_change_password FROM users WHERE id = ${uid} AND tenant_id = ${tid}`);
  const [t] = await rows(sql`SELECT id, key, name, plan_key, status, trial_ends_at, settings FROM tenants WHERE id = ${tid}`);
  const [c] = await rows(sql`SELECT COALESCE(SUM(delta),0) AS balance FROM coin_ledger WHERE tenant_id = ${tid} AND (expires_at IS NULL OR expires_at > NOW())`);
  if (!u || !t) return null;
  const trialEnds = utcDate(t.trial_ends_at);
  const trialDaysLeft = trialEnds ? Math.max(0, Math.ceil((trialEnds.getTime() - Date.now()) / 86400_000)) : null;
  return {
    user: { id: Number(u.id), email: u.email, name: u.name, role: u.role, emailVerified: !!u.email_verified_at, mustChangePassword: !!u.must_change_password },
    tenant: { id: Number(t.id), key: t.key, name: t.name, planKey: t.plan_key, status: t.status, trialEndsAt: trialEnds, trialDaysLeft, settings: t.settings },
    coins: Number(c?.balance || 0),
  };
}

/* ═══════════ 운영자 ═══════════ */
export interface OperatorRow { id: number; email: string; password_hash: string | null; name: string | null; role: OpsRole; active: boolean;
  must_change_password: boolean; failed_logins: number; locked_until: Date | null; sso_sub: string | null }

export async function findOperatorByEmail(email: string): Promise<OperatorRow | null> {
  const r = await rows(sql`SELECT * FROM operators WHERE email = ${email} LIMIT 1`);
  return (r[0] as unknown as OperatorRow) || null;
}

export async function loginOperator(email: string, password: string, ip: string | null): Promise<{ ok: true; op: OperatorRow } | { ok: false; reason: "invalid" | "locked" | "inactive" }> {
  const op = await findOperatorByEmail(email);
  if (!op || !op.password_hash) { await bcrypt.compare(password, "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv"); return { ok: false, reason: "invalid" }; }
  if (!op.active) return { ok: false, reason: "inactive" };
  if (op.locked_until && new Date(op.locked_until) > new Date()) return { ok: false, reason: "locked" };
  const good = await bcrypt.compare(password, op.password_hash);
  if (!good) {
    const n = (op.failed_logins || 0) + 1;
    if (n >= LOCK_AFTER) {
      await rows(sql`UPDATE operators SET failed_logins = 0, locked_until = NOW() + (${LOCK_MIN} || ' minutes')::interval WHERE id = ${op.id}`);
      await writeAudit({ tenantId: null, action: "ops_login_locked", actorType: "operator", actorId: op.id, ip, riskLevel: "high" });
      return { ok: false, reason: "locked" };
    }
    await rows(sql`UPDATE operators SET failed_logins = ${n} WHERE id = ${op.id}`);
    return { ok: false, reason: "invalid" };
  }
  await rows(sql`UPDATE operators SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ${op.id}`);
  await writeAudit({ tenantId: null, action: "ops_login", actorType: "operator", actorId: op.id, ip });
  return { ok: true, op };
}

export function issueOpsSession(op: { id: number; email: string; name?: string | null; role: OpsRole }): string[] {
  // ★C(P1R4) fix: 원시 SELECT 의 bigint 는 postgres-js 가 **문자열**로 준다 — "1" 이 토큰에 실리면 `id === g.ops.oid`(자기 자신 보호)가 항상 거짓이라 super_admin 이 스스로를 강등·비활성화할 수 있었다(실측 · admin 이 operator 로 내려앉음).
  const token = signOpsToken({ oid: Number(op.id), role: op.role, email: op.email, name: op.name || undefined });
  return [opsCookie(token)];
}
export function opsLogoutHeaders(): string[] { return [clearCookie(OPS_COOKIE)]; }

export async function setOperatorPassword(id: number, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await rows(sql`UPDATE operators SET password_hash = ${hash}, must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = ${id}`);
}

/**
 * 🔴 [2026-09-19 수리 · 시나리오 B ⑥] **뽑은 사람을 들여보내는 손.**
 *   `POST /api/ops-operators` 로 만든 운영자는 `password_hash = NULL` 이라 **로그인 자체가 안 됐다**
 *   (`loginOperator` 가 해시 없으면 `invalid`). 그리고 **남의 비번을 정해 주는 길이 어디에도 없었다** —
 *   `setOperatorPassword` 를 부르는 곳은 «본인 비번 바꾸기» 한 곳뿐이었다(실측). ⇒ **상담원을 못 뽑았다.**
 *   여기는 «임시 비번을 쥐여 준다»다 — 위와 딱 하나가 다르다: **`must_change_password = true`.**
 *   그 표시가 있으면 첫 로그인에서 화면이 `/ops/password.html?first=1` 로 보내고(login.html:35),
 *   본인이 자기 비번을 정하면 그때 표시가 꺼진다. ⇒ **임시 비번은 우리 손에 남지 않는다.**
 *   잠김·실패 수도 함께 푼다(잠긴 사람을 풀어 주는 길이기도 하다).
 */
export async function setOperatorTempPassword(id: number, password: string): Promise<void> {
  const hash = await bcrypt.hash(password, BCRYPT_COST);
  await rows(sql`UPDATE operators SET password_hash = ${hash}, must_change_password = true, failed_logins = 0, locked_until = NULL WHERE id = ${id}`);
}

/** SSO 진입 — 이메일 기준 upsert. role 은 sso-role 판정 결과(상향만 자동). 비활성은 부활 금지. */
export async function upsertOperatorFromSso(input: { email: string; name?: string; sub: string; role: OpsRole }): Promise<OperatorRow | null> {
  const existing = await findOperatorByEmail(input.email);
  if (existing) {
    if (!existing.active) return null;
    await rows(sql`UPDATE operators SET role = ${input.role}, sso_sub = ${input.sub}, name = COALESCE(name, ${input.name || null}), last_login_at = NOW() WHERE id = ${existing.id}`);
    return { ...existing, role: input.role };
  }
  const r = await rows(sql`INSERT INTO operators (email, name, role, sso_sub, active, last_login_at) VALUES (${input.email}, ${input.name || null}, ${input.role}, ${input.sub}, true, NOW()) RETURNING *`);
  return (r[0] as unknown as OperatorRow) || null;
}

export type { UserClaims, OpsClaims };
