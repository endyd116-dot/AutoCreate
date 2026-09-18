/**
 * POST /api/auth-register { email, password, name?, consents?, referralCode? } — 가입 = 테넌트(체험 N일) + owner. 즉시 세션 발급 + 인증 메일.
 *   [P1R6 §1.1] referralCode(8자) 가 오면 **테넌트를 만들기 전에** 검증 → 400 `step:"referral"` 사람말(없는 코드 · 내 코드 · 이미 추천받은 계정) · 흔적 0.
 *      통과하면 가입 뒤 `tenants.referred_by` 1회 연결 · 응답 `referral:{ applied:true }`(화면 «추천 코인은 첫 결제 뒤에»). 보상은 첫 유료 결제 성공 때(lib/referral.ts).
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
import { checkSignupReferral, attachReferral } from "../../lib/referral";
import { z } from "zod";

export const config = { path: "/api/auth-register" };
const schema = z.object({ email: emailSchema, password: passwordSchema, name: z.string().trim().max(80).optional(), consents: z.record(z.string(), z.unknown()).optional(), referralCode: z.string().trim().max(16).optional() });

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const parsed = schema.safeParse(await readJson(req));
  if (!parsed.success) return badRequest(firstIssue(parsed.error));
  const { email, password, name, consents, referralCode } = parsed.data;
  // P1R4 §2.4(7) — 약관 동의: 이용약관·개인정보는 필수 · 나머지는 있으면 기록. 기록은 가입 성공 뒤(테넌트 id 가 있어야 한다).
  //   ⚠️ `consents` 키 자체가 없는 옛 화면(머지 순서 B→A 사이 창)은 막지 않고 감사만 남긴다 — 화면이 보내기 시작하면 필수가 된다(조용히 가입이 막히는 사고 방지).
  const agreed = parseSignupConsents(consents ?? {});
  // [2026-09-19 수리 ⑤] 화면은 «네 가지 약관에 모두 동의해 주세요»라고 말하는데 여기는 «둘»이라고 했다 — 숫자가 어긋났다(시나리오 A §1).
  if (consents !== undefined && agreed.missing.length) return badRequest("네 가지 약관에 모두 동의해 주세요.", "consents");
  try {
    if (await findUserByEmail(email)) return badRequest("이 이메일로는 가입할 수 없어요. 로그인하거나 비밀번호를 찾아보세요.", "exists");
    // [P1R6 §1.1] 추천 코드는 테넌트를 만들기 **전에** 본다 — 틀리면 400 만 돌려주고 아무것도 남기지 않는다.
    const ref = referralCode ? await checkSignupReferral(referralCode, email) : null;
    if (ref && !ref.ok) return badRequest(ref.error, "referral");
    const { user, tenant, verifyNonce, trialDays } = await registerUser({ email, password, name, ip: clientIp(req) });
    const referral = ref && ref.ok ? await attachReferral(Number(tenant.id), ref.inviterTid, { actorId: Number(user.id), ip: clientIp(req), code: referralCode ?? null }) : null;
    if (agreed.kinds.length) await recordConsents(Number(tenant.id), Number(user.id), agreed.kinds, { ip: clientIp(req), ua: userAgent(req) });
    else await writeAudit({ tenantId: Number(tenant.id), action: "signup_no_consents", actorType: "user", actorId: Number(user.id), riskLevel: "medium", detail: { note: "consents 키 없이 가입(옛 화면)" } });
    const t = signActionToken({ id: Number(user.id), purpose: "verify", nonce: verifyNonce }, "3d");
    const link = `${siteUrl()}/api/auth-verify?t=${encodeURIComponent(t)}`;
    const mailSent = await sendEmail(email, "AutoCreate 이메일 인증", simpleMail("이메일을 확인해 주세요", "아래 버튼을 누르면 인증이 끝나요. 3일 안에 눌러 주세요.", { label: "이메일 인증하기", url: link }));
    // 메일 실패는 가입을 막지 않는다(세션은 이미 유효 · 인증은 «막는 문»이 아니라 배너) — 대신 사실을 응답·감사에 남긴다.
    if (!mailSent) await writeAudit({ tenantId: Number(tenant.id), action: "verify_mail_failed", actorType: "system", actorId: Number(user.id), riskLevel: "medium", detail: { at: "register" } });
    const cookies = await issueUserSession({ id: Number(user.id), tenant_id: Number(tenant.id), email, name: name || null, role: "owner" }, { remember: true, ua: userAgent(req), ip: clientIp(req) });
    return jsonWithCookies({ ok: true, tenantKey: tenant.key, trialDays, mailSent, ...(referral ? { referral: { applied: referral.applied } } : {}) }, cookies, 201);
  } catch (err) { return jsonError("register", err); }
};
