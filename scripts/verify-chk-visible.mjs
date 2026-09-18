/**
 * scripts/verify-chk-visible.mjs — 🔴 «손님이 체크박스를 **볼 수 있나**»를 잰다 (수리 ① · 2026-09-19).
 *
 *   왜 생겼나: `public/css/ac.css` 에 `.chk` 정의가 **두 번** 있었다. 특이도가 같아 속성별로 뒤가 이기는데
 *   `width·height·background·border` 는 뒤(=네모를 그리는 쪽)가 이기고 `opacity:0` 은 앞 것이 살아남아
 *   **22×22 네모가 투명하게** 그려졌다. 마크업·JS·API·검사는 전부 초록이었고 **손님만 못 봤다**.
 *   첫 손님이 «네 가지 약관에 모두 동의해 주세요»를 듣고도 누를 네모를 못 찾았다(시나리오 A §1).
 *
 *   🔴 **이 자는 자기가 무엇을 세는지 말한다.** 어제 당근 자(`verify-r12-6-norevenue`)가 초록이었던 이유가
 *      «세는 화면이 revenue.html 하나»였기 때문이다 — 무엇을 셌는지 안 적으면 초록이 거짓말을 한다.
 *
 *   쓰기: node scripts/verify-chk-visible.mjs
 *   나가는 값: 0 = 통과 · 1 = 실패
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const CSS = "public/css/ac.css";
const css = readFileSync(CSS, "utf8");
const fails = [];
const notes = [];

/* 주석을 걷어낸 CSS — 주석 안의 `.chk{` 설명까지 «정의»로 세면 안 된다(이 파일 머리처럼). */
const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/* ── ① 같은 선택자가 두 번 정의되지 않았나 (이번 사고의 뿌리) ── */
const defsOf = (sel) => {
  const re = new RegExp("(^|[},\\s])" + sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{", "g");
  return (bare.match(re) || []).length;
};
for (const sel of [".chk", ".chk input"]) {
  const n = defsOf(sel);
  notes.push(`센 것: \`${sel}\` 정의 ${n}번 (${CSS})`);
  if (n > 1) fails.push(`🔴 \`${sel}\` 가 ${n}번 정의됐다 — 속성별로 섞여 «보이는데 안 보이는» 상자가 된다. 한 곳으로 합쳐라.`);
  if (n === 0) fails.push(`🔴 \`${sel}\` 정의가 없다 — 체크박스를 그리는 규칙이 사라졌다.`);
}

/* ── ② 체크박스를 투명하게 만드는 규칙이 남아 있지 않나 ── */
const chkInputBlocks = [...bare.matchAll(/\.chk\s+input[^{}]*\{([^}]*)\}/g)].map((m) => m[1]);
notes.push(`센 것: \`.chk input\` 계열 블록 ${chkInputBlocks.length}개의 선언 내용`);
for (const b of chkInputBlocks) {
  if (/opacity\s*:\s*0(?!\.)/.test(b)) fails.push(`🔴 \`.chk input\` 에 \`opacity:0\` 이 남아 있다 — 상자가 투명해진다: {${b.trim().slice(0, 90)}}`);
  if (/\bwidth\s*:\s*0\b/.test(b)) fails.push(`🔴 \`.chk input\` 에 \`width:0\` 이 남아 있다 — 상자가 사라진다: {${b.trim().slice(0, 90)}}`);
}

/* ── ③ 상자가 «켜졌다»를 눈으로 알 수 있나 (색이 바뀌는 규칙이 있나) ── */
const hasChecked = /\.chk\s+input:checked\s*\{[^}]*background/.test(bare);
const hasTick = /\.chk\s+input:checked::after\s*\{/.test(bare);
notes.push(`센 것: 켜짐 표시 규칙 — 배경 바뀜=${hasChecked} · 체크표시(::after)=${hasTick}`);
if (!hasChecked) fails.push("🔴 켜져도 배경이 안 바뀐다 — 손님이 «켜졌다»를 알 수 없다.");
if (!hasTick) fails.push("🔴 체크 표시(`.chk input:checked::after`)가 없다.");

/* ── ④ 마크업이 CSS 가 그리는 방식과 같은가 — 죽은 `<i>` 방식이 남아 있지 않나 ── */
const drawsViaI = /\.chk\s+i\s*\{/.test(bare);
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(html|txt)$/.test(f)) files.push(p); } };
walk("public");
const withI = [];
const plain = [];
for (const p of files) {
  const src = readFileSync(p, "utf8");
  for (const m of src.matchAll(/class="chk"[^>]*>\s*(?:<[^>]+>\s*)*?<input[^>]*type="checkbox"[^>]*>\s*(<i\b)?/g)) (m[1] ? withI : plain).push(p);
}
notes.push(`센 것: \`class="chk"\` 를 쓰는 파일 전수(public/**.html·**.txt) — 형제 \`<i>\` 방식 ${withI.length}곳 · \`<span>\`/글자 방식 ${plain.length}곳`);
if (withI.length && !drawsViaI) fails.push(`🔴 마크업 ${withI.length}곳이 형제 \`<i>\` 로 상자를 그리려 하는데 CSS 에 \`.chk i\` 가 없다 — 그 자리는 상자가 안 그려진다: ${[...new Set(withI)].join(" · ")}`);
if (drawsViaI && plain.length) fails.push(`🔴 CSS 가 \`.chk i\` 로 그리는데 마크업 ${plain.length}곳은 \`<i>\` 가 없다 — 두 방식이 섞였다.`);
if (!plain.length && !withI.length) fails.push("🔴 `class=\"chk\"` 를 쓰는 곳을 한 곳도 못 찾았다 — 이 자가 헛돌고 있다(양성 대조 실패).");

/* ── ⑤ 정본과 생성물이 같은가(AC-105) — 템플릿만 고치고 생성물을 잊으면 라이브는 옛것이다 ── */
const tpl = readFileSync("public/app/_tpl.txt", "utf8");
const gen = readFileSync("public/app/settings.html", "utf8");
const tplHasI = /class="chk"[^>]*>\s*<input[^>]*id="okChk"[^>]*>\s*<i\b/.test(tpl);
const genHasI = /class="chk"[^>]*>\s*<input[^>]*id="okChk"[^>]*>\s*<i\b/.test(gen);
notes.push(`센 것: 탈퇴 동의 체크박스의 정본(_tpl.txt)↔생성물(settings.html) 모양 일치 — 정본 \`<i>\`=${tplHasI} · 생성물 \`<i>\`=${genHasI}`);
if (tplHasI !== genHasI) fails.push("🔴 `_tpl.txt` 와 `settings.html` 의 체크박스 모양이 다르다 — `node scripts/build-pages.mjs` 를 안 돌렸다(AC-105).");

/* ── 보고 ── */
console.log("체크박스가 손님 눈에 보이나(수리 ① · AC 시나리오 A §1) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** (안 적으면 초록이 거짓말을 한다 — 어제 당근 자가 그랬다)");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 체크박스를 그리는 규칙이 한 곳이고, 투명하게 만드는 선언이 없고, 마크업과 방식이 같다.");
console.log("─".repeat(108));
console.log(`PASS ${notes.length - fails.length > 0 ? notes.length : 0} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
