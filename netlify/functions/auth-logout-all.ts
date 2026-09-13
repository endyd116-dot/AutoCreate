/** POST /api/auth-logout-all — 전 기기 로그아웃(리프레시 토큰 전부 폐기 + 현재 세션 종료). */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { revokeAllRefresh, logoutHeaders } from "../../lib/auth-service";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { jsonWithCookies } from "./_resp";
export const config = { path: "/api/auth-logout-all" };
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  try {
    const n = await revokeAllRefresh("user", auth.user.uid);
    await writeAudit({ tenantId: auth.tid, action: "user_logout_all", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), detail: { revoked: n } });
    return jsonWithCookies({ ok: true, revoked: n }, logoutHeaders());
  } catch (err) { return jsonError("logout_all", err); }
};
