/**
 * lib/writing-contracts.ts — 채널별 집필 계약(DESIGN §5C.1 표 7행 전부 · §5.4 감성 프로파일). AM 원본: ../AutoMarketing/lib/content-tone.ts (톤 계약·구성 로테이션·hashSeed 관례 2026-09-14 · 값은 AC 설계표로 교체)
 *   코드 기본값 + DB `emotion_profiles.contract` 오버레이(키 = `{channel}.{emotionKey}` · 있으면 필드 단위로 덮어씀 · graceful).
 *   계약 = 독자·말투(reader·register·rules) · 서사 로테이션(formats · 각 format 의 블록 시퀀스 structure) · 시각 요소(visual) · 분량(length) · 제목 스타일(titleStyle) · 이미지 기본(images).
 *   소비처: director(format 로테이션·imageCount·coinCost) · content-gen(프롬프트 ①②) · ai-tell-gate(visual_min) · slots(coinsPerWeek).
 */
import { db } from "../db/index";
import { sql } from "drizzle-orm";

export type BlockType = "hook" | "para" | "h2" | "h3" | "quote" | "list" | "checklist" | "table" | "image" | "divider" | "tip" | "faq" | "hashtags" | "disclosure" | "adsense" | "toc" | "summary" | "affiliate";
export type FormatKey = "story" | "info" | "listicle" | "compare" | "qna" | "guide" | "cardnews";

