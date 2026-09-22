/**
 * scripts/verify-pause-wakes.mjs — 🔴 **까먹어도 깨워 주는가**(DESIGN §5B.11(3)(6) · AC-220 · B 2026-09-23)
 *
 *   ══ 왜 이 자인가 — 사장님 물음이 그대로 명세다 ══
 *     «근데 크론 멈췄다는 걸 **내가 까먹으면** 어떡해?»
 *     멈추는 기능만 만들면 **«쉬는 줄 모르고 몇 달»** 이 된다 — 손님은 돈을 내면서 아무것도 못 받는다. 해지보다 나쁘다.
 *     🔴 그래서 설계가 이 자의 이름을 적어 뒀다: «7일마다 알림이 가는가 · `pause_until` 이 지나면 깨는가».
 *
 *   ══ 재는 것 ══
 *     ① 저절로 깨나 — 기한이 지난 집을 **깨우나** · 깨우며 **밀린 글을 모으나** · 알림에 **수를 적나**
 *     ② 7일마다   — «내가 켤 때까지»인 집에 **7일마다** 알리나 · `pause_notified_at` 으로 **멱등**인가
 *     ③ 하루 전   — 자동으로 깰 집에 **하루 전** 예고하나
 *     ④ 말투     — 🔴 **겁주지 않나**(§3) · 시스템 낱말이 없나
 *     ⑤ 🔴 셈    — 판정을 **실제로 돌려** 본다: 7일이 안 됐으면 안 알리고, 지나면 알린다(경계 표본)
 *
 *   🔴 ⑤가 이 자의 값이다 — «그 글자가 있나»가 아니라 **«그 날짜에 정말 알리나»**를 잰다.
 *      판정식을 소스에서 떼어 돌린다(과녁을 제품 밖에 두지 않는다).
 *   `--mutants` = 🔴 **«깨우기를 지우면 우는가»** — 메인이 콕 집어 요구한 변이다.
 *   종료코드: 0 = 깨워 준다 · 1 = 안 깨운다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { codeOnly } from "./_lib/code-only.mjs";
import { blockOf } from "./_lib/block.mjs";

const ROOT = process.cwd();
const WATCH = "lib/cron/pause-watch.ts", RUNNER = "lib/cron/runner.ts", PAUSE = "lib/tenant-pause.ts";
const FILES = [WATCH, RUNNER, PAUSE];

const rawRead = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const read = (f) => { const t = rawRead(f); return t === null ? null : codeOnly(t); };   // 🔴 주석을 걷는다(AC-191)

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const gone = FILES.filter((f) => T[f] === null);
if (gone.length) { console.error(`⊘ 못 쟀어요 — ${gone.join(", ")} 가 없다.`); process.exit(2); }

/* ───────── 0. 🔴 **등록돼 있나** — 안 돌면 나머지 축은 전부 헛것이다 ───────── */
notes.push("■ ⓪ 등록 — 만들어 놓고 **아무도 안 도는** 스텝이 아닌가(조용한 누락 · PITFALLS #7)");
{
  /* 🔴 처음엔 `/pauseWatchStep/` 를 **파일 전체**에 걸었다가 변이가 조용했다 — 목록에서 빼도 **수입 줄에 이름이 남기** 때문이다.
     «등록돼 있다»는 «이름이 파일 어딘가에 있다»가 아니라 «**그 목록 안에 있다**»이다. ⇒ `STEPS` 덩이 안에서만 본다. */
  const reg = blockOf(T[RUNNER], "export const STEPS", ["\n];"]);
  if (!reg) unk("⓪", "`STEPS` 목록을 못 찾았다");
  else (/pauseWatchStep/.test(reg.body) ? ok : bad)("⓪", "🔴 우산 `STEPS` **목록 안에** 있다(이게 없으면 아래 초록이 전부 거짓이다)");
  (/every: "hourly"/.test(T[WATCH]) ? ok : bad)("⓪", "매시 돈다(설계 (3) `pauseWatchStep`(hourly))");
}

