/**
 * scripts/verify-norevenue-reach.mjs — 🔴 «광고가 안 붙는 채널»이라는 말이 **손님 눈에 닿나** (수리 ③ · 2026-09-19).
 *
 *   왜 생겼나: 2026-09-18 에 당근용 «광고 수익이 안 붙어요»를 붙였고 `verify-r12-6-norevenue.mjs` 는 **초록**이었다.
 *   그런데 시나리오 A 로 **실제로 당근을 눌러 보니 한 글자도 안 떴다**(§6).
 *   화면이 `soon`(아직 안 열린 채널) 가지로 **먼저** 갈라져 배너 가지에 영영 못 갔기 때문이다.
 *   당근은 `status:"planned"` 라 **언제나** soon 이다 ⇒ 그 말은 **처음부터 닿을 수 없었다.**
 *
 *   🔴 **어제 자가 초록이었던 진짜 이유**: 세는 화면이 «revenue.html 하나»였다. 붙인 곳은 **둘**(수익 · 계정 연결)이었는데.
 *      ⇒ **이 자는 자기가 어느 화면을 세는지 한 줄씩 찍는다.** 그래야 «무엇을 안 세고 있는지»가 보인다.
 *
 *   쓰기: node scripts/verify-norevenue-reach.mjs
 */
import { readFileSync } from "node:fs";

const fails = [];
const notes = [];

const TPL = "public/app/_tpl.txt";
/* 🔴 **주석을 걷어내고 본다.** 처음 이 자를 냈을 때 `soonSheet` 안의 *주석에 적힌* «noRevenueBanner» 를 증거로 읽고
   배너를 통째로 뗀 변이에도 초록이었다(AC-108 로 잡았다). 주석은 코드가 아니다 — AC-59 를 기계가 반복한 자리다.
   줄 수는 지킨다(줄 번호가 어긋나면 사람이 못 찾는다). */
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));
const tpl = decomment(readFileSync(TPL, "utf8"));
/* 생성물도 같이 본다 — 정본만 고치고 build-pages 를 잊으면 라이브는 옛것이다(AC-105). */
const SCREENS = [
  { file: "public/app/accounts.html", 이름: "계정 연결(당근을 고르는 자리)" },
  { file: "public/app/revenue.html", 이름: "수익(0원이 뜨는 자리)" },
];

/* ── ① 문장 정본이 한 곳인가(AC-52) ── */
const ui = decomment(readFileSync("public/js/ui.js", "utf8"));
const hasSay = /UI\.noRevenueSay\s*=/.test(ui), hasBanner = /UI\.noRevenueBanner\s*=/.test(ui);
notes.push(`센 것: 문장 정본 \`UI.noRevenueSay\`=${hasSay} · \`UI.noRevenueBanner\`=${hasBanner} (public/js/ui.js)`);
if (!hasSay || !hasBanner) fails.push("🔴 «광고가 안 붙어요» 문장 정본이 `ui.js` 에 없다 — 화면마다 베껴 쓰면 말이 갈라진다(AC-52).");

/* ── ② 🔴 **어느 화면이 그 말을 하나** — 화면마다 한 줄씩 찍는다 ── */
let reached = 0;
for (const s of SCREENS) {
  const src = decomment(readFileSync(s.file, "utf8"));
  const uses = (src.match(/noRevenueBanner|noRevenueChannels|monetizable/g) || []).length;
  notes.push(`센 것: **${s.이름}** \`${s.file}\` — 말할 거리(noRevenueBanner·noRevenueChannels·monetizable)가 ${uses}곳`);
  if (!uses) fails.push(`🔴 **${s.이름}**(\`${s.file}\`)가 «광고가 안 붙어요»를 한 번도 말하지 않는다.`);
  else reached++;
}
notes.push(`센 것: 말이 닿는 화면 ${reached}/${SCREENS.length} — 🔴 이 목록에 없는 화면은 **안 세고 있는 것**이다(어제 자가 여기서 거짓말했다)`);

