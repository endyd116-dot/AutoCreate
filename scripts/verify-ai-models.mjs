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

const models = process.argv.slice(2).filter(Boolean);
if (!models.length) {
  console.error("사용법: node --env-file=.env scripts/verify-ai-models.mjs <model> [model2 ...]");
  process.exit(2);
}
if (!String(process.env.GEMINI_API_KEY ?? "").trim()) {
  console.error("GEMINI_API_KEY 가 없어요. `node --env-file=.env scripts/verify-ai-models.mjs <model>` 로 .env 를 실어 주세요.");
  process.exit(2);
}

const mark = (v) => (v === true ? "✓" : v === false ? "✗" : "·");
let anyFail = false;
for (const m of models) {
  const t = await verifyModel(m, { deadline: Date.now() + 40_000 });
  console.log(`\n${m}`);
  console.log(`  text ${mark(t.text)}   json강제 ${mark(t.json)}   googleSearch ${mark(t.googleSearch)}   image ${mark(t.image)}`);
  if (t.text !== true || t.json !== true) anyFail = true;   // 기본기(text·json) 못 하면 채택 부적합
}
console.log("\n(✓ 됨 · ✗ 미지원 · · 판정불가) — text·json 이 ✓ 여야 ai-models.ts 체인에 넣을 자격.");
process.exit(anyFail ? 1 : 0);
