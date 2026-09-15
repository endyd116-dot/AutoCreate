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

/* ══════════════ [R8CLOSE-B1 §B9] 대표 이미지 — «필요하다»가 **실제로 하는 일** ══════════════

   ── 무엇이 죽어 있었나 ──
   `director.ts:322` · `cron/director-auto.ts:132` 가 `heroNeeded: ch === "naver_blog" || ch === "tistory"` 를
   **적고**, `director.ts:579` 가 `piece.meta` 로 **나르는데**, 🔴 **읽는 곳이 0** 이었다.
   = 네이버·티스토리 대표 이미지가 «필요하다»고 적히기만 하고 아무 일도 안 일어났다.

   ── 🔴 위의 `heroIndexOf` 주석과의 관계(AC-59 — 주석이 앞선 건지 뒤처진 건지 먼저 봤다) ──
   「`heroNeeded` 가 꺼져 있어도 첫 장은 대표다」는 **코드와 맞는 말**이고 그대로 둔다.
   `heroIndexOf` 는 «어느 자리가 대표인가»(모든 채널)이고, `heroNeeded` 는 «대표가 **있어야** 하는가»(네이버·티스토리)다.
   ⇒ 두 개는 다른 질문이다. 아래는 **뒤쪽 질문**에만 값을 준다 — 사진 경제(첫 장 = AI)는 건드리지 않는다.

   ── 🔴 우리가 실제로 할 수 있는 것만 한다(§9 «없는 길»은 없는 길이라고 적는다) ──
   실측(2026-09-16): `runner/channels/naver-blog.mjs` · `runner/channels/tistory.mjs` 어디에도
   **대표·썸네일을 지정하는 동작이 0**이다(`grep 대표|썸네일|thumb` = 0건). 에디터에서 «대표»로 콕 집는 것은
   B7 «에디터 실제 요소»(R10 · AM 발행 러너 이식)와 같은 일이라 **여기서 만들지 않는다.**
   두 에디터 다 **본문 첫 사진**을 대표로 집는다 — 그래서 우리가 할 수 있는 일은 셋이다:
     ① 대표가 **있게** 한다   — 사진 자리가 0개면 한 자리를 만들어 준다(막는 게 아니라 **대신 해 주는 것** · §9-④)
     ② 대표를 **대표답게** 굽는다 — 그 자리 그림 지시문에 «목록에서 작게 잘려 보인다» 한 줄을 더한다(호출 수는 그대로 · 돈 0)
     ③ 어떻게 됐는지 **말해 준다** — `meta.hero` 로 남기고 검수 화면이 읽는다. 🔴 못 한 것은 못 했다고 적는다.
   🔴 **막지 않는다** — 대표가 못 서도 글은 그대로 나간다. 재작성도 돌리지 않는다(돈이 두 배 · §9). */

/** 대표 이미지를 어떻게 할 것인가 — 사진을 굽기 **전에** 정한다. */
export interface HeroPlan {
  /** 이 채널이 대표 이미지를 요구하나(`meta.heroNeeded`). */
  needed: boolean;
  /** 대표가 될 이미지 블록의 `imageIndex`. `-1` = 아직 자리가 없다. */
  index: number;
  /** 사진 자리가 0개라 **우리가 한 자리 만들어 줬나**(①). */
  made: boolean;
}

/**
 * 대표 자리를 정한다. `imageIndexes` 는 이 글의 이미지 블록들이 가진 `imageIndex` 목록.
 *   🔴 자리가 이미 있으면 **첫 자리**가 대표다(두 에디터가 본문 첫 사진을 집는다 · 위 헤더).
 *   🔴 `needed` 인데 자리가 0개면 `made: true` — 부르는 쪽이 블록을 하나 끼워 넣는다.
 */
export function heroPlanOf(heroNeeded: boolean, imageIndexes: readonly number[]): HeroPlan {
  const index = heroIndexOf(imageIndexes);
  if (!heroNeeded) return { needed: false, index, made: false };
  return { needed: true, index, made: index < 0 };
}

/**
 * 대표 자리 그림 지시문에 붙이는 한 줄(②).
 *   🔴 **영문이다** — `prompt` 는 그림 모델에게 가는 말이고(블록 `prompt` 주석) 독자에게 안 보인다.
 *   🔴 비율(`aspect`)은 **안 건드린다** — 두 채널이 썸네일을 어떤 비로 자르는지 우리 손으로 재 본 적이 없다(AC-9).
 *      가운데를 비워 두지 않게만 시킨다. 그러면 어느 비로 잘려도 주제가 남는다.
 */
export const HERO_PROMPT_HINT = "This is the cover image: it will also be shown as a small thumbnail in a feed, so keep the subject large and centered with clear margins.";

/** 대표 이미지가 **어떻게 됐나** — 사진을 다 붙인 **뒤에** 적는다(`pieces.meta.hero`). */
export interface HeroFact {
  needed: boolean;
  /** 대표가 실제로 섰나. */
  ok: boolean;
  /** 선 자리(`imageIndex`) · 못 섰으면 `-1`. */
  index: number;
  /** 그 사진이 어디서 왔나. */
  source: "ai" | "stock" | "customer" | null;
  /** 사진 자리를 우리가 만들어 줬나(①). */
  made: boolean;
  /**
   * 🔴 **에디터에서 «대표»로 콕 집었나 — 언제나 `false` 다.** 못 하는 것을 못 한다고 적는 칸이다(§9 «없는 길»).
   *   R10 «에디터 실제 요소»(B7)가 열리면 그때 참이 될 수 있다. 그때까지 이 칸은 **거짓말을 막는 자리**다.
   */
  pinned: false;
  /** 검수 화면이 그대로 그리는 **사람말 한 줄**(서버가 정본 · 두 곳이 다른 말을 하지 않게). */
  line: string;
}

/**
 * 대표 이미지 결과를 사람말로 적는다.
 *   🔴 겁주지 않는다(§3) — ①사실 ②어떻게 하면 되는지 ③우리가 대신 해 준 것 순서다.
 */
export function heroFactOf(plan: HeroPlan, source: HeroFact["source"]): HeroFact {
  const ok = plan.index >= 0 && source !== null;
  const line = !plan.needed
    ? "첫 사진이 이 글의 얼굴이에요."
    : ok
      ? `첫 사진이 대표로 나가요 — 목록과 검색에 이 사진이 같이 보여요.${plan.made ? " 사진 자리가 없어서 한 장 넣어 뒀어요." : ""}`
      : "대표로 쓸 사진이 아직 없어요. 사진을 한 장 올리시면 그게 대표가 돼요 — 그대로 두셔도 글은 올라가요.";
  return { needed: plan.needed, ok, index: ok ? plan.index : -1, source: ok ? source : null, made: plan.made, pinned: false, line };
}
