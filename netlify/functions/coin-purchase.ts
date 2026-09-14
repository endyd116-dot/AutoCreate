/**
 * 코인 충전 API(계약 P1R4 §1.1 · DESIGN §12.1·§12.3):
 *   POST /api/coin-purchase-start { packId, agreePaidTerms?, payRoute?:"keyin", keyin?:true } → { ok, orderNo, mode:"oneclick"|"auth", pay?:{url,form}, amountKrw, vatKrw, totalKrw, coins, balance? }
 *   GET|POST /api/coin-charge-return …KICC 콜백                → 302 /app/coins.html?charged=orderNo | ?failed=사유   🔴 KICC 는 **POST form** 으로 돌아온다(2026-09-15 실측 · lib/billing/callback.ts)
 *   GET  /api/coin-history?month=YYYY-MM                       → { ok, rows:[{ at, kind, amount, ref, expiresAt?, reason? }], balance:{ included, purchased, total }, orders:[{ orderNo, packId, coins, amountKrw, vatKrw, totalKrw, status, paidAt?, refundedAt?, refundable, refundDeadlineAt? }] }
 *        rows = 원장 움직임(내역 · 월별) · orders = 충전 주문(환불 요청 버튼의 근거 · 7일·미사용 판정은 quoteCoinRefund)
 *   POST /api/coin-refund-request { orderNo }                  → { ok, refundKrw, revoked, invoiceId } | { ok:false, reason:"used"|"window"|…, error }
 *   GET  /api/coin-packs                                        → { ok, packs:[{ id, krw, vatKrw, totalKrw, coins, bonusPct, oncePerTenant, available }], vatNote, keyin:{ available, label, notice } }
 *        keyin = «카드번호 직접 입력»(비인증 라인 · §1.6) 노출 여부 — 화면은 이 값만 보고 체크박스를 그린다(MID·정책 원본은 모른다).
 *   🔴 원격접속 중 충전·환불 403(denyIfImpersonating) · 결제 첫 회 유료 약관 재동의(agreePaidTerms) · KICC 없으면 no-op 정직(503 not_configured 아님 · 200 {ok:false, step:"not_configured"}).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, denyIfImpersonating } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { balance } from "../../lib/coin-ledger";
import { utcDate } from "../../lib/db-util";
import { startCoinPurchase, approveCoinPurchase, trialPackUsed } from "../../lib/billing/coin-purchase";
import { resolvePayRoute, keyinOption } from "../../lib/pay-route";
import { readKiccCallback, callbackAudit } from "../../lib/billing/callback";
import { parseCoinOrderNo } from "../../lib/billing/packs";
import { writeAudit } from "../../lib/audit";
import { executeCoinRefund, quoteCoinRefund } from "../../lib/billing/coin-refund";
import { loadPacksAndTable, packView } from "../../lib/billing/packs";
import { requirePaidTerms } from "../../lib/billing/consents";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/coin-purchase-start", "/api/coin-charge-return", "/api/coin-history", "/api/coin-refund-request", "/api/coin-packs"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);
const redirect = (to: string) => new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  try {
    /* ── 콜백(세션 없음 · 주문번호 되파싱) ── */
    if (path.endsWith("/coin-charge-return")) {
      const cb = await readKiccCallback(req);
      const orderNo = cb.orderNo, authorizationId = cb.authorizationId;
      // 🔴 어떤 경우에도 흔적을 남긴다(값 금지 · 이름만).
      const tid0 = orderNo ? parseCoinOrderNo(orderNo)?.tenantId ?? null : null;
      await writeAudit({ tenantId: tid0, action: "coin_charge_callback", actorType: "system", riskLevel: "medium", detail: callbackAudit(cb) });
      if (!orderNo || !authorizationId) return redirect(`/app/coins.html?failed=${encodeURIComponent(cb.resMsg || "결제가 취소됐어요")}&reason=params`);
      if (!cb.success) return redirect(`/app/coins.html?failed=${encodeURIComponent(cb.resMsg || "결제가 취소됐어요")}&reason=${encodeURIComponent(cb.resCd || "cancelled")}`);
      const verify = String(process.env.KICC_VERIFY_MSGAUTH ?? "") === "1" ? (await import("../../lib/kicc")).verifyMsgAuth : undefined;
      const r = await approveCoinPurchase(authorizationId, orderNo, { verifyMsgAuth: verify });
      return redirect(r.ok ? `/app/coins.html?charged=${encodeURIComponent(orderNo)}` : `/app/coins.html?failed=${encodeURIComponent(r.reason)}`);
    }

    const auth = requireUser(req); if (!auth.ok) return auth.res;
    const tid = auth.tid;

    if (path.endsWith("/coin-packs")) {
      const { packs } = await loadPacksAndTable();
      const used = await trialPackUsed(tid);
      return json({ ok: true, packs: packs.filter((p) => p.active).map((p) => ({ ...packView(p), available: !(p.oncePerTenant && used) })), vatNote: "부가세 별도", keyin: await keyinOption() });
    }
    if (path.endsWith("/coin-history")) {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month")! : null;
      const rows = month
        ? await q(sql`SELECT kind, bucket, delta, item, ref, reason, expires_at, created_at FROM coin_ledger WHERE tenant_id = ${tid}
            AND to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${month} ORDER BY id DESC LIMIT 300`)
        : await q(sql`SELECT kind, bucket, delta, item, ref, reason, expires_at, created_at FROM coin_ledger WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 100`);
      const b = await balance(tid);
      const orderRows = await q(sql`SELECT order_no, pack_id, krw, coins, vat_krw, total_krw, status, paid_at, refunded_at, created_at FROM coin_orders WHERE tenant_id = ${tid} AND status IN ('paid','refunded') ORDER BY id DESC LIMIT 50`);
      const orders: Record<string, unknown>[] = [];
      for (const r of orderRows) {
        const o: Record<string, unknown> = { orderNo: String(r.order_no), packId: String(r.pack_id), coins: n(r.coins), amountKrw: n(r.krw), vatKrw: n(r.vat_krw), totalKrw: n(r.total_krw) || n(r.krw) + n(r.vat_krw), status: String(r.status), createdAt: utcDate(r.created_at)?.toISOString() ?? "" };
        const pa = utcDate(r.paid_at); if (pa) o.paidAt = pa.toISOString();
        const ra = utcDate(r.refunded_at); if (ra) o.refundedAt = ra.toISOString();
        if (String(r.status) === "paid") { const qr = await quoteCoinRefund(tid, String(r.order_no)); o.refundable = qr.eligible; if (qr.refundDeadlineAt) o.refundDeadlineAt = qr.refundDeadlineAt; if (qr.eligible) o.refundKrw = qr.maxRefundKrw; else if (qr.reason) o.refundBlocked = qr.reason; }
        else o.refundable = false;
        orders.push(o);
      }
      return json({ ok: true, orders, rows: rows.map((r) => {
        const o: Record<string, unknown> = { at: utcDate(r.created_at)?.toISOString() ?? "", kind: String(r.kind), bucket: String(r.bucket), amount: n(r.delta) };
        if (r.item) o.item = String(r.item); if (r.ref) o.ref = String(r.ref); if (r.reason) o.reason = String(r.reason);
        const e = utcDate(r.expires_at); if (e) o.expiresAt = e.toISOString();
        return o;
      }), balance: { included: b.included, purchased: b.purchased, total: b.balance } });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const imp = denyIfImpersonating(auth.user); if (imp) return imp;   // 결제·충전은 본인만(§0)
    const b = await readJson<Record<string, unknown>>(req);

    if (path.endsWith("/coin-purchase-start")) {
      if (!await requirePaidTerms(tid, auth.user.uid, b.agreePaidTerms, { ip: clientIp(req), ua: req.headers.get("user-agent") })) return json({ ok: false, step: "paid_terms", error: "유료 약관에 동의해 주세요." }, 400);
      const r = await startCoinPurchase(tid, b.packId, { actorId: auth.user.uid, userAgent: req.headers.get("user-agent"), returnBase: process.env.SITE_URL, route: await resolvePayRoute(b) });
      if (!r.ok) return json({ ok: false, step: r.step, error: r.error, ...(r.orderNo ? { orderNo: r.orderNo } : {}), ...(r.amountKrw !== undefined ? { amountKrw: r.amountKrw, vatKrw: r.vatKrw, totalKrw: r.totalKrw } : {}) }, r.step === "pack" || r.step === "once" ? 400 : 200);
      return json(r);
    }
    if (path.endsWith("/coin-refund-request")) {
      const orderNo = String(b.orderNo ?? "").trim(); if (!orderNo) return badRequest("orderNo");
      if (b.quoteOnly === true) { const qt = await quoteCoinRefund(tid, orderNo); return json({ ok: true, quote: qt }); }
      const r = await executeCoinRefund(tid, orderNo, { actorId: auth.user.uid, actorType: "user", reason: String(b.reason ?? "고객 요청") });
      if (!r.ok) return json({ ok: false, step: r.step, reason: r.reason ?? r.step, error: r.error, ...(r.quote ? { quote: r.quote } : {}) }, r.step === "quote" ? 400 : 200);
      return json({ ok: true, refundKrw: r.refundKrw, revoked: r.revoked, invoiceId: r.invoiceId });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("coin_purchase", err); }
};
