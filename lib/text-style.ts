/**
 * lib/text-style.ts — **글 레퍼런스에서 배운 «어떻게 생겼나»**(R10-2·3·4 · 설계 §3.4~§3.6 · B · 2026-09-16). 🔴 순수(DB·네트워크 0).
 *   🔎 출처: AC 신규 — AM `lib/shorts-reference.ts sanitizeTemplateForStorage`(허용 목록 복사 + 길이 캡)의 **사상**을 가져오고 모양은 새로 짰다(읽기만 · 복사 0).
 *
 *   ══ 사장님 말씀(계약 §0-2) ══
 *     «고객은 자주 쓰는 이모지, 띄어쓰기, 직관적인 밑줄·하이라이트, 적합한 구성, 이미지 등을 맘에 들어할 수 있는데, 우리가 받는 건 글의 구성이 전부잖아»
 *     ⇒ «어떻게 생겼나»는 **전부** 잰다(§3.4). **문장은 한 줄도 저장하지 않는다.**
 *
 *   ══ 🔴 새지 않게 하는 이빨 셋(§3.5) — AM 방식 + 우리가 더 세다 ══
 *     ① **허용 목록 복사** — `sanitizeTextStyleForStorage` 가 아래 `TextStyle` 모양으로 **옮겨 적는다.** 모델이 `quotes`·`sentences`·`script`·`transcript`
 *        어느 키에 원문을 실어도 저장 모양에 그 키가 없다. 금지 목록이면 «새 키로 새는» 구멍이 영원히 남지만 허용 목록이면 그 구멍이 구조적으로 없다.
 *     ② **자유 문자열 칸이 0 개다** — 숫자·불리언·닫힌 enum·`BlockType[]`(닫힌 목록)·이모지 목록(글자·숫자·한글이 섞이면 버린다 · 각 ≤8자 · ≤8개)뿐.
 *        영상의 120자 캡은 블로그 한 문장을 통째로 담을 수 있어서(트리거 B-6 ⚠️) **글 축엔 문자열 칸 자체를 두지 않았다.**
 *     ③ 구성은 `BlockType[]` 로만 — 구조가 산문을 실어 나를 수 없다.
 *     🔴 저장 직전 **한 곳**(`text-style-store.createTextStyle`)에서만 이 함수를 지난다 · **프롬프트는 부탁이고 이 함수가 강제다**(AC-63).
 *
 *   ══ 못 잰 것은 «못 쟀다»(AC-9) ══
 *     복붙(paste)으로 배우면 꾸밈·이모지 자리·사진을 못 본다 — `learned.measured` 가 그걸 든다. 화면은 «복붙이라 꾸밈은 못 봤어요»라고 말한다(«없음»으로 위장 X).
 *
 *   ══ R8-A 를 되돌리지 않기(§3.7) ══
 *     배운 스타일은 **«고정 한 벌»이 아니다.** `applyTextStyleShape` 는 계약 골격에 «이 계정이 쓰는 요소·결론 위치·소제목 수»만 **얹는다**(format 하나를 갈아끼우지 않는다).
 *     그리고 이렇게 만든 글도 `structure_repeat` 대상에서 빼지 않는다 — 자기가 만든 템플릿을 자기가 잡는다.
 */
import type { BlockType } from "./blocks";
import { MARK_KINDS, type MarkKind } from "./blocks";

/* ─────────────────────────── 닫힌 어휘 ─────────────────────────── */
export const EMOJI_WHERE = ["para_start", "para_end", "heading", "list_item", "inline", "title"] as const;
export const EMPHASIS_KIND = ["bold", "underline", "highlight", "color", "italic"] as const;
export const EMPHASIS_ON = ["number", "conclusion", "name", "keyword", "warning"] as const;
export const PHOTO_WHERE = ["top", "between_sections", "end", "every_para", "inline"] as const;
export const PHOTO_KIND = ["photo", "screenshot", "illust", "infographic"] as const;
export const LINE_BREAK = ["single", "double", "mixed"] as const;
export const CONCLUSION = ["first", "last", "both", "none"] as const;
export const LEARNED_FROM = ["url", "capture", "paste"] as const;
export type EmojiWhere = typeof EMOJI_WHERE[number];
export type EmphasisKind = typeof EMPHASIS_KIND[number];
export type EmphasisOn = typeof EMPHASIS_ON[number];
export type PhotoWhere = typeof PHOTO_WHERE[number];
export type PhotoKind = typeof PHOTO_KIND[number];
export type LineBreak = typeof LINE_BREAK[number];
export type Conclusion = typeof CONCLUSION[number];
export type LearnedFrom = typeof LEARNED_FROM[number];
/** 블록 어휘 — `lib/blocks.ts BlockType` 과 같은 글자(닫힌 목록 · 여기 없으면 버린다). */
export const STYLE_BLOCK_TYPES: readonly BlockType[] = ["hook", "para", "h2", "h3", "quote", "list", "checklist", "table", "image", "divider", "tip", "faq", "hashtags", "toc", "summary", "place"];

