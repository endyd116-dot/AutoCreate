/**
 * scripts/verify-script-imports.mjs — 🔴 **scripts/ 의 상대 수입이 실제로 풀리나**(메인 · AC-173 · 2026-09-23).
 *
 * 왜 생겼나 — 2026-09-23 실사고.
 *   B 가 `scripts/lib/` 를 `scripts/_lib/` 로 합치면서 **부르는 쪽 15곳을 다 고쳤다.**
 *   B 는 「수입 훑기 0곳 + 영향받는 자 15/15 실행 exit 0」 둘로 확인했다. **B 의 가지에서는 맞았다.**
 *   🔴 그런데 그 사이 메인이 B2 의 `47cee01` 을 머지했고, 거기 `./lib/...` 를 부르는 **새 파일 셋**이 들어왔다.
 *   ⇒ 머지 직후 `probe-dead-selectors` · `probe-selector-guard` · `verify-selector-guard` 셋이
 *     **첫 줄에서 죽는 상태**였다. 아무도 몰랐다 — **그 셋을 돌리는 사람이 없었으니까.**
 *
 * 🔴 이 자의 값 = **«모수»는 가지마다 다르다.** 재고 나서 머지가 한 번 더 있으면 그 측정은 옛것이다.
 *   그러니 «누가 재느냐»가 아니라 **머지된 뒤의 main 에서 한 번 더** 재야 한다.
 *
 * 🔴 **이 자는 grep 을 대신하는 것이 아니다**(B 가 재서 되받아 줬다 · 2026-09-23).
 *   B 의 훑기는 `"./lib/block` 처럼 **따옴표까지 붙여 겨누고 있었고 안 멀었다** — 그 셋은 **B 의 가지에 없던 파일**이라
 *   무엇으로 훑었어도 안 나왔다. **원인은 패턴이 아니라 오직 «때»다.**
 *   ⇒ 이 자의 값은 둘이다: ㉮ 이름이 아니라 **경로가 실제로 풀리나**를 잰다 ㉯ 🔴 **«돌리는 사람이 없는 파일»까지 본다**
 *     — 그 셋이 첫 줄에서 죽고 있었는데 아무도 몰랐던 것이 바로 그 값이다.
 *
 * 거짓 빨강 둘을 반드시 피한다(둘 다 실제로 났다):
 *   ① 주석 안의 «쓰는 법» 예시        → `stripComments`(scripts/_lib/block.mjs)로 지운다
 *   ② 템플릿 문자열 안의 import       → 검사기가 **임시 파일을 리포 뿌리에 써서** 돌리는 수법이다.
 *                                       그 안의 `./lib/...` 는 **그 임시 파일 자리 기준**이라 맞다.
 *                                       ⇒ 앞에 백틱이 홀수 개면 문자열 안이다.
 *   ③ 따옴표 안의 import 한 줄        → `.replace('import { x } from "..."', …)` 처럼 **남의 파일의 한 줄**을
 *                                       글자로 들고 있는 것. ⇒ **같은 줄에서** 바로 앞 글자가 따옴표면 문자열 안이다.
 *
 * 🔴 ③ 을 «줄머리에 있는 import 만 본다»로 풀지 않았다 — 그러면 `await import("../lib/x")` 같은
 *   **진짜 수입이 모수에서 빠진다**(AC-141 «모수» 병). 좁히는 규칙은 좁히는 것만 겨눠야 한다.
 *
 * 실행: `node scripts/verify-script-imports.mjs`      (0 = 다 풀린다 · 1 = 깨진 것 있다 · 2 = 자가 못 쟀다)
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { stripComments } from "./_lib/block.mjs";

const BS = String.fromCharCode(92);
const TICK = String.fromCharCode(96);

/** 한 파일의 소스에서 «진짜 상대 수입»만 뽑는다. 반환: [{ spec, index }] */
export function relativeImports(src) {
  const t = stripComments(src);
  const out = [];
  for (const m of t.matchAll(/(?:from|import)[\s(]+["'](\.[^"']+)["']/g)) {
    const before = t.slice(0, m.index);
    let ticks = 0;
    for (let i = 0; i < before.length; i++) {
      if (before[i] !== TICK) continue;
      if (i > 0 && before[i - 1] === BS) continue;   // 이스케이프된 백틱은 안 센다
      ticks++;
    }
    if (ticks % 2 === 1) continue;                    // ② 템플릿 문자열 안 — 자리가 다르다

    // ③ 줄머리에 **안 닫힌 따옴표**가 있으면 «남의 파일의 한 줄»을 글자로 들고 있는 것이다.
    //    🔴 «바로 앞 글자»로는 못 잡는다 — 이 정규식은 `import` 가 아니라 `from` 에서 맞을 수 있고,
    //    그때 앞 글자는 `}` 다(자기시험이 실제로 물어서 알았다 · 2026-09-23).
    const lineHead = before.slice(before.lastIndexOf("\n") + 1);
    let sq = 0, dq = 0;
    for (let i = 0; i < lineHead.length; i++) {
      if (i > 0 && lineHead[i - 1] === BS) continue;
      if (lineHead[i] === "'") sq++;
      else if (lineHead[i] === '"') dq++;
    }
    if (sq % 2 === 1 || dq % 2 === 1) continue;

    out.push({ spec: m[1], index: m.index });
  }
  return out;
}

/** 그 자리에서 그 경로가 풀리나. TS·ESM 의 확장자 생략을 다 본다. */
export function resolves(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  const js = /[.]js$/;
  return [
    base,
    base.replace(js, ".ts"), base.replace(js, ".mts"),
    base + ".ts", base + ".mts", base + ".mjs", base + ".js",
    base + "/index.ts", base + "/index.mjs", base + "/index.js",
  ].some(existsSync);
}

/* ───────── 🔴 자가 무나 — 먼저 확인한다(«그 자가 잰다»는 «그 자가 문다»가 아니다) ───────── */
function selfTest() {
  const fails = [];

  //  물어야 하는 것: 없는 파일을 부르는 수입
  const bad = 'import { x } from "./_lib/이런건-없다.mjs";';
  if (relativeImports(bad).length !== 1) fails.push("평범한 import 를 못 봤다");
  else if (resolves("scripts/z.mjs", relativeImports(bad)[0].spec)) fails.push("없는 경로를 «있다»고 했다");

  //  🔴 무해 변이 — 물면 안 되는 것 둘(오늘 실제로 났던 거짓 빨강)
  const inComment = " * 쓰는 법: import { x } from " + '"' + "./lib/없다" + '"' + ";";
  if (relativeImports("/*" + inComment + "*/").length !== 0) fails.push("주석 안 예시를 물었다");

  const inTemplate = "writeFileSync(p, " + TICK + "\nimport { y } from " + '"' + "./lib/writing-contracts" + '"' + ";\n" + TICK + ");";
  if (relativeImports(inTemplate).length !== 0) fails.push("템플릿 문자열 안 import 를 물었다");

  const inQuotes = ".replace('import { p } from " + '"' + "../../lib/account-slots" + '"' + ";', z)";
  if (relativeImports(inQuotes).length !== 0) fails.push("따옴표 안의 한 줄을 물었다");

  //  🔴 모수 지킴이 — 좁히는 규칙이 **진짜 수입을 먹지 않았나**(AC-141)
  const dynamic = "const { r } = await import(" + '"' + "../lib/blocks.js" + '"' + ");";
  if (relativeImports(dynamic).length !== 1) fails.push("🔴 줄 가운데의 진짜 `await import()` 가 모수에서 빠졌다");
  const afterString = "const A = " + '"' + "x" + '"' + "\nimport { b } from " + '"' + "./_lib/block.mjs" + '"' + ";";
  if (relativeImports(afterString).length !== 1) fails.push("🔴 앞 줄이 따옴표로 끝나자 다음 줄 수입이 모수에서 빠졌다");

  //  실재하는 경로는 통과해야 한다
  if (!resolves("scripts/verify-paint.mjs", "./_lib/find-playwright.mjs")) fails.push("있는 경로를 «없다»고 했다");

  return fails;
}

const selfFails = selfTest();
if (selfFails.length) {
  console.error("🔴 자가 못 쟀다(자기시험 실패) — 제품을 재지 않고 멈춘다:");
  for (const f of selfFails) console.error("   · " + f);
  process.exit(2);
}

/* ───────── 제품을 잰다 ───────── */
const files = readdirSync("scripts", { recursive: true })
  .map(f => "scripts/" + String(f).split(BS).join("/"))
  .filter(f => /[.](mjs|mts|js|ts)$/.test(f));

if (files.length < 50) {
  console.error("🔴 자가 못 쟀다 — scripts/ 에서 " + files.length + "개만 봤다(모수가 비었다). 리포 뿌리에서 돌려라.");
  process.exit(2);
}

let n = 0, bad = 0;
for (const f of files) {
  for (const { spec } of relativeImports(readFileSync(f, "utf8"))) {
    n++;
    if (!resolves(f, spec)) { console.log("🔴 " + f + "  ->  " + spec + "  (그 자리에 없다)"); bad++; }
  }
}

console.log("모수: 파일 " + files.length + "개 · 상대 수입 " + n + "개 · 깨진 것 " + bad + "개");
if (bad) {
  console.log("");
  console.log("고치는 법: 파일이 옮겨졌다면 **부르는 쪽 전부**를 고친다. 머지 뒤에는 새로 들어온 부르는 쪽이 있을 수 있다.");
}
process.exit(bad ? 1 : 0);
