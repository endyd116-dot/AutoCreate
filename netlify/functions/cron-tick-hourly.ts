/**
 * POST /api/cron-tick-hourly — 정시 우산(계약 §1 · DESIGN §5B.7).
 *   스텝: `slots.roll` · `slots.assign_topics` · `slots.produce`(produceHour 시각에만) · `slots.review_deadline` · `slots.learn`.
 *   호출 경로 2개 — ① Netlify 스케줄(netlify.toml `[functions."cron-tick-hourly"] schedule`) ② 수동 `?secret=`·`x-cron-secret`(CRON_SECRET).
 *   ⚠️ 스텝 추가는 **함수 추가가 아니다**(AM 관례) — `lib/cron/runner.ts STEPS` 에 한 줄 등록한다.
 */
import { runTick } from "../../lib/cron/runner";
import { jsonError } from "../../lib/response";

export const config = { path: "/api/cron-tick-hourly" };

export default async (req: Request): Promise<Response> => {
  try { return await runTick("hourly", req); }
  catch (err) { return jsonError("cron_tick_hourly", err); }
};
