/**
 * POST /api/auth-verify-resend — 인증 메일 «다시 보내기»(로그인 필요 · 본인 것만).
 *   왜 생겼나(2026-09-15 · AC-36): 가입에서 인증 메일을 `await` 로 바꿔 **실패를 알 수 있게** 됐는데,
 *   정작 고객이 다시 받을 길이 없었다 — «메일이 안 왔다»의 유일한 출구가 CS 였다. 알림만 정확해지고 구멍은 그대로인 셈이라 같이 낸다.
 *   ✓ nonce 를 새로 발급한다(옛 링크는 그때 죽는다 · 1회용 유지) → `users.verify_nonce`
 *   ✓ 남용 방지: **60초에 1번**(audit `verify_mail_resend` 로 재는다 · 새 칸 없이).
 *   ✓ 이미 인증된 계정이면 보내지 않고 `{ok:true, sent:false, verified:true}`(화면은 배너를 내린다).
 *   응답: `{ ok:true, sent:true }` · `{ ok:true, sent:false, verified:true }` · `{ ok:false, step:"rate"|"mail", error }`
 */
import { sql } from "drizzle-orm";
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { signActionToken, newNonce, clientIp } from "../../lib/auth";
import { sendEmail, siteUrl, simpleMail } from "../../lib/email";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";

export const config = { path: "/api/auth-verify-resend" };
export const RESEND_COOLDOWN_SEC = 60;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const uid = auth.user.uid, tid = auth.tid;
  try {
    const [u] = await q(sql`SELECT id, email, email_verified_at FROM users WHERE id = ${uid} AND tenant_id = ${tid}`);
    if (!u) return json({ ok: false, step: "auth", error: "다시 로그인해 주세요." }, 401);
    if (u.email_verified_at) return json({ ok: true, sent: false, verified: true });

    const [recent] = await q(sql`SELECT 1 FROM audit_logs WHERE actor_id = ${uid} AND action = 'verify_mail_resend'
      AND created_at > NOW() - (${RESEND_COOLDOWN_SEC} || ' seconds')::interval LIMIT 1`);
    if (recent) return json({ ok: false, step: "rate", error: `방금 보냈어요. ${RESEND_COOLDOWN_SEC}초 뒤에 다시 눌러 주세요.` }, 429);

    const nonce = newNonce();
    await q(sql`UPDATE users SET verify_nonce = ${nonce} WHERE id = ${uid}`);   // 옛 링크는 여기서 무효(1회용 유지)
    const t = signActionToken({ id: uid, purpose: "verify", nonce }, "3d");
    const link = `${siteUrl()}/api/auth-verify?t=${encodeURIComponent(t)}`;
    const sent = await sendEmail(String(u.email), "AutoCreate 이메일 인증", simpleMail("이메일을 확인해 주세요", "아래 버튼을 누르면 인증이 끝나요. 3일 안에 눌러 주세요.", { label: "이메일 인증하기", url: link }));
    await writeAudit({ tenantId: tid, action: sent ? "verify_mail_resend" : "verify_mail_failed", actorType: "user", actorId: uid, ip: clientIp(req), riskLevel: sent ? "low" : "medium", detail: { at: "resend" } });
    if (!sent) return json({ ok: false, step: "mail", error: "메일을 보내지 못했어요. 잠시 뒤 다시 해 주세요." }, 200);
    return json({ ok: true, sent: true });
  } catch (err) { return jsonError("verify_resend", err); }
};
