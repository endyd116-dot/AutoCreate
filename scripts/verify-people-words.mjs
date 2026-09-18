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
const BAD_WORDS = ["계약 폭", "테넌트", "러너 잡", "러너 job", "piece 를", "piece 가", "slot 을", "gate_report"];
const CUSTOMER_FILES = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/\bops\b/.test(p)) walk(p); } else if (/\.(html|txt)$/.test(f)) CUSTOMER_FILES.push(p); } };
walk("public");
const wordHits = [];
for (const p of CUSTOMER_FILES) {
  const src = decomment(readFileSync(p, "utf8"));
  for (const w of BAD_WORDS) if (src.includes(w)) wordHits.push(`${p.replace(/\\/g, "/")} → «${w}»`);
}
/* 서버가 만드는 라벨도 손님 화면에 그대로 간다(AC-52) */
for (const p of ["lib/ai-tell-gate.ts", "lib/produce-window.ts"]) {
  const src = decomment(readFileSync(p, "utf8"));
  for (const w of BAD_WORDS) if (src.includes(`"${w}`) || src.includes(`${w} 안"`)) wordHits.push(`${p} → «${w}»`);
}
notes.push(`센 것: 손님 화면(public/** · 운영센터 제외 ${CUSTOMER_FILES.length}개) + 서버 라벨 2개에서 시스템 용어 [${BAD_WORDS.join(", ")}] = ${wordHits.length}곳`);
if (wordHits.length) fails.push(`🔴 손님 화면에 시스템 용어가 있다(§3): ${wordHits.join(" · ")}`);

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
notes.push(`센 것: 홈 «해야 할 일»이 걸린 검사에 \`GATE_FAIL_LABEL\` 을 쓰나 = ${usesFail}`);
if (!usesFail) fails.push("🔴 홈이 걸린 검사를 통과 이름으로 적고 있다 — «분량이 알맞음 · 채널 시각 요소 충족 — 막지는 않았어요»가 위험처럼 뜬다.");

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
