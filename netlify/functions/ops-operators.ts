/**
 * 운영센터 — 운영진 계정 + 감사 검색(계약 P1R4 §2.2·§2.4(6) · DESIGN §11.4). 🔴 super_admin 만.
 *   GET  /api/ops-operators?page                     → { ok, operators:[Operator], page, total }
 *   POST /api/ops-operators { id?, email, name, role, ssoSubject? }  → { ok, operator }   // 생성/수정(비밀번호는 여기서 안 만든다 · SSO/기존 흐름)
 *   POST /api/ops-operator-role   { id, role }        → { ok, operator }
 *   POST /api/ops-operator-disable { id, active }     → { ok, operator }
 *   GET  /api/ops-audit-search?q&tenant&actor&actorType&action&risk&from&to&page → { ok, rows:[…], page, total }  // R1 ops-audit 확장 · KST 기간
 *        actorType = operator|customer|system — 🔴 DB 칸(audit_logs.actor_type)은 user|operator|system 이라 «customer ↔ user» 로 옮긴다.
 *        응답의 rows[].actorType 도 같은 어휘(customer)로 내보낸다 — 거르는 말과 보이는 말이 다르면 화면이 못 맞춘다.
 *   Operator = { id, email, name, role, ssoSubject?, active, lastLoginAt? }   // DB 저장은 operators.sso_sub
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";
import { utcDate } from "../../lib/db-util";

export const config = { path: ["/api/ops-operators", "/api/ops-operator-role", "/api/ops-operator-disable", "/api/ops-audit-search"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const ROLES = new Set(["operator", "admin", "super_admin"]);
const PAGE = 30;
/** 감사 행위자 어휘: 화면·API = operator|customer|system · DB(audit_logs.actor_type) = operator|user|system. */
const AT_TO_DB: Record<string, string> = { operator: "operator", customer: "user", user: "user", system: "system" };
const AT_TO_API = (dbType: string) => (dbType === "user" ? "customer" : dbType);

