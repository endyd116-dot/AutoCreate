/**
 * lib/video/reference-apply.ts — 레퍼런스가 **배워 온 것**을 «지금 우리가 낼 수 있는 자리»로 옮긴다(R8CLOSE · B2 · 2026-09-16).
 *
 *   ══ 왜 이 파일이 생겼나 ══
 *     `reference.ts` 는 유튜브를 읽어 `TemplateStyle`(visual·palette·caption·pace·camera·rules·hookPrinciple)을 **저장한다.**
 *     그런데 `director.ts` 는 그중 **`structure` 하나만** 꺼내 갔다 — 나머지는 DB 에 쌓이기만 하고 **읽는 쪽이 통째로 없었다.**
 *     🔴 «벤치마킹»의 절반은 이미 만들어져 있었고, 나머지 절반이 없어서 **아무 일도 안 일어나고 있었다**
 *        (실측: `docs/active/2026-09-16-B2-video-capability.md` §2).
 *
 *   ══ 🔴 이 파일의 규칙 — «못 내는 축은 넘기지도 않는다» ══
 *     배워 온 축을 전부 넘기면 **«넘겼는데 아무 일도 안 남»**이 새로 생긴다(그게 지금 고치고 있는 병이다).
 *     그래서 **낼 수 있는 자리가 있는 축만** `applied` 로 보내고, 나머지는 **`unused` 에 이름과 이유를 적어** 돌려준다.
 *     `unused` 는 piece 에 그대로 남는다 — 렌더가 좋아지면 **그게 할 일 목록**이 된다(AC-9 · 조용히 버리지 않는다).
 *
 *   ══ 지금 낼 수 있는 자리(실측 근거) ══
 *     · `visual`       → 컷 프롬프트 **STYLE 절**(`scenes.ts buildShotPrompt`) — 상수 `DEFAULT_GRAPHIC_STYLE` 자리다
 *     · `palette`      → **`variant.palette`**(고객 칩이 보여 주고 **고객이 바꿀 수 있는** 값) → COLOR 절
 *     · `rules`        → 컷 프롬프트 **RULES 절**(≤6 · `reference.ts` 주석이 «컷 프롬프트 재료»라고 이미 적어 뒀다)
 *     · `hookPrinciple`→ 대본 프롬프트 **훅 절**(`script.ts`)
 *     · `pace`·`camera`→ 🟠 **컷 안 비트 수**(`splitCutBeats` 의 fast/normal/hold) — 그 **한 축만** 받는다
 *     · `caption`      → ❌ **없다.** 자막 모양은 렌더에 상수로 박혀 있고 프리셋 3개뿐이다 → 늘 `unused`
 *
 *   🔴 **[R12] `audioTempo`(말 속도)·`captionMotion`(자막 모션)·`transition`(컷 전환)이 여기 들어왔다.**
 *      R10 까지는 셋 다 «낼 자리가 없다»였다 — 렌더가 구절당 PNG **한 장**이고 씬은 `concat` 뿐이었다.
 *      R12 가 그 구조를 고쳤다(ffmpeg 이 그 한 장을 움직이고, 전환은 컷 «안»에서 빌린다) ⇒ 이제 **닿는 자리**다.
 *      🔴 다만 **못 내는 값은 여전히 `unused`** 다: 모션 넷·전환 셋 밖은 애초에 `sanitizeTemplate` 이 안 받고,
 *      말 속도는 **규격을 넘으면 `gen.ts` 가 되돌리며** «못 냈어요»를 적는다(여기서는 넘기기만 한다).
 *
 *   🔴 순수 함수다(네트워크·DB 0). `scripts/verify-reference-apply.mts` 가 이걸 그대로 돌린다.
 */
import { P0_LIKENESS, TEXT_SIGNAL, defuseTextDemand } from "./scenes";
import type { TemplateStyle } from "./reference";
import type { VideoSpec } from "./types";

