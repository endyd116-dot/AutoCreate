/**
 * 구독·결제 수단·인보이스 API(계약 P1R4 §1.2 · DESIGN §12.2·§12.0):
 *   GET  /api/subscription                             → { ok, plan:{key,name,priceKrw,vatKrw,totalKrw,cycle}, status, trialEndsAt?, periodEnd?, nextBillingAt?, pendingPlanKey?, cancelAtPeriodEnd, billingKey:{has,last4?,brand?}, vatNote }
 *   GET  /api/subscription-quote?planKey&cycle&couponCode? → { ok, quote:{ supplyKrw, vatKrw, totalKrw, discountPct, source, couponCode?, couponKrw? }, coupon?:{ ok, error? } }   // 화면 «이 플랜으로» 시트가 미리 보는 값(쿠폰은 미리보기만)
 *   POST /api/subscription-change { planKey, cycle, agreePaidTerms?, couponCode? } → { ok, effectiveAt, pending, chargeNowKrw?, vatKrw?, totalKrw? } | { ok:false, step:"billing_key"|"not_configured"|"charge"|"plan"|"same"|"paid_terms"|"coupon" }
 *     쿠폰은 청구 전에 적용(redeemCoupon · 1테넌트 1회 · pct 는 장부 할인 · krw 는 다음 청구 1회 차감) — 틀린 코드는 400 step "coupon" 으로 멈춘다(모르고 정가 결제되지 않게).
 *   POST /api/subscription-cancel { atPeriodEnd:true|false } → { ok, periodEnd }
 *   POST /api/billing-key-start                          → { ok, url, form, orderNo } | { ok:false, step:"not_configured" }
 *   GET  /api/billing-key-return?…KICC 콜백              → 302 /app/plan.html?key=ok|fail
 *   POST /api/billing-key-remove                         → { ok, removed }
 *   GET  /api/invoices?year=                             → { ok, rows:[{ id, kind, period, amountKrw, vatKrw, totalKrw, status, paidAt?, refundedKrw? }] }
 *   🔴 결제 경로는 본인만(denyIfImpersonating) · 부가세 별도(금액 3개 따로) · KICC 없으면 no-op 정직.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, denyIfImpersonating } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { utcDate } from "../../lib/db-util";
import { subscriptionView, quotePlan, changePlan, cancelAtPeriodEnd, PAID_PLANS, type Cycle } from "../../lib/subscription";
import { startBillingKey, approveBillingKey, removeBillingKeyOf } from "../../lib/billing/billing-key";
import { requirePaidTerms } from "../../lib/billing/consents";
import { redeemCoupon, validateCoupon } from "../../lib/billing/promotions";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/subscription", "/api/subscription-quote", "/api/subscription-change", "/api/subscription-cancel", "/api/billing-key-start", "/api/billing-key-return", "/api/billing-key-remove", "/api/invoices"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
const cycleOf = (v: unknown): Cycle => (v === "year" ? "year" : "month");

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/billing-key-return")) {
      const p = url.searchParams;
      const orderNo = p.get("shopOrderNo") || p.get("orderNo") || "", authorizationId = p.get("authorizationId") || "";
      if (!orderNo || !authorizationId) return redirect("/app/plan.html?key=fail");
      const r = await approveBillingKey(authorizationId, orderNo);
      return redirect(r.ok ? `/app/plan.html?key=ok${r.trialEndedByFp ? "&trial=reused" : ""}` : "/app/plan.html?key=fail");
    }

    const auth = requireUser(req); if (!auth.ok) return auth.res;
    const tid = auth.tid;

    if (path.endsWith("/subscription") && req.method === "GET") return json({ ok: true, ...(await subscriptionView(tid)) });
    if (path.endsWith("/subscription-quote")) {
      const planKey = String(url.searchParams.get("planKey") || ""); if (!PAID_PLANS.has(planKey)) return badRequest("planKey");
      const couponCode = (url.searchParams.get("couponCode") || "").trim() || null;
      const qt = await quotePlan(tid, planKey, cycleOf(url.searchParams.get("cycle")), undefined, new Date(), { previewCoupon: couponCode });
      const body: Record<string, unknown> = { ok: true, quote: { supplyKrw: qt.supplyKrw, vatKrw: qt.vatKrw, totalKrw: qt.totalKrw, discountPct: qt.discountPct, source: qt.source, baseKrw: qt.baseKrw, ...(qt.couponCode ? { couponCode: qt.couponCode } : {}), ...(qt.couponKrw ? { couponKrw: qt.couponKrw } : {}) }, vatNote: "부가세 별도" };
      if (couponCode) { const v = await validateCoupon(tid, couponCode, planKey); body.coupon = v.ok ? { ok: true, kind: v.coupon.kind, value: v.coupon.value, months: v.coupon.months } : { ok: false, reason: v.reason, error: v.error }; }
      return json(body);
    }
    if (path.endsWith("/invoices")) {
      const year = /^\d{4}$/.test(url.searchParams.get("year") || "") ? url.searchParams.get("year")! : null;
      const rows = await q(sql`SELECT id, kind, period, amount, vat_krw, total_krw, status, paid_at, refunded_krw, order_no, plan_key, created_at FROM invoices WHERE tenant_id = ${tid}
        ${year ? sql`AND to_char(COALESCE(paid_at, created_at) AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY') = ${year}` : sql``} ORDER BY id DESC LIMIT 200`);
      return json({ ok: true, rows: rows.map((r) => {
        const o: Record<string, unknown> = { id: n(r.id), kind: String(r.kind), period: String(r.period), amountKrw: n(r.amount), vatKrw: n(r.vat_krw), totalKrw: n(r.total_krw) || n(r.amount) + n(r.vat_krw), status: String(r.status), createdAt: utcDate(r.created_at)?.toISOString() ?? "" };
        const pa = utcDate(r.paid_at); if (pa) o.paidAt = pa.toISOString();
        if (n(r.refunded_krw)) o.refundedKrw = n(r.refunded_krw);
        if (r.order_no) o.orderNo = String(r.order_no); if (r.plan_key) o.planKey = String(r.plan_key);
        return o;
      }) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const imp = denyIfImpersonating(auth.user); if (imp) return imp;
    const b = await readJson<Record<string, unknown>>(req);

    if (path.endsWith("/subscription-change")) {
      const planKey = String(b.planKey ?? ""); if (!PAID_PLANS.has(planKey)) return badRequest("고를 수 있는 요금제가 아니에요.", "plan");
      if (!await requirePaidTerms(tid, auth.user.uid, b.agreePaidTerms, { ip: clientIp(req), ua: req.headers.get("user-agent") })) return json({ ok: false, step: "paid_terms", error: "유료 약관에 동의해 주세요." }, 400);
      if (typeof b.couponCode === "string" && b.couponCode.trim()) {
        const c = await redeemCoupon(tid, b.couponCode, planKey, auth.user.uid);
        if (!c.ok) return json({ ok: false, step: "coupon", reason: c.reason, error: c.error }, 400);
      }
      const r = await changePlan(tid, planKey, cycleOf(b.cycle), { actorId: auth.user.uid, source: "change" });
      if (!r.ok) return json({ ok: false, step: r.step, error: r.error, ...(r.totalKrw !== undefined ? { totalKrw: r.totalKrw } : {}) }, r.step === "plan" || r.step === "same" ? 400 : 200);
      return json(r);
    }
    if (path.endsWith("/subscription-cancel")) {
      const on = b.atPeriodEnd !== false;
      const r = await cancelAtPeriodEnd(tid, on, auth.user.uid);
      if (!r.ok) return json({ ok: false, step: "state", error: "구독 중이 아니에요." }, 400);
      return json({ ok: true, periodEnd: r.periodEnd, cancelAtPeriodEnd: on });
    }
    if (path.endsWith("/billing-key-start")) {
      const r = await startBillingKey(tid, { userAgent: req.headers.get("user-agent"), returnBase: process.env.SITE_URL });
      if (!r.ok) return json({ ok: false, step: r.step, error: r.error }, 200);
      return json({ ok: true, url: r.url, form: r.form, orderNo: r.orderNo });
    }
    if (path.endsWith("/billing-key-remove")) {
      const r = await removeBillingKeyOf(tid, auth.user.uid);
      return json({ ok: true, removed: r.removed });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("subscription", err); }
};
