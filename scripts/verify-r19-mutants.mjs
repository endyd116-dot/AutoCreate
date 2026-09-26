/**
 * scripts/verify-r19-mutants.mjs — 🔴 **내 R19 자(`verify-r19.mts`)가 제품이 틀리는 순간 우는가**(C · 2026-09-27 · 트리거 R19 §0-E «변이(울어야 한다)»)
 *
 *   ══ 왜 ══
 *   §0-E 는 축마다 «이렇게 망가뜨리면 울어야 한다»를 적었다. 이 하니스가 그 줄들을 **실제로** 넣는다 —
 *   제품의 **사본**을 한 군데씩 망가뜨리고, 자가 **그 축의 줄머리(`❌ [축]`)로** 우는지 본다(R18 하니스와 같은 모양 · AC-121).
 *
 *   ══ 🔴 지키는 넷(R18 하니스 그대로) ══
 *     ① **과녁부터 센다**(AC-236) — 바꿀 글자가 사본에 없으면 그 변이는 셈에서 뺀다(잡은 것도 놓친 것도 아니다).
 *     ② **대조군 먼저**(AC-161) — 안 건드린 사본에서 ❌ 0 이어야 변이 판을 읽는다.
 *     ③ **«울었다»는 그 축으로만** — 종료 1 **그리고** `❌ [기대 축]` 줄이 있어야 «잡았다». 종료 2 는 «울었다»가 아니다.
 *     ④ 0·1·2 밖 종료(시간 초과·신호)는 ⊘ «끝까지 못 갔다» — «안 울었다»로 세지 않는다(AC-249).
 *
 *   ══ 사본은 어디에 ══
 *   `--tree <경로>`(기본: 작업 폴더)의 `lib/`·`db/`·`netlify/`·`public/` 를 **내 나무 안** `.r19-mut-<pid>/` 에 복사한다
 *   (내 `node_modules` 가 풀리게). 🔴 남의 나무에는 한 글자도 안 쓴다 · 끝나면(성공·실패·예외) 사본을 지운다.
 *   🔴 변이표의 키는 `put` 이다(`to:` 아님 — `verify-mutant-residue` 가 `to: "…"` 글자를 제품에서 찾는다 · 이 하니스는 사본만 고친다). 표식 `r19mut`.
 *
 *   쓰는 법:
 *     node scripts/verify-r19-mutants.mjs                 ← 순수 변이(DB 0 · 돈 0 · 네트워크 0)
 *     node scripts/verify-r19-mutants.mjs --db            ← + DB 변이(yt.project · yt.rolling — 변이마다 시드 집 둘 → 치운다)
 *     node scripts/verify-r19-mutants.mjs --screen        ← + 화면 변이(브라우저 · piece.html 의 «준비 중» 갈래) · 대조군도 --screen 으로 돈다
 *     node scripts/verify-r19-mutants.mjs --tree ../AutoCreate-B2 --only yt.calls
 *   종료코드: 0 = 과녁 있는 변이 **전부** 잡힘 · 1 = 놓친 변이가 있다 · 2 = 못 쟀다(대조군 빨강 · 과녁 있는 변이 0 · ⊘ 섞임).
 */
