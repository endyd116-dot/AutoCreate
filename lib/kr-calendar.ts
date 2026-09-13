/**
 * lib/kr-calendar.ts — 한국 절기·명절·행사 연간표(DESIGN §5C.4 · §5 seasonal 팩터). AC 신규(2026-09-14 · 순수 상수).
 *   음력 명절(설·추석)은 연도별 양력 표(2026~2028)로 둔다. 그 밖은 월 단위 고정.
 *   소비처: topics(LLM 재료 + seasonal 가중) · content-gen(③재료 «계절») · director(이유 문장).
 */
export interface KrEvent { key: string; label: string; months: number[]; /** 1~12 */ hint: string; weight: number }

export const KR_EVENTS: KrEvent[] = [
  { key: "newyear", label: "새해·신년 계획", months: [1], hint: "새해 목표·다이어리·운동 시작·정리", weight: 1.25 },
  { key: "seollal", label: "설 연휴", months: [1, 2], hint: "설 선물·차례 음식·귀성길·세뱃돈·명절 스트레스", weight: 1.35 },
  { key: "yearend_tax", label: "연말정산", months: [12, 1, 2], hint: "연말정산 환급·공제·홈택스", weight: 1.3 },
  { key: "school_start", label: "새 학기·입학", months: [2, 3], hint: "입학 준비물·새 학기 가방·학용품·이사철", weight: 1.2 },
  { key: "moving", label: "봄 이사철", months: [3, 4], hint: "이사 견적·전세·자취 시작·가전 구입", weight: 1.15 },
  { key: "spring_bloom", label: "벚꽃·봄나들이", months: [3, 4], hint: "벚꽃 명소·피크닉·미세먼지·환절기 알레르기", weight: 1.2 },
  { key: "children_day", label: "어린이날·가정의 달", months: [5], hint: "어린이날 선물·어버이날·카네이션·가족 나들이", weight: 1.3 },
  { key: "early_summer", label: "초여름·자외선", months: [5, 6], hint: "선크림·에어컨 청소·모기·캠핑 시작", weight: 1.1 },
  { key: "monsoon", label: "장마", months: [6, 7], hint: "제습기·곰팡이·빨래 냄새·우산·습기 관리", weight: 1.25 },
  { key: "summer_vacation", label: "여름휴가·폭염", months: [7, 8], hint: "휴가지·물놀이·폭염·전기요금·보양식", weight: 1.3 },
  { key: "chuseok", label: "추석 연휴", months: [9, 10], hint: "추석 선물세트·전 부치기·귀성·명절 음식 보관", weight: 1.35 },
  { key: "autumn", label: "가을·환절기", months: [9, 10], hint: "단풍·환절기 감기·이불 교체·가을 캠핑", weight: 1.15 },
  { key: "suneung", label: "수능", months: [10, 11], hint: "수능 도시락·수험생 선물·컨디션 관리", weight: 1.25 },
  { key: "kimjang", label: "김장", months: [11, 12], hint: "김장 재료·절임배추·김치냉장고", weight: 1.3 },
  { key: "heating", label: "난방·겨울 준비", months: [11, 12, 1], hint: "난방비·보일러·결로·가습기·패딩", weight: 1.2 },
  { key: "christmas", label: "크리스마스·연말", months: [12], hint: "크리스마스 선물·트리·연말 모임·송년회", weight: 1.3 },
  { key: "blackfriday", label: "연말 세일", months: [11], hint: "블랙프라이데이·직구·연말 할인", weight: 1.15 },
];

/** 음력 명절 양력 날짜(당일). 연도가 표에 없으면 months 기준으로만 판단. */
export const LUNAR_DATES: Record<string, Record<number, string>> = {
  seollal: { 2026: "2026-02-17", 2027: "2027-02-06", 2028: "2028-01-26" },
  chuseok: { 2026: "2026-09-25", 2027: "2027-09-15", 2028: "2028-10-03" },
};

const KST_OFFSET_MS = 9 * 3600 * 1000;
export function kstNow(now: Date = new Date()): Date { return new Date(now.getTime() + KST_OFFSET_MS); }
export function kstMonth(now: Date = new Date()): number { return kstNow(now).getUTCMonth() + 1; }

/** 이달·다음달 행사(LLM 재료 문장용). */
export function upcomingEvents(now: Date = new Date()): KrEvent[] {
  const m = kstMonth(now); const next = (m % 12) + 1;
  return KR_EVENTS.filter((e) => e.months.includes(m) || e.months.includes(next));
}

/** 소재 제목·앵글에 행사어가 들어 있고 지금이 그 시즌이면 가중(§5 seasonal 팩터). 없으면 1.0. 매칭 라벨도 돌려준다. */
export function seasonalFor(text: string, now: Date = new Date()): { weight: number; label: string | null } {
  const m = kstMonth(now); const t = String(text || "");
  let best: KrEvent | null = null;
  for (const e of KR_EVENTS) {
    if (!e.months.includes(m)) continue;
    const words = [e.label.split(/[·]/)[0], ...e.hint.split(/[·]/)].map((w) => w.trim()).filter((w) => w.length >= 2);
    if (words.some((w) => t.includes(w))) { if (!best || e.weight > best.weight) best = e; }
  }
  return best ? { weight: best.weight, label: best.label } : { weight: 1.0, label: null };
}

/** 프롬프트 재료 한 줄: «지금은 9월 — 추석 연휴(추석 선물세트·전 부치기…), 가을·환절기(…)». */
export function seasonLine(now: Date = new Date()): string {
  const ev = upcomingEvents(now);
  const m = kstMonth(now);
  if (!ev.length) return `지금은 ${m}월`;
  return `지금은 ${m}월 — ` + ev.map((e) => `${e.label}(${e.hint})`).join(" · ");
}
