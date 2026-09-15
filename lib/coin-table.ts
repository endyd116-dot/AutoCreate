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
  | "account_slot" | "account_slot_managed"
  /* [R10-7 · 사장님 2026-09-16] 🔴 **글 등급 셋** — 간단히 1 · 보통 2 · 프리미엄 3(상한 3). 디렉터는 글 한 편에 이 항목 **한 행**만 차감한다(사진 항목을 따로 안 센다).
     `blog`(1)·`image`(1)은 옛 글(등급 전)의 원장 행과 카드뉴스 재차감이 아직 부르므로 남긴다. */
  | "post_simple" | "post_standard" | "post_premium";

export const COIN_TABLE: Record<CoinItem, number> = {
  image: 1, sns: 1, blog: 1, cardnews: 3, landing: 4, video_clip: 2, video_15: 6, video_30: 12, video_60: 28,
  persona: 15, image_regen: 1, video_pro: 100, managed_extra: 30, hero_ad: 1,
  account_slot: 0, account_slot_managed: 0,   // 0 = «표에 값 없음» — 호출부가 lib/plans.ts 값을 넘긴다(두 벌 금지)
  post_simple: 1, post_standard: 2, post_premium: 3,   // [R10-7] 등급 코인 — `COIN_TIERS[k].coins` 는 여기서 파생한다(값 두 벌 금지)
};
export const COIN_ITEM_LABEL: Record<CoinItem, string> = {
  video_60: "숏폼 영상 60초", video_30: "숏폼 영상 30초", video_15: "짧은 영상 15초", video_clip: "짧은 클립 2~5초",
  cardnews: "카드뉴스 세트", blog: "블로그 글 1건", sns: "SNS 글 1건", landing: "랜딩 1종", image: "이미지 1장",
  persona: "새 페르소나·전략", image_regen: "이미지 재생성 1장", video_pro: "전문가 영상(외주 제작)",
  managed_extra: "매니징 초과 요청 처리", hero_ad: "랜딩 히어로 광고판",
  account_slot: "계정 1개 + 전용 IP(30일)", account_slot_managed: "관리형 계정 1개(30일)",
  post_simple: "글 1편(간단히)", post_standard: "글 1편(보통)", post_premium: "글 1편(프리미엄)",
};

/* ═══ [R10-7·8·9 · 사장님 2026-09-16 «글 1개에 6코인 7코인 지불할 사람은 없다 — 최소/중간/최상 퀄리티로 값을 매기자»] ═══
 *   🔴 **등급 셋 · 식은 `pieceCoinCost` 한 곳.** 화면 말은 «간단히 · 보통 · 프리미엄»(«최소»라는 말은 쓰지 않는다 — 고른 고객이 «내 글은 최소구나» 한다).
 *   | 등급 | AI 사진 | 코인 | 분량(쯤) | 구성 | 검색 최적화 |
 *   | 간단히 | 1장 | 1 | 1,000자 | 소제목 | 기본 |
 *   | 보통 | 2~3장 | 2 | 1,500자 | +목록·표 | 기본 |
 *   | 프리미엄 | 4~5장 | 3 | 2,000자+ | +FAQ·체크리스트 | 구조화 데이터(HTML 채널) |
 *   · 🔴 **내 사진·스톡은 코인을 안 늘린다** · 🔴 **AI 사진 0장이어도 1코인**(글 한 편 AI 값 약 68원) · 🔴 **AI 를 덜 구우면 덜 받고 돌려준다**(`settlePieceCoins` · 프리미엄을 골라도 내 사진으로 다 채워 AI 0장이면 1코인)
 *   · 🔴 «고르는 자리»를 갈라 놓지 않는다 — 2026-09-15 카드뉴스가 1코인으로 샌 사고가 그것이다(`coinFormatOf` 가 그 수리). 등급도 **이 표 한 곳**에서 갈린다.
 *   · 🔴 AC-93: 등급을 **모르면 제일 싼 값**(간단히)으로만 틀린다 — 모르는 것으로 돈을 물릴 땐 모자라게 받는 쪽으로.
 *   · 🟢 글을 늘리는 값은 거의 공짜다(글 한 편 AI 값 68원 · 사진 한 장 64원) — 프리미엄에 글을 두 배 얹어도 마진이 거의 안 준다(트리거 B-10).
 *   읽는 곳: director(propose·applyPatches·confirm) · director-auto · slots(coinsPerWeek·slots-list) · pieces(regen) · content-gen(구조·분량·정산) · accounts-list(`tiers`) · plans-list(`piecesByTier`). */
