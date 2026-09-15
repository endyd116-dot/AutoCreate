/**
 * lib/stock-safety.ts — **스톡 사진을 이 글에 써도 되나**(계약 P1R8 §5.1-앞 · 조사 `docs/active/2026-09-15-image-sourcing-policy.md`).
 *   🔎 출처: AC 신규(계약 P1R8 · 생성 2026-09-15) — AM 원본 없음. 🔴 **순수 리프**(import 0 · 순환 0).
 *
 *   ══ 왜 이 게이트가 스톡보다 **먼저** 와야 하나 ══
 *     무료 스톡 라이선스는 «상업적 사용 가능»이라고 해 놓고 **사람·상표에서 조건을 건다**(2026-09-15 공식 약관 실조사):
 *       · Pexels — «Don't **imply endorsement** of your product by people or brands on the imagery.» ·
 *                  «**Identifiable people may not appear in a bad light** or in a way that is offensive.» (https://www.pexels.com/license/)
 *       · Pixabay — «If Content depicts any **trademarks, logos or brands** … you cannot use that Content **for commercial purposes**
 *                  in relation to goods and services» · «especially Content which features a **recognisable person**» (https://pixabay.com/service/terms/)
 *     우리 글의 상당수가 **제휴·협찬 글**이다. 게이트 없이 스톡을 켜면 **켜는 순간 위반**이 된다(메인 판정 2026-09-15).
 *
 *   ══ 🔴 대용물로 판정하지 않는다(AC-57) ══
 *     «사람이 찍혔나»를 파일 이름·태그로 짐작하면 **틀린다**. 그래서 신호를 세 값으로 둔다: `true`(있다) · `false`(없다 — **제공사가 그렇게 말할 때만**) · `null`(모른다).
 *     🔴 **광고성 글에서는 «모름»도 막는다**(안전한 쪽). 정보성 글에서는 «모름»을 통과시킨다 — 그쪽은 위반 조항이 «상업적 사용»을 전제하기 때문이다.
 *     🔴 태그 힌트(`peopleHintFromTags`)는 **한 방향으로만** 쓴다 — «사람이 있다»는 올릴 수 있어도, 태그에 없다고 «사람이 없다»로 내리지 않는다(그게 대용물 판정이다).
 *
 *   ══ 값은 누가 채우나 ══
 *     B-1 의 `lib/stock/`(Pixabay·Pexels 조달)이 `piece_assets.meta.stock` 에 아래 `StockSource` 모양으로 적는다.
 *     🔴 **값이 없으면 이 게이트는 «스톡이 아니다»로 보고 조용히 통과한다** — 지금(스톡 도입 전)은 검사할 것이 없다는 뜻이고,
 *        B-1 이 출처를 적기 시작하면 **코드를 고치지 않아도 게이트가 스스로 켜진다**.
 */

/** 제공사가 말해 준 것 + 우리가 기록해 둘 것. `people`·`brand` 는 **모르면 null**(짐작해서 false 로 적지 않는다). */
export interface StockSource {
  provider: "pixabay" | "pexels" | string;
  id?: string | number;
  author?: string;
  sourceUrl?: string;
  licenseUrl?: string;
  /** 사람이 **알아볼 수 있게** 찍혔나. 제공사가 말해 줄 때만 true/false · 아니면 null(모름). */
  people?: boolean | null;
  /** 상표·로고가 찍혔나. 같은 규칙. */
  brand?: boolean | null;
  /** 제공사 태그(원문 그대로) — 힌트에만 쓴다. */
  tags?: string[];
}

export type StockBlockCode = "people_in_paid" | "brand_in_paid" | "unknown_in_paid";
export interface StockVerdict {
  ok: boolean;
  /** 막았을 때만. */
  code?: StockBlockCode;
  /** 사람이 읽는 사유(화면·게이트 detail 에 그대로 쓴다). */
  reason?: string;
  /** 어느 약관 줄 때문인가 — 사유에 붙여 보여 준다. */
  law?: string;
}

/**
 * 사람이 찍혔을 **가능성**을 태그에서 올린다. 🔴 **한 방향** — `true` 아니면 `null`(절대 `false` 를 돌려주지 않는다).
 *   «추정»이다: 제공사 태그는 사진마다 들쭉날쭉해서, 없다고 사람이 없는 게 아니다.
 */
