/**
 * lib/cron/slot-renew.ts — 스텝 `slot.renew`(계약 P1R7 §3.6 · hourly 우산 · **KST 05:00 게이트 = 하루 1번**).
 *   ① IP 재고가 생기면 `waiting_ip` 슬롯에 배정하고 **그때** 코인을 받는다(없는 걸 팔지 않는다)
 *   ② 만료 D-3 안내 1회 ③ 만료일 갱신 차감(멱등 ref `slot:{id}:{YYYYMM}`) · 잔액 부족이면 **그 슬롯만 «쉼»** ④ 코인이 채워지면 자동 복구
 *   🔴 **global 스텝**(테넌트 루프 밖) — 슬롯은 readonly·체험 만료 테넌트에도 있고, 우산의 활성 목록은 trial|active 뿐이다.
 *   🔎 출처: AC 신규(계약 §3.6·푸시 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { writeAudit } from "../audit";
import { runSlotCycle } from "../account-slots";
import { kstHour, type GlobalStep, type StepOutcome } from "./base";

export const SLOT_HOUR_KST = 5;

export const slotRenewStep: GlobalStep = {
  key: "slot.renew",
  every: "hourly",
  scope: "global",
  async run(ctx): Promise<StepOutcome> {
    if (!ctx.manual && kstHour(ctx.now) !== SLOT_HOUR_KST) return { changed: 0, skipped: 0 };
    const r = await runSlotCycle(ctx.now);
    const changed = r.assigned + r.renewed + r.paused + r.resumed + r.noticed;
    if (changed) await writeAudit({ tenantId: null, action: "cron_slot_renew", actorType: "system", riskLevel: r.paused ? "medium" : "low", target: "cron:slot.renew", detail: r.detail });
    return { changed, skipped: 0, detail: changed ? r.detail : undefined };
  },
};
