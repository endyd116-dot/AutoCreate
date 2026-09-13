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
  caption?: string;
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
        if (img?.url) out.push(`<figure data-image-index="${b.imageIndex ?? ""}"><img src="${esc(img.url)}" alt="${esc(img.alt || cap)}" loading="lazy"><figcaption>${inline(cap)}</figcaption></figure>`);
        else out.push(`<figure class="pending" data-image-index="${b.imageIndex ?? ""}"><figcaption>${inline(cap)}</figcaption></figure>`);
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
  void channel;
  return out.join("\n");
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
    if (Number.isInteger(Number(o.imageIndex)) && o.imageIndex !== undefined && o.imageIndex !== null) b.imageIndex = Number(o.imageIndex);
    if (type === "para" && !b.text && !b.items) continue;
    if ((type === "list" || type === "checklist") && !b.items) continue;
    if (type === "table" && !b.rows) continue;
    out.push(b);
  }
  return out;
}
