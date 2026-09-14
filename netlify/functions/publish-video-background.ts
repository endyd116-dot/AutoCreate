/**
 * POST /api/publish-video-background { pieceId, tenantId } — Netlify **background**(202 즉시 · 15분). 계약 P1R5 v5.3 §2.3b.
 *   왜 배경인가: 유튜브 `videos.insert` 는 mp4 를 **서버가 스트리밍 업로드**한다(resumable · 60초 편 5~30MB) — 동기 26초 안에 끝나지 않는다.
 *   몸통은 얇다: R2 의 mp4 를 B2 의 커넥터(`lib/publish/index.ts publishPieceById` → 채널별 `publishYoutubeShorts(piece, account)`)에 넘기고,
 *   결과를 `finalizePublish`(B2)가 쓴다 — **여기서 piece/slot/posts 를 직접 쓰지 않는다**(계약 §5 «상태를 쓰는 자리 한 벌»).
 *   실패 처리: retriable 이면 piece 를 `scheduled` 로 되돌려 다음 5분 틱이 다시 잡게 · 아니면 `awaiting_manual` + 알림(조용한 0건 금지 · AC-16).
 *   내부 시크릿 `INTERNAL_SECRET`(폴백 0 · 미설정이면 정직 500).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../../lib/db-util";
import { publishPieceById } from "../../lib/publish";
export const config = { path: "/api/publish-video-background" };

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];

export default async (req: Request): Promise<Response> => {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  if (!secret) { console.error("[publish-video-background] INTERNAL_SECRET 미설정"); return new Response(JSON.stringify({ ok: false, step: "config" }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if ((req.headers.get("x-internal-secret") || "") !== secret) return new Response(JSON.stringify({ ok: false, step: "auth" }), { status: 401, headers: { "Content-Type": "application/json" } });
  let body: { pieceId?: number; tenantId?: number; slotId?: number } = {};
  try { body = await req.json(); } catch { /* */ }
  const pieceId = Number(body.pieceId || 0), tid = Number(body.tenantId || 0);
  if (!pieceId || !tid) return new Response(JSON.stringify({ ok: false, step: "validate" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const t0 = Date.now();
  try {
    const [p] = await q(sql`SELECT status FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} AND kind = 'video'`);
    if (!p) return new Response(JSON.stringify({ ok: false, step: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (String(p.status) !== "publishing" && String(p.status) !== "scheduled") { console.log(`[publish-video-background] piece=${pieceId} status=${p.status} — 스킵(멱등)`); return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200, headers: { "Content-Type": "application/json" } }); }
    const r = await publishPieceById(tid, pieceId, body.slotId ? { slotId: Number(body.slotId) } : {});
    if (r.ok) { console.log(`[publish-video-background] piece=${pieceId} → ${r.via}${r.already ? " (이미 나감)" : ""} ${Math.round((Date.now() - t0) / 1000)}s`); return new Response(JSON.stringify({ ok: true, via: r.via }), { status: 200, headers: { "Content-Type": "application/json" } }); }
    // 실패 — retriable 이면 다음 틱에 다시(상태만 되돌린다) · 아니면 사람에게
    const retriable = r.retriable === true;
    await q(sql`UPDATE pieces SET status = ${retriable ? "scheduled" : "awaiting_manual"}, meta = meta || ${jsonb({ publishFail: { reason: r.reason, error: r.error ?? null, at: new Date().toISOString() } })}, updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${pieceId} AND status IN ('publishing','scheduled')`);
    if (!retriable) await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"publish_manual"}, ${"영상 업로드에 손이 필요해요"}, ${String(r.error ?? "업로드하지 못했어요.").slice(0, 200)}, ${"/app/posts.html"})`);
    console.error(`[publish-video-background] piece=${pieceId} 실패 reason=${r.reason} retriable=${retriable}`);
    return new Response(JSON.stringify({ ok: false, reason: r.reason, retriable }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[publish-video-background]", e);
    return new Response(JSON.stringify({ ok: false, step: "error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
