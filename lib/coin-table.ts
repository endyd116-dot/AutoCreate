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
