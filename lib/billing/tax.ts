/**
 * lib/billing/tax.ts — 세금계산서(계약 P1R6 §1.2 · DESIGN §11.4). 청구서의 taxInvoice 모양 · 프로필(다음부터 자동) · 요청 · 발급 표시.
 *   상태 = invoices.tax_status none | requested | issued(0013). 요청 시각은 R4 의 tax_doc_requested_at(중복 칸 없음) · 발급 tax_issued_at · 문서 tax_url · 요청 시점 사업자 스냅샷 tax_biz.
 *   프로필 = tenants.settings.taxProfile { bizNo, bizName, email } — 한 번 적으면 다음 청구서부터 그대로(화면이 채워 보여준다).
 *   실발급(홈택스 전자세금계산서)은 사람이 한다: 운영센터 «발행됨» 처리(`POST /api/ops-tax-invoice { status:"issued", url? }`) → 화면 «발행됨» 필 + 문서 열기.
 *   운영센터 R4 호환: detail.taxDoc 도 같이 적는다(ops-billing 이 읽던 자리) · 감사 `tax_invoice_request`(고객) · `ops_tax_doc_issued`(운영자).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { jsonb, utcDate } from "../db-util";
import { createTicket } from "../cs";

const n = (v: unknown) => Number(v || 0);
export type TaxStatus = "none" | "requested" | "issued";
export interface TaxInvoiceView { status: TaxStatus; requestedAt?: string; issuedAt?: string; url?: string }
export interface TaxProfile { bizNo: string; bizName: string; email: string }
export const TAX_PROFILE_KEY = "taxProfile";

/** invoices 1행 → 화면의 taxInvoice(계약 §1.2 · plan.html 이 status·issuedAt·url 을 읽는다). 옛 행(tax_status 없음 · tax_doc_requested_at 만) 도 requested 로 보인다. */
export function taxInvoiceOf(r: Record<string, unknown>): TaxInvoiceView {
  const raw = String(r.tax_status ?? "none");
  const status: TaxStatus = raw === "issued" ? "issued" : raw === "requested" || (raw === "none" && r.tax_doc_requested_at) ? "requested" : "none";
  const o: TaxInvoiceView = { status };
  const ra = utcDate(r.tax_doc_requested_at); if (ra) o.requestedAt = ra.toISOString();
  const ia = utcDate(r.tax_issued_at); if (ia) o.issuedAt = ia.toISOString();
  if (r.tax_url) o.url = String(r.tax_url);
  return o;
}

/* ───────── 입력 검증(400 step = 칸 이름 · 화면이 그 칸 밑에 사람말을 붙인다) ───────── */
export function formatBizNo(v: unknown): string { const d = String(v ?? "").replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(v ?? "").trim(); }
export type TaxInputCheck = { ok: true; profile: TaxProfile } | { ok: false; step: "bizNo" | "bizName" | "email"; error: string };
export function validateTaxInput(b: Record<string, unknown>): TaxInputCheck {
  const bizNo = formatBizNo(b.bizNo);
  if (!/^\d{3}-\d{2}-\d{5}$/.test(bizNo)) return { ok: false, step: "bizNo", error: "사업자등록번호는 숫자 10자리예요(000-00-00000)." };
  const bizName = String(b.bizName ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!bizName) return { ok: false, step: "bizName", error: "상호를 적어 주세요." };
  const email = String(b.email ?? "").trim().toLowerCase().slice(0, 160);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, step: "email", error: "받으실 메일 주소를 확인해 주세요." };
  return { ok: true, profile: { bizNo, bizName, email } };
}

