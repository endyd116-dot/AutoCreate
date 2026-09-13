/**
 * lib/db-util.ts — DB 소도구.
 *   jsonb(): drizzle `sql` 템플릿용 jsonb 바인딩. AM 라이브 관례(`${JSON.stringify(x)}::jsonb` · lib/audit.ts 등 100여 곳)와 동일.
 *   ⚠️ PITFALLS #1 은 postgres-js **raw 클라이언트**(pgClient) 경로 — 거기서는 `pgClient.json(obj)` 만 쓴다. 드리즐 sql 경로는 이 헬퍼.
 *   쓴 직후 `jsonb_typeof()` 로 object/array 인지 확인하는 것까지가 쓰기다(스모크 스크립트 scripts/smoke-db.mjs).
 */
import { sql, type SQL } from "drizzle-orm";
export function jsonb(value: unknown): SQL {
  return sql`${JSON.stringify(value ?? null)}::jsonb`;
}

/** timestamp(without tz) 는 postgres-js 가 "YYYY-MM-DD HH:MM:SS.ffffff" 문자열로 준다. UTC 로 해석해 Date 로(로컬 tz 오염 방지 · PITFALLS #4). */
export function utcDate(v: unknown): Date | null {
  if (v == null) return null;
  if (v instanceof Date) return v;
  const s = String(v);
  if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(s) && !/[zZ]|[+-]\d\d:?\d\d$/.test(s)) return new Date(s.replace(" ", "T") + "Z");
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
}
