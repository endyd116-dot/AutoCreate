/**
 * scripts/verify-video-motion.mjs — [R12-1·2·4] **자막 모션 · 컷 전환 · 컷 하한**의 자.
 *   `node scripts/verify-video-motion.mjs` · 종료코드 0 = 전부 통과.
 *
 *   ══ 🔴 이 자가 무엇을 재나 — «있나»가 아니라 «도나» ══
 *     `runner/channels/render-video.mjs` 의 **`buildRenderArgs`(순수)** 와 `lib/video/scenes.ts` 의 **`applyCutFloor`(순수)**
 *     를 **실제로 돌려** 나온 값을 본다. 소스에 그 줄이 있나를 세지 않는다(그러면 `if(false)` 로 바꿔도 초록이다 · AC-99 ⑩).
 *
 *   ══ 🔴 축 ① 무회귀 — **기댓값을 손으로 적었다** ══
 *     모션·전환을 **안 보냈을 때** 나와야 하는 ffmpeg 인자를, 베이스 판(`9d81a2b`)의 `render-video.mjs` 를 **읽고 옮겨 적었다.**
 *     🔴 이 함수의 출력에서 기댓값을 뽑아 오면 그게 **AC-78**(검사가 값을 베끼는 것)이다 — 그러면 내가 무엇을 바꿔도 늘 초록이다.
 *     ⇒ 아래 `BASE_ARGS` 는 **사람이 적은 글자**다. 렌더를 일부러 고치면 이 줄도 같이 고쳐야 하고, 그게 맞다.
 *
 *   ══ 🔴 이 자가 **못 재는 것** — 그리고 그게 오늘 우리를 물었다 ══
 *     이 자는 **ffmpeg 인자까지**다. «인자는 맞는데 **나온 파일**의 프레임이 안 달라진다»는 **원리상 못 잡는다.**
 *     2026-09-17 에 정확히 그 일이 났다: `eof_action=pass` 라 오버레이가 **한 장도 안 얹히는데** 인자는 멀쩡했다(C 가 잡았다).
 *     ⇒ **굽는 자(C)와 이 자는 다른 층을 본다.** 한 층만 보면 또 난다.
 *
 *     🔴 B2 가 이 기계에서 **직접 구워 본 값**(ffmpeg 8.1.2 · 320×240 검은 4초 + 빨간 PNG · 창 1.0~2.0초 · 좌상단 픽셀):
 *       · `eof_action=pass`  → @1.5s **(0,0,0)**      = 창 안인데 **안 그려진다**
 *       · `eof_action=repeat`→ @1.5s **(252,0,0)** · @3.0s (0,0,0) = 창 밖엔 안 그려진다(맞다)
 *       · `fade`             → @1.0s (0,0,0) · @1.1s **(124,0,0)** · @1.5s (252,0,0)   = 투명도가 실제로 오른다
 *       · `pop`              → @1.0s (0,0,0) · @1.5s (252,0,0)                          = 작을 땐 좌상단이 비어 있다
 *       · `slide_up`         → @1.0s (0,0,0) · @1.5s (252,0,0)                          = 내려가 있다가 제자리로
 *       · 전환 `fade`        → **길이 5.000000 ↔ 전환 없음 5.000000(같다)** · @1.85s none (0,0,254) vs fade **(0,68,113)**
 *         ⇒ 🔴 «길이는 그대로인데 그림만 섞인다»가 **실물로** 확인됐다.
 *
 *   ══ 🔴 굽는 자를 만들 사람에게 — C 가 알려 준 함정(출처: autocreate-c 2026-09-17) ══
 *     «프레임 해시가 전부 다르다»를 «전 프레임이 달라졌다»로 읽지 마라.
 *     🔴 **프레임 0 하나만 바뀌어도 뒤의 P 프레임이 그걸 참조해 `framemd5` 가 120장 전부 다르게 나온다.**
 *     C 의 대조군이 그래서 **엉뚱한 이유로 초록**이었다. 창 «안쪽» 프레임을 **픽셀로** 봐야 한다.
 *
 *   ══ 🔴 변이(mutation) — 표 맨 윗줄이 «원판»이다(AC-100 ⑦) ══
 *     원판 줄이 초록이 아니면 **표 전체를 버린다**. 그리고 변이를 **심은 자리 수를 센다**(0곳 = 못 심음 · 2곳 이상 = 하니스 고장).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildRenderArgs, planTransitions, motionForLayer,
  CAPTION_MOTION_MS, CAPTION_MOTION_MIN_WINDOW_MS, TRANSITION_MS, TRANSITION_MIN_CUT_MS,
  pickVerifyLayer,
} from "../runner/channels/render-video.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0, pass = 0;
const ok = (name, cond, detail = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${detail ? " — " + detail : ""}`); } };
/** 🔴 역슬래시 없는 세기 — 이 환경의 셸이 역슬래시를 한 겹 먹어 정규식이 조용히 다른 것을 잰다(계약 §4b). */
const s_count = (hay, needle) => String(hay).split(needle).length - 1;
const eq = (name, got, want) => ok(name, got === want, `기대 «${String(want).slice(0, 220)}» / 실제 «${String(got).slice(0, 220)}»`);

