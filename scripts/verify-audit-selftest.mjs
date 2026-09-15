/**
 * scripts/verify-audit-selftest.mjs — 🔴 **하니스를 하니스로 잰다**(C · R8 마감 · 2026-09-16).
 *   사용: node scripts/verify-audit-selftest.mjs
 *
 *   ══ 왜 ══
 *   B2 가 자기 칸(B5 쓰레드 연결글)에서 찾았다: 판정이 `/연결글|threadChain|reply_to/` 라서
 *   **«연결글은 아직 없다»는 주석 한 줄만 있어도 «닫힘»** 이었다. 메인이 «다른 칸에도 같은 병이 있는지 훑어 달라»고 했다.
 *
 *   ══ 이 파일이 잡는 병 셋 ══
 *     ① 🔴 **주석만으로 닫히는 칸** — 그 파일에서 주석·문자열을 **지우고** 다시 재서 판정이 뒤집히면 그 칸은 주석이 세운 것이다.
 *        («없다»라고 적어 둔 주석이 «있다»로 세어지는 것이 제일 나쁘다 — 정직하게 적을수록 초록이 된다.)
 *     ② 🔴 **한국어 낱말로 재는 칸** — 소스 주석에 그 말이 나올 확률이 높다. ①에 안 걸려도 미리 알린다.
 *     ③ 🔴 **손으로 든 파일 목록** — 그 기능이 사는 파일이 목록 밖이면 다 만들어도 영영 열림이다(AC-82).
 *        목록에 없는데 그 낱말이 **더 많이** 나오는 파일이 있으면 짚어 준다.
 *
 *   ⚠️ 이 검사는 **경보기**다. 여기서 빨강이라고 그 칸이 틀린 것은 아니다 — «사람이 한 번 봐야 한다»는 뜻이다.
 *      그래서 종료코드는 ①(주석이 세운 칸)에서만 1 이다.
 */
import { readFileSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, rmSync, cpSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const AUDIT = "scripts/verify-r8-audit64.mjs";
const src = readFileSync(AUDIT, "utf8");

/* ══ 기준 판정 ══ */
const runAudit = (cwd) => {
  const raw = execFileSync(process.execPath, [AUDIT, "--json"], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(raw).results.reduce((m, r) => (m[r.row] = r.state, m), {});
};
const base = runAudit(process.cwd());

/* ══ ① 주석·문자열을 지운 사본으로 다시 재기 ══
   🔴 **소스를 안 바꾼다.** 임시 폴더에 우리 소스만 복사하고 거기서 지운다(라이브·워크트리 건드리지 않는다). */
const SCAN_DIRS = ["lib", "netlify", "public", "runner", "db", "drizzle", "scripts", "docs"];
const tmp = mkdtempSync(path.join(tmpdir(), "ac-selftest-"));
for (const d of SCAN_DIRS) if (existsSync(d)) cpSync(d, path.join(tmp, d), { recursive: true });

/** 코드에서 **주석만** 지운다(문자열 리터럴은 남긴다 — 실제 동작에 쓰이는 말일 수 있다).
 *  줄 수는 보존한다(줄 번호를 지목하는 판정이 있다). */
const stripCodeComments = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .split("\n").map((ln) => (/^\s*(\/\/|\*|--|#)/.test(ln) ? "" : ln.replace(/\s\/\/[^\n]*$/, ""))).join("\n");

const walk = (dir, acc = []) => {
  /* 🔴 [2026-09-16] 첫 판은 여기서 `require("node:fs")` 를 썼다 — **ESM 이라 던진다.** 그런데 try/catch 가 먹어서
     훑기가 **아무것도 안 하고 조용히 빈 배열**을 냈고, 그러니 «주석 지운 사본»이 원본과 같아서 판정이 안 뒤집혔다.
     즉 **이 하니스가 가짜 초록을 냈다** — 내가 잡으려던 바로 그 병을 내가 냈다.
     ⇒ 그래서 아래 «훑은 파일 수»를 화면에 찍고, **0 이면 실패**로 센다. 숫자를 안 찍으면 다음 사람도 못 본다. */
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of names) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|mts|mjs|js|sql)$/.test(e.name)) acc.push(p);
  }
  return acc;
};
let stripped = 0;
for (const f of walk(tmp)) {
  try {
    const before = readFileSync(f, "utf8");
    const after = stripCodeComments(before);
    if (after !== before) { writeFileSync(f, after); stripped++; }
  } catch { /* 못 읽는 파일은 둔다 */ }
}
/* 하니스 자신은 **원본 그대로** 둔다 — 자기 주석을 지우면 정규식 리터럴이 깨진다. */
mkdirSync(path.join(tmp, "scripts"), { recursive: true });
writeFileSync(path.join(tmp, AUDIT), src);

let after = {};
let runErr = "";
try { after = runAudit(tmp); } catch (e) { runErr = String(e?.message ?? e).slice(0, 300); }

/**
 * 🔴 **이름 붙인 예외 — 산출물 자체가 주석인 칸**(2026-09-16 · 메인이 묻고 C 가 정했다 · 갈래 ⓐ).
 *   C5 «AC-1 출처 헤더»는 «lib/*.ts 헤더 주석에 출처가 있나»를 세는 칸이라, 주석을 지우면 **당연히** 열린다 —
 *   주석이 기능을 **흉내 낸** 것이 아니라 주석이 **그것 자체**다. 이 검사의 뜻(«주석이 코드를 흉내 내나»)의 밖이다.
 *   ⚠️ **이 예외가 못 잡게 되는 것**: C5 가 «출처: 없음» 같은 빈말로 닫혀도 여기서는 안 잡힌다 — 그 칸의 값은
 *      `verify-r8-audit64` 의 C5 판정(헤더 구역에 출처 낱말이 있나)이 지킨다. **다른 칸은 예외가 아니다** — 목록 밖 칸이
 *      주석으로 닫히면 여전히 빨강이다. 예외는 조용히 먹지 않고 아래에 **반드시 찍는다.**
 *   부정 대조: `SELFTEST_NO_EXCEPTION=1` 로 돌리면 예외를 끄고 C5 가 다시 빨개져야 한다(이 예외가 «무엇을 가리는지» 보여 준다).
 */
const COMMENT_IS_DELIVERABLE = process.env.SELFTEST_NO_EXCEPTION ? [] : ["C5 AC-1 헤더 일괄"];
const flipped = [];
const excepted = [];
if (!runErr) {
  for (const row of Object.keys(base)) {
    const b = base[row], a = after[row];
    if (a === undefined) continue;
    /* 🔴 닫힘 → 열림/일부 로 내려간 칸 = **주석이 세우고 있던 칸**이다. */
    if (b === "닫힘" && a !== "닫힘") {
      if (COMMENT_IS_DELIVERABLE.some((x) => row.includes(x))) excepted.push([row, b, a]);
      else flipped.push([row, b, a]);
    }
  }
}

/* ══ ② 한국어 낱말로 재는 칸 — 미리 알린다 ══
   🔴 하니스 **자신의 주석과 설명 문자열**을 먼저 지운다. 안 지우면 «판정 근거는 코드인데 옆 주석에 한글이 있다»는 이유로
      멀쩡한 칸이 경보에 뜬다(내 첫 판에서 A7·A11 이 그렇게 떴다). **늘 빨강인 검사는 아무도 안 본다.** */
const srcForScan = src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .split("\n").map((ln) => (/^\s*(\/\/|\*)/.test(ln) ? "" : ln)).join("\n")
  .replace(/"(?:[^"\\\n]|\\.)*"/g, (m) => (/[가-힣]/.test(m) ? '"…"' : m));   // 설명 문자열의 한글은 판정이 아니다