export function peopleHintFromTags(tags?: readonly string[]): true | null {
  const blob = (tags ?? []).join(" ").toLowerCase();
  if (!blob) return null;
  const words = ["people", "person", "woman", "man", "girl", "boy", "child", "kid", "portrait", "face", "model", "couple", "family", "crowd", "hands", "사람", "여성", "남성", "아이", "가족", "인물", "얼굴"];
  return words.some((w) => blob.includes(w)) ? true : null;
}
/** 상표·로고 가능성 — 같은 규칙(한 방향). */
export function brandHintFromTags(tags?: readonly string[]): true | null {
  const blob = (tags ?? []).join(" ").toLowerCase();
  if (!blob) return null;
  const words = ["logo", "brand", "trademark", "signage", "storefront", "packaging", "상표", "로고", "간판", "브랜드"];
  return words.some((w) => blob.includes(w)) ? true : null;
}

/** 제공사 값 + 태그 힌트를 합친 최종 신호(힌트는 올리기만 한다). */
export function resolvedSignals(src: StockSource): { people: boolean | null; brand: boolean | null } {
  const people = src.people === true ? true : (src.people === false ? false : peopleHintFromTags(src.tags));
  const brand = src.brand === true ? true : (src.brand === false ? false : brandHintFromTags(src.tags));
  return { people, brand };
}

const LAW_PEXELS = "Pexels 라이선스 «Don't imply endorsement of your product by people or brands on the imagery»";
const LAW_PIXABAY = "Pixabay 약관 «상표·로고가 찍힌 콘텐츠는 상업적 목적으로 쓸 수 없다»";

/**
 * assessStockImage — 이 스톡 사진을 이 글에 써도 되나.
 *   @param src 스톡 출처(없으면 스톡이 아니다 → 통과)
 *   @param ctx.paid **대가를 받은 글인가**(제휴·협찬·무상 제공 — `lib/disclosure.ts compensationOfMeta().need` 와 같은 값)
 */
export function assessStockImage(src: StockSource | null | undefined, ctx: { paid: boolean }): StockVerdict {
  if (!src || !src.provider) return { ok: true };              // 스톡이 아니다(우리가 만든 그림·고객 사진) — 여기서 판단하지 않는다
  if (!ctx.paid) return { ok: true };                          // 정보성 글 — 위 조항들은 «상업적 사용»을 전제한다
  const { people, brand } = resolvedSignals(src);
  if (brand === true) return { ok: false, code: "brand_in_paid", reason: "상표·로고가 찍힌 스톡 사진은 광고가 들어간 글에 쓸 수 없어요.", law: LAW_PIXABAY };
  if (people === true) return { ok: false, code: "people_in_paid", reason: "사람이 알아볼 수 있게 찍힌 스톡 사진은 광고가 들어간 글에 쓸 수 없어요(제품을 보증하는 것처럼 보여요).", law: LAW_PEXELS };
  if (people === null || brand === null) {
    /* 🔴 «모름»을 통과시키면 그게 곧 위반 경로가 된다 — 제공사가 사람·상표를 말해 주지 않는 지금은 이 가지가 **대부분**이다.
       그래서 광고성 글의 스톡은 사실상 «제공사가 괜찮다고 말한 사진»만 통과한다(안전한 쪽 · 메인 판정 2026-09-15). */
    return { ok: false, code: "unknown_in_paid", reason: "이 사진에 사람·상표가 있는지 확인할 수 없어서 광고가 들어간 글에는 쓰지 않아요.", law: `${LAW_PEXELS} · ${LAW_PIXABAY}` };
  }
  return { ok: true };
}

/** piece_assets 행의 meta 에서 스톡 출처를 꺼낸다(없으면 null = 스톡이 아니다). */
export function stockSourceOf(assetMeta: unknown): StockSource | null {
  const m = (assetMeta && typeof assetMeta === "object" ? assetMeta : {}) as Record<string, unknown>;
  const s = m.stock;
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const provider = String(o.provider ?? "").trim();
  if (!provider) return null;
  return {
    provider,
    ...(o.id !== undefined ? { id: String(o.id) } : {}),
    ...(o.author ? { author: String(o.author) } : {}),
    ...(o.sourceUrl ? { sourceUrl: String(o.sourceUrl) } : {}),
    ...(o.licenseUrl ? { licenseUrl: String(o.licenseUrl) } : {}),
    people: o.people === true ? true : (o.people === false ? false : null),
    brand: o.brand === true ? true : (o.brand === false ? false : null),
    ...(Array.isArray(o.tags) ? { tags: (o.tags as unknown[]).map(String) } : {}),
  };
}
