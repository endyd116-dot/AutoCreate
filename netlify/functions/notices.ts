/**
 * 고객 공지·장애 배너(계약 P1R4 §2.4(8) · DESIGN §11.4).
 *   GET /api/notices  → { ok, notices:[Notice] }   // 지금 유효(active·기간 안)·내 플랜 대상 것만. 홈이 incident 를 상단 1줄 배너로.
 *   🔴 requireUser 스코프 — 내 플랜에 해당하는 공지만 본다(전체 대상 [] 는 모두에게).
 */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";
import { toNotice } from "./ops-notices";

export const config = { path: ["/api/notices"] };

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  try {
    const [t] = await q(sql`SELECT plan_key FROM tenants WHERE id = ${auth.tid} LIMIT 1`);
    const planKey = String(t?.plan_key ?? "");
    // 유효 = active · 시작함 · 안 끝남. 대상 = plans 비었거나(전체) 내 플랜 포함.
    const rows = await q(sql`SELECT * FROM notices
      WHERE active = true AND starts_at <= NOW() AND (ends_at IS NULL OR ends_at > NOW())
        AND (jsonb_array_length(COALESCE(plans, '[]'::jsonb)) = 0 OR plans ? ${planKey})
      ORDER BY (kind = 'incident') DESC, id DESC LIMIT 20`);
    return json({ ok: true, notices: rows.map(toNotice) });
  } catch (err) {
    return jsonError("notices", err);
  }
};
