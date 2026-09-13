/** GET /api/auth-verify?t= — 이메일 인증(1회용 nonce). 성공/실패 모두 앱으로 302. */
import { verifyActionToken } from "../../lib/auth";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { redirectWithCookies } from "./_resp";
export const config = { path: "/api/auth-verify" };
export default async (req: Request): Promise<Response> => {
  const t = new URL(req.url).searchParams.get("t") || "";
  const p = verifyActionToken(t);
  if (!p || p.purpose !== "verify") return redirectWithCookies("/app/home.html?verify=invalid");
  try {
    const r = (await db.execute(sql`UPDATE users SET email_verified_at = NOW(), verify_nonce = NULL WHERE id = ${p.id} AND verify_nonce = ${p.nonce} RETURNING id`)) as unknown as unknown[];
    return redirectWithCookies(r.length ? "/app/home.html?verify=ok" : "/app/home.html?verify=used");
  } catch { return redirectWithCookies("/app/home.html?verify=error"); }
};
