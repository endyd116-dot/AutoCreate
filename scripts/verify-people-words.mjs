/**
 * scripts/verify-people-words.mjs — 🔴 «손님 화면에 **우리 말**이 새어 나가나» (수리 ⑤ · 2026-09-19).
 *
 *   시나리오 A 가 모은 «말이 이상한 데» 10 개 중 **자가 지킬 수 있는 것**을 여기서 지킨다.
 *     ① 영어 칸 이름 — «password: 8자 이상»
 *     ② 영어 문장 통째 — «t: String must contain at least 10 character(s)»
 *     ③ 시스템 용어 — «계약 폭» 같은 내부 말
 *     ④ 통과 이름으로 실패를 말하기 — 홈 위험 목록이 «분량이 알맞음»을 위험으로 실었다
 *     ⑤ 겁주는 말(§3) — «정지됩니다» · «불이익» · «알려만»
 *     ⑥ 남은 날을 두 자로 세기 — «31일»과 «30일»이 같이 떴다
 *
 *   🔴 **이 자는 자기가 무엇을 셌는지 말한다.**
 *
 *   쓰기: node scripts/verify-people-words.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const fails = [];
const notes = [];
const decomment = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  /* 🔴 [2026-09-20 · B] **HTML 주석도 걷는다.** 안 걷으면 `register.html` 의 `<!-- … 계약 §3.2 -->` 가
     «손님 화면의 시스템 용어»로 잡힌다 — 거짓 빨강이다. 이 자는 `.html` 을 세면서 정작 HTML 주석을 못 걷고 있었다
     (옆 자 `verify-script-issues-shown` 은 처음부터 걷는다 — **같은 일을 하는 자끼리 갈라져 있었다**). */
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));

/* ── ① · ② 손님에게 나가는 오류 문구를 만드는 자리 ── */
const val = decomment(readFileSync("lib/validate.ts", "utf8"));
const rawPath = /\$\{i\.path\.join\("\."\)[^}]*\}: \$\{i\.message\}/.test(val);
notes.push(`센 것: \`lib/validate.ts firstIssue\` 가 zod 의 **칸 경로(영어)** 를 그대로 붙이나 = ${rawPath}`);
if (rawPath) fails.push("🔴 `firstIssue` 가 영어 칸 이름을 손님에게 그대로 보여 준다(«password: 8자 이상») — 사람말 표로 옮겨라.");

for (const need of ["FIELD_SAY", "TOKEN_FIELDS", "humanize"]) {
  const has = new RegExp("\\b" + need + "\\b").test(val);
  notes.push(`센 것: \`lib/validate.ts\` 에 \`${need}\` 가 있나 = ${has}`);
  if (!has) fails.push(`🔴 \`${need}\` 가 없다 — 영어가 그대로 새 나가는 길이 다시 열린다.`);
}
const englishOut = /return label \? `\$\{label\}: \$\{msg\}` : msg;/.test(val) && !/\^\[\\x20-\\x7E\]\+\$/.test(val);
notes.push(`센 것: 아직 못 옮긴 **영어 메시지**를 내보내지 않게 막았나 = ${!englishOut}`);
if (englishOut) fails.push("🔴 영어 메시지를 그대로 내보내는 길이 열려 있다 — «String must contain at least…» 가 손님 화면에 뜬다.");

/* ── ③ 시스템 용어 — 손님 화면에 나가는 문자열에 있으면 안 되는 말 ── */
/* 🔴 **한국어 시스템 용어만** 센다. `piece`·`payload`·`undefined` 같은 영어는 **코드 이름과 구별할 수 없다**
   (`piece.html` · `pieceId` · JS 의 `undefined` 가 전부 걸린다 — 처음 이 자를 냈을 때 16곳이 헛 울었다).
   ⇒ 영어 식별자는 이 자가 **못 잰다.** 그건 화면을 띄워서 보는 수밖에 없다(시나리오 걷기가 하는 일). */
