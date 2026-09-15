/**
 * scripts/verify-video-safe-area.mts — 안전영역·자막 줄 수 축이 **진짜 잡는지** 돌려서 확인한다(R8-A §3 · 2026-09-15 B2).
 *
 *   🔴 이 검사가 필요한 이유가 코드에 남아 있다. 종전 `safe_area` 축은 이렇게 생겼었다:
 *        axis("safe_area", p.overlay.safeZone.top === 220 && p.overlay.safeZone.bottom === 300 && ...)
 *      축 이름은 «자막·배지가 안전영역 안»인데 실제로 잰 건 **«그 숫자가 그 숫자인가»**다(AC-57).
 *      그래서 **틀린 값(300)을 초록으로 찍고**, 쇼츠 규격(390)으로 고치면 **그 순간 빨강**이 됐다 — 고치면 검사가 막았다.
 *      같은 실수를 또 하지 않으려면 **«일부러 틀린 페이로드가 빨강으로 나오는가»**를 매번 확인해야 한다(AC-33).
 *
 *   🔴 그래서 이 파일의 절반이 **음성 대조**다. «전부 초록»이면 아무것도 안 보는 축이라는 뜻이라 초록을 취소한다.
 *
 *   실행: npx --yes tsx scripts/verify-video-safe-area.mts        (DB·네트워크·provider 호출 0)
 */
import { judgePayloadDeterministic, captionLinesOf, CAPTION_MAX_LINES } from "../lib/video/judge";
import { SAFE_ZONE_OF, safeZoneOf, type RenderPayload, type VideoChannel } from "../lib/video/types";

/** 최소한의 페이로드 — 안전영역·자막 축만 보므로 나머지는 통과하게 채운다. */
function payload(o: {
  channel?: VideoChannel; top: number; bottom: number; side?: number;
  badge?: boolean; preset?: "keyword_center" | "talking_big" | "clip_top"; phrases?: string[];
}): RenderPayload {
  const texts = o.phrases ?? ["보증금 지키는 법", "확정일자 먼저", "오늘 바로 해요"];
  return {
    pieceId: 1, tenantId: 1,
    out: { w: 1080, h: 1920, fps: 30, maxSeconds: 30, crf: 20 },
    scenes: [{ idx: 0, startMs: 0, endMs: 4000 }, { idx: 1, startMs: 4000, endMs: 9000 }, { idx: 2, startMs: 9000, endMs: 15000 }] as RenderPayload["scenes"],
    captions: {
      preset: o.preset ?? "keyword_center",
      phrases: texts.map((t, i) => ({ idx: i, text: t, startMs: i * 5000, endMs: i * 5000 + 4800 })),
      srtKey: "x.srt",
    },
    audio: { narration: [], bgm: null, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 } },
    overlay: {
      badge: o.badge ? { text: "유료 광고 포함", corner: "tr" } : null,
      safeZone: { top: o.top, bottom: o.bottom, ...(o.side !== undefined ? { side: o.side } : {}) },
      endcard: { text: "오늘 바로 해 보세요" },
    },
    disclosureCaption: null,
    ...(o.channel ? { channel: o.channel } : {}),
  } as RenderPayload;
}

const axisOf = (p: RenderPayload, key: string) => judgePayloadDeterministic(p, {}, null, "보증금 지키는 법").axes.find((a) => a.key === key);

