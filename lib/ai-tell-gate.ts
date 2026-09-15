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
import { blocksToPlain, blocksCharCount } from "./blocks";
import type { WritingContract, TopicGroup } from "./writing-contracts";
import { lengthFor } from "./writing-contracts";   // [R8 §2.1] 계약 분량 폭(주제군 반영) — 정본 한 곳
import { checkDisclosure, compensationOfMeta } from "./disclosure";
import { findBannedWords, BLOG_EXTRA_BANNED, normalizeForBanScan, classifyBanned, hasEvidenceNear, findAdPointing } from "./banned-words";   // [R8-A §4] 3층 사전 + 근거 판정
import { isHealthTopic } from "./banned-categories";                                   // [R8-A §4] 건강·의료 소재면 효능 표현이 바로 위법
import { SAME_BODY_SIMILARITY } from "./similarity";

/** [P1R7 B3] `link_check` 는 **여기(runGate)가 재는 12키가 아니다** — 네트워크가 필요해 `lib/content-approve.ts checkLinks` 가 따로 재서 붙인다(소프트).
 *  어휘를 이 파일에 두는 이유: 화면·감사가 키·라벨을 한 곳에서 읽어야 하기 때문(GATE_KEYS 에는 넣지 않는다 = runGate 는 안 돈다). */
export type GateKey = "length" | "cliche" | "para_repeat" | "bullet_ratio" | "sentence_variance" | "translationese" | "superlative" | "persona" | "visual_min" | "disclosure" | "banned_words" | "similarity" | "affiliate_count" | "ad_pointing" | "link_check" | "stock_safe" | "structure_repeat";
export const GATE_KEYS: GateKey[] = ["length", "cliche", "para_repeat", "bullet_ratio", "sentence_variance", "translationese", "superlative", "persona", "visual_min", "disclosure", "banned_words", "similarity", "affiliate_count", "ad_pointing"];
export const GATE_LABEL: Record<GateKey, string> = {
  /* [R8 §2.1 · B-1] 🔴 **분량** — 여태 **아무도 안 쟀다**. `blocksCharCount`(공백 포함 · 고지·태그 제외)는 있었는데 **부르는 곳이 0** 이었다(AC-29).
     그래서 «계약 1,500자»가 선언으로만 있고, 실제로는 절반(C 실호출 3편 평균 736자)이 나와도 아무 표시가 없었다.
     🔴 **소프트**다(HARD_GATE_KEYS 밖) — 짧다고 발행을 막으면 공장이 선다. 대신 **재작성 지시**로 이어진다(AC-63 «다른 층의 손잡이»).
     🔴 **근거를 못 박아 둔다: SEO 가 아니다.** 구글은 «콘텐츠 길이 자체는 순위 결정과 관련 없다»고 직접 말한다(B3 조사 · DESIGN §5C.6).
        맞는 근거는 둘뿐이다 — ①**실물이 그렇다**(R8-A 표본: 티스토리 8,500~12,500자) ②**얇은 글은 사람이 안 읽는다**.
        여기에 «SEO 때문»이라고 적으면 다음 사람이 그 근거를 무너뜨리고 손잡이를 통째로 뺀다.
     `runGate` 안에서 돈다(순수 · DB·AI 0) — `link_check`·`structure_repeat` 와 달리 밖에서 잴 것이 없다. */
  length: "분량이 계약 폭 안",
  cliche: "상투 표현 없음", para_repeat: "문단 시작이 다양함", bullet_ratio: "불릿이 본문을 대신하지 않음", sentence_variance: "문장 길이가 살아 있음",
  translationese: "번역투 없음", superlative: "최상급에 근거가 있음", persona: "내 사정이 들어감", visual_min: "채널 시각 요소 충족",
  disclosure: "대가 고지 첫머리", banned_words: "근거 없이 쓰면 위험한 표현 없음", similarity: "다른 글과 겹치지 않음", affiliate_count: "제휴 링크 2개 이하",
  link_check: "링크 열림",
  /* [R8-A §4 · 사장님 지시] 🔴 **좁은 축**이다 — «광고·배너»를 **가리키며 누르라**고 할 때만 걸린다(애드센스 계정 정지 사유).
     독자 행동 유도(계속 읽기·저장·구독)와 우리 제휴 링크 유도는 **여기서 안 잡는다** — 오히려 더 해야 하는 것들이다. */
  ad_pointing: "광고를 가리키지 않음",
  /* [P1R8 §5.1-앞] 스톡 사진 안전 — «광고가 들어간 글에 사람·상표가 찍힌 스톡을 쓰지 않았나»(무료 스톡 라이선스의 조건).
     `GATE_KEYS` 밖(= runGate 가 안 돈다 · DB 의 piece_assets 를 읽어야 해서 `lib/content-approve.ts` 가 따로 잰다 · link_check 와 같은 자리). */
  stock_safe: "스톡 사진이 쓸 수 있는 것",
  /* [R8-A §2 · B-1] 골격 반복 — `similarity` 는 **글자**만 봐서, 소제목 수·블록 순서·끝맺음이 매번 같아도 단어만 다르면 통과한다.
     `GATE_KEYS` 밖(= runGate 가 안 돈다 · `link_check` 와 같은 자리) · **소프트**(HARD_GATE_KEYS 아님). 판정은 `lib/structure-print.ts`. */
  structure_repeat: "최근 글과 구조가 다름",
};
export type GateWeight = "high" | "mid" | "low";
/**
 * [R8 §9] 축의 **무게** — 정본은 여기 한 곳이다(화면이 제 표를 들고 있으면 서버와 갈린다 · AC-52).
 *   🔴 무게는 «막는다»가 아니다 — 막는 게이트는 0개다. 무게는 **읽는 순서**다.
 *   `high` 법·계정이 걸린다(고지·금칙·광고 클릭 유도) · `mid` 플랫폼·품질에 실제 영향 · `low` 다듬으면 좋은 것.
 */
