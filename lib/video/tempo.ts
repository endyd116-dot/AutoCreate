/**
 * lib/video/tempo.ts — **말 속도**(R12-3 · B2 · 2026-09-17). 🔴 순수(임포트 0 · DB·네트워크 0).
 *   `scripts/verify-video-tempo.mts` 가 이 파일을 그대로 돌린다.
 *
 *   ══ 왜 따로 파일인가 ══
 *     R10 에서 `audioTempo` 를 **저장까지만** 하고 `refUnused` 에 «아직 반영 안 함 + 왜»를 적어 뒀다:
 *     🔴 «말 속도가 바뀌면 나레이션 길이가 바뀌고, 그러면 **자막 시각·컷 창·전체 길이가 전부 따라 움직인다**».
 *     ⇒ 「값 하나 넘기기」가 아니라 **새 규칙**이라 판정을 순수 함수로 빼 둔다 —
 *        `gen.ts` 안에 섞으면 DB 없이 못 돌리고, 못 돌리는 규칙은 «있나»로만 재게 된다(AC-99 ⑩).
 *
 *   ══ 🔴 무회귀가 이 변경의 절반이다 ══
 *     기본값은 **종전에 박혀 있던 그 상수**(`NARRATION_TEMPO_BASELINE` = 1.1 · AM SHORTS1).
 *     레퍼런스가 아무것도 안 배워 오면 `resolveNarrationTempo` 는 **정확히 1.1** 을 돌려주고,
 *     그러면 TTS 요청 본문도 종전과 한 글자도 안 달라진다(`audio_tempo` 는 ≠1 일 때만 실린다 ⇒ 1.1 은 실린다 · 종전에도 실렸다).
 *
 *   ══ 🔴 배운 값의 «단위» — 여기서 한 번만 정한다 ══
 *     레퍼런스 프롬프트가 묻는 말은 «말 속도 배수 0.5~2.0(**보통이면 1.0**)»이다.
 *     그런데 **우리 보통은 1.0 이 아니라 1.1** 이다. 배운 값을 그대로 `audio_tempo` 로 넘기면
 *     «보통 속도로 배워 왔다»가 **오늘보다 느린 영상**이 된다 — 배운 적 없는 변화다(조용한 개편).
 *     ⇒ **상대 배수로 읽는다**: 넘기는 값 = `clamp(1.1 × 배운값)`. 배운값 1.0 = **오늘과 같은 영상**.
 */

/** 타입캐스트가 받는 범위(API 계약). */
export const TEMPO_MIN = 0.5;
export const TEMPO_MAX = 2.0;

/**
 * 🔴 **우리 «보통» 말 속도** — AM SHORTS1 실측값 1.1. 종전에 `tts-typecast.ts` 에 박혀 있던 그 상수다.
 *   `TYPECAST_DEFAULT_TEMPO` 가 이 값을 다시 내보낸다(상수 두 벌 금지 — 갈라지면 무회귀 축이 거짓말을 한다).
 */
export const NARRATION_TEMPO_BASELINE = 1.1;

/** 규격(초)을 넘었다고 볼 여유 — 인코딩·컨테이너 반올림분. 이보다 적게 넘친 것은 «넘쳤다»로 세지 않는다. */
export const TEMPO_SPEC_GRACE_MS = 250;

export function clampTempo(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return NARRATION_TEMPO_BASELINE;
  return Math.min(TEMPO_MAX, Math.max(TEMPO_MIN, Math.round(n * 1000) / 1000));
}

export interface TempoPlan {
  /** TTS 에 실제로 넘길 값. 🔴 배운 것이 없으면 **정확히 baseline**. */
  tempo: number;
  /** 레퍼런스가 배워 온 «보통 대비 배수»(못 배웠으면 `null` — 0·1 로 메우지 않는다 · AC-92). */
  learned: number | null;
  /** baseline 과 다른가 = 이 piece 는 «속도를 손댄» piece 인가. */
  changed: boolean;
  /**
   * R2 키·캐시 세대에 붙일 꼬리. 🔴 **baseline 이면 빈 문자열**이라 옛 piece 의 키가 그대로 산다(재합성 0원).
   *   속도가 다르면 다른 폴더라 **굽고 있던 렌더가 다른 속도의 음성을 집지 않는다**(AC-39 와 같은 근거).
   */
  genSuffix: string;
}

/**
 * 배운 값 → 실제로 넘길 말 속도. 🔴 **못 배웠으면 baseline**(오늘과 같은 영상).
 *   `learned` 는 «보통(1.0) 대비 배수»다 — 위 머리말의 단위 규칙.
 */
