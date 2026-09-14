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

/* ═══════════ P1R4 — 플랜 게이트(계약 §1.4 · §0.1) ═══════════
 *   AM `plan-gate.ts`(1,489줄 · 광고·리드·랜딩 10축)는 **옮기지 않는다** — AC 축은 6개뿐이라 이 두 함수면 된다.
 *   상태형(지금 몇 개 켜져 있나) = accounts·runnerDevices·teamSeats·rules · 상한형 = horizonDays(요청값 ≤ 플랜 최대).
 *   기능형 = PlanFeatures 6 → `requireFeature`. 초과 = 402 `{ ok:false, reason:"plan_limit", used, limit, planKey }` 글자 그대로(A 가 «계정은 3개까지예요 · Pro 로 바꾸면 15개» 시트를 그린다).
 *   ⚠️ 조회 실패는 **통과**(보조 기능 · 돈이 걸린 건 원장이 따로 막는다 · AM 규율) — 단 콘솔에 남긴다. */
import { json } from "./response";

export type LimitResource = "accounts" | "runnerDevices" | "teamSeats" | "rules" | "horizonDays";
export interface LimitCheck { ok: boolean; reason?: "plan_limit"; used: number; limit: number | null; planKey: string; res?: Response }

/** 테넌트의 플랜(정본 tenants.plan_key · trial 도 plans.trial 행). */
export async function tenantPlan(tid: number): Promise<{ planKey: string; plan: PlanDef; status: string }> {
  try {
    const rows = (await db.execute(sql`SELECT plan_key, status FROM tenants WHERE id = ${tid}`)) as unknown as { plan_key: string; status: string }[];
    const key = String(rows[0]?.plan_key ?? "trial");
    return { planKey: key, plan: await planOf(key), status: String(rows[0]?.status ?? "trial") };
  } catch { return { planKey: "trial", plan: PLAN_DEFAULTS[0], status: "trial" }; }
}

/**
 * checkLimit(tid, resource, requested?) — 상태형은 «지금 개수 + 1»이 한도를 넘나, horizonDays 는 요청값이 최대를 넘나.
 *   `res` 가 실려 오면 그대로 반환하면 된다: `const c = await checkLimit(tid, "accounts"); if (!c.ok) return c.res;`
 */
export async function checkLimit(tid: number, resource: LimitResource, requested?: number): Promise<LimitCheck> {
  const { planKey, plan } = await tenantPlan(tid);
  const L = plan.limits;
  let used = 0; let limit: number | null = null; let label = "";
  try {
    switch (resource) {
      case "accounts": { const r = (await db.execute(sql`SELECT COUNT(*)::int AS c FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`)) as unknown as { c: number }[]; used = Number(r[0]?.c ?? 0); limit = L.maxAccounts; label = "계정"; break; }
      case "runnerDevices": { const r = (await db.execute(sql`SELECT COUNT(*)::int AS c FROM runner_devices WHERE tenant_id = ${tid}`)) as unknown as { c: number }[]; used = Number(r[0]?.c ?? 0); limit = L.runnerDevices; label = "내 PC 러너"; break; }
      case "teamSeats": { const r = (await db.execute(sql`SELECT COUNT(*)::int AS c FROM users WHERE tenant_id = ${tid}`)) as unknown as { c: number }[]; used = Number(r[0]?.c ?? 0); limit = L.teamSeats; label = "팀원"; break; }
      case "rules": { const r = (await db.execute(sql`SELECT COUNT(*)::int AS c FROM cadence_rules WHERE tenant_id = ${tid} AND active = true`)) as unknown as { c: number }[]; used = Number(r[0]?.c ?? 0); limit = L.maxRules; label = "편성 규칙"; break; }
      case "horizonDays": { used = Math.max(0, Math.floor(Number(requested) || 0)); limit = L.horizonDays; label = "달력 기간(일)"; break; }
    }
  } catch (e) { console.warn("[plans] checkLimit 조회 실패 — 통과", resource, String((e as Error)?.message ?? e).slice(0, 80)); return { ok: true, used: 0, limit: null, planKey }; }
  const over = limit !== null && (resource === "horizonDays" ? used > limit : used >= limit);
  if (!over) return { ok: true, used, limit, planKey };
  const upsell = planKey === "starter" ? "Pro" : planKey === "pro" ? "Agency" : null;
  const error = resource === "horizonDays" ? `이 요금제에서는 달력을 ${limit}일까지만 미리 채울 수 있어요.` : `${label}은(는) ${limit}개까지예요.${upsell ? ` ${upsell} 로 바꾸면 더 늘어나요.` : ""}`;
  return { ok: false, reason: "plan_limit", used, limit, planKey, res: json({ ok: false, reason: "plan_limit", step: "plan_limit", resource, used, limit, planKey, error }, 402) };
}

export type FeatureKey = keyof PlanFeatures;
/** 기능형 게이트 — managedRunner 는 "no" 만 막힘(option·included 는 통과). */
export async function requireFeature(tid: number, feature: FeatureKey): Promise<{ ok: true; planKey: string } | { ok: false; planKey: string; res: Response }> {
  const { planKey, plan } = await tenantPlan(tid);
  const v = plan.features[feature];
  const ok = feature === "managedRunner" ? v !== "no" : v === true;
  if (ok) return { ok: true, planKey };
  const label: Record<FeatureKey, string> = { directorEdit: "디렉터 손보기", autoSchedule: "자동 편성", failover: "계정 자동 승계", managedRunner: "관리형 러너", runnerRevenue: "내 PC 수익 수집", teamApproval: "팀 승인 흐름" };
  return { ok: false, planKey, res: json({ ok: false, reason: "plan_limit", step: "plan_feature", feature, planKey, error: `${label[feature]}은(는) 지금 요금제에 없어요. Pro 로 바꾸면 쓸 수 있어요.` }, 402) };
}
/** «첫 발행 전 결제수단 등록» 토글(계약 §1.5 · 플랜 features.requireCardBeforePublish · 기본 false). */
export function requireCardBeforePublish(plan: PlanDef): boolean { return (plan.features as unknown as Record<string, unknown>).requireCardBeforePublish === true; }
