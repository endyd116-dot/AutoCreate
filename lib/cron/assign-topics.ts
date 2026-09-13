/**
 * lib/cron/assign-topics.ts — 스텝 `slots.assign_topics`(계약 §1 · DESIGN §5B.2 D-7 · §5B.7).
 *   매시 · `topicLeadDays` 안에 든 `planned` 슬롯마다 편성자가 소재 1개를 배정한다: planned → topic_assigned.
 *
 *   ══ 고르는 규칙(결정론) ══
 *     후보 = `topics.status='candidate'` ∧ 만료 전 ∧ **30일 안에 같은 norm_key 를 쓴 적 없음**(중복 발행 방지 · lib/topics normKey 규약 그대로).
 *     우선순위 = ① 그 슬롯 채널과 `channel_hint` 가 맞는 것 ② score 높은 순 ③ id 큰 순(최신).
 *     채널이 안 맞아도 «없는 것보다 낫다» — 힌트는 힌트다(디렉터가 produce 에서 그 채널에 맞게 앵글을 가른다).
 *
 *   ══ 후보가 없을 때 ══
 *     ① 이 틱에서 **한 번** `refreshTopics(tid)` 를 자동 실행한다. 사람이 누르는 «소재 뽑기»의 하루 3회 상한과는 **다른 계정**이다
 *        — 그래서 감사 action 을 `topics_refresh_cron` 으로 가른다(사람 상한을 세는 `refreshCountToday` 는 `topics_refresh` 만 센다).
 *     ② LLM 호출은 길다. 우산 예산이 12초 미만이면 **부르지 않고** 다음 주기로 미룬다. 불렀는데 예산이 끝나면 흘려보낸다
 *        (그 호출이 끝나면 topics 는 들어간다 — 다음 틱이 줍는다). 크론이 26초 벽에 부딪혀 틱 전체가 죽는 일이 없어야 한다.
 *     ③ 그래도 없으면 슬롯 `no_topic` + 알림 1회(«소재가 떨어졌어요»). 조용한 0건 금지 — 다음 주기에 다시 시도한다.
 *
 *   ⚠️ 경합: 같은 소재를 두 슬롯이 가져가지 못하게 **CAS**(`UPDATE topics SET status='picked' WHERE status='candidate' RETURNING id`)로 집는다.
 *      0행이면 남이 먼저 가져간 것 — 조용히 다음 후보로 간다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { refreshTopics } from "../topics";
import { kstToday, notifyOnce, setSlot, withTimeout, type CronStep, type StepOutcome } from "./base";

const n = (v: unknown) => Number(v || 0);

interface Cand { id: number; normKey: string; hint: string; score: number; title: string }

/** 후보 소재 — 30일 중복 회피 포함. 한 번 읽어 메모리에서 소모한다(슬롯마다 다시 뒤지면 같은 자리를 두 번 집는다 · AM SlotPool 교훈). */
async function loadCandidates(tid: number, limit: number): Promise<Cand[]> {
  const rows = await q(sql`SELECT t.id, t.norm_key, t.channel_hint, t.score, t.title FROM topics t
    WHERE t.tenant_id = ${tid} AND t.status = 'candidate' AND (t.expires_at IS NULL OR t.expires_at > NOW())
      AND NOT EXISTS (SELECT 1 FROM topics u WHERE u.tenant_id = t.tenant_id AND u.norm_key = t.norm_key
                        AND u.status IN ('used','picked') AND COALESCE(u.used_at, u.created_at) > NOW() - interval '30 days')
    ORDER BY t.score DESC, t.id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`);
  return rows.map((r) => ({ id: n(r.id), normKey: String(r.norm_key ?? ""), hint: String(r.channel_hint ?? ""), score: Number(r.score ?? 0), title: String(r.title ?? "") }));
}

/** 이 슬롯에 가장 맞는 후보(없으면 null). 채널 힌트 일치 > 점수(> 최신 — pool 이 이미 score DESC, id DESC 라 동점은 앞이 최신). */
function pickFor(pool: Cand[], channel: string, taken: Set<string>): Cand | null {
  let best: Cand | null = null, bestKey = -1;
  for (const c of pool) {
    if (taken.has(c.normKey)) continue;
    const key = (c.hint === channel ? 1_000_000 : 0) + c.score;
    if (key > bestKey) { bestKey = key; best = c; }
  }
  return best;
}

