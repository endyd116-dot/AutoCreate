/**
 * lib/cron/assign-topics.ts — 스텝 `slots.assign_topics`(계약 §1 · DESIGN §5B.2 D-7 · §5B.7).
 *   매시 · `topicLeadDays` 안에 든 `planned` 슬롯마다 편성자가 소재 1개를 배정한다: planned → topic_assigned.
 *
 *   ══ 고르는 규칙(결정론) ══
 *     후보 = `topics.status='candidate'` ∧ 만료 전 ∧ **90일 안에 같은 norm_key 를 쓴 적 없음**(DESIGN §19 정본 · 중복 발행 방지 · lib/topics normKey 규약 그대로).
 *     우선순위 = ① 그 슬롯 채널과 `channel_hint` 가 맞는 것 ② score 높은 순 ③ id 큰 순(최신).
 *     채널이 안 맞아도 «없는 것보다 낫다» — 힌트는 힌트다(디렉터가 produce 에서 그 채널에 맞게 앵글을 가른다).
 *
 *   ══ 후보가 없을 때 ══
 *     ① 이 틱에서 **한 번** 소재 리필을 시작한다 — 🔴 **배경 함수로**(계약 v2.9 · CLAUDE §4.5b «넘을 것 같으면 처음부터 배경으로»).
 *        사람 경로(`/api/topics-refresh`)와 **같은 배경 함수·같은 상태 칸**을 쓴다 — 중복 실행 0(이미 도는 중이면 그쪽이 즉시 끝낸다).
 *        사람의 하루 3회 상한과는 **다른 계정**이다: 감사 action 이 `topics_refresh_cron`(상한을 세는 `refreshCountToday` 는 `topics_refresh` 만 센다).
 *     ② 배경이라 이 스텝은 **기다리지 않는다** — 리필은 다음 틱이 줍는다. 크론이 26초 벽에 부딪히는 경로 0.
 *     ③ 이번 틱에 쓸 소재가 없으면 슬롯 `no_topic` + 알림 1회(«소재가 떨어졌어요»). 조용한 0건 금지 — 다음 주기에 다시 시도한다.
 *
 *   ⚠️ 경합: 같은 소재를 두 슬롯이 가져가지 못하게 **CAS**(`UPDATE topics SET status='picked' WHERE status='candidate' RETURNING id`)로 집는다.
 *      0행이면 남이 먼저 가져간 것 — 조용히 다음 후보로 간다.
 *   🔎 출처: AC 신규(계약 P1R2-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { startTopicsRefresh } from "../../netlify/functions/topics-refresh-background";
import { kstToday, notifyOnce, setSlot, type CronStep, type StepOutcome } from "./base";
import { maxSimilarity, CROSS_ACCOUNT_SIMILARITY, CROSS_ACCOUNT_DAYS } from "../similarity";
import { htmlToPlain } from "../blocks";

const n = (v: unknown) => Number(v || 0);

interface Cand { id: number; normKey: string; hint: string; score: number; title: string; angle: string; manual: boolean }
/** 최근 글(계정 간 유사도 게이트 재료) — 제목 + 도입부(첫 300자). */
interface RecentPiece { accountId: number | null; text: string }

/** 후보 소재 — 90일 중복 회피 포함(DESIGN §19). 한 번 읽어 메모리에서 소모한다(슬롯마다 다시 뒤지면 같은 자리를 두 번 집는다 · AM SlotPool 교훈). */
async function loadCandidates(tid: number, limit: number): Promise<Cand[]> {
  const rows = await q(sql`SELECT t.id, t.norm_key, t.channel_hint, t.score, t.title, t.angle, t.source FROM topics t
    WHERE t.tenant_id = ${tid} AND t.status = 'candidate' AND (t.expires_at IS NULL OR t.expires_at > NOW())
      AND NOT EXISTS (SELECT 1 FROM topics u WHERE u.tenant_id = t.tenant_id AND u.norm_key = t.norm_key
                        AND u.status IN ('used','picked') AND COALESCE(u.used_at, u.created_at) > NOW() - interval '90 days')   /* [R7 메인 §7] 소재 재사용 금지 창 = **90일**(DESIGN §19 가 정본 · 종전 30일은 코드가 설계보다 짧았다) */
    ORDER BY (t.source = 'manual') DESC, t.score DESC, t.id DESC LIMIT ${Math.max(1, Math.min(200, limit))}`);   // [topics-add] 사용자가 직접 넣은 소재가 우선(점수는 그대로)
  return rows.map((r) => ({ id: n(r.id), normKey: String(r.norm_key ?? ""), hint: String(r.channel_hint ?? ""), score: Number(r.score ?? 0), title: String(r.title ?? ""), angle: String(r.angle ?? ""), manual: String(r.source ?? "") === "manual" }));
}

