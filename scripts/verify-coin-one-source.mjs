/**
 * scripts/verify-coin-one-source.mjs — 🔴 **코인 값이 한 벌인가 · 컷 수가 한 곳인가**(B 2026-09-21)
 *
 *   ══ 왜 이 자인가 ══
 *   사장님 지시: «**모든 화면의 코인값은 변수로 지정**해서, **운영센터에서 가격 바꾸면 다 같이 바뀌어서 보일 수 있게**».
 *   그러려면 «서버가 한 값을 말한다»가 먼저다. 그런데 두 군데서 갈라져 있었다:
 *
 *   ① **단가가 두 벌이었다** — 차감은 `lib/coin-ledger.ts` → `coinCostOverlay()`(DB 오버레이)를 읽는데,
 *      고객 화면으로 나가는 `plans-list.ts` 는 `COIN_TABLE`(코드 기본값)을 그대로 내보냈다.
 *      ⇒ 운영센터가 단가를 바꾸면 **화면은 옛 값, 차감은 새 값**. 라이브 오버레이가 0행이라 **아직 안 갈렸을 뿐**이다.
 *
 *   ② 🔴 **컷 수가 두 벌이었고 한쪽이 틀렸다** — 만들 때는 계약(`shortsFormOf`)에 묻는데,
 *      원가 잴 때는 `seconds === 60 ? 9 : seconds === 30 ? 5 : 3` 이라는 **손으로 베낀 삼항**을 썼다.
 *      **90 이 거기 없어서 3컷**으로 떨어졌고, 90초 추정 원가가 60초보다 **싸게** 나왔다.
 *      🔴 표시가 아니라 **돈 관문**이 틀린 것이다 — `checkAiCostCap`·하드캡이 그 싼 값을 믿는다.
 *      고객은 손해를 안 보니 **알려 줄 수 없고**, 그래서 더 늦게 들킨다.
 *
 *   ══ 재는 것 ══
 *     ① 한 벌   — 단가를 내보내는 두 문이 **오버레이 적용값**에서 가져오나
 *     ② 실은 칸 — 디렉터·편성표·만들기가 이미 부르는 `accounts-list` 가 `coins:{table,labels}` 를 싣나
 *     ③ 한 곳   — 컷 수를 `cost.ts`·`gen.ts` 가 **같은 함수**에 묻나
 *     ④ 값      — 🔴 **실제로 돌려서** 잰다: 90 > 60 인가 · 60·30 은 그대로인가 · 0컷을 보내도 안 죽나
 *
 *   🔴 부정형 단언을 안 쓴다 — «그 삼항이 없어야 한다»로 적지 않았다(과녁이 사라지면 공짜로 참이 된다).
 *      대신 ④축이 **값으로** 잰다: 손 사본이 돌아오면 90초가 다시 싸져서 그 축이 운다.
 *
 *   `--mutants` = 제품 사본에 변이를 넣고 이 자를 다시 돌려 **내가 정말 무는지** 본다.
 *   종료코드: 0 = 한 벌이다 · 1 = 갈라져 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, symlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
/* 🔴 **주석을 걷고 본다.** 변이가 잡아 줬다 — 내가 제품 주석에 «`loadPacksAndTable()` 에서 온다»라고 적어 뒀더니,
   본문에서 그 호출을 통째로 빼도 **내 주석이 과녁에 걸려** 축이 초록이었다(①축 변이 둘이 조용했다).
   리포가 이미 값을 치른 병이라 도구도 이미 있다 — `scripts/_lib/code-only.mjs` 한 곳(AC-82). */
const rawRead = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const read = (f) => { const t = rawRead(f); return t === null ? null : codeOnly(t); };
const PLANS = "netlify/functions/plans-list.ts", ACC = "netlify/functions/accounts.ts";
const COST = "lib/video/cost.ts", GEN = "lib/video/gen.ts", WC = "lib/writing-contracts.ts";
const FILES = [PLANS, ACC, COST, GEN, WC];

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const gone = FILES.filter((f) => T[f] === null);
if (gone.length) { console.error(`⊘ 못 쟀어요 — ${gone.join(", ")} 가 없다.`); process.exit(2); }

