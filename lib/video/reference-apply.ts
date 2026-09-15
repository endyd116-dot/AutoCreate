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
 *   🔴 **`audio_tempo`(말 속도)는 여기서 안 다룬다** — 손잡이는 `tts-typecast.ts` 에 있지만
 *      **레퍼런스가 그 칸을 애초에 저장하지 않는다**(`TemplateStyle` 에 없다). 「읽게만 한다」로는 이을 수 없고,
 *      «컷 속도 글 → 말 속도»로 옮기는 건 **새 규칙**이라 R10 이다(나레이션 길이가 바뀌면 자막 시각·컷 창이 전부 따라 움직인다).
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

  /* 🔴 자막 문법 — **넣을 칸이 없다.** 자막은 브라우저가 그린 PNG 이고 굵기·색·그림자가 렌더에 **상수**로 박혀 있다.
     프리셋 3개(keyword_center·talking_big·clip_top) 말고 고를 것이 없다 → 배워 와도 늘 여기 남는다. */
  const caption = txt(s.caption, 160);
  if (caption) unused.push({ field: "caption", why: "자막 모양이 렌더에 상수로 박혀 있다(프리셋 3개뿐) — 넣을 칸이 없다 · R10 3번" });

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
