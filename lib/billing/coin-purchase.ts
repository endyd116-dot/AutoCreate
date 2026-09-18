/**
 * lib/billing/coin-purchase.ts — 코인 충전(계약 §1.1 · DESIGN §12.1·§12.3 pack_trial).
 *   AM 원본: ../AutoMarketing/lib/coin-purchase.ts(startCoinPurchase §91 · approveCoinPurchase §166) · lib/coin-invoice.ts recordCoinInvoice(영수증 1행) (이식 2026-09-14)
 *   바꾼 것(§0.1): 주문번호 `AC-COIN-…` · 대표 = users role owner · 빌키 = billing_keys.billing_key/active · 영수증 = invoices kind='coin' period=주문번호
 *   (AM 의 `COIN-…` period 우회는 버림) · 시도 감사 = coin_orders(pending|paid|failed) + audit(billing_logs 없음) · 부가세 별도.
 *
 *   ══ 두 갈래(AM 그대로) ══
 *     ㉠ 빌키 있으면 **원클릭**(chargeWithBillingKey · 동기 · 응답이 곧 결과) → 바로 purchaseCoins + 영수증.
 *     ㉡ 없으면 **인증창**(registerTrade → authPageUrl → 콜백 approveTrade) → approveCoinPurchase 가 기입. 콜백엔 세션이 없어 주문번호를 되파싱한다.
 *   ══ 규칙 ══
 *     · «성공한 충전만 영수증 1행»(실패는 coin_orders.status='failed' 만 · 미수로 쌓이지 않는다).
 *     · pack_trial 은 (tenant, pack_id, status='paid') 가 있으면 거절 · 체험 중 허용(§12.3).
 *     · KICC 키 없으면 no-op 정직(`notConfigured` · «결제 준비 중이에요»). 원격접속 중 충전 금지는 호출부(denyIfImpersonating).
 *     · **이중 MID(§1.6)**: 거래등록 MID 를 `coin_orders.pg_mid` 에 남기고 콜백 승인이 그 MID 를 쓴다 · 원클릭은 빌키의 `pg_mid` 로 청구 · 영수증에도 `invoices.pg_mid`.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { vatOf } from "../billing-math";
import { purchaseCoins, balance } from "../coin-ledger";
import { applyBonusCoins } from "./promotions";
import { jsonb } from "../db-util";
import { activeBillingKey, tenantOwner } from "../subscription";
import { rewardReferralOnPaid } from "../referral";
import { coinOrderNo, findPack, packIdOfCode, parseCoinOrderNo, type CoinPack } from "./packs";
import type { PayRoute } from "../kicc";

const n = (v: unknown) => Number(v || 0);

export type StartResult =
  | { ok: true; orderNo: string; mode: "oneclick"; amountKrw: number; vatKrw: number; totalKrw: number; coins: number; bonus: number; balance: number; invoiceId: number | null }
  | { ok: true; orderNo: string; mode: "auth"; amountKrw: number; vatKrw: number; totalKrw: number; coins: number; pay: { url: string; form: Record<string, string> } }
  | { ok: false; step: "pack" | "once" | "not_configured" | "charge" | "tenant"; error: string; orderNo?: string; amountKrw?: number; vatKrw?: number; totalKrw?: number };

/** pack_trial 1회 한정(§0.1) — 이미 산 적 있으면 true. */
export async function trialPackUsed(tid: number): Promise<boolean> {
  const [r] = await q(sql`SELECT 1 FROM coin_orders WHERE tenant_id = ${tid} AND pack_id = 'pack_trial' AND status = 'paid' LIMIT 1`);
  return !!r;
}

