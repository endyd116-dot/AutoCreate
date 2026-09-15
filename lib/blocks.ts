/**
 * lib/blocks.ts — Block 타입(계약 §4 v1.1) + renderBlocksHtml(blocks, channel, images) + 평문 추출. AM 원본: ../AutoMarketing/lib/content-images.ts figureHtml · content-tone toPlainText (관례 2026-09-14)
 *   🔴 HTML class 는 계약 §4B(v1.3) 글자 그대로: div.disclosure(첫 요소) · nav.toc>ol>li · p.summary · a.affiliate>img+span>b.name/em.price+span.go · div.adsense(빈 박스 · «광고» 라벨은 A CSS ::before)
 *   · dl.faq>dt/dd · p.tip · ul.check>li · p.tags · blockquote · hr · figure>img+figcaption · table · h2/h3/p/ul 표준. 러너는 이 class 로 에디터 실요소로 되돌린다(R2).
 */
export type BlockType = "hook" | "para" | "h2" | "h3" | "quote" | "list" | "checklist" | "table" | "image" | "divider" | "tip" | "faq" | "hashtags" | "disclosure" | "adsense" | "toc" | "summary" | "affiliate";
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
}
export interface RenderImage { url: string; caption?: string; alt?: string }

const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** 인라인 강조만 허용: **굵게** → <strong>. 나머지 HTML 은 이스케이프. */
function inline(s: unknown): string {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>");
}

export function renderBlocksHtml(blocks: Block[], channel: string, images: RenderImage[] = []): string {
  const out: string[] = [];
  const h2s = blocks.filter((b) => b.type === "h2" && b.text).map((b) => String(b.text));
  for (const b of blocks) {
    switch (b.type) {
      case "hook": out.push(`<p class="hook"><strong>${inline(b.text)}</strong></p>`); break;
      case "para": out.push(`<p>${inline(b.text)}</p>`); break;
      case "h2": out.push(`<h2>${inline(b.text)}</h2>`); break;
      case "h3": out.push(`<h3>${inline(b.text)}</h3>`); break;
      case "quote": out.push(`<blockquote>${inline(b.text)}</blockquote>`); break;
      case "list": out.push(`<ul>${(b.items ?? []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); break;
      case "checklist": out.push(`<ul class="check">${(b.items ?? []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); break;
      case "table": {
        const rows = b.rows ?? []; if (!rows.length) break;
        const [head, ...body] = rows;
        out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
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
      case "tip": out.push(`<p class="tip">${inline(b.text)}${b.items?.length ? "<br>" + b.items.map((i) => inline(i)).join("<br>") : ""}</p>`); break;
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
      case "summary": out.push(`<p class="summary">${inline(b.text)}${b.items?.length ? (b.text ? "<br>" : "") + b.items.map((i) => inline(i)).join("<br>") : ""}</p>`); break;
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

/** 블록 정규화 — 모델 출력의 느슨한 모양을 계약 모양으로. 모르는 type 은 para 로. */
export function normalizeBlocks(raw: unknown): Block[] {
  const TYPES = new Set<BlockType>(["hook", "para", "h2", "h3", "quote", "list", "checklist", "table", "image", "divider", "tip", "faq", "hashtags", "disclosure", "adsense", "toc", "summary", "affiliate"]);
  const list = Array.isArray(raw) ? raw : [];
  const out: Block[] = [];
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const type = TYPES.has(String(o.type) as BlockType) ? (String(o.type) as BlockType) : "para";
    const b: Block = { type };
    if (typeof o.text === "string" && o.text.trim()) b.text = o.text.trim();
    if (Array.isArray(o.items)) { const items = o.items.map((i) => String(i ?? "").trim()).filter(Boolean); if (items.length) b.items = items; }
    if (Array.isArray(o.rows)) { const rows = o.rows.filter(Array.isArray).map((r) => (r as unknown[]).map((c) => String(c ?? "").trim())); if (rows.length) b.rows = rows; }
    if (typeof o.caption === "string" && o.caption.trim()) b.caption = o.caption.trim();
    if (typeof o.prompt === "string" && o.prompt.trim()) b.prompt = o.prompt.trim().slice(0, 600);
    if (Number.isInteger(Number(o.imageIndex)) && o.imageIndex !== undefined && o.imageIndex !== null) b.imageIndex = Number(o.imageIndex);
    if (type === "para" && !b.text && !b.items) continue;
    if ((type === "list" || type === "checklist") && !b.items) continue;
    if (type === "table" && !b.rows) continue;
    out.push(b);
  }
  return out;
}
