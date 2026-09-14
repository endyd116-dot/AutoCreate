/**
 * lib/video/providers/registry.ts — AI 영상 provider 레지스트리 + 하드 금지 목록(순수 · IO 0).
 *   AM 원본: ../AutoMarketing/lib/video-providers/registry.ts (복사 2026-09-15 · 원본 7a180912b 2026-09-03 · 모델명은 lib/ai-models.ts 로 이동 · pickProvider 를 AC 티어 규칙(계약 §0.1-1)으로)
 *   철학(AM R13 그대로): 환각 0 — 공간을 날조 생성하지 않는다. 그래픽 스토리는 t2v «semi-stylized 3D» 계약 안에서만 · 실공간 클레임은 실사진 i2v 만.
 *   🔴 하드 금지(법적): Sora(API 종료·얼굴 입력 거부) · Hunyuan(라이선스가 대한민국 제외) · LTX(연구 전용). env 로 밀어 넣어도 assertProviderAllowed 가 막는다.
 *   가격 = 2026-09-03 공식가 실측 정정본(Veo 표준 $0.40/s · Fast $0.10/s · Lite $0.05/s · Omni $0.10/s).
 */
import { MODEL_OMNI, MODEL_VEO, MODEL_VEO_FAST, MODEL_VEO_LITE, FAL_MODEL_WAN, FAL_MODEL_HAILUO, FAL_MODEL_KLING } from "../../ai-models";
import type { ClipTier, ProviderKey, VideoSeconds } from "../types";

export type { ClipTier, ProviderKey };

export interface ProviderSpec {
  key: ProviderKey;
  label: string;
  gateway: "fal" | "gemini" | "omni";
  model: string;
  /** ~5초 클립 1개 추정 비용(USD). */
  costPer5sUsd: number;
  license: string;
  i2v: boolean;
  t2v: boolean;
  /** 동기(omni) | 제출/폴링(veo·fal). */
  sync: boolean;
}

export const PROVIDERS: Record<ProviderKey, ProviderSpec> = {
  omni: { key: "omni", label: "Gemini Omni 1.1 Flash (Interactions API)", gateway: "omni", model: MODEL_OMNI, costPer5sUsd: 0.50, license: "1st-party·한국 공식 지원·가시 워터마크 없음(SynthID만)", i2v: false, t2v: true, sync: true },
  veo_lite: { key: "veo_lite", label: "Google Veo 3.1 Lite (Gemini API)", gateway: "gemini", model: MODEL_VEO_LITE, costPer5sUsd: 0.25, license: "1st-party·한국 공식 지원·가시 워터마크 없음", i2v: true, t2v: true, sync: false },
  veo_fast: { key: "veo_fast", label: "Google Veo 3.1 Fast (Gemini API)", gateway: "gemini", model: MODEL_VEO_FAST, costPer5sUsd: 0.50, license: "1st-party·한국 공식 지원·가시 워터마크 없음", i2v: true, t2v: true, sync: false },
  veo: { key: "veo", label: "Google Veo 3.1 (Gemini API)", gateway: "gemini", model: MODEL_VEO, costPer5sUsd: 2.00, license: "1st-party·한국 공식 지원·가시 워터마크 없음(SynthID만)", i2v: true, t2v: true, sync: false },
  wan: { key: "wan", label: "Wan 2.2 (fal.ai)", gateway: "fal", model: FAL_MODEL_WAN, costPer5sUsd: 0.20, license: "Apache 2.0(무제한 상업·출력 소유·지역제한 0)", i2v: true, t2v: true, sync: false },
  hailuo: { key: "hailuo", label: "MiniMax Hailuo 02 (fal.ai)", gateway: "fal", model: FAL_MODEL_HAILUO, costPer5sUsd: 0.27, license: "상업 사용 허용·투명 초당 과금·한국 접근 가능", i2v: true, t2v: false, sync: false },
  kling: { key: "kling", label: "Kling 2.6 Pro (fal.ai)", gateway: "fal", model: FAL_MODEL_KLING, costPer5sUsd: 0.35, license: "⚠️ 자기재사용 조항 — 기본 선택 제외(명시 지정 시만)", i2v: true, t2v: false, sync: false },
};