export interface TextStyle {
  v: 1;
  shape: {
    paraChars: { avg: number; max: number };
    paraLines: { avg: number; max: number };
    lineBreak: LineBreak;
    emoji: { uses: boolean; where: EmojiWhere[]; top: string[]; perPost: number };
    emphasis: { kinds: EmphasisKind[]; perPost: number; on: EmphasisOn[] };
    photos: { count: number; where: PhotoWhere[]; captionRate: number; kinds: PhotoKind[] };
    listCount: number; tableCount: number; quoteCount: number; dividerCount: number;
  };
  voice: {
    /** 문장 끝 비율(0~1) — 셋의 합은 1 을 넘지 않는다. */
    ending: { haeyo: number; hamnida: number; banmal: number };
    sentenceChars: number;
    questionRate: number;
    title: { hasNumber: boolean; chars: number; isQuestion: boolean };
  };
  layout: { blocks: BlockType[]; conclusion: Conclusion; h2Count: number; totalChars: number };
  /** 어디서 배웠나 · **무엇을 못 쟀나**(복붙은 꾸밈·이모지 자리·사진을 못 본다 — «없음»이 아니라 «못 쟀다»). */
  learned: { from: LearnedFrom; shots?: number; measured: { emphasis: boolean; emoji: boolean; photos: boolean } };
}

/* ─────────────────────────── 분석 프롬프트 (부탁 · 강제는 소독기) ─────────────────────────── */
/** 🔴 모델에게 보여 주는 예시 — 저장 모양과 같은 열쇠. 검사가 «정상 응답이 살아남나»(AC-68)의 표본으로 쓴다. */
export const TEXT_STYLE_RAW_EXAMPLE = {
  shape: {
    paraChars: { avg: 90, max: 180 }, paraLines: { avg: 3, max: 5 }, lineBreak: "double",
    emoji: { uses: true, where: ["para_start", "heading"], top: ["✅", "📌", "💡"], perPost: 8 },
    emphasis: { kinds: ["bold", "highlight"], perPost: 6, on: ["number", "conclusion"] },
    photos: { count: 7, where: ["between_sections"], captionRate: 0.3, kinds: ["photo"] },
    listCount: 2, tableCount: 1, quoteCount: 1, dividerCount: 3,
  },
  voice: { ending: { haeyo: 0.8, hamnida: 0.1, banmal: 0.1 }, sentenceChars: 32, questionRate: 0.15, title: { hasNumber: true, chars: 28, isQuestion: false } },
  layout: { blocks: ["hook", "image", "para", "h2", "para", "list", "image", "h2", "para", "table", "h2", "para", "image", "summary", "faq", "hashtags"], conclusion: "last", h2Count: 3, totalChars: 1900 },
} as const;

export const TEXT_STYLE_PROMPT = [
  "너는 블로그 글의 «생김새»를 재는 측정기다. 아래 캡처(또는 글)를 보고 **모양·말투·구성**만 숫자와 목록으로 적는다.",
  "🔴 절대 규칙: 글의 **문장·문구·고유명사·주제를 한 글자도 옮겨 적지 않는다.** 저장은 숫자·불리언·정해진 낱말·이모지만 받는다(그 밖은 버려진다).",
  "잰다 — 모양: 문단 길이(자·줄) · 줄바꿈 리듬(single/double/mixed) · 이모지(쓰나 · 어디에 · 자주 쓰는 것 상위 3~5개 · 글당 몇 개) · 강조(bold/underline/highlight/color/italic 중 무엇 · 글당 몇 곳 · 무엇에: number/conclusion/name/keyword/warning) · 사진(몇 장 · 어디에: top/between_sections/end/every_para/inline · 캡션 비율 · photo/screenshot/illust/infographic) · 목록·표·인용·구분선 개수(listCount/tableCount/quoteCount/dividerCount)",
  "말투: 문장 끝 비율(해요체 haeyo / 합니다체 hamnida / 반말 banmal · 합 1) · 문장 평균 글자 수 · 질문 문장 비율 · 제목(숫자 포함? · 글자 수 · 질문형?)",
  `구성: 블록 순서를 이 어휘로만: ${STYLE_BLOCK_TYPES.join("|")} · 결론 위치(first/last/both/none) · 소제목(h2) 수 · 본문 총 글자 수`,
  `출력 JSON 하나만 — 열쇠는 이 예시와 같다: ${JSON.stringify(TEXT_STYLE_RAW_EXAMPLE)}`,
].join("\n");

