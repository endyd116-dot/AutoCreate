/**
 * scripts/check-am-origin.mjs — AC-1 «AM 원본 경로·복사일» 헤더가 **없는 `lib` 파일**을 증거와 함께 뽑는다(읽기 전용).
 *   `node scripts/check-am-origin.mjs [--json] [--since <git ref>]`
 *
 *   ══ 왜 스크립트인가 ══
 *     목록은 **찍는 순간 낡는다** — 라운드마다 `lib/*.ts` 가 새로 생긴다(오늘만 `channel-url.ts`·`coin-reconcile.ts` 둘).
 *     그래서 계획 문서(`docs/active/2026-09-15-AC1-header-plan.md`)는 «그날의 사진»이고, **실행 직전에 이걸 다시 돌려**
 *     그 사이 생긴 파일을 더한다. 사람이 목록을 손으로 갱신하면 반드시 빠뜨린다.
 *
 *   ══ 판정(지어내지 않는다 · 근거만 적는다) ══
 *     A군 = 파일이 이미 **AM 을 말하고 있다**(형식만 AC-1 과 다름) → «AM 원본: 경로 · 복사일»로 고친다.
 *     B군 = AM 언급이 없고 **AC 라운드 커밋이 만든 파일** → «AC 신규(계약 …)» 를 적는다.
 *     C군 = 둘 다 아니다 → 🔴 **«AM 원본 불명»** 으로 적는다(추측 금지).
 *     보조 증거: AM `lib/` 에 **같은 이름** 파일이 있나(이름만 같을 수 있으니 사람이 내용을 본다).
 *   🔴 읽기 전용 — 파일을 고치지 않는다. 고치는 것은 사람이 한 커밋으로.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const AM_LIB = process.env.AM_LIB_DIR || "../AutoMarketing/lib";
const argv = process.argv.slice(2);
const AS_JSON = argv.includes("--json");
const SINCE = argv.includes("--since") ? argv[argv.indexOf("--since") + 1] : null;

/**
 * 판정에 쓰는 신호 3개.
 *   🔴 AC-1 이 요구하는 것은 **«어디서 왔는지 되짚을 수 있는가»**(경로 + 시점)이지 특정 문구가 아니다.
 *      그래서 «AM 원본:» 이 아니어도 **AM 경로(`../AutoMarketing/...`)가 적혀 있으면 추적 가능**으로 본다
 *      (예: `lib/publish/blogger.ts` = «AC 신규 2026-09-14(B2). 관례 출처: ../AutoMarketing/lib/publish-threads.ts»).
 *      문구만 맞추려고 멀쩡한 헤더 수십 개를 건드리면, 그건 규율이 아니라 잡음이다.
 */
