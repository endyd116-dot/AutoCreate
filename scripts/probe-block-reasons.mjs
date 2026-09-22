/**
 * scripts/_tmp/count-block-reasons.mjs — 🔴 **«막혔다»를 지금 몇 갈래로 적나**(AC-203 · 임시 · 읽기만).
 *   메인: 「네이버가 거절하면 «해외 IP 차단» 같은 **한 가지 사유로 뭉쳐 적는다**」.
 *   🔴 **재는 것이 먼저다** — 고치기 전에 «뭉쳐 적는 자리»를 전수로 센다.
 *   주석은 걷고 본다(오늘 배운 ④꼴 — 주석 속 문구를 코드로 세면 안 된다).
 */
/* 🔴 **이 파일은 커밋된 코드가 대는 증거다** — `_tmp/` 에 두면 그 인용이 **허공을 가리킨다.**
 *   ⚠️ 나는 이 실수를 **한 판 전에 고치고 바로 다음 판에서 또 했다**(2026-09-23).
 *      「증거를 대려면 그 증거가 커밋돼 있어야 한다」를 배워 놓고, 새 판을 시작하자마자 같은 자리에 빠졌다.
 *      ⇒ **재는 하니스는 처음부터 `scripts/` 에 만든다.** `_tmp/` 는 두 번 안 볼 것만.
 */

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { codeOnlyKeepIndex } from "./_lib/code-only.mjs";

const DIRS = ["runner/channels", "runner/lib"];
const files = [];
for (const d of DIRS) {
  for (const f of readdirSync(d)) if (f.endsWith(".mjs")) files.push(path.join(d, f));
}

/** `BLOCK("kind", "사람말…")` 를 전부 걷는다. 🔴 열거라 **전부** 센다(유일성 아님). */
const RE = /BLOCK\(\s*"([a-z_]+)"\s*,\s*([`"'])([\s\S]*?)\2/g;

const rows = [];
for (const f of files) {
  const src = codeOnlyKeepIndex(readFileSync(f, "utf8"));
  for (const m of src.matchAll(RE)) {
    const line = src.slice(0, m.index).split("\n").length;
    rows.push({ file: f.replace(/\\/g, "/"), line, kind: m[1], msg: m[3].replace(/\s+/g, " ").trim() });
  }
}

console.log(`■ 러너가 «막혔다»를 내는 자리 — **${rows.length}곳** (파일 ${files.length}개를 훑었다)\n`);

const byKind = new Map();
for (const r of rows) { if (!byKind.has(r.kind)) byKind.set(r.kind, []); byKind.get(r.kind).push(r); }
console.log("■ kind 별 — 🔴 한 kind 에 여러 **다른 사정**이 몰려 있으면 그게 «뭉쳐 적는» 자리다");
for (const [k, v] of [...byKind].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n  ${k}  (${v.length}곳)`);
  for (const r of v) console.log(`     ${r.file}:${r.line}  «${r.msg.slice(0, 74)}»`);
}

/* 🔴 **단정하는 말**을 따로 센다 — 「의심돼요」·「~인 것 같아요」는 추측인데 **한 가지로 못 박아** 말한다. */
console.log("\n■ 🔴 **까닭을 단정하거나 추측을 단정처럼 적은 자리**");
const GUESSY = [
  [/해외\s*IP|IP\s*차단/, "IP 를 지목한다"],
  [/의심/, "«의심»이라면서 한 가지만 댄다"],
  [/것 같아요|것으로 보여요|보여요/, "추측을 사유로 적는다"],
  [/세션 만료/, "«세션 만료»로 못 박는다"],
];
let guessy = 0;
for (const r of rows) {
  const hit = GUESSY.filter(([re]) => re.test(r.msg));
  if (!hit.length) continue;
  guessy++;
  console.log(`  · ${r.file}:${r.line} [${r.kind}] ${hit.map((h) => h[1]).join(" · ")}\n      «${r.msg.slice(0, 96)}»`);
}
console.log(`\n  ⇒ ${guessy}곳 / ${rows.length}곳`);
