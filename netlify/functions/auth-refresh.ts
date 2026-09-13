/** POST /api/auth-refresh — 슬라이딩(세션 유효하면 재발급) 또는 리프레시 토큰으로 복구(회전). */
import { json, jsonError } from "../../lib/response";
import { verifyUser, readCookie, REFRESH_COOKIE, signUserToken, userCookie, clientIp, userAgent } from "../../lib/auth";
import { refreshUserSession } from "../../lib/auth-service";
import { jsonWithCookies } from "./_resp";
export const config = { path: "/api/auth-refresh" };
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  try {
    const u = verifyUser(req);
    if (u && !u.imp) {
      const token = signUserToken({ uid: u.uid, tid: u.tid, role: u.role, email: u.email, name: u.name });
      return jsonWithCookies({ ok: true, via: "sliding" }, [userCookie(token)]);
    }
    const raw = readCookie(req, REFRESH_COOKIE);
    if (raw) {
      const cookies = await refreshUserSession(raw, { ua: userAgent(req), ip: clientIp(req) });
      if (cookies) return jsonWithCookies({ ok: true, via: "refresh" }, cookies);
    }
    return json({ ok: false, error: "다시 로그인해 주세요.", step: "expired" }, 401);
  } catch (err) { return jsonError("refresh", err); }
};
