/**
 * 코인 충전 API(계약 P1R4 §1.1 · DESIGN §12.1·§12.3):
 *   POST /api/coin-purchase-start { packId, agreePaidTerms? } → { ok, orderNo, mode:"oneclick"|"auth", pay?:{url,form}, amountKrw, vatKrw, totalKrw, coins, balance? }
 *   GET  /api/coin-charge-return?…KICC 콜백                    → 302 /app/coins.html?charged=orderNo | ?failed=사유
 *   GET  /api/coin-history?month=YYYY-MM                       → { ok, rows:[{ at, kind, amount, ref, expiresAt?, reason? }], balance:{ included, purchased, total } }
 *   POST /api/coin-refund-request { orderNo }                  → { ok, refundKrw, revoked, invoiceId } | { ok:false, reason:"used"|"window"|…, error }
 *   GET  /api/coin-packs                                        → { ok, packs:[{ id, krw, vatKrw, totalKrw, coins, bonusPct, oncePerTenant, available }], vatNote }
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
      const p = url.searchParams;
      const orderNo = p.get("shopOrderNo") || p.get("orderNo") || p.get("shop_order_no") || "";
      const authorizationId = p.get("authorizationId") || p.get("authorization_id") || "";
      if (!orderNo || !authorizationId) return redirect(`/app/coins.html?failed=${encodeURIComponent(p.get("resultMsg") || p.get("errorMessage") || "결제가 취소됐어요")}`);
      const verify = String(process.env.KICC_VERIFY_MSGAUTH ?? "") === "1" ? (await import("../../lib/kicc")).verifyMsgAuth : undefined;
      const r = await approveCoinPurchase(authorizationId, orderNo, { verifyMsgAuth: verify });
      return redirect(r.ok ? `/app/coins.html?charged=${encodeURIComponent(orderNo)}` : `/app/coins.html?failed=${encodeURIComponent(r.reason)}`);
    }

    const auth = requireUser(req); if (!auth.ok) return auth.res;
    const tid = auth.tid;

    if (path.endsWith("/coin-packs")) {
      const { packs } = await loadPacksAndTable();
      const used = await trialPackUsed(tid);
      return json({ ok: true, packs: packs.filter((p) => p.active).map((p) => ({ ...packView(p), available: !(p.oncePerTenant && used) })), vatNote: "부가세 별도" });
    }
    if (path.endsWith("/coin-history")) {
      const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "") ? url.searchParams.get("month")! : null;
      const rows = month
        ? await q(sql`SELECT kind, bucket, delta, item, ref, reason, expires_at, created_at FROM coin_ledger WHERE tenant_id = ${tid}
            AND to_char(created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = ${month} ORDER BY id DESC LIMIT 300`)
        : await q(sql`SELECT kind, bucket, delta, item, ref, reason, expires_at, created_at FROM coin_ledger WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 100`);
      const b = await balance(tid);
      return json({ ok: true, rows: rows.map((r) => {
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
      const r = await startCoinPurchase(tid, b.packId, { actorId: auth.user.uid, userAgent: req.headers.get("user-agent"), returnBase: process.env.SITE_URL });
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