/** 컷 안 비트 빠르기(`scenes.ts splitCutBeats` 가 받는 값 그대로). */
export type CutPace = "fast" | "normal" | "hold";

/** 레퍼런스에서 **실제로 어딘가에 닿는** 것만. 빈 칸은 아예 넣지 않는다(«넘겼는데 아무 일도 안 남» 금지). */
export interface RefStyleApplied {
  /** 컷 프롬프트 STYLE 절. */
  style?: string;
  /** 컷 프롬프트 RULES 절에 덧붙는다(≤6). */
  rules?: string[];
  /** 컷 안 비트 수. **글에서 못 읽으면 없다**(«normal» 로 메우지 않는다 — 그건 안 배운 것을 배운 척하는 것이다). */
  pace?: CutPace;
  /** 대본 프롬프트 훅 절. */
  hookPrinciple?: string;
  /** `variant.palette` 로 간다 → 컷 프롬프트 COLOR 절. */
  palette?: string;

  /* ═══ [R10-6] 자막 모양 — 🔴 **렌더 payload `captions.type` 으로 그대로 간다** ═══
   *   2026-09-16 에 `render-video.mjs buildOverlayHtml` 의 상수를 값으로 열었다. 종전에는 배워 와도
   *   «넣을 칸이 없다»로 `unused` 에만 남았다 — 그 칸이 이제 있다.
   *   🔴 읽은 축만 담는다. 하나도 못 읽었으면 `captionType` 자체가 없다(빈 객체를 넘기지 않는다). */
  captionType?: {
    weight?: number; strokeWidth?: number; shadow?: string;
    position?: "top" | "middle" | "bottom"; maxCharsPerLine?: number; accentColor?: string; side?: number;
  };
  /** 영상 전체 길이(초) — 고객이 고른 값이 **있으면 고객 것이 이긴다**(§9 핸들은 고객에게). */
  totalSec?: number;

  /* ═══ [R12] 🔴 **렌더 구조가 바뀌어 새로 닿게 된 넷** ═══
   *   전부 **없으면 키가 없고**, 키가 없으면 렌더·TTS 가 **종전 그대로** 간다(무회귀). */

  /** [R12-1] 자막 등장 방식 → 렌더 payload `captions.type.motion`. 길이(120~200ms)는 러너가 정한다. */
  captionMotion?: "none" | "fade" | "slide_up" | "pop";
  /** [R12-2] 컷 전환 → 렌더 payload `transition`. 길이(0.3초·상한 0.4초)는 러너가 정한다. */
  transition?: "none" | "fade" | "slide";
  /**
   * [R12-3] 말 속도 «보통(1.0) 대비 배수». 🔴 **넘기는 값으로 환산하는 것은 `lib/video/tempo.ts` 한 곳**이다
   *   (우리 보통은 1.0 이 아니라 1.1 이다 — 여기서 또 곱하면 두 벌이 된다).
   */
  audioTempo?: number;
  /**
   * [R12-4] 컷 하나가 **최소** 머무는 ms. 🔴 **나레이션을 이긴다는 뜻이 아니다** —
   *   나레이션이 더 길면 나레이션이 이긴다(컷이 나레이션보다 짧으면 **말이 잘린다** · 되돌릴 수 없는 나쁨).
   *   하한을 다 더해 규격을 넘으면 `scenes.ts applyCutFloor` 가 **하한을 통째로 버리고** 사유를 돌려준다.
   */
  minCutMs?: number;
}
/** 못 넘긴 칸 — **이름과 이유**를 같이 남긴다(AC-9). */
export interface RefUnused { field: string; why: string }
export interface RefApplyResult { applied: RefStyleApplied; unused: RefUnused[] }

const txt = (v: unknown, cap = 240): string => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);

/* ─────────────────────────── 빠르기 읽기 ─────────────────────────── */

