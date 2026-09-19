/**
 * scripts/verify-slot-name.mjs — 🔴 «편성표가 **실제로 나갈 글**의 이름을 부르나» (2026-09-20).
 *
 *   왜 생겼나: 손님이 검수에서 제목을 고쳐 예약해 놓고 편성표를 보면 **딴 글이 걸린 것처럼** 보였다(A 실측 2026-09-20).
 *   편성표가 언제나 `topicTitle`(디렉터가 배정한 **소재** 제목)을 그렸기 때문이다 —
 *   홈 «오늘 편성»은 글 제목을 보여 줘서 **두 화면이 같은 자리를 다른 이름으로** 불렀다.
 *
 *   계약(B · 2026-09-20): 글이 걸려 있으면 `title` · 아직 없으면 `topicTitle` · **둘 다 보낸다.**
 *   🔴 **`topicTitle` 은 지우면 안 된다** — 이름표가 아니라 **판정**에도 쓰인다
 *      (`can.make = !pieceId && !!topicTitle` · «먼저 소재를 정해 주세요» · «다른 소재로 바꿔요»). 덮으면 그 판정이 거짓말이 된다.
 *
 *   🔴 **이 자는 자기가 무엇을 셌는지 말한다.**
 *   쓰기: node scripts/verify-slot-name.mjs
 */
import { readFileSync } from "node:fs";

const fails = [];
const notes = [];
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));

const tplAll = decomment(readFileSync("public/app/_tpl.txt", "utf8"));
const seg = (() => { const i = tplAll.indexOf("=== schedule.html"); const j = tplAll.indexOf("\n=== ", i + 10); return i < 0 ? "" : tplAll.slice(i, j < 0 ? tplAll.length : j); })();
notes.push(`센 것: 정본에서 \`schedule.html\` 절만 떼어 본다 — ${seg.length}자 (${seg ? "찾음" : "🔴 못 찾음"})`);
if (!seg) fails.push("🔴 `=== schedule.html` 절을 못 찾았다 — 이 자가 과녁을 잃었다(양성 대조 실패).");

/* ── ① 서버가 정말 `title` 을 싣나 (화면만 고치고 서버가 안 보내면 영영 못 본다) ── */
const slotsTs = decomment(readFileSync("lib/slots.ts", "utf8"));
const sendsTitle = slotsTs.split(/\r?\n/).some((l) => /o\.title\s*=/.test(l) && /piece_title/.test(l));
const keepsTopic = /o\.topicTitle\s*=/.test(slotsTs);
notes.push(`센 것: 서버 \`lib/slots.ts\` 가 \`title\`(글 제목)을 싣나 = ${sendsTitle} · \`topicTitle\`(소재)도 그대로 싣나 = ${keepsTopic}`);
if (!sendsTitle) fails.push("🔴 서버가 `title` 을 안 싣는다 — 화면이 아무리 읽어도 **소재 제목만** 그릴 수 있다.");
if (!keepsTopic) fails.push("🔴 서버가 `topicTitle` 을 뺐다 — 그 값으로 «먼저 소재를 정해 주세요» 같은 **판정**을 하고 있다. 되살려라.");

/* ── ② 🔴 **이름표로 쓰는 자리**가 전부 한 규칙을 통과하나 ── */
const hasHelper = /const slotName\s*=\s*\(s\)\s*=>\s*s\.title\s*\|\|\s*s\.topicTitle/.test(seg);
notes.push(`센 것: 이름 고르는 규칙이 한 곳(\`slotName(s) = s.title || s.topicTitle || …\`)에 있나 = ${hasHelper}`);
if (!hasHelper) fails.push("🔴 `slotName()` 이 없다 — 이름 고르는 규칙이 화면마다 흩어지면 또 갈라진다(AC-52).");

