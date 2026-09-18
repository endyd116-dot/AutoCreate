/**
 * 운영센터 · CS 메뉴(계약 §2.1 `ops-cs.ts` · §2.4(5) 행 모양 · DESIGN §11.4 CS «티켓함 + 상세 3단»). 권한: 열람·답변·담당·해결·우선순위 = operator 이상 · 매크로·FAQ 편집 = admin 이상.
 *   GET  /api/ops-tickets?status&priority&assignee&tag&q&page&source&unclaimed → { ok, tickets:[Ticket], total, page }
 *        [R8 §4.3] `source`=app|email|kakao|system · `unclaimed=1` = 🔴 **바깥에서 왔는데 우리 고객을 못 찾은 문의**(운영자가 집을 붙여 준다)
 *   GET  /api/ops-ticket?id                                    → { ok, ticket, messages:[{ id, from, text, at, attachments?, internal? }], context, macros:[{ id, title, text }] }
 *   POST /api/ops-ticket-reply { id, text, macroId?, internal?, attachments? } → 답변(고객 앱 알림 + 대표 메일 · internal 은 운영 메모 · 첫 답변 시각)
 *   POST /api/ops-ticket-claim  { id, tenantId }  — [R8 §4.3] 주인 없는 문의에 고객을 붙인다(맥락은 그때 새로 받아 적는다 · 이미 주인 있으면 400)
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
import { subjectWithRef } from "../../lib/cs-inbound";   // [R8 §4.3] 나가는 메일 제목의 실타래 표시 — 답장이 티켓으로 돌아오게
import { tenantOwner } from "../../lib/subscription";
import { pageOf } from "../../lib/ops/period";

export const config = { path: ["/api/ops-tickets", "/api/ops-ticket-claim", "/api/ops-ticket", "/api/ops-ticket-reply", "/api/ops-ticket-assign", "/api/ops-ticket-resolve", "/api/ops-ticket-priority", "/api/ops-ticket-update", "/api/ops-ticket-create", "/api/ops-macros", "/api/ops-faqs", "/api/ops-cs-stats"] };
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
  /* 🔴 [R8 §4.3] 제목에 `[AC-{id}]` 를 박는다 — 고객이 이 메일에 **답장**하면 그 답장이 `cs-inbound` 에서 **이 티켓으로 돌아온다**.
     이 글자가 없으면 답장은 대표 메일함에서 끝나고, 티켓함은 «답이 없는 고객»이라고 거짓말을 한다. */
  try { const owner = await tenantOwner(tid); if (owner.email) await sendEmail(owner.email, subjectWithRef(`[AutoCreate] ${title}`, ticketId), simpleMail(title, body, { label: "답변 보기", url: `${siteUrl()}${link}` })); } catch { /* 메일은 보조 */ }
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
  const o = await requireAdmin(req); if (!o.ok) return o.res;
  const ip = clientIp(req);
  try {
    /* ── 티켓함 ── */
    if (path.endsWith("/ops-tickets")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const status = (url.searchParams.get("status") || "").trim(), priority = (url.searchParams.get("priority") || "").trim(), tag = (url.searchParams.get("tag") || "").trim();
      const assignee = url.searchParams.get("assignee");   // 숫자 = 그 운영자 · "me" · "none"
      const s = (url.searchParams.get("q") || "").trim().toLowerCase();
      const { page, size, offset } = pageOf(url);
      /* [R8 §4.3] 유입 경로 거르개 — 설계가 «한 목록»이라 했으니 **기본은 섞어 보여 주고**, 고르고 싶을 때만 좁힌다. */
      const source = (url.searchParams.get("source") || "").trim();
      /* 🔴 «주인 없는 문의» = 바깥에서 왔는데 우리 고객을 못 찾은 것. 이게 따로 안 보이면 **아무도 안 본다** —
         그 사람은 답을 기다리는데 티켓함에서는 이름 없는 줄 하나일 뿐이다. */
      const unclaimed = ["1", "true", "yes"].includes((url.searchParams.get("unclaimed") || "").toLowerCase());
      const assigneeSql: SQL = assignee === "me" ? sql`k.assignee_id = ${o.ops.oid}` : assignee === "none" ? sql`k.assignee_id IS NULL` : n(assignee) ? sql`k.assignee_id = ${n(assignee)}` : sql`TRUE`;
      const where: SQL = sql`(${status} = '' OR (${status} = 'unresolved' AND k.status <> 'resolved') OR k.status = ${status}) AND (${priority} = '' OR k.priority = ${priority})
        AND (${tag} = '' OR k.tags ? ${tag}) AND ${assigneeSql}
        AND (${source} = '' OR COALESCE(k.source, k.channel) = ${source})
        AND (${!unclaimed} OR (k.tenant_id IS NULL AND k.from_email IS NOT NULL))
        AND (${s} = '' OR LOWER(k.subject) LIKE ${"%" + s + "%"} OR LOWER(COALESCE(t.name, '')) LIKE ${"%" + s + "%"} OR LOWER(COALESCE(k.from_email, '')) LIKE ${"%" + s + "%"})`;
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM tickets k LEFT JOIN tenants t ON t.id = k.tenant_id WHERE ${where}`);
      const rows = await q(sql`${TICKET_SELECT} WHERE ${where}
        ORDER BY CASE k.status WHEN 'open' THEN 0 WHEN 'progress' THEN 1 WHEN 'hold' THEN 2 ELSE 3 END, CASE k.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, k.sla_due_at NULLS LAST, k.id DESC
        LIMIT ${size} OFFSET ${offset}`);
      return json({ ok: true, tickets: rows.map(toTicketRow), total: n(cnt?.c), page, size });
    }

    /* ── [R8 §4.3] 🔴 **주인 없는 문의에 집을 붙인다** ──
       바깥에서 온 문의는 보낸 메일 주소로 고객을 찾는다. 못 찾으면 `tenant_id` 가 빈 채로 남는데(버리지 않으려고),
       그 상태로는 **플랜·러너·최근 오류 같은 맥락이 하나도 없어** 운영자가 답을 못 한다.
       그래서 운영자가 «이 집 사람이네»를 누르면 그때 붙이고, 맥락을 **그 시점에 새로 받아 적는다.**
       🔴 이미 주인이 있는 티켓은 **바꾸지 않는다** — 남의 집 문의를 다른 집에 옮기는 길은 만들지 않는다(옮기면 그 집 사람이 남의 문의를 본다). */
    if (path.endsWith("/ops-ticket-claim")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<{ id?: unknown; tenantId?: unknown }>(req);
      const id = n(b.id), tenantId = n(b.tenantId);
      if (!id || !tenantId) return badRequest("티켓과 고객을 골라 주세요.", "id");
      const [k] = await q(sql`SELECT id, tenant_id, from_email FROM tickets WHERE id = ${id}`);
      if (!k) return json({ ok: false, error: "티켓을 찾을 수 없어요.", step: "not_found" }, 404);
      if (k.tenant_id) return json({ ok: false, step: "already", error: "이미 고객이 연결된 문의예요." }, 400);
      const [t] = await q(sql`SELECT id, name FROM tenants WHERE id = ${tenantId}`);
      if (!t) return json({ ok: false, error: "그 고객을 찾을 수 없어요.", step: "tenant" }, 404);
      const context = await ticketContext(tenantId);
      await q(sql`UPDATE tickets SET tenant_id = ${tenantId}, context = ${jsonb(context)}, updated_at = NOW() WHERE id = ${id}`);
      await writeAudit({ tenantId, action: "ops_ticket_claim", actorType: "operator", actorId: o.ops.oid, ip, target: `ticket:${id}`, detail: { fromEmail: k.from_email ? String(k.from_email) : null } });
      return json({ ok: true, ticketId: id, tenantId, tenantName: String(t.name ?? "") });
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
      const g = await requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      /* 🔴 [2026-09-19 수리 2판 · C `verify-key-contract`] **화면은 봉투로 보낸다 — 서버가 그걸 안 뜯었다.**
         `ops/cs-faq.html` 이 보내는 것: `{ action:"save", id?, macro:{title,text} }` · `{ action:"delete", id }`
         옛 판은 `b.title`·`b.text` 만 봐서 **저장이 늘 400**(«제목과 내용을 적어 주세요»)이었고,
         🔴 **지우는 길은 아예 없었다**(매크로엔 DELETE 분기 자체가 없다). 봉투를 뜯고, 옛 평면 모양도 그대로 받는다. */
      const body = await readJson<Record<string, unknown>>(req);
      const env = (body.macro && typeof body.macro === "object" ? body.macro : {}) as Record<string, unknown>;
      const b = { ...body, ...env } as { id?: number; title?: string; text?: string; tags?: unknown; active?: boolean; sort?: number; action?: string; delete?: boolean };
      const id = n(b.id);
      /* 지우기 — FAQ 와 같은 어휘로 맞춘다(`action:"delete"` 또는 옛 `delete:true`). */
      if (id && (b.action === "delete" || b.delete === true)) {
        const [gone] = await q(sql`DELETE FROM macros WHERE id = ${id} RETURNING id`);
        if (!gone) return json({ ok: false, error: "매크로가 없어요.", step: "not_found" }, 404);
        await writeAudit({ tenantId: null, action: "ops_macro_delete", actorType: "operator", actorId: o.ops.oid, ip, target: `macro:${id}` });
        return json({ ok: true, deleted: id });
      }
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
      const g = await requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      /* 🔴 [2026-09-19 수리 2판 · C `verify-key-contract`] 매크로와 같은 병 —
         화면은 `{ action:"save", id?, faq:{q,a,public} }` · `{ action:"delete", id }` 로 보내는데
         옛 판은 `b.q`·`b.a` 만 봐서 **저장이 늘 400**, 지우기는 `b.delete` 만 봐서 **안 지워졌다.** */
      const body = await readJson<Record<string, unknown>>(req);
      const envF = (body.faq && typeof body.faq === "object" ? body.faq : {}) as Record<string, unknown>;
      const b = { ...body, ...envF } as { id?: number; q?: string; a?: string; order?: number; public?: boolean; category?: string; delete?: boolean; action?: string };
      const id = n(b.id);
      if (id && (b.action === "delete" || b.delete === true)) { await q(sql`DELETE FROM faqs WHERE id = ${id}`); await writeAudit({ tenantId: null, action: "ops_faq_delete", actorType: "operator", actorId: o.ops.oid, ip, target: `faq:${id}` }); return json({ ok: true, deleted: id }); }
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
    /* 🔴 [2026-09-19 수리 2판 · C `verify-key-contract`] **화면이 보내는 이름을 서버가 안 읽고 있었다.**
       셋 다 «오류 한 글자 없이» 엉뚱하게 동작했다 — 그래서 시나리오에서도 안 걸렸다(200 이 온다). */
    if (path.endsWith("/ops-ticket-assign")) {
      /* 화면(`ops/ticket.html`)은 `operatorId` 로 보낸다. 옛 이름 `assigneeId` 도 그대로 받는다(무회귀).
         🔴 옛 판은 `b.assigneeId` 만 봐서 **늘 undefined** → `n(undefined) || o.ops.oid` 로 떨어졌다 ⇒
            ① 남을 골라도 **누른 사람에게 배정**되고 ② «담당 없음»(null)도 **자기에게 배정**됐다.
         값을 아예 안 보냈을 때만 «나에게»다 — `null` 은 «담당 없음»이라는 **뜻**이라 그대로 지킨다. */
      const raw = b.assigneeId !== undefined ? b.assigneeId : b.operatorId;
      assigneeId = raw === null ? null : raw === undefined ? o.ops.oid : n(raw) || o.ops.oid;
    }
    else if (path.endsWith("/ops-ticket-resolve")) {
      /* 🔴 옛 판은 `status = "resolved"` 를 **못 박았다** — 화면의 「보류」 단추도 `status:"hold"` 를 보내는데
            그대로 «해결»로 닫혔다(고객에게 «해결됐어요» 알림까지 갔다). 보내 준 상태를 존중하되 기본은 해결이다. */
      status = STATUSES.includes(b.status as TicketStatus) ? b.status as TicketStatus : "resolved";
    }
    else if (path.endsWith("/ops-ticket-priority")) {
      if (!PRIORITIES.includes(b.priority as TicketPriority)) return badRequest("priority");
      priority = b.priority as TicketPriority;
      /* 🔴 화면은 우선순위와 **태그를 같은 칩 묶음에서 함께** 보낸다(`ops/ticket.html:51`) — 옛 판은 태그를 안 읽어
            **태그가 저장되지 않았다.** 다중 칩이라 값은 배열이고, **빈 배열은 «전부 껐다»는 뜻**이라 그대로 지운다.
            🔴 다만 `tags` 를 **아예 안 보냈으면** 건드리지 않는다 — 없는 값으로 있는 것을 지우지 않는다(메모에서 겪은 그 병). */
      if (b.tags !== undefined) {
        if (!Array.isArray(b.tags)) return badRequest("tags");
        tags = [...new Set(b.tags.map((t) => String(t).slice(0, 30)))].slice(0, 10);
      }
    }
    else if (path.endsWith("/ops-ticket-update")) {
      if (b.status !== undefined) { if (!STATUSES.includes(b.status as TicketStatus)) return badRequest("status"); status = b.status as TicketStatus; }
      if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority as TicketPriority)) return badRequest("priority"); priority = b.priority as TicketPriority; }
      if (b.tags !== undefined) { if (!Array.isArray(b.tags)) return badRequest("tags"); tags = [...new Set(b.tags.map((t) => String(t).slice(0, 30)))].slice(0, 10); }
      if (b.assigneeId !== undefined) assigneeId = b.assigneeId === null ? null : n(b.assigneeId) || null;
    } else return json({ ok: false, error: "not found" }, 404);
    if (assigneeId) { const [op] = await q(sql`SELECT id FROM operators WHERE id = ${assigneeId} AND active = true`); if (!op) return badRequest("없는 운영자예요.", "assignee"); }
    // SET 절은 있는 것만 조립한다(NULL 파라미터를 COALESCE/CASE 에 넣으면 42P18 «타입 미확정» — 스모크에서 잡힘).
    const sets: SQL[] = [sql`updated_at = NOW()`];
    if (status) {
      sets.push(sql`status = ${status}`);
      sets.push(status === "resolved" ? sql`resolved_at = COALESCE(resolved_at, NOW())` : sql`resolved_at = NULL`);
      sets.push(status === "resolved" ? sql`closed_at = NOW()` : sql`closed_at = NULL`);
    }
    if (priority) { sets.push(sql`priority = ${priority}`); sets.push(sql`sla_due_at = created_at + ${`${SLA_HOURS[priority]} hours`}::interval`); }
    if (tags) sets.push(sql`tags = ${jsonb(tags)}`);
    if (assigneeId !== undefined) sets.push(assigneeId === null ? sql`assignee_id = NULL` : sql`assignee_id = ${assigneeId}`);
    const [r] = await q(sql`UPDATE tickets SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING *`);
    if (status === "resolved" && String(k.status) !== "resolved" && tid) await notifyCustomer(tid, id, String(k.subject), "ticket_resolved");
    await writeAudit({ tenantId: tid, action: "ops_ticket_update", actorType: "operator", actorId: o.ops.oid, ip, target: `ticket:${id}`, detail: { status, priority, tags, assigneeId: assigneeId === undefined ? undefined : assigneeId } });
    const [full] = await q(sql`${TICKET_SELECT} WHERE k.id = ${id}`);
    return json({ ok: true, ticket: toTicketRow(full ?? r) });
  } catch (err) { return jsonError("ops_cs", err); }
};