import "./_lib/load-env.mjs";
import { readFileSync, writeFileSync, existsSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const MY = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const TREE = path.resolve(argv.includes("--tree") ? argv[argv.indexOf("--tree") + 1] : process.cwd());
const DB = argv.includes("--db");
const SCREEN = argv.includes("--screen");   /* 화면 겹 — 브라우저로 piece.html 을 읽는 변이 */
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : "";
const RULER = "scripts/verify-r19.mts";
const MINE = [RULER, "scripts/_lib/code-only.mjs", "scripts/_lib/load-env.mjs", "scripts/_lib/find-playwright.mjs", "scripts/_teardown.mjs"];
const TSX = path.join(MY, "node_modules", "tsx", "dist", "cli.mjs");
const YT = "lib/publish/youtube.ts", PO = "lib/publish-one.ts", REUSE = "lib/video/reuse.ts", ACC = "lib/accounts.ts", MOCK = "public/js/mock.js";

for (const f of MINE) if (!existsSync(path.join(MY, f))) { console.error(`⊘ 못 쟀어요 — 내 자 ${f} 가 없다`); process.exit(2); }
if (!existsSync(TSX)) { console.error("⊘ 못 쟀어요 — tsx 가 없다(npm i)"); process.exit(2); }
if (!existsSync(path.join(TREE, "lib")) || !existsSync(path.join(TREE, "db"))) { console.error(`⊘ 못 쟀어요 — ${TREE} 에 lib/·db/ 가 없다`); process.exit(2); }

const BOX = path.join(MY, `.r19-mut-${process.pid}`);
const cases = [];
/** add(이름, 파일, [[찾을 글자, 넣을 글자], …], 기대 축, 팔) — `find` 는 정확히 그 글자. 여러 겹이면 전부 과녁이 있어야 한다. */
const add = (name, file, edits, axis, arm = "pure") => cases.push({ name, file, edits, axis, arm });

/* ═══ yt.project · yt.rolling — 🔴 DB 팔(진짜 함수를 라이브에서) ═══ */
const COUNT_SQL = "WHERE action = 'youtube.insert_call' AND created_at > NOW() - interval '24 hours'`";
add("집 단위로 세면(한 집 것만 센다 — `tenant_id =` 를 넣는다)", YT,
  [[COUNT_SQL, "WHERE action = 'youtube.insert_call' AND tenant_id = (SELECT max(tenant_id) FROM audit_logs WHERE action = 'youtube.insert_call') /*r19mut*/ AND created_at > NOW() - interval '24 hours'`"]], "yt.project", "db");
add("KST 달력으로 되돌리면(오늘 KST 자정부터 센다)", YT,
  [[COUNT_SQL, "WHERE action = 'youtube.insert_call' AND created_at >= (date_trunc('day', NOW() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul') /*r19mut*/`"]], "yt.rolling", "db");
add("UTC 달력(`date_trunc`)으로 세면", YT,
  [[COUNT_SQL, "WHERE action = 'youtube.insert_call' AND created_at >= date_trunc('day', NOW()) /*r19mut*/`"]], "yt.rolling", "db");

/* ═══ yt.calls — 부를 때마다 한 번(실패 포함) ═══ */
const NOTE = "    await noteInsertCall(tid, piece.id, channel);";
add("`start` 안의 기록을 빼면", YT, [[NOTE, "    /*r19mut*/"]], "yt.calls");
add("성공한 뒤에만 세면(실패·401 은 안 센다)", YT,
  [[NOTE, "    /*r19mut*/"], ["      let json: Record<string, unknown> | null = null;", "      let json: Record<string, unknown> | null = null; if (r.ok) await noteInsertCall(tid, piece.id, channel); /*r19mut*/"]], "yt.calls");
add("첫 호출 앞에서 한 번만 세면(401 재시도 · 유료 칸 빼고 다시는 안 센다)", YT,
  [[NOTE, "    /*r19mut*/"], ["  let s: Awaited<ReturnType<typeof start>>;", "  let s: Awaited<ReturnType<typeof start>>; await noteInsertCall(tid, piece.id, channel); /*r19mut*/"]], "yt.calls");

/* ═══ yt.say — 숫자 없는 말 · 찬 날과 잠깐 빠름을 가른다 · dailyPublishCap 0 ═══ */
add("찬 날의 말에 `${used}/${cap}` 을 되넣으면", YT,
  [["    return { ok: false, reason: \"channel_error\", retriable: true, error: YOUTUBE_FULL_SAY,", "    return { ok: false, reason: \"channel_error\", retriable: true, error: `오늘 유튜브에 올릴 수 있는 만큼 다 올렸어요(${room.used}/${room.cap}). 내일 이어서 올릴게요.` /*r19mut*/,"]], "yt.say");
add("화면에 싣는 한 줄에 «100개»를 적으면", YT,
  [["export const YOUTUBE_LIMIT_NOTE = \"유튜브는 하루에 ", "export const YOUTUBE_LIMIT_NOTE = \"유튜브는 하루에 100개까지 /*r19mut*/ "]], "yt.say");
add("429(잠깐 빠름)도 «찬 날의 말»로 묶으면", YT,
  [["error: \"유튜브가 잠깐 천천히 올려 달라고 해요. 잠시 후 다시 올릴게요.\"", "error: YOUTUBE_FULL_SAY /*r19mut*/"]], "yt.say");
add("계정 응답에 `dailyPublishCap` 을 되살리면", ACC,
  [["...(isYoutubeChannel(key) ? { publishLimitNote: YOUTUBE_LIMIT_NOTE } : {})", "...(isYoutubeChannel(key) ? { publishLimitNote: YOUTUBE_LIMIT_NOTE, dailyPublishCap: 100 /*r19mut*/ } : {})"]], "yt.say");

/* ═══ yt.gate — 배경 함수 전 문 ═══ */
add("배경 함수 전 문을 끄면(찬 날에도 부른다)", PO, [["      if (room.full) {", "      if (false /*r19mut*/ && room.full) {"]], "yt.gate");

/* ═══ reuse.targets · reuse.honest ═══ */
add("서버 대상에서 쓰레드를 빼면", REUSE, [[", \"facebook_reels\", \"threads\"];", ", \"facebook_reels\"]; /*r19mut*/"]], "reuse.targets");
add("모의 후보에서 쓰레드를 빼면(서버 ≠ 모의)", MOCK,
  [["const REUSE_CANDS = [\"youtube_shorts\", \"reels\", \"tiktok\", \"naver_clip\", \"facebook_reels\", \"threads\"];", "const REUSE_CANDS = [\"youtube_shorts\", \"reels\", \"tiktok\", \"naver_clip\", \"facebook_reels\"]; /*r19mut*/"]], "reuse.targets");
add("`not_connectable` 갈래를 지우면(창구가 닫혀도 «연결하시면»)", REUSE,
  [["const canConnect = input.connectable ? input.connectable[channel] !== false : true;", "const canConnect = true; /*r19mut*/"]], "reuse.honest");
/* 화면 겹(--screen) — 생성된 화면 파일을 직접 고친다(자가 브라우저로 읽는 것은 `public/app/piece.html` 이다 · 정본 `_tpl.txt` 가 아니다) */
add("화면 — 재사용 줄의 «준비 중» 갈래를 지우면(«계정을 연결하시면 …용» 단추가 닫힌 창구에 뜬다)", "public/app/piece.html",
  [['s.why === "too_long" && s.remake && s.connected === false && s.connectable === false ? ""', 's.why === "too_long" && s.remake && false /*r19mut*/ ? ""']], "reuse.honest", "screen");

/* ═══ 돌리기 ═══ */
const run = (withDb, withScreen = SCREEN) => {
  const args = [TSX, path.join(BOX, RULER), ...(withDb ? ["--db"] : []), ...(withScreen ? ["--screen"] : [])];
  try { return { code: 0, out: execFileSync(process.execPath, args, { cwd: BOX, encoding: "utf8", env: { ...process.env, PW_DIR: process.env.PW_DIR || path.join(MY, "runner") }, maxBuffer: 32 << 20 }) }; }
  catch (e) { return { code: e.status ?? -1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const reds = (out) => out.split("\n").filter((l) => l.startsWith("❌"));

console.log(`\n── 내 R19 자에 변이를 넣는다 · 나무 ${TREE} · ${new Date().toISOString()} · ${DB ? "순수 + DB" : "순수"} ──\n`);
let exit = 0;
try {
  mkdirSync(BOX, { recursive: true });
  for (const d of ["lib", "db", "netlify", "public"]) if (existsSync(path.join(TREE, d))) cpSync(path.join(TREE, d), path.join(BOX, d), { recursive: true });
  for (const f of MINE) { mkdirSync(path.dirname(path.join(BOX, f)), { recursive: true }); cpSync(path.join(MY, f), path.join(BOX, f)); }

  const ctl = run(DB);
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
      /* ① 과녁부터 — 겹마다 */
      const hits = c.edits.map(([find]) => count(orig, find));
      if (hits.some((h) => h === 0)) { noTarget++; console.log(`⊘ [${c.axis}] ${c.name}  — 과녁 0곳(«${c.edits[hits.findIndex((h) => h === 0)][0].slice(0, 60)}» 가 ${c.file} 에 없다) · 셈에서 뺀다`); continue; }
      let mutated = orig;
      for (const [find, put] of c.edits) mutated = mutated.split(find).join(put);
      if (mutated === orig) { noTarget++; console.log(`⊘ [${c.axis}] ${c.name}  — 바꿨는데 글자가 같다`); continue; }
      writeFileSync(p, mutated);
      try {
        const r = run(c.arm === "db");
        const got = reds(r.out);
        const want = `❌ [${c.axis}]`;
        const hit = r.code === 1 && got.some((l) => l.startsWith(want));
        if (hit) { caught++; console.log(`✅ [${c.axis}] ${c.name}  — 과녁 ${hits.join("+")}곳 · 종료 1 · 그 축이 울었다(${got.filter((l) => l.startsWith(want)).length}줄)`); }
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
    console.log(`\n■ 과녁 있는 변이 ${total} 중 잡음 ${caught} · 놓침 ${missed}  (과녁 0곳 ${noTarget} · ⊘ ${unmeasured} 는 셈 밖)${DB ? "" : " · DB 변이 셋은 --db 로"}`);
    if (missedLines.length) console.log("   🔴 놓친 것:\n     " + missedLines.join("\n     "));
    exit = missed ? 1 : total ? (unmeasured || noTarget ? 2 : 0) : 2;
  }
} finally {
  rmSync(BOX, { recursive: true, force: true });
}
process.exit(exit);
