/**
 * GET /api/referral → { ok, code, invited:[{ tenantName, at, rewarded }], rewardCoins }   (계약 P1R6 §1.1 · 화면 public/app/account.html)
 *   code 는 처음 부를 때 발급(테넌트당 1개 · 8자) · invited = 나를 추천인으로 가입한 테넌트(최신순) · rewardCoins = 지금 활성인 추천 이벤트 값(없으면 0).
 *   원격접속(imp) 세션도 읽기는 된다(코드를 «만드는» 것뿐 · 돈이 걸린 동작이 아니다).
 */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { referralView } from "../../lib/referral";

export const config = { path: "/api/referral" };

export default async (req: Request): Promise<Response> => {
  if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  try {
    const v = await referralView(auth.tid);
    return json({ ok: true, ...v });
  } catch (err) { return jsonError("referral", err); }
};
