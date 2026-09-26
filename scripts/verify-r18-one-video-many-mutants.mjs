/**
 * scripts/verify-r18-one-video-many-mutants.mjs — 🔴 **내 자(`verify-r18-one-video-many.mts`)가 제품이 틀리는 순간 우는가**
 *   (C · 2026-09-26 · 트리거 R18 §7 C)
 *
 *   ══ 왜 ══
 *   자는 제품보다 먼저 섰다. 그런데 «먼저 선 자»의 초록은 두 가지로 읽힌다 — «제품이 맞다» 또는 «자가 눈이 멀었다».
 *   그 둘을 가르는 것이 이 하니스다: 제품의 **사본**을 한 군데씩 망가뜨려서 자가 **그 축의 그 코드로** 우는지 본다.
 *
 *   ══ 🔴 지키는 넷 ══
 *     ① **과녁부터 센다**(AC-236) — 변이를 넣기 전에 «바꿀 글자»가 사본에 **몇 곳** 있나 찍는다. 0 이면 그건 변이가 아니라 오타다 → ⊘.
 *        «빈 겹 4»가 그럴듯했던 날을 되풀이하지 않는다: 과녁 없는 변이는 **셈에 안 넣는다**(잡은 것도 놓친 것도 아니다).
 *     ② **대조군 먼저**(AC-161) — 안 건드린 사본이 ❌ 0 이어야 변이 판을 읽을 수 있다. 대조군이 빨가면 전부 ⊘.
 *     ③ **«울었다»는 그 코드로만**(AC-121) — 종료코드 1 **그리고** 줄머리 `[축 코드]` 가 기대한 것일 때만 «잡았다».
 *        엉뚱한 축이 울면 «잡았다»가 아니다. 🔴 종료코드 2(⊘)는 «울었다»가 아니다(AC-161 ①).
 *     ④ **«망가뜨리는 변이»만**(AC-112 ⑥) — 제품이 더 좋아져도 죽지 않는 변이는 넣지 않는다.
 *        (예: 멱등을 깨는 변이는 **없다** — `have` 검사를 지워도 DB 유니크 `(origin_piece_id, channel)` 이 받아 낸다. 그건 제품이 두 겹이라는 뜻이지 자의 구멍이 아니다.)
 *
 *   ══ 사본은 어디에 ══
 *   `--tree <경로>`(기본: 작업 폴더)의 `lib/`·`db/`·`netlify/` 를 **내 나무 안** `.r18-mut-<pid>/` 에 복사한다(내 `node_modules` 가 풀리게).
 *   🔴 **남의 나무에는 한 글자도 안 쓴다**(읽기만) · 끝나면(성공·실패·예외) 사본을 지운다.
 *   🔴 변이표의 키는 `put` 이다(`to:` 아님) — `verify-mutant-residue` 는 `to: "…"` 글자를 제품에서 찾는데, 이 하니스는 **사본만** 고치므로
 *      제품에 잔재가 남을 길이 없고, 치환 글자가 제품에 원래 있는 줄(`out[k] = v;` 같은)이면 그 자에 **거짓 빨강**을 준다. 모든 치환엔 `r18mut` 표식을 단다.
 *
 *   ══ 쓰는 법 ══
 *     node scripts/verify-r18-one-video-many-mutants.mjs --tree ../AutoCreate-B              ← 순수 변이(돈 0 · DB 0)
 *     node scripts/verify-r18-one-video-many-mutants.mjs --tree ../AutoCreate-B --rehearse   ← + DB 변이(시드 집을 변이마다 만들고 치운다)
 *
 *   종료코드: 0 = 과녁 있는 변이 **전부** 잡힘 · 1 = 안 잡힌 변이가 있다 · 2 = 못 쟀다(대조군 빨강 · 과녁 있는 변이 0).
 */
