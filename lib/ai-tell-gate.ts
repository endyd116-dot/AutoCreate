/**
 * lib/ai-tell-gate.ts — «사람이 쓴 것처럼» 코드 게이트(DESIGN §5C.2 표 전부 + §16B 4검사 = GateKey 12 · 계약 v1.1 순서 고정).
 *   AM 원본: ../AutoMarketing/lib/content-director.ts §5-7(checkDirectorGates 관례) · content-channels AI_CLICHE_PATTERNS · ad-law-banned (2026-09-14 이식 · 사전은 AC 60개로 확장)
 *
 *   | key | 검사 | 임계 |
 *   | cliche | 상투 표현 사전 60개(CLICHES) | 0건 |
 *   | para_repeat | 같은 어절로 시작하는 문단(중복 수 Σ(count-1)) | ≤1 |
 *   | bullet_ratio | 불릿(list·checklist) 글자 ÷ 본문 글자 | ≤30% |
 *   | sentence_variance | 문장 길이(글자) 표준편차 | ≥ 9 — 근거: 사람이 쓴 한국어 블로그 문장은 8~60자 사이를 오가 표본 stdev 12~18, 기계 단조 문장은 6~8. 그 사이 보수값(운영 실측 후 조정) |
 *   | translationese | 번역투(TRANSLATIONESE 패턴 합) | ≤3 |
 *   | superlative | 근거 없는 최상급·확정(광고법 금칙 + 최고/1위/100%/완벽) | 0 |
 *   | persona | 페르소나 사정 어휘 ≥1 등장 | ≥1 |
 *   | visual_min | 채널 계약 visualMin(네이버 quote1·divider1·image6 / 티스토리 h2 3·table|list 1·adsense 2 …) | 충족 |
 *   | disclosure | 제휴면 첫 블록 = 정본 고지(lib/disclosure) | 통과 |
 *   | banned_words | 광고법 금칙어(lib/banned-words + BLOG_EXTRA) | 0 |
 *   | similarity | 같은 brief·같은 계정 30일 글과 2-gram 자카드 | < 0.45 |
 *   | affiliate_count | 제휴 링크(affiliate 블록 + 본문 링크) | ≤2 |
 *   걸리면 «재작성 지시문»(buildRewriteInstruction)으로 1회 재생성 · 재실패는 in_review 로 사람에게(gate_report).
 *   순수 모듈(DB·AI 0).
 */
import type { Block } from "./blocks";
import { blocksToPlain } from "./blocks";
import type { WritingContract } from "./writing-contracts";
import { checkDisclosure } from "./disclosure";
import { findBannedWords, BLOG_EXTRA_BANNED, normalizeForBanScan } from "./banned-words";
import { SAME_BODY_SIMILARITY } from "./similarity";

export type GateKey = "cliche" | "para_repeat" | "bullet_ratio" | "sentence_variance" | "translationese" | "superlative" | "persona" | "visual_min" | "disclosure" | "banned_words" | "similarity" | "affiliate_count";
export const GATE_KEYS: GateKey[] = ["cliche", "para_repeat", "bullet_ratio", "sentence_variance", "translationese", "superlative", "persona", "visual_min", "disclosure", "banned_words", "similarity", "affiliate_count"];
export const GATE_LABEL: Record<GateKey, string> = {
  cliche: "상투 표현 없음", para_repeat: "문단 시작이 다양함", bullet_ratio: "불릿이 본문을 대신하지 않음", sentence_variance: "문장 길이가 살아 있음",
  translationese: "번역투 없음", superlative: "근거 없는 최상급 없음", persona: "내 사정이 들어감", visual_min: "채널 시각 요소 충족",
  disclosure: "제휴 고지 첫머리", banned_words: "광고법 금칙어 없음", similarity: "다른 글과 겹치지 않음", affiliate_count: "제휴 링크 2개 이하",
};
export interface GateCheck { key: GateKey; label: string; pass: boolean; detail?: string }
export interface GateReport {
  ok: boolean; checks: GateCheck[]; rewritten: boolean;
  /** [P1R5 §1.4-6] 영상 심사 결과 — «GateKey 12 중 영상에 해당하는 것 + judge». 글 piece 에는 없다.
   *  모양은 `lib/video/types.ts JudgeResult` 와 구조적으로 같다(여기서 video 를 import 하지 않으려고 구조로만 적는다 · AC-17). */
  judge?: { grade: "P0" | "P1" | "P2"; axes: { key: string; label: string; pass: boolean; grade: "P0" | "P1" | "P2"; detail?: string }[]; repaired?: boolean };
}