/**
 * 🔴 `pace`·`camera` 는 **자유 문장**이고 우리 손잡이는 **fast|normal|hold 셋**뿐이다 — 그 사이를 여기서 옮긴다.
 *   찾는 순서: ①«몇 초마다» 숫자 → ②«컷당 비트 몇» 숫자 → ③말(빠른/느린).
 *   🔴 **못 읽으면 `null` 이다.** 기본값 «normal» 로 메우지 않는다 — 그러면 «안 배웠는데 배운 것처럼» 보이고,
 *      그게 이 라운드 내내 우리를 관통한 모양이다(AC-9).
 */
export function paceHintOf(text: unknown): CutPace | null {
  const s = String(text ?? "").toLowerCase();
  if (!s.trim()) return null;

  /* ① «5초마다» · «cut every 5s» — 컷 길이가 곧 빠르기다. */
  const sec = s.match(/(\d+(?:\.\d+)?)\s*(?:s\b|sec\b|secs\b|second|seconds|초)/);
  if (sec) { const n = Number(sec[1]); if (Number.isFinite(n) && n > 0) return n <= 3 ? "fast" : n >= 5 ? "hold" : "normal"; }

  /* ② «two beats per cut» — 한 컷 안에서 몇 번 끊나. 많이 끊을수록 빠르다. */
  const WORD_N: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const beat = s.match(/\b(one|two|three|four|five|\d+)\s*(?:-|\s)?beats?\b/) ?? s.match(/\b비트\s*(\d+)/);
  if (beat) { const n = WORD_N[beat[1]] ?? Number(beat[1]); if (Number.isFinite(n) && n > 0) return n >= 3 ? "fast" : n === 1 ? "hold" : "normal"; }

  /* ③ 말. */
  if (/\b(fast|rapid|quick|snappy|frantic|breathless|punchy|staccato)\b|빠른|빠르|속도감|경쾌/.test(s)) return "fast";
  if (/\b(slow|hold|holds|lingering|calm|contemplative|patient|unhurried|long takes?)\b|느린|느리|천천|긴 호흡|여유/.test(s)) return "hold";
  return null;
}

/* ─────────────────────────── 옮기기 ─────────────────────────── */

/**
 * 🔴 **정본** — 배워 온 `TemplateStyle` → 「지금 닿는 것(`applied`)」 + 「못 낸 것(`unused`)」.
 *   빈 칸(레퍼런스가 애초에 못 뽑은 축)은 **둘 중 어디에도 안 적는다** — 없는 것과 못 내는 것은 다르다(AC-9).
 */
