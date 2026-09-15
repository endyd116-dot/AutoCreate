/**
 * lib/db-util.ts — DB 소도구.
 *   jsonb(): drizzle `sql` 템플릿용 jsonb 바인딩. AM 라이브 관례(`${JSON.stringify(x)}::jsonb` · lib/audit.ts 등 100여 곳)와 동일.
 *   ⚠️ PITFALLS #1 은 postgres-js **raw 클라이언트**(pgClient) 경로 — 거기서는 `pgClient.json(obj)` 만 쓴다. 드리즐 sql 경로는 이 헬퍼.
 *   쓴 직후 `jsonb_typeof()` 로 object/array 인지 확인하는 것까지가 쓰기다(스모크 스크립트 scripts/smoke-db.mjs).
 *   🔎 출처: AC 신규(계약 phase0 · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql, type SQL } from "drizzle-orm";
export function jsonb(value: unknown): SQL {
  return sql`${JSON.stringify(value ?? null)}::jsonb`;
}

/** timestamp(without tz) 는 postgres-js 가 "YYYY-MM-DD HH:MM:SS.ffffff" 문자열로 준다. UTC 로 해석해 Date 로(로컬 tz 오염 방지 · PITFALLS #4). */
export function utcDate(v: unknown): Date | null {
  if (v == null) return null;
  /* 🔴 **«잘못된 날짜»를 값으로 돌려주지 않는다** — 옛 코드는 `Date` 면 그대로 돌려줘서 Invalid Date 가 새어 나갔고,
     받는 쪽에서 `toISOString()` 이 던졌다(2026-09-15 B-1 실측 · 캐던스 검사에서 터짐). 못 읽었으면 **null** 이다. */
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const s = String(v);
  /* 🔴 **«+00» 두 자리 오프셋**도 «시간대가 붙은 값»이다 — 옛 정규식은 네 자리(`+09:00`·`+0900`)만 봐서
     Postgres 가 흔히 내주는 `2026-09-16 11:09:31.928+00` 을 «시간대 없음»으로 보고 뒤에 `Z` 를 덧붙였다 → **Invalid Date**.
     그 값이 그대로 새어 나가 캐던스 검사가 **조용히 아무것도 못 잡았다**(2026-09-15 B-1 실측). */
  if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(s) && !/([zZ]|[+-]\d\d(:?\d\d)?)$/.test(s)) {
    const u = new Date(s.replace(" ", "T") + "Z");
    return Number.isNaN(u.getTime()) ? null : u;
  }
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
}
