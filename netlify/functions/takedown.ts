/**
 * 고객 쪽 — 내 글에 들어온 신고(DESIGN §5E.2 ③⑤ · 계약 R8).
 *   GET  /api/takedowns → { ok, notices:[{ id, status, kind, kindLabel, reason, dueAt, daysLeft, externalUrl?, canRetract, retractAvailable }] }
 *   POST /api/takedown-action { id, action:"removed"|"retract" } → «직접 내렸어요» | «대신 내려 주세요»
 *   🔴 내리는 데 **코인 0**(우리 잘못이든 고객 마음이든).
 *   🔴 «대신 내려 주기» 길이 없는 채널이면 정직하게 «직접 내려 주세요» + 그 글 링크를 돌려준다 — **없는 길을 단추로 만들지 않는다**(DESIGN §5E.3).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { listNotices, markCustomerRemoved, requestRetract } from "../../lib/takedown";

export const config = { path: ["/api/takedowns", "/api/takedown-action"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid; const uid = Number(auth.user.uid);
  try {
    if (path.endsWith("/takedowns")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      return json({ ok: true, notices: await listNotices(tid) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<{ id?: unknown; action?: unknown }>(req);
    const id = Number(b.id || 0); if (!id) return badRequest("id");
    const action = String(b.action ?? "");
    if (action === "removed") {
      const r = await markCustomerRemoved(tid, id, uid);
      if (!r.ok) return json({ ok: false, error: r.error, step: "not_found" }, 404);
      return json({ ok: true, status: r.status, verifying: r.verifying === true,
        message: r.verifying ? "확인해 볼게요 — 잠시 뒤 결과를 알려 드려요." : "알려 주셔서 고마워요. 운영팀이 확인할게요." });
    }
    if (action === "retract") {
      const r = await requestRetract(tid, id, uid);
      if (!r.ok) return json({ ok: false, error: r.error, step: r.step ?? "retract", ...(r.url ? { url: r.url } : {}) }, 400);
      return json({ ok: true, queued: true, message: "대신 내려 드릴게요. 내려간 뒤 정말 없는지 확인까지 하고 알려 드려요." });
    }
    return badRequest("action 은 removed 또는 retract 예요.", "action");
  } catch (err) { return jsonError("takedown", err); }
};
