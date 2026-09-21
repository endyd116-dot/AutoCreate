/**
 * 운영센터 · 침해 통지 접수·처리(DESIGN §5E.2 · 계약 R8). 권한: admin 이상(되돌릴 수 없는 단계는 감사 high/critical).
 *   GET  /api/ops-takedowns?status&tenantId&page → { ok, notices:[…], total, due:[{id,tenantId,dueAt}] }  (due = 기한 지난 것 = 운영 대기열)
 *   GET  /api/ops-takedown?id=                                 → { ok, notice:{…이름·제목·계정까지…}, trail:[…지금까지 한 일…] }
 *   POST /api/ops-takedown { tenantId, kind, reason, externalUrl?|pieceId?|postId?, claimant?, evidence?, dueDays? } → 접수(①②③ 한 번에)
 *   POST /api/ops-takedown-action { id, action:"disconnect"|"suspend"|"resolve"|"dismiss", note? } → 단계 실행·종결
 *   🔴 **자동 정지는 없다** — 기한이 지나도 크론은 대기열에 올리기만 하고, 계정 해제·서비스 정지는 **사람이 여기서 누른다**
 *      (통지는 틀린 것도 온다 · 되돌릴 수 없는 일은 사람 확인 뒤에 · DESIGN §5E.1-③ 을 안 만드는 대가로 ①~④를 확실히 한다).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { sql, type SQL } from "drizzle-orm";
import { utcDate } from "../../lib/db-util";
import { pageOf } from "../../lib/ops/period";
import { receiveNotice, escalate, resolveNotice, dueNotices, TAKEDOWN_KINDS, TAKEDOWN_KIND_LABEL, type TakedownKind } from "../../lib/takedown";

export const config = { path: ["/api/ops-takedowns", "/api/ops-takedown", "/api/ops-takedown-action"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url); const path = routeOf(req);
  const o = await requireAdmin(req, ["admin", "super_admin"]); if (!o.ok) return o.res;
  const ip = clientIp(req);
  try {
    if (path.endsWith("/ops-takedowns")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const status = (url.searchParams.get("status") || "").trim();
      const tenantId = n(url.searchParams.get("tenantId"));
      const { page, size, offset } = pageOf(url);
      const where: SQL = sql`(${status} = '' OR t.status = ${status}) AND (${tenantId} = 0 OR t.tenant_id = ${tenantId})`;
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM takedown_notices t WHERE ${where}`);
      /* 🔴 **화면이 그릴 수 있게 이름까지 뽑는다**(2026-09-21 B · CLAUDE §3).
         전에는 `piece_id`·`account_id` 만 내려보내서, 운영자는 «어느 글인지»를 모른 채
         «계정 연결 해제»·«서비스 정지» 같은 **되돌릴 수 없는 단추**를 눌러야 했다.
         제목·계정 이름은 이미 옆 표에 있다 — 안 뽑을 이유가 없었다. */
      const rows = await q(sql`SELECT t.*, e.name AS tenant_name, p.title AS piece_title,
               a.handle AS account_handle, a.channel AS account_channel, a.status AS account_status
          FROM takedown_notices t
          LEFT JOIN tenants e ON e.id = t.tenant_id
          LEFT JOIN pieces p ON p.id = t.piece_id
          LEFT JOIN accounts a ON a.id = t.account_id
        WHERE ${where} ORDER BY t.id DESC LIMIT ${size} OFFSET ${offset}`);
      return json({ ok: true, total: n(cnt?.c), page, size, kinds: TAKEDOWN_KINDS.map((k) => ({ key: k, label: TAKEDOWN_KIND_LABEL[k] })),
        due: await dueNotices(50),
        notices: rows.map((r) => ({
          id: n(r.id), tenantId: n(r.tenant_id), tenantName: String(r.tenant_name ?? ""), status: String(r.status),
          kind: String(r.kind), kindLabel: TAKEDOWN_KIND_LABEL[String(r.kind) as TakedownKind] ?? String(r.kind),
          reason: String(r.reason ?? ""), claimant: r.claimant ? String(r.claimant) : null, evidence: r.evidence ? String(r.evidence) : null,
          channel: r.channel ? String(r.channel) : null, externalUrl: r.external_url ? String(r.external_url) : null,
          pieceId: r.piece_id ? n(r.piece_id) : null, postId: r.post_id ? n(r.post_id) : null, accountId: r.account_id ? n(r.account_id) : null,
          /* 제목이 없으면 **지어내지 않고** 주소를 준다. 둘 다 없으면 빈 글자 — 화면이 «글을 못 찾았어요»라고 쓴다(AC-9). */
          pieceTitle: String(r.piece_title ?? "") || (r.external_url ? String(r.external_url) : ""),
          accountHandle: r.account_handle ? String(r.account_handle) : null,
          accountChannel: r.account_channel ? String(r.account_channel) : null,
          accountStatus: r.account_status ? String(r.account_status) : null,
          receivedAt: utcDate(r.received_at)?.toISOString() ?? "", dueAt: utcDate(r.due_at)?.toISOString() ?? "",
          overdue: String(r.status) === "open" && !!utcDate(r.due_at) && utcDate(r.due_at)!.getTime() < Date.now(),
          resolution: r.resolution ? String(r.resolution) : null,
        })) });
    }
    /* ───────── 단건(상세) ─────────
       🔴 **없던 문이다**(2026-09-21 B). `/api/ops-takedown` 은 POST(접수)만 받고 GET 은 405 였다 —
          그래서 운영자가 신고 하나를 열어 **증거·신고인·지금까지 한 일**을 보고 판단할 자리가 없었다.
          목록만으로는 «되돌릴 수 없는 단추»를 누르기에 모자라다(DESIGN §5E.2 «통지는 틀린 것도 온다»). */
    if (path.endsWith("/ops-takedown") && req.method === "GET") {
      const id = n(url.searchParams.get("id"));
      if (!id) return badRequest("id");
      const [r] = await q(sql`SELECT t.*, e.name AS tenant_name, e.status AS tenant_status, p.title AS piece_title,
               a.handle AS account_handle, a.channel AS account_channel, a.status AS account_status,
               po.external_url AS post_url, po.published_at AS post_published_at
          FROM takedown_notices t
          LEFT JOIN tenants e ON e.id = t.tenant_id
          LEFT JOIN pieces p ON p.id = t.piece_id
          LEFT JOIN accounts a ON a.id = t.account_id
          LEFT JOIN posts po ON po.id = t.post_id
         WHERE t.id = ${id} LIMIT 1`);
      if (!r) return json({ ok: false, error: "그 신고를 찾을 수 없어요.", step: "not_found" }, 404);
      const kind = String(r.kind);
      /* 지금까지 이 신고에 한 일 — 되돌릴 수 없는 단계일수록 **누가 언제 눌렀나**가 남아야 한다.
         보조 SELECT 라 실패해도 빈 배열로 계속한다(CLAUDE §4.1). */
      const trail = await q(sql`SELECT id, action, actor_type, actor_id, risk_level, detail, created_at
          FROM audit_logs WHERE target = ${`takedown:${id}`} ORDER BY id`).catch(() => []);
      return json({ ok: true, notice: {
        id: n(r.id), tenantId: n(r.tenant_id), tenantName: String(r.tenant_name ?? ""), tenantStatus: String(r.tenant_status ?? ""),
        status: String(r.status), kind, kindLabel: TAKEDOWN_KIND_LABEL[kind as TakedownKind] ?? kind,
        reason: String(r.reason ?? ""), claimant: r.claimant ? String(r.claimant) : null, evidence: r.evidence ? String(r.evidence) : null,
        channel: r.channel ? String(r.channel) : null, externalUrl: r.external_url ? String(r.external_url) : null,
        pieceId: r.piece_id ? n(r.piece_id) : null, pieceTitle: String(r.piece_title ?? "") || (r.external_url ? String(r.external_url) : ""),
        postId: r.post_id ? n(r.post_id) : null, postUrl: r.post_url ? String(r.post_url) : null,
        postedAt: utcDate(r.post_published_at)?.toISOString() ?? null,
        accountId: r.account_id ? n(r.account_id) : null, accountHandle: r.account_handle ? String(r.account_handle) : null,
        accountChannel: r.account_channel ? String(r.account_channel) : null, accountStatus: r.account_status ? String(r.account_status) : null,
        receivedAt: utcDate(r.received_at)?.toISOString() ?? "", dueAt: utcDate(r.due_at)?.toISOString() ?? "",
        overdue: String(r.status) === "open" && !!utcDate(r.due_at) && utcDate(r.due_at)!.getTime() < Date.now(),
        disconnectedAt: utcDate(r.disconnected_at)?.toISOString() ?? null,
        suspendedAt: utcDate(r.suspended_at)?.toISOString() ?? null,
        resolution: r.resolution ? String(r.resolution) : null,
      }, trail: trail.map((t) => ({
        id: n(t.id), action: String(t.action), actorType: String(t.actor_type ?? ""), actorId: t.actor_id ? n(t.actor_id) : null,
        riskLevel: String(t.risk_level ?? "low"), detail: t.detail ?? null, at: utcDate(t.created_at)?.toISOString() ?? "",
      })) });
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    if (path.endsWith("/ops-takedown-action")) {
      const b = await readJson<{ id?: unknown; action?: unknown; note?: unknown }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const action = String(b.action ?? "");
      if (action === "disconnect" || action === "suspend") {
        const r = await escalate(id, action, o.ops.oid, ip);
        if (!r.ok) return json({ ok: false, error: r.error, step: "not_found" }, 404);
        return json({ ok: true, status: r.status, affected: r.affected ?? 0 });
      }
      if (action === "resolve" || action === "dismiss") {
        const r = await resolveNotice(id, o.ops.oid, { dismissed: action === "dismiss", note: typeof b.note === "string" ? b.note : undefined, ip });
        if (!r.ok) return json({ ok: false, error: r.error, step: "not_found" }, 404);
        return json({ ok: true, status: r.status });
      }
      return badRequest("action 은 disconnect · suspend · resolve · dismiss 중 하나예요.", "action");
    }

    const b = await readJson<Record<string, unknown>>(req);
    const kind = String(b.kind ?? "other") as TakedownKind;
    if (!(TAKEDOWN_KINDS as readonly string[]).includes(kind)) return badRequest("어떤 종류의 신고인지 골라 주세요.", "kind");
    const r = await receiveNotice({
      tenantId: n(b.tenantId), pieceId: b.pieceId ? n(b.pieceId) : null, postId: b.postId ? n(b.postId) : null,
      externalUrl: typeof b.externalUrl === "string" ? b.externalUrl : null, kind,
      claimant: typeof b.claimant === "string" ? b.claimant : null, evidence: typeof b.evidence === "string" ? b.evidence : null,
      reason: String(b.reason ?? ""), dueDays: b.dueDays ? n(b.dueDays) : undefined, operatorId: o.ops.oid, ip,
    });
    if (!r.ok) return json({ ok: false, error: r.error, step: r.step }, 400);
    return json({ ok: true, notice: r.notice, stoppedSlots: r.stoppedSlots }, 201);
  } catch (err) { return jsonError("ops_takedown", err); }
};
