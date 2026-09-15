import { json, jsonError } from "../../lib/response";
import { loadPlans, currentTrialDays } from "../../lib/plans";
import { COIN_PACKS, COIN_KRW, COIN_TABLE, COIN_ITEM_LABEL, COIN_TIER_LIST, COIN_TIER_NOTE, piecesByTier } from "../../lib/coin-table";
export const config = { path: "/api/plans" };
export default async (): Promise<Response> => {
  try {
    /* [R10-9] 🔴 요금제 «포함 코인»이 **몇 편**인지 서버가 다시 셈해 내려 준다(Pro 150 → 간단히 150 / 보통 75 / 프리미엄 50). 화면은 셈하지 않는다(AC-74). */
    const plans = (await loadPlans()).filter((p) => p.public).map((p) => ({ ...p, piecesByTier: piecesByTier(Number(p.limits?.coinsIncluded ?? 0)) }));
    const trialDays = await currentTrialDays();
    return json({ ok: true, plans, trialDays, coins: { krw: COIN_KRW, packs: COIN_PACKS, table: COIN_TABLE, labels: COIN_ITEM_LABEL }, tiers: COIN_TIER_LIST, tierNote: COIN_TIER_NOTE });
  } catch (err) { return jsonError("plans", err); }
};
