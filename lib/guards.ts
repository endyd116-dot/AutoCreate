/**
 * lib/guards.ts — 요청 가드. AM 원본: ../AutoMarketing/lib/admin-guard.ts (복사 2026-09-14 · 고객/운영자 분리로 개작)
 *   사용: const auth = requireUser(req); if (!auth.ok) return auth.res;   // 고객 — 항상 자기 테넌트(tid)로 스코프
 *         const ops  = requireOps(req, "admin"); if (!ops.ok) return ops.res; // 운영자 — 최소 역할
 *   AM의 tenantAllowed 관례: 고객 핸들러는 auth.tid 만 쓴다(교차 테넌트 IDOR 구조적 봉쇄 — 요청 body의 tenantId를 믿지 않는다).
 */
import { verifyUser, verifyOps, type UserClaims, type OpsClaims, type OpsRole } from "./auth";
import { json } from "./response";

type UserOk = { ok: true; user: UserClaims & { imp?: OpsClaims["imp"] }; tid: number; res: null };
type Fail = { ok: false; user: null; ops: null; tid: null; res: Response };
type OpsOk = { ok: true; ops: OpsClaims; res: null };

export function requireUser(req: Request): UserOk | Fail {
  const u = verifyUser(req);
  if (!u) return fail(json({ ok: false, error: "로그인이 필요해요.", step: "auth" }, 401));
  return { ok: true, user: u, tid: Number(u.tid), res: null };
}

const RANK: Record<OpsRole, number> = { operator: 1, admin: 2, super_admin: 3 };
export function requireOps(req: Request, minRole: OpsRole = "operator"): OpsOk | Fail {
  const o = verifyOps(req);
  if (!o) return fail(json({ ok: false, error: "운영자 로그인이 필요해요.", step: "auth" }, 401));
  if ((RANK[o.role] ?? 0) < RANK[minRole]) return fail(json({ ok: false, error: "권한이 없어요.", step: "role" }, 403));
  return { ok: true, ops: o, res: null };
}

/** 원격접속 세션(imp)이면 돈이 걸린 동작을 막는다(AM 관례 — 결제·충전은 고객 본인만). */
export function denyIfImpersonating(user: UserOk["user"]): Response | null {
  if (user.imp) return json({ ok: false, error: "원격접속 중에는 결제·충전을 할 수 없어요.", step: "impersonation" }, 403);
  return null;
}

function fail(res: Response): Fail { return { ok: false, user: null, ops: null, tid: null, res }; }
