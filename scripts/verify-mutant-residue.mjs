/**
 * scripts/verify-mutant-residue.mjs — 🔴 «변이가 제품 코드에 남아 있나»
 *
 *   왜 (2026-09-20 · A 가 실제로 밟았다):
 *   `verify-safe-list --run` 은 변이표가 든 자를 돌린다. 그 자들은 **제품 파일을 잠깐 고쳤다가 되돌린다.**
 *   🔴 **그 사이에 다른 창이 `git add -A` 로 커밋하면 변이가 그대로 딸려 들어간다.**
 *   A 가 `lib/revenue/trend.ts` 에서 `if (samples < TREND_MIN_SAMPLES) {` → `if (false) {` 가
 *   커밋에 섞인 것을 stat 에서 보고 잡았다. **한 글자도 안 틀린 채 «되돌리기 전»이 박힌다.**
 *   🔴 tsc 도 검사도 안 운다 — `if (false)` 는 문법이 멀쩡하고, 그 자는 되돌린 뒤 초록을 낸다.
 *
 *   무엇을 하나: 변이표(`scripts/*mutant*`·`*mutate*`)가 써 넣는 «고친 뒤» 문자열을 긁어,
 *   그것이 **제품 코드에 살아 있나**를 본다. 있으면 «되돌리기 전에 커밋된» 것이다.
 *
 *   🔴 **주석은 제외한다**(AC-109) — 옛 사고를 설명하는 글에 그 문자열이 그대로 실린다.
 *      실제로 `eof_action=pass` 가 세 파일 주석에 있고, 코드는 `repeat` 이다. 안 걷으면 매번 가짜 빨강이다.
 *
 *   백슬래시 없는 검사만 쓴다(AC-100).
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };

/** 🔴 주석을 걷는다 — 안 걷으면 «그 사고를 적어 둔 글»이 잔재로 잡힌다(AC-109). */
function codeOnly(s) {
  return s.replace(/[/][*][^]*?[*][/]/g, " ").split("\n").map((l) => {
    const i = l.indexOf("//");
    return i < 0 ? l : l.slice(0, i);
  }).join("\n");
}

/** 변이표가 써 넣는 «고친 뒤» 문자열 — 폴더에서 세는 것이지 손으로 적지 않는다(AC-108). */
function mutantStrings() {
  const out = [];
  for (const f of readdirSync("scripts")) {
    if (!/mutant|mutate/i.test(f)) continue;
    const s = read(join("scripts", f));
    const parts = s.split('to: "');
    for (let i = 1; i < parts.length; i++) {
      const end = parts[i].indexOf('"');
      if (end > 8 && end < 200) out.push({ from: f, lit: parts[i].slice(0, end) });
    }
  }
  return out;
}

const DIRS = ["lib", "netlify", "runner/channels", "runner/lib", "public/js", "public/app", "db"];
function productFiles() {
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/[.](ts|mjs|js|txt)$/.test(e.name)) out.push(p);
    }
  };
  DIRS.forEach(walk);
  return out;
}

const lits = mutantStrings();
const files = productFiles();
console.log(`\u25a0 변이 잔재 검사 — 변이표가 쓰는 문자열 ${lits.length}개 \u00b7 제품 파일 ${files.length}개`);
console.log(`  (폴더에서 센다 \u00b7 손 목록 0 \u00b7 주석은 걷는다)\n`);

const cache = new Map();
const code = (f) => { if (!cache.has(f)) cache.set(f, codeOnly(read(f))); return cache.get(f); };

let bad = 0, skipped = 0;
for (const { from, lit } of lits) {
  if (lit.trim().length < 8) { skipped++; continue; }
  for (const f of files) {
    if (code(f).includes(lit)) {
      bad++;
      console.log(`\u2717 ${f}`);
      console.log(`    변이표 ${from} 가 써 넣는 글자가 **코드에 살아 있다**:`);
      console.log(`    ${lit.slice(0, 90)}`);
      console.log(`    \u21d2 «되돌리기 전»이 커밋된 것일 수 있다. git log -S 로 언제 들어왔는지 봐라.`);
    }
  }
}

if (!bad) console.log(`\u2713 제품 코드에 변이 잔재 없음 (짧아서 건너뛴 문자열 ${skipped}개)`);
console.log(`\n\u2298 이 자가 **못 재는 것**: 변이표가 \`to:\` 가 아닌 방식으로 고치는 것(함수·정규식 치환).`);
console.log(`   \U0001f534 그리고 이 자는 **사고를 막지 못한다 — 사고가 난 뒤에 알려 줄 뿐이다.**`);
console.log(`   막는 법: **\`--run\` 이 도는 동안 커밋하지 않는다** \u00b7 \`git add -A\` 대신 **파일을 짚어서** add 한다.`);
process.exit(bad ? 1 : 0);