/* ───────── 프로필(다음부터 자동) ───────── */
export async function readTaxProfile(tid: number): Promise<TaxProfile | null> {
  const [t] = await q(sql`SELECT settings -> ${TAX_PROFILE_KEY} AS p FROM tenants WHERE id = ${tid}`);
  const p = t?.p && typeof t.p === "object" ? t.p as Record<string, unknown> : null;
  if (!p || !p.bizNo) return null;
  return { bizNo: String(p.bizNo ?? ""), bizName: String(p.bizName ?? ""), email: String(p.email ?? "") };
}
export async function writeTaxProfile(tid: number, p: TaxProfile, actorId: number | null = null): Promise<TaxProfile> {
  await q(sql`UPDATE tenants SET settings = COALESCE(settings, '{}'::jsonb) || ${jsonb({ [TAX_PROFILE_KEY]: p })}, updated_at = NOW() WHERE id = ${tid}`);
  const [chk] = await q(sql`SELECT jsonb_typeof(settings) AS t FROM tenants WHERE id = ${tid}`);
  if (chk && chk.t !== "object") console.error("[tax] tenants.settings jsonb_typeof 이상", chk);   // PITFALLS #1
  await writeAudit({ tenantId: tid, action: "tax_profile_update", actorType: actorId ? "user" : "system", actorId, detail: { bizNo: p.bizNo, bizName: p.bizName, email: p.email } });
  return p;
}

/* ───────── 요청(고객) ───────── */
export type TaxRequestResult = { ok: true; invoiceId: number; taxInvoice: TaxInvoiceView; already: boolean } | { ok: false; step: "not_found" | "status"; error: string; status?: number };
/**
 * requestTaxInvoice — 내 청구서(tenant 스코프 · 타 테넌트는 404)에 세금계산서를 요청한다. 결제 완료(paid · 부분환불 포함)만.
 *   이미 요청/발급된 청구서는 그대로 돌려준다(멱등 · already). 프로필은 요청 값으로 갱신(다음부터 자동) · 운영 CS 티켓 1건(autoKey 멱등).
 */
export async function requestTaxInvoice(tid: number, invoiceId: number, p: TaxProfile, ctx: { actorId?: number | null; ip?: string | null } = {}): Promise<TaxRequestResult> {
  const [inv] = await q(sql`SELECT id, tenant_id, kind, period, status, total_krw, amount, vat_krw, tax_status, tax_doc_requested_at, tax_issued_at, tax_url FROM invoices WHERE id = ${invoiceId} AND tenant_id = ${tid}`);
  if (!inv) return { ok: false, step: "not_found", error: "청구서를 찾을 수 없어요.", status: 404 };
  const cur = taxInvoiceOf(inv);
  if (cur.status !== "none") return { ok: true, invoiceId: n(inv.id), taxInvoice: cur, already: true };
  if (String(inv.status) !== "paid") return { ok: false, step: "status", error: "결제가 끝난 청구서만 세금계산서를 받을 수 있어요." };
  const taxDoc = { kind: "tax_invoice", status: "requested", requestedBy: "user", bizNo: p.bizNo, bizName: p.bizName, email: p.email };
  await q(sql`UPDATE invoices SET tax_status = ${"requested"}, tax_doc_requested_at = COALESCE(tax_doc_requested_at, NOW()), tax_biz = ${jsonb(p)},
    detail = COALESCE(detail, '{}'::jsonb) || ${jsonb({ taxDoc })}, updated_at = NOW() WHERE id = ${n(inv.id)} AND tenant_id = ${tid}`);
  const [chk] = await q(sql`SELECT jsonb_typeof(tax_biz) AS a, jsonb_typeof(detail) AS b FROM invoices WHERE id = ${n(inv.id)}`);
  if (chk && (chk.a !== "object" || chk.b !== "object")) console.error("[tax] invoices jsonb_typeof 이상", chk);   // PITFALLS #1
  await writeTaxProfile(tid, p, ctx.actorId ?? null);
  await writeAudit({ tenantId: tid, action: "tax_invoice_request", actorType: "user", actorId: ctx.actorId ?? null, ip: ctx.ip ?? null, target: `invoice:${n(inv.id)}`, detail: { period: String(inv.period), kind: String(inv.kind), totalKrw: n(inv.total_krw), bizNo: p.bizNo, bizName: p.bizName, email: p.email } });
  await createTicket({ tenantId: tid, subject: `세금계산서 요청 · 청구서 #${n(inv.id)} (${String(inv.period)})`,
    text: `공급가 ${n(inv.amount).toLocaleString("ko-KR")}원 · 부가세 ${n(inv.vat_krw).toLocaleString("ko-KR")}원 · 합계 ${n(inv.total_krw).toLocaleString("ko-KR")}원\n사업자등록번호 ${p.bizNo} · 상호 ${p.bizName} · 받을 메일 ${p.email}\n발행 뒤 운영센터 결제 메뉴에서 «발행됨» 처리해 주세요.`,
    source: "system", priority: "normal", tags: ["세금계산서"], autoKey: `tax_invoice:${n(inv.id)}` });
  const [after] = await q(sql`SELECT tax_status, tax_doc_requested_at, tax_issued_at, tax_url FROM invoices WHERE id = ${n(inv.id)}`);
  return { ok: true, invoiceId: n(inv.id), taxInvoice: taxInvoiceOf(after ?? {}), already: false };
}

