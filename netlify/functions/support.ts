/**
 * 고객 «문의하기»(계약 P1R4 §2.1 `support.ts` · §3.2 «문의하기» · DESIGN §11.4 CS). 로그인 쿠키 · 테넌트 스코프.
 *   POST /api/support-ticket { subject, text, attachments?:[r2Key] } → 201 { ok, ticketId }   (자동 첨부: 플랜·상태·코인·러너·최근 오류 3건·앱 버전(x-app-version 헤더) — createTicket 한 벌)
 *   GET  /api/support-tickets                → { ok, tickets:[{ id, subject, status, priority, createdAt, updatedAt, lastMessageAt?, rating?, replied }] }
 *   GET  /api/support-ticket?id              → { ok, ticket, messages:[{ id, from, text, at, attachments? }] }   (운영 메모 internal 은 안 보인다)
 *   POST /api/support-ticket-message { id, text, attachments? } → 내 문의에 이어 쓰기(해결된 티켓이면 다시 open)
 *   POST /api/support-rate { id, helpful:boolean } → 만족도(해결된 내 티켓만 · 1탭)
 *   POST /api/support-upload-url { ext, contentType } → { ok, key, uploadUrl, url }   R2 presigned PUT(60초 · 이미지만 · 5MB 는 화면이 막는다) · R2 없으면 step not_configured 정직
 *   GET  /api/faqs                           → { ok, faqs:[{ id, q, a, order, category? }] } (공개 · 로그인 불필요)
 *   옛 경로 /api/support-ticket-create { subject, body } 는 그대로 받는다(R1 화면 호환).
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { jsonb, utcDate } from "../../lib/db-util";
import { createTicket } from "../../lib/cs";
import { r2Configured, r2PublicUrl, safeKey, getR2Client, R2_BUCKET } from "../../lib/r2";

export const config = { path: ["/api/support-ticket", "/api/support-ticket-create", "/api/support-tickets", "/api/support-ticket-message", "/api/support-rate", "/api/support-upload-url", "/api/faqs"] };
const n = (v: unknown) => Number(v || 0);
const iso = (v: unknown) => utcDate(v)?.toISOString();
const KEY_RE = /^autocreate\/support\/\d+\/[a-z0-9_\-/]+\.(png|jpg|jpeg|webp)$/i;

/** 첨부 정규화 — 내 테넌트 접두의 R2 키만(다른 테넌트 키 끼워넣기 차단). */
function attachmentsOf(v: unknown, tid: number): { key: string; url: string }[] {
  if (!Array.isArray(v)) return [];
  const out: { key: string; url: string }[] = [];
  for (const a of v.slice(0, 5)) {
    const key = typeof a === "string" ? a : (a && typeof a === "object" ? String((a as Record<string, unknown>).key ?? "") : "");
    if (KEY_RE.test(key) && key.startsWith(`autocreate/support/${tid}/`) && !key.includes("..")) out.push({ key, url: r2PublicUrl(key) });
  }
  return out;
}
function messageRow(m: Record<string, unknown>): Record<string, unknown> {
  const at = String(m.author_type ?? "");
  const o: Record<string, unknown> = { id: n(m.id), from: at === "operator" ? "operator" : at === "system" ? "system" : "customer", text: String(m.body ?? ""), at: iso(m.created_at) ?? "" };
  if (Array.isArray(m.attachments) && m.attachments.length) o.attachments = m.attachments;
  return o;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
  try {
    if (path.endsWith("/faqs")) {
      const rows = await q(sql`SELECT id, question, answer, category, sort FROM faqs WHERE public = true ORDER BY sort, id`);
      return json({ ok: true, faqs: rows.map((r) => ({ id: n(r.id), q: String(r.question), a: String(r.answer), order: n(r.sort), ...(r.category ? { category: String(r.category) } : {}) })) });
    }
    const auth = requireUser(req); if (!auth.ok) return auth.res;
    const tid = auth.tid;

    if (path.endsWith("/support-tickets")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const rows = await q(sql`SELECT k.id, k.subject, k.status, k.priority, k.created_at, k.updated_at, k.last_message_at, k.satisfaction, k.first_reply_at,
          (SELECT COUNT(*) FROM ticket_messages m WHERE m.ticket_id = k.id AND m.author_type = 'operator' AND m.internal = false) AS replies
        FROM tickets k WHERE k.tenant_id = ${tid} AND k.source <> 'system' ORDER BY k.id DESC LIMIT 100`);
      return json({ ok: true, tickets: rows.map((r) => {
        const o: Record<string, unknown> = { id: n(r.id), subject: String(r.subject), status: String(r.status), priority: String(r.priority), createdAt: iso(r.created_at) ?? "", updatedAt: iso(r.updated_at) ?? "", replied: n(r.replies) > 0 };
        const lm = iso(r.last_message_at); if (lm) o.lastMessageAt = lm;
        if (r.satisfaction !== null && r.satisfaction !== undefined) o.rating = n(r.satisfaction) > 0;
        return o;
      }) });
    }
    if (path.endsWith("/support-ticket") && req.method === "GET") {
      const id = n(url.searchParams.get("id")); if (!id) return badRequest("id");
      const [k] = await q(sql`SELECT * FROM tickets WHERE id = ${id} AND tenant_id = ${tid}`);
      if (!k) return json({ ok: false, error: "문의를 찾을 수 없어요.", step: "not_found" }, 404);
      const messages = await q(sql`SELECT * FROM ticket_messages WHERE ticket_id = ${id} AND internal = false ORDER BY id`);
      const t: Record<string, unknown> = { id: n(k.id), subject: String(k.subject), status: String(k.status), priority: String(k.priority), createdAt: iso(k.created_at) ?? "", updatedAt: iso(k.updated_at) ?? "" };
      if (k.satisfaction !== null && k.satisfaction !== undefined) t.rating = n(k.satisfaction) > 0;
      return json({ ok: true, ticket: t, messages: messages.map(messageRow) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);

    /* ── 새 문의(신·구 경로) ── */
    if (path.endsWith("/support-ticket") || path.endsWith("/support-ticket-create")) {
      const subject = String(b.subject ?? "").trim().slice(0, 160);
      const text = String(b.text ?? b.body ?? "").trim().slice(0, 8000);
      if (!subject || !text) return badRequest("요약과 내용을 적어 주세요.");
      const attachments = attachmentsOf(b.attachments, tid);
      const r = await createTicket({ tenantId: tid, userId: auth.user.uid, subject, text, source: "app", attachments, appVersion: req.headers.get("x-app-version") || undefined });
      if (!r.ok) return json({ ok: false, error: r.error, step: "create" }, 500);
      await writeAudit({ tenantId: tid, action: "support_ticket_create", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `ticket:${r.ticketId}`, detail: { attachments: attachments.length } });
      return json({ ok: true, ticketId: r.ticketId }, 201);
    }
    /* ── 이어 쓰기 ── */
    if (path.endsWith("/support-ticket-message")) {
      const id = n(b.id); if (!id) return badRequest("id");
      const text = String(b.text ?? "").trim().slice(0, 8000); if (!text) return badRequest("내용을 적어 주세요.");
      const [k] = await q(sql`SELECT id, status FROM tickets WHERE id = ${id} AND tenant_id = ${tid}`);
      if (!k) return json({ ok: false, error: "문의를 찾을 수 없어요.", step: "not_found" }, 404);
      const attachments = attachmentsOf(b.attachments, tid);
      const [m] = await q(sql`INSERT INTO ticket_messages (ticket_id, author_type, author_id, body, attachments) VALUES (${id}, ${"customer"}, ${auth.user.uid}, ${text}, ${attachments.length ? jsonb(attachments) : null}) RETURNING *`);
      await q(sql`UPDATE tickets SET status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END, resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END, closed_at = NULL, last_message_at = NOW(), updated_at = NOW() WHERE id = ${id}`);
      return json({ ok: true, message: messageRow(m), reopened: String(k.status) === "resolved" }, 201);
    }
    /* ── 만족도 ── */
    if (path.endsWith("/support-rate")) {
      const id = n(b.id); if (!id || typeof b.helpful !== "boolean") return badRequest("id·helpful");
      const [r] = await q(sql`UPDATE tickets SET satisfaction = ${b.helpful ? 1 : 0}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${tid} AND status = 'resolved' RETURNING id`);
      if (!r) return json({ ok: false, error: "해결된 문의에만 평가할 수 있어요.", step: "state" }, 400);
      return json({ ok: true, helpful: b.helpful });
    }
    /* ── 첨부 업로드 URL(R2 presigned PUT) ── */
    if (path.endsWith("/support-upload-url")) {
      if (!r2Configured()) return json({ ok: false, step: "not_configured", error: "사진 첨부는 아직 준비 중이에요. 글로 적어 주시면 돼요." });
      const ext = String(b.ext ?? "").toLowerCase().replace(/[^a-z]/g, "");
      if (!["png", "jpg", "jpeg", "webp"].includes(ext)) return badRequest("png·jpg·webp 이미지만 첨부할 수 있어요.", "ext");
      const contentType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
      const key = safeKey(`autocreate/support/${tid}`, ext);
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const uploadUrl = await getSignedUrl(getR2Client(), new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }), { expiresIn: 60 });
      return json({ ok: true, key, uploadUrl, url: r2PublicUrl(key), contentType, expiresIn: 60 });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("support", err); }
};
