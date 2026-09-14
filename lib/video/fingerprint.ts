/**
 * lib/video/fingerprint.ts — 프레임 지문(pHash 64bit · DCT) + 계정 간 변주 게이트(계약 §1.9 · DESIGN §6.2 «중복 업로드 판정 회피» · §16B.3 유튜브 «반복 콘텐츠»).
 *   AC 신규(2026-09-15). 의존성 0 — PNG/JPEG 를 직접 디코딩하지 않는다(서버리스 · sharp 없음): 러너가 포스터와 함께 올리는 **32×32 그레이 썸네일 raw**(RenderReport 확장 `thumbGray?: base64 1024B`)가 있으면 그것으로, 없으면 Gemini 비전이 «닮음»을 판정하는 폴백(judge.ts).
 *   임계: 해밍 거리 ≤ 10 = 유사(같은 사람이 여러 계정) → 팔레트·훅 바꿔 1회 재생성(P1). 대본 유사도는 lib/similarity.ts CROSS_ACCOUNT_SIMILARITY 그대로.
 */
export const PHASH_SIMILAR_MAX_DISTANCE = 10;

/** 32×32 그레이(0~255 · 1024B) → 64bit pHash(hex 16자). 순수 DCT(8×8 저주파 · 중앙값 기준). */
export function phashFromGray32(gray: Uint8Array | number[]): string {
  const N = 32; const px = Array.from(gray).slice(0, N * N); while (px.length < N * N) px.push(0);
  const c = (u: number) => (u === 0 ? Math.SQRT1_2 : 1);
  const dct: number[][] = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) {
    let s = 0;
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) s += px[x * N + y] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N)) * Math.cos(((2 * y + 1) * v * Math.PI) / (2 * N));
    dct[u][v] = (c(u) * c(v) / 4) * s;
  }
  const vals: number[] = []; for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) if (u || v) vals.push(dct[u][v]);
  const sorted = [...vals].sort((a, b) => a - b); const median = sorted[Math.floor(sorted.length / 2)];
  let bits = ""; for (let u = 0; u < 8; u++) for (let v = 0; v < 8; v++) bits += (u || v) ? (dct[u][v] > median ? "1" : "0") : "0";
  let hex = ""; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
export function hammingHex(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0; for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}
export function isSimilarHash(a: string, b: string, max = PHASH_SIMILAR_MAX_DISTANCE): boolean { return hammingHex(a, b) <= max; }
/** 여러 지문 중 가장 가까운 것. */
export function nearestHash(target: string, others: { id: number; hash: string }[]): { id: number; distance: number } | null {
  let best: { id: number; distance: number } | null = null;
  for (const o of others) { const d = hammingHex(target, o.hash); if (!best || d < best.distance) best = { id: o.id, distance: d }; }
  return best;
}
