/**
 * lib/blocks.ts — Block 타입(계약 §4 v1.1) + renderBlocksHtml(blocks, channel, images) + 평문 추출. AM 원본: ../AutoMarketing/lib/content-images.ts figureHtml · content-tone toPlainText (관례 2026-09-14)
 *   🔴 HTML class 는 계약 §4B(v1.3) 글자 그대로: div.disclosure(첫 요소) · nav.toc>ol>li · p.summary · a.affiliate>img+span>b.name/em.price+span.go · div.adsense(빈 박스 · «광고» 라벨은 A CSS ::before)
 *   · dl.faq>dt/dd · p.tip · ul.check>li · p.tags · blockquote · hr · figure>img+figcaption · table · h2/h3/p/ul 표준. 러너는 이 class 로 에디터 실요소로 되돌린다(R2).
 */
import { formatCapsOf } from "./channel-registry";   // [R9-1] 순수 리프(import 0) — 여기서 가져와도 고리가 안 생긴다(AC-17)

export type BlockType = "hook" | "para" | "h2" | "h3" | "quote" | "list" | "checklist" | "table" | "image" | "divider" | "tip" | "faq" | "hashtags" | "disclosure" | "adsense" | "toc" | "summary" | "affiliate" | "place";
export interface Block {
  type: BlockType;
  text?: string;
  items?: string[];
  rows?: string[][];
  imageIndex?: number;
  /** [2026-09-15 §5C 수리] 사람이 읽는 캡션 — **글쓴이 말투 한 줄(≤25자)** · 대부분의 사진엔 **없다**(`images.captionRate`).
   *  🔴 그림 지시문이 아니다. 종전엔 한 문장이 «그림 지시 + 캡션» 두 일을 해서 «~놓여 있는 모습» 묘사문이 그대로 발행됐다(사장님 실측 piece 329). */
  caption?: string;
  /** [2026-09-15] 그림 생성용 묘사(영문 가능 · 사람·로고·글자 없는 장면) — 화면·발행에 **절대 나가지 않는다**. `alt` 는 여기서 짧게 파생한다. */
  prompt?: string;
  affiliate?: { productName: string; url: string; imageUrl?: string; price?: number };
  /**
   * [R8CLOSE-B1 §B4] **장소/링크 카드**(DESIGN §5C.3 네이버 블로그 시각 요소 「장소/링크카드」).
   *   🔴 **에디터의 «장소» 카드가 아니다.** 러너 op 어휘에 장소 카드가 **없고**(`runner/channels/naver-blog.mjs` 실측 2026-09-16),
   *      에디터에서 장소를 검색해 꽂는 것은 B7 «에디터 실제 요소»(R10)와 같은 일이다.
   *      ⇒ 지금 우리가 **할 수 있는 길**로 내려앉힌다: 본문 링크 카드(HTML 채널) · 지도 링크 한 줄(네이버 러너).
   *      `asCard:false` 가 그 사실을 적는 칸이다 — «장소 카드를 넣었다»고 말하면 그게 거짓말이다.
   */
  place?: { name: string; url?: string; address?: string; note?: string };
  /**
   * [R9-1 · B · 2026-09-16] 🔴 **인라인 꾸밈 — «뜻 마크»**(설계 §2.1d · AM `naver-blog-runner.mjs` 의 value·line·row 어휘 + 굵게·밑줄·기울임).
   *   뜻만 적는다. **보이는 모양**(형광펜이냐 글자색이냐 · 무슨 색이냐)은 채널·러너가 정한다 — 그래야 채널이 늘어도 서버가 안 바뀐다.
   *   · `s`/`e` = `text` 의 문자 인덱스 `[s, e)` · 마크 적용 **전 원문** 기준 · JS 문자열 인덱스(러너도 JS 라 같은 자)
   *   · 🔴 **`text` 가 있는 블록에만** 붙는다(para·hook·h2·h3·quote·tip·summary). `items[]`·`rows[][]` 블록은 «어느 문자열의 인덱스인가»가
   *     모호해서 안 받는다(B2 합의 · 억지로 넣으면 인덱스가 조용히 어긋난다 — 목록 항목 강조는 다음 라운드 `itemMarks`).
   *   · 이모지는 마크가 **아니다** — `text` 안 글자다(러너는 타자만 친다).
   *   · AM 은 제어문자를 본문에 섞어 마크를 나르는데 우리는 **구조**로 나른다(AC-77 ③ · 보이지 않는 글자는 git·DB 에서 사고다).
   */
  marks?: InlineMark[];
}
export interface RenderImage { url: string; caption?: string; alt?: string }

