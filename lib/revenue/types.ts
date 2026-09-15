/**
 * lib/revenue/types.ts — 수익 커넥터 공통 타입(계약 P1R3 §1.1 · 글자 그대로). DESIGN §9.1·§9.2.
 *   소스별 파일(adsense·youtube·coupang·aliexpress·linkprice)은 이 인터페이스만 구현한다.
 *   🔴 이 파일은 아무것도 import 하지 않는다(순환 0 · AC-17). 러너 report(B2)도 이 타입으로 행을 실어 보낸다.
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */

/**
 * 소스 어휘(계약 §1.4b(4) 최종). 화면·집계·enum 검사가 전부 이 목록을 본다.
 *
 * [P1R8 §3.4] 🔴 **텐핑·애드픽·쇼핑커넥트를 더했다 — 그런데 «커넥터»가 아니라 «이름»을 준 것이다.** 이유를 적어 둔다:
 *   셋 다 **공개 API 가 없다**(링크프라이스와 다른 점이다 — 그쪽은 API 가 있어서 커넥터가 있다).
 *   그래서 자동 회수는 ①러너 스크랩 ②수동 입력 둘 중 하나인데, **우리는 세 곳의 화면을 한 번도 열어 본 적이 없다.**
 *   본 적 없는 화면에 스크랩 셀렉터를 박는 것이 이 프로젝트에서 제일 비싼 실수였다(AC-42·AC-43 · 티스토리 이틀).
 *   ⇒ 지금 정직한 상태는 **수동**이고, 그래도 **이름을 갖는 것만으로 값이 크다**:
 *      종전에는 텐핑 수익을 넣으면 «그 외»로 뭉개져 **어디서 번 돈인지 화면이 말하지 못했다.**
 *      이제 소스별 집계·내보내기·홈의 «오늘 번 돈»이 세 매체를 **따로** 센다.
 *   🔴 나중에 스크랩·API 가 생기면 **`FRESHNESS_OF` 한 줄만** 바꾸면 된다(어휘를 다시 안 만든다).
 */
export const REVENUE_SOURCES = ["adsense", "youtube", "coupang", "aliexpress", "linkprice", "adpost", "adfit", "clip", "tenping", "adpick", "shopping_connect", "meta", "tiktok", "x", "sponsor", "manual"] as const;
export type RevenueSource = typeof REVENUE_SOURCES[number];
export function isRevenueSource(v: unknown): v is RevenueSource { return typeof v === "string" && (REVENUE_SOURCES as readonly string[]).includes(v); }

/** 수집 방식 = 신선도 배지의 근거(§0). */
export type Freshness = "api" | "runner" | "manual";
/** 소스마다 어떤 손이 가져오나(정본 한 곳 — 화면 배지·스텝 분기가 같은 표를 본다). */
export const FRESHNESS_OF: Readonly<Record<RevenueSource, Freshness>> = {
  adsense: "api", youtube: "api", coupang: "api", aliexpress: "api", linkprice: "api",
  adpost: "runner", adfit: "runner", clip: "runner",
  /* [P1R8 §3.4] 공개 API 없음 · 화면 미실측 → 지금은 수동. 길이 생기면 **이 줄만** 바꾼다(위 어휘 주석). */
  tenping: "manual", adpick: "manual", shopping_connect: "manual",
  meta: "manual", tiktok: "manual", x: "manual", sponsor: "manual", manual: "manual",
};

/**
 * 🔴 **수동으로 넣을 수 있는 소스와 그 이름** — 서버가 정본이다(AC-52·AC-74 «화면이 낱말도 숫자도 갖지 않는다»).
 *   종전에는 목록이 **세 곳**에 손으로 적혀 있었다: `netlify/functions/revenue.ts MANUAL_SOURCES`(받는 쪽) ·
 *   `public/app/revenue.html MSRC`(고르는 쪽) · 그리고 이 표. 셋이 갈리면 **화면에는 있는데 서버가 400** 이 된다.
 *   ⇒ 목록은 `FRESHNESS_OF` 에서 **파생**하고, 이름만 여기 적는다.
 */
export const MANUAL_SOURCE_LABEL: Readonly<Partial<Record<RevenueSource, string>>> = {
  sponsor: "협찬·광고비",
  tenping: "텐핑",
  adpick: "애드픽",
  shopping_connect: "네이버 쇼핑커넥트",
  meta: "메타",
  tiktok: "틱톡",
  x: "엑스",
  manual: "그 외",
};
/** 수동 입력을 받는 소스 집합 — 🔴 손으로 적지 않는다(`FRESHNESS_OF` 가 «manual» 이라고 말한 것들). */
export const MANUAL_SOURCES: ReadonlySet<RevenueSource> =
  new Set(REVENUE_SOURCES.filter((s) => FRESHNESS_OF[s] === "manual"));
