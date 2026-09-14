/**
 * 운영센터 — 러너 팜(계약 P1R4 §2.2 · DESIGN §8·§19). 관리형 러너(tenant_id NULL) + 고객 러너를 가로질러 본다.
 *   GET  /api/ops-runners            → { ok, requests:[{ id, tenantId, devices, totalKrw, assigned, requestedAt }], runners:[{ id, name, kind, tenantId, tenantKey, online, lastSeenAt, version, active, queued }], farm:{ managed, online, queued, claimed, oldestQueuedMin } }
 *   POST /api/ops-runner-assign      { action, id, tenantId? }   → 액션별
 *        · action="request-reject" { requestId, note? } — 관리형 러너 «신청» 거절(P1R6 §3.1)
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
      const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
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
      /* P1R6 §3.1 — 관리형 러너 **신청서** 목록. 기기 목록과 **따로** 싣는다:
         신청은 아직 기기가 아니다(실기기 프로비저닝은 범위 밖 · 운영자가 아래 rebind 로 손수 배정한다).
         한 배열에 섞으면 «신청만 했는데 기기가 있는 것처럼» 보인다. */
      const requests = await q(sql`SELECT r.id, r.tenant_id, r.devices, r.plan_key, r.amount_krw, r.vat_krw, r.total_krw,
             r.note, r.created_at, t.key AS tenant_key, t.name AS tenant_name,
             (SELECT COUNT(*) FROM runner_devices d WHERE d.tenant_id = r.tenant_id AND d.kind = 'managed') AS assigned
        FROM managed_runner_requests r LEFT JOIN tenants t ON t.id = r.tenant_id
        WHERE r.status = 'requested' ORDER BY r.created_at`);
      return json({ ok: true, requests: requests.map((r) => ({
        id: n(r.id), tenantId: n(r.tenant_id), tenantKey: r.tenant_key ? String(r.tenant_key) : null,
        tenantName: r.tenant_name ? String(r.tenant_name) : null, devices: n(r.devices), planKey: r.plan_key ? String(r.plan_key) : null,
        amountKrw: n(r.amount_krw), vatKrw: n(r.vat_krw), totalKrw: n(r.total_krw),
        note: r.note ? String(r.note) : null, assigned: n(r.assigned),
        requestedAt: utcDate(r.created_at)?.toISOString() ?? null,
      })), runners: runners.map((r) => ({
        id: n(r.id), name: String(r.name ?? ""), kind: String(r.kind ?? "own"),
        tenantId: r.tenant_id ? n(r.tenant_id) : null, tenantKey: r.tenant_key ? String(r.tenant_key) : null,
        online: r.online === true, lastSeenAt: utcDate(r.last_seen_at)?.toISOString() ?? null,
        version: r.version ? String(r.version) : null, active: n(r.active), queued: n(r.queued),
      })), farm: { managed: n(f?.managed), online: n(f?.online), queued: n(f?.queued), claimed: n(f?.claimed), oldestQueuedMin: f?.oldest_queued_min == null ? null : Math.round(Number(f.oldest_queued_min)) } });
    }

    if (path.endsWith("/ops-canary") && req.method === "GET") {
      const g = await requireAdmin(req, ["operator", "admin", "super_admin"]); if (!g.ok) return g.res;
      const days = Math.max(1, Math.min(60, n(url.searchParams.get("days")) || 14));
      const rows = await q(sql`SELECT day, channel, ok, step, detail, shot_key, ran_at FROM canary_runs
        WHERE channel <> '__eval__' AND day >= ((NOW() AT TIME ZONE 'Asia/Seoul')::date - ${days}::int)   -- ★C(P1R4) fix: date - $1 은 바인딩 타입이 없어 «operator does not exist: date >= integer» 500(AC-23) — ::int + 괄호
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
      // 러너 팜 변경 = super_admin 전용(플랫폼 설정 · 메인 결정 4).
      const g = await requireAdmin(req, ["super_admin"]); if (!g.ok) return g.res;
      if (req.method !== "POST") return json({ ok: false, error: "method", step: "method" }, 405);
      const b = await readJson<Record<string, unknown>>(req);
      const id = n(b.id); const action = String(b.action ?? "");

      /* 🔴 «신청 거절»은 **기기가 없는** 동작이다(신청서만 닫는다). 아래 기기 조회보다 **먼저** 가른다 —
         안 그러면 기기 id 를 요구하는 검사에 걸려 영영 못 부른다(가드가 엉뚱한 것을 막는 자리). */
      if (action === "request-reject") {
        const reqId = n(b.requestId);
        if (!reqId) return badRequest("requestId");
        const [r] = await q(sql`UPDATE managed_runner_requests SET status = 'rejected', decided_by = ${g.ops.oid}, decided_at = NOW(),
            note = COALESCE(${String(b.note ?? "").slice(0, 500) || null}, note), updated_at = NOW()
          WHERE id = ${reqId} AND status = 'requested' RETURNING id, tenant_id`);
        if (!r) return json({ ok: false, error: "그 신청을 찾을 수 없어요(이미 처리됐을 수 있어요).", step: "not_found" }, 404);
        const rtid = n(r.tenant_id);
        await writeAudit({ tenantId: rtid, action: "managed_runner_rejected", actorType: "operator", actorId: g.ops.oid, target: `tenant:${rtid}`, detail: { requestId: reqId }, riskLevel: "medium" });
        await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
          VALUES (${rtid}, ${"managed_runner"}, ${"관리형 러너 신청을 처리했어요"},
                  ${"지금은 배정이 어려워요. 자세한 내용은 문의로 알려 드릴게요."}, ${"/app/runner.html"})`);
        return json({ ok: true, requestId: reqId, status: "rejected" });
      }

      if (!id) return badRequest("id");
      const [dev] = await q(sql`SELECT id, name, tenant_id FROM runner_devices WHERE id = ${id} LIMIT 1`);
      if (!dev) return json({ ok: false, error: "러너를 찾을 수 없어요.", step: "not_found" }, 404);

      if (action === "rebind") {
        const tenantId = b.tenantId == null || b.tenantId === "" ? null : n(b.tenantId);
        if (tenantId != null) { const [t] = await q(sql`SELECT id FROM tenants WHERE id = ${tenantId} LIMIT 1`); if (!t) return json({ ok: false, error: "그 테넌트가 없어요.", step: "tenant" }, 404); }
        // 관리형으로 배정하는 것이므로 기기 종류도 같이 바꾼다(자기 PC 로 등록된 기기를 팜에 넣는 경우).
        const [row] = await q(sql`UPDATE runner_devices SET tenant_id = ${tenantId}${tenantId != null ? sql`, kind = 'managed'` : sql``} WHERE id = ${id} RETURNING id, tenant_id`);
        /* 🔴 배정이 곧 신청의 «끝»이다 — 열린 신청을 여기서 닫는다.
           안 닫으면 배정이 끝났는데도 운영 목록에 계속 남아 «아직 처리 안 된 것»처럼 보인다(조용한 잔여). */
        let closed = 0;
        if (tenantId != null) {
          const done = await q(sql`UPDATE managed_runner_requests SET status = 'active', decided_by = ${g.ops.oid}, decided_at = NOW(), updated_at = NOW()
            WHERE tenant_id = ${tenantId} AND status = 'requested' RETURNING id`);
          closed = done.length;
        }
        await writeAudit({ tenantId, action: "ops_runner_rebind", actorType: "operator", actorId: g.ops.oid, target: `runner_device:${id}`, detail: { from: dev.tenant_id ? n(dev.tenant_id) : null, to: tenantId, requestClosed: closed }, riskLevel: "high" });
        return json({ ok: true, id, tenantId: row?.tenant_id ? n(row.tenant_id) : null, requestClosed: closed });
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
      return badRequest("action 은 rebind|release|remove|request-reject", "action");
    }

    return json({ ok: false, error: "not_found", step: "route" }, 404);
  } catch (err) {
    return jsonError("ops_runners", err);
  }
};
