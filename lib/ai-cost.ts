/**
 * lib/ai-cost.ts — Gemini 모델별 단가표 + calcCost. AM 원본: ../AutoMarketing/lib/ai-cost.ts (복사 2026-09-14 · 단가 무수정 · 주석 축약)
 *   ai_usage.cost_usd 의 유일한 계산기. 새 모델을 ai-models.ts 체인에 넣을 때 **같은 커밋**에서 여기 단가를 넣는다
 *   (빠뜨리면 __default $0.075 로 떨어져 실제의 1/20 로 기록된다 — AM 2026-09-11 실사고).
 *   출처: https://ai.google.dev/pricing (추정치 — 운영 적용 시 공식 단가 재확인).
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Context Caching 적중 입력 토큰 단가(보통 입력의 1/4). */
  cachedInputPerMTok?: number;
}

const PRICING: Record<string, ModelPricing> = {
  "gemini-3.5-flash":      { inputPerMTok: 0.075, outputPerMTok: 0.30, cachedInputPerMTok: 0.01875 },
  "gemini-3-flash":        { inputPerMTok: 0.075, outputPerMTok: 0.30, cachedInputPerMTok: 0.01875 },
  "gemini-3.6-flash":       { inputPerMTok: 1.50, outputPerMTok: 7.50, cachedInputPerMTok: 0.375 },
  "gemini-3.7-flash":       { inputPerMTok: 1.50, outputPerMTok: 7.50, cachedInputPerMTok: 0.375 },
  "gemini-3.8-flash":       { inputPerMTok: 1.50, outputPerMTok: 7.50, cachedInputPerMTok: 0.375 },
  "gemini-flash-latest":    { inputPerMTok: 1.50, outputPerMTok: 7.50, cachedInputPerMTok: 0.375 },
  "gemini-3.1-pro-preview": { inputPerMTok: 2.00, outputPerMTok: 12.00, cachedInputPerMTok: 0.50 },
  "gemini-3.5-flash-lite":  { inputPerMTok: 0.30, outputPerMTok: 2.50, cachedInputPerMTok: 0.075 },
  "gemini-3-flash-preview": { inputPerMTok: 0.075, outputPerMTok: 0.30, cachedInputPerMTok: 0.01875 },
  "gemini-3.1-flash-lite":  { inputPerMTok: 0.025, outputPerMTok: 0.10, cachedInputPerMTok: 0.00625 },
  "gemini-3-flash-lite":   { inputPerMTok: 0.025, outputPerMTok: 0.10, cachedInputPerMTok: 0.00625 },
  "gemini-3.0-flash":      { inputPerMTok: 0.075, outputPerMTok: 0.30, cachedInputPerMTok: 0.01875 },
  "gemini-2.5-flash":      { inputPerMTok: 0.075, outputPerMTok: 0.30, cachedInputPerMTok: 0.01875 },
  "gemini-2.5-flash-lite": { inputPerMTok: 0.025, outputPerMTok: 0.10, cachedInputPerMTok: 0.00625 },
  "gemini-2.0-flash":      { inputPerMTok: 0.075, outputPerMTok: 0.30, cachedInputPerMTok: 0.01875 },
  "gemini-embedding-001":  { inputPerMTok: 0.15,  outputPerMTok: 0 },
  /* 이미지 생성 모델 — 출력은 이미지 토큰(장당 ~1,290 토큰 · $30/M 준용 ≈ $0.039/장). AC 추가(AM 표엔 없음 · 보수 추정). */
  "gemini-3.1-flash-image":         { inputPerMTok: 0.30, outputPerMTok: 30.0 },
  "gemini-3.1-flash-image-preview": { inputPerMTok: 0.30, outputPerMTok: 30.0 },
  "gemini-3-pro-image":             { inputPerMTok: 2.00, outputPerMTok: 120.0 },
  /* 미등록 모델 폴백 — flash 단가로 보수적 계산 */
  "__default":             { inputPerMTok: 0.075, outputPerMTok: 0.30, cachedInputPerMTok: 0.01875 },
};

export function getPricing(model: string): ModelPricing {
  return PRICING[model] || PRICING.__default;
}

/** calcCost — 모델별 정확 토큰 비용(USD). cachedTokens 는 Context Caching 적중 입력 토큰. */
export function calcCost(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0): number {
  const p = getPricing(model);
  const inTok = Math.max(0, inputTokens - cachedTokens);
  const inputCost = (inTok / 1_000_000) * p.inputPerMTok;
  const cachedCost = (cachedTokens / 1_000_000) * (p.cachedInputPerMTok ?? p.inputPerMTok);
  const outputCost = (outputTokens / 1_000_000) * p.outputPerMTok;
  return inputCost + cachedCost + outputCost;
}