/**
 * 계정 간 유사도 게이트 재료(P1R3 §1.7 · DESIGN §7.3): 이 테넌트가 최근 CROSS_ACCOUNT_DAYS 일에 만든 글의 제목+도입부.
 *   같은 테넌트의 **다른 계정** 글과 닮은 소재를 같은 시기에 또 내면 플랫폼이 «한 사람이 여러 계정»으로 본다 — 편성 단계에서 소재를 바꾼다.
 *   R1 의 유사도 함수(lib/similarity.maxSimilarity)를 **그대로** 쓴다(판정기 두 벌 금지) · 임계·기간은 그 파일 상수 한 곳.
 */
async function recentPieces(tid: number): Promise<RecentPiece[]> {
  const rows = await q(sql`SELECT account_id, title, body FROM pieces WHERE tenant_id = ${tid} AND status NOT IN ('rejected','failed')
    AND created_at > NOW() - (${CROSS_ACCOUNT_DAYS} || ' days')::interval AND title IS NOT NULL ORDER BY id DESC LIMIT 300`);
  return rows.map((r) => ({ accountId: r.account_id ? n(r.account_id) : null, text: `${String(r.title ?? "")} ${htmlToPlain(String(r.body ?? "")).slice(0, 300)}` }));
}
/** 이 소재가 «다른 계정»의 최근 글과 닮았나. slotAccountId 가 없으면(자동 로테이션) 모든 최근 글과 비교한다(어느 계정이 될지 모른다). */
function tooSimilarToOtherAccount(cand: Cand, recent: RecentPiece[], slotAccountId: number | null): { similar: boolean; score: number } {
  const others = recent.filter((p) => slotAccountId === null || p.accountId === null || p.accountId !== slotAccountId).map((p) => p.text);
  if (!others.length) return { similar: false, score: 0 };
  const m = maxSimilarity(`${cand.title} ${cand.angle}`, others);
  return { similar: m.score >= CROSS_ACCOUNT_SIMILARITY, score: m.score };
}