/* 🔴 [2026-09-20 · B] **«계약 폭» 만 막았더니 «계약 하한»이 샜다** — 손님 화면에 «2자 — 계약 하한 1,500자에…» 가 떴다.
   낱말이 아니라 **«계약» 자체가 내부 말**이다(§3). 뒤에 무엇이 붙든 같다 ⇒ «계약 » 으로 넓힌다.
   🔴 넓혀도 안전하다: 이 자는 **주석을 걷고** 센다. `public/**` 의 «계약»은 전부 주석이고(실측), 남는 것은 손님이 읽는 문자열뿐이다. */
const BAD_WORDS = ["계약 ", "테넌트", "러너 잡", "러너 job", "piece 를", "piece 가", "slot 을", "gate_report"];
/* 🔴 [2026-09-19] **`public/**` 이라 적어 놓고 `.html`·`.txt` 만 셌다** — `public/js/mock.js`·`ui.js` 를 아예 안 봤다.
   그래서 «계약 폭»을 서버에서 고치고도 **화면 사본이 옛말인 것**을 놓쳤다(기존 자 `verify-label-surface` 가 잡았다).
   🔴 손님이 보는 글자는 **`.js` 안에 더 많다**(모의·공용 층이 문장을 만든다). 확장자를 늘리고, 아래 note 에 **무엇을 셌는지 그대로 적는다.** */
const EXT = /\.(html|txt|js)$/;
const CUSTOMER_FILES = [];
/* 🔴 운영센터는 뺀다 — **폴더(`public/ops/`)만이 아니라 파일 이름(`ops.js`·`mock-ops.js`)까지** 본다.
   §13.0b «운영 콘솔 예외» — «테넌트» 같은 말은 **운영자에게는 맞는 말**이다. 폴더만 보다가 `public/js/mock-ops.js` 에서 헛 울었다. */
const isOps = (p) => /(^|[\\/])ops([\\/]|[-.])/.test(p) || /[\\/]mock-ops\./.test(p);
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!isOps(p + "/")) walk(p); } else if (EXT.test(f) && !isOps(p)) CUSTOMER_FILES.push(p); } };
walk("public");
const wordHits = [];
for (const p of CUSTOMER_FILES) {
  const src = decomment(readFileSync(p, "utf8"));
  for (const w of BAD_WORDS) if (src.includes(w)) wordHits.push(`${p.replace(/\\/g, "/")} → «${w}»`);
}
/* 서버가 만드는 라벨도 손님 화면에 그대로 간다(AC-52)
   🔴 [2026-09-20 · B 가 더했다] `lib/video/script.ts` 를 넣는다 — **대본 검사 문장이 검수 화면 칩이 됐다.**
      실제로 «문장 수 3(**계약** 4~8)» 이 손님 화면에 떴다. 9/19 에 `ai-tell-gate` 의 «계약 폭»을 고친 그 낱말이
      🔴 **다른 문에서 또 샜다** — 그때 이 목록에 «서버 라벨 두 개»만 적어 둔 것이 좁았던 것이다.
      ⇒ 말을 먼저 고치고(같은 커밋) **그 다음 이 줄을 넣었다.** 그래서 `pending-red` 에 올릴 것이 없다(들어오자마자 초록).
   🔴 이 목록은 «손님이 그대로 읽는 서버 문장»을 담는다 — 새 자리가 생기면 **여기 한 줄**이다. */