export function applyReferenceStyle(style: TemplateStyle | null | undefined): RefApplyResult {
  const s = (style ?? {}) as TemplateStyle;
  const applied: RefStyleApplied = {};
  const unused: RefUnused[] = [];

  const visual = txt(s.visual, 240);
  if (visual) applied.style = visual;

  const palette = txt(s.palette, 160);
  if (palette) applied.palette = palette;

  const hookPrinciple = txt(s.hookPrinciple, 80);
  if (hookPrinciple) applied.hookPrinciple = hookPrinciple;

  /* 연출 규칙 — 🔴 **우리 안전 규칙과 싸우는 것은 버린다.** 레퍼런스가 «큰 자막을 깔아라»·«유명인 얼굴»을
     배워 오면 무인물·무텍스트 계약(§5C.3·§19)과 정면으로 부딪친다. 버리되 **버렸다고 적는다.** */
  const rules: string[] = [];
  for (const r0 of Array.isArray(s.rules) ? s.rules : []) {
    const r = txt(r0, 160);
    if (!r) continue;
    if (P0_LIKENESS.test(r)) { unused.push({ field: "rules", why: `실존 인물을 요구해 버렸다(무인물 계약 §19): «${r.slice(0, 40)}»` }); continue; }
    if (TEXT_SIGNAL.test(r)) { unused.push({ field: "rules", why: `그림 안 글자·로고를 요구해 버렸다(무텍스트 계약 §5C.3): «${r.slice(0, 40)}»` }); continue; }
    rules.push(defuseTextDemand(r));
    if (rules.length >= 6) break;
  }
  if (rules.length) applied.rules = rules;

  /* ═══ [R10-6] 자막 모양 — 🔴 **이제 칸이 있다.** ═══
     2026-09-16 이전엔 굵기·색·그림자가 렌더에 상수로 박혀 있어 배워 와도 늘 `unused` 였다.
     같은 날 `buildOverlayHtml` 의 상수를 payload 값으로 열었다(기본값은 종전 상수 그대로 · 무회귀).
     🔴 읽은 축만 담는다 — 못 읽은 축은 **키를 안 만든다**(«보통»으로 메우면 안 배운 것을 배운 척하는 것이다 · AC-92). */
  const ct: NonNullable<RefStyleApplied["captionType"]> = {};
  const ty = s.typography ?? {};
  const cp = s.captionPlace ?? {};
  if (Number.isFinite(Number(ty.weight))) ct.weight = Number(ty.weight);
  if (Number.isFinite(Number(ty.strokeWidth)) && Number(ty.strokeWidth) > 0) ct.strokeWidth = Number(ty.strokeWidth);
  /* 그림자는 «세기 말»을 CSS 한 벌로 옮긴다 — 레퍼런스가 쓰는 낱말과 렌더가 받는 값이 다른 층이다. */
  if (ty.shadow === "none") ct.shadow = "none";
  else if (ty.shadow === "hard") ct.shadow = "0 6px 0 rgba(0,0,0,.9)";
  else if (ty.shadow === "soft") ct.shadow = "0 4px 18px rgba(0,0,0,.75),0 0 6px rgba(0,0,0,.9)";
  if (cp.position) ct.position = cp.position;
  if (Number.isFinite(Number(cp.maxCharsPerLine))) ct.maxCharsPerLine = Number(cp.maxCharsPerLine);
  if (cp.accentColor) ct.accentColor = cp.accentColor;
  if (Number.isFinite(Number(s.design?.sideMargin))) ct.side = Number(s.design?.sideMargin);
  if (Object.keys(ct).length) applied.captionType = ct;

  /* ═══ [R12-1·2] 자막 모션 · 컷 전환 — 🔴 **어휘는 `reference.ts` 가 이미 닫아 뒀다** ═══
     목록 밖 값(«타자기»·«와이프»)은 `sanitizeTemplate` 의 `pick()` 에서 이미 떨어져 여기 안 온다.
     그래서 여기서는 **온 것만** 그대로 옮긴다 — 두 번째 허용 목록을 만들면 그 둘이 갈라진다(AC-57). */
  if (s.captionMotion) applied.captionMotion = s.captionMotion;
  if (s.transition) applied.transition = s.transition;

  /* 🔴 **크기는 안 받는다** — 자막 글자 크기는 프리셋(`talking_big`·`clip_top`·그 외)이 정하고 그건 **고객이 고르는 값**이다.
     레퍼런스가 덮으면 화면 칩이 말하는 것과 영상이 달라진다(AC-52 — 그래서 색도 `variant.palette` 로 넣는다). */

  /* 🔴 배워 온 자막 문장(`caption`)은 **자유 문장**이라 숫자가 아니다 — 위 구조화된 칸이 못 받은 부분만 남긴다. */
  const caption = txt(s.caption, 160);
  if (caption && !Object.keys(ct).length) {
    unused.push({ field: "caption", why: `«${caption.slice(0, 40)}» 에서 굵기·자리·줄 수를 숫자로 못 읽었다 — 글로만 배워 온 것은 렌더에 넣을 수 없다` });
  }

  /* 전체 길이 — 배운 값은 **기본값 후보**다. 고객이 15/30/60 을 골랐으면 고객 것이 이긴다(호출자가 정한다). */
  if (Number.isFinite(Number(s.speed?.totalSec))) applied.totalSec = Number(s.speed?.totalSec);

  /* ═══ [R12-4] 컷당 초 — 🔴 **이제 «하한»으로 받는다** ═══
     R10 까지는 «컷 길이는 나레이션이 정한다»며 통째로 `unused` 였다. 그건 지금도 맞다 —
     그래서 **덮어쓰기가 아니라 하한**이다(«이 컷은 최소 N초는 보여 줘»). 나레이션이 더 길면 나레이션이 이긴다.
     🔴 상한은 `scenes.ts` 의 컷 최대 길이다 — 그보다 큰 하한은 거기서 잘린다(여기서 두 벌로 자르지 않는다). */
  const secPerCut = Number(s.speed?.secPerCut);
  if (Number.isFinite(secPerCut) && secPerCut > 0) applied.minCutMs = Math.round(secPerCut * 1000);

  /* ═══ [R12-3] 말 속도 — 🔴 **이제 넘긴다** ═══
     R10 은 «배워서 저장까지»였다(사유: 속도가 바뀌면 자막 시각·컷 창·전체 길이가 전부 따라 움직인다).
     R12 가 그 셋을 같이 잡았다 ⇒ 여기서는 **배운 배수를 그대로** 실어 보내고,
     🔴 «넘기는 값으로 환산»과 «규격을 넘었나»는 `lib/video/tempo.ts` 와 `gen.ts` 가 한 번씩만 한다. */
  if (Number.isFinite(Number(s.audioTempo))) applied.audioTempo = Number(s.audioTempo);

  /* 🔴 **색 가짓수**는 못 받는다 — 우리 팔레트는 «색 이름 한 줄»이고 «몇 개»를 강제하는 자리가 없다. */
  if (Number.isFinite(Number(s.design?.colorCount))) {
    unused.push({ field: "colorCount", why: `«색 ${s.design?.colorCount}개»를 셌지만 우리 팔레트는 색 가짓수를 강제하는 칸이 없다 — 색 자체는 palette 로 넘어갔다` });
  }

  /* 컷 속도·카메라 — 🟠 **한 축만** 받는다. */
  const paceTxt = txt(s.pace, 120);
  const cameraTxt = txt(s.camera, 240);
  const hint = paceHintOf(`${paceTxt} ${cameraTxt}`);
  if (hint) applied.pace = hint;
  if (paceTxt && !hint) unused.push({ field: "pace", why: `«${paceTxt.slice(0, 40)}» 에서 빠르기를 못 읽었다 — 컷 길이는 나레이션이 정하고, 우리 손잡이는 fast|normal|hold 뿐이다` });
  if (cameraTxt) unused.push({ field: "camera", why: hint ? "컷 안 비트 수만 받았다 — 이동 규칙(푸시인·궤도·팬)은 렌더가 켄번즈 하나뿐이라 못 낸다 · R10 4·5번" : `«${cameraTxt.slice(0, 40)}» — 비트 수도 못 읽었고 이동 규칙도 낼 수 없다` });

  return { applied, unused };
}

/**
 * 🔴 배워 온 **색**은 `variant.palette` 로 넣는다 — 컷 프롬프트 COLOR 절이 그 값을 읽는다.
 *   프롬프트에만 몰래 끼우지 않는 이유: `variant.palette` 는 **화면 칩이 보여 주고 고객이 바꿀 수 있는 값**이다.
 *   프롬프트만 레퍼런스 색으로 바꾸면 칩은 «네이비»라고 말하는데 그림은 다른 색으로 나온다 — **화면이 거짓말을 한다**(AC-52).
 *   편성 확정에서 **기본값으로** 넣어 두면 칩도 같은 값을 말하고, 고객이 다시 고르면 **고객 것이 이긴다**(§9 — 핸들은 고객에게).
 */
export function applyRefPalette(v: VideoSpec | undefined, ref: RefStyleApplied | null): VideoSpec | undefined {
  if (!v || !ref?.palette) return v;
  return { ...v, variant: { ...v.variant, palette: ref.palette } };
}
