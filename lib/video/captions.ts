/**
 * lib/video/captions.ts — 어절 타임스탬프 → 구절 자막(동적계획 분할) · SRT · 렌더 phrases. 전부 순수(IO 0).
 *   AM 원본: ../AutoMarketing/lib/shorts-captions.ts (복사 2026-09-15 · 원본 275882663 2026-09-03 · wordMap·펀치인은 제외 · 규칙·비용·벌점 값 그대로)
 *   규칙(AM 정본 §7 B2): 2~4어절 · 한글 ≤12음절 · 표시 ≥700ms · 끊는 자리 우선순위 문장부호 > 접속사 앞 > 연결어미 뒤 > 어절 상한.
 *   구절 시각 = 첫 구절 start=문장 start · 이후 = 첫 어절 startMs · end = 다음 구절 start(빈틈 0) · 마지막 = 문장 end.
 *   words 없으면(Gemini TTS 폴백) 글자 질량 비례로 시각을 나눠 같은 분할기를 태운다(계약 §0.1-2 «자막 균등 분할»).
 */
import type { RenderPhrase } from "./types";

export interface CaptionWordTime { text: string; startMs: number; endMs: number }
export interface PhraseLineIn { i: number; text: string; startMs: number; endMs: number; sceneIdx?: number; words?: CaptionWordTime[] | null }
export interface Phrase { i: number; k: number; text: string; startMs: number; endMs: number; sceneIdx: number; words?: CaptionWordTime[] }
export interface SplitPhrasesOpts { maxWords?: number; minWords?: number; maxSyllables?: number; minShowMs?: number }

export const PHRASE_MAX_WORDS = 4;
export const PHRASE_MIN_WORDS = 2;
export const PHRASE_MAX_SYLLABLES = 12;
export const PHRASE_MIN_SHOW_MS = 700;
export const PHRASE_CONJUNCTIONS = ["그런데", "그래서", "하지만", "근데", "그러니까", "그럼", "즉", "결국"] as const;
export const PHRASE_CONNECTIVE_ENDINGS = ["는데", "인데", "은데", "지만", "라서", "니까", "고", "며", "서", "면"] as const;
export const BREAK_RANK = { punct: 1, conjunction: 2, connective: 3, plain: 4 } as const;
const BREAK_COST: Record<number, number> = { 1: 0, 2: 1, 3: 2, 4: 8 };
const PHRASE_SOFT_SYLLABLES = 8;
const PENALTY_SINGLE_WORD = 40, PENALTY_TOO_SHORT = 20, PENALTY_SINGLE_TOO_LONG = 100;

