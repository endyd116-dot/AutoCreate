/**
 * GET /api/ops-dashboard?month=YYYY-MM — 운영센터 대시보드(계약 §2.1 · DESIGN §11.4 «9월에 3,240,000원 벌었어요»). R1 `ops-center.ts` 의 대시보드를 **교체**.
 *   응답(계약 글자 그대로 · 전부 KST 월):
 *     { revenue:{ todayKrw, monthKrw, subscriptionKrw, coinKrw }, mrr, arr, signups:{ today, month }, trialToPaidPct, activeTenants,
 *       churn:{ month, pct }, coins:{ soldKrw, consumed }, aiCost:{ usd, krw?, fxMissing }, marginKrw?, published:{ byChannel:[{channel,n}] }, revenueCollectedKrw }
 *   돈 규칙: 매출 = **공급가**(invoices.amount · 부가세 제외 · 환불분은 공급가로 환산해 뺀다). 부가세는 매출이 아니다(§12.0).
 *   🔴 «없음 ≠ 0»(AC-9): 환율이 없으면 aiCost.krw 를 싣지 않고 fxMissing:true · marginKrw 도 싣지 않는다. 전환율은 코호트가 없으면 null.
 *   R1 화면(public/ops/index.html)이 읽던 `month`·`tenants` 객체는 과도기 동안 같이 싣는다(계약 모양엔 없는 키 · A 가 R4 화면으로 바꾸면 뗀다). 집계한 달은 `period`.
 */
import { sql } from "drizzle-orm";
import { json, jsonError } from "../../lib/response";
import { requireAdmin } from "../../lib/guards";
import { q } from "../../lib/accounts";
import { loadPlans } from "../../lib/plans";
import { paidPlanKeys } from "../../lib/subscription";
import { fxToKrw } from "../../lib/revenue/common";
import { COIN_KRW } from "../../lib/coin-table";
import { kstMonthRange, ts, within } from "../../lib/ops/period";

