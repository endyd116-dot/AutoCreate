/**
 * POST /api/generate-video-background { pieceId, tenantId, resume? } — Netlify **background**(202 즉시 · 15분). 계약 P1R5 §1.4.
 *   호출 = director-confirm(영상) · 이어달리기(gen.handOff) · 스위퍼(video.sweep) · pieces-regenerate. 내부 시크릿 `INTERNAL_SECRET`(폴백 0 → 미설정이면 정직 500 · AC-16).
 *   멱등: piece 가 generating 이 아니면 스킵 · `meta.chainLock` 이 20분 안이면 즉시 반환(중복 체인 0 — 같은 편을 두 번 만들면 돈이 두 배다).
 */
import { generateVideo } from "../../lib/video/gen";
export const config = { path: "/api/generate-video-background" };

export default async (req: Request): Promise<Response> => {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  if (!secret) { console.error("[generate-video-background] INTERNAL_SECRET 미설정"); return new Response(JSON.stringify({ ok: false, step: "config", error: "INTERNAL_SECRET 미설정" }), { status: 500, headers: { "Content-Type": "application/json" } }); }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  if ((req.headers.get("x-internal-secret") || "") !== secret) return new Response(JSON.stringify({ ok: false, step: "auth" }), { status: 401, headers: { "Content-Type": "application/json" } });
  let body: { pieceId?: number; tenantId?: number; resume?: boolean } = {};
  try { body = await req.json(); } catch { /* */ }
  const pieceId = Number(body.pieceId || 0), tid = Number(body.tenantId || 0);
  if (!pieceId || !tid) return new Response(JSON.stringify({ ok: false, step: "validate" }), { status: 400, headers: { "Content-Type": "application/json" } });
  const t0 = Date.now();
  const r = await generateVideo(tid, pieceId, { resume: body.resume === true, by: "background" });
  console.log(`[generate-video-background] piece=${pieceId} tid=${tid} → ${r.status}${r.stage ? `/${r.stage}` : ""}${r.resumed ? " (이어달리기)" : ""}${r.reason ? ` (${r.reason})` : ""} ${Math.round((Date.now() - t0) / 1000)}s`);
  return new Response(JSON.stringify({ ok: r.ok, status: r.status, stage: r.stage ?? null }), { status: 200, headers: { "Content-Type": "application/json" } });
};
