/**
 * lib/writing-contracts.ts — 채널별 집필 계약(DESIGN §5C.1 표 7행 전부 · §5.4 감성 프로파일). AM 원본: ../AutoMarketing/lib/content-tone.ts (톤 계약·구성 로테이션·hashSeed 관례 2026-09-14 · 값은 AC 설계표로 교체)
 *   코드 기본값 + DB `emotion_profiles.contract` 오버레이(키 = `{channel}.{emotionKey}` · 있으면 필드 단위로 덮어씀 · graceful).
 *   계약 = 독자·말투(reader·register·rules) · 서사 로테이션(formats · 각 format 의 블록 시퀀스 structure) · 시각 요소(visual) · 분량(length) · 제목 스타일(titleStyle) · 이미지 기본(images).
 *   소비처: director(format 로테이션·imageCount·coinCost) · content-gen(프롬프트 ①②) · ai-tell-gate(visual_min) · slots(coinsPerWeek).
 */
import { db } from "../db/index";
import { sql } from "drizzle-orm";
import { COIN_TIERS, imageSlotsForTier, plannedAiFor, type CoinTier } from "./coin-table";   // [R10-8] 등급 → 분량·구성·사진 자리(표는 coin-table 한 곳 · 순수 리프)

/**
 * 🔴 [R8CLOSE-B1 §B4 · 2026-09-16] **블록 어휘는 `lib/blocks.ts` 한 곳이다.**
 *   여기엔 같은 이름의 목록이 **한 벌 더** 적혀 있었다 — 두 벌이면 갈린다. `place` 를 blocks.ts 에 더하자마자
 *   이 파일이 «그런 블록 없다»고 해서 바로 드러났다(오늘 코인·말투에서 겪은 «표 두 벌»과 같은 모양 · AC-78).
 *   ⇒ 여기서는 **다시 적지 않고 그대로 가져온다.** 이름은 그대로 내보내서 부르는 쪽은 아무것도 안 바꿔도 된다.
 */
export type { BlockType } from "./blocks";
import type { BlockType } from "./blocks";
/* [R8 §2.5] `steps` 추가 — 인스타 카드뉴스의 «단계형». format 이 1종뿐이라 골격이 100% 겹치던 것을 다섯으로 늘리며 생겼다.
   🔴 새 열쇠를 더하면 **화면 라벨(`public/js/ui.js UI.FORMAT`)도 같이** 더해야 한다 — 안 그러면 화면에 빈칸이 뜬다(AC-52 계열). */
export type FormatKey = "story" | "info" | "listicle" | "compare" | "qna" | "guide" | "cardnews" | "steps";

export interface VisualMin { quote?: number; divider?: number; image?: number; h2?: number; tableOrList?: number; adsense?: number; checklist?: number; hashtags?: number; faq?: number;
  /** [R8CLOSE-B1 §B4] 🔴 **아무 채널도 안 쓴다**(일부러). 칸만 둔 이유는 다음 사람이 넣는 순간 `contractSelfConflicts` 가 잡게 하려는 것이다. */
  place?: number }

/* ═══════════ [R8-A §2 · B-1 2026-09-15] 계약의 «성격»을 바꾼 세 축 ═══════════
 *   조사 결론(`docs/active/2026-09-15-R8A-voice-text.md`): 우리 계약은 **실물이 아니라 «SEO 블로그가 말하는 이상적인 글»**을 베끼고 있었다.
 *   증거 ①목차·FAQ 를 전 format **필수**로 박았는데 실물은 티스토리 1/4·블로거 0/2·워드프레스 2/2 로 **글마다 다르다**
 *        ②글자 수 상한이 통째로 낮다(티스토리 실물 8,500~12,500 vs 우리 3,000)
 *        ③🔴 계약이 내는 **골격이 3~5가지뿐**이라 블로거·워드프레스는 **4편째부터 반드시 겹친다**(스모크 실측) — 그게 AI 티의 가장 큰 원인이다.
 *   ⇒ 고정값 1벌 → **①범위 ②주제군 갈래 ③필수/선택/억제 3단** + **④수익 목적 갈래**(사장님 질문 2026-09-15).
 */

/** 주제군 — 같은 채널이라도 이 갈래에 따라 분량·사진 수가 다르다(실물 관측). */
export type TopicGroup = "review" | "info" | "life";
export const TOPIC_GROUPS: readonly TopicGroup[] = ["review", "info", "life"];

/** 수익 목적 — `lib/director.ts Goal` 과 같은 어휘(여기서 director 를 import 하면 순환이다 · AC-17). */
export type RevenueGoal = "affiliate" | "adsense" | "adpost" | "ypp" | "clip_incentive" | "mixed";

/**
 * 블록 3단 — **필수 / 선택 / 억제**.
 *   `required` 는 매번 들어간다. `optional` 은 **글마다 들쭉날쭉**해야 한다(그게 실물이다).
 *   🔴 `suppress` = «이 채널에선 흔하지 않다» — 넣으면 오히려 AI 티다(실물 근거가 없어 우리가 박아 뒀던 것들).
 */
export interface BlockTiers { required: BlockType[]; optional: BlockType[]; suppress: BlockType[] }

export interface WritingContract {
  channel: string;
  /** 감성 키(emotion_profiles.key 의 뒤쪽 · DESIGN §5.4 «기본 감성»). */
  emotionKey: string;
  label: string;
  /** 독자와 말투(사람말 · 프롬프트 ① 역할). */
  reader: string;
  register: string;
  /** 말투 규칙(하드룰 · 프롬프트 ①). */
  rules: string[];
  /** 서사 구조 로테이션 — 순서가 곧 로테이션 순서. */
  formats: FormatKey[];
  formatLabel: Partial<Record<FormatKey, string>>;
  /** format → 블록 시퀀스(프롬프트 ② 구성 · 렌더 순서). image 블록 수 = images.default 를 기준으로 배치. */
  structure: Partial<Record<FormatKey, BlockType[]>>;
  /** 채널 에디터 실지원 시각 요소(사람말 · 프롬프트 ②·게이트 사유). */
  visual: string[];
  /** 게이트 최소치(§5C.2 «채널 시각 요소 최소치»). */
  visualMin: VisualMin;
  /** 본문 글자 수(공백 포함 평문). */
  length: { min: number; max: number };
  /** 제목 스타일: naver(검색어 앞 + 감정 뒤) · google(연도+총정리) · hook(첫 줄 훅) · card(30자) · script(대본). */
  titleStyle: "naver" | "google" | "hook" | "card" | "script";
  titleExample: string;
  /** [2026-09-15 §5C] captionRate = 캡션을 다는 사진 비율(0~1). 🔴 기본은 «없음» — 네이버 블로거 대부분 사진마다 캡션을 안 단다(전부 달면 그것도 AI 티). */
  images: { min: number; max: number; default: number; style: "photo" | "illust" | "infographic"; aspect: "4:3" | "1:1" | "9:16" | "16:9"; captionRate: number };
  /** 이모지 허용(문단당). */
  emojiPerParagraph: number;
  /** 글 채널인가(이 라운드 생성 대상). */
  text: boolean;

  /* ── [R8-A §2] 아래 넷은 **선택 필드**다. 없으면 위의 고정값이 그대로 쓰인다(무회귀). ── */
  /** 주제군별 분량 — 없으면 `length`. 실물 근거는 조사 문서 §2.2·§3·§4. */
  lengthByGroup?: Partial<Record<TopicGroup, { min: number; max: number }>>;
  /** 주제군별 사진 수 — 없으면 `images`. */
  imagesByGroup?: Partial<Record<TopicGroup, { min: number; max: number; default: number }>>;
  /** 블록 3단(필수/선택/억제) — 없으면 `structure` 배열을 그대로 쓴다. */
  tiers?: BlockTiers;
  /**
   * [R8 §2.5] 🔴 **이 채널의 사진은 «사진»이 아니라 «카드»다** — 카드마다 글자가 얹힌다(인스타 카드뉴스).
   *   있으면 세 가지가 달라진다:
   *     ① `captionRate` 를 무시하고 **모든 카드가 caption 을 갖는다**(글 채널은 «대부분 캡션 없음»이 실물이지만,
   *        카드뉴스에서 글자 없는 카드는 **카드가 아니다**).
   *     ② caption 길이 상한이 25자가 아니라 `max` 다.
   *     ③ 프롬프트가 «카드 한 장 = 한 메시지»를 블록 스키마 자리에서 말한다.
   *   🔴 묘사문 금칙(«~하는 모습»)은 **그대로 적용된다** — 카드 글자는 장면 설명이 아니라 독자가 가져갈 한 마디다.
   */
  cardText?: { max: number };
  /**
   * 수익 목적별 규칙 — **프롬프트에 그대로 실린다**.
   *   🔴 사장님 질문(2026-09-15): «같은 네이버라도 수익 목적에 따라 글 구성을 다 달리해야 하나?»
   *      답: **달라야 한다.** 그런데 2026-09-15 확인 결과 `briefs.goal` 은 저장만 되고 `content-gen` 에 **한 번도 안 들어갔다**(grep 0) —
   *      즉 «애드센스 목적»과 «애드포스트 목적»이 글을 **한 글자도 바꾸지 않았다**. 그 구멍을 이 필드가 막는다.
   *
   *   🔴 **«유도»는 3층으로 갈린다**(사장님 2026-09-15 · 뭉뚱그리면 글이 밍밍해지고 수익이 안 난다):
   *     ① **광고를 가리키는 유도** — 🔴 절대 금지. «아래 배너 눌러 주세요»·«광고 보고 가세요»·광고 위치 지시. **계정 정지 사유**.
   *     ② **우리 링크(쿠팡 제휴)로의 유도** — 🟢 해도 된다. 단 고지 필수 · 과장·거짓 금지(표시광고법).
   *     ③ **독자의 행동으로의 유도**(계속 읽기·저장·다음 글·구독) — 🟢🟢 **더 해야 한다.**
   *        애드센스·애드포스트 수익은 **체류·노출**에서 나온다 — «오래 읽게 하는 것»이 정당하고 유일한 개선법이다.
   *   🔴 그리고 지금 우리 글은 «유도가 과한» 쪽이 아니라 **«부족한» 쪽**이다 —
   *      실물은 끝맺음이 «행동 유도 한 문장»인데(조사 §2.2·§3) 우리는 `faq` 로 끝났다.
   */
  goalRules?: Partial<Record<RevenueGoal, string[]>>;
}

const NAVER_STORY: BlockType[] = ["hook", "image", "quote", "para", "image", "image", "checklist", "para", "image", "divider", "para", "image", "tip", "image", "hashtags"];

