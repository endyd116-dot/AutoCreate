/**
 * scripts/_lib/r18-judge.d.mts — `r18-judge.mjs` 의 타입 선언(C · 2026-09-27 · R19 — `tsc` 빨강 34 수리).
 *   🔴 왜 이제야: R18 에 `verify-r18-one-video-many.mts` 가 이 `.mjs` 를 불렀는데 선언이 없어 `tsc` 가 TS7016 + 번진 implicit any 로 울었다.
 *      **배포 체인에 `tsc` 칸이 없어서** 그 빨강을 단 채 배포됐다(제품 번들엔 scripts 가 안 들어가 라이브 영향 0 · 메인 실측).
 *      ⇒ 체인 `scripts/gate-parallel.mjs` 에 `tsc` 를 한 칸으로 넣었다.
 *   🔴 구현은 `.mjs` 다(순수 · 자들이 `node` 로도 `tsx` 로도 부른다). 선언만 여기 둔다(`block.d.mts` 관례).
 *   ⚠️ **구현과 이 선언이 갈라지면 아무도 안 잡는다.** 칸을 더하면 둘 다 고쳐라. 모르는 칸은 `unknown` 으로 둔다(지어내지 않는다).
 */

export type Verdict = "pass" | "fail" | "unmeasured";

/** 판정 하나가 낸 발견 — `axis`·`code` 는 늘 있고, 나머지 칸은 축마다 다르다(모양을 좁혀 적지 않는다). */
export interface Finding { axis: string; code: string; why?: string; [k: string]: unknown }

/** 판정 넷이 돌려주는 모양. `untimed`·`minGapMin` 은 ② 만 싣는다 · `note` 는 ① 만 싣는다. */
export interface Judgement {
  axis: string;
  verdict: Verdict;
  measured: number;
  findings: Finding[];
  note?: string;
  untimed?: number;
  minGapMin?: number | null;
}

/** ④ 말투 판정에 넣는 문장 하나 — 한 줄(`text`)로 오거나 두 칸(`line`·`how`)으로 온다. */
export interface WordItem {
  channel?: string;
  seconds?: number;
  max?: number | null;
  why?: string;
  text?: string;
  line?: string | null;
  how?: string | null;
}

/** ③ 목록 판정의 한 줄 — 원본 채널 · 길이 · 간 곳 · 빠진 곳. */
export interface ReuseRow {
  source: string;
  seconds: number;
  targets?: (string | { channel: string })[];
  skipped?: (WordItem & { channel: string })[];
}

/** ② 가족의 한 사람 — `at` 은 ISO 문자열·Date·없음. */
export interface FamilyMember { pieceId: number; channel: string; at: string | Date | null }

export const FORBIDDEN_REUSE: readonly string[];
export const HARD_WORDS: readonly string[];
export const SCARY: readonly (readonly [RegExp, string])[];
export const GOOD_WORDS: readonly WordItem[];
export const BAD_WORDS: readonly (readonly [WordItem, string])[];

export function secondsForms(sec: unknown): string[];
export function lengthsIn(text: unknown): number[];
export function skipText(it: WordItem | null | undefined): string;
export function judgeWords(items: WordItem[]): Judgement;
export function judgeReuse(rows: ReuseRow[], opts?: { maxOf?: (channel: string) => number | null; forbidden?: readonly string[] }): Judgement;
export function judgeCoin(input?: {
  derivedIds?: unknown[];
  ledger?: Record<string, unknown>[];
  consumeBefore?: number;
  consumeAfter?: number;
}): Judgement;
export function judgeMinutes(families: { originId: number; members: FamilyMember[] }[]): Judgement;
export function selfTest(): { ok: boolean; lines: { name: string; ok: boolean; got: unknown }[] };
