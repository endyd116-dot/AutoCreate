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

/* ═══════════ P1R4 — 쓰기 게이트 · 역할 게이트 (계약 §0.2 · §1.3 · §5) ═══════════ */
import { sql } from "drizzle-orm";
import { db } from "../db/index";
import { writeAudit } from "./audit";

export type WritableReason = "readonly" | "suspended" | "unknown";
export type WritableOk = { ok: true; status: string; res: null };
export type WritableFail = { ok: false; reason: WritableReason; status: string; res: Response };
/** 쓰기(생성·발행·충전 소비)를 막는 테넌트 상태. 열람은 전부 된다(§12.3 «읽기 전용»). */
export const NON_WRITABLE: ReadonlySet<string> = new Set(["readonly", "suspended", "cancelled"]);

/**
 * requireWritable(tid) — 🔴 **한 곳**(계약 §0.1). produce·publisher·director-confirm·slots-produce-now·pieces-regenerate 가 부른다.
 *   통과 = `tenants.status ∈ {trial, active}` · 막힘 = 403 `{ ok:false, step:"writable", reason:"readonly"|"suspended", error }` —
 *   화면은 reason 으로 «요금제를 고르면 바로 이어서 돼요»(readonly) / «결제가 밀려 있어요»(suspended) 시트를 띄운다.
 *   조회 실패는 **막는다**(unknown · 돈이 걸린 경로는 안전측 · AM plan-gate 규율). B2 는 잡 적재 직전에 이 함수를 부른다.
 */
export async function requireWritable(tid: number): Promise<WritableOk | WritableFail> {
  try {
    const rows = (await db.execute(sql`SELECT status FROM tenants WHERE id = ${Math.floor(Number(tid) || 0)}`)) as unknown as { status: string }[];
    const status = String(rows[0]?.status ?? "");
    if (!status) return { ok: false, reason: "unknown", status, res: json({ ok: false, step: "writable", reason: "unknown", error: "계정 상태를 확인하지 못했어요." }, 403) };
    if (!NON_WRITABLE.has(status)) return { ok: true, status, res: null };
    const reason: WritableReason = status === "suspended" ? "suspended" : "readonly";
    const error = reason === "suspended" ? "결제가 밀려 있어서 잠시 멈췄어요. 결제 수단을 확인해 주세요." : "체험이 끝났어요. 요금제를 고르면 바로 이어서 할 수 있어요.";
    return { ok: false, reason, status, res: json({ ok: false, step: "writable", reason, error }, 403) };
  } catch (e) {
    console.error("[guards] requireWritable 조회 실패", String((e as Error)?.message ?? e).slice(0, 120));
    return { ok: false, reason: "unknown", status: "", res: json({ ok: false, step: "writable", reason: "unknown", error: "계정 상태를 확인하지 못했어요. 잠시 뒤 다시 해 주세요." }, 403) };
  }
}

/**
 * requireAdmin(req, allowed) — 운영 API 역할 게이트(계약 §0.2). `allowed` 에 든 역할만 통과 · 아니면 403 + audit `ops_forbidden`.
 *   super_admin 은 항상 통과(전부). 예: requireAdmin(req, ["admin"]) = admin·super_admin.
 *   ⚠️ 기존 `requireOps(req, minRole)`(최소 역할 서열)은 그대로 둔다 — 새 메뉴는 이 함수로, 옛 경로는 옛 함수로(무회귀).
 */
export async function requireAdmin(req: Request, allowed: OpsRole[] = ["operator", "admin", "super_admin"]): Promise<OpsOk | Fail> {
  const o = verifyOps(req);
  if (!o) return fail(json({ ok: false, error: "운영자 로그인이 필요해요.", step: "auth" }, 401));
  if (o.role === "super_admin" || allowed.includes(o.role)) return { ok: true, ops: o, res: null };
  // 🔴 감사는 **await**(2026-09-15 · C 라이브 실측으로 간헐 유실 확인). 서버리스는 응답을 돌려주면 인보케이션을 끝낸다 —
  //    `void writeAudit(...)` 는 INSERT 가 경합에서 지면 조용히 사라진다. «될 때도 있고 안 될 때도 있는 권한 거부 기록»은
  //    없는 것보다 나쁘다(보안 감사). 403 은 이미 사람이 막힌 경로라 한 왕복(수십 ms) 늦는 편이 낫다.
  await writeAudit({ tenantId: null, action: "ops_forbidden", actorType: "operator", actorId: o.oid, riskLevel: "medium",
    target: new URL(req.url).pathname, detail: { role: o.role, allowed } });
  return fail(json({ ok: false, error: "이 메뉴는 권한이 없어요.", step: "role", role: o.role }, 403));
}
