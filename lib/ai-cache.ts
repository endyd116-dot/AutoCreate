/**
 * lib/ai-cache.ts — AI 응답 메모리 캐시. AM 원본: ../AutoMarketing/lib/ai-cache.ts (복사 2026-09-15 · 원본은 SIREN tbfa-mis 차용본)
 *   AC 변경: 키 재료를 AC `callGemini` 인자(purpose·chain·system·user·json·mode·temperature·maxOutputTokens)로 교체 ·
 *            `googleSearch:true` 는 **캐시하지 않는다**(검색 그라운딩은 «지금»을 묻는 호출이라 5분 전 답이 틀릴 수 있다) ·
 *            적중 시 `costUsd:0` + `cached:true` 로 돌려주고 `ai_usage` 에 **기록하지 않는다**(안 쓴 돈을 쓴 것으로 세지 않는다).
 *
 *   ══ 왜 ══
 *     같은 입력의 Gemini 호출이 짧은 시간에 반복되면 돈이 두 번 나간다. 전수조사에서 AM 재사용 맵의 빈칸이었고,
 *     사장님이 «AI 원가가 왜 이만큼이냐»를 물은 화면(운영 대시보드)의 숫자를 직접 줄이는 자리다.
 *
 *   ══ 정책(AM 그대로) ══
 *     · 키 = 입력 직렬화의 경량 해시(crypto 없이) + **tenantId 포함**(교차 테넌트 누수 0 · CLAUDE §4.6)
 *     · TTL 5분 · 최대 200건 LRU · **성공(text 있음)만** 저장 · 함수 인스턴스 메모리(콜드 스타트마다 비워진다 — 안전망이지 정합성 보장이 아니다)
 *   🔴 이 파일은 아무것도 import 하지 않는다(순환 0 · AC-17).
 */

const TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 200;

export interface CachedAiResult {
  text: string;
  json?: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
}

interface Entry { value: CachedAiResult; expiresAt: number; lastAccess: number }
const cache = new Map<string, Entry>();

/** 입력 조합 → 안정 캐시 키(경량 해시 · AM 의 33/31 이중 해시 그대로). */
export function buildAiCacheKey(parts: {
  tenantId?: number | null;
  purpose: string;
  chain: string[];
  role?: string;
  system?: string;
  user: string;
  json?: boolean;
  mode?: string;
  temperature?: number;
  maxOutputTokens?: number;
}): string {
  const payload = JSON.stringify({
    t: parts.tenantId ?? 0, f: parts.purpose, c: parts.chain, r: parts.role ?? "",
    s: parts.system ?? "", p: parts.user, j: !!parts.json, m: parts.mode ?? "",
    tp: parts.temperature ?? null, mx: parts.maxOutputTokens ?? null,
  });
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return `${parts.purpose}:${h1.toString(36)}${h2.toString(36)}`;
}

/** 적중 시 결과, 아니면 null. */
export function tryAiCacheGet(key: string): CachedAiResult | null {
  const e = cache.get(key);
  if (!e) return null;
  const now = Date.now();
  if (e.expiresAt < now) { cache.delete(key); return null; }
  e.lastAccess = now;
  return e.value;
}

/** 성공 결과 저장(LRU 정원 관리). 빈 응답은 저장하지 않는다. */
export function aiCacheSet(key: string, value: CachedAiResult): void {
  if (!value || !value.text) return;
  const now = Date.now();
  if (cache.size >= MAX_ENTRIES && !cache.has(key)) {
    let oldestKey: string | null = null, oldestTime = Infinity;
    for (const [k, v] of cache.entries()) if (v.lastAccess < oldestTime) { oldestTime = v.lastAccess; oldestKey = k; }
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: now + TTL_MS, lastAccess: now });
}

/** 진단용 — 캐시 상태(운영 화면·프로브). */
export function getAiCacheStats(): { size: number; valid: number; max: number; ttlMs: number } {
  const now = Date.now();
  let valid = 0;
  for (const e of cache.values()) if (e.expiresAt >= now) valid++;
  return { size: cache.size, valid, max: MAX_ENTRIES, ttlMs: TTL_MS };
}

/** 전체 비우기(테스트·프로브). 지운 건수를 돌려준다. */
export function clearAiCache(): number { const n = cache.size; cache.clear(); return n; }