interface C { name: string; p: RenderPayload; key: string; want: boolean; why: string }
const CASES: C[] = [
  /* ── 양성: 채널 규격대로면 통과해야 한다 ── */
  ...(["youtube_shorts", "reels", "naver_clip"] as VideoChannel[]).map((ch) => ({
    name: `${ch} — 그 채널 규격대로`, key: "safe_area", want: true, why: "기준선",
    p: payload({ channel: ch, ...SAFE_ZONE_OF[ch] }),
  })),
  /* ── 🔴 음성 대조: 종전 값(220/300)은 **셋 다 빨강**이어야 한다 ── */
  ...(["youtube_shorts", "reels", "naver_clip"] as VideoChannel[]).map((ch) => ({
    name: `🔴 ${ch} — 종전 값 220/300`, key: "safe_area", want: false,
    why: "🔴 이게 초록이면 이번 고침이 아무것도 안 한 것이다(종전 축이 정확히 이걸 초록으로 찍었다)",
    p: payload({ channel: ch, top: 220, bottom: 300 }),
  })),
  /* ── 채널마다 기준이 **다르게** 적용되는가(한 값으로 다 통과하면 채널 구분이 헛것이다) ── */
  {
    name: "🔴 틱톡 값(108/320)을 쇼츠에 쓰면", key: "safe_area", want: false,
    why: "🔴 채널별로 다른 기준이 실제로 적용되는지 — 한 값이 다 통과하면 구분이 헛것이다",
    p: payload({ channel: "youtube_shorts", top: 108, bottom: 320 }),
  },
  {
    name: "쇼츠 값(180/390)을 릴스에 쓰면", key: "safe_area", want: false,
    why: "릴스는 아래가 450 이라 390 으로는 모자란다",
    p: payload({ channel: "reels", top: 180, bottom: 390 }),
  },
  {
    name: "릴스 값(220/450)을 쇼츠에 쓰면", key: "safe_area", want: true,
    why: "더 보수적인 값은 통과해야 한다(넉넉한 건 문제가 아니다)",
    p: payload({ channel: "youtube_shorts", top: 220, bottom: 450 }),
  },
  /* ── 채널을 모를 때는 **가장 보수적인 기준**으로 ── */
  {
    name: "채널 없음 + 쇼츠 값", key: "safe_area", want: false,
    why: "모르면 안전한 쪽(AC-9) — 가장 넓은 기준으로 본다",
    p: payload({ top: 180, bottom: 390 }),
  },
  { name: "채널 없음 + 보수적 값", key: "safe_area", want: true, why: "기준선", p: payload({ top: 220, bottom: 450 }) },
  /* ── 좌우 여백 ── */
  {
    name: "🔴 좌우 여백 20px", key: "safe_area", want: false, why: "🔴 좌우도 실제로 보는지",
    p: payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.youtube_shorts, side: 20 }),
  },
  /* ── 배지(제휴 고지) ── */
  {
    name: "배지 있음 + 규격대로", key: "safe_area", want: true, why: "고지 배지가 안전영역 안",
    p: payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.youtube_shorts, badge: true }),
  },
  {
    name: "🔴 배지 있음 + 위가 모자람", key: "safe_area", want: false,
    why: "🔴 배지가 상단 UI 에 가려지면 §16B 고지가 안 보인다 — 품질이 아니라 정책",
    p: payload({ channel: "youtube_shorts", top: 80, bottom: 390, badge: true }),
  },
  /* ── 자막 줄 수 ── */
  {
    name: "자막 짧음(1줄)", key: "caption_lines", want: true, why: "기준선",
    p: payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.youtube_shorts, phrases: ["확정일자 먼저"] }),
  },
  {
    name: "🔴 자막 3줄짜리(큰 글씨)", key: "caption_lines", want: false,
    why: "🔴 한국어 자막 표준은 최대 2줄 — 넘으면 잡아야 한다",
    p: payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.youtube_shorts, preset: "talking_big", phrases: ["보증금을 지키려면 확정일자와 전입신고를 같은 날에 끝내야 합니다"] }),
  },
  {
    name: "지금 규칙(≤12음절)은 2줄 안", key: "caption_lines", want: true,
    why: "현재 분할기 상한이면 어느 프리셋에서도 2줄을 안 넘는다",
    p: payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.youtube_shorts, preset: "talking_big", phrases: ["확정일자 먼저 받으세요"] }),
  },
];

let pass = 0; const fails: string[] = [];
console.log("\n  안전영역·자막 줄 수 축 실측 (provider 호출 0)\n");
for (const c of CASES) {
  const a = axisOf(c.p, c.key);
  const got = a?.pass === true;
  const ok = got === c.want;
  if (ok) pass++; else fails.push(`${c.name} — 기대 ${c.want ? "통과" : "빨강"} · 실제 ${got ? "통과" : "빨강"}  (${c.why})`);
  console.log(`  ${ok ? "✓" : "✗"} ${c.name.padEnd(40)} ${got ? "통과" : "빨강"}${a?.detail ? `  ${a.detail.slice(0, 58)}` : ""}`);
}

/* 🔴 음성 대조의 음성 대조 — 축이 «전부 초록»이거나 «전부 빨강»이면 아무것도 안 보는 것이다. */
const verdicts = CASES.map((c) => axisOf(c.p, c.key)?.pass === true);
const spread = verdicts.some((v) => v) && verdicts.some((v) => !v);
console.log(`\n  ${spread ? "✓" : "✗"} 음성 대조 — 통과와 빨강이 ${spread ? "둘 다 나온다" : "🔴 한쪽만 나온다(축이 헛돈다)"}`);
if (!spread) fails.push("판정이 한쪽으로 쏠렸다 — 초록이어도 의미가 없다");

/* 순수 함수도 한 번 — 줄 수 계산이 뒤집히지 않았나 */
const l1 = captionLinesOf("확정일자 먼저", 78, 960), l3 = captionLinesOf("가".repeat(40), 92, 960);
const pureOk = l1 === 1 && l3 > CAPTION_MAX_LINES;
console.log(`  ${pureOk ? "✓" : "✗"} 줄 수 계산 — 짧은 구절 ${l1}줄 · 40자 큰글씨 ${l3}줄`);
if (!pureOk) fails.push("captionLinesOf 가 이상하다");

/* 채널 표 자체도 본다 — 폴백이 «가장 보수적»인지 */
const fb = safeZoneOf("없는채널");
const fbOk = fb.bottom >= Math.max(...Object.values(SAFE_ZONE_OF).map((z) => z.bottom));
console.log(`  ${fbOk ? "✓" : "✗"} 모르는 채널 폴백이 가장 보수적(아래 ${fb.bottom}px)`);
if (!fbOk) fails.push("폴백이 가장 보수적이지 않다 — 모르는 채널에서 자막이 먹힌다");

console.log(`\n  통과 ${pass}/${CASES.length}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 채널별 안전영역을 실제로 재고, 틀린 값은 빨강으로 잡는다.\n");
