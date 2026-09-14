/**
 * lib/revenue/types.ts — 수익 커넥터 공통 타입(계약 P1R3 §1.1 · 글자 그대로). DESIGN §9.1·§9.2.
 *   소스별 파일(adsense·youtube·coupang·aliexpress·linkprice)은 이 인터페이스만 구현한다.
 *   🔴 이 파일은 아무것도 import 하지 않는다(순환 0 · AC-17). 러너 report(B2)도 이 타입으로 행을 실어 보낸다.
 */

/** 소스 어휘(계약 §1.4b(4) 최종). 화면·집계·enum 검사가 전부 이 목록을 본다. */
export const REVENUE_SOURCES = ["adsense", "youtube", "coupang", "aliexpress", "linkprice", "adpost", "adfit", "clip", "meta", "tiktok", "x", "sponsor", "manual"] as const;
export type RevenueSource = typeof REVENUE_SOURCES[number];
export function isRevenueSource(v: unknown): v is RevenueSource { return typeof v === "string" && (REVENUE_SOURCES as readonly string[]).includes(v); }

/** 수집 방식 = 신선도 배지의 근거(§0). */
export type Freshness = "api" | "runner" | "manual";
/** 소스마다 어떤 손이 가져오나(정본 한 곳 — 화면 배지·스텝 분기가 같은 표를 본다). */
export const FRESHNESS_OF: Readonly<Record<RevenueSource, Freshness>> = {
  adsense: "api", youtube: "api", coupang: "api", aliexpress: "api", linkprice: "api",
  adpost: "runner", adfit: "runner", clip: "runner",
  meta: "manual", tiktok: "manual", x: "manual", sponsor: "manual", manual: "manual",
};
/**
 * «오늘 확정» 소스(DESIGN §9.3 · 계약 §1.4 v3.2): 오늘 날짜에 대해 하루치를 확정으로 주는 소스.
 *   나머지(adpost·adfit·clip·youtube)는 부분 수집 = «예상». 홈의 큰 숫자가 이 표로 갈라진다 — 합쳐서 한 숫자로 내리지 않는다.
 */
export const CONFIRMED_SOURCES: ReadonlySet<RevenueSource> = new Set(["adsense", "coupang", "aliexpress", "linkprice", "meta", "tiktok", "x", "sponsor", "manual"]);

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
