/**
 * scripts/verify-onboarding-resume.mjs — 🔴 «온보딩을 나갔다 오면 이어지나» (수리 ④ · 2026-09-19).
 *
 *   왜 생겼나: 2화면에서 채널을 고르다 나가면 **고른 게 전부 날아갔다**(시나리오 A §5).
 *   마지막 «시작하기» 를 누르기 전까지 아무 데도 안 적혔기 때문이다 — 폰에서 전화 한 통이면 처음부터였다.
 *
 *   🔴 **이 자는 자기가 무엇을 세는지 말한다.**
 *
 *   무엇을 세나(`public/onboarding.html` 한 파일 · 주석 걷어내고):
 *     ① 초안을 적는 자리(`draftSave`)가 **고르는 곳마다** 붙어 있나 — 종류 고르기 · 채널 고르기 · 다음 · 이전
 *     ② 열 때 **이어받는** 자리(`draftLoad` → `applyPicked`)가 있나
 *     ③ 끝내면 **버리는** 자리(`draftClear`)가 있나 — 안 버리면 다음 손님이 남의 선택을 본다
 *     ④ localStorage 를 **try/catch 로 감쌌나** — 사생활 보호 창에서 던지면 온보딩이 통째로 죽는다
 *     ⑤ 중간 값을 **서버에 쓰지 않나** — 끝나기 전 값이 편성에 새면 안 된다
 *
 *   쓰기: node scripts/verify-onboarding-resume.mjs
 */
import { readFileSync } from "node:fs";

const F = "public/onboarding.html";
const fails = [];
const notes = [];

/* 주석은 코드가 아니다 — 주석에 적힌 이름을 증거로 읽으면 «말만 하고 안 고친» 것을 통과시킨다(AC-59). */
const src = readFileSync(F, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));

const count = (re) => (src.match(re) || []).length;

/* ── ① 고르는 곳마다 적나 ── */
const HOOKS = [
  { 이름: "종류 고르기(#s1 .choice)", re: /#s1 \.choice[\s\S]{0,260}?draftSave\(\)/ },
  { 이름: "채널 고르기(#cg .cgi)", re: /#cg \.cgi[\s\S]{0,260}?draftSave\(\)/ },
  { 이름: "«다음»으로 넘어갈 때", re: /step\+\+;\s*show\(\);\s*draftSave\(\)/ },
  { 이름: "«이전»으로 돌아갈 때", re: /step--;\s*show\(\);\s*draftSave\(\)/ },
];
for (const h of HOOKS) {
  const ok = h.re.test(src);
  notes.push(`센 것: **${h.이름}** 뒤에 \`draftSave()\` 가 붙어 있나 = ${ok}`);
  if (!ok) fails.push(`🔴 **${h.이름}** 에서 초안을 안 적는다 — 거기서 나가면 그 선택이 날아간다.`);
}
notes.push(`센 것: \`draftSave()\` 를 부르는 자리 모두 = ${count(/draftSave\(\)/g)}곳(정의 1 + 부르는 곳)`);

/* ── ② 이어받나 ── */
const loads = /draftLoad\(\)/.test(src);
const applies = /applyPicked\(d\.kinds, d\.channels\)/.test(src);
const stepBack = /step = d\.step/.test(src);
notes.push(`센 것: 열 때 초안을 읽나 = ${loads} · 고른 것을 되살리나 = ${applies} · **화면 번호까지** 되살리나 = ${stepBack}`);
if (!loads || !applies) fails.push("🔴 초안을 읽어 되살리는 자리가 없다 — 적어만 두고 안 쓰면 없는 것과 같다.");
if (!stepBack) fails.push("🔴 화면 번호(`step`)를 안 되살린다 — 고른 건 남아도 **1화면부터** 다시 시작하게 된다.");

const serverFallback = /tenant-settings[\s\S]{0,200}?applyPicked/.test(src);
notes.push(`센 것: 초안이 없을 때 **서버에 저장된 값**으로 서나 = ${serverFallback}`);
if (!serverFallback) fails.push("🔴 초안이 없으면 서버 값도 안 읽는다 — 온보딩을 끝냈던 손님이 다시 오면 처음부터가 된다.");

/* ── ③ 끝나면 버리나 ── */
const cleared = /onboarding[\s\S]{0,400}?draftClear\(\)/.test(src);
notes.push(`센 것: 저장에 성공한 뒤 초안을 버리나 = ${cleared}`);
if (!cleared) fails.push("🔴 온보딩을 끝내고도 초안이 남는다 — 다음에 열면 이미 끝난 것을 또 고르게 된다.");

/* ── ④ localStorage 를 감쌌나 ── */
/* 🔴 «앞 200자에 try 가 있나»로 보면 **옆 함수의 try 를 제 것으로 읽는다** — 처음 이렇게 썼다가
   `draftClear` 에서 try 를 뗀 변이에 안 울었다(AC-108 로 잡았다).
   ⇒ **그 호출을 감싼 함수의 머리부터** 훑는다(가장 가까운 `=> {` / `function` 뒤). */
const lsHits = [...src.matchAll(/localStorage\.\w+\(/g)];
const unguarded = [];
for (const m of lsHits) {
  const i = m.index;
  const fnStart = Math.max(src.lastIndexOf("=> {", i), src.lastIndexOf("function", i));
  if (!/try\s*\{/.test(src.slice(Math.max(0, fnStart), i))) {
    unguarded.push(`${src.slice(0, i).split(/\n/).length}줄 ${m[0]}…`);
  }
}
notes.push(`센 것: \`localStorage\` 를 만지는 자리 ${lsHits.length}곳 · 그중 **자기 함수 안에 \`try\` 가 없는** 자리 ${unguarded.length}곳`);
if (unguarded.length) fails.push(`🔴 \`localStorage\` 를 감싸지 않은 자리가 있다(${unguarded.join(" · ")}) — 사생활 보호 창·차단 설정에서 **온보딩이 통째로 죽는다**.`);
if (!lsHits.length) fails.push("🔴 `localStorage` 를 한 번도 안 쓴다 — 초안을 어디에도 안 적고 있다(양성 대조 실패).");

/* ── ⑤ 중간 값을 서버에 쓰지 않나 ── */
const posts = [...src.matchAll(/UI\.api\("\/api\/([a-z-]+)"[^)]*body/g)].map((m) => m[1]);
notes.push(`센 것: 이 화면이 **서버에 쓰는** 곳 = [${[...new Set(posts)].join(", ") || "없음"}]`);
const strayWrite = posts.filter((p) => p !== "onboarding" && p !== "auth-verify-resend");
if (strayWrite.length) fails.push(`🔴 온보딩 도중에 서버로 쓰는 곳이 있다(${strayWrite.join(", ")}) — 끝나기 전 값이 편성에 샌다.`);

/* ── 보고 ── */
console.log("온보딩이 나갔다 와도 이어지나(수리 ④ · AC 시나리오 A §5) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** (안 적으면 초록이 거짓말을 한다)");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 고를 때마다 적고, 열 때 이어받고, 끝나면 버리고, 못 적어도 안 죽는다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
