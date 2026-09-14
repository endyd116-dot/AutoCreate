/**
 * lib/billing/coin-refund.ts — 코인 충전 환불 **판정 + 실행**(계약 §1.1 환불 5규칙 · §2.1 ops-refund · DESIGN §12.3 청약철회 7일).
 *   AM 원본: ../AutoMarketing/lib/coin-refund.ts(quoteCoinRefund §152 · revokeCoinPurchase §210) (이식 2026-09-14 · 표 이름만 AC)
 *
 *   ══ 5규칙(AM 그대로) ══
 *     ① 환불 가능액 = **아직 안 쓴 코인**뿐(쓴 코인은 결과물로 나갔고 원가도 나갔다)
 *     ② 회수량 ≤ 잔량 → 음수가 구조적으로 불가(원장 계약 ②)
 *     ③ **7일 룰이 미사용분보다 먼저** 걸린다 — 충전 후 7일이 지나면 미사용분이 있어도 환불하지 않는다(예외 없음)
 *     ④ 단가 = 그 주문의 **실제 결제액 ÷ 그 주문으로 받은 코인 수** — 표를 읽지 않는다(오늘 표로 어제를 재지 않는다)
 *     ⑤ 부분 환불 없음 = 미사용분 전량 1회(회수 행 멱등 키가 주문당 하나라 둘째 회수를 적을 자리가 없다)
 *   ══ 순서(호출부가 아니라 여기서 못 박는다) ══
 *     견적 → **PG 취소 성공** → 원장 회수(revokeCoins) → 인보이스 refunded_krw · coin_orders.refunded_at → 감사. 취소가 실패하면 원장을 건드리지 않는다.
 *     KICC 없으면 no-op 정직(`not_configured`). 완전 미사용(usedCoins 0)이면 전액, 1개라도 썼으면 잔량 비례 **내림**.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { readPurchasedLots, lotOfOrder, revokeCoins } from "../coin-ledger";
import { utcDate } from "../db-util";
import { isCoinOrderNo } from "./packs";

const n = (v: unknown) => Number(v || 0);
/** 확정 — 충전 후 환불 가능 기간(일). 전상법 청약철회 7일과 같은 창. */
export const COIN_REFUND_WINDOW_DAYS = 7;
export type RefundReason = "not_coin_order" | "not_paid" | "already_refunded" | "window" | "used" | "no_lot";
export interface RefundQuote {
  eligible: boolean; reason: RefundReason | null; orderNo: string;
  packKrw: number; vatKrw: number; totalKrw: number; packCoins: number; unitKrw: number;
  usedCoins: number; unusedCoins: number; maxRefundKrw: number;
  purchasedAt: string | null; refundDeadlineAt: string | null; invoiceId: number | null;
}
const NO = (orderNo: string, reason: RefundReason, base: Partial<RefundQuote> = {}): RefundQuote => ({
  eligible: false, reason, orderNo, packKrw: 0, vatKrw: 0, totalKrw: 0, packCoins: 0, unitKrw: 0, usedCoins: 0, unusedCoins: 0, maxRefundKrw: 0, purchasedAt: null, refundDeadlineAt: null, invoiceId: null, ...base,
});

/** 견적(읽기 전용 · 화면 «환불 요청» 버튼과 운영 «환불» 둘 다 이걸 본다). */
export async function quoteCoinRefund(tid: number, orderNo: string, now = new Date()): Promise<RefundQuote> {
  if (!isCoinOrderNo(orderNo)) return NO(orderNo, "not_coin_order");
  const [inv] = await q(sql`SELECT id, amount, vat_krw, total_krw, refunded_krw, status, paid_at FROM invoices WHERE tenant_id = ${tid} AND kind = 'coin' AND period = ${orderNo}`);
  if (!inv || String(inv.status) !== "paid" && String(inv.status) !== "refunded") return NO(orderNo, "not_paid");
  if (String(inv.status) === "refunded" || n(inv.refunded_krw) > 0) return NO(orderNo, "already_refunded", { invoiceId: n(inv.id) });
  const lot = lotOfOrder(await readPurchasedLots(tid, now), orderNo);
  if (!lot) return NO(orderNo, "no_lot", { invoiceId: n(inv.id) });
  const paidAt = utcDate(inv.paid_at);
  const purchasedMs = paidAt ? paidAt.getTime() : Date.parse(lot.createdAt) || 0;
  const deadlineMs = purchasedMs ? purchasedMs + COIN_REFUND_WINDOW_DAYS * 86400_000 : 0;
  const within = deadlineMs > 0 && now.getTime() <= deadlineMs;
  const packCoins = lot.granted, unusedCoins = Math.max(0, lot.remaining), usedCoins = Math.max(0, packCoins - lot.revoked - unusedCoins);
  const packKrw = n(inv.amount), vatKrw = n(inv.vat_krw), totalKrw = n(inv.total_krw) || packKrw + vatKrw;
  const unitKrw = packCoins > 0 ? totalKrw / packCoins : 0;   // 단가 = 실제 결제액(부가세 포함) ÷ 받은 코인
  const maxRefundKrw = usedCoins === 0 ? totalKrw : Math.floor(unusedCoins * unitKrw);   // 미사용이면 전액(청약철회) · 썼으면 비례 내림
  const base: Partial<RefundQuote> = { packKrw, vatKrw, totalKrw, packCoins, unitKrw, usedCoins, unusedCoins, maxRefundKrw, purchasedAt: purchasedMs ? new Date(purchasedMs).toISOString() : null, refundDeadlineAt: deadlineMs ? new Date(deadlineMs).toISOString() : null, invoiceId: n(inv.id) };
  if (!within) return NO(orderNo, "window", base);            // ③ 7일 룰이 먼저
  if (unusedCoins <= 0 || maxRefundKrw <= 0) return NO(orderNo, "used", base);
  return { ...NO(orderNo, "no_lot", base), eligible: true, reason: null };
}