export const WRITING_CONTRACTS: Record<string, WritingContract> = {
  naver_blog: {
    channel: "naver_blog", emotionKey: "story", label: "네이버 블로그 · 경험담·친근",
    reader: "내 블로그 이웃 — 같은 동네·같은 또래의 친구 같은 사람",
    register: "구어 존댓말 «~했어요 / ~더라고요 / ~거든요» · 1인칭 경험",
    rules: [
      "이웃에게 말하듯 쓴다. «~했어요/~더라고요/~거든요» 종결을 섞고, «~합니다/~입니다» 는 쓰지 않는다.",
      "직접 겪은 장면(언제·어디서·무엇을)으로 시작한다. 실패했던 것·바꿔 본 것·개인 판단(«저는 이게 낫더라고요») 을 넣는다.",
      "구체 숫자(가격 원화·시간·횟수)는 페르소나 사정이나 재료에 있는 것만. 없는 수치를 만들지 않는다.",
      "문장 길이를 섞는다 — 짧은 문장이 30% 이상. 문단은 2~4문장 · 길이 불규칙.",
      "소제목엔 이모지를 0~1개까지 허용(본문엔 0).",
    ],
    formats: ["story", "compare", "guide", "qna", "info"],
    formatLabel: { story: "경험담(계기→해봄→결과→팁)", compare: "비교 후기", guide: "실패담→해결", qna: "Q&A", info: "일상+정보" },
    structure: {
      story: NAVER_STORY,
      compare: ["hook", "image", "quote", "para", "table", "image", "image", "para", "checklist", "image", "divider", "image", "tip", "image", "hashtags"],
      guide: ["hook", "image", "para", "quote", "image", "para", "image", "checklist", "image", "divider", "para", "image", "tip", "image", "hashtags"],
      qna: ["hook", "image", "quote", "h3", "para", "image", "h3", "para", "image", "h3", "para", "image", "divider", "checklist", "image", "tip", "image", "hashtags"],
      info: ["hook", "image", "para", "quote", "image", "list", "para", "image", "image", "divider", "para", "image", "tip", "image", "hashtags"],
    },
    visual: ["사진 6~10장 + 캡션", "인용구(핵심 한 줄)", "구분선", "체크리스트", "소제목", "해시태그 5~10", "장소/링크 카드"],
    /* 🔴 [R8 §9 · 2026-09-15] **요구를 우리가 늘 채울 수 있는 것만 남긴다** — `visual_min` 은 막지는 않지만 빨개지면 **재작성(=돈)** 을 부른다.
       뺀 것: ①`tiers.optional` 이 뺄 수 있는 칸(계약이 스스로 싸웠다 · `contractSelfConflicts` 가 0 이 되게)
       ②사진 장수 — 조달이 «AI 1장 + 고객·스톡»으로 바뀌므로 **늘 보장되는 1장**만 요구한다(6장을 요구하면 조달을 못 바꾼다).
       ③FAQ — 근거였던 검색 리치 결과가 2025-05-08 지원 중단이라 **SEO 값이 0**이고, 실물도 글마다 다르다(R8-A). */
    visualMin: { image: 1, hashtags: 5 },
    length: { min: 1500, max: 2500 },
    titleStyle: "naver", titleExample: "에어프라이어 청소, 3분이면 새것처럼",
    images: { min: 6, max: 10, default: 6, style: "photo", aspect: "4:3", captionRate: 0.3 },
    emojiPerParagraph: 0, text: true,
    /* [R8-A] 🔴 네이버는 **실물 미확인**(도구가 naver.com 을 못 읽는다 · 조사 §0.1). 아래 값은 그대로 두되 **출처가 «업계 통설»**임을 밝힌다 —
       «1,500자 이상»·«사진 6~13장»은 네이버가 공식으로 낸 적이 없다(조사 §5.1). 사장님 세션 실물이 들어오면 여기부터 고친다. */
    lengthByGroup: { review: { min: 1200, max: 2500 }, info: { min: 1500, max: 3000 }, life: { min: 1000, max: 2200 } },
    tiers: {
      required: ["hook", "para", "image"],
      /* 🔴 [R8CLOSE-B1 §B4] `place`(장소/링크 카드)는 **어느 칸에도 없다** — 일부러다.
         처음엔 `optional` 에 넣었는데, `expandForLength` 가 분량을 채우려고 optional 을 끌어다 쓰는 바람에
         **네이버 글 네 구성 전부에 장소 블록이 박혔다**(하니스 ②가 잡았다). 그러면 장소가 없는 소재에도
         자리가 생기고, 모델은 그 자리를 **지어낸 상호·주소**로 채운다 — 사진 캡션 묘사문보다 나쁘다
         (고객이 손님을 엉뚱한 데로 보낸다). 2026-09-15 `visualMin.faq` 사고와 **같은 뿌리**다.
         ⇒ 골격은 장소를 **강제하지 않는다.** 대신 프롬프트가 «소재에 실제로 장소가 나오면 하나 넣어도 된다»고
           **허락**한다(`lib/content-gen.ts`). 있으면 넣고 없으면 안 넣는다 — 그게 «막지도 강제하지도 않는다»다. */
      optional: ["quote", "divider", "checklist", "tip", "list", "h3"],
      /* 🔴 목차·FAQ·요약은 네이버 블로그에서 흔하지 않다(스마트에디터에 그런 관례가 없다). 넣으면 «검색 최적화 글» 티가 난다. */
      suppress: ["toc", "faq", "summary", "adsense"],
    },
    goalRules: {
      /* 🔴 네이버 = 애드포스트. 광고는 **네이버가 자동 배치**한다 — 우리가 광고 자리를 만들지 않는다(그래서 structure 에 `adsense` 가 없는 게 맞다).
         수익은 «체류·재방문»에서 나온다 ⇒ 경험담·사진·이웃 말투. */
      adpost: [
        "이 글의 목표는 «다시 오게 하는 것»이다 — 🔴 **끝맺음은 «다음 행동 한 줄»**(다음에 쓸 이야기 예고·이웃 추가 권유). 이 유도는 **해야 한다**.",
        "광고 자리를 본문에 만들지 않는다(네이버가 알아서 붙인다).",
        "사진과 겪은 장면을 아끼지 않는다 — 오래 머무르게 하는 건 정보 밀도가 아니라 장면이다.",
      ],
      affiliate: [
        "이 글의 목표는 «고르게 돕는 것»이다 — 비교 기준을 먼저 주고, 내가 왜 그걸 골랐는지 말한다.",
        "🔴 제휴 고지는 첫머리에 그대로 둔다(법 · 빼거나 아래로 내리지 않는다).",
      ],
    },
  },
  tistory: {
    channel: "tistory", emotionKey: "info", label: "티스토리 · 정보·정리",
    reader: "검색으로 들어온 사람 — 답을 빨리, 정확히 얻고 싶은 독자",
    register: "격식 존댓말 «~합니다 / ~입니다» 를 바탕으로, 권유 «~해 보세요»·질문 «~일까요?» 를 섞는 정리 톤",
    rules: [
      /* [R8-A 실물] 티스토리 4편 종결어미: ~습니다 60~70% + **~세요·~나요? 15~25%**. 순수 «~합니다» 는 실물이 아니다. */
      "바탕은 «~합니다/~입니다» 지만 **열 문장 중 두세 문장은 «~해 보세요»(권유)나 «~일까요?»(질문)** 로 쓴다. 전부 «~합니다» 로 끝나면 기계가 쓴 티가 난다.",
      "🔴 문단 하나는 **2~3문장**이다. 네 문장이 넘으면 문단을 나눈다(모바일에서 벽처럼 보인다).",
      "서론-본론-결론. 첫 문단에서 이 글이 답하는 질문을 한 줄로 짚고 시작한다.",
      "표·체크리스트·요약 박스로 한눈에 보이게 한다. 굵게 강조는 문단당 최대 1곳.",
      "근거 없는 수치·최상급 금지. 조건·예외를 «주의» 로 분리해 적는다.",
      "그래도 사람이 쓴 글이다 — 한 문단은 직접 겪은 사례나 개인 판단으로 쓴다.",
    ],
    formats: ["info", "listicle", "compare", "guide"],
    formatLabel: { info: "정보형(문제→원인→방법→주의)", listicle: "리스트형(N가지)", compare: "비교표형", guide: "가이드형(단계)" },
    structure: {
      info: ["toc", "para", "h2", "para", "adsense", "image", "h2", "para", "table", "h2", "para", "image", "list", "h2", "adsense", "summary", "faq"],
      listicle: ["toc", "para", "h2", "para", "adsense", "image", "h2", "list", "para", "h2", "para", "image", "h2", "table", "adsense", "summary", "faq"],
      compare: ["toc", "para", "h2", "para", "adsense", "table", "image", "h2", "para", "h2", "list", "image", "h2", "adsense", "summary", "faq"],
      guide: ["toc", "para", "h2", "para", "adsense", "image", "h2", "checklist", "para", "h2", "para", "image", "table", "h2", "adsense", "summary", "faq"],
    },
    visual: ["목차", "H2/H3", "표", "요약 박스", "굵게 강조", "이미지 2~4장", "애드센스 자리 2곳(첫 H2 뒤·마지막 H2 앞)", "FAQ"],
    /* 🔴 [R8 §9 · 2026-09-15] **요구를 우리가 늘 채울 수 있는 것만 남긴다** — `visual_min` 은 막지는 않지만 빨개지면 **재작성(=돈)** 을 부른다.
       뺀 것: ①`tiers.optional` 이 뺄 수 있는 칸(계약이 스스로 싸웠다 · `contractSelfConflicts` 가 0 이 되게)
       ②사진 장수 — 조달이 «AI 1장 + 고객·스톡»으로 바뀌므로 **늘 보장되는 1장**만 요구한다(6장을 요구하면 조달을 못 바꾼다).
       ③FAQ — 근거였던 검색 리치 결과가 2025-05-08 지원 중단이라 **SEO 값이 0**이고, 실물도 글마다 다르다(R8-A). */
    visualMin: { h2: 3, adsense: 2, image: 1 },
    length: { min: 1800, max: 3000 },
    titleStyle: "google", titleExample: "2026 에어프라이어 청소 방법 총정리",
    images: { min: 2, max: 4, default: 3, style: "photo", aspect: "16:9", captionRate: 0.2 },
    emojiPerParagraph: 0, text: true,
    /* [R8-A 실물 근거] 티스토리 4편: 1,850(후기) / 8,500 / 12,000 / 12,500(정보성) · 이미지 8(후기) / 2·2·2(정보성) ·
       목차 1/4 · FAQ 1/4 · 요약박스 0/4 · H3 5~22개 · 태그 6~8 · 종결어미 ~습니다 60~70% + ~세요·~나요? 15~25%. */
    lengthByGroup: { review: { min: 1500, max: 3000 }, info: { min: 3000, max: 12000 }, life: { min: 1500, max: 4000 } },
    imagesByGroup: { review: { min: 5, max: 10, default: 7 }, info: { min: 1, max: 3, default: 2 }, life: { min: 2, max: 6, default: 3 } },
    tiers: {
      required: ["para", "h2"],
      /* 🔴 목차·FAQ 는 **선택**이다 — 실물 1/4. 전 format 필수로 박아 두면 매번 같은 골격이 되고 그게 AI 티다. */
      optional: ["toc", "faq", "h3", "table", "list", "checklist", "image", "tip"],
      suppress: ["summary", "quote", "divider", "hashtags"],
    },
    goalRules: {
      /* 🔴 애드센스 = «오래 읽게 한다». 광고는 우리가 자리를 만든다(structure 의 `adsense` 2곳). */
      adsense: [
        "이 글의 목표는 «끝까지 읽게 하는 것»이다 — 소제목을 넉넉히 두고, 각 소제목 아래를 스스로 완결되게 쓴다.",
        "🔴 **광고를 가리키는 말만** 쓰지 않는다 — «아래 배너»·«광고 눌러 주세요»·광고 위치 지시(계정 정지 사유). **일반 권유는 막지 않는다.**",
        "🔴 **끝맺음은 «다음 행동 한 줄»**이다 — 독자를 계속 읽게·다시 오게 만드는 유도는 **더 해야 한다**(체류가 곧 수익).",
        "소구점을 먼저 던지고 공감 → 정보 → 다음 행동 순서로 간다.",
        "광고가 들어갈 자리 앞뒤 문단은 짧게 끊지 않는다(문단이 몰리면 광고가 붙어 보인다).",
      ],
      affiliate: ["비교 기준을 먼저 주고 내가 왜 그걸 골랐는지 말한다.", "🔴 제휴 고지는 첫머리에 그대로 둔다(법)."],
    },
  },
  blogger: {
    channel: "blogger", emotionKey: "seo", label: "블로거 · SEO 정보",
    reader: "구글 검색·AI 답변엔진으로 들어온 사람",
    register: "격식 존댓말 «~합니다» · 간결한 SEO 정보",
    rules: [
      "티스토리와 같은 정보 톤. 바탕은 «~합니다» 지만 **열 문장 중 두세 문장은 «~해 보세요»·«~일까요?»** 로 섞는다(전부 «~합니다» 면 기계 티가 난다).",
      "🔴 문단 하나는 **2~3문장**. 네 문장이 넘으면 나눈다.",
      "첫 문단 150자 안에 핵심 답을 준다(메타 설명으로 그대로 쓰인다).",
      "FAQ 3문답(질문은 실제 검색 문장)으로 마무리한다.",
      "이미지 alt 는 장면 설명으로 서로 다르게.",
      "근거 없는 수치·최상급 금지.",
    ],
    formats: ["info", "guide", "listicle"],
    formatLabel: { info: "정보형", guide: "가이드형", listicle: "리스트형" },
    structure: {
      info: ["para", "h2", "para", "image", "h2", "table", "para", "h2", "para", "image", "summary", "faq"],
      guide: ["para", "h2", "checklist", "para", "image", "h2", "para", "h2", "para", "image", "summary", "faq"],
      listicle: ["para", "h2", "list", "para", "image", "h2", "para", "h2", "table", "image", "summary", "faq"],
    },
    visual: ["H2/H3", "표", "FAQ(AEO)", "이미지 alt"],
    /* 🔴 [R8 §9 · 2026-09-15] **요구를 우리가 늘 채울 수 있는 것만 남긴다** — `visual_min` 은 막지는 않지만 빨개지면 **재작성(=돈)** 을 부른다.
       뺀 것: ①`tiers.optional` 이 뺄 수 있는 칸(계약이 스스로 싸웠다 · `contractSelfConflicts` 가 0 이 되게)
       ②사진 장수 — 조달이 «AI 1장 + 고객·스톡»으로 바뀌므로 **늘 보장되는 1장**만 요구한다(6장을 요구하면 조달을 못 바꾼다).
       ③FAQ — 근거였던 검색 리치 결과가 2025-05-08 지원 중단이라 **SEO 값이 0**이고, 실물도 글마다 다르다(R8-A). */
    visualMin: { h2: 3, image: 1 },
    length: { min: 1200, max: 2000 },
    titleStyle: "google", titleExample: "2026 에어프라이어 청소 방법 총정리",
    images: { min: 1, max: 3, default: 2, style: "photo", aspect: "16:9", captionRate: 0.5 },
    emojiPerParagraph: 0, text: true,
    /* [R8-A 실물 근거] 블로거 2편: 2,500 / 3,850자 · 이미지 0 / 11장 · FAQ 0/2 · 목차 0/2·1/2 · 라벨 0/4 · H2 6·6.
       🔴 «이미지 0장인 정보 글»이 실제로 있다 — 그래서 하한을 0 으로 연다. */
    lengthByGroup: { review: { min: 1500, max: 3000 }, info: { min: 1500, max: 4000 }, life: { min: 1200, max: 3000 } },
    imagesByGroup: { review: { min: 2, max: 8, default: 4 }, info: { min: 0, max: 6, default: 2 }, life: { min: 1, max: 6, default: 2 } },
    tiers: { required: ["para", "h2"], optional: ["toc", "faq", "h3", "table", "list", "checklist", "image", "tip"], suppress: ["summary", "quote", "divider", "adsense", "hashtags"] },
    goalRules: {
      adsense: [
        "이 글의 목표는 «끝까지 읽게 하는 것»이다 — 소제목을 넉넉히 두고 각 소제목 아래를 스스로 완결되게 쓴다.",
        "🔴 **광고를 가리키는 말만** 쓰지 않는다 — «아래 배너»·«광고 눌러 주세요»·광고 위치 지시. (일반 권유는 막지 않는다.)",
        "🔴 **끝맺음은 «다음 행동 한 줄»**이다 — «오늘 하나만 해 보세요: …». 독자를 계속 읽게·다시 오게 만드는 유도는 **더 해야 한다**(체류가 곧 수익).",
        "소구점을 먼저 던지고(«이거 몰라서 손해 봤다») 공감 → 정보 → 다음 행동 순서로 간다.",
      ],
      affiliate: ["비교 기준을 먼저 주고 내가 왜 그걸 골랐는지 말한다.", "🔴 제휴 고지는 첫머리에 그대로 둔다(법)."],
    },
  },
  threads: {
    channel: "threads", emotionKey: "hook", label: "쓰레드 · 훅·짧게",
    reader: "피드를 훑는 친구 — 첫 줄에서 멈추지 않으면 못 읽는다",
    register: "친구에게 툭 «~임 / ~함 / ~했는데» 반말 또는 가벼운 존댓말",
    rules: [
      "첫 줄이 훅이다 — 결론·반전·질문 중 하나로 시작한다.",
      "본문은 3~5줄. 줄바꿈으로 리듬을 만들고 한 줄은 40자 이내.",
      /* [R8-A §4] 🔴 쓰레드는 «해시태그»가 아니라 **토픽 태그**이고 공식 상한이 **게시물당 1개**다
         («You can include up to 1 topic per post» · https://help.instagram.com/1356090605000312).
         예전 문구 «해시태그 0~2개» 는 플랫폼에 없는 규칙이었다.
         🔴 링크는 댓글에 달아도 되지만 **고지(대가 표시)는 본문 첫 부분**이다 — 공정위는 «댓글·본문 중간»을 부적절한 위치로 본다. */
      "링크는 본문에 넣지 않는다(댓글에 단다) — 다만 대가 고지는 본문 첫 줄이다. 토픽 태그는 0~1개(쓰레드는 게시물당 1개만 붙는다).",
      "«~에 대해 알아보겠습니다» 류 도입 금지. 바로 본론.",
    ],
    formats: ["story", "info", "qna"],
    formatLabel: { story: "경험 한 토막", info: "팁 한 줄", qna: "질문→답" },
    structure: { story: ["hook", "para", "para", "image"], info: ["hook", "list", "para", "image"], qna: ["hook", "para", "para", "image"] },
    visual: ["줄바꿈 리듬", "이미지 1장"],
    visualMin: { image: 1 },
    length: { min: 120, max: 500 },
    titleStyle: "hook", titleExample: "에어프라이어 3분 청소법, 진짜 됨",
    images: { min: 0, max: 1, default: 1, style: "photo", aspect: "1:1", captionRate: 0 },
    emojiPerParagraph: 1, text: true,
  },
  /* [R12-6 · 2026-09-17 · B] 🔴 **당근 비즈프로필 «새소식»** — `verify-channel-tables` 가 «textGen=true 인데 글 계약이 없다»로 잡아 줘서 채웠다.
     계약이 없으면 `contractFor` 가 **네이버 블로그 계약을 채널명만 바꿔** 돌려준다 — 1,500자짜리 블로그 글이 **평문 새소식**에 통째로 올라간다.
     ⚠️ 값의 근거: AM `daangn-runner.mjs`(2026-07 실측) 헤더 + 새소식 에디터가 **평문**이라는 사실. 🔴 **실제로 올려 본 적은 없다**(탐침 대기) —
        그래서 «본 것»(서식 0 · 사진 10장)만 못 박고, 못 본 것(정확한 글자 수 상한)은 **보수적으로** 잡았다(짧은 쪽이 안전하다).
     🔴 독자가 «이웃»이 아니라 **동네 사람**이다 — 이게 이 채널을 네이버와 가르는 유일한 축이고, 계정마다 덮어쓸 수 있다(R11-8 `accounts.reader`). */
  daangn: {
    channel: "daangn", emotionKey: "hook", label: "당근 새소식 · 동네 말투",
    reader: "우리 동네 사람 — 가게가 가까운지, 지금 가도 되는지를 먼저 본다",
    register: "가게 주인이 이웃에게 «~해요 / ~하고 있어요» 나긋한 존댓말",
    rules: [
      "첫 줄에 **무슨 소식인지**를 그대로 쓴다(«새로 들어왔어요» «이번 주만» 같은 사실 한 줄).",
      "동네·거리·시간을 말한다 — 읽는 사람이 «걸어갈 만한가»를 바로 알 수 있게.",
      /* 🔴 **서식이 0** 이라 굵게·형광펜으로 강조할 수 없다 — 강조는 **줄바꿈과 낱말 순서**로만 한다.
         이 줄이 없으면 모델이 «**굵게**» 를 본문 글자로 써서 별표가 그대로 올라간다(마크가 아니라 글자로). */
      "굵게·밑줄·형광펜을 쓸 수 없는 곳이다 — 강조는 줄바꿈과 낱말 순서로만 한다. 별표(**)·마크다운을 본문에 쓰지 않는다.",
      "«~에 대해 알아보겠습니다» 류 도입 금지. 과장·최상급 금지(동네 장사에서 제일 빨리 신뢰를 깎는다).",
    ],
    formats: ["story", "info"],
    formatLabel: { story: "오늘 있었던 일", info: "알아 두면 좋은 것" },
    structure: { story: ["hook", "para", "para", "image"], info: ["hook", "list", "para", "image"] },
    visual: ["사진 1~10장(첫 장이 대표)", "줄바꿈 리듬"],
    visualMin: { image: 1 },
    length: { min: 150, max: 700 },
    titleStyle: "hook", titleExample: "오늘 들어온 딸기, 한 상자 8천원이에요",
    images: { min: 1, max: 10, default: 3, style: "photo", aspect: "1:1", captionRate: 0 },
    emojiPerParagraph: 0, text: true,
  },
  instagram: {
    channel: "instagram", emotionKey: "cardnews", label: "인스타 카드뉴스 · 짧고 단정",
    reader: "썸네일을 넘기며 보는 사람 — 카드 한 장에 한 메시지",
    register: "짧고 단정한 명사형·구어 «~하기 / ~해요»",
    /* [R8 §2.5] 🔴 옛 판은 «표지 1장 → 핵심 5장 → CTA 1장»을 **규칙(문장)으로만** 적고 골격에는 image 블록이 **한 개도 없었다**.
       그러면 `structureFor` 가 사진 6장을 **맨 앞에 몰아 넣는다**(붙일 `para` 가 없어 `lastIndexOf("para") = -1` → 전부 index 1).
       = 표지도 CTA 도 없는 «카드 6장 뭉치 + 목록 5개»가 나온다. AC-63 그대로다 — **규칙과 구조가 싸우면 구조가 이긴다.**
       그래서 골격에 카드를 **자리마다 박았다**. 카드 한 장 = image 블록 하나다. */
    rules: [
      "🔴 **카드 한 장 = image 블록 하나**다. 카드마다 `caption` 을 단다 — 그 한 줄이 카드 위에 얹히는 글자다(30자 이내).",
      "🔴 **첫 카드는 표지**(제목을 그대로 베끼지 말고 한 번 더 좁힌다) · **마지막 카드는 행동 유도**(저장·다음 글·프로필). 가운데는 핵심 하나씩.",
      "한 카드에 한 메시지. 두 가지를 한 카드에 넣지 않는다. 숫자·단계로 구조를 준다.",
      "🔴 카드 글자는 **장면 설명이 아니다** — «~하는 모습» «~이 놓여 있는» 금지. 읽는 사람이 바로 가져갈 한 마디를 쓴다.",
      "게시물 본문(캡션)은 2~3줄이면 충분하다 — 카드에서 이미 다 말했다. 해시태그 5~10개.",
    ],
    /* 🔴 [R8 §2.5] format 이 **1종뿐이라 모든 글의 골격이 같았다** — `structure_repeat` 축이 10편 중 9편을 잡는다.
       (`structurePrint` 는 **블록 타입 순서**를 본다 · 한 가지 골격이면 두 번째 글부터 100% 겹친다.)
       다섯으로 늘리되 **순서가 실제로 다르게** 짰다 — 카드 수·곁들이는 블록·끝맺음을 셋 다 달리한다. */
    formats: ["cardnews", "steps", "listicle", "compare", "qna"],
    formatLabel: {
      cardnews: "카드뉴스(표지→핵심→CTA)", steps: "단계형(1단계씩 한 카드)", listicle: "N가지형(하나씩 넘기며)",
      compare: "비교형(A vs B 표)", qna: "문답형(궁금한 것부터)",
    },
    structure: {
      cardnews: ["hook", "image", "image", "image", "image", "image", "image", "tip", "para", "hashtags"],
      steps: ["hook", "image", "checklist", "image", "image", "image", "image", "image", "summary", "hashtags"],
      listicle: ["hook", "list", "image", "image", "image", "image", "image", "image", "tip", "hashtags"],
      compare: ["hook", "image", "table", "image", "image", "image", "image", "image", "quote", "hashtags"],
      qna: ["hook", "image", "image", "image", "image", "image", "image", "faq", "para", "hashtags"],
    },
    visual: ["카드 6~8장", "카드마다 30자 이내 한 줄", "표지 카드", "마지막 카드는 행동 유도"],
    /* 🔴 `image: 6` 은 계약과 **싸우지 않는다** — 아래 `images.default`·`imagesByGroup` 이 전부 6장 이상이다
       (`contractSelfConflicts` 가 이 둘을 대조한다 · CLAUDE §9 «최소치도 게이트다»). */
    visualMin: { image: 6, hashtags: 5 },
    length: { min: 150, max: 400 },
    titleStyle: "card", titleExample: "에어프라이어 청소 3단계",
    images: { min: 6, max: 8, default: 6, style: "infographic", aspect: "1:1", captionRate: 0 },
    /* 🔴 카드 수도 주제군마다 다르다(§2.5 «카드 6~8장»). 후기는 보여 줄 것이 많고 정보성은 짧게 끝난다. */
    imagesByGroup: { review: { min: 6, max: 8, default: 8 }, info: { min: 6, max: 8, default: 6 }, life: { min: 6, max: 8, default: 7 } },
    /* 🔴 카드 글자 — `captionRate: 0` 을 **덮는다**(카드뉴스에서 글자 없는 카드는 카드가 아니다 · `cardText` 필드 설명). */
    cardText: { max: 30 },
    emojiPerParagraph: 1, text: false,
  },
  wordpress: {
    channel: "wordpress", emotionKey: "seo", label: "워드프레스 · SEO 정보",
    reader: "구글 검색·AI 답변엔진으로 들어온 사람",
    register: "격식 존댓말 «~합니다» · 간결한 SEO 정보 · 영문 slug·메타",
    rules: [
      "티스토리와 같은 정보 톤. 바탕은 «~합니다» 지만 **열 문장 중 두세 문장은 «~해 보세요»·«~일까요?»** 로 섞는다.",
      "🔴 문단 하나는 **2~3문장**. 네 문장이 넘으면 나눈다.",
      "첫 문단 150자 안에 핵심 답(메타 설명).",
      "FAQ 3문답으로 마무리. 이미지 alt 는 장면 설명.",
      "근거 없는 수치·최상급 금지.",
    ],
    formats: ["info", "guide", "listicle"],
    formatLabel: { info: "정보형", guide: "가이드형", listicle: "리스트형" },
    structure: {
      info: ["para", "h2", "para", "image", "h2", "table", "para", "h2", "para", "image", "summary", "faq"],
      guide: ["para", "h2", "checklist", "para", "image", "h2", "para", "h2", "para", "image", "summary", "faq"],
      listicle: ["para", "h2", "list", "para", "image", "h2", "para", "h2", "table", "image", "summary", "faq"],
    },
    visual: ["H2/H3", "표", "FAQ(AEO)", "이미지 alt", "영문 slug"],
    /* 🔴 [R8 §9 · 2026-09-15] **요구를 우리가 늘 채울 수 있는 것만 남긴다** — `visual_min` 은 막지는 않지만 빨개지면 **재작성(=돈)** 을 부른다.
       뺀 것: ①`tiers.optional` 이 뺄 수 있는 칸(계약이 스스로 싸웠다 · `contractSelfConflicts` 가 0 이 되게)
       ②사진 장수 — 조달이 «AI 1장 + 고객·스톡»으로 바뀌므로 **늘 보장되는 1장**만 요구한다(6장을 요구하면 조달을 못 바꾼다).
       ③FAQ — 근거였던 검색 리치 결과가 2025-05-08 지원 중단이라 **SEO 값이 0**이고, 실물도 글마다 다르다(R8-A). */
    visualMin: { h2: 3, image: 1 },
    length: { min: 1200, max: 2000 },
    titleStyle: "google", titleExample: "2026 에어프라이어 청소 방법 총정리",
    images: { min: 1, max: 3, default: 2, style: "photo", aspect: "16:9", captionRate: 0.5 },
    emojiPerParagraph: 0, text: true,
    /* [R8-A 실물 근거] 워드프레스 2편: 28,000~40,000자 · 이미지 15~20장 · 목차 2/2 · FAQ 0/2 · 이모지 2~15개(💡📍👉) · H3 4~30.
       🔴 표본 2편이 **둘 다 대형 가이드**라 «폭의 위쪽만 봤다» — 하한은 우리 값을 지키고 상한만 연다(조사 §8.3). */
    lengthByGroup: { review: { min: 1500, max: 4000 }, info: { min: 2000, max: 15000 }, life: { min: 1500, max: 5000 } },
    imagesByGroup: { review: { min: 2, max: 12, default: 5 }, info: { min: 2, max: 20, default: 6 }, life: { min: 2, max: 10, default: 4 } },
    /* 🔴 목차는 워드프레스에서 **흔하다**(2/2) — 티스토리와 반대다. 그래서 «선택»이되 긴 글이면 붙는다. */
    tiers: { required: ["para", "h2"], optional: ["toc", "h3", "table", "list", "checklist", "image", "tip", "faq"], suppress: ["summary", "quote", "divider", "adsense", "hashtags"] },
    goalRules: {
      adsense: [
        "이 글의 목표는 «끝까지 읽게 하는 것»이다 — 소제목을 넉넉히 두고 각 소제목 아래를 스스로 완결되게 쓴다.",
        "🔴 **광고를 가리키는 말만** 쓰지 않는다 — «아래 배너»·«광고 눌러 주세요»·광고 위치 지시. (일반 권유는 막지 않는다.)",
        "🔴 **끝맺음은 «다음 행동 한 줄»**이다 — «오늘 하나만 해 보세요: …». 독자를 계속 읽게·다시 오게 만드는 유도는 **더 해야 한다**(체류가 곧 수익).",
        "소구점을 먼저 던지고(«이거 몰라서 손해 봤다») 공감 → 정보 → 다음 행동 순서로 간다.",
      ],
      affiliate: ["비교 기준을 먼저 주고 내가 왜 그걸 골랐는지 말한다.", "🔴 제휴 고지는 첫머리에 그대로 둔다(법)."],
    },
  },
  /* 영상 대본 3채널 — 같은 계약(§5C.1 «쇼츠·클립·릴스 대본» 1행). 생성은 Phase 3 · 계약은 지금 전부. */
  youtube_shorts: shortsContract("youtube_shorts", "유튜브 쇼츠 · 3초 훅·자막 본체", "9:16"),
  naver_clip: shortsContract("naver_clip", "네이버 클립 · 생활밀착·네이버 톤", "9:16"),
  reels: shortsContract("reels", "릴스 · 감성 b-roll", "9:16"),
  tiktok: shortsContract("tiktok", "틱톡 · 3초 훅", "9:16"),
};

