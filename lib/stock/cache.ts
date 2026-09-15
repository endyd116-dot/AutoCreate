/**
 * lib/stock/cache.ts — 제공사 응답 **24시간 보관** + 실제 호출 수 세기(계약 P1R8 §10 · 조사 §1.2).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음.
 *
 *   ══ 🔴 왜 메모리 캐시로는 안 되나 ══
 *     Pixabay 약관이 **«Requests must be cached for 24 hours»** 를 요구한다(https://pixabay.com/api/docs/).
 *     함수 인스턴스 메모리는 **콜드 스타트마다 비워진다** — 그러면 «24시간 캐시했다»가 우리 말만 그런 것이 된다.
 *     그래서 정본은 DB(`stock_cache`)에 두고, 메모리는 그 앞에 붙는 **빠른 길**로만 쓴다(같은 인스턴스 안 반복 호출).
 *
 *   ══ 🔴 표 하나가 일 셋을 한다 ══
 *     ① 24시간 보관(약관) ② 같은 검색어를 두 번 안 물어본다(값) ③ **요청 상한 세기** —
 *     실제 호출만 행을 만드므로 «최근 60초 안에 생긴 행 수» = «최근 60초 동안 부른 횟수»다.
 *     따로 카운터 표를 만들지 않았다. 🔴 다만 **정확한 상한이 아니라 안전한 근사**다(동시 호출은 셋 다 «아직 0» 을 볼 수 있다) —
 *     여유를 두고 끊는 이유가 그것이다(`RATE` 표의 값이 제공사 상한보다 낮다).
 *
 *   ══ 이 표에 tenant_id 가 없는 이유(CLAUDE §4.6 의 예외 — 잊은 것이 아니다) ══
 *     여기 담기는 것은 **제공사의 공개 검색 결과**이지 고객의 것이 아니다. 집마다 따로 담으면
 *     ①같은 검색어를 집 수만큼 물어보게 되어 약관이 요구한 캐시가 무의미해지고 ②상한에 그만큼 빨리 닿는다.
 *     검색어 원문도 담는다 — **어차피 그 문자열을 제공사에게 보낸다**(여기 담는다고 새로 드러나는 것이 없다). 대신 운영자가 되짚을 수 있다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { jsonb } from "../db-util";
import type { StockProviderName } from "./types";

/** 약관이 요구하는 보관 시간. 🔴 줄이지 마라 — Pixabay 요구치다. */
export const CACHE_TTL_SEC = 24 * 60 * 60;

/**
 * 제공사별 요청 상한 — **공식 문서 값보다 낮게 잡는다**(위 «안전한 근사» 이유).
 *   · Pixabay «100 requests per 60 seconds» → 80/60s
 *   · Pexels  «200 per hour · 20,000 per month» → 160/시간
 */
export const RATE: Readonly<Record<StockProviderName, { max: number; windowSec: number }>> = {
  pixabay: { max: 80, windowSec: 60 },
  pexels: { max: 160, windowSec: 3600 },
};

