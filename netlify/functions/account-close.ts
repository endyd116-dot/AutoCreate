/**
 * 탈퇴 · 되돌리기(계약 P1R7 §3.1 · DESIGN §16). 고객 본인만(원격접속 중 금지 — 돈·계정을 없애는 동작이다).
 *   GET  /api/account-close                 → { ok, closed, closedAt?, purgeAt?, daysLeft?, graceDays }   (설정 화면이 «탈퇴» 줄을 그릴 때)
 *   POST /api/account-close { reason? }     → { ok, closedAt, purgeAt, graceDays } · 400 step:"subscription"(구독 먼저 해지) · 403 보호 계정
 *   POST /api/account-restore               → { ok, status }                        · 400 step:"purged"(이미 파기 — 되돌릴 수 없다)
 *   🔴 탈퇴 = 즉시 readonly(보기만) + 30일 뒤 파기 예약. 실제 파기는 크론 `tenant.purge` 가 한다(여기서 데이터를 지우지 않는다).
 */
import { json, jsonError } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, denyIfImpersonating } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { closeAccount, restoreAccount, closeStateOf, CLOSE_GRACE_DAYS } from "../../lib/account-close";

export const config = { path: ["/api/account-close", "/api/account-restore"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid; const uid = Number(auth.user.uid); const ip = clientIp(req);
  try {
    if (req.method === "GET") {
      if (!path.endsWith("/account-close")) return json({ ok: false, error: "method" }, 405);
      return json({ ok: true, ...(await closeStateOf(tid)) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const imp = denyIfImpersonating(auth.user); if (imp) return json({ ok: false, error: "원격접속 중에는 탈퇴·되돌리기를 할 수 없어요.", step: "impersonation", gated: true }, 403);

    if (path.endsWith("/account-restore")) {
      const r = await restoreAccount(tid, { actorId: uid, ip });
      if (!r.ok) return json({ ok: false, error: r.error, step: r.step }, r.step === "not_found" ? 404 : 400);
      return json({ ok: true, status: r.status, ...(await closeStateOf(tid)) });
    }
    const b = await readJson<{ reason?: unknown }>(req);
    const r = await closeAccount(tid, { reason: typeof b.reason === "string" ? b.reason : undefined, actorId: uid, ip });
    if (!r.ok) return json({ ok: false, error: r.error, step: r.reason }, r.reason === "protected" ? 403 : r.reason === "not_found" ? 404 : 400);
    return json({ ok: true, closedAt: r.closedAt, purgeAt: r.purgeAt, graceDays: CLOSE_GRACE_DAYS, already: r.reason === "already" });
  } catch (err) { return jsonError("account_close", err); }
};
