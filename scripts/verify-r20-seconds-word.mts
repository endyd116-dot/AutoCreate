/**
 * scripts/verify-r20-seconds-word.mts — [R20 · B · 2026-09-28] 편성표·규칙 화면의 «영상 길이»는 서버 값 · 고객 문장은 «쓰레드»
 *   사용: `npx --yes tsx scripts/verify-r20-seconds-word.mts` (종료코드 0 = 전부 통과 · 1 = 틀림 · DB 0 · 네트워크 0)
 *
 *   ══ 재는 것 / 뜻하는 것(AC-178 — 두 문장이 다르면 그 자리가 대용물이다) ══
 *     ① slotVideoSecondsOf 를 돌린다   / 편성표 영상 자리가 «만든 영상이면 그 길이 · 아니면 견적»을 말하는지 — 30초 원본의 파생 자리가 «60초»라 하지 않는지
 *     ② videoSecondsByChannelOf 를 돌린다 / 규칙 화면의 채널별 길이가 **견적(coinsPerWeek)과 같은 값**인지 — 코인 값으로 대조한다(글자 대조가 아니다)
 *     ③ 소스 두 곳을 잰다               / 그 함수가 **실제 응답**에 실리는지(listSlots 의 영상 자리 · rules-list) — ⚠️ 대용물: «부른다»까지만 · 라이브 응답은 C 가 잰다
 *     ④ 서버 코드(주석 걷고)를 훑는다   / 고객에게 나가는 서버 문장에 «스레드»가 0인지 — 설계 정본 표기 «쓰레드»(R20 §0-B)
 *
 *   ══ 스스로 지키는 셋(verify-r18-reuse 관례) ══ 원판 줄 먼저 · 대조군 짝 · 무회귀
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { slotVideoSecondsOf, videoSecondsByChannelOf, coinsPerWeek, type Rule } from "../lib/slots";
import { estimateVideoSeconds, estimateAiImagesFor, coinFormatOf } from "../lib/writing-contracts";
import { pieceCoinCost, DEFAULT_COIN_TIER } from "../lib/coin-table";
import { VIDEO_CHANNELS, VIDEO_SECONDS, isVideoChannel } from "../lib/video/types";
import { channelLabelKo } from "../lib/channel-url";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
let fail = 0, pass = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`); } };
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const SETTINGS: unknown[] = [undefined, 15, 30, 60, 90, "60", "junk", null];

console.log("\n① 편성표 영상 자리 — 만든 영상이면 그 길이, 아니면 견적");
{
  eq("원판 · 영상 없음 · 설정 60 · 쇼츠 → 60(견적)", slotVideoSecondsOf({ channel: "youtube_shorts", settingsVideoSeconds: 60 }), 60);
  eq("원판 · 영상 없음 · 설정 60 · 클립 → 30(채널 상한)", slotVideoSecondsOf({ channel: "naver_clip", settingsVideoSeconds: 60 }), 30);
  eq("설정 30 → 쇼츠 30(고객이 고른 길이를 말한다)", slotVideoSecondsOf({ channel: "youtube_shorts", settingsVideoSeconds: 30 }), 30);
  eq("🔴 30초로 만든 원본의 파생(릴스) 자리 · 설정 60 → 30(견적 60 이 아니라 실제)", slotVideoSecondsOf({ channel: "reels", pieceKind: "video", pieceVideo: { format: "graphic", seconds: 30 }, settingsVideoSeconds: 60 }), 30);
  eq("만든 영상 · 클립형 60 → 30(shortsFormOf 와 같게 · 재사용 시트와 같은 값)", slotVideoSecondsOf({ channel: "youtube_shorts", pieceKind: "video", pieceVideo: { format: "clip", seconds: 60 }, settingsVideoSeconds: 60 }), 30);
  eq("🔴 대조군 · 걸린 글이 영상이 아니면(kind post) 견적", slotVideoSecondsOf({ channel: "threads", pieceKind: "post", pieceVideo: { seconds: 15 }, settingsVideoSeconds: 60 }), 60);
  eq("🔴 대조군 · 영상인데 meta.video.seconds 가 없으면 지어낸 60 이 아니라 견적(설정 30)", slotVideoSecondsOf({ channel: "youtube_shorts", pieceKind: "video", pieceVideo: {}, settingsVideoSeconds: 30 }), 30);
  eq("🔴 대조군 · seconds 가 규격 밖(45)이면 견적", slotVideoSecondsOf({ channel: "youtube_shorts", pieceKind: "video", pieceVideo: { seconds: 45 }, settingsVideoSeconds: 15 }), estimateVideoSeconds("youtube_shorts", 15));
  let diff = 0, seen = 0;
  for (const c of VIDEO_CHANNELS) for (const s of SETTINGS) { seen++; if (slotVideoSecondsOf({ channel: c, settingsVideoSeconds: s }) !== estimateVideoSeconds(c, s)) diff++; }
  eq(`무회귀 · 영상 없는 자리는 견적 함수와 같다(채널 ${VIDEO_CHANNELS.size} × 설정 ${SETTINGS.length} = ${seen}판)`, diff, 0);
  ok("값은 늘 규격 안(15|30|60|90)", [...VIDEO_CHANNELS].every((c) => SETTINGS.every((s) => (VIDEO_SECONDS as readonly number[]).includes(slotVideoSecondsOf({ channel: c, settingsVideoSeconds: s })))));
}

console.log("\n② 규칙 화면 — 채널별 길이 = 견적(coinsPerWeek)이 쓰는 길이");
{
  const m60 = videoSecondsByChannelOf(60);
  eq("키 = 영상 규칙을 만들 수 있는 채널(VIDEO_CHANNELS)", Object.keys(m60).sort(), [...VIDEO_CHANNELS].sort());
  ok("🔴 그 키 전부 rules-save 가 shorts 로 저장하는 채널(isVideoChannel)", Object.keys(m60).every((c) => isVideoChannel(c)));
  eq("원판 · 설정 60 → 쇼츠 60 · 클립 30 · 릴스 60 · 쓰레드 60", [m60.youtube_shorts, m60.naver_clip, m60.reels, m60.threads], [60, 30, 60, 60]);
  eq("설정 15 → 쇼츠는 15 가 아니다(그래픽 15 는 30 으로 오른다 · 견적과 같게)", videoSecondsByChannelOf(15).youtube_shorts, estimateVideoSeconds("youtube_shorts", 15));
  /* 🔴 «같은 함수»를 글자가 아니라 **값**으로 잰다 — 편당 코인이 같으면 길이가 같다(video_15/30/60/90 이 전부 다른 값) */
  const bad: string[] = []; let n = 0;
  for (const c of VIDEO_CHANNELS) for (const s of SETTINGS) {
    n++;
    const rule: Rule = { id: 0, channel: c, kind: "shorts", accountMode: "auto", every: "week", count: 1, active: true };
    const fromEstimate = coinsPerWeek([rule], s);
    const fromMap = pieceCoinCost("shorts", estimateAiImagesFor(c, DEFAULT_COIN_TIER), { format: coinFormatOf(c), seconds: videoSecondsByChannelOf(s)[c], tier: DEFAULT_COIN_TIER });
    if (fromEstimate !== fromMap) bad.push(`${c}@${String(s)}: 견적 ${fromEstimate} ≠ 길이표 ${fromMap}`);
  }
  ok(`🔴 편당 코인이 견적과 같다(채널 × 설정 ${n}판) — 두 벌이면 여기서 운다`, !bad.length, bad.slice(0, 3).join(" | "));
  ok("원판 · 코인 대조가 실제로 값을 갈랐다(설정 15↔60 쇼츠 편당 코인이 다르다)", coinsPerWeek([{ id: 0, channel: "youtube_shorts", kind: "shorts", accountMode: "auto", every: "week", count: 1, active: true }], 15) !== coinsPerWeek([{ id: 0, channel: "youtube_shorts", kind: "shorts", accountMode: "auto", every: "week", count: 1, active: true }], 60));
}

