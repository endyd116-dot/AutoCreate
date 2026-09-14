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
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { vatOf } from "../billing-math";
import { purchaseCoins, balance } from "../coin-ledger";
import { jsonb } from "../db-util";
import { activeBillingKey, tenantOwner } from "../subscription";
import { coinOrderNo, findPack, packIdOfCode, parseCoinOrderNo, type CoinPack } from "./packs";

const n = (v: unknown) => Number(v || 0);

export type StartResult =
  | { ok: true; orderNo: string; mode: "oneclick"; amountKrw: number; vatKrw: number; totalKrw: number; coins: number; balance: number; invoiceId: number | null }
  | { ok: true; orderNo: string; mode: "auth"; amountKrw: number; vatKrw: number; totalKrw: number; coins: number; pay: { url: string; form: Record<string, string> } }
  | { ok: false; step: "pack" | "once" | "not_configured" | "charge" | "tenant"; error: string; orderNo?: string; amountKrw?: number; vatKrw?: number; totalKrw?: number };

/** pack_trial 1회 한정(§0.1) — 이미 산 적 있으면 true. */
export async function trialPackUsed(tid: number): Promise<boolean> {
  const [r] = await q(sql`SELECT 1 FROM coin_orders WHERE tenant_id = ${tid} AND pack_id = 'pack_trial' AND status = 'paid' LIMIT 1`);
  return !!r;
}

/** «성공한 충전만» 영수증 1행(invoices kind='coin' · period=주문번호 · 멱등). */
async function recordCoinInvoice(tid: number, orderNo: string, pack: CoinPack, pgTid: string | null): Promise<number | null> {
  const vatKrw = vatOf(pack.krw);
  const [inv] = await q(sql`INSERT INTO invoices (tenant_id, kind, period, amount, vat_krw, total_krw, status, pg_ref, paid_at, order_no, detail)
    VALUES (${tid}, ${"coin"}, ${orderNo}, ${pack.krw}, ${vatKrw}, ${pack.krw + vatKrw}, ${"paid"}, ${pgTid}, NOW(), ${orderNo}, ${jsonb({ packId: pack.id, coins: pack.coins })})
    ON CONFLICT (tenant_id, kind, period) DO UPDATE SET status = 'paid', pg_ref = COALESCE(EXCLUDED.pg_ref, invoices.pg_ref), updated_at = NOW() RETURNING id`);
  return inv ? n(inv.id) : null;
}
async function markOrder(tid: number, orderNo: string, status: "paid" | "failed", extra: { pgTid?: string | null; error?: string | null } = {}): Promise<void> {
  await q(sql`UPDATE coin_orders SET status = ${status}, pg_ref = COALESCE(${extra.pgTid ?? null}, pg_ref), error = ${extra.error ?? null},
    paid_at = CASE WHEN ${status} = 'paid' THEN NOW() ELSE paid_at END, updated_at = NOW() WHERE tenant_id = ${tid} AND order_no = ${orderNo}`);
}

/** 결제 성공 뒤 «기입 + 영수증»(㉠·㉡ 공용 · 멱등). */
async function settle(tid: number, orderNo: string, pack: CoinPack, pgTid: string | null, actorId: number | null): Promise<{ balance: number; invoiceId: number | null; already: boolean }> {
  await markOrder(tid, orderNo, "paid", { pgTid });
  const invoiceId = await recordCoinInvoice(tid, orderNo, pack, pgTid);
  const p = await purchaseCoins(tid, pack.coins, orderNo, { actorId, reason: `코인 충전 ${pack.coins.toLocaleString("ko-KR")}개(₩${(pack.krw + vatOf(pack.krw)).toLocaleString("ko-KR")} · 유효 1년)` });
  await writeAudit({ tenantId: tid, action: "coin_purchase", actorType: actorId ? "user" : "system", actorId, target: `order:${orderNo}`, detail: { packId: pack.id, coins: pack.coins, krw: pack.krw, vatKrw: vatOf(pack.krw), pgTid, granted: p.granted, already: p.already, invoiceId } });
  return { balance: p.balance, invoiceId, already: p.already };
}

