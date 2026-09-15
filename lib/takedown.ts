/**
 * lib/takedown.ts — 침해 통지 대응 **다섯 걸음**(DESIGN §5E.2 · 사장님 질문 2026-09-15 · 계약 R8).
 *
 *   ══ 우리가 만드는 것 / 안 만드는 것 ══
 *     ✅ (가) **우리 안에서 내리기** — ①재발행·재생성 차단 ②예약 중지 ③기한 통지 ④계정 해제 → 서비스 정지
 *     ✅ ② 고객이 «대신 내려 줘»를 누르면 **B2 의 `publish.retract` 잡**을 부른다(잡은 B2 몫 · 우리는 부르기만 · `lib/retract-port.ts`)
 *     🔴 ③ **우리가 고객 동의 없이 내리기는 만들지 않는다**(DESIGN §5E.1): 되돌릴 수 없고, 통지는 **틀린 것도 온다**(경쟁자가 걸기도 한다).
 *        대신 ①~④를 확실히 갖는 것이 그 대가다.
 *
 *   ══ 규율 ══
 *     🔴 되돌릴 수 없는 4단계(계정 해제·서비스 정지)는 **운영자 확인 + 감사 high** — 크론은 «기한이 지났다»만 알리고 **자동으로 정지하지 않는다**
 *        (자동 정지는 틀린 통지 하나로 멀쩡한 고객을 끊는다 · 크론은 운영 대기열에 올린다).
 *     🔴 고객에게 보이는 문구는 **무엇이 왜 문제인지**를 사람말로(«침해 통지»라고만 쓰면 뭘 해야 할지 모른다).
 *     🔴 `posts` 행은 지우지 않는다 — `retracted_at`·사유만 적는다(수익 귀속·감사).
 *     🔴 내리는 데 **코인 0**(우리 잘못이든 고객 마음이든).
 *     ⚠️ 법적 판단은 우리가 하지 않는다 — «남의 플랫폼 글은 그 플랫폼이 신고를 받는다»는 우리 이해이고, 약관 법률 검토 항목이다.
 *        **약관에 있어야 하는 문장 3**(체크리스트로 올림): ①고객이 올린 내용에 대한 **보증·책임** ②우리가 **예약을 멈추고 연결을 해제할 수 있는 근거**
 *        ③통지가 오면 고객이 **지체 없이** 조치해야 한다는 의무. 지금 약관엔 셋 다 없다(B3 grep 확인).
 *   🔎 출처: AC 신규(DESIGN §5E · 생성 커밋 2026-09-15).
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { jsonb, utcDate } from "./db-util";
import { sendEmail, simpleMail, siteUrl } from "./email";
import { tenantOwner } from "./subscription";
import { createTicket } from "./cs";
import { enqueueRetract, retractAvailable } from "./retract-port";

const n = (v: unknown) => Number(v || 0);
export const TAKEDOWN_DUE_DAYS = 7;
/** 기한이 지나도 **자동 정지하지 않는다** — 운영자가 누르기 전까지 며칠을 더 기다리는지(대기열에서 보인다). */
export const TAKEDOWN_KINDS = ["copyright", "defamation", "privacy", "policy", "other"] as const;
export type TakedownKind = typeof TAKEDOWN_KINDS[number];
export const TAKEDOWN_KIND_LABEL: Record<TakedownKind, string> = {
  copyright: "저작권", defamation: "명예훼손·비방", privacy: "개인정보", policy: "채널 정책 위반", other: "기타",
};
export type TakedownStatus = "open" | "customer_removed" | "retracted" | "disconnected" | "suspended" | "dismissed" | "resolved";
/** 아직 «살아 있는» 통지 — 이 상태면 그 글은 다시 못 나간다. */
export const ACTIVE_STATUSES: readonly TakedownStatus[] = ["open", "disconnected", "suspended"];