console.log("\n③ 응답에 실린다(⚠️ 소스 대용물 — 라이브 응답은 C)");
{
  const slots: string = codeOnly(readFileSync(path.join(ROOT, "lib/slots.ts"), "utf8"));
  const list = slots.slice(slots.indexOf("export async function listSlots("));
  const pwAt = list.indexOf("if (pw) {");
  const vsAt = list.search(/if \(o\.kind === "shorts"\) o\.videoSeconds = slotVideoSecondsOf\(\{ channel: o\.channel, pieceKind: r\.piece_kind, pieceVideo: r\.piece_video, settingsVideoSeconds: rawSettings\.videoSeconds \}\)/);
  ok("listSlots 가 영상 자리에 slotVideoSecondsOf 를 싣는다", vsAt > 0);
  ok("🔴 그 줄이 `if (pw)` 가지 **밖**(앞)이다 — 지난·완료 자리도 길이를 말한다", vsAt > 0 && pwAt > 0 && vsAt < pwAt, `videoSeconds@${vsAt} · pw@${pwAt}`);
  ok("listSlots SELECT 가 걸린 글의 kind·meta.video 를 읽는다(실제 길이의 재료)", /pc\.kind AS piece_kind, pc\.meta->'video' AS piece_video/.test(list));
  const rules: string = codeOnly(readFileSync(path.join(ROOT, "netlify/functions/rules.ts"), "utf8"));
  const rl = rules.slice(rules.indexOf('path.endsWith("/rules-list")'), rules.indexOf('path.endsWith("/slots-list")'));
  ok("rules-list 가 videoSecondsByChannelOf(raw.videoSeconds) 를 응답에 싣는다", /videoSecondsByChannelOf\(raw\.videoSeconds\)/.test(rl) && /videoSecondsByChannel \}\);/.test(rl));
}

