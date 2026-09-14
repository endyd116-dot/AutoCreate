/**
 * 검수 API(계약 P1R1 §4 v1.1/1.3):
 *   GET  /api/pieces-list?status=generating|in_review|scheduled|published|failed|rejected|all(기본 all) → { pieces:[PieceRow] }
 *   GET  /api/pieces-get?id=                      → { piece:PieceDetail }
 *   POST /api/pieces-approve { id }               → { status:"scheduled", scheduledFor } | ✗ { step:"gate", error, gate }   // 고지·금칙어·제휴 링크 수·유사도 재검사
 *   POST /api/pieces-reject { id, reason? }       → { status:"rejected" }
 *   POST /api/pieces-regenerate { id, note? }     → { status:"generating" } | ✗ step regen_limit   // 코인 0(같은 ref) · 1회
 *   POST /api/pieces-update { id, title?, bodyHtml? } → { gate:GateReport, bodyHtml }              // bodyHtml 정본 승격(meta.editedByUser) · 고지 첫 요소 재삽입 · 게이트 재검사(정보)
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { jsonb, utcDate } from "../../lib/db-util";
import { q } from "../../lib/accounts";
import { type GateReport } from "../../lib/ai-tell-gate";
import { disclosureTextFor } from "../../lib/disclosure";
/* 🔴 발행 직전 재검사·승인 전이는 `lib/content-approve.ts` 한 벌이 정본이다 — 크론(`slots.review_deadline` 자동 승인)이
   같은 판정기·같은 전이를 부른다(사람 승인과 자동 승인의 기준이 갈라지지 않게 · PITFALLS #11-b). */
import { recheckPiece, approvePiece } from "../../lib/content-approve";
import { triggerGenerate } from "../../lib/director";
import { sql } from "drizzle-orm";