export type CoinTier = "simple" | "standard" | "premium";
export const COIN_TIER_KEYS: readonly CoinTier[] = ["simple", "standard", "premium"];
/** 🔴 등급을 안 고른 계정의 기본 — **오늘까지의 글(AI 1장 · 1코인)과 같은 값**이라 «기본값»이지 «날조»가 아니다(AC-93: 그대로 실행되는 값). */
export const DEFAULT_COIN_TIER: CoinTier = "simple";
export interface CoinTierDef { key: CoinTier; label: string; coins: number; aiImages: [number, number]; chars: number; say: string }
export const COIN_TIERS: Record<CoinTier, CoinTierDef> = {
  simple:   { key: "simple",   label: "간단히",   coins: COIN_TABLE.post_simple,   aiImages: [1, 1], chars: 1000, say: "AI가 사진 1장 · 핵심만 1,000자쯤" },
  standard: { key: "standard", label: "보통",     coins: COIN_TABLE.post_standard, aiImages: [2, 3], chars: 1500, say: "AI가 사진 2~3장 · 목록·표까지 1,500자쯤" },
  premium:  { key: "premium",  label: "프리미엄", coins: COIN_TABLE.post_premium,  aiImages: [4, 5], chars: 2000, say: "AI가 사진 4~5장 · 자주 묻는 질문까지 2,000자쯤" },
};
/** 화면에 내려보내는 배열 꼴(accounts-list.tiers · plans-list.tiers — A 합의 모양 그대로). */
export const COIN_TIER_LIST: readonly CoinTierDef[] = COIN_TIER_KEYS.map((k) => COIN_TIERS[k]);
/** 사장님 문장 — 화면이 그대로 그린다(정본 한 곳). */
export const COIN_TIER_NOTE = "내 사진을 올리면 AI 사진을 대신하거나 더 얹어요 — 코인은 안 늘어요";
/** 느슨한 값 → 등급. 🔴 모르는 값은 **null**(기본값으로 위장하지 않는다 · 호출부가 `?? DEFAULT_COIN_TIER` 로 «안 고름»을 명시한다). */
export function toCoinTier(v: unknown): CoinTier | null {
  const s = String(v ?? "").trim().toLowerCase();
  return (COIN_TIER_KEYS as readonly string[]).includes(s) ? (s as CoinTier) : null;
}
/** AI 사진 장수 → 코인(상한 3). 0~1장 = 1 · 2~3장 = 2 · 4장~ = 3. 🔴 이 함수가 «덜 구우면 덜 받는다»의 식이다. */
export function coinsForAiImages(aiImageCount: number): 1 | 2 | 3 {
  const ai = Math.max(0, Math.floor(Number(aiImageCount) || 0));
  return ai <= 1 ? 1 : ai <= 3 ? 2 : 3;
}
/** AI 장수가 실제로 떨어지는 등급(정산·재차감이 «무엇을 물렸나»를 적을 때). */
export function tierForAiImages(aiImageCount: number): CoinTier {
  const c = coinsForAiImages(aiImageCount);
  return c === 1 ? "simple" : c === 2 ? "standard" : "premium";
}
/** 코인 수 → 차감 항목(원장 `item` · 화면 «최근 사용»에 «글 1편(보통)»으로 보인다). */
export function postItemForCoins(coins: number): CoinItem {
  return coins >= 3 ? "post_premium" : coins === 2 ? "post_standard" : "post_simple";
}
/**
 * 이 등급이 계획하는 AI 장수 — 등급 상한(1/3/5)을 **글의 사진 자리 수 안에서**. 자리가 모자라면 자리만큼(쓰레드처럼 사진 1장 채널에서 프리미엄은 AI 1장 = 1코인).
 *   🔴 «AI 사진 4~5장»을 팔았으면 AI 로 굽는다(스톡보다 먼저 · `content-gen` 이 이 수만큼 AI 자리를 잡는다). 내 사진이 자리를 먹으면 그만큼 덜 굽고 돌려준다.
 */
