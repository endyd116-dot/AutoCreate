/**
 * lib/cron/produce.ts — 스텝 `slots.produce`(계약 §1 · DESIGN §5B.2 D-3 · §5B.7 · §5B.9). 🔴 **이 라운드의 심장.**
 *   «사람이 아무것도 안 눌러도» 발행 D-3 에 글이 만들어진다.
 *
 *   ══ 언제 ══
 *     KST 현재 «시»가 `produceHour` 의 시와 같을 때만(하루 1회). 그 시각의 정시 틱 한 번이 그날 몫을 전부 만든다.
 *     ⚠️ 예산이 끊겨 못 만든 자리는 다음 시각에 못 만난다(시각 게이트 때문) — 그래서 **못 만든 수를 `deferredToNextDay` 로 센다**.
 *        다만 자리는 `topic_assigned` 그대로라 **내일 같은 시각에 다시 만든다**(발행일이 지나면 publisher 가 안 집어 가고
 *        review_deadline 이 «안 나갔다»를 남긴다 — 조용히 사라지는 경로 0).
 *
 *   ══ 무엇을 ══
 *     `produceLeadDays` 안에 든 `topic_assigned` 자리(소재는 assign_topics 가 이미 배정했다).
 *
 *   ══ 절차(자리 하나마다) ══
 *     ① **주간 코인 상한**(`weeklyCoinCap`) 검사 — 이번 주(월~일 KST) consume 합 + 이번 글 예상 비용 > cap 이면
 *        자리를 `coin_short` 로 두고 알림 1회. 🔴 **원장은 건드리지 않는다**(«상한»은 한도지 지출이 아니다).
 *     ② 디렉터 자동 모드 — `proposeForSlot`(슬롯의 채널·계정으로 고정 · LLM 0콜).
 *     ③ `confirm(..., { slotId, origin:"auto" })` — **사람 경로와 같은 함수**. piece 생성·코인 차감(멱등 ref)·롤백·배경 생성 호출이 거기 한 곳에 있다.
 *        자동이라 `consume({ auto:true })` → 충전 코인은 옵트인일 때만 쓴다(AM 규율).
 *     ④ 자리는 `producing`(confirm 이 쓴다).
 *        🔴 그 뒤 `in_review`·`failed` 동기화는 **`lib/content-gen.ts` 한 곳**이다(배경 함수 말미 · 이 스텝은 손대지 않는다).
 *     ⑤ 실제 잔액 부족 → `coin_short` + 알림. ⑥ 슬롯 게이트 거부 → 자리를 그대로 두고 감사에만(이미 게이트가 남겼다).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { confirm } from "../director";
import { hourOf, kstHour, kstToday, kstWeekStartUtc, notifyOnce, setSlot, type CronStep, type StepOutcome } from "./base";
import { proposeForSlot, toAutoSlot } from "./director-auto";

const n = (v: unknown) => Number(v || 0);
/** 한 자리를 만드는 데 필요한 최소 예산(브리프 + piece + 코인 + 배경 호출). LLM 은 배경 함수가 따로 돈다. */
const PER_SLOT_MS = 4_000;