for (const p of ["lib/ai-tell-gate.ts", "lib/produce-window.ts", "lib/video/script.ts"]) {
  const src = decomment(readFileSync(p, "utf8"));
  /* 🔴 [2026-09-20] 문자열 **첫머리**만 보던 것을 **아무 데나**로 바꿨다 — «— 계약 하한 …» 처럼 문장 가운데 있으면 못 봤다.
     주석은 이미 걷었으니 여기 남은 한글은 사실상 손님이 읽는 문자열이다. */
  for (const w of BAD_WORDS) if (src.includes(w)) wordHits.push(`${p} → «${w.trim()}»`);
}
/* 🔴 [2026-09-20] **대본 검사 문구도 손님 화면에 그대로 간다** — 2026-09-20 에 A 가 `meta.scriptIssues` 를 칩 줄로 그리기 시작하면서
   `lib/video/script.ts` 의 문장이 **처음으로 손님 눈에 닿았다.** 거기 «(계약 4~8)» 이 있다 — «계약»은 우리 내부 말이다(§3).
   9/19 에 `GATE_LABEL` 의 «분량이 계약 폭 안»을 고친 것과 **같은 낱말**이다.
   🔴 화면이 고쳐 쓰지 않는다(AC-52 — 두 곳이 갈라진다). 서버 문자열이 바뀌어야 하고 그건 B 몫이다.
   ⇒ **지금 넣고 빨간 채로 둔다**(메인 지시 2026-09-20). «B 가 고친 뒤에 넣자»가 잊히는 길이다.
      «기다리는 빨강»은 `docs/rules/pending-red.json` 에 등록했다 — B 가 고치면 그 줄을 지운다. */
{
  const p = "lib/video/script.ts";
  const src = decomment(readFileSync(p, "utf8"));
  /* 손님에게 나가는 문장(`issues.push(…)`)만 본다 — 변수명·타입에 든 «계약»까지 세면 헛 운다. */
  for (const m of src.matchAll(/issues\.push\(([^\n]*)\)/g)) {
    if (/계약/.test(m[1])) wordHits.push(`${p} → «계약»(손님 칩으로 나간다: ${m[1].trim().slice(0, 60)})`);
  }
}
notes.push(`센 것: 손님 화면 ${CUSTOMER_FILES.length}개(\`public/**\` 의 .html·.txt·**.js** · 운영센터 제외) + 서버 라벨 2개 + **대본 검사 문구**(lib/video/script.ts 의 \`issues.push\`) 에서 시스템 용어 [${BAD_WORDS.join(", ")}, 계약] = ${wordHits.length}곳`);
if (wordHits.length) fails.push(`🔴 손님 화면에 시스템 용어가 있다(§3): ${wordHits.join(" · ")}`);

/* ── ③-b 🔴 **서버에서 고친 낱말이 화면 사본에도 갔나** ──
   이 자가 처음에 놓친 자리다. «계약 폭»을 `lib/ai-tell-gate.ts` 에서만 고치고 `public/js/mock.js` 사본은 옛말이었다 —
   그런데 **손님 화면에 뜨는 건 모의 쪽**이라 고친 값이 0에 가까웠다(메인 지적 2026-09-19).
   🔴 라벨 전수 대조는 `scripts/verify-label-surface.mjs` 가 한다. 여기서는 **이 라운드에서 바꾼 낱말**만 못 박는다. */
const RENAMED = [
  { 옛말: "분량이 계약 폭 안", 새말: "분량이 알맞음", 어디: "글 검사 라벨" },
];
const staleCopies = [];
for (const r of RENAMED) {
  for (const p of CUSTOMER_FILES) {
    const src = decomment(readFileSync(p, "utf8"));
    if (src.includes(r.옛말)) staleCopies.push(`${p.replace(/\\/g, "/")} → «${r.옛말}»(새말 «${r.새말}»)`);
  }
}
notes.push(`센 것: 이 라운드에서 바꾼 낱말 ${RENAMED.length}개의 **옛말이 화면 사본에 남아 있나** = ${staleCopies.length}곳`);
if (staleCopies.length) fails.push(`🔴 서버만 고치고 화면 사본이 옛말이다 — 손님이 보는 건 이쪽이다: ${staleCopies.join(" · ")}`);