/** 상투 표현 사전 60개 — 「~에 대해 알아보겠습니다」류 도입·마무리·강조 상투구. 정규식(어미 변형 흡수). */
export const CLICHES: { re: RegExp; label: string }[] = [
  { re: /에\s*대해\s*알아보(겠습니다|도록\s*하겠습니다|아요|겠어요|자|려고\s*합니다)/, label: "~에 대해 알아보겠습니다" },
  { re: /에\s*대해서?\s*(자세히|간단히)?\s*살펴보(겠습니다|도록|아요|겠어요)/, label: "~에 대해 살펴보겠습니다" },
  { re: /마무리하(며|면서|겠습니다)/, label: "마무리하며" },
  { re: /오늘은\s*[^.\n]{0,20}(를|을)\s*소개/, label: "오늘은 ~를 소개" },
  { re: /하는\s*것이\s*중요합니다/, label: "~하는 것이 중요합니다" },
  { re: /에\s*있어서/, label: "~에 있어서" },
  { re: /함에\s*따라/, label: "~함에 따라" },
  { re: /[을를]\s*통해/, label: "~을 통해" },
  { re: /알아두면\s*(좋은|유용한)/, label: "알아두면 좋은" },
  { re: /도움이\s*되(셨길|셨으면|었으면|기를)\s*(바랍니다|바라요|합니다)/, label: "도움이 되셨길 바랍니다" },
  { re: /참고하시(면|길)\s*(좋겠|바랍)/, label: "참고하시길 바랍니다" },
  { re: /함께\s*(알아|살펴)보(아요|시죠|겠습니다|도록)/, label: "함께 알아보아요" },
  { re: /지금\s*바로|오늘\s*바로/, label: "지금 바로" },
  { re: /망설이지\s*마(세요|시고)/, label: "망설이지 마세요" },
  { re: /추천\s*드(려요|립니다|리고)/, label: "추천드려요" },
  { re: /어떠(실까요|신가요)\?|어떨까요\?/, label: "어떠실까요?" },
  { re: /꼭\s*필요한|반드시\s*필요한|필수적으로/, label: "꼭 필요한" },
  { re: /많은\s*분들이|대부분의\s*분들이/, label: "많은 분들이" },
  { re: /여러분(도|께서|들은)/, label: "여러분" },
  { re: /이처럼|이렇듯/, label: "이처럼" },
  { re: /앞서\s*(말씀드린|언급한)\s*(것|바)?처럼/, label: "앞서 말씀드린 것처럼" },
  { re: /결론적으로/, label: "결론적으로" },
  { re: /종합적으로\s*(보면|판단)/, label: "종합적으로 보면" },
  { re: /다양한\s*(방법|정보|측면|경험)/, label: "다양한 ~" },
  { re: /효과적(으로|인)\s*(활용|관리|방법)/, label: "효과적으로 활용" },
  { re: /중요한\s*역할을\s*(합니다|해요|한다)/, label: "중요한 역할을 합니다" },
  { re: /긍정적인\s*영향/, label: "긍정적인 영향" },
  { re: /삶의\s*질/, label: "삶의 질" },
  { re: /현대\s*사회|현대인들/, label: "현대 사회" },
  { re: /바쁜\s*일상\s*속/, label: "바쁜 일상 속" },
  { re: /최근\s*들어\s*많은/, label: "최근 들어 많은" },
  { re: /고민이\s*많으실\s*텐데요/, label: "고민이 많으실 텐데요" },
  { re: /궁금하신\s*분들?(을|이)\s*위해/, label: "궁금하신 분들을 위해" },
  { re: /정리해\s*(보았습니다|봤습니다|드리겠습니다|드릴게요)/, label: "정리해 보았습니다" },
  { re: /소개해\s*드리(겠습니다|도록|려고)/, label: "소개해 드리겠습니다" },
  { re: /말씀드리(겠습니다|자면|고자)/, label: "말씀드리겠습니다" },
  { re: /하시기\s*바랍니다/, label: "하시기 바랍니다" },
  { re: /것을\s*권장(합니다|드립니다)/, label: "것을 권장합니다" },
  { re: /하시는\s*것이\s*좋습니다/, label: "하시는 것이 좋습니다" },
  { re: /하는\s*것이\s*바람직/, label: "하는 것이 바람직" },
  { re: /할\s*수\s*있을\s*것입니다/, label: "할 수 있을 것입니다" },
  { re: /라고\s*할\s*수\s*있습니다/, label: "라고 할 수 있습니다" },
  { re: /간과해서는\s*안/, label: "간과해서는 안" },
  { re: /주목받고\s*있(습니다|어요)/, label: "주목받고 있습니다" },
  { re: /각광받/, label: "각광받는" },
  { re: /트렌드로\s*자리\s*잡/, label: "트렌드로 자리 잡" },
  { re: /필수\s*아이템/, label: "필수 아이템" },
  { re: /핫한|핫플/, label: "핫한" },
  { re: /가성비\s*갑/, label: "가성비 갑" },
  { re: /인생\s*(템|아이템)/, label: "인생템" },
  { re: /강력\s*추천/, label: "강력 추천" },
  { re: /후회\s*없(는|을)\s*선택/, label: "후회 없는 선택" },
  { re: /놓치지\s*마세요/, label: "놓치지 마세요" },
  { re: /꿀팁/, label: "꿀팁" },
  { re: /총정리해\s*드/, label: "총정리해 드" },
  { re: /함께\s*하세요|함께해요/, label: "함께하세요" },
  { re: /행복한\s*하루\s*되세요|좋은\s*하루\s*되세요/, label: "좋은 하루 되세요" },
  { re: /끝까지\s*읽어\s*주셔서/, label: "끝까지 읽어 주셔서" },
  { re: /다음\s*(글|포스팅)에서\s*(만나|뵙)/, label: "다음 글에서 만나요" },
  { re: /궁금한\s*점은\s*댓글/, label: "궁금한 점은 댓글" },
];

