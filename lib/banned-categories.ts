/**
 * lib/banned-categories.ts — 금칙 **카테고리** 사전(계약 §1.5 · DESIGN §19 운영 «남용 방지»). 🔴 상수 한 곳.
 *   R1 `lib/banned-words.ts`(광고법 표현 · 최상급)와 **다른 축**이다: 그쪽은 «표현», 여기는 «주제». 성인·도박·의료 과장·타인 비방 소재는
 *   소재 단계(후보 생성·소재 뽑기·수동 배정)에서 **거부 + 감사**(`topic_banned_category`) — 글이 만들어져 코인이 나가기 전에 자른다.
 *   판정은 정규화(공백·기호 제거 · 소문자) 후 부분 일치. 오탐이 나면 이 사전만 고친다(코드 여러 곳을 뒤지지 않게).
 */
import { normalizeForBanScan } from "./banned-words";

export type BannedCategory = "adult" | "gambling" | "medical_exaggeration" | "defamation" | "illegal";
export const BANNED_CATEGORY_LABEL: Readonly<Record<BannedCategory, string>> = {
  adult: "성인·선정", gambling: "도박·사행성", medical_exaggeration: "의료·건강 과장", defamation: "타인 비방·혐오", illegal: "불법·위험",
};
/** 카테고리별 키워드(정규화 뒤 비교 · 짧은 낱말은 오탐이 커서 두 글자 이상 조합으로). */
export const BANNED_CATEGORIES: Readonly<Record<BannedCategory, readonly string[]>> = {
  adult: ["성인용품", "야동", "포르노", "음란", "섹스", "성매매", "유흥업소", "출장안마", "조건만남", "19금"],
  gambling: ["토토사이트", "사설토토", "바카라", "카지노사이트", "슬롯머신", "홀덤", "먹튀", "배팅사이트", "경마사이트", "복권당첨번호"],
  medical_exaggeration: ["암완치", "당뇨완치", "탈모완치", "부작용없음", "즉효", "만병통치", "다이어트약", "성기확대", "정력제", "비아그라", "처방없이"],
  defamation: ["병신", "쓰레기같은", "죽어라", "인간말종", "극혐", "저격", "신상털기", "매국노"],
  illegal: ["대포통장", "대포폰", "불법대출", "작업대출", "마약", "필로폰", "대마초", "총기구매", "위조", "짝퉁판매", "해킹프로그램", "개인정보판매"],
};

export interface BannedHit { category: BannedCategory; label: string; word: string }
/** 제목·앵글·검색어를 한 번에 넘긴다. 첫 매칭을 돌려준다(없으면 null). */
export function findBannedCategory(text: unknown): BannedHit | null {
  const blob = normalizeForBanScan(text);
  if (!blob) return null;
  for (const [cat, words] of Object.entries(BANNED_CATEGORIES) as [BannedCategory, readonly string[]][]) {
    for (const w of words) if (blob.includes(normalizeForBanScan(w))) return { category: cat, label: BANNED_CATEGORY_LABEL[cat], word: w };
  }
  return null;
}