/* ═══ [R9-1] 인라인 꾸밈 어휘 — 🔴 **키 이름은 B2(러너)·A(화면)와 글자 그대로 맞춘 계약이다**(2026-09-16). 바꾸면 셋이 같이 바뀐다. ═══
 *   value     = 점 강조(숫자·결론 낱말 · «핵심값»)     line = 면 강조(문장 하나 통째로 · 형광펜)     row = 나열 강조(요금·비교 같은 행)
 *   bold      = 굵게                                  underline = 밑줄                              italic = 기울임
 *   🔴 채널이 낼 수 있는 종류는 `lib/channel-registry.ts formatCaps` 가 정본이다(모르면 null). 서버는 **true 인 종류만 모델에게 시킨다.** */
export type MarkKind = "value" | "line" | "row" | "bold" | "underline" | "italic";
export const MARK_KINDS: readonly MarkKind[] = ["value", "line", "row", "bold", "underline", "italic"];
export interface InlineMark { s: number; e: number; kind: MarkKind }
/** 사람말 라벨 — 🔴 화면 라벨의 **정본**(AC-52 · 화면은 베껴 쓰지 않고 서버가 실어 준 label 을 그린다). */
export const MARK_LABEL: Record<MarkKind, string> = {
  value: "핵심 강조", line: "형광펜", row: "나열 강조", bold: "굵게", underline: "밑줄", italic: "기울임",   // 칩 글자 — A 화면과 같은 낱말(라벨 하니스 ⑧-d 가 대조한다)
};
/** HTML 채널(블로거·워드프레스)과 검수 미리보기가 그리는 태그 — A 와 합의한 글자 그대로(`.preview mark.line …` CSS 가 이 class 를 본다). */
export const MARK_HTML: Record<MarkKind, [string, string]> = {
  value: ['<mark class="value">', "</mark>"], line: ['<mark class="line">', "</mark>"], row: ['<mark class="row">', "</mark>"],
  bold: ["<strong>", "</strong>"], underline: ["<u>", "</u>"], italic: ["<em>", "</em>"],
};
/**
 * 글당 상한 — AM 실측값(value 12/60자 · line 6/140자 · row 10)을 그대로(B2 러너 계획층도 같은 수 · **서버가 더 적게 보내면 그게 이긴다**).
 *   🔴 이건 게이트가 아니다(§9) — 넘친 마크는 **앞쪽부터 남기고** 나머지는 `budget` 으로 «못 냈어요»에 적는다. 글은 그대로 나간다.
 */
export const MARK_BUDGET: Record<MarkKind, { perPost: number; maxChars: number }> = {
  value: { perPost: 12, maxChars: 60 }, line: { perPost: 6, maxChars: 140 }, row: { perPost: 10, maxChars: 140 },
  bold: { perPost: 12, maxChars: 60 }, underline: { perPost: 8, maxChars: 80 }, italic: { perPost: 6, maxChars: 80 },
};
/** 마크 하나를 버린 사유 — 🔴 내부 어휘다(화면에 그대로 안 나간다 · AC-91). 사람말은 `lib/format-marks.ts WHY_SAY`. */
export interface MarkDrop { kind: string; why: "range_invalid" | "overlap" | "unknown_kind" | "no_text" | "too_long" | "budget"; sample?: string }

