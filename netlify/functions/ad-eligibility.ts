/**
 * 수익 매체 신청 조건 API(계약 P1R3 §1.4·§1.4b · DESIGN §9.0):
 *   GET  /api/ad-eligibility → { ok, accounts:[{ accountId, handle, channel, adpost:{state,posts,visitors,ready}, ypp?:{...}, clip?:{open,deadline?} }], thresholds, links }
 *   POST /api/ad-eligibility { action:"applied"|"approved", source:"adpost"|"ypp", accountId } → { ok:true, accounts:[...] }  // 갱신 목록을 그대로 돌려준다(화면 재조회 0)
 *   🔴 thresholds·links 는 `lib/ad-eligibility.ts` 상수 그대로 — 화면은 분모·주소를 갖지 않는다(§1.4b(1)(2)).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { judgeAccounts, claimMediaState, THRESHOLDS, LINKS } from "../../lib/ad-eligibility";

export const config = { path: "/api/ad-eligibility" };
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid;
  try {
    if (req.method === "GET") return json({ ok: true, accounts: await judgeAccounts(tid), thresholds: THRESHOLDS, links: LINKS });
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<{ action?: string; source?: string; accountId?: number }>(req);
    const action = b.action === "applied" || b.action === "approved" ? b.action : null;
    const source = (["adpost", "ypp", "adsense", "clip"] as const).find((x) => x === b.source) ?? null;
    const accountId = n(b.accountId);
    if (!action || !source || !accountId) return badRequest("action(applied|approved)·source(adpost|ypp|adsense|clip)·accountId 가 필요해요.");
    const ok = await claimMediaState(tid, auth.user.uid, source, accountId, action);
    if (!ok) return json({ ok: false, step: "not_found", error: "계정을 찾을 수 없어요." }, 404);
    return json({ ok: true, accounts: await judgeAccounts(tid), thresholds: THRESHOLDS, links: LINKS });
  } catch (err) { return jsonError("ad_eligibility", err); }
};