/* ═══ P1R5 §1.3 — 영상 계약 4행(DESIGN §5C.1 «쇼츠·클립·릴스 대본» + §5.4 감성 3행 + §6.2 포맷 3·채널 규격). 포맷×초 표는 `shortsFormOf` 한 함수가 낸다(AM shorts-reference.shortsFormOf 관례 · SHORTS6 «길이·컷·발화 예산 한 표»). ═══ */
export type ShortsFormat = "graphic" | "talking" | "clip";
/** [R12-7] 영상 길이 리터럴 — 🔴 정본은 `lib/video/types.ts VideoSeconds` 다. 이 파일은 **순수 표**라 저쪽을 import 하지 않으므로(순환 0) 같은 글자를 여기 한 번 적는다.
 *  🔴 둘이 갈리면 tsc 가 곧바로 빨개진다(`resolveVideoSeconds` 가 두 타입을 한 자리에서 쓴다) — 그게 이 중복의 안전장치다. */
export type VideoSecondsLit = 15 | 30 | 60 | 90;
export interface ShortsForm {
  format: ShortsFormat; seconds: VideoSecondsLit;
  /** 컷 수(min·max·기본). */
  cuts: { min: number; max: number; default: number };
  /** 컷 길이(초 · provider 생성 길이 상한 8). */
  cutSec: { min: number; max: number };
  /** 기본 provider 키(계약 §0.1-1 · 15초 = veo_lite 강제). */
  provider: "omni" | "veo_lite";
  /** 발화 예산(음절 · 초당 4.6 × 85%). */
  syllables: { min: number; max: number };
  /** 자막 프리셋(계약 §2.1 captions.preset). */
  captionPreset: "keyword_center" | "talking_big" | "clip_top";
  /** 정지 이미지 대체(토킹 = B-roll 절반 · Ken Burns). */
  stillRatio: number;
  /** 채널 규격(§6.2): 최대 초 · 세이프존. */
  /** 채널 상한 표 — 값은 `VIDEO_CHANNEL_MAX_SEC` 한 곳에서 온다([P1R6 §2.3] · 여기에 숫자를 다시 적지 않는다). */
  channelMaxSec: Readonly<Record<string, VideoSecondsLit>>;
}
/** shortsFormOf(format, seconds) — 포맷·초 → 계약 한 표(순수). */
export function shortsFormOf(format: ShortsFormat, seconds: VideoSecondsLit): ShortsForm {
  const maxSyl = Math.floor(seconds * 4.6 * 0.85);
  const syllables = { min: Math.floor(maxSyl * 0.55), max: maxSyl };
  const channelMaxSec = VIDEO_CHANNEL_MAX_SEC;   // 🔴 표는 위 한 곳(§2.3) — 여기서 다시 적지 않는다
  /* [R12-7] 🔴 클립형은 **어느 채널에서도 30을 넘지 않는다**(§1.3 표) — 60 이 30 으로 내려앉던 그대로 **90 도 30 으로** 내려앉는다.
     `seconds === 60 ? 30 : seconds` 만 두면 90 이 그대로 통과해 «90초 클립형»이 조용히 생긴다. */
  if (format === "clip") return { format, seconds: seconds >= 60 ? 30 : seconds, cuts: { min: 3, max: 4, default: 3 }, cutSec: { min: 5, max: 8 }, provider: seconds === 15 ? "veo_lite" : "omni", syllables, captionPreset: "clip_top", stillRatio: 0, channelMaxSec };
  /* 🔴 토킹(계약 §1.3 표): 컷 길이 **5초 고정** · B-roll 3~4 · **나머지 정지 이미지**. 즉 컷 수는 «초 ÷ 5»(60초 = 12컷)이지 3~4 가 아니다.
     예전 값(default 4)은 60초를 컷 4개로 나눠 창이 15초가 됐고, 8초 상한 클립으로는 7초가 비어 러너가 멈춘 화면을 늘려야 했다(설계 축소 · CLAUDE §8). */
  if (format === "talking") { const tc = Math.round((seconds === 15 ? 30 : seconds) / 5); return { format, seconds: seconds === 15 ? 30 : seconds, cuts: { min: Math.max(3, tc - 3), max: tc + 3, default: tc }, cutSec: { min: 5, max: 5 }, provider: "veo_lite", syllables, captionPreset: "talking_big", stillRatio: 0.5, channelMaxSec }; }
  /* [R12-7] 그래픽 스토리 90초 — 60초 표(6~12 · 기본 9)를 **1.5배**로 넓힌다. 컷당 초(5~8)는 그대로라 컷 수만 늘어난다.
     🔴 60초 이하의 값은 **한 숫자도 안 바뀐다**(무회귀 · 계약 §5). */
  const s60 = seconds === 60;
  const cuts = seconds === 90 ? { min: 9, max: 18, default: 13 } : s60 ? { min: 6, max: 12, default: 9 } : { min: 4, max: 6, default: 5 };
  return { format: "graphic", seconds: seconds === 15 ? 30 : seconds, cuts, cutSec: { min: 5, max: 8 }, provider: "omni", syllables, captionPreset: "keyword_center", stillRatio: 0, channelMaxSec };
}
/**
 * 🔴 **이 편이 몇 컷인가 — 한 곳**(2026-09-21 B).
 *
 *   여태 이 셈이 **두 벌**이었다:
 *     · 만들 때  `lib/video/gen.ts:102` → `clamp(spec.cuts || form.cuts.default, min, max)`  ← 맞는 쪽
 *     · 값 잴 때 `lib/video/cost.ts:39`  → `seconds === 60 ? 9 : seconds === 30 ? 5 : 3`     ← **손으로 베낀 쪽**
 *   베낀 쪽에 **90 이 없어서 3컷으로 떨어졌다.** 90초 추정 원가가 60초보다 **싸게** 나왔고,
 *   그 값으로 `checkAiCostCap`·하드캡이 판정하니 **90초가 실제보다 싸 보이는 채로 관문을 통과**했다.
 *   🔴 표시가 틀린 게 아니라 **돈 관문이 틀렸다** — 그래서 고객이 알려 줄 수 없고 더 늦게 들킨다.
 *   🔎 AM 에는 이 삼항이 없다(메인 확인) — AC 에서 생긴 줄이라 우리가 고친다.
 *
 *   ⇒ 이제 **둘 다 이 함수를 부른다.** 컷 수를 다시 적는 자리를 만들지 마라.
 *   `asked` = 고객이 손보기에서 고른 컷 수(`spec.cuts`). `0`·`undefined` 는 «안 골랐다»로 본다
 *   (🔴 `??` 로 받으면 `0` 이 그대로 통과해 **0으로 나누게 된다** — `||` 여야 한다).
 */