export function resolveNarrationTempo(learned: unknown): TempoPlan {
  const raw = Number(learned);
  const ok = Number.isFinite(raw) && raw >= TEMPO_MIN && raw <= TEMPO_MAX;
  if (!ok) return { tempo: NARRATION_TEMPO_BASELINE, learned: null, changed: false, genSuffix: "" };
  const tempo = clampTempo(NARRATION_TEMPO_BASELINE * raw);
  const changed = Math.abs(tempo - NARRATION_TEMPO_BASELINE) > 0.001;
  /* 꼬리는 `narrationKey` 가 `[^a-z0-9]` 를 지우고 16자로 자른다 — 소수점·부호가 없는 모양으로 만든다. */
  return { tempo, learned: Math.round(raw * 100) / 100, changed, genSuffix: changed ? `t${Math.round(tempo * 100)}` : "" };
}

export interface TempoVerdict {
  /** 이 속도로 가도 되나. */
  keep: boolean;
  /** 규격(ms). */
  specMs: number;
  /** 잰 전체 길이(ms). */
  measuredMs: number;
  /** 🔴 사람말 — 못 낸 이유. `keep` 이면 `null`. 화면·`refUnused` 가 이 문장을 그대로 쓴다. */
  why: string | null;
}

/**
 * 🔴 **잰 뒤에** 판정한다 — «규격을 넘었나»는 음성을 굽기 전엔 모른다(추정으로 적으면 그게 AC-92 다).
 *   넘었으면 **속도를 포기하고 보통으로 다시 굽는다**. 막는 것이 아니다 — 영상은 나간다(CLAUDE §9).
 *   🔴 baseline 으로 굽고도 넘치는 것은 **대본이 길어서**(B 몫)지 속도 탓이 아니다 ⇒ 그때는 `keep:true`
 *      («속도를 되돌려도 안 줄어드는데 두 번 굽는 것»은 돈만 두 배다).
 */
export function checkTempoFitsSpec(a: { plan: TempoPlan; seconds: number; measuredTotalMs: number }): TempoVerdict {
  const specMs = Math.max(1000, Math.round(Number(a.seconds) || 0) * 1000);
  const measuredMs = Math.max(0, Math.round(Number(a.measuredTotalMs) || 0));
  const over = measuredMs > specMs + TEMPO_SPEC_GRACE_MS;
  /* 속도를 안 건드렸으면 되돌릴 것이 없다. 느리게가 아니라 **빠르게** 배운 경우도 되돌릴 이유가 없다
     (빠르게는 길이를 줄이지 늘리지 않는다 — 넘쳤다면 대본 탓이다). */
  if (!over || !a.plan.changed || a.plan.tempo >= NARRATION_TEMPO_BASELINE) {
    return { keep: true, specMs, measuredMs, why: null };
  }
  return {
    keep: false, specMs, measuredMs,
    why: `말 속도를 그대로 쓰면 ${Math.round(measuredMs / 100) / 10}초가 되어 ${Math.round(specMs / 1000)}초를 넘어서, 보통 속도로 만들었어요.`,
  };
}

/* ═══════════ B(대본 길이) 쪽이 부르는 둘 — 🔴 **식을 두 벌 적지 않으려고 여기 둔다** ═══════════
 *   B-8 이 «대본을 속도만큼 짧게» 쓴다(`script.ts budgetFor`). 그 셈이 저쪽에 한 벌 더 적히면
 *   **속도는 A 로 굽고 대본은 B 로 맞추는** 일이 조용히 생긴다 — 그러면 규격 초과가 왔다 갔다 한다.
 *   ⇒ 넘길 값도, 음절 예산 비율도 **이 파일 한 곳**에서 나온다(2026-09-17 B↔B2 합의).
 */

/** 배운 «보통 대비 배수» → TTS 에 실제로 넘길 값. `resolveNarrationTempo(x).tempo` 와 같다. */
export function effectiveTempo(learned: unknown): number { return resolveNarrationTempo(learned).tempo; }

/**
 * 대본 음절 예산에 곱할 비율. 🔴 **느리게 말하면 대본이 짧아야** 같은 초에 들어간다.
 *   = 실제 속도 ÷ 우리 보통 속도. 못 배웠으면 **정확히 1**(대본이 종전과 한 글자도 안 달라진다 · 무회귀).
 */
export function syllableRatioOf(learned: unknown): number {
  return Math.round((effectiveTempo(learned) / NARRATION_TEMPO_BASELINE) * 1000) / 1000;
}