/* ─────────────────────────── 소독기 ─────────────────────────── */
const num = (v: unknown, min: number, max: number, digits = 0): number => {
  const x = Number(v);
  if (!Number.isFinite(x)) return min;
  const c = Math.min(max, Math.max(min, x));
  const p = 10 ** digits;
  return Math.round(c * p) / p;
};
const bool = (v: unknown): boolean => v === true || v === "true" || v === 1;
const pickEnum = <T extends string>(v: unknown, vocab: readonly T[], cap: number): T[] => {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  const out: T[] = [];
  for (const x of arr) { const s = String(x ?? "").trim().toLowerCase() as T; if ((vocab as readonly string[]).includes(s) && !out.includes(s)) out.push(s); if (out.length >= cap) break; }
  return out;
};
const oneEnum = <T extends string>(v: unknown, vocab: readonly T[], fallback: T): T => {
  const s = String(v ?? "").trim().toLowerCase() as T;
  return (vocab as readonly string[]).includes(s) ? s : fallback;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

/** 🔴 이모지만 — 글자·숫자·한글·기호가 섞이면 통째로 버린다(이모지 칸에 문장을 실어 새는 우회 차단). 각 ≤ 8자(코드 유닛 · ZWJ 조합 하나가 8까지 간다). */
const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}|\p{Variation_Selector}|\p{Join_Control}|\p{Me})+$/u;
export function isEmojiOnly(s: unknown): boolean {
  const t = String(s ?? "");
  return t.length > 0 && t.length <= 8 && EMOJI_ONLY.test(t) && !/[\p{L}\p{N}]/u.test(t);
}
export function pickEmojis(v: unknown, cap = 8): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,·]+/) : [];
  const out: string[] = [];
  for (const x of arr) { const t = String(x ?? "").trim(); if (isEmojiOnly(t) && !out.includes(t)) out.push(t); if (out.length >= cap) break; }
  return out;
}
export function pickBlocks(v: unknown, cap = 40): BlockType[] {
  const arr = Array.isArray(v) ? v : [];
  const out: BlockType[] = [];
  for (const x of arr) { const s = String(typeof x === "object" && x ? (x as Record<string, unknown>).type ?? "" : x ?? "").trim().toLowerCase() as BlockType; if (STYLE_BLOCK_TYPES.includes(s)) out.push(s); if (out.length >= cap) break; }
  return out;
}

/**
 * sanitizeTextStyleForStorage — 분석 산출(무엇이 오든) → **저장 모양**. 🔴 여기 적힌 칸·범위만 살아남는다.
 *   `raw.shape/voice/layout` 이 없으면 최상위에서도 읽는다(모델이 평평하게 낼 때). 모르는 열쇠는 전부 버린다.
 *   `from` = 어디서 배웠나 → 복붙이면 꾸밈·이모지 자리·사진을 «못 쟀다»로 든다.
 */