/* ═══════════ 고정 재료 — 2장면(정지) · 자막 2구절 · 나레이션 1 · BGM 없음 ═══════════ */
const fixture = (over = {}) => ({
  sceneFiles: [
    { idx: 0, durMs: 2000, isClip: false, file: "sc-000.png" },
    { idx: 1, durMs: 3000, isClip: false, file: "sc-001.png" },
  ],
  layers: [
    { file: "ov-000.png", startMs: 0, endMs: 2000, motion: "none" },
    { file: "ov-001.png", startMs: 2000, endMs: 5000, motion: "none" },
  ],
  narration: [{ file: "nar-0.wav", atMs: 0 }],
  bgm: null,
  out: { w: 1080, h: 1920, fps: 30, maxSeconds: 15, crf: 20 },
  outPath: "out.mp4",
  bodySec: 5,
  deco: false,
  wantTransition: "none",
  payload: { audio: { loudnorm: { I: -16, TP: -1.5, LRA: 11 } } },
  ...over,
});

/* 🔴 **손으로 적은 기댓값** — 베이스 판 `render-video.mjs` 의 ④ 블록을 읽고 그대로 옮겼다.
 *
 *   🔴🔴 **2026-09-17: 이 기댓값을 한 군데 «일부러» 고쳤다 — `eof_action=pass` → `repeat`.**
 *      베이스 판이 **틀려 있었다**(C 발견 · B2 가 ffmpeg 8.1.2 로 실측 확인):
 *      오버레이 입력이 단일 프레임이라 t=0 에 EOF 고, `pass` 는 그때부터 본편을 통과시켜
 *      **자막·제휴 고지·배지·엔드카드가 첫 프레임 말고는 안 실렸다.**
 *      ⇒ 여기서 «무회귀»는 **«종전과 같게»가 아니라 «종전에서 이 한 글자만 다르게»**다.
 *      🔴 이 줄을 조용히 고치면 그게 «조용한 개편»이다. 그래서 **이 주석과 아래 ⑦ 축이 같이 있다.** */
const NORM = (i, dur) => `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,trim=duration=${dur},setpts=PTS-STARTPTS[v${i}]`;
const BASE_FC = [
  NORM(0, "2.000"),
  NORM(1, "3.000"),
  "[v0][v1]concat=n=2:v=1:a=0[base]",
  "[base][2:v]overlay=0:0:enable='between(t,0.000,2.000)':eof_action=repeat[ov0]",
  "[ov0][3:v]overlay=0:0:enable='between(t,2.000,5.000)':eof_action=repeat[vout]",
  "[4:a]adelay=0|0[n0]",
  "[n0]amix=inputs=1:duration=longest:dropout_transition=0:normalize=0[amixed]",
  "[amixed]loudnorm=I=-16:TP=-1.5:LRA=11[aout]",
].join(";");
const BASE_ARGS = [
  "-y",
  "-loop", "1", "-t", "2.000", "-i", "sc-000.png",
  "-loop", "1", "-t", "3.000", "-i", "sc-001.png",
  "-i", "ov-000.png",
  "-i", "ov-001.png",
  "-i", "nar-0.wav",
  "-filter_complex", BASE_FC, "-map", "[vout]",
  "-map", "[aout]", "-c:a", "aac", "-b:a", "192k",
  "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-pix_fmt", "yuv420p", "-r", "30",
  "-t", "5.000", "-movflags", "+faststart", "out.mp4",
];

