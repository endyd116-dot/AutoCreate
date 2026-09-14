/**
 * cron-tick-5m — 5분 우산(계약 §1 · DESIGN §5B.7). **Netlify 스케줄 전용 함수.**
 *   스텝: `publisher`(due 발행) · `runner.reap`(claim 15분 무보고 잡 회수).
 *
 *   🔴 **HTTP 로 부를 수 없다.** `netlify.toml` 의 `schedule` 로 등록된 함수는 플랫폼이 스케줄러 전용으로 잡아
 *      직접 요청을 막는다(로컬 실측 2026-09-14: netlify dev 가 «You can do this to test your functions locally,
 *      but it won't work in production» 을 돌려주고 우리 응답 본문을 통째로 버린다). 그래서 `config.path` 를 두지 않는다 —
 *      두면 «있는데 안 되는 경로»가 되어 다음 사람이 계약대로 불렀다가 조용히 빈 응답을 받는다.
 *   ⇒ **수동 강제 실행·검증은 `/api/cron-run?every=5m&secret=$CRON_SECRET`**(`netlify/functions/cron-run.ts`).
 *      같은 `runTick()` 을 부르고 계약 §1 의 `{ ok, ran:[...] }` 를 **그대로 돌려준다**(스텝 로직은 한 벌).
 *   ⚠️ 스텝 추가는 함수 추가가 아니다(AM 관례) — `lib/cron/runner.ts STEPS` 에 한 줄 등록한다.
 */
import { runTick } from "../../lib/cron/runner";

export default async (req: Request): Promise<Response> => {
  try { return await runTick("5m", req); }
  catch (err) { console.error("[cron-tick-5m]", err); return new Response(JSON.stringify({ ok: false, step: "cron_tick_5m" }), { status: 500 }); }
};
