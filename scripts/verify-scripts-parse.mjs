// scripts/verify-scripts-parse.mjs — 🔴 `scripts/**` 가 **문법적으로 온전한가**(P1R8 §3.5 · B2 2026-09-15).
//   사용: node scripts/verify-scripts-parse.mjs
//
//   ══ 왜 이게 필요한가 ══
//     `tsconfig.json` 의 `include` 는 `netlify/functions`·`lib`·`db` 뿐이다 — **`scripts/**` 는 tsc 가 안 본다.**
//     즉 **급할 때 쓰는 도구(배포·되돌리기·마이그레이션)만 아무 검사도 안 받는다.** 실제로 오늘 그래서 당했다:
//     `build-runner.mts` 에 «Unterminated string literal» 을 심었는데 `npx tsc` 가 **초록**이었고,
//     실행해 보고서야 나왔다. 배포 직전에 그랬으면 사고 한가운데서 처음 봤을 것이다.
//
//   🔴 이건 **타입 검사가 아니라 문법 검사**다(그게 지금 초록으로 세울 수 있는 선이다).
//      전체 타입 검사는 남의 세션 파일에 옛 오류가 10건 있어 지금 켜면 빨강으로 시작한다 —
//      **첫날부터 빨간 검사는 아무도 안 본다.** 그건 메인에 따로 올렸다(라운드 항목 후보).
//      대신 이 검사는 **나를 실제로 문 그 결함**을 잡는다.
import { readdirSync, readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const files = readdirSync("scripts").filter((f) => /\.(mts|mjs|ts|js)$/.test(f)).sort();
const bad = [];
for (const f of files) {
  const src = readFileSync(`scripts/${f}`, "utf8");
  const loader = /\.m?ts$/.test(f) ? "ts" : "js";
  try { transformSync(src, { loader, format: "esm", target: "es2022" }); }
  catch (e) {
    const first = e?.errors?.[0];
    bad.push(`${f}${first?.location ? `:${first.location.line}:${first.location.column}` : ""} → ${first?.text ?? String(e?.message ?? e).slice(0, 120)}`);
  }
}
console.log(`scripts/ 파일 ${files.length}개 문법 검사`);
/* 🔴 센 것을 찍는다 — 0개면 이 검사는 아무것도 안 본 것이고, 그래도 초록이 뜬다(AC-58). */
if (!files.length) { console.log("🔴 검사할 파일이 하나도 없다 — 경로가 바뀌었나 본다"); process.exit(1); }
if (bad.length) { console.log(`\n🔴 문법이 깨진 파일 ${bad.length}개:`); for (const b of bad) console.log(`  · ${b}`); process.exit(1); }
console.log("✅ 전부 파싱된다");
