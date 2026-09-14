/**
 * 운영센터 — 러너 팜(계약 P1R4 §2.2 · DESIGN §8·§19). 관리형 러너(tenant_id NULL) + 고객 러너를 가로질러 본다.
 *   GET  /api/ops-runners            → { ok, runners:[{ id, name, kind, tenantId, tenantKey, online, lastSeenAt, version, active, queued }], farm:{ managed, online, queued, claimed, oldestQueuedMin } }
 *   POST /api/ops-runner-assign      { action, id, tenantId? }   → 액션별
 *        · action="rebind"  { id, tenantId|null } — 관리형 러너를 테넌트에 배정(또는 NULL=팜 복귀)
 *        · action="release" { id }               — 그 기기가 물고 있는 claimed 잡을 큐로 되돌린다(수동 페일오버)
 *        · action="remove"  { id }               — 기기 제거(물던 잡은 먼저 큐로)
 *   GET  /api/ops-canary?days=14     → { ok, days, channels:[{ channel, today:{ok,step,shotKey,ranAt}|null, history:[{ day, ok, step }] }] }  // §19 셀렉터 카나리 결과
 *   권한: 조회 operator+ · 변경 admin+.
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { utcDate } from "../../lib/db-util";
import { ONLINE_WINDOW_MIN } from "../../lib/runner-jobs";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/ops-runners", "/api/ops-runner-assign", "/api/ops-canary"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/ops-runners") && req.method === "GET") {
      const g = requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const runners = await q(sql`
        SELECT d.id, d.name, d.kind, d.tenant_id, d.version, d.last_seen_at,
               (d.last_seen_at IS NOT NULL AND d.last_seen_at > NOW() - (${ONLINE_WINDOW_MIN} * INTERVAL '1 minute')) AS online,
               t.key AS tenant_key,
               (SELECT COUNT(*) FROM runner_jobs j WHERE j.claimed_by = d.id AND j.status = 'claimed') AS active,
               (SELECT COUNT(*) FROM runner_jobs j WHERE (j.tenant_id = d.tenant_id OR d.tenant_id IS NULL) AND j.status = 'queued' AND (j.due_at IS NULL OR j.due_at <= NOW())) AS queued
          FROM runner_devices d LEFT JOIN tenants t ON t.id = d.tenant_id
         ORDER BY d.tenant_id NULLS FIRST, d.id`);
      const [f] = await q(sql`
        SELECT (SELECT COUNT(*) FROM runner_devices WHERE tenant_id IS NULL) AS managed,
               (SELECT COUNT(*) FROM runner_devices WHERE last_seen_at > NOW() - (${ONLINE_WINDOW_MIN} * INTERVAL '1 minute')) AS online,
               (SELECT COUNT(*) FROM runner_jobs WHERE status = 'queued' AND (due_at IS NULL OR due_at <= NOW())) AS queued,
               (SELECT COUNT(*) FROM runner_jobs WHERE status = 'claimed') AS claimed,
               (SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/60 FROM runner_jobs WHERE status = 'queued' AND (due_at IS NULL OR due_at <= NOW())) AS oldest_queued_min`);
      return json({ ok: true, runners: runners.map((r) => ({
        id: n(r.id), name: String(r.name ?? ""), kind: String(r.kind ?? "own"),
        tenantId: r.tenant_id ? n(r.tenant_id) : null, tenantKey: r.tenant_key ? String(r.tenant_key) : null,
        online: r.online === true, lastSeenAt: utcDate(r.last_seen_at)?.toISOString() ?? null,
        version: r.version ? String(r.version) : null, active: n(r.active), queued: n(r.queued),
      })), farm: { managed: n(f?.managed), online: n(f?.online), queued: n(f?.queued), claimed: n(f?.claimed), oldestQueuedMin: f?.oldest_queued_min == null ? null : Math.round(Number(f.oldest_queued_min)) } });
    }

    if (path.endsWith("/ops-canary") && req.method === "GET") {
      const g = requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const days = Math.max(1, Math.min(60, n(url.searchParams.get("days")) || 14));
      const rows = await q(sql`SELECT day, channel, ok, step, detail, shot_key, ran_at FROM canary_runs
        WHERE channel <> '__eval__' AND day >= (NOW() AT TIME ZONE 'Asia/Seoul')::date - ${days}
        ORDER BY day DESC, channel`);
      const today = String((await q(sql`SELECT (NOW() AT TIME ZONE 'Asia/Seoul')::date AS d`))[0]?.d ?? "");
      const byChannel = new Map<string, { channel: string; today: unknown; history: unknown[] }>();
      for (const r of rows) {
        const ch = String(r.channel);
        if (!byChannel.has(ch)) byChannel.set(ch, { channel: ch, today: null, history: [] });
        const entry = byChannel.get(ch)!;
        const day = String(r.day ?? "").slice(0, 10);
        const rec = { day, ok: r.ok === null ? null : r.ok === true, step: r.step ? String(r.step) : null, shotKey: r.shot_key ? String(r.shot_key) : null, ranAt: utcDate(r.ran_at)?.toISOString() ?? null };
        entry.history.push({ day: rec.day, ok: rec.ok, step: rec.step });
        if (day === today && !entry.today) entry.today = { ok: rec.ok, step: rec.step, shotKey: rec.shotKey, ranAt: rec.ranAt };
      }
      return json({ ok: true, days, channels: [...byChannel.values()] });
    }

    if (path.endsWith("/ops-runner-assign")) {
      const g = requireAdmin(req, ["admin", "super_admin"]); if (!g.ok) return g.res;
      if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
      const b = await readJson<Record<string, unknown>>(req);
      const id = n(b.id); const action = String(b.action ?? "");
      if (!id) return badRequest("id");
      const [dev] = await q(sql`SELECT id, name, tenant_id FROM runner_devices WHERE id = ${id} LIMIT 1`);
      if (!dev) return json({ ok: false, error: "러너를 찾을 수 없어요.", step: "not_found" }, 404);

      if (action === "rebind") {
        const tenantId = b.tenantId == null || b.tenantId === "" ? null : n(b.tenantId);
        if (tenantId != null) { const [t] = await q(sql`SELECT id FROM tenants WHERE id = ${tenantId} LIMIT 1`); if (!t) return json({ ok: false, error: "그 테넌트가 없어요.", step: "tenant" }, 404); }
        const [row] = await q(sql`UPDATE runner_devices SET tenant_id = ${tenantId} WHERE id = ${id} RETURNING id, tenant_id`);
        await writeAudit({ tenantId, action: "ops_runner_rebind", actorType: "operator", actorId: g.ops.oid, target: `runner_device:${id}`, detail: { from: dev.tenant_id ? n(dev.tenant_id) : null, to: tenantId }, riskLevel: "high" });
        return json({ ok: true, id, tenantId: row?.tenant_id ? n(row.tenant_id) : null });
      }
      if (action === "release") {
        const released = await q(sql`UPDATE runner_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW()
          WHERE claimed_by = ${id} AND status = 'claimed' RETURNING id`);
        await writeAudit({ tenantId: dev.tenant_id ? n(dev.tenant_id) : null, action: "ops_runner_release", actorType: "operator", actorId: g.ops.oid, target: `runner_device:${id}`, detail: { released: released.length }, riskLevel: "high" });
        return json({ ok: true, id, released: released.length });
      }
      if (action === "remove") {
        await q(sql`UPDATE runner_jobs SET status = 'queued', claimed_by = NULL, claimed_at = NULL, updated_at = NOW() WHERE claimed_by = ${id} AND status = 'claimed'`);
        await q(sql`DELETE FROM runner_devices WHERE id = ${id}`);
        await writeAudit({ tenantId: dev.tenant_id ? n(dev.tenant_id) : null, action: "ops_runner_remove", actorType: "operator", actorId: g.ops.oid, target: `runner_device:${id}`, detail: { name: String(dev.name ?? "") }, riskLevel: "high" });
        return json({ ok: true, id, removed: true });
      }
      return badRequest("action 은 rebind|release|remove", "action");
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_runners", err);
  }
};