export function cutCountFor(format: ShortsFormat, seconds: VideoSecondsLit, asked?: number): number {
  const c = shortsFormOf(format, seconds).cuts;
  return Math.max(c.min, Math.min(c.max, Number(asked) || c.default));
}

/* ═══════════ 영상 채널 규격 — 🔴 **한 곳**(계약 P1R6 §2.3 «화면 상수 금지») ═══════════
 *   여기가 정본이다: `clampSecondsForChannel`·`shortsFormOf`·`accounts-list.channels[].video` 가 전부 이 표를 읽는다.
 *   화면(A)은 이 값을 서버에서 받아 칩을 켜고 끈다 — «클립은 30초까지» 같은 숫자를 화면에 적지 않는다.
 *   릴스 90초는 Phase 5(계약 R5 §7-3 «R5 제외») — 여기 60 을 올리는 것으로 열린다. */
export const VIDEO_CHANNEL_MAX_SEC: Readonly<Record<string, VideoSecondsLit>> = { youtube_shorts: 60, naver_clip: 30, reels: 90, threads: 60 };
/* [R12-7 · 2026-09-17] 🔴 **릴스만 90**으로 올렸다(감사 A12 «VIDEO_SECONDS 에 90 없음»).
   🔴 `naver_clip`(30)·`threads`(60)·`youtube_shorts`(60)는 **그대로다** — 여기서 셋이 같이 올라가면 «클립에 90초»가 조용히 생긴다(B2 지적 2026-09-17).
   🔴 그리고 **셋이 같이 움직여야** 한다: 이 표 · 코인 값(`coin-table.ts video_90`) · 심사 축(`lib/video/judge.ts duration_fit`).
      따로 가면 «90초인데 값은 60초»가 되고 그건 우리가 손해를 보는 쪽이라 더 늦게 들킨다. */