console.log("① 무회귀 — 안 보내면 **어제와 같은 인자**인가(기댓값은 손으로 적었다)");
{
  const { args } = buildRenderArgs(fixture());
  eq("deco=false · 인자 전체가 베이스와 한 글자도 안 다르다", args.join(""), BASE_ARGS.join(""));

  /* payload 에 키를 **안 넣은** 채 deco 를 켜도 같아야 한다 — «켰는데 안 보냈다» 는 여전히 어제다. */
  const { args: a2 } = buildRenderArgs(fixture({ deco: true }));
  eq("deco=true 인데 모션·전환을 안 보냈다 → 여전히 베이스와 같다", a2.join(""), BASE_ARGS.join(""));
  /* 🔴 **되돌릴 길의 자**(변이표가 찾아낸 구멍 · 2026-09-17) — 꾸미다 인코딩이 죽으면 `deco:false` 로 한 번 더 굽는다.
     그때 층에는 **이미 모션이 박혀 있다**. 그래도 베이스와 같아야 «되돌린 것»이다.
     ⚠️ 이 줄이 없을 때는 ① 축의 층이 전부 `motion:"none"` 이라 `deco` 분기를 **아무도 안 밟았다** — 변이가 초록이었다. */
  const { args: aBack } = buildRenderArgs(fixture({
    deco: false, wantTransition: "fade",
    layers: [
      { file: "ov-000.png", startMs: 0, endMs: 2000, motion: "fade" },
      { file: "ov-001.png", startMs: 2000, endMs: 5000, motion: "pop" },
    ],
  }));
  eq("되돌림 — 꾸밈을 끄면 층에 모션이 박혀 있어도 베이스와 같다", aBack.join(""), BASE_ARGS.join(""));
}

