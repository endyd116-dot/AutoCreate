/**
 * lib/cron/stock-cache-sweep.ts — 스톡 제공사 응답 캐시에서 **만료된 행만** 치운다(계약 P1R8 §10 · `lib/stock/cache.ts`).
 *
 *   🔴 왜 스텝이 필요한가: `stock_cache` 는 약관이 요구한 **24시간 보관**이라 하루치가 계속 쌓인다.
 *      치우는 자리가 없으면 표가 한없이 자라고, 상한 세기(«최근 창 안 행 수»)를 세는 질의가 점점 느려진다.
 *      🔴 **만료 전 행은 절대 지우지 않는다** — 지우면 24시간 캐시 약속이 깨지고 제공사를 다시 부르게 된다(그게 약관 위반이다).
 *
 *   🔴 **global 스텝**이다(테넌트 루프 밖). 이 표에는 `tenant_id` 가 없다 —
 *      담기는 것이 **제공사의 공개 검색 결과**이지 고객의 것이 아니기 때문이다(DDL 0028 헤더에 근거).
 *      테넌트 스텝으로 만들면 집 수만큼 같은 일을 하고, 집이 0곳이면 영영 안 돈다.
 *
 *   🔎 출처: AC 신규(계약 P1R8 §10 · B-1 · 2026-09-15) — AM 원본 없음.
 */
import { sweepStockCache } from "../stock/cache";
import type { GlobalStep, StepOutcome } from "./base";

/** 한 번에 치우는 상한 — 한 틱이 길어지지 않게. 남으면 다음 시간에 계속 치운다(밀려도 하루면 따라잡는다). */
const SWEEP_LIMIT = 5000;

export const stockCacheSweepStep: GlobalStep = {
  key: "stock.cache_sweep",
  every: "hourly",
  scope: "global",
  async run(): Promise<StepOutcome> {
    const removed = await sweepStockCache(SWEEP_LIMIT);
    /* 0건이 정상이다(만료된 것이 없다) — «안 돌았다»와 구분되게 detail 은 지운 게 있을 때만 남긴다. */
    return removed ? { changed: removed, skipped: 0, detail: { expiredRemoved: removed } } : { changed: 0, skipped: 0 };
  },
};
