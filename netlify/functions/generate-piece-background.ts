/**
 * POST /api/generate-piece-background { pieceId, tenantId } — Netlify **background** 함수(파일명 -background · 202 즉시 반환 · 15분).
 *   호출 = director-confirm / pieces-regenerate(서버 내부 · `x-internal-secret` = INTERNAL_SECRET · 폴백 없음 → 미설정이면 500).
 *   멱등: piece 가 generating 이 아니면(이미 in_review/failed) 스킵. 본체 = lib/content-gen.generatePiece.
 */
import { generatePiece } from "../../lib/content-gen";
export const config = { path: "/api/generate-piece-background" };

export default async (req: Request): Promise<Response> => {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  if (!secret) { console.error("[generate-piece-background] INTERNAL_SECRET 미설정"); return new Response(JSON.stringify({ ok: false, step: "config", error: "INTERNAL_SECRET 미설정" }), { status: 500 }); }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if ((req.headers.get("x-internal-secret") || "") !== secret) return new Response(JSON.stringify({ ok: false, step: "auth" }), { status: 401 });
  let body: { pieceId?: number; tenantId?: number } = {};
  try { body = await req.json(); } catch { /* */ }
  const pieceId = Number(body.pieceId || 0), tid = Number(body.tenantId || 0);
  if (!pieceId || !tid) return new Response(JSON.stringify({ ok: false, step: "validate" }), { status: 400 });
  const t0 = Date.now();
  const r = await generatePiece(tid, pieceId);
  console.log(`[generate-piece-background] piece=${pieceId} tid=${tid} → ${r.status}${r.reason ? ` (${r.reason})` : ""} ${Math.round((Date.now() - t0) / 1000)}s`);
  return new Response(JSON.stringify({ ok: r.ok, status: r.status }), { status: 200, headers: { "Content-Type": "application/json" } });
};