console.log("② 전체 길이 불변 — 전환을 켜도 규격이 안 밀리나");
{
  const tr = planTransitions([2000, 3000], "fade");
  ok("전환이 걸린다", tr.ms === TRANSITION_MS && tr.at[0] === true, JSON.stringify(tr));
  ok("첫 컷은 안 늘린다 · 둘째만 전환만큼 늘린다", tr.extendMs[0] === 0 && tr.extendMs[1] === TRANSITION_MS, JSON.stringify(tr.extendMs));

  const { args } = buildRenderArgs(fixture({ deco: true, wantTransition: "fade" }));
  const fc = args[args.indexOf("-filter_complex") + 1];
  /* 🔴 길이 산수: 입력 2.000 + (3.000+0.300) − 0.300 = 5.000. offset = 2.000 − 0.300. */
  ok("둘째 컷 입력이 3.300 으로 늘어난다", args.join(" ").includes("-t 3.300 -i sc-001.png"), args.join(" "));
  ok("xfade offset 이 1.700(= 2.000 − 0.300)", fc.includes("xfade=transition=fade:duration=0.300:offset=1.700"), fc);
  ok("출력 잠금(-t)은 5.000 그대로 — **밀리지 않는다**", args[args.lastIndexOf("-t") + 1] === "5.000", args[args.lastIndexOf("-t") + 1]);
  ok("나레이션 시각은 한 밀리초도 안 움직인다", fc.includes("[4:a]adelay=0|0[n0]"), fc);
  ok("자막 시각도 그대로", fc.includes("between(t,2.000,5.000)"), fc);

  /* 짧은 컷은 건너뛴다 — 겹칠 자리가 없다. */
  const short = planTransitions([700, 3000, 3000], "fade");
  ok("0.8초 미만 컷이 낀 경계는 건너뛴다", short.at[0] === false && short.at[1] === true && short.skipped === 1, JSON.stringify(short.at));
  ok("건너뛴 경계 앞 컷은 안 늘어난다", short.extendMs[0] === 0 && short.extendMs[1] === 0 && short.extendMs[2] === TRANSITION_MS, JSON.stringify(short.extendMs));
  ok("건너뛰면 덩어리가 갈린다(그 사이는 concat)", JSON.stringify(short.runs) === JSON.stringify([[0], [1, 2]]), JSON.stringify(short.runs));
  const { args: a3 } = buildRenderArgs(fixture({
    deco: true, wantTransition: "fade",
    sceneFiles: [
      { idx: 0, durMs: 700, isClip: false, file: "a.png" },
      { idx: 1, durMs: 3000, isClip: false, file: "b.png" },
      { idx: 2, durMs: 3000, isClip: false, file: "c.png" },
    ],
  }));
  const fc3 = a3[a3.indexOf("-filter_complex") + 1];
  ok("갈린 덩어리는 concat 으로 다시 잇는다", fc3.includes("concat=n=2:v=1:a=0[base]"), fc3);
  ok("xfade 는 한 번만 걸린다", (fc3.match(/xfade=/g) || []).length === 1, fc3);

  /* 영상 조각은 `tpad` 로 늘린다 — 조각이 창에 딱 맞게 만들어져 더 뽑을 그림이 없다. */
  const { args: a4 } = buildRenderArgs(fixture({
    deco: true, wantTransition: "slide",
    sceneFiles: [
      { idx: 0, durMs: 2000, isClip: true, file: "a.mp4" },
      { idx: 1, durMs: 3000, isClip: true, file: "b.mp4" },
    ],
  }));
  const fc4 = a4[a4.indexOf("-filter_complex") + 1];
  ok("영상 조각은 tpad 로 늘린다", fc4.includes("tpad=stop_mode=clone:stop_duration=0.300"), fc4);
  ok("늘린 조각을 그만큼 잘라 준다", fc4.includes("trim=duration=3.300"), fc4);
  ok("slide 는 slideleft 로 나간다", fc4.includes("xfade=transition=slideleft"), fc4);
  ok("첫 조각에는 tpad 가 없다", (fc4.match(/tpad=/g) || []).length === 1, fc4);
}

console.log("③ 못 냈어요 — 못 내는 자리는 `none` 으로 내려앉나");
{
  ok("전환 이름을 모르면 안 건다", planTransitions([3000, 3000], "wipe").ms === 0);
  ok("컷이 하나면 안 건다", planTransitions([3000], "fade").ms === 0);
  ok("모션 이름을 모르면 안 건다", motionForLayer("phrase", 3000, "typewriter") === "none");
  const trOff = planTransitions([3000, 3000], "none");
  ok("`none` 이면 덩어리가 낱개다(= 종전 concat 갈래)", JSON.stringify(trOff.runs) === JSON.stringify([[0], [1]]), JSON.stringify(trOff.runs));
  /* ffmpeg 판정은 실제 바이너리를 부르므로 여기서는 «부를 수 있는가»만 본다 — 판정 자체는 러너가 실측한다. */
  ok("`hasXfade` 는 판 번호가 아니라 `-filters` 를 부른다(소스 대조)", readFileSync(join(ROOT, "runner/channels/render-video.mjs"), "utf8").includes('"-hide_banner", "-filters"'));
}

