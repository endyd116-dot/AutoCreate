/**
 * scripts/verify-r8a-video-probe.mts — **R8-A §3 영상**(C · 순수 · provider 실호출 0 · DB 0).
 *   `npx tsx scripts/verify-r8a-video-probe.mts`
 *
 *   🔴 B2 의 `scripts/verify-video-safe-area.mts` 는 **심사 축**이 제대로 잡는지를 잰다(음성 대조 내장 · 좋은 하니스다).
 *      이 프로브는 그 하니스가 **안 보는 자리**를 잰다 — 트리거 §3.5 «하니스 자체를 의심해라»(AC-62):
 *        ① 심사 축은 «페이로드가 맞나» 만 본다. 그런데 **그 페이로드를 만드는 곳**(`gen.ts`)과
 *           **그 페이로드를 실제로 그리는 곳**(러너 CSS)은 아무도 안 쟀다.
 *        ② 축이 통과해도 러너가 그 숫자를 안 쓰면 **자막은 그대로 UI 에 먹힌다**(«검사는 초록, 화면은 가려짐»).
 *      ⇒ 여기서는 **러너가 실제로 내놓는 CSS 문자열**을 채널마다 읽는다. 문자열 흉내가 아니라 그 함수의 산출물이다(AC-31).
 */
import { judgePayloadDeterministic, captionLinesOf, CAPTION_MAX_LINES } from "../lib/video/judge";
import { SAFE_ZONE_OF, SAFE_ZONE_FALLBACK, safeZoneOf, type RenderPayload, type VideoChannel } from "../lib/video/types";
import { buildOverlayHtml } from "../runner/channels/render-video.mjs";

const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const CHANNELS: VideoChannel[] = ["youtube_shorts", "reels", "naver_clip", "threads"];

function payload(o: { channel?: VideoChannel; top: number; bottom: number; side?: number; badge?: boolean; preset?: "keyword_center" | "talking_big" | "clip_top"; phrases?: string[] }): RenderPayload {
  const texts = o.phrases ?? ["보증금 지키는 법", "확정일자 먼저", "오늘 바로 해요"];
  return {
    pieceId: 1, tenantId: 1,
    out: { w: 1080, h: 1920, fps: 30, maxSeconds: 30, crf: 20 },
    scenes: [{ idx: 0, startMs: 0, endMs: 4000 }, { idx: 1, startMs: 4000, endMs: 9000 }, { idx: 2, startMs: 9000, endMs: 15000 }] as RenderPayload["scenes"],
    captions: { preset: o.preset ?? "keyword_center", phrases: texts.map((t, i) => ({ idx: i, text: t, startMs: i * 5000, endMs: i * 5000 + 4800 })), srtKey: "x.srt" },
    audio: { narration: [], bgm: null, sfx: null, loudnorm: { I: -16, TP: -1.5, LRA: 11 } },
    overlay: {
      badge: o.badge ? { text: "광고 포함 · 파트너스 수수료", corner: "tr" } : null,
      safeZone: { top: o.top, bottom: o.bottom, ...(o.side !== undefined ? { side: o.side } : {}) },
      endcard: { text: "오늘 바로 해 보세요" },
    },
    disclosureCaption: null,
    ...(o.channel ? { channel: o.channel } : {}),
  } as RenderPayload;
}
const px = (css: string, re: RegExp) => Number((css.match(re) ?? [])[1] ?? NaN);