/** 번역투 — «~에 의해» «~되어지다» «~의 경우» «~에 대한» «~에 관하여» «~로 인해» «~에 있어» (cliche 와 겹치는 3종은 cliche 가 먼저 센다). */
/**
 * [2026-09-15 §5C.2] 사진 캡션 **묘사문** 패턴 — 이런 캡션은 사람이 쓴 게 아니라 **그림 생성 프롬프트**가 새어 나온 것이다.
 *   사장님 실측: «원목 테이블 위에 정갈하게 포장된 명절 선물 상자가 놓여 있는 모습» 이 그대로 발행됐다.
 *   사람 캡션은 감상·맥락이다(«팀원들 줄 거라 포장 예쁜 걸로 골랐어요» · «이게 3만원대라니»). `content-gen.fixBlocks` 가 생성 단계에서 **떨어뜨리고**,
 *   여기서는 손으로 고친 HTML 까지 다시 잰다(cliche 축).
 */
export const DESCRIPTIVE_CAPTION: { re: RegExp; label: string }[] = [
  { re: /(는|은|인|된|한|의)\s*모습[.!…]?$/, label: "~하는 모습" },
  { re: /놓여\s*(있|져\s*있)/, label: "~이 놓여 있는" },
  { re: /보여\s*주(는|고\s*있)/, label: "~를 보여주는" },
  { re: /담(긴|고\s*있는|아낸)\s*(장면|모습|사진|이미지|컷)/, label: "~을 담은 장면" },
  { re: /(장면|풍경|이미지|사진|정경|전경)[.!…]?$/, label: "~장면·풍경 으로 끝남" },
  { re: /클로즈업|배경으로\s*(한|하는)|위에\s*(정갈|가지런|나란|깔끔)(하|히)|근접\s*촬영/, label: "묘사 관용구" },
  // [2026-09-15 C · R6.5 음성 대조] «놓인·걸린·펼쳐진·담긴 + 장소» 도 묘사문이다 — «선물이 가지런히 놓인 테이블» 이 빠져나갔다.
  { re: /(있는|하는|되는|된|놓인|걸린|펼쳐진|담긴|쌓인)\s*(테이블|책상|주방|거실|공간|선반|바닥|책상\s*위)[.!…]?$/, label: "장소로 끝나는 묘사" },
];
/** 캡션이 묘사문이면 걸린 라벨, 아니면 null. */
export function descriptiveCaptionHit(caption: string): string | null {
  const s = String(caption ?? "").trim();
  if (!s) return null;
  for (const p of DESCRIPTIVE_CAPTION) if (p.re.test(s)) return p.label;
  return null;
}

