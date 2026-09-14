/**
 * lib/revenue/aggregate.ts — 수익 집계 한 벌(계약 §1.4·§1.4b(5)·§1.4c · DESIGN §9.3). `revenue-summary`·`revenue-daily`·`home-summary` 가 같은 식을 쓴다.
 *   🔴 KST: `day` 는 KST 날짜 칸이다 — «오늘»·«이번 달»·«어제» 경계는 SQL `(NOW() AT TIME ZONE 'Asia/Seoul')::date` 로 만든다(PITFALLS #4 · §0).
 *   🔴 오늘 확정/예상은 **합치지 않는다**(§1.4 v3.2): confirmed = CONFIRMED_SOURCES 의 오늘치 · estimated = 나머지(adpost·adfit·clip·youtube)의 오늘치.
 *   🔴 `days[]` 는 **행이 있는 날만**(0원도 행이면 싣는다 = 수집됐고 0원) · 행이 없는 날은 키가 없다 = «수집 안 됨»(§1.4c · AC-9).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { utcDate } from "../db-util";
import { CONFIRMED_SOURCES, type Freshness } from "./types";

const n = (v: unknown) => Number(v || 0);
/** 확정 소스 목록을 SQL 인라인 리스트로 — 배열 파라미터(`ANY($1::text[])`)는 드리즐→postgres-js 경로에서 42846(cannot cast)로 죽는다(2026-09-14 실측). */
const CONFIRMED_IN = sql.join([...CONFIRMED_SOURCES].map((x) => sql`${x}`), sql`, `);
const kstToday = sql`(NOW() AT TIME ZONE 'Asia/Seoul')::date`;

export interface RevenueSummary {
  monthKrw: number; todayConfirmedKrw: number; todayEstimatedKrw: number; prevMonthKrw: number;
  bySource: { source: string; krw: number; freshness: Freshness; lastSyncAt?: string }[];
  byAccount: { accountId: number; handle: string; channel: string; krw: number }[];
  topPieces: { pieceId: number; title: string; channel: string; krw: number }[];
}
export interface HomeRevenue { todayConfirmedKrw: number; todayEstimatedKrw: number; yesterdayKrw: number; monthKrw: number }

/** month 'YYYY-MM' → 그 달 1일(KST 날짜 문자열). 형식이 틀리면 이번 달. */
export function monthStart(month: string | null | undefined): string | null {
  return /^\d{4}-\d{2}$/.test(String(month ?? "")) ? `${month}-01` : null;
}

/** 홈 큰 숫자 4개(§1.4b(5)) — 오늘 확정·오늘 예상·어제 전체·이번 달. */
export async function homeRevenue(tid: number): Promise<HomeRevenue> {
  const [r] = await q(sql`SELECT
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND source IN (${CONFIRMED_IN})), 0) AS today_confirmed,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND NOT (source IN (${CONFIRMED_IN}))), 0) AS today_estimated,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} - 1), 0) AS yesterday,
      COALESCE(SUM(amount_krw) FILTER (WHERE day >= date_trunc('month', ${kstToday})::date), 0) AS month
    FROM revenue_daily WHERE tenant_id = ${tid} AND day >= date_trunc('month', ${kstToday})::date - 1`);
  return { todayConfirmedKrw: n(r?.today_confirmed), todayEstimatedKrw: n(r?.today_estimated), yesterdayKrw: n(r?.yesterday), monthKrw: n(r?.month) };
}

