import { json, jsonError } from "../../lib/response";
import { loadPlans, currentTrialDays } from "../../lib/plans";
import { COIN_PACKS, COIN_KRW, COIN_TABLE, COIN_ITEM_LABEL } from "../../lib/coin-table";
export const config = { path: "/api/plans" };
export default async (): Promise<Response> => {
  try {
    const plans = (await loadPlans()).filter((p) => p.public);
    const trialDays = await currentTrialDays();
    return json({ ok: true, plans, trialDays, coins: { krw: COIN_KRW, packs: COIN_PACKS, table: COIN_TABLE, labels: COIN_ITEM_LABEL } });
  } catch (err) { return jsonError("plans", err); }
};