import "./_lib/load-env.mjs";
import { readFileSync, writeFileSync, existsSync, rmSync, cpSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const MY = path.resolve(import.meta.dirname, "..");
const argv = process.argv.slice(2);
const TREE = path.resolve(argv.includes("--tree") ? argv[argv.indexOf("--tree") + 1] : process.cwd());
const REHEARSE = argv.includes("--rehearse");
/** `--only <글자>` — 이름에 그 글자가 든 변이만(대조군은 늘 돈다). 한 수리의 반대팔만 빨리 잴 때. */
const ONLY = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : "";
const RULER = "scripts/verify-r18-one-video-many.mts";
const MINE = [RULER, "scripts/_lib/r18-judge.mjs", "scripts/_lib/code-only.mjs", "scripts/_lib/load-env.mjs", "scripts/_teardown.mjs"];
const TSX = path.join(MY, "node_modules", "tsx", "dist", "cli.mjs");
const REUSE = "lib/video/reuse.ts", WC = "lib/writing-contracts.ts";
const SCHED = "lib/derived-schedule.ts", PAUSE = "lib/tenant-pause.ts", PIECES = "netlify/functions/pieces.ts", DIRECTOR = "lib/director.ts";

for (const f of MINE) if (!existsSync(path.join(MY, f))) { console.error(`⊘ 못 쟀어요 — 내 자 ${f} 가 없다`); process.exit(2); }
if (!existsSync(TSX)) { console.error("⊘ 못 쟀어요 — tsx 가 없다(npm i)"); process.exit(2); }
if (!existsSync(path.join(TREE, "lib")) || !existsSync(path.join(TREE, "db"))) { console.error(`⊘ 못 쟀어요 — ${TREE} 에 lib/·db/ 가 없다`); process.exit(2); }

const BOX = path.join(MY, `.r18-mut-${process.pid}`);
const cases = [];
/** add(축, 이름, 파일, 찾을 글자, 넣을 글자, 기대 코드, 팔) — `find` 는 문자열(정확히 그 글자). */
const add = (name, file, find, put, expect, arm = "pure") => cases.push({ name, file, find, put, expect, arm });

/* ═══ 순수 변이 — `reuseFit`·표 ═══ */
add("③ `VIDEO_REUSE_TARGETS` 에 youtube_long 을 넣으면", REUSE,
  'export const VIDEO_REUSE_TARGETS: readonly string[] = ["youtube_shorts",',
  'export const VIDEO_REUSE_TARGETS: readonly string[] = ["youtube_long" /*r18mut*/, "youtube_shorts",', "[③ forbidden_target]");
add("③ youtube_long 을 «빠진 채널»에 띄우면(화면에도 안 띄운다 · 트리거 §3)", REUSE,
  "  return { seconds: input.seconds, places: 1 + go.length, go, skip };",
  '  if (want.has("youtube_long")) skip.push({ channel: "youtube_long", label: "유튜브 긴 영상", maxSeconds: 60 as ChannelMaxSecLit, why: "too_long", line: "긴 영상은 가로로 만들어야 해요(최대 60초).", how: "가로 60초를 골라 주세요." }); /*r18mut*/\n  return { seconds: input.seconds, places: 1 + go.length, go, skip };',
  "[③ forbidden_shown]");
add("③ 원본과 같은 가족(원본 채널)을 대상에서 안 빼면", REUSE,
  "return VIDEO_REUSE_TARGETS.filter((c) => familyOf(c) !== fam);",
  "return VIDEO_REUSE_TARGETS.filter((c) => true /*r18mut*/ || familyOf(c) !== fam);", "[③ source_again]");
add("③ 딱 맞는 길이도 «길이 때문에» 빼면(`>` → `>=`)", REUSE,
  "if (input.seconds > maxSeconds) {", "if (input.seconds >= maxSeconds /*r18mut*/) {", "[③ fit_but_skipped]");
add("③ 긴 영상을 짧은 채널로 보내면(상한 두 배까지 통과)", REUSE,
  "if (input.seconds > maxSeconds) {", "if (input.seconds > maxSeconds * 2 /*r18mut*/) {", "[③ too_long_target]");
add("③ 후보의 상한을 표에서 지우면(판정 자체가 안 된다 · 트리거 §2)", WC,
  "tiktok: 180", "tiktok_r18mut: 180", "[③ no_spec]");
add("④ «안 올라가요»를 «업로드 불가»로 바꾸면", REUSE,
  "(최대 ${maxSeconds}초)엔 안 올라가요.`", "(최대 ${maxSeconds}초) 업로드 불가.`/*r18mut*/", "[④ hard_word]");
add("④ «사실» 칸에서 상한을 빼면(«어떻게» 칸의 30초가 대신 채워 주던 모양)", REUSE,
  "${label}(최대 ${maxSeconds}초)엔 안 올라가요.`", "${label}엔 안 올라가요.`/*r18mut*/", "[④ no_fact]");
add("④ «어떻게» 칸에서 길이를 빼면(«더 짧게»만 권한다)", REUSE,
  "만들 때 ${pick}초를 골라 주세요.`", "더 짧게 만들어 주세요.`/*r18mut*/", "[④ no_way]");   // B v1.4 에서 `longestPickableUnder(maxSeconds)` → `pick` (과녁을 새 글자로)
add("④ «계정 없음»의 «어떻게»를 비우면", REUSE,
  'how: "계정을 연결하시면 같이 올라가요.",', 'how: "" /*r18mut*/,', "[④ no_way]");   // B v1.4 에서 `connected` 칸이 뒤에 붙었다
add("④ 채널 이름 대신 채널 키가 새면", REUSE,
  "const label = channelLabelKo(channel);", "const label = channel /*r18mut*/;", "[④ machine_word]");
add("④ 겁주는 꼬리를 달면", REUSE,
  "(최대 ${maxSeconds}초)엔 안 올라가요.`", "(최대 ${maxSeconds}초)엔 안 올라가요. 계속 올리시면 계정이 정지될 수 있어요.`/*r18mut*/", "[④ scary]");

/* ═══ DB 변이 — 리허설 팔(시드 집에 실제로 파생) ═══ */
add("① 파생 id 로 코인을 받으면", REUSE,
  "    created.push({ pieceId, channel: g.channel, accountId: acc.id });",
  '    await (await import("../coin-ledger")).consume(tid, "video_60", `piece:${pieceId}`, { reason: "r18mut" });\n    created.push({ pieceId, channel: g.channel, accountId: acc.id });',
  "[① derived_charged]", "db");
add("① 🔴 원본 ref 에 꼬리를 달아 받으면(파생 id 는 깨끗 — 첫 문장만 재는 자는 여기서 눈이 먼다)", REUSE,
  "    created.push({ pieceId, channel: g.channel, accountId: acc.id });",
  '    await (await import("../coin-ledger")).consume(tid, "video_60", `piece:${originPieceId}:r18mut:${g.channel}`, { reason: "r18mut" });\n    created.push({ pieceId, channel: g.channel, accountId: acc.id });',
  "[① tenant_charged_on_derive]", "db");
add("덤 파생이 영상 파일을 새로 가리키면(다시 굽는 모양 · 트리거 §5)", REUSE,
  "SELECT tenant_id, ${pieceId}, kind, r2_key, caption,", "SELECT tenant_id, ${pieceId}, kind, r2_key || '.r18mut', caption,", "[덤 other_r2_key]", "db");
add("덤 원본의 발행·코인 흔적을 통째로 물려받으면(§6-2)", REUSE,
  "if (!STRIP_EXACT.has(k) && !STRIP_PREFIX.test(k)) out[k] = v;", "if (true /*r18mut*/) out[k] = v;", "[덤 inherited_marks]", "db");

/* ═══ ② ⑤ ⑥ — 편성(B2)·원본의 결정(B) · 🔴 기대는 **그 줄의 빨강**으로 적는다(② 는 두 줄이 같은 코드를 내서 코드만으론 어느 길이 울었는지 못 가른다 · AC-121) ═══ */
add("② 가족 시차를 빼면(파생이 전부 «원본+30분» 한 분에)", SCHED,
  "      clash(family, stagger);", "      /*r18mut*/", "❌ ② 같은 분에 N곳 없음 — 파생에 시각을 박은 뒤", "db");
add("② 🔴 멈췄다 깰 때 파생을 옛 길(채널·계정만 보는 pickPublishAt)로 되돌리면(C 반례: 틱톡·클립 19:00)", PAUSE,
  "  if (derived.length) {", "  for (const p of derived) await placeOne(p); /*r18mut*/\n  if (false) {", "❌ ② 멈췄다 깨도 같은 분에 안 모인다", "db");
add("⑤ 원본을 다시 만들 때 파생의 시각을 안 풀면(옛 영상이 먼저 나간다)", REUSE,
  "  const rows = await q(sql`UPDATE pieces SET scheduled_for = NULL,", "  const rows = await q(sql`UPDATE pieces SET status = status /*r18mut*/,", "[⑤ timed_while_regen]", "db");
add("⑤ 재승인 때 파생을 새 영상으로 안 갈아 끼우면", REUSE,
  "      await refreshHeldDerived(tid, prev.pieceId, originPieceId, meta, { originPieceId, originChannel, seconds, at }, scheduleAt);", "      /*r18mut*/", "[⑤ stale_video]", "db");
add("⑤ 파생에서 «다시 만들기»를 열어 두면(다시 굽는다 · 퓨즈가 굽기를 끊는다)", PIECES,
  "      if (p.origin_piece_id != null && n(p.origin_piece_id)) {", "      if (false /*r18mut*/) {", "[⑤ derived_regen_open]", "db");
add("⑥ 원본을 버릴 때 파생을 같이 안 내리면(문의 배선을 끊는다)", PIECES,
  '? await holdDerivedFor(tid, id, "reject") : [];', "? [] /*r18mut*/ : [];", "[⑥ derived_left_scheduled]", "db");
add("⑥ 이미 나간 파생까지 «안 나간 것»으로 치면", REUSE,
  'const UNSENT_DERIVED: readonly string[] = ["scheduled", "awaiting_manual"];', 'const UNSENT_DERIVED: readonly string[] = ["scheduled", "awaiting_manual", "published" /*r18mut*/];', "[⑥ published_touched]", "db");

/* ①-b B 의 수리(5f99451 «먼저 잡기»)를 끈다 — 🔴 경쟁이라 자는 5판 × 동시 3번으로 잰다(한 번 초록은 우연일 수 있다) */
add("①-b «30초 판 새로 만들기»의 먼저 잡기(조건부 UPDATE)를 늘 통과시키면", DIRECTOR,
  "      WHERE tenant_id = ${tid} AND id = ${originPieceId} AND (", "      WHERE tenant_id = ${tid} AND id = ${originPieceId} AND (true /*r18mut*/ OR ", "[①b remake_twice]", "db");

/* ═══ 돌리기 ═══ */
const run = (withDb) => {
  const args = [TSX, path.join(BOX, RULER), ...(withDb ? ["--rehearse"] : [])];
  try { return { code: 0, out: execFileSync(process.execPath, args, { cwd: BOX, encoding: "utf8", env: process.env, maxBuffer: 32 << 20 }) }; }
  catch (e) { return { code: e.status ?? -1, out: String(e.stdout ?? "") + String(e.stderr ?? "") }; }
};
const count = (hay, needle) => (needle ? hay.split(needle).length - 1 : 0);
const reds = (out) => out.split("\n").filter((l) => l.startsWith("❌") || /^\s+\[/.test(l));

console.log(`\n── 내 자에 변이를 넣는다 · 나무 ${TREE} · ${new Date().toISOString()} · ${REHEARSE ? "순수 + DB" : "순수"} ──\n`);
let exit = 0;
try {
  mkdirSync(BOX, { recursive: true });
  for (const d of ["lib", "db", "netlify"]) if (existsSync(path.join(TREE, d))) cpSync(path.join(TREE, d), path.join(BOX, d), { recursive: true });
  for (const f of MINE) { mkdirSync(path.dirname(path.join(BOX, f)), { recursive: true }); cpSync(path.join(MY, f), path.join(BOX, f)); }

  /* ② 대조군 */
  const ctl = run(REHEARSE);
  const ctlRed = reds(ctl.out);
  console.log(`${ctlRed.length ? "⊘" : "✅"} 대조군(안 건드린 사본) — 종료 ${ctl.code} · 빨강 ${ctlRed.length}${ctlRed.length ? ` — 🔴 대조군이 빨가면 변이 판을 못 읽는다:\n     ${ctlRed.slice(0, 6).join("\n     ")}` : ""}`);
  if (ctlRed.length || ctl.code === 1) { console.log("\n■ ⊘ 못 쟀다 — 대조군부터 빨강"); exit = 2; }
  else {
    let caught = 0, missed = 0, noTarget = 0, unmeasured = 0;
    const missedLines = [];
    for (const c of cases) {
      if (c.arm === "db" && !REHEARSE) continue;
      if (ONLY && !c.name.includes(ONLY)) continue;
      const p = path.join(BOX, c.file);
      const orig = existsSync(p) ? readFileSync(p, "utf8") : "";
      const hits = count(orig, c.find);
      /* ① 과녁부터 */
      if (hits === 0) { noTarget++; console.log(`⊘ ${c.name}  — 과녁 0곳(«${c.find.slice(0, 60)}» 가 ${c.file} 에 없다) · 셈에서 뺀다`); continue; }
      const mutated = orig.split(c.find).join(c.put);
      if (mutated === orig) { noTarget++; console.log(`⊘ ${c.name}  — 바꿨는데 글자가 같다`); continue; }
      writeFileSync(p, mutated);
      try {
        const r = run(c.arm === "db");
        const got = reds(r.out);
        const hit = r.code === 1 && r.out.includes(c.expect);
        if (hit) { caught++; console.log(`✅ ${c.name}  — 과녁 ${hits}곳 · 종료 1 · ${c.expect} 로 울었다`); }
        else if (r.code === 2 && !got.length) { unmeasured++; console.log(`⊘ ${c.name}  — 종료 2(자가 «못 쟀다») · 울었다로 안 센다(AC-161)`); }
        else {
          missed++;
          const why = r.code !== 1 ? `종료 ${r.code} — 안 울었다` : `🔴 엉뚱한 축이 울었다(기대 ${c.expect}): ${got.slice(0, 3).join(" | ")}`;
          missedLines.push(`${c.name} — ${why}`);
          console.log(`❌ ${c.name}  — 과녁 ${hits}곳 · ${why}`);
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