/** 화면이 그대로 그리는 «어디서 받았나요» 목록(순서 = 위 라벨 표 순서). */
export const MANUAL_SOURCE_CHOICES: readonly { key: RevenueSource; label: string }[] =
  (Object.keys(MANUAL_SOURCE_LABEL) as RevenueSource[])
    .filter((k) => MANUAL_SOURCES.has(k))
    .map((k) => ({ key: k, label: MANUAL_SOURCE_LABEL[k] as string }));
/**
 * «오늘 확정» 소스(DESIGN §9.3 · 계약 §1.4 v3.2): 오늘 날짜에 대해 하루치를 확정으로 주는 소스.
 *   나머지(adpost·adfit·clip·youtube)는 부분 수집 = «예상». 홈의 큰 숫자가 이 표로 갈라진다 — 합쳐서 한 숫자로 내리지 않는다.
 */
export const CONFIRMED_SOURCES: ReadonlySet<RevenueSource> = new Set(["adsense", "coupang", "aliexpress", "linkprice", "tenping", "adpick", "shopping_connect", "meta", "tiktok", "x", "sponsor", "manual"]);

/**
 * [P1R7 B3 · DESIGN §13.5 «외부 값»] **그 매체의 «집계일»이 KST 인가.**
 *   우리는 매체가 준 날짜 문자열을 그대로 `revenue_daily.day` 에 넣는다 — 🔴 **옮기지 않는다**(시차만큼 밀어 버리면 매체 리포트와 숫자가 안 맞아
 *   «우리 화면이 틀렸다»가 된다). 대신 **기준이 다르면 화면이 그 사실을 한 줄로 밝힌다**(«애드센스 기준일»).
 *   값: `kst` = 한국 날짜 그대로 · `pt` = 미국 태평양(구글 계열 리포트 관례 · 계정 설정에 따라 다를 수 있다) · `provider` = 매체 자체 기준(문서 확인 전).
 *   ⬜ 실측은 **키가 온 뒤**(§19 기술 «애드센스 Management API 승인»·«쿠팡 subId 집계») — 그때 이 표를 실제 리포트와 대조해 고친다.
 */
export type DayBasis = "kst" | "pt" | "provider";
export const DAY_BASIS_OF: Readonly<Record<RevenueSource, DayBasis>> = {
  adsense: "pt", youtube: "pt",                     // 구글 리포트는 계정 시간대(대개 PT) 기준일 — 한국 자정과 다르다
  coupang: "kst", adpost: "kst", adfit: "kst", clip: "kst",   // 국내 매체 = 한국 날짜
  aliexpress: "provider", linkprice: "provider",    // 문서 확인 전 — 확인되면 kst/pt 로 바꾼다
  tenping: "kst", adpick: "kst", shopping_connect: "kst",   // [P1R8 §3.4] 국내 매체 · 사람이 KST 로 적는다
  meta: "kst", tiktok: "kst", x: "kst", sponsor: "kst", manual: "kst",   // 사람이 KST 로 적는다
};
/** 화면에 한 줄로 붙일 말(없으면 KST 라 굳이 말하지 않는다). */
export const DAY_BASIS_NOTE: Readonly<Partial<Record<DayBasis, string>>> = {
  pt: "이 매체는 미국 시간 기준으로 하루를 세요 — 한국 날짜와 하루가 어긋날 수 있어요.",
  provider: "이 매체가 세는 하루 기준을 아직 확인하지 못했어요 — 한국 날짜와 다를 수 있어요.",
};

/** 수익 1행(계약 §1.1). day 는 **KST 날짜** · amountKrw 는 정수 원(외화는 currency+fxRate 를 남기고 환산값을 넣는다). */
export interface RevenueRow {
  source: RevenueSource | string;
  accountId?: number;
  pieceId?: number;
  /** KST YYYY-MM-DD */
  day: string;
  /** 정수 원 */
  amountKrw: number;
  currency?: string;
  fxRate?: number;
  /** 진단용 원문 일부 — 🔴 토큰·키는 절대 넣지 않는다. */
  raw?: unknown;
}

export type SyncFailReason = "not_configured" | "auth" | "rate_limit" | "provider" | "parse";
export interface SyncFail { ok: false; reason: SyncFailReason; retriable: boolean; detail?: string }
export type SyncResult = { ok: true; rows: RevenueRow[] } | SyncFail;

/** revenue_sources 행 투영(커넥터 입력). credEnc 는 복호화 전 암호문 — 커넥터 안에서만 푼다. */
export interface RevenueSourceRow {
  id: number; tenantId: number; source: RevenueSource | string; accountId: number | null;
  method: string; status: string; credEnc: string | null;
  lastSyncAt: string | null; lastError: string | null; failCount: number;
  /** 소스 설정(사이트 id·채널 id·머천트 id 등 — 비밀 아님). */
  config: Record<string, unknown>;
}

/** «우리 버그»와 «고객 계정 문제»를 가른다(AC-10). 고객 안내 = not_configured·auth · 우리 신호 = provider·parse(rate_limit 는 둘 다 아님·재시도). */
export function isCustomerSide(reason: SyncFailReason): boolean { return reason === "not_configured" || reason === "auth"; }