/** 3.1 🔴 채널값이 **러너 CSS 까지** 간다 — 심사 축이 아니라 «실제로 그리는 자리»를 읽는다. */
function s31() {
  const seen: string[] = [];
  let bad = 0;
  for (const ch of CHANNELS) {
    const want = SAFE_ZONE_OF[ch];
    const css = buildOverlayHtml(payload({ channel: ch, ...want, badge: true }) as never) as string;
    const capBottom = px(css, /#cap\{[^}]*bottom:(\d+)px/);
    const capSide = px(css, /#cap\{[^}]*left:(\d+)px/);
    const badgeTop = px(css, /#badge\{[^}]*top:(\d+)px/);
    const ok = capBottom === want.bottom && capSide === want.side && badgeTop === want.top;
    if (!ok) bad++;
    seen.push(`${ch} 자막아래 ${capBottom}(기대 ${want.bottom}) 좌우 ${capSide} 배지위 ${badgeTop}(기대 ${want.top})`);
  }
  out("🔴 §3.1 채널별 안전영역이 **러너가 그리는 CSS 까지** 간다(심사 축이 아니라 실제 그리는 자리)", bad === 0, seen.join(" · "));

  /* 🔴 음성 대조 — 서버가 안전영역을 안 실어 보내면 러너는 **가장 보수적인 값**으로 그린다(모르면 안전한 쪽). */
  const noZone = buildOverlayHtml({ ...payload({ top: 0, bottom: 0 }), overlay: { badge: null, safeZone: undefined, endcard: null } } as never) as string;
  out("🔴 §3.1 음성 대조 — 안전영역이 안 실려 오면 러너 폴백은 **가장 보수적인 값**이다(220/450)",
    px(noZone, /#cap\{[^}]*bottom:(\d+)px/) === SAFE_ZONE_FALLBACK.bottom,
    `폴백 자막아래 ${px(noZone, /#cap\{[^}]*bottom:(\d+)px/)}px · SAFE_ZONE_FALLBACK ${SAFE_ZONE_FALLBACK.bottom}px`);

  /* 채널마다 **다른** 값이 나와야 한다 — 하나로 다 통과하면 채널 구분이 헛것이다. */
  const bottoms = new Set(CHANNELS.map((ch) => px(buildOverlayHtml(payload({ channel: ch, ...SAFE_ZONE_OF[ch] }) as never) as string, /#cap\{[^}]*bottom:(\d+)px/)));
  out("§3.1 채널이 다르면 CSS 숫자도 다르다(쇼츠만 390 · 나머지 450)", bottoms.size >= 2, `실제로 나온 자막 아래값 [${[...bottoms].join(",")}]`);

  /* 모르는 채널(옛 piece·tiktok 처럼 우리 채널이 아닌 값) → 서버 쪽도 보수적 폴백. */
  out("§3.1 모르는 채널은 서버도 보수적 폴백(AC-9 — 모르면 안전한 쪽)",
    safeZoneOf("tiktok").bottom === SAFE_ZONE_FALLBACK.bottom && safeZoneOf(null).bottom === SAFE_ZONE_FALLBACK.bottom,
    `tiktok → ${safeZoneOf("tiktok").bottom} · null → ${safeZoneOf(null).bottom} · (tiktok 은 우리 영상 채널이 아니다 — VIDEO_CHANNELS 밖)`);
}

/** 3.2 심사 축이 «이름대로» 재나 — **그 영상의 채널 값**으로. */
function s32() {
  const axisOf = (p: RenderPayload) => judgePayloadDeterministic(p, {}, null, "보증금 지키는 법").axes.find((a) => a.key === "safe_area");
  const good = CHANNELS.filter((ch) => axisOf(payload({ channel: ch, ...SAFE_ZONE_OF[ch] }))?.pass);
  out("§3.2 채널 규격대로면 통과(4채널)", good.length === CHANNELS.length, `통과 ${good.length}/${CHANNELS.length}`);

  /* 🔴 음성 대조 — 종전 전 채널 공용값(220/300)은 **넷 다 빨강**이어야 한다. 초록이면 이번 고침이 아무것도 안 한 것이다. */
  const oldVal = CHANNELS.filter((ch) => axisOf(payload({ channel: ch, top: 220, bottom: 300 }))?.pass === false);
  out("🔴 §3.2 음성 대조 — 종전 공용값 220/300 은 **네 채널 다 빨강**(옛 축은 이걸 초록으로 찍었다)",
    oldVal.length === CHANNELS.length, `빨강 ${oldVal.length}/${CHANNELS.length}`);

  /* 🔴 **채널마다 기준이 다른가** — 쇼츠 규격(180/390)을 릴스에 쓰면 빨강이어야 한다(한 값으로 다 통과하면 채널 구분이 헛것). */
  const shortsOnReels = axisOf(payload({ channel: "reels", ...SAFE_ZONE_OF.youtube_shorts }));
  const reelsOnShorts = axisOf(payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.reels }));
  out("🔴 §3.2 쇼츠 값을 릴스에 쓰면 **빨강** · 릴스 값을 쇼츠에 쓰면 통과(더 보수적이라)",
    shortsOnReels?.pass === false && reelsOnShorts?.pass === true,
    `쇼츠값→릴스 ${shortsOnReels?.pass}(«${String(shortsOnReels?.detail ?? "").slice(0, 40)}») · 릴스값→쇼츠 ${reelsOnShorts?.pass}`);

  const noCh = axisOf(payload({ top: 220, bottom: 450 }));
  out("§3.2 채널이 없으면 가장 보수적인 기준으로 잰다(AC-9)", noCh?.pass === true, `채널 없음 + 220/450 → ${noCh?.pass}`);
}

/** 3.3 🔴 제휴 고지 **배지**가 안 가려지나 — 품질이 아니라 정책 문제다. */
function s33() {
  const axisOf = (p: RenderPayload) => judgePayloadDeterministic(p, {}, null, "보증금 지키는 법").axes.find((a) => a.key === "safe_area");
  const badgeBad = axisOf(payload({ channel: "youtube_shorts", top: 80, bottom: 390, badge: true }));
  const badgeOk = axisOf(payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.youtube_shorts, badge: true }));
  out("🔴 §3.3 배지가 상단 UI 안쪽이면 **빨강**(그 배지가 §16B 고지다)", badgeBad?.pass === false && badgeOk?.pass === true,
    `위 80px → ${badgeBad?.pass} · 규격대로 → ${badgeOk?.pass}`);

  const corner = axisOf(payload({ channel: "reels", ...SAFE_ZONE_OF.reels, badge: true }));
  const wrongCorner = judgePayloadDeterministic({ ...payload({ channel: "reels", ...SAFE_ZONE_OF.reels, badge: true }), overlay: { ...payload({ channel: "reels", ...SAFE_ZONE_OF.reels, badge: true }).overlay, badge: { text: "광고 포함", corner: "bl" } } } as RenderPayload, {}, null, "보증금 지키는 법").axes.find((a) => a.key === "safe_area");
  out("§3.3 배지 코너가 tr 이 아니면 빨강", corner?.pass === true && wrongCorner?.pass === false, `tr ${corner?.pass} · bl ${wrongCorner?.pass}`);

  /* 🔴 러너 CSS 에서 배지가 실제로 안전영역 **안쪽**에 놓이는가(종전 `safe.top - 140` 은 바깥이었다). */
  const css = buildOverlayHtml(payload({ channel: "youtube_shorts", ...SAFE_ZONE_OF.youtube_shorts, badge: true }) as never) as string;
  const badgeTop = px(css, /#badge\{[^}]*top:(\d+)px/);
  out("🔴 §3.3 러너 CSS — 배지 윗변이 안전영역 **경계 이상**(위쪽 바깥이 아니다)",
    badgeTop >= SAFE_ZONE_OF.youtube_shorts.top, `배지 top ${badgeTop}px ≥ 안전영역 ${SAFE_ZONE_OF.youtube_shorts.top}px`);
  out("§3.3 배지가 없으면 CSS 에 배지 글자도 안 들어간다(음성 대조)",
    !(buildOverlayHtml(payload({ channel: "reels", ...SAFE_ZONE_OF.reels, badge: false }) as never) as string).includes("광고 포함 · 파트너스"),
    "badge:null → 배지 문구 없음");
}

/** 3.4 자막 2줄 규칙 · 좌우 여백이 채널값을 쓰나. */
function s34() {
  const axisOf = (p: RenderPayload) => judgePayloadDeterministic(p, {}, null, "보증금 지키는 법").axes.find((a) => a.key === "caption_lines");
  const longOne = "보증금을 지키려면 확정일자와 전입신고를 같은 날에 끝내야 하고 그다음 등기부를 다시 봐야 해요";
  const over = axisOf(payload({ channel: "reels", ...SAFE_ZONE_OF.reels, phrases: [longOne] }));
  const fine = axisOf(payload({ channel: "reels", ...SAFE_ZONE_OF.reels, phrases: ["확정일자 먼저"] }));
  out("🔴 §3.4 자막이 2줄을 넘으면 빨강 · 짧으면 통과(음성·양성 대조)", over?.pass === false && fine?.pass === true,
    `${longOne.length}자 → ${over?.pass}(«${String(over?.detail ?? "").slice(0, 44)}») · 짧은 구절 → ${fine?.pass}`);

  const lines = captionLinesOf(longOne, 78, 1080 - 60 * 2);
  out(`§3.4 \`captionLinesOf\` 가 실제로 ${CAPTION_MAX_LINES}줄 규칙을 센다`, lines > CAPTION_MAX_LINES, `${longOne.length}자 · 78px · 960px 상자 → ${lines}줄`);

  /* 좌우 여백 — 채널값이 CSS 의 left/right 로 간다. */
  const css = buildOverlayHtml(payload({ channel: "reels", ...SAFE_ZONE_OF.reels }) as never) as string;
  const left = px(css, /#cap\{[^}]*left:(\d+)px/), right = px(css, /#cap\{[^}]*right:(\d+)px/);
  out("§3.4 좌우 여백이 채널값 그대로 CSS 에 실린다", left === SAFE_ZONE_OF.reels.side && right === SAFE_ZONE_OF.reels.side,
    `left ${left} · right ${right} · 채널값 ${SAFE_ZONE_OF.reels.side}`);

  /* `clip_top` 프리셋은 자막이 **위**에 붙는다 — 그때는 top 을 쓴다. */
  const clipTop = buildOverlayHtml(payload({ channel: "naver_clip", ...SAFE_ZONE_OF.naver_clip, preset: "clip_top" }) as never) as string;
  out("§3.4 `clip_top` 프리셋은 자막이 위 — 그때는 안전영역 **top** 을 쓴다",
    /#cap\{[^}]*top:220px/.test(clipTop) && !/#cap\{[^}]*bottom:\d/.test(clipTop),
    `clip_top CSS 에 top:${px(clipTop, /#cap\{[^}]*top:(\d+)px/)}px`);
}

/** 3.5 🔴 B2 하니스 자체를 의심한다 — 자기가 쓴 걸 자기가 읽나(AC-62) · catch 가 눈을 가리나(AC-58). */
async function s35() {
  const fs = await import("node:fs/promises");
  const src = await fs.readFile("scripts/verify-video-safe-area.mts", "utf8");
  /* ① 기대값을 **제품에서** 가져오는가(하니스가 자기가 쓴 숫자를 자기가 읽으면 늘 초록이다).
     🔴 여기서 «숫자가 박혀 있나» 로 물으면 안 된다 — 나는 첫 판에서 그렇게 묻다가 **가짜 빨강**을 만들었다.
        이 하니스의 박힌 숫자(180/390 을 릴스에 쓰는 따위)는 **일부러 틀린 입력**이고, 음성 대조의 본체다.
        물어야 할 것은 «**양성 기준선**의 기대값이 제품에서 오나» 다. */
  const baseline = /SAFE_ZONE_OF\[ch\]/.test(src);
  const importsProduct = /from "\.\.\/lib\/video\/types"/.test(src);
  const noLocalTable = !/(const|let)\s+\w*(SAFE|ZONE)\w*\s*[:=]\s*\{/i.test(src);   // 제품 표를 하니스가 다시 적어 두지 않았나
  out("🔴 §3.5 B2 하니스가 **양성 기준선**의 기대값을 제품에서 읽는다(자기가 쓴 걸 자기가 읽지 않는다 · AC-62)",
    baseline && importsProduct && noLocalTable,
    `기준선이 SAFE_ZONE_OF[ch] ${baseline} · 제품 임포트 ${importsProduct} · 하니스가 표를 다시 적음 ${noLocalTable ? "없음" : "있음"}`
    + " · (박힌 숫자들은 «일부러 틀린 입력» 이라 자기참조가 아니다)");

  /* ② 삼키는 catch 가 있나(AC-58). */
  const swallow = (src.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g) || []).length + (src.match(/\.catch\(\(\)\s*=>\s*(\{\s*\}|\[\]|null|undefined)\)/g) || []).length;
  out("§3.5 삼키는 catch 0(AC-58 — 검사 코드의 catch 는 증거를 지운다)", swallow === 0, `삼키는 catch ${swallow}개`);

  /* ③ 음성 대조가 실제로 들어 있는가 — «전부 초록»이면 아무것도 안 보는 축이다. */
  const negatives = (src.match(/want:\s*false/g) || []).length;
  out("§3.5 음성 대조가 내장돼 있다(want:false 인 사례가 있다)", negatives >= 3, `want:false 사례 ${negatives}건`);

  /* ④ 🔴 그러나 **안 보는 자리**가 있다 — 심사 축만 재고 «만드는 곳·그리는 곳»은 안 잰다. 이 프로브가 그 자리를 맡는다. */
  const touchesGen = /video\/gen|buildOverlayHtml|render-video/.test(src);
  out("🔴 §3.5 …다만 그 하니스는 **페이로드를 만드는 곳(gen)·그리는 곳(러너)** 은 안 본다 — 이 프로브가 그 자리다",
    !touchesGen ? "WARN" : true,
    touchesGen ? "gen·러너까지 본다" : "심사 축만 본다(결함은 아니다 · 범위의 문제) ⇒ §3.1·§3.3 의 러너 CSS 절이 그 구멍을 메운다");
}

try { s31(); s32(); s33(); s34(); await s35(); }
catch (e) { out("영상 프로브 예외", false, String((e as Error)?.stack ?? e).slice(0, 240)); }
