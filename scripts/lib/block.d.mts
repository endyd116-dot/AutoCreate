/**
 * scripts/lib/block.d.mts — `block.mjs` 의 타입 선언(AC-216 · B2 · 2026-09-22).
 *   🔴 구현은 `.mjs` 다(자들이 `node` 로도 `tsx` 로도 부른다). 선언만 여기 둔다 —
 *      없으면 `.mts` 자에서 `tsc` 가 TS7016 으로 운다.
 *   ⚠️ **구현과 이 선언이 갈라지면 아무도 안 잡는다.** 칸을 더하면 둘 다 고쳐라.
 */

/** 주석을 **공백으로 치환**해 걷어 낸다(길이·인덱스 보존 · 문자열 리터럴 속 `//` 는 안 건드린다). */
export function stripComments(text: string): string;

/**
 * 닻부터 **끝 표식 중 가장 먼저 오는 것**까지를 덩이로.
 *   🔴 **못 잡으면 `null`** — 「파일 전체」로도 「N자」로도 넓히지 않는다. `null` 은 «못 쟀다»이지 «가드 없음»이 아니다.
 */
export function blockOf(
  text: string,
  anchor: string,
  enders: readonly string[],
  opts?: { maxChars?: number },
): { body: string; start: number; end: number } | null;

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
