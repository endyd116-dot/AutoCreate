/**
 * ops-center.ts — R1 운영센터 묶음을 P1R4 에서 **메뉴별 파일로 쪼갰다**(계약 §4 «B 가 쪼개고 옛 경로는 그대로 살린다»).
 *   /api/ops-dashboard                                  → ops-dashboard.ts(교체)
 *   /api/ops-tenants · ops-tenant · ops-tenant-update · ops-coins-grant · ops-impersonate(-end) → ops-tenants.ts
 *   /api/ops-audit                                      → 여기 남긴다(B2 `ops-operators.ts` 가 R1 확장판(q·tenant·actor·from·to)을 만들면 **이 파일은 지운다** — 같은 경로를 두 함수가 잡으면 안 된다).
 */
import { json, jsonError } from "../../lib/response";
import { requireAdmin } from "../../lib/guards";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/ops-audit"] };
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const o = requireAdmin(req); if (!o.ok) return o.res;
  try {
    const tid = n(url.searchParams.get("tenantId"));
    const limit = Math.min(200, n(url.searchParams.get("limit")) || 50);
    const rows = await q(sql`SELECT id, tenant_id, actor_type, actor_id, action, target, risk_level, ip, created_at FROM audit_logs
      WHERE (${tid} = 0 OR tenant_id = ${tid}) ORDER BY id DESC LIMIT ${limit}`);
    return json({ ok: true, rows });
  } catch (err) { return jsonError("ops_center", err); }
};