/** 포맷 자체의 상한(채널과 **별개** 축) — 클립형은 생활밀착 15~30초라 어느 채널에서도 30을 넘지 않는다(§1.3 표). */
export const VIDEO_FORMAT_MAX_SEC: Readonly<Record<ShortsFormat, VideoSecondsLit>> = { graphic: 90, talking: 90, clip: 30 };
export const VIDEO_FORMAT_LABEL: Readonly<Record<ShortsFormat, string>> = { graphic: "그래픽 스토리", talking: "말하는 영상", clip: "짧은 클립" };

/** 이 채널에서 고를 수 있는 것 — 채널 상한 + 포맷별 상한(둘 중 작은 것이 실제 상한). */
export function videoChannelSpec(channel: string): { maxSeconds: VideoSecondsLit; formats: { key: ShortsFormat; label: string; maxSeconds: VideoSecondsLit }[] } | null {
  const max = VIDEO_CHANNEL_MAX_SEC[channel];
  if (!max) return null;
  const formats = (Object.keys(VIDEO_FORMAT_MAX_SEC) as ShortsFormat[]).map((key) => ({
    key, label: VIDEO_FORMAT_LABEL[key], maxSeconds: Math.min(max, VIDEO_FORMAT_MAX_SEC[key]) as VideoSecondsLit,
  }));
  return { maxSeconds: max, formats };
}

/**
 * videoSecondsFor — 채널·테넌트 설정 → **이 편의 길이**(15|30|60). 채널 상한(클립 채널 30)까지 자른다.
 *   🔴 [2026-09-16] `lib/director.ts` 에 있던 것을 **표 옆으로** 옮겼다 — 값을 쓰는 곳이 디렉터만이 아니다.
 *      편성표 견적(`lib/slots.ts`)이 이 함수를 못 불러서 **60초라고 혼자 정하고 있었다**(아래 `estimateVideoSeconds` 주석).
 * 🔴 «고르지 않았다»의 답은 **60**이다 — 이건 날조가 아니라 **우리 기본값**이고, 안 고른 고객에게 실제로 만들어 주는 길이다.
 *    날조와 기본값의 차이: 기본값은 **그대로 실행된다**(고객이 받는 것과 같다). 날조는 실행과 다른 값을 말한다.
 */
export function videoSecondsFor(channel: string, want?: unknown): VideoSecondsLit {
  /* [R12-7] 90 도 «고른 값»이다. 🔴 **기본값은 여전히 60** — 안 고른 고객에게 만들어 주는 길이를 바꾸면 그건 «칸 열기»가 아니라 조용한 개편이고
     길이 구간제라 **코인이 통째로 오른다**(계약 §5 무회귀). */
  const n0 = Number(want); const base: VideoSecondsLit = n0 === 15 || n0 === 30 || n0 === 60 || n0 === 90 ? n0 : 60;
  return clampSecondsForChannel(channel, base);
}

/**
 * estimateVideoSeconds — **아직 포맷을 안 고른 자리**(편성표)가 쓸 길이. 견적·코인 값 계산용.
 *
 * 🔴 [2026-09-16 · AC-92 훑기에서 나옴] 왜 `videoSecondsFor` 로는 모자라나:
 *    실제 길이는 **채널 상한 ∩ 포맷 상한**이고(§2.3 `resolveVideoSeconds`), 포맷은 디렉터가 로테이션으로 **나중에** 고른다.
 *    그런데 포맷은 길이를 **내리기만 하지 않는다** — `shortsFormOf` 는 15초를 30초로 **올린다**(토킹·그래픽 모두).
 *    ⇒ 「15초로 맞춰 둔 고객에게 편성표가 6코인이라 적고 실제로 12코인을 빼는」 자리가 된다.
 * 🔴 그래서 **고를 수 있는 포맷 전부를 실제로 돌려 보고 그중 가장 긴 것**을 쓴다 —
 *    표의 숫자를 여기 베껴 적지 않는다(베낀 검사·베낀 값은 표가 바뀌면 낡는다 · AC-78).
 *    가장 긴 쪽으로 트는 이유: 견적이 실제보다 **낮으면** 고객이 «적혀 있던 것보다 더 빠졌다»를 겪는다. 그건 돈 이야기라 한쪽으로만 틀려야 한다.
 */
export function estimateVideoSeconds(channel: string, want?: unknown): VideoSecondsLit {
  const asked = videoSecondsFor(channel, want);
  const all = (Object.keys(VIDEO_FORMAT_MAX_SEC) as ShortsFormat[]).map((f) => shortsFormOf(f, asked).seconds);
  return Math.max(...all) as VideoSecondsLit;
}

/** 채널의 최대 초(§6.2 채널 규격) — 15|30|60|90 중 채널이 허용하는 것. 🔴 **올림이 아니라 내림**이다(채널 상한을 넘지 않는다). */
export function clampSecondsForChannel(channel: string, seconds: number): VideoSecondsLit {
  const max = VIDEO_CHANNEL_MAX_SEC[channel] ?? 60;
  const s: VideoSecondsLit = seconds <= 15 ? 15 : seconds <= 30 ? 30 : seconds <= 60 ? 60 : 90;
  return (Math.min(s, max) as VideoSecondsLit);
}

function shortsContract(channel: string, label: string, aspect: "9:16"): WritingContract {
  const clip = channel === "naver_clip"; const reels = channel === "reels";
  return {
    channel, emotionKey: "script", label,
    reader: clip ? "네이버 앱에서 생활 정보를 훑는 사람 — 15~30초 · 상단 자막 크게" : reels ? "감성 피드를 넘기는 사람 — 텍스트 오버레이 · BGM 무드" : "무음으로 스크롤하는 시청자 — 3초 안에 멈추게 해야 한다",
    register: clip ? "생활밀착 네이버 톤 · 존댓말 · 짧은 문장" : "구어체 반말/존댓말 · 자막이 본체",
    rules: [
      "3초 훅(반전·문제 제기·숫자 · ≤16음절 · 도입어 금지) · 문장 4~10개 · 한 문장 ≤ 28음절.",
      "무음 시청 전제 — 자막만으로 이해되게(나레이션은 보조).",
      "컷 4~8(60초는 6~12) · 문장 경계 = 컷 경계 · 엔드카드 1 · 마무리는 행동 한 줄(광고성 CTA 금지).",
      "제휴·유료면 시작 3초 자막 + 우상단 상시 배지 «광고 포함 · 파트너스 수수료» + 설명란 첫 줄 공식 문구(§16B).",
      ...(clip ? ["쇼핑커넥트 태그는 메타로 · 본문에서 팔지 않는다."] : []),
      ...(reels ? ["텍스트 오버레이 큰 글씨 · BGM 무드(라이선스 확인분만)."] : []),
    ],
    formats: ["story", "info", "listicle", "compare"],
    formatLabel: { story: "반전", info: "문제해결", listicle: "목록(3가지)", compare: "비포애프터" },
    structure: { story: ["hook", "para", "para", "para", "tip"], info: ["hook", "para", "para", "para", "tip"], listicle: ["hook", "list", "para", "tip"], compare: ["hook", "para", "para", "tip"] },
    visual: ["자막 본체(문장 4~10)", "컷 4~8", "엔드카드", "우상단 배지(제휴 시)", clip ? "상단 큰 자막" : "키워드 중앙 자막"],
    visualMin: {},
    length: { min: 60, max: 235 },
    titleStyle: "script", titleExample: "에어프라이어, 3분 만에 새것 되는 법",
    images: { min: 0, max: 0, default: 0, style: "photo", aspect, captionRate: 0 },
    emojiPerParagraph: 0, text: false,
  };
}

/* ───────── DB 오버레이(emotion_profiles.contract) ───────── */
const cache = new Map<string, { c: WritingContract; at: number }>();
const OVERLAY_KEYS: (keyof WritingContract)[] = ["label", "reader", "register", "rules", "formats", "formatLabel", "structure", "visual", "visualMin", "length", "titleStyle", "titleExample", "images", "emojiPerParagraph"];

