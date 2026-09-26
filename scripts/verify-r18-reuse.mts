/**
 * scripts/verify-r18-reuse.mts — [R18 · B · 2026-09-26] 🔴 **한 번 만들어 여러 곳에** — 판정을 «실제로 돌려» 본다.
 *   사용: `npx --yes tsx scripts/verify-r18-reuse.mts` (종료코드 0 = 전부 통과 · DB 0)
 *
 *   ══ 재는 것 / 뜻하는 것(AC-178 — 두 문장이 다르면 그 자리가 대용물이다) ══
 *     ① 표 값을 잰다          / 틱톡 180·페북 릴스 90 이 들어가고 쇼츠 60·클립 30 은 **그대로**인지를 뜻한다(무회귀)
 *     ② reuseFit 출력을 잰다  / «이 길이면 어디 가고 어디 빠지나»가 트리거 §1 의 모양 그대로인지를 뜻한다
 *     ③ 유튜브 가족 수를 잰다 / 한 가족에 유튜브가 **두 번** 가는 길이 **어느 원본·어느 길이에서도** 없는지를 뜻한다(쿼터 두 배 · §3)
 *     ④ 문장 글자를 잰다      / §3 말투(사실 + 어떻게 · «실패·오류·불가» 0)를 뜻한다
 *     ⑤ derivedMetaOf 를 잰다 / 파생이 «이미 나갔다»로 읽힐 발행 흔적 없이 태어나는지를 뜻한다(B2 ③)
 *     ⑥ reuse.ts 소스를 잰다  / 파생 경로에 **코인 차감이 없음**을 뜻한다 — ⚠️ 이건 대용물이다: 소스에 `consume` 이 없다 ≠ 원장 0행.
 *                              원장 0행은 C 의 자(라이브 원장 대조)가 잰다. 여기선 «부를 수단이 없다»까지만 말한다(놓치는 쪽으로 틀린다).
 *
 *   ══ 스스로 지키는 셋(verify-r11-axis 관례) ══
 *     원판 줄 먼저(안 건드린 입력이 기대대로) · 대조군 짝(빠져야 할 것과 **안 빠져야 할 것** 둘 다) · 무회귀 축.
 */
import { readFileSync } from "node:fs";
import { VIDEO_CHANNEL_MAX_SEC, videoChannelSpec, clampSecondsForChannel } from "../lib/writing-contracts";
import {
  VIDEO_REUSE_TARGETS, reuseFit, reuseTargetsFor, pickableSecondsFor, pieceSecondsOf, derivedMetaOf,
  readVideoReuse, reuseBasisOf, basisChannels,
} from "../lib/video/reuse";
import { VIDEO_CHANNELS, VIDEO_SECONDS } from "../lib/video/types";

