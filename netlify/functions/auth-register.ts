/**
 * POST /api/auth-register { email, password, name? } — 가입 = 테넌트(체험 N일) + owner. 즉시 세션 발급 + 인증 메일.
 *   이메일 인증은 «막는 문»이 아니라 «알림 배너»다(토스형 — 진입 마찰 최소). 결제·러너 연결 전에만 인증을 요구한다(Phase 4).
 *   enumeration 완화: 이미 있는 이메일이면 같은 모양의 실패 문구.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { emailSchema, passwordSchema, readJson, firstIssue } from "../../lib/validate";
import { findUserByEmail, registerUser, issueUserSession } from "../../lib/auth-service";
import { signActionToken, clientIp, userAgent } from "../../lib/auth";
import { sendEmail, siteUrl, simpleMail } from "../../lib/email";
import { jsonWithCookies } from "./_resp";
import { z } from "zod";

export const config = { path: "/api/auth-register" };
const schema = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().max(80).optional() });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { email, password, name } = parsed.data;
  try {
    if (await findUserByEmail(email)) return badRequest("이 이메일로는 가입할 수 없어요. 로그인하거나 비밀번호를 찾아보세요.", "exists");
    const { user, tenant, verifyNonce, trialDays } = await registerUser({ email, password, name, ip: clientIp(req) });
    const t = signActionToken({ id: Number(user.id), purpose: "verify", nonce: verifyNonce }, "3d");
    const link = `${siteUrl()}/api/auth-verify?t=${encodeURIComponent(t)}`;
    void sendEmail(email, "AutoCreate 이메일 인증", simpleMail("이메일을 확인해 주세요", "아래 버튼을 누르면 인증이 끝나요. 3일 안에 눌러 주세요.", { label: "이메일 인증하기", url: link }));
    const cookies = await issueUserSession({ id: Number(user.id), tenant_id: Number(tenant.id), email, name: name || null, role: "owner" }, { remember: true, ua: userAgent(req), ip: clientIp(req) });
    return jsonWithCookies({ ok: true, tenantKey: tenant.key, trialDays }, cookies, 201);
  } catch (err) { return jsonError("register", err); }
};