/** contractFor(channel, emotionKey?) — 코드 기본값 + DB 오버레이(있으면 필드 단위 덮어씀 · 60초 캐시 · graceful). 미등록 채널은 naver_blog 계약을 채널명만 바꿔 돌려준다. */
export async function contractFor(channel: string, emotionKey?: string | null): Promise<WritingContract> {
  const base = WRITING_CONTRACTS[channel] ?? { ...WRITING_CONTRACTS.naver_blog, channel };
  const key = `${channel}.${emotionKey || base.emotionKey}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.c;
  let merged: WritingContract = { ...base };
  try {
    const rows = (await db.execute(sql`SELECT contract FROM emotion_profiles WHERE key = ${key} LIMIT 1`)) as unknown as { contract: Record<string, unknown> }[];
    const o = rows[0]?.contract;
    if (o && typeof o === "object") {
      /* 운영센터 시드(Phase 0 seed-plans)의 짧은 모양도 받는다: length [min,max] · images [min,max] · tone → register.
         그 밖의 필드는 **기본값과 같은 모양(배열/객체/문자열)일 때만** 덮어쓴다 — 모양이 다르면 무시(스모크 실사고: length 배열이 객체를 덮어 NaN 코인). */
      const o2: Record<string, unknown> = { ...o };
      if (Array.isArray(o2.length) && o2.length.length >= 2) o2.length = { min: Number(o2.length[0]), max: Number(o2.length[1]) };
      if (Array.isArray(o2.images) && o2.images.length >= 2) o2.images = { min: Number(o2.images[0]), max: Number(o2.images[1]), default: Number(o2.images[0]) };
      if (typeof o2.tone === "string" && !o2.register) o2.register = o2.tone;
      for (const k of OVERLAY_KEYS) {
        const v = o2[k as string];
        if (v === undefined || v === null) continue;
        const cur = base[k];
        const shape = (x: unknown) => Array.isArray(x) ? "array" : typeof x === "object" ? "object" : typeof x;
        if (shape(cur) !== shape(v)) continue;
        if (shape(cur) === "object") (merged as unknown as Record<string, unknown>)[k] = { ...(cur as object), ...(v as object) };
        else (merged as unknown as Record<string, unknown>)[k] = v;
      }
      if (emotionKey) merged.emotionKey = emotionKey;
    }
  } catch { /* 오버레이 없음 — 코드 기본값 */ }
  cache.set(key, { c: merged, at: Date.now() });
  return merged;
}

/** 채널의 기본 이미지 수(coinsPerWeek·디렉터 imageCount). */
/** [R8] 그 채널이 **한 가지 구성만** 쓰면 그 구성(인스타 = `cardnews`). 🔴 값 매기는 방식이 갈린다 — 카드뉴스는 장수로 안 세고 통째로 3코인이다. */
export function soleFormatOf(channel: string): FormatKey | null {
  const c = WRITING_CONTRACTS[channel];
  return c && c.formats.length === 1 ? c.formats[0] : null;
}
export function defaultImageCount(channel: string): number { return (WRITING_CONTRACTS[channel] ?? WRITING_CONTRACTS.naver_blog).images.default; }
/**
 * [R10-7] 견적 자리(편성표 · 규칙)가 쓰는 **동기** 추정 — 소재·주제군을 아직 모르는 자리라 채널 기본 사진 자리로 «이 등급이면 AI 몇 장»을 센다.
 *   디렉터가 실제로 정하는 값(`imageCountFor` + `plannedAiFor`)과 **같은 두 함수**를 부른다 — 견적과 차감이 갈릴 수 없게.
 */
export function estimateAiImagesFor(channel: string, tier: CoinTier): number {
  const c = WRITING_CONTRACTS[channel] ?? WRITING_CONTRACTS.naver_blog;
  return plannedAiFor(tier, imageCountFor(c, null, tier));
}

/** 문자열 시드 → 결정론 해시(AM hashSeed). */
export function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

/** 직전 글과 다른 format 을 결정론으로(로테이션 · DESIGN §5.3-3). recent = 최신순. */
export function pickFormat(c: WritingContract, recent: string[], seed: string, hint?: string | null): FormatKey {
  if (hint && c.formats.includes(hint as FormatKey)) return hint as FormatKey;
  const last = recent[0];
  const pool = c.formats.filter((f) => f !== last);
  const cands = pool.length ? pool : c.formats;
  // 최근에 안 쓴 것 우선
  const fresh = cands.filter((f) => !recent.slice(0, Math.max(0, c.formats.length - 1)).includes(f));
  const list = fresh.length ? fresh : cands;
  return list[hashSeed(seed) % list.length];
}

/** format 의 블록 시퀀스를 이미지 수에 맞춰 조정(image 블록을 count 개로 · 부족하면 뒤에서 제거 · 넘치면 para 뒤에 추가). */
/** 작은 결정론 난수(seed) — 같은 글은 언제 만들어도 같은 골격이 나온다(재생성 멱등). */
function seeded(seed: number): () => number {
  let x = (Math.floor(seed) || 1) >>> 0;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x / 0x100000000; };
}

/**
 * [R8-A §2] 블록 3단을 적용해 **골격을 글마다 다르게** 만든다.
 *   ① `suppress` 에 든 블록은 **뺀다**(«이 채널에선 흔하지 않다» — 넣으면 AI 티).
 *   ② `optional` 에 든 블록은 **seed 로 들쭉날쭉하게** 남긴다(대략 절반). `required` 는 건드리지 않는다.
 *   🔴 이게 이 라운드의 핵심이다 — 계약이 내는 골격이 **3~5가지뿐**이라 블로거·워드프레스는 4편째부터 반드시 겹쳤다(스모크 실측).
 *      `structure_repeat` 축(`lib/structure-print.ts`)이 그걸 재고, 이 함수가 그걸 **만들지 않게** 한다.
 *   `tiers` 가 없는 채널(쓰레드·인스타·영상)은 **아무것도 하지 않는다**(무회귀).
 */
/* 🔴 `visualMin` → 블록 타입별 요구 수(순수). `hashtags` 는 **블록 안 items 개수**를 세는 항목이라 골격 단계에서 못 정하므로 제외한다
   (`lib/ai-tell-gate.ts` visual_min 이 그렇게 센다 — 여기서 손으로 다시 세면 대용물이 된다 · AC-57). */
const TABLE_OR_LIST: readonly BlockType[] = ["table", "list", "checklist"];
const TABLE_OR_LIST_KEY = "__tableOrList" as unknown as BlockType;
function visualNeedOf(c: WritingContract): Map<BlockType, number> {
  const vm = c.visualMin as unknown as Record<string, number>;
  const m = new Map<BlockType, number>();
  for (const [k, v] of Object.entries(vm)) {
    if (!v || k === "hashtags") continue;
    if (k === "tableOrList") { m.set(TABLE_OR_LIST_KEY, v); continue; }
    m.set(k as BlockType, v);
  }
  return m;
}

export function applyTiers(base: BlockType[], c: WritingContract, seed: number): BlockType[] {
  const t = c.tiers;
  if (!t) return base;
  const rnd = seeded(seed);
  const out: BlockType[] = [];
  /* 🔴 [2026-09-15 C · R8] **계약이 스스로와 싸우지 않게 한다.**
     `visualMin` 이 요구하는 블록이 `tiers.optional` 에 있으면 ②에서 떨어질 수 있고, 그러면 `visual_min` 축이 실패해
     **재작성이 한 번 더 돈다 = 그 편 글 비용이 두 배**다. 아무도 규칙을 어기지 않았는데 돈만 든다.
     실측(제품 `runGate` 로 40편씩): naver_blog **80%** · tistory 15% · blogger 20% · wordpress 18% 가 미달이었다.
     🔴 재작성은 `content-gen.ts:278` 의 `!report.ok`(13축 **전부**)로 돈다 — `HARD_GATE_KEYS` 와 **무관**하다.
        그래서 게이트를 소프트로 바꿔도 이 비용은 안 사라진다(메인 확인 요청 2026-09-15 · 코드로 확인함).
     ⇒ **떨어뜨렸을 때 요구치 미만이 되는 블록은 남긴다.** 무작위는 그대로 두되 «못 채우는 무작위»만 막는다. */
  const need = visualNeedOf(c);
  const left = new Map<BlockType, number>();
  for (const b of base) if (!t.suppress.includes(b)) left.set(b, (left.get(b) ?? 0) + 1);
  const kept = new Map<BlockType, number>();
  const have = (k: BlockType) => (kept.get(k) ?? 0) + (left.get(k) ?? 0);
  /** 이걸 떨어뜨려도 `visualMin` 을 아직 채울 수 있나. */
  const droppable = (b: BlockType): boolean => {
    const own = need.get(b) ?? 0;
    if (own > 0 && have(b) - 1 < own) return false;
    /* `tableOrList` 는 셋 중 아무거나로 채운다 — 그룹 잔량으로 본다. */
    if (TABLE_OR_LIST.includes(b)) {
      const groupNeed = need.get(TABLE_OR_LIST_KEY) ?? 0;
      if (groupNeed > 0) {
        const groupHave = TABLE_OR_LIST.reduce((s, k) => s + have(k), 0);
        if (groupHave - 1 < groupNeed) return false;
      }
    }
    return true;
  };
  for (const b of base) {
    if (t.suppress.includes(b)) continue;                 // ① 억제
    left.set(b, (left.get(b) ?? 1) - 1);
    if (t.optional.includes(b) && rnd() < 0.45 && droppable(b)) continue; // ② 선택 — 글마다 들쭉날쭉(단, 계약이 요구하는 수는 남긴다)
    out.push(b);
    kept.set(b, (kept.get(b) ?? 0) + 1);
  }
  /* 선택 블록을 너무 많이 떨어뜨려 필수만 남으면 그것도 매번 같은 모양이다 — 하나는 되살린다. */
  if (!out.some((b) => t.optional.includes(b))) {
    const cand = base.filter((b) => t.optional.includes(b) && !t.suppress.includes(b));
    if (cand.length) { const pick = cand[Math.floor(rnd() * cand.length)]; const at = base.indexOf(pick); out.splice(Math.min(at, out.length), 0, pick); }
  }
  return addOptional(out, t, rnd);
}

/* 🔴 넣기에서 빼는 블록 — 꼬리는 `endWithAction` 이 정한다. 여기서 `tip` 을 꽂으면 끝맺음 교정과 싸우고,
   `hashtags`·`disclosure` 는 자리가 법·채널로 정해져 있어 흩뿌릴 값이 아니다. */
const NO_INSERT: readonly BlockType[] = ["tip", "hashtags", "disclosure", "adsense", "affiliate", "hook"];

/**
 * [2026-09-15 C · R8-A §1.3 실측] **빼기만 해서는 골격이 안 갈린다.**
 *   `applyTiers` 가 ②에서 «있는 것을 떨어뜨리기»만 하니, 가짓수가 **«그 format 배열에 우연히 들어 있는 optional 수»** 에 묶였다.
 *   blogger·wordpress 는 배열이 12블록 · optional 등장이 4~5개 · `required` 가 `[para,h2]` 뿐이라
 *   3개 format 이 억제·탈락을 거치면 **같은 골격으로 수렴**했다 — seed 1·3·4 가 글자 그대로 같은 배열을 냈다:
 *     `para,h2,para,h2,para,image,h2,para,image,faq,tip`
 *   실측 20편 가짓수: tistory 20 · naver_blog 13 · **blogger 6(3편째 중복)** · **wordpress 6(3편째 중복)** — 계약 기준은 «11~32 · 4편째 전 중복 없음».
 *   ⇒ 채널이 **허용한다고 적어 둔 optional 풀**에서 seed 로 **넣기도** 한다. 그러면 가짓수가 배열의 우연이 아니라 **풀 크기에 비례**한다.
 *   🔴 한 편에 최대 2개만 넣는다(AC-63 — 블록을 늘리면 모델이 총 분량을 나눠 담아 **편당 글자 수가 되레 준다**.
 *      B-1 실측: 12→17블록에 1,849→1,503자). 분량 손잡이는 B-1 몫이고, 여기서는 **가짓수만** 산다.
 */
function addOptional(seq: BlockType[], t: BlockTiers, rnd: () => number): BlockType[] {
  const pool = t.optional.filter((b) => !t.suppress.includes(b) && !NO_INSERT.includes(b));
  if (!pool.length) return seq.length ? seq : seq;
  const out = [...seq];
  /* 꼬리(해시태그·행동 유도·FAQ)는 건드리지 않는다 — `expandForLength` 와 같은 규칙. */
  const tail: BlockType[] = ["hashtags", "tip", "faq"];
  let body = out.length; while (body > 0 && tail.includes(out[body - 1])) body--;
  const howMany = rnd() < 0.35 ? 2 : rnd() < 0.75 ? 1 : 0;
  for (let i = 0; i < howMany; i++) {
    const pick = pool[Math.floor(rnd() * pool.length)];
    const at = 1 + Math.floor(rnd() * Math.max(1, body - 1));
    if (out[at] === pick || out[at - 1] === pick) continue;   // 같은 블록이 나란히 붙지 않게
    out.splice(at, 0, pick);
    body++;
  }
  return out.length ? out : seq;
}

/**
 * [R8-A §2] 주제군별 분량·사진 수 — 값이 없으면 채널 고정값(무회귀).
 *   [R10-8 · 사장님 «전반적인 컨텐츠 퀄리티»] 등급이 **하한을 올린다**: 보통 ≥1,500 · 프리미엄 ≥2,000(`COIN_TIERS.chars`). 간단히는 채널 폭 그대로(오늘까지의 글과 같다).
 *   🔴 채널 폭 **위로만** 올린다(내리지 않는다 — 계약 하한은 실물 근거다) · 🔴 짧은 채널(쓰레드 500자 상한)에선 상한 200자 아래까지만 — 등급이 채널 한계를 넘게 시키지 않는다.
 *   🔴 게이트(`ai-tell-gate length`)·프롬프트·검수 화면이 **같은 함수·같은 tier** 로 잰다 — 잣대가 갈리면 «잰 값은 같은데 기준이 다른» 상태가 된다.
 */
export function lengthFor(c: WritingContract, group?: TopicGroup | null, tier?: CoinTier | null): { min: number; max: number } {
  const base = (group && c.lengthByGroup?.[group]) || c.length;
  if (!tier || tier === "simple") return base;
  const floor = COIN_TIERS[tier].chars;
  const min = Math.min(Math.max(base.min, floor), Math.max(base.min, base.max - 200));
  return { min, max: base.max };
}
export function imagesFor(c: WritingContract, group?: TopicGroup | null): { min: number; max: number; default: number } {
  const g = group && c.imagesByGroup?.[group];
  return g || { min: c.images.min, max: c.images.max, default: c.images.default };
}
/**
 * [R10-7] 등급이 있을 때 사진 자리 **상한** — 블로그형 채널(사진 3장 이상 받는 곳)은 등급이 계약 상한을 **넘길 수 있다**(고객이 «AI 사진 4~5장»을 산 것이고 계약 상한은 실물 «보통 이만큼»이지 플랫폼 한계가 아니다).
 *   🔴 사진을 1~2장만 받는 채널(쓰레드 · 커넥터가 한 장만 올린다)은 **넘기지 않는다** — 그건 플랫폼 사실이라 등급이 못 바꾼다(«없는 길»).
 */
export function maxImagesFor(c: WritingContract, tier?: CoinTier | null, group?: TopicGroup | null): number {
  const img = imagesFor(c, group);
  if (!tier || img.max < 3) return img.max;
  return Math.max(img.max, COIN_TIERS[tier].aiImages[1]);
}
/** [R10-7] 이 글의 사진 자리 수 — 계약 기본값과 «등급이 굽겠다는 AI 장수» 중 큰 쪽(상한은 `maxImagesFor`). 디렉터 두 경로(사람·자동)가 **같은 함수**를 쓴다. */
export function imageCountFor(c: WritingContract, group?: TopicGroup | null, tier?: CoinTier | null): number {
  const img = imagesFor(c, group);
  const want = tier ? imageSlotsForTier(tier, img.default) : img.default;
  return Math.max(img.min, Math.min(maxImagesFor(c, tier, group), want));
}
/**
 * [R10-8] 🔴 **등급마다 글도 달라진다** — 사진 수만 다르면 «프리미엄»이 거짓말이 된다(사장님). 구조로 넣는다(규칙과 구조가 싸우면 구조가 이긴다 · AC-63).
 *   보통 = +목록·표(셋 중 하나라도 있으면 그대로) · 프리미엄 = +체크리스트 +FAQ. 간단히 = 그대로.
 *   🔴 `tiers.suppress` 에 든 블록은 넣지 않는다(그 채널에선 흔하지 않은 요소) · 🔴 `visualMin` 은 건드리지 않는다(«최소치도 게이트다» · CLAUDE §9 · 2026-09-15 faq 사고) —
 *      이 함수는 **더하기만** 하고 요구치를 만들지 않으므로 `contractSelfConflicts` 가 그대로 0 이다(검사가 그걸 잰다 · `scripts/verify-coin-tier.mts`).
 *   꼬리(해시태그·행동 유도 한 줄·FAQ·요약)는 `endWithAction` 이 정한 자리라 그 **앞**에 넣는다.
 */
export function applyQualityTier(seq: BlockType[], c: WritingContract, tier?: CoinTier | null): BlockType[] {
  /* 🔴 `tiers` 가 없는 채널(쓰레드·인스타·영상)은 **아무것도 하지 않는다** — `applyTiers` 와 같은 선. 500자 글에 체크리스트·FAQ 를 꽂으면 그 채널 실물이 아니다(검사 ⑤가 이걸 잡았다). */
  if (!tier || tier === "simple" || !c.tiers) return seq;
  const sup = new Set<BlockType>(c.tiers?.suppress ?? []);
  const out = [...seq];
  const tailTypes: BlockType[] = ["hashtags", "tip", "faq", "summary"];
  const tailAt = () => { let i = out.length; while (i > 0 && tailTypes.includes(out[i - 1])) i--; return i; };
  const midParaAt = () => { const ps = out.map((b, i) => (b === "para" ? i : -1)).filter((i) => i >= 0); return ps.length ? ps[Math.floor(ps.length / 2)] + 1 : Math.max(1, tailAt()); };
  const ensure = (t: BlockType, at: () => number) => { if (sup.has(t) || out.includes(t)) return; out.splice(at(), 0, t); };
  if (!(["list", "table", "checklist"] as BlockType[]).some((t) => out.includes(t))) ensure("list", midParaAt);
  if (tier === "premium") { ensure("checklist", midParaAt); ensure("faq", tailAt); }
  return out;
}
/**
 * [R10-8] 등급별 프롬프트 줄(① 역할 칸 뒤에 실린다). 🔴 구조는 `applyQualityTier` 가 넣고 여기는 **그 블록을 어떻게 채우나**만 말한다(문장은 부탁 · 구조가 강제 · AC-63).
 *   검색 최적화: 구글은 «글자 수는 순위와 무관»이라 했고 FAQ 리치결과는 2025-05 에 끝났다(`lib/publish/seo.ts` 머리말) — 그래서 «구조화 데이터»는 HTML 채널의 Article JSON-LD(이미 붙는다) + **검색어 배치**(제목·첫 문단·소제목 하나)로 말한다. 지어낸 SEO 규칙은 넣지 않는다.
 */
export function tierPromptLines(tier?: CoinTier | null): string[] {
  if (!tier || tier === "simple") return [];
  const lines = ["· 목록·표는 실제 정보(가격·기간·비교·순서)로 채운다 — 장식용 나열 금지."];
  if (tier === "premium") lines.push(
    "· 체크리스트는 독자가 따라 할 수 있는 행동 단위로(5~7개) · 자주 묻는 질문은 3개 이상, 각 답은 두 문장 이상.",
    "· 목표 검색어를 제목·첫 문단·소제목 하나에 자연스럽게 넣는다(같은 문장 반복 금지) · 요약이 있으면 결론을 먼저 말한다.",
  );
  return lines;
}

/**
 * [R8-A §2] 이 글의 **수익 목적**을 정한다 — 🔴 **한 곳**이다.
 *   생성(`content-gen`)과 검수 화면(`pieces-get`)이 **같은 함수**를 봐야 «프롬프트에 실린 값»과 «화면이 보여 주는 값»이 안 갈린다
 *   (갈리면 화면이 거짓말을 한다 · AC-57 대용물 금지 · 오늘 우리가 gate_report 에서 겪은 그 모양).
 *   규칙: 제휴가 붙었으면 `affiliate` 가 이긴다 → 아니면 brief 의 목적 → 그것도 없으면 채널 기본(네이버=애드포스트 · 나머지=애드센스).
 *
 * 🔴 [2026-09-15 C · R8-A §1.2 실측] **brief 의 목적을 그대로 쓰면 절반 넘게 규칙이 안 닿는다.**
 *   `director.goalOf()` 는 브리프에 채널이 둘 이상이면 `"mixed"` 를 넣는다 — 라이브 brief 61건 중 **34건(56%)** 이 mixed 이고
 *   거기 달린 글이 **23편**이다. 그런데 `goalRules` 에 `mixed` 열쇠를 둔 채널은 **0개**다.
 *   게다가 `"mixed"` 는 truthy 라 «없으면 채널 기본» 폴백도 **그냥 지나간다** ⇒ 그 23편은 수익 목적 규칙을 **한 줄도 못 받았다.**
 *   ⇒ **brief 는 여러 채널의 묶음이지만 piece 는 채널이 하나다.** 그 채널에 규칙이 있는 목적일 때만 brief 값을 쓰고,
 *     아니면(mixed·ypp 같은 남의 채널 목적·오타) **그 채널의 기본 목적**으로 읽는다. 저장된 `briefs.goal` 은 건드리지 않는다(소급 0).
 */
export interface GoalResolution {
  goal: RevenueGoal;
  /** 이 값이 **어디서 왔나** — 🔴 안 남기면 다음 사람이 «brief 는 mixed 인데 글은 adpost 네?» 하고 또 헤맨다(메인 지시). */
  source: "affiliate" | "brief" | "channel_default";
  /** brief 에 값은 있었는데 이 채널에 규칙이 없어 떨어뜨린 경우 그 값(예: `"mixed"`). 없으면 null. */
  briefGoalIgnored: string | null;
}

/** `resolveGoal` 의 속살 — 값과 **출처**를 같이 준다. 화면·메타·감사가 이걸 읽는다. */
export function resolveGoalDetail(a: { affiliate: boolean; briefGoal?: string | null; channel: string }): GoalResolution {
  if (a.affiliate) return { goal: "affiliate", source: "affiliate", briefGoalIgnored: null };
  const fallback: RevenueGoal = a.channel === "naver_blog" ? "adpost" : "adsense";
  const g = String(a.briefGoal ?? "").trim();
  if (!g) return { goal: fallback, source: "channel_default", briefGoalIgnored: null };
  /* 🔴 «값이 있나» 가 아니라 **«규칙이 있는 목적인가»** 를 묻는다 — 그래야 `ypp`·`clip_incentive` 처럼
     규칙 없는 목적이 나중에 또 생겨도 같은 구멍이 안 난다(메인 지시 2026-09-15). */
  const rules = WRITING_CONTRACTS[a.channel]?.goalRules?.[g as RevenueGoal];
  if (rules?.length) return { goal: g as RevenueGoal, source: "brief", briefGoalIgnored: null };
  return { goal: fallback, source: "channel_default", briefGoalIgnored: g };
}

export function resolveGoal(a: { affiliate: boolean; briefGoal?: string | null; channel: string }): RevenueGoal {
  return resolveGoalDetail(a).goal;
}

/** [R8-A §2] 소재·형식에서 주제군을 고른다(순수 · 재료가 없으면 null = 채널 고정값을 쓴다). */
export function topicGroupOf(a: { format?: string | null; intent?: string | null; title?: string | null }): TopicGroup | null {
  const f = String(a.format ?? ""), intent = String(a.intent ?? ""), t = String(a.title ?? "");
  if (f === "compare" || /후기|리뷰|써\s?봤|사용기|내돈내산/.test(t) || intent === "commercial") return "review";
  if (f === "info" || f === "listicle" || f === "guide" || f === "qna") return "info";
  if (f === "story") return "life";
  return null;
}

/**
 * [R8-A §2 실호출 검증에서 잡은 것 2026-09-15] **끝맺음을 «다음 행동 한 줄»로 바꾼다.**
 *   🔴 `goalRules` 에 «끝맺음은 다음 행동 한 줄»을 적어 놨는데 **글은 여전히 FAQ 로 끝났다.**
 *      원인: 프롬프트 ②칸이 «블록 시퀀스를 순서·개수 **그대로** 채운다(추가·생략 금지)» 라고 강제한다 —
 *      즉 **규칙(①-b)과 구조(②)가 싸우면 구조가 이긴다.** 말로만 고치면 안 되고 **구조를 고쳐야** 한다.
 *      (이게 «계약만 고치면 생성이 따라오나»의 답이다 — 문장만 고치면 안 따라온다.)
 */
function endWithAction(seq: BlockType[], c: WritingContract): BlockType[] {
  if (!c.tiers || c.tiers.suppress.includes("tip")) return seq;
  const out = [...seq];
  const last = out[out.length - 1];
  if (last === "tip") return out;
  /* 해시태그는 진짜 마지막이다(네이버) — 그 앞에 넣는다. */
  const at = last === "hashtags" ? out.length - 1 : out.length;
  out.splice(at, 0, "tip");
  return out;
}

/**
 * [R8-A §2 · AC-63] **분량을 구조로 맞춘다.**
 *   🔴 실호출 1편 실측: 티스토리 정보성 목표 3,000~12,000자인데 **1,849자**가 나왔다.
 *      프롬프트에 «3,000~12,000자» 라고 **적어 놨는데도** 그랬다 — 프롬프트 ②칸이 «블록 시퀀스를 순서·개수 그대로» 라고 강제하니
 *      **블록 수가 곧 분량**이다(규칙과 구조가 싸우면 구조가 이긴다 · AC-63).
 *   ⇒ 목표 하한에 닿을 때까지 **`h2`+`para` 쌍을 늘린다**(가끔 `list`). 늘리는 자리는 seed 로 흩어 골격이 또 굳지 않게 한다.
 *   🔴 **그런데 이것만으로는 분량이 안 늘어난다 — 2번째 실호출로 확인했다(2026-09-15).**
 *      블록을 12개 → 17개로 늘렸더니 글은 1,849자 → **1,503자**가 됐다(오히려 줄었다).
 *      블록당 글자 수가 460자 → **215자**로 떨어진 것이다 — **모델이 총 분량 감각을 스스로 갖고, 블록이 늘면 나눠 담는다.**
 *      ⇒ 분량은 «문장으로도 구조로도» 안 잡히는 **세 번째 경우**다. 다음 라운드 후보: 블록마다 «최소 몇 자» 를 적어 주거나,
 *        `maxOutputTokens`·재작성 지시로 잡는다. 지금 어림값은 **실측 215자** 를 쓴다(늘리는 양이 과하지 않게).
 */
const CHARS: Partial<Record<BlockType, number>> = { para: 420, hook: 260, h2: 30, h3: 25, list: 140, checklist: 130, table: 150, quote: 40, tip: 90, faq: 240, summary: 120, toc: 0, image: 0, divider: 0, adsense: 0, hashtags: 0, disclosure: 0, affiliate: 0, place: 40 };
/**
 * 🔴 [R8 §9 · B-1 2026-09-15] **계약이 스스로 싸우는 자리**를 찾는다 — 게이트를 최소화하라는 규칙(CLAUDE §9)의 짝이다.
 *   `visualMin` 이 **요구**하는 블록을 `tiers.optional`·`suppress` 가 **뺄 수 있으면**, 빠진 글마다 `visual_min` 이 빨개지고
 *   그 빨강이 **재작성을 부른다 = 돈이 두 배**다. 막는 게이트가 아니어도 «돈이 드는 게이트»는 게이트다.
 *   ⇒ 값이 바뀔 때마다 되짚기가 이 함수를 불러 **0 인지** 본다. 사람이 눈으로 맞추면 다음 사람이 또 어긋낸다.
 */
/**
 * [R8 §2.5] 🔴 **«이 채널은 카드뉴스인가»의 정본 한 곳.**
 *   목록을 따로 두지 않는다 — 판정 기준이 곧 뜻이다: **사진이 «카드»인 채널**(`cardText` 가 있는 채널)이 카드뉴스다.
 *   목록을 새로 만들면 채널이 늘 때 한쪽만 고쳐져 갈라진다(AC-57 · 오늘 채널 «성질» 표를 한 곳으로 모은 것과 같은 이유).
 *   편성(`RuleKind`)·생성(`pieces.kind`)·코인이 **전부 이 함수 하나**를 본다.
 */
export function isCardnewsChannel(channel: string): boolean {
  return !!WRITING_CONTRACTS[String(channel)]?.cardText;
}

/**
 * [R8 · 메인 2026-09-15] 🔴 **코인 식에 넘길 `format` 은 «고른 골격»이 아니라 «채널의 성질»이다.**
 *   코인 재설계 뒤 인스타 계약이 골격 5종(cardnews·steps·listicle·compare·qna)으로 늘었다.
 *   그 순간 `soleFormatOf`(«골격이 하나일 때만 돌려준다»)가 **null** 이 되고, 고른 골격이 `steps` 면
 *   코인 식이 «카드뉴스» 갈래를 못 타 **글값(1코인)** 으로 떨어졌다 — 카드 8장을 굽고 1코인만 받는다.
 *   실제로 `verify-cardnews` ⑦ 이 이걸 잡았다(편성표 견적 1 ↔ 화면 «카드뉴스 3코인»).
 *   🔴 그래서 판정은 **채널 하나**(`isCardnewsChannel` · `cardText` 가 정의)로 모은다 — 골격이 몇 종으로 늘든 값이 안 흔들린다.
 *   `lib/coin-table.ts` 는 계약표를 보지 않는 순수 파일이라(AC-17) **호출부가 주는 것이 맞다** — 그 «호출부»가 여기 하나다.
 */
export function coinFormatOf(channel: string, picked?: string | null): string | undefined {
  if (isCardnewsChannel(channel)) return "cardnews";
  return picked ?? soleFormatOf(channel) ?? undefined;
}

export function contractSelfConflicts(c: WritingContract): string[] {
  const out: string[] = [];
  const t = c.tiers;
  if (!t) return out;
  const soft = new Set<BlockType>([...(t.optional ?? []), ...(t.suppress ?? [])]);
  /** `visualMin` 의 칸 이름 → 그 칸을 채우는 블록 타입(하나라도 있으면 채워진다). */
  const NEED: Partial<Record<keyof VisualMin, BlockType[]>> = {
    quote: ["quote"], divider: ["divider"], image: ["image"], h2: ["h2"], checklist: ["checklist"],
    hashtags: ["hashtags"], adsense: ["adsense"], faq: ["faq"], tableOrList: ["table", "list", "checklist"],
    /* [R8CLOSE-B1 §B4] 🔴 **지금 `visualMin.place` 를 쓰는 채널은 없다**(일부러 안 넣었다).
       그래도 여기 적어 두는 이유: 다음 사람이 넣는 순간 `contractSelfConflicts` 가 **바로 잡아 주게** 하려는 것이다. */
    place: ["place"],
  };
  for (const [key, want] of Object.entries(c.visualMin ?? {}) as [keyof VisualMin, number][]) {
    if (!want) continue;
    /* 🔴 **사진은 tiers 가 정하지 않는다** — `structureFor` 가 `imageCount` 에 맞춰 뺀 만큼 **다시 넣는다**.
       그래서 사진의 싸움은 «tiers 가 뺀다»가 아니라 «**요구가 우리가 넣는 장수보다 많다**»다. 그쪽으로 잰다. */
    if (key === "image") {
      const have = Math.min(imagesFor(c, null).default, imagesFor(c, "review").default, imagesFor(c, "info").default, imagesFor(c, "life").default);
      if (want > have) out.push(`visualMin.image=${want} 인데 우리가 넣는 사진은 적게는 ${have}장이다`);
      continue;
    }
    const types = NEED[key] ?? [];
    if (!types.length) continue;
    /* 그 칸을 채울 수 있는 타입이 **전부** «빠질 수 있는» 쪽이면 싸운다(하나라도 required 면 안전하다). */
    if (types.every((x) => soft.has(x))) out.push(`visualMin.${key}=${want} 인데 tiers 가 ${types.join("·")} 를 뺄 수 있다`);
  }
  return out;
}

export function estimateChars(seq: BlockType[]): number { return seq.reduce((a, b) => a + (CHARS[b] ?? 0), 0); }

export function expandForLength(seq: BlockType[], c: WritingContract, group: TopicGroup | null | undefined, seed: number): BlockType[] {
  if (!c.tiers) return seq;
  const target = lengthFor(c, group).min;
  if (estimateChars(seq) >= target) return seq;
  const rnd = seeded(seed * 31 + 7);
  const out = [...seq];
  /* 꼬리(해시태그·행동 유도·FAQ)는 건드리지 않는다 — 그 앞까지가 본체다. */
  const tailTypes: BlockType[] = ["hashtags", "tip", "faq"];
  let body = out.length; while (body > 0 && tailTypes.includes(out[body - 1])) body--;
  let guard = 0;
  while (estimateChars(out) < target && guard++ < 40) {
    const at = 1 + Math.floor(rnd() * Math.max(1, body - 1));
    const add: BlockType[] = rnd() < 0.25 && !c.tiers.suppress.includes("list") ? ["h2", "para", "list"] : ["h2", "para"];
    out.splice(at, 0, ...add);
    body += add.length;
  }
  return out;
}

/** `seed` 를 주면 3단(필수/선택/억제)을 적용해 골격을 글마다 다르게 낸다. 안 주면 종전 그대로(무회귀). */
export function structureFor(c: WritingContract, format: FormatKey, imageCount: number, affiliate: boolean, seed?: number, group?: TopicGroup | null, tier?: CoinTier | null): BlockType[] {
  const raw = [...(c.structure[format] ?? c.structure[c.formats[0]] ?? NAVER_STORY)];
  /* [R10-8] 등급 블록은 3단·분량 늘리기·끝맺음 **뒤**에 더한다(끝맺음 앞에 넣으므로 `tip` 이 계속 마지막이다). 간단히·tier 없음 = 종전 그대로(무회귀). */
  const base = seed === undefined ? raw : applyQualityTier(endWithAction(expandForLength(applyTiers(raw, c, seed), c, group, seed), c), c, tier);
  let imgs = base.filter((b) => b === "image").length;
  const out: BlockType[] = [];
  for (const b of base) { if (b === "image" && imgs > imageCount) { imgs--; continue; } out.push(b); }
  let need = imageCount - out.filter((b) => b === "image").length;
  for (let i = out.length - 1; i > 0 && need > 0; i--) { if (out[i] === "para" && out[i - 1] !== "image") { out.splice(i + 1, 0, "image"); need--; } }
  while (need > 0) { const at = Math.max(1, out.lastIndexOf("para") + 1); out.splice(at, 0, "image"); need--; }
  if (affiliate) {
    // 고지는 첫 블록 고정(§16B.4) · 제휴 링크 블록은 중간(mid) + 끝(end) 슬롯 후보 — director 가 slot 을 정한다.
    out.unshift("disclosure");
  }
  return out;
}