export const TRANSLATIONESE: RegExp[] = [/에\s*의해/g, /되어지(다|고|는|ㅁ)/g, /의\s*경우(에는|에|,)/g, /에\s*대한\s/g, /에\s*관하여/g, /로\s*인해/g, /을\s*가지고\s*있/g, /것으로\s*보(여|입)/g, /하기\s*위한\s/g, /적인\s*측면/g];

const SUPERLATIVE_RE = /최고|최상|1위|일위|100%|100퍼센트|완벽|절대적|무조건|유일한|압도적|끝판왕|역대급|전국\s*최저|최저가/;

function sentencesOf(text: string): string[] {
  return text.replace(/\n+/g, " ").split(/(?<=[.!?…。]|다\.|요\.|죠\.)\s+/).map((s) => s.trim()).filter((s) => s.length >= 2);
}
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
}

export interface GateInput {
  blocks: Block[];
  contract: WritingContract;
  /** 페르소나 사정 어휘(프로필 값을 어절로 쪼갠 것). */
  personaTerms: string[];
  meta: { affiliate?: unknown; adDisclosure?: boolean } | null;
  /** 유사도(호출부가 계산 · 없으면 0). */
  similarity?: { score: number; against?: string };
  /** 제목(최상급·금칙어 검사에 포함). */
  title?: string;
}