export type RefundExec = { ok: true; refundKrw: number; revoked: number; invoiceId: number | null; alreadyRevoked: boolean } | { ok: false; step: "quote" | "not_configured" | "pg" | "ledger"; reason?: RefundReason; error: string; quote?: RefundQuote };
/** 실행 — 취소가 성공한 뒤에만 회수한다. 운영자·고객 둘 다 이 함수. */
export async function executeCoinRefund(tid: number, orderNo: string, opts: { actorId: number | null; actorType: "user" | "operator"; reason?: string }, now = new Date()): Promise<RefundExec> {
  const quote = await quoteCoinRefund(tid, orderNo, now);
  if (!quote.eligible) return { ok: false, step: "quote", reason: quote.reason ?? "no_lot", error: refundReasonKo(quote.reason ?? "no_lot"), quote };
  const { isKiccConfigured, cancelPayment } = await import("../kicc");
  if (!isKiccConfigured()) return { ok: false, step: "not_configured", error: "결제 준비 중이라 환불도 아직이에요 · 곧 열려요", quote };
  const [inv] = await q(sql`SELECT pg_ref FROM invoices WHERE id = ${quote.invoiceId}`);
  const pgTid = String(inv?.pg_ref ?? "");
  if (!pgTid) return { ok: false, step: "pg", error: "결제 기록(PG 번호)이 없어 환불하지 못했어요. 문의해 주세요.", quote };
  // KICC revise: 전액 = 40(amount 없음) · 부분 = 32(amount) — AM deposit.ts 관례.
  const full = quote.maxRefundKrw >= quote.totalKrw;
  const c = await cancelPayment({ pgTid, reviseTypeCode: full ? "40" : "32", amount: full ? undefined : quote.maxRefundKrw, reason: (opts.reason ?? "코인 충전 환불").slice(0, 100) });
  if (!c.success) {
    await writeAudit({ tenantId: tid, action: "coin_refund_failed", actorType: opts.actorType, actorId: opts.actorId, riskLevel: "medium", target: `order:${orderNo}`, detail: { refundKrw: quote.maxRefundKrw, errorCode: c.errorCode ?? null, error: c.errorMessage ?? null } });
    return { ok: false, step: "pg", error: c.errorMessage || "카드사 취소가 되지 않았어요. 잠시 뒤 다시 해 주세요.", quote };
  }
  const rv = await revokeCoins(tid, orderNo, `환불 회수(₩${quote.maxRefundKrw.toLocaleString("ko-KR")} · 미사용 ${quote.unusedCoins}코인)`, opts.actorId);
  if (!rv.ok) return { ok: false, step: "ledger", error: "돈은 취소됐는데 코인 회수가 실패했어요 — 운영자가 확인해요.", quote };   // 이 상태는 감사로 남겨 사람이 본다
  await q(sql`UPDATE invoices SET refunded_krw = refunded_krw + ${quote.maxRefundKrw}, status = CASE WHEN refunded_krw + ${quote.maxRefundKrw} >= COALESCE(total_krw, amount + vat_krw) THEN 'refunded' ELSE status END, updated_at = NOW() WHERE id = ${quote.invoiceId}`);
  await q(sql`UPDATE coin_orders SET refunded_at = NOW(), updated_at = NOW() WHERE tenant_id = ${tid} AND order_no = ${orderNo}`);
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"coin_refunded"}, ${"환불이 처리됐어요"}, ${`${quote.maxRefundKrw.toLocaleString("ko-KR")}원을 돌려드렸어요(미사용 ${quote.unusedCoins}코인 회수). 카드사 사정에 따라 3~5일 걸릴 수 있어요.`}, ${"/app/coins.html"})`);
  await writeAudit({ tenantId: tid, action: "coin_refund", actorType: opts.actorType, actorId: opts.actorId, riskLevel: "high", target: `order:${orderNo}`,
    detail: { refundKrw: quote.maxRefundKrw, revoked: rv.revoked, alreadyRevoked: rv.alreadyRevoked, unusedCoins: quote.unusedCoins, usedCoins: quote.usedCoins, unitKrw: quote.unitKrw, pgTid, invoiceId: quote.invoiceId } });
  return { ok: true, refundKrw: quote.maxRefundKrw, revoked: rv.revoked, invoiceId: quote.invoiceId, alreadyRevoked: rv.alreadyRevoked };
}

export function refundReasonKo(r: RefundReason): string {
  return ({ not_coin_order: "충전 주문이 아니에요.", not_paid: "결제가 끝난 주문이 아니에요.", already_refunded: "이미 환불된 주문이에요.",
    window: `충전 후 ${COIN_REFUND_WINDOW_DAYS}일이 지나 환불할 수 없어요.`, used: "코인을 모두 써서 돌려드릴 게 없어요.", no_lot: "충전 기록을 찾지 못했어요." } as Record<RefundReason, string>)[r];
}
