/**
 * lib/plans.ts — 구독 플랜 정본(코드 기본값) + 체험 정책. DB `plans` 표가 있으면 DB가 이긴다(운영센터 «요금제»에서 편집 · DESIGN §11.4).
 *   DESIGN §12.2(Q2 가정) · §12.3 체험 14일·코인 무료 X.
 */
import { db } from "../db/index";
import { sql } from "drizzle-orm";
import { TEXT_CHANNELS } from "./accounts";   // [P1R7 §3.2] 채널 정본은 lib/accounts 하나 — 게이트가 목록을 두 벌 갖지 않는다(순환 0: accounts 는 plans 를 보지 않는다)

export interface PlanLimits { maxAccounts: number; coinsIncluded: number; runnerDevices: number; teamSeats: number; horizonDays: number; maxRules: number | null;
  /** [P1R7 §3.2] 이 요금제가 **새로 연결**할 수 있는 채널(설계 §12.2 · 사장님 결정 3). 없으면 코드 기본값 → 그것도 없으면 제한 없음.
   *  🔴 소급 금지: 이미 연결한 계정에는 쓰지 않는다(`requireChannel` 은 «새로 추가·계정 없는 발행»에서만). */
  channels?: string[] }
export interface PlanFeatures { directorEdit: boolean; autoSchedule: boolean; failover: boolean; managedRunner: "no" | "option" | "included"; runnerRevenue: boolean; teamApproval: boolean;
  /** [P1R7 B3] «조용하면 그대로 발행»(DESIGN §5B.9 · Starter 제외). 라이브 plans 행엔 없는 키라 `autoApproveAllowed` 가 코드 기본값으로 메운다. */
  autoApprove?: boolean;
  /** [P1R7 §3.2] 리포트 내보내기(ZIP) — 설계 §12.2 Agency 열. 라이브 plans 행엔 없는 키라 `featureOf` 가 코드 기본값으로 메운다. */
  exportZip?: boolean }
export interface PlanDef { key: string; name: string; priceMonth: number; priceYear: number; limits: PlanLimits; features: PlanFeatures; public: boolean; recommended: boolean; sort: number }

export const TRIAL_DAYS_DEFAULT = 14;

/* [P1R7 §3.2 · 사장님 결정 3] 요금제별 채널 — 정본은 여기 한 곳.
 *   Starter = **글 채널 전부 + 쇼츠 1개**(설계 §12.2 «Starter = 글 + 쇼츠») · Pro/Agency = 목록 없음 = 제한 없음.
 *   🔴 레지스트리에 글 채널이 늘어나면 Starter 도 자동으로 늘어난다(`TEXT_CHANNELS` 가 정본 · 목록을 두 벌 적지 않는다).
 *   🔴 체험(trial)은 제한 없음 — 붙여 보고 고르게 한다(고르기 전에 막으면 팔 수 없다). */
export const STARTER_CHANNELS: readonly string[] = [...TEXT_CHANNELS, "youtube_shorts"];

export const PLAN_DEFAULTS: PlanDef[] = [
  { key: "trial", name: "체험", priceMonth: 0, priceYear: 0, public: false, recommended: false, sort: 0,
    limits: { maxAccounts: 5, coinsIncluded: 0, runnerDevices: 1, teamSeats: 1, horizonDays: 14, maxRules: null },
    features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "no", runnerRevenue: true, teamApproval: false, autoApprove: true, exportZip: false } },
  { key: "starter", name: "Starter", priceMonth: 19_000, priceYear: 190_000, public: true, recommended: false, sort: 1,
    limits: { maxAccounts: 3, coinsIncluded: 40, runnerDevices: 1, teamSeats: 1, horizonDays: 7, maxRules: 3, channels: [...STARTER_CHANNELS] },   // [P1R7 §3.2] Starter = 글 + 쇼츠
    features: { directorEdit: false, autoSchedule: true, failover: false, managedRunner: "no", runnerRevenue: false, teamApproval: false, autoApprove: false, exportZip: false } },   // [P1R7 B3] 자동 승인은 Pro 부터(DESIGN §5B.9)
  { key: "pro", name: "Pro", priceMonth: 49_000, priceYear: 490_000, public: true, recommended: true, sort: 2,
    limits: { maxAccounts: 15, coinsIncluded: 150, runnerDevices: 2, teamSeats: 2, horizonDays: 30, maxRules: null },
    features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "option", runnerRevenue: true, teamApproval: false, autoApprove: true, exportZip: false } },
  { key: "agency", name: "Agency", priceMonth: 149_000, priceYear: 1_490_000, public: true, recommended: false, sort: 3,
    limits: { maxAccounts: 50, coinsIncluded: 500, runnerDevices: 5, teamSeats: 5, horizonDays: 30, maxRules: null },
    features: { directorEdit: true, autoSchedule: true, failover: true, managedRunner: "included", runnerRevenue: true, teamApproval: true, autoApprove: true, exportZip: true } },   // [P1R7 §3.2] 내보내기는 Agency 열
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

