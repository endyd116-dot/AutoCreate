/**
 * lib/cron/push-fanout.ts — 스텝 `push.fanout`(5분 우산 · **global**).
 *   알림함에 새로 들어온 행(`notifications.pushed_at IS NULL`)을 기기로 쏜다 — 문구는 알림함과 **한 출처**(다시 짓지 않는다).
 *   🔴 왜 팬아웃인가: 알림 INSERT 자리가 46군데다. 한 곳에서 쏘면 «어떤 알림만 푸시가 안 가는» 구멍이 안 생긴다(대신 최대 5분 늦다).
 *   🔴 VAPID 키가 없으면 **표시만 하고 넘어간다**(나중에 키를 꽂아도 옛 알림이 한꺼번에 울리지 않게) · 60분 넘은 알림도 같다.
 *   🔎 출처: AC 신규(계약 §3.6·푸시 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { pushConfigured, pushPendingNotifications } from "../push";
import { writeAudit } from "../audit";
import type { GlobalStep, StepOutcome } from "./base";

export const pushFanoutStep: GlobalStep = {
  key: "push.fanout",
  every: "5m",
  scope: "global",
  async run(): Promise<StepOutcome> {
    const r = await pushPendingNotifications();
    const changed = r.notifications;
    if (r.sent || r.removed || r.failed) {
      await writeAudit({ tenantId: null, action: "cron_push_fanout", actorType: "system", riskLevel: r.failed ? "medium" : "low", target: "cron:push.fanout",
        detail: { ...r, configured: pushConfigured() } });
    }
    return { changed, skipped: r.skippedOld, detail: changed || r.skippedOld ? { ...r, configured: pushConfigured() } : undefined };
  },
};
