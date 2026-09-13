/**
 * 소재 API(계약 P1R1 §2):
 *   GET  /api/topics-list?status=candidate|picked|used|expired|all → { topics:[Topic], refreshedAt?, refresh:{running,startedAt?,finishedAt?,added?,error?} }
 *   POST /api/topics-refresh {}  → **202** { ok:true, started:true } · 이미 도는 중이면 { ok:true, started:false, running:true }
 *        코인 0 · 하루 3회(step rate_limit · audit topics_refresh COUNT)
 *        🔴 v2.9(CLAUDE §4.5b): «동기 한도(≈26초) 넘을 것 같으면 재지 말고 처음부터 배경으로» — LLM 1콜 + 검색량 조회라 동기로는 못 끝낸다.
 *        진행·결과는 `topics-list` 의 `refresh` 로 본다(화면이 폴링).
 *   POST /api/topics-pick { id } → { topic }          // candidate→picked
 *   POST /api/topics-skip { id } → { ok }             // →expired
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { listTopics, refreshCountToday, toTopic } from "../../lib/topics";
import { readRefreshState } from "../../lib/topics-refresh-state";
import { startTopicsRefresh } from "./topics-refresh-background";
import { utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/topics-list", "/api/topics-refresh", "/api/topics-pick", "/api/topics-skip"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const REFRESH_PER_DAY = 3;
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/topics-list")) {
      const status = url.searchParams.get("status") || "candidate";
      const [topics, refresh] = await Promise.all([listTopics(tid, status), readRefreshState(tid)]);
      const [last] = await q(sql`SELECT created_at FROM audit_logs WHERE tenant_id = ${tid} AND action = 'topics_refresh' ORDER BY id DESC LIMIT 1`);
      // refresh 는 항상 싣는다(화면이 폴링한다 · 없으면 화면은 running=false 로 보지만 «added» 를 못 받아 완료 문구가 틀린다).
      const body: Record<string, unknown> = { ok: true, topics, refresh };
      const at = utcDate(last?.created_at); if (at) body.refreshedAt = at.toISOString();
      return json(body);
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    if (path.endsWith("/topics-refresh")) {
      // 이미 도는 중이면 횟수를 쓰지 않는다(중복 요청이 상한을 갉아먹지 않게) — 응답 모양은 계약 v2.9 글자 그대로.
      const cur = await readRefreshState(tid);
      if (cur.running) return json({ ok: true, started: false, running: true });
      const used = await refreshCountToday(tid);
      if (used >= REFRESH_PER_DAY) return json({ ok: false, step: "rate_limit", error: `소재 뽑기는 하루 ${REFRESH_PER_DAY}번까지예요. 내일 다시 뽑을 수 있어요.` }, 429);
      // 감사 행이 곧 횟수 — 시작 전에 먼저 적는다(실패해도 횟수는 쓴 것 · AI 비용이 나갔으므로)
      await writeAudit({ tenantId: tid, action: "topics_refresh", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { n: used + 1 } });
      const st = await startTopicsRefresh(tid, "user");
      if (!st.started && !st.running) return json({ ok: false, step: "start", error: st.error ?? "소재 뽑기를 시작하지 못했어요." }, 502);
      return json({ ok: true, started: st.started, running: true }, st.started ? 202 : 200);
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