export function runGate(inp: GateInput): GateReport {
  const { blocks, contract } = inp;
  const plain = blocksToPlain(blocks);
  const withTitle = `${inp.title ?? ""}\n${plain}`;
  const checks: GateCheck[] = [];
  const push = (key: GateKey, pass: boolean, detail?: string) => { const c: GateCheck = { key, label: GATE_LABEL[key], pass }; if (detail) c.detail = detail; checks.push(c); };

  // cliche — 본문 상투구 + [2026-09-15 §5C] **사진 캡션의 묘사문**(«~놓여 있는 모습» = 그림 지시문이 캡션으로 새어 나온 것 · 사장님 실측 piece 329)
  const hits = CLICHES.filter((c) => c.re.test(plain)).map((c) => c.label);
  for (const b of blocks) {
    if (b.type !== "image" || !b.caption) continue;
    const d = descriptiveCaptionHit(b.caption);
    if (d) hits.push(`사진 캡션이 묘사문(${d}): «${b.caption.slice(0, 20)}»`);
  }
  push("cliche", hits.length === 0, hits.length ? `${hits.length}건: ${hits.slice(0, 5).join(", ")}` : undefined);

  // para_repeat
  const paras = blocks.filter((b) => ["hook", "para", "tip"].includes(b.type) && b.text).map((b) => String(b.text).trim());
  const starts = new Map<string, number>();
  for (const p of paras) { const w = p.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, "") || ""; if (w.length >= 1) starts.set(w, (starts.get(w) ?? 0) + 1); }
  const rep = [...starts.entries()].filter(([, c]) => c > 1);
  const repCount = rep.reduce((a, [, c]) => a + (c - 1), 0);
  push("para_repeat", repCount <= 1, repCount > 1 ? `«${rep.map(([w, c]) => `${w}×${c}`).join(", ")}» 로 시작하는 문단이 반복돼요` : undefined);

  // bullet_ratio
  const bulletChars = blocks.filter((b) => b.type === "list" || b.type === "checklist").reduce((a, b) => a + (b.items ?? []).join("").length, 0);
  const total = Math.max(1, plain.replace(/\s+/g, "").length);
  const ratio = bulletChars / total;
  push("bullet_ratio", ratio <= 0.3, ratio > 0.3 ? `불릿이 본문의 ${Math.round(ratio * 100)}%예요(30% 이하)` : undefined);

  // sentence_variance
  const lens = sentencesOf(paras.join(" ")).map((s) => s.length);
  const sd = stdev(lens);
  const SD_MIN = 9;
  push("sentence_variance", lens.length < 4 || sd >= SD_MIN, lens.length >= 4 && sd < SD_MIN ? `문장 길이 편차 ${sd.toFixed(1)}(기준 ${SD_MIN}) — 문장이 다 비슷한 길이예요` : undefined);

  // translationese
  let tr = 0; const trHits: string[] = [];
  for (const re of TRANSLATIONESE) { re.lastIndex = 0; const m = plain.match(re); if (m) { tr += m.length; trHits.push(m[0].trim()); } }
  push("translationese", tr <= 3, tr > 3 ? `${tr}건: ${[...new Set(trHits)].slice(0, 4).join(", ")}` : undefined);

  // superlative
  const sup = withTitle.match(SUPERLATIVE_RE);
  push("superlative", !sup, sup ? `«${sup[0]}» — 근거 없는 최상급·확정 표현` : undefined);

  // persona
  const terms = inp.personaTerms.map((t) => t.trim()).filter((t) => t.length >= 2);
  const found = terms.filter((t) => plain.includes(t));
  push("persona", terms.length === 0 || found.length >= 1, terms.length && !found.length ? `내 사정(${terms.slice(0, 4).join("·")})이 한 곳도 안 들어갔어요` : undefined);

  // visual_min
  const cnt = (t: string) => blocks.filter((b) => b.type === t).length;
  const vm = contract.visualMin; const miss: string[] = [];
  if (vm.quote && cnt("quote") < vm.quote) miss.push(`인용구 ${cnt("quote")}/${vm.quote}`);
  if (vm.divider && cnt("divider") < vm.divider) miss.push(`구분선 ${cnt("divider")}/${vm.divider}`);
  if (vm.image && cnt("image") < vm.image) miss.push(`사진 ${cnt("image")}/${vm.image}`);
  if (vm.h2 && cnt("h2") < vm.h2) miss.push(`소제목 ${cnt("h2")}/${vm.h2}`);
  if (vm.tableOrList && cnt("table") + cnt("list") + cnt("checklist") < vm.tableOrList) miss.push(`표 또는 리스트 0/${vm.tableOrList}`);
  if (vm.adsense && cnt("adsense") < vm.adsense) miss.push(`광고 자리 ${cnt("adsense")}/${vm.adsense}`);
  if (vm.checklist && cnt("checklist") < vm.checklist) miss.push(`체크리스트 ${cnt("checklist")}/${vm.checklist}`);
  if (vm.faq && cnt("faq") < vm.faq) miss.push(`FAQ ${cnt("faq")}/${vm.faq}`);
  if (vm.hashtags) { const h = blocks.find((b) => b.type === "hashtags")?.items?.length ?? 0; if (h < vm.hashtags) miss.push(`해시태그 ${h}/${vm.hashtags}`); }
  push("visual_min", miss.length === 0, miss.length ? miss.join(" · ") : undefined);

  // disclosure
  const d = checkDisclosure(blocks, inp.meta);
  push("disclosure", d.ok, d.detail);

  // banned_words
  const banned = findBannedWords(withTitle, BLOG_EXTRA_BANNED);
  push("banned_words", banned.length === 0, banned.length ? banned.join(", ") : undefined);

  // similarity
  const sim = inp.similarity?.score ?? 0;
  push("similarity", sim < SAME_BODY_SIMILARITY, sim >= SAME_BODY_SIMILARITY ? `유사도 ${Math.round(sim * 100)}%(${inp.similarity?.against ?? "다른 글"})` : undefined);

  // affiliate_count
  const links = cnt("affiliate") + (plain.match(/https?:\/\/(link\.coupang|coupa\.ng|www\.coupang)/g)?.length ?? 0);
  push("affiliate_count", links <= 2, links > 2 ? `제휴 링크 ${links}개(2개 이하)` : undefined);

  return { ok: checks.every((c) => c.pass), checks, rewritten: false };
}

