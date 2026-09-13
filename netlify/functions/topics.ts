/**
 * 소재 API(계약 P1R1 §2):
 *   GET  /api/topics-list?status=candidate|picked|used|expired|all → { topics:[Topic], refreshedAt? }
 *   POST /api/topics-refresh {}  → { added, topics }   // 코인 0 · 하루 3회(step rate_limit · audit topics_refresh COUNT)
 *   POST /api/topics-pick { id } → { topic }          // candidate→picked
 *   POST /api/topics-skip { id } → { ok }             // →expired
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { listTopics, refreshTopics, refreshCountToday, toTopic } from "../../lib/topics";
import { utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/topics-list", "/api/topics-refresh", "/api/topics-pick", "/api/topics-skip"] };
const REFRESH_PER_DAY = 3;
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url); const path = url.pathname;
  try {
    if (path.endsWith("/topics-list")) {
      const status = url.searchParams.get("status") || "candidate";
      const topics = await listTopics(tid, status);
      const [last] = await q(sql`SELECT created_at FROM audit_logs WHERE tenant_id = ${tid} AND action = 'topics_refresh' ORDER BY id DESC LIMIT 1`);
      const body: Record<string, unknown> = { ok: true, topics };
      const at = utcDate(last?.created_at); if (at) body.refreshedAt = at.toISOString();
      return json(body);
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    if (path.endsWith("/topics-refresh")) {
      const used = await refreshCountToday(tid);
      if (used >= REFRESH_PER_DAY) return json({ ok: false, step: "rate_limit", error: `소재 뽑기는 하루 ${REFRESH_PER_DAY}번까지예요. 내일 다시 뽑을 수 있어요.` }, 429);
      // 감사 행이 곧 횟수 — 생성 전에 먼저 적는다(실패해도 횟수는 쓴 것 · AI 비용이 나갔으므로)
      await writeAudit({ tenantId: tid, action: "topics_refresh", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { n: used + 1 } });
      let r: Awaited<ReturnType<typeof refreshTopics>>;
      try { r = await refreshTopics(tid); }
      catch (e) { if ((e as { step?: string })?.step === "ai") return json({ ok: false, step: "ai", error: "소재를 뽑지 못했어요. 잠시 후 다시 해 주세요." }, 502); throw e; }
      const topics = await listTopics(tid, "candidate");
      return json({ ok: true, added: r.added, topics, volumesKnown: r.volumesKnown, growthKnown: r.growthKnown });
    }

    const b = await readJson<{ id?: number }>(req);
    const id = n(b.id); if (!id) return badRequest("id");
    if (path.endsWith("/topics-pick")) {
      const [row] = await q(sql`UPDATE topics SET status = 'picked' WHERE tenant_id = ${tid} AND id = ${id} AND status = 'candidate' RETURNING *`);
      if (!row) {
        const [cur] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND id = ${id}`);
        if (!cur) return json({ ok: false, error: "소재를 찾을 수 없어요.", step: "not_found" }, 404);
        return json({ ok: true, topic: toTopic(cur) });   // 이미 picked/used — 멱등
      }
      return json({ ok: true, topic: toTopic(row) });
    }
    if (path.endsWith("/topics-skip")) {
      const r = await q(sql`UPDATE topics SET status = 'expired', expires_at = NOW() WHERE tenant_id = ${tid} AND id = ${id} AND status IN ('candidate','picked') RETURNING id`);
      if (!r.length) { const [cur] = await q(sql`SELECT id FROM topics WHERE tenant_id = ${tid} AND id = ${id}`); if (!cur) return json({ ok: false, error: "소재를 찾을 수 없어요.", step: "not_found" }, 404); }
      return json({ ok: true });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("topics", err); }
};
