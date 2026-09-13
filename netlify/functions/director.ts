/**
 * 디렉터 API(계약 P1R1 §3 v1.1):
 *   POST /api/director-propose { topicId }                → { brief:Brief }
 *   POST /api/director-confirm { briefId, pieces?:[PieceSpecPatch] } → 202 { briefId, pieceIds, coinsCharged, coinsLeft }   // 생성은 배경 함수 · 화면은 pieces-list 폴링
 *     ✗ 코인 부족 → { ok:false, step:"coin_short", error, need, have }
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { propose, confirm, type PieceSpecPatch } from "../../lib/director";

export const config = { path: ["/api/director-propose", "/api/director-confirm"] };
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = new URL(req.url).pathname;
  try {
    if (path.endsWith("/director-propose")) {
      const b = await readJson<{ topicId?: number }>(req);
      const topicId = n(b.topicId); if (!topicId) return badRequest("topicId");
      const r = await propose(tid, topicId);
      if (!r.ok) return json(r, r.step === "not_found" ? 404 : 400);
      await writeAudit({ tenantId: tid, action: "director_propose", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `brief:${r.brief.id}`, detail: { topicId, pieces: r.brief.pieces.length, coinCost: r.brief.coinCost } });
      return json({ ok: true, brief: r.brief });
    }
    if (path.endsWith("/director-confirm")) {
      const b = await readJson<{ briefId?: number; pieces?: PieceSpecPatch[] }>(req);
      const briefId = n(b.briefId); if (!briefId) return badRequest("briefId");
      const r = await confirm(tid, briefId, Array.isArray(b.pieces) ? b.pieces : [], auth.user.uid);
      if (!r.ok) return json(r, r.step === "coin_short" ? 402 : r.step === "not_found" ? 404 : 400);
      await writeAudit({ tenantId: tid, action: "director_confirm", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `brief:${briefId}`, detail: { pieceIds: r.pieceIds, coinsCharged: r.coinsCharged } });
      return json(r, 202);
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("director", err); }
};
