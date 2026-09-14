/**
 * 운영센터 — 인앱 공지 + 장애 배너(계약 P1R4 §2.2·§2.4(6) · DESIGN §11.4).
 *   GET  /api/ops-notices?page&kind                → { ok, notices:[Notice], page, total }
 *   POST /api/ops-notices  { id?, kind, title, body?, startsAt?, endsAt?, plans?, channels?, active? } → { ok, notice }
 *   POST /api/ops-notice-delete { id }             → { ok }
 *   Notice = { id, kind:"notice"|"incident", title, body?, startsAt, endsAt?, plans?, channels?, active }
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";
import { jsonb, utcDate } from "../../lib/db-util";

export const config = { path: ["/api/ops-notices", "/api/ops-notice-delete"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const PAGE = 30;

export function toNotice(r: Record<string, unknown>) {
  const o: Record<string, unknown> = {
    id: n(r.id), kind: String(r.kind ?? "notice"), title: String(r.title ?? ""),
    active: r.active === true,
    startsAt: utcDate(r.starts_at)?.toISOString() ?? new Date().toISOString(),
  };
  if (r.body) o.body = String(r.body);
  const ea = utcDate(r.ends_at); if (ea) o.endsAt = ea.toISOString();
  if (Array.isArray(r.plans) && (r.plans as unknown[]).length) o.plans = (r.plans as unknown[]).map(String);
  if (Array.isArray(r.channels) && (r.channels as unknown[]).length) o.channels = (r.channels as unknown[]).map(String);
  return o;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/ops-notices") && req.method === "GET") {
      const g = requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const page = Math.max(1, n(url.searchParams.get("page")) || 1);
      const kind = url.searchParams.get("kind");
      const where = kind === "notice" || kind === "incident" ? sql`WHERE kind = ${kind}` : sql``;
      const [{ c }] = await q(sql`SELECT COUNT(*) c FROM notices ${where}`);
      const rows = await q(sql`SELECT * FROM notices ${where} ORDER BY id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`);
      return json({ ok: true, notices: rows.map(toNotice), page, total: n(c) });
    }

    if (path.endsWith("/ops-notice-delete")) {
      const g = requireAdmin(req, ["admin", "super_admin"]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: unknown }>(req); const id = n(b.id);
      if (!id) return badRequest("id");
      await q(sql`DELETE FROM notices WHERE id = ${id}`);
      await writeAudit({ tenantId: null, action: "ops_notice_delete", actorType: "operator", actorId: g.ops.oid, target: `notice:${id}` });
      return json({ ok: true });
    }

    if (path.endsWith("/ops-notices")) {
      const g = requireAdmin(req, ["admin", "super_admin"]); if (!g.ok) return g.res;
      const b = await readJson<Record<string, unknown>>(req);
      const kind = String(b.kind ?? "notice");
      if (kind !== "notice" && kind !== "incident") return badRequest("kind 는 notice/incident");
      const title = String(b.title ?? "").trim();
      if (!title) return badRequest("제목을 입력해 주세요", "title");
      const body = b.body ? String(b.body).slice(0, 4000) : null;
      const startsAt = b.startsAt ? String(b.startsAt) : null;
      const endsAt = b.endsAt ? String(b.endsAt) : null;
      const plans = Array.isArray(b.plans) ? b.plans.map((s) => String(s).slice(0, 32)).slice(0, 10) : [];
      const channels = Array.isArray(b.channels) ? b.channels.map((s) => String(s).slice(0, 24)).slice(0, 12) : [];
      const active = b.active !== false;
      const id = n(b.id);

      let row;
      if (id) {
        [row] = await q(sql`UPDATE notices SET kind = ${kind}, title = ${title.slice(0, 160)}, body = ${body},
          starts_at = COALESCE(${startsAt ? sql`${startsAt}::timestamptz AT TIME ZONE 'UTC'` : sql`NULL`}, starts_at),
          ends_at = ${endsAt ? sql`${endsAt}::timestamptz AT TIME ZONE 'UTC'` : null},
          plans = ${jsonb(plans)}, channels = ${jsonb(channels)}, active = ${active}, updated_at = NOW()
          WHERE id = ${id} RETURNING *`);
        if (!row) return json({ ok: false, error: "공지를 찾을 수 없어요.", step: "not_found" }, 404);
      } else {
        [row] = await q(sql`INSERT INTO notices (kind, title, body, starts_at, ends_at, plans, channels, active, created_by)
          VALUES (${kind}, ${title.slice(0, 160)}, ${body},
                  ${startsAt ? sql`${startsAt}::timestamptz AT TIME ZONE 'UTC'` : sql`NOW()`},
                  ${endsAt ? sql`${endsAt}::timestamptz AT TIME ZONE 'UTC'` : null},
                  ${jsonb(plans)}, ${jsonb(channels)}, ${active}, ${g.ops.oid}) RETURNING *`);
      }
      await writeAudit({ tenantId: null, action: id ? "ops_notice_update" : "ops_notice_create", actorType: "operator", actorId: g.ops.oid,
        target: `notice:${n(row.id)}`, detail: { kind, active }, riskLevel: kind === "incident" ? "medium" : "low" });
      return json({ ok: true, notice: toNotice(row) });
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_notices", err);
  }
};
