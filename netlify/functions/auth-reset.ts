/** POST /api/auth-reset { t, password } — 1회용 nonce 검증 후 비밀번호 교체 + 전 기기 로그아웃. */
import { json, jsonError, badRequest } from "../../lib/response";
import { passwordSchema, readJson, firstIssue } from "../../lib/validate";
import { verifyActionToken, clientIp } from "../../lib/auth";
import { setUserPassword, revokeAllRefresh } from "../../lib/auth-service";
import { writeAudit } from "../../lib/audit";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { z } from "zod";
export const config = { path: "/api/auth-reset" };
const schema = z.object({ t: z.string().min(10), password: passwordSchema });
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const p = verifyActionToken(parsed.data.t);
  if (!p || p.purpose !== "reset") return badRequest("링크가 만료됐어요. 다시 요청해 주세요.", "token");
  try {
    const r = (await db.execute(sql`SELECT id, tenant_id FROM users WHERE id = ${p.id} AND reset_nonce = ${p.nonce}`)) as unknown as { id: number; tenant_id: number }[];
    if (!r[0]) return badRequest("이미 사용된 링크예요. 다시 요청해 주세요.", "used");
    await setUserPassword(p.id, parsed.data.password);
    await revokeAllRefresh("user", p.id);
    await writeAudit({ tenantId: Number(r[0].tenant_id), action: "user_password_reset", actorType: "user", actorId: p.id, ip: clientIp(req), riskLevel: "medium" });
    return json({ ok: true });
  } catch (err) { return jsonError("reset", err); }
};