/** 수익 탭 상단~TOP5(§1.4). month 가 없으면 이번 달(KST). */
export async function summary(tid: number, month?: string | null): Promise<RevenueSummary> {
  const ms = monthStart(month);
  const start = ms ? sql`${ms}::date` : sql`date_trunc('month', ${kstToday})::date`;
  const [tot] = await q(sql`SELECT
      COALESCE(SUM(amount_krw) FILTER (WHERE day >= ${start} AND day < (${start} + interval '1 month')::date), 0) AS month,
      COALESCE(SUM(amount_krw) FILTER (WHERE day >= (${start} - interval '1 month')::date AND day < ${start}), 0) AS prev,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND source IN (${CONFIRMED_IN})), 0) AS today_confirmed,
      COALESCE(SUM(amount_krw) FILTER (WHERE day = ${kstToday} AND NOT (source IN (${CONFIRMED_IN}))), 0) AS today_estimated
    FROM revenue_daily WHERE tenant_id = ${tid} AND day >= (${start} - interval '1 month')::date`);
  const bySrc = await q(sql`SELECT d.source, COALESCE(SUM(d.amount_krw),0) AS krw, MAX(d.freshness) AS freshness, MAX(d.updated_at) AS last_upd,
      (SELECT MAX(s.last_ok_at) FROM revenue_sources s WHERE s.tenant_id = d.tenant_id AND s.source = d.source) AS last_ok
    FROM revenue_daily d WHERE d.tenant_id = ${tid} AND d.day >= ${start} AND d.day < (${start} + interval '1 month')::date
    GROUP BY d.tenant_id, d.source ORDER BY krw DESC`);
  const byAcc = await q(sql`SELECT d.account_id, a.handle, a.channel, COALESCE(SUM(d.amount_krw),0) AS krw
    FROM revenue_daily d JOIN accounts a ON a.id = d.account_id AND a.tenant_id = d.tenant_id
    WHERE d.tenant_id = ${tid} AND d.account_id IS NOT NULL AND d.day >= ${start} AND d.day < (${start} + interval '1 month')::date
    GROUP BY d.account_id, a.handle, a.channel ORDER BY krw DESC LIMIT 20`);
  const top = await q(sql`SELECT d.piece_id, p.title, p.channel, COALESCE(SUM(d.amount_krw),0) AS krw
    FROM revenue_daily d JOIN pieces p ON p.id = d.piece_id AND p.tenant_id = d.tenant_id
    WHERE d.tenant_id = ${tid} AND d.piece_id IS NOT NULL AND d.day >= ${start} AND d.day < (${start} + interval '1 month')::date
    GROUP BY d.piece_id, p.title, p.channel ORDER BY krw DESC LIMIT 5`);
  return {
    monthKrw: n(tot?.month), prevMonthKrw: n(tot?.prev), todayConfirmedKrw: n(tot?.today_confirmed), todayEstimatedKrw: n(tot?.today_estimated),
    bySource: bySrc.map((r) => {
      const o: RevenueSummary["bySource"][number] = { source: String(r.source), krw: n(r.krw), freshness: (["api", "runner", "manual"].includes(String(r.freshness)) ? String(r.freshness) : "api") as Freshness };
      const at = utcDate(r.last_ok) ?? utcDate(r.last_upd); if (at) o.lastSyncAt = at.toISOString();
      return o;
    }),
    byAccount: byAcc.map((r) => ({ accountId: n(r.account_id), handle: String(r.handle), channel: String(r.channel), krw: n(r.krw) })),
    topPieces: top.map((r) => ({ pieceId: n(r.piece_id), title: String(r.title || ""), channel: String(r.channel), krw: n(r.krw) })),
  };
}

/** 일별 막대(§1.4c). 행이 있는 날만 — 0원도 행이면 싣는다 · 없는 날은 키 없음(«수집 안 됨»). */
export async function daily(tid: number, from: string, to: string): Promise<{ day: string; krw: number; freshness: Freshness }[]> {
  const rows = await q(sql`SELECT day::text AS d, COALESCE(SUM(amount_krw),0) AS krw,
      CASE WHEN COUNT(DISTINCT freshness) = 1 THEN MAX(freshness) ELSE 'api' END AS freshness
    FROM revenue_daily WHERE tenant_id = ${tid} AND day >= ${from}::date AND day <= ${to}::date GROUP BY day ORDER BY day`);
  return rows.map((r) => ({ day: String(r.d).slice(0, 10), krw: n(r.krw), freshness: (["api", "runner", "manual"].includes(String(r.freshness)) ? String(r.freshness) : "api") as Freshness }));
}

/**
 * 최근 30일 piece 수익(학습 되먹임 §1.6 재료). 표본 수(수익 행 수)도 같이 준다 — 5건 미만이면 호출부가 팩터를 건드리지 않는다.
 */
export async function pieceRevenue30d(tid: number): Promise<Map<number, { krw: number; samples: number }>> {
  const rows = await q(sql`SELECT piece_id, COALESCE(SUM(amount_krw),0) AS krw, COUNT(*)::int AS samples FROM revenue_daily
    WHERE tenant_id = ${tid} AND piece_id IS NOT NULL AND day >= ${kstToday} - 30 GROUP BY piece_id`);
  return new Map(rows.map((r) => [n(r.piece_id), { krw: n(r.krw), samples: n(r.samples) }]));
}
