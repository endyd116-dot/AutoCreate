/**
 * lib/stock/index.ts — **스톡 사진 사다리**(Pixabay 1순위 → Pexels 2순위) + «이 글에 써도 되나» 판정을 **적어 두기**.
 *   계약 P1R8 §10.3·§10.4 · DESIGN §5C.5 조달 순서 · 조사 `docs/active/2026-09-15-image-sourcing-policy.md`.
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음.
 *
 *   ══ 이 파일이 있는 이유 = 돈 ══
 *     라이브 `ai_usage` 실측(2026-09-15): 글 1편 원가 ₩458 중 **사진이 ₩389(85%)** 다. 글은 ₩69 뿐이다.
 *     사장님: «사진을 스톡으로 가져오고 **1장(많아야 2장)만 메인만 AI 로**». 그 «스톡으로 가져오는» 자리가 여기다.
 *     🔴 **사진 «수»는 깎지 않는다**(계약 §10.3) — 6장을 3장으로 줄이면 글이 약해진다. 바뀌는 것은 **어디서 가져오나**뿐이다.
 *
 *   ══ 🔴 사람·상표로 **거르지도 미루지도 않는다** (사장님 지시 2026-09-15) ══
 *     사장님: **«픽셀은 해외 채널인데 한국에서 저작권 문제가 걸릴 이유도 일도 없어. 그러니 무시해도 돼.»**
 *     실질도 그렇다 — Pexels·Pixabay 라이선스가 **상업적 사용을 허락**하므로 정상 경로로 쓰면 다툼이 날 자리가 거의 없다.
 *     그리고 두 제공사 다 `people`·`brand` 를 **응답에 주지 않아** 광고성 글에서는 거의 전부가 «모르겠다»로 나온다 —
 *     그 값으로 순위를 미루면 **좋은 사진이 뒤로 밀리는 값만 치르고 얻는 것이 없다.**
 *       · 그래서 `assessStockImage()` 를 **여전히 부르고 결과를 사진에 적어 두되**(§9 «검사를 지우지 마라»)
 *         **순위에는 쓰지 않는다.** 순서는 제공사 사다리 순서 그대로다.
 *       · 화면도 이걸 **경고로 그리지 않는다** — 필요하면 «참고» 정도(메인 전달 2026-09-15).
 *       · 🔴 나중에 필요해지면 **정렬만 다시 켜면 된다.** 판정은 계속 쌓이고 있다.
 *
 *   ══ 🔴 그래서 남는 위험은 «저작권»이 아니라 «약관»이다 — 그 둘은 그대로 지킨다 ══
 *     키가 죽는 경로는 사람·상표가 아니라 ①**크레딧 미표기**(Pexels 는 작가 크레딧 + Pexels 링크가 의무)
 *     ②**캐시·호출 상한 위반**(Pixabay 24시간 캐시 · 100req/60s)이다.
 *     사장님이 «무시해도 된다»고 하신 것은 **사람·상표 판정**이지 약관 준수가 아니다 — `cache.ts` 와 `creditLineOf` 가 그 둘을 맡는다.
 */
import { assessStockImage, type StockVerdict } from "../stock-safety";
import { pixabay } from "./pixabay";
import { pexels } from "./pexels";
import { STOCK_PAGE_SIZE, type StockCandidate, type StockProvider, type StockProviderName, type StockSearchOutcome } from "./types";
import type { StockMeta } from "../photo-source";

export type { StockCandidate, StockProviderName, StockSearchOutcome } from "./types";
export { STOCK_PAGE_SIZE, STOCK_TIMEOUT_MS } from "./types";

/** 🔴 순서가 곧 정책이다 — Pixabay 가 먼저다(크레딧 의무가 가볍고, «내려받아 쓰라»가 우리 방식과 같다). */
export const PROVIDERS: readonly StockProvider[] = [pixabay, pexels];

/** 후보 한 장 + 그 사진에 대한 판정(막는 값이 아니라 **보여 주는 값**). */
export interface StockPick extends StockCandidate {
  verdict: StockVerdict;
}

/** 열쇠가 하나라도 꽂혀 있나 — `/api/health` 와 화면이 «아직 못 써요»를 정직하게 말할 때 쓴다. */
export function stockConfigured(): boolean { return PROVIDERS.some((p) => p.configured()); }
/** 어느 제공사가 준비됐나(운영 화면용). */
export function stockStatus(): { provider: StockProviderName; configured: boolean }[] {
  return PROVIDERS.map((p) => ({ provider: p.name, configured: p.configured() }));
}