const korRows = [];
for (const m of srcForScan.matchAll(/\["?([^"\n]{2,60}?)"?,\s*\(\)\s*=>[\s\S]{0,700}?\]\],/g)) {
  const block = m[0];
  const name = m[1];
  const kor = [...block.matchAll(/\/[^/\n]*[가-힣][^/\n]*\/[gimsuy]*/g)].map((x) => x[0]);
  if (kor.length) korRows.push([name, kor.slice(0, 3).join(" ")]);
}
/* FOUR 쪽(객체 모양)도 훑는다 — 여기도 주석·설명 지운 사본으로 본다 */
for (const m of srcForScan.matchAll(/\{\s*n:\s*("?[\w]+"?),\s*name:\s*("[^"]*"|…)[\s\S]{0,1400}?\n  \} \},/g)) {
  const kor = [...m[0].matchAll(/\/[^/\n]*[가-힣][^/\n]*\/[gimsuy]*/g)].map((x) => x[0]);
  if (kor.length) korRows.push([`④-${m[1].replace(/"/g, "")} ${m[2]}`, kor.slice(0, 3).join(" ")]);
}

/* ══ ③ 손으로 든 파일 목록 ══ */
const handLists = [...src.matchAll(/\[((?:\s*"[\w./-]+\.(?:ts|mjs|js|html|css|sql)"\s*,?){2,})\]/g)]
  .map((m) => m[1].match(/"[^"]+"/g).map((s) => s.slice(1, -1)));

const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\n하니스 자체 검사 — «주석만 있어도 닫히나» · ${new Date().toISOString()}\n${"─".repeat(124)}`);
console.log(`우리 소스 ${stripped}개에서 **주석을 지운 사본**을 만들어 같은 하니스를 다시 돌렸다(원본은 안 건드린다).`);
if (runErr) console.log(`🔴 사본에서 하니스가 못 돌았다: ${runErr}`);

console.log(`\n■ ① 주석이 세우고 있던 칸 — **${flipped.length}개**`);
if (!flipped.length && !runErr) console.log("   ✅ 없다. 닫힘 칸은 전부 주석이 아니라 **코드**가 세우고 있다.");
for (const [row, b, a] of flipped) console.log(`   ✗ ${w(row, 48)} 원본 ${w(b, 6)} → 주석 지우면 ${a} 🔴`);
for (const [row, b, a] of excepted) console.log(`   △ ${w(row, 48)} 원본 ${w(b, 6)} → 주석 지우면 ${a}  — **이름 붙인 예외**(산출물이 주석인 칸 · 이 검사 밖 · 값은 audit64 C5 판정이 지킨다)`);
if (COMMENT_IS_DELIVERABLE.length) console.log(`   ⚠️ 예외 목록 ${COMMENT_IS_DELIVERABLE.length}칸: ${COMMENT_IS_DELIVERABLE.join(", ")} — 이 칸이 빈말로 닫혀도 여기서는 안 잡힌다(SELFTEST_NO_EXCEPTION=1 로 끄면 다시 빨강).`);

console.log(`\n■ ② 한국어 낱말로 재는 칸 — ${korRows.length}개(경보 · 틀렸다는 뜻이 아니다)`);
for (const [name, res] of korRows) console.log(`   · ${w(name, 44)} ${res}`);
if (!korRows.length) console.log("   ✅ 없다.");

console.log(`\n■ ③ 손으로 든 파일 목록 — ${handLists.length}벌(AC-82)`);
/* 🔴 [2026-09-16 메인 지적] 목록에 **없는 파일**이 섞여 있으면 그 칸은 «남은 파일이 우연히 있어서» 통과하는 것이다 —
   남은 파일이 이름을 바꾸는 날 조용히 «없음»이 된다. 경보가 아니라 **실패**로 센다(목록을 고치면 초록이 된다). */
let staleLists = 0;
for (const l of handLists) {
  const missing = l.filter((p) => !existsSync(p));
  if (missing.length) staleLists++;
  console.log(`   · [${l.join(", ")}]${missing.length ? `  🔴 없는 파일 ${missing.join(",")}` : ""}`);
}

rmSync(tmp, { recursive: true, force: true });
console.log(`${"─".repeat(124)}`);
/* 🔴 **«0개 훑었다»는 통과가 아니라 고장이다.** 이 줄이 없으면 훑기가 죽어도 초록이 뜬다(내가 첫 판에서 그랬다). */
const brokenScan = stripped === 0;
if (brokenScan) console.log("🔴 **훑은 파일이 0개다 — 이 검사 자체가 고장난 것이다**(«주석으로 닫힌 칸 0» 은 이 경우 근거가 아니다).");
else console.log(flipped.length
  ? `🔴 **${flipped.length}칸이 주석으로 닫혀 있다** — 그 칸은 제품이 아니라 글자를 센 것이다.`
  : `✅ 주석으로 닫힌 칸 0 (파일 ${stripped}개에서 주석을 지우고 다시 쟀다${excepted.length ? ` · 이름 붙인 예외 ${excepted.length}칸은 위에 찍었다` : ""}).`);
if (staleLists) console.log(`🔴 손으로 든 파일 목록 ${staleLists}벌에 없는 파일이 섞여 있다 — 목록을 고쳐라(AC-82).`);
process.exit(flipped.length || brokenScan || runErr || staleLists ? 1 : 0);
