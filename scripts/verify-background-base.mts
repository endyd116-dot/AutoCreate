/**
 * scripts/verify-background-base.mts — 🔴 **배포 밖(스크립트)에서 라이브 배경 함수를 못 부른다 · 배포 안은 안 막는다**(C · 2026-09-26 · 메인 발주)
 *
 *   ══ 왜 ══
 *   `backgroundBase()` 의 안전핀은 `NETLIFY_DEV` 일 때만 섰다. `tsx`/`node` 자·리허설은 그 값이 없어서 `.env` 의 `SITE_URL`(라이브)을 돌려받고
 *   `INTERNAL_SECRET`(역시 `.env`)까지 실어 **라이브 `generate-video-background` 를 칠 수 있었다**(2026-09-15 $3.63 의 길).
 *   🔴 그런데 막는 쪽으로만 재면 **라이브 영상 생성을 우리가 막는** 수리도 초록이 된다 — 그래서 양팔을 같이 잰다(메인이 보탠 팔 ㉯).
 *
 *   ══ 팔 ══
 *     ㉮ 배포 밖 + 라이브 주소(`SITE_URL` 만)          → **던진다**
 *     ㉯ 배포 안(`URL` · `DEPLOY_PRIME_URL` · 람다 표지) + 라이브 → **던지지 않는다** ← 빠지면 라이브 영상 생성을 우리가 막는다
 *     ㉰ 배포 밖 + 로컬 주소                          → 던지지 않는다(로컬 스텁으로 도는 자들 · e2e·piece-sweep)
 *     ㉱ netlify dev + 라이브 주소                     → 던진다(첫 안전핀 그대로)
 *   🔴 **라이브는 치지 않는다** — `backgroundBase()` 를 직접 부르고 돌려받은 문자열만 본다(fetch 0).
 *
 *   쓰는 법:
 *     npx --yes tsx scripts/verify-background-base.mts                      ← 이 나무의 lib/site-url.ts
 *     npx --yes tsx scripts/verify-background-base.mts --file <경로>        ← 다른 판(예: 고치기 전 판)으로 반대팔을 잰다
 *   종료코드: 0 = 전부 ✅ · 1 = ❌ 있음 · 2 = 못 쟀다
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const argv = process.argv.slice(2);
const FILE = path.resolve(argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : path.join(process.cwd(), "lib/site-url.ts"));
if (!existsSync(FILE)) { console.error(`⊘ 못 쟀어요 — ${FILE} 가 없다`); process.exit(2); }

const LIVE = "https://autocreate-endyd.netlify.app";
const KEYS = ["URL", "DEPLOY_PRIME_URL", "SITE_URL", "NETLIFY_DEV", "NETLIFY", "AWS_LAMBDA_FUNCTION_NAME", "LAMBDA_TASK_ROOT"];
for (const k of KEYS) delete process.env[k];   // 🔴 .env 를 읽지 않는다 — 환경은 칸마다 내가 만든다
const { backgroundBase } = await import(pathToFileURL(FILE).href);

let bad = 0;
const arm = (name: string, env: Record<string, string>, wantThrow: boolean) => {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let got = "", threw = "";
  try { got = backgroundBase(); } catch (e) { threw = String((e as Error)?.message ?? e); }
  const ok = wantThrow ? !!threw : !threw && !!got;
  if (!ok) bad++;
  console.log(`${ok ? "✅" : "❌"} ${name}  — ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(" ")} → ${threw ? `던짐 «${threw.slice(0, 70)}»` : `«${got}» 돌려줌`}${ok ? "" : wantThrow ? "  🔴 라이브를 부를 수 있다" : "  🔴 라이브 영상 생성을 우리가 막는다"}`);
};

console.log(`\n«배포 밖에선 라이브 배경 함수를 못 부른다 · 배포 안은 안 막는다» · ${path.relative(process.cwd(), FILE)} · ${new Date().toISOString()}\n`);
arm("㉮ 배포 밖 + 라이브(.env 의 SITE_URL 만) → 던진다", { SITE_URL: LIVE }, true);
arm("㉯ 배포 안(URL · 라이브 /api/health 가 보여 준 그 값) → 안 던진다", { URL: LIVE, SITE_URL: LIVE }, false);
arm("㉯ 배포 안(DEPLOY_PRIME_URL · 프리뷰) → 안 던진다", { DEPLOY_PRIME_URL: "https://deploy-preview-1--autocreate-endyd.netlify.app", SITE_URL: LIVE }, false);
arm("㉯ 배포 안(람다 표지만 · URL 없음) → 안 던진다", { AWS_LAMBDA_FUNCTION_NAME: "generate-video", SITE_URL: LIVE }, false);
arm("㉰ 배포 밖 + 로컬 주소 → 안 던진다", { SITE_URL: "http://127.0.0.1:8901" }, false);
arm("㉰ 배포 밖 + 로컬 스텁을 URL 로(e2e·piece-sweep 모양) → 안 던진다", { URL: "http://127.0.0.1:8902", SITE_URL: LIVE }, false);
arm("㉱ netlify dev + 라이브 → 던진다(첫 안전핀)", { NETLIFY_DEV: "true", URL: LIVE }, true);
arm("㉱ netlify dev + 로컬 → 안 던진다", { NETLIFY_DEV: "true", URL: "http://localhost:8888" }, false);
arm("주소 없음 → 던진다(빈 주소로 부르지 않는다)", {}, true);

console.log(`\n■ ${bad ? `❌ ${bad}칸` : "✅ 전부"}`);
process.exit(bad ? 1 : 0);
