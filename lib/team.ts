/**
 * lib/team.ts — **팀 시트**(소유자가 팀원을 부른다 · 계약 P1R8-B §4.5 · DESIGN §11 «소유자가 «팀원 초대» → 같은 테넌트 member»).
 *   🔎 출처: AC 신규(계약 P1R8-B §4.5 · 생성 커밋 `fae3352` 2026-09-16) — AM 원본 없음(`../AutoMarketing/lib/` 에 같은 이름 없음 · 2026-09-16 확인).
 *
 *   ══ 무엇이 없었나 ══
 *     `plans.limits.teamSeats`(1/2/5)가 **요금표에 있고 `checkLimit` 도 세고 있었는데**, 🔴 **팀원을 늘릴 길이 없었다.**
 *     한 집에 사람은 늘 한 명이고 `users.role`(owner|member)은 아무 데서도 안 쓰였다 —
 *     «Agency 는 팀 시트 5개»가 **팔리고 있는데 쓸 수 없는 줄**이었다(§4.8 «완료 = 화면에서 쓸 수 있을 때»의 반대).
 *
 *   ══ 🔴 지키는 것 다섯 ══
 *     ① **초대 토큰은 해시로만 둔다** — 비밀번호와 같은 취급. 평문은 메일로 한 번 나가고 **우리도 다시 못 본다**.
 *     ② **자리 수를 두 번 센다** — 보낼 때(대기 중 초대 포함)와 **받을 때** 다시. 안 그러면 초대 5통을 뿌려 한도를 넘긴다.
 *     ③ 🔴 **마지막 소유자는 못 내보낸다** — 집주인이 0명이면 결제·탈퇴를 아무도 못 한다(되돌릴 길이 없는 상태).
 *     ④ **owner 는 초대로 안 만든다** — 집주인이 둘이면 «누가 정하나»가 사라진다(양도는 따로 · 아직 없음).
 *     ⑤ **이미 다른 집에 있는 사람은 못 받는다** — `users.email` 이 전역 유일이라 그 사람의 기존 집이 사라진다.
 *        🔴 이건 «우리가 막는 게 아니라 **없는 길**»이다(§9) — 사람 하나가 두 집에 속하려면 `tenant_members` 표가 필요하고, 그건 인증 전체가 바뀌는 결정이다.
 */
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { checkLimit, featureOf, planOf, tenantPlan } from "./plans";

const n = (v: unknown) => Number(v || 0);
/** 초대가 살아 있는 기간. 길면 «누가 언제 들어올지 모르는 문»이 오래 열려 있다. */
export const INVITE_DAYS = 7;

export const hashInviteToken = (t: string) => crypto.createHash("sha256").update(String(t ?? ""), "utf8").digest("hex");
const newToken = () => crypto.randomBytes(24).toString("base64url");

export interface TeamMember { id: number; email: string; name: string; role: "owner" | "member"; joinedAt: string | null; me?: true }
export interface TeamInvite { id: number; email: string; invitedAt: string; expiresAt: string; expired: boolean }

/* ═══════════ 팀 승인 흐름(§4.5 · 메인 승인 2026-09-16) ═══════════
   🔴 **우리 판단이 아니다**(CLAUDE §9 밖) — **그 집 사장이 자기 직원에게 건 규칙**이다.
      §9 가 내리라는 건 «우리 판단으로 고객 계정을 막는 것»이고, 이건 «돈·계약»과 같은 칸이다.
   🔴 **기본 꺼짐** — 오늘 세 번째 같은 규율이다(러너 자동 시작 · BYO · 이것). 몰래 안 켠다.
   🔴 «막혔다»가 아니라 **«기다리는 중»**이다 — 그래서 owner 에게 **알림 + 홈 해야 할 일**이 가야 한다.
      안 가면 그 글은 **조용히 사라진다**(CLAUDE §4.7). */