export const BANNED_PROVIDERS: Record<string, string> = {
  sora: "OpenAI Sora — API 2026-09-24 종료 + 실제 인물 얼굴 입력 거부(우리 용도 불가)",
  openai_video: "OpenAI 영상 API — 위와 동일(종료·얼굴 입력 거부)",
  hunyuan: "Tencent Hunyuan Video — 모델 라이선스가 **대한민국을 제외**(한국 기반 제품에서 법적 사용 불가)",
  ltx: "LTX Video — 모델 라이선스 '연구 전용'(상업 사용 불가)",
  ltxv: "LTX Video — 모델 라이선스 '연구 전용'(상업 사용 불가)",
};
export class BannedProviderError extends Error {
  constructor(public readonly token: string, reason: string) { super(`금지된 영상 provider입니다: ${reason}`); this.name = "BannedProviderError"; }
}
/** 호출 시도 자체를 막는 관문 — 어댑터의 모든 요청이 먼저 지난다. */
export function assertProviderAllowed(...tokens: (string | null | undefined)[]): void {
  const hay = tokens.map((t) => String(t ?? "").toLowerCase()).join(" ");
  for (const [tok, reason] of Object.entries(BANNED_PROVIDERS)) {
    if (new RegExp(`(^|[^a-z0-9])${tok}([^a-z0-9]|$)`).test(hay)) throw new BannedProviderError(tok, reason);
  }
}
export function isProviderBanned(...tokens: (string | null | undefined)[]): { banned: boolean; reason?: string } {
  try { assertProviderAllowed(...tokens); return { banned: false }; } catch (e) { return { banned: true, reason: (e as Error).message }; }
}

export function falAvailable(): boolean { return !!(process.env.FAL_KEY || process.env.FAL_API_KEY || "").trim(); }
export function geminiAvailable(): boolean { return !!(process.env.GEMINI_API_KEY || "").trim(); }

/**
 * pickProvider — AC 규칙(계약 §0.1-1): Omni 기본 + Veo Lite 폴백 · **15초는 Lite 강제**(원가 역전 방지) · fal 은 FAL_KEY 있을 때만 · kling 은 명시 지정 시만.
 *   mode i2v(정지 이미지 애니메이션)는 Omni 가 못 하므로 Veo Lite/Fast(또는 fal) 로.
 */
export function pickProvider(tier: ClipTier, mode: "i2v" | "t2v", seconds: VideoSeconds): ProviderSpec {
  if (seconds === 15) return PROVIDERS.veo_lite;
  if (mode === "t2v") {
    if (tier === "money") return PROVIDERS.omni;
    if (tier === "standard") return PROVIDERS.omni;
    return falAvailable() ? PROVIDERS.wan : PROVIDERS.veo_lite;
  }
  if (tier === "money") return PROVIDERS.veo_fast;
  if (tier === "standard") return falAvailable() ? PROVIDERS.hailuo : PROVIDERS.veo_lite;
  return falAvailable() ? PROVIDERS.wan : PROVIDERS.veo_lite;
}
/** 폴백 사다리(계약 §0.1-1): omni → veo_lite · veo_* → veo_lite → (fal) wan · 끝이면 null(정직 실패). */
export function fallbackProvider(cur: ProviderKey): ProviderSpec | null {
  if (cur === "omni" || cur === "veo" || cur === "veo_fast") return PROVIDERS.veo_lite;
  if (cur === "veo_lite") return falAvailable() ? PROVIDERS.wan : null;
  if (cur === "hailuo" || cur === "kling") return PROVIDERS.wan;
  return null;
}
/** 클립 1개 비용 추정(USD) — 초 비례(5초 기준가). */
export function estimateClipCostUsd(provider: ProviderSpec, durationSec: number): number {
  const s = Math.max(1, Math.min(12, Number(durationSec) || 5));
  return Math.round((provider.costPer5sUsd * (s / 5)) * 1000) / 1000;
}
export function cheaperTier(tier: ClipTier): ClipTier | null { return tier === "money" ? "standard" : tier === "standard" ? "filler" : null; }
