// scripts/gen-mock-ops-emotion.mts — 운영센터 모의(`public/js/mock-ops.js`)의 «집필 계약 표»를 **서버 파일에서 뽑아** 쓴다.
//   사용: npx tsx scripts/gen-mock-ops-emotion.mts           (표시된 칸을 새로 쓴다)
//         npx tsx scripts/gen-mock-ops-emotion.mts --check   (쓰지 않고 «서버 표와 모의 표가 갈렸나»만 · 갈렸으면 종료코드 1)
//
// 🔴 [R18 · A · 2026-09-26 · 메인 발주] 왜 손으로 안 베끼고 생성하나 — AC-275:
//    모의가 서버 «함수의 결과»를 손으로 베껴 두면 서버 표가 바뀐 날부터 **같은 모양·다른 값**으로 조용히 낡는다.
//    그래서 **표(WRITING_CONTRACTS 의 오버레이 칸 · OVERLAY_KEYS · OVERLAY_CACHE_SECONDS)는 여기서 뽑고**,
//    **식(applyOverlay · summaryOf · keyOf)은 mock-ops.js 에 옮긴다**(식은 짧고 잘 안 바뀐다 · 표는 길고 자주 바뀐다).
//    표를 고친 사람이 이걸 안 돌리면 `--check` 가 운다.
import { readFileSync, writeFileSync } from "node:fs";
import { WRITING_CONTRACTS, OVERLAY_KEYS, OVERLAY_CACHE_SECONDS } from "../lib/writing-contracts";

const FILE = "public/js/mock-ops.js";
const START = "/* ▼ GEN:emotion — scripts/gen-mock-ops-emotion.mts 가 lib/writing-contracts.ts 에서 뽑아 쓴다 · 🔴 손으로 고치지 마라(다시 돌리면 덮인다) */";
const END = "/* ▲ GEN:emotion */";

/* 🔴 applyOverlay 가 보는 칸만 싣는다 — channel·emotionKey(열쇠) + OVERLAY_KEYS(모양 비교·요약에 쓰는 값) */
const base = Object.values(WRITING_CONTRACTS).map((c) => Object.fromEntries(
  ["channel", "emotionKey", ...OVERLAY_KEYS].filter((k) => (c as unknown as Record<string, unknown>)[k] !== undefined).map((k) => [k, (c as unknown as Record<string, unknown>)[k]])));
const block = `${START}
  const EMO_BASE = ${JSON.stringify(base)};
  const EMO_KEYS = ${JSON.stringify(OVERLAY_KEYS)};
  const EMO_CACHE_SECONDS = ${JSON.stringify(OVERLAY_CACHE_SECONDS)};
  ${END}`;

const src = readFileSync(FILE, "utf8");
const i = src.indexOf(START), j = src.indexOf(END);
if (i < 0 || j < 0 || j < i) { console.error(`⊘ ${FILE} 에 표시(▼ GEN:emotion … ▲)가 없다 — 어디에 쓸지 몰라서 안 썼다`); process.exit(2); }
const next = src.slice(0, i) + block + src.slice(j + END.length);
if (process.argv.includes("--check")) {
  if (next === src) { console.log(`✓ 모의 집필 계약 표 = 서버 표(${base.length}계약 · 칸 ${OVERLAY_KEYS.length} · 캐시 ${OVERLAY_CACHE_SECONDS}초)`); process.exit(0); }
  console.log(`🔴 모의 집필 계약 표가 서버 표와 갈렸다 — \`npx tsx scripts/gen-mock-ops-emotion.mts\` 로 다시 뽑아라`); process.exit(1);
}
if (next === src) { console.log(`= 그대로(${base.length}계약)`); process.exit(0); }
writeFileSync(FILE, next, "utf8");
console.log(`✓ ${FILE} 표를 새로 썼다(${base.length}계약 · 칸 ${OVERLAY_KEYS.length} · 캐시 ${OVERLAY_CACHE_SECONDS}초)`);
