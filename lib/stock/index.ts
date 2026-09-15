/**
 * lib/stock/index.ts — **스톡 사진 사다리**(Pixabay 1순위 → Pexels 2순위) + «이 글에 써도 되나»를 **말해 주기**.
 *   계약 P1R8 §10.3·§10.4 · DESIGN §5C.5 조달 순서 · 조사 `docs/active/2026-09-15-image-sourcing-policy.md`.
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음.
 *
 *   ══ 이 파일이 있는 이유 = 돈 ══
 *     라이브 `ai_usage` 실측(2026-09-15): 글 1편 원가 ₩458 중 **사진이 ₩389(85%)** 다. 글은 ₩69 뿐이다.
 *     사장님: «사진을 스톡으로 가져오고 **1장(많아야 2장)만 메인만 AI 로**». 그 «스톡으로 가져오는» 자리가 여기다.
 *     🔴 **사진 «수»는 깎지 않는다**(계약 §10.3) — 6장을 3장으로 줄이면 글이 약해진다. 바뀌는 것은 **어디서 가져오나**뿐이다.
 *
 *   ══ 🔴 막지 않는다. 고른다. (CLAUDE §9 · 사장님 전역 지시 2026-09-15) ══
 *     §9 가 하드 게이트를 0개로 내리면서 «스톡 사람/상표»도 소프트가 됐다. 그래서 여기서는 —
 *       · B3 `lib/stock-safety.ts assessStockImage()` 를 **그대로 부른다**(게이트를 다시 만들지 않는다).
 *       · 판정 결과로 **막지 않는다.** 대신 **순위를 바꾸고**(안전한 것을 위로) 사진마다 판정을 **달아 보낸다**.
 *       · 화면·검수가 그 판정을 읽어 «무엇이 · 왜 · 어떻게»를 세 줄로 말한다(§9 의 «말해 주기»).
 *     🔴 순위 바꾸기는 게이트가 아니라 §9.4 «우리가 대신 해 줄 수 있는 것은 대신 해 준다» 다.
 *
 *   ══ 🔴 알고 쓰는 사실 하나 ══
 *     **Pixabay·Pexels 둘 다 `people`·`brand` 를 응답에 주지 않는다.** 그래서 광고성 글에서는 거의 모든 후보가
 *     `unknown_in_paid`(«모르겠다»)로 나온다. 이걸 **막기로** 뒀다면 광고성 글의 스톡은 **100% 막혔을** 것이다.
 *     우리가 할 수 있는 최선은 ①태그 힌트로 사람·상표 냄새가 나는 것을 뒤로 미루고 ②«확인 못 했다»고 정직하게 말하는 것이다(AC-9·AC-60).
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
 * 판정 나쁜 순서 — **뒤로 미룰 순서**다(막는 순서가 아니다).
 *   통과(0) → 모르겠다(1) → 사람이 찍혔다(2) → 상표가 찍혔다(3).
 *   🔴 «모르겠다»를 «사람이 찍혔다»보다 앞에 두는 이유: 전자는 **우리가 못 잰 것**이고 후자는 **재서 걸린 것**이다(AC-9 «못 쟀어요»는 «나쁘다»가 아니다).
 */
function rank(v: StockVerdict): number {
  if (v.ok) return 0;
  if (v.code === "unknown_in_paid") return 1;
  if (v.code === "people_in_paid") return 2;
  return 3;
}

/**
 * 스톡 사진 찾기 — 사다리를 타고 내려가며 필요한 만큼 모은다.
 *
 * @param a.query   찾을 낱말(소재 제목·장면 묘사).
 * @param a.paid    🔴 **대가를 받은 글인가**(제휴·협찬·무상 제공). `lib/disclosure.ts compensationOfMeta().need` 와 같은 값을 넣는다.
 *                  이 값에 따라 B3 판정이 갈린다 — 정보성 글에서는 사람·상표 조항이 «상업적 사용»을 전제하므로 전부 통과한다.
 * @param a.provider 특정 제공사만(화면에서 골랐을 때). 안 주면 사다리 전부.
 *
 * @returns `picks` 는 **이미 순위가 매겨져** 있다. `tried` 는 제공사마다 무슨 일이 있었나 —
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

  const ranked = rankStockPicks(picks, a.paid);
  return { ok: ranked.length > 0, picks: ranked.slice(0, want), tried };
}

/**
 * 후보마다 B3 판정을 달고 **순위를 매긴다**. 🔴 **거르지 않는다** — 길이가 줄지 않는다(CLAUDE §9).
 *   들어온 순서(= 제공사 사다리 순서)는 판정이 같을 때 그대로 유지된다(안정 정렬).
 */
export function rankStockPicks(candidates: readonly StockCandidate[], paid: boolean): StockPick[] {
  const picks: StockPick[] = candidates.map((c) => ({ ...c, verdict: assessStockImage(toStockMeta(c), { paid }) }));
  picks.sort((x, y) => rank(x.verdict) - rank(y.verdict));
  return picks;
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