/* 손님에게 **이름을 보여 주는** 줄 = `<span class="t"…>${…}` 안에 소재/제목이 들어가는 자리 */
const nameLines = seg.split(/\r?\n/).map((l, i) => ({ l, n: i + 1 })).filter((x) => /class="t[ "]/.test(x.l) && /topicTitle|slotName\(/.test(x.l));
notes.push(`센 것: 슬롯 이름을 **손님에게 그리는** 줄 = ${nameLines.length}곳 [${nameLines.map((x) => x.n + "줄").join(" · ")}]`);
if (!nameLines.length) fails.push("🔴 이름을 그리는 줄을 한 곳도 못 찾았다 — 이 자가 헛돌고 있다(양성 대조 실패).");
for (const { l, n } of nameLines) {
  if (/slotName\(/.test(l)) continue;
  fails.push(`🔴 _tpl.txt(schedule.html) ${n}줄 — 이름을 \`topicTitle\` 로 바로 그린다. 글이 걸려 있으면 **고친 제목**이 나가야 한다: ${l.trim().slice(0, 100)}`);
}

/* ── ③ 🔴 **판정 자리는 건드리지 않았나** — topicTitle 이 판정에 그대로 쓰이는지 ── */
/* 🔴 처음엔 «`can.make` 가 든 줄»을 판정 줄로 봤는데, 실제 정의는 `const can = { … make: … }` 라
   **그 줄이 안 잡혔고** 거기에 `slotName()` 을 넣은 변이에 안 울었다(AC-112 로 잡았다 — 변이는 먹었고 자가 성겼다).
   ⇒ 규칙을 **뒤집는다**: `slotName()` 은 **이름을 그리는 줄에만** 있어도 된다. 그 밖에 나오면 판정에 샌 것이다. */
const nameLineNos = new Set(nameLines.map((x) => x.n));
const strayUse = seg.split(/\r?\n/).map((l, i) => ({ l, n: i + 1 }))
  .filter((x) => /slotName\(/.test(x.l) && !/const slotName\s*=/.test(x.l) && !nameLineNos.has(x.n));
notes.push(`센 것: \`slotName()\` 을 부르는 줄 중 **이름 그리는 자리가 아닌** 곳 = ${strayUse.length}곳 [${strayUse.map((x) => x.n + "줄").join(" · ") || "없음"}]`);
for (const { l, n } of strayUse) fails.push(`🔴 _tpl.txt ${n}줄 — 이름 그리는 자리가 아닌데 \`slotName()\` 을 썼다. **판정에 새면** 글 제목이 있을 때 «소재가 있다»로 잘못 읽힌다: ${l.trim().slice(0, 100)}`);

/* 판정이 `topicTitle` 을 그대로 보고 있나 — 이 값이 사라지면 «먼저 소재를 정해 주세요»가 거짓말이 된다 */
const judgeUsesTopic = seg.split(/\r?\n/).filter((l) => /(make:\s*!s\.pieceId|먼저 소재를 정해|다른 소재로 바꿔)/.test(l) && /s\.topicTitle/.test(l)).length;
notes.push(`센 것: 판정이 \`s.topicTitle\` 을 그대로 보는 줄 = ${judgeUsesTopic}곳`);
if (!judgeUsesTopic) fails.push("🔴 판정이 `topicTitle` 을 안 본다 — 「소재가 정해졌나」를 글 제목으로 판정하면 «먼저 소재를 정해 주세요»가 거짓말이 된다.");

/* ── ④ 정본 ↔ 생성물(AC-105) ── */
const gen = decomment(readFileSync("public/app/schedule.html", "utf8"));
const genHas = /const slotName\s*=/.test(gen);
const genStray = gen.split(/\r?\n/).filter((l) => /class="t[ "]/.test(l) && /topicTitle/.test(l) && !/slotName\(/.test(l)).length;
notes.push(`센 것: 생성물 \`schedule.html\` 에 \`slotName\` 이 들어갔나 = ${genHas} · 생성물에서 아직 \`topicTitle\` 로 바로 그리는 줄 = ${genStray}곳`);
if (!genHas || genStray) fails.push("🔴 `_tpl.txt` 만 고치고 `node scripts/build-pages.mjs` 를 안 돌렸다(AC-105) — 라이브는 옛 화면이다.");

/* ── 보고 ── */
console.log("편성표가 실제로 나갈 글의 이름을 부르나(2026-09-20) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나**");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 서버가 둘 다 싣고, 이름은 한 규칙으로 고르고, 판정은 `topicTitle` 을 그대로 본다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