export const assignTopicsStep: CronStep = {
  key: "slots.assign_topics",
  every: "hourly",
  needsAutoSchedule: true,
  async run(ctx): Promise<StepOutcome> {
    const lead = ctx.settings.topicLeadDays;
    // 창 = 오늘(KST) ~ 오늘+topicLeadDays. 경계는 SQL 안에서 만든다(PITFALLS #4).
    const slots = await q(sql`SELECT id, channel, slot_date::text AS d FROM slots
      WHERE tenant_id = ${ctx.tid} AND status = 'planned' AND topic_id IS NULL AND piece_id IS NULL
        AND slot_date >= ${kstToday()} AND slot_date <= ${kstToday()} + ${lead}::int
      ORDER BY slot_date, publish_at NULLS LAST, id`);
    if (!slots.length) return { changed: 0, skipped: 0 };

    let pool = await loadCandidates(ctx.tid, slots.length * 3 + 20);
    let refreshed: { added: number; skipped: number } | null = null;
    let refreshTried = false;
    let assigned = 0, noTopic = 0, deferred = 0;
    const takenNormKeys = new Set<string>();

    for (const s of slots) {
      if (Date.now() >= ctx.deadline) { deferred++; continue; }
      const slotId = n(s.id), channel = String(s.channel);

      // 후보가 비었으면 이 틱에서 한 번만 리필한다(예산이 있을 때만 — LLM 은 길다).
      if (!pool.length && !refreshTried) {
        refreshTried = true;
        const budget = ctx.deadline - Date.now();
        if (budget < 12_000) {
          deferred++;
          console.log(`[cron/assign_topics] tid=${ctx.tid} 후보 0 · 예산 ${Math.round(budget / 1000)}s — 리필은 다음 주기로`);
          continue;
        }
        const r = await withTimeout(refreshTopics(ctx.tid), budget - 3_000);
        refreshed = r ? { added: r.added, skipped: r.skipped } : { added: 0, skipped: 0 };
        await writeAudit({ tenantId: ctx.tid, action: "topics_refresh_cron", actorType: "system", target: `tenant:${ctx.tid}`,
          detail: { origin: "cron", step: "slots.assign_topics", added: refreshed.added, skipped: refreshed.skipped, timedOut: r === null } });
        pool = await loadCandidates(ctx.tid, slots.length * 3 + 20);
      }

      const cand = pickFor(pool, channel, takenNormKeys);
      if (!cand) {
        // 소재가 정말 없다 — 슬롯에 사유를 남기고 알림 1회. 조용한 0건 금지(다음 주기 재시도).
        if (await setSlot(ctx.tid, slotId, "no_topic", "쓸 소재가 없어요")) noTopic++;
        await notifyOnce(ctx.tid, "slot_no_topic", "소재가 떨어졌어요",
          "편성표에 자리는 있는데 쓸 소재가 없어요. «만들기»에서 소재를 새로 뽑아 주세요.", "/app/topics.html");
        continue;
      }

      // CAS — 남이 먼저 가져갔으면 0행. pool 에서 빼고 다음 슬롯으로(이 슬롯은 다음 주기가 다시 본다).
      const got = await q(sql`UPDATE topics SET status = 'picked', used_at = NULL WHERE tenant_id = ${ctx.tid} AND id = ${cand.id} AND status = 'candidate' RETURNING id`);
      pool = pool.filter((c) => c.id !== cand.id);
      if (!got.length) { continue; }
      takenNormKeys.add(cand.normKey);

      const upd = await q(sql`UPDATE slots SET topic_id = ${cand.id}, status = 'topic_assigned', note = NULL, updated_at = NOW()
        WHERE tenant_id = ${ctx.tid} AND id = ${slotId} AND status = 'planned' AND topic_id IS NULL RETURNING id`);
      if (!upd.length) {
        // 슬롯이 그새 바뀌었다(건너뛰기 등) — 소재를 도로 후보로 돌려준다(소재가 증발하지 않게).
        await q(sql`UPDATE topics SET status = 'candidate' WHERE tenant_id = ${ctx.tid} AND id = ${cand.id} AND status = 'picked'`);
        takenNormKeys.delete(cand.normKey);
        continue;
      }
      assigned++;
    }

    if (assigned > 0) {
      await notifyOnce(ctx.tid, "topics_assigned", `다음 ${lead}일치 소재 ${assigned}개를 정했어요`,
        "편성표에서 무엇이 언제 나가는지 볼 수 있어요. 바꾸고 싶으면 슬롯을 눌러 주세요.", "/app/schedule.html", { byKind: true });
    }
    const out: StepOutcome = { changed: assigned, skipped: noTopic + deferred };
    const detail: Record<string, unknown> = {};
    if (noTopic) detail.noTopic = noTopic;
    if (deferred) detail.deferred = deferred;
    if (refreshed) detail.refreshed = refreshed;
    if (Object.keys(detail).length) out.detail = detail;
    return out;
  },
};
