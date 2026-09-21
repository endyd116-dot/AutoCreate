/**
 * scripts/verify-video-no-account.mjs — 🔴 **영상 채널 계정 0개로 영상이 만들어지나**(R7 §1.2 · B 2026-09-21)
 *
 *   ══ 왜 이 자인가 ══
 *   사장님이 «토글만 켜면 리소스 안 나가지?»라고 물으셨고, 설계는 두 가지를 **동시에** 약속한다:
 *     ① 영상을 켠 고객은 **계정이 없어도** 영상을 만들어 «앱에서 직접» 올릴 수 있다(유튜브 OAuth 가 심사 전이라 막혀 있다)
 *     ② 🔴 그런데 **자동 편성은 영상을 안 만든다** — «아무도 안 보는 사이에 올릴 곳 없는 영상을 코인 써 가며 쌓지 않는다»
 *   이 둘은 **한 줄 차이**(`opts.origin === "manual"`)로 갈린다. 그 한 줄이 지워지면
 *   ①이 죽거나(계정 없으면 영상 0) ②가 죽는다(자동이 28코인짜리를 쌓는다). **둘 다 조용하다.**
 *
 *   2026-09-21 실측(시험 테넌트 761 · 영상 채널 계정 0개):
 *     · 수동 → 조각 2개 중 영상 1개(`youtube_shorts` · accountId=null · 28코인) ✅
 *     · 자동 → 조각 1개 중 영상 0개 ✅
 *     · 🔴 그런데 **«직접 올리셔야 해요»가 확정 전에 한 번도 안 나왔다** — 넘겨주는 길(`lib/manual-upload.ts`)이
 *       `naver_clip` 하나만 알고 있었고, 이 길이 기본으로 떨어지는 `youtube_shorts` 는 **표에 없었다.**
 *       고객은 28코인을 쓰고 **발행이 실패한 뒤에야** 처음 들었다. 그래서 ③축이 생겼다.
 *
 *   ══ 재는 것 ══
 *     ① 갈림   — «계정 없이 영상»이 **수동에서만** 열리나(제품 소스의 그 한 줄)
 *     ② 넘겨주기 — 영상 채널 **넷 다** 안내가 있나 · 계정이 있으면 **안 띄우나**(실제로 함수를 돌린다)
 *     ③ 말해 주기 — 지시서 응답에 `selfUpload` 가 실리나(확정 **전에** 말하나)
 *     ④ kinds  — «글»은 항상 남나 · `kindsSet`(안 물었다) 과 «껐다»가 갈리나(실제로 함수를 돌린다)
 *
 *   🔴 ②·④는 **글자 대조가 아니라 실행**이다 — `lib/manual-upload.ts`·`lib/tenant-kinds.ts` 는 임포트가 0이라
 *      그대로 불러다 돌릴 수 있다(그러라고 순수하게 뒀다).
 *   🔴 부정형 단언을 안 쓴다 — 전부 «있나»이거나 «돌렸더니 이 값이 나오나»다.
 *
 *   `--mutants` = 제품 사본에 변이를 넣고 이 자를 다시 돌려 **내가 정말 무는지** 본다.
 *   종료코드: 0 = 다 됐다 · 1 = 어긋난 곳이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = process.cwd();
const read = (f) => { const p = path.join(ROOT, f); return existsSync(p) ? readFileSync(p, "utf8") : null; };
const DIR = "lib/director.ts", MAN = "lib/manual-upload.ts", KIN = "lib/tenant-kinds.ts", PV = "netlify/functions/piece-video.ts";
const FILES = [DIR, MAN, KIN, PV];

const fails = [], notes = [];
const ok  = (ax, m) => notes.push(`  ✓ ${ax} ${m}`);
const bad = (ax, m) => { notes.push(`  ✗ ${ax} ${m}`); fails.push(`${ax} ${m}`); };
const unk = (ax, m) => { notes.push(`  ⊘ ${ax} 못 쟀음 — ${m}`); fails.push(`${ax} 못 쟀음`); };

const T = {}; for (const f of FILES) T[f] = read(f);
const gone = FILES.filter((f) => T[f] === null);
if (gone.length) { console.error(`⊘ 못 쟀어요 — ${gone.join(", ")} 가 없다.`); process.exit(2); }

/* ───────── ① 갈림 — «계정 없이 영상»이 수동에서만 열리나 ───────── */
notes.push("■ ① 갈림 — «계정 없이 영상»은 **사람이 누른 길에서만** 열리나(자동은 안 쌓는다)");
const SPLIT = [
  ["영상을 켠 집만",                    /const noAccountVideo = wantVideo &&/],
  ["🔴 **수동일 때만**(자동 제외)",     /const noAccountVideo = wantVideo && opts\.origin === "manual"/],
  ["영상 채널 계정이 없을 때만",        /const noAccountVideo = wantVideo && opts\.origin === "manual" && !videoCh\.length/],
  ["없으면 채널 하나를 대신 세운다",    /const fallbackVideoCh = isVideoChannel\(topic\.channelHint\) \? topic\.channelHint : "youtube_shorts"/],
  ["그 채널을 후보에 넣는다",           /const connected = \[\.\.\.textCh, \.\.\.videoCh, \.\.\.\(noAccountVideo \? \[fallbackVideoCh\] : \[\]\)\]/],
  ["🔴 확정도 사람 경로로 부른다",      /confirm\(tid, briefId,[\s\S]{0,80}\{ origin: "manual" \}\)/],
];
const api = read("netlify/functions/director.ts") ?? "";
for (const [name, re] of SPLIT) (re.test(T[DIR]) || re.test(api) ? ok : bad)("①", name);

