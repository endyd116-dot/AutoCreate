/**
 * runner/lib/capture-slice.mjs — **레퍼런스 캡처를 어떻게 자르나**(R10-1 · 순수 · IO 0 · 브라우저 0).
 *
 * ══ 사장님이 못 박은 것 — 그대로 ══
 *   🔴 **폰 폭(430px)으로 찍는다.** 「데스크톱 폭이면 한 문단이 2줄로 보이는데 **실제 독자(모바일)에겐 5줄**이다.
 *      독자가 보는 폭이 아니면 «문단 리듬»이 **틀린 값**이 된다」
 *   🔴 **한 장은 안 된다.** 전체 캡처는 폭 1,000에 높이 12,000 꼴이고 모델이 **줄여서** 보므로
 *      **밑줄과 굵게를 구분 못 한다.**
 *   🔴 **2분할·4분할을 못 박지 않는다.** 찍기 전에 **페이지 높이를 알 수 있다** —
 *      한 조각이 «폰 화면 1.5개» 정도가 되게 자른다(보통 3~4장 · 긴 글 6장).
 *   🔴 **6장을 넘으면 더 안 늘린다.** 처음·중간·끝 위주로(«어떻게 생겼나»는 반복된다).
 *   🔴 **겹쳐 자른다(10~15%).** 딱 자르면 경계에 걸린 문단·사진이 양쪽에서 반씩 잘려 **둘 다 못 읽는다.**
 *
 * ══ 🔴 이 파일이 지키는 것 둘 ══
 *   ① **구멍 0** — 이웃한 두 조각은 반드시 **겹치거나 최소한 맞닿는다**. 6장 상한에 긴 글이 걸리면 겹침이
 *      «음수»가 되기 쉬운데 그러면 **글 한복판이 통째로 안 찍힌다**(모델은 없는 줄도 모른다).
 *      ⇒ 상한에 걸리면 겹침을 줄이는 게 아니라 **조각을 키운다**(=모델이 더 줄여서 보게 된다 · 그건 `why` 에 적는다).
 *   ② **못 잰 것은 «못 쟀다»**(AC-9·AC-92) — 페이지 높이를 모르면 그럴듯한 기본값을 지어내지 않는다.
 */

/** 🔴 사장님이 못 박은 폭. 코드 여러 곳에 숫자를 흩지 않는다. */
export const PHONE_WIDTH = 430;
/** 폰 한 화면(아이폰 14 Pro Max 기준 CSS 픽셀). 조각 하나는 이것의 1.5배를 목표로 한다. */
export const PHONE_VIEWPORT_HEIGHT = 932;
export const MIN_SHOTS = 2;
export const MAX_SHOTS = 6;
/** 겹침 10~15% — 가운데(12%)를 기본으로 두고, 구멍이 날 것 같으면 **늘리는 쪽**으로만 움직인다. */
export const OVERLAP_PCT_MIN = 10;
export const OVERLAP_PCT_DEFAULT = 12;
export const OVERLAP_PCT_MAX = 15;

const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/**
 * planCaptureSlices — (페이지 높이) → 자를 조각들.
 *
 * @param pageHeight  캡처 대상 페이지의 **전체 높이**(px · 폰 폭으로 잰 값).
 * @param opts {{ width?, viewportHeight?, max?, min?, overlapPct?, viewportsPerShot? }}
 * @returns {{ slices: {index,y,h}[], count, overlapPct, width, pageHeight, why: string[] }}
 *          🔴 `why` = «왜 이 장수·이 겹침인가» + **못 잰 것**. 화면·보고가 그대로 읽을 수 있게 사람말로 적는다.
 */