export function phraseSyllables(text: unknown): number { return (String(text ?? "").match(/[가-힣0-9A-Za-z]/g) ?? []).length; }
function hangulBody(word: string): string { return String(word ?? "").replace(/[^가-힣0-9A-Za-z]/g, ""); }
function endsWithPunct(word: string): boolean { return /[,.?!…]["'”’)\]]*$/.test(String(word ?? "")); }
function isConjunction(word: string): boolean { const b = hangulBody(word); if (!b) return false; for (const c of PHRASE_CONJUNCTIONS) { if (b === c) return true; if (c.length >= 2 && b.startsWith(c)) return true; } return false; }
function hasConnectiveEnding(word: string): boolean { const b = hangulBody(word); if (!b || b.length < 2) return false; return PHRASE_CONNECTIVE_ENDINGS.some((e) => b.endsWith(e)); }
export function breakRank(prevWord: string, nextWord: string): number {
  if (endsWithPunct(prevWord)) return BREAK_RANK.punct;
  if (isConjunction(nextWord)) return BREAK_RANK.conjunction;
  if (hasConnectiveEnding(prevWord)) return BREAK_RANK.connective;
  return BREAK_RANK.plain;
}
function mass(text: unknown): number { return Math.max(1, hangulBody(String(text ?? "")).length); }
/** 누적 글자 질량 단조 시계 — 타임스탬프 단위 위에 원문 누적 비율을 얹는다(정수 교차곱 비교 · 어절 수가 같으면 원본 시각 그대로). */
function massClock(units: CaptionWordTime[] | null | undefined, startMs: number, endMs: number): (cum: number, total: number) => number {
  const arr = (units ?? []).filter((u) => u && Number.isFinite(u.startMs) && Number.isFinite(u.endMs) && u.endMs >= u.startMs);
  const lens = arr.map((u) => mass(u.text)); const totalT = lens.reduce((a, b) => a + b, 0);
  if (!arr.length || totalT <= 0) { const span = Math.max(0, endMs - startMs); return (cum, total) => Math.round(startMs + (total > 0 ? Math.max(0, Math.min(1, cum / total)) : 0) * span); }
  const cumT: number[] = [0]; for (const l of lens) cumT.push(cumT[cumT.length - 1] + l);
  return (cum, total) => {
    if (total <= 0 || cum <= 0) return arr[0].startMs;
    if (cum >= total) return arr[arr.length - 1].endMs;
    let k = 0; while (k < arr.length - 1 && cum * totalT >= cumT[k + 1] * total) k++;
    const u = arr[k]; const local = (cum * totalT - cumT[k] * total) / Math.max(1, lens[k] * total);
    return Math.round(u.startMs + Math.max(0, Math.min(1, local)) * (u.endMs - u.startMs));
  };
}
/** 원문 어절에 시각(절대 ms) — start=그 어절 첫 글자 시각 · end=다음 어절 start(마지막=문장 end). */
export function alignWordTimes(line: PhraseLineIn): CaptionWordTime[] {
  const eojeol = String(line.text ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!eojeol.length) return [];
  const clock = massClock(line.words, line.startMs, line.endMs);
  const lens = eojeol.map(mass); const total = lens.reduce((a, b) => a + b, 0);
  const out: CaptionWordTime[] = []; let cum = 0;
  for (let k = 0; k < eojeol.length; k++) { out.push({ text: eojeol[k], startMs: clock(cum, total), endMs: 0 }); cum += lens[k]; }
  for (let k = 0; k < out.length; k++) out[k].endMs = k < out.length - 1 ? out[k + 1].startMs : line.endMs;
  return out;
}
/** splitPhrases — 문장 1개 → 구절(최소 비용 분할). */
export function splitPhrases(line: PhraseLineIn, opts?: SplitPhrasesOpts): Phrase[] {
  const maxW = Math.max(1, Math.round(Number(opts?.maxWords) || PHRASE_MAX_WORDS));
  const minW = Math.max(1, Math.round(Number(opts?.minWords) || PHRASE_MIN_WORDS));
  const maxS = Math.max(1, Math.round(Number(opts?.maxSyllables) || PHRASE_MAX_SYLLABLES));
  const minMs = Math.max(0, Math.round(Number(opts?.minShowMs ?? PHRASE_MIN_SHOW_MS)));
  const sceneIdx = Number.isFinite(Number(line.sceneIdx)) ? Number(line.sceneIdx) : line.i;
  const w = alignWordTimes(line); const n = w.length; if (!n) return [];
  const groupStart = (a: number) => (a === 0 ? line.startMs : w[a].startMs);
  const groupEnd = (b: number) => (b === n ? line.endMs : w[b].startMs);
  const syl = w.map((x) => phraseSyllables(x.text));
  const best = new Array<number>(n + 1).fill(Number.POSITIVE_INFINITY); const from = new Array<number>(n + 1).fill(-1); best[0] = 0;
  for (let j = 1; j <= n; j++) {
    for (let a = Math.max(0, j - maxW); a < j; a++) {
      if (!Number.isFinite(best[a])) continue;
      const size = j - a; let s = 0; for (let k = a; k < j; k++) s += syl[k];
      let cost = best[a] + (a > 0 ? BREAK_COST[breakRank(w[a - 1].text, w[a].text)] : 0);
      cost += Math.max(0, s - PHRASE_SOFT_SYLLABLES) * 2;
      if (s > maxS) { if (size > 1) continue; cost += PENALTY_SINGLE_TOO_LONG; }
      if (size < minW && n >= minW) cost += PENALTY_SINGLE_WORD;
      if (groupEnd(j) - groupStart(a) < minMs) cost += PENALTY_TOO_SHORT;
      if (cost < best[j]) { best[j] = cost; from[j] = a; }
    }
  }
  const cuts: number[] = []; for (let j = n; j > 0; j = from[j]) cuts.push(from[j]); cuts.reverse();
  const out: Phrase[] = [];
  for (let k = 0; k < cuts.length; k++) {
    const a = cuts[k], b = k + 1 < cuts.length ? cuts[k + 1] : n;
    const startMs = groupStart(a), endMs = groupEnd(b);
    const words = w.slice(a, b).map((x, wi) => ({ text: x.text, startMs: wi === 0 ? Math.min(x.startMs, startMs) : x.startMs, endMs: x.endMs }));
    out.push({ i: line.i, k, text: w.slice(a, b).map((x) => x.text).join(" "), startMs, endMs, sceneIdx, ...(words.length ? { words } : {}) });
  }
  return out;
}
export function splitPhrasesForLines(lines: PhraseLineIn[], opts?: SplitPhrasesOpts): Phrase[] {
  return [...(lines ?? [])].sort((a, b) => a.startMs - b.startMs).flatMap((l) => splitPhrases(l, opts));
}
export function srtTime(ms: number): string {
  const t = Math.max(0, Math.round(Number(ms) || 0));
  const h = Math.floor(t / 3600000), m = Math.floor((t % 3600000) / 60000), s = Math.floor((t % 60000) / 1000), f = t % 1000;
  const p2 = (v: number) => String(v).padStart(2, "0");
  return `${p2(h)}:${p2(m)}:${p2(s)},${String(f).padStart(3, "0")}`;
}
export function phrasesToSrt(phrases: Phrase[]): string {
  return [...(phrases ?? [])].sort((a, b) => a.startMs - b.startMs).map((p, k) => `${k + 1}\n${srtTime(p.startMs)} --> ${srtTime(p.endMs)}\n${p.text}\n`).join("\n");
}
/** 구절 → 렌더 phrases(계약 §2.1) — keyword 는 구절 안 가장 긴 명사형 어절(대형 키워드 중앙 배치 재료). */
export function phrasesToRender(phrases: Phrase[]): RenderPhrase[] {
  return phrases.map((p, idx) => {
    const kw = p.text.split(" ").map((w) => hangulBody(w)).filter((w) => w.length >= 2).sort((a, b) => b.length - a.length)[0];
    return { idx, text: p.text, startMs: p.startMs, endMs: p.endMs, ...(kw ? { keyword: kw } : {}) };
  });
}