export function sanitizeTextStyleForStorage(raw: unknown, from: LearnedFrom = "url", shots?: number): TextStyle {
  const r = obj(raw);
  const sh = { ...r, ...obj(r.shape) };
  const vo = { ...r, ...obj(r.voice) };
  const la = { ...r, ...obj(r.layout) };
  const em = obj(sh.emoji), ep = obj(sh.emphasis), ph = obj(sh.photos), pc = obj(sh.paraChars), pl = obj(sh.paraLines);
  const en = obj(vo.ending), ti = obj(vo.title);
  const ending = { haeyo: num(en.haeyo, 0, 1, 2), hamnida: num(en.hamnida, 0, 1, 2), banmal: num(en.banmal, 0, 1, 2) };
  const sum = ending.haeyo + ending.hamnida + ending.banmal;
  if (sum > 1) { ending.haeyo = Math.round(ending.haeyo / sum * 100) / 100; ending.hamnida = Math.round(ending.hamnida / sum * 100) / 100; ending.banmal = Math.round(ending.banmal / sum * 100) / 100; }
  const paste = from === "paste";
  const emojiTop = pickEmojis(em.top);
  return {
    v: 1,
    shape: {
      paraChars: { avg: num(pc.avg, 0, 2000), max: num(pc.max, 0, 4000) },
      paraLines: { avg: num(pl.avg, 0, 40, 1), max: num(pl.max, 0, 80) },
      lineBreak: oneEnum(sh.lineBreak, LINE_BREAK, "mixed"),
      emoji: { uses: bool(em.uses) || emojiTop.length > 0, where: pickEnum(em.where, EMOJI_WHERE, 4), top: emojiTop, perPost: num(em.perPost, 0, 60) },
      emphasis: { kinds: pickEnum(ep.kinds, EMPHASIS_KIND, 5), perPost: num(ep.perPost, 0, 60), on: pickEnum(ep.on, EMPHASIS_ON, 5) },
      photos: { count: num(ph.count, 0, 60), where: pickEnum(ph.where, PHOTO_WHERE, 4), captionRate: num(ph.captionRate, 0, 1, 2), kinds: pickEnum(ph.kinds, PHOTO_KIND, 4) },
      listCount: num(sh.listCount ?? sh.lists, 0, 40), tableCount: num(sh.tableCount ?? sh.tables, 0, 20), quoteCount: num(sh.quoteCount ?? sh.quotes, 0, 20), dividerCount: num(sh.dividerCount ?? sh.dividers, 0, 40),
    },
    voice: {
      ending, sentenceChars: num(vo.sentenceChars, 0, 300), questionRate: num(vo.questionRate, 0, 1, 2),
      title: { hasNumber: bool(ti.hasNumber), chars: num(ti.chars, 0, 120), isQuestion: bool(ti.isQuestion) },
    },
    layout: { blocks: pickBlocks(la.blocks), conclusion: oneEnum(la.conclusion, CONCLUSION, "none"), h2Count: num(la.h2Count, 0, 40), totalChars: num(la.totalChars, 0, 50000) },
    learned: { from, ...(typeof shots === "number" && shots > 0 ? { shots: Math.min(12, Math.floor(shots)) } : {}), measured: { emphasis: !paste, emoji: !paste || emojiTop.length > 0, photos: !paste } },
  };
}

