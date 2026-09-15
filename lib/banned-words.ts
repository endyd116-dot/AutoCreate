/**
 * lib/banned-words.ts — 표시·광고 위험 표현 사전 + 판정기. AM 원본: ../AutoMarketing/lib/ad-law-banned.ts (사전·정규화·findBannedWord 발췌 복사 2026-09-14 · 수익 문구 제외).
 *   순수 리프(임포트 0). 정규화 = NFKC + 제로폭·공백·구두점 제거(«보 장»·«보.장» 우회 차단).
 *   소비처: topics(앵글 필터) · ai-tell-gate(superlative·banned_words) · pieces-approve(발행 직전 재검사).
 *
 *   ══ [R8-A §4] 🔴 «금칙어»라는 말이 틀렸다(2026-09-15 실조사) ══
 *     표시·광고의 공정화에 관한 법률 **제5조는 «금지 낱말 목록»이 아니라 «실증 책임»**이다 —
 *       «사업자등은 자기가 한 표시·광고 중 **사실과 관련한 사항에 대하여는 실증(實證)할 수 있어야 한다**»
 *       («1위·유일·최다» 같은 배타적 표현도 **명백히 입증 + 기준·방법을 명시**하면 쓸 수 있다).
 *     그래서 한 덩어리 사전을 **3층**으로 나눈다:
 *       ① `BANNED_HARD`        — 사실상 입증이 불가능하거나 다른 법이 정면으로 막는 표현 → **차단**
 *       ② `BANNED_NEEDS_PROOF` — 근거(기관·기간·수치)를 밝히면 쓸 수 있는 표현 → **근거 있으면 통과**(없으면 차단)
 *       ③ `BANNED_TONE`        — 법과 무관한 과장 어투(«역대급»·«끝판왕») → **감점만**(AI 티 축으로 이동)
 *     그리고 ④ `BANNED_HEALTH_CLAIM` — 식품·건강·의료 효능 표현. **대가를 받은 글(광고)이거나 건강 소재면 차단**,
 *       아니면 근거 요구(일반 정보 글의 «면역력»까지 무조건 막으면 과차단이라 상태를 봐서 가른다).
 *   근거: 표시광고법 §5 https://www.law.go.kr/법령/표시광고의공정화에관한법률 ·
 *         식품 등의 표시·광고에 관한 법률 §8(질병 예방·치료 효능 인식 / 식약처 미인정 기능성) ·
 *         의료법 §56·시행령 §23(치료 효과 보장 · **환자 치료경험담**) · 상세 = `docs/active/2026-09-15-R8A-voice-policy.md`.
 */

/** ① 무조건 차단 — 절대적·확정적 표현(실증 자체가 불가) + 치료 단정. */
export const BANNED_HARD = [
  "100%", "100퍼센트", "무조건", "절대", "평생", "보장",
  "완치", "부작용 없음", "부작용 0", "즉시 효과", "확실한 효과", "만병통치", "치료 효과를 보장",
] as const;

/** ② 근거 있으면 통과 — 배타적·최상급 표현(표시광고법 §5 «기준과 방법을 명시»). */
export const BANNED_NEEDS_PROOF = [
  "최저가", "전국 최저", "1위", "최고의", "유일", "독보적", "국내 최초", "세계 최초", "업계 최고", "최다",
] as const;

/** ③ 감점만 — 어느 법에도 없는 과장 어투(AI 티 축). */
export const BANNED_TONE = ["역대급", "끝판왕", "레전드", "미쳤다"] as const;

/**
 * ④ 식품·건강·의료 효능 — 광고(대가 받은 글)이거나 건강 소재면 **차단**, 아니면 근거 요구.
 *   🔴 의료법 §56 은 **환자 치료경험담 자체**를 막는다 — 그 축은 낱말이 아니라 «형식»이라 `lib/banned-categories.ts isHealthTopic`
 *      + `director-auto` 의 구성 선택에서 막는다(경험담 구성 금지).
 */
export const BANNED_HEALTH_CLAIM = [
  "면역력 강화", "항암", "암 예방", "혈압을 낮", "혈당 개선", "디톡스", "숙취 해소", "체지방 감소",
  "다이어트 보장", "질병 치료", "염증 제거", "성기능 개선",
] as const;

/** 옛 이름(호환) — R8-A 전 코드가 쓰던 두 묶음. 새 코드는 `classifyBanned` 를 쓴다. */
export const AD_LAW_BANNED: readonly string[] = [...BANNED_HARD, ...BANNED_NEEDS_PROOF];
export const BLOG_EXTRA_BANNED: readonly string[] = [...BANNED_HEALTH_CLAIM];

