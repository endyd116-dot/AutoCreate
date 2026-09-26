/**
 * verify-keyin-notice-mutants — `verify-keyin-notice-shown.mjs` 가 **진짜 무는지** 변이로 증명한다(AC-108).
 *
 *   🔴 «자를 냈다»는 증거가 아니다. 고친 자리를 하나씩 되돌려 놓고 **자가 우는지**를 본다.
 *   맨 윗줄은 «원판» — 원판이 초록이 아니면 이 표 전체를 버린다(AC-100 ⑦).
 *
 *   🔴 **안 울면 자보다 변이를 먼저 의심한다**(AC-112) — 그래서 바뀐 줄 수를 찍고, 0줄이면 «못 바꿈»으로 적는다.
 *   🔴 `_tpl.txt` 가 정본이라 여기도 정본을 바꾸고 `build-pages` 로 생성물까지 만든다(AC-105).
 *      중간에 죽어도 원판으로 돌아가도록 finally 에서 되돌린다.
 *
 *   🔴 [R18 · C · 2026-09-26 · A 의 AC-276 을 재서 고침] **«거절하는 빌드»(AC-244)와 이 자가 서로를 막았다.**
 *      이 자는 **일부러** 정본과 생성물을 가른다(정본에서 줄을 빼고 빌드) — 새 빌드는 그걸 «생성물에만 있는 줄 · 지우면 안 된다»로 거절하고
 *      `execSync` 가 던져 **하니스가 첫 변이에서 죽었다**(C 실측: «1장은 안 썼다» → exit 1). 그리고 죽으면서 `ui.js` 판 번호를
 *      오늘로 **올려 놓은 채** 끝났다 — 진짜 빌드가 판 번호를 박기 때문이다(검사 도구가 나무를 더럽히는 병 · `verify-check-writes-nothing`).
 *   ⇒ 🔴 **거절은 풀지 않는다.** 대신 이 자가 «나는 일부러 가른다»를 **증명하고** 지나간다:
 *      ① 손대기 **전에** `build-pages --check`(이제 아무것도 안 쓴다) — 정본과 생성물이 **이미** 갈려 있으면 ⊘ 로 멈춘다.
 *         그 갈림은 남의 줄(생성물에만 있는 R17·R18 화면)일 수 있고, 아래 `--force` 가 그걸 **말없이 지운다**(AC-244 가 다시 온다).
 *      ② ①이 깨끗할 때만 `--force` — 그때 덮이는 줄은 **이 자가 방금 넣은 변이뿐**이다.
 *      ③ 되돌릴 때 **다시 빌드하지 않고 바이트 그대로** 되쓴다(정본·모의·ui.js·생성물 전부). 빌드로 되돌리면 판 번호·줄끝이 바뀐다.
 *      ④ 끝에 **나무가 처음과 한 바이트도 안 다른지** 스스로 확인한다 — 다르면 빨강(검사가 흔적을 남기면 그게 고장이다).
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const TPL = path.join(ROOT, "public", "app", "_tpl.txt");
const MOCK = path.join(ROOT, "public", "js", "mock.js");
const UIJS = path.join(ROOT, "public", "js", "ui.js");
const TPL0 = readFileSync(TPL, "utf8");
const MOCK0 = readFileSync(MOCK, "utf8");

/* ① 손대기 전에 — 정본과 생성물이 이미 같은가(아니면 --force 가 남의 줄을 지운다) */
try { execSync("node scripts/build-pages.mjs --check", { cwd: ROOT, stdio: "pipe" }); }
catch (e) {
  console.log("⊘ 못 쟀다 — 정본(_tpl.txt)과 생성물이 **이미** 갈려 있다. 변이를 넣지 않는다(아무 파일도 안 건드렸다).");
  console.log("   이 자는 빌드를 --force 로 돌리는데, 지금 갈린 줄은 **남의 작업**일 수 있어서 말없이 지워진다(AC-244).");
  console.log("   `node scripts/build-pages.mjs --check` 로 무엇이 갈렸나 먼저 보고, 정본에 옮긴 뒤 다시 돌려라.");
  process.exit(2);
}
/* ③ 되돌릴 것 — 이 자가 건드릴 수 있는 파일 전부의 **바이트** */
const SNAP = new Map([TPL, MOCK, UIJS, ...readdirSync(path.join(ROOT, "public", "app")).filter((f) => f.endsWith(".html")).map((f) => path.join(ROOT, "public", "app", f))]
  .map((p) => [p, readFileSync(p)]));