/* ───────── ① 저절로 깨나 ───────── */
notes.push("■ ① 저절로 깨나 — 기한이 지나면");
{
  const wake = blockOf(T[WATCH], "if (until && until.getTime() <= now.getTime())", ["return {"]);
  if (!wake) unk("①", "깨우는 갈래를 못 찾았다");
  else {
    (/paused_at = NULL/.test(wake.body) ? ok : bad)("①", "칸을 비워 **깨운다**");
    (/holdBacklog/.test(wake.body) ? ok : bad)("①", "🔴 깨우며 **밀린 글을 모은다**(안 모으면 그 틱에 한꺼번에 나간다)");
    (/countBacklog/.test(wake.body) ? ok : bad)("①", "🔴 **수를 센다** — 안 세면 알림에 «N건»을 못 적는다");
    (/INSERT INTO notifications/.test(wake.body) ? ok : bad)("①", "깼다고 **알린다**(조용히 깨면 까먹는 것과 같다)");
    (/\$\{total\}건/.test(wake.body) ? ok : bad)("①", "🔴 알림 본문에 **밀린 글 수**가 들어간다(안 적으면 손님은 그 글들이 **사라진 줄** 안다)");
  }
}

/* ───────── ② 7일마다 — 🔴 사장님 «까먹으면?» 의 자리 ───────── */
notes.push("■ ② 7일마다 — «내가 켤 때까지»인 집에");
{
  (/PAUSE_REMIND_DAYS = 7/.test(T[WATCH]) ? ok : bad)("②", "🔴 **7일**이 상수로 있다(설계 (3))");
  /* 🔴 끝 표식을 `"return {"` 으로 잡았다가 **거짓 빨강**을 받았다 — 그 갈래의 **첫 줄이 이른 `return`**(«아직 7일이 안 됐다»)이라
     덩이가 거기서 끊겨 뒤의 알림·찍기를 못 봤다. 제품은 멀쩡했다.
     ⇒ 갈래의 **닫는 괄호**(그 들여쓰기)로 끊는다. 어제 배운 그대로 — «넓혀서» 고치지 않고 **경계를 바로** 잡는다. */
  const still = blockOf(T[WATCH], "if (!until) {", ["\n    }"]);
  if (!still) unk("②", "«내가 켤 때까지» 갈래를 못 찾았다");
  else {
    /* 🔴 **«그 갈래가 정말 보내나»를 먼저 본다** — 멱등만 재다가, 알림 자체를 딴 이름으로 바꾼 변이가 조용했다.
       `kind` 는 장식이 아니다: 알림함이 그 이름으로 묶고 화면이 그 이름으로 고른다. 바뀌면 **손님에게 안 닿는다**. */
    (/INSERT INTO notifications/.test(still.body) ? ok : bad)("②", "🔴 그 갈래가 **실제로 알린다**");
    (/\$\{"pause_still"\}/.test(still.body) ? ok : bad)("②", "🔴 알림 이름이 `pause_still` 이다(이름이 바뀌면 알림함에서 길을 잃는다)");
    (/pause_notified_at/.test(still.body) ? ok : bad)("②", "🔴 `pause_notified_at` 으로 **멱등**이다(없으면 매시 알림이 나간다)");
    (/\?\? pausedAt/.test(still.body) ? ok : bad)("②", "🔴 **한 번도 안 알린 집**은 `paused_at` 부터 센다(NULL 을 «방금 알렸다»로 읽지 않는다)");
    (/UPDATE tenants SET pause_notified_at = NOW\(\)/.test(still.body) ? ok : bad)("②", "알린 뒤 **찍는다**(안 찍으면 멱등이 안 돈다)");
  }
}