/** 이 집이 팀 승인을 켰나 — **플랜 기능(Agency)** 과 **그 집 스위치**가 둘 다 참일 때만. */
export async function teamApprovalOn(tid: number): Promise<boolean> {
  try {
    const [t] = await q(sql`SELECT settings FROM tenants WHERE id = ${Math.floor(tid)}`);
    const s = (t?.settings && typeof t.settings === "object" ? t.settings : {}) as Record<string, unknown>;
    if (s.teamApproval !== true) return false;   // 🔴 기본 꺼짐
    const { plan } = await tenantPlan(Math.floor(tid));
    return featureOf(plan, "teamApproval") === true;
  } catch { return false; }   // 못 읽으면 «안 켰다» — 우리가 대신 막지 않는다(§9)
}

/**
 * needsOwnerApproval — 이 글이 **owner 를 기다려야 하나**.
 *   🔴 자동(크론)으로 만든 글은 `created_by` 가 **NULL** 이라 해당 없음 — 기계가 만든 글에 «누가 만들었나»는 없다.
 *   🔴 owner 가 만든 글도 해당 없음 — 자기가 만든 걸 자기가 또 승인할 이유가 없다.
 */
export async function needsOwnerApproval(tid: number, createdBy: unknown): Promise<boolean> {
  const uid = Math.floor(Number(createdBy) || 0);
  if (!uid) return false;
  if (!(await teamApprovalOn(tid))) return false;
  try {
    const [u] = await q(sql`SELECT role FROM users WHERE tenant_id = ${Math.floor(tid)} AND id = ${uid}`);
    return !!u && String(u.role) !== "owner";
  } catch { return false; }
}

/**
 * notifyOwnersWaiting — 🔴 **주인에게 알린다.** 이게 없으면 그 글은 조용히 사라진다.
 *   하루 한 번(KST)만 — 글마다 알리면 알림함이 도배되고, 도배된 알림은 **안 읽는 알림**이다.
 */