export const GATE_WEIGHT: Readonly<Record<string, GateWeight>> = {
  disclosure: "high", banned_words: "high", ad_pointing: "high",
  stock_safe: "high",                          // 제3자가 다치는 축(저작권·초상권) — 막지는 않지만 **맨 위에서 읽혀야** 한다
  affiliate_count: "mid", similarity: "mid", superlative: "mid", length: "mid", visual_min: "mid", link_check: "mid",
  cliche: "low", para_repeat: "low", bullet_ratio: "low", sentence_variance: "low", translationese: "low", persona: "low", structure_repeat: "low",
};
/** 모르는 축은 `mid` — 새 축이 조용히 맨 아래로 밀리지도, 맨 위로 튀지도 않게. */
export function gateWeightOf(key: string): GateWeight { return GATE_WEIGHT[key] ?? "mid"; }

export interface GateCheck {
  key: GateKey; label: string; pass: boolean; detail?: string;
  /**
   * [R8 §5D.3-3] **이 축은 재지 않았다**(사람이 직접 쓴 글에 AI 티 축을 들이대지 않는다).
   *   🔴 «조용히 다 끄기» 금지라 **빠뜨리지 않고 실어 보낸다** — 화면이 이 칸을 보고 «안 했어요»로 그리고,
   *      `pass:true` 를 초록 ✓ 로 **그리지 않는다**(못 잰 것을 통과로 그리지 않는 규율 · AC-33).
   */
  skipped?: boolean;
  /** 왜 안 쟀나 — 지금은 `"self"` 하나(직접 쓴 글). */
  skipReason?: string;
  /**
   * [R8 §9] 이 축이 이 글에서 **도는가** — `soft`(돌고 말해 준다) · `off`(안 쟀다).
   *   🔴 **`hard` 는 없다** — 막는 게이트는 0개다(사장님 지시 2026-09-15 · «말해 주기로 내려. 고객 계정이야»).
   *      검사를 지운 것이 **아니다**: 계속 돌고 결과를 보여 준다. 막지만 않는다.
   */
  level?: "soft" | "off";
  /**
   * [R8 §9] 🔴 **무게** — 막지 않는 대신 «가벼운 것과 무거운 것이 같은 얼굴»이면 아무도 안 읽는다(A 요청).
   *   `high` 법·계정 정지 위험(대가 고지 누락 · 금칙 · 광고 클릭 유도) · `mid` 플랫폼·품질에 실제로 영향 · `low` 다듬기.
   */
  weight?: GateWeight;
}
export interface GateReport {
  ok: boolean; checks: GateCheck[]; rewritten: boolean;
  /** [P1R5 §1.4-6] 영상 심사 결과 — «GateKey 12 중 영상에 해당하는 것 + judge». 글 piece 에는 없다.
   *  모양은 `lib/video/types.ts JudgeResult` 와 구조적으로 같다(여기서 video 를 import 하지 않으려고 구조로만 적는다 · AC-17). */
  judge?: { grade: "P0" | "P1" | "P2";
    /** [R7 §1.5] `pending:true` = 판정 보류(잴 재료가 없었다 · AC-33). `pass:true` 지만 ✅ 로 그리면 안 된다 — 화면은 «아직 못 쟀어요». */
    axes: { key: string; label: string; pass: boolean; grade: "P0" | "P1" | "P2"; detail?: string; pending?: boolean }[]; repaired?: boolean; at?: string };
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
/** [R8-A §4] 같은 정규식의 g 판 — 등장 전부를 훑어 낱말마다 «근거가 붙었나»를 본다. */
const SUPERLATIVE_RE_G = new RegExp(SUPERLATIVE_RE.source, "g");

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
  /** [R8-A §4] 대가 3종 — `affiliate`(제휴) · `sponsored`(원고료·PPL) · `gift`(무상 제공). 하나라도 참이면 고지가 필요하다. */
  meta: { affiliate?: unknown; adDisclosure?: boolean; sponsored?: boolean; gift?: boolean } | null;
  /** 유사도(호출부가 계산 · 없으면 0). */
  similarity?: { score: number; against?: string };
  /** 제목(최상급·금칙어 검사에 포함). */
  title?: string;
  /** [R8 §2.1] 주제군 — 계약 분량 폭이 주제군마다 다르다(`lengthFor`). 없으면 채널 기본 폭. */
  group?: TopicGroup | null;
  /**
   * [R8 §5D] 이 글이 **어떻게 만들어졌나**(`auto`·`manual`·`self`). 판정 자체는 안 바꾸고 **말투만** 바꾼다 —
   *   ①은 사람이 방금 쓴 글이라 «모자란다»는 판정문이 아프게 읽힌다(A 지적 2026-09-15). 같은 정보를 권유형으로 적는다.
   */
  origin?: string | null;
}