/** 이 슬롯에 가장 맞는 후보(없으면 null). 채널 힌트 일치 > 점수(> 최신 — pool 이 이미 score DESC, id DESC 라 동점은 앞이 최신). */
function pickFor(pool: Cand[], channel: string, taken: Set<string>, reject?: (c: Cand) => boolean): Cand | null {
  let best: Cand | null = null, bestKey = -1;
  for (const c of pool) {
    if (taken.has(c.normKey)) continue;
    if (reject && reject(c)) continue;
    /* 🔴 [2026-09-15 C · R6.5] 채널 힌트 일치 > **내가 넣은 소재** > 점수. 종전엔 힌트 + 점수만 봐서 `loadCandidates` 의
       «manual 먼저» 정렬이 여기서 점수 max 로 다시 고르는 순간 **사라졌다**(실측: 점수 95 AI 후보가 점수 12 «내 소재»보다 먼저 배정 · 슬롯 278:475 · 279:476).
       사용자가 직접 넣은 소재는 힌트가 맞으면 점수와 무관하게 먼저 집는다(점수 자체는 부풀리지 않는다). */
    const key = (c.hint === channel ? 2_000_000 : 0) + (c.manual ? 1_000_000 : 0) + c.score;
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
    const slots = await q(sql`SELECT id, channel, account_id, slot_date::text AS d FROM slots
      WHERE tenant_id = ${ctx.tid} AND status IN ('planned','no_topic') AND topic_id IS NULL AND piece_id IS NULL   -- ★C6 fix: no_topic 도 다시 본다(리필 뒤 영영 비어 있던 자리)
        AND slot_date >= ${kstToday()} AND slot_date <= ${kstToday()} + ${lead}::int
      ORDER BY slot_date, publish_at NULLS LAST, id`);
    if (!slots.length) return { changed: 0, skipped: 0 };

    const pool = await loadCandidates(ctx.tid, slots.length * 3 + 20);
    let refill: Record<string, unknown> | null = null;
    let refreshTried = false;
    let assigned = 0, noTopic = 0, deferred = 0;
    const takenNormKeys = new Set<string>();
    const recent = await recentPieces(ctx.tid);
    let similarSkipped = 0;

    for (const s of slots) {
      if (Date.now() >= ctx.deadline) { deferred++; continue; }
      const slotId = n(s.id), channel = String(s.channel), slotAccountId = s.account_id ? n(s.account_id) : null;

      /* 후보가 비었으면 이 틱에서 **한 번만** 리필을 시작한다 — 배경 함수라 기다리지 않는다(v2.9).
         이번 틱의 남은 자리는 소재를 못 받지만, 리필이 끝나면 다음 틱이 줍는다. 그래서 아래에서 `no_topic` 으로 표시하고 알린다. */
      if (!pool.length && !refreshTried) {
        refreshTried = true;
        const st = await startTopicsRefresh(ctx.tid, "cron");
        refill = { started: st.started, running: st.running, ...(st.error ? { error: st.error } : {}) };
        await writeAudit({ tenantId: ctx.tid, action: "topics_refill_started", actorType: "system", target: `tenant:${ctx.tid}`,
          detail: { origin: "cron", step: "slots.assign_topics", ...refill } });
        console.log(`[cron/assign_topics] tid=${ctx.tid} 후보 0 → 배경 리필 ${st.started ? "시작" : st.running ? "이미 실행 중" : "실패"}`);
      }

      // 계정 간 유사도 게이트(§1.7) — 닮은 소재는 이 자리에서 건너뛰고 다음 후보로(= 소재 교체).
      const cand = pickFor(pool, channel, takenNormKeys, (c) => { const r = tooSimilarToOtherAccount(c, recent, slotAccountId); if (r.similar) similarSkipped++; return r.similar; });
      if (!cand) {
        // 소재가 정말 없다 — 슬롯에 사유를 남기고 알림 1회. 조용한 0건 금지(다음 주기 재시도).
        // ★C6 라이브 실측(2026-09-14): 종전엔 no_topic 이 된 자리를 다음 주기가 다시 안 봤다(SELECT 가 planned 만) — 리필로 소재가 생겨도 영영 빈 자리였다.
        if (await setSlot(ctx.tid, slotId, "no_topic", "쓸 소재가 없어요")) noTopic++;
        await notifyOnce(ctx.tid, "slot_no_topic", "소재가 떨어졌어요",
          "편성표에 자리는 있는데 쓸 소재가 없어요. «만들기»에서 소재를 새로 뽑아 주세요.", "/app/create.html");   // ★C fix: /app/topics.html 은 없는 화면(소재는 create.html)
        continue;
      }

      // CAS — 남이 먼저 가져갔으면 0행. pool 에서 빼고 다음 슬롯으로(이 슬롯은 다음 주기가 다시 본다).
      const got = await q(sql`UPDATE topics SET status = 'picked', used_at = NULL WHERE tenant_id = ${ctx.tid} AND id = ${cand.id} AND status = 'candidate' RETURNING id`);
      const at = pool.indexOf(cand); if (at >= 0) pool.splice(at, 1);
      if (!got.length) { continue; }
      takenNormKeys.add(cand.normKey);

      const upd = await q(sql`UPDATE slots SET topic_id = ${cand.id}, status = 'topic_assigned', note = NULL, updated_at = NOW()
        WHERE tenant_id = ${ctx.tid} AND id = ${slotId} AND status IN ('planned','no_topic') AND topic_id IS NULL RETURNING id`);
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
        "편성표에서 무엇이 언제 나가는지 볼 수 있어요. 바꾸고 싶으면 그 날 자리를 눌러 주세요.", "/app/schedule.html", { byKind: true });
    }
    const out: StepOutcome = { changed: assigned, skipped: noTopic + deferred };
    const detail: Record<string, unknown> = {};
    if (noTopic) detail.noTopic = noTopic;
    if (deferred) detail.deferred = deferred;
    if (similarSkipped) detail.similarSkipped = similarSkipped;   // 계정 간 유사도로 교체한 후보 수(§1.7)
    if (refill) detail.refill = refill;
    if (Object.keys(detail).length) out.detail = detail;
    return out;
  },
};