/**
 * validateMarks — 모델(또는 사람)이 낸 `marks` 를 **믿지 않고** 잰다. 어긋난 것은 버리되 **조용히 안 버린다**(`dropped` 에 사유).
 *   규칙(러너와 같은 규칙 · B2 합의): 정수 `0 ≤ s < e ≤ text.length` · kind 는 어휘 안 · 겹침 없음(앞선 것이 이김) · 너무 긴 구간은 `too_long`.
 */
export function validateMarks(text: unknown, raw: unknown): { marks: InlineMark[]; dropped: MarkDrop[] } {
  const t = String(text ?? "");
  const dropped: MarkDrop[] = [];
  if (!Array.isArray(raw) || !raw.length) return { marks: [], dropped };
  if (!t) { for (const x of raw) dropped.push({ kind: String((x as Record<string, unknown>)?.kind ?? "?"), why: "no_text" }); return { marks: [], dropped }; }
  const cand: InlineMark[] = [];
  for (const x of raw) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const kind = String(o.kind ?? "");
    const s = Number(o.s), e = Number(o.e);
    if (!MARK_KINDS.includes(kind as MarkKind)) { dropped.push({ kind: kind || "?", why: "unknown_kind" }); continue; }
    if (!Number.isInteger(s) || !Number.isInteger(e) || s < 0 || e > t.length || s >= e) { dropped.push({ kind, why: "range_invalid" }); continue; }
    if (e - s > MARK_BUDGET[kind as MarkKind].maxChars) { dropped.push({ kind, why: "too_long", sample: t.slice(s, s + 20) }); continue; }
    cand.push({ s, e, kind: kind as MarkKind });
  }
  cand.sort((a, b) => a.s - b.s || a.e - b.e);
  const out: InlineMark[] = [];
  let end = -1;
  for (const m of cand) {
    if (m.s < end) { dropped.push({ kind: m.kind, why: "overlap", sample: t.slice(m.s, m.s + 20) }); continue; }
    out.push(m); end = m.e;
  }
  return { marks: out, dropped };
}

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 인라인 강조만 허용: **굵게** → <strong>. 나머지 HTML 은 이스케이프. */
function inline(s: unknown): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}
/**
 * [R9-1] 마크를 HTML 로 — 원문을 마크 경계에서 잘라 조각마다 이스케이프하고 태그로 감싼다(인덱스는 **원문** 기준이라 이스케이프 뒤 길이와 무관).
 *   `render(kind)` 가 false 인 종류는 태그 없이 글자만 남긴다(채널 표가 «못 낸다»고 한 것 · 호출부가 `demoted` 에 적는다).
 *   🔴 무회귀: 마크가 없으면 종전 `inline()` 과 한 글자도 다르지 않다.
 */
