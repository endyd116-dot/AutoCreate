/**
 * lib/stock/types.ts — **스톡 사진 한 장**이 우리에게 오는 모양(계약 P1R8 §10.3·§10.4 · 조사 `docs/active/2026-09-15-image-sourcing-policy.md`).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음. 🔴 **순수 리프**(import 0 · 순환 0).
 *
 *   ══ 왜 이 파일이 따로 있나 ══
 *     제공사(Pixabay·Pexels)는 응답 모양이 전혀 다르다. 그 차이를 **provider 파일 안에서 끝내고**,
 *     바깥(고르기·내려받기·기록)은 아래 한 모양만 본다. 제공사를 더 붙일 때 고칠 곳이 provider 파일 하나가 된다.
 *
 *   ══ 🔴 이 파일이 지키는 약속 셋 ══
 *     ① **hotlink 하지 않는다** — `downloadUrl` 은 «우리 서버로 가져올 주소»다. 그대로 글에 싣는 주소가 아니다.
 *        Pixabay 약관이 «Permanent hotlinking … is **not allowed**. please **download them to your server first**» 이고,
 *        네이버·티스토리 에디터는 어차피 사진을 자기 저장소로 가져간다(= hotlink 가 유지될 수 없다).
 *     ② **`people`·`brand` 는 제공사가 명시할 때만 값을 적는다**(AC-57 대용물 금지). 🔴 **지금 두 제공사 다 이 필드를 주지 않는다 → 항상 `null`(모름)**.
 *        짐작해서 `false` 를 적으면 그 한 줄이 라이선스 위반을 통과시킨다(B3 `lib/stock-safety.ts` 규약).
 *     ③ **크레딧 재료를 버리지 않는다** — 작가·출처 주소·라이선스 주소를 받은 그대로 들고 다닌다.
 *        Pexels 는 «show a **prominent link to Pexels**» + 작가 크레딧, Pixabay 는 «**Show your users where the images … are from**» 을 요구한다.
 *        나중에 «이 사진 어디서 났냐»를 물으면 답할 수 있어야 한다.
 */

/** 우리가 쓰는 제공사 — 🔴 **Unsplash 는 없다**(§1.2: «non-automated … experiences» 용도 제한 + hotlink 강제 · 우리는 자동 생성·자동 발행이다). */
export type StockProviderName = "pixabay" | "pexels";

/** 제공사가 보여 준 사진 한 장(아직 **내려받기 전**이다 — 고르는 단계의 후보). */
export interface StockCandidate {
  provider: StockProviderName;
  /** 제공사 안에서의 사진 번호. `stockSourceKey(provider, id)` 의 재료이자 **되짚기 열쇠**의 절반이다. */
  id: string;
  /** 🔴 **우리 서버(R2)로 가져올** 주소. 글에 그대로 싣지 않는다(위 약속 ①). */
  downloadUrl: string;
  /** 고를 때 보는 작은 그림 — **화면 전용**. 발행에 쓰지 않는다. */
  previewUrl: string;
  width: number;
  height: number;
  /** 작가 이름(크레딧 줄에 들어간다). 제공사가 안 주면 null. */
  author: string | null;
  /** 제공사의 그 사진 페이지 — 크레딧 줄의 링크가 여기로 간다. */
  sourceUrl: string | null;
  /** 라이선스 전문 주소(제공사별 고정). */
  licenseUrl: string;
  /** 🔴 사람이 알아볼 수 있게 찍혔나 — **제공사가 말해 줄 때만** true/false. 모르면 `null`. */
  people: boolean | null;
  /** 🔴 상표·로고가 찍혔나 — 같은 규칙. */
  brand: boolean | null;
  /** 제공사 태그 원문 — B3 `peopleHintFromTags`·`brandHintFromTags` 의 재료(힌트에만 쓴다). */
  tags: string[];
  /** 사진 설명(있으면 alt 후보). */
  alt: string | null;
}

/** 한 제공사에게 물어본 결과. */
export interface StockSearchOutcome {
  provider: StockProviderName;
  ok: boolean;
  candidates: StockCandidate[];
  /** 왜 못 물어봤나 — 🔴 «키 없음»과 «불렀는데 0건»은 다른 말이다(화면이 갈라 보여 준다). */
  reason?: "no_key" | "rate_limited" | "http_error" | "network" | "empty";
  /** 사람에게 보여 줄 한 줄(시스템 용어 금지 · CLAUDE §3). */
  detail?: string;
  /** 응답을 캐시에서 꺼냈나(제공사에게 실제로 안 물어봤다). */
  cached?: boolean;
}

/** 제공사 하나가 지켜야 하는 모양. 새 제공사를 붙이려면 이것만 구현하면 된다. */
export interface StockProvider {
  name: StockProviderName;
  /** 키가 꽂혀 있나 — 🔴 키가 없으면 **조용히 0건이 아니라 `no_key` 로 정직하게** 말한다(CLAUDE §8 «키 꽂으면 즉시 가동»). */
  configured(): boolean;
  /** 라이선스 전문 주소. */
  licenseUrl: string;
  /**
   * 🔴 이 제공사의 사진이 **실제로 올라와 있는 호스트**. 내려받기는 여기서만 한다.
   *   왜 필요한가: 사진을 붙이는 API 는 «어느 사진»을 **고객이 고른 값**으로 받는다. 그 주소를 그대로 가져오면
   *   ①우리 서버가 아무 주소나 대신 열어 주는 통로가 되고(SSRF) ②아무 그림이나 «정식 라이선스 스톡»이라는 딱지를 달고 저장된다.
   *   호스트를 제공사에 묶어 두면 둘 다 막힌다 — 그리고 **크레딧이 엉뚱한 곳을 가리키는 일**도 없다.
   */
  imageHosts: readonly string[];
  search(a: { query: string; count: number; lang?: string; timeoutMs?: number }): Promise<StockSearchOutcome>;
}

/** 주소가 그 제공사의 호스트인가(정확히 같거나 하위 도메인). 🔴 `endsWith` 만 쓰면 `evil-pixabay.com` 이 통과한다. */
export function hostAllowed(url: string, hosts: readonly string[]): boolean {
  let h: string;
  try { const u = new URL(url); if (u.protocol !== "https:") return false; h = u.hostname.toLowerCase(); }
  catch { return false; }
  return hosts.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/** 한 번에 물어보는 최대 장수 — 후보는 넉넉해야 «사람·상표 힌트 걸린 것을 뒤로 미루기»가 의미가 있다. */
export const STOCK_PAGE_SIZE = 24;
/** 제공사 응답 기다리는 시간. 생성 파이프라인 안에서 부르므로 길게 잡지 않는다. */
export const STOCK_TIMEOUT_MS = 12_000;
