/**
 * lib/subscription.ts — 구독 상태 갱신 **한 벌**(계약 §5 · §1.2 · §0.1 · DESIGN §12.2·§12.0).
 *   AM 원본: ../AutoMarketing/lib/billing.ts(runMonthlyBilling·chargeTenantNow·activateSubscription §154~1062 · 1,323줄) 의 «청구 성공/실패 뒤 상태 갱신»
 *   부분만 `applyChargeResult()` 한 함수로 접어 이식(2026-09-14). 크론·콜백·운영 재시도·플랜 변경이 전부 이것만 부른다.
 *
 *   ══ 정본(§0.1) ══
 *     `tenants.status / plan_key / trial_ends_at` 가 정본 · `subscriptions` 는 결제 주기 **장부**(테넌트당 1행 · cycle·period·next_billing_at·
 *     billing_day·pending_plan_key·cancel_at_period_end·discount·price_locked·fail_count). 두 곳이 어긋나면 tenants 가 이긴다 —
 *     그래서 둘 다 여기서만 쓴다.
 *   ══ 돈(§12.0 부가세 별도) ══
 *     표시가 = 공급가(plans.price_month · 연납 = price_year = 월×10). 청구 = 공급가 + `vatOf`. 응답엔 amountKrw·vatKrw·totalKrw 를 **따로** 싣는다.
 *     가격 우선순위: `price_locked_krw`(가입 시점 고정) > 개정 이벤트(effective_at 지난 것 · plan_price_events) > plans 현재가. 할인은 그 뒤에.
 *   ══ 청구 성공 ══ invoice paid(kind subscription · period) → tenants.status active + plan_key(예약 변경 반영) → 장부 period·next_billing_at →
 *     **included 지급**(`grantIncluded` · 월말 만료) → 감사 `billing_attempt`. 연납은 12개월치 포함분을 **매달** 준다(크론이 월별 ref 로 · 청구는 1년에 1번).
 *   ══ 청구 실패 ══ invoice failed + attempts + `dunningSchedule` → next_retry_at · **3회 → tenants.status suspended + 알림 + 자동 티켓**(계약 §1.2).
 *   ⚠️ AM `operators`(테넌트 관리자) → AC `users role='owner'` — 전수 손으로(§0.1). 이 파일은 cron·publish 를 import 하지 않는다(AC-17).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { vatOf, subscriptionAfterDiscount, prorateUpgradeSupply, dunningSchedule } from "./billing-math";
import { grantIncluded } from "./coin-ledger";
import { createTicket } from "./cs";
import { pendingKrwCoupon, markCouponConverted, validateCoupon } from "./billing/promotions";
import { rewardReferralOnPaid } from "./referral";
import { jsonb, utcDate } from "./db-util";
import { planOf, loadPlans, type PlanDef } from "./plans";

const n = (v: unknown) => Number(v || 0);
const KST_MS = 9 * 3600_000;
export type Cycle = "month" | "year";
/** 코드 기본 유료 플랜(폴백). 🔴 판정은 `isPaidPlan()`(DB 플랜 포함 — 운영센터가 만든 플랜도 결제 대상) — 이 상수를 직접 쓰지 않는다. */
export const PAID_PLANS: ReadonlySet<string> = new Set(["starter", "pro", "agency"]);
/** 유료 플랜인가 = plans(DB 우선·코드 폴백)에 있고 trial 이 아니다. */
export async function isPaidPlan(planKey: string): Promise<boolean> {
  const key = String(planKey ?? ""); if (!key || key === "trial") return false;
  const plans = await loadPlans();
  return plans.some((p) => p.key === key);
}
export async function paidPlanKeys(): Promise<string[]> { return (await loadPlans()).map((p) => p.key).filter((k) => k !== "trial"); }
/** 연속 실패 이 횟수면 정지(계약 §1.2 «3회»). dunningSchedule 의 사다리(D+0 → +3일 → +4일)는 그대로 쓰고, 정지 시점만 3회로 당긴다. */
export const SUSPEND_AFTER_FAILS = 3;