/**
 * 스톡 사진 찾기 — 사다리를 타고 내려가며 필요한 만큼 모은다.
 *
 * @param a.query   찾을 낱말(소재 제목·장면 묘사).
 * @param a.paid    🔴 **대가를 받은 글인가**(제휴·협찬·무상 제공). `lib/disclosure.ts compensationOfMeta().need` 와 같은 값을 넣는다.
 *                  이 값에 따라 B3 판정이 갈린다. 🔴 **판정은 적어 둘 뿐 거르거나 미루지 않는다**(위 헤더).
 * @param a.provider 특정 제공사만(화면에서 골랐을 때). 안 주면 사다리 전부.
 *
 * @returns `picks` 는 **제공사 사다리 순서 그대로**이고 사진마다 판정(`verdict`)이 달려 있다. `tried` 는 제공사마다 무슨 일이 있었나 —
 *          🔴 «키 없음»과 «불렀는데 0건»을 화면이 갈라 말할 수 있어야 한다(`no_key` vs `empty`).
 */
export async function searchStock(a: {
  query: string;
  count?: number;
  lang?: string;
  paid: boolean;
  provider?: StockProviderName | null;
  timeoutMs?: number;
}): Promise<{ ok: boolean; picks: StockPick[]; tried: StockSearchOutcome[] }> {
  const want = Math.min(STOCK_PAGE_SIZE, Math.max(1, Math.floor(a.count ?? STOCK_PAGE_SIZE)));
  const ladder = a.provider ? PROVIDERS.filter((p) => p.name === a.provider) : PROVIDERS;
  const tried: StockSearchOutcome[] = [];
  const picks: StockCandidate[] = [];

  for (const p of ladder) {
    /* 🔴 **넉넉히 이미 모았으면 다음 제공사를 부르지 않는다** — 안 불러도 되는 호출이 상한을 먹는다. */
    if (picks.length >= want) break;
    const out = await p.search({ query: a.query, count: want, lang: a.lang, timeoutMs: a.timeoutMs });
    tried.push(out);
    picks.push(...out.candidates);
  }

  const marked = markStockPicks(picks, a.paid);
  return { ok: marked.length > 0, picks: marked.slice(0, want), tried };
}

/**
 * 후보마다 B3 판정을 **달기만** 한다.
 *   🔴 **거르지도 않고 순서도 안 바꾼다**(사장님 지시 2026-09-15 · 위 헤더). 들어온 순서 = 제공사 사다리 순서 그대로.
 *   판정은 `verdict` 에 실려 `piece_assets.meta.stock.verdict` 로 저장된다 — **쌓아 두는 값**이지 지금 쓰는 값이 아니다.
 *   (나중에 정렬이 필요해지면 여기서 `sort` 한 줄이면 된다. 그래서 판정을 지우지 않았다 · §9 «검사를 지우지 마라».)
 */
export function markStockPicks(candidates: readonly StockCandidate[], paid: boolean): StockPick[] {
  return candidates.map((c) => ({ ...c, verdict: assessStockImage(toStockMeta(c), { paid }) }));
}

/**
 * 후보 → `piece_assets.meta.stock` 에 적을 모양(`lib/photo-source.ts StockMeta`).
 *   🔴 `people`·`brand` 는 후보가 들고 온 값 **그대로**다 — 여기서 «모름»을 «없음»으로 바꾸지 않는다(AC-57).
 */
export function toStockMeta(c: StockCandidate): StockMeta {
  return {
    provider: c.provider,
    id: c.id,
    ...(c.author ? { author: c.author } : {}),
    ...(c.sourceUrl ? { sourceUrl: c.sourceUrl } : {}),
    licenseUrl: c.licenseUrl,
    people: c.people,
    brand: c.brand,
    ...(c.tags.length ? { tags: c.tags } : {}),
  };
}

/**
 * 제공사들이 겪은 일을 사람 한 줄로 — 🔴 «0건»을 «아직 안 켰어요»와 섞지 않는다.
 *   화면이 이 문장을 그대로 쓴다(시스템 용어 금지 · CLAUDE §3).
 */
export function stockTroubleLine(tried: StockSearchOutcome[]): string | null {
  if (!tried.length) return "사진 제공사가 아직 연결되지 않았어요.";
  if (tried.some((t) => t.ok && t.candidates.length)) return null;
  if (tried.every((t) => t.reason === "no_key")) return "사진 제공사 열쇠가 아직 안 꽂혀 있어요. 열쇠를 넣으면 바로 됩니다.";
  if (tried.some((t) => t.reason === "rate_limited")) return "사진을 너무 빨리 찾고 있어요. 잠시 뒤에 다시 시도해 주세요.";
  if (tried.every((t) => t.reason === "empty")) return "그 낱말로는 사진을 못 찾았어요. 다른 낱말로 찾아 보세요.";
  return "사진을 찾는 데 실패했어요. 잠시 뒤에 다시 시도해 주세요.";
}