export async function startCoinPurchase(tid: number, packId: unknown, opts: { actorId: number; userAgent?: string | null; returnBase?: string }): Promise<StartResult> {
  const pack = await findPack(packId);
  if (!pack) return { ok: false, step: "pack", error: "충전 팩을 골라 주세요." };
  if (pack.oncePerTenant && await trialPackUsed(tid)) return { ok: false, step: "once", error: "첫 충전 팩은 한 번만 살 수 있어요. 다른 팩을 골라 주세요." };
  const vatKrw = vatOf(pack.krw), totalKrw = pack.krw + vatKrw;
  const { isKiccConfigured, chargeWithBillingKey, registerTrade, deviceTypeFromUA } = await import("../kicc");
  if (!isKiccConfigured()) return { ok: false, step: "not_configured", error: "결제 준비 중이에요 · 곧 열려요", amountKrw: pack.krw, vatKrw, totalKrw };
  const owner = await tenantOwner(tid);
  const orderNo = coinOrderNo(tid, pack.id);
  const goodsName = `AutoCreate 코인 ${pack.coins.toLocaleString("ko-KR")}개 충전`;
  const key = await activeBillingKey(tid);
  await q(sql`INSERT INTO coin_orders (tenant_id, pack_id, krw, coins, status, order_no, vat_krw, total_krw, mode)
    VALUES (${tid}, ${pack.id}, ${pack.krw}, ${pack.coins}, ${"pending"}, ${orderNo}, ${vatKrw}, ${totalKrw}, ${key ? "oneclick" : "auth"})`);

  if (key) {
    // ㉠ 원클릭 — 응답이 곧 결과.
    const r = await chargeWithBillingKey({ billingKey: key.billingKey, shopOrderNo: orderNo, amount: totalKrw, goodsName, customerName: owner.name, customerEmail: owner.email ?? undefined });
    if (!r.success) {
      await markOrder(tid, orderNo, "failed", { error: (r.errorMessage || r.errorCode || "charge_failed").slice(0, 300) });
      await writeAudit({ tenantId: tid, action: "coin_purchase_failed", actorType: "user", actorId: opts.actorId, riskLevel: "medium", target: `order:${orderNo}`, detail: { packId: pack.id, totalKrw, errorCode: r.errorCode ?? null, error: r.errorMessage ?? null } });
      return { ok: false, step: "charge", error: r.errorMessage || "카드 결제가 되지 않았어요. 카드 한도·유효기간을 확인해 주세요.", orderNo, amountKrw: pack.krw, vatKrw, totalKrw };
    }
    const s = await settle(tid, orderNo, pack, r.pgTid ?? null, opts.actorId);
    return { ok: true, orderNo, mode: "oneclick", amountKrw: pack.krw, vatKrw, totalKrw, coins: pack.coins, balance: s.balance, invoiceId: s.invoiceId };
  }
  // ㉡ 인증창 — 콜백에서 approveCoinPurchase.
  const base = (opts.returnBase || process.env.SITE_URL || "").replace(/\/$/, "");
  const r = await registerTrade({ shopOrderNo: orderNo, amount: totalKrw, goodsName, isBillingKey: false, returnUrl: `${base}/api/coin-charge-return`, customerName: owner.name, customerEmail: owner.email ?? undefined, deviceTypeCode: deviceTypeFromUA(opts.userAgent) });
  if (!r.success || !r.authPageUrl) {
    await markOrder(tid, orderNo, "failed", { error: (r.errorMessage || r.errorCode || "register_failed").slice(0, 300) });
    return { ok: false, step: "charge", error: r.errorMessage || "결제창을 열지 못했어요. 잠시 뒤 다시 해 주세요.", orderNo, amountKrw: pack.krw, vatKrw, totalKrw };
  }
  return { ok: true, orderNo, mode: "auth", amountKrw: pack.krw, vatKrw, totalKrw, coins: pack.coins, pay: { url: r.authPageUrl, form: {} } };
}

export type ApproveResult = { ok: true; tenantId: number; coins: number; balance: number; alreadyPaid: boolean } | { ok: false; tenantId?: number; reason: string };
/** ㉡ 콜백 — 승인 확정 → 기입. 같은 주문번호 재수신은 alreadyPaid(원장 유니크가 최종 보증). */
export async function approveCoinPurchase(authorizationId: string, orderNo: string, opts: { verifyMsgAuth?: (raw: unknown) => boolean } = {}): Promise<ApproveResult> {
  const parsed = parseCoinOrderNo(orderNo);
  if (!parsed) return { ok: false, reason: "bad_order_no" };
  const tid = parsed.tenantId;
  const [o] = await q(sql`SELECT pack_id, status FROM coin_orders WHERE tenant_id = ${tid} AND order_no = ${orderNo}`);
  const pack = await findPack(o?.pack_id ?? packIdOfCode(parsed.packCode));
  if (!pack) return { ok: false, tenantId: tid, reason: "unknown_pack" };
  if (String(o?.status) === "paid") { const b = await balance(tid); return { ok: true, tenantId: tid, coins: pack.coins, balance: b.balance, alreadyPaid: true }; }
  const { approveTrade } = await import("../kicc");
  const a = await approveTrade({ authorizationId, shopOrderNo: orderNo });
  if (!a.success) {
    await markOrder(tid, orderNo, "failed", { error: (a.errorMessage || a.errorCode || "approve_failed").slice(0, 300) });
    await writeAudit({ tenantId: tid, action: "coin_purchase_failed", actorType: "system", riskLevel: "medium", target: `order:${orderNo}`, detail: { packId: pack.id, errorCode: a.errorCode ?? null, error: a.errorMessage ?? null } });
    return { ok: false, tenantId: tid, reason: a.errorMessage || a.errorCode || "approve_failed" };
  }
  if (opts.verifyMsgAuth && !opts.verifyMsgAuth(a.raw)) {
    // 서명 불일치 = «PG 는 승인했는데 서명만 다르다» — 코인을 넣지 않고 사람이 본다(AM classifyChargeFailure msgauth 규율).
    await writeAudit({ tenantId: tid, action: "coin_purchase_msgauth_mismatch", actorType: "system", riskLevel: "high", target: `order:${orderNo}`, detail: { pgTid: a.pgTid ?? null } });
    return { ok: false, tenantId: tid, reason: "msgauth_mismatch" };
  }
  const s = await settle(tid, orderNo, pack, a.pgTid ?? null, null);
  return { ok: true, tenantId: tid, coins: pack.coins, balance: s.balance, alreadyPaid: s.already };
}