/** 원문 해시 — 공백·대소문자를 지운 본문의 sha256(같은 글을 다시 구워도 같은 값). */
export function contentHash(body: unknown): string {
  const t = String(body ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  return createHash("sha256").update(t).digest("hex").slice(0, 64);
}

export interface TakedownView {
  id: number; status: TakedownStatus; kind: TakedownKind; kindLabel: string; reason: string;
  channel?: string; externalUrl?: string; pieceId?: number; accountId?: number;
  receivedAt: string; dueAt: string; daysLeft: number; claimant?: string;
  canRetract: boolean; retractAvailable: boolean;
}
/** 남은 날 = **KST 달력 날짜 차이**(밀리초 차이로 세면 «7일 뒤»가 8일로 보인다 — 사람이 세는 방식으로). */
function daysLeftKst(due: Date, now = new Date()): number {
  const day = (d: Date) => Math.floor((d.getTime() + 9 * 3600_000) / 86400_000);
  return Math.max(0, day(due) - day(now));
}
function toView(r: Record<string, unknown>, canRetract: boolean, retractOn: boolean): TakedownView {
  const due = utcDate(r.due_at) ?? new Date();
  const kind = (TAKEDOWN_KINDS as readonly string[]).includes(String(r.kind)) ? String(r.kind) as TakedownKind : "other";
  const o: TakedownView = {
    id: n(r.id), status: String(r.status) as TakedownStatus, kind, kindLabel: TAKEDOWN_KIND_LABEL[kind],
    reason: String(r.reason ?? ""), receivedAt: utcDate(r.received_at)?.toISOString() ?? "", dueAt: due.toISOString(),
    daysLeft: daysLeftKst(due), canRetract, retractAvailable: retractOn,
  };
  if (r.channel) o.channel = String(r.channel);
  if (r.external_url) o.externalUrl = String(r.external_url);
  if (r.piece_id) o.pieceId = n(r.piece_id);
  if (r.account_id) o.accountId = n(r.account_id);
  if (r.claimant) o.claimant = String(r.claimant);
  return o;
}

/* ───────── ① 차단 — 그 글은 다시 못 나간다 ───────── */
export interface BlockCheck { blocked: boolean; noticeId?: number; reason?: string; message?: string }
/**
 * takedownBlock(tid, piece) — 이 글이 통지로 막혀 있나. **발행·재생성 앞에서** 묻는다.
 *   같은 piece 거나, **본문이 같은 글**(content_hash)이면 막는다 — 다시 구워도 같은 내용이면 같은 문제다.
 *   조회 실패는 **통과**(보조 게이트 · 발행 본류를 세우지 않는다) — 대신 콘솔에 남긴다.
 */
export async function takedownBlock(tid: number, piece: { id?: unknown; body?: unknown }): Promise<BlockCheck> {
  const pieceId = n(piece?.id);
  try {
    const hash = piece?.body ? contentHash(piece.body) : null;
    const [row] = await q(sql`SELECT id, reason, kind FROM takedown_notices
      WHERE tenant_id = ${tid} AND status IN (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)})
        AND (piece_id = ${pieceId || null} ${hash ? sql`OR content_hash = ${hash}` : sql``})
      ORDER BY id DESC LIMIT 1`);
    if (!row) return { blocked: false };
    const kind = String(row.kind) as TakedownKind;
    return { blocked: true, noticeId: n(row.id), reason: String(row.reason ?? ""),
      message: `이 글은 «${TAKEDOWN_KIND_LABEL[kind] ?? "신고"}» 로 접수된 통지가 있어서 다시 올릴 수 없어요. 문의함의 안내를 확인해 주세요.` };
  } catch (e) { console.warn("[takedown] 차단 조회 실패 — 통과", String((e as Error)?.message ?? e).slice(0, 100)); return { blocked: false }; }
}

/* ───────── 접수(운영자) = ①②③ 을 한 번에 ───────── */
export interface ReceiveInput {
  tenantId: number; pieceId?: number | null; postId?: number | null; externalUrl?: string | null;
  kind: TakedownKind; claimant?: string | null; evidence?: string | null; reason: string; dueDays?: number; operatorId: number; ip?: string | null;
}
export type ReceiveResult = { ok: true; notice: TakedownView; stoppedSlots: number } | { ok: false; step: "tenant" | "reason" | "target"; error: string };
/**
 * receiveNotice — 통지 접수(운영센터). 접수 즉시:
 *   ① 그 글(과 같은 본문)의 재발행·재생성을 막는다(해시 저장) ② 그 계정·그 소재의 **예약을 세운다**(슬롯 `skipped` + 사유)
 *   ③ 고객에게 **기한과 함께** 알린다(알림 + 메일 + 문의함 티켓) — 무엇이 왜 문제인지 사람말로.
 */
export async function receiveNotice(inp: ReceiveInput): Promise<ReceiveResult> {
  const tid = n(inp.tenantId);
  const reason = String(inp.reason ?? "").trim().slice(0, 1000);
  if (!tid) return { ok: false, step: "tenant", error: "어느 고객인지 골라 주세요." };
  if (reason.length < 5) return { ok: false, step: "reason", error: "고객에게 보일 사유를 사람말로 적어 주세요(무엇이 왜 문제인지)." };
  const [t] = await q(sql`SELECT id, name FROM tenants WHERE id = ${tid}`);
  if (!t) return { ok: false, step: "tenant", error: "그 고객을 찾을 수 없어요." };

  let pieceId = inp.pieceId ? n(inp.pieceId) : 0;
  let postId = inp.postId ? n(inp.postId) : 0;
  const url = String(inp.externalUrl ?? "").trim().slice(0, 500) || null;
  /* 주소만 온 통지도 받는다 — 우리가 그 주소를 아는 글이면 이어 준다(모르면 그대로 둔다 · «없음»을 억지로 채우지 않는다). */
  if (!postId && url) { const [p] = await q(sql`SELECT id, piece_id FROM posts WHERE tenant_id = ${tid} AND external_url = ${url} ORDER BY id DESC LIMIT 1`); if (p) { postId = n(p.id); pieceId = pieceId || n(p.piece_id); } }
  if (!pieceId && postId) { const [p] = await q(sql`SELECT piece_id FROM posts WHERE id = ${postId} AND tenant_id = ${tid}`); pieceId = n(p?.piece_id); }
  if (!pieceId && !postId && !url) return { ok: false, step: "target", error: "어느 글인지(주소 또는 글 번호) 적어 주세요." };

  const [pc] = pieceId ? await q(sql`SELECT id, body, channel, account_id, topic_id FROM pieces WHERE id = ${pieceId} AND tenant_id = ${tid}`) : [null];
  const hash = pc?.body ? contentHash(pc.body) : null;
  const channel = pc?.channel ? String(pc.channel) : (postId ? String((await q(sql`SELECT channel FROM posts WHERE id = ${postId}`))[0]?.channel ?? "") : "") || null;
  const accountId = pc?.account_id ? n(pc.account_id) : null;
  const dueDays = Math.max(1, Math.min(30, Math.floor(Number(inp.dueDays ?? TAKEDOWN_DUE_DAYS))));

  const [row] = await q(sql`INSERT INTO takedown_notices (tenant_id, piece_id, post_id, account_id, channel, external_url, kind, claimant, evidence, reason, content_hash, received_by, due_at)
    VALUES (${tid}, ${pieceId || null}, ${postId || null}, ${accountId}, ${channel}, ${url}, ${inp.kind}, ${String(inp.claimant ?? "").slice(0, 160) || null},
      ${String(inp.evidence ?? "").slice(0, 4000) || null}, ${reason}, ${hash}, ${n(inp.operatorId) || null}, NOW() + make_interval(days => ${dueDays}))
    RETURNING *`);
  const noticeId = n(row.id);

  // ② 예약을 세운다 — 그 계정(있으면)·그 소재의 아직 안 나간 자리. 이미 나간 글은 건드리지 않는다.
  let stopped = 0;
  try {
    const stop = await q(sql`UPDATE slots SET status = 'skipped', note = ${`신고 접수로 멈췄어요 — ${reason.slice(0, 120)}`}, updated_at = NOW()
      WHERE tenant_id = ${tid} AND status NOT IN ('published', 'skipped', 'failed')
        AND (${accountId ? sql`account_id = ${accountId}` : sql`false`} ${pc?.topic_id ? sql`OR topic_id = ${n(pc.topic_id)}` : sql``})
      RETURNING id`);
    stopped = stop.length;
    if (pieceId) await q(sql`UPDATE pieces SET meta = COALESCE(meta, '{}'::jsonb) || ${jsonb({ takedown: { noticeId, at: new Date().toISOString() } })}, updated_at = NOW() WHERE id = ${pieceId} AND tenant_id = ${tid}`);
  } catch (e) { console.warn("[takedown] 예약 중지 실패", String((e as Error)?.message ?? e).slice(0, 120)); }

  // ③ 고객에게 — 알림 + 메일 + 문의함(답할 자리가 있어야 한다)
  const due = utcDate(row.due_at);
  const dueTxt = due ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(due) : `${dueDays}일 안`;
  const title = "올라간 글에 대한 신고가 접수됐어요";
  const body = `${TAKEDOWN_KIND_LABEL[inp.kind]} 문제로 신고가 들어왔어요.\n\n무엇이 문제인가: ${reason}\n\n${url ? `그 글: ${url}\n\n` : ""}${dueTxt}까지 직접 내려 주시거나, «대신 내려 주기»를 눌러 주세요. 그때까지 같은 글은 다시 올라가지 않도록 막아 뒀어요. 기한이 지나면 계정 연결이 해제될 수 있어요.`;
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"takedown_notice"}, ${title}, ${body}, ${"/app/settings.html#takedown"})`);
  const owner = await tenantOwner(tid);
  if (owner.email) await sendEmail(owner.email, `[AutoCreate] ${title}`, simpleMail(title, body.replace(/\n\n/g, "<br><br>"), { label: "확인하러 가기", url: `${siteUrl()}/app/settings.html#takedown` }));
  await createTicket({ tenantId: tid, subject: `신고 접수 — ${TAKEDOWN_KIND_LABEL[inp.kind]}${url ? ` (${url.slice(0, 60)})` : ""}`, text: body, source: "system", priority: "high", tags: ["신고"], autoKey: `takedown:${noticeId}` });
  await writeAudit({ tenantId: tid, action: "takedown_received", actorType: "operator", actorId: n(inp.operatorId) || null, ip: inp.ip ?? null, riskLevel: "high", target: `takedown:${noticeId}`,
    detail: { kind: inp.kind, pieceId: pieceId || null, postId: postId || null, url, claimant: inp.claimant ?? null, dueDays, stoppedSlots: stopped, hash } });
  return { ok: true, notice: toView(row, !!postId, retractAvailable()), stoppedSlots: stopped };
}