/* ───────── ③ 하루 전 ───────── */
notes.push("■ ③ 하루 전 — 자동으로 깰 집에 예고하나");
{
  const soon = blockOf(T[WATCH], "if (until && until.getTime() - now.getTime() <= DAY_MS)", ["\n    }"]);   // 🔴 위와 같은 까닭(이른 `return`)
  if (!soon) unk("③", "하루 전 갈래를 못 찾았다");
  else {
    (/pause_wake_soon/.test(soon.body) ? ok : bad)("③", "«내일 다시 시작해요»를 보낸다");
    (/pause_notified_at/.test(soon.body) ? ok : bad)("③", "매시 보내지 않는다(같은 멱등 키를 쓴다)");
  }
}

/* ───────── ④ 말투 — 🔴 겁주지 않는다(§3) ───────── */
notes.push("■ ④ 말투 — 🔴 겁주지 않는다 · 시스템 낱말 0(CLAUDE §3)");
{
  const says = [...T[WATCH].matchAll(/\$\{"([^"]{4,})"\}/g)].map((m) => m[1]);
  const body = says.join(" ") + " " + [...T[WATCH].matchAll(/\$\{`([^`]{4,})`\}/g)].map((m) => m[1]).join(" ");
  if (!says.length) unk("④", "손님에게 가는 문장을 하나도 못 떼었다(모수 0 을 통과로 쓰지 않는다)");
  else {
    /* 🔴 §3 «겁주지 않는다» — 위협·책임 전가·겁주는 조건절. 이 목록은 CLAUDE §3 의 금지어 그대로다. */
    const SCARY = /정지됩니다|불이익|책임입니다|알려만|줄어들|손해|위험합니다|삭제됩니다/;
    (SCARY.test(body) ? bad : ok)("④", `겁주는 말이 없다(문장 ${says.length}개를 봤다)`);
    /* 🔴 시스템 용어 — 손님은 «테넌트»·«크론»·«스텝»을 모른다. */
    const SYS = /테넌트|크론|스텝|잡\b|piece|slot|status/i;
    (SYS.test(body) ? bad : ok)("④", "시스템 낱말이 없다");
    (/언제든 다시 시작할 수 있어요/.test(body) ? ok : bad)("④", "🔴 **되돌릴 길을 함께 말한다**(§9-③)");
  }
}

/* ───────── ⑤ 🔴 셈 — 판정을 **실제로 돌린다** ───────── */
notes.push("■ ⑤ 셈 — «7일이 됐나»를 **실제로 돌려** 본다(글자 대조가 아니다)");
{
  const m = /if \(now\.getTime\(\) - last\.getTime\(\) < (PAUSE_REMIND_DAYS \* DAY_MS)\)/.exec(T[WATCH]);
  const days = /PAUSE_REMIND_DAYS = (\d+)/.exec(T[WATCH]);
  const dayMs = /const DAY_MS = (\d+_?\d*)/.exec(T[WATCH]);
  if (!m || !days || !dayMs) unk("⑤", `판정식을 못 떼었다(${!m ? "조건" : !days ? "7일" : "DAY_MS"})`);
  else {
    /* 🔴 **상수도 제품에서 떼어 온다** — 자가 숫자를 적으면 제품이 바꿔도 이 축은 옛 값으로 계속 초록이다. */
    const quiet = new Function("nowMs", "lastMs",
      `const PAUSE_REMIND_DAYS = ${days[1]}; const DAY_MS = ${dayMs[1]}; return nowMs - lastMs < ${m[1]};`);
    const D = 86400_000;
    const CASES = [
      ["6일째는 **안 알린다**",      6 * D, true],
      ["🔴 7일이 되면 **알린다**",   7 * D, false],
      ["8일째도 알린다",             8 * D, false],
      ["방금 알렸으면 안 알린다",    60_000, true],
    ];
    for (const [name, gap, wantQuiet] of CASES) {
      const got = quiet(gap, 0);
      (got === wantQuiet ? ok : bad)("⑤", `${name} — 기대 ${wantQuiet ? "조용" : "알림"} · 나온 것 ${got ? "조용" : "알림"}`);
    }
  }
}

/* ───────── 찍기 ───────── */
console.log("─".repeat(100));
console.log(`까먹어도 깨워 주는가 — 축 ${notes.filter((l) => /^  [✓✗⊘]/.test(l)).length}개 · 어긋난 곳 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-pause-wakes.mjs");
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-wake-"));
  try {
    const box = {}; for (const f of FILES) box[f] = rawRead(f);
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of Object.keys(box)) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    for (const sub of [["scripts", "_lib", "code-only.mjs"], ["scripts", "lib", "block.mjs"]]) {
      mkdirSync(path.join(dir, ...sub.slice(0, -1)), { recursive: true });
      writeFileSync(path.join(dir, ...sub), readFileSync(path.join(ROOT, ...sub), "utf8"));
    }
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 · AC-161)");
const ctrl = runIn(null);
if (ctrl.code !== 0) { console.log("  ⊘ 못 쟀음 — 대조군(맨 판)이 이미 빨갛다."); console.log(ctrl.out.split("\n").filter((l) => /✗|⊘/.test(l)).slice(0, 6).join("\n")); process.exit(2); }
console.log("  ✓ 대조군(맨 판) 초록");
const MUT = [
  /* 🔴 **메인이 콕 집어 요구한 변이** — «깨우기를 지우면 우는가». 사장님 «까먹으면?» 의 자다. */
  ["🔴 깨우기를 통째로 지운다",      (b) => { b[WATCH] = b[WATCH].replace("      await q(sql`UPDATE tenants SET paused_at = NULL, pause_until = NULL, pause_reason = NULL, pause_notified_at = NULL, updated_at = NOW()\n        WHERE id = ${ctx.tid}`);", ""); }, "①"],
  ["🔴 스텝을 우산에서 뺀다",        (b) => { b[RUNNER] = b[RUNNER].replace("  pauseWatchStep,", ""); }, "⓪"],
  ["🔴 7일 알림을 지운다",           (b) => { b[WATCH] = b[WATCH].replace('VALUES (${ctx.tid}, ${"pause_still"}', 'VALUES (${ctx.tid}, ${"zz_gone"}'); }, "②"],
  ["🔴 알림 멱등을 뗀다",            (b) => { b[WATCH] = b[WATCH].replace("      await q(sql`UPDATE tenants SET pause_notified_at = NOW(), updated_at = NOW() WHERE id = ${ctx.tid}`);\n      return { changed: 1, skipped: 0, detail: { reminded: true, days: view.days } };", "      return { changed: 1, skipped: 0, detail: { reminded: true, days: view.days } };"); }, "②"],
  ["🔴 한 번도 안 알린 집을 «방금 알렸다»로 읽는다", (b) => { b[WATCH] = b[WATCH].replace("utcDate(t?.pause_notified_at) ?? pausedAt", "utcDate(t?.pause_notified_at) ?? now"); }, "②"],
  ["🔴 7일을 30일로 늘린다",         (b) => { b[WATCH] = b[WATCH].replace("PAUSE_REMIND_DAYS = 7", "PAUSE_REMIND_DAYS = 30"); }, "⑤"],
  ["하루 전 예고를 지운다",          (b) => { b[WATCH] = b[WATCH].replace('${"pause_wake_soon"}', '${"zz_gone2"}'); }, "③"],
  ["밀린 글 수를 알림에서 뺀다",      (b) => { b[WATCH] = b[WATCH].replace("`쉬는 동안 발행 시각이 지난 글 ${total}건을 그대로 두었어요. 차례로 올릴지, 그냥 둘지 고르실 수 있어요.`", '"다시 시작했어요."'); }, "①"],
  ["🔴 겁주는 말을 넣는다",          (b) => { b[WATCH] = b[WATCH].replace("언제든 다시 시작할 수 있어요.", "이대로 두시면 수익이 줄어들어요."); }, "④"],
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
