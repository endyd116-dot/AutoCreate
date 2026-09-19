/**
 * scripts/verify-script-issues-shown.mjs — 🔴 «대본 검사 결과가 **손님 눈까지** 오나» (2026-09-20).
 *
 *   왜 생겼나: `lib/video/script.ts checkScriptGates` 가 훅·**광고법 금칙어**·**수익 약속 표현**·상투 표현·문장 수를 재고
 *   `lib/video/gen.ts` 가 `meta.scriptIssues` 에 적어 두는데 — **읽는 데가 0곳**이었다(B 가 전수로 셌다).
 *   ⇒ **막지도 않고 말하지도 않는다.** §9 가 «게이트보다 나쁘다»고 한 바로 그 자리다
 *      (막지 않기로 했으면 «말해 주기»가 **더 세져야** 한다 — 그게 §9 의 값이다).
 *
 *   🔴 이 자는 **길 전체**를 센다 — 재는 자리 → 적는 자리 → 실어 보내는 자리 → **그리는 자리** → 말투.
 *      한 칸만 보면 «서버엔 있는데 화면엔 없는» 오늘의 그 병을 또 놓친다.
 *
 *   쓰기: node scripts/verify-script-issues-shown.mjs
 */
import { readFileSync } from "node:fs";

const fails = [];
const notes = [];
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));

/* ── ① 재는 자리 ── */
const scriptTs = decomment(readFileSync("lib/video/script.ts", "utf8"));
const axes = [
  { key: "훅", re: /issues\.push\(`훅/ },
  { key: "광고법 금칙어", re: /issues\.push\(`광고법 금칙어/ },
  { key: "수익 약속 표현", re: /issues\.push\(`수익 약속 표현/ },
  { key: "상투 표현", re: /issues\.push\(`상투 표현/ },
  { key: "문장 수", re: /issues\.push\(`문장 수/ },
];
const found = axes.filter((a) => a.re.test(scriptTs)).map((a) => a.key);
notes.push(`센 것: \`checkScriptGates\` 가 재는 축 = ${found.length}/${axes.length} [${found.join(", ")}]`);
if (found.length < axes.length) fails.push(`🔴 재던 축이 사라졌다: ${axes.filter((a) => !found.includes(a.key)).map((a) => a.key).join(", ")} — 검사를 지우지 마라(§9 «소프트로 내리는 것이지 없애는 게 아니다»).`);

/* ── ② 적는 자리 ── */
const genTs = decomment(readFileSync("lib/video/gen.ts", "utf8"));
const writes = /scriptIssues:/.test(genTs);
notes.push(`센 것: \`lib/video/gen.ts\` 가 \`meta.scriptIssues\` 에 적나 = ${writes}`);
if (!writes) fails.push("🔴 잰 결과를 아무 데도 안 적는다 — 그러면 화면이 읽을 것이 없다.");

/* ── ③ 실어 보내는 자리 (허용 목록) ── */
const piecesTs = decomment(readFileSync("netlify/functions/pieces.ts", "utf8"));
const sends = /meta\.scriptIssues\s*=/.test(piecesTs);
notes.push(`센 것: \`pieces-get\` 이 \`scriptIssues\` 를 화면에 실어 보내나 = ${sends}`);
if (!sends) fails.push("🔴 서버가 안 실어 보낸다 — 적어만 두고 아무도 못 본다(2026-09-20 이전 상태 그대로).");

/* ── ④ 🔴 **그리는 자리** — 여기가 오늘의 교훈이다 ── */
const tplAll = readFileSync("public/app/_tpl.txt", "utf8");
const i0 = tplAll.indexOf("=== piece.html"); const j0 = tplAll.indexOf("\n=== ", i0 + 10);
const segRaw = i0 < 0 ? "" : tplAll.slice(i0, j0 < 0 ? tplAll.length : j0);
const seg = decomment(segRaw);
const hasFn = /function renderScriptIssues\(\)/.test(seg);
const reads = /\(P\.meta \|\| \{\}\)\.scriptIssues/.test(seg);
const called = /renderScriptIssues\(\)\s*;/.test(seg.replace(/function renderScriptIssues\(\)[\s\S]*?\n\}/, ""));
const host = /id="scriptissues"/.test(seg);
notes.push(`센 것: 그리는 함수가 있나 = ${hasFn} · 그 값을 읽나 = ${reads} · **render 가 실제로 부르나** = ${called} · 붙일 자리(\`#scriptissues\`)가 있나 = ${host}`);
if (!hasFn) fails.push("🔴 `renderScriptIssues()` 가 없다 — 그릴 자가 없다.");
if (!reads) fails.push("🔴 `P.meta.scriptIssues` 를 안 읽는다.");
if (!called) fails.push("🔴 함수만 있고 **아무도 안 부른다** — «정의가 있나»가 아니라 «호출이 있나»다(AC-69).");
if (!host) fails.push("🔴 붙일 자리(`#scriptissues`)가 마크업에 없다.");

/* ── ⑤ 🔴 말투(§3 · §9) — 겁주거나 발 빼면 막는 것보다 나쁘다 ── */
const fn = (seg.match(/function renderScriptIssues\(\)[\s\S]*?\n\}/) || [""])[0];
const SCARY = ["정지됩니다", "정지될 수", "불이익", "알려만", "책임", "위반입니다", "삭제됩니다"];
const scary = SCARY.filter((w) => fn.includes(w));
const saysSoft = /막지 않아요/.test(fn);
notes.push(`센 것: 그 문구에 겁주는 말 [${SCARY.join(", ")}] = ${scary.length}개 · «막지 않아요»를 같이 말하나 = ${saysSoft}`);
if (scary.length) fails.push(`🔴 겁주거나 발 빼는 말이 있다(§3): ${scary.join(", ")}`);
if (!saysSoft) fails.push("🔴 «막지 않아요»를 말하지 않는다 — 막지 않기로 한 검사는 **막지 않는다는 사실까지** 말해야 한다(§9).");

/* ── ⑥ 문장을 화면이 지어내지 않나(AC-52) ── */
const invents = /광고법 금칙어:|수익 약속 표현:|상투 표현:/.test(fn);
notes.push(`센 것: 화면이 서버 문장을 **베껴 적지** 않았나 = ${!invents}`);
if (invents) fails.push("🔴 화면이 서버 문장을 베껴 적었다 — 두 곳이 갈라진다(AC-52). 서버가 준 문자열을 그대로 그려라.");

/* ── ⑦ 정본 ↔ 생성물(AC-105) ── */
const gen = decomment(readFileSync("public/app/piece.html", "utf8"));
const genOk = /function renderScriptIssues\(\)/.test(gen) && /id="scriptissues"/.test(gen);
notes.push(`센 것: 정본의 처치가 **생성물에도** 들어갔나 = ${genOk}`);
if (!genOk) fails.push("🔴 `_tpl.txt` 만 고치고 `node scripts/build-pages.mjs` 를 안 돌렸다(AC-105).");

/* ── 보고 ── */
console.log("대본 검사 결과가 손님 눈까지 오나(2026-09-20) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** — 재는 자리 → 적는 자리 → 실어 보내는 자리 → **그리는 자리** → 말투");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 재고, 적고, 실어 보내고, **그리고**, 겁주지 않고 «막지 않아요»까지 말한다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