/* ── ③ 🔴 이번 사고의 뿌리 — «아직 안 열린 채널»에도 닿나 ── */
const gridLine = (tpl.match(/^.*#cg.*innerHTML.*cgi.*$/m) || [""])[0];
notes.push(`센 것: 계정 연결 격자 한 줄(\`#cg\` innerHTML) 안에서 \`soon(\` 과 \`monetizable\` 의 자리`);
if (!gridLine) fails.push("🔴 계정 연결 격자를 그리는 줄을 못 찾았다 — 이 자가 과녁을 잃었다(양성 대조 실패).");
else {
  const iSoon = gridLine.indexOf("soon(c) ?");
  const iMon = gridLine.indexOf("monetizable");
  const soonBranchTellsToo = /soon\(c\) \? `\$\{soonWord\(c\)\}\$\{c\.monetizable === false/.test(gridLine);
  notes.push(`센 것: 격자에서 \`soon\` 갈래가 \`monetizable\` 을 **함께** 말하나 = ${soonBranchTellsToo} (soon 위치 ${iSoon} · monetizable 위치 ${iMon})`);
  if (!soonBranchTellsToo && iSoon >= 0 && iMon > iSoon)
    fails.push("🔴 격자에서 `soon` 갈래가 먼저 갈라지고 `monetizable` 은 그 뒤에만 있다 — **당근처럼 «아직 안 열린」 채널은 배너 가지에 영영 못 간다**(이번 사고 그대로).");
}

const soonSheet = (tpl.match(/function soonSheet\(c\)[\s\S]*?\n\}/) || [""])[0];
const connectSheet = (tpl.match(/function connectSheet\(c\)[\s\S]*?\n\}/) || [""])[0];
notes.push(`센 것: 연결 시트 두 갈래 — \`soonSheet\`(아직 안 열린 채널)가 배너를 부르나 = ${/noRevenueBanner/.test(soonSheet)} · \`connectSheet\`(열린 채널) = ${/noRevenueBanner/.test(connectSheet)}`);
if (!soonSheet) fails.push("🔴 `soonSheet` 를 못 찾았다 — 이 자가 과녁을 잃었다(양성 대조 실패).");
else if (!/noRevenueBanner/.test(soonSheet))
  fails.push("🔴 `soonSheet()` 가 «광고가 안 붙어요»를 말하지 않는다 — 당근을 누르면 그 말이 **한 글자도 안 뜬다**(시나리오 A §6 에서 실제로 그랬다).");
if (connectSheet && !/noRevenueBanner/.test(connectSheet))
  fails.push("🔴 `connectSheet()` 가 «광고가 안 붙어요»를 말하지 않는다 — 열린 채널에서 고르기 전에 알려 줄 길이 사라졌다.");

/* ── ④ 🔴 막는 데 쓰지 않았나(§9 — 하드 게이트 0개) ── */
for (const s of SCREENS) {
  const src = decomment(readFileSync(s.file, "utf8"));
  const blocks = [...src.matchAll(/monetizable === false[^;\n]{0,80}/g)].map((m) => m[0]).filter((t) => /disabled|hidden|locked|return null|display:none/.test(t));
  if (blocks.length) fails.push(`🔴 ${s.file} 에서 \`monetizable === false\` 로 **막고 있다**(§9 위반 — 말해 주는 것까지다): ${blocks.join(" · ")}`);
}
notes.push("센 것: 두 화면에서 `monetizable === false` 로 단추를 잠그거나 숨기는 자리(§9 위반)");

/* ── ⑤ 정본↔생성물(AC-105) ── */
const genOk = decomment(readFileSync("public/app/accounts.html", "utf8"));
const tplSheetHasBanner = /noRevenueBanner/.test(soonSheet);
const genSheetHasBanner = /function soonSheet[\s\S]*?noRevenueBanner/.test(genOk);
notes.push(`센 것: 정본(_tpl.txt)↔생성물(accounts.html)의 \`soonSheet\` 배너 — 정본 ${tplSheetHasBanner} · 생성물 ${genSheetHasBanner}`);
if (tplSheetHasBanner !== genSheetHasBanner) fails.push("🔴 `_tpl.txt` 를 고치고 `node scripts/build-pages.mjs` 를 안 돌렸다(AC-105).");

/* ── 보고 ── */
console.log("«광고가 안 붙어요»가 손님 눈에 닿나(수리 ③ · AC 시나리오 A §6) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** — 어제 자는 이걸 안 적어서 «revenue.html 하나»만 세고도 초록이었다");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 두 화면 다 말하고, «아직 안 열린 채널»에도 닿고, 막는 데 쓰지 않았다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
