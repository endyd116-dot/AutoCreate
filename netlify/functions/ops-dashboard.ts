/**
 * GET /api/ops-dashboard?month=YYYY-MM — 운영센터 대시보드(계약 §2.1 · DESIGN §11.4 «9월에 3,240,000원 벌었어요»). R1 `ops-center.ts` 의 대시보드를 **교체**.
 *   응답(계약 글자 그대로 · 전부 KST 월):
 *     { revenue:{ todayKrw, monthKrw, subscriptionKrw, coinKrw }, mrr, arr, signups:{ today, month }, trialToPaidPct, activeTenants,
 *       churn:{ month, pct }, coins:{ soldKrw, consumed }, aiCost:{ usd, krw?, fxMissing, calls, byPurpose:[{purpose,usd,calls}], byProvider:[{provider,calls,usd}], overPlan:{coins,pieces}, excluded:{ internalUsd, syntheticUsd, orphanUsd, byoUsd, byoCalls } }, marginKrw?, published:{ byChannel:[{channel,n}] }, revenueCollectedKrw }
 *   돈 규칙: 매출 = **공급가**(invoices.amount · 부가세 제외 · 환불분은 공급가로 환산해 뺀다). 부가세는 매출이 아니다(§12.0).
 *   🔴 «없음 ≠ 0»(AC-9): 환율이 없으면 aiCost.krw 를 싣지 않고 fxMissing:true · marginKrw 도 싣지 않는다. 전환율은 코호트가 없으면 null.
 *   R1 화면(public/ops/index.html)이 읽던 `month`·`tenants` 객체는 과도기 동안 같이 싣는다(계약 모양엔 없는 키 · A 가 R4 화면으로 바꾸면 뗀다). 집계한 달은 `period`.
 *   🔴 [P1R7 §3.4] **내부 테스트 테넌트는 기본 집계에서 뺀다**(`tenants.is_internal` · 사장님 질문 «AI 원가 15,820원이 뭐냐»). `?internal=1` 이면 포함.
 *      응답 `internal:{ excluded, tenants }` 로 «몇 집을 뺐는지»를 같이 말한다 — 숫자가 줄어든 이유를 화면이 설명할 수 있어야 한다.
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
import { excludeInternal, excludeInternalSelf, includeInternalOf } from "../../lib/ops/internal";

export const config = { path: "/api/ops-dashboard" };
const n = (v: unknown) => Number(v || 0);
/** 환불 누계(total 기준)를 공급가로 환산 — 부가세 10% 를 걷어낸다(billing-math vatOf 의 역산 · 정수 원). */
const supplyOfTotal = sql`FLOOR(refunded_krw / 1.1)`;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
  const o = await requireAdmin(req); if (!o.ok) return o.res;
  const url = new URL(req.url);
  const r = kstMonthRange(url.searchParams.get("month"));
  const inc = includeInternalOf(url);                 // [P1R7 §3.4] 기본 false = 내부 테스트 제외
  const notInternal = excludeInternal(sql`tenant_id`, inc);
  try {
    const paidAt = sql`paid_at`;
    // ① 매출(공급가) — 이번 달 · 오늘 · 구독/코인 분리. refunded 행도 공급가에서 환불분을 뺀 만큼은 매출.
    const [rev] = await q(sql`SELECT
        COALESCE(SUM(CASE WHEN ${within(paidAt, r)} THEN amount - ${supplyOfTotal} END), 0) AS month_krw,
        COALESCE(SUM(CASE WHEN ${within(paidAt, r)} AND kind = 'subscription' THEN amount - ${supplyOfTotal} END), 0) AS sub_krw,
        COALESCE(SUM(CASE WHEN ${within(paidAt, r)} AND kind = 'coin' THEN amount - ${supplyOfTotal} END), 0) AS coin_krw,
        COALESCE(SUM(CASE WHEN paid_at >= ${ts(r.todayStart)} THEN amount - ${supplyOfTotal} END), 0) AS today_krw
      FROM invoices WHERE status IN ('paid', 'refunded') AND paid_at IS NOT NULL${notInternal}`);

    // ② MRR — 활성 유료 테넌트의 월 환산 공급가(가입 시점 고정가 > 플랜가 · 연납은 /12 · 할인 반영).
    const plans = await loadPlans();
    const paid = new Set(await paidPlanKeys());
    const subs = await q(sql`SELECT t.plan_key, s.cycle, s.price_locked_krw, s.discount_pct, s.discount_until
      FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id WHERE t.status = 'active'${excludeInternalSelf(sql`t`, inc)}`);
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
      FROM tenants t WHERE TRUE${excludeInternalSelf(sql`t`, inc)}`);
    const cohort = n(t?.cohort), converted = n(t?.converted);
    const trialToPaidPct = cohort > 0 ? Math.round(converted * 100 / cohort) : null;
    const [ch] = await q(sql`SELECT COUNT(DISTINCT tenant_id) AS c FROM audit_logs
      WHERE action IN ('subscription_cancelled', 'subscription_suspended_no_key') AND ${within(created, r)}${notInternal}`);
    const churnMonth = n(ch?.c);
    const churnBase = n(t?.active) + churnMonth;
    /* 🔴 [2026-09-19 수리 · 시나리오 B ⑤ · AC-9] **잴 집이 없으면 «0%»가 아니라 «못 쟀다»(null)다.**
       바로 위 `trialToPaidPct` 는 이미 그렇게 하고 있었는데(`cohort > 0 ? … : null`) 이탈률만 `: 0` 이었다.
       집이 하나도 없는 날 «이탈 0%»는 사실처럼 보이지만 **잰 적이 없는 값**이다. 화면이 «못 쟀어요»로 받는다. */
    const churn = { month: churnMonth, pct: churnBase > 0 ? Math.round(churnMonth * 1000 / churnBase) / 10 : null };

    // ④ 코인 — 판매(공급가) · 소비(코인 수)
    const [coins] = await q(sql`SELECT
        COALESCE(SUM(CASE WHEN kind = 'coin' AND status IN ('paid','refunded') AND ${within(paidAt, r)} THEN amount - ${supplyOfTotal} END), 0) AS sold_krw
      FROM invoices WHERE TRUE${notInternal}`);
    const [cons] = await q(sql`SELECT COALESCE(-SUM(delta), 0) AS consumed FROM coin_ledger WHERE kind = 'consume' AND ${within(created, r)}${notInternal}`);

    // ⑤ AI 원가 — usd 합 · 환율 없으면 미환산(0 아님)
    /* 🔴 [P1R8] AI 원가는 **행이 가진 분류**로 거른다(메인 라이브 실측 2026-09-15).
       종전엔 `NOT EXISTS(tenants … is_internal)` 로만 걸러서 **부모를 지우면 그 돈이 «고객 비용»으로 넘어갔다**
       (고아 103행 $9.98 · 그중 $9.00 은 상한 시험용 가짜 행). 이제 셋을 함께 뺀다:
         ① 행의 `is_internal`(쓰는 순간 스냅샷) ② 행의 `synthetic`(실제 호출이 아님) ③ **고아**(테넌트가 지워졌다 = 우리 테스트 집)
       🔴 테넌트 없는 호출(`tenant_id IS NULL`)은 **우리 플랫폼 몫이라 그대로 센다**(실제로 쓴 돈이다).
       그리고 «얼마나 많이 불렀나»를 같이 준다 — 편 수로 보면 3배씩 틀린다(글 1편이 생성·재작성·게이트로 여러 호출로 쪼개진다). */
    /* 🔴 [R8 §4.4] `NOT a.byo` 를 더한다 — **고객이 자기 키로 쓴 돈은 우리 원가가 아니다.**
       안 가르면 «우리 AI 원가»가 남의 지갑까지 세어 마진이 거짓말을 한다(AC-71 의 같은 구멍이 새 칸에서 되살아나는 자리). */
    const aiCustomer = sql`(NOT a.is_internal AND NOT a.synthetic AND NOT a.byo AND (a.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants zt WHERE zt.id = a.tenant_id AND NOT zt.is_internal)))`;
    const [ai] = await q(sql`SELECT COALESCE(SUM(a.cost_usd), 0) AS usd, COUNT(*)::int AS calls,
        COALESCE(SUM(a.cost_usd) FILTER (WHERE a.is_internal OR EXISTS (SELECT 1 FROM tenants zt WHERE zt.id = a.tenant_id AND zt.is_internal)), 0) AS internal_usd,
        COALESCE(SUM(a.cost_usd) FILTER (WHERE a.synthetic), 0) AS synthetic_usd,
        COALESCE(SUM(a.cost_usd) FILTER (WHERE a.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenants zt WHERE zt.id = a.tenant_id)), 0) AS orphan_usd
      FROM ai_usage a WHERE ${within(sql`a.created_at`, r)} AND ${aiCustomer}`);
    const [aiAll] = await q(sql`SELECT COALESCE(SUM(a.cost_usd), 0) AS usd, COUNT(*)::int AS calls,
        COALESCE(SUM(a.cost_usd) FILTER (WHERE a.is_internal OR EXISTS (SELECT 1 FROM tenants zt WHERE zt.id = a.tenant_id AND zt.is_internal)), 0) AS internal_usd,
        COALESCE(SUM(a.cost_usd) FILTER (WHERE a.synthetic), 0) AS synthetic_usd,
        COALESCE(SUM(a.cost_usd) FILTER (WHERE a.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenants zt WHERE zt.id = a.tenant_id)), 0) AS orphan_usd,
        COALESCE(SUM(a.cost_usd) FILTER (WHERE a.byo), 0) AS byo_usd,
        COUNT(*) FILTER (WHERE a.byo)::int AS byo_calls
      FROM ai_usage a WHERE ${within(sql`a.created_at`, r)}`);
    /* 🔴 **무엇이 비싼가는 `purpose` 로 먼저 본다** — «글이 비싸다»는 오해가 나기 딱 좋다(실측: 글 3편 $0.98 중 사진 18장 $0.83 = 85%). */
    const aiBy = await q(sql`SELECT a.purpose, COALESCE(SUM(a.cost_usd), 0) AS usd, COUNT(*)::int AS calls
      FROM ai_usage a WHERE ${within(sql`a.created_at`, r)} AND ${aiCustomer} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
    const aiByModel = await q(sql`SELECT a.model, COALESCE(SUM(a.cost_usd), 0) AS usd, COUNT(*)::int AS calls
      FROM ai_usage a WHERE ${within(sql`a.created_at`, r)} AND ${aiCustomer} GROUP BY 1 ORDER BY 2 DESC LIMIT 12`);
    /* [R8 §4.5 운영 축] 🔴 **provider 분해는 «호출 수» 기준**(메인 지시) — 돈만 보면 «어디에 많이 기대고 있나»가 안 보인다.
       한 곳이 흔들리면 그날 공장이 서는데, 그 «한 곳»이 어디인지는 **몇 번 부르나**로 드러난다.
       🔴 지금은 제공사가 **하나뿐**이라 이 줄이 늘 한 줄이다 — 그게 사실이고, 사실대로 보여 준다(있는 척도 없는 척도 안 한다 · AC-9).
       모델 이름 앞머리로 가른다(`lib/ai-models.ts` 밖에 모델 **이름**을 적지 않는다는 §4.9 와 어긋나지 않는다 — 여기서 쓰는 건 이름이 아니라 **갈래**다). */
    const aiByProvider = await q(sql`SELECT
        CASE WHEN a.model ILIKE 'gemini%' OR a.model ILIKE 'models/gemini%' THEN 'gemini'
             WHEN a.model ILIKE 'gpt%' OR a.model ILIKE 'o1%' OR a.model ILIKE 'o3%' THEN 'openai'
             WHEN a.model ILIKE 'claude%' THEN 'anthropic'
             WHEN a.model = '' OR a.model IS NULL THEN '(모름)'
             ELSE split_part(a.model, '-', 1) END AS provider,
        COUNT(*)::int AS calls, COALESCE(SUM(a.cost_usd), 0) AS usd
      FROM ai_usage a WHERE ${within(sql`a.created_at`, r)} AND ${aiCustomer} GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
    /* [R8 §4.5] 🔴 **우리가 안은 몫** — 고객이 계획보다 AI 사진을 더 써서 **더 받지 않기로 한** 그 코인.
       감사에만 있으면 아무도 안 본다(오늘 이 프로젝트를 열한 번 관통한 문장이다).
       그리고 이 숫자는 «스톡이 비어서 AI 가 다 구웠다»는 **신호**다 — 재고를 채우라는 말이지 그냥 손실이 아니다.
       🔴 `ai_usage` 와 **같은 거르개**를 태운다(내부 집 제외) — 안 그러면 오늘 고친 그 오염이 이 칸에서 되살아난다(AC-71).
       🔴 «얼마»만이 아니라 **«몇 편이 그랬나»**도 준다 — 금액만 있으면 한 편이 크게 샌 건지 전부 조금씩인지 모른다. */
    let overPlan = { coins: 0, pieces: 0 };
    try {
      const [op] = await q(sql`SELECT COALESCE(SUM((g.detail->>'absorbed')::numeric), 0) AS coins, COUNT(*)::int AS pieces
        FROM audit_logs g WHERE g.action = 'piece_ai_over_plan' AND ${within(sql`g.created_at`, r)}
          AND g.tenant_id IS NOT NULL AND EXISTS (SELECT 1 FROM tenants zt WHERE zt.id = g.tenant_id AND NOT zt.is_internal)`);
      overPlan = { coins: Math.round(n(op?.coins) * 100) / 100, pieces: n(op?.pieces) };
    } catch (e) { console.warn("[ops-dashboard] 안은 몫 조회 실패 — 그 줄만 빠진다", String((e as Error)?.message ?? e).slice(0, 100)); }
    const usd = Math.round(n(ai?.usd) * 10000) / 10000;
    const fx = fxToKrw(usd, "USD", {});
    const round4 = (v: unknown) => Math.round(n(v) * 10000) / 10000;
    const aiCost: Record<string, unknown> = fx ? { usd, krw: fx.krw, fxMissing: false } : { usd, fxMissing: true };
    aiCost.calls = n(ai?.calls);
    aiCost.byPurpose = aiBy.map((x) => ({ purpose: String(x.purpose ?? ""), usd: round4(x.usd), calls: n(x.calls) }));
    aiCost.byModel = aiByModel.map((x) => ({ model: String(x.model ?? ""), usd: round4(x.usd), calls: n(x.calls) }));
    aiCost.byProvider = aiByProvider.map((x) => ({ provider: String(x.provider ?? ""), calls: n(x.calls), usd: round4(x.usd) }));
    /* 🔴 우리가 안은 몫 — 0이어도 **키를 싣는다**(«없음»과 «0»은 다르다 · AC-9). 화면이 «아직 없어요»를 그릴 수 있어야 한다. */
    aiCost.overPlan = overPlan;
    /* «왜 이 숫자가 작아 보이나»를 화면이 설명할 수 있게 — 뺀 몫을 따로 말한다(숨긴 게 아니라 가른 것이다). */
    aiCost.excluded = { internalUsd: round4(aiAll?.internal_usd), syntheticUsd: round4(aiAll?.synthetic_usd), orphanUsd: round4(aiAll?.orphan_usd),
      /* 🔴 [R8 §4.4] 고객이 **자기 키로** 쓴 몫 — 우리가 안 낸 돈이라 원가에서 빠진다(숨긴 게 아니라 가른 것이다). */
      byoUsd: round4(aiAll?.byo_usd), byoCalls: n(aiAll?.byo_calls),
      totalUsd: round4(n(aiAll?.usd) - n(ai?.usd)), calls: Math.max(0, n(aiAll?.calls) - n(ai?.calls)) };

    // ⑥ 채널별 발행 · 고객이 걷은 수익(revenue_daily · KST day 는 이미 날짜)
    const pub = await q(sql`SELECT channel, COUNT(*) AS c FROM posts WHERE ${within(sql`published_at`, r)}${notInternal} GROUP BY channel ORDER BY c DESC`);
    const [collected] = await q(sql`SELECT COALESCE(SUM(amount_krw), 0) AS krw FROM revenue_daily WHERE day >= ${r.month + "-01"}::date AND day < (${r.month + "-01"}::date + interval '1 month')${notInternal}`);
    const [tk] = await q(sql`SELECT COUNT(*) FILTER (WHERE status IN ('open','progress')) AS open FROM tickets WHERE TRUE${notInternal}`);
    const [intl] = await q(sql`SELECT COUNT(*)::int AS c FROM tenants WHERE is_internal`);

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
      internal: { excluded: !inc, tenants: n(intl?.c) },   // [P1R7 §3.4] «내부 N집을 뺀 숫자입니다» 를 화면이 말할 수 있게
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
