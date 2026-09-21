/**
 * scripts/verify-formatmarks-contract.mjs — 🔴 **러너가 보내는 칸 ↔ 서버가 읽는 칸**(AC-193 · B 2026-09-22)
 *
 *   ══ 왜 이 자인가 — 같은 자리에서 **네 번**이다 ══
 *     `lib/format-marks.ts` 의 흰 목록은 **모르는 칸을 조용히 버린다.** 러너가 세어 보내도 서버에서 사라진다.
 *       · `notes`(2026-09-20)        — 🔴 **일부러 버린다**(메인 판정 2026-09-15 · 러너가 문장을 만들면 화면이 러너 판에 묶인다)
 *       · `paragraphs`(2026-09-20)   — ❌ 실수. B2 가 문단 수 대조를 붙이며 걸렸다
 *       · `subtitleFont`(2026-09-22) — ❌ 실수(B2 보고). ⚠️ 이 브랜치에는 그 글자가 없다 — **못 쟀다**
 *       · `paragraphs.measured`      — ❌ **이 자를 만들다 찾았다.** 러너가 보내는데 `paragraphsOf` 가 버린다
 *
 *   ══ 🔴 그래서 병은 «버리는 것»이 아니라 «**의도와 실수가 구분이 안 되는 것**»이다 ══
 *     일부러 버리는 칸이 실제로 둘 있다 — `notes`(위)와 `bleed.samples`(B2 합의 · meta 를 무겁게 안 한다).
 *     ⇒ 흰 목록을 뒤집어 «모르는 칸을 그냥 실어 보내면» **그 두 결정이 조용히 뒤집힌다.** 뒤집으면 안 된다.
 *     ⇒ 대신 **«일부러 버린다»를 글로 적게** 하고(`DROPPED` 아래), 거기에도 없는 칸이 나타나면 **여기서 운다.**
 *        오늘 `verify-ai-usage-leaks` 의 `ALLOW` 로 값을 본 그 모양 그대로다.
 *
 *   ══ 재는 것 ══
 *     ① 최상위  — 러너 `formatMarks.*` 의 칸을 서버 `mergeRunnerFormatMarks` 가 읽나
 *     ② 안쪽    — `paragraphs.*` 를 `paragraphsOf` 가, `bleed.*` 를 `bleedOf` 가 읽나
 *     ③ 타입    — `RunnerFormatMarks`(계약서)가 **구현과 같은 말**을 하나(타입만 낡으면 다음 사람이 없는 칸으로 안다)
 *     ④ 낡음    — `DROPPED` 에 적힌 칸이 **아직 러너에 살아 있나**(과녁이 사라지면 그 줄은 공짜로 참이 된다)
 *   🔴 **모수를 말한다** — «러너 칸 M개 중 서버가 읽는 것 N개 · 일부러 버리는 것 K개». 0 을 통과로 쓰지 않는다(AC-141 ②).
 *
 *   `--mutants` = 제품 사본에 변이를 넣고 이 자가 정말 무는지 본다.
 *   종료코드: 0 = 계약이 맞다 · 1 = 어긋난다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
const FM = "lib/format-marks.ts", RJ = "lib/runner-jobs.ts", BLEED = "runner/lib/format-bleed.mjs";
const CHANNELS = existsSync(path.join(ROOT, "runner/channels"))
  ? readdirSync(path.join(ROOT, "runner/channels")).filter((f) => f.endsWith(".mjs")).map((f) => `runner/channels/${f}`)
  : [];
const FILES = [FM, RJ, BLEED, ...CHANNELS];

const rawRead = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const read = (f) => { const t = rawRead(f); return t === null ? null : codeOnly(t); };   // 🔴 주석을 걷고 본다(AC-191)

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const gone = FILES.filter((f) => T[f] === null);
if (gone.length) { console.error(`⊘ 못 쟀어요 — ${gone.join(", ")} 가 없다.`); process.exit(2); }
if (!CHANNELS.length) { console.error("⊘ 못 쟀어요 — 러너 채널 파일이 하나도 없다(모수 0 을 통과로 쓰지 않는다)."); process.exit(2); }

/* ───────── 🔴 **일부러 버리는 칸** — 까닭을 글로 적는다 ─────────
   여기 없는 칸이 러너에 나타나면 ①②가 운다. 적어 두면 «봤고, 버리기로 했다»가 되고 안 적으면 «사고»다.
   🔴 줄 번호로 적지 않는다 — «어느 칸을 · 왜»로 적는다. */
