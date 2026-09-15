/**
 * 팀 시트 — 소유자가 팀원을 부른다(계약 P1R8-B §4.5 · DESIGN §11).
 *   GET  /api/team                        → { ok, members:[{ id, email, name, role, joinedAt, me? }], invites:[…], seats:{ used, limit }, isOwner }
 *   POST /api/team-invite  { email }      → 201 { ok, inviteId, expiresAt, mailSent, link? }   (소유자만)
 *   POST /api/team-revoke  { id }         → { ok }                                             (소유자만)
 *   POST /api/team-remove  { userId }     → { ok }                                             (소유자만)
 *   GET  /api/team-invite-info?token=     → { ok, tenantName, email }        🔴 로그인 없이(받는 사람은 아직 우리 고객이 아니다)
 *   POST /api/team-accept  { token, name?, password } → 201 + 세션 쿠키      🔴 로그인 없이
 *
 *   🔴 **왜 이게 없었나**: `plans.limits.teamSeats`(1/2/5)가 요금표에 있고 `checkLimit` 도 세고 있었는데 **늘릴 길이 없었다** —
 *      «Agency 는 팀 자리 5개»가 팔리는데 **쓸 수 없는 줄**이었다(§4.8 «완료 = 화면에서 쓸 수 있을 때»의 반대).
 *   🔴 소유자만 하는 일: 부르기·거두기·빼기. `users.role` 이 여태 **아무 데서도 안 쓰였다** — 여기가 첫 자리다.
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { clientIp, userAgent } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { sendEmail, simpleMail, siteUrl } from "../../lib/email";
import { issueUserSession } from "../../lib/auth-service";
import { jsonWithCookies } from "./_resp";
import { teamOf, inviteMember, revokeInvite, removeMember, inviteByToken, hashInviteToken } from "../../lib/team";
import bcrypt from "bcryptjs";

export const config = { path: ["/api/team", "/api/team-invite", "/api/team-revoke", "/api/team-remove", "/api/team-invite-info", "/api/team-accept"] };
const n = (v: unknown) => Number(v || 0);
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  const url = new URL(req.url);
  try {
    /* ── 로그인 없이 도는 둘 — 받는 사람은 **아직 우리 고객이 아니다** ── */
    if (path.endsWith("/team-invite-info")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const r = await inviteByToken(String(url.searchParams.get("token") ?? ""));
      return r.ok ? json({ ok: true, tenantName: r.tenantName, email: r.email }) : json({ ok: false, error: r.error, step: "invite" }, 410);
    }
    if (path.endsWith("/team-accept")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<{ token?: unknown; name?: unknown; password?: unknown }>(req);
      const token = String(b.token ?? "").trim();
      const password = String(b.password ?? "");
      if (!token) return badRequest("초대 링크가 올바르지 않아요.", "token");
      if (password.length < 8) return badRequest("비밀번호는 8자 이상으로 정해 주세요.", "password");
      const inv = await inviteByToken(token);
      if (!inv.ok) return json({ ok: false, error: inv.error, step: "invite" }, 410);

      /* 🔴 **자리를 여기서 다시 센다** — 보낼 때 셌어도 그 사이에 다른 초대가 받아졌을 수 있다.
         안 세면 «초대 5통 뿌리고 다 받기»로 한도가 뚫린다. */
      const seat = await teamOf(inv.tenantId);
      const filled = seat.members.length;
      if (seat.seats.limit !== null && filled >= seat.seats.limit) {
        return json({ ok: false, step: "seat", error: "그 사이에 팀 자리가 다 찼어요. 초대한 분께 알려 주세요." }, 409);
      }
      const [dup] = await q(sql`SELECT id FROM users WHERE lower(email) = ${inv.email.toLowerCase()}`);
      if (dup) return json({ ok: false, step: "exists", error: "그 주소는 이미 쓰고 있어요. 그 계정으로 로그인해 주세요." }, 409);

      const hash = await bcrypt.hash(password, 10);
      const [u] = await q(sql`INSERT INTO users (tenant_id, email, password_hash, name, role, invited_by, email_verified_at)
        VALUES (${inv.tenantId}, ${inv.email}, ${hash}, ${b.name ? String(b.name).slice(0, 80) : null}, ${"member"}, ${null}, NOW()) RETURNING id, email, name`);
      /* 🔴 초대 메일을 받은 사람이니 **이메일은 이미 확인된 것**이다 — 또 확인 메일을 보내면 «왜 또?»가 된다. */
      await q(sql`UPDATE team_invites SET accepted_at = NOW(), accepted_uid = ${n(u.id)} WHERE token_hash = ${hashInviteToken(token)}`);
      await writeAudit({ tenantId: inv.tenantId, action: "team_invite_accept", actorType: "user", actorId: n(u.id), ip: clientIp(req), target: `invite:${inv.id}`, detail: { email: inv.email } });
      const cookies = await issueUserSession({ id: n(u.id), tenant_id: inv.tenantId, email: inv.email, name: (b.name ? String(b.name) : null), role: "member" }, { remember: true, ua: userAgent(req), ip: clientIp(req) });
      return jsonWithCookies({ ok: true, tenantName: inv.tenantName }, cookies, 201);
    }

    /* ── 여기부터는 로그인 ── */
    const auth = requireUser(req); if (!auth.ok) return auth.res;
    const tid = auth.tid; const uid = n(auth.user.uid);
    const isOwner = String(auth.user.role ?? "") === "owner";

    if (path.endsWith("/team")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const t = await teamOf(tid, uid);
      /* 팀원에게는 **초대 목록을 안 보여 준다** — 부르고 거두는 건 소유자의 일이다(볼 이유가 없다). */
      return json({ ok: true, members: t.members, invites: isOwner ? t.invites : [], seats: t.seats, isOwner });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    /* 🔴 소유자만 — `users.role` 을 실제로 쓰는 첫 자리다. 「돈·계약」 축이라 §9 밖이다(우리 판단이 아니라 권한). */
    if (!isOwner) return json({ ok: false, step: "owner_only", error: "팀은 이 집의 주인만 바꿀 수 있어요." }, 403);

    if (path.endsWith("/team-invite")) {
      const b = await readJson<{ email?: unknown }>(req);
      const r = await inviteMember(tid, String(b.email ?? ""), uid, auth.user.email);
      if (!r.ok) return json({ ok: false, step: r.step, error: r.error, ...(r.limit !== undefined ? { used: r.used, limit: r.limit } : {}) }, r.step === "seat" ? 402 : 400);
      const link = `${siteUrl()}/app/team-accept.html?token=${encodeURIComponent(r.token)}`;
      const [t] = await q(sql`SELECT name FROM tenants WHERE id = ${tid}`);
      const who = String(t?.name ?? "").trim() || "팀";
      /* 🔴 메일이 안 나가도 초대는 **살아 있다** — 링크를 응답에 돌려주어 소유자가 직접 전할 수 있게 한다(막다른 길을 만들지 않는다). */
      const mailSent = await sendEmail(String(b.email ?? ""), `[AutoCreate] ${who} 에서 함께 일하자고 부르셨어요`,
        simpleMail(`${who} 에 초대받으셨어요`, "아래 버튼을 누르면 바로 함께 시작할 수 있어요. 링크는 7일 동안 살아 있어요.", { label: "초대 받기", url: link }));
      return json({ ok: true, inviteId: r.inviteId, expiresAt: r.expiresAt, mailSent, ...(mailSent ? {} : { link }) }, 201);
    }

    if (path.endsWith("/team-revoke")) {
      const b = await readJson<{ id?: unknown }>(req);
      const id = n(b.id); if (!id) return badRequest("어떤 초대를 거둘지 골라 주세요.", "id");
      return (await revokeInvite(tid, id, uid))
        ? json({ ok: true })
        : json({ ok: false, step: "not_found", error: "이미 받았거나 거둔 초대예요." }, 404);
    }

    if (path.endsWith("/team-remove")) {
      const b = await readJson<{ userId?: unknown }>(req);
      const r = await removeMember(tid, n(b.userId), uid);
      return r.ok ? json({ ok: true }) : json({ ok: false, step: r.step, error: r.error }, r.step === "not_found" ? 404 : 400);
    }

    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("team", err); }
};
