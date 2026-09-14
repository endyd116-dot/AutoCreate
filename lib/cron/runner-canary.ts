/**
 * lib/cron/runner-canary.ts — 셀렉터 카나리 «평가»(계약 P1R4 §2.2 · DESIGN §19). CronStep(hourly 우산 · KST 05:00 게이트).
 *   🔴 브라우저는 러너(고객 PC)에만 있다 — 이 서버 스텝은 카나리를 **돌리지 않는다**. 러너가 `ac-runner --canary` 로
 *      «임시저장까지» 드라이런하고 결과를 하트비트 canary 필드로 보내면 `canary_runs` 에 쌓인다(runner-jobs heartbeat).
 *      이 스텝은 매일 05:00(KST) 그 결과를 **평가**한다: 실패한 채널이 있으면 운영 알림 + 채널 `down` **제안**(자동 전환 X).
 *   🔴 전역 스텝인데 우산은 테넌트마다 run() 을 부른다 → `canary_runs(day='eval')` 유니크로 **하루 1회만** 평가(나머지 테넌트 호출은 skip).
 *   AC-9: ok 는 true/false/null(판정 불가). null 은 실패로 세지 않는다(티스토리 세션 없음 등).
 *   AC-17: publish·runner-jobs 를 최상단 import 하지 않는다(이 파일은 순수 SQL + 알림만).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { kstHour, type CronStep, type TenantCtx, type StepOutcome, NOOP } from "./base";

const CANARY_CHANNELS = ["naver_blog", "tistory"];

export const runnerCanaryStep: CronStep = {
  key: "runner.canary",
  every: "hourly",
  needsAutoSchedule: false,   // 운영 신호 — 고객 자동 편성과 무관
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    // KST 05:00 에만. 그 시각의 첫 테넌트 호출만 실제 평가하고 나머지는 유니크 충돌로 skip.
    if (kstHour(ctx.now) !== 5) return NOOP;

    // 하루 1회 잠금 — canary_runs 에 채널 'eval' 한 줄을 오늘 날짜로 선점(UPSERT 아님 · 이미 있으면 conflict=이미 평가함).
    const claim = await q(sql`INSERT INTO canary_runs (day, channel, ok, step, ran_at)
      VALUES ((NOW() AT TIME ZONE 'Asia/Seoul')::date, ${"__eval__"}, NULL, ${"lock"}, NOW())
      ON CONFLICT (day, channel) DO NOTHING RETURNING id`);
    if (!claim.length) return { changed: 0, skipped: 1, detail: { reason: "already-evaluated-today" } };

    // 오늘(KST) 채널별 카나리 결과.
    const rows = await q(sql`SELECT channel, ok, step, detail, shot_key FROM canary_runs
      WHERE day = (NOW() AT TIME ZONE 'Asia/Seoul')::date AND channel <> '__eval__'`);
    const byChannel = new Map(rows.map((r) => [String(r.channel), r]));

    const failed: string[] = [];
    const missing: string[] = [];
    const unknown: string[] = [];
    for (const ch of CANARY_CHANNELS) {
      const r = byChannel.get(ch);
      if (!r) { missing.push(ch); continue; }               // 오늘 카나리가 안 돌았다(러너가 안 켜졌거나 잡 없음)
      if (r.ok === false) failed.push(ch);                  // 🔴 셀렉터 깨짐 — 고객보다 먼저 잡았다
      else if (r.ok === null) unknown.push(ch);             // 판정 불가(세션 없음 · 실패 아님)
    }

    // 🔴 실패 채널 → 운영 알림 + down «제안»(자동 전환 X · 사람이 ops-channels 에서 누른다).
    for (const ch of failed) {
      const r = byChannel.get(ch)!;
      await writeAudit({ tenantId: null, action: "runner_canary_down_suggested", actorType: "system", target: `channel:${ch}`,
        detail: { channel: ch, step: r.step ?? null, detail: r.detail ?? null, shotKey: r.shot_key ?? null, suggest: "down" }, riskLevel: "high" });
    }
    if (missing.length) {
      await writeAudit({ tenantId: null, action: "runner_canary_missing", actorType: "system", target: "canary",
        detail: { channels: missing }, riskLevel: "medium" });
    }
    await writeAudit({ tenantId: null, action: "runner_canary_eval", actorType: "system", target: "canary",
      detail: { failed, missing, unknown, ok: CANARY_CHANNELS.filter((c) => byChannel.get(c)?.ok === true) }, riskLevel: failed.length ? "high" : "low" });

    return { changed: failed.length, skipped: unknown.length + missing.length, detail: { failed, missing, unknown } };
  },
};