/** 활성 체험 일수 — 프로모션(trial_days)이 있으면 그 값(운영센터 이벤트). 어떤 이벤트가 적용됐는지(promoId)도 돌려준다(성과 집계 · P1R4 §2.1). */
export async function currentTrialPromo(): Promise<{ days: number; promoId: number | null }> {
  try {
    const rows = await db.execute(sql`SELECT id, config FROM promotions WHERE kind = ${"trial_days"} AND active = true
      AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) ORDER BY created_at DESC LIMIT 1`);
    const r = (rows as unknown as { id?: unknown; config?: { days?: unknown } }[])[0];
    const d = Number(r?.config?.days);
    if (Number.isFinite(d) && d > 0) return { days: Math.min(90, Math.floor(d)), promoId: Number(r?.id) || null };
  } catch { /* graceful */ }
  return { days: TRIAL_DAYS_DEFAULT, promoId: null };
}
export async function currentTrialDays(): Promise<number> { return (await currentTrialPromo()).days; }

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

/**
 * 관리형 러너 월 이용료 — **대당 공급가**(부가세 별도 · §12.0 · 계약 P1R6 §3.1).
 *   🔴 값이 사는 곳은 여기 하나다. 화면·API 에 숫자를 다시 적지 않는다(적는 순간 두 벌이 되어 갈라진다).
 *   features.managedRunner 등급에서 유도한다: option(Pro)=유료 · included(Agency)=요금제에 포함(0원) · no=못 씀.
 *   ⚠️ P1R6 계약은 «플랜 표의 managedRunner 가격을 plans.ts 에서 읽는다»고 했는데 표에 **가격 칸이 없었다** —
 *      칸을 새로 만들면 DB plans 행·화면까지 번지므로, 등급에서 유도하는 상수 한 곳으로 뒀다(메인에 보고).
 */
export const MANAGED_RUNNER_PRICE_KRW = 30_000;
export function managedRunnerUnitKrw(plan: PlanDef): number {
  return plan.features.managedRunner === "option" ? MANAGED_RUNNER_PRICE_KRW : 0;
}

export type FeatureKey = keyof PlanFeatures;
/** 기능형 게이트 — managedRunner 는 "no" 만 막힘(option·included 는 통과). */
export async function requireFeature(tid: number, feature: FeatureKey): Promise<{ ok: true; planKey: string } | { ok: false; planKey: string; res: Response }> {
  const { planKey, plan } = await tenantPlan(tid);
  const v = plan.features[feature];
  /* [P1R7 B3] `autoApprove` 는 라이브 plans 행에 **없는 키**라 `v === true` 로 재면 전 플랜이 막힌다 — 코드 기본값 폴백을 타야 한다. */
  /* [P1R7 §3.2] 그 밖의 키도 **없으면 코드 기본값**으로 판정한다(`featureOf`) — 새 키(exportZip)를 넣을 때마다 라이브 plans 행을 고치지 않게. */
  const ok = feature === "managedRunner" ? v !== "no" : feature === "autoApprove" ? autoApproveAllowed(planKey, plan) : featureOf(plan, feature) === true;
  if (ok) return { ok: true, planKey };
  const label: Record<FeatureKey, string> = { directorEdit: "디렉터 손보기", autoSchedule: "자동 편성", failover: "계정 자동 승계", managedRunner: "관리형 러너", runnerRevenue: "내 PC 수익 수집", teamApproval: "팀 승인 흐름", autoApprove: "«조용하면 발행»(자동 승인)", exportZip: "리포트 내보내기" };
  const upsell = feature === "exportZip" ? "Agency" : "Pro";   // 내보내기는 Agency 열(설계 §12.2) — «Pro 로 바꾸면» 은 거짓말이 된다
  return { ok: false, planKey, res: json({ ok: false, reason: "plan_limit", step: "plan_feature", feature, planKey, error: `${label[feature]}은(는) 지금 요금제에 없어요. ${upsell} 로 바꾸면 쓸 수 있어요.` }, 402) };
}
/**
 * [P1R7 B3] 자동 승인(«조용하면 그대로 발행» · DESIGN §5B.9 «Pro = … 자동 승인»)을 이 플랜이 쓸 수 있나.
 *   🔴 라이브 `plans.features` 는 Phase 0 시드 그대로라 이 키가 **없다** — 없으면 코드 기본값(`PLAN_DEFAULTS`)으로 판정한다(AC-6 «모양이 다르면 코드가 정본»).
 *      그래서 DDL·라이브 UPDATE 0 으로 오늘부터 맞게 돈다. 운영자가 나중에 값을 넣으면 그 값이 이긴다.
 *   🔴 모르는 플랜 키(운영자가 새로 만든 플랜)는 **허용** — 모른다고 고객을 막지 않는다(조용한 정지 0).
 */
