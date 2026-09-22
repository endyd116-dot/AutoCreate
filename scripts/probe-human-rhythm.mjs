/**
 * scripts/_tmp/count-rhythm.mjs — 🔴 **«사람처럼»이 지금 실제로 어떤가**(AC-204 · 임시 · 읽기만).
 *   메인: 「사람의 리듬(입력 속도·쉬는 틈·스크롤)이 지금 어떤지 **재고**, 모자라면 채워라.
 *         🔴 **재지 않고 «넣었다»고 하지 마라**」.
 *   주석은 걷고 센다(주석 속 예시를 코드로 세면 안 된다 · 오늘 배운 ④꼴).
 */
/* 🔴 **이 파일은 커밋된 코드가 대는 증거다** — `_tmp/` 에 두면 그 인용이 **허공을 가리킨다.**
 *   ⚠️ 나는 이 실수를 **한 판 전에 고치고 바로 다음 판에서 또 했다**(2026-09-23).
 *      「증거를 대려면 그 증거가 커밋돼 있어야 한다」를 배워 놓고, 새 판을 시작하자마자 같은 자리에 빠졌다.
 *      ⇒ **재는 하니스는 처음부터 `scripts/` 에 만든다.** `_tmp/` 는 두 번 안 볼 것만.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { codeOnlyKeepIndex } from "./_lib/code-only.mjs";

const files = [];
for (const d of ["runner/channels", "runner/lib"]) {
  for (const f of readdirSync(d)) if (f.endsWith(".mjs")) files.push(path.join(d, f));
}
const src = new Map(files.map((f) => [f.replace(/\\/g, "/"), codeOnlyKeepIndex(readFileSync(f, "utf8"))]));

/* ── ① 쉬는 틈: `settle(page, min)` 는 **고정**이고 `settle(page, min, max)` 라야 흔들린다 ── */
let fixed = 0, jittered = 0;
const fixedVals = new Map();
for (const [f, t] of src) {
  for (const m of t.matchAll(/settle\(\s*[A-Za-z_$][\w$]*\s*,\s*([0-9_]+)\s*(,\s*([0-9_]+)\s*)?\)/g)) {
    if (m[3]) jittered++;
    else { fixed++; const v = Number(m[1].replace(/_/g, "")); fixedVals.set(v, (fixedVals.get(v) ?? 0) + 1); }
  }
}
console.log("■ ① 쉬는 틈(settle)");
console.log(`   🔴 **고정** ${fixed}곳 · 흔들림 ${jittered}곳`);
console.log(`   고정값 분포: ${[...fixedVals].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([v, n]) => `${v}ms×${n}`).join(" · ")}`);
console.log("   ⚠️ `settle(page, min)` 은 `max>min` 이 거짓이라 **난수를 안 탄다** — 도우미 주석은 «기계적 등간격을 피한다»고 적혀 있다.");

/* ── ② 입력 속도: `keyboard.type(..., { delay: N })` ── */
console.log("\n■ ② 입력 속도(keyboard.type delay)");
const delays = new Map();
let typeNoDelay = 0;
for (const [f, t] of src) {
  for (const m of t.matchAll(/keyboard\.type\(([\s\S]{0,120}?)\)/g)) {
    const d = /delay:\s*([0-9]+)/.exec(m[1]);
    if (d) { const v = Number(d[1]); if (!delays.has(v)) delays.set(v, []); delays.get(v).push(f); }
    else typeNoDelay++;
  }
}
for (const [v, where] of [...delays].sort((a, b) => a[0] - b[0])) {
  console.log(`   ${String(v).padStart(3)}ms × ${where.length}곳   ${[...new Set(where)].join(" · ")}`);
}
console.log(`   delay 없음(즉시): ${typeNoDelay}곳`);
console.log("   🔴 전부 **상수**다 — 사람은 글자마다 간격이 다르고, 낱말 사이·문장 끝에서 더 쉰다.");

/* ── ③ 사람이 하는데 우리가 안 하는 것 ── */
console.log("\n■ ③ 사람이 하는데 우리가 **안 하는 것**(셈)");
const has = (re) => [...src].filter(([, t]) => re.test(t)).length;
console.log(`   스크롤(mouse.wheel / scrollIntoView 로 읽는 시늉): wheel ${has(/mouse\.wheel/)}곳`);
console.log(`   마우스 이동(mouse.move): ${has(/mouse\.move/)}곳`);
console.log(`   글 쓰다 멈칫(문단 사이 긴 쉼): 전용 도우미 ${has(/pauseBetweenParagraphs|thinkPause/)}곳`);
console.log(`   ⚠️ 0 이면 «없다»이지 «필요 없다»가 아니다 — 필요한지는 이 자가 못 잰다(실물 발행이 답한다).`);