console.log("④ 대조군 짝 — 안 걸어야 할 데는 안 걸리나(AC-68)");
{
  eq("고지 자막에는 안 건다", motionForLayer("disclosure", 3000, "fade"), "none");
  eq("엔드카드에도 안 건다", motionForLayer("endcard", 2500, "pop"), "none");
  eq(`${CAPTION_MOTION_MIN_WINDOW_MS}ms 미만 구절에는 안 건다`, motionForLayer("phrase", CAPTION_MOTION_MIN_WINDOW_MS - 1, "fade"), "none");
  eq("긴 구절에는 건다", motionForLayer("phrase", CAPTION_MOTION_MIN_WINDOW_MS, "fade"), "fade");

  /* 🔴 한 영상 안에 «걸린 층»과 «안 걸린 층»이 같이 있어야 한다 — 그래야 대조군이다. */
  const mixed = fixture({
    deco: true,
    layers: [
      { file: "ov-disc.png", startMs: 0, endMs: 3000, motion: "none" },     // 고지
      { file: "ov-000.png", startMs: 0, endMs: 2000, motion: "fade" },      // 구절
      { file: "ov-001.png", startMs: 2000, endMs: 5000, motion: "none" },   // 짧아서 못 건 구절
    ],
    narration: [{ file: "nar-0.wav", atMs: 0 }],
  });
  const { args } = buildRenderArgs(mixed);
  const fc = args[args.indexOf("-filter_complex") + 1];
  ok("걸린 층에만 fade 필터가 붙는다(정확히 한 층)", (fc.match(/fade=t=in:st=0:d=0\.160:alpha=1/g) || []).length === 1, fc);
  /* 🔴 세는 것은 «overlay 줄 수»가 아니라 «**모션 스트림을 거친 층 수**»다 —
     `fade` 도 overlay 모양은 `0:0` 그대로라, overlay 줄을 세면 셋 다 같아 보여 **거저 초록**이 된다. */
  ok("모션 스트림을 거친 층은 정확히 하나(정의 1번 + 얹기 1번 = 2곳)", s_count(fc, "[ovs") === 2, fc);
  ok("나머지 둘은 입력에서 곧바로 얹는다", s_count(fc, ":v]overlay=0:0:enable=") === 2, fc);
  ok("모션 층만 -loop 입력으로 바뀐다", (args.join(" ").match(/-loop 1 -t 2\.000 -i ov-000\.png/g) || []).length === 1, args.join(" "));
  ok("안 걸린 층은 -loop 없이 그대로", args.join(" ").includes("-i ov-disc.png") && !args.join(" ").includes("-t 3.000 -i ov-disc.png"), args.join(" "));
}

console.log("⑤ 모션 갈래마다 **다른 필터**가 나오나(같은 것이 나오면 아무도 안 읽은 것이다)");
{
  const of = (m) => {
    const { args } = buildRenderArgs(fixture({ deco: true, layers: [{ file: "ov.png", startMs: 1000, endMs: 4000, motion: m }], narration: [] }));
    return args[args.indexOf("-filter_complex") + 1];
  };
  const none = of("none"), fade = of("fade"), slide = of("slide_up"), pop = of("pop");
  ok("fade ≠ none", fade !== none);
  ok("slide_up ≠ none", slide !== none);
  ok("pop ≠ none", pop !== none);
  ok("넷이 서로 다르다", new Set([none, fade, slide, pop]).size === 4);
  ok(`fade 길이는 ${CAPTION_MOTION_MS}ms`, fade.includes(`d=${(CAPTION_MOTION_MS / 1000).toFixed(3)}`), fade);
  ok("fade 는 제자리로 민다(setpts)", fade.includes("setpts=PTS+1.000/TB"), fade);
  ok("slide_up 은 y 식으로만 낸다(입력 모양은 안 바꾼다)", slide.includes("overlay=x=0:y='if(lt(t-1.000,0.160)"), slide);
  ok("pop 은 0.94 에서 1.0 으로 끝난다", pop.includes("0.94+0.06*min(1,t/0.160)"), pop);
  ok("pop 은 가운데로 얹는다", pop.includes("overlay=x='(W-w)/2':y='(H-h)/2'"), pop);
}

