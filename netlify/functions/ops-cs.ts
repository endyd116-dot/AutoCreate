/**
 * 운영센터 · CS 메뉴(계약 §2.1 `ops-cs.ts` · §2.4(5) 행 모양 · DESIGN §11.4 CS «티켓함 + 상세 3단»). 권한: 열람·답변·담당·해결·우선순위 = operator 이상 · 매크로·FAQ 편집 = admin 이상.
 *   GET  /api/ops-tickets?status&priority&assignee&tag&q&page → { ok, tickets:[Ticket], total, page }
 *   GET  /api/ops-ticket?id                                    → { ok, ticket, messages:[{ id, from, text, at, attachments?, internal? }], context, macros:[{ id, title, text }] }
 *   POST /api/ops-ticket-reply { id, text, macroId?, internal?, attachments? } → 답변(고객 앱 알림 + 대표 메일 · internal 은 운영 메모 · 첫 답변 시각)
 *   POST /api/ops-ticket-assign { id, assigneeId } · /api/ops-ticket-resolve { id } · /api/ops-ticket-priority { id, priority } · /api/ops-ticket-update { id, status?, tags?, priority?, assigneeId? }
 *   GET/POST /api/ops-macros   { id?, title, text, tags?, active? }  · GET/POST /api/ops-faqs { id?, q, a, order?, public?, category? }
 *   GET  /api/ops-cs-stats    → { ok, open, avgFirstReplyMin, slaMissPct, satisfactionPct, windowDays }   (최근 30일 · 없음은 null)
 *   자동 티켓은 lib/cron/cs-auto-ticket.ts · 생성은 lib/cs.ts createTicket 한 벌(운영 수동 생성 = POST /api/ops-ticket-create { tenantId, subject, text, priority?, tags? }).
 */
import { sql, type SQL } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { jsonb, utcDate } from "../../lib/db-util";
import { sendEmail, simpleMail, siteUrl } from "../../lib/email";
import { createTicket, toTicketRow, ticketContext, SLA_HOURS, type TicketPriority, type TicketStatus } from "../../lib/cs";
import { tenantOwner } from "../../lib/subscription";
import { pageOf } from "../../lib/ops/period";

export const config = { path: ["/api/ops-tickets", "/api/ops-ticket", "/api/ops-ticket-reply", "/api/ops-ticket-assign", "/api/ops-ticket-resolve", "/api/ops-ticket-priority", "/api/ops-ticket-update", "/api/ops-ticket-create", "/api/ops-macros", "/api/ops-faqs", "/api/ops-cs-stats"] };
const n = (v: unknown) => Number(v || 0);
const iso = (v: unknown) => utcDate(v)?.toISOString();
const STATUSES: TicketStatus[] = ["open", "progress", "hold", "resolved"];
const PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];
const ADMIN = ["admin", "super_admin"] as const;
const TICKET_SELECT = sql`SELECT k.*, t.name AS tenant_name, op.name AS assignee_name FROM tickets k LEFT JOIN tenants t ON t.id = k.tenant_id LEFT JOIN operators op ON op.id = k.assignee_id`;

function messageRow(m: Record<string, unknown>): Record<string, unknown> {
  const at = String(m.author_type ?? "");
  const o: Record<string, unknown> = { id: n(m.id), from: at === "operator" ? "operator" : at === "system" ? "system" : "customer", text: String(m.body ?? ""), at: iso(m.created_at) ?? "" };
  if (Array.isArray(m.attachments) && m.attachments.length) o.attachments = m.attachments;
  if (m.internal === true) o.internal = true;
  if (m.author_id) o.authorId = n(m.author_id);
  return o;
}
function macroRow(r: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = { id: n(r.id), title: String(r.title ?? ""), text: String(r.body ?? ""), active: r.active !== false, sort: n(r.sort) };
  if (Array.isArray(r.tags) && r.tags.length) o.tags = r.tags;
  return o;
}
const faqRow = (r: Record<string, unknown>): Record<string, unknown> => ({ id: n(r.id), q: String(r.question ?? ""), a: String(r.answer ?? ""), order: n(r.sort), public: r.public !== false, ...(r.category ? { category: String(r.category) } : {}) });