export const config = { path: "/api/ops-dashboard" };
const n = (v: unknown) => Number(v || 0);
/** 환불 누계(total 기준)를 공급가로 환산 — 부가세 10% 를 걷어낸다(billing-math vatOf 의 역산 · 정수 원). */
const supplyOfTotal = sql`FLOOR(refunded_krw / 1.1)`;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
  const o = await requireAdmin(req); if (!o.ok) return o.res;
  const url = new URL(req.url);
  const r = kstMonthRange(url.searchParams.get("month"));
  try {
    const paidAt = sql`paid_at`;
    // ① 매출(공급가) — 이번 달 · 오늘 · 구독/코인 분리. refunded 행도 공급가에서 환불분을 뺀 만큼은 매출.
    const [rev] = await q(sql`SELECT
        COALESCE(SUM(CASE WHEN ${within(paidAt, r)} THEN amount - ${supplyOfTotal} END), 0) AS month_krw,
        COALESCE(SUM(CASE WHEN ${within(paidAt, r)} AND kind = 'subscription' THEN amount - ${supplyOfTotal} END), 0) AS sub_krw,
        COALESCE(SUM(CASE WHEN ${within(paidAt, r)} AND kind = 'coin' THEN amount - ${supplyOfTotal} END), 0) AS coin_krw,
        COALESCE(SUM(CASE WHEN paid_at >= ${ts(r.todayStart)} THEN amount - ${supplyOfTotal} END), 0) AS today_krw
      FROM invoices WHERE status IN ('paid', 'refunded') AND paid_at IS NOT NULL`);

    // ② MRR — 활성 유료 테넌트의 월 환산 공급가(가입 시점 고정가 > 플랜가 · 연납은 /12 · 할인 반영).
    const plans = await loadPlans();
    const paid = new Set(await paidPlanKeys());
    const subs = await q(sql`SELECT t.plan_key, s.cycle, s.price_locked_krw, s.discount_pct, s.discount_until
      FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id WHERE t.status = 'active'`);
    let mrr = 0; const byPlan = new Map<string, number>();
    for (const s of subs) {
      const key = String(s.plan_key); if (!paid.has(key)) continue;
      byPlan.set(key, (byPlan.get(key) ?? 0) + 1);
      const p = plans.find((x) => x.key === key); if (!p) continue;
      const yearly = String(s.cycle ?? "month") === "year";
      const base = s.price_locked_krw !== null && s.price_locked_krw !== undefined ? n(s.price_locked_krw) : (yearly ? p.priceYear : p.priceMonth);
      const monthly = yearly ? base / 12 : base;
      const until = s.discount_until ? new Date(String(s.discount_until).replace(" ", "T") + "Z").getTime() : 0;
      const pct = n(s.discount_pct) > 0 && (!until || until > Date.now()) ? n(s.discount_pct) : 0;
      mrr += Math.round(monthly * (100 - pct) / 100);
    }

    // ③ 가입·활성·전환·이탈
    const created = sql`created_at`;
    const [t] = await q(sql`SELECT
        COUNT(*) FILTER (WHERE ${within(created, r)}) AS signups_month,
        COUNT(*) FILTER (WHERE created_at >= ${ts(r.todayStart)}) AS signups_today,
        COUNT(*) FILTER (WHERE status = 'active') AS active,
        COUNT(*) FILTER (WHERE status = 'trial') AS trial,
        COUNT(*) FILTER (WHERE status IN ('readonly', 'suspended', 'past_due')) AS at_risk,
        COUNT(*) AS total,
        -- 전환 코호트: 이번 달 가입 중 체험이 끝났거나 유료가 된 곳 / 그중 유료 활성
        COUNT(*) FILTER (WHERE ${within(created, r)} AND (trial_ends_at <= NOW() OR (status = 'active' AND plan_key <> 'trial'))) AS cohort,
        COUNT(*) FILTER (WHERE ${within(created, r)} AND status = 'active' AND plan_key <> 'trial') AS converted
      FROM tenants`);
    const cohort = n(t?.cohort), converted = n(t?.converted);
    const trialToPaidPct = cohort > 0 ? Math.round(converted * 100 / cohort) : null;
    const [ch] = await q(sql`SELECT COUNT(DISTINCT tenant_id) AS c FROM audit_logs
      WHERE action IN ('subscription_cancelled', 'subscription_suspended_no_key') AND ${within(created, r)}`);
    const churnMonth = n(ch?.c);
    const churnBase = n(t?.active) + churnMonth;
    const churn = { month: churnMonth, pct: churnBase > 0 ? Math.round(churnMonth * 1000 / churnBase) / 10 : 0 };

    // ④ 코인 — 판매(공급가) · 소비(코인 수)
    const [coins] = await q(sql`SELECT
        COALESCE(SUM(CASE WHEN kind = 'coin' AND status IN ('paid','refunded') AND ${within(paidAt, r)} THEN amount - ${supplyOfTotal} END), 0) AS sold_krw
      FROM invoices`);
    const [cons] = await q(sql`SELECT COALESCE(-SUM(delta), 0) AS consumed FROM coin_ledger WHERE kind = 'consume' AND ${within(created, r)}`);

    // ⑤ AI 원가 — usd 합 · 환율 없으면 미환산(0 아님)
    const [ai] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE ${within(created, r)}`);
    const usd = Math.round(n(ai?.usd) * 10000) / 10000;
    const fx = fxToKrw(usd, "USD", {});
    const aiCost: Record<string, unknown> = fx ? { usd, krw: fx.krw, fxMissing: false } : { usd, fxMissing: true };

    // ⑥ 채널별 발행 · 고객이 걷은 수익(revenue_daily · KST day 는 이미 날짜)
    const pub = await q(sql`SELECT channel, COUNT(*) AS c FROM posts WHERE ${within(sql`published_at`, r)} GROUP BY channel ORDER BY c DESC`);
    const [collected] = await q(sql`SELECT COALESCE(SUM(amount_krw), 0) AS krw FROM revenue_daily WHERE day >= ${r.month + "-01"}::date AND day < (${r.month + "-01"}::date + interval '1 month')`);
    const [tk] = await q(sql`SELECT COUNT(*) FILTER (WHERE status IN ('open','progress')) AS open FROM tickets`);

    const revenue = { todayKrw: n(rev?.today_krw), monthKrw: n(rev?.month_krw), subscriptionKrw: n(rev?.sub_krw), coinKrw: n(rev?.coin_krw) };
    const body: Record<string, unknown> = {
      ok: true, period: r.month,
      revenue, mrr, arr: mrr * 12,
      signups: { today: n(t?.signups_today), month: n(t?.signups_month) },
      trialToPaidPct, activeTenants: n(t?.active), churn,
      coins: { soldKrw: n(coins?.sold_krw), consumed: n(cons?.consumed) },
      aiCost,
      published: { byChannel: pub.map((p) => ({ channel: String(p.channel), n: n(p.c) })) },
      revenueCollectedKrw: n(collected?.krw),
      openTickets: n(tk?.open),
    };
    if (fx) body.marginKrw = revenue.monthKrw - fx.krw;
    // ── R1 화면 호환(과도기 · public/ops/index.html 이 `month`·`tenants` 객체를 읽는다 · 계약 모양엔 없는 키라 충돌 없음) ──
    body.month = { revenue: revenue.monthKrw, subscription: revenue.subscriptionKrw, coin: revenue.coinKrw, today: revenue.todayKrw, mrr, arr: mrr * 12,
        aiCostKrw: fx ? fx.krw : 0, marginKrw: fx ? revenue.monthKrw - fx.krw : 0, coinsSold: n(coins?.sold_krw), coinsConsumed: n(cons?.consumed), coinKrw: COIN_KRW,
        published: pub.reduce((a, p) => a + n(p.c), 0), customerRevenueKrw: n(collected?.krw), openTickets: n(tk?.open) };
    body.tenants = { total: n(t?.total), trial: n(t?.trial), active: n(t?.active), atRisk: n(t?.at_risk), newMonth: n(t?.signups_month), newToday: n(t?.signups_today),
        byPlan: [...byPlan.entries()].map(([planKey, count]) => ({ planKey, count })) };
    return json(body);
  } catch (err) { return jsonError("ops_dashboard", err); }
};