const DROPPED = [
  ["notes", "메인 판정 2026-09-15 — 러너가 **문장**을 만들면 화면 문구가 러너 판(zip)에 묶인다. 러너는 사실만 보내고 문장은 서버가 만든다(`lib/runner-jobs.ts` 그 주석이 정본)"],
  ["bleed.samples", "B2 합의 — 번진 문단의 **실물 조각**은 러너 로그에만 둔다. `pieces.meta` 를 무겁게 하지 않는다(«왜 예시 문단이 안 보이지»의 답)"],
  ["paragraphs.measured", "🔴 **`kind` 와 겹친다** — `paragraphVerdict` 는 `measured:false` 일 때만 `kind:\"unknown\"` 을 낸다. 두 칸이 같은 말을 하면 나중에 **둘이 갈린다**. `kind` 쪽이 화면까지 가는 정본이라 그쪽만 싣는다"],
];

/* ───────── 뜯기 ─────────
   `const formatMarks = { … }` 의 최상위 칸 · `formatMarks.<칸> =` 대입 · `formatMarks.paragraphs = { … }` 의 안쪽 칸. */
function literalKeys(text, start) {
  const i = text.indexOf(start);
  if (i < 0) return [];
  let depth = 0, j = text.indexOf("{", i), end = -1;
  if (j < 0) return [];
  for (let k = j; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") { depth--; if (depth === 0) { end = k; break; } }
  }
  if (end < 0) return [];
  const body = text.slice(j + 1, end);
  const out = [];
  let d = 0;
  for (let k = 0; k < body.length; k++) {
    const c = body[k];
    if (c === "{" || c === "[" || c === "(") d++;
    else if (c === "}" || c === "]" || c === ")") d--;
    else if (d === 0) {
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(body.slice(k));
      if (m && (k === 0 || /[\s,]/.test(body[k - 1]))) { out.push(m[1]); k += m[0].length - 1; }
    }
  }
  return out;
}
const runnerTop = new Set(), runnerPara = new Set();
for (const f of CHANNELS) {
  for (const k of literalKeys(T[f], "const formatMarks = {")) runnerTop.add(k);
  for (const m of T[f].matchAll(/formatMarks\.([A-Za-z_$][\w$]*)\s*=/g)) runnerTop.add(m[1]);
  for (const k of literalKeys(T[f], "formatMarks.paragraphs = {")) runnerPara.add(k);
}
/* `bleed` 는 러너가 `measureFormatBleed` 의 결과를 통째로 싣는다 — 그 반환 모양을 계약서(`RunnerFormatMarks.bleed`)에서 읽는다. */
const bleedDecl = /bleed\?: \{([^}]*)\}/.exec(rawRead(RJ) ?? "");
const runnerBleed = new Set((bleedDecl?.[1] ?? "").split(";").map((s) => (/([A-Za-z_$][\w$]*)\??:/.exec(s.trim())?.[1] ?? "")).filter(Boolean));

