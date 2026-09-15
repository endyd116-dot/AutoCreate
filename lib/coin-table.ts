/**
 * lib/coin-table.ts — 코인 구간표·팩 정본. AM 원본: ../AutoMarketing/lib/coin-ledger.ts §1 (발췌 복사 2026-09-14 · 값 무수정)
 *   🔴 DESIGN §12.1 «코인은 AM과 동일» — 값을 바꾸려면 AM과 같이 바꾼다. 원장 로직(consume·grant·잔액)은 Phase 1에서 coin-ledger.ts로 이식.
 *   AC 추가: pack_trial(체험 소액팩 · Q7 가정) — AM 표엔 없다.
 */
export type CoinItem =
  | "video_60" | "video_30" | "video_15" | "video_clip" | "cardnews" | "blog" | "sns" | "landing"
  | "image" | "persona" | "image_regen" | "video_pro" | "managed_extra" | "hero_ad"
  /* [P1R7 §3.6] «계정 1개 + 전용 IP» 30일권 — 🔴 값이 **여기 없다**(표는 생성 1건 원가 · 이건 월 대여료다).
     가격 정본은 `lib/plans.ts ACCOUNT_SLOT_PRODUCTS`(원가 근거 proxy-cost.md) → `consume(…, { cost })` 로 그때 값을 넘긴다. */
  | "account_slot" | "account_slot_managed";

export const COIN_TABLE: Record<CoinItem, number> = {
  image: 1, sns: 1, blog: 1, cardnews: 3, landing: 4, video_clip: 2, video_15: 6, video_30: 12, video_60: 28,
  persona: 15, image_regen: 1, video_pro: 100, managed_extra: 30, hero_ad: 1,
  account_slot: 0, account_slot_managed: 0,   // 0 = «표에 값 없음» — 호출부가 lib/plans.ts 값을 넘긴다(두 벌 금지)
};
export const COIN_ITEM_LABEL: Record<CoinItem, string> = {
  video_60: "숏폼 영상 60초", video_30: "숏폼 영상 30초", video_15: "짧은 영상 15초", video_clip: "짧은 클립 2~5초",
  cardnews: "카드뉴스 세트", blog: "블로그 글 1건", sns: "SNS 글 1건", landing: "랜딩 1종", image: "이미지 1장",
  persona: "새 페르소나·전략", image_regen: "이미지 재생성 1장", video_pro: "전문가 영상(외주 제작)",
  managed_extra: "매니징 초과 요청 처리", hero_ad: "랜딩 히어로 광고판",
  account_slot: "계정 1개 + 전용 IP(30일)", account_slot_managed: "관리형 계정 1개(30일)",
};
/** 1코인 = ₩500 (AM 사장님 확정). */
export const COIN_KRW = 500;
export const COIN_PACKS = [
  { id: "pack_trial", krw: 5_000, coins: 10, bonusPct: 0, oncePerTenant: true },   // AC 전용(Q7)
  { id: "pack_50k", krw: 50_000, coins: 100, bonusPct: 0, oncePerTenant: false },
  { id: "pack_100k", krw: 100_000, coins: 220, bonusPct: 10, oncePerTenant: false },
  { id: "pack_300k", krw: 300_000, coins: 720, bonusPct: 20, oncePerTenant: false },
] as const;
export type CoinPackId = typeof COIN_PACKS[number]["id"];
export const PURCHASE_VALID_DAYS = 365;
export function coinCostOf(item: CoinItem): number { return COIN_TABLE[item] ?? 0; }

/**
 * videoCoinItem — 영상 길이 → 구간(AM 원본 ../AutoMarketing/lib/coin-ledger.ts §1 videoCoinItem · 복사 2026-09-15 · «초 단위 산식 금지·구간제»).
 *   ~5초 = video_clip · ~15초 = video_15 · ~35초 = video_30 · 그보다 길면 video_60(SHORTSBILL — 60초 편이 30초 요금으로 팔리던 손해의 수리).
 */
