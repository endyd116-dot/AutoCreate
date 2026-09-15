/**
 * lib/export/markdown.ts — 블록 → 마크다운(계약 P1R6 §2.1 «글 = 마크다운 + 이미지»).
 *   `lib/blocks.ts renderBlocksHtml` 의 짝. 왜 HTML 이 아니라 마크다운인가: 내보내기는 «내 자산을 들고 나가는 것» 이라
 *   다른 도구(옵시디언·노션·워드프레스)가 바로 읽는 형식이어야 한다. HTML 은 우리 CSS 를 전제한다.
 *   이미지는 ZIP 안 상대 경로(`이미지/NN.png`)로 건다 — 압축을 풀면 그대로 보인다(R2 링크는 7일 뒤 죽는다).
 *   🔎 출처: AC 신규(계약 P1R6-B-1 §2.1 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import type { Block } from "../blocks";

const clean = (s: unknown) => String(s ?? "").replace(/\r/g, "").trim();
/** 마크다운 특수문자 중 **제목 줄**에서만 문제가 되는 것 — 본문은 사람이 쓴 대로 둔다(과도한 이스케이프는 읽기를 해친다). */
const heading = (s: unknown) => clean(s).replace(/^#+\s*/, "").replace(/\n+/g, " ");

export interface MdImage { /** ZIP 안 상대 경로. */ path: string; caption?: string }

export function blocksToMarkdown(blocks: Block[], images: MdImage[] = []): string {
  const out: string[] = [];
  let imgCursor = 0;
  for (const b of blocks) {
    const t = clean(b.text);
    switch (b.type) {
      case "hook": if (t) out.push(`> **${t.replace(/\n+/g, " ")}**`); break;
      case "h2": if (t) out.push(`## ${heading(t)}`); break;
      case "h3": if (t) out.push(`### ${heading(t)}`); break;
      case "quote": if (t) out.push(t.split("\n").map((l) => `> ${l}`).join("\n")); break;
      case "para": case "summary": if (t) out.push(t); break;
      case "tip": if (t) out.push(`> 💡 ${t.replace(/\n+/g, " ")}`); break;
      case "disclosure": if (t) out.push(`> ${t.replace(/\n+/g, " ")}`); break;
      case "divider": out.push("---"); break;
      case "list": if (b.items?.length) out.push(b.items.map((x) => `- ${clean(x)}`).join("\n")); break;
      case "checklist": if (b.items?.length) out.push(b.items.map((x) => `- [ ] ${clean(x)}`).join("\n")); break;
      case "toc": if (b.items?.length) out.push(b.items.map((x, i) => `${i + 1}. ${clean(x)}`).join("\n")); break;
      case "hashtags": if (b.items?.length) out.push(b.items.map((x) => `#${clean(x).replace(/^#/, "")}`).join(" ")); break;
      case "faq":
        if (b.rows?.length) out.push(b.rows.map((r) => `**Q. ${clean(r[0])}**\n\nA. ${clean(r[1])}`).join("\n\n"));
        else if (t) out.push(t);
        break;
      case "table":
        if (b.rows?.length) {
          const [head, ...rest] = b.rows;
          out.push([`| ${head.map(clean).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rest.map((r) => `| ${r.map(clean).join(" | ")} |`)].join("\n"));
        }
        break;
      case "image": {
        const idx = typeof b.imageIndex === "number" ? b.imageIndex : imgCursor;
        const img = images[idx];
        imgCursor = Math.max(imgCursor, idx + 1);
        const cap = clean(b.caption ?? img?.caption);
        if (img) out.push(`![${cap || "사진"}](${encodeURI(img.path)})${cap ? `\n\n*${cap}*` : ""}`);
        break;
      }
      case "affiliate":
        if (b.affiliate?.url) out.push(`[${clean(b.affiliate.productName) || "상품 보러가기"}](${b.affiliate.url})`);
        break;
      case "adsense": break;                                     // 광고 자리 — 내보내기에는 뜻이 없다
      default: if (t) out.push(t);
    }
  }
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** 프런트매터 — 다른 도구가 제목·날짜·채널·링크를 그대로 읽는다. 시각은 KST(§4.5b). */
export function frontMatter(o: { title: string; channel: string; status: string; createdAtKst: string; publishedAtKst?: string; url?: string; tags?: string[]; account?: string }): string {
  const esc = (s: unknown) => `"${String(s ?? "").replace(/"/g, '\\"')}"`;
  const lines = [
    "---",
    `title: ${esc(o.title)}`,
    `channel: ${esc(o.channel)}`,
    `status: ${esc(o.status)}`,
    `created: ${esc(`${o.createdAtKst} (KST)`)}`,
  ];
  if (o.publishedAtKst) lines.push(`published: ${esc(`${o.publishedAtKst} (KST)`)}`);
  if (o.account) lines.push(`account: ${esc(o.account)}`);
  if (o.url) lines.push(`url: ${esc(o.url)}`);
  if (o.tags?.length) lines.push(`tags: [${o.tags.map((t) => esc(t)).join(", ")}]`);
  lines.push("---", "");
  return lines.join("\n");
}
