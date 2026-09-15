/**
 * scripts/verify-ai-models.mjs — 모델을 **우리 키로 불러 보고** 실측 4종 결과를 낸다(CLAUDE §4.9 정본 스크립트).
 *   🔴 크론(lib/cron/ai-model-watch.ts)과 **같은 함수**(lib/ai-verify.ts verifyModel)를 부른다 — 판정 한 벌(메인 결정 1).
 *   Node 24 가 lib/ai-verify.ts 를 그대로 타입 스트립해 로드한다(별도 빌드 없음).
 *
 *   사용법:  node --env-file=.env scripts/verify-ai-models.mjs <model> [model2 ...]
 *     예:    node --env-file=.env scripts/verify-ai-models.mjs gemini-3.8-flash gemini-4.0-pro
 *   표기:    ✓=됨 · ✗=모델이 거부(미지원) · ·=판정 불가(예산/네트워크). 넣을지는 사람이 이 표를 보고 정한다.
 */
import { verifyModel } from "../lib/ai-verify.ts";
/* [R8 · §3.3] 🔴 키는 여기서도 **같은 자리**에서 고른다(`lib/ai-key.ts`) — `GEMINI_API_KEYS` 만 꽂은 집에서
   이 하니스만 옛 env 를 읽으면 «키가 없다»고 거짓 보고한다. 🔴 그 파일은 import 0 인 순수 리프라 타입 스트립으로 그대로 로드된다. */
import { leaseAiKey, reportAiKeyOutcome, aiKeysConfigured } from "../lib/ai-key.ts";

const models = process.argv.slice(2).filter(Boolean);
if (!models.length) {
  console.error("사용법: node --env-file=.env scripts/verify-ai-models.mjs <model> [model2 ...]");
  process.exit(2);
}
/* 🔴 [R8 · §3.3] 키가 있나를 **`aiKeysConfigured()` 로** 묻는다 — `GEMINI_API_KEYS`(여러 개)도 키다.
   옛 판은 `GEMINI_API_KEY` 만 봐서, 여러 키만 꽂은 집에서 «키가 없다»고 거짓으로 멈췄다. */
if (!aiKeysConfigured()) {
  console.error("Gemini 열쇠가 없어요. `node --env-file=.env scripts/verify-ai-models.mjs <model>` 로 .env 를 실어 주세요(GEMINI_API_KEY 또는 GEMINI_API_KEYS).");
  process.exit(2);
}

const mark = (v) => (v === true ? "✓" : v === false ? "✗" : "·");
let anyFail = false;
for (const m of models) {
  /* 🔴 키를 골라 넘긴다 — `ai-verify.ts` 는 import 0 을 지켜야 해서 스스로 못 고른다(그 파일 헤더). */
  const lease = leaseAiKey();
  const t = await verifyModel(m, { deadline: Date.now() + 40_000, ...(lease ? { apiKey: lease.key } : {}) });
  const anyOk = t.text === true || t.json === true || t.googleSearch === true || t.image === true;
  reportAiKeyOutcome(lease, anyOk ? "ok" : "error");   // 판정 불가는 키 탓인지 알 수 없다 — 쉬게 하지 않는다
  console.log(`\n${m}`);
  console.log(`  text ${mark(t.text)}   json강제 ${mark(t.json)}   googleSearch ${mark(t.googleSearch)}   image ${mark(t.image)}`);
  if (t.text !== true || t.json !== true) anyFail = true;   // 기본기(text·json) 못 하면 채택 부적합
}
console.log("\n(✓ 됨 · ✗ 미지원 · · 판정불가) — text·json 이 ✓ 여야 ai-models.ts 체인에 넣을 자격.");
process.exit(anyFail ? 1 : 0);
