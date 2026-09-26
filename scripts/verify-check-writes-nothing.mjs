/**
 * scripts/verify-check-writes-nothing.mjs — 🔴 **«검사»는 아무것도 쓰지 않는다**(C · 2026-09-26 · 메인 발주)
 *
 *   ══ 왜 ══
 *   `node scripts/build-pages.mjs --check` 가 «✓ 정본과 생성물이 같다 · 종료 0»을 찍으면서 **`public/js/ui.js` 를 오늘 날짜로 고쳐 놓았다.**
 *   판 번호 블록이 모드와 상관없이 맨 먼저 돌았기 때문이다. 메인이 머지하고 `--check` 를 돌린 뒤 main 에 **자기가 안 만든 미커밋**이 생겼고,
 *   A 는 같은 걸 밟고 되돌리려다 `git checkout ui.js` 로 **자기 R18 줄까지** 날렸다(A 의 AC-274).
 *   🔴 **«잰다»는 도구가 «쓴다»면 그 도구를 돌린 모든 창이 몰래 더러워진다.** 그리고 초록으로 끝나서 아무도 모른다(AC-244 의 서명 그대로).
 *
 *   ══ 무엇을 재나 ══
 *     ① `--check` 전후로 `public/app`·`public/ops`·`public/js` 의 **바이트**가 한 글자도 안 바뀌나.
 *     ② 🔴 **대조군 — 이 자가 «쓰기»를 볼 수 있나**: `--check` 없이 돌리면 **바뀌어야 한다**(판 번호를 옛 날짜로 돌려 둔 사본이라 반드시 쓴다).
 *        대조군이 안 바뀌면 ①의 초록은 «안 썼다»가 아니라 «못 봤다»다 → ⊘(AC-161 · 과녁이 살아 있나 · AC-236).
 *   🔴 사본(os 임시 폴더)에서만 돌린다 — 제품 파일은 한 글자도 안 건드린다.
 *
 *   ══ 이 자가 못 하는 것 ══
 *     · `public/` 밖에 쓰는 것은 안 본다(지금 `build-pages.mjs` 가 쓰는 곳은 이 셋뿐이다 — 늘면 여기 `WATCH` 에 더한다).
 *
 *   쓰는 법: node scripts/verify-check-writes-nothing.mjs      종료코드: 0 = 안 쓴다 · 1 = 검사가 썼다 · 2 = 못 쟀다
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync, cpSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const BUILD = "scripts/build-pages.mjs";
const WATCH = ["public/app", "public/ops", "public/js"];
const ANCHOR = 'UI.APP_VERSION = "';

if (!existsSync(path.join(ROOT, BUILD))) { console.error(`⊘ 못 쟀어요 — ${BUILD} 가 없다`); process.exit(2); }

function snap(dir) {
  const out = new Map();
  const walk = (d) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else out.set(path.relative(dir, p), createHash("sha1").update(readFileSync(p)).digest("hex")); } };
  for (const w of WATCH) if (existsSync(path.join(dir, w))) walk(path.join(dir, w));
  return out;
}
function box() {
  const d = mkdtempSync(path.join(os.tmpdir(), "ac-check-"));
  for (const w of WATCH) cpSync(path.join(ROOT, w), path.join(d, w), { recursive: true });
  mkdirSync(path.join(d, "scripts"), { recursive: true });
  cpSync(path.join(ROOT, BUILD), path.join(d, BUILD));
  /* 판 번호를 옛 날짜로 — 오늘과 다르면 빌드는 **반드시** 쓴다(과녁을 살린다) */
  const ui = path.join(d, "public/js/ui.js");
  const src = readFileSync(ui, "utf8");
  const hits = src.split(ANCHOR).length - 1;
  if (hits !== 1) return { d, hits };
  const s = src.indexOf(ANCHOR) + ANCHOR.length, e = src.indexOf('"', s);
  writeFileSync(ui, src.slice(0, s) + "2000.01.01" + src.slice(e));
  return { d, hits };
}
const run = (d, args) => { try { execFileSync(process.execPath, [BUILD, ...args], { cwd: d, encoding: "utf8", stdio: "pipe" }); return 0; } catch (e) { return e.status ?? -1; } };
const diff = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));

console.log(`\n«검사는 아무것도 쓰지 않는다» · ${BUILD} --check · ${new Date().toISOString()}\n`);
let exit = 0;
const A = box(), B = box();
try {
  if (A.hits !== 1) { console.log(`⊘ 과녁 — ui.js 에 «${ANCHOR}» 가 ${A.hits}곳(1곳이어야 한다) · 못 쟀다`); exit = 2; }
  else {
    /* ② 대조군 먼저 — 쓰는 모드는 바뀌어야 한다 */
    const b0 = snap(B.d); const cb = run(B.d, []); const b1 = snap(B.d); const wrote = diff(b0, b1);
    console.log(`${wrote.length ? "✅" : "⊘"} 대조군 — --check 없이 돌리면 쓴다(종료 ${cb}) · 바뀐 파일 ${wrote.length}${wrote.length ? `: ${wrote.slice(0, 4).join(", ")}` : " — 🔴 이 자는 쓰기를 못 본다"}`);
    if (!wrote.length) exit = 2;
    else {
      /* ① 검사 모드 */
      const a0 = snap(A.d); const ca = run(A.d, ["--check"]); const a1 = snap(A.d); const touched = diff(a0, a1);
      console.log(`${touched.length ? "❌" : "✅"} --check 는 아무것도 안 쓴다(종료 ${ca}) — 본 파일 ${a0.size}개${touched.length ? ` · 🔴 바뀐 파일 ${touched.length}: ${touched.join(", ")}` : " · 바뀐 파일 0"}`);
      if (touched.length) exit = 1;
    }
  }
} finally {
  rmSync(A.d, { recursive: true, force: true }); rmSync(B.d, { recursive: true, force: true });
}
console.log(`\n■ ${exit === 0 ? "✅ 검사는 말만 한다" : exit === 1 ? "❌ 검사가 썼다" : "⊘ 못 쟀다"}`);
process.exit(exit);