let fail = 0, pass = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (cond) { pass++; console.log(`  ✅ ${name}`); } else { fail++; console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`); } };
const eq = (name: string, got: unknown, want: unknown) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
const ALL_ON = Object.fromEntries(VIDEO_REUSE_TARGETS.map((c) => [c, true]));

console.log("\n① 표(VIDEO_CHANNEL_MAX_SEC) — 채운 둘 · 그대로 둔 셋");
eq("틱톡 180(트리거 §2 · 모두에게 되는 값)", VIDEO_CHANNEL_MAX_SEC.tiktok, 180);
eq("페북 릴스 90(API video_reels 3~90초)", VIDEO_CHANNEL_MAX_SEC.facebook_reels, 90);
eq("🔴 대조군 · 유튜브 쇼츠는 그대로 60(트리거 §4 — 표·코인·심사가 같이 움직여야)", VIDEO_CHANNEL_MAX_SEC.youtube_shorts, 60);
eq("🔴 대조군 · 네이버 클립 그대로 30", VIDEO_CHANNEL_MAX_SEC.naver_clip, 30);
eq("🔴 대조군 · 인스타 릴스 그대로 90", VIDEO_CHANNEL_MAX_SEC.reels, 90);
ok("🔴 youtube_long 은 표에 **없다**(값을 넣는 문제가 아니다 · §3)", VIDEO_CHANNEL_MAX_SEC.youtube_long === undefined);
eq("틱톡 규격 — 채널 상한은 180, 만드는 상한은 포맷 상한(≤90)", videoChannelSpec("tiktok")?.formats.map((f) => f.maxSeconds), [90, 90, 30]);
eq("무회귀 · clampSecondsForChannel 은 여전히 15|30|60|90 만(틱톡 90 → 90)", clampSecondsForChannel("tiktok", 90), 90);
eq("무회귀 · 클립 채널 60 → 30", clampSecondsForChannel("naver_clip", 60), 30);
ok("후보 다섯 전부 표에 있다(표에 없으면 reuseFit 이 조용히 건너뛴다)", VIDEO_REUSE_TARGETS.every((c) => !!VIDEO_CHANNEL_MAX_SEC[c]));

console.log("\n② reuseFit — 트리거 §1 의 두 모양");
{
  // 원판 줄: 60초 쇼츠 → 릴스·틱톡·페북 ✅ · 클립 —
  const f60 = reuseFit({ originChannel: "youtube_shorts", seconds: 60, channels: VIDEO_REUSE_TARGETS, connected: ALL_ON });
  eq("원판 · 60초 쇼츠 → go", f60.go.map((g) => g.channel), ["reels", "tiktok", "facebook_reels"]);
  eq("원판 · 60초 쇼츠 → 클립만 빠진다(too_long)", f60.skip.map((s) => `${s.channel}:${s.why}`), ["naver_clip:too_long"]);
  eq("원판 · places = 1(원본) + go", f60.places, 4);
  eq("문장 · 사실 한 줄", f60.skip[0]?.line, "이 영상은 60초라 네이버 클립(최대 30초)엔 안 올라가요.");
  eq("문장 · 어떻게 하면 되는지", f60.skip[0]?.how, "네이버 클립에도 올리시려면 만들 때 30초를 골라 주세요.");
  const f30 = reuseFit({ originChannel: "youtube_shorts", seconds: 30, channels: VIDEO_REUSE_TARGETS, connected: ALL_ON });
  eq("30초면 다섯 곳(쇼츠+릴스+틱톡+클립+페북) · 빠지는 곳 0", [f30.places, f30.skip.length], [5, 0]);
  const f90 = reuseFit({ originChannel: "reels", seconds: 90, channels: VIDEO_REUSE_TARGETS, connected: ALL_ON });
  eq("90초 릴스 → 쇼츠(60)·클립(30) 빠지고 틱톡·페북 간다", [f90.go.map((g) => g.channel), f90.skip.map((s) => s.channel)], [["tiktok", "facebook_reels"], ["youtube_shorts", "naver_clip"]]);
  eq("90초 릴스 → 쇼츠 how 는 60초", f90.skip.find((s) => s.channel === "youtube_shorts")?.how, "유튜브 쇼츠에도 올리시려면 만들 때 60초를 골라 주세요.");
  // no_account
  const na = reuseFit({ originChannel: "youtube_shorts", seconds: 30, channels: ["tiktok", "reels"], connected: { ...ALL_ON, tiktok: false } });
  eq("계정 없는 채널 → skip no_account", na.skip.map((s) => `${s.channel}:${s.why}`), ["tiktok:no_account"]);
  eq("no_account 문장", [na.skip[0]?.line, na.skip[0]?.how], ["틱톡 계정이 아직 연결되지 않았어요.", "계정을 연결하시면 같이 올라가요."]);
  // 🔴 대조군: connected 를 안 주면 계정은 안 본다
  eq("🔴 대조군 · connected 없음 → 길이만 잰다(no_account 0)", reuseFit({ originChannel: "youtube_shorts", seconds: 30, channels: ["tiktok"] }).skip.length, 0);
  // 길이·계정 둘 다 → 길이 먼저
  const both = reuseFit({ originChannel: "youtube_shorts", seconds: 60, channels: ["naver_clip"], connected: { naver_clip: false } });
  eq("길이도 안 맞고 계정도 없으면 길이 먼저(이 영상에 대한 사실)", both.skip[0]?.why, "too_long");
  // 고르지 않은 채널은 어디에도 없다
  eq("🔴 대조군 · 고르지 않은 채널은 go·skip 어디에도 없다", reuseFit({ originChannel: "youtube_shorts", seconds: 60, channels: ["reels"], connected: ALL_ON }).skip.length, 0);
  // 중복·후보 밖
  const junk = reuseFit({ originChannel: "youtube_shorts", seconds: 30, channels: ["reels", "reels", "youtube_long", "naver_blog", "threads"], connected: ALL_ON });
  eq("후보 밖(youtube_long·naver_blog·threads)·중복은 조용히 무시 — 없는 길", [junk.go.map((g) => g.channel), junk.skip.length], [["reels"], 0]);
}

console.log("\n③ 🔴 유튜브는 한 가족에 최대 1건 — 모든 원본 × 15/30/60/90");
{
  const origins = [...new Set([...VIDEO_CHANNELS, "youtube_long", "tiktok", "facebook_reels"])];
  let worst = 0; const bad: string[] = [];
  for (const o of origins) for (const s of VIDEO_SECONDS) {
    const f = reuseFit({ originChannel: o, seconds: s, channels: [...VIDEO_REUSE_TARGETS, "youtube_long"], connected: ALL_ON });
    const yt = [o, ...f.go.map((g) => g.channel), ...f.skip.map((x) => x.channel)].filter((c) => c.startsWith("youtube_")).length;
    worst = Math.max(worst, yt); if (yt > 1) bad.push(`${o}@${s}s`);
  }
  ok(`원본 ${origins.length}종 × 길이 ${VIDEO_SECONDS.length} — 가족당 youtube_* ≤ 1(go·skip 포함)`, !bad.length, bad.join(", "));
  eq("원본이 youtube_shorts 면 후보에 youtube_* 0", reuseTargetsFor("youtube_shorts").filter((c) => c.startsWith("youtube_")), []);
  eq("원본이 youtube_long 이어도 youtube_shorts 가 빠진다(B2 지적)", reuseTargetsFor("youtube_long").filter((c) => c.startsWith("youtube_")), []);
  eq("🔴 대조군 · 원본이 클립이면 유튜브 쇼츠는 **남는다**(한 건은 간다)", reuseTargetsFor("naver_clip").includes("youtube_shorts"), true);
  ok("youtube_long 은 후보 목록에 없다", !VIDEO_REUSE_TARGETS.includes("youtube_long"));
}

console.log("\n④ 문장 말투(§3) — 모든 skip 문장");
{
  const lines: string[] = [];
  for (const o of VIDEO_CHANNELS) for (const s of VIDEO_SECONDS) {
    const f = reuseFit({ originChannel: o, seconds: s, channels: VIDEO_REUSE_TARGETS, connected: { tiktok: false } });
    for (const x of f.skip) lines.push(x.line, x.how);
  }
  ok(`문장 ${lines.length}줄 — «실패·오류·불가·정지·불이익» 0`, !lines.some((l) => /실패|오류|불가|정지|불이익|에러/.test(l)), lines.find((l) => /실패|오류|불가|정지|불이익|에러/.test(l)) ?? "");
  ok("문장에 시스템 용어(channel key) 0 — 사람말 라벨만", !lines.some((l) => /[a-z]+_[a-z]+/.test(l)), lines.find((l) => /[a-z]+_[a-z]+/.test(l)) ?? "");
  ok("원판 · 문장이 실제로 만들어졌다(빈 표가 초록이 되지 않게)", lines.length > 0);
}

console.log("\n⑤ 고를 수 있는 초 · 만든 길이");
eq("쇼츠 → 15·30·60", pickableSecondsFor("youtube_shorts"), [15, 30, 60]);
eq("클립 → 15·30", pickableSecondsFor("naver_clip"), [15, 30]);
eq("릴스 → 15·30·60·90", pickableSecondsFor("reels"), [15, 30, 60, 90]);
eq("만든 길이 · 클립형 60 → 30(shortsFormOf 와 같게)", pieceSecondsOf({ video: { format: "clip", seconds: 60 } }), 30);
eq("만든 길이 · 그래픽 15 → 30", pieceSecondsOf({ video: { format: "graphic", seconds: 15 } }), 30);
eq("만든 길이 · 아무것도 없으면 60(gen.ts 기본값과 같게)", pieceSecondsOf({}), 60);

console.log("\n⑥ 파생 meta — 발행 흔적·코인 흔적 없이 태어난다(B2 ③)");
{
  const origin = { video: { format: "graphic", seconds: 60 }, render: { scenes: [] }, youtube: { title: "t" }, affiliate: { provider: "coupang" }, disclosure: "광고",
    fbReelId: "r1", ttPublishId: "p1", thCreationId: "c1", igCreationId: "i1", igFeedCreationId: "f1", publishFail: { reason: "x" }, publishAttempts: 2,
    chainLock: null, chainStage: "done", renderJobId: 9, renderRetry: 1, renderedAt: "x", failReason: "x", coinItem: "video_60", regenCount: 1, refunded: 0,
    reuseChannels: ["reels"], reuseResult: {}, scheduleAt: "old", stage: "done" };
  const d = derivedMetaOf(origin, { originPieceId: 7, originChannel: "youtube_shorts", seconds: 60, at: "2026-09-26T00:00:00.000Z" }, "2026-09-27T00:00:00.000Z");
  const leaked = ["fbReelId", "ttPublishId", "thCreationId", "igCreationId", "igFeedCreationId", "publishFail", "publishAttempts", "chainLock", "chainStage", "renderJobId", "renderRetry", "renderedAt", "failReason", "coinItem", "regenCount", "refunded", "reuseChannels", "reuseResult"].filter((k) => k in d);
  eq("발행 멱등 키·체인·코인 흔적이 하나도 안 샌다", leaked, []);
  eq("🔴 대조군 · 올리는 데 쓰는 것(render·video·youtube·affiliate·disclosure)은 **남는다**", ["render", "video", "youtube", "affiliate", "disclosure"].filter((k) => !(k in d)), []);
  eq("meta.reuse — 원본·코인 0", d.reuse, { originPieceId: 7, originChannel: "youtube_shorts", seconds: 60, at: "2026-09-26T00:00:00.000Z", coin: 0 });
  eq("scheduleAt 은 원본 시각(힌트)으로 바뀐다", d.scheduleAt, "2026-09-27T00:00:00.000Z");
}

console.log("\n⑦ 설정 모양(settings.videoReuse)");
{
  const empty = readVideoReuse({});
  eq("키 없음 = 꺼짐 · 안 물었다(기본)", [empty.on, empty.askedAt, reuseBasisOf(empty)], [false, null, "all"]);
  const junk = readVideoReuse({ videoReuse: { on: true, channels: ["reels", "youtube_long", "reels", "naver_blog"], askedAt: "2026-09-26T00:00:00Z" } });
  eq("후보 밖·중복 채널은 읽을 때도 걸러진다", junk.channels, ["reels"]);
  eq("켜짐 → basis chosen · 고른 채널로 센다", [reuseBasisOf(junk), basisChannels(junk)], ["chosen", ["reels"]]);
  const off = readVideoReuse({ videoReuse: { on: false, channels: ["reels"], askedAt: "2026-09-26T00:00:00Z" } });
  eq("물었고 껐다 → basis off · 셀 채널 0", [reuseBasisOf(off), basisChannels(off)], ["off", []]);
  eq("🔴 대조군 · on 이 문자열 \"true\" 면 켜짐이 아니다(모르면 안 켠다)", readVideoReuse({ videoReuse: { on: "true" } }).on, false);
}

console.log("\n⑧ 🔴 파생 경로에 코인 차감 수단이 없다(⚠️ 대용물 — 원장 0행은 C 가 라이브로 잰다)");
{
  const src = readFileSync(new URL("../lib/video/reuse.ts", import.meta.url), "utf8");
  const code = src.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
  ok("reuse.ts 가 coin-ledger 를 import 하지 않는다", !/from\s+["'][^"']*coin-ledger["']/.test(code));
  ok("reuse.ts 코드에 consume( 호출 0", !/\bconsume\s*\(/.test(code));
  ok("원판 · 파생 INSERT 가 origin_piece_id 를 쓴다(자가 빈 파일을 재지 않게)", /INSERT INTO pieces[\s\S]{0,400}origin_piece_id/.test(code));
  ok("파생은 scheduled 로 태어난다(approved 아님 · AC-178)", /'scheduled', gate_report/.test(code) && !/'approved', gate_report/.test(code));
  const pieces = readFileSync(new URL("../netlify/functions/pieces.ts", import.meta.url), "utf8");
  ok("pieces-regenerate 가 파생을 거절한다", /origin_piece_id[\s\S]{0,120}step: "derived"/.test(pieces));
}

console.log(`\n${fail ? "🔴" : "✅"} R18 재사용 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
