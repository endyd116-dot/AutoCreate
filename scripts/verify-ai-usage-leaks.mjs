/**
 * scripts/verify-ai-usage-leaks.mjs — 🔴 **돈이 나가는 길에 «기록 없는 return» 이 있나**(B 2026-09-21 · 메인 지시)
 *
 *   ══ 왜 이 자인가 ══
 *   `recordAiUsage` 가 **성공 경로에만** 있었다. 실패하면 그냥 `return`/`continue` 라 `ai_usage` 에 **한 줄도 안 남았다.**
 *   그래서 ① «몇 번 헛돌았나»를 셀 수 없었고 ② `checkAiCostCap`(= `SUM(cost_usd)`)이 그만큼을 **못 봤다.**
 *
 *   🔴 **제일 나쁜 두 자리**: 제공사가 **영상을 다 만들어 준 뒤** 우리가 못 받아 오거나(다운로드) 못 넣은(R2) 경우.
 *      그건 «제공사 실패»가 아니라 **우리 쪽 사고**라 **확실히 청구된다.** 그게 통째로 안 보였다.
 *
 *   🔴 그리고 이건 **영상만의 문제가 아니었다**(메인이 짚었다 — 재 보니 맞았다):
 *      · 글(`lib/ai.ts`)   — **이미 막혀 있었다**(`${purpose}:fail` · 이 규약을 그대로 따랐다)
 *      · 이미지(`lib/ai-image.ts`) — 🔴 **샜다.** 체인을 돌며 모델마다 실패해도 한 줄도 안 남았다
 *      · TTS(`lib/video/tts-typecast.ts`) — 🔴 **샜다.** 합성 끝나고 다운로드만 실패한 자리까지
 *
 *   ══ 재는 것 ══
 *     ① 자리    — 여섯 자리가 **실제로 기록하나**(사유를 갈라서)
 *     ② 「모름」 — 🔴 **청구 여부·금액을 모르면 0 이 아니라 NULL** 이다(AC-9). 아는 자리만 숫자를 적나
 *     ③ 관문    — 🔴 **합을 안 건드리나**(메인 지시 «새 자리는 세기만») — 새 행은 `costUsd: 0` · 관문은 `cost_usd` 만 본다
 *     ④ 칸      — DDL 과 `schema.ts` 가 같은 칸을 말하나
 *     ⑤ 🔴 훑기 — **그 밖에 «기록 없이 빠져나가는 실패»가 또 있나**(돈 쓰는 파일 전수 · 새로 생기면 여기서 잡힌다)
 *
 *   🔴 부정형 단언을 안 쓴다 — ②는 «그 자리에 `costUsdMaybe` 가 **없다**»를 재야 해서 부정형이 된다.
 *      그래서 **과녁을 제품 밖에 두지 않고** 「그 호출 덩이 안에 `failKind: "provider_failed"` 가 **있다**」를 먼저 확인한 뒤
 *      그 덩이 안에서만 금액 유무를 본다 — 과녁이 사라지면 ①축이 먼저 운다.
 *
 *   `--mutants` = 제품 사본에 변이를 넣고 이 자를 다시 돌려 **내가 정말 무는지** 본다.
 *   종료코드: 0 = 안 샌다 · 1 = 새는 곳이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
const rawRead = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
/* 🔴 주석을 걷고 본다 — AC-191(내가 쓴 제품 주석이 과녁에 걸려 거짓 초록을 만든다). */
const read = (f) => { const t = rawRead(f); return t === null ? null : codeOnly(t); };
const VID = "lib/video/providers/index.ts", IMG = "lib/ai-image.ts", TTS = "lib/video/tts-typecast.ts";
const AI = "lib/ai.ts", CAP = "lib/billing/ai-cost-cap.ts", SCH = "db/schema.ts", DDL = "drizzle/0084-ai-usage-fail.sql";
const FILES = [VID, IMG, TTS, AI, CAP, SCH, DDL];

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const warn = (ax, m) => notes.push(`  △ ${ax} ${m}`);
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const gone = FILES.filter((f) => T[f] === null);
if (gone.length) { console.error(`⊘ 못 쟀어요 — ${gone.join(", ")} 가 없다.`); process.exit(2); }

