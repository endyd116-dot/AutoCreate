/**
 * POST /api/auth-forgot { email } — 항상 ok(enumeration 방지). 있으면 1회용 재설정 링크(30분).
 *   🔴 메일은 **await**(2026-09-15 · AC-36) — `void` 로 던지면 응답 뒤 인보케이션이 끝나 간헐 미발송이 된다(사용자가 기다리는 경로).
 *   ⚠️ 발송 실패해도 **응답 모양은 그대로 `{ok:true}`** — 여기서 실패를 알리면 «그 이메일은 가입돼 있다»가 새 나간다(enumeration). 실패는 로그·감사로만.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { emailSchema, readJson } from "../../lib/validate";
import { findUserByEmail } from "../../lib/auth-service";
import { signActionToken, newNonce } from "../../lib/auth";
import { sendEmail, siteUrl, simpleMail } from "../../lib/email";
import { writeAudit } from "../../lib/audit";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
export const config = { path: "/api/auth-forgot" };
export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const body = await readJson<{ email?: string }>(req);
  const e = emailSchema.safeParse(body.email);
  if (!e.success) return badRequest("이메일을 확인해 주세요.");
  try {
    const u = await findUserByEmail(e.data);
    if (u) {
      const nonce = newNonce();
      await db.execute(sql`UPDATE users SET reset_nonce = ${nonce} WHERE id = ${u.id}`);
      const t = signActionToken({ id: u.id, purpose: "reset", nonce }, "30m");
      const link = `${siteUrl()}/reset.html?t=${encodeURIComponent(t)}`;
      const sent = await sendEmail(u.email, "AutoCreate 비밀번호 재설정", simpleMail("비밀번호를 다시 정해요", "아래 버튼은 30분 동안만 유효해요. 요청한 적 없다면 무시하세요.", { label: "새 비밀번호 만들기", url: link }));
      if (!sent) await writeAudit({ tenantId: Number(u.tenant_id) || null, action: "reset_mail_failed", actorType: "system", actorId: u.id, riskLevel: "medium" });
    }
    return json({ ok: true });
  } catch (err) { return jsonError("forgot", err); }
};