/** 실패 항목 → 재작성 지시문(프롬프트 앞에 붙인다 · 1회). */
export function buildRewriteInstruction(report: GateReport): string {
  const fails = report.checks.filter((c) => !c.pass);
  if (!fails.length) return "";
  const lines = fails.map((c) => {
    switch (c.key) {
      case "cliche": return `- 상투 표현을 전부 지워라(${c.detail}). «~에 대해 알아보겠습니다·마무리하며·오늘은 ~를 소개» 같은 도입·마무리 문구 없이 장면·사실로 바로 들어간다.`;
      case "para_repeat": return `- 문단 첫 어절이 겹친다(${c.detail}). 각 문단을 다른 말(시간·장소·판단·질문)로 시작해라.`;
      case "bullet_ratio": return `- 불릿이 너무 많다(${c.detail}). 리스트 항목의 절반을 문장으로 풀어 써라.`;
      case "sentence_variance": return `- 문장 길이가 다 비슷하다(${c.detail}). 5~10자 짧은 문장을 30% 섞고, 한 문장은 40자 넘게 이어 써라.`;
      case "translationese": return `- 번역투가 많다(${c.detail}). «~에 의해→~가», «~의 경우→~면», «~로 인해→~때문에» 처럼 한국어 어순으로 고쳐라.`;
      case "superlative": return `- 근거 없는 최상급(${c.detail})을 지워라. 비교급·구체 사실로 바꾼다.`;
      case "persona": return `- 내 사정이 안 들어갔다(${c.detail}). 페르소나 재료 중 1~2개를 실제 장면(언제·어디서)으로 자연스럽게 넣어라.`;
      case "visual_min": return `- 채널 시각 요소가 모자란다(${c.detail}). 구성 시퀀스의 블록 타입을 그대로 채워라.`;
      case "disclosure": return `- 제휴 고지가 첫 블록이어야 한다(${c.detail}).`;
      case "banned_words": return `- 광고법 금칙어(${c.detail})를 지워라.`;
      case "similarity": return `- 다른 글과 너무 비슷하다(${c.detail}). 도입 장면·소제목·예시를 전부 다른 관점으로 새로 써라(같은 문장 재사용 금지).`;
      case "affiliate_count": return `- 제휴 링크는 2개까지다(${c.detail}).`;
    }
  });
  return `[다시 쓰기 — 직전 원고가 아래 검사에 걸렸다. 같은 실수를 반복하면 이 글은 사람 검수로 넘어간다]\n${lines.join("\n")}\n`;
}