/* ═══════════ ⑥ 컷 하한(R12-4) — `lib/video/scenes.ts` 의 순수 함수 ═══════════ */
console.log("⑥ 컷 하한 — 늘리기만 하고, 넘치면 통째로 버리나");
{
  const mod = await import("tsx/esm/api").then((api) => api.register()).then(() => import("../lib/video/scenes.ts")).catch(() => null);
  if (!mod) { console.log("  ⊘ tsx 없이 못 불렀다 — `verify-cut-floor.mts` 가 같은 축을 잰다"); }
  else {
    const W = [
      { idx: 0, lineIdx: [0], startMs: 0, endMs: 1000 },
      { idx: 1, lineIdx: [1], startMs: 1000, endMs: 4000 },
    ];
    const LN = [{ idx: 0, startMs: 0, endMs: 1000 }, { idx: 1, startMs: 1000, endMs: 4000 }];
    const same = mod.applyCutFloor(W, LN, undefined, 15000);
    ok("하한을 안 주면 들어온 값 그대로(무회귀)", JSON.stringify(same.windows) === JSON.stringify(W) && JSON.stringify(same.lines) === JSON.stringify(LN) && same.appliedMs === null);
    const up = mod.applyCutFloor(W, LN, 2000, 15000);
    ok("짧은 컷만 늘어난다", up.windows[0].endMs === 2000 && up.appliedMs === 2000, JSON.stringify(up.windows));
    ok("뒤 컷이 그만큼 밀린다", up.windows[1].startMs === 2000 && up.windows[1].endMs === 5000, JSON.stringify(up.windows));
    ok("그 컷의 문장도 같이 민다", up.lines[1].startMs === 2000 && up.lines[1].endMs === 5000, JSON.stringify(up.lines));
    ok("늘리기만 한다 — 긴 컷은 안 줄인다", up.windows[1].endMs - up.windows[1].startMs === 3000);
    const over = mod.applyCutFloor(W, LN, 8000, 15000);
    ok("다 더해 규격을 넘으면 통째로 버린다", JSON.stringify(over.windows) === JSON.stringify(W) && over.appliedMs === null, JSON.stringify(over));
    ok("버렸다는 사실을 사람말로 돌려준다", typeof over.why === "string" && over.why.includes("못 했어요"), String(over.why));
  }
}

console.log("⑦ 🔴 오버레이가 **정말 얹히나** — `eof_action` 은 `pass` 가 아니라 `repeat` 이어야 한다");
{
  /* 🔴 **왜 이 축이 영구로 있나**(2026-09-17 · C 발견 · B2 실측):
       오버레이 PNG 는 **단일 프레임**이라 t=0 에 EOF 다. `pass` 는 그 순간부터 본편을 그대로 통과시켜
       **`enable` 창이 와도 영영 안 얹힌다** — 자막·**제휴 고지**·배지·엔드카드가 통째로 사라진다.
       실측(ffmpeg 8.1.2): `pass` → 창 안 프레임 (0,0,0) · `repeat` → (252,0,0).
     🔴 이 축은 «있나»가 아니라 «**어느 쪽 글자인가**»를 잰다 — 산출물로 재는 것은 C 의 자다(굽는 자).
       둘이 **다른 층**을 봐야 한다: 나는 인자를, C 는 나온 파일을. 한 층만 보면 오늘 같은 일이 또 난다. */
  const all = [
    buildRenderArgs(fixture()),
    buildRenderArgs(fixture({ deco: true, wantTransition: "fade", layers: [{ file: "a.png", startMs: 0, endMs: 3000, motion: "fade" }], narration: [] })),
    buildRenderArgs(fixture({ deco: true, layers: [{ file: "a.png", startMs: 0, endMs: 3000, motion: "slide_up" }], narration: [] })),
    buildRenderArgs(fixture({ deco: true, layers: [{ file: "a.png", startMs: 0, endMs: 3000, motion: "pop" }], narration: [] })),
  ].map(({ args }) => args[args.indexOf("-filter_complex") + 1]);
  ok("어느 갈래에도 `eof_action=pass` 가 없다", all.every((fc) => s_count(fc, "eof_action=pass") === 0), all.join(" || "));
  ok("모든 overlay 가 `eof_action=repeat` 이다", all.every((fc) => s_count(fc, "overlay") === s_count(fc, "eof_action=repeat")), all.join(" || "));
}

