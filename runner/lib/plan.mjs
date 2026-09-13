/**
 * runner/lib/plan.mjs — 원고(§4B 블록/bodyHtml) → **에디터 조작 시퀀스**(순수 · IO 0).
 *   AM 원본: ../AutoMarketing/scripts/naver-blog-runner.mjs planEditorOps(2026-09-14 구조 이식 · AC 블록 어휘로 개작).
 *
 *   🔴 이 함수의 출력이 발행물의 정본 설계도다. 채널 모듈은 이 «데이터»를 연주만 한다 —
 *      그래야 네이버·티스토리가 같은 원고에서 같은 모양을 낸다(서식이 채널마다 갈리지 않는다).
 *
 *   블록이 있으면 블록을 쓴다(정본). 사람이 검수창에서 본문을 고쳐 블록과 어긋난 경우를 대비해
 *   **bodyHtml 파서**도 둔다(블록이 비었을 때만 · §4B class 계약을 그대로 되읽는다).
 */

/** op 종류: title · para · heading · quote · divider · list · check · image · faq · tags · link · note */
const clean = (s) => String(s ?? "").replace(/ /g, " ").replace(/\s+\n/g, "\n").trim();

/** HTML 엔티티 되돌리기(에디터에는 사람이 읽는 글자를 넣는다). */
function unescapeHtml(s) {
  return String(s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h2|h3|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
}

/* ─────────────── 블록 → ops(정본 경로) ─────────────── */

function opsFromBlocks(blocks, images) {
  const ops = [];
  const imgs = Array.isArray(images) ? images : [];
  let imgCursor = 0;
  for (const b of blocks) {
    const type = String(b?.type ?? "");
    const text = clean(b?.text);
    switch (type) {
      case "disclosure":
        // 🔴 고지는 «본문과 구분되는 블록»이어야 한다(§16B.1) — 인용구로 세운다. 첫 자리는 호출자가 보장한다.
        if (text) ops.push({ op: "quote", text, role: "disclosure" });
        break;
      case "hook":
      case "para":
      case "summary":
      case "tip":
        if (text) ops.push({ op: "para", text });
        break;
      case "h2": if (text) ops.push({ op: "heading", text, level: 2 }); break;
      case "h3": if (text) ops.push({ op: "heading", text, level: 3 }); break;
      case "quote": if (text) ops.push({ op: "quote", text }); break;
      case "divider": ops.push({ op: "divider" }); break;
      case "toc":
      case "list":
        for (const it of (b?.items ?? [])) { const t = clean(it); if (t) ops.push({ op: "list", text: t }); }
        break;
      case "checklist":
        for (const it of (b?.items ?? [])) { const t = clean(it); if (t) ops.push({ op: "check", text: t }); }
        break;
      case "table":
        /* 스마트에디터 ONE 에 표를 «데이터로» 넣을 안정적 길이 없다 — 줄로 정직하게 내려앉힌다.
           조용히 빠뜨리지 않고 note 를 남겨 보고에 실린다(축소를 숨기지 않는다). */
        for (const row of (b?.rows ?? [])) {
          const line = (row ?? []).map((c) => clean(c)).filter(Boolean).join(" · ");
          if (line) ops.push({ op: "para", text: line });
        }
        if ((b?.rows ?? []).length) ops.push({ op: "note", text: "표는 줄글로 넣었습니다(에디터 표 미지원)" });
        break;
      case "faq":
        for (const it of (b?.items ?? [])) {
          const t = clean(it);
          if (!t) continue;
          ops.push({ op: "faq", text: t });
        }
        break;
      case "image": {
        const idx = Number.isFinite(Number(b?.imageIndex)) ? Number(b.imageIndex) : imgCursor;
        const img = imgs[idx] ?? imgs[imgCursor];
        if (img?.url) { ops.push({ op: "image", url: img.url, caption: clean(b?.caption ?? img.caption) }); imgCursor = idx + 1; }
        break;
      }
      case "affiliate": {
        const af = b?.affiliate ?? {};
        const name = clean(af.productName) || "상품 보러가기";
        const url = String(af.url ?? "").trim();
        if (url) ops.push({ op: "link", text: name, url });
        break;
      }
      case "adsense":
        /* 애드센스 코드는 스크립트라 네이버·티스토리 에디터 본문에 그대로 넣을 수 없다.
           서버 게이트가 채널별로 이미 정리했다(네이버는 제거) — 러너는 아무것도 하지 않는다. */
        break;
      case "hashtags":
        if (text) ops.push({ op: "tags", text });
        break;
      default:
        if (text) ops.push({ op: "para", text });
    }
  }
  return ops;
}

/* ─────────────── bodyHtml → ops(폴백 경로 · §4B class 계약 되읽기) ─────────────── */

function opsFromHtml(html) {
  const ops = [];
  const src = String(html ?? "");
  // 최상위 요소를 순서대로 훑는다(중첩은 얕다 — §4B 계약이 단순한 모양을 보장한다).
  const re = /<(div|p|h2|h3|blockquote|hr|ul|ol|figure|dl|nav|a|table)\b([^>]*)>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!m[1]) { ops.push({ op: "divider" }); continue; }
    const tag = m[1].toLowerCase();
    const attrs = m[2] ?? "";
    const inner = m[3] ?? "";
    const cls = (/class="([^"]*)"/i.exec(attrs)?.[1] ?? "").split(/\s+/);
    const text = clean(unescapeHtml(inner));
    if (tag === "div" && cls.includes("disclosure")) { if (text) ops.push({ op: "quote", text, role: "disclosure" }); continue; }
    if (tag === "div" && cls.includes("adsense")) continue;
    if (tag === "h2") { if (text) ops.push({ op: "heading", text, level: 2 }); continue; }
    if (tag === "h3") { if (text) ops.push({ op: "heading", text, level: 3 }); continue; }
    if (tag === "blockquote") { if (text) ops.push({ op: "quote", text }); continue; }
    if (tag === "ul" || tag === "ol" || tag === "nav") {
      const isCheck = cls.includes("check");
      for (const li of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
        const t = clean(unescapeHtml(li[1]));
        if (t) ops.push({ op: isCheck ? "check" : "list", text: t });
      }
      continue;
    }
    if (tag === "figure") {
      const url = /<img[^>]*src="([^"]+)"/i.exec(inner)?.[1] ?? "";
      const cap = clean(unescapeHtml(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner)?.[1] ?? ""));
      if (url) ops.push({ op: "image", url, caption: cap });
      continue;
    }
    if (tag === "dl") {
      for (const d of inner.matchAll(/<(dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
        const t = clean(unescapeHtml(d[2]));
        if (t) ops.push({ op: "faq", text: (d[1].toLowerCase() === "dt" ? "Q. " : "A. ") + t });
      }
      continue;
    }
    if (tag === "a" && cls.includes("affiliate")) {
      const url = /href="([^"]+)"/i.exec(attrs)?.[1] ?? "";
      const name = clean(unescapeHtml(/<b[^>]*class="name"[^>]*>([\s\S]*?)<\/b>/i.exec(inner)?.[1] ?? "")) || "상품 보러가기";
      if (url) ops.push({ op: "link", text: name, url });
      continue;
    }
    if (tag === "table") {
      for (const tr of inner.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
        const cells = [...tr[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => clean(unescapeHtml(c[2]))).filter(Boolean);
        if (cells.length) ops.push({ op: "para", text: cells.join(" · ") });
      }
      ops.push({ op: "note", text: "표는 줄글로 넣었습니다(에디터 표 미지원)" });
      continue;
    }
    if (tag === "p") {
      if (cls.includes("tags")) { if (text) ops.push({ op: "tags", text }); continue; }
      if (text) ops.push({ op: "para", text });
      continue;
    }
    if (tag === "div" && text) ops.push({ op: "para", text });
  }
  return ops;
}

