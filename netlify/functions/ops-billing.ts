/**
 * 운영센터 · 결제 메뉴(계약 §2.1 `ops-billing.ts` · §2.4(4) 행 모양 · DESIGN §11.4). 권한: admin 이상(§0.2 «결제»).
 *   GET  /api/ops-invoices?status&month&kind&tenantId&page → { ok, invoices:[Invoice], total, page }     (month = KST 'YYYY-MM' · paid_at 우선, 없으면 created_at)
 *   POST /api/ops-invoice-retry { id }                    → 실패한 구독 인보이스 재청구(chargeTenant · source ops · applyChargeResult 한 벌) · KICC 없으면 정직 not_configured
 *   POST /api/ops-refund { orderNo, amountKrw?, reason? } → 코인 주문(AC-COIN-) = lib/billing/coin-refund(미사용분 비례 · 회수) · 구독 주문 = resolveRefund(부분·전액) → KICC 취소 → refunded_krw
 *   GET  /api/ops-billing-keys?q&page                     → { ok, keys:[BillingKey], total, page }
 *   GET  /api/ops-receivables                             → { ok, receivables:[Receivable], total, overdueKrw }   실패 뒤 아직 안 걷힌 구독 청구(테넌트별 합)
 *   POST /api/ops-tax-invoice { invoiceId, kind?:"tax_invoice"|"cash_receipt", note? } → 요청 기록(tax_doc_requested_at · detail.taxDoc) — 실발급은 KICC 키 뒤
 *   🔴 돈 계산은 billing-math(resolveRefund) · 금액 3개(amount·vat·total) 따로 · 청구 상태 갱신은 applyChargeResult 한 벌(재시도도 chargeTenant 를 통해).
 */
import { sql, type SQL } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { jsonb, utcDate } from "../../lib/db-util";
import { resolveRefund } from "../../lib/billing-math";
import { chargeTenant, readLedger, type Cycle } from "../../lib/subscription";
import { executeCoinRefund } from "../../lib/billing/coin-refund";
import { isCoinOrderNo } from "../../lib/billing/packs";
import { kstMonthRange, pageOf, within } from "../../lib/ops/period";

export const config = { path: ["/api/ops-invoices", "/api/ops-invoice-retry", "/api/ops-refund", "/api/ops-billing-keys", "/api/ops-receivables", "/api/ops-tax-invoice"] };
const n = (v: unknown) => Number(v || 0);
const iso = (v: unknown) => utcDate(v)?.toISOString();
const INVOICE_STATUSES = ["paid", "failed", "pending", "refunded"];

