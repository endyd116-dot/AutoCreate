/**
 * lib/cron/billing-charge.ts — 스텝 `billing.charge`(계약 §1.2 · DESIGN §12.2). hourly 우산 · **KST 09:00** 1회(테스트: settings.billingHour).
 *   AM 원본: ../AutoMarketing/lib/billing.ts runMonthlyBilling(§154) 의 순회 규칙만(정기·재시도 통합 1패스) — 상태 갱신은 전부 `applyChargeResult` 한 벌.
 *
 *   ══ 한 테넌트에서 하는 일(순서) ══
 *     ① 해지 예약(cancel_at_period_end) + 기간 끝 → tenants.status 'cancelled'(빌키 유지 · 재구독 가능) — 청구 없음.
 *     ② 정기 청구: active · 유료 플랜 · next_billing_at ≤ now → 새 주기 청구(pending_plan_key 있으면 그 플랜·주기로 · applyChargeResult 가 반영).
 *     ③ 재시도: fail_count > 0 · next_billing_at(=next_retry_at) ≤ now → 같은 period 로 attempt+1(dunning 사다리 · 3회째 정지는 applyChargeResult).
 *     ④ 정지 뒤 카드 교체 → 자동 재시도 1회(suspended · 새 빌키가 suspended_at 이후 등록).
 *     ⑤ 연납 포함분: 활성 연납 테넌트는 매달 `included:{tid}:{YYYY-MM}` 지급(청구 없이 · 멱등).
 *   KICC 없으면 chargeTenant 가 notConfigured 로 돌아온다 — 세고 넘어간다(상태 무접촉 · «결제 준비 중» 정직).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { grantIncluded } from "../coin-ledger";
import { planOf } from "../plans";
import { chargeTenant, kstMonthOf, periodEndOf, quotePlan, readLedger, PAID_PLANS, type Cycle } from "../subscription";
import { applyDuePriceEvents } from "../billing/price-events";
import { hourOf, kstHour, type CronStep, type StepOutcome } from "./base";

export const BILLING_HOUR = 9;
const n = (v: unknown) => Number(v || 0);
const periodLabel = (start: Date, cycle: Cycle) => cycle === "year" ? `${kstMonthOf(start)}~${kstMonthOf(periodEndOf(start, "year"))}` : kstMonthOf(start);

export const billingChargeStep: CronStep = {
  key: "billing.charge",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx): Promise<StepOutcome> {
    const want = typeof ctx.raw.billingHour === "string" ? hourOf(ctx.raw.billingHour, BILLING_HOUR) : BILLING_HOUR;
    if (kstHour(ctx.now) !== want) return { changed: 0, skipped: 0, ...(ctx.manual ? { detail: { skippedByHour: `${kstHour(ctx.now)}시 ≠ ${want}시` } } : {}) };
    await applyDuePriceEvents();   // 가격 개정 게이트: 적용일이 지난 개정을 표시가에 반영(멱등 · 청구 전)
    const [t] = await q(sql`SELECT status, plan_key, suspended_at FROM tenants WHERE id = ${ctx.tid}`);
    const l = await readLedger(ctx.tid);
    if (!t || !l) return { changed: 0, skipped: 0 };
    const status = String(t.status), planKey = String(t.plan_key);
    const now = ctx.now.getTime();
    const detail: Record<string, unknown> = {};
    let changed = 0;

    // ① 해지 예약 도래
    if (status === "active" && l.cancelAtPeriodEnd && l.periodEnd && l.periodEnd.getTime() <= now) {
      await q(sql`UPDATE tenants SET status = 'cancelled', updated_at = NOW() WHERE id = ${ctx.tid}`);
      await q(sql`UPDATE subscriptions SET status = 'cancelled', next_billing_at = NULL, updated_at = NOW() WHERE tenant_id = ${ctx.tid}`);
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${ctx.tid}, ${"subscription_cancelled"}, ${"구독이 끝났어요"}, ${"요청하신 대로 이번 주기까지 쓰고 끝냈어요. 다시 시작하려면 요금제를 고르면 돼요(카드는 그대로 있어요)."}, ${"/app/plan.html"})`);
      await writeAudit({ tenantId: ctx.tid, action: "subscription_cancelled", actorType: "system", detail: { periodEnd: l.periodEnd.toISOString() } });
      return { changed: 1, skipped: 0, detail: { cancelled: true } };
    }

    // ⑤ 연납 포함분(매달) — 청구와 무관하게 먼저.
    if (status === "active" && l.cycle === "year" && PAID_PLANS.has(planKey)) {
      const plan = await planOf(planKey);
      const g = await grantIncluded(ctx.tid, plan.limits.coinsIncluded, kstMonthOf(ctx.now));
      if (g.granted) { changed++; detail.yearlyIncluded = g.granted; }
    }

    // ④ 정지 뒤 새 카드 → 1회 자동 재시도
    if (status === "suspended" && t.suspended_at) {
      const [newKey] = await q(sql`SELECT id FROM billing_keys WHERE tenant_id = ${ctx.tid} AND active = true AND removed_at IS NULL AND created_at > ${String(t.suspended_at)}::timestamp LIMIT 1`);
      if (newKey && PAID_PLANS.has(planKey)) {
        const start = ctx.now; const cycle = l.cycle;
        const quote = await quotePlan(ctx.tid, planKey, cycle, l, ctx.now);
        const r = await chargeTenant(ctx.tid, { planKey, cycle, period: periodLabel(start, cycle), supplyKrw: quote.supplyKrw, attempt: 1, source: "cron", periodStart: start });
        detail.resumeAfterSuspend = r.ok ? "paid" : r.notConfigured ? "not_configured" : "failed";
        if (r.ok) changed++;
      }
      return { changed, skipped: 0, detail };
    }
    if (status !== "active" || !PAID_PLANS.has(planKey)) return { changed, skipped: 0, ...(Object.keys(detail).length ? { detail } : {}) };

    // ②③ 청구 도래(정기 또는 재시도)
    if (l.nextBillingAt && l.nextBillingAt.getTime() <= now) {
      const retry = l.failCount > 0;
      const nextPlan = (!retry && l.pendingPlanKey && PAID_PLANS.has(l.pendingPlanKey)) ? l.pendingPlanKey : planKey;
      const nextCycle: Cycle = (!retry && l.pendingCycle) ? l.pendingCycle : l.cycle;
      // 새 주기 시작 = 지난 주기 끝(정기) · 재시도는 원래 주기 그대로(period 라벨도 그대로).
      const start = retry ? (l.periodStart ?? ctx.now) : (l.periodEnd ?? ctx.now);
      const quote = await quotePlan(ctx.tid, nextPlan, nextCycle, l, ctx.now);
      const r = await chargeTenant(ctx.tid, { planKey: nextPlan, cycle: nextCycle, period: periodLabel(start, nextCycle), supplyKrw: quote.supplyKrw, attempt: retry ? l.failCount + 1 : 1, source: "cron", periodStart: start });
      if (r.notConfigured) { detail.charge = "not_configured"; return { changed, skipped: 1, detail }; }
      if (r.noBillingKey) {
        detail.charge = "no_billing_key";
        // 카드 없는 활성 구독(사각) — 3일 지나면 정지(AM G3 봉합).
        const [miss] = await q(sql`SELECT billing_key_missing_at FROM subscriptions WHERE tenant_id = ${ctx.tid}`);
        const since = miss?.billing_key_missing_at ? Date.parse(String(miss.billing_key_missing_at).replace(" ", "T") + "Z") : NaN;
        if (Number.isFinite(since) && now - since > 3 * 86400_000) {
          await q(sql`UPDATE tenants SET status = 'suspended', suspended_at = NOW(), updated_at = NOW() WHERE id = ${ctx.tid} AND status = 'active'`);
          await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${ctx.tid}, ${"billing_suspended"}, ${"결제 수단이 없어 잠시 멈췄어요"}, ${"카드를 등록하면 바로 다시 시작돼요."}, ${"/app/plan.html"})`);
          await writeAudit({ tenantId: ctx.tid, action: "subscription_suspended_no_key", actorType: "system", riskLevel: "medium", detail: { since: new Date(since).toISOString() } });
          detail.suspendedNoKey = true; changed++;
        } else if (!Number.isFinite(since)) {
          await q(sql`UPDATE subscriptions SET billing_key_missing_at = NOW(), updated_at = NOW() WHERE tenant_id = ${ctx.tid}`);
        }
        return { changed, skipped: 0, detail };
      }
      changed++;
      detail.charge = r.ok ? "paid" : r.suspended ? "suspended" : "failed";
      detail.attempt = retry ? l.failCount + 1 : 1;
      if (r.includedGranted) detail.included = r.includedGranted;
    }
    return { changed, skipped: 0, ...(Object.keys(detail).length ? { detail } : {}) };
  },
};
void n;