/* 서버가 읽는 칸 — 함수 몸통 안의 `r.<칸>`·`o.<칸>`·`pick("<칸>")`·목록 리터럴. */
function bodyOf(text, sig) {
  const i = text.indexOf(sig);
  if (i < 0) return "";
  let depth = 0, j = text.indexOf("{", i), end = -1;
  for (let k = j; k < text.length; k++) {
    if (text[k] === "{") depth++;
    else if (text[k] === "}") { depth--; if (depth === 0) { end = k; break; } }
  }
  return end < 0 ? text.slice(i) : text.slice(i, end);
}
const mergeBody = bodyOf(T[FM], "export function mergeRunnerFormatMarks");
const paraBody = bodyOf(T[FM], "function paragraphsOf");
const bleedBody = bodyOf(T[FM], "export function bleedOf");
const serverTop = new Set([...mergeBody.matchAll(/\br\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
const serverPara = new Set([...paraBody.matchAll(/\bo\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
const serverBleed = new Set([...bleedBody.matchAll(/pick\("([A-Za-z_$][\w$]*)"\)/g)].map((m) => m[1]));
for (const m of bleedBody.matchAll(/"([A-Za-z_$][\w$]*)"/g)) if (/for \(const k of \[/.test(bleedBody)) serverBleed.add(m[1]);

const droppedSet = new Set(DROPPED.map(([k]) => k));
const M = runnerTop.size + runnerPara.size + runnerBleed.size;
if (!M) { console.error("⊘ 못 쟀어요 — 러너 칸을 하나도 못 뜯었다(뜯는 눈이 깨졌다)."); process.exit(2); }

/* ───────── ①② 러너 칸이 서버에 닿나 ───────── */
function axis(ax, label, runnerKeys, serverKeys, prefix) {
  const lost = [...runnerKeys].filter((k) => !serverKeys.has(k) && !droppedSet.has(prefix ? `${prefix}.${k}` : k));
  const onPurpose = [...runnerKeys].filter((k) => droppedSet.has(prefix ? `${prefix}.${k}` : k));
  if (lost.length) bad(ax, `🔴 ${label} — 러너가 보내는데 **서버가 조용히 버리는** 칸 ${lost.length}개: ${lost.join(", ")} · 읽든지, 못 읽겠으면 \`DROPPED\` 에 **까닭과 함께** 적어라`);
  else ok(ax, `${label} — 러너 칸 ${runnerKeys.size}개 전부 서버에 닿는다(읽는 것 ${runnerKeys.size - onPurpose.length} · 일부러 버리는 것 ${onPurpose.length})`);
  for (const k of onPurpose) notes.push(`      · 일부러 버린다 — ${prefix ? `${prefix}.` : ""}${k}: ${DROPPED.find(([d]) => d === (prefix ? `${prefix}.${k}` : k))[1]}`);
}
notes.push("■ ① 최상위 — 러너 `formatMarks.*` 를 `mergeRunnerFormatMarks` 가 읽나");
axis("①", "formatMarks 최상위", runnerTop, serverTop, "");
notes.push("■ ② 안쪽 — `paragraphs.*`·`bleed.*`");
axis("②", "paragraphs", runnerPara, serverPara, "paragraphs");
axis("②", "bleed", runnerBleed, serverBleed, "bleed");

/* ───────── ③ 타입 — 계약서가 구현과 같은 말을 하나 ───────── */
notes.push("■ ③ 타입 — `RunnerFormatMarks`(계약서)가 구현과 같은 말을 하나");
{
  const decl = bodyOf(rawRead(RJ) ?? "", "export interface RunnerFormatMarks");
  const declared = new Set([...decl.matchAll(/^\s{2}([A-Za-z_$][\w$]*)\??:/gm)].map((m) => m[1]));
  /* 🔴 **서버가 읽는데 계약서에 없는 칸**이 병이다 — 다음 사람이 타입만 보고 «그런 칸은 없다»고 안다.
     실제로 `paragraphs` 가 그랬다(구현은 읽는데 타입엔 없었다). 반대쪽(타입에만 있는 칸)은 «아직 안 왔다»일 수 있어 안 문다. */
  const missing = [...runnerTop].filter((k) => serverTop.has(k) && !declared.has(k));
  (missing.length ? bad : ok)("③", missing.length
    ? `🔴 구현은 읽는데 \`RunnerFormatMarks\` 에 없는 칸 ${missing.length}개: ${missing.join(", ")} — 타입만 보는 사람은 그 칸이 **없는 줄 안다**`
    : `계약서가 구현이 읽는 칸 ${[...runnerTop].filter((k) => serverTop.has(k)).length}개를 모두 적고 있다`);
}

/* ───────── ④ 낡음 — `DROPPED` 의 과녁이 살아 있나 ───────── */
notes.push("■ ④ 낡음 — 일부러 버리기로 한 칸이 아직 러너에 있나");
{
  const all = new Set([...[...runnerTop].map((k) => k), ...[...runnerPara].map((k) => `paragraphs.${k}`), ...[...runnerBleed].map((k) => `bleed.${k}`)]);
  const stale = DROPPED.filter(([k]) => !all.has(k) && k !== "notes");   // `notes` 는 formatMarks 밖(보고 본문)이라 여기 안 뜬다
  (stale.length ? bad : ok)("④", stale.length
    ? `낡은 \`DROPPED\` ${stale.length}줄 — 러너가 그 칸을 이제 안 보낸다(${stale.map((x) => x[0]).join(", ")}). 지우면 다음 사람이 헷갈리지 않는다`
    : `\`DROPPED\` ${DROPPED.length}줄 모두 과녁이 살아 있다`);
}

/* ───────── 찍기 ───────── */
console.log("─".repeat(100));
console.log(`러너가 보내는 칸 ↔ 서버가 읽는 칸 — 축 ${notes.filter((l) => /^  [✓✗⊘]/.test(l)).length}개 · 어긋난 곳 ${fails.length}`);
console.log(`  · 모수 — 러너 칸 **${M}개**(최상위 ${runnerTop.size} · paragraphs ${runnerPara.size} · bleed ${runnerBleed.size}) · 일부러 버리는 것 ${DROPPED.length}개 · 훑은 채널 ${CHANNELS.length}개`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 — 제품 무접촉(사본에서만) ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-formatmarks-contract.mjs");
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-fmc-"));
  try {
    const box = {}; for (const f of FILES) box[f] = rawRead(f);
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of Object.keys(box)) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    mkdirSync(path.join(dir, "scripts", "_lib"), { recursive: true });
    writeFileSync(path.join(dir, "scripts", "_lib", "code-only.mjs"), readFileSync(path.join(ROOT, "scripts", "_lib", "code-only.mjs"), "utf8"));
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 · AC-161)");
const ctrl = runIn(null);
if (ctrl.code !== 0) { console.log("  ⊘ 못 쟀음 — 대조군(맨 판)이 이미 빨갛다. 변이 탓을 말할 수 없다."); process.exit(2); }
console.log("  ✓ 대조군(맨 판) 초록");
const NAVER = CHANNELS.find((f) => f.includes("naver")) ?? CHANNELS[0];
const MUT = [
  ["🔴 러너가 새 칸을 싣는다(최상위)", (b) => { b[NAVER] = b[NAVER].replace("const formatMarks = {", "const formatMarks = {\n      zzNewField: 1,"); }, "①"],
  ["🔴 러너가 새 칸을 싣는다(paragraphs)", (b) => { b[NAVER] = b[NAVER].replace("formatMarks.paragraphs = {", "formatMarks.paragraphs = {\n      zzInner: 1,"); }, "②"],
  ["🔴 서버가 `paragraphs` 읽기를 뗀다", (b) => { b[FM] = b[FM].replace("const paras = paragraphsOf(r.paragraphs);", "const paras = null;"); }, "①"],
  ["🔴 서버가 `breaks` 읽기를 뗀다",     (b) => { b[FM] = b[FM].replace("const breaks = num(r.breaks),", "const breaks = undefined, zz = num(r.zzz),"); }, "①"],
  ["🔴 `bleed` 안쪽 한 칸을 안 읽는다",  (b) => { b[FM] = b[FM].replace('for (const k of ["total", "bad", "red", "center", "italic", "underline", "bold"] as const)', 'for (const k of ["total", "bad", "red", "center", "italic", "underline"] as const)'); }, "②"],
  ["🔴 계약서에서 칸 하나를 뺀다",       (b) => { b[RJ] = b[RJ].replace("  breaks?: number;", ""); }, "③"],
];
let silent = 0;
for (const [name, tf, axisName] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 듯). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axisName}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axisName}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 본다`); silent++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : `✓ 변이 ${MUT.length}종이 모두 제 축을 울렸다`);
process.exit(fails.length || silent ? 1 : 0);