const MUTANTS = [
  { name: "원판(아무것도 안 바꿈)", expect: "초록" },

  { name: "시트에서 안내 줄을 뺀다 → ③ 이 «안 그려졌다»로 울어야 한다",
    file: TPL, from: "${keyinNote(K)}<div class=\"cta\">", to: "<div class=\"cta\">", expect: "빨강" },

  { name: "가드를 고치기 전으로 되돌린다 → 시트 자체가 안 열려 ③ 이 울어야 한다",
    file: TPL, from: "if (!K || (!K.available && !K.notice)) return startCard();", to: "if (!K || !K.available) return startCard();", expect: "빨강" },

  { name: "안내를 «고를 수 있을 때만» 그리게 한다 → available:false 라 사라져 ③ 이 울어야 한다",
    file: TPL, from: "const keyinNote = (K) => K && K.notice ?", to: "const keyinNote = (K) => K && K.notice && K.available ?", expect: "빨강" },

  /* 🔴 [2026-09-21] «#keyin 널 가드를 뗀다»(옛 ㉤)는 **더 이상 심을 자리가 없다** — 메인 지시로 카드 등록 쪽의
     체크박스·payRoute 보내기를 통째로 지웠다(읽는 자리 자체가 없으니 가드할 것도 없다).
     그 자리를 **덫이 돌아오는 변이**로 갈아 끼운다 — 지운 것이 되살아나는 것이 이제 진짜 위험이다. */
  { name: "🔴 카드 등록 쪽에 payRoute 보내기를 되살린다 → ⑥ 이 «물어 놓고 버린다»로 울어야 한다",
    file: TPL, from: "sh.querySelector(\"#go\").onclick = () => { close(); startCard(); };", to: "sh.querySelector(\"#go\").onclick = () => { const body = {}; const kc = sh.querySelector(\"#keyin\"); if (kc && kc.checked) body.payRoute = \"keyin\"; close(); startCard(body); };", expect: "빨강" },

  { name: "🔴 빈 몸통을 다시 변수로 감춘다 → ⑥-b 가 «글자로 안 적었다»로 울어야 한다",
    file: TPL, from: "async function startCard() { const r = await UI.api(\"/api/billing-key-start\", { body: {} });", to: "async function startCard(body) { const r = await UI.api(\"/api/billing-key-start\", { body });", expect: "빨강" },

  { name: "🔴 대조군 — 코인 쪽 payRoute 까지 같이 지운다 → ⑥ 대조군이 «거긴 고를 수 있다»로 울어야 한다",
    file: TPL, from: "const keyinBody = (sh, body) => { const el = sh.querySelector(\"#keyin\"); if (el && el.checked) body.payRoute = \"keyin\"; return body; };", to: "const keyinBody = (sh, body) => body;", expect: "빨강" },

  { name: "모의 문장을 한 글자 바꾼다 → ② 가 «서버와 다르다»로 울어야 한다",
    file: MOCK, from: "카드 등록은 카드사 인증 창으로 열려요.", to: "카드 등록은 카드사 인증 창으로 열립니다.", expect: "빨강" },

  { name: "모의를 코인용 모양으로 되돌린다 → ② 가 «모양이 다르다»로 울어야 한다",
    file: MOCK, from: "o.keyin = keyinForBillingKey();", to: "o.keyin = keyinOption();", expect: "빨강" },
];

