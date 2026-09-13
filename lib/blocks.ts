/**
 * lib/blocks.ts — Block 타입(계약 §4 v1.1) + renderBlocksHtml(blocks, channel, images) + 평문 추출. AM 원본: ../AutoMarketing/lib/content-images.ts figureHtml · content-tone toPlainText (관례 2026-09-14)
 *   HTML 은 «미리보기·러너 변환» 공용 정본 한 벌. 블록마다 `class="ac-<type>"` 를 달아 러너가 에디터 실요소(인용구·구분선·체크리스트)로 되돌린다(R2).
 *   adsense 블록은 «광고» 라벨을 렌더에 박는다(§16B.3 «광고 자리 본문과 혼동 금지»). disclosure 는 `ac-disclosure` 인용 박스(본문과 같은 크기 이상).
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
      case "hook": out.push(`<p class="ac-hook"><strong>${inline(b.text)}</strong></p>`); break;
      case "para": out.push(`<p class="ac-para">${inline(b.text)}</p>`); break;
      case "h2": out.push(`<h2 class="ac-h2">${inline(b.text)}</h2>`); break;
      case "h3": out.push(`<h3 class="ac-h3">${inline(b.text)}</h3>`); break;
      case "quote": out.push(`<blockquote class="ac-quote">${inline(b.text)}</blockquote>`); break;
      case "list": out.push(`<ul class="ac-list">${(b.items ?? []).map((i) => `<li>${inline(i)}</li>`).join("")}</ul>`); break;
      case "checklist": out.push(`<ul class="ac-checklist">${(b.items ?? []).map((i) => `<li>☑ ${inline(i)}</li>`).join("")}</ul>`); break;
      case "table": {
        const rows = b.rows ?? []; if (!rows.length) break;
        const [head, ...body] = rows;
        out.push(`<table class="ac-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
        break;
      }
      case "image": {
        const img = typeof b.imageIndex === "number" ? images[b.imageIndex] : undefined;
        const cap = b.caption || img?.caption || "";
        if (img?.url) out.push(`<figure class="ac-figure" data-image-index="${b.imageIndex ?? ""}"><img src="${esc(img.url)}" alt="${esc(img.alt || cap)}" loading="lazy"><figcaption>${inline(cap)}</figcaption></figure>`);
        else out.push(`<figure class="ac-figure ac-figure--pending" data-image-index="${b.imageIndex ?? ""}"><figcaption>${inline(cap)}</figcaption></figure>`);
        break;
      }
      case "divider": out.push(`<hr class="ac-divider">`); break;
      case "tip": out.push(`<div class="ac-tip"><p>${inline(b.text)}</p>${b.items?.length ? `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>` : ""}</div>`); break;
      case "faq": {
        const items = b.items ?? [];
        out.push(`<div class="ac-faq">${items.map((qa) => { const [qq, ...aa] = String(qa).split(/\n|\s*\|\s*/); return `<div class="ac-faq-item"><p class="ac-faq-q"><strong>Q. ${inline(qq)}</strong></p><p class="ac-faq-a">${inline(aa.join(" ").trim())}</p></div>`; }).join("")}</div>`);
        break;
      }
      case "hashtags": out.push(`<p class="ac-hashtags">${(b.items ?? []).map((t) => `#${esc(String(t).replace(/^#/, "").replace(/\s+/g, ""))}`).join(" ")}</p>`); break;
      case "disclosure": out.push(`<blockquote class="ac-disclosure">${esc(b.text)}</blockquote>`); break;
      case "adsense": out.push(`<div class="ac-adsense" data-label="광고"><span class="ac-adsense-label">광고</span></div>`); break;
      case "toc": {
        const items = b.items?.length ? b.items : h2s;
        out.push(`<nav class="ac-toc"><p><strong>목차</strong></p><ol>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</ol></nav>`);
        break;
      }
      case "summary": out.push(`<div class="ac-summary"><p><strong>요약</strong></p>${b.text ? `<p>${inline(b.text)}</p>` : ""}${b.items?.length ? `<ul>${b.items.map((i) => `<li>${inline(i)}</li>`).join("")}</ul>` : ""}</div>`); break;
      case "affiliate": {
        const a = b.affiliate; if (!a?.url) break;
        out.push(`<div class="ac-affiliate"><a href="${esc(a.url)}" target="_blank" rel="nofollow sponsored noopener">${a.imageUrl ? `<img src="${esc(a.imageUrl)}" alt="${esc(a.productName)}" loading="lazy">` : ""}<span class="ac-affiliate-name">${esc(a.productName)}</span>${typeof a.price === "number" && a.price > 0 ? `<span class="ac-affiliate-price">${a.price.toLocaleString("ko-KR")}원</span>` : ""}</a>${b.text ? `<p>${inline(b.text)}</p>` : ""}</div>`);
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