/* ───────── 발급 표시(운영자) ───────── */
export type TaxIssueResult = { ok: true; invoiceId: number; tenantId: number; taxInvoice: TaxInvoiceView } | { ok: false; step: "not_found" | "url"; error: string; status?: number };
/** markTaxIssued — 운영자가 홈택스에서 발행한 뒤 «발행됨» + 문서 주소(선택)를 남긴다. 요청이 없던 청구서도 발행 표시는 된다(운영자가 먼저 끊어 준 경우). */
export async function markTaxIssued(invoiceId: number, input: { url?: unknown; actorId: number; ip?: string | null }): Promise<TaxIssueResult> {
  const [inv] = await q(sql`SELECT id, tenant_id, period, tax_status FROM invoices WHERE id = ${invoiceId}`);
  if (!inv) return { ok: false, step: "not_found", error: "인보이스가 없어요.", status: 404 };
  const url = String(input.url ?? "").trim().slice(0, 300);
  if (url && !/^https:\/\//i.test(url)) return { ok: false, step: "url", error: "문서 주소는 https:// 로 시작해야 해요." };
  await q(sql`UPDATE invoices SET tax_status = ${"issued"}, tax_issued_at = COALESCE(tax_issued_at, NOW()), tax_url = ${url || null}, tax_doc_requested_at = COALESCE(tax_doc_requested_at, NOW()),
    detail = COALESCE(detail, '{}'::jsonb) || ${jsonb({ taxDoc: { kind: "tax_invoice", status: "issued", issuedBy: input.actorId, url: url || null } })}, updated_at = NOW() WHERE id = ${n(inv.id)}`);
  const [chk] = await q(sql`SELECT jsonb_typeof(detail) AS t FROM invoices WHERE id = ${n(inv.id)}`);
  if (chk && chk.t !== "object") console.error("[tax] invoices.detail jsonb_typeof 이상", chk);   // PITFALLS #1
  const tid = n(inv.tenant_id);
  await writeAudit({ tenantId: tid, action: "ops_tax_doc_issued", actorType: "operator", actorId: input.actorId, ip: input.ip ?? null, target: `invoice:${n(inv.id)}`, detail: { period: String(inv.period), url: url || null, was: String(inv.tax_status ?? "none") } });
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"tax_invoice_issued"}, ${"세금계산서를 발행했어요"}, ${`${String(inv.period)} 청구서의 세금계산서가 발행됐어요.${url ? " 요금제 화면에서 문서를 열 수 있어요." : " 적어 주신 메일로 보내 드렸어요."}`}, ${"/app/plan.html"})`);
  const [after] = await q(sql`SELECT tax_status, tax_doc_requested_at, tax_issued_at, tax_url FROM invoices WHERE id = ${n(inv.id)}`);
  return { ok: true, invoiceId: n(inv.id), tenantId: tid, taxInvoice: taxInvoiceOf(after ?? {}) };
}