/* ───────── ① 한 벌 — 오버레이 적용값에서 오나 ───────── */
notes.push("■ ① 한 벌 — 단가를 내보내는 문이 **운영센터가 바꾼 값**에서 가져오나");
const ONE = [
  ["요금제 문이 오버레이를 읽는다",     PLANS, /loadPacksAndTable\(\)/],
  ["요금제 문이 그 값을 내보낸다",       PLANS, /coins: \{ krw: COIN_KRW, packs, table, labels: COIN_ITEM_LABEL \}/],
  ["계정 문이 오버레이를 읽는다",       ACC,   /loadPacksAndTable\(\)/],
  ["🔴 차감도 같은 오버레이를 본다",    null,  null],
];
for (const [name, f, re] of ONE) {
  if (f === null) {
    const led = read("lib/coin-ledger.ts") ?? "";
    (/coinCostOverlay/.test(led) ? ok : bad)("①", name);
  } else (re.test(T[f]) ? ok : bad)("①", name);
}

/* ───────── ② 실은 칸 — A 가 읽을 자리 ───────── */
notes.push("■ ② 실은 칸 — 디렉터·편성표·만들기가 이미 부르는 문에 실렸나");
(/coins: \{ table: coins\.table, labels: COIN_ITEM_LABEL \}/.test(T[ACC]) ? ok : bad)("②", "`accounts-list` 가 `coins:{table,labels}` 를 싣는다");
for (const [scr, re] of [["director.html", /accounts-list/], ["schedule.html", /accounts-list/], ["create.html", /accounts-list/]]) {
  const t = read(`public/app/${scr}`);
  if (t === null) unk("②", `${scr} 가 없다`);
  else (re.test(t) ? ok : bad)("②", `${scr} 가 그 문을 부른다(왕복이 안 는다)`);
}

