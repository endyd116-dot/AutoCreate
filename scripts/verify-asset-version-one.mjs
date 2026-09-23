/**
 * scripts/verify-asset-version-one.mjs — [R17-B2 · 2026-09-23] 🔴 **공용 스크립트의 판 번호가 페이지마다 같은가.**
 *
 *   ══ 왜 ══
 *   `public/js/ui.js` 에 함수를 하나 더하고 `?v=` 를 안 올리면, **캐시를 물고 있는 브라우저는 옛 ui.js 를 쓴다** —
 *   새 화면이 `UI.whenKST is not a function` 으로 죽는다. 배포는 초록인데 고객 화면만 깨지는 모양이다.
 *   🔴 그리고 실제로 갈려 있었다: 오늘 `v=30 → v=31` 로 올리는데 **세 장이 안 따라왔다**
 *      (`public/app/home.html` · `public/app/team-accept.html` · `public/ops/login.html`) —
 *      `scripts/build-pages.mjs` 가 만드는 장이 아니라 **손으로 두는 장**이라 일괄 치환에서 샜다.
 *      ⇒ 그 세 장만 옛 ui.js 를 쓰고 있었을 것이다. **사람이 눈으로 세는 한 또 샌다.**
 *
 *   ══ 무엇을 보나 ══
 *     공용 스크립트(`ui.js`·`ops.js`·`mock.js`·`mock-ops.js`)마다
 *     **페이지들이 부르는 `?v=` 가 한 가지뿐인가.** 두 가지 이상이면 빨강.
 *   🔴 «어느 번호가 맞나»는 안 본다 — 그건 사람이 정하는 값이다. **갈렸다는 사실**만 센다.
 *
 *   쓰기: node scripts/verify-asset-version-one.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = "public";
const SHARED = ["ui.js", "ops.js", "mock.js", "mock-ops.js"];

/** public/ 아래 .html 전부(하위 폴더 포함). */
function pages(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { pages(p, out); continue; }
    if (name.endsWith(".html")) out.push(p);
  }
  return out;
}

const files = pages(ROOT);
/** 스크립트 이름 → { 판번호 → [그 번호를 쓰는 페이지…] } */
const seen = new Map(SHARED.map((s) => [s, new Map()]));
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const s of SHARED) {
    const re = new RegExp(`/js/${s.replace(".", "\\.")}\\?v=([0-9]+)`, "g");
    for (const m of src.matchAll(re)) {
      const by = seen.get(s);
      if (!by.has(m[1])) by.set(m[1], []);
      by.get(m[1]).push(f.replace(/\\/g, "/"));
    }
  }
}

const problems = [];
console.log(`공용 스크립트 판 번호 — 페이지 ${files.length}장`);
for (const s of SHARED) {
  const by = seen.get(s);
  if (!by.size) { console.log(`  ${s.padEnd(12)} (아무 데서도 안 부른다)`); continue; }
  const parts = [...by.entries()].map(([v, ps]) => `v=${v}×${ps.length}`).join(" · ");
  console.log(`  ${s.padEnd(12)} ${parts}`);
  if (by.size > 1) {
    /* 적은 쪽이 «안 따라온 장»이다 — 이름을 찍어 준다(«어디»를 안 찍으면 사람이 또 눈으로 찾아야 한다). */
    const sorted = [...by.entries()].sort((a, b) => b[1].length - a[1].length);
    const [, ] = sorted[0];
    for (const [v, ps] of sorted.slice(1)) {
      problems.push(`🔴 ${s}: v=${v} 를 쓰는 장이 ${ps.length}개 남았다(나머지는 v=${sorted[0][0]}) — 그 장들은 **옛 ${s} 를 쓴다**\n     ${ps.join("\n     ")}`);
    }
  }
}
/* 🔴 아무것도 못 찾았으면 «맞다»가 아니라 **정규식이 빗나간 것**이다(이 프로젝트의 자 규율 · AC-100 ⑦). */
if (![...seen.values()].some((by) => by.size)) { console.log("🔴 판 번호를 하나도 못 읽었다 — 페이지의 <script src> 모양이 바뀌었다"); process.exit(1); }
if (problems.length) { console.log("\n" + problems.join("\n")); process.exit(1); }
console.log("\n✅ 공용 스크립트마다 판 번호가 한 가지다");