/* ───────── 고객 쪽 ───────── */
export async function listNotices(tid: number): Promise<TakedownView[]> {
  const rows = await q(sql`SELECT * FROM takedown_notices WHERE tenant_id = ${tid} ORDER BY id DESC LIMIT 50`);
  return rows.map((r) => toView(r, !!r.post_id, retractAvailable()));
}
/** 고객이 «직접 내렸어요» — 우리가 확인할 길이 있으면(러너) 확인 잡을 걸고, 없으면 말한 그대로 받는다(운영자가 본다). */
export async function markCustomerRemoved(tid: number, noticeId: number, uid: number | null): Promise<{ ok: boolean; status?: TakedownStatus; error?: string; verifying?: boolean }> {
  const [row] = await q(sql`SELECT * FROM takedown_notices WHERE id = ${noticeId} AND tenant_id = ${tid}`);
  if (!row) return { ok: false, error: "그 신고를 찾을 수 없어요." };
  if (!ACTIVE_STATUSES.includes(String(row.status) as TakedownStatus)) return { ok: true, status: String(row.status) as TakedownStatus };
  await q(sql`UPDATE takedown_notices SET status = ${"customer_removed"}, resolution = ${"고객이 직접 내렸다고 알림"}, updated_at = NOW() WHERE id = ${noticeId}`);
  if (row.post_id) await q(sql`UPDATE posts SET retracted_at = NOW(), retract_reason = ${"고객이 직접 내림(신고 대응)"} WHERE id = ${n(row.post_id)} AND retracted_at IS NULL`);
  const v = row.piece_id ? await enqueueRetract(tid, { pieceId: n(row.piece_id), accountId: row.account_id ? n(row.account_id) : null, verifyOnly: true }) : { ok: false as const, unavailable: true };
  await writeAudit({ tenantId: tid, action: "takedown_customer_removed", actorType: "user", actorId: uid, riskLevel: "medium", target: `takedown:${noticeId}`, detail: { postId: row.post_id ? n(row.post_id) : null, verifyQueued: v.ok } });
  await createTicket({ tenantId: tid, subject: `신고 #${noticeId} — 고객이 «직접 내렸다»고 알림`, text: "운영자 확인이 필요합니다(정말 내려갔는지).", source: "system", priority: "normal", tags: ["신고"], autoKey: `takedown_removed:${noticeId}` });
  return { ok: true, status: "customer_removed", verifying: v.ok };
}
/** 고객이 «대신 내려 줘» — B2 의 `publish.retract` 잡을 건다(길이 없으면 정직하게 «직접 내려 주세요»). 🔴 코인 0. */
export async function requestRetract(tid: number, noticeId: number, uid: number | null): Promise<{ ok: boolean; queued?: boolean; error?: string; step?: string; url?: string }> {
  const [row] = await q(sql`SELECT * FROM takedown_notices WHERE id = ${noticeId} AND tenant_id = ${tid}`);
  if (!row) return { ok: false, error: "그 신고를 찾을 수 없어요." };
  if (!row.piece_id) return { ok: false, step: "no_target", error: "이 신고는 우리가 올린 글로 이어지지 않아요. 채널에서 직접 내려 주세요.", ...(row.external_url ? { url: String(row.external_url) } : {}) };
  const r = await enqueueRetract(tid, { pieceId: n(row.piece_id), accountId: row.account_id ? n(row.account_id) : null });
  if (!r.ok) {
    return { ok: false, step: r.unavailable ? "not_configured" : "enqueue",
      error: r.unavailable ? "이 채널은 아직 대신 내려 드릴 수 없어요. 채널에서 직접 내려 주세요 — 내리시면 «직접 내렸어요»를 눌러 주세요." : "요청을 넣지 못했어요. 잠시 뒤 다시 해 주세요.",
      ...(row.external_url ? { url: String(row.external_url) } : {}) };
  }
  await q(sql`UPDATE takedown_notices SET resolution = ${"고객이 «대신 내려 주기» 요청"}, updated_at = NOW() WHERE id = ${noticeId}`);
  await writeAudit({ tenantId: tid, action: "takedown_retract_requested", actorType: "user", actorId: uid, riskLevel: "high", target: `takedown:${noticeId}`, detail: { pieceId: n(row.piece_id), jobId: r.jobId ?? null } });
  return { ok: true, queued: true };
}

