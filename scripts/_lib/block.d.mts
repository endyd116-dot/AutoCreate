/**
 * scripts/_lib/block.d.mts — `block.mjs` 의 타입 선언(AC-216 · B2 · 2026-09-22).
 *   🔴 구현은 `.mjs` 다(자들이 `node` 로도 `tsx` 로도 부른다). 선언만 여기 둔다 —
 *      없으면 `.mts` 자에서 `tsc` 가 TS7016 으로 운다.
 *   ⚠️ **구현과 이 선언이 갈라지면 아무도 안 잡는다.** 칸을 더하면 둘 다 고쳐라.
 */

/**
 * 주석을 **공백으로 치환**해 걷어 낸다(길이·자리·줄 수 보존).
 *   🔴 **여기서 만든 게 아니다** — `scripts/_lib/code-only.mjs codeOnlyKeepIndex` 를 그대로 내보낸다.
 *      그 파일이 「주석 걷기를 두 벌로 두지 마라」를 배워서 생긴 집이다. 고칠 일은 **거기서** 고쳐라.
 */
export function stripComments(text: string): string;

/**
 * 닻부터 **끝 표식 중 가장 먼저 오는 것**까지를 덩이로.
 *   🔴 **못 잡으면 `null`** — 「파일 전체」로도 「N자」로도 넓히지 않는다. `null` 은 «못 쟀다»이지 «가드 없음»이 아니다.
 */
export function blockOf(
  text: string,
  anchor: string,
  enders: readonly string[],
  /** `unique` 는 **기본 켬** — 닻이 둘 이상이면 `null`(엉뚱한 덩이를 집지 않는다). 일부러 첫 것을 쓰려면 `false` 로 **적어서**. */
  opts?: { maxChars?: number; unique?: boolean },
): { body: string; start: number; end: number; count: number } | null;

/**
 * 🔴 **열거** — 닻이 나오는 자리를 **전부**. 「몇 개나 있나」는 이것으로 묻는다.
 *   `blockOf`(유일성)를 여기에 쓰면 **모수가 1로 줄어 조용한 초록**이 된다 — **판정은 유일하게 · 열거는 전부.**
 *   `unresolved > 0` 이면 닻은 있는데 끝을 못 찾은 것이라 부르는 쪽이 **`⊘`** 로 적어야 한다.
 */
export function allBlocksOf(
  text: string,
  anchor: string,
  enders: readonly string[],
  /**
   * 🔴 `anchorKind` — **«끝을 못 찾았다»의 뜻**을 정한다(기본 `"literal"`).
   *   · `"literal"`   닻이 글자 그대로의 코드 → 못 찾음 = «**내가 실패했다**» ⇒ `⊘` · 모수는 **안 줄인다**
   *   · `"heuristic"` 닻이 어림짐작 → 못 찾음 = «**그건 애초에 그게 아니었다**» ⇒ 모수에서 **뺀다**
   *   ⚠️ 한 값을 한 뜻으로만 읽으면 한쪽은 반드시 거짓이다(⊘ 로 쓰면 거짓 빨강 · 빼면 조용한 초록).
   */
  opts?: { maxChars?: number; anchorKind?: "literal" | "heuristic" },
): {
  count: number;
  blocks: { body: string; start: number; end: number }[];
  unresolved: number;
  /** 🔴 **셈에 쓸 모수** — `literal`=`count` · `heuristic`=`blocks.length`. 부르는 쪽이 갈래를 다시 쓰지 않게. */
  denominator: number;
  /** 🔴 `"unmeasured"`(⊘ 로 적어라) | `"not_applicable"`(그건 그게 아니었다). */
  unresolvedMeans: "unmeasured" | "not_applicable";
};

/** 덩이 안에서 A 가 B 보다 앞인가. `null` = 둘 중 하나를 못 찾았다(⊘). */
export function orderIn(
  body: string | null,
  firstRe: RegExp,
  secondRe: RegExp,
): { ok: boolean; why: string } | null;

/** ✓ · ✗ · ⊘ 세 값 집계기. `done()` 이 종료코드를 준다(0 / 1 제품 / **2 자가 못 쟀다**). */
export function tally(): {
  ok(name: string, cond: boolean, extra?: string): void;
  unmeasured(name: string, why?: string): void;
  okOr(name: string, block: string | null, judge: (b: string) => boolean, extra?: string): void;
  done(label?: string): number;
};