/* ───────── ① 자리 — 여섯 자리가 실제로 기록하나 ───────── */
notes.push("■ ① 자리 — 돈이 나간 뒤 빠져나가는 길이 **사유를 갈라** 기록하나");
const SITES = [
  ["영상: 제공사 실패 → 폴백",   VID, /failKind: "provider_failed"/],
  ["🔴 영상: 다 만들어졌는데 못 받음", VID, /failKind: "download_failed"/],
  ["🔴 영상: 다 받고 저장 실패", VID, /failKind: "store_failed"/],
  ["이미지: 모델 호출 실패",     IMG, /purpose: "image:fail"/],
  ["TTS: 합성 요청 거절",        TTS, /failKind: "http"/],
  ["🔴 TTS: 합성 끝나고 못 받음", TTS, /failKind: "download_failed"/],
  ["글은 원래 막혀 있었다(규약 출처)", AI, /purpose: okEff \? a\.purpose : `\$\{a\.purpose\}:fail`/],
];
for (const [name, f, re] of SITES) (re.test(T[f]) ? ok : bad)("①", name);

/* ───────── ② 「모름」을 0으로 적지 않나 ─────────
   🔴 과녁을 «없음»에 두지 않으려고, **그 호출 덩이를 먼저 찾고**(있어야 한다) 그 안에서만 금액 유무를 본다. */
notes.push("■ ② 「모름」 — 🔴 청구 여부·금액을 모르면 **0 이 아니라 NULL**(AC-9)");
function callBlock(text, needle) {
  const i = text.indexOf(needle);
  if (i < 0) return null;
  const s = text.lastIndexOf("recordAiUsage({", i);
  if (s < 0) return null;
  const e = text.indexOf("});", i);
  return e < 0 ? null : text.slice(s, e);
}
const MONEY = [
  ["영상 provider_failed — 금액 모름",  VID, 'failKind: "provider_failed"', false],
  ["영상 download_failed — 금액 안다",  VID, 'failKind: "download_failed"', true],
  ["영상 store_failed — 금액 안다",     VID, 'failKind: "store_failed"',    true],
  ["TTS download_failed — 금액 안다",   TTS, 'failKind: "download_failed"', true],
  ["TTS http — 금액 모름",              TTS, 'failKind: "http"',            false],
];
for (const [name, f, needle, wantAmount] of MONEY) {
  const blk = callBlock(T[f], needle);
  if (!blk) { bad("②", `${name} — 그 기록 자체를 못 찾았다(①축이 먼저 운다)`); continue; }
  const has = /costUsdMaybe:/.test(blk);
  if (has === wantAmount) ok("②", `${name} — ${wantAmount ? "숫자를 적는다" : "금액을 안 적는다(NULL)"}`);
  else bad("②", `${name} — ${wantAmount ? "숫자를 적어야 하는데 안 적는다" : "🔴 모르는데 금액을 적는다(0/숫자로 뭉갠다)"}`);
}
(/costUsdMaybe === undefined \|\| row\.costUsdMaybe === null/.test(T[AI]) ? ok : bad)("②", "🔴 기록 함수가 `?? 0` 으로 접지 않는다(모름 → NULL)");

/* ───────── ③ 관문 — 합을 안 건드리나 ───────── */
notes.push("■ ③ 관문 — 🔴 **합을 지금은 안 건드린다**(메인 지시 «새 자리는 세기만»)");
(/COALESCE\(SUM\(cost_usd\), 0\)/.test(T[CAP]) ? ok : bad)("③", "관문은 `cost_usd` 만 합한다(= 새 칸을 안 읽는다)");
{
  /* 새 기록들이 전부 `costUsd: 0` 인가 — 하나라도 실비용을 넣으면 그 순간 관문이 움직인다. */
  const blocks = [VID, IMG, TTS].flatMap((f) => [...T[f].matchAll(/recordAiUsage\(\{[\s\S]*?\}\)/g)].map((m) => m[0]));
  const failBlocks = blocks.filter((b) => /failKind:/.test(b));
  const moved = failBlocks.filter((b) => !/costUsd: 0/.test(b));
  if (!failBlocks.length) bad("③", "실패 기록을 하나도 못 찾았다");
  else if (moved.length) bad("③", `실패 기록 ${moved.length}건이 \`costUsd\` 에 값을 넣는다 — 관문이 조용히 움직인다`);
  else ok("③", `실패 기록 ${failBlocks.length}건 모두 \`costUsd: 0\`(관문 합 무영향)`);
}