export function plannedAiFor(tier: CoinTier, imageCount: number): number {
  return Math.max(0, Math.min(COIN_TIERS[tier].aiImages[1], Math.floor(Number(imageCount) || 0)));
}
/** 글 한 편이 **적어도** 가져야 할 사진 자리 — 등급이 굽겠다는 AI 장수만큼은 자리가 있어야 한다(계약 상한 안에서 · 호출부가 clamp). */
export function imageSlotsForTier(tier: CoinTier, contractDefault: number): number {
  return Math.max(Math.floor(Number(contractDefault) || 0), COIN_TIERS[tier].aiImages[1]);
}
/** 요금제 포함 코인 → 등급별 «몇 편»(Pro 150 → 간단히 150 / 보통 75 / 프리미엄 50). 화면은 셈하지 않는다(AC-74). */
export function piecesByTier(coinsIncluded: number): Record<CoinTier, number> {
  const c = Math.max(0, Math.floor(Number(coinsIncluded) || 0));
  return { simple: Math.floor(c / COIN_TIERS.simple.coins), standard: Math.floor(c / COIN_TIERS.standard.coins), premium: Math.floor(c / COIN_TIERS.premium.coins) };
}
/**
 * 정산 문장 — 🔴 «덜 받고 돌려준 경우»를 **말해 준다**(조용히 돌려주면 고객이 모른다 · A-5). 정본 한 곳.
 *   예) «프리미엄으로 만들었는데 내 사진으로 채워서 1코인만 받았어요 — 2코인은 돌려드렸어요.»
 */
export function tierCoinsLine(a: { tier: CoinTier; planned: number; charged: number; returned: number; actualAi: number; customerPhotos?: number; stockPhotos?: number }): string {
  const t = COIN_TIERS[a.tier];
  if (a.returned > 0) {
    const why = (a.customerPhotos ?? 0) > 0 ? "내 사진으로 채워서" : (a.stockPhotos ?? 0) > 0 ? "무료 사진으로 채워져서" : `AI 사진을 ${a.actualAi}장만 구워서`;
    return `${t.label}(으)로 만들었는데 ${why} ${a.charged}코인만 받았어요 — ${a.returned}코인은 돌려드렸어요.`;
  }
  return `${t.label} · ${a.charged}코인 (AI 사진 ${a.actualAi}장)`;
}
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
 *   · 글    = [R10-7] **min(등급 코인, AI 장수별 값)** — 간단히 1 · 보통 2 · 프리미엄 3(`COIN_TIERS`). 옛 식 `blog + image×(ai−1)` 은 2026-09-16 에 내렸다.
 *   · 카드뉴스 = `cardnews`(3) — 🔴 인스타는 장수로 세지 않는다. 화면(`/app/coins`)이 이미 «카드뉴스 3코인»이라 말하고 있어서
 *              장수로 세면 7~9코인이 빠진다(화면이 말한 값의 두세 배 · AC-74).
 *   · 영상   = 길이 구간(`videoCoinItem`)
 *   🔴 이 파일은 DB·계약표를 보지 않는다(순수 유지 · AC-17) — 장수·구성은 **호출부가 준다.**
 */
export function pieceCoinCost(kind: string, aiImageCount: number, opts: { seconds?: number; format?: string; tier?: CoinTier | null } = {}): number {
  /* 🔴 [2026-09-16] `?? 60` 은 **«모르면 60»이 아니라 «안 고르면 60»**이다 — `writing-contracts.videoSecondsFor` 가
     안 고른 고객에게 실제로 만들어 주는 길이와 **같은 값**이라 견적과 실물이 갈리지 않는다.
     🔴 그래도 **부르는 쪽이 넘겨야 한다.** 채널 상한(클립 채널 30초)과 고객이 고른 길이는 여기서 알 수 없다 —
        편성표가 이걸 안 넘겨서 15초짜리에 60초 값(28코인)을 적던 자리가 있었다. 견적 자리는 `estimateVideoSeconds` 를 쓴다. */
  if (kind === "shorts" || kind === "video") return coinCostOf(videoCoinItem(opts.seconds ?? 60));
  if (opts.format === "cardnews") return coinCostOf("cardnews");
  /* [R10-7] 🔴 글 = min(등급 코인, AI 장수별 값). 등급은 **상한**이고 AI 장수가 **실제 값**이다 —
     그래서 «프리미엄(3)을 골랐는데 AI 0장 → 1», «간단히를 골랐는데 대표 사진 때문에 AI 2장 → 1(더 받지 않는다)» 둘 다 이 한 식에서 나온다.
     🔴 등급을 모르면(옛 글 · 안 넘긴 호출) 상한이 **simple(1)** 이다 — 모르는 것으로 돈을 물릴 땐 모자라게 받는 쪽으로만(AC-93).
        옛 식 `blog + image×(ai−1)` 은 AI 5장에 5코인이었다(사장님: «6코인 7코인 지불할 사람은 없다»). */
  const ai = Math.max(0, Math.floor(Number(aiImageCount) || 0));
  const cap = COIN_TIERS[opts.tier ?? DEFAULT_COIN_TIER].coins;
  return Math.min(cap, coinsForAiImages(ai));
}

