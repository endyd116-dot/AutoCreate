/**
 * lib/similarity.ts — 본문 «같은 글» 판정(글자 2-gram 자카드). AM 원본: ../AutoMarketing/lib/ad-copy-similarity.ts (복사 2026-09-14 · 임계만 본문용으로 조정)
 *   소비처: content-gen(같은 brief 의 다른 piece · 같은 계정 최근 30일 글과 비교 → 임계 초과 시 앵글 바꿔 1회 재생성 · DESIGN §4.3 «계정 간 중복 0»).
 *   임계 근거: 카피(짧은 문장)는 0.6 이 «같은 말»이지만 긴 본문은 공통 어휘가 많아 자카드가 낮게 나온다 —
 *   같은 소재를 두 채널로 쓴 실측 없이 값을 못 박지 않는다 → 보수적으로 0.45(같은 재료를 그대로 옮긴 글은 0.6+ · 관점을 바꾼 글은 0.2~0.35 근처를 기대). 운영 실측 후 조정.
 */
export const SAME_BODY_SIMILARITY = 0.45;

export function normalizeCopyKey(s: unknown): string {
  return String(s ?? "").normalize("NFC").replace(/[\s,.!?~()\-+&:%·「」"'“”]/g, "");
}
function bigrams(s: string): Set<string> {
  const t = normalizeCopyKey(s);
  const out = new Set<string>();
  if (t.length <= 1) { if (t) out.add(t); return out; }
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
/** 0~1 자카드. */
export function copySimilarity(a: unknown, b: unknown): number {
  const A = bigrams(String(a ?? "")), B = bigrams(String(b ?? ""));
  if (A.size === 0 || B.size === 0) return normalizeCopyKey(a) === normalizeCopyKey(b) ? 1 : 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / (A.size + B.size - inter);
}
export function isSameBody(a: unknown, b: unknown, threshold = SAME_BODY_SIMILARITY): boolean {
  if (normalizeCopyKey(a) === normalizeCopyKey(b)) return true;
  return copySimilarity(a, b) >= threshold;
}
/** 여러 본문 중 최대 유사도. */
export function maxSimilarity(text: string, others: string[]): { score: number; index: number } {
  let best = { score: 0, index: -1 };
  others.forEach((o, i) => { const s = copySimilarity(text, o); if (s > best.score) best = { score: s, index: i }; });
  return best;
}

/**
 * 계정 간 유사도 게이트(P1R3 §1.7 · DESIGN §7.3): 같은 테넌트의 **다른 계정**이 최근 CROSS_ACCOUNT_DAYS 일 안에 올린 글과
 *   제목·도입부가 이만큼 닮으면 편성 단계에서 소재를 바꾼다(플랫폼의 «같은 사람이 여러 계정» 판정을 피한다). 🔴 임계·기간은 여기 한 곳.
 */
export const CROSS_ACCOUNT_SIMILARITY = 0.6;
export const CROSS_ACCOUNT_DAYS = 14;