/* ───────── ④ 칸 — DDL 과 schema.ts 가 같은 말을 하나 ───────── */
notes.push("■ ④ 칸 — DDL 과 `schema.ts` 가 같은 칸을 말하나(CLAUDE §4.4 «DDL 적용과 동시에»)");
for (const col of ["fail_kind", "cost_usd_maybe"]) {
  const inDdl = new RegExp(`ADD COLUMN IF NOT EXISTS ${col}\\b`).test(T[DDL]);
  const inSch = new RegExp(`"${col}"`).test(T[SCH]);
  (inDdl && inSch ? ok : bad)("④", `${col} — DDL ${inDdl ? "있다" : "없다"} · schema.ts ${inSch ? "있다" : "없다"}`);
}

/* ───────── ⑤ 🔴 훑기 — 그 밖에 «기록 없이 빠져나가는 실패» ─────────
   돈 쓰는 파일에서 `return { ok: false` 를 다 찾아, **앞 12줄 안에** `recordAiUsage` 가 있나 본다.
   🔴 **돈을 안 쓴 실패는 세면 안 된다** — 키가 없거나 저장소 미설정이면 **호출 자체를 안 했다**. 아래 목록이 그 예외다.
      예외는 «사유 글자»로 적는다(줄 번호로 적으면 줄이 밀릴 때마다 거짓이 된다). */
notes.push("■ ⑤ 🔴 훑기 — 그 밖에 «기록 없이 빠져나가는 실패» 가 또 있나");
/* 🔴 **이미 까닭을 확인한 자리**는 여기 적는다 — 안 적으면 이 축이 늘 9곳을 물고, 늘 빨간 자는 아무도 안 본다(AC-95).
   🔴 **줄 번호로 적지 않는다**(줄이 밀리면 거짓이 된다) — «어느 파일의 어떤 글자»로 적는다.
   새 자리가 생기면 여기 없으므로 **빨개진다.** 그게 이 축의 값이다. */