/** 이번 주(월~일 KST)에 이미 쓴 코인. 경계는 SQL 안에서 만든다(PITFALLS #4). */
async function weeklySpent(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COALESCE(SUM(-delta), 0) AS c FROM coin_ledger
    WHERE tenant_id = ${tid} AND kind = 'consume' AND created_at >= ${kstWeekStartUtc()}`);
  return Math.max(0, n(r?.c));
}

export const produceStep: CronStep = {
  key: "slots.produce",
  every: "hourly",
  needsAutoSchedule: true,
  async run(ctx): Promise<StepOutcome> {
    // 시각 게이트 — 하루 1회. 수동 강제 실행(`?secret=`)도 같은 규칙을 탄다(테스트는 produceHour 를 지금 시각으로 바꿔서 한다).
    const want = hourOf(ctx.settings.produceHour);
    const now = kstHour(ctx.now);
    if (now !== want) return { changed: 0, skipped: 0, ...(ctx.manual ? { detail: { skippedByHour: `${now}시 ≠ produceHour ${want}시` } } : {}) };

    const lead = ctx.settings.produceLeadDays;
    const slots = await q(sql`SELECT id, channel, account_id, topic_id, publish_at, slot_date::text AS d FROM slots
      WHERE tenant_id = ${ctx.tid} AND status IN ('topic_assigned','coin_short') AND topic_id IS NOT NULL AND piece_id IS NULL
        AND slot_date >= ${kstToday()} AND slot_date <= ${kstToday()} + ${lead}::int
      ORDER BY slot_date, publish_at NULLS LAST, id LIMIT 100`);
    if (!slots.length) return { changed: 0, skipped: 0 };

    const cap = ctx.settings.weeklyCoinCap;
    let spent = cap === null ? 0 : await weeklySpent(ctx.tid);

    let made = 0, coinShort = 0, capped = 0, blocked = 0, noAccount = 0, deferred = 0, failed = 0;
    for (const row of slots) {
      if (ctx.deadline - Date.now() < PER_SLOT_MS) { deferred++; continue; }
      const slot = toAutoSlot(row);

      // ② 브리프 먼저 — 이번 글의 실제 코인 비용을 알아야 상한을 잴 수 있다(채널마다 이미지 수가 다르다).
      const brief = await proposeForSlot(ctx.tid, slot);
      if (!brief.ok) {
        if (brief.step === "no_account") {
          noAccount++;
          await setSlot(ctx.tid, slot.id, "awaiting_manual", "올릴 수 있는 계정이 없어요");
          await notifyOnce(ctx.tid, "produce_no_account", "글을 올릴 계정이 없어요",
            `${slot.channel} 계정이 모두 오늘 한도를 채웠거나 연결이 풀렸어요. «내 계정»에서 확인해 주세요.`, "/app/accounts.html");
        } else {
          // 소재가 사라졌거나 이미 쓴 소재 — 자리를 planned 로 되돌려 다음 assign_topics 가 새 소재를 준다.
          await q(sql`UPDATE slots SET status = 'planned', topic_id = NULL, note = ${brief.error.slice(0, 300)}, updated_at = NOW()
            WHERE tenant_id = ${ctx.tid} AND id = ${slot.id} AND piece_id IS NULL`);
          failed++;
        }
        continue;
      }

      // ① 주간 코인 상한 — 넘으면 원장 무접촉으로 보류.
      if (cap !== null && spent + brief.coinCost > cap) {
        capped++;
        if (await setSlot(ctx.tid, slot.id, "coin_short", `이번 주 코인 상한(${cap})을 넘어서 미뤘어요`)) coinShort++;
        await q(sql`UPDATE briefs SET status = 'skipped' WHERE tenant_id = ${ctx.tid} AND id = ${brief.briefId}`);
        await notifyOnce(ctx.tid, "coin_cap", "이번 주 코인 상한에 닿았어요",
          `한 주에 ${cap}코인까지 쓰도록 정해 두셨어요. 상한을 올리거나 다음 주가 되면 기다리던 글이 만들어져요.`, "/app/coins.html");
        await writeAudit({ tenantId: ctx.tid, action: "produce_coin_capped", actorType: "system", target: `slot:${slot.id}`,
          detail: { cap, spent, need: brief.coinCost, briefId: brief.briefId } });
        continue;
      }

      // ③ 사람 경로와 **같은** confirm — 슬롯을 빌려 쓰고, 자동이므로 게이트를 탄다.
      const r = await confirm(ctx.tid, brief.briefId, [], null, { slotId: slot.id, origin: "auto" });
      if (r.ok) {
        made++;
        spent += brief.coinCost;
        await writeAudit({ tenantId: ctx.tid, action: "piece_auto_produced", actorType: "system", target: `slot:${slot.id}`,
          detail: { briefId: brief.briefId, pieceIds: r.pieceIds, coinsCharged: r.coinsCharged, topicId: slot.topicId, channel: slot.channel, accountId: brief.spec.accountId } });
        continue;
      }

      await q(sql`UPDATE briefs SET status = 'skipped' WHERE tenant_id = ${ctx.tid} AND id = ${brief.briefId}`);
      if (r.step === "coin_short") {
        coinShort++;
        await setSlot(ctx.tid, slot.id, "coin_short", "코인이 모자라 미뤘어요");
        await notifyOnce(ctx.tid, "coin_short", "코인이 모자라요",
          `만들 글이 기다리고 있어요. 충전하면 다음 제작 시각에 이어서 만들어요.`, "/app/coins.html");
        continue;
      }
      if (r.step === "slot_gate") {
        // 게이트가 이미 감사·홈 노출을 남겼다. 자리는 손대지 않는다(다음 주기에 다시 본다).
        blocked++;
        continue;
      }
      failed++;
      await setSlot(ctx.tid, slot.id, "failed", r.error.slice(0, 300));
      await writeAudit({ tenantId: ctx.tid, action: "piece_auto_produce_failed", actorType: "system", riskLevel: "medium",
        target: `slot:${slot.id}`, detail: { step: r.step, error: r.error, briefId: brief.briefId } });
    }

    const out: StepOutcome = { changed: made + coinShort + noAccount + failed, skipped: deferred + blocked };
    const detail: Record<string, unknown> = { produceHour: ctx.settings.produceHour };
    for (const [k, v] of Object.entries({ made, coinShort, capped, blocked, noAccount, failed })) if (v) detail[k] = v;
    if (deferred) detail.deferredToNextDay = deferred;   // 🔴 오늘 못 만든 수 — 조용히 사라지지 않게 반드시 센다
    if (cap !== null) detail.weeklyCoinCap = { cap, spent };
    out.detail = detail;
    return out;
  },
};
