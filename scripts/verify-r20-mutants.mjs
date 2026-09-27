/**
 * scripts/verify-r20-mutants.mjs — 🔴 **내 R20 자(`verify-r20.mts`)가 제품이 틀리는 순간 우는가**(C · 2026-09-28 · 트리거 R20 §0-E «변이»)
 *
 *   R19 하니스와 같은 모양이다: 제품 **사본**을 한 군데씩 망가뜨리고, 자가 **그 축의 줄머리(`❌ [축]`)로** 우는지 본다.
 *   ① 과녁부터 센다(AC-236) ② 대조군 먼저(AC-161) ③ «울었다»는 그 축으로만(AC-121) ④ 0·1·2 밖 종료는 ⊘(AC-249).
 *   사본: `--tree`(기본 작업 폴더)의 `lib/`·`db/`·`netlify/`·`public/` → 내 나무 안 `.r20-mut-<pid>/` · 끝나면 지운다 · 남의 나무엔 안 쓴다.
 *   변이표 키는 `put`(`to:` 아님 — `verify-mutant-residue` 와 안 겹치게) · 표식 `r20mut`.
 *
 *   쓰는 법: node scripts/verify-r20-mutants.mjs [--db] [--screen] [--only <축|이름 조각>]
 *   종료코드: 0 = 과녁 있는 변이 전부 잡힘 · 1 = 놓침 · 2 = 못 쟀다(대조군 빨강 · 과녁 있는 변이 0 · ⊘ 섞임).
 */