const ALLOW = [
  [VID, "fal_failed",       "`callProvider` 안쪽이다 — **부르는 쪽**(`generateClip`)이 `!r.ok` 로 받아 `provider_failed` 로 적는다"],
  [VID, 'r2Put(key, buf,',  "스텁 갈래(`videoStub()`)의 자리 채움 바이트 — provider 호출 0 · 돈 0"],
  [VID, 'r2Put(key, png,',  "정지 컷 **스텁** 갈래(1×1 PNG) — 돈 0"],
  [IMG, "gemini_error_",    "`callImageModel` 안쪽 — 부르는 쪽이 `image:fail`(`http`)로 적는다"],
  [IMG, "empty_image",      "`callImageModel` 안쪽 — 부르는 쪽이 `image:fail`(`empty`)로 적는다"],
  [IMG, "AbortError",       "`callImageModel` 안쪽 — 부르는 쪽이 `image:fail`(`timeout`)로 적는다"],
  [TTS, "읽을 대본이 없습니다", "**호출 전** 가드 — 타입캐스트를 안 부른다 · 돈 0"],
  [TTS, "R2 미설정",         "**호출 전** 가드 — 돈 0"],
  [TTS, "TYPECAST_API_KEY", "**호출 전** 가드(키가 없다) — 돈 0"],
];
const NO_MONEY = /no_api_key|r2_not_configured|no_provider_available|no_model|not_configured|policyBlocked/;
const seen = [], fresh = [];
for (const f of [VID, IMG, TTS]) {
  const lines = T[f].split(String.fromCharCode(10));
  lines.forEach((ln, i2) => {
    if (!/return \{ ok: false/.test(ln)) return;
    if (NO_MONEY.test(ln)) return;                                   // 호출 전에 끊은 것 = 돈 0
    const back = lines.slice(Math.max(0, i2 - 12), i2 + 1).join(String.fromCharCode(10));
    if (/recordAiUsage/.test(back)) return;                           // 바로 앞에서 기록했다
    const a = ALLOW.find(([af, m]) => af === f && ln.includes(m));
    (a ? seen : fresh).push(a ? `${f} «${a[1]}» — ${a[2]}` : `${f}:${i2 + 1} ${ln.trim().slice(0, 100)}`);
  });
}
if (fresh.length) {
  bad("⑤", `🔴 **까닭이 안 적힌** «기록 없이 빠져나가는 실패» ${fresh.length}곳 — 돈을 썼는지 보고, 안 썼으면 ALLOW 에 까닭과 함께 적어라:`);
  for (const s2 of fresh) notes.push(`      · ${s2}`);
} else ok("⑤", `«기록 없이 빠져나가는 실패» ${seen.length}곳 전부 까닭이 적혀 있다(새 것 0)`);
/* 🔴 **적어 뒀다고 없어지지 않는다** — 확인한 자리도 매번 찍는다(`api-callers.json` 의 그 규율). */
for (const s2 of seen) notes.push(`      · 확인함 — ${s2}`);
/* 🔴 그리고 **ALLOW 가 낡으면 그것도 신호다** — 과녁이 사라지면 그 줄은 공짜로 참이 된다. */
{
  const stale = ALLOW.filter(([af, m]) => !T[af].includes(m));
  (stale.length ? bad : ok)("⑤", stale.length ? `낡은 ALLOW ${stale.length}줄 — 그 글자가 제품에 없다(${stale.map((x) => x[1]).join(", ")})` : `ALLOW ${ALLOW.length}줄 모두 제품에 과녁이 살아 있다`);
}

/* ───────── 찍기 ───────── */
console.log("─".repeat(100));
console.log(`원장이 못 세던 돈 — 축 ${notes.filter((l) => /^  [✓✗⊘△]/.test(l)).length}개 · 새는 곳 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 — 제품 무접촉(사본에서만) ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-ai-usage-leaks.mjs");
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-leak-"));
  try {
    const box = {}; for (const f of FILES) box[f] = rawRead(f);   // 🔴 사본엔 **원문**(주석 걷은 것을 쓰면 그게 변이다 · AC-191)
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
const MUT = [
  ["영상 폴백 기록을 뗀다",          (b) => { b[VID] = b[VID].replace(/void recordAiUsage\(\{[^}]*failKind: "provider_failed"[\s\S]*?\}\);/, ""); }, "①"],
  ["🔴 다운로드 실패 기록을 뗀다",   (b) => { b[VID] = b[VID].replace(/void recordAiUsage\(\{[^}]*failKind: "download_failed"[\s\S]*?\}\);/, ""); }, "①"],
  ["이미지 기록을 뗀다",             (b) => { b[IMG] = b[IMG].replace(/void recordAiUsage\(\{[^}]*purpose: "image:fail"[\s\S]*?\}\);/, ""); }, "①"],
  ["🔴 모르는데 금액을 적는다",      (b) => { b[VID] = b[VID].replace('costUsd: 0, failKind: "provider_failed"', 'costUsd: 0, costUsdMaybe: 0, failKind: "provider_failed"'); }, "②"],
  ["아는 금액을 안 적는다",          (b) => { b[TTS] = b[TTS].replace(/, costUsdMaybe: chars \* TYPECAST_USD_PER_CHAR/, ""); }, "②"],
  ["🔴 기록 함수가 모름을 0으로 접는다", (b) => { b[AI] = b[AI].replace("row.costUsdMaybe === undefined || row.costUsdMaybe === null", "false"); }, "②"],
  ["🔴 실패 기록이 관문 합을 움직인다", (b) => { b[VID] = b[VID].replace('costUsd: 0, failKind: "download_failed", costUsdMaybe: billed', 'costUsd: billed, failKind: "download_failed", costUsdMaybe: billed'); }, "③"],
  ["schema.ts 에서 칸을 뺀다",       (b) => { b[SCH] = b[SCH].replace('numeric("cost_usd_maybe", { precision: 10, scale: 6 })', "numeric(\"zz_gone\", { precision: 10, scale: 6 })"); }, "④"],
];
let silent = 0;
for (const [name, tf, axis] of MUT) {
  const r = runIn(tf);
  if (!r.changed) { console.log(`  ⊘ ${name} — 🔴 **변이가 안 먹었다**(과녁 글자가 바뀐 듯). 통과로 세지 않는다.`); silent++; continue; }
  const cried = r.code !== 0 && new RegExp(`✗ ${axis}`).test(r.out);
  if (cried) console.log(`  ✓ ${name} → ${axis}축이 운다`);
  else { console.log(`  ✗ ${name} → 🔴 **안 운다**(종료 ${r.code}) — 이 자가 그 자리를 못 본다`); silent++; }
}
console.log("─".repeat(100));
console.log(silent ? `🔴 변이 ${silent}종이 안 울었다 — 자를 고쳐야 한다` : `✓ 변이 ${MUT.length}종이 모두 제 축을 울렸다`);
process.exit(fails.length || silent ? 1 : 0);