export interface VisualMin { quote?: number; divider?: number; image?: number; h2?: number; tableOrList?: number; adsense?: number; checklist?: number; hashtags?: number; faq?: number }

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
    visual: ["사진 6~10장 + 캡션", "인용구(핵심 한 줄)", "구분선", "체크리스트", "소제목", "해시태그 5~10"],
    visualMin: { quote: 1, divider: 1, image: 6, hashtags: 5 },
    length: { min: 1500, max: 2500 },
    titleStyle: "naver", titleExample: "에어프라이어 청소, 3분이면 새것처럼",
    images: { min: 6, max: 10, default: 6, style: "photo", aspect: "4:3", captionRate: 0.3 },
    emojiPerParagraph: 0, text: true,
  },
  tistory: {
    channel: "tistory", emotionKey: "info", label: "티스토리 · 정보·정리",
    reader: "검색으로 들어온 사람 — 답을 빨리, 정확히 얻고 싶은 독자",
    register: "격식 존댓말 «~합니다 / ~입니다» · 정리해 주는 전문가 톤",
    rules: [
      "정보를 정리해 주는 «~합니다/~입니다» 로 쓴다. 감탄·이모지 없이 담백하게.",
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
    visualMin: { h2: 3, tableOrList: 1, adsense: 2, image: 2 },
    length: { min: 1800, max: 3000 },
    titleStyle: "google", titleExample: "2026 에어프라이어 청소 방법 총정리",
    images: { min: 2, max: 4, default: 3, style: "photo", aspect: "16:9", captionRate: 0.2 },
    emojiPerParagraph: 0, text: true,
  },
  blogger: {
    channel: "blogger", emotionKey: "seo", label: "블로거 · SEO 정보",
    reader: "구글 검색·AI 답변엔진으로 들어온 사람",
    register: "격식 존댓말 «~합니다» · 간결한 SEO 정보",
    rules: [
      "티스토리와 같은 «~합니다» 정보 톤. 첫 문단 150자 안에 핵심 답을 준다(메타 설명으로 그대로 쓰인다).",
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
    visualMin: { h2: 3, faq: 1, image: 1 },
    length: { min: 1200, max: 2000 },
    titleStyle: "google", titleExample: "2026 에어프라이어 청소 방법 총정리",
    images: { min: 1, max: 3, default: 2, style: "photo", aspect: "16:9", captionRate: 0.5 },
    emojiPerParagraph: 0, text: true,
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
  instagram: {
    channel: "instagram", emotionKey: "cardnews", label: "인스타 카드뉴스 · 짧고 단정",
    reader: "썸네일을 넘기며 보는 사람 — 카드 한 장에 한 메시지",
    register: "짧고 단정한 명사형·구어 «~하기 / ~해요»",
    rules: ["표지 1장 → 핵심 5장 → CTA 1장. 카드당 30자 이내.", "한 카드에 한 메시지. 숫자·단계로 구조를 준다.", "캡션은 2~3줄 + 해시태그 5~10."],
    formats: ["cardnews"],
    formatLabel: { cardnews: "카드뉴스(표지→핵심 5→CTA)" },
    structure: { cardnews: ["hook", "list", "list", "list", "list", "list", "tip", "hashtags"] },
    visual: ["카드 6~8장", "큰 텍스트"],
    visualMin: { hashtags: 5 },
    length: { min: 150, max: 400 },
    titleStyle: "card", titleExample: "에어프라이어 청소 3단계",
    images: { min: 6, max: 8, default: 6, style: "infographic", aspect: "1:1", captionRate: 0 },
    emojiPerParagraph: 1, text: false,
  },
  wordpress: {
    channel: "wordpress", emotionKey: "seo", label: "워드프레스 · SEO 정보",
    reader: "구글 검색·AI 답변엔진으로 들어온 사람",
    register: "격식 존댓말 «~합니다» · 간결한 SEO 정보 · 영문 slug·메타",
    rules: [
      "티스토리와 같은 «~합니다» 정보 톤. 첫 문단 150자 안에 핵심 답(메타 설명).",
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
    visualMin: { h2: 3, faq: 1, image: 1 },
    length: { min: 1200, max: 2000 },
    titleStyle: "google", titleExample: "2026 에어프라이어 청소 방법 총정리",
    images: { min: 1, max: 3, default: 2, style: "photo", aspect: "16:9", captionRate: 0.5 },
    emojiPerParagraph: 0, text: true,
  },
  /* 영상 대본 3채널 — 같은 계약(§5C.1 «쇼츠·클립·릴스 대본» 1행). 생성은 Phase 3 · 계약은 지금 전부. */
  youtube_shorts: shortsContract("youtube_shorts", "유튜브 쇼츠 · 3초 훅·자막 본체", "9:16"),
  naver_clip: shortsContract("naver_clip", "네이버 클립 · 생활밀착·네이버 톤", "9:16"),
  reels: shortsContract("reels", "릴스 · 감성 b-roll", "9:16"),
  tiktok: shortsContract("tiktok", "틱톡 · 3초 훅", "9:16"),
};

/* ═══ P1R5 §1.3 — 영상 계약 4행(DESIGN §5C.1 «쇼츠·클립·릴스 대본» + §5.4 감성 3행 + §6.2 포맷 3·채널 규격). 포맷×초 표는 `shortsFormOf` 한 함수가 낸다(AM shorts-reference.shortsFormOf 관례 · SHORTS6 «길이·컷·발화 예산 한 표»). ═══ */
export type ShortsFormat = "graphic" | "talking" | "clip";
export interface ShortsForm {
  format: ShortsFormat; seconds: 15 | 30 | 60;
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
  channelMaxSec: Readonly<Record<string, 15 | 30 | 60>>;
}
/** shortsFormOf(format, seconds) — 포맷·초 → 계약 한 표(순수). */
export function shortsFormOf(format: ShortsFormat, seconds: 15 | 30 | 60): ShortsForm {
  const maxSyl = Math.floor(seconds * 4.6 * 0.85);
  const syllables = { min: Math.floor(maxSyl * 0.55), max: maxSyl };
  const channelMaxSec = VIDEO_CHANNEL_MAX_SEC;   // 🔴 표는 위 한 곳(§2.3) — 여기서 다시 적지 않는다
  if (format === "clip") return { format, seconds: seconds === 60 ? 30 : seconds, cuts: { min: 3, max: 4, default: 3 }, cutSec: { min: 5, max: 8 }, provider: seconds === 15 ? "veo_lite" : "omni", syllables, captionPreset: "clip_top", stillRatio: 0, channelMaxSec };
  /* 🔴 토킹(계약 §1.3 표): 컷 길이 **5초 고정** · B-roll 3~4 · **나머지 정지 이미지**. 즉 컷 수는 «초 ÷ 5»(60초 = 12컷)이지 3~4 가 아니다.
     예전 값(default 4)은 60초를 컷 4개로 나눠 창이 15초가 됐고, 8초 상한 클립으로는 7초가 비어 러너가 멈춘 화면을 늘려야 했다(설계 축소 · CLAUDE §8). */
  if (format === "talking") { const tc = Math.round((seconds === 15 ? 30 : seconds) / 5); return { format, seconds: seconds === 15 ? 30 : seconds, cuts: { min: Math.max(3, tc - 3), max: tc + 3, default: tc }, cutSec: { min: 5, max: 5 }, provider: "veo_lite", syllables, captionPreset: "talking_big", stillRatio: 0.5, channelMaxSec }; }
  const s60 = seconds === 60;
  return { format: "graphic", seconds: seconds === 15 ? 30 : seconds, cuts: s60 ? { min: 6, max: 12, default: 9 } : { min: 4, max: 6, default: 5 }, cutSec: { min: 5, max: 8 }, provider: "omni", syllables, captionPreset: "keyword_center", stillRatio: 0, channelMaxSec };
}
/* ═══════════ 영상 채널 규격 — 🔴 **한 곳**(계약 P1R6 §2.3 «화면 상수 금지») ═══════════
 *   여기가 정본이다: `clampSecondsForChannel`·`shortsFormOf`·`accounts-list.channels[].video` 가 전부 이 표를 읽는다.
 *   화면(A)은 이 값을 서버에서 받아 칩을 켜고 끈다 — «클립은 30초까지» 같은 숫자를 화면에 적지 않는다.
 *   릴스 90초는 Phase 5(계약 R5 §7-3 «R5 제외») — 여기 60 을 올리는 것으로 열린다. */
export const VIDEO_CHANNEL_MAX_SEC: Readonly<Record<string, 15 | 30 | 60>> = { youtube_shorts: 60, naver_clip: 30, reels: 60, threads: 60 };
/** 포맷 자체의 상한(채널과 **별개** 축) — 클립형은 생활밀착 15~30초라 어느 채널에서도 30을 넘지 않는다(§1.3 표). */
export const VIDEO_FORMAT_MAX_SEC: Readonly<Record<ShortsFormat, 15 | 30 | 60>> = { graphic: 60, talking: 60, clip: 30 };
export const VIDEO_FORMAT_LABEL: Readonly<Record<ShortsFormat, string>> = { graphic: "그래픽 스토리", talking: "말하는 영상", clip: "짧은 클립" };

/** 이 채널에서 고를 수 있는 것 — 채널 상한 + 포맷별 상한(둘 중 작은 것이 실제 상한). */
export function videoChannelSpec(channel: string): { maxSeconds: 15 | 30 | 60; formats: { key: ShortsFormat; label: string; maxSeconds: 15 | 30 | 60 }[] } | null {
  const max = VIDEO_CHANNEL_MAX_SEC[channel];
  if (!max) return null;
  const formats = (Object.keys(VIDEO_FORMAT_MAX_SEC) as ShortsFormat[]).map((key) => ({
    key, label: VIDEO_FORMAT_LABEL[key], maxSeconds: Math.min(max, VIDEO_FORMAT_MAX_SEC[key]) as 15 | 30 | 60,
  }));
  return { maxSeconds: max, formats };
}

/** 채널의 최대 초(§6.2 채널 규격) — 15|30|60 중 채널이 허용하는 것. */
export function clampSecondsForChannel(channel: string, seconds: number): 15 | 30 | 60 {
  const max = VIDEO_CHANNEL_MAX_SEC[channel] ?? 60;
  const s = seconds <= 15 ? 15 : seconds <= 30 ? 30 : 60;
  return (Math.min(s, max) as 15 | 30 | 60);
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
export function defaultImageCount(channel: string): number { return (WRITING_CONTRACTS[channel] ?? WRITING_CONTRACTS.naver_blog).images.default; }

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
export function structureFor(c: WritingContract, format: FormatKey, imageCount: number, affiliate: boolean): BlockType[] {
  const base = [...(c.structure[format] ?? c.structure[c.formats[0]] ?? NAVER_STORY)];
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