export function planCaptureSlices(pageHeight, opts = {}) {
  const width = Math.round(Number(opts.width) > 0 ? Number(opts.width) : PHONE_WIDTH);
  const viewportHeight = Math.round(Number(opts.viewportHeight) > 0 ? Number(opts.viewportHeight) : PHONE_VIEWPORT_HEIGHT);
  const maxShots = clampInt(Number(opts.max) > 0 ? Number(opts.max) : MAX_SHOTS, 1, 12);
  const minShots = clampInt(Number(opts.min) > 0 ? Number(opts.min) : MIN_SHOTS, 1, maxShots);
  const perShot = Number(opts.viewportsPerShot) > 0 ? Number(opts.viewportsPerShot) : 1.5;
  const why = [];

  const H = Number(pageHeight);
  /* 🔴 높이를 못 쟀다 — **지어내지 않는다.** 조각 0개로 돌려보내고 «못 쟀다»고 적는다(AC-92).
     호출자는 이걸 보고 «화면을 찍어서 올려 주세요»로 떨어진다(그건 «없는 길»이지 우리 판단이 아니다). */
  if (!Number.isFinite(H) || H <= 0) {
    return { slices: [], count: 0, overlapPct: 0, width, pageHeight: null, why: ["페이지 높이를 재지 못했어요 — 몇 장으로 자를지 정할 수 없어요."] };
  }

  const target = Math.round(viewportHeight * perShot);          // 조각 하나의 목표 높이(«폰 화면 1.5개»)
  let overlapPct = clampInt(Number(opts.overlapPct) > 0 ? Number(opts.overlapPct) : OVERLAP_PCT_DEFAULT, OVERLAP_PCT_MIN, OVERLAP_PCT_MAX);

  /* ── 목표 조각 하나에 다 들어가는 글 — 🔴 **한 장이 맞다.**
        «한 장은 안 된다»는 **12,000px 짜리를 한 장에 우겨넣지 마라**는 뜻이지 «무조건 쪼개라»가 아니다.
        이유가 «모델이 줄여서 봐 밑줄과 굵게를 구분 못 한다»이므로, **줄일 것이 없는 글은 나눌 이유가 없다.**
        여기서 억지로 둘로 쪼개면 **거의 같은 화면을 두 번** 보내는 셈이고 그건 요금제 한도만 깎는다. ── */
  if (H <= target) {
    why.push(`글이 짧아서(${Math.round(H)}px · 폰 화면 ${(H / viewportHeight).toFixed(1)}개) 한 장으로 찍었어요 — 줄여 볼 일이 없어 나눌 필요가 없어요.`);
    return { slices: [{ index: 0, y: 0, h: Math.round(H) }], count: 1, overlapPct: 0, width, pageHeight: Math.round(H), why };
  }

  /* 겹치며 덮으려면: H ≤ h + (n-1)·h·(1-ov)  ⇒  n = 1 + ceil((H - h) / (h·(1-ov))) */
  const needed = 1 + Math.ceil((H - target) / Math.max(1, target * (1 - overlapPct / 100)));
  const count = clampInt(needed, minShots, maxShots);

  /* 🔴 **장수를 정한 뒤 조각 높이를 «그 장수에 맞춰» 다시 낸다.**
     종전엔 목표 높이를 그대로 쓰고 자리만 벌렸는데, 그러면 2,800px 글이 **50% 겹침**으로 나왔다 —
     같은 내용을 두 번 보내면서 요금제 한도만 깎는다. 같은 장수라면 **조각이 작을수록 글자가 크게 보인다.**
     ⚠️ 6장 상한에 걸린 긴 글에서는 같은 식이 반대로 조각을 **키운다** — 식은 하나다(가지를 나누면 둘이 갈린다). */
  let h = Math.ceil(H / (1 + (count - 1) * (1 - overlapPct / 100)));
  h = Math.min(h, Math.round(H));
  if (h > target) {
    /* 🔴 겹침을 줄여서 맞추지 않는다 — 10% 밑으로 내려가면 경계 문단이 양쪽에서 반씩 잘리고, 더 깎으면 **구멍**이 난다.
       조각을 키우면 모델이 그만큼 줄여 보게 되니 그 손해를 `why` 에 정직하게 적는다(AC-9: 못 한 것은 적는다). */
    why.push(`글이 길어서(${Math.round(H)}px) ${maxShots}장을 넘기지 않고 한 조각을 ${h}px 로 키웠어요 — 조각이 크면 글자가 그만큼 작게 보여요.`);
  }

  /* ── 자리 잡기: 마지막 조각은 **페이지 끝에 붙인다**(끝이 잘리면 «마무리 모양»을 못 읽는다). ── */
  const step = count > 1 ? (H - h) / (count - 1) : 0;
  const slices = [];
  for (let i = 0; i < count; i++) {
    const y = i === count - 1 ? Math.round(H - h) : Math.round(i * step);
    slices.push({ index: i, y: Math.max(0, y), h });
  }

  /* 구멍 보정 — 반올림으로 한두 픽셀이 벌어지면 그 조각을 **앞으로 당긴다**.
     «벌어졌다»는 곧 «그 줄은 아무 조각에도 안 들어갔다»이고, 모델은 **없는 줄이 있었다는 것도 모른다.**
     🔴 **정직하게 적어 둔다: 이 줄은 여태 한 번도 안 걸렸다.** 높이 1,400~60,000px 를 **58,601개 전수**로
        재 봤더니(2026-09-16 B2) 위 산수만으로 틈이 **0건**이었다. ⇒ 이건 «작동하는 안전장치»가 아니라
        **산수를 바꿀 다음 사람을 위한 난간**이다. «있다»고 세지 마라(AC-68 — 작동한 적 없는 안전장치를 세지 않는다).
        진짜 감시는 하니스의 C-02 다(`checkCoverage` 로 **결과를** 잰다 · 변이 c1 로 그 자가 구멍을 보는지 확인했다). */
  for (let i = 1; i < slices.length; i++) {
    const prevEnd = slices[i - 1].y + slices[i - 1].h;
    if (slices[i].y > prevEnd) slices[i].y = prevEnd;
  }

  const realOverlap = count > 1
    ? Math.round(((slices[0].y + slices[0].h - slices[1].y) / h) * 100)
    : 0;
  overlapPct = realOverlap;
  why.push(`${count}장으로 잘랐어요(한 조각 ${h}px · ${realOverlap}% 겹침) — 겹쳐 자르지 않으면 경계에 걸린 문단이 양쪽에서 반씩 잘려 둘 다 못 읽어요.`);
  if (count >= maxShots && H > target * maxShots) {
    why.push("아주 긴 글이라 처음·중간·끝 위주로 봤어요 — «어떻게 생겼나»는 글 안에서 반복되거든요.");
  }

  return { slices, count, overlapPct, width, pageHeight: Math.round(H), why };
}

/**
 * 🔴 **조각들이 페이지를 빠짐없이 덮나** — 호출자·하니스가 같은 자로 잰다(두 벌이면 갈린다).
 * @returns {{ ok:boolean, gaps:{from:number,to:number}[], covered:number }}
 */
export function checkCoverage(slices, pageHeight) {
  const gaps = [];
  if (!Array.isArray(slices) || !slices.length) return { ok: false, gaps: [{ from: 0, to: Number(pageHeight) || 0 }], covered: 0 };
  const sorted = [...slices].sort((a, b) => a.y - b.y);
  let reach = 0;
  for (const s of sorted) {
    if (s.y > reach) gaps.push({ from: reach, to: s.y });
    reach = Math.max(reach, s.y + s.h);
  }
  if (reach < Number(pageHeight)) gaps.push({ from: reach, to: Number(pageHeight) });
  return { ok: gaps.length === 0, gaps, covered: reach };
}
