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
  /* [R8-A §4] 식품·의료 축 보강 — 실제 제재는 «질병 예방·치료 효능 인식»(식품표시광고법 §8)과 «치료 효과 보장»(의료법 §56)에서 난다. */
  medical_exaggeration: ["암완치", "당뇨완치", "탈모완치", "부작용없음", "즉효", "만병통치", "다이어트약", "성기확대", "정력제", "비아그라", "처방없이",
    "질병치료", "치료효과보장", "암예방", "고혈압치료", "당뇨치료", "관절염치료", "비급여할인", "시술후기", "수술후기", "환자후기"],
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

/* ═══ [R8-A §4] 건강·의료·식품 «소재» 판정 — 표현이 아니라 주제 축 ═══
   🔴 왜 필요한가: 의료법 §56·시행령 §23 은 **환자 치료경험담 자체**를 막는다("환자에 관한 치료경험담 등 소비자로 하여금
      치료 효과를 오인하게 할 우려가 있는 내용"). 그런데 우리 네이버 계약의 기본 구성이 **경험담(story)**이라,
      건강·의료 소재가 오면 **구조적으로** 위험한 글이 나온다. 그래서 소재 단계에서 주제를 알아보고 구성을 가른다.
   판정은 낱말 목록 부분 일치(정규화 뒤) — 오탐이 나면 이 목록만 고친다. LLM 0 · 순수. */
export const HEALTH_TOPIC_TERMS: readonly string[] = [
  "병원", "의원", "한의원", "치과", "피부과", "성형", "시술", "수술", "진료", "처방", "약국", "의약품", "영양제", "건강기능식품",
  "다이어트", "체중감량", "혈압", "혈당", "당뇨", "고지혈증", "관절", "탈모", "치료", "증상", "질환", "통증", "면역력", "항암", "암",
];
/** 이 소재가 건강·의료·식품 축인가(제목·앵글·검색어를 한 번에 넘긴다). */
export function isHealthTopic(text: unknown): boolean {
  const blob = normalizeForBanScan(text);
  if (!blob) return false;
  return HEALTH_TOPIC_TERMS.some((w) => blob.includes(normalizeForBanScan(w)));
}
/** 건강·의료 소재에서 **쓰면 안 되는 구성**(경험담·후기 형식) — `pickFormat` 이 이 목록을 뺀다. */
export const HEALTH_FORBIDDEN_FORMATS: readonly string[] = ["story", "review"];