function toOperator(r: Record<string, unknown>) {
  const o: Record<string, unknown> = { id: n(r.id), email: String(r.email ?? ""), name: String(r.name ?? ""), role: String(r.role ?? "operator"), active: r.active === true };
  if (r.sso_sub) o.ssoSubject = String(r.sso_sub);
  const ll = utcDate(r.last_login_at); if (ll) o.lastLoginAt = ll.toISOString();
  return o;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  try {
    /* 🔴 운영진·감사는 전부 super_admin 전용(§0.2). */
    const g = requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;

    if (path.endsWith("/ops-audit-search")) {
      // R1 /api/ops-audit(테넌트·limit) 를 확장: 자유어(action/target)·테넌트·actor·위험도·KST 기간.
      const page = Math.max(1, n(url.searchParams.get("page")) || 1);
      const conds = [sql`1=1`];
      const qtext = String(url.searchParams.get("q") ?? "").trim();
      if (qtext) conds.push(sql`(action ILIKE ${"%" + qtext + "%"} OR target ILIKE ${"%" + qtext + "%"})`);
      const tenant = n(url.searchParams.get("tenant")); if (tenant) conds.push(sql`tenant_id = ${tenant}`);
      const actor = n(url.searchParams.get("actor")); if (actor) conds.push(sql`actor_id = ${actor}`);
      // 행위자 «종류» — actor_id 만으로는 운영자인지 고객인지 못 가른다(메인 소발주 1). API customer → DB user.
      const at = String(url.searchParams.get("actorType") ?? "").trim().toLowerCase();
      if (at && at !== "all") {
        const dbType = AT_TO_DB[at];
        if (!dbType) return badRequest("actorType 은 operator|customer|system", "actorType");
        conds.push(sql`actor_type = ${dbType}`);
      }
      const action = String(url.searchParams.get("action") ?? "").trim(); if (action) conds.push(sql`action = ${action}`);
      const risk = String(url.searchParams.get("risk") ?? "").trim(); if (risk) conds.push(sql`risk_level = ${risk}`);
      // from/to 는 KST 날짜(YYYY-MM-DD) — KST 자정 경계를 UTC 로 변환해 비교(§13.5).
      const from = String(url.searchParams.get("from") ?? "").trim();
      const to = String(url.searchParams.get("to") ?? "").trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(from)) conds.push(sql`created_at >= (${from + " 00:00:00"}::timestamp AT TIME ZONE 'Asia/Seoul')`);
      if (/^\d{4}-\d{2}-\d{2}$/.test(to)) conds.push(sql`created_at < ((${to}::date + 1)::text || ' 00:00:00')::timestamp AT TIME ZONE 'Asia/Seoul'`);
      const where = sql.join(conds, sql` AND `);
      const [{ c }] = await q(sql`SELECT COUNT(*) c FROM audit_logs WHERE ${where}`);
      const rows = await q(sql`SELECT id, tenant_id, actor_type, actor_id, action, target, risk_level, detail, ip, created_at
        FROM audit_logs WHERE ${where} ORDER BY id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`);
      return json({ ok: true, rows: rows.map((r) => ({
        id: n(r.id), tenantId: r.tenant_id ? n(r.tenant_id) : null, actorType: r.actor_type ? AT_TO_API(String(r.actor_type)) : null,
        actorId: r.actor_id ? n(r.actor_id) : null, action: String(r.action), target: r.target ? String(r.target) : null,
        risk: String(r.risk_level), detail: r.detail ?? null, ip: r.ip ? String(r.ip) : null,
        at: utcDate(r.created_at)?.toISOString(),
      })), page, total: n(c) });
    }

    if (path.endsWith("/ops-operators") && req.method === "GET") {
      const page = Math.max(1, n(url.searchParams.get("page")) || 1);
      const [{ c }] = await q(sql`SELECT COUNT(*) c FROM operators`);
      const rows = await q(sql`SELECT id, email, name, role, sso_sub, active, last_login_at FROM operators ORDER BY id LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`);
      return json({ ok: true, operators: rows.map(toOperator), page, total: n(c) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);

    if (path.endsWith("/ops-operator-role")) {
      const id = n(b.id); const role = String(b.role ?? "");
      if (!id || !ROLES.has(role)) return badRequest("id·role");
      if (id === g.ops.oid && role !== "super_admin") return json({ ok: false, error: "본인의 super_admin 권한은 스스로 내릴 수 없어요.", step: "self" }, 400);
      const [row] = await q(sql`UPDATE operators SET role = ${role} WHERE id = ${id} RETURNING id, email, name, role, sso_sub, active, last_login_at`);
      if (!row) return json({ ok: false, error: "운영자를 찾을 수 없어요.", step: "not_found" }, 404);
      await writeAudit({ tenantId: null, action: "ops_operator_role", actorType: "operator", actorId: g.ops.oid, target: `operator:${id}`, detail: { role }, riskLevel: "high" });
      return json({ ok: true, operator: toOperator(row) });
    }

    if (path.endsWith("/ops-operator-disable")) {
      const id = n(b.id); const active = b.active === true;
      if (!id) return badRequest("id");
      if (id === g.ops.oid && !active) return json({ ok: false, error: "본인 계정은 스스로 비활성화할 수 없어요.", step: "self" }, 400);
      const [row] = await q(sql`UPDATE operators SET active = ${active} WHERE id = ${id} RETURNING id, email, name, role, sso_sub, active, last_login_at`);
      if (!row) return json({ ok: false, error: "운영자를 찾을 수 없어요.", step: "not_found" }, 404);
      await writeAudit({ tenantId: null, action: "ops_operator_disable", actorType: "operator", actorId: g.ops.oid, target: `operator:${id}`, detail: { active }, riskLevel: "high" });
      return json({ ok: true, operator: toOperator(row) });
    }

    if (path.endsWith("/ops-operators")) {
      const email = String(b.email ?? "").trim().toLowerCase();
      const role = String(b.role ?? "operator");
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return badRequest("올바른 이메일을 입력해 주세요", "email");
      if (!ROLES.has(role)) return badRequest("role");
      const name = String(b.name ?? "").slice(0, 80);
      const ssoSub = b.ssoSubject ? String(b.ssoSubject).slice(0, 64) : null;
      const id = n(b.id);
      let row;
      if (id) {
        [row] = await q(sql`UPDATE operators SET email = ${email}, name = ${name}, role = ${role}, sso_sub = ${ssoSub}
          WHERE id = ${id} RETURNING id, email, name, role, sso_sub, active, last_login_at`);
        if (!row) return json({ ok: false, error: "운영자를 찾을 수 없어요.", step: "not_found" }, 404);
      } else {
        const [dup] = await q(sql`SELECT id FROM operators WHERE email = ${email} LIMIT 1`);
        if (dup) return json({ ok: false, error: "이미 있는 이메일이에요.", step: "duplicate" }, 409);
        // 비밀번호는 여기서 안 만든다 — SSO 매핑(sso_sub) 또는 기존 비번 발급 흐름. must_change_password 로 초대.
        [row] = await q(sql`INSERT INTO operators (email, name, role, sso_sub, active, must_change_password)
          VALUES (${email}, ${name}, ${role}, ${ssoSub}, true, true) RETURNING id, email, name, role, sso_sub, active, last_login_at`);
      }
      await writeAudit({ tenantId: null, action: id ? "ops_operator_update" : "ops_operator_create", actorType: "operator", actorId: g.ops.oid, target: `operator:${n(row.id)}`, detail: { email, role }, riskLevel: "high" });
      return json({ ok: true, operator: toOperator(row) });
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_operators", err);
  }
};