export function runGate(inp: GateInput): GateReport {
  const { blocks, contract } = inp;
  const plain = blocksToPlain(blocks);
  const withTitle = `${inp.title ?? ""}\n${plain}`;
  const checks: GateCheck[] = [];
  const push = (key: GateKey, pass: boolean, detail?: string) => { const c: GateCheck = { key, label: GATE_LABEL[key], pass, weight: gateWeightOf(key) }; if (detail) c.detail = detail; checks.push(c); };

  /* [R8 §2.1] 분량 — **세는 자는 하나**다(`blocksCharCount` · 계약 주석 «공백 포함 평문» 그대로 · `lib/blocks.ts`).
     🔴 하한만 걸고 상한은 **적기만** 한다: 짧은 글은 고객 손해지만, 긴 글은 손해가 아니라 «폭을 넘었다»일 뿐이라
     그걸로 재작성(=돈)을 돌리지 않는다. */
  const lenRange = lengthFor(contract, inp.group);
  const chars = blocksCharCount(blocks);
  const self = String(inp.origin ?? "") === "self";
  push("length", chars >= lenRange.min,
    chars >= lenRange.min
      ? `${chars.toLocaleString()}자(${self ? "이 채널에서 잘 읽히는 " : "계약 "}${lenRange.min.toLocaleString()}~${lenRange.max.toLocaleString()}자)${chars > lenRange.max ? " — 폭보다 길다" : ""}`
      : self
        ? `${lenRange.min.toLocaleString()}자쯤이면 더 잘 읽혀요 — 지금 ${chars.toLocaleString()}자예요(안 고쳐도 올라갑니다)`
        : `${chars.toLocaleString()}자 — 계약 하한 ${lenRange.min.toLocaleString()}자에 ${(lenRange.min - chars).toLocaleString()}자 모자란다`);

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
  /* [R8-A §2 · B-1 실물 근거] 🔴 임계를 **문단 수에 비례**시킨다.
     예전 값 `repCount <= 1` 은 «문단 10개짜리 글»을 전제했는데, 실물 한국 블로그는 문단이 50~150개다(티스토리 85 · 워드프레스 150 · B-1 표본 8편).
     문단이 많으면 «그런데/저는/이때» 로 시작이 겹치는 것은 **자연스러운 한국어**인데도 자동으로 걸렸다.
     문단 8개 이하에서는 cap = 1 이라 짧은 글엔 회귀가 없다(10개 → 2 · 50개 → 6 · 85개 → 11 · 150개 → 18).
     한 글자 낱말(«그»·«저»·«이»)은 세지 않는다 — 조사·관형사라 «시작이 같다»의 근거가 못 된다. */
  for (const p of paras) { const w = p.split(/\s+/)[0]?.replace(/[^\p{L}\p{N}]/gu, "") || ""; if (w.length >= 2) starts.set(w, (starts.get(w) ?? 0) + 1); }
  const rep = [...starts.entries()].filter(([, c]) => c > 1);
  const repCount = rep.reduce((a, [, c]) => a + (c - 1), 0);
  /* 🔴 B-1 이 준 식(`repCount <= ceil(문단수 × 0.12)`)은 **의도대로 동작하지 않는다**(프로브로 확인 · 2026-09-15):
     `repCount` 는 «겹친 낱말 수»가 아니라 **초과 횟수의 합**이라 문단이 많을수록 선형으로 커진다
     (문단 60개를 다섯 가지 접속어로 고르게 시작 = repCount 55 > cap 8 → 여전히 실패).
     그래서 **집중도**로 잰다: 긴 글은 «한 낱말이 문단의 1/4 넘게 시작하는가»만 본다 — 그게 진짜 기계 티다.
     짧은 글(문단 8개 이하)은 예전 규칙 그대로(회귀 0). */
  const topStart = [...starts.entries()].sort((a, b) => b[1] - a[1])[0];
  const topShare = paras.length ? (topStart?.[1] ?? 0) / paras.length : 0;
  const longForm = paras.length > 8;
  const okRepeat = longForm ? topShare <= 0.25 : repCount <= 1;
  push("para_repeat", okRepeat, !okRepeat
    ? (longForm
      ? `«${topStart?.[0]}» 로 시작하는 문단이 ${topStart?.[1]}개예요(문단 ${paras.length}개 중 ${Math.round(topShare * 100)}% · 25%까지)`
      : `«${rep.map(([w, c]) => `${w}×${c}`).join(", ")}» 로 시작하는 문단이 반복돼요`)
    : undefined);

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
  /* [R8-A §4] 🔴 **근거가 있으면 통과**(표시광고법 §5 는 낱말 금지가 아니라 실증 책임) — B-1 이 넘긴 과차단 건.
     «판매량 1위(2026년 9월 네이버 쇼핑 기준)» 처럼 같은 문장에 기관·기간·수치가 있으면 법이 허용한다. */
  const supHits: string[] = [];
  for (const m of withTitle.matchAll(SUPERLATIVE_RE_G)) { const w = m[0]; if (!hasEvidenceNear(withTitle, w) && !supHits.includes(w)) supHits.push(w); }
  push("superlative", supHits.length === 0, supHits.length ? `«${supHits.slice(0, 3).join("·")}» — 근거(기관·기간·수치)를 같은 문장에 밝히거나 표현을 낮춰 주세요(표시광고법 §5 실증 책임)` : undefined);

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
  /* [R8-A §4] 3층 사전 — hard(차단) · needs_proof(근거 없으면 차단) · tone(감점만 · 여기선 안 센다).
     문맥: 대가를 받은 글이거나 건강·의료 소재면 식품표시광고법 §8·의료법 §56 이 바로 걸린다. */
  const comp = compensationOfMeta(inp.meta as Record<string, unknown> | null);
  const ban = classifyBanned(withTitle, { paid: comp.need, health: isHealthTopic(withTitle) });
  const banHits = [...ban.hard, ...ban.needsProof];
  push("banned_words", banHits.length === 0, banHits.length ? banHits.slice(0, 4).map((h) => `«${h.word}»(${h.law})`).join(" · ") : undefined);

  /* [R8-A §4] 광고를 가리키는 표현 — 애드센스 «광고 클릭 유도·광고를 본문처럼 위장» 금지(계정 정지 사유)라 **하드**다.
     🔴 좁게 본다: 한 문장에 «광고·배너·스폰서» + «클릭·눌러·보고 가» 가 같이 있을 때만. 고지 문장·독자 행동 유도는 안 걸린다. */
  const pointing = findAdPointing(plain);
  push("ad_pointing", pointing.length === 0, pointing.length ? `${pointing[0].why}: «${pointing[0].sentence}»` : undefined);

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
      case "length": return `- 분량이 모자란다(${c.detail}). 🔴 **문단 수를 늘리지 말고**(구성 시퀀스는 그대로) 각 문단을 더 깊게 써라 — 장면(언제·어디서·무엇을)·구체적 사실·직접 겪은 예를 문단마다 2~3문장씩 더 넣는다. 같은 말을 바꿔 쓰거나 요약을 덧붙여 늘리지 마라.`;
      case "cliche": return `- 상투 표현을 전부 지워라(${c.detail}). «~에 대해 알아보겠습니다·마무리하며·오늘은 ~를 소개» 같은 도입·마무리 문구 없이 장면·사실로 바로 들어간다.`;
      case "para_repeat": return `- 문단 첫 어절이 겹친다(${c.detail}). 각 문단을 다른 말(시간·장소·판단·질문)로 시작해라.`;
      case "bullet_ratio": return `- 불릿이 너무 많다(${c.detail}). 리스트 항목의 절반을 문장으로 풀어 써라.`;
      case "sentence_variance": return `- 문장 길이가 다 비슷하다(${c.detail}). 5~10자 짧은 문장을 30% 섞고, 한 문장은 40자 넘게 이어 써라.`;
      case "translationese": return `- 번역투가 많다(${c.detail}). «~에 의해→~가», «~의 경우→~면», «~로 인해→~때문에» 처럼 한국어 어순으로 고쳐라.`;
      case "superlative": return `- 최상급 표현에 근거가 없다(${c.detail}). **같은 문장에** 출처·기간·수치를 붙이거나(예: «2026년 9월 네이버 쇼핑 기준»), 비교급·구체 사실로 바꿔라.`;
      case "persona": return `- 내 사정이 안 들어갔다(${c.detail}). 페르소나 재료 중 1~2개를 실제 장면(언제·어디서)으로 자연스럽게 넣어라.`;
      case "visual_min": return `- 채널 시각 요소가 모자란다(${c.detail}). 구성 시퀀스의 블록 타입을 그대로 채워라.`;
      case "disclosure": return `- 제휴 고지가 첫 블록이어야 한다(${c.detail}).`;
      case "banned_words": return `- 근거 없이 쓰면 위험한 표현이다(${c.detail}). 단정·효능 표현은 지우고, 최상급은 근거를 같은 문장에 밝혀라.`;
      case "similarity": return `- 다른 글과 너무 비슷하다(${c.detail}). 도입 장면·소제목·예시를 전부 다른 관점으로 새로 써라(같은 문장 재사용 금지).`;
      case "affiliate_count": return `- 제휴 링크는 2개까지다(${c.detail}).`;
      case "ad_pointing": return `- 광고·배너를 가리키며 누르라고 하지 마라(${c.detail}). 애드센스 계정 정지 사유다. 독자에게 «다음 글 보기·저장» 같은 **읽기 행동**을 권하는 문장으로 바꿔라.`;
    }
  });
  return `[다시 쓰기 — 직전 원고가 아래 검사에 걸렸다. 같은 실수를 반복하면 이 글은 사람 검수로 넘어간다]\n${lines.join("\n")}\n`;
}