export const config = { path: ["/api/pieces-list", "/api/pieces-get", "/api/pieces-approve", "/api/pieces-reject", "/api/pieces-regenerate", "/api/pieces-update"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);
type Row = Record<string, unknown>;
const STATUSES = new Set(["generating", "draft", "in_review", "approved", "scheduled", "publishing", "published", "awaiting_manual", "failed", "rejected"]);

function stageOf(r: Row): "writing" | "images" | "checking" | "done" | "failed" {
  const st = String(r.status); const m = (r.meta || {}) as Record<string, unknown>;
  if (st === "failed") return "failed";
  if (st !== "generating") return "done";
  const s = String(m.stage || "writing");
  return (["writing", "images", "checking", "done"].includes(s) ? s : "writing") as "writing" | "images" | "checking" | "done";
}
function pieceRow(r: Row): Record<string, unknown> {
  const m = (r.meta && typeof r.meta === "object" ? r.meta : {}) as Record<string, unknown>;
  const g = (r.gate_report && typeof r.gate_report === "object" ? r.gate_report : null) as GateReport | null;
  const o: Record<string, unknown> = {
    id: n(r.id), channel: String(r.channel), accountHandle: r.handle ? String(r.handle) : null, kind: String(r.kind || "post"), format: String(r.format || ""),
    title: String(r.title || ""), status: String(r.status), stage: stageOf(r), gateOk: g ? !!g.ok : false, createdAt: utcDate(r.created_at)?.toISOString() ?? "",
  };
  const sf = utcDate(r.scheduled_for); if (sf) o.scheduledFor = sf.toISOString();
  const pa = utcDate(r.published_at); if (pa) o.publishedAt = pa.toISOString();
  if (r.external_url) o.externalUrl = String(r.external_url);
  if (r.cover_url) o.coverUrl = String(r.cover_url);
  if (m.failReason) o.failReason = String(m.failReason);
  return o;
}
const PIECE_SELECT = sql`p.*, a.handle, (SELECT (c.meta->>'url') FROM piece_assets c WHERE c.piece_id = p.id AND c.kind = 'image' ORDER BY c.sort LIMIT 1) AS cover_url`;


/** 사용자가 고지를 지웠어도 첫 요소로 되돌린다(§16B.4). */
function ensureDisclosureHtml(html: string, provider: string | null | undefined): string {
  const text = disclosureTextFor(provider);
  const stripped = html.replace(/<div[^>]*class="[^"]*\bdisclosure\b[^"]*"[^>]*>[\s\S]*?<\/div>\s*/gi, "");
  return `<div class="disclosure">${text}</div>\n${stripped}`;
}
/** 사용자 HTML 소독 — script · on속성 · iframe 제거. */
function sanitizeHtml(html: string): string {
  return String(html || "").replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1>/gi, "").replace(/\son\w+="[^"]*"/gi, "").replace(/\son\w+='[^']*'/gi, "").replace(/javascript:/gi, "").slice(0, 200_000);
}

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const url = new URL(req.url); const path = routeOf(req);
  try {
    if (path.endsWith("/pieces-list")) {
      const status = url.searchParams.get("status") || "all";
      const rows = status === "all"
        ? await q(sql`SELECT ${PIECE_SELECT} FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.tenant_id = ${tid} ORDER BY p.id DESC LIMIT 200`)
        : STATUSES.has(status) ? await q(sql`SELECT ${PIECE_SELECT} FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id WHERE p.tenant_id = ${tid} AND p.status = ${status} ORDER BY p.id DESC LIMIT 200`) : [];
      return json({ ok: true, pieces: rows.map(pieceRow) });
    }
    if (path.endsWith("/pieces-get")) {
      const id = n(url.searchParams.get("id")); if (!id) return badRequest("id");
      const [p] = await q(sql`SELECT ${PIECE_SELECT}, t.title AS topic_title FROM pieces p LEFT JOIN accounts a ON a.id = p.account_id LEFT JOIN topics t ON t.id = p.topic_id WHERE p.tenant_id = ${tid} AND p.id = ${id}`);
      if (!p) return json({ ok: false, error: "글을 찾을 수 없어요.", step: "not_found" }, 404);
      const m = (p.meta || {}) as Record<string, unknown>;
      const assets = await q(sql`SELECT caption, meta, sort FROM piece_assets WHERE piece_id = ${id} AND kind = 'image' ORDER BY sort`);
      const g = (p.gate_report && typeof p.gate_report === "object" ? p.gate_report : { ok: false, checks: [], rewritten: false }) as GateReport;
      const meta: Record<string, unknown> = { tags: Array.isArray(m.tags) ? m.tags : [], disclosure: m.disclosure ?? null };
      if (m.affiliate && typeof m.affiliate === "object") { const af = m.affiliate as Record<string, unknown>; meta.affiliate = { provider: af.provider, url: af.url, subId: af.subId }; }
      if (m.scheduleAt) meta.scheduleAt = m.scheduleAt;
      if (m.slotReason) meta.slotReason = m.slotReason;
      if (m.angle) meta.angle = m.angle;
      return json({ ok: true, piece: { ...pieceRow(p), bodyHtml: String(p.body || ""), blocks: Array.isArray(p.blocks) ? p.blocks : [],
        images: assets.map((x) => ({ url: String(((x.meta || {}) as Record<string, unknown>).url || ""), caption: x.caption ? String(x.caption) : "", sort: n(x.sort) })),
        meta, gate: g, topicTitle: p.topic_title ? String(p.topic_title) : "", regenCount: n(m.regenCount) } });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);
    const id = n(b.id); if (!id) return badRequest("id");
    const [p] = await q(sql`SELECT p.* FROM pieces p WHERE p.tenant_id = ${tid} AND p.id = ${id}`);
    if (!p) return json({ ok: false, error: "글을 찾을 수 없어요.", step: "not_found" }, 404);
    const m = (p.meta || {}) as Record<string, unknown>;
    const st = String(p.status);

    if (path.endsWith("/pieces-approve")) {
      const r = await approvePiece(tid, p);
      if (!r.ok) return r.step === "gate"
        ? json({ ok: false, step: "gate", error: r.error, gate: r.gate }, 409)
        : json({ ok: false, step: "state", error: r.error }, 400);
      if (!r.alreadyScheduled) await writeAudit({ tenantId: tid, action: "piece_approve", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { scheduledFor: r.scheduledFor, gateOk: r.gate.ok } });
      return json({ ok: true, status: "scheduled", scheduledFor: r.scheduledFor });
    }
    if (path.endsWith("/pieces-reject")) {
      if (st === "rejected") return json({ ok: true, status: "rejected" });
      if (!["in_review", "draft", "failed", "scheduled", "approved"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 버릴 수 없어요." }, 400);
      const reason = String(b.reason ?? "").trim().slice(0, 300);
      await q(sql`UPDATE pieces SET status = 'rejected', meta = meta || ${jsonb({ rejectReason: reason || null })}, updated_at = NOW() WHERE id = ${id}`);
      if (p.slot_id) await q(sql`UPDATE slots SET status = 'skipped', note = ${reason || "버림"}, updated_at = NOW() WHERE id = ${n(p.slot_id)}`);
      await writeAudit({ tenantId: tid, action: "piece_reject", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { reason } });
      return json({ ok: true, status: "rejected" });
    }
    if (path.endsWith("/pieces-regenerate")) {
      const w = await requireWritable(tid); if (!w.ok) return w.res;   // readonly·suspended 는 재생성 금지(P1R4 §1.3)
      if (st === "generating") {
        // ★C4 fix: 배경 함수가 죽어 «만드는 중»에 갇힌 글은 다시 만들기가 거부되어 사용자가 빠져나갈 길이 없었다 —
        //   20분 넘게 그대로면 코인 재차감 0(같은 ref)으로 한 번 더 건다. 다시 실패하면 triggerGenerate 가 failed+환급+알림으로 내린다.
        const at = utcDate(p.updated_at);
        if (at && Date.now() - at.getTime() > 20 * 60_000) {
          const fired = await triggerGenerate(id, tid);
          await writeAudit({ tenantId: tid, action: "piece_retrigger", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { fired, stuckMin: Math.round((Date.now() - at.getTime()) / 60_000) } });
          return json({ ok: true, status: "generating" }, 202);
        }
        return json({ ok: true, status: "generating" });
      }
      if (!["in_review", "draft", "failed", "rejected"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 다시 만들 수 없어요." }, 400);
      const regen = n(m.regenCount);
      if (regen >= 1) return json({ ok: false, step: "regen_limit", error: "다시 만들기는 한 번만 할 수 있어요. 직접 수정하거나 새 소재로 만들어 주세요." }, 400);
      const note = String(b.note ?? "").trim().slice(0, 300);
      // 실패로 환급됐던 piece 는 다시 차감(원장 행 삭제 0 · 새 ref `piece:{id}:regen{n}` — 순액은 1회분 · 부족하면 coin_short)
      if (st === "failed" && n(m.refunded) > 0) {
        const { consume, refundPiece } = await import("../../lib/coin-ledger");
        const imgs = Math.max(0, Math.trunc(n(m.imageCount)));
        const tag = `piece:${id}:regen${regen + 1}`;
        const c1 = await consume(tid, "blog", tag, { actorId: auth.user.uid, reason: "다시 만들기(환급분 재차감)" });
        if (!c1.ok) return json({ ok: false, step: "coin_short", error: "코인이 부족해요.", need: c1.reason === "insufficient" ? c1.need : 0, have: c1.balance }, 402);
        for (let i = 1; i <= imgs; i++) {
          const ci = await consume(tid, "image", `${tag}:img${i}`, { actorId: auth.user.uid, reason: `이미지 ${i}/${imgs}(재차감)` });
          if (!ci.ok) { await refundPiece(tid, id); return json({ ok: false, step: "coin_short", error: "코인이 부족해요.", need: ci.reason === "insufficient" ? ci.need : 0, have: ci.balance }, 402); }
        }
      }
      await q(sql`UPDATE pieces SET status = 'generating', gate_report = NULL, meta = meta || ${jsonb({ stage: "writing", regenCount: regen + 1, regenNote: note || null, failReason: null, refunded: null, angle: note ? `${String(m.angle || "")} — 사용자 요청: ${note}` : m.angle })}, updated_at = NOW() WHERE id = ${id}`);
      if (p.slot_id) await q(sql`UPDATE slots SET status = 'producing', updated_at = NOW() WHERE id = ${n(p.slot_id)}`);
      const fired = await triggerGenerate(id, tid);
      await writeAudit({ tenantId: tid, action: "piece_regenerate", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { note, fired } });
      return json({ ok: true, status: "generating" }, 202);
    }
    if (path.endsWith("/pieces-update")) {
      if (!["in_review", "draft", "scheduled", "approved", "rejected"].includes(st)) return json({ ok: false, step: "state", error: "지금 상태에서는 수정할 수 없어요." }, 400);
      const sets: ReturnType<typeof sql>[] = [];
      let bodyHtml = String(p.body || "");
      if (typeof b.title === "string") { const t = b.title.trim().slice(0, 120); if (t) sets.push(sql`title = ${t}`); }
      const need = !!m.affiliate || m.adDisclosure === true;
      if (typeof b.bodyHtml === "string") {
        bodyHtml = sanitizeHtml(b.bodyHtml);
        if (need) bodyHtml = ensureDisclosureHtml(bodyHtml, (m.affiliate as Record<string, unknown> | null)?.provider as string | undefined ?? "coupang");
        sets.push(sql`body = ${bodyHtml}`);
        sets.push(sql`meta = meta || ${jsonb({ editedByUser: true, editedAt: new Date().toISOString() })}`);
      }
      if (!sets.length) return badRequest("바꿀 값이 없어요.");
      await q(sql`UPDATE pieces SET ${sql.join(sets, sql`, `)}, updated_at = NOW() WHERE id = ${id}`);
      const [p2] = await q(sql`SELECT p.* FROM pieces p WHERE p.id = ${id}`);
      const gate = await recheckPiece(tid, p2);
      await q(sql`UPDATE pieces SET gate_report = ${jsonb(gate)} WHERE id = ${id}`);
      await writeAudit({ tenantId: tid, action: "piece_update", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `piece:${id}`, detail: { title: typeof b.title === "string", body: typeof b.bodyHtml === "string", gateOk: gate.ok } });
      return json({ ok: true, gate, bodyHtml: String(p2.body || "") });
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("pieces", err); }
};