/** «성공한 충전만» 영수증 1행(invoices kind='coin' · period=주문번호 · 멱등). */
async function recordCoinInvoice(tid: number, orderNo: string, pack: CoinPack, pgTid: string | null, pgMid: string | null): Promise<number | null> {
  const vatKrw = vatOf(pack.krw);
  const [inv] = await q(sql`INSERT INTO invoices (tenant_id, kind, period, amount, vat_krw, total_krw, status, pg_ref, pg_mid, paid_at, order_no, detail)
    VALUES (${tid}, ${"coin"}, ${orderNo}, ${pack.krw}, ${vatKrw}, ${pack.krw + vatKrw}, ${"paid"}, ${pgTid}, ${pgMid}, NOW(), ${orderNo}, ${jsonb({ packId: pack.id, coins: pack.coins })})
    ON CONFLICT (tenant_id, kind, period) DO UPDATE SET status = 'paid', pg_ref = COALESCE(EXCLUDED.pg_ref, invoices.pg_ref), pg_mid = COALESCE(EXCLUDED.pg_mid, invoices.pg_mid), updated_at = NOW() RETURNING id`);
  return inv ? n(inv.id) : null;
}
async function markOrder(tid: number, orderNo: string, status: "paid" | "failed", extra: { pgTid?: string | null; error?: string | null; pgMid?: string | null } = {}): Promise<void> {
  await q(sql`UPDATE coin_orders SET status = ${status}, pg_ref = COALESCE(${extra.pgTid ?? null}, pg_ref), pg_mid = COALESCE(${extra.pgMid ?? null}, pg_mid), error = ${extra.error ?? null},
    paid_at = CASE WHEN ${status} = 'paid' THEN NOW() ELSE paid_at END, updated_at = NOW() WHERE tenant_id = ${tid} AND order_no = ${orderNo}`);
}

/** 결제 성공 뒤 «기입 + 영수증»(㉠·㉡ 공용 · 멱등). */
async function settle(tid: number, orderNo: string, pack: CoinPack, pgTid: string | null, actorId: number | null, pgMid: string | null = null): Promise<{ balance: number; invoiceId: number | null; already: boolean; bonus: number }> {
  await markOrder(tid, orderNo, "paid", { pgTid, pgMid });
  const invoiceId = await recordCoinInvoice(tid, orderNo, pack, pgTid, pgMid);
  const p = await purchaseCoins(tid, pack.coins, orderNo, { actorId, reason: `코인 충전 ${pack.coins.toLocaleString("ko-KR")}개(₩${(pack.krw + vatOf(pack.krw)).toLocaleString("ko-KR")} · 유효 1년)` });
  // 이벤트 보너스(계약 §2.1 ops-promotions bonus_coin · ref bonus:{orderNo} 멱등) — 충전이 실제로 기입된 뒤에만.
  const bonus = p.already ? { bonus: 0, promoId: null } : await applyBonusCoins(tid, orderNo, pack.id, pack.coins, actorId);
  // [P1R6 §1.1] 코인 충전도 «유료 결제» — 피추천인의 첫 결제면 양쪽 추천 보상(멱등 · 절대 안 던진다). 재정산(already)엔 부르지 않는다.
  const referral = p.already ? null : await rewardReferralOnPaid(tid, { orderNo, invoiceId, source: "coin" });
  await writeAudit({ tenantId: tid, action: "coin_purchase", actorType: actorId ? "user" : "system", actorId, target: `order:${orderNo}`, detail: { packId: pack.id, coins: pack.coins, krw: pack.krw, vatKrw: vatOf(pack.krw), pgTid, granted: p.granted, already: p.already, invoiceId, bonus: bonus.bonus, referral: referral?.status ?? null } });
  return { balance: bonus.bonus || referral?.status === "rewarded" ? (await balance(tid)).balance : p.balance, invoiceId, already: p.already, bonus: bonus.bonus };
}