console.log("\n④ 고객 문장 «쓰레드»(설계 정본) — 서버 코드(주석 걷고)에 «스레드» 0");
{
  eq("채널 라벨(channelLabelKo) = «쓰레드»", channelLabelKo("threads"), "쓰레드");
  const hits: string[] = []; let files = 0, good = 0;
  const walk = (d: string) => { for (const f of readdirSync(d)) { if (f === "node_modules" || f.startsWith(".")) continue; const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|mts|mjs|js)$/.test(f)) {
    files++; const c: string = codeOnly(readFileSync(p, "utf8")); good += (c.match(/쓰레드/g) ?? []).length;
    c.split("\n").forEach((l, i) => { if (l.includes("스레드")) hits.push(`${path.relative(ROOT, p)}:${i + 1}`); }); } } };
  for (const d of ["lib", "netlify", "runner", "db"]) walk(path.join(ROOT, d));
  ok(`서버 코드 ${files}파일 — «스레드» 0(주석 제외)`, !hits.length, hits.slice(0, 5).join(", "));
  ok("원판 · 훑기가 실제로 글자를 봤다(«쓰레드» > 0 — 빈 훑기가 초록이 되지 않게)", good > 0, `${good}곳`);
  const th: string = codeOnly(readFileSync(path.join(ROOT, "lib/publish/threads.ts"), "utf8"));
  ok("연결글 반만 올라간 말(say)이 «쓰레드 N조각 중 M조각»", /say: `쓰레드 \$\{parts\.parts\.length\}조각 중 \$\{posted\.length\}조각까지 올라갔어요\.`/.test(th));
  const mu: string = codeOnly(readFileSync(path.join(ROOT, "lib/manual-upload.ts"), "utf8"));
  ok("직접 올리기 안내(쓰레드) 라벨·단추 말이 «쓰레드»", /label: "쓰레드"/.test(mu) && /openLabel: "쓰레드 열기"/.test(mu));
}

console.log(`\n${fail ? "🔴" : "✅"} R20 길이·표기 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
