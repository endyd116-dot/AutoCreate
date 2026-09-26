/**
 * scripts/_teardown.d.mts — `_teardown.mjs` 의 타입 선언(C · 2026-09-27 · R19 — `tsc` 빨강 수리).
 *   `.mts` 자(`verify-r18-one-video-many.mts`)가 이 `.mjs` 를 부르는데 선언이 없어 TS7016 으로 울었다.
 *   🔴 구현은 `.mjs` 다(하니스 공용 · `node` 로 부른다). 선언만 여기 둔다(`_lib/block.d.mts` 관례).
 *   ⚠️ **구현과 이 선언이 갈라지면 아무도 안 잡는다.** 칸을 더하면 둘 다 고쳐라.
 */

/** 보존 테넌트 — 집은 절대 지우지 않는다(이번 실행 산출물만). */
export const PROTECT: Set<number>;
export const ARTIFACT_TABLES: string[];
export const KEEP_TABLES: Set<string>;

/** 하니스 끝(성공·실패·예외 모두)에서 부른다. 🔴 절대 던지지 않는다. `sql` 은 postgres-js 태그(모양을 여기서 좁히지 않는다). */
export function teardownRun(
  sql: unknown,
  opts?: { tenants?: unknown[]; since?: Date | string; operatorIds?: unknown[]; label?: string; dryRun?: boolean },
): Promise<{ text: string; deleted: number[]; kept: number[]; artifacts: number; failed: boolean }>;
