/**
 * POST /api/cron-tick-5m — 5분 우산(계약 §1 · DESIGN §5B.7).
 *   스텝: `publisher`(due 발행) · `runner.reap`(claim 15분 무보고 잡 회수).
 *   호출 경로 2개 — ① Netlify 스케줄(netlify.toml `[functions."cron-tick-5m"] schedule`) ② 수동 `?secret=`·`x-cron-secret`(CRON_SECRET).
 *   ⚠️ 스텝 추가는 **함수 추가가 아니다**(AM 관례) — `lib/cron/runner.ts STEPS` 에 한 줄 등록한다.
 */
import { runTick } from "../../lib/cron/runner";
import { jsonError } from "../../lib/response";

export const config = { path: "/api/cron-tick-5m" };

export default async (req: Request): Promise<Response> => {
  try { return await runTick("5m", req); }
  catch (err) { return jsonError("cron_tick_5m", err); }
};
