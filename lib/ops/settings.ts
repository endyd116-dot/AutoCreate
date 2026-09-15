/**
 * lib/ops/settings.ts — 운영센터 **전역 설정**(플랫폼 한 벌 · 표 `ops_settings` key/value jsonb).
 *   테넌트 설정(`tenants.settings`)과 다른 축이다: 여기 값은 모든 고객에게 같이 적용된다.
 *   첫 손님 = `payment` { keyinEnabled(기본 false) · keyinLabel? · keyinNotice? } — 결제 라인 정책(`lib/pay-route.ts`).
 *   🔴 읽기 실패는 **기본값으로 통과**(결제가 설정 조회 때문에 막히면 안 된다) · 60초 캐시(무배포 토글이 1분 안에 먹는다).
 *   🔴 jsonb 쓰기는 `jsonb()` + 쓴 직후 `jsonb_typeof` 확인(PITFALLS #1).
 *   🔎 출처: AC 신규(계약 KICC 이중 MID · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { jsonb } from "../db-util";

type Bag = Record<string, unknown>;
const TTL = 60_000;
const cache = new Map<string, { at: number; value: Bag }>();

/** 설정 한 덩이 읽기(캐시 60초 · 없거나 실패면 {}). */
export async function readOpsSetting(key: string, force = false): Promise<Bag> {
  const k = String(key).slice(0, 40);
  const hit = cache.get(k);
  if (!force && hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const [r] = await q(sql`SELECT value FROM ops_settings WHERE key = ${k}`);
    const value = (r?.value && typeof r.value === "object" && !Array.isArray(r.value) ? r.value : {}) as Bag;
    cache.set(k, { at: Date.now(), value });
    return value;
  } catch (e) {
    console.warn("[ops/settings] 읽기 실패 — 기본값", k, String((e as Error)?.message ?? e).slice(0, 100));
    return hit?.value ?? {};
  }
}

/** 설정 patch(얕은 병합) — 운영센터 저장 경로에서만. 캐시 즉시 무효화. */
export async function writeOpsSetting(key: string, patch: Bag, operatorId: number | null): Promise<Bag> {
  const k = String(key).slice(0, 40);
  await q(sql`INSERT INTO ops_settings (key, value, updated_by, updated_at) VALUES (${k}, ${jsonb(patch)}, ${operatorId}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = ops_settings.value || EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`);
  const [chk] = await q(sql`SELECT jsonb_typeof(value) AS t FROM ops_settings WHERE key = ${k}`);
  if (chk && chk.t !== "object") console.error("[ops/settings] jsonb_typeof 이상", k, chk);   // PITFALLS #1
  cache.delete(k);
  return await readOpsSetting(k, true);
}

export function invalidateOpsSetting(key?: string): void {
  if (key) cache.delete(String(key).slice(0, 40)); else cache.clear();
}
