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
/* 🔴 [2026-09-20 · B 가 고쳤다] **축을 «문장»이 아니라 «검사 호출»에 고정한다.**
   첫 판은 `issues.push(\`광고법 금칙어` 처럼 **손님이 읽는 문장의 앞머리**로 축을 잡았다.
   그런데 그 문장들은 **§3 말투 규칙을 지켜야 하는 말**이다(«문장 수 3(**계약** 4~8)» 의 «계약»이 그래서 걸렸다).
   ⇒ 말에 고정하면 **말투를 고칠 때마다 이 자가 빨개진다** — «검사를 지웠다»가 아닌데 그렇게 운다.
   🔴 §9 가 지키라는 것은 «검사를 지우지 마라»이지 «문구를 고치지 마라»가 아니다.
      그래서 **검사를 부르는 모양**으로 잰다 — 이러면 말투는 자유롭고 검사를 빼면 바로 운다.
   (같은 교훈: 2026-09-20 `verify-upstream-discarded` 도 이름이 아니라 **쓰는 모양**으로 옮겼다.) */
const axes = [
  { key: "훅", re: /checkHook\s*\(/ },
  { key: "광고법 금칙어", re: /findBannedWords\s*\(/ },
  { key: "수익 약속 표현", re: /findIncomeClaim\s*\(/ },
  { key: "상투 표현", re: /CLICHES\s*\.\s*filter/ },
  { key: "문장 수", re: /script\.lines\.length\s*[<>]/ },
];
/* 🔴 [변이가 고치게 했다 · AC-108] **«정의가 있나»가 아니라 «그 함수 안에서 부르나»** 로 잰다.
   첫 재고정은 파일 전체에서 `checkHook(` 를 찾았다 — 그런데 **그 파일에 `checkHook` 의 정의가 있다.**
   그래서 `checkScriptGates` 안의 호출을 통째로 들어내도 **안 울었다**(변이 M1 이 잡았다).
   `verify-r8-deadends` 가 머리말에 적어 둔 그 교훈(«정의가 있나가 아니라 호출이 있나»)을 내가 그대로 밟은 것이다.
   ⇒ `checkScriptGates` 의 **몸통만 잘라** 그 안에서 찾는다. */
/* 🔴 [AC-113 을 내가 그대로 밟았다] 첫 판은 «이름 뒤 첫 `)` 다음의 첫 `{`» 를 몸통으로 봤다.
   타입스크립트에서 그 `{` 는 **반환 타입**의 것일 수 있다 — 여기가 정확히 그렇다:
     `checkScriptGates(script: VideoScript, maxLines = 12): { ok: boolean; issues: string[] } { …진짜 몸통… }`
   그러면 «몸통»이 `{ ok: boolean; issues: string[] }` 가 되어 **축이 전부 사라진다**(변이 M5 가 그 꼴로 잡혔다).
   ⇒ 인자 목록을 **괄호 깊이**로 닫고, 그 뒤 **꺾쇠(`<>`)·중괄호 깊이가 0일 때** 나오는 첫 `{` 가 몸통이다.
   C 가 `verify-audit-gap` 머리말(AC-113)에 적어 둔 그 처방이다 — 적어 둔 걸 읽고도 밟았다. */
function bodyOf(src, name) {
  const i = src.indexOf(`export function ${name}(`);
  if (i < 0) return "";
  /* 인자 목록을 **괄호 깊이**로 닫는다(기본값 안에 `(` 가 있어도 안 속는다). */
  let k = src.indexOf("(", i), par = 0;
  for (; k < src.length; k++) { if (src[k] === "(") par++; else if (src[k] === ")") { par--; if (!par) { k++; break; } } }
  /* 그 뒤로 **짝이 맞는 `{ … }` 덩어리**를 차례로 모은다 — 반환 타입의 것과 몸통의 것이 섞여 있다.
     🔴 고르는 법은 단순하다: **제일 멀리 닫히는 덩어리가 몸통**이다(반환 타입은 한 줄 안에서 닫힌다). */
  /* 🔴 **이웃한 덩어리만** 줍는다 — 첫 판은 함수 끝에서 안 멈춰 **다음 함수의 몸통까지** 주웠고,
     «제일 큰 것»을 고르다 보니 엉뚱한 함수를 몸통이라 했다(자가 통째로 빨개졌다).
     사이에 낀 글자가 **타입에 나올 법한 것**(`: | & 이름 [] <> , . ( ) ' "` 과 공백)일 때만 이어 붙인다. */
  const groups = [];
  let cur = k;
  /* 🔴 **최대 둘**이다 — 반환 타입 덩어리 + 몸통. 셋째부터는 **다음 선언**이다.
     첫 판은 넷까지 줍고 «제일 큰 것»을 골랐는데, 사이 글자가 `export interface ScriptInput` 이어도
     `\w` 가 허용해서 **그 인터페이스 몸통**을 «함수 몸통»이라 했다(길이 1167 · 자가 통째로 빨개졌다).
     ⇒ 개수를 둘로 막고, 사이에 **선언 키워드**가 끼면 거기서 끊는다. */
  while (groups.length < 2) {
    const nxt = src.indexOf("{", cur);
    if (nxt < 0) break;
    const gap = src.slice(cur, nxt);
    if (/\b(export|function|interface|type|const|let|class|enum)\b/.test(gap)) break;
    if (!/^[\s:|&\w[\]<>,.()'"?=-]*$/.test(gap)) break;                  // 진짜 코드가 끼면 함수 signature 가 끝난 것
    let d = 0, end = -1;
    for (let m = nxt; m < src.length; m++) { if (src[m] === "{") d++; else if (src[m] === "}") { d--; if (!d) { end = m; break; } } }
    if (end < 0) break;
    groups.push([nxt, end]); cur = end + 1;
  }
  if (!groups.length) return "";
  const [open, close] = groups.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  return src.slice(open, close + 1);
}
const gateBody = bodyOf(scriptTs, "checkScriptGates");
if (!gateBody) fails.push("🔴 `checkScriptGates` 의 몸통을 못 찾았다 — 이 자를 고쳐라(조용히 통과시키지 않는다).");
const found = axes.filter((a) => a.re.test(gateBody)).map((a) => a.key);
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