import "./_lib/load-env.mjs";
import { readFileSync, writeFileSync, existsSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const MY = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const TREE = path.resolve(argv.includes("--tree") ? argv[argv.indexOf("--tree") + 1] : process.cwd());
const DB = argv.includes("--db"), SCREEN = argv.includes("--screen");
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : "";
const RULER = "scripts/verify-r20.mts";
const MINE = [RULER, "scripts/_lib/code-only.mjs", "scripts/_lib/load-env.mjs", "scripts/_lib/find-playwright.mjs", "scripts/_teardown.mjs"];
const TSX = path.join(MY, "node_modules", "tsx", "dist", "cli.mjs");

for (const f of MINE) if (!existsSync(path.join(MY, f))) { console.error(`⊘ 못 쟀어요 — 내 자 ${f} 가 없다`); process.exit(2); }
if (!existsSync(TSX)) { console.error("⊘ 못 쟀어요 — tsx 가 없다(npm i)"); process.exit(2); }
if (!existsSync(path.join(TREE, "lib")) || !existsSync(path.join(TREE, "db"))) { console.error(`⊘ 못 쟀어요 — ${TREE} 에 lib/·db/ 가 없다`); process.exit(2); }

const BOX = path.join(MY, `.r20-mut-${process.pid}`);
const cases = [];
/** add(이름, 파일, [[찾을 글자, 넣을 글자], …], 기대 축, 팔 = pure | db | screen) */
const add = (name, file, edits, axis, arm = "pure") => cases.push({ name, file, edits, axis, arm });

/* ═══ slot.seconds — 서버(B) ═══ */
add("서버가 견적 대신 60 을 박으면(다른 식)", "lib/slots.ts",
  [["? pieceSecondsOf({ video: pv }) : estimateVideoSeconds(input.channel, input.settingsVideoSeconds);", "? pieceSecondsOf({ video: pv }) : 60 /*r20mut*/;"]], "slot.seconds", "db");
add("만든 영상의 실제 길이를 버리고 늘 견적으로 가면", "lib/slots.ts",
  [["return pv && isVideoSeconds(pv.seconds) ? pieceSecondsOf", "return false /*r20mut*/ && pv && isVideoSeconds(pv.seconds) ? pieceSecondsOf"]], "slot.seconds", "db");
add("지난(나간) 자리엔 길이를 안 실으면(pw 가지 안으로)", "lib/slots.ts",
  [['    if (o.kind === "shorts") o.videoSeconds = slotVideoSecondsOf(', '    if (o.kind === "shorts" && o.status !== "published" /*r20mut*/) o.videoSeconds = slotVideoSecondsOf(']], "slot.seconds", "db");
add("규칙 화면 길이 표가 60 을 박으면", "lib/slots.ts",
  [["[c, estimateVideoSeconds(c, settingsVideoSeconds)]", "[c, 60 /*r20mut*/]"]], "slot.seconds");

/* ═══ threads.word — 서버(B) ═══ */
add("서버 채널 이름을 «스레드»로 되돌리면", "lib/channel-url.ts", [['threads: "쓰레드"', 'threads: "스레드" /*r20mut*/']], "threads.word");
add("쓰레드 커넥터의 고객 문장 하나를 «스레드»로", "lib/publish/threads.ts", [['error: "쓰레드 로그인이 만료됐어요.', 'error: "스레드 로그인이 만료됐어요. /*r20mut*/']], "threads.word");

/* ═══ 화면·모의(A · main 386e136 의 진짜 글자) — 🔴 브라우저가 읽는 것은 **생성된 화면 파일**이다(정본 `_tpl.txt` 가 아니다) ═══ */
const SCH = "public/app/schedule.html", ACC = "public/app/accounts.html", CS = "public/ops/cs.html", MOCK = "public/js/mock.js", MOCKOPS = "public/js/mock-ops.js";
add("화면 — 편성표 자리 줄에 «· 60초»를 되박으면(서버 videoSeconds 를 안 읽는다)", SCH,
  [["const secSay = (s) => (Number.isFinite(s.videoSeconds) && s.videoSeconds > 0 ? ` · ${s.videoSeconds}초` : \"\");", "const secSay = (s) => (s.kind === \"shorts\" ? \" · 60초\" /*r20mut*/ : \"\");"]], "slot.seconds", "screen");
add("화면 — 규칙 화면의 채널 길이를 60 으로 박으면(videoSecondsByChannel 을 안 읽는다)", SCH,
  [["const vsecOf = (c) => { const v = Number(((D && D.videoSecondsByChannel) || {})[c]);", "const vsecOf = (c) => { const v = 60 /*r20mut*/;"]], "slot.seconds", "screen");
add("화면 — 편당 코인을 VIDEO_COIN[60] 으로 박으면(perPiece)", SCH,
  [["const perPiece = (c) => (isVideoCh(c) ? vcoinOf(vsecOf(c)) : UI.COIN.blog);", "const perPiece = (c) => (isVideoCh(c) ? UI.VIDEO_COIN[60] /*r20mut*/ : UI.COIN.blog);"]], "slot.seconds", "screen");
add("화면 — «건강 점수» 줄을 옛 배치로 되돌리면(단추 최소폭 · 줄바꿈 허용)", ACC,
  [['<div class="kv" style="padding-left:0;padding-right:0;align-items:baseline;gap:12px"><span class="k" style="white-space:nowrap">건강 점수</span><span class="v" style="flex-wrap:wrap;justify-content:flex-end;row-gap:4px;min-width:0"><span style="white-space:nowrap">', '<div class="kv" style="padding-left:0;padding-right:0"><span class="k">건강 점수</span><span class="v"><span /*r20mut*/>'],
   ['id="hre" style="margin-left:8px;min-width:0"', 'id="hre" style="margin-left:8px"']], "health.fit", "screen");
add("화면 — 운영 «내부로 표시된 N곳» 줄 단추의 최소폭을 되살리면", CS,
  [['id="chidt" style="min-width:0;white-space:nowrap"', 'id="chidt" data-r20mut="1"']], "health.fit", "screen");
add("모의 — 채널 표의 쓰레드를 «스레드»로 되돌리면", MOCK, [['threads: "쓰레드"', 'threads: "스레드" /*r20mut*/']], "threads.word");
add("모의 — covered 문장 한 글자를 바꾸면(서버 ≠ 모의)", MOCK, [["용으로 새로 만든 영상이", "용으로 새로 만든 영상은"]], "mock.covered");
add("모의 — ops-tenants 가 숨긴 수를 0 으로 말하면(서버 모양 아님)", MOCKOPS,
  [["hidden: inc ? 0 : base.filter((t) => t.isInternal === true).length", "hidden: 0 /*r20mut*/"]], "mock.internal", "screen");

/* ═══ 돌리기 ═══ */
const run = (withDb, withScreen) => {
  const args = [TSX, path.join(BOX, RULER), ...(withDb ? ["--db"] : []), ...(withScreen ? ["--screen"] : [])];
  try { return { code: 0, out: execFileSync(process.execPath, args, { cwd: BOX, encoding: "utf8", env: { ...process.env, PW_DIR: process.env.PW_DIR || path.join(MY, "runner") }, maxBuffer: 32 << 20 }) }; }
  catch (e) { return { code: e.status ?? -1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const reds = (out) => out.split("\n").filter((l) => l.startsWith("❌"));

console.log(`\n── 내 R20 자에 변이를 넣는다 · 나무 ${TREE} · ${new Date().toISOString()} · ${["순수", DB && "DB", SCREEN && "화면"].filter(Boolean).join(" + ")} ──\n`);
let exit = 0;
try {
  mkdirSync(BOX, { recursive: true });
  for (const d of ["lib", "db", "netlify", "public"]) if (existsSync(path.join(TREE, d))) cpSync(path.join(TREE, d), path.join(BOX, d), { recursive: true });
  for (const f of MINE) { mkdirSync(path.dirname(path.join(BOX, f)), { recursive: true }); cpSync(path.join(MY, f), path.join(BOX, f)); }

  const ctl = run(DB, SCREEN);
  const ctlRed = reds(ctl.out);
  console.log(`${ctlRed.length || ctl.code === 1 ? "⊘" : "✅"} 대조군(안 건드린 사본) — 종료 ${ctl.code} · 빨강 ${ctlRed.length}${ctlRed.length ? ` — 🔴 대조군이 빨가면 변이 판을 못 읽는다: ${ctlRed.slice(0, 2).join(" | ")}` : ""}`);
  if (ctlRed.length || ctl.code === 1) { console.log("\n■ ⊘ 못 쟀다 — 대조군부터 빨강"); exit = 2; }
  else {
    let caught = 0, missed = 0, noTarget = 0, unmeasured = 0;
    const missedLines = [];
    for (const c of cases) {
      if (c.arm === "db" && !DB) continue;
      if (c.arm === "screen" && !SCREEN) continue;
      if (ONLY && !c.name.includes(ONLY) && c.axis !== ONLY) continue;
      const p = path.join(BOX, c.file);
      const orig = existsSync(p) ? readFileSync(p, "utf8") : "";
      const hits = c.edits.map(([find]) => count(orig, find));
      if (hits.some((h) => h === 0)) { noTarget++; console.log(`⊘ [${c.axis}] ${c.name}  — 과녁 0곳(«${c.edits[hits.findIndex((h) => h === 0)][0].slice(0, 60)}» 가 ${c.file} 에 없다) · 셈에서 뺀다`); continue; }
      let mutated = orig;
      for (const [find, put] of c.edits) mutated = mutated.split(find).join(put);
      if (mutated === orig) { noTarget++; console.log(`⊘ [${c.axis}] ${c.name}  — 바꿨는데 글자가 같다`); continue; }
      writeFileSync(p, mutated);
      try {
        /* 변이마다 **그 팔만** 돈다(순수 겹은 늘 돈다) — 전 팔을 매번 돌리면 변이 하나에 시드 집 + 브라우저가 붙어 체인 1번 칸이 16분이 된다(첫 판 실측) */
        const r = run(c.arm === "db", c.arm === "screen");
        const got = reds(r.out);
        const want = `❌ [${c.axis}]`;
        if (r.code === 1 && got.some((l) => l.startsWith(want))) { caught++; console.log(`✅ [${c.axis}] ${c.name}  — 과녁 ${hits.join("+")}곳 · 종료 1 · 그 축이 울었다(${got.filter((l) => l.startsWith(want)).length}줄)`); }
        else if (r.code === 2 && !got.length) { unmeasured++; console.log(`⊘ [${c.axis}] ${c.name}  — 종료 2(자가 «못 쟀다») · 울었다로 안 센다(AC-161)`); }
        else if (![0, 1, 2].includes(r.code)) { unmeasured++; console.log(`⊘ [${c.axis}] ${c.name}  — 종료 ${r.code}(끝까지 못 갔다) · 울었다·안 울었다로 안 센다(AC-249)`); }
        else {
          missed++;
          const why = r.code !== 1 ? `종료 ${r.code} — 안 울었다` : `🔴 엉뚱한 축이 울었다(기대 ${c.axis}): ${got.slice(0, 2).join(" | ")}`;
          missedLines.push(`[${c.axis}] ${c.name} — ${why}`);
          console.log(`❌ [${c.axis}] ${c.name}  — 과녁 ${hits.join("+")}곳 · ${why}`);
        }
      } finally { writeFileSync(p, orig); }
    }
    const total = caught + missed;
    console.log(`\n■ 과녁 있는 변이 ${total} 중 잡음 ${caught} · 놓침 ${missed}  (과녁 0곳 ${noTarget} · ⊘ ${unmeasured} 는 셈 밖)`);
    if (missedLines.length) console.log("   🔴 놓친 것:\n     " + missedLines.join("\n     "));
    exit = missed ? 1 : total ? (unmeasured || noTarget ? 2 : 0) : 2;
  }
} finally {
  rmSync(BOX, { recursive: true, force: true });
}
process.exit(exit);