/* ───────── ③ 한 곳 — 컷 수를 같은 함수에 묻나 ───────── */
notes.push("■ ③ 한 곳 — 컷 수를 만들 때와 잴 때가 **같은 함수**에 묻나");
(/export function cutCountFor\(/.test(T[WC]) ? ok : bad)("③", "계약에 컷 수 함수가 있다");
(/cutCountFor\(format, seconds, cuts\)/.test(T[COST]) ? ok : bad)("③", "🔴 원가 추정이 그 함수를 부른다");
(/cutCountFor\(format as ShortsFormat, seconds, spec\.cuts\)/.test(T[GEN]) ? ok : bad)("③", "🔴 실제 생성도 그 함수를 부른다");
(/Number\(asked\) \|\| c\.default/.test(T[WC]) ? ok : bad)("③", "컷 0 은 «안 골랐다»로 본다(`??` 면 0으로 나눈다)");
(/form\.cutSec\.max, Math\.max\(form\.cutSec\.min/.test(T[COST]) ? ok : bad)("③", "컷 길이도 계약에서 온다(화면 상수 0)");

/* ───────── ④ 값 — 🔴 실제로 돌려서 잰다 ───────── */
notes.push("■ ④ 값 — 🔴 **실제로 돌려서** 잰다(글자 대조가 아니다)");
function runPure(dir) {
  const probe = path.join(dir, ".probe-coin.mts");
  writeFileSync(probe, `
import { cutCountFor, shortsFormOf } from "./lib/writing-contracts";
import { estimateVideoCostUsd } from "./lib/video/cost";
const out = {
  cuts: {} as Record<string, number>,
  cost: {} as Record<string, number>,
  inRange: true,
  zero: cutCountFor("graphic", 60, 0),
};
for (const f of ["graphic", "talking", "clip"] as const) for (const s of [15, 30, 60, 90] as const) {
  const n = cutCountFor(f, s);
  out.cuts[f + ":" + s] = n;
  out.cost[f + ":" + s] = estimateVideoCostUsd(f, s, shortsFormOf(f, s).provider as never);
  const c = shortsFormOf(f, s).cuts;
  if (n < c.min || n > c.max) out.inRange = false;
}
console.log("@@" + JSON.stringify(out) + "@@");
`);
  try {
    const o = execFileSync("npx", ["tsx", probe], { cwd: dir, encoding: "utf8", shell: process.platform === "win32", timeout: 180000 });
    const m = /@@(.*)@@/s.exec(o);
    return m ? JSON.parse(m[1]) : null;
  } finally { try { rmSync(probe, { force: true }); } catch { /* 지워지면 그만 */ } }
}
let V = null;
try { V = runPure(ROOT); } catch { V = null; }
if (!V) unk("④", "제품 함수를 못 돌렸다(tsx)");
else {
  /* 🔴 **이 판의 그 버그** — 90초가 60초보다 싸면 돈 관문이 90초를 싸게 보고 통과시킨다. */
  (V.cost["graphic:90"] > V.cost["graphic:60"] ? ok : bad)("④",
    `🔴 90초가 60초보다 비싸다(그래픽 $${V.cost["graphic:90"]} > $${V.cost["graphic:60"]})`);
  (V.cuts["graphic:90"] > V.cuts["graphic:60"] ? ok : bad)("④",
    `🔴 90초 컷 수가 60초보다 많다(${V.cuts["graphic:90"]} > ${V.cuts["graphic:60"]})`);
  /* 🔴 **무회귀** — 실고객이 쓰는 길이(그래픽 60·30)는 옛 상수와 같은 컷 수여야 한다.
     여기 숫자 9·5 는 «옛 상수»라 자에 적는 게 맞다(제품 값을 베끼는 게 아니라 **바뀌지 않았음**을 잰다). */
  (V.cuts["graphic:60"] === 9 ? ok : bad)("④", `그래픽 60초는 9컷 그대로(=${V.cuts["graphic:60"]})`);
  (V.cuts["graphic:30"] === 5 ? ok : bad)("④", `그래픽 30초는 5컷 그대로(=${V.cuts["graphic:30"]})`);
  (V.inRange ? ok : bad)("④", "모든 포맷×길이의 컷 수가 계약 min~max 안에 있다");
  (V.zero === 9 ? ok : bad)("④", `컷 0 을 보내도 기본값으로 떨어진다(=${V.zero} · 0으로 나누지 않는다)`);
}

/* ───────── 찍기 ───────── */
console.log("─".repeat(100));
console.log(`코인·컷 한 벌 — 축 ${notes.filter((l) => /^  [✓✗⊘]/.test(l)).length}개 · 갈라진 곳 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 — 제품 무접촉(사본에서만) ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-coin-one-source.mjs");
const EXTRA = ["lib/coin-ledger.ts", "public/app/director.html", "public/app/schedule.html", "public/app/create.html"];
/* 🔴 사본을 **돌아가게** 세운다. 처음엔 바뀐 파일만 복사했더니 사본에 `db/index`·`node_modules` 가 없어
   ④축(제품 함수를 실제로 돌리는 축)이 «못 쟀음»으로 떨어졌고, **가장 중요한 변이가 측정 불능**이 됐다.
   ⇒ 소스 나무(`lib`·`db`·`netlify`·`public/app`)를 통째로 복사하고 `node_modules` 는 **정션**으로 잇는다
      (윈도우에서 정션은 관리자 권한이 필요 없다). 제품은 여전히 무접촉이다 — 사본만 고친다. */
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-coin-"));
  try {
    for (const d of ["lib", "db", "netlify", "public/app", "scripts/_lib"]) {
      const src = path.join(ROOT, d);
      if (existsSync(src)) cpSync(src, path.join(dir, d), { recursive: true });
    }
    for (const f of ["package.json", "tsconfig.json"]) {
      if (existsSync(path.join(ROOT, f))) writeFileSync(path.join(dir, f), readFileSync(path.join(ROOT, f), "utf8"));
    }
    try { symlinkSync(path.join(ROOT, "node_modules"), path.join(dir, "node_modules"), "junction"); } catch { /* 없으면 tsx 가 알아서 실패하고 ④축이 «못 쟀음»이라 말한다 */ }

    const box = {}; for (const f of [...FILES, ...EXTRA]) { const t = rawRead(f); if (t !== null) box[f] = t; }   // 🔴 사본엔 **원문**을 쓴다(주석 걷은 것을 제품 자리에 두면 그 자체가 변이가 된다)
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of Object.keys(box)) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* 정션이 잡고 있으면 다음 판에 지워진다 */ } }
}

console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 · AC-161)");
const ctrl = runIn(null);
const textOnly = ctrl.code !== 0;
if (textOnly) console.log("  ⊘ 대조군이 빨갛다 — 사본에서 제품 함수를 못 돌린 듯하다. **글자 축(①②③)만** 변이로 잰다.");
else console.log("  ✓ 대조군(맨 판) 초록");
const MUT = [
  ["요금제 문을 코드 기본값으로 되돌린다", (b) => { b[PLANS] = b[PLANS].replace("const { packs, table } = await loadPacksAndTable();", "const packs = [], table = {};"); }, "①"],
  ["계정 문에서 오버레이를 뗀다",          (b) => { b[ACC] = b[ACC].replace("listChannels(), loadPacksAndTable()", "listChannels(), Promise.resolve({ table: {} })"); }, "①"],
  ["계정 문이 코인 칸을 안 싣는다",        (b) => { b[ACC] = b[ACC].replace(/,\s*\n\s*coins: \{ table: coins\.table, labels: COIN_ITEM_LABEL \}/, ""); }, "②"],
  ["원가가 컷 수를 손으로 다시 적는다",    (b) => { b[COST] = b[COST].replace("const n = cutCountFor(format, seconds, cuts);", "const n = cuts ?? (seconds === 60 ? 9 : seconds === 30 ? 5 : 3);"); }, "③"],
  ["생성이 컷 수를 손으로 다시 적는다",    (b) => { b[GEN] = b[GEN].replace("const cuts = cutCountFor(format as ShortsFormat, seconds, spec.cuts);", "const cuts = Math.max(form.cuts.min, Math.min(form.cuts.max, spec.cuts || form.cuts.default));"); }, "③"],
  ["컷 0 을 그대로 통과시킨다",            (b) => { b[WC] = b[WC].replace("Number(asked) || c.default", "asked ?? c.default"); }, "③"],
];
let silent = 0;
for (const [name, tf, axis] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 듯). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axis}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axis}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 본다`); silent++; }
}
/* 🔴 **가장 중요한 변이는 ④축이다** — 옛 삼항을 되돌리면 90초가 다시 싸져야 한다. 대조군이 돌 때만 잰다. */
if (!textOnly) {
  const r = runIn((b) => { b[COST] = b[COST].replace("const n = cutCountFor(format, seconds, cuts);", "const n = cuts ?? (seconds === 60 ? 9 : seconds === 30 ? 5 : 3);"); });
  const cried = r.code !== 0 && /✗ ④/.test(r.out);
  if (cried) console.log("  ✓ 🔴 옛 삼항을 되돌리면 → ④축이 **값으로** 운다(90초가 다시 싸진다)");
  else { console.log(`  ✗ 🔴 옛 삼항을 되돌렸는데 ④축이 **안 운다**(종료 ${r.code}) — 값 축이 헛돈다`); silent++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : "✓ 변이가 모두 제 축을 울렸다");
process.exit(fails.length || silent ? 1 : 0);
