/**
 * lib/plans.ts — 구독 플랜 정본(코드 기본값) + 체험 정책. DB `plans` 표가 있으면 DB가 이긴다(운영센터 «요금제»에서 편집 · DESIGN §11.4).
 *   DESIGN §12.2(Q2 가정) · §12.3 체험 14일·코인 무료 X.
 */
import { db } from "../db/index";
import { sql } from "drizzle-orm";

export interface PlanLimits { maxAccounts: number; coinsIncluded: number; runnerDevices: number; teamSeats: number; horizonDays: number; maxRules: number | null }
export interface PlanFeatures { directorEdit: boolean; autoSchedule: boolean; failover: boolean; managedRunner: "no" | "option" | "included"; runnerRevenue: boolean; teamApproval: boolean }
export interface PlanDef { key: string; name: string; priceMonth: number; priceYear: number; limits: PlanLimits; features: PlanFeatures; public: boolean; recommended: boolean; sort: number }

export const TRIAL_DAYS_DEFAULT = 14;

export const PLAN_DEFAULTS: PlanDef[] = [
  { key: "trial", name: "체험", priceMonth: 0, priceYear: 0, public: false, recommended: false, sort: 0,
    limits: { maxAccounts: 5, coinsIncluded: 0, runnerDevices: 1, teamSeats: 1, horizonDays: 14, maxRules: null },
    features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "no", runnerRevenue: true, teamApproval: false } },
  { key: "starter", name: "Starter", priceMonth: 19_000, priceYear: 190_000, public: true, recommended: false, sort: 1,
    limits: { maxAccounts: 3, coinsIncluded: 40, runnerDevices: 1, teamSeats: 1, horizonDays: 7, maxRules: 3 },
    features: { directorEdit: false, autoSchedule: true, failover: false, managedRunner: "no", runnerRevenue: false, teamApproval: false } },
  { key: "pro", name: "Pro", priceMonth: 49_000, priceYear: 490_000, public: true, recommended: true, sort: 2,
    limits: { maxAccounts: 15, coinsIncluded: 150, runnerDevices: 2, teamSeats: 2, horizonDays: 30, maxRules: null },
    features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "option", runnerRevenue: true, teamApproval: false } },
  { key: "agency", name: "Agency", priceMonth: 149_000, priceYear: 1_490_000, public: true, recommended: false, sort: 3,
    limits: { maxAccounts: 50, coinsIncluded: 500, runnerDevices: 5, teamSeats: 5, horizonDays: 30, maxRules: null },
    features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "included", runnerRevenue: true, teamApproval: true } },
];

type PlanRow = { key: string; name: string; price_month: unknown; price_year: unknown; limits: PlanLimits; features: PlanFeatures; public: unknown; recommended: unknown; sort: unknown };

/** DB 우선 · 없으면 코드 기본값(graceful). */
export async function loadPlans(): Promise<PlanDef[]> {
  try {
    const rows = await db.execute(sql`SELECT key, name, price_month, price_year, limits, features, public, recommended, sort FROM plans ORDER BY sort`);
    const list = rows as unknown as PlanRow[];
    if (list.length) return list.map((r) => ({
      key: r.key, name: r.name, priceMonth: Number(r.price_month), priceYear: Number(r.price_year),
      limits: r.limits, features: r.features, public: !!r.public, recommended: !!r.recommended, sort: Number(r.sort),
    }));
  } catch (err) { console.warn("[plans] DB 읽기 실패 — 코드 기본값", err); }
  return PLAN_DEFAULTS;
}
export async function planOf(key: string): Promise<PlanDef> {
  const all = await loadPlans();
  return all.find((p) => p.key === key) || PLAN_DEFAULTS.find((p) => p.key === key) || PLAN_DEFAULTS[0];
}

/** 활성 체험 일수 — 프로모션(trial_days)이 있으면 그 값(운영센터 이벤트). */
export async function currentTrialDays(): Promise<number> {
  try {
    const rows = await db.execute(sql`SELECT config FROM promotions WHERE kind = ${"trial_days"} AND active = true
      AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) ORDER BY created_at DESC LIMIT 1`);
    const r = (rows as unknown as { config?: { days?: unknown } }[])[0];
    const d = Number(r?.config?.days);
    if (Number.isFinite(d) && d > 0) return d;
  } catch { /* graceful */ }
  return TRIAL_DAYS_DEFAULT;
}