console.log("⑧ 🔴 «오버레이가 정말 실렸나» 확인기 — 재는 자리가 맞나");
{
  /* 🔴 **이 축이 있는 까닭**(2026-09-17 실측): 처음 만든 확인기는 «층을 통째로 빼고» 견줬는데,
       그러면 `overlay` 필터가 **사라져** 색공간 왕복이 한 번 줄고 **아무것도 안 그려도 픽셀이 달라진다**
       ⇒ «달라졌으니 그려졌다»가 늘 참이 되어 **옛 `eof_action=pass` 판을 못 잡았다**(실물로 확인했다).
       ⇒ 기준판은 **층을 두고 창만 출력 밖으로 민다** — 필터 사슬의 «모양»이 같아야 차이가 하나로 좁혀진다. */
  const ctxV = fixture({ layers: [{ file: "ov.png", role: "disclosure", startMs: 1000, endMs: 3000, motion: "none" }], narration: [] });
  const { args: withA } = buildRenderArgs({ ...ctxV, rawProbe: { atSec: 2.0 } });
  const { args: farA } = buildRenderArgs({ ...ctxV, layers: [{ ...ctxV.layers[0], startMs: 15000, endMs: 17000 }], rawProbe: { atSec: 2.0 } });
  ok("날 프레임으로 뽑는다(rawvideo · rgb24)", withA.includes("rawvideo") && withA.includes("rgb24"), withA.join(" "));
  ok("🔴 **x264 를 안 태운다**(태우면 율 제어가 달라 늘 «그려졌다»가 된다)", !withA.includes("libx264"), withA.join(" "));
  ok("오디오를 안 싣는다(확인에 필요 없다)", !withA.includes("[aout]"), withA.join(" "));
  const fcW = withA[withA.indexOf("-filter_complex") + 1], fcF = farA[farA.indexOf("-filter_complex") + 1];
  ok("🔴 기준판은 **필터 수가 같다**(층을 빼지 않는다)", s_count(fcW, "overlay") === 1 && s_count(fcF, "overlay") === 1, fcW + " || " + fcF);
  ok("🔴 그리고 **창만 다르다**", fcW !== fcF && fcW.includes("between(t,1.000,3.000)") && fcF.includes("between(t,15.000,17.000)"), fcW + " || " + fcF);

  /* 🔴 **법이 읽는 것부터 확인한다** — 고지 → 배지 → 구절. */
  eq("고지 층이 있으면 그것으로 잰다", pickVerifyLayer([{ role: "phrase", startMs: 0, endMs: 2000 }, { role: "disclosure", startMs: 0, endMs: 3000 }]), 1);
  eq("고지가 없으면 배지", pickVerifyLayer([{ role: "phrase", startMs: 0, endMs: 2000 }, { role: "badge", startMs: 0, endMs: 5000 }]), 1);
  eq("둘 다 없으면 구절", pickVerifyLayer([{ role: "phrase", startMs: 0, endMs: 2000 }]), 0);
  eq("🔴 층이 없으면 -1 — 키를 아예 안 보낸다(«확인할 게 없다»와 «못 쟀다»는 다르다)", pickVerifyLayer([]), -1);
  /* 🔴 B 의 규칙(2026-09-17): «**못 잰다**로 내려앉는 조건에 입력이 둘 이상이면 대조군이 있어야 한다».
     `pickVerifyLayer` 는 «층이 있나» × «창이 충분한가» 둘을 본다 ⇒ **양쪽 다** 재야 한다.
     이 줄이 없으면 «창 길이를 아예 안 본다»로 바꿔도 초록이다. */
  eq("층은 있는데 창이 다 너무 짧으면 -1(못 잰다)", pickVerifyLayer([{ role: "phrase", startMs: 0, endMs: 100 }]), -1);
  eq("짧은 층과 긴 층이 섞이면 **긴 쪽**을 고른다", pickVerifyLayer([{ role: "phrase", startMs: 0, endMs: 100 }, { role: "phrase", startMs: 0, endMs: 3000 }]), 1);
}

console.log(`\n${fail === 0 ? "초록" : "빨강"} — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