/** invoices 1행(+tenant_name) → 계약 §2.4(4) Invoice. total 이 NULL 인 옛 행은 amount+vat 로. */
function invoiceRow(r: Record<string, unknown>): Record<string, unknown> {
  const detail = (r.detail && typeof r.detail === "object" ? r.detail : {}) as Record<string, unknown>;
  const o: Record<string, unknown> = {
    id: n(r.id), tenantId: n(r.tenant_id), tenantName: String(r.tenant_name ?? ""), kind: String(r.kind), period: String(r.period),
    amountKrw: n(r.amount), vatKrw: n(r.vat_krw), totalKrw: r.total_krw === null || r.total_krw === undefined ? n(r.amount) + n(r.vat_krw) : n(r.total_krw),
    status: String(r.status), attempts: n(r.attempts), createdAt: iso(r.created_at) ?? "",
  };
  const pa = iso(r.paid_at); if (pa) o.paidAt = pa;
  if (String(r.status) === "failed") { const fa = iso(r.updated_at) ?? iso(r.created_at); if (fa) o.failedAt = fa; }
  const nr = iso(r.next_retry_at); if (nr) o.nextRetryAt = nr;
  if (typeof detail.receiptUrl === "string" && detail.receiptUrl) o.receiptUrl = detail.receiptUrl;
  if (n(r.refunded_krw) > 0) o.refundedKrw = n(r.refunded_krw);
  if (r.order_no) o.orderNo = String(r.order_no);
  if (r.plan_key) o.planKey = String(r.plan_key);
  if (r.last_error) o.lastError = String(r.last_error).slice(0, 200);
  const td = iso(r.tax_doc_requested_at); if (td) o.taxDocRequestedAt = td;
  return o;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
  const o = requireAdmin(req, ["admin", "super_admin"]); if (!o.ok) return o.res;
  const ip = clientIp(req);
  try {
    /* ── 인보이스 목록 ── */
    if (path.endsWith("/ops-invoices")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const status = (url.searchParams.get("status") || "").trim();
      if (status && !INVOICE_STATUSES.includes(status)) return badRequest("status");
      const kind = (url.searchParams.get("kind") || "").trim();
      const tenantId = n(url.searchParams.get("tenantId"));
      const monthParam = url.searchParams.get("month");
      const { page, size, offset } = pageOf(url);
      let where: SQL = sql`(${status} = '' OR i.status = ${status}) AND (${kind} = '' OR i.kind = ${kind}) AND (${tenantId} = 0 OR i.tenant_id = ${tenantId})`;
      if (monthParam) { const r = kstMonthRange(monthParam); where = sql`${where} AND ${within(sql`COALESCE(i.paid_at, i.created_at)`, r)}`; }
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM invoices i WHERE ${where}`);
      const rows = await q(sql`SELECT i.*, t.name AS tenant_name FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE ${where} ORDER BY i.id DESC LIMIT ${size} OFFSET ${offset}`);
      return json({ ok: true, invoices: rows.map(invoiceRow), total: n(cnt?.c), page, size });
    }

    /* ── 빌키 목록 ── */
    if (path.endsWith("/ops-billing-keys")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const s = (url.searchParams.get("q") || "").trim().toLowerCase();
      const { page, size, offset } = pageOf(url);
      const where: SQL = sql`(${s} = '' OR LOWER(t.name) LIKE ${"%" + s + "%"} OR LOWER(t.key) LIKE ${"%" + s + "%"} OR k.last4 = ${s})`;
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM billing_keys k JOIN tenants t ON t.id = k.tenant_id WHERE ${where}`);
      const rows = await q(sql`SELECT k.id, k.tenant_id, t.name AS tenant_name, k.brand, k.last4, k.card_label, k.active, k.removed_at, k.card_fp, k.created_at
        FROM billing_keys k JOIN tenants t ON t.id = k.tenant_id WHERE ${where} ORDER BY k.active DESC, k.id DESC LIMIT ${size} OFFSET ${offset}`);
      const keys = rows.map((r) => {
        const k: Record<string, unknown> = { id: n(r.id), tenantId: n(r.tenant_id), tenantName: String(r.tenant_name ?? ""), brand: String(r.brand ?? r.card_label ?? ""), last4: String(r.last4 ?? ""), active: r.active === true && !r.removed_at, updatedAt: iso(r.removed_at) ?? iso(r.created_at) ?? "" };
        if (r.card_fp) k.cardFp = String(r.card_fp).slice(0, 12);   // 지문 앞 12자만(같은 카드 판별용 · 전체 노출 불필요)
        return k;
      });
      return json({ ok: true, keys, total: n(cnt?.c), page, size });
    }

    /* ── 미수 ── */
    if (path.endsWith("/ops-receivables")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const rows = await q(sql`SELECT i.tenant_id, t.name AS tenant_name, t.status AS tenant_status,
          SUM(COALESCE(i.total_krw, i.amount + i.vat_krw)) AS overdue_krw, MIN(i.created_at) AS since, MAX(i.attempts) AS attempts,
          (SELECT last_error FROM invoices x WHERE x.tenant_id = i.tenant_id AND x.status = 'failed' ORDER BY x.updated_at DESC LIMIT 1) AS last_error,
          (SELECT next_retry_at FROM invoices x WHERE x.tenant_id = i.tenant_id AND x.status = 'failed' ORDER BY x.updated_at DESC LIMIT 1) AS next_retry_at
        FROM invoices i JOIN tenants t ON t.id = i.tenant_id WHERE i.kind = 'subscription' AND i.status = 'failed'
        GROUP BY i.tenant_id, t.name, t.status ORDER BY since`);
      const now = Date.now();
      const receivables = rows.map((r) => {
        const since = utcDate(r.since);
        const x: Record<string, unknown> = { tenantId: n(r.tenant_id), tenantName: String(r.tenant_name ?? ""), tenantStatus: String(r.tenant_status ?? ""), overdueKrw: n(r.overdue_krw), overdueDays: since ? Math.max(0, Math.floor((now - since.getTime()) / 86400_000)) : 0, attempts: n(r.attempts), lastFailReason: String(r.last_error ?? "").slice(0, 200) };
        const nr = iso(r.next_retry_at); if (nr) x.nextRetryAt = nr;
        return x;
      });
      return json({ ok: true, receivables, total: receivables.length, overdueKrw: receivables.reduce((a, r) => a + n(r.overdueKrw), 0) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    /* ── 실패 인보이스 재청구 ── */
    if (path.endsWith("/ops-invoice-retry")) {
      const b = await readJson<{ id?: number }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const [inv] = await q(sql`SELECT * FROM invoices WHERE id = ${id}`);
      if (!inv) return json({ ok: false, error: "인보이스가 없어요.", step: "not_found" }, 404);
      if (String(inv.kind) !== "subscription") return badRequest("구독 인보이스만 재청구할 수 있어요(코인은 고객이 다시 충전해요).", "kind");
      if (String(inv.status) !== "failed") return badRequest("실패한 인보이스만 재청구할 수 있어요.", "status");
      const tid = n(inv.tenant_id);
      const detail = (inv.detail && typeof inv.detail === "object" ? inv.detail : {}) as Record<string, unknown>;
      const cycle: Cycle = detail.cycle === "year" ? "year" : "month";
      const ledger = await readLedger(tid);
      const period = String(inv.period);
      const isUpgrade = period.includes(":up-");
      const r = await chargeTenant(tid, { planKey: String(inv.plan_key ?? ledger?.planKey ?? ""), cycle, period, supplyKrw: n(inv.amount), attempt: n(inv.attempts) + 1, source: "ops", periodStart: ledger?.periodStart ?? undefined, keepPeriod: isUpgrade, actorId: o.ops.oid });
      await writeAudit({ tenantId: tid, action: "ops_invoice_retry", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", target: `invoice:${id}`, detail: { period, attempt: n(inv.attempts) + 1, ok: r.ok, notConfigured: !!r.notConfigured, noBillingKey: !!r.noBillingKey, error: r.error ?? null, suspended: !!r.suspended } });
      if (r.notConfigured) return json({ ok: false, step: "not_configured", error: r.error ?? "결제 준비 중이에요 · 곧 열려요" });
      if (r.noBillingKey) return json({ ok: false, step: "billing_key", error: "고객에게 등록된 결제 수단이 없어요." }, 400);
      return json({ ok: r.ok, step: r.ok ? undefined : "charge", error: r.error, invoiceId: r.invoiceId, status: r.status, suspended: !!r.suspended, totalKrw: r.totalKrw });
    }

    /* ── 환불 ── */
    if (path.endsWith("/ops-refund")) {
      const b = await readJson<{ orderNo?: string; amountKrw?: number; reason?: string }>(req);
      const orderNo = String(b.orderNo ?? "").trim(); if (!orderNo) return badRequest("orderNo");
      const reason = (b.reason || "운영자 환불").slice(0, 100);
      if (isCoinOrderNo(orderNo)) {
        const [co] = await q(sql`SELECT tenant_id FROM coin_orders WHERE order_no = ${orderNo}`);
        if (!co) return json({ ok: false, error: "주문이 없어요.", step: "not_found" }, 404);
        const r = await executeCoinRefund(n(co.tenant_id), orderNo, { actorId: o.ops.oid, actorType: "operator", reason });
        if (!r.ok) return json({ ok: false, step: r.step, reason: r.reason, error: r.error, ...(r.quote ? { quote: r.quote } : {}) }, r.step === "not_configured" ? 200 : 400);
        return json({ ok: true, kind: "coin", refundKrw: r.refundKrw, revoked: r.revoked, invoiceId: r.invoiceId });
      }
      // 구독 인보이스 — 부분/전액(resolveRefund) · PG 취소 성공 뒤에만 장부.
      const [inv] = await q(sql`SELECT * FROM invoices WHERE order_no = ${orderNo} AND kind = 'subscription'`);
      if (!inv) return json({ ok: false, error: "주문이 없어요.", step: "not_found" }, 404);
      if (!["paid", "refunded"].includes(String(inv.status))) return badRequest("결제된 인보이스만 환불할 수 있어요.", "status");
      const total = inv.total_krw === null || inv.total_krw === undefined ? n(inv.amount) + n(inv.vat_krw) : n(inv.total_krw);
      const rr = resolveRefund(total, n(inv.refunded_krw), b.amountKrw !== undefined && b.amountKrw !== null ? n(b.amountKrw) : undefined);
      if (!rr.ok) return json({ ok: false, step: "amount", error: rr.error, refundable: rr.refundable }, 400);
      const { isKiccConfigured, cancelPayment } = await import("../../lib/kicc");
      if (!isKiccConfigured()) return json({ ok: false, step: "not_configured", error: "결제 준비 중이라 환불도 아직이에요 · 곧 열려요", refundKrw: rr.refund });
      const pgTid = String(inv.pg_ref ?? ""); if (!pgTid) return json({ ok: false, step: "pg", error: "PG 거래번호가 없어 취소할 수 없어요." }, 400);
      const fullFromZero = rr.full && n(inv.refunded_krw) === 0;   // KICC revise: 전액 40(amount 없음) · 부분 32(amount) — AM deposit.ts 관례
      const c = await cancelPayment({ pgTid, reviseTypeCode: fullFromZero ? "40" : "32", amount: fullFromZero ? undefined : rr.refund, reason });
      const tid = n(inv.tenant_id);
      if (!c.success) {
        await writeAudit({ tenantId: tid, action: "subscription_refund_failed", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "medium", target: `order:${orderNo}`, detail: { refundKrw: rr.refund, errorCode: c.errorCode ?? null, error: c.errorMessage ?? null } });
        return json({ ok: false, step: "pg", error: c.errorMessage || "카드사 취소가 되지 않았어요." }, 400);
      }
      await q(sql`UPDATE invoices SET refunded_krw = ${rr.newRefunded}, status = ${rr.full ? "refunded" : "paid"}, updated_at = NOW() WHERE id = ${n(inv.id)}`);
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"subscription_refunded"}, ${"환불이 처리됐어요"}, ${`${rr.refund.toLocaleString("ko-KR")}원을 돌려드렸어요. 카드사 사정에 따라 3~5일 걸릴 수 있어요.`}, ${"/app/plan.html"})`);
      await writeAudit({ tenantId: tid, action: "subscription_refund", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", target: `order:${orderNo}`, detail: { refundKrw: rr.refund, newRefunded: rr.newRefunded, full: rr.full, pgTid, invoiceId: n(inv.id), reason } });
      return json({ ok: true, kind: "subscription", refundKrw: rr.refund, refundedKrw: rr.newRefunded, full: rr.full, invoiceId: n(inv.id) });
    }

    /* ── 세금계산서/현금영수증 요청 기록 ── */
    if (path.endsWith("/ops-tax-invoice")) {
      const b = await readJson<{ invoiceId?: number; kind?: string; note?: string }>(req);
      const id = n(b.invoiceId); if (!id) return badRequest("invoiceId");
      const kind = b.kind === "cash_receipt" ? "cash_receipt" : "tax_invoice";
      const [inv] = await q(sql`SELECT id, tenant_id, status, detail FROM invoices WHERE id = ${id}`);
      if (!inv) return json({ ok: false, error: "인보이스가 없어요.", step: "not_found" }, 404);
      if (String(inv.status) !== "paid") return badRequest("결제된 인보이스만 요청할 수 있어요.", "status");
      const taxDoc = { kind, requestedBy: o.ops.oid, note: String(b.note ?? "").slice(0, 300), status: "requested" };
      await q(sql`UPDATE invoices SET tax_doc_requested_at = COALESCE(tax_doc_requested_at, NOW()), detail = COALESCE(detail, '{}'::jsonb) || ${jsonb({ taxDoc })}, updated_at = NOW() WHERE id = ${id}`);
      const [chk] = await q(sql`SELECT jsonb_typeof(detail) AS t FROM invoices WHERE id = ${id}`);
      if (chk && chk.t !== "object") console.error("[ops-billing] invoices.detail jsonb_typeof 이상", chk);   // PITFALLS #1
      await writeAudit({ tenantId: n(inv.tenant_id), action: "ops_tax_doc_request", actorType: "operator", actorId: o.ops.oid, ip, target: `invoice:${id}`, detail: taxDoc });
      return json({ ok: true, invoiceId: id, taxDoc, issued: false, note: "실발급은 KICC 키 등록 뒤에 열려요 — 지금은 요청만 기록했어요." });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("ops_billing", err); }
};