export async function startCoinPurchase(tid: number, packId: unknown, opts: { actorId: number; userAgent?: string | null; returnBase?: string; route?: PayRoute }): Promise<StartResult> {
  const pack = await findPack(packId);
  if (!pack) return { ok: false, step: "pack", error: "충전 팩을 골라 주세요." };
  if (pack.oncePerTenant && await trialPackUsed(tid)) return { ok: false, step: "once", error: "첫 충전 팩은 한 번만 살 수 있어요. 다른 팩을 골라 주세요." };
  const vatKrw = vatOf(pack.krw), totalKrw = pack.krw + vatKrw;
  const { isKiccConfigured, chargeWithBillingKey, registerTrade, deviceTypeFromUA } = await import("../kicc");
  if (!isKiccConfigured()) return { ok: false, step: "not_configured", error: "결제 준비 중이에요 · 곧 열려요", amountKrw: pack.krw, vatKrw, totalKrw };
  const route: PayRoute = opts.route === "keyin" ? "keyin" : "auth";   // 판정은 lib/pay-route.ts 한 곳
  const owner = await tenantOwner(tid);
  const orderNo = coinOrderNo(tid, pack.id);
  const goodsName = `코인 ${pack.coins.toLocaleString("ko-KR")}개 충전`;   // 어댑터가 «AutoCreate » 를 붙인다(명세서 구별 · §1.6)
  const key = await activeBillingKey(tid);
  await q(sql`INSERT INTO coin_orders (tenant_id, pack_id, krw, coins, status, order_no, vat_krw, total_krw, mode)
    VALUES (${tid}, ${pack.id}, ${pack.krw}, ${pack.coins}, ${"pending"}, ${orderNo}, ${vatKrw}, ${totalKrw}, ${key ? "oneclick" : "auth"})`);

  if (key) {
    // ㉠ 원클릭 — 응답이 곧 결과. 빌키를 발급한 MID 로만 청구된다(§1.6).
    const r = await chargeWithBillingKey({ billingKey: key.billingKey, shopOrderNo: orderNo, amount: totalKrw, goodsName, customerName: owner.name, customerEmail: owner.email ?? undefined, mid: key.pgMid });
    if (!r.success) {
      await markOrder(tid, orderNo, "failed", { error: (r.errorMessage || r.errorCode || "charge_failed").slice(0, 300), pgMid: r.mallId ?? key.pgMid ?? null });
      await writeAudit({ tenantId: tid, action: "coin_purchase_failed", actorType: "user", actorId: opts.actorId, riskLevel: "medium", target: `order:${orderNo}`, detail: { packId: pack.id, totalKrw, errorCode: r.errorCode ?? null, error: r.errorMessage ?? null } });
      return { ok: false, step: "charge", error: r.errorMessage || "카드 결제가 되지 않았어요. 카드 한도·유효기간을 확인해 주세요.", orderNo, amountKrw: pack.krw, vatKrw, totalKrw };
    }
    const s = await settle(tid, orderNo, pack, r.pgTid ?? null, opts.actorId, r.mallId ?? key.pgMid ?? null);
    return { ok: true, orderNo, mode: "oneclick", amountKrw: pack.krw, vatKrw, totalKrw, coins: pack.coins, bonus: s.bonus, balance: s.balance, invoiceId: s.invoiceId };
  }
  // ㉡ 인증창 — 콜백에서 approveCoinPurchase.
  const base = (opts.returnBase || process.env.SITE_URL || "").replace(/\/$/, "");
  const r = await registerTrade({ shopOrderNo: orderNo, amount: totalKrw, goodsName, isBillingKey: false, returnUrl: `${base}/api/coin-charge-return`, customerName: owner.name, customerEmail: owner.email ?? undefined, deviceTypeCode: deviceTypeFromUA(opts.userAgent), route });
  if (!r.success || !r.authPageUrl) {
    await markOrder(tid, orderNo, "failed", { error: (r.errorMessage || r.errorCode || "register_failed").slice(0, 300) });
    return { ok: false, step: "charge", error: r.errorMessage || "결제창을 열지 못했어요. 잠시 뒤 다시 해 주세요.", orderNo, amountKrw: pack.krw, vatKrw, totalKrw };
  }
  // 🔴 승인(콜백)은 **등록과 같은 MID** 로 해야 한다 → 지금 쓴 MID 를 주문 행에 남긴다(콜백엔 세션이 없다).
  await q(sql`UPDATE coin_orders SET pg_mid = ${r.mallId ?? null}, updated_at = NOW() WHERE tenant_id = ${tid} AND order_no = ${orderNo}`);
  return { ok: true, orderNo, mode: "auth", amountKrw: pack.krw, vatKrw, totalKrw, coins: pack.coins, pay: { url: r.authPageUrl, form: {} } };
}

