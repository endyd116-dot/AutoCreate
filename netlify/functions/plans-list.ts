/**
 * GET /api/plans → { ok, plans, trialDays, coins:{ krw, packs, table, labels }, tiers, tierNote }
 *
 *   🔴 **코인 값은 «운영센터가 바꾼 값» 한 벌이다**(사장님 지시 2026-09-21 ·
 *      «모든 화면의 코인값은 변수로 지정해서, 운영센터에서 가격 바꾸면 다 같이 바뀌어서 보일 수 있게»).
 *
 *   여태 이 문은 `lib/coin-table.ts` 의 **코드 기본값**(`COIN_PACKS`·`COIN_TABLE`)을 그대로 내보냈다.
 *   그런데 **차감하는 쪽**(`lib/coin-ledger.ts` → `coinCostOverlay`)은 DB 오버레이(`coin_price_overrides`)를 읽는다.
 *   ⇒ 운영센터가 `/api/ops-coin-prices` 로 단가를 바꾸면 **화면은 옛 값을 보여 주고 새 값으로 차감됐다.**
 *      (라이브 오버레이가 0행이라 **아직 안 갈렸을 뿐** — 한 번이라도 바꾸는 날 갈라진다.)
 *   ⇒ 이제 `loadPacksAndTable()`(오버레이 적용 · 60초 캐시 · 조회 실패 시 코드 기본값) **한 곳**에서 온다.
 */
import { json, jsonError } from "../../lib/response";
import { loadPlans, currentTrialDays } from "../../lib/plans";
import { COIN_KRW, COIN_ITEM_LABEL, COIN_TIER_LIST, COIN_TIER_NOTE, piecesByTier } from "../../lib/coin-table";
import { loadPacksAndTable } from "../../lib/billing/packs";
export const config = { path: "/api/plans" };
export default async (): Promise<Response> => {
  try {
    /* [R10-9] 🔴 요금제 «포함 코인»이 **몇 편**인지 서버가 다시 셈해 내려 준다(Pro 150 → 간단히 150 / 보통 75 / 프리미엄 50). 화면은 셈하지 않는다(AC-74). */
    const plans = (await loadPlans()).filter((p) => p.public).map((p) => ({ ...p, piecesByTier: piecesByTier(Number(p.limits?.coinsIncluded ?? 0)) }));
    const trialDays = await currentTrialDays();
    /* 🔴 오버레이 적용값. 읽기가 실패해도 `loadPacksAndTable` 이 **코드 기본값으로 내려앉는다**(graceful) —
       여기서 또 폴백을 적으면 «두 벌»이 다시 생긴다. */
    const { packs, table } = await loadPacksAndTable();
    return json({ ok: true, plans, trialDays, coins: { krw: COIN_KRW, packs, table, labels: COIN_ITEM_LABEL }, tiers: COIN_TIER_LIST, tierNote: COIN_TIER_NOTE });
  } catch (err) { return jsonError("plans", err); }
};