export function videoCoinItem(seconds: number | null | undefined): CoinItem {
  const s = Number(seconds) || 0;
  if (s <= 5) return "video_clip";
  if (s <= 15) return "video_15";
  if (s <= 35) return "video_30";
  return "video_60";
}

/**
 * [R8 · 🔴 사장님 승인 2026-09-15 «좋다. 시작해»] **AI_IMAGES_INCLUDED — 글 한 편에 AI 사진 1장이 포함된다.**
 *   왜 이 값이 생겼나: 네이버 글 한 편이 **7코인(₩3,500)** 이었다. 요금제 포함 코인으로는 Pro 가 월 21편이라
 *   설계가 말하는 «하루 3편(월 90편)» 의 1/4 이었다 — 표가 약속한 것과 실제가 4.5배 어긋났다(docs/active/2026-09-15-coin-economy.md §3b).
 *   🔴 값을 내릴 수 있게 된 근거는 **원가가 실제로 내려갔다**는 것이다: 사진을 «내 사진 → 스톡 → AI» 순서로 채우면서
 *      네이버 편당 원가가 ₩458 → ₩134 가 됐다(B-1). 원가 없이 값만 내리면 그건 그냥 손해다.
 *   🔴 **고객 사진·스톡 사진은 0코인**이다 — 우리 원가가 0이기 때문이다. 코인은 «우리가 돈 쓴 곳»에만 붙는다.
 */
export const AI_IMAGES_INCLUDED = 1;

/**
 * [R8] pieceCoinCost — **한 편에 드는 코인**. 🔴 이 식이 사는 곳은 여기 하나다.
 *   전에는 `lib/slots.ts coinsPerWeek` 와 `lib/cron/director-auto.ts pieceCoin` 이 **각자 적고 있었다** —
 *   둘이 갈리면 «견적»과 «실제 차감»이 달라진다(고객이 가장 못 참는 종류의 어긋남 · AC-74).
 *
 *   · 글    = `blog`(1) + `image`(1) × **AI 로 구울 장수에서 포함분(1장)을 뺀 수**
 *   · 카드뉴스 = `cardnews`(3) — 🔴 인스타는 장수로 세지 않는다. 화면(`/app/coins`)이 이미 «카드뉴스 3코인»이라 말하고 있어서
 *              장수로 세면 7~9코인이 빠진다(화면이 말한 값의 두세 배 · AC-74).
 *   · 영상   = 길이 구간(`videoCoinItem`)
 *   🔴 이 파일은 DB·계약표를 보지 않는다(순수 유지 · AC-17) — 장수·구성은 **호출부가 준다.**
 */
export function pieceCoinCost(kind: string, aiImageCount: number, opts: { seconds?: number; format?: string } = {}): number {
  /* 🔴 [2026-09-16] `?? 60` 은 **«모르면 60»이 아니라 «안 고르면 60»**이다 — `writing-contracts.videoSecondsFor` 가
     안 고른 고객에게 실제로 만들어 주는 길이와 **같은 값**이라 견적과 실물이 갈리지 않는다.
     🔴 그래도 **부르는 쪽이 넘겨야 한다.** 채널 상한(클립 채널 30초)과 고객이 고른 길이는 여기서 알 수 없다 —
        편성표가 이걸 안 넘겨서 15초짜리에 60초 값(28코인)을 적던 자리가 있었다. 견적 자리는 `estimateVideoSeconds` 를 쓴다. */
  if (kind === "shorts" || kind === "video") return coinCostOf(videoCoinItem(opts.seconds ?? 60));
  if (opts.format === "cardnews") return coinCostOf("cardnews");
  const ai = Math.max(0, Math.floor(Number(aiImageCount) || 0));
  return coinCostOf("blog") + coinCostOf("image") * Math.max(0, ai - AI_IMAGES_INCLUDED);
}

