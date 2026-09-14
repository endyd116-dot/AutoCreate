/**
 * lib/ops/period.ts — 운영센터 집계용 **KST 월 범위**(계약 §2.1 «전부 KST 월» · §13.5).
 *   DB 의 timestamp(without tz)는 UTC 로 저장돼 있다. KST 월의 [시작, 끝) 을 UTC Date 로 만들어 `${ts(start)}::timestamptz AT TIME ZONE 'UTC'` 로 비교한다(AC-5 · Date 바인딩 금지).
 *   `?month=YYYY-MM` 이 없으면 이번 달(KST). 잘못된 값이면 이번 달로(운영 화면이 빈 표를 보는 것보다 낫다 · 응답의 `month` 로 무엇을 집계했는지 알린다).
 */
import { sql, type SQL } from "drizzle-orm";

const KST_MS = 9 * 3600_000;
export interface KstRange { month: string; start: Date; end: Date; todayStart: Date; now: Date; prevStart: Date }

export function kstMonthRange(month?: string | null, now = new Date()): KstRange {
  const k = new Date(now.getTime() + KST_MS);
  let y = k.getUTCFullYear(), m = k.getUTCMonth() + 1;
  const mm = /^(\d{4})-(\d{2})$/.exec(String(month ?? "").trim());
  if (mm && Number(mm[2]) >= 1 && Number(mm[2]) <= 12) { y = Number(mm[1]); m = Number(mm[2]); }
  const start = new Date(Date.UTC(y, m - 1, 1) - KST_MS);
  const end = new Date(Date.UTC(y, m, 1) - KST_MS);
  const prevStart = new Date(Date.UTC(y, m - 2, 1) - KST_MS);
  const todayStart = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_MS);
  return { month: `${y}-${String(m).padStart(2, "0")}`, start, end, todayStart, now, prevStart };
}

/** ISO 문자열 바인딩 → timestamp(UTC) 비교식. */
export const ts = (d: Date): SQL => sql`(${d.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;
/** `col` 이 [start, end) 안인가. */
export const within = (col: SQL, r: { start: Date; end: Date }): SQL => sql`(${col} >= ${ts(r.start)} AND ${col} < ${ts(r.end)})`;

/** 목록 페이징(운영 표 · 계약 §2.4 «page·total 을 같이»). page 는 1부터 · 기본 50행 · 최대 200. */
export function pageOf(url: URL, defaultSize = 50): { page: number; size: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(url.searchParams.get("page") || 1)) || 1);
  const size = Math.min(200, Math.max(1, Math.floor(Number(url.searchParams.get("size") || defaultSize)) || defaultSize));
  return { page, size, offset: (page - 1) * size };
}