const orig = (f) => (f === TPL ? TPL0 : MOCK0);
/* ③ 바이트 그대로 되쓴다 — 빌드로 되돌리지 않는다(판 번호·줄끝이 바뀐다) */
const restore = () => { for (const [p, b] of SNAP) writeFileSync(p, b); };
/* ② «나는 일부러 가른다» — ①이 깨끗했으니 --force 가 덮는 것은 이 자가 방금 넣은 변이뿐이다 */
const build = () => execSync("node scripts/build-pages.mjs --force", { cwd: ROOT, stdio: "pipe" });

/** 바뀐 줄 수 — 0이면 변이가 안 닿은 것이다(AC-112) */
const changedLines = (a, b) => {
  const A = a.split("\n"), B = b.split("\n");
  let n = 0;
  for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) n++;
  return n;
};

const rows = [];
try {
  for (const m of MUTANTS) {
    let changed = 0;
    if (m.file) {
      const src = orig(m.file);
      if (!src.includes(m.from)) { rows.push({ ...m, got: "못 바꿈", ok: false, changed: 0, note: "🔴 바꿀 자리를 못 찾았다 — **변이가 무의미하다**(자 탓이 아니다)" }); continue; }
      const next = src.replace(m.from, m.to);          // from 은 글자 그대로 · to 에 $ 가 없다(AC-15)
      changed = changedLines(src, next);
      writeFileSync(TPL, TPL0); writeFileSync(MOCK, MOCK0);
      writeFileSync(m.file, next);
    } else { writeFileSync(TPL, TPL0); writeFileSync(MOCK, MOCK0); }
    build();

    if (m.file && changed === 0) { rows.push({ ...m, got: "0줄 바뀜", ok: false, changed, note: "🔴 파일이 안 바뀌었다 — **변이를 먼저 의심하라**(AC-112)" }); continue; }

    let code = 0;
    try { execSync("node scripts/verify-keyin-notice-shown.mjs", { cwd: ROOT, stdio: "pipe" }); }
    catch (e) { code = e.status ?? 1; }
    const got = code === 0 ? "초록" : code === 2 ? "⊘ 못 쟀다" : "빨강";
    rows.push({ ...m, got, changed, ok: got === m.expect });
  }
} finally { restore(); }

/* ④ 나무가 처음과 한 바이트도 안 다른가 — 검사가 흔적을 남기면 그게 고장이다 */
const dirty = [...SNAP].filter(([p, b]) => !readFileSync(p).equals(b)).map(([p]) => path.relative(ROOT, p));
if (dirty.length) { console.log(`🔴 되돌렸는데 처음과 다른 파일 ${dirty.length}개: ${dirty.join(", ")} — 이 자가 나무를 더럽혔다`); process.exit(1); }

console.log("🔴 verify-keyin-notice-shown 변이 시험 — «자가 진짜 무는가»");
console.log("─".repeat(104));
let bad = 0;
for (const r of rows) {
  const mark = r.ok ? "✓" : "✗";
  if (!r.ok) bad++;
  console.log(`${mark} ${r.name}`);
  console.log(`     기대=${r.expect} · 나옴=${r.got}${r.file ? ` · 바뀐 줄=${r.changed}` : ""}${r.note ? ` · ${r.note}` : ""}`);
}
console.log("─".repeat(104));
console.log(`🔴 이 표가 **무엇을 셌나** — 변이 ${MUTANTS.length}개(원판 1 + 빨개져야 하는 것 ${MUTANTS.length - 1}) · 각각 정본(_tpl.txt·mock.js)을 한 자리만 바꾸고 build-pages 까지 돌린 뒤 자를 부른다`);
console.log("🔴 이 표가 **못 재는 것** — 여기 없는 고장. 변이표는 «내가 생각한 고장»만 잰다.");
if (bad) { console.log(`\n🔴 ${bad}건이 기대와 다르다`); process.exit(1); }
console.log("\n✅ 변이 전부 기대대로 — 이 자는 문다");
process.exit(0);
