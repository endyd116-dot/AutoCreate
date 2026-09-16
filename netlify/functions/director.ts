/**
 * 디렉터 API(계약 P1R1 §3 v1.1):
 *   POST /api/director-propose { topicId }                → { brief:Brief }
 *   POST /api/director-confirm { briefId, pieces?:[PieceSpecPatch] } → 202 { briefId, pieceIds, coinsCharged, coinsLeft, usedTodaySlot? }   // 생성은 배경 함수 · 화면은 pieces-list 폴링
 *   POST /api/director-estimate { briefId, pieces?:[PieceSpecPatch] } → { coinCost, coinsLeft, enough, need, pieces:[{key,channel,kind,coinCost,imageCount,aiCount}] }
 *     🔴 **누르기 전에 몇 코인인지.** 아무것도 쓰지 않는다 · confirm 과 같은 `applyPatches` 를 타서 견적과 실제가 갈릴 수 없다.
 *     [R7 §1.6] `usedTodaySlot:{ slotId, channel, publishAt, prevStatus }` = 오늘 이미 잡혀 있던 편성 자리에 넣었다(새 자리를 만들지 않았다) → 화면 «오늘 자리에 넣었어요».
 *     ✗ 코인 부족 → { ok:false, step:"coin_short", error, need, have }
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, requireWritable } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { clientIp } from "../../lib/auth";
import { propose, confirm, estimate, type PieceSpecPatch } from "../../lib/director";
import { requireFeature } from "../../lib/plans";

export const config = { path: ["/api/director-propose", "/api/director-confirm", "/api/director-estimate"] };
/** netlify dev 는 함수가 404 를 내면 같은 경로에 `.html`·`.htm`·`/index.html` 을 붙여 다시 부른다(마지막 시도의 응답이 클라이언트에 간다)(정적 폴백) — 그 재시도가 경로 매칭에서 빠지면 엉뚱한 405 가 보인다. 꼬리를 떼고 맞춘다. */
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  const path = routeOf(req);
  try {
    if (path.endsWith("/director-propose")) {
      const b = await readJson<{ topicId?: number }>(req);
      const topicId = n(b.topicId); if (!topicId) return badRequest("topicId");
      const r = await propose(tid, topicId, { origin: "manual" });   // [R7 §1.2] 사람이 «만들기»를 누른 경로 — 계정 없이도 영상을 낼 수 있다
      if (!r.ok) return json(r, r.step === "not_found" ? 404 : 400);
      await writeAudit({ tenantId: tid, action: "director_propose", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `brief:${r.brief.id}`, detail: { topicId, pieces: r.brief.pieces.length, coinCost: r.brief.coinCost } });
      return json({ ok: true, brief: r.brief });
    }
    if (path.endsWith("/director-estimate")) {
      const b = await readJson<{ briefId?: unknown; pieces?: unknown }>(req);
      const briefId = Number(b.briefId || 0); if (!briefId) return badRequest("briefId");
      const r = await estimate(tid, briefId, Array.isArray(b.pieces) ? (b.pieces as PieceSpecPatch[]) : []);
      return r.ok ? json(r) : json(r, r.step === "not_found" ? 404 : 400);
    }
    if (path.endsWith("/director-confirm")) {
      const w = await requireWritable(tid); if (!w.ok) return w.res;   // 체험 종료(readonly)·정지(suspended)면 생성 금지(P1R4 §1.3)
      const b = await readJson<{ briefId?: number; pieces?: PieceSpecPatch[] }>(req);
      const briefId = n(b.briefId); if (!briefId) return badRequest("briefId");
      // ★C(P1R4) fix: 손보기(pieces 패치) 는 directorEdit 기능(Starter 는 없음 · 계약 §1.4). requireFeature 는 있었지만 아무도 안 불렀다 — 코인 검사보다 먼저 잰다(Starter 가 «코인 부족»을 보면 안 된다).
      if (Array.isArray(b.pieces) && b.pieces.length) { const f = await requireFeature(tid, "directorEdit"); if (!f.ok) return f.res; }
      // 🔴 `origin:"manual"` 을 **명시**한다 — confirm 의 기본값은 fail-closed 로 "auto" 이고, auto 는 편성 슬롯 없이는 거부된다(CLAUDE §4.7 · AC-2).
      //    사람이 «이대로 만들기»를 누른 경로이므로 편성표의 통제 대상이 아니다(사람이 곧 편성자다).
      const r = await confirm(tid, briefId, Array.isArray(b.pieces) ? b.pieces : [], auth.user.uid, { origin: "manual" });
      if (!r.ok) return json(r, r.step === "coin_short" ? 402 : r.step === "not_found" ? 404 : 400);
      await writeAudit({ tenantId: tid, action: "director_confirm", actorType: "user", actorId: auth.user.uid, ip: clientIp(req), target: `brief:${briefId}`, detail: { pieceIds: r.pieceIds, coinsCharged: r.coinsCharged, ...(r.usedTodaySlot ? { usedTodaySlot: r.usedTodaySlot } : {}) } });
      return json(r, 202);
    }
    return json({ ok: false, error: "not_found" }, 404);
  } catch (err) { return jsonError("director", err); }
};