/** 검색어를 캐시 열쇠로 — 대소문자·앞뒤 공백·가운데 공백 차이로 같은 검색을 두 번 하지 않게. */
export function queryKeyOf(a: { query: string; count: number; lang?: string }): string {
  const nq = String(a.query ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${nq}|${Math.max(1, Math.floor(a.count))}|${a.lang ?? ""}`;
}

/* ── 메모리 앞단(같은 인스턴스 안에서만 · 정본은 DB) ────────────────────────── */
interface MemEntry { payload: unknown; expiresAt: number }
const mem = new Map<string, MemEntry>();
const MEM_MAX = 120;
/** 제공사 이름에는 `|` 가 없으므로(pixabay·pexels) 첫 `|` 앞이 곧 제공사다 — 열쇠가 섞이지 않는다.
 *  ⚠️ 여기에 제어문자를 쓰면 **git 이 이 파일을 binary 로 본다**(2026-09-15 실측 · diff 도 머지도 안 된다). */
const memKey = (p: string, k: string) => `${p}|${k}`;

function memGet(p: StockProviderName, k: string): unknown | null {
  const e = mem.get(memKey(p, k));
  if (!e) return null;
  if (e.expiresAt <= Date.now()) { mem.delete(memKey(p, k)); return null; }
  return e.payload;
}
function memPut(p: StockProviderName, k: string, payload: unknown, ttlSec: number): void {
  if (mem.size >= MEM_MAX) { const first = mem.keys().next().value; if (first) mem.delete(first); }
  mem.set(memKey(p, k), { payload, expiresAt: Date.now() + ttlSec * 1000 });
}

/* ── DB 정본 ──────────────────────────────────────────────────────────────── */

/**
 * 보관해 둔 응답(없거나 만료면 null).
 *   🔴 DB 가 안 되면 **막지 않는다** — 캐시가 죽었다고 사진을 못 가져오면 안 된다. 그때는 «캐시 없음»으로 계속 간다(로그 한 줄).
 */
export async function readCache(provider: StockProviderName, queryKey: string): Promise<unknown | null> {
  const m = memGet(provider, queryKey);
  if (m !== null) return m;
  try {
    const [row] = await q(sql`SELECT payload FROM stock_cache
      WHERE provider = ${provider} AND query_key = ${queryKey} AND expires_at > NOW() LIMIT 1`);
    if (!row) return null;
    memPut(provider, queryKey, row.payload, 60);   /* 앞단은 짧게 — 정본이 DB 다 */
    return row.payload;
  } catch (e) { console.warn("[stock-cache] 읽기 실패(캐시 없이 계속한다)", String((e as Error)?.message ?? e).slice(0, 120)); return null; }
}

/**
 * 응답을 보관한다. **실제로 제공사를 부른 직후에만** 부른다 — 이 행이 곧 «호출했다»의 기록이라 상한 세기가 여기에 기댄다.
 *   🔴 쓴 직후 `jsonb_typeof` 확인까지가 쓰기다(PITFALLS #1).
 */
export async function writeCache(provider: StockProviderName, queryKey: string, payload: unknown, ttlSec = CACHE_TTL_SEC): Promise<void> {
  memPut(provider, queryKey, payload, Math.min(ttlSec, 300));
  try {
    const [ins] = await q(sql`INSERT INTO stock_cache (provider, query_key, payload, expires_at)
      VALUES (${provider}, ${queryKey}, ${jsonb(payload)}, NOW() + (${ttlSec} * INTERVAL '1 second'))
      ON CONFLICT (provider, query_key) DO UPDATE
        SET payload = EXCLUDED.payload, created_at = NOW(), expires_at = EXCLUDED.expires_at
      RETURNING id`);
    const [chk] = await q(sql`SELECT jsonb_typeof(payload) AS t FROM stock_cache WHERE id = ${Number(ins?.id ?? 0)}`);
    if (chk?.t !== "object") console.error("[stock-cache] payload jsonb 확인 실패", chk);
  } catch (e) { console.warn("[stock-cache] 쓰기 실패(응답은 그대로 쓴다)", String((e as Error)?.message ?? e).slice(0, 120)); }
}

/**
 * 지금 한 번 더 불러도 되나 — «최근 창 안에 실제 호출이 몇 번 있었나»로 본다.
 *   🔴 **DB 가 안 되면 통과시킨다.** 캐시 표가 죽었을 때 사진 기능 전체를 멈추는 것이 더 나쁘다
 *      (상한을 넘으면 제공사가 429 로 말해 주고, 그건 `http_error` 로 정직하게 화면에 뜬다).
 */
export async function rateAllows(provider: StockProviderName): Promise<{ ok: boolean; used: number; max: number }> {
  const { max, windowSec } = RATE[provider];
  try {
    const [row] = await q(sql`SELECT COUNT(*)::int AS c FROM stock_cache
      WHERE provider = ${provider} AND created_at > NOW() - (${windowSec} * INTERVAL '1 second')`);
    const used = Math.floor(Number(row?.c ?? 0)) || 0;
    return { ok: used < max, used, max };
  } catch { return { ok: true, used: 0, max }; }
}

/** 만료된 행 치우기 — 크론이 부른다(표가 한없이 자라지 않게). 지우는 것은 **만료된 것뿐**이다. */
export async function sweepStockCache(limit = 5000): Promise<number> {
  try {
    const rows = await q(sql`DELETE FROM stock_cache WHERE id IN (
      SELECT id FROM stock_cache WHERE expires_at <= NOW() ORDER BY id LIMIT ${Math.max(1, limit)}
    ) RETURNING id`);
    return rows.length;
  } catch (e) { console.warn("[stock-cache] 청소 실패", String((e as Error)?.message ?? e).slice(0, 120)); return 0; }
}