const AM_PATH = /\.\.\/AutoMarketing\//;                                   // 되짚을 수 있는 경로
const AM_HINT = /(AM 원본|AutoMarketing|AM `|AM 관례|AM 과 동일|AM 방식|계승\)|AM 의 )/;   // 출처를 «말은 하는데» 경로가 없을 수 있다
/** [2026-09-15] 이 스캐너가 넣은 «되짚을 수 있다» 표식 — 한 번 붙으면 다시 대상이 되지 않는다. */
const MARKED = /🔎 (출처|AM 원본):/;
const AC_NEW = /(AC 신규|신규 구현|신규\()/;

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".ts")) out.push(p);
  }
  return out;
}

const acFiles = walk("lib").map((p) => p.split(path.sep).join("/"));
const amFiles = walk(AM_LIB);
const amBase = new Map();
for (const a of amFiles) amBase.set(path.basename(a, ".ts"), a);

const rows = [];
for (const f of acFiles) {
  const src = readFileSync(f, "utf8");
  const hasAm = AM_HINT.test(src);
  const hasNew = AC_NEW.test(src);
  const hasPath = AM_PATH.test(src);
  /* [2026-09-15 실행 뒤 보강] 🔴 **이 스캐너가 넣은 표식이 있으면 끝난 파일이다.**
     헤더에 «AM 원본 없음» 같은 문장이 들어가면 `AM_HINT` 가 그 낱말을 보고 다시 A군으로 집어 든다 —
     그러면 다음 사람이 재스캔할 때 **이미 고친 75개가 다시 대상으로** 보인다(내가 실제로 그렇게 봤다).
     표식(`🔎 출처:` / `🔎 AM 원본:`)은 «되짚을 수 있다»의 증거라 경로 유무와 상관없이 통과시킨다. */
  if (MARKED.test(src)) continue;
  if (hasPath) continue;                                       // AM 경로가 있다 = 되짚을 수 있다(문구는 안 따진다)
  if (hasNew && !hasAm) continue;                              // «AC 신규»만 밝힌 파일 — 출처가 없는 게 아니라 «AM 것이 아니다»
  let added = "", addedAt = "";
  try {
    added = execSync(`git log --diff-filter=A --format=%s -1 -- "${f}"`, { encoding: "utf8" }).trim();
    addedAt = execSync(`git log --diff-filter=A --format=%ad --date=short -1 -- "${f}"`, { encoding: "utf8" }).trim();
  } catch { /* 새 파일(아직 커밋 전)이면 비어 있다 */ }
  const round = (added.match(/^\w+\(([^)]+)\)/) || [, ""])[1];
  const group = hasAm ? "A" : (round ? "B" : "C");
  rows.push({ file: f, group, round, addedAt, amSameName: amBase.get(path.basename(f, ".ts")) ? path.basename(f) : "", addedSubject: added.slice(0, 70) });
}

/** --since 가 있으면 «그 뒤 새로 생긴 lib 파일»을 따로 표시(계획 문서를 찍은 뒤 늘어난 것). */
let newer = new Set();
if (SINCE) {
  try {
    newer = new Set(execSync(`git diff --name-only --diff-filter=A ${SINCE}..HEAD -- lib/`, { encoding: "utf8" }).trim().split(/\r?\n/).filter(Boolean));
  } catch (e) { console.warn(`[since] ${SINCE} 비교 실패 — 건너뜀:`, String(e?.message ?? e).slice(0, 80)); }
}

if (AS_JSON) { console.log(JSON.stringify({ at: new Date().toISOString(), amLib: AM_LIB, since: SINCE, rows: rows.map((r) => ({ ...r, isNew: newer.has(r.file) })) }, null, 1)); process.exit(0); }

const A = rows.filter((r) => r.group === "A"), B = rows.filter((r) => r.group === "B"), C = rows.filter((r) => r.group === "C");
console.log(`AC-1 헤더 대상 — lib ${acFiles.length}개 중 ${rows.length}개 · AM 목록 ${amFiles.length}개(${AM_LIB})`);
console.log("─".repeat(100));
console.log(`A군(AM 을 말하는데 형식만 다름 · «AM 원본: 경로 · 복사일»로) ${A.length}개`);
for (const r of A) console.log(`  · ${r.file}${r.amSameName ? `   [AM 같은 이름: ${r.amSameName} — 내용 확인 필요]` : ""}`);
console.log(`\nB군(AC 라운드가 만든 것 · «AC 신규(계약 …)»로) ${B.length}개`);
for (const r of B) console.log(`  · ${r.file.padEnd(38)} ${r.round} (${r.addedAt})${newer.has(r.file) ? "  🆕 계획 문서 이후 생김" : ""}`);
if (C.length) {
  console.log(`\n🔴 C군(근거 없음 · «AM 원본 불명»으로 적는다) ${C.length}개`);
  for (const r of C) console.log(`  · ${r.file}`);
} else console.log("\nC군(불명) 0개");
if (SINCE) console.log(`\n«${SINCE}» 이후 새로 생긴 lib 파일: ${[...newer].length}개 ${[...newer].join(" ") || "(없음)"}`);
