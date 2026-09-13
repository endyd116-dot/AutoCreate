/** POST /api/auth-forgot { email } — 항상 ok(enumeration 방지). 있으면 1회용 재설정 링크(30분). */
import { json, jsonError, badRequest } from "../../lib/response";
import { emailSchema, readJson } from "../../lib/validate";
import { findUserByEmail } from "../../lib/auth-service";
import { signActionToken, newNonce } from "../../lib/auth";
import { sendEmail, siteUrl, simpleMail } from "../../lib/email";
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
      void sendEmail(u.email, "AutoCreate 비밀번호 재설정", simpleMail("비밀번호를 다시 정해요", "아래 버튼은 30분 동안만 유효해요. 요청한 적 없다면 무시하세요.", { label: "새 비밀번호 만들기", url: link }));
    }
    return json({ ok: true });
  } catch (err) { return jsonError("forgot", err); }
};