/** 저장물이 정말 «문장 0» 인가 — 검사·저장 직전에 한 번 더 잰다(가장 긴 문자열 · 글자/한글이 든 문자열 수). */
export function textStyleLeakProbe(style: unknown): { longest: number; wordy: number } {
  let longest = 0, wordy = 0;
  const walk = (v: unknown) => {
    if (typeof v === "string") { if (STYLE_VOCAB.has(v)) return; longest = Math.max(longest, v.length); if (/[\p{L}\p{N}]/u.test(v)) wordy++; return; }
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(style);
  return { longest, wordy };
}
const STYLE_VOCAB = new Set<string>([...EMOJI_WHERE, ...EMPHASIS_KIND, ...EMPHASIS_ON, ...PHOTO_WHERE, ...PHOTO_KIND, ...LINE_BREAK, ...CONCLUSION, ...LEARNED_FROM, ...STYLE_BLOCK_TYPES]);

/* ─────────────────────────── 사람말 ─────────────────────────── */
const KO = {
  emojiWhere: { para_start: "문단 첫머리", para_end: "문단 끝", heading: "소제목", list_item: "목록 항목", inline: "문장 사이", title: "제목" } as Record<EmojiWhere, string>,
  emphasis: { bold: "굵게", underline: "밑줄", highlight: "형광펜", color: "글자색", italic: "기울임" } as Record<EmphasisKind, string>,
  on: { number: "숫자", conclusion: "결론", name: "이름·상호", keyword: "검색어", warning: "주의할 점" } as Record<EmphasisOn, string>,
  photoWhere: { top: "맨 위", between_sections: "소제목 사이", end: "맨 끝", every_para: "문단마다", inline: "문장 사이" } as Record<PhotoWhere, string>,
  photoKind: { photo: "실사", screenshot: "캡처", illust: "그림", infographic: "인포그래픽" } as Record<PhotoKind, string>,
  conclusion: { first: "앞", last: "뒤", both: "앞뒤", none: "따로 없음" } as Record<Conclusion, string>,
  block: { hook: "첫 줄", para: "문단", h2: "소제목", h3: "작은 소제목", quote: "인용", list: "목록", checklist: "체크리스트", table: "표", image: "사진", divider: "구분선", tip: "한 줄 팁", faq: "자주 묻는 질문", hashtags: "해시태그", toc: "목차", summary: "요약", place: "장소·링크 카드" } as Record<string, string>,
};
const join = (xs: string[], sep = "·") => xs.join(sep);
function endingSay(e: TextStyle["voice"]["ending"]): string {
  const top = [["해요체", e.haeyo], ["합니다체", e.hamnida], ["반말", e.banmal]].sort((a, b) => Number(b[1]) - Number(a[1])) as [string, number][];
  if (!top[0][1]) return "";
  return top[0][1] >= 0.8 ? `${top[0][0]}가 대부분` : `${top[0][0]} ${Math.round(top[0][1] * 10)} : ${top[1][0]} ${Math.round(top[1][1] * 10)}`;
}
/** 화면용 문장 배열(A 합의 `styles[].summary`) — 영어 키는 한 글자도 안 나간다. 못 잰 축은 «못 봤어요»로 말한다(AC-9). */
export function textStyleSummary(s: TextStyle): string[] {
  const out: string[] = [];
  const { shape, voice, layout, learned } = s;
  if (shape.paraChars.avg) out.push(`문단은 ${shape.paraChars.avg}자${shape.paraLines.avg ? ` · ${shape.paraLines.avg}줄` : ""}쯤`);
  if (learned.measured.emoji) out.push(shape.emoji.uses ? `이모지 ${shape.emoji.top.length ? shape.emoji.top.join("") + " " : ""}${shape.emoji.where.length ? join(shape.emoji.where.map((w) => KO.emojiWhere[w])) + "에 " : ""}글당 ${shape.emoji.perPost}개쯤` : "이모지는 안 써요");
  if (learned.measured.emphasis) out.push(shape.emphasis.kinds.length ? `강조는 ${join(shape.emphasis.kinds.map((k) => KO.emphasis[k]))}${shape.emphasis.on.length ? ` · 주로 ${join(shape.emphasis.on.map((k) => KO.on[k]))}에` : ""} · 글당 ${shape.emphasis.perPost}곳` : "강조는 거의 안 써요");
  else out.push("복붙으로 배워서 꾸밈(밑줄·형광펜)은 못 봤어요");
  if (learned.measured.photos) out.push(shape.photos.count ? `사진 ${shape.photos.count}장${shape.photos.where.length ? ` · ${join(shape.photos.where.map((w) => KO.photoWhere[w]))}` : ""}${shape.photos.captionRate >= 0.5 ? " · 캡션 있음" : ""}${shape.photos.kinds.length ? ` · ${join(shape.photos.kinds.map((k) => KO.photoKind[k]))}` : ""}` : "사진은 안 써요");
  else out.push("사진은 못 봤어요(복붙)");
  const bits: string[] = [];
  if (shape.listCount) bits.push(`목록 ${shape.listCount}`); if (shape.tableCount) bits.push(`표 ${shape.tableCount}`); if (shape.quoteCount) bits.push(`인용 ${shape.quoteCount}`); if (shape.dividerCount) bits.push(`구분선 ${shape.dividerCount}`);
  if (bits.length) out.push(bits.join(" · "));
  const es = endingSay(voice.ending);
  const v: string[] = [];
  if (es) v.push(es); if (voice.sentenceChars) v.push(`문장 ${voice.sentenceChars}자쯤`); if (voice.questionRate) v.push(`질문 문장 ${Math.round(voice.questionRate * 100)}%`);
  if (v.length) out.push(v.join(" · "));
  if (voice.title.chars) out.push(`제목 ${voice.title.chars}자${voice.title.hasNumber ? " · 숫자 있음" : ""}${voice.title.isQuestion ? " · 질문형" : ""}`);
  const l: string[] = [];
  if (layout.h2Count) l.push(`소제목 ${layout.h2Count}개`); if (layout.totalChars) l.push(`${layout.totalChars.toLocaleString("ko-KR")}자`); if (layout.conclusion !== "none") l.push(`결론이 ${KO.conclusion[layout.conclusion]}`);
  if (l.length) out.push(l.join(" · "));
  return out;
}
/** 직접 쓰기(§5D)가 «구성만 그 틀로» 빌려 쓸 뼈대 — 블록 이름을 사람말로. */
export function textStyleOutline(s: TextStyle): { type: BlockType; label: string }[] {
  return s.layout.blocks.map((t) => ({ type: t, label: KO.block[t] ?? t }));
}

/* ─────────────────────────── 생성에 얹기 ─────────────────────────── */
/** 배운 강조 종류 → 이 채널에서 시켜도 되는 마크 종류(형광펜 = line·value · 글자색은 우리 어휘에 없어 value 로). 채널이 못 내는 건 뺀다(«못 낸 서식»에 적히지 않게 — 애초에 안 시킨다). */
export function styleMarkKinds(s: TextStyle, marksAllowed: readonly string[]): MarkKind[] {
  const want = new Set<MarkKind>();
  for (const k of s.shape.emphasis.kinds) {
    if (k === "bold") want.add("bold");
    if (k === "underline") want.add("underline");
    if (k === "italic") want.add("italic");
    if (k === "highlight" || k === "color") { want.add("line"); want.add("value"); }
  }
  return MARK_KINDS.filter((k) => want.has(k) && marksAllowed.includes(k));
}
/**
 * 프롬프트 줄(① 역할 칸 뒤 «①-d 이 계정의 글 모양») — 🔴 «문장을 베껴라»가 아니라 «이렇게 생기게 써라»다. 못 잰 축은 줄을 안 싣는다.
 *   강조 줄은 채널이 낼 수 있는 마크 종류로만 말한다(`marksAllowed`) — 못 내는 걸 시키면 «못 냈어요»가 매 글에 뜬다.
 */
export function textStylePromptLines(s: TextStyle, marksAllowed: readonly string[] = []): string[] {
  const out: string[] = [];
  const { shape, voice, layout, learned } = s;
  if (shape.paraChars.avg) out.push(`· 문단 하나는 ${shape.paraChars.avg}자 안팎(${shape.paraLines.avg ? `${shape.paraLines.avg}줄 · ` : ""}가장 길어도 ${shape.paraChars.max || shape.paraChars.avg * 2}자) · 줄바꿈은 ${shape.lineBreak === "single" ? "문단 사이 한 줄" : shape.lineBreak === "double" ? "문단 사이 빈 줄 하나" : "짧은 문단은 붙이고 긴 문단 뒤엔 빈 줄"}.`);
  if (learned.measured.emoji) {
    out.push(shape.emoji.uses
      ? `· 이모지를 ${shape.emoji.where.length ? join(shape.emoji.where.map((w) => KO.emojiWhere[w]), "·") : "문단 첫머리"}에 글당 ${shape.emoji.perPost || 4}개쯤${shape.emoji.top.length ? ` · 주로 ${shape.emoji.top.join(" ")} 중에서` : ""}. 같은 이모지를 연달아 쓰지 않는다.`
      : "· 이모지는 쓰지 않는다.");
  }
  if (learned.measured.emphasis) {
    const kinds = styleMarkKinds(s, marksAllowed);
    if (kinds.length && shape.emphasis.perPost) out.push(`· 강조는 marks 로 ${kinds.join("·")} 만 · 글당 ${Math.min(shape.emphasis.perPost, 12)}곳쯤${shape.emphasis.on.length ? ` · 주로 ${join(shape.emphasis.on.map((k) => KO.on[k]))}에` : ""}.`);
    else if (!shape.emphasis.kinds.length) out.push("· 강조(굵게·밑줄)는 거의 쓰지 않는다 — 한두 곳이면 충분하다.");
  }
  const es = endingSay(voice.ending);
  const v: string[] = [];
  if (es) v.push(`문장 끝은 ${es}`); if (voice.sentenceChars) v.push(`문장은 평균 ${voice.sentenceChars}자(짧은 문장을 섞는다)`); if (voice.questionRate) v.push(`질문 문장을 ${Math.round(voice.questionRate * 100)}%쯤`);
  if (v.length) out.push(`· 말투: ${v.join(" · ")}.`);
  if (voice.title.chars) out.push(`· 제목은 ${voice.title.chars}자쯤${voice.title.hasNumber ? " · 숫자를 하나 넣는다" : ""}${voice.title.isQuestion ? " · 질문형" : ""}.`);
  if (layout.conclusion === "first" || layout.conclusion === "both") out.push("· 결론(요약)을 앞에 먼저 말하고 근거를 뒤에 푼다.");
  if (learned.measured.photos && shape.photos.captionRate >= 0.5) out.push("· 사진엔 한 줄 캡션을 단다(글쓴이 말투).");
  return out;
}

/**
 * 계약 골격에 스타일의 «생김새»를 **얹는다**(R8-A §3.7 — 갈아끼우지 않는다).
 *   ① 이 계정이 쓰는 요소(인용·구분선·표·목록·체크리스트)가 골격에 없으면 **최대 둘**을 넣는다(억제 목록 존중)
 *   ② 결론이 앞이면 `summary` 를 첫 문단 뒤로(없으면 하나 넣는다)
 *   ③ 소제목 수를 스타일 쪽으로 **한 칸**만 당긴다(±1 · seed 로 흔든다) — 전부 맞추면 그게 고정 한 벌이다
 *   🔴 `tiers` 없는 채널(쓰레드)은 손대지 않는다 · 이렇게 만든 글도 `structure_repeat` 가 그대로 잰다.
 */
export function applyTextStyleShape(seq: BlockType[], s: TextStyle, c: { tiers?: { suppress: BlockType[] } | undefined }, seed = 1): BlockType[] {
  if (!c.tiers) return seq;
  const sup = new Set<BlockType>(c.tiers.suppress);
  const out = [...seq];
  const tail: BlockType[] = ["hashtags", "tip", "faq", "summary"];
  const tailAt = () => { let i = out.length; while (i > 0 && tail.includes(out[i - 1])) i--; return i; };
  const midParaAt = () => { const ps = out.map((b, i) => (b === "para" ? i : -1)).filter((i) => i >= 0); return ps.length ? ps[Math.floor(ps.length / 2)] + 1 : Math.max(1, tailAt()); };
  let added = 0;
  const want: [BlockType, number][] = [["quote", s.shape.quoteCount], ["divider", s.shape.dividerCount], ["table", s.shape.tableCount], ["list", s.shape.listCount]];
  for (const [t, n] of want) { if (n > 0 && !sup.has(t) && !out.includes(t) && added < 2) { out.splice(midParaAt(), 0, t); added++; } }
  if ((s.layout.conclusion === "first" || s.layout.conclusion === "both") && !sup.has("summary")) {
    const at = out.indexOf("summary"); if (at > 1) out.splice(at, 1);
    const firstPara = out.indexOf("para"); if (!out.slice(0, 2).includes("summary")) out.splice(firstPara >= 0 ? firstPara + 1 : 1, 0, "summary");
  }
  const h2s = out.filter((b) => b === "h2").length;
  const jitter = (seed % 2 === 0 ? 1 : 0);
  if (s.layout.h2Count > 0 && h2s > 0 && !sup.has("h2")) {
    const target = s.layout.h2Count + jitter - (seed % 3 === 0 ? 1 : 0);
    if (h2s + 1 <= target) out.splice(tailAt(), 0, "h2", "para");
    else if (h2s - 1 >= target && h2s > 2) { const last = out.lastIndexOf("h2"); if (last > 0 && out[last + 1] === "para") out.splice(last, 2); }
  }
  return out;
}

/** 스타일 이름 — 주소의 호스트만(남의 글 제목·주소 경로는 이름에 안 쓴다). */
export function textStyleName(from: LearnedFrom, sourceUrl?: string | null, at = new Date()): string {
  const d = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" }).format(at).replace(/\s/g, "");
  let host = "";
  try { host = sourceUrl ? new URL(sourceUrl).hostname.replace(/^www\./, "") : ""; } catch { host = ""; }
  const src = from === "paste" ? "복붙으로 배움" : from === "capture" ? "올린 화면으로 배움" : host ? `${host}에서 배움` : "링크로 배움";
  return `${src} · ${d}`.slice(0, 80);
}
