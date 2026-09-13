/**
 * lib/banned-words.ts — 표시·광고법 금칙어 사전 + findBannedWord. AM 원본: ../AutoMarketing/lib/ad-law-banned.ts (사전·정규화·findBannedWord 발췌 복사 2026-09-14 · 수익 약속 축은 안 가져옴)
 *   순수 리프(임포트 0). 정규화 = NFKC + 제로폭·공백·구두점 제거(«보 장»·«보.장» 우회 차단).
 *   소비처: topics(앵글 필터) · ai-tell-gate(superlative) · pieces-approve(banned_words 재검사 · DESIGN §16B.3 애드포스트 «광고법 금칙어»).
 */

/** 표시·광고법/과장 금칙(AM 단일출처 값 그대로). */
export const AD_LAW_BANNED = ["최저가", "전국 최저", "100%", "무조건", "평생", "보장", "1위", "최고의", "유일", "독보적", "절대"];

/** AC 추가 — 블로그 글에서 자주 나오는 근거 없는 최상급·확정 표현(의료·효능 과장 포함 · §16B.3 애드포스트/애드센스). */
export const BLOG_EXTRA_BANNED = ["국내 최초", "세계 최초", "업계 최고", "완치", "부작용 없음", "즉시 효과", "확실한 효과", "100퍼센트", "역대급", "끝판왕"];

/** 대조 전 정규화 — NFKC + 제로폭·공백·구두점 제거. 금칙어 자신도 같은 함수를 통과시켜 비교한다. */
export function normalizeForBanScan(text: unknown): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿­᠎]/g, "")
    .replace(/\s+/g, "")
    .replace(/[·ㆍ・.,;:!?~^*_\-–—/\\|'"`()[\]{}<>«»「」]/g, "");
}

/** findBannedWord — 정규화 후 금칙어 대조. 걸리면 원문 금칙어(사람이 읽는 사유용). */
export function findBannedWord(text: unknown, extra: readonly string[] = []): string | null {
  const blob = normalizeForBanScan(text);
  if (!blob) return null;
  for (const w of [...AD_LAW_BANNED, ...extra]) {
    const n = normalizeForBanScan(w);
    if (n && blob.includes(n)) return w;
  }
  return null;
}

/** 전부 찾기(게이트 detail 용 · 중복 제거). */
export function findBannedWords(text: unknown, extra: readonly string[] = []): string[] {
  const blob = normalizeForBanScan(text);
  if (!blob) return [];
  const out: string[] = [];
  for (const w of [...AD_LAW_BANNED, ...extra]) { const n = normalizeForBanScan(w); if (n && blob.includes(n) && !out.includes(w)) out.push(w); }
  return out;
}
