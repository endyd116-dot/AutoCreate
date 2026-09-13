/** POST /api/auth-logout — 세션 쿠키 삭제 + 이 기기의 리프레시 토큰 폐기. */
import { json, jsonError } from "../../lib/response";
import { readCookie, REFRESH_COOKIE, verifyUser, clientIp } from "../../lib/auth";
import { revokeRefresh, logoutHeaders } from "../../lib/auth-service";
import { writeAudit } from "../../lib/audit";
import { jsonWithCookies } from "./_resp";
export const config = { path: "/api/auth-logout" };
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  try {
    const u = verifyUser(req);
    await revokeRefresh(readCookie(req, REFRESH_COOKIE));
    if (u) await writeAudit({ tenantId: u.tid, action: "user_logout", actorType: "user", actorId: u.uid, ip: clientIp(req) });
    return jsonWithCookies({ ok: true }, logoutHeaders());
  } catch (err) { return jsonError("logout", err); }
};