/**
 * planEditorOps — payload → { ops, tags, stats }.
 *   · 고지(role:"disclosure")는 **무조건 맨 앞**으로 끌어올린다(§16B.1 본문 첫머리 · 순서가 바뀌면 위반이다).
 *   · 해시태그 줄은 **무조건 맨 뒤**로(글 중간에 태그가 박히면 모양이 망가진다).
 */
export function planEditorOps(payload) {
  const blocks = Array.isArray(payload?.blocks) ? payload.blocks : [];
  const images = Array.isArray(payload?.images) ? payload.images : [];
  let ops = blocks.length ? opsFromBlocks(blocks, images) : opsFromHtml(payload?.bodyHtml);
  if (!ops.length && payload?.bodyHtml) ops = opsFromHtml(payload.bodyHtml);

  const disclosure = ops.filter((o) => o.role === "disclosure");
  const tagOps = ops.filter((o) => o.op === "tags");
  const body = ops.filter((o) => o.role !== "disclosure" && o.op !== "tags");

  // 태그: payload.tags(정본) 우선 · 본문 해시태그 줄은 보조.
  const tags = (Array.isArray(payload?.tags) ? payload.tags : [])
    .map((t) => String(t).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10);
  if (!tags.length && tagOps.length) {
    for (const t of String(tagOps[0].text).split(/\s+/)) {
      const v = t.replace(/^#+/, "").trim();
      if (v && tags.length < 10) tags.push(v);
    }
  }

  const finalOps = [...disclosure, ...body, ...tagOps];
  const stats = {
    total: finalOps.length,
    headings: finalOps.filter((o) => o.op === "heading").length,
    images: finalOps.filter((o) => o.op === "image").length,
    quotes: finalOps.filter((o) => o.op === "quote").length,
    dividers: finalOps.filter((o) => o.op === "divider").length,
    lists: finalOps.filter((o) => o.op === "list" || o.op === "check").length,
    notes: finalOps.filter((o) => o.op === "note").map((o) => o.text),
    fromBlocks: blocks.length > 0,
  };
  return { ops: finalOps, tags, stats };
}

/** 고지가 실제로 첫 op 인가 — 러너도 마지막으로 한 번 본다(서버 게이트의 이중 확인 · §16B.4). */
export function disclosureIsFirst(plan, payload) {
  const need = !!payload?.disclosure;
  if (!need) return true;
  const first = plan.ops[0];
  return !!first && first.role === "disclosure";
}
