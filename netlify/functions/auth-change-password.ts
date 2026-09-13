/** POST /api/auth-change-password { current, password } — 로그인 상태에서 교체. 다른 기기 로그아웃. */
import { json, jsonError, badRequest } from "../../lib/response";
import { passwordSchema, readJson, firstIssue } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { setUserPassword, verifyPassword, revokeAllRefresh } from "../../lib/auth-service";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { z } from "zod";
export const config = { path: "/api/auth-change-password" };
const schema = z.object({ current: z.string().min(1), password: passwordSchema });
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  if (auth.user.imp) return json({ ok: false, error: "원격접속 중에는 바꿀 수 없어요.", step: "impersonation" }, 403);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  try {
    const r = (await db.execute(sql`SELECT password_hash FROM users WHERE id = ${auth.user.uid}`)) as unknown as { password_hash: string }[];
    if (!r[0] || !(await verifyPassword(r[0].password_hash, parsed.data.current))) return json({ ok: false, error: "현재 비밀번호가 맞지 않아요.", step: "current" }, 401);
    await setUserPassword(auth.user.uid, parsed.data.password);
    await revokeAllRefresh("user", auth.user.uid);
    await writeAudit({ tenantId: auth.tid, action: "user_password_change", actorType: "user", actorId: auth.user.uid, ip: clientIp(req) });
    return json({ ok: true });
  } catch (err) { return jsonError("change_password", err); }
};
