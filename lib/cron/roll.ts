/**
 * lib/cron/roll.ts — 스텝 `slots.roll`(계약 §1 · DESIGN §5B.7). 매시 · 달력을 horizonDays 까지 채운다.
 *   본체는 R1 의 `lib/slots.ts rollSlots` 그대로 — 이 스텝은 «언제·어느 테넌트에» 만 맡는다(로직 두 벌 금지 · PITFALLS #11-b).
 *   멱등: rollSlots 가 (rule_id, slot_date) 중복을 만들지 않는다 → 매시 돌아도 하루치가 한 번만 생긴다(changed 는 새로 만든 수).
 *   자동 편성이 꺼져 있으면 돌지 않는다(needsAutoSchedule) — «주 0회로 뒀는데 계속 만들어지는» 사고의 첫 문(AC-2).
 *   🔎 출처: AC 신규(계약 P1R2-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { rollSlots } from "../slots";
import type { CronStep, StepOutcome } from "./base";

export const rollStep: CronStep = {
  key: "slots.roll",
  every: "hourly",
  needsAutoSchedule: true,
  async run(ctx): Promise<StepOutcome> {
    const r = await rollSlots(ctx.tid, ctx.settings.horizonDays, ctx.now);
    // checked = 규칙이 이 기간에 «내야 했던» 자리 수 · created = 그중 비어 있어 새로 만든 수.
    // 둘을 함께 남긴다: created 0 이 «규칙이 없다»인지 «이미 다 차 있다»인지 갈라 보이게(PITFALLS #7).
    const out: StepOutcome = { changed: r.created, skipped: Math.max(0, r.checked - r.created) };
    if (r.checked) out.detail = { checked: r.checked, horizonDays: ctx.settings.horizonDays };
    return out;
  },
};