/* ───────── KST 날짜 소도구(순수 산술) ───────── */
export function kstMonthOf(d: Date): string { const k = new Date(d.getTime() + KST_MS); return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`; }
/** 주기 끝 = 시작 + 1개월/1년(KST 달력 기준 · 말일 보정). */
export function periodEndOf(start: Date, cycle: Cycle): Date {
  const k = new Date(start.getTime() + KST_MS);
  const y = k.getUTCFullYear(), m = k.getUTCMonth(), d = k.getUTCDate();
  const ny = cycle === "year" ? y + 1 : y, nm = cycle === "year" ? m : m + 1;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last), k.getUTCHours(), k.getUTCMinutes(), k.getUTCSeconds()) - KST_MS);
}
const ts = (d: Date) => sql`${d.toISOString()}::timestamptz AT TIME ZONE 'UTC'`;

/* ───────── 장부 읽기 ───────── */
export interface Ledger {
  tenantId: number; planKey: string; status: string; cycle: Cycle; periodStart: Date | null; periodEnd: Date | null;
  nextBillingAt: Date | null; billingDay: number | null; pendingPlanKey: string | null; pendingCycle: Cycle | null;
  cancelAtPeriodEnd: boolean; discountPct: number; discountUntil: Date | null; priceLockedKrw: number | null;
  failCount: number; lastChargeAt: Date | null; couponCode: string | null;
}
export async function readLedger(tid: number): Promise<Ledger | null> {
  const [r] = await q(sql`SELECT * FROM subscriptions WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 1`);
  if (!r) return null;
  return {
    tenantId: tid, planKey: String(r.plan_key), status: String(r.status), cycle: r.cycle === "year" ? "year" : "month",
    periodStart: utcDate(r.period_start), periodEnd: utcDate(r.period_end), nextBillingAt: utcDate(r.next_billing_at),
    billingDay: r.billing_day ? n(r.billing_day) : null, pendingPlanKey: r.pending_plan_key ? String(r.pending_plan_key) : null,
    pendingCycle: r.pending_cycle === "year" ? "year" : r.pending_cycle === "month" ? "month" : null,
    cancelAtPeriodEnd: r.cancel_at_period_end === true, discountPct: n(r.discount_pct), discountUntil: utcDate(r.discount_until),
    priceLockedKrw: r.price_locked_krw !== null && r.price_locked_krw !== undefined ? n(r.price_locked_krw) : null,
    failCount: n(r.fail_count), lastChargeAt: utcDate(r.last_charge_at), couponCode: r.coupon_code ? String(r.coupon_code) : null,
  };
}
/** 테넌트 대표(users role owner) — AM 의 operators 가 아니다(§0.1). */
export async function tenantOwner(tid: number): Promise<{ name: string; email: string | null }> {
  const [t] = await q(sql`SELECT t.name, (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS email FROM tenants t WHERE t.id = ${tid}`);
  return { name: String(t?.name ?? ""), email: t?.email ? String(t.email) : null };
}
export async function activeBillingKey(tid: number): Promise<{ id: number; billingKey: string; last4: string | null; brand: string | null; pgMid: string | null } | null> {
  const [k] = await q(sql`SELECT id, billing_key, last4, brand, pg_mid FROM billing_keys WHERE tenant_id = ${tid} AND active = true AND removed_at IS NULL ORDER BY id DESC LIMIT 1`);
  // pgMid = 이 빌키를 발급한 MID(§1.6) — 청구·삭제는 이 MID 로만 된다. NULL 인 옛 행은 midOrDefault 가 인증 MID 로 폴백.
  return k ? { id: n(k.id), billingKey: String(k.billing_key), last4: k.last4 ? String(k.last4) : null, brand: k.brand ? String(k.brand) : null, pgMid: k.pg_mid ? String(k.pg_mid) : null } : null;
}

/* ───────── 가격 ───────── */
export interface Quote { planKey: string; cycle: Cycle; baseKrw: number; supplyKrw: number; vatKrw: number; totalKrw: number; discountPct: number; source: "locked" | "price_event" | "plan"; couponCode?: string; couponKrw?: number }
/**
 * 공급가 결정: 고정가 > 개정 이벤트(effective_at 경과) > plans 현재가 → 할인(장부 discount_pct · 쿠폰 pct) → krw 쿠폰 1회 차감 → 부가세. 화면·청구가 같은 함수를 본다.
 *   `opts.previewCoupon` = 아직 적용 안 한 코드를 미리 보기(subscription-quote). 실제 적용은 redeemCoupon(장부) → 여기서는 장부 값을 읽는다.
 */
export async function quotePlan(tid: number, planKey: string, cycle: Cycle, ledger?: Ledger | null, now = new Date(), opts: { previewCoupon?: string | null } = {}): Promise<Quote> {
  const plan = await planOf(planKey);
  const l = ledger === undefined ? await readLedger(tid) : ledger;
  let base = cycle === "year" ? (plan.priceYear || plan.priceMonth * 10) : plan.priceMonth;
  let source: Quote["source"] = "plan";
  if (l && l.priceLockedKrw !== null && l.planKey === planKey && l.cycle === cycle) { base = l.priceLockedKrw; source = "locked"; }
  else {
    // 가격 개정 게이트(계약 §2.1 ops-plans): 고지 뒤 effective_at 이 지난 이벤트만 새 가격으로 — 고지 전엔 옛 가격 그대로.
    const [ev] = await q(sql`SELECT after FROM plan_price_events WHERE plan_key = ${planKey} AND status IN ('noticed','applied')
      AND effective_at IS NOT NULL AND effective_at <= ${ts(now)} ORDER BY effective_at DESC LIMIT 1`);
    const after = (ev?.after && typeof ev.after === "object" ? ev.after : null) as Record<string, unknown> | null;
    const evPrice = after ? n(cycle === "year" ? after.priceYear : after.priceMonth) : 0;
    if (evPrice > 0) { base = evPrice; source = "price_event"; }
  }
  let discountPct = l && l.discountPct > 0 && (!l.discountUntil || l.discountUntil.getTime() > now.getTime()) ? l.discountPct : 0;
  let couponKrw = 0; let couponCode: string | undefined;
  if (opts.previewCoupon) {
    const v = await validateCoupon(tid, opts.previewCoupon, planKey);
    if (v.ok) { couponCode = v.coupon.code; if (v.coupon.kind === "pct") discountPct = Math.max(discountPct, v.coupon.value); else couponKrw = v.coupon.value; }
  } else {
    const pending = await pendingKrwCoupon(tid, l?.couponCode ?? null);
    if (pending) { couponCode = pending.code; couponKrw = pending.krw; }
    else if (l?.couponCode && discountPct > 0) couponCode = l.couponCode;
  }
  const supplyKrw = Math.max(0, subscriptionAfterDiscount(base, discountPct) - couponKrw);
  const vatKrw = vatOf(supplyKrw);
  const qt: Quote = { planKey, cycle, baseKrw: base, supplyKrw, vatKrw, totalKrw: supplyKrw + vatKrw, discountPct, source };
  if (couponCode) qt.couponCode = couponCode;
  if (couponKrw) qt.couponKrw = Math.min(couponKrw, subscriptionAfterDiscount(base, discountPct));
  return qt;
}

/* ───────── 🔴 청구 결과 적용 — 한 벌 ───────── */
export interface ChargeOutcome {
  ok: boolean;
  planKey: string; cycle: Cycle;
  /** 'YYYY-MM'(월납) 또는 'YYYY-MM~YYYY-MM'(연납) — 인보이스 (tenant,kind,period) 유니크 키. */
  period: string;
  supplyKrw: number; vatKrw: number; totalKrw: number;
  orderNo: string; pgTid?: string | null;
  /** 이 청구를 처리한 KICC MID(invoices.pg_mid 로 저장 · 취소가 같은 MID 를 써야 한다 · §1.6). */
  pgMid?: string | null;
  errorCode?: string | null; errorMessage?: string | null; retryable?: boolean;
  /** 이번 실패가 몇 번째인가(1-based). 성공이면 무시. */
  attempt: number;
  source: "cron" | "callback" | "ops" | "change";
  /** 새 주기 시작(성공 시). 없으면 now. 업그레이드 비례 청구는 주기를 바꾸지 않는다(`keepPeriod`). */
  periodStart?: Date; keepPeriod?: boolean;
  actorId?: number | null;
}
export interface ApplyResult { ok: boolean; status: string; planKey: string; invoiceId: number | null; nextBillingAt?: string; includedGranted?: number; suspended?: boolean; error?: string }

export async function applyChargeResult(tid: number, r: ChargeOutcome, now = new Date()): Promise<ApplyResult> {
  const kind = "subscription";
  if (r.ok) {
    const start = r.periodStart ?? now;
    const end = periodEndOf(start, r.cycle);
    // ① 인보이스(멱등 · 같은 period 재승인이면 갱신)
    const [inv] = await q(sql`INSERT INTO invoices (tenant_id, kind, period, amount, vat_krw, total_krw, status, pg_ref, pg_mid, paid_at, order_no, plan_key, attempts, detail)
      VALUES (${tid}, ${kind}, ${r.period}, ${r.supplyKrw}, ${r.vatKrw}, ${r.totalKrw}, ${"paid"}, ${r.pgTid ?? null}, ${r.pgMid ?? null}, ${ts(now)}, ${r.orderNo}, ${r.planKey}, ${Math.max(1, r.attempt)}, ${jsonb({ cycle: r.cycle, source: r.source })})
      ON CONFLICT (tenant_id, kind, period) DO UPDATE SET status = 'paid', amount = EXCLUDED.amount, vat_krw = EXCLUDED.vat_krw, total_krw = EXCLUDED.total_krw,
        pg_ref = EXCLUDED.pg_ref, pg_mid = COALESCE(EXCLUDED.pg_mid, invoices.pg_mid), paid_at = EXCLUDED.paid_at, order_no = EXCLUDED.order_no, plan_key = EXCLUDED.plan_key, last_error = NULL, next_retry_at = NULL, updated_at = NOW()
      RETURNING id`);
    // ② 정본(tenants) — active + 플랜. 체험 끝·readonly·suspended 전부 여기서 풀린다.
    await q(sql`UPDATE tenants SET status = 'active', plan_key = ${r.planKey}, suspended_at = NULL, readonly_at = NULL, updated_at = NOW() WHERE id = ${tid}`);
    // ③ 장부 — 주기·다음 청구·실패 0. 비례 청구(업그레이드)는 주기를 안 바꾼다.
    if (r.keepPeriod) {
      await q(sql`UPDATE subscriptions SET plan_key = ${r.planKey}, status = 'active', fail_count = 0, last_charge_at = ${ts(now)}, billing_key_missing_at = NULL, updated_at = NOW() WHERE tenant_id = ${tid}`);
    } else {
      const billingDay = Math.min(28, new Date(start.getTime() + KST_MS).getUTCDate());
      await q(sql`INSERT INTO subscriptions (tenant_id, plan_key, status, cycle, period_start, period_end, next_billing_at, billing_day, fail_count, last_charge_at, pending_plan_key, pending_cycle, updated_at)
        VALUES (${tid}, ${r.planKey}, ${"active"}, ${r.cycle}, ${ts(start)}, ${ts(end)}, ${ts(end)}, ${billingDay}, 0, ${ts(now)}, NULL, NULL, NOW())
        ON CONFLICT (tenant_id) DO UPDATE SET plan_key = EXCLUDED.plan_key, status = 'active', cycle = EXCLUDED.cycle, period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
          next_billing_at = EXCLUDED.next_billing_at, billing_day = EXCLUDED.billing_day, fail_count = 0, last_charge_at = EXCLUDED.last_charge_at,
          pending_plan_key = NULL, pending_cycle = NULL, billing_key_missing_at = NULL, updated_at = NOW()`);
    }
    // ④ 포함분(월 단위 · 멱등 · 월말 만료). 연납도 «이달» 몫을 지금 주고, 다음 달들은 크론이 월별 ref 로 준다.
    const plan = await planOf(r.planKey);
    const g = await grantIncluded(tid, plan.limits.coinsIncluded, kstMonthOf(now));
    await markCouponConverted(tid, r.orderNo);   // 쿠폰 성과(전환) · krw 쿠폰은 1회 소진
    const referral = await rewardReferralOnPaid(tid, { orderNo: r.orderNo, invoiceId: n(inv?.id) || null, source: `subscription:${r.source}` });   // [P1R6 §1.1] 피추천인 첫 유료 결제 → 양쪽 보상(멱등 · 절대 안 던진다)
    await writeAudit({ tenantId: tid, action: "billing_attempt", actorType: r.source === "ops" ? "operator" : "system", actorId: r.actorId ?? null, target: `invoice:${n(inv?.id)}`,
      detail: { ok: true, source: r.source, planKey: r.planKey, cycle: r.cycle, period: r.period, supplyKrw: r.supplyKrw, vatKrw: r.vatKrw, totalKrw: r.totalKrw, orderNo: r.orderNo, pgTid: r.pgTid ?? null, includedGranted: g.granted, keepPeriod: !!r.keepPeriod, referral: referral.status } });
    return { ok: true, status: "active", planKey: r.planKey, invoiceId: n(inv?.id) || null, nextBillingAt: r.keepPeriod ? undefined : end.toISOString(), includedGranted: g.granted };
  }

  // ── 실패 ──
  const attempt = Math.max(1, Math.floor(r.attempt));
  const d = dunningSchedule(attempt);
  const suspend = attempt >= SUSPEND_AFTER_FAILS || d.notice === "suspend" || r.retryable === false && attempt >= 2;
  const retryAt = !suspend && d.retryDays ? new Date(now.getTime() + d.retryDays * 86400_000) : null;
  const err = String(r.errorMessage || r.errorCode || "결제 실패").slice(0, 300);
  const [inv] = await q(sql`INSERT INTO invoices (tenant_id, kind, period, amount, vat_krw, total_krw, status, order_no, pg_mid, plan_key, attempts, next_retry_at, last_error, detail)
    VALUES (${tid}, ${kind}, ${r.period}, ${r.supplyKrw}, ${r.vatKrw}, ${r.totalKrw}, ${"failed"}, ${r.orderNo}, ${r.pgMid ?? null}, ${r.planKey}, ${attempt}, ${retryAt ? ts(retryAt) : null}, ${err}, ${jsonb({ cycle: r.cycle, source: r.source, errorCode: r.errorCode ?? null })})
    ON CONFLICT (tenant_id, kind, period) DO UPDATE SET status = CASE WHEN invoices.status = 'paid' THEN 'paid' ELSE 'failed' END,
      attempts = ${attempt}, next_retry_at = ${retryAt ? ts(retryAt) : null}, last_error = ${err}, order_no = EXCLUDED.order_no, pg_mid = COALESCE(EXCLUDED.pg_mid, invoices.pg_mid), updated_at = NOW()
    RETURNING id, status`);
  await q(sql`INSERT INTO subscriptions (tenant_id, plan_key, status, cycle, period_start, period_end, next_billing_at, fail_count, updated_at)
    VALUES (${tid}, ${r.planKey}, ${"active"}, ${r.cycle}, ${ts(now)}, ${ts(now)}, ${retryAt ? ts(retryAt) : null}, ${attempt}, NOW())
    ON CONFLICT (tenant_id) DO UPDATE SET fail_count = ${attempt}, next_billing_at = ${retryAt ? ts(retryAt) : sql`subscriptions.next_billing_at`}, updated_at = NOW()`);
  let suspended = false;
  if (suspend) {
    const [t] = await q(sql`UPDATE tenants SET status = 'suspended', suspended_at = NOW(), updated_at = NOW() WHERE id = ${tid} AND status <> 'suspended' RETURNING id`);
    suspended = !!t;
    if (suspended) {
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"billing_suspended"}, ${"결제가 안 되어 잠시 멈췄어요"}, ${`${attempt}번 시도했지만 카드 결제가 되지 않았어요. 결제 수단을 확인하면 바로 다시 시작돼요.`}, ${"/app/plan.html"})`);
      await createTicket({ tenantId: tid, subject: `결제 실패 ${attempt}회 — 구독 정지(${r.period})`, text: `카드 청구가 ${attempt}회 연속 실패해 정지했어요. 마지막 사유: ${err}`, source: "system", priority: "high", tags: ["결제"], autoKey: `billing_fail:${tid}:${r.period}` });
    }
  } else {
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"billing_failed"}, ${"카드 결제가 되지 않았어요"}, ${`${retryAt ? `${d.retryDays}일 뒤에 다시 시도해요.` : "다시 시도해요."} 카드 한도·유효기간을 확인해 주세요. (${err.slice(0, 80)})`}, ${"/app/plan.html"})`);
  }
  await writeAudit({ tenantId: tid, action: "billing_attempt", actorType: r.source === "ops" ? "operator" : "system", actorId: r.actorId ?? null, riskLevel: suspend ? "high" : "medium", target: `invoice:${n(inv?.id)}`,
    detail: { ok: false, source: r.source, planKey: r.planKey, period: r.period, totalKrw: r.totalKrw, orderNo: r.orderNo, attempt, errorCode: r.errorCode ?? null, error: err, retryAt: retryAt?.toISOString() ?? null, suspended } });
  return { ok: false, status: suspended ? "suspended" : "active", planKey: r.planKey, invoiceId: n(inv?.id) || null, suspended, error: err };
}

/* ───────── 청구 실행(KICC) ───────── */
export const orderNoSub = (tid: number, period: string, attempt: number) => `AC-SUB-${period.replace(/[^0-9A-Za-z]/g, "")}-${tid}${attempt > 1 ? `-r${attempt}` : ""}`.slice(0, 40);
export type ChargeTenantResult = ApplyResult & { notConfigured?: boolean; noBillingKey?: boolean; totalKrw?: number };
/**
 * chargeTenant — 빌키로 청구하고 결과를 `applyChargeResult` 에 넘긴다(크론·운영 재시도·플랜 변경 공용).
 *   KICC 키 없으면 **no-op 정직**(`notConfigured`) · 빌키 없으면 `noBillingKey`(장부에 billing_key_missing_at 표시 · 청구 시도 아님).
 */
export async function chargeTenant(tid: number, opts: { planKey: string; cycle: Cycle; period: string; supplyKrw: number; attempt: number; source: ChargeOutcome["source"]; periodStart?: Date; keepPeriod?: boolean; actorId?: number | null; goods?: string }): Promise<ChargeTenantResult> {
  const { isKiccConfigured, chargeWithBillingKey } = await import("./kicc");
  const vatKrw = vatOf(opts.supplyKrw), totalKrw = opts.supplyKrw + vatKrw;
  if (!isKiccConfigured()) return { ok: false, status: "", planKey: opts.planKey, invoiceId: null, notConfigured: true, totalKrw, error: "결제 준비 중이에요 · 곧 열려요" };
  const key = await activeBillingKey(tid);
  if (!key) {
    await q(sql`UPDATE subscriptions SET billing_key_missing_at = COALESCE(billing_key_missing_at, NOW()), updated_at = NOW() WHERE tenant_id = ${tid}`);
    return { ok: false, status: "", planKey: opts.planKey, invoiceId: null, noBillingKey: true, totalKrw, error: "등록된 결제 수단이 없어요." };
  }
  const owner = await tenantOwner(tid);
  const orderNo = orderNoSub(tid, opts.period, opts.attempt);
  const plan = await planOf(opts.planKey);
  // 빌키 청구는 **발급한 MID** 로(KICC 규칙 · §1.6). 상품명은 어댑터가 «AutoCreate » 를 붙인다(명세서 구별).
  const res = await chargeWithBillingKey({ billingKey: key.billingKey, shopOrderNo: orderNo, amount: totalKrw, goodsName: opts.goods ?? `${plan.name} ${opts.cycle === "year" ? "연" : "월"} 구독`, customerName: owner.name, customerEmail: owner.email ?? undefined, mid: key.pgMid });
  const applied = await applyChargeResult(tid, { ok: res.success, planKey: opts.planKey, cycle: opts.cycle, period: opts.period, supplyKrw: opts.supplyKrw, vatKrw, totalKrw, orderNo, pgTid: res.pgTid ?? null, pgMid: res.mallId ?? key.pgMid ?? null,
    errorCode: res.errorCode ?? null, errorMessage: res.errorMessage ?? null, retryable: res.retryable, attempt: opts.attempt, source: opts.source, periodStart: opts.periodStart, keepPeriod: opts.keepPeriod, actorId: opts.actorId });
  return { ...applied, totalKrw };
}

/* ───────── 플랜 변경·해지 ───────── */
export type ChangeResult = { ok: true; effectiveAt: string; pending: boolean; chargeNowKrw?: number; vatKrw?: number; totalKrw?: number; invoiceId?: number | null }
  | { ok: false; step: "plan" | "billing_key" | "not_configured" | "charge" | "same"; error: string; totalKrw?: number };
/**
 * changePlan — 업그레이드 = 즉시 비례 청구(`prorateUpgradeSupply` · 남은 일수) + 즉시 전환 · 다운그레이드 = 다음 주기부터(pending) ·
 *   체험/readonly/suspended 에서 유료 진입 = 지금 한 주기 청구 + 전환. 주기 변경(월↔연)은 다음 주기부터.
 */
export async function changePlan(tid: number, planKey: string, cycle: Cycle, opts: { actorId?: number | null; source?: ChargeOutcome["source"] } = {}, now = new Date()): Promise<ChangeResult> {
  if (!await isPaidPlan(planKey)) return { ok: false, step: "plan", error: "고를 수 있는 요금제가 아니에요." };
  const [t] = await q(sql`SELECT status, plan_key FROM tenants WHERE id = ${tid}`);
  if (!t) return { ok: false, step: "plan", error: "계정을 찾을 수 없어요." };
  const status = String(t.status), curPlan = String(t.plan_key);
  const ledger = await readLedger(tid);
  const plans = await loadPlans();
  const rank = (k: string) => plans.find((p) => p.key === k)?.sort ?? 0;
  const paying = status === "active" && await isPaidPlan(curPlan) && ledger?.periodEnd && ledger.periodEnd.getTime() > now.getTime();

  // ① 유료로 «진입»(체험·readonly·suspended·해지 뒤) — 지금 한 주기 청구.
  if (!paying) {
    const quote = await quotePlan(tid, planKey, cycle, ledger, now);
    const period = cycle === "year" ? `${kstMonthOf(now)}~${kstMonthOf(periodEndOf(now, "year"))}` : kstMonthOf(now);
    const r = await chargeTenant(tid, { planKey, cycle, period, supplyKrw: quote.supplyKrw, attempt: 1, source: opts.source ?? "change", periodStart: now, actorId: opts.actorId });
    if (r.notConfigured) return { ok: false, step: "not_configured", error: r.error ?? "결제 준비 중이에요", totalKrw: quote.totalKrw };
    if (r.noBillingKey) return { ok: false, step: "billing_key", error: "먼저 결제 수단을 등록해 주세요.", totalKrw: quote.totalKrw };
    if (!r.ok) return { ok: false, step: "charge", error: r.error ?? "결제에 실패했어요.", totalKrw: quote.totalKrw };
    return { ok: true, effectiveAt: now.toISOString(), pending: false, chargeNowKrw: quote.supplyKrw, vatKrw: quote.vatKrw, totalKrw: quote.totalKrw, invoiceId: r.invoiceId };
  }
  if (planKey === curPlan && cycle === (ledger?.cycle ?? "month")) return { ok: false, step: "same", error: "지금 쓰는 요금제예요." };

  // ② 다운그레이드 또는 주기 변경 → 다음 주기부터(pending).
  if (rank(planKey) < rank(curPlan) || (planKey === curPlan && cycle !== ledger!.cycle)) {
    await q(sql`UPDATE subscriptions SET pending_plan_key = ${planKey}, pending_cycle = ${cycle}, cancel_at_period_end = false, updated_at = NOW() WHERE tenant_id = ${tid}`);
    await writeAudit({ tenantId: tid, action: "plan_change_scheduled", actorType: "user", actorId: opts.actorId ?? null, detail: { from: curPlan, to: planKey, cycle, effectiveAt: ledger!.periodEnd!.toISOString() } });
    return { ok: true, effectiveAt: ledger!.periodEnd!.toISOString(), pending: true };
  }
  // ③ 업그레이드 → 남은 일수 비례 차액 즉시 청구 + 즉시 전환(주기는 유지).
  const curQuote = await quotePlan(tid, curPlan, ledger!.cycle, ledger, now), newQuote = await quotePlan(tid, planKey, ledger!.cycle, ledger, now);
  const cycleDays = Math.max(1, Math.round((ledger!.periodEnd!.getTime() - ledger!.periodStart!.getTime()) / 86400_000));
  const remainDays = Math.max(0, Math.ceil((ledger!.periodEnd!.getTime() - now.getTime()) / 86400_000));
  const supply = prorateUpgradeSupply(newQuote.supplyKrw, curQuote.supplyKrw, remainDays, cycleDays);
  const period = `${ledger!.cycle === "year" ? `${kstMonthOf(ledger!.periodStart!)}~${kstMonthOf(ledger!.periodEnd!)}` : kstMonthOf(ledger!.periodStart!)}:up-${planKey}`;
  if (supply <= 0) {
    await q(sql`UPDATE subscriptions SET plan_key = ${planKey}, updated_at = NOW() WHERE tenant_id = ${tid}`);
    await q(sql`UPDATE tenants SET plan_key = ${planKey}, updated_at = NOW() WHERE id = ${tid}`);
    return { ok: true, effectiveAt: now.toISOString(), pending: false, chargeNowKrw: 0, vatKrw: 0, totalKrw: 0 };
  }
  const r = await chargeTenant(tid, { planKey, cycle: ledger!.cycle, period, supplyKrw: supply, attempt: 1, source: opts.source ?? "change", keepPeriod: true, actorId: opts.actorId, goods: `업그레이드 차액(${planKey} · 남은 ${remainDays}일)` });
  if (r.notConfigured) return { ok: false, step: "not_configured", error: r.error ?? "결제 준비 중이에요", totalKrw: r.totalKrw };
  if (r.noBillingKey) return { ok: false, step: "billing_key", error: "먼저 결제 수단을 등록해 주세요.", totalKrw: r.totalKrw };
  if (!r.ok) return { ok: false, step: "charge", error: r.error ?? "결제에 실패했어요.", totalKrw: r.totalKrw };
  return { ok: true, effectiveAt: now.toISOString(), pending: false, chargeNowKrw: supply, vatKrw: vatOf(supply), totalKrw: supply + vatOf(supply), invoiceId: r.invoiceId };
}

/**
 * 업그레이드 즉시 청구 미리보기(계약 v4.4 `subscription-quote.prorate` · 토스 원칙 «누르기 전 정확한 금액»).
 *   changePlan ③ 과 **같은 산식**(prorateUpgradeSupply · 남은 일수/주기 일수). 업그레이드가 아니면(진입·다운·주기 변경) null.
 */
export async function prorateQuote(tid: number, planKey: string, cycle: Cycle, now = new Date()): Promise<{ chargeNowKrw: number; vatKrw: number; totalKrw: number; days: number; cycleDays: number } | null> {
  const [t] = await q(sql`SELECT status, plan_key FROM tenants WHERE id = ${tid}`);
  if (!t) return null;
  const ledger = await readLedger(tid);
  const curPlan = String(t.plan_key);
  const paying = String(t.status) === "active" && await isPaidPlan(curPlan) && ledger?.periodEnd && ledger.periodEnd.getTime() > now.getTime();
  if (!paying || planKey === curPlan) return null;
  const plans = await loadPlans();
  const rank = (k: string) => plans.find((p) => p.key === k)?.sort ?? 0;
  if (rank(planKey) <= rank(curPlan) || cycle !== ledger!.cycle) return null;   // 다운·주기 변경은 다음 주기(즉시 청구 없음)
  const curQuote = await quotePlan(tid, curPlan, ledger!.cycle, ledger, now), newQuote = await quotePlan(tid, planKey, ledger!.cycle, ledger, now);
  const cycleDays = Math.max(1, Math.round((ledger!.periodEnd!.getTime() - ledger!.periodStart!.getTime()) / 86400_000));
  const days = Math.max(0, Math.ceil((ledger!.periodEnd!.getTime() - now.getTime()) / 86400_000));
  const chargeNowKrw = prorateUpgradeSupply(newQuote.supplyKrw, curQuote.supplyKrw, days, cycleDays);
  const vatKrw = vatOf(chargeNowKrw);
  return { chargeNowKrw, vatKrw, totalKrw: chargeNowKrw + vatKrw, days, cycleDays };
}

/** 해지(기간 말) — 빌키 유지 · 재구독 가능. 되돌리기(false)도 같은 함수. */
export async function cancelAtPeriodEnd(tid: number, on: boolean, actorId: number | null = null): Promise<{ ok: boolean; periodEnd: string | null }> {
  const l = await readLedger(tid);
  if (!l) return { ok: false, periodEnd: null };
  await q(sql`UPDATE subscriptions SET cancel_at_period_end = ${on}, pending_plan_key = NULL, pending_cycle = NULL, updated_at = NOW() WHERE tenant_id = ${tid}`);
  await writeAudit({ tenantId: tid, action: on ? "subscription_cancel_scheduled" : "subscription_cancel_reverted", actorType: "user", actorId, detail: { periodEnd: l.periodEnd?.toISOString() ?? null } });
  return { ok: true, periodEnd: l.periodEnd?.toISOString() ?? null };
}

/** GET /api/subscription 응답(계약 §1.2). */
export async function subscriptionView(tid: number): Promise<Record<string, unknown>> {
  const [t] = await q(sql`SELECT status, plan_key, trial_ends_at FROM tenants WHERE id = ${tid}`);
  const l = await readLedger(tid);
  const planKey = String(t?.plan_key ?? "trial");
  const plan: PlanDef = await planOf(planKey);
  const cycle: Cycle = l?.cycle ?? "month";
  const quote = await isPaidPlan(planKey) ? await quotePlan(tid, planKey, cycle, l) : null;
  const key = await activeBillingKey(tid);
  const o: Record<string, unknown> = {
    plan: { key: plan.key, name: plan.name, priceKrw: quote ? quote.supplyKrw : 0, vatKrw: quote ? quote.vatKrw : 0, totalKrw: quote ? quote.totalKrw : 0, cycle },
    status: String(t?.status ?? "trial"), cancelAtPeriodEnd: l?.cancelAtPeriodEnd ?? false,
    billingKey: key ? { has: true, ...(key.last4 ? { last4: key.last4 } : {}), ...(key.brand ? { brand: key.brand } : {}) } : { has: false },
    vatNote: "부가세 별도",
  };
  o.failCount = l?.failCount ?? 0;   // 미납 헤드라인 «N회 실패»(v4.4 추가 발주)
  const te = utcDate(t?.trial_ends_at); if (te) o.trialEndsAt = te.toISOString();
  if (l?.periodEnd) o.periodEnd = l.periodEnd.toISOString();
  if (l?.nextBillingAt) o.nextBillingAt = l.nextBillingAt.toISOString();
  if (l?.pendingPlanKey) o.pendingPlanKey = l.pendingPlanKey;
  if (l?.pendingCycle) o.pendingCycle = l.pendingCycle;
  return o;
}
