/**
 * POST /api/auth-register { email, password, name? } — 가입 = 테넌트(체험 N일) + owner. 즉시 세션 발급 + 인증 메일.
 *   이메일 인증은 «막는 문»이 아니라 «알림 배너»다(토스형 — 진입 마찰 최소). 결제·러너 연결 전에만 인증을 요구한다(Phase 4).
 *   enumeration 완화: 이미 있는 이메일이면 같은 모양의 실패 문구.
 *   🔴 인증 메일은 **await**(2026-09-15 · AC-36): 서버리스는 응답을 돌려주면 인보케이션을 끝낸다 — `void sendEmail(...)` 은
 *      간헐적으로 «메일이 안 왔다»가 된다. 고객이 직접 기다리는 경로라 200~500ms 는 값싼 대가다.
 *      응답의 **`mailSent`** 로 화면이 «메일이 안 갔어요 · 다시 보내기»(POST /api/auth-verify-resend)를 띄운다.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { emailSchema, passwordSchema, readJson, firstIssue } from "../../lib/validate";
import { findUserByEmail, registerUser, issueUserSession } from "../../lib/auth-service";
import { parseSignupConsents, recordConsents } from "../../lib/billing/consents";
import { writeAudit } from "../../lib/audit";
import { signActionToken, clientIp, userAgent } from "../../lib/auth";
import { sendEmail, siteUrl, simpleMail } from "../../lib/email";
import { jsonWithCookies } from "./_resp";
import { z } from "zod";

export const config = { path: "/api/auth-register" };
const schema = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().max(80).optional(), consents: z.record(z.string(), z.unknown()).optional() });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { email, password, name, consents } = parsed.data;
  // P1R4 §2.4(7) — 약관 동의: 이용약관·개인정보는 필수 · 나머지는 있으면 기록. 기록은 가입 성공 뒤(테넌트 id 가 있어야 한다).
  //   ⚠️ `consents` 키 자체가 없는 옛 화면(머지 순서 B→A 사이 창)은 막지 않고 감사만 남긴다 — 화면이 보내기 시작하면 필수가 된다(조용히 가입이 막히는 사고 방지).
  const agreed = parseSignupConsents(consents ?? {});
  if (consents !== undefined && agreed.missing.length) return badRequest("이용약관과 개인정보 처리방침에 동의해 주세요.", "consents");
  try {
    if (await findUserByEmail(email)) return badRequest("이 이메일로는 가입할 수 없어요. 로그인하거나 비밀번호를 찾아보세요.", "exists");
    const { user, tenant, verifyNonce, trialDays } = await registerUser({ email, password, name, ip: clientIp(req) });
    if (agreed.kinds.length) await recordConsents(Number(tenant.id), Number(user.id), agreed.kinds, { ip: clientIp(req), ua: userAgent(req) });
    else await writeAudit({ tenantId: Number(tenant.id), action: "signup_no_consents", actorType: "user", actorId: Number(user.id), riskLevel: "medium", detail: { note: "consents 키 없이 가입(옛 화면)" } });
    const t = signActionToken({ id: Number(user.id), purpose: "verify", nonce: verifyNonce }, "3d");
    const link = `${siteUrl()}/api/auth-verify?t=${encodeURIComponent(t)}`;
    const mailSent = await sendEmail(email, "AutoCreate 이메일 인증", simpleMail("이메일을 확인해 주세요", "아래 버튼을 누르면 인증이 끝나요. 3일 안에 눌러 주세요.", { label: "이메일 인증하기", url: link }));
    // 메일 실패는 가입을 막지 않는다(세션은 이미 유효 · 인증은 «막는 문»이 아니라 배너) — 대신 사실을 응답·감사에 남긴다.
    if (!mailSent) await writeAudit({ tenantId: Number(tenant.id), action: "verify_mail_failed", actorType: "system", actorId: Number(user.id), riskLevel: "medium", detail: { at: "register" } });
    const cookies = await issueUserSession({ id: Number(user.id), tenant_id: Number(tenant.id), email, name: name || null, role: "owner" }, { remember: true, ua: userAgent(req), ip: clientIp(req) });
    return jsonWithCookies({ ok: true, tenantKey: tenant.key, trialDays, mailSent }, cookies, 201);
  } catch (err) { return jsonError("register", err); }
};
