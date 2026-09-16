/**
 * POST/GET /api/cron-run?every=5m|hourly — 🔴 **크론 수동 강제 실행·검증 창구**(계약 §1 응답 모양 그대로).
 *   왜 따로 있나: `cron-tick-5m`·`cron-tick-hourly` 는 `netlify.toml` 의 `schedule` 로 등록돼 있어
 *   **프로덕션에서 HTTP 로 부를 수 없다**(플랫폼이 스케줄러 전용으로 잡는다 · 로컬 실측 2026-09-14).
 *   그 두 함수와 이 함수는 **같은 `runTick()`** 을 부른다 — 스텝 로직은 한 벌이고, 여기는 «부르는 문»만 다르다.
 *
 *   인증: `?secret=` 또는 헤더 `x-cron-secret` = `CRON_SECRET`(미설정이면 잠긴다 · `lib/cron/runner.ts` 게이트와 동일).
 *   쓰임: C 의 시나리오 검증 · 운영 중 «지금 한 번 돌려» · 배포 직후 스모크.
 *   `?tid=<테넌트 id>` — 그 집만 돈다(검증 재현성). 없으면 평소처럼 활성 테넌트 전부.
 */
import { runTick, type Every } from "../../lib/cron/runner";
import { json, jsonError } from "../../lib/response";

export const config = { path: "/api/cron-run" };

export default async (req: Request): Promise<Response> => {
  try {
    const u = new URL(req.url);
    const every = u.searchParams.get("every");
    if (every !== "5m" && every !== "hourly") return json({ ok: false, step: "validate", error: "every=5m 또는 every=hourly 가 필요해요." }, 400);
    // `?tid=` — 한 테넌트만(검증용). 우산은 원래 활성 테넌트를 전부 도는데, 검증에서 남의 집까지 같이 돌면
    // 예산이 쪼개져 보려던 스텝이 budgetSkipped 로 밀리고 숫자가 섞여 재현이 안 된다.
    const onlyTid = Math.floor(Number(u.searchParams.get("tid")) || 0) || null;
    return await runTick(every as Every, req, { onlyTid });
  } catch (err) { return jsonError("cron_run", err); }
};
