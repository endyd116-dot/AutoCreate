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
import { recheckVideoPiece, hardFailures, judgeBlockers } from "../../lib/content-approve";
import { writeAudit } from "../../lib/audit";
import { setSlot } from "../../lib/cron/base";   // 슬롯 상태 쓰기 한 곳(base.ts) — 편성표가 «올리는 중»에 영영 멈춰 있지 않게
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
    const [p] = await q(sql`SELECT status, slot_id FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId} AND kind = 'video'`);
    if (!p) return new Response(JSON.stringify({ ok: false, step: "not_found" }), { status: 404, headers: { "Content-Type": "application/json" } });
    // 편성 자리 — 호출부(publisher)가 준 것이 먼저, 없으면 piece 에 붙은 것(같은 값이어야 한다).
    const slotId = Number(body.slotId || 0) || Number(p.slot_id || 0) || null;
    if (String(p.status) !== "publishing" && String(p.status) !== "scheduled") { console.log(`[publish-video-background] piece=${pieceId} status=${p.status} — 스킵(멱등)`); return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200, headers: { "Content-Type": "application/json" } }); }

    /* 🔴 발행 **직전** 재검사(계약 §1.8·§16B · AC-29 «호출처 0» 수리) — 승인 뒤에 설명란을 고쳤을 수 있다.
       고지 3종(우상단 배지 · 시작 3초 자막 · 설명란 첫 줄)과 대본 금칙어·유사도를 승인과 **같은 판정기**로 다시 잰다.
       막는 것은 승인과 같은 하드 기준뿐(하드 게이트 + 심사 P0) — 취향 항목은 발행을 막지 않는다.
       고지가 빠진 영상이 나가면 공정위 건이다 → 나가지 않게 하고 사람에게 넘긴다(조용한 통과 0). */
    const [full] = await q(sql`SELECT * FROM pieces WHERE tenant_id = ${tid} AND id = ${pieceId}`);
    const gate = await recheckVideoPiece(tid, full);
    const blockers = [...hardFailures(gate).map((c) => c.label), ...judgeBlockers(gate).map((a) => a.label)];
    if (blockers.length) {
      await q(sql`UPDATE pieces SET status = 'awaiting_manual', gate_report = ${jsonb(gate)}, meta = meta || ${jsonb({ publishFail: { reason: "gate", error: blockers.join(" · "), at: new Date().toISOString() } })}, updated_at = NOW()
        WHERE tenant_id = ${tid} AND id = ${pieceId} AND status IN ('publishing','scheduled')`);
      /* 🔴 [R7 통합 점검 2026-09-15] 편성 자리도 같이 옮긴다 — publisher 가 `publishing` 으로 올려 두고 넘겼는데 여기서 piece 만 내리면
         편성표는 «올리는 중»에 영영 멈춰 있다(실측: piece awaiting_manual · slot publishing). 글 경로(publisher.ts:189)와 같은 처치. */
      if (slotId) await setSlot(tid, slotId, "awaiting_manual", blockers.join(" · "));
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"publish_manual"}, ${"영상을 올리기 전에 확인이 필요해요"}, ${`${blockers.join(" · ")} — 확인하고 다시 올려 주세요.`.slice(0, 200)}, ${`/app/piece.html?id=${pieceId}`})`);
      await writeAudit({ tenantId: tid, action: "video_publish_gate_block", actorType: "system", riskLevel: "high", target: `piece:${pieceId}`, detail: { blockers } });
      console.error(`[publish-video-background] piece=${pieceId} 발행 직전 게이트 차단: ${blockers.join(" · ")}`);
      return new Response(JSON.stringify({ ok: false, reason: "gate", blockers }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    const r = await publishPieceById(tid, pieceId, body.slotId ? { slotId: Number(body.slotId) } : {});
    if (r.ok) { console.log(`[publish-video-background] piece=${pieceId} → ${r.via}${r.already ? " (이미 나감)" : ""} ${Math.round((Date.now() - t0) / 1000)}s`); return new Response(JSON.stringify({ ok: true, via: r.via }), { status: 200, headers: { "Content-Type": "application/json" } }); }
    // 실패 — retriable 이면 다음 틱에 다시(상태만 되돌린다) · 아니면 사람에게
    const retriable = r.retriable === true;
    await q(sql`UPDATE pieces SET status = ${retriable ? "scheduled" : "awaiting_manual"}, meta = meta || ${jsonb({ publishFail: { reason: r.reason, error: r.error ?? null, at: new Date().toISOString() } })}, updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${pieceId} AND status IN ('publishing','scheduled')`);
    // 편성 자리도 piece 와 같은 상태로(위 게이트 차단과 같은 이유) — 다시 시도면 `scheduled` 로 되돌려 다음 틱이 잡게, 아니면 «직접 올리기».
    if (slotId) await setSlot(tid, slotId, retriable ? "scheduled" : "awaiting_manual", retriable ? null : String(r.error ?? "업로드하지 못했어요"));
    if (!retriable) await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"publish_manual"}, ${"영상 업로드에 손이 필요해요"}, ${String(r.error ?? "업로드하지 못했어요.").slice(0, 200)}, ${"/app/posts.html"})`);
    console.error(`[publish-video-background] piece=${pieceId} 실패 reason=${r.reason} retriable=${retriable}`);
    return new Response(JSON.stringify({ ok: false, reason: r.reason, retriable }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[publish-video-background]", e);
    return new Response(JSON.stringify({ ok: false, step: "error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};
