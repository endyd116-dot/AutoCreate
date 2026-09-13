/** POST /api/auth-login { email, password, remember? } — 실패 5회 → 15분 잠금. remember=true 면 30일 리프레시 토큰. */
import { json, jsonError, badRequest } from "../../lib/response";
import { emailSchema, readJson, firstIssue } from "../../lib/validate";
import { loginUser, issueUserSession } from "../../lib/auth-service";
import { clientIp, userAgent } from "../../lib/auth";
import { jsonWithCookies } from "./_resp";
import { z } from "zod";

export const config = { path: "/api/auth-login" };
const schema = z.object({ email: emailSchema, password: z.string().min(1).max(72), remember: z.boolean().optional() });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { email, password, remember } = parsed.data;
  try {
    const r = await loginUser(email, password, clientIp(req));
    if (!r.ok) {
      if (r.reason === "locked") return json({ ok: false, error: "여러 번 실패해서 15분 동안 잠겼어요. 잠시 후 다시 시도해 주세요.", step: "locked" }, 423);
      return json({ ok: false, error: "이메일 또는 비밀번호가 맞지 않아요.", step: "invalid" }, 401);
    }
    const cookies = await issueUserSession(r.user, { remember: !!remember, ua: userAgent(req), ip: clientIp(req) });
    return jsonWithCookies({ ok: true, mustChangePassword: !!r.user.must_change_password }, cookies);
  } catch (err) { return jsonError("login", err); }
};
