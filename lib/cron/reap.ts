/**
 * lib/cron/reap.ts — 스텝 `runner.reap`(계약 §1). 5분마다 «말이 없는 것들»을 정리한다.
 *   ① 러너 잡 회수 — claim 후 **15분** 무보고면 큐로 되돌린다(attempts++ · 상한 초과면 발행 잡을 `awaiting_manual` 로 종결).
 *      🔴 큐 SQL 은 B2 `reapStaleJobs(staleMin)` 한 벌이다 — 우선순위·attempts·종결 규칙이 거기 있다. 여기서 다시 쓰지 않는다(계약 §10).
 *      ⚠️ B2 의 함수는 **테넌트 전역**이다 — 테넌트마다 부르면 같은 일을 N 번 한다. 그래서 한 틱에 **한 번만** 부른다(아래 tickGuard).
 *   ② 계정 회복 — `cooldown` 24시간 경과 → `active` · `posts_today` KST 자정 리셋(`lib/account-health.sweepAccountStates`).
 *      `pending_login` 은 시간으로 풀지 않는다 — 사람이 다시 로그인해야 끝난다(러너 `session.login` 이 성공하면 B2 가 active 로 올린다).
 */
import { sweepAccountStates } from "../account-health";
import { type CronStep, type StepOutcome } from "./base";
import { reapStaleJobs } from "./publish-port";

/** 잡을 회수하기까지 기다리는 시간(분) — 러너 하트비트 60초 × 여유. */
const STALE_MIN = 15;

/** 이 틱에서 전역 회수를 이미 돌렸나(틱 기준 시각으로 구분 — 테넌트 수와 무관하게 한 번). */
let lastReapTick = 0;

export const reapStep: CronStep = {
  key: "runner.reap",
  every: "5m",
  needsAutoSchedule: false,
  async run(ctx): Promise<StepOutcome> {
    let changed = 0;
    const detail: Record<string, unknown> = {};

    // ① 전역 1회.
    const tick = ctx.now.getTime();
    if (tick !== lastReapTick) {
      lastReapTick = tick;
      const r = await reapStaleJobs(STALE_MIN);
      if (r === null) detail.queueReaper = "missing";   // «0건»이 아니라 «아직 못 물어봤다»
      else { changed += r.released + r.failed; if (r.released) detail.released = r.released; if (r.failed) detail.exhausted = r.failed; }
    }

    // ② 테넌트마다.
    const s = await sweepAccountStates(ctx.tid);
    changed += s.woke + s.reset;
    if (s.woke) detail.cooldownEnded = s.woke;
    if (s.reset) detail.dailyCountReset = s.reset;

    const out: StepOutcome = { changed, skipped: 0 };
    if (Object.keys(detail).length) out.detail = detail;
    return out;
  },
};