/* ───────── ②·④ 실제로 돌린다 ─────────
   🔴 `lib/manual-upload.ts`·`lib/tenant-kinds.ts` 는 **임포트가 0**이라 그대로 불러 돌릴 수 있다. */
function runPure(dir) {
  const probe = path.join(dir, ".probe.mts");
  writeFileSync(probe, `
import { manualHandoffFor, isAlwaysManualChannel } from "./lib/manual-upload";
import { normalizeKinds, kindsView, videoOn } from "./lib/tenant-kinds";
const out = {
  handoff: {} as Record<string, unknown>,
  alwaysManual: {} as Record<string, boolean>,
  kinds: {} as Record<string, unknown>,
};
for (const ch of ["youtube_shorts", "naver_clip", "reels", "threads", "naver_blog"]) {
  out.handoff[ch] = {
    noAccount: !!manualHandoffFor(ch, { noAccount: true }),
    withAccount: !!manualHandoffFor(ch),
    steps: manualHandoffFor(ch, { noAccount: true })?.steps?.length ?? 0,
    openUrl: manualHandoffFor(ch, { noAccount: true })?.openUrl ?? "",
  };
  out.alwaysManual[ch] = isAlwaysManualChannel(ch);
}
out.kinds = {
  none: kindsView({}),
  videoOnly: kindsView({ kinds: ["video"] }),
  textOnly: kindsView({ kinds: ["text"] }),
  both: kindsView({ kinds: ["text", "video"] }),
  junk: normalizeKinds("어쩌구"),
  videoOnFromNone: videoOn({}),
  videoOnFromBoth: videoOn({ kinds: ["text", "video"] }),
};
console.log("@@" + JSON.stringify(out) + "@@");
`);
  /* 🔴 **치우고 나간다.** 안 치웠더니 `.probe.mts` 가 리포 뿌리에 남았고, 메인이 «커밋 안 된 파일»로 보고 지웠다
     (2026-09-21). 자가 제 뒷정리를 안 하면 **다음 사람이 그걸 제품으로 오해**하거나 그대로 커밋한다.
     ⚠️ 프로브는 리포 안에 있어야 한다(`./lib/...` 를 tsx 가 풀려면) — 그래서 임시 폴더로 못 옮긴다. 대신 반드시 지운다.
        세게 죽으면(SIGKILL) 남을 수 있어 `.gitignore` 에도 적어 뒀다(두 겹). */
  try {
    const o = execFileSync("npx", ["tsx", probe], { cwd: dir, encoding: "utf8", shell: process.platform === "win32", timeout: 180000 });
    const m = /@@(.*)@@/s.exec(o);
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
  finally { try { rmSync(probe, { force: true }); } catch { /* 이미 없으면 그만 */ } }
}

notes.push("■ ② 넘겨주기 — «어떻게 올리나»가 영상 채널 **넷 다** 있나(실제로 함수를 돌린다)");
const V = runPure(ROOT);
if (!V) unk("②", "순수 함수를 못 돌렸다(tsx)");
else {
  for (const ch of ["youtube_shorts", "naver_clip", "reels", "threads"]) {
    const h = V.handoff[ch];
    if (h?.noAccount && h.steps >= 3 && /^https:\/\//.test(h.openUrl)) ok("②", `${ch} — 계정 없을 때 안내가 있다(걸음 ${h.steps} · ${h.openUrl})`);
    else bad("②", `${ch} — 계정 없을 때 안내가 없다(noAccount=${h?.noAccount} steps=${h?.steps})`);
  }
  /* 🔴 **계정이 있으면 안 띄운다** — 우리가 올릴 텐데 «직접 올리세요»는 도움이 아니라 거짓 안내다.
     다만 클립은 계정이 있어도 우리가 못 올린다(`alwaysManual`) — 그래서 늘 띄운다. */
  (V.handoff.naver_clip?.withAccount === true ? ok : bad)("②", "🔴 클립은 계정이 있어도 안내한다(우리가 영영 못 올린다)");
  (V.handoff.youtube_shorts?.withAccount === false ? ok : bad)("②", "🔴 유튜브는 계정이 있으면 **안** 내민다(거짓 안내 금지)");
  (V.alwaysManual.naver_clip === true && V.alwaysManual.youtube_shorts === false ? ok : bad)("②", "«영영 못 올리는 채널»과 «아직 안 붙인 채널»이 갈린다");
  (V.handoff.naver_blog?.noAccount === false ? ok : bad)("②", "글 채널은 영상 넘겨주기 대상이 아니다");
}

/* ───────── ③ 말해 주기 — 확정 «전에» 말하나 ───────── */
notes.push("■ ③ 말해 주기 — 28코인을 쓰기 **전에** «직접 올리셔야 해요»가 닿나");
const SAY = [
  ["지시서가 selfUpload 를 싣는다", T[DIR], /selfUpload: \{ channel: h\.channel/],
  ["계정이 없는 영상에만 붙인다",   T[DIR], /if \(s2\.kind !== "video" \|\| s2\.accountId\) return s2;/],
  ["지시서가 kinds 를 싣는다",      T[DIR], /kinds: kv\.kinds, kindsSet: kv\.kindsSet/],
  ["내려받기 문도 계정을 본다",     T[PV],  /manualHandoffFor\(String\(row\.channel \?\? ""\), \{ noAccount: !n\(row\.account_id\) \}\)/],
  ["그 문이 계정을 실제로 읽는다",  T[PV],  /SELECT p\.id, p\.title, p\.channel, p\.kind, p\.status, p\.account_id/],
];
for (const [name, text, re] of SAY) (re.test(text) ? ok : bad)("③", name);

/* ───────── ④ kinds — «글»은 밑바탕 · «안 물었다»와 «껐다»는 다른 말 ───────── */
notes.push("■ ④ kinds — «글»은 항상 남나 · «한 번도 안 물었다»가 «껐다»와 갈리나");
if (!V) unk("④", "순수 함수를 못 돌렸다(tsx)");
else {
  const k = V.kinds;
  (JSON.stringify(k.videoOnly?.kinds) === '["text","video"]' ? ok : bad)("④", "🔴 영상만 보내도 «글»이 남는다(영상만 켜는 길은 없다)");
  (JSON.stringify(k.none?.kinds) === '["text"]' ? ok : bad)("④", "저장값이 없으면 «글»만(영상 꺼짐)");
  (JSON.stringify(k.junk) === '["text"]' ? ok : bad)("④", "이상한 값이 와도 «글»만");
  (k.none?.kindsSet === false ? ok : bad)("④", "🔴 저장된 적 없으면 kindsSet=false(«안 물었다»)");
  (k.textOnly?.kindsSet === true ? ok : bad)("④", "🔴 «껐다»는 kindsSet=true — «안 물었다»와 갈린다");
  (k.videoOnFromNone === false && k.videoOnFromBoth === true ? ok : bad)("④", "영상 켬 판정이 한 곳에서 나온다");
}

/* ───────── 찍기 ───────── */
console.log("─".repeat(100));
console.log(`계정 0개 영상 — 축 ${notes.filter((l) => /^  [✓✗⊘]/.test(l)).length}개 · 어긋난 곳 ${fails.length}`);
for (const l of notes) console.log(l);
console.log("─".repeat(100));
if (!process.argv.includes("--mutants")) process.exit(fails.length ? 1 : 0);

/* ═════════ 🔴 변이 — 제품 무접촉(사본에서만) ═════════ */
const SELF = path.join(ROOT, "scripts", "verify-video-no-account.mjs");
const EXTRA = ["netlify/functions/director.ts"];
function runIn(transform) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-vid-"));
  try {
    const box = {}; for (const f of [...FILES, ...EXTRA]) box[f] = read(f);
    const before = JSON.stringify(box);
    if (transform) transform(box);
    const changed = JSON.stringify(box) !== before;
    for (const f of Object.keys(box)) { mkdirSync(path.join(dir, path.dirname(f)), { recursive: true }); writeFileSync(path.join(dir, f), box[f]); }
    // 순수 함수를 돌리려면 사본에도 모듈 해석이 돼야 한다 — 리포의 node_modules 를 이어 준다.
    try { mkdirSync(path.join(dir, "node_modules"), { recursive: true }); } catch { /* 있으면 그만 */ }
    writeFileSync(path.join(dir, "package.json"), readFileSync(path.join(ROOT, "package.json"), "utf8"));
    let out = "", code = 0;
    try { out = execFileSync(process.execPath, [SELF], { cwd: dir, encoding: "utf8" }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

console.log("\n■ 🔴 변이 — 내가 정말 무는가(대조군을 먼저 · AC-161)");
const ctrl = runIn(null);
if (ctrl.code !== 0) {
  /* 🔴 **여기서 «초록»이라고 우기지 않는다.** 사본에서 순수 함수를 못 돌리면(node_modules 없음)
     ②·④축이 «못 쟀음»으로 빨개진다 — 그건 변이 탓이 아니다. 그러면 글자 축(①·③)만 변이로 잰다. */
  console.log("  ⊘ 대조군이 빨갛다 — 사본에서 순수 함수를 못 돌린 것 같다. **글자 축(①③)만** 변이로 잰다.");
}
const textOnlyMode = ctrl.code !== 0;
const MUT = [
  ["🔴 자동도 영상을 만들게 한다",   (b) => { b[DIR] = b[DIR].replace('const noAccountVideo = wantVideo && opts.origin === "manual" && !videoCh.length;', "const noAccountVideo = wantVideo && !videoCh.length;"); }, "①"],
  ["«계정 없이 영상»을 닫는다",      (b) => { b[DIR] = b[DIR].replace("...(noAccountVideo ? [fallbackVideoCh] : [])", "...[]"); }, "①"],
  ["확정을 자동 경로로 부른다",      (b) => { b[EXTRA[0]] = b[EXTRA[0]].replace('confirm(tid, briefId, Array.isArray(b.pieces) ? b.pieces : [], auth.user.uid, { origin: "manual" })', "confirm(tid, briefId, Array.isArray(b.pieces) ? b.pieces : [], auth.user.uid)"); }, "①"],
  ["확정 전 «직접 올리세요»를 뗀다", (b) => { b[DIR] = b[DIR].replace(/selfUpload: \{ channel: h\.channel/, "selfUploadX: { channel: h.channel"); }, "③"],
  ["내려받기 문이 계정을 안 본다",   (b) => { b[PV] = b[PV].replace('manualHandoffFor(String(row.channel ?? ""), { noAccount: !n(row.account_id) })', 'manualHandoffFor(String(row.channel ?? ""))'); }, "③"],
];
if (!textOnlyMode) MUT.push(
  ["유튜브 안내를 표에서 뺀다",     (b) => { b[MAN] = b[MAN].replace(/  youtube_shorts: \{[\s\S]*?\n  \},\n/, ""); }, "②"],
  ["계정이 있어도 들이민다",        (b) => { b[MAN] = b[MAN].replace("return h.alwaysManual || opts.noAccount === true ? h : null;", "return h;"); }, "②"],
  ["🔴 «글»을 끌 수 있게 한다",     (b) => { b[KIN] = b[KIN].replace('return list.includes("video") ? ["text", "video"] : ["text"];', 'return list.includes("video") ? ["video"] : ["text"];'); }, "④"],
  ["«안 물었다»를 «껐다»로 뭉갠다", (b) => { b[KIN] = b[KIN].replace("const has = Array.isArray(settings.kinds) && (settings.kinds as unknown[]).length > 0;", "const has = true;"); }, "④"],
);
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