/* ── ④ 걸린 검사를 «통과 이름»으로 말하지 않나 ── */
const gate = decomment(readFileSync("lib/ai-tell-gate.ts", "utf8"));
const hasFailLabel = /export const GATE_FAIL_LABEL/.test(gate);
notes.push(`센 것: \`GATE_FAIL_LABEL\`(걸렸을 때의 말)이 있나 = ${hasFailLabel}`);
if (!hasFailLabel) fails.push("🔴 `GATE_FAIL_LABEL` 이 없다 — 걸린 검사를 통과 이름으로 말하게 된다(«분량이 알맞음»이 위험 목록에 실린다).");
else {
  /* 🔴 `^\s*([a-z_]+):` 로 세면 **한 줄에 여럿 적힌 검사를 놓친다**(18개 중 9개만 셌다 · 손으로 대조해서 잡았다).
     자가 덜 세면 «빠진 것 0개»라고 말하면서 절반을 안 본다 — 초록이 거짓말하는 바로 그 모양이다. */
  const okKeys = [...(gate.match(/export const GATE_LABEL[\s\S]*?\n\};/) || [""])[0].matchAll(/([a-z_]+):\s*"/g)].map((m) => m[1]);
  const failKeys = [...(gate.match(/export const GATE_FAIL_LABEL[\s\S]*?\n\};/) || [""])[0].matchAll(/([a-z_]+):\s*"/g)].map((m) => m[1]);
  const missing = okKeys.filter((k) => !failKeys.includes(k));
  notes.push(`센 것: 검사 ${okKeys.length}개 중 «걸렸을 때의 말»이 빠진 것 = ${missing.length}개 [${missing.join(", ") || "없음"}]`);
  if (missing.length) fails.push(`🔴 «걸렸을 때의 말»이 없는 검사가 있다: ${missing.join(", ")} — 그 검사는 통과 이름으로 위험 목록에 실린다.`);
}
const home = decomment(readFileSync("netlify/functions/home-summary.ts", "utf8"));
const usesFail = /GATE_FAIL_LABEL\[String\(r\.key\)/.test(home);
notes.push(`센 것: **서버** 홈이 걸린 검사에 \`GATE_FAIL_LABEL\` 을 쓰나 = ${usesFail}`);
if (!usesFail) fails.push("🔴 홈이 걸린 검사를 통과 이름으로 적고 있다 — «분량이 알맞음 · 채널 시각 요소 충족 — 막지는 않았어요»가 위험처럼 뜬다.");

/* 🔴 **모의도 같이 본다.** 서버만 고치고 모의를 안 고치면 **손님 화면에 뜨는 건 모의 쪽**이다(메인 지적 2026-09-19).
   변이로 확인했다 — 모의를 되돌렸을 때 이 자가 안 울어서 이 줄을 더했다. */
const mock = decomment(readFileSync("public/js/mock.js", "utf8"));
const mockHasMap = /GATE_FAIL_SAY\s*=\s*\{/.test(mock);
const mockUsesFail = /GATE_FAIL_SAY\[c\.key\]/.test(mock);
notes.push(`센 것: **모의**(public/js/mock.js)에 \`GATE_FAIL_SAY\` 표가 있나 = ${mockHasMap} · 위험을 셀 때 그걸 쓰나 = ${mockUsesFail}`);
if (!mockHasMap) fails.push("🔴 모의에 `GATE_FAIL_SAY` 가 없다 — 모의 화면은 걸린 검사를 통과 이름으로 말하게 된다.");
if (!mockUsesFail) fails.push("🔴 모의가 위험 사유를 `c.label`(통과 이름)로 세고 있다 — 서버만 고치고 화면 사본을 안 고친 모양이다.");
if (mockHasMap) {
  /* 두 표가 글자까지 같은가 — 갈라지면 화면과 서버가 딴말을 한다(AC-52). 전수 대조는 `verify-label-surface` 도 하지만, 여기서도 못 박는다. */
  const srvSeg = (gate.match(/export const GATE_FAIL_LABEL[\s\S]*?\n\};/) || [""])[0];
  const mockSeg = (mock.match(/GATE_FAIL_SAY\s*=\s*\{[\s\S]*?\n\s*\};/) || [""])[0];
  const pick = (s) => new Map([...s.matchAll(/([a-z_]+):\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const a = pick(srvSeg), b = pick(mockSeg);
  const diff = [...a].filter(([k, v]) => b.has(k) && b.get(k) !== v).map(([k, v]) => `${k}: 모의 «${b.get(k)}» ≠ 서버 «${v}»`);
  const gone = [...a.keys()].filter((k) => !b.has(k));
  notes.push(`센 것: 서버 \`GATE_FAIL_LABEL\` ${a.size}개 ↔ 모의 \`GATE_FAIL_SAY\` ${b.size}개 — 글자가 다른 것 ${diff.length}개 · 모의에 빠진 것 ${gone.length}개`);
  if (diff.length) fails.push(`🔴 걸렸을 때의 말이 서버와 모의에서 다르다: ${diff.join(" · ")}`);
  if (gone.length) fails.push(`🔴 모의에 빠진 «걸렸을 때의 말»: ${gone.join(", ")}`);
}

/* ── ⑤ 겁주는 말(§3) ── */
const SCARY = ["정지됩니다", "불이익", "알려만 드립니다", "알려만 드렸", "고객님 책임", "책임지지 않습니다"];
/* 🔴 **약관·개인정보 처리방침·자동 발행 안내는 뺀다.** 거기 «책임지지 않습니다»는 법률 문서의 말이고,
   §3 가 금지한 것은 **제품 화면**에서 겁주거나 발 빼는 말이다. 법 문서를 §3 로 재면 자가 매번 헛 운다. */
const LEGAL = ["terms.html", "paid-terms.html", "privacy.html", "automation-notice.html"];
const scaryFiles = CUSTOMER_FILES.filter((p) => !LEGAL.some((l) => p.endsWith(l)));
const scaryHits = [];
for (const p of scaryFiles) {
  const src = decomment(readFileSync(p, "utf8"));
  for (const w of SCARY) if (src.includes(w)) scaryHits.push(`${p.replace(/\\/g, "/")} → «${w}»`);
}
notes.push(`센 것: 제품 화면 ${scaryFiles.length}개(법 문서 ${LEGAL.length}개는 뺐다)에서 겁주는 말 [${SCARY.join(", ")}] = ${scaryHits.length}곳`);
if (scaryHits.length) fails.push(`🔴 겁주거나 발 빼는 말이 있다(§3): ${scaryHits.join(" · ")}`);

/* ── ⑥ 남은 날을 세는 자가 하나인가 ── */
const dayCounters = [];
for (const p of ["lib/account-close.ts", "lib/guards.ts"]) {
  const src = decomment(readFileSync(p, "utf8"));
  /* 🔴 `[^)]*` 는 **중첩 괄호를 못 넘는다** — `Math.ceil((a.getTime() - b) / 86400_000)` 를 놓친다.
     이 라운드에서 같은 실수를 **세 번** 했다(글자수 자 · 이 자 · 그 전에 한 번). 괄호를 세지 말고 **한 줄 안에서** 찾는다. */
  if (/Math\.ceil\([^;\n]*86400/.test(src)) dayCounters.push(p);
}
notes.push(`센 것: «며칠 남았나»를 밀리초로 **직접** 올림하는 자리 = ${dayCounters.length}곳 [${dayCounters.join(", ") || "없음"}]`);
if (dayCounters.length) fails.push(`🔴 «남은 날»을 밀리초로 세는 자리가 있다(${dayCounters.join(", ")}) — 밀리초 하나 차이로 «31일»과 «30일»이 같이 뜬다. \`daysLeftKst\` 를 써라.`);
const util = decomment(readFileSync("lib/db-util.ts", "utf8"));
notes.push(`센 것: \`daysLeftKst\`(KST 날짜로 세는 자)가 \`lib/db-util.ts\` 에 있나 = ${/export function daysLeftKst/.test(util)}`);
if (!/export function daysLeftKst/.test(util)) fails.push("🔴 `daysLeftKst` 가 없다 — 화면마다 제 나름대로 세게 된다.");

/* ── ⑦ 한국어 문장에 «AM/PM» 이 섞이지 않나 ── */
const slots = decomment(readFileSync("lib/slots.ts", "utf8"));
const localeAmPm = /Intl\.DateTimeFormat\("ko-KR",[^)]*hour:\s*"numeric"/.test(slots) && !/hour12:\s*false/.test(slots);
notes.push(`센 것: \`lib/slots.ts\` 가 \`ko-KR\` 로케일에 오전/오후를 맡기나 = ${localeAmPm} (맡기면 CLDR 이 «AM» 을 준다)`);
if (localeAmPm) fails.push("🔴 `ko-KR` 로케일에 오전/오후를 맡기고 있다 — 한국어 문장에 «오늘 AM 6:00»이 뜬다. 우리가 «오전/오후»를 적어라.");

/* ── 보고 ── */
console.log("손님 화면에 우리 말이 새어 나가나(수리 ⑤ · AC 시나리오 A «말이 이상한 데») · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** (안 적으면 초록이 거짓말을 한다)");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 영어·시스템 용어·겁주는 말이 손님 화면에 없고, 걸린 검사는 걸린 말로 말하고, 남은 날을 한 자로 센다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
