/**
 * ops-center.ts — R1 운영센터 묶음을 P1R4 에서 **메뉴별 파일로 쪼갰다**(계약 §4 «B 가 쪼개고 옛 경로는 그대로 살린다»).
 *   /api/ops-dashboard                                  → ops-dashboard.ts(교체)
 *   /api/ops-tenants · ops-tenant · ops-tenant-update · ops-coins-grant · ops-impersonate(-end) → ops-tenants.ts
 *   /api/ops-audit                                      → 여기 남긴다(A `public/ops/audit.html` R1 호환 · 응답 { ok, rows }). B2 의 확장판은 **다른 경로** `/api/ops-audit-search`(ops-operators.ts · q·tenant·actor·from·to)라 충돌 없음 — 이 파일은 그대로 둔다(B2 확인 2026-09-14).
 */
import { json, jsonError } from "../../lib/response";
import { requireAdmin } from "../../lib/guards";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/ops-audit"] };
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const o = await requireAdmin(req); if (!o.ok) return o.res;
  try {
    const tid = n(url.searchParams.get("tenantId"));
    const limit = Math.min(200, n(url.searchParams.get("limit")) || 50);
    const rows = await q(sql`SELECT id, tenant_id, actor_type, actor_id, action, target, risk_level, ip, created_at FROM audit_logs
      WHERE (${tid} = 0 OR tenant_id = ${tid}) ORDER BY id DESC LIMIT ${limit}`);
    return json({ ok: true, rows });
  } catch (err) { return jsonError("ops_center", err); }
};