export function autoApproveAllowed(planKey: string, plan: PlanDef): boolean {
  const v = (plan.features as unknown as Record<string, unknown>).autoApprove;
  if (typeof v === "boolean") return v;
  const def = PLAN_DEFAULTS.find((p) => p.key === planKey);
  const dv = def ? (def.features as unknown as Record<string, unknown>).autoApprove : undefined;
  return typeof dv === "boolean" ? dv : true;
}
/** «첫 발행 전 결제수단 등록» 토글(계약 §1.5 · 플랜 features.requireCardBeforePublish · 기본 false). */
export function requireCardBeforePublish(plan: PlanDef): boolean { return (plan.features as unknown as Record<string, unknown>).requireCardBeforePublish === true; }

/* ═══════════ P1R7 §3.2 — 채널 게이트(사장님 결정 3 · 설계 §12.2) ═══════════
 *   🔴 **소급 금지**: 이미 연결한 계정은 그대로 쓴다. 이 게이트는 «새로 추가»(계정 추가·OAuth 연결)와
 *      «계정 없이 채널만 정해 둔 글의 발행»(lib/cron/publish-port.ts)에서만 묻는다.
 *   🔴 DB `plans` 행에 새 키가 없어도 코드 기본값으로 판정한다(라이브 UPDATE 0 · B3 `autoApproveAllowed` 와 같은 규율).
 */

/** 이 플랜이 새로 연결할 수 있는 채널 — DB 값 > 코드 기본값 > (둘 다 없으면) 제한 없음(null). 빈 배열도 «제한 없음»으로 읽는다(전부 막는 사고 방지). */
export function planChannelsOf(plan: PlanDef): string[] | null {
  const fromDb = plan.limits?.channels;
  if (Array.isArray(fromDb)) return fromDb.length ? fromDb.map(String) : null;
  const def = PLAN_DEFAULTS.find((p) => p.key === plan.key)?.limits.channels;
  return Array.isArray(def) && def.length ? [...def] : null;
}
/** 기능 값 — DB 행에 키가 없으면 코드 기본값 · 모르는 커스텀 플랜이면 **막지 않는다**(조용한 정지 0). */
export function featureOf(plan: PlanDef, key: FeatureKey): boolean | string {
  const v = (plan.features as unknown as Record<string, unknown>)[key];
  if (v !== undefined && v !== null) return v as boolean | string;
  const def = PLAN_DEFAULTS.find((p) => p.key === plan.key);
  if (!def) return true;
  const dv = (def.features as unknown as Record<string, unknown>)[key];
  return dv === undefined || dv === null ? true : dv as boolean | string;
}

export interface ChannelGate { ok: boolean; planKey: string; allowed: string[] | null; res?: Response }
/**
 * requireChannel(tid, channel, label?) — 이 요금제로 이 채널을 **새로** 연결/발행해도 되나.
 *   막히면 402 `{ reason:"plan_limit", step:"plan_channel", channel, allowed, planKey, error }`(A 의 업셀 시트가 읽는 모양).
 *   조회 실패는 통과(보조 게이트 · plans.ts 규율).
 */
export async function requireChannel(tid: number, channel: string, label?: string): Promise<ChannelGate> {
  let planKey = "trial"; let allowed: string[] | null = null;
  try {
    const { planKey: k, plan } = await tenantPlan(tid);
    planKey = k; allowed = planChannelsOf(plan);
  } catch (e) { console.warn("[plans] requireChannel 조회 실패 — 통과", String((e as Error)?.message ?? e).slice(0, 80)); return { ok: true, planKey, allowed: null }; }
  if (!allowed || allowed.includes(channel)) return { ok: true, planKey, allowed };
  const upsell = planKey === "starter" ? "Pro" : planKey === "pro" ? "Agency" : null;
  const name = label || channel;
  return { ok: false, planKey, allowed,
    res: json({ ok: false, reason: "plan_limit", step: "plan_channel", channel, allowed, planKey,
      error: `이 요금제에서는 ${name}을(를) 새로 연결할 수 없어요.${upsell ? ` ${upsell} 로 바꾸면 쓸 수 있어요.` : ""} 이미 연결한 계정은 그대로 쓸 수 있어요.` }, 402) };
}
