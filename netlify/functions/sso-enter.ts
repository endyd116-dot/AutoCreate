/**
 * GET /api/sso/enter?t=<JWT> — 싸이렌MIS 허브 SSO 진입점. AM 원본: ../AutoMarketing/netlify/functions/sso-enter.ts (복사 2026-09-14 · AC 개작)
 *   허브 `sso-autocreate`가 60초 토큰(iss siren-hub · aud autocreate · role claim) 서명 → 여기서 검증 → operators upsert → ac_ops 쿠키 → /ops/.
 *   role claim: sso-role.ts 판정(신규=부여 · 기존=상향만 자동 · 하향은 감사만). 비활성 계정은 부활하지 않는다.
 *   실패는 throw 없이 /ops/login.html?sso_error= 로 302.
 */
import { verifySsoToken, clientIp } from "../../lib/auth";
import { parseSsoRoleClaim, resolveSsoRole, type SsoRole } from "../../lib/sso-role";
import { findOperatorByEmail, upsertOperatorFromSso, issueOpsSession } from "../../lib/auth-service";
import { writeAudit } from "../../lib/audit";
import { redirectWithCookies } from "./_resp";

export const config = { path: "/api/sso/enter" };

// AM G10 — role claim 없는 범용 토큰은 allowlist 이메일만(전역 발권 차단). 유효 role claim 은 MIS가 운영진임을 단언 → 면제.
const SSO_ALLOWLIST = new Set((process.env.SSO_ADMIN_EMAILS || "endyd1116@gmail.com,endyd116@gmail.com").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const t = url.searchParams.get("t") || url.searchParams.get("token") || "";
  const sso = verifySsoToken(t);
  if (!sso) return redirectWithCookies("/ops/login.html?sso_error=invalid");
  const email = (sso.email || "").toLowerCase().trim();
  if (!email) return redirectWithCookies("/ops/login.html?sso_error=noemail");
  const claim: SsoRole | null = parseSsoRoleClaim(sso.role);
  if (!claim && !SSO_ALLOWLIST.has(email)) return redirectWithCookies("/ops/login.html?sso_error=not_allowed");
  try {
    const existing = await findOperatorByEmail(email);
    if (existing && !existing.active) return redirectWithCookies("/ops/login.html?sso_error=inactive");
    const decision = resolveSsoRole((existing?.role as SsoRole) ?? null, claim);
    const op = await upsertOperatorFromSso({ email, name: sso.name, sub: String(sso.sub), role: decision.role });
    if (!op) return redirectWithCookies("/ops/login.html?sso_error=inactive");
    if (decision.audit) await writeAudit({ tenantId: null, action: "sso_role_map", actorType: "operator", actorId: op.id, ip: clientIp(req), detail: { claim, action: decision.action, applied: decision.role } });
    await writeAudit({ tenantId: null, action: "ops_login_sso", actorType: "operator", actorId: op.id, ip: clientIp(req) });
    return redirectWithCookies("/ops/", issueOpsSession({ id: op.id, email: op.email, name: op.name, role: decision.role }));
  } catch (err) {
    console.error("[sso-enter]", err);
    return redirectWithCookies("/ops/login.html?sso_error=server");
  }
};
