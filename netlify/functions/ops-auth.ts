/**
 * 운영자 인증 묶음 — 함수 수(=배포 폭발 반경)를 줄이려 한 파일에 4 경로:
 *   POST /api/ops-login { email, password } · POST /api/ops-logout · GET /api/ops-me · POST /api/ops-change-password { current?, password }
 *   admin/admin1234 시드 계정은 must_change_password=true → ops-me 가 알려주고 화면이 변경 화면으로 보낸다(DESIGN §11.0).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson, passwordSchema, firstIssue } from "../../lib/validate";
import { requireOps } from "../../lib/guards";
import { loginOperator, issueOpsSession, opsLogoutHeaders, setOperatorPassword, findOperatorByEmail, verifyPassword } from "../../lib/auth-service";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { jsonWithCookies } from "./_resp";
import { z } from "zod";

export const config = { path: ["/api/ops-login", "/api/ops-logout", "/api/ops-me", "/api/ops-change-password"] };

const loginSchema = z.object({ email: z.string().trim().min(1).max(160), password: z.string().min(1).max(72) });
const pwSchema = z.object({ current: z.string().optional(), password: passwordSchema });

export default async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/ops-login")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const parsed = loginSchema.safeParse(await readJson(req));
      if (!parsed.success) return badRequest(firstIssue(parsed.error));
      // 아이디 형태(admin)도 허용 — 이메일이 아니면 로컬 계정 규칙 `<id>@ops.local` 로 매핑.
      const email = parsed.data.email.includes("@") ? parsed.data.email.toLowerCase() : `${parsed.data.email.toLowerCase()}@ops.local`;
      const r = await loginOperator(email, parsed.data.password, clientIp(req));
      if (!r.ok) {
        if (r.reason === "locked") return json({ ok: false, error: "여러 번 실패해서 15분 동안 잠겼어요.", step: "locked" }, 423);
        if (r.reason === "inactive") return json({ ok: false, error: "비활성 계정이에요.", step: "inactive" }, 403);
        return json({ ok: false, error: "아이디 또는 비밀번호가 맞지 않아요.", step: "invalid" }, 401);
      }
      return jsonWithCookies({ ok: true, mustChangePassword: !!r.op.must_change_password, role: r.op.role }, issueOpsSession({ id: r.op.id, email: r.op.email, name: r.op.name, role: r.op.role }));
    }
    if (path.endsWith("/ops-logout")) {
      const o = requireOps(req);
      if (o.ok) await writeAudit({ tenantId: null, action: "ops_logout", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req) });
      return jsonWithCookies({ ok: true }, opsLogoutHeaders());
    }
    const o = requireOps(req); if (!o.ok) return o.res;
    if (path.endsWith("/ops-me")) {
      const r = (await db.execute(sql`SELECT id, email, name, role, must_change_password, last_login_at FROM operators WHERE id = ${o.ops.oid} AND active = true`)) as unknown as Record<string, unknown>[];
      if (!r[0]) return json({ ok: false, error: "운영자 계정을 찾을 수 없어요.", step: "operator" }, 401);
      return json({ ok: true, operator: { id: Number(r[0].id), email: r[0].email, name: r[0].name, role: r[0].role, mustChangePassword: !!r[0].must_change_password } });
    }
    if (path.endsWith("/ops-change-password")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const parsed = pwSchema.safeParse(await readJson(req));
      if (!parsed.success) return badRequest(firstIssue(parsed.error));
      const op = await findOperatorByEmail(o.ops.email || "");
      if (!op) return json({ ok: false, error: "운영자 계정을 찾을 수 없어요.", step: "operator" }, 401);
      // 강제 변경(must_change_password) 상태가 아니면 현재 비밀번호 확인 필수.
      if (!op.must_change_password) {
        if (!parsed.data.current || !op.password_hash || !(await verifyPassword(op.password_hash, parsed.data.current))) return json({ ok: false, error: "현재 비밀번호가 맞지 않아요.", step: "current" }, 401);
      }
      if (parsed.data.password === "admin1234") return badRequest("기본 비밀번호는 쓸 수 없어요.", "weak");
      await setOperatorPassword(op.id, parsed.data.password);
      await writeAudit({ tenantId: null, action: "ops_password_change", actorType: "operator", actorId: op.id, ip: clientIp(req), riskLevel: "medium" });
      return json({ ok: true });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("ops_auth", err); }
};
