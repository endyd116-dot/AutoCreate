/**
 * 영수증·세금계산서(계약 P1R6 §1.2 · DESIGN §11.4). 고객 본인 테넌트만(타 테넌트 id 는 404 · IDOR 봉쇄).
 *   GET  /api/invoice?id=                     → { ok, invoice:{ id, kind, period, amountKrw, vatKrw, totalKrw, status, createdAt, paidAt?, refundedKrw?, orderNo?, planKey?, taxInvoice }, supplier }
 *        supplier = 운영센터 «회사 정보»(§1.3 · ops_settings.company) · 상호·사업자번호가 없으면 **null**(화면 «준비 중» 한 줄 · 금액·결제일은 그대로).
 *        화면: public/receipt.html(영수증 페이지) · public/app/plan.html(taxInvoice{status,issuedAt,url}).
 *   GET  /api/tax-profile                     → { ok, profile:{ bizNo, bizName, email } | null }   (한 번 적으면 다음 청구서부터 자동)
 *   POST /api/tax-profile { bizNo, bizName, email } → { ok, profile }   · 400 step:"bizNo"|"bizName"|"email"
 *   POST /api/tax-invoice-request { invoiceId, bizNo, bizName, email } → { ok, invoiceId, taxInvoice, already } · 400 step 칸 이름 | "status" · 404 not_found
 *        요청 = invoices.tax_status requested + 사업자 스냅샷(tax_biz) + 프로필 갱신 + 운영 CS 티켓 1건(멱등) + 감사. 실발급은 운영센터 «발행됨»(ops-billing).
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { utcDate } from "../../lib/db-util";
import { readCompany, supplierOf } from "../../lib/ops/company";
import { taxInvoiceOf, validateTaxInput, readTaxProfile, writeTaxProfile, requestTaxInvoice } from "../../lib/billing/tax";

export const config = { path: ["/api/invoice", "/api/tax-profile", "/api/tax-invoice-request"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

/** invoices 1행 → 고객 화면 모양(`/api/invoices` 의 rows 와 같은 키 + taxInvoice). */
export function customerInvoiceRow(r: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = { id: n(r.id), kind: String(r.kind), period: String(r.period), amountKrw: n(r.amount), vatKrw: n(r.vat_krw), totalKrw: n(r.total_krw) || n(r.amount) + n(r.vat_krw), status: String(r.status), createdAt: utcDate(r.created_at)?.toISOString() ?? "" };
  const pa = utcDate(r.paid_at); if (pa) o.paidAt = pa.toISOString();
  if (n(r.refunded_krw)) o.refundedKrw = n(r.refunded_krw);
  if (r.order_no) o.orderNo = String(r.order_no); if (r.plan_key) o.planKey = String(r.plan_key);
  o.taxInvoice = taxInvoiceOf(r);
  return o;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid; const uid = Number(auth.user.uid);
  try {
    if (path.endsWith("/invoice")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const id = n(url.searchParams.get("id")); if (!id) return badRequest("id");
      const [r] = await q(sql`SELECT id, kind, period, amount, vat_krw, total_krw, status, paid_at, refunded_krw, order_no, plan_key, created_at, tax_status, tax_doc_requested_at, tax_issued_at, tax_url
        FROM invoices WHERE id = ${id} AND tenant_id = ${tid}`);
      if (!r) return json({ ok: false, error: "청구서를 찾을 수 없어요.", step: "not_found" }, 404);
      const supplier = supplierOf(await readCompany());
      return json({ ok: true, invoice: customerInvoiceRow(r), supplier });
    }
    if (path.endsWith("/tax-profile")) {
      if (req.method === "GET") return json({ ok: true, profile: await readTaxProfile(tid) });
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const v = validateTaxInput(await readJson(req));
      if (!v.ok) return badRequest(v.error, v.step);
      return json({ ok: true, profile: await writeTaxProfile(tid, v.profile, uid) });
    }
    if (path.endsWith("/tax-invoice-request")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<Record<string, unknown>>(req);
      const invoiceId = n(b.invoiceId); if (!invoiceId) return badRequest("invoiceId");
      const v = validateTaxInput(b);
      if (!v.ok) return badRequest(v.error, v.step);
      const r = await requestTaxInvoice(tid, invoiceId, v.profile, { actorId: uid, ip: clientIp(req) });
      if (!r.ok) return json({ ok: false, error: r.error, step: r.step }, r.status ?? 400);
      return json({ ok: true, invoiceId: r.invoiceId, taxInvoice: r.taxInvoice, already: r.already });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("invoice", err); }
};
