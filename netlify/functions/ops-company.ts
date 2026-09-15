/**
 * 운영센터 «회사 정보»(계약 P1R6 §1.3 · DESIGN §11.4). 권한: **super_admin** 만(읽기도).
 *   GET  /api/ops-company                     → { ok, name, ceo, bizNo, mailOrderNo, address, email, phone, updatedBy, updatedAt, configured }
 *   POST /api/ops-company { name?, ceo?, bizNo?, mailOrderNo?, address?, email?, phone? } → 부분 갱신 · 400 step=칸 이름 · 저장 + 감사 **high** → GET 과 같은 모양.
 *   🔴 영수증 supplier · 약관 하단(GET /api/company) · 세금계산서가 모두 ops_settings.company 한 출처를 읽는다 — 여기 말고 어디에도 회사 정보를 적지 않는다.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { readCompany, validateCompanyInput, writeCompany, COMPANY_FIELDS, type CompanyInput } from "../../lib/ops/company";

export const config = { path: "/api/ops-company" };

export default async (req: Request): Promise<Response> => {
  const o = await requireAdmin(req, ["super_admin"]); if (!o.ok) return o.res;
  try {
    if (req.method === "GET") return json({ ok: true, ...(await readCompany(true)) });
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<CompanyInput>(req);
    const v = validateCompanyInput(b);
    if (!v.ok) return badRequest(v.error, v.step);
    if (!Object.keys(v.patch).length) return badRequest("바꿀 값이 없어요.", "empty");
    const before = await readCompany(true);
    const after = await writeCompany(v.patch, o.ops.oid);
    const changed = COMPANY_FIELDS.filter((k) => before[k] !== after[k]);
    await writeAudit({ tenantId: null, action: "ops_company_update", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req), riskLevel: "high", target: "ops_settings:company",
      detail: { changed, before: Object.fromEntries(changed.map((k) => [k, before[k]])), after: Object.fromEntries(changed.map((k) => [k, after[k]])) } });
    return json({ ok: true, ...after, changed });
  } catch (err) { return jsonError("ops_company", err); }
};
