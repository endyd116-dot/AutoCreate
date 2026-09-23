/**
 * 소재 API(계약 P1R1 §2):
 *   GET  /api/topics-list?status=candidate|picked|used|expired|later|all → { topics:[Topic], refreshedAt?, refresh:{running,startedAt?,finishedAt?,added?,error?} }
 *   POST /api/topics-refresh {}  → **202** { ok:true, started:true } · 이미 도는 중이면 { ok:true, started:false, running:true }
 *        코인 0 · 하루 3회(step rate_limit · audit topics_refresh COUNT)
 *        🔴 v2.9(CLAUDE §4.5b): «동기 한도(≈26초) 넘을 것 같으면 재지 말고 처음부터 배경으로» — LLM 1콜 + 검색량 조회라 동기로는 못 끝낸다.
 *        진행·결과는 `topics-list` 의 `refresh` 로 본다(화면이 폴링).
 *   POST /api/topics-add { title, keyword?, channelHint?, angle? } → { ok, topic:Topic(source "manual") }   // [2026-09-15 · DESIGN §5.1] 소재를 «직접» 넣는 입구
 *        코인 0 · 하루 20회(429 step rate) · 🔴 requireWritable 을 부르지 않는다(소재 넣기는 생성이 아니다 · readonly 도 넣는다 · 막는 건 디렉터 확정)
 *        400 step: title(빈값·80자) | banned_category(R4 사전 · 문장 그대로) | duplicate(30일 안 같은 제목 → 기존 topic 동봉)
 *   POST /api/topics-pick { id } → { topic }          // candidate→picked
 *   POST /api/topics-skip { id } → { ok }             // →expired
 *   POST /api/topics-later { id } → { ok, topic }    // 🔴 [AC-251] candidate→later(«나중에») · 되돌리기 = 같은 문에 { id, undo:true }
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { listTopics, refreshCountToday, toTopic, addManualTopic, addCountToday } from "../../lib/topics";
import { readRefreshState } from "../../lib/topics-refresh-state";
import { startTopicsRefresh } from "./topics-refresh-background";
import { utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/topics-list", "/api/topics-refresh", "/api/topics-pick", "/api/topics-skip", "/api/topics-add", "/api/topics-later"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const REFRESH_PER_DAY = 3;
/** 직접 넣기 하루 상한 — 남용 방지(넣는 것 자체는 코인 0이지만 자동 편성 후보를 오염시킬 수 있다). */
const ADD_PER_DAY = 20;
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
      { const { requireAiBudget } = await import("../../lib/billing/ai-cost-cap"); const bgt = await requireAiBudget(tid); if (!bgt.ok) return json({ ok: false, step: "ai_cost_cap", error: bgt.error }, 400); }   // ★C(P1R4) fix: 소재 뽑기도 AI 생성 — 일 상한(§1.5)을 잰다
      const used = await refreshCountToday(tid);
      if (used >= REFRESH_PER_DAY) return json({ ok: false, step: "rate_limit", error: `소재 뽑기는 하루 ${REFRESH_PER_DAY}번까지예요. 내일 다시 뽑을 수 있어요.` }, 429);
      // 감사 행이 곧 횟수 — 시작 전에 먼저 적는다(실패해도 횟수는 쓴 것 · AI 비용이 나갔으므로)
      await writeAudit({ tenantId: tid, action: "topics_refresh", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { n: used + 1 } });
      const st = await startTopicsRefresh(tid, "user");
      if (!st.started && !st.running) return json({ ok: false, step: "start", error: st.error ?? "소재 뽑기를 시작하지 못했어요." }, 502);
      return json({ ok: true, started: st.started, running: true }, st.started ? 202 : 200);
    }

    if (path.endsWith("/topics-add")) {
      /* 🔴 AC-35: requireWritable 을 여기서 부르지 않는다 — 소재 넣기는 생성이 아니다(readonly·suspended 도 넣을 수 있다 · 막는 건 디렉터 확정에서). */
      const used = await addCountToday(tid);
      if (used >= ADD_PER_DAY) return json({ ok: false, step: "rate", error: `소재는 하루 ${ADD_PER_DAY}개까지 넣을 수 있어요. 내일 더 넣을 수 있어요.` }, 429);
      const ba = await readJson<{ title?: unknown; keyword?: unknown; channelHint?: unknown; angle?: unknown }>(req);
      const r = await addManualTopic(tid, { title: ba.title, keyword: ba.keyword, channelHint: ba.channelHint, angle: ba.angle });
      if (!r.ok) return json({ ok: false, step: r.step, error: r.error, ...(r.topic ? { topic: r.topic } : {}) }, 400);
      return json({ ok: true, topic: r.topic, volumeKnown: r.volumeKnown });
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
    /* ───────── 🔴 «나중에»(AC-251 · 2026-09-23) ─────────
       `public/app/create.html:136` 이 스스로 적어 뒀다: «서버에 «나중에»를 적어 둘 자리가 없다(pick·skip 뿐) —
       화면에서만 숨기면 새로고침하면 돌아와 «했는데 안 됐다»가 된다».
       🔴 **화면 탓이 아니라 서버 칸이 없던 것**이라 여기서 연다(설계 §13.0b 소재 카드의 세 번째 방향).

       ⚠️ `skip`(→expired)과 **뜻이 다르다**: 넘김은 «안 쓴다», 나중에는 «지금은 아니다».
          그래서 **만료 시각을 안 건드린다** — 되돌리면 원래 후보로 그대로 돌아온다.
       🔴 막지 않는다(§9) — 목록에서 사라지는 게 아니라 `?status=later` 로 **언제든 다시 본다.** */
    if (path.endsWith("/topics-later")) {
      const undo = (b as { undo?: unknown }).undo === true;
      const [row] = undo
        ? await q(sql`UPDATE topics SET status = 'candidate' WHERE tenant_id = ${tid} AND id = ${id} AND status = 'later' RETURNING *`)
        : await q(sql`UPDATE topics SET status = 'later' WHERE tenant_id = ${tid} AND id = ${id} AND status = 'candidate' RETURNING *`);
      if (!row) {
        const [cur] = await q(sql`SELECT * FROM topics WHERE tenant_id = ${tid} AND id = ${id}`);
        if (!cur) return json({ ok: false, error: "소재를 찾을 수 없어요.", step: "not_found" }, 404);
        return json({ ok: true, topic: toTopic(cur) });   // 이미 그 상태 — 멱등(두 번 눌러도 같은 답)
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