export function inlineMarked(s: unknown, marks: InlineMark[] | undefined, render: (kind: MarkKind) => boolean = () => true): string {
  const text = String(s ?? "");
  const ms = (marks ?? []).filter((m) => m && render(m.kind) && m.s >= 0 && m.e <= text.length && m.s < m.e).sort((a, b) => a.s - b.s);
  if (!ms.length) return inline(text);
  let out = ""; let pos = 0;
  for (const m of ms) {
    if (m.s < pos) continue;   // 겹침 방어(validateMarks 가 걸렀지만 한 번 더)
    const [open, close] = MARK_HTML[m.kind];
    out += esc(text.slice(pos, m.s)) + open + esc(text.slice(m.s, m.e)) + close;
    pos = m.e;
  }
  out += esc(text.slice(pos));
  return out.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

/**
 * [R9-1 · R9-5] 채널이 «못 낸다»(false)고 적힌 종류는 **태그를 벗긴다**(글자는 남는다). null(모름)·true 는 그린다 —
 *   모르는 건 러너가 올려 보고 발행 뒤 같은 칸에 적는다(§9-2 «발행 뒤에도 볼 수 있게»).
 *   🔴 표는 `lib/channel-registry.ts`(순수 리프) 한 곳 — 여기서 채널 이름으로 분기하지 않는다.
 */
export function markRendererFor(channel: string): (kind: MarkKind) => boolean {
  const caps = formatCapsOf(channel);
  return (kind) => !(caps && caps[kind] === false);
}

export function renderBlocksHtml(blocks: Block[], channel: string, images: RenderImage[] = []): string {
  const out: string[] = [];
  const h2s = blocks.filter((b) => b.type === "h2" && b.text).map((b) => String(b.text));
  const mk = markRendererFor(channel);
  const im = (b: Block) => inlineMarked(b.text, b.marks, mk);
  for (const b of blocks) {
    switch (b.type) {
      case "hook": out.push(`<p class="hook"><strong>${im(b)}</strong></p>`); break;
      case "para": out.push(`<p>${im(b)}</p>`); break;
      case "h2": out.push(`<h2>${im(b)}</h2>`); break;
      case "h3": out.push(`<h3>${im(b)}</h3>`); break;
      case "quote": out.push(`<blockquote>${im(b)}</blockquote>`); break;
      case "list": out.push(`<ul>${(b.items ?? []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); break;
      case "checklist": out.push(`<ul class="check">${(b.items ?? []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); break;
      case "table": {
        const rows = b.rows ?? []; if (!rows.length) break;
        const [head, ...body] = rows;
        out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        break;
      }
      /* [R8CLOSE-B1 §B4] 장소/링크 카드 — 🔴 **링크가 없으면 아무것도 안 그린다**(빈 카드는 카드가 아니다). */
      case "place": {
        const p = b.place; if (!p?.name) break;
        const inner = [`<strong>${esc(p.name)}</strong>`, p.address ? `<span class="addr">${esc(p.address)}</span>` : "", p.note ? `<span class="note">${esc(p.note)}</span>` : ""].filter(Boolean).join("");
        out.push(p.url
          ? `<aside class="place"><a href="${esc(p.url)}" rel="noopener">${inner}</a></aside>`
          : `<aside class="place">${inner}</aside>`);
        break;
      }
      case "image": {
        const img = typeof b.imageIndex === "number" ? images[b.imageIndex] : undefined;
        const cap = b.caption || img?.caption || "";
        // [§5C 수리] 캡션이 없으면 <figcaption> 자체를 내지 않는다(빈 칸이 보이면 그것도 티다) · alt 는 접근성용(화면에 안 보인다 · prompt 파생)
        const fc = cap ? `<figcaption>${inline(cap)}</figcaption>` : "";
        const alt = img?.alt || cap || "사진";
        if (img?.url) out.push(`<figure data-image-index="${b.imageIndex ?? ""}"><img src="${esc(img.url)}" alt="${esc(alt)}" loading="lazy">${fc}</figure>`);
        else out.push(`<figure class="pending" data-image-index="${b.imageIndex ?? ""}">${fc}</figure>`);
        break;
      }
      case "divider": out.push(`<hr>`); break;
      case "tip": out.push(`<p class="tip">${im(b)}${b.items?.length ? "<br>" + b.items.map((i) => inline(i)).join("<br>") : ""}</p>`); break;
      case "faq": {
        const items = b.items ?? [];
        out.push(`<dl class="faq">${items.map((qa) => { const [qq, ...aa] = String(qa).split(/\n|\s*\|\s*/); return `<dt>${inline(qq.replace(/^Q[.:：]?\s*/i, ""))}</dt><dd>${inline(aa.join(" ").trim().replace(/^A[.:：]?\s*/i, ""))}</dd>`; }).join("")}</dl>`);
        break;
      }
      case "hashtags": out.push(`<p class="tags">${(b.items ?? []).map((t) => `#${esc(String(t).replace(/^#/, "").replace(/\s+/g, ""))}`).join(" ")}</p>`); break;
      case "disclosure": out.push(`<div class="disclosure">${esc(b.text)}</div>`); break;
      case "adsense": out.push(`<div class="adsense"></div>`); break;
      case "toc": {
        const items = b.items?.length ? b.items : h2s;
        out.push(`<nav class="toc"><ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol></nav>`);
        break;
      }
      case "summary": out.push(`<p class="summary">${im(b)}${b.items?.length ? (b.text ? "<br>" : "") + b.items.map((i) => inline(i)).join("<br>") : ""}</p>`); break;
      case "affiliate": {
        const a = b.affiliate; if (!a?.url) break;
        out.push(`<a class="affiliate" href="${esc(a.url)}" rel="nofollow sponsored noopener" target="_blank">${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="">` : ""}<span><b class="name">${esc(a.productName)}</b>${typeof a.price === "number" && a.price > 0 ? `<em class="price">${a.price.toLocaleString("ko-KR")}원</em>` : ""}</span><span class="go">보러가기</span></a>`);
        if (b.text) out.push(`<p>${inline(b.text)}</p>`);
        break;
      }
    }
  }
  return insertAdSlots(out.join("\n"), channel);
}

/** 광고 자리를 넣지 않는 채널 — 네이버 블로그는 애드포스트가 자동 삽입한다(계약 P1R3 §2.2). 영상·SNS 채널은 본문 광고 자리가 없다. */
export const NO_AD_SLOT_CHANNELS: ReadonlySet<string> = new Set(["naver_blog", "naver_clip", "threads", "instagram", "reels", "tiktok", "youtube_shorts"]);
/**
 * insertAdSlots — 본문에 «애드센스 자리» 2곳을 비워 둔다(계약 P1R3 §2.2 · DESIGN §9.0): **첫 소제목(h2) 뒤 · 마지막 문단(p) 앞**.
 *   `<div class="ad-slot" data-slot="mid"></div>` / `data-slot="end"`. 광고 코드 실체화는 B2(발행층)가 한다 — 여기는 자리만.
 *   멱등: 이미 `.ad-slot` 이 있으면 손대지 않는다. h2 가 없으면 mid 는 첫 문단 뒤. 사용자가 고친 HTML(pieces-update)은 건드리지 않는다.
 */
export function insertAdSlots(html: string, channel: string): string {
  if (!html || NO_AD_SLOT_CHANNELS.has(String(channel)) || /class="ad-slot"/.test(html)) return html;
  const MID = `<div class="ad-slot" data-slot="mid"></div>`, END = `<div class="ad-slot" data-slot="end"></div>`;
  let s = html;
  const h2 = /<\/h2>/i.exec(s);
  if (h2) s = s.slice(0, h2.index + h2[0].length) + "\n" + MID + s.slice(h2.index + h2[0].length);
  else { const p1 = /<\/p>/i.exec(s); if (p1) s = s.slice(0, p1.index + p1[0].length) + "\n" + MID + s.slice(p1.index + p1[0].length); }
  // 마지막 «문단» = class 없는 마지막 <p>(태그·요약·고지처럼 class 가 붙은 p 는 문단이 아니다). 없으면 맨 끝.
  const ps = [...s.matchAll(/<p(?![^>]*class=)[^>]*>/gi)];
  if (ps.length) { const last = ps[ps.length - 1]; s = s.slice(0, last.index) + END + "\n" + s.slice(last.index); }
  else s = s + "\n" + END;
  return s;
}

/** HTML → 평문(게이트·유사도 판정용). */
export function htmlToPlain(html: string | null | undefined): string {
  return String(html ?? "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|figure|figcaption|blockquote|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** 블록 → 평문(문단 단위 · 게이트용). 고지·해시태그·광고 자리는 제외. */
export function blocksToPlain(blocks: Block[]): string {
  const ps: string[] = [];
  for (const b of blocks) {
    if (["disclosure", "adsense", "hashtags", "toc", "divider", "image", "affiliate"].includes(b.type)) continue;
    if (b.text) ps.push(String(b.text));
    if (b.items?.length) ps.push(b.items.join("\n"));
    if (b.rows?.length) ps.push(b.rows.map((r) => r.join(" ")).join("\n"));
  }
  return ps.join("\n\n");
}

/** 본문 글자 수(공백 포함 · 고지·태그 제외). */
export function blocksCharCount(blocks: Block[]): number { return blocksToPlain(blocks).replace(/\s+/g, " ").length; }

/**
 * 블록 정규화 — 모델 출력의 느슨한 모양을 계약 모양으로. 모르는 type 은 para 로.
 *   [R9-1] `marks` 도 여기서 받는다 — 🔴 **파싱이 없으면 모델이 내도 조용히 버려진다**(place 블록에서 겪은 그것). 어긋난 마크는
 *   `opts.drops` 에 사유와 함께 쌓인다(호출부가 «못 냈어요»에 적는다 · 조용히 0건 금지).
 *   ⚠️ `text` 는 `.trim()` 되므로 앞 공백만큼 인덱스를 당긴다 — 모델은 원문 기준으로 세기 때문이다.
 */
export function normalizeBlocks(raw: unknown, opts: { drops?: MarkDrop[] } = {}): Block[] {
  const TYPES = new Set<BlockType>(["hook", "para", "h2", "h3", "quote", "list", "checklist", "table", "image", "divider", "tip", "faq", "hashtags", "disclosure", "adsense", "toc", "summary", "affiliate", "place"]);
  const list = Array.isArray(raw) ? raw : [];
  const out: Block[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const type = TYPES.has(String(o.type) as BlockType) ? (String(o.type) as BlockType) : "para";
    const b: Block = { type };
    if (typeof o.text === "string" && o.text.trim()) b.text = o.text.trim();
    if (o.marks !== undefined && o.marks !== null) {
      const lead = typeof o.text === "string" ? o.text.length - o.text.trimStart().length : 0;
      const shifted = Array.isArray(o.marks) ? o.marks.map((m) => (m && typeof m === "object" ? { ...(m as Record<string, unknown>), s: Number((m as Record<string, unknown>).s) - lead, e: Number((m as Record<string, unknown>).e) - lead } : m)) : o.marks;
      const v = validateMarks(b.text ?? "", shifted);
      if (v.marks.length) b.marks = v.marks;
      if (v.dropped.length && opts.drops) opts.drops.push(...v.dropped);
    }
    if (Array.isArray(o.items)) { const items = o.items.map((i) => String(i ?? "").trim()).filter(Boolean); if (items.length) b.items = items; }
    if (Array.isArray(o.rows)) { const rows = o.rows.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? "").trim())); if (rows.length) b.rows = rows; }
    if (typeof o.caption === "string" && o.caption.trim()) b.caption = o.caption.trim();
    if (typeof o.prompt === "string" && o.prompt.trim()) b.prompt = o.prompt.trim().slice(0, 600);
    if (Number.isInteger(Number(o.imageIndex)) && o.imageIndex !== undefined && o.imageIndex !== null) b.imageIndex = Number(o.imageIndex);
    /* [R8CLOSE-B1 §B4] 장소/링크 카드 — 🔴 이 파싱이 없으면 모델이 내도 **조용히 버려진다**(블록 타입만 만들면 안 닫힌다).
       `url` 은 http(s) 만 받는다: `javascript:` 가 본문 `<a href>` 로 나가면 그건 우리가 심는 구멍이다. */
    if (o.place && typeof o.place === "object") {
      const p = o.place as Record<string, unknown>;
      const name = String(p.name ?? "").trim();
      if (name) {
        const url = String(p.url ?? "").trim();
        b.place = { name: name.slice(0, 80),
          ...(String(url).toLowerCase().startsWith("http://") || String(url).toLowerCase().startsWith("https://") ? { url: url.slice(0, 400) } : {}),
          ...(String(p.address ?? "").trim() ? { address: String(p.address).trim().slice(0, 120) } : {}),
          ...(String(p.note ?? "").trim() ? { note: String(p.note).trim().slice(0, 60) } : {}) };
      }
    }
    if (type === "place" && !b.place) continue;                 // 이름 없는 장소 블록은 빈 카드다 — 버린다
    if (type === "para" && !b.text && !b.items) continue;
    if ((type === "list" || type === "checklist") && !b.items) continue;
    if (type === "table" && !b.rows) continue;
    out.push(b);
  }
  return out;
}