export async function notifyOwnersWaiting(tid: number): Promise<void> {
  try {
    const [c] = await q(sql`SELECT COUNT(*)::int AS c FROM pieces p
      WHERE p.tenant_id = ${Math.floor(tid)} AND p.status = 'in_review' AND p.created_by IS NOT NULL
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.created_by AND u.tenant_id = p.tenant_id AND u.role <> 'owner')`);
    const cnt = n(c?.c);
    if (!cnt) return;
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
      SELECT ${Math.floor(tid)}, ${"team_review"}, ${`팀원이 만든 글 ${cnt}건이 기다리고 있어요`},
             ${"보시고 승인하시면 편성표대로 나가요. 승인 전에는 나가지 않아요."}, ${"/app/pieces.html?status=in_review"}
      WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE tenant_id = ${Math.floor(tid)} AND kind = 'team_review'
        AND created_at >= (date_trunc('day', (NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul'))`);
  } catch (e) { console.warn("[team] 대기 알림 실패", String((e as Error)?.message ?? e).slice(0, 100)); }
}

/** 이 집에서 **주인을 기다리는 글** 수(홈 «해야 할 일» · 0이면 0을 그대로 준다 — «없음»과 «0»은 다르다). */
export async function waitingForOwner(tid: number): Promise<{ count: number; firstId: number }> {
  try {
    if (!(await teamApprovalOn(tid))) return { count: 0, firstId: 0 };
    const [r] = await q(sql`SELECT COUNT(*)::int AS c, MIN(p.id)::int AS first_id FROM pieces p
      WHERE p.tenant_id = ${Math.floor(tid)} AND p.status = 'in_review' AND p.created_by IS NOT NULL
        AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.created_by AND u.tenant_id = p.tenant_id AND u.role <> 'owner')`);
    return { count: n(r?.c), firstId: n(r?.first_id) };
  } catch { return { count: 0, firstId: 0 }; }
}

/** 이 집 사람들 + 살아 있는 초대 + 남은 자리. */
export async function teamOf(tid: number, meUid?: number): Promise<{ members: TeamMember[]; invites: TeamInvite[]; seats: { used: number; limit: number | null } }> {
  const rows = await q(sql`SELECT id, email, name, role, created_at FROM users WHERE tenant_id = ${tid} ORDER BY (role = 'owner') DESC, id`);
  const inv = await q(sql`SELECT id, email, created_at, expires_at FROM team_invites
    WHERE tenant_id = ${tid} AND accepted_at IS NULL AND revoked_at IS NULL ORDER BY id`);
  const chk = await checkLimit(tid, "teamSeats");
  const iso = (v: unknown) => (v ? new Date(String(v).endsWith("Z") ? String(v) : `${String(v)}Z`).toISOString() : null);
  return {
    members: rows.map((r) => ({
      id: n(r.id), email: String(r.email ?? ""), name: String(r.name ?? ""),
      role: String(r.role) === "owner" ? "owner" : "member", joinedAt: iso(r.created_at),
      ...(meUid && n(r.id) === meUid ? { me: true as const } : {}),
    })),
    /* 🔴 **대기 중 초대도 자리를 먹는다** — 안 그러면 초대 5통을 뿌려 한도를 넘긴 채 다 받게 된다. */
    invites: inv.map((r) => ({ id: n(r.id), email: String(r.email ?? ""), invitedAt: iso(r.created_at) ?? "", expiresAt: iso(r.expires_at) ?? "", expired: new Date(`${String(r.expires_at)}Z`).getTime() < Date.now() })),
    seats: { used: chk.used + inv.filter((r) => new Date(`${String(r.expires_at)}Z`).getTime() >= Date.now()).length, limit: chk.limit },
  };
}

export type InviteResult =
  | { ok: true; inviteId: number; token: string; expiresAt: string }
  | { ok: false; step: "seat" | "exists" | "self" | "pending" | "other_tenant" | "write"; error: string; used?: number; limit?: number | null };

/**
 * inviteMember — 소유자가 이메일로 부른다. 🔴 **토큰 원문은 이 반환값에만 있다**(메일로 보내고 버린다).
 */
export async function inviteMember(tid: number, email: string, byUid: number, byEmail?: string): Promise<InviteResult> {
  const mail = String(email ?? "").trim().toLowerCase();
  if (!mail || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(mail)) return { ok: false, step: "write", error: "이메일 주소를 확인해 주세요." };
  if (byEmail && mail === String(byEmail).toLowerCase()) return { ok: false, step: "self", error: "이미 이 집에 계세요." };

  const [mine] = await q(sql`SELECT id FROM users WHERE tenant_id = ${tid} AND lower(email) = ${mail}`);
  if (mine) return { ok: false, step: "exists", error: "이미 팀에 있는 분이에요." };
  /* 🔴 다른 집에 이미 있는 사람 — 받아 주면 그 사람의 **기존 집이 사라진다**(users.email 이 전역 유일).
     «우리가 막는 것»이 아니라 **없는 길**이다(§9). 그래서 문구도 «안 돼요»가 아니라 사실과 길을 준다. */
  const [other] = await q(sql`SELECT id FROM users WHERE lower(email) = ${mail}`);
  if (other) return { ok: false, step: "other_tenant", error: "그 주소는 이미 다른 곳에서 쓰고 있어요. 다른 주소로 불러 주세요." };

  /* 🔴 **«이미 보낸 초대»를 자리보다 먼저 본다.** 순서가 반대면 그 초대가 자리를 먹고 있어서
     같은 사람에게 다시 보낼 때 «자리가 찼어요»라고 **엉뚱한 말**을 한다 — 고객은 요금제를 올리러 간다(스모크가 잡았다). */
  const [pending] = await q(sql`SELECT id FROM team_invites
    WHERE tenant_id = ${tid} AND lower(email) = ${mail} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > NOW() LIMIT 1`);
  if (pending) return { ok: false, step: "pending", error: "그 주소로 보낸 초대가 아직 살아 있어요. 철회하고 다시 보내실 수 있어요." };

  const seat = await teamOf(tid);
  if (seat.seats.limit !== null && seat.seats.used >= seat.seats.limit) {
    return { ok: false, step: "seat", error: `지금 요금제는 팀 자리가 ${seat.seats.limit}개예요. 요금제를 올리면 더 부를 수 있어요.`, used: seat.seats.used, limit: seat.seats.limit };
  }

  const token = newToken();
  try {
    const [row] = await q(sql`INSERT INTO team_invites (tenant_id, email, role, token_hash, invited_by, expires_at)
      VALUES (${tid}, ${mail}, ${"member"}, ${hashInviteToken(token)}, ${byUid || null}, NOW() + (${INVITE_DAYS} || ' days')::interval) RETURNING id, expires_at`);
    await writeAudit({ tenantId: tid, action: "team_invite", actorType: "user", actorId: byUid, target: `invite:${n(row?.id)}`, detail: { email: mail } });
    return { ok: true, inviteId: n(row?.id), token, expiresAt: new Date(`${String(row?.expires_at)}Z`).toISOString() };
  } catch (e) {
    /* 부분 유니크에 걸렸다 = 살아 있는 초대가 이미 있다. «또 보냈어요»가 아니라 사실을 말한다. */
    if ((e as { code?: string })?.code === "23505") return { ok: false, step: "pending", error: "그 주소로 보낸 초대가 아직 살아 있어요. 철회하고 다시 보내실 수 있어요." };
    console.error("[team] 초대 실패", String((e as Error)?.message ?? e).slice(0, 160));
    return { ok: false, step: "write", error: "초대를 보내지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

/** 초대 한 건 읽기(토큰으로) — 받는 화면이 «어느 집인지»를 먼저 보여 줄 수 있게. */
export async function inviteByToken(token: string): Promise<{ ok: true; id: number; tenantId: number; email: string; tenantName: string } | { ok: false; error: string }> {
  const [r] = await q(sql`SELECT i.id, i.tenant_id, i.email, t.name AS tenant_name FROM team_invites i LEFT JOIN tenants t ON t.id = i.tenant_id
    WHERE i.token_hash = ${hashInviteToken(token)} AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > NOW() LIMIT 1`);
  if (!r) return { ok: false, error: "초대가 만료됐거나 이미 쓰였어요. 초대한 분께 다시 요청해 주세요." };
  return { ok: true, id: n(r.id), tenantId: n(r.tenant_id), email: String(r.email ?? ""), tenantName: String(r.tenant_name ?? "") };
}

/** 소유자가 초대를 거둔다. */
export async function revokeInvite(tid: number, id: number, byUid: number): Promise<boolean> {
  const rows = await q(sql`UPDATE team_invites SET revoked_at = NOW() WHERE tenant_id = ${tid} AND id = ${Math.floor(id)} AND accepted_at IS NULL AND revoked_at IS NULL RETURNING id`);
  if (rows.length) await writeAudit({ tenantId: tid, action: "team_invite_revoke", actorType: "user", actorId: byUid, target: `invite:${Math.floor(id)}` });
  return rows.length > 0;
}

/**
 * removeMember — 팀에서 뺀다.
 *   🔴 **마지막 소유자는 못 뺀다** — 집주인이 0명이면 결제·탈퇴를 아무도 못 하고, 되돌릴 길이 없다.
 *   🔴 뺀 사람이 만든 글·자리는 **그대로 둔다**(사람이 나갔다고 일이 사라지지 않는다).
 */
export async function removeMember(tid: number, userId: number, byUid: number): Promise<{ ok: true } | { ok: false; step: string; error: string }> {
  const uid = Math.floor(Number(userId) || 0);
  if (!uid) return { ok: false, step: "bad", error: "누구를 뺄지 골라 주세요." };
  if (uid === byUid) return { ok: false, step: "self", error: "스스로를 뺄 수는 없어요." };
  const [u] = await q(sql`SELECT id, role, email FROM users WHERE tenant_id = ${tid} AND id = ${uid}`);
  if (!u) return { ok: false, step: "not_found", error: "그분을 찾을 수 없어요." };
  if (String(u.role) === "owner") {
    const [c] = await q(sql`SELECT COUNT(*)::int AS c FROM users WHERE tenant_id = ${tid} AND role = 'owner'`);
    if (n(c?.c) <= 1) return { ok: false, step: "last_owner", error: "마지막 주인은 뺄 수 없어요. 먼저 다른 분께 주인을 넘겨 주세요." };
  }
  await q(sql`DELETE FROM users WHERE tenant_id = ${tid} AND id = ${uid}`);
  await writeAudit({ tenantId: tid, action: "team_member_remove", actorType: "user", actorId: byUid, riskLevel: "medium", target: `user:${uid}`, detail: { email: String(u.email ?? ""), role: String(u.role) } });
  return { ok: true };
}
