/**
 * lib/stock/plan.ts — **사진을 어디서 가져올지 정한다**(DESIGN §5C.5 조달 순서 · 계약 P1R8 §10.3).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음. 🔴 **순수**(DB·네트워크 0 · 타입만 import).
 *
 *   ══ 조달 순서(설계 그대로) ══
 *     ① **대표 사진 1장 = AI** — 그 글에만 있는 그림. 대표는 스톡으로 바꾸지 않는다(남의 글과 같은 얼굴이 된다).
 *     ② 본문 사진 = **①내가 올린 사진 → ②스톡(정식 API) → ③그래도 모자라면 AI**.
 *
 *   ══ 🔴 AI 는 «상한»이 아니라 «맨 뒤»다 ══
 *     사장님 안은 «1장(많아야 2장)만 AI» 지만, 그것을 **하드 상한으로 두면 안 된다**:
 *     열쇠가 아직 안 꽂혔거나(오늘이 그렇다) 스톡이 0건이면 **사진 수가 통째로 줄어든다** —
 *     그건 계약 §10.3 이 금지한 «사진 수를 깎는 것»이고, `visualMin` 축과도 싸운다(CLAUDE §9 «계약의 최소치도 게이트다»).
 *     ⇒ AI 는 **못 채운 자리를 메우는 마지막 수단**이다. 열쇠가 꽂히면 자동으로 스톡이 그 자리를 먼저 가져간다(§8 «키 꽂으면 즉시 가동»).
 *     ⇒ 그래서 «AI 몇 장이었나»는 **정하는 값이 아니라 세는 값**이다 — `PhotoMix` 가 실제로 붙은 것만 센다.
 *
 *   ══ 🔴 왜 검색을 **글마다 한 번**만 하나 ══
 *     블록마다 찾으면 사진 6장짜리 글 하나가 제공사 호출 6번을 쓴다. Pixabay 는 **100req/60초**다 —
 *     크론이 한 틱에 글 몇 편만 만들어도 상한에 닿는다. 소재 제목으로 **한 번** 찾아 그 후보를 나눠 쓴다.
 */
import type { StockCandidate } from "./types";

/** 이 글의 사진이 어디서 왔나 — **장수만**. 🔴 옛 B-1 되먹임 원장(§5F)이 `pieces.meta.photoMix` 로 읽는 칸이다(칸 이름 합의 2026-09-15). */
export interface PhotoMix { ai: number; stock: number; customer: number; failed: number }
export const emptyMix = (): PhotoMix => ({ ai: 0, stock: 0, customer: 0, failed: 0 });

/**
 * 대표 사진은 몇 번째인가 — **첫 이미지 블록**이다.
 *   🔴 `heroNeeded` 가 꺼져 있어도 첫 장은 대표다(글의 얼굴은 언제나 첫 사진이다).
 *   이미지가 한 장도 없으면 `-1`.
 */
export function heroIndexOf(imageIndexes: readonly number[]): number {
  return imageIndexes.length ? Math.min(...imageIndexes) : -1;
}

/** 검색어에서 걷어 낼 것 — 사진 검색은 **명사**로 한다(따옴표·괄호·기호는 결과만 망친다). */
const QUERY_STRIP = /[^\p{L}\p{N}\s]/gu;
/** 제목에 흔히 붙는 군더더기(이게 들어가면 엉뚱한 사진이 온다). */
const QUERY_NOISE = new Set(["총정리", "정리", "추천", "후기", "방법", "완벽", "가이드", "베스트", "top", "best", "년", "월"]);

/**
 * 소재 제목 → 사진 검색어. 🔴 **짧을수록 맞는 사진이 온다**(긴 문장을 그대로 넣으면 0건이 된다).
 *   낱말 3개까지 · 군더더기 제거 · 숫자만 있는 낱말 제거.
 *   ⚠️ 정직: «한국어로 찾으면 결과가 좋은가»는 **못 쟀다**(우리 키가 아직 없다 · AC-9).
 *      두 제공사 다 한국어 검색을 공식 지원한다(`lang=ko` · `locale=ko-KR`) — 그것만 확인했다.
 */
export function stockQueryOf(topicTitle: string, scene?: string | null): string {
  const src = String(scene || topicTitle || "").replace(QUERY_STRIP, " ");
  const words = src.split(/\s+/).map((x) => x.trim()).filter(Boolean)
    .filter((x) => !QUERY_NOISE.has(x.toLowerCase()) && !/^\d+$/.test(x));
  return words.slice(0, 3).join(" ").slice(0, 60);
}

/**
 * 후보 묶음에서 **아직 안 쓴** 사진을 하나 꺼낸다.
 *   🔴 같은 글에 같은 사진이 두 번 들어가지 않게 `used`(제공사:id)로 거른다 —
 *      `attachStockPhoto` 도 멱등이라 두 번째는 조용히 «이미 있다»로 접히는데, 그러면 **그 자리가 빈 채로 남는다**.
 */
export function takeCandidate(pool: readonly StockCandidate[], used: Set<string>): StockCandidate | null {
  for (const c of pool) {
    const k = `${c.provider}:${c.id}`;
    if (used.has(k)) continue;
    used.add(k);
    return c;
  }
  return null;
}