/** 고객에게 «답변 도착» 알림 + 대표 메일(메일 키 없으면 콘솔 · graceful). */
async function notifyCustomer(tid: number, ticketId: number, subject: string, kind: "ticket_replied" | "ticket_resolved"): Promise<void> {
  const title = kind === "ticket_replied" ? "문의에 답변이 도착했어요" : "문의가 해결됐어요 · 도움이 됐나요?";
  const body = kind === "ticket_replied" ? `«${subject.slice(0, 40)}» 문의에 답변을 남겼어요.` : `«${subject.slice(0, 40)}» 문의를 해결로 표시했어요. 아직 문제가 있으면 다시 남겨 주세요.`;
  const link = `/app/support.html?id=${ticketId}`;
  await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${kind}, ${title}, ${body}, ${link})`);
  try { const owner = await tenantOwner(tid); if (owner.email) await sendEmail(owner.email, `[AutoCreate] ${title}`, simpleMail(title, body, { label: "답변 보기", url: `${siteUrl()}${link}` })); } catch { /* 메일은 보조 */ }
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
  const o = requireAdmin(req); if (!o.ok) return o.res;
  const ip = clientIp(req);
  try {
    /* ── 티켓함 ── */
    if (path.endsWith("/ops-tickets")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const status = (url.searchParams.get("status") || "").trim(), priority = (url.searchParams.get("priority") || "").trim(), tag = (url.searchParams.get("tag") || "").trim();
      const assignee = url.searchParams.get("assignee");   // 숫자 = 그 운영자 · "me" · "none"
      const s = (url.searchParams.get("q") || "").trim().toLowerCase();
      const { page, size, offset } = pageOf(url);
      const assigneeSql: SQL = assignee === "me" ? sql`k.assignee_id = ${o.ops.oid}` : assignee === "none" ? sql`k.assignee_id IS NULL` : n(assignee) ? sql`k.assignee_id = ${n(assignee)}` : sql`TRUE`;
      const where: SQL = sql`(${status} = '' OR (${status} = 'unresolved' AND k.status <> 'resolved') OR k.status = ${status}) AND (${priority} = '' OR k.priority = ${priority})
        AND (${tag} = '' OR k.tags ? ${tag}) AND ${assigneeSql}
        AND (${s} = '' OR LOWER(k.subject) LIKE ${"%" + s + "%"} OR LOWER(COALESCE(t.name, '')) LIKE ${"%" + s + "%"})`;
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM tickets k LEFT JOIN tenants t ON t.id = k.tenant_id WHERE ${where}`);
      const rows = await q(sql`${TICKET_SELECT} WHERE ${where}
        ORDER BY CASE k.status WHEN 'open' THEN 0 WHEN 'progress' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END, CASE k.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, k.sla_due_at NULLS LAST, k.id DESC
        LIMIT ${size} OFFSET ${offset}`);
      return json({ ok: true, tickets: rows.map(toTicketRow), total: n(cnt?.c), page, size });
    }

    /* ── 상세 3단 ── */
    if (path.endsWith("/ops-ticket")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const id = n(url.searchParams.get("id")); if (!id) return badRequest("id");
      const [k] = await q(sql`${TICKET_SELECT} WHERE k.id = ${id}`);
      if (!k) return json({ ok: false, error: "티켓이 없어요.", step: "not_found" }, 404);
      const messages = await q(sql`SELECT * FROM ticket_messages WHERE ticket_id = ${id} ORDER BY id`);
      const macros = await q(sql`SELECT id, title, body, tags FROM macros WHERE active = true ORDER BY sort, id`);
      const tid = k.tenant_id ? n(k.tenant_id) : null;
      // 컨텍스트는 «지금» 값으로 다시 잰다(티켓 생성 시점 스냅샷은 context 칸에 남아 있다).
      const context = tid ? await ticketContext(tid) : {};
      const snapshot = (k.context && typeof k.context === "object" ? k.context : {}) as Record<string, unknown>;
      if (snapshot.appVersion && !("appVersion" in context)) context.appVersion = snapshot.appVersion;
      return json({ ok: true, ticket: toTicketRow(k), messages: messages.map(messageRow), context, contextAtCreate: snapshot, macros: macros.map((m) => ({ id: n(m.id), title: String(m.title), text: String(m.body), ...(Array.isArray(m.tags) && m.tags.length ? { tags: m.tags } : {}) })) });
    }

    /* ── 통계 ── */
    if (path.endsWith("/ops-cs-stats")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const days = 30;
      const [s] = await q(sql`SELECT
          (SELECT COUNT(*) FROM tickets WHERE status <> 'resolved') AS open,
          (SELECT COUNT(*) FROM tickets WHERE status <> 'resolved' AND sla_due_at IS NOT NULL AND sla_due_at < NOW() AND first_reply_at IS NULL) AS overdue,
          AVG(EXTRACT(EPOCH FROM (first_reply_at - created_at)) / 60) FILTER (WHERE first_reply_at IS NOT NULL) AS avg_first_min,
          COUNT(*) FILTER (WHERE source <> 'system') AS total,
          COUNT(*) FILTER (WHERE source <> 'system' AND sla_due_at IS NOT NULL AND ((first_reply_at IS NOT NULL AND first_reply_at > sla_due_at) OR (first_reply_at IS NULL AND status <> 'resolved' AND sla_due_at < NOW()))) AS sla_miss,
          COUNT(*) FILTER (WHERE satisfaction IS NOT NULL) AS rated,
          COUNT(*) FILTER (WHERE satisfaction > 0) AS happy
        FROM tickets WHERE created_at > NOW() - (${days} || ' days')::interval`);
      const total = n(s?.total), rated = n(s?.rated);
      return json({ ok: true, open: n(s?.open), overdue: n(s?.overdue), avgFirstReplyMin: s?.avg_first_min === null || s?.avg_first_min === undefined ? null : Math.round(n(s.avg_first_min)),
        slaMissPct: total > 0 ? Math.round(n(s?.sla_miss) * 1000 / total) / 10 : null, satisfactionPct: rated > 0 ? Math.round(n(s?.happy) * 100 / rated) : null, windowDays: days, slaHours: SLA_HOURS });
    }

    /* ── 매크로 ── */
    if (path.endsWith("/ops-macros")) {
      if (req.method === "GET") { const rows = await q(sql`SELECT * FROM macros ORDER BY active DESC, sort, id`); return json({ ok: true, macros: rows.map(macroRow), total: rows.length }); }
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const g = requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; title?: string; text?: string; tags?: unknown; active?: boolean; sort?: number }>(req);
      const id = n(b.id);
      if (id && typeof b.active === "boolean" && b.title === undefined && b.text === undefined) {
        const [r] = await q(sql`UPDATE macros SET active = ${b.active}, updated_at = NOW() WHERE id = ${id} RETURNING *`);
        return r ? json({ ok: true, macro: macroRow(r) }) : json({ ok: false, error: "매크로가 없어요.", step: "not_found" }, 404);
      }
      const title = String(b.title ?? "").trim().slice(0, 80), text = String(b.text ?? "").trim().slice(0, 4000);
      if (!title || !text) return badRequest("제목과 내용을 적어 주세요.");
      const tags = Array.isArray(b.tags) ? [...new Set(b.tags.map((t) => String(t).slice(0, 30)))].slice(0, 10) : [];
      const [r] = id
        ? await q(sql`UPDATE macros SET title = ${title}, body = ${text}, tags = ${jsonb(tags)}, sort = COALESCE(${b.sort ?? null}, sort), active = ${b.active !== false}, updated_at = NOW() WHERE id = ${id} RETURNING *`)
        : await q(sql`INSERT INTO macros (title, body, tags, sort, active) VALUES (${title}, ${text}, ${jsonb(tags)}, ${n(b.sort)}, ${b.active !== false}) RETURNING *`);
      if (!r) return json({ ok: false, error: "매크로가 없어요.", step: "not_found" }, 404);
      await writeAudit({ tenantId: null, action: id ? "ops_macro_update" : "ops_macro_create", actorType: "operator", actorId: o.ops.oid, ip, target: `macro:${n(r.id)}` });
      return json({ ok: true, macro: macroRow(r) }, id ? 200 : 201);
    }

    /* ── FAQ ── */
    if (path.endsWith("/ops-faqs")) {
      if (req.method === "GET") { const rows = await q(sql`SELECT * FROM faqs ORDER BY sort, id`); return json({ ok: true, faqs: rows.map(faqRow), total: rows.length }); }
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const g = requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; q?: string; a?: string; order?: number; public?: boolean; category?: string; delete?: boolean }>(req);
      const id = n(b.id);
      if (id && b.delete === true) { await q(sql`DELETE FROM faqs WHERE id = ${id}`); await writeAudit({ tenantId: null, action: "ops_faq_delete", actorType: "operator", actorId: o.ops.oid, ip, target: `faq:${id}` }); return json({ ok: true, deleted: id }); }
      const qq = String(b.q ?? "").trim().slice(0, 200), a = String(b.a ?? "").trim().slice(0, 8000);
      if (!qq || !a) return badRequest("질문과 답을 적어 주세요.");
      const category = b.category ? String(b.category).slice(0, 40) : null;
      const [r] = id
        ? await q(sql`UPDATE faqs SET question = ${qq}, answer = ${a}, sort = COALESCE(${b.order ?? null}, sort), public = ${b.public !== false}, category = COALESCE(${category}, category), updated_at = NOW() WHERE id = ${id} RETURNING *`)
        : await q(sql`INSERT INTO faqs (question, answer, category, sort, public) VALUES (${qq}, ${a}, ${category}, ${n(b.order)}, ${b.public !== false}) RETURNING *`);
      if (!r) return json({ ok: false, error: "FAQ 가 없어요.", step: "not_found" }, 404);
      await writeAudit({ tenantId: null, action: id ? "ops_faq_update" : "ops_faq_create", actorType: "operator", actorId: o.ops.oid, ip, target: `faq:${n(r.id)}` });
      return json({ ok: true, faq: faqRow(r) }, id ? 200 : 201);
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);

    /* ── 운영 수동 생성 ── */
    if (path.endsWith("/ops-ticket-create")) {
      const tenantId = n(b.tenantId) || null;
      const r = await createTicket({ tenantId, subject: String(b.subject ?? ""), text: String(b.text ?? ""), source: "ops", priority: PRIORITIES.includes(b.priority as TicketPriority) ? b.priority as TicketPriority : "normal", tags: Array.isArray(b.tags) ? b.tags.map(String) : [] });
      if (!r.ok) return badRequest(r.error);
      await q(sql`UPDATE tickets SET assignee_id = COALESCE(assignee_id, ${o.ops.oid}) WHERE id = ${r.ticketId}`);
      await writeAudit({ tenantId, action: "ops_ticket_create", actorType: "operator", actorId: o.ops.oid, ip, target: `ticket:${r.ticketId}` });
      return json({ ok: true, ticketId: r.ticketId }, 201);
    }

    const id = n(b.id); if (!id) return badRequest("id");
    const [k] = await q(sql`SELECT * FROM tickets WHERE id = ${id}`);
    if (!k) return json({ ok: false, error: "티켓이 없어요.", step: "not_found" }, 404);
    const tid = k.tenant_id ? n(k.tenant_id) : null;

    /* ── 답변 ── */
    if (path.endsWith("/ops-ticket-reply")) {
      let text = String(b.text ?? "").trim();
      const macroId = n(b.macroId);
      if (macroId) { const [m] = await q(sql`SELECT body FROM macros WHERE id = ${macroId} AND active = true`); if (m) text = text ? `${text}\n\n${String(m.body)}` : String(m.body); }
      text = text.slice(0, 8000);
      if (!text) return badRequest("답변 내용을 적어 주세요.");
      const internal = b.internal === true;
      const attachments = Array.isArray(b.attachments) ? b.attachments.filter((a) => a && typeof a === "object" && (a as Record<string, unknown>).key).slice(0, 10) : [];
      const [m] = await q(sql`INSERT INTO ticket_messages (ticket_id, author_type, author_id, body, attachments, internal) VALUES (${id}, ${"operator"}, ${o.ops.oid}, ${text}, ${attachments.length ? jsonb(attachments) : null}, ${internal}) RETURNING *`);
      await q(sql`UPDATE tickets SET status = CASE WHEN status = 'open' AND ${internal} = false THEN 'progress' ELSE status END,
        first_reply_at = CASE WHEN ${internal} = false THEN COALESCE(first_reply_at, NOW()) ELSE first_reply_at END, last_message_at = NOW(), assignee_id = COALESCE(assignee_id, ${o.ops.oid}), updated_at = NOW() WHERE id = ${id}`);
      if (!internal && tid) await notifyCustomer(tid, id, String(k.subject), "ticket_replied");
      await writeAudit({ tenantId: tid, action: internal ? "ops_ticket_note" : "ops_ticket_reply", actorType: "operator", actorId: o.ops.oid, ip, target: `ticket:${id}`, detail: { macroId: macroId || null, length: text.length } });
      return json({ ok: true, message: messageRow(m) }, 201);
    }

    /* ── 담당 · 해결 · 우선순위 · 상태/태그 ── */
    let status: TicketStatus | null = null, priority: TicketPriority | null = null, tags: string[] | null = null, assigneeId: number | null | undefined;
    if (path.endsWith("/ops-ticket-assign")) { assigneeId = b.assigneeId === null ? null : n(b.assigneeId) || o.ops.oid; }
    else if (path.endsWith("/ops-ticket-resolve")) { status = "resolved"; }
    else if (path.endsWith("/ops-ticket-priority")) { if (!PRIORITIES.includes(b.priority as TicketPriority)) return badRequest("priority"); priority = b.priority as TicketPriority; }
    else if (path.endsWith("/ops-ticket-update")) {
      if (b.status !== undefined) { if (!STATUSES.includes(b.status as TicketStatus)) return badRequest("status"); status = b.status as TicketStatus; }
      if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority as TicketPriority)) return badRequest("priority"); priority = b.priority as TicketPriority; }
      if (b.tags !== undefined) { if (!Array.isArray(b.tags)) return badRequest("tags"); tags = [...new Set(b.tags.map((t) => String(t).slice(0, 30)))].slice(0, 10); }
      if (b.assigneeId !== undefined) assigneeId = b.assigneeId === null ? null : n(b.assigneeId) || null;
    } else return json({ ok: false, error: "not found" }, 404);
    if (assigneeId) { const [op] = await q(sql`SELECT id FROM operators WHERE id = ${assigneeId} AND active = true`); if (!op) return badRequest("없는 운영자예요.", "assignee"); }
    const [r] = await q(sql`UPDATE tickets SET
        status = COALESCE(${status}, status),
        priority = COALESCE(${priority}, priority),
        sla_due_at = CASE WHEN ${priority} IS NOT NULL THEN created_at + (${priority ? SLA_HOURS[priority] : 0} || ' hours')::interval ELSE sla_due_at END,
        tags = COALESCE(${tags ? jsonb(tags) : null}, tags),
        assignee_id = CASE WHEN ${assigneeId === undefined} THEN assignee_id ELSE ${assigneeId ?? null} END,
        resolved_at = CASE WHEN ${status} = 'resolved' THEN COALESCE(resolved_at, NOW()) WHEN ${status} IS NOT NULL THEN NULL ELSE resolved_at END,
        closed_at = CASE WHEN ${status} = 'resolved' THEN NOW() WHEN ${status} IS NOT NULL THEN NULL ELSE closed_at END,
        updated_at = NOW() WHERE id = ${id} RETURNING *`);
    if (status === "resolved" && String(k.status) !== "resolved" && tid) await notifyCustomer(tid, id, String(k.subject), "ticket_resolved");
    await writeAudit({ tenantId: tid, action: "ops_ticket_update", actorType: "operator", actorId: o.ops.oid, ip, target: `ticket:${id}`, detail: { status, priority, tags, assigneeId: assigneeId === undefined ? undefined : assigneeId } });
    const [full] = await q(sql`${TICKET_SELECT} WHERE k.id = ${id}`);
    return json({ ok: true, ticket: toTicketRow(full ?? r) });
  } catch (err) { return jsonError("ops_cs", err); }
};