export type ApproveResult = { ok: true; tenantId: number; coins: number; bonus: number; balance: number; alreadyPaid: boolean } | { ok: false; tenantId?: number; reason: string };
/** ㉡ 콜백 — 승인 확정 → 기입. 같은 주문번호 재수신은 alreadyPaid(원장 유니크가 최종 보증). */
export async function approveCoinPurchase(authorizationId: string, orderNo: string, opts: { verifyMsgAuth?: (raw: unknown, mid?: string | null) => boolean } = {}): Promise<ApproveResult> {
  /* 🔴 [2026-09-19 수리 2판 · C `verify-audit-gap`] **돈이 걸린 콜백인데 두 갈래가 조용히 돌아섰다.**
     이 함수는 승인 실패·서명 불일치는 남기면서, «주문번호를 못 읽음»·«없는 묶음»은 **아무 기록 없이** 돌아섰다.
     그 둘은 «PG 가 뭔가 보냈는데 우리가 못 알아들었다»는 뜻이다 — 고객 돈이 빠져나갔을 수도 있는 자리라
     **가장 남아야 할 갈래**다. 남길 테넌트를 모르는 첫 갈래는 `tenantId: null` 로 남긴다(안 남기는 것보다 낫다). */
  const parsed = parseCoinOrderNo(orderNo);
  if (!parsed) {
    await writeAudit({ tenantId: null, action: "coin_purchase_failed", actorType: "system", riskLevel: "high", target: `order:${String(orderNo).slice(0, 80)}`, detail: { reason: "bad_order_no" } });
    return { ok: false, reason: "bad_order_no" };
  }
  const tid = parsed.tenantId;
  const [o] = await q(sql`SELECT pack_id, status, pg_mid FROM coin_orders WHERE tenant_id = ${tid} AND order_no = ${orderNo}`);
  const pack = await findPack(o?.pack_id ?? packIdOfCode(parsed.packCode));
  if (!pack) {
    await writeAudit({ tenantId: tid, action: "coin_purchase_failed", actorType: "system", riskLevel: "high", target: `order:${orderNo}`, detail: { reason: "unknown_pack", packId: o?.pack_id ?? null, packCode: parsed.packCode ?? null } });
    return { ok: false, tenantId: tid, reason: "unknown_pack" };
  }
  if (String(o?.status) === "paid") { const b = await balance(tid); return { ok: true, tenantId: tid, coins: pack.coins, bonus: 0, balance: b.balance, alreadyPaid: true }; }
  const { approveTrade } = await import("../kicc");
  const orderMid = o?.pg_mid ? String(o.pg_mid) : null;   // 거래등록 때 쓴 MID(§1.6) — 없으면 인증 MID 폴백
  const a = await approveTrade({ authorizationId, shopOrderNo: orderNo, mid: orderMid });
  if (!a.success) {
    await markOrder(tid, orderNo, "failed", { error: (a.errorMessage || a.errorCode || "approve_failed").slice(0, 300) });
    await writeAudit({ tenantId: tid, action: "coin_purchase_failed", actorType: "system", riskLevel: "medium", target: `order:${orderNo}`, detail: { packId: pack.id, errorCode: a.errorCode ?? null, error: a.errorMessage ?? null } });
    return { ok: false, tenantId: tid, reason: a.errorMessage || a.errorCode || "approve_failed" };
  }
  if (opts.verifyMsgAuth && !opts.verifyMsgAuth(a.raw, a.mallId ?? orderMid)) {
    // 서명 불일치 = «PG 는 승인했는데 서명만 다르다» — 코인을 넣지 않고 사람이 본다(AM classifyChargeFailure msgauth 규율).
    await writeAudit({ tenantId: tid, action: "coin_purchase_msgauth_mismatch", actorType: "system", riskLevel: "high", target: `order:${orderNo}`, detail: { pgTid: a.pgTid ?? null } });
    return { ok: false, tenantId: tid, reason: "msgauth_mismatch" };
  }
  const s = await settle(tid, orderNo, pack, a.pgTid ?? null, null, a.mallId ?? orderMid);
  return { ok: true, tenantId: tid, coins: pack.coins, bonus: s.bonus, balance: s.balance, alreadyPaid: s.already };
}