/** 대조 전 정규화 — NFKC + 제로폭·공백·구두점 제거. 금칙어 자신도 같은 함수를 통과시켜 비교한다. */
export function normalizeForBanScan(text: unknown): string {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿­᠎]/g, "")
    .replace(/\s+/g, "")
    .replace(/[·ㆍ・.,;:!?~^*_\-–—/\\|'"`()[\]{}<>«»「」]/g, "");
}

/** findBannedWord — 정규화 후 대조. 걸리면 원문 낱말(사람이 읽는 사유용). 옛 호출부 호환(기본 사전 = HARD + NEEDS_PROOF). */
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

/**
 * hasEvidenceNear — 그 낱말이 **근거와 함께** 쓰였나(표시광고법 §5 «기준과 방법을 명시»).
 *   판정(결정론 · LLM 0): 낱말이 들어간 **문장** 안에 ① 연도·기간(2024년·최근 3개월) ② 기관·출처(조사·통계·기준·발표·자료·따르면·출처·기관 이름)
 *   ③ 숫자+단위(명·건·개·%) 중 **둘 이상**이 있으면 «근거 있음».
 *   🔴 한 문장 안을 본다 — 글 어딘가에 연도가 있다고 통과시키면 «근거 요구»가 아무 것도 요구하지 않는 셈이 된다.
 */
export function hasEvidenceNear(text: unknown, word: string): boolean {
  const raw = String(text ?? "");
  const target = normalizeForBanScan(word);
  if (!target) return false;
  for (const sentence of raw.split(/(?<=[.!?\n])|(?<=다\.)/)) {
    if (!normalizeForBanScan(sentence).includes(target)) continue;
    let hit = 0;
    if (/(19|20)\d{2}\s*년|최근\s*\d+\s*(개월|년|주)|\d+\s*분기/.test(sentence)) hit++;
    if (/조사|통계|기준|발표|자료|따르면|출처|집계|리서치|공시|보고서/.test(sentence)) hit++;
    if (/\d[\d,.]*\s*(명|건|개|원|%|퍼센트|위)/.test(sentence)) hit++;
    if (hit >= 2) return true;
  }
  return false;
}

export type BanLayer = "hard" | "needs_proof" | "tone";
export interface BanHit { word: string; layer: BanLayer; law: string }
export interface BanContext {
  /** 대가를 받은 글인가(제휴·협찬·무상 제공) — 광고면 식품·건강 효능 표현이 바로 위법이 된다. */
  paid?: boolean;
  /** 건강·의료·식품 소재인가(`lib/banned-categories.ts isHealthTopic`). */
  health?: boolean;
  /**
   * [R8CLOSE-B1 §B3] 🔴 **이 계정에서 잡지 않을 요즘 말**(신조어 화이트리스트 · DESIGN §5C.4).
   *   표는 `lib/slang-whitelist.ts` 한 곳이다 — 🔴 **여기로 import 하지 않고 낱말만 받는다**:
   *   이 파일은 «순수 리프(임포트 0)»가 계약이고, 사전이 표를 끌어오면 그 계약이 깨진다.
   *   🔴 `tone` 층에만 먹는다. 법(`hard`·`needs_proof`)은 **연령대로 봐주지 않는다** — 20대라고 «100% 보장»이 되지 않는다.
   */
  allowSlang?: readonly string[];
}
const LAW = {
  hard: "표시광고법 §5(실증 책임) · 절대적 표현",
  proof: "표시광고법 §5 — 근거(기관·기간·수치)를 밝히면 쓸 수 있어요",
  health: "식품표시광고법 §8 · 의료법 §56(질병 예방·치료 효능)",
  tone: "법 금칙은 아니고 과장 어투",
} as const;

/**
 * classifyBanned — 본문을 3층으로 판정한다. 게이트는 `hard` 만 막고, `needs_proof` 는 **근거가 없을 때만** 막고, `tone` 은 감점이다.
 *   반환의 `law` 는 그대로 사람에게 보여 주는 사유가 된다(«무엇을 어기나»를 말해야 고객이 고친다).
 */
export function classifyBanned(text: unknown, ctx: BanContext = {}): { hard: BanHit[]; needsProof: BanHit[]; tone: BanHit[] } {
  const blob = normalizeForBanScan(text);
  const out = { hard: [] as BanHit[], needsProof: [] as BanHit[], tone: [] as BanHit[] };
  if (!blob) return out;
  const has = (w: string) => { const n = normalizeForBanScan(w); return !!n && blob.includes(n); };
  for (const w of BANNED_HARD) if (has(w)) out.hard.push({ word: w, layer: "hard", law: LAW.hard });
  for (const w of BANNED_HEALTH_CLAIM) {
    if (!has(w)) continue;
    if (ctx.paid || ctx.health) out.hard.push({ word: w, layer: "hard", law: LAW.health });
    else out.needsProof.push({ word: w, layer: "needs_proof", law: LAW.health });
  }
  for (const w of BANNED_NEEDS_PROOF) {
    if (!has(w)) continue;
    if (hasEvidenceNear(text, w)) continue;                 // 근거와 함께 쓰였으면 통과(법이 허용한다)
    out.needsProof.push({ word: w, layer: "needs_proof", law: LAW.proof });
  }
  /* [R8CLOSE-B1 §B3] 🔴 연령대에 맞는 요즘 말은 **과장 어투로 치지 않는다.**
     이 줄이 없으면 다음 사람이 신조어를 한 줄 넣는 순간 20대 계정 글이 반려되고 재작성이 돌아 **돈이 두 배**가 된다
     (2026-09-15 `visualMin.faq` 사고와 같은 모양 — 네이버 글 10편 중 8편 재작성). */
  const allow = new Set((ctx.allowSlang ?? []).map((w) => normalizeForBanScan(w)).filter(Boolean));
  for (const w of BANNED_TONE) if (has(w) && !allow.has(normalizeForBanScan(w))) out.tone.push({ word: w, layer: "tone", law: LAW.tone });
  return out;
}

/* ═══ [R8-A §4 · 사장님 지시 2026-09-15] 🔴 «유도»는 셋으로 갈린다 — 사전이 건드릴 곳은 ①뿐이다 ═══
     ① **광고를 가리키는 유도 = 금지**(애드센스 계정 정지 사유) — «아래 배너 눌러 주세요» «광고 보고 가세요».
     ② 우리 링크(제휴)로의 유도 = **허용** — 막을 것은 고지 누락·과장뿐(그건 disclosure·NEEDS_PROOF 가 맡는다).
     ③ 독자 행동으로의 유도(계속 읽기·저장·구독) = **더 해야 한다** — 애드센스 수익은 체류·노출에서 나온다.
        🔴 여기를 사전으로 막으면 글이 밍밍해지고 수익이 떨어진다(사장님: «애드센스는 **무분별한** 유도인 거고, 우리는 소구점 잡아서 유도시켜야지»).
        B-1 실측: 실물 한국 블로그는 끝맺음이 «행동 유도 한 문장»인데 우리 글은 FAQ 로 끝난다 — 우리는 유도가 **부족한** 쪽이다.
   그래서 판정을 **좁게** 만든다: «광고·배너·스폰서» 류 **지칭어**와 «클릭·눌러·확인» 류 **지시 동사**가 **같은 문장**에 있을 때만 잡는다.
   근거: Google 게시자 정책 https://support.google.com/adsense/answer/10502938 (광고 클릭 유도·광고를 본문처럼 위장 금지). */
const AD_NOUN_RE = /광고|배너|스폰서|애드센스|adsense|adfit|애드핏|애드포스트/i;
const CLICK_VERB_RE = /클릭|눌러|눌러서|터치|보고\s*가|보고\s*오|확인해\s*주|한\s*번\s*씩|봐\s*주세요|구경/;
const POSITION_RE = /아래|위|여기|하단|상단|밑에|이곳/;

export interface AdPointingHit { sentence: string; why: string }
/**
 * findAdPointing — «광고를 가리키는 표현»만 잡는다(독자 행동 유도는 **건드리지 않는다**).
 *   잡는 조건: 한 문장 안에 ①광고 지칭어 + ②클릭·시청 지시 동사. 위치어(아래·여기)가 같이 있으면 더 확실하지만 **필수는 아니다**.
 *   🔴 «이 글에는 광고가 포함되어 있습니다» 같은 **고지 문장은 잡지 않는다**(지시 동사가 없다).
 */
export function findAdPointing(text: unknown): AdPointingHit[] {
  const raw = String(text ?? "");
  const out: AdPointingHit[] = [];
  for (const sentence of raw.split(/(?<=[.!?\n])|(?<=다\.)|(?<=요\.)/)) {
    const s = sentence.trim();
    if (s.length < 4) continue;
    if (!AD_NOUN_RE.test(s) || !CLICK_VERB_RE.test(s)) continue;
    out.push({ sentence: s.slice(0, 80), why: POSITION_RE.test(s) ? "광고 위치를 가리키며 누르라고 한다" : "광고를 누르거나 보라고 한다" });
  }
  return out;
}
