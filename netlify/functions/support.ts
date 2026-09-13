/** POST /api/support-ticket-create { subject, body } — 고객 문의 → tickets(컨텍스트 자동 첨부). GET /api/faqs 공개. */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { jsonb } from "../../lib/db-util";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
export const config = { path: ["/api/support-ticket-create", "/api/faqs"] };
export default async (req: Request): Promise<Response> => {
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/faqs")) {
      const rows = await db.execute(sql`SELECT id, question, answer, category FROM faqs WHERE public = true ORDER BY sort, id`);
      return json({ ok: true, faqs: rows });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const auth = requireUser(req); if (!auth.ok) return auth.res;
    const b = await readJson<{ subject?: string; body?: string }>(req);
    const subject = String(b.subject || "").trim().slice(0, 160); const body = String(b.body || "").trim().slice(0, 5000);
    if (!subject || !body) return badRequest("요약과 내용을 적어 주세요.");
    const [t] = (await db.execute(sql`SELECT plan_key, status, trial_ends_at FROM tenants WHERE id = ${auth.tid}`)) as unknown as Record<string, unknown>[];
    const errs = await db.execute(sql`SELECT action, created_at FROM audit_logs WHERE tenant_id = ${auth.tid} AND risk_level IN ('medium','high','critical') ORDER BY id DESC LIMIT 5`);
    const runners = await db.execute(sql`SELECT name, status, last_seen_at FROM runner_devices WHERE tenant_id = ${auth.tid}`);
    const ctx = { plan: t?.plan_key, status: t?.status, trialEndsAt: t?.trial_ends_at, recentIssues: errs, runners, ua: req.headers.get("user-agent") };
    const [tk] = (await db.execute(sql`INSERT INTO tickets (tenant_id, user_id, channel, subject, context) VALUES (${auth.tid}, ${auth.user.uid}, ${"app"}, ${subject}, ${jsonb(ctx)}) RETURNING id`)) as unknown as { id: number }[];
    await db.execute(sql`INSERT INTO ticket_messages (ticket_id, author_type, author_id, body) VALUES (${tk.id}, ${"user"}, ${auth.user.uid}, ${body})`);
    return json({ ok: true, ticketId: Number(tk.id) }, 201);
  } catch (err) { return jsonError("support", err); }
};