/* ───────── ④ 단계 — 🔴 운영자가 누른다(크론은 알리기만) ───────── */
export type EscalateStep = "disconnect" | "suspend";
export async function escalate(noticeId: number, step: EscalateStep, operatorId: number, ip?: string | null): Promise<{ ok: boolean; status?: TakedownStatus; error?: string; affected?: number }> {
  const [row] = await q(sql`SELECT * FROM takedown_notices WHERE id = ${noticeId}`);
  if (!row) return { ok: false, error: "그 신고를 찾을 수 없어요." };
  const tid = n(row.tenant_id);
  if (step === "disconnect") {
    const accs = row.account_id
      ? await q(sql`UPDATE accounts SET status = 'disconnected', last_error_kind = ${"takedown"}, updated_at = NOW() WHERE id = ${n(row.account_id)} AND tenant_id = ${tid} RETURNING id`)
      : [];
    await q(sql`UPDATE takedown_notices SET status = ${"disconnected"}, disconnected_at = NOW(), updated_at = NOW() WHERE id = ${noticeId}`);
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"takedown_escalated"}, ${"신고된 글이 그대로여서 계정 연결을 해제했어요"},
      ${"기한까지 조치가 없어 그 계정의 연결을 끊었어요. 글을 내리신 뒤 계정 화면에서 다시 연결해 주세요."}, ${"/app/accounts.html"})`);
    await writeAudit({ tenantId: tid, action: "takedown_disconnect", actorType: "operator", actorId: operatorId, ip: ip ?? null, riskLevel: "high", target: `takedown:${noticeId}`, detail: { accountId: row.account_id ? n(row.account_id) : null, accounts: accs.length } });
    return { ok: true, status: "disconnected", affected: accs.length };
  }
  await q(sql`UPDATE tenants SET status = 'suspended', suspended_at = NOW(), updated_at = NOW() WHERE id = ${tid} AND status <> 'suspended'`);
  await q(sql`UPDATE takedown_notices SET status = ${"suspended"}, suspended_at = NOW(), updated_at = NOW() WHERE id = ${noticeId}`);
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"takedown_escalated"}, ${"서비스를 잠시 멈췄어요"},
    ${"신고된 글이 그대로 남아 있어 서비스를 멈췄어요. 글을 내리고 문의함으로 알려 주시면 바로 풀어 드려요."}, ${"/app/support.html"})`);
  await writeAudit({ tenantId: tid, action: "takedown_suspend", actorType: "operator", actorId: operatorId, ip: ip ?? null, riskLevel: "critical", target: `takedown:${noticeId}`, detail: { noticeId } });
  return { ok: true, status: "suspended" };
}
/** 통지 종결(기각·해결) — 막아 둔 것이 풀린다(재발행 가능). */
export async function resolveNotice(noticeId: number, operatorId: number, opts: { dismissed?: boolean; note?: string; ip?: string | null } = {}): Promise<{ ok: boolean; status?: TakedownStatus; error?: string }> {
  const [row] = await q(sql`SELECT tenant_id FROM takedown_notices WHERE id = ${noticeId}`);
  if (!row) return { ok: false, error: "그 신고를 찾을 수 없어요." };
  const status: TakedownStatus = opts.dismissed ? "dismissed" : "resolved";
  await q(sql`UPDATE takedown_notices SET status = ${status}, resolved_at = NOW(), resolved_by = ${operatorId}, resolution = ${String(opts.note ?? "").slice(0, 1000) || null}, updated_at = NOW() WHERE id = ${noticeId}`);
  await writeAudit({ tenantId: n(row.tenant_id), action: "takedown_resolved", actorType: "operator", actorId: operatorId, ip: opts.ip ?? null, riskLevel: "high", target: `takedown:${noticeId}`, detail: { status, note: opts.note ?? null } });
  return { ok: true, status };
}

/** 기한이 지난 통지 — 크론이 **운영 대기열에 올린다**(자동 정지 없음). */
export async function dueNotices(limit = 50): Promise<{ id: number; tenantId: number; dueAt: string; reason: string }[]> {
  const rows = await q(sql`SELECT id, tenant_id, due_at, reason FROM takedown_notices WHERE status = 'open' AND due_at <= NOW() ORDER BY due_at LIMIT ${Math.max(1, Math.min(200, limit))}`);
  return rows.map((r) => ({ id: n(r.id), tenantId: n(r.tenant_id), dueAt: utcDate(r.due_at)?.toISOString() ?? "", reason: String(r.reason ?? "") }));
}
