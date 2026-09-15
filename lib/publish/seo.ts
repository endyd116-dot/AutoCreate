/**
 * lib/publish/seo.ts — **머리말을 만질 수 있는 채널에만** 붙이는 것들(계약 P1R8 §3.4-② · 조사 `docs/active/2026-09-15-seo-aeo.md`).
 *   AC 신규 2026-09-15(B2).
 *
 *   ══ 🔴 이 파일이 **하지 않는 것**부터 적는다(그게 이 조사의 결론이다) ══
 *     · **FAQPage JSON-LD — 안 만든다.** 2023-09 «정부·보건 사이트에만»으로 축소 → **2025-05-08 지원 중단**
 *       («이 기능이 Google 검색에 더 이상 표시되지 않습니다»). 우리 `faq` 블록의 **검색 값은 0**이다
 *       (독자에게 주는 값은 별개이고, 그건 블록이 이미 한다).
 *     · **HowTo JSON-LD — 안 만든다.** 2023-08 «더 이상 검색결과에 표시되지 않으므로 문서가 삭제».
 *     · **글자 수를 SEO 근거로 삼지 않는다.** 공식: «콘텐츠 길이 자체는 순위 결정과 관련 없습니다».
 *     🔴 이 셋은 **«아직 안 했다»가 아니라 «하지 않기로 한 것»**이다. 다음 사람이 «빠졌네» 하고 넣지 않도록 여기 적는다.
 *
 *   ══ 그리고 **어디에** 붙일 수 있나가 절반이다 ══
 *     네이버·티스토리는 **러너가 에디터로 쓴다** — 머리말(`<head>`)을 만질 자리가 **아예 없다**.
 *     그래서 JSON-LD 를 «모든 글에 있어야 하는 것»으로 만들면 그 두 채널은 **영원히 미달**이 된다.
 *     🔴 그러므로 이것들은 **선택**이다. 있으면 좋고, 없는 채널은 없는 게 맞는 상태다(게이트로 만들지 않는다 · CLAUDE §9).
 */
import type { PublishPiece } from "./contract";

/* ─────────────────────────── 메타 설명(excerpt) ─────────────────────────── */

/**
 * 스니펫용 한 문단.
 *   🔴 **«155자» 같은 상한은 구글이 낸 적이 없다**(업계 통설이다 · 공식은 «길이 제한은 없지만 필요에 따라 잘려서 표시»).
 *      그래서 «검색에 맞춘 길이»가 아니라 **«사람이 한눈에 읽는 길이»**로 자른다 — 근거가 그것뿐이라 그렇게 적는다.
 *   재료 순서: ①글이 만든 `summary` 블록 ②첫 문단 ③제목. 앞엣것이 없으면 뒤로 내려간다.
 *   🔴 **고지 문장은 쓰지 않는다** — 첫 블록이 고지일 때 그걸 메타 설명으로 올리면 검색 결과에 «이 글은 광고를…»만 뜬다.
 */
export function excerptOf(piece: PublishPiece, max = 200): string {
  const blocks = Array.isArray(piece.blocks) ? piece.blocks : [];
  const textOf = (b: unknown): string => {
    const o = (b ?? {}) as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (Array.isArray(o.items)) return (o.items as unknown[]).map((i) => (typeof i === "string" ? i : String((i as Record<string, unknown>)?.text ?? ""))).join(" ");
    return "";
  };
  const type = (b: unknown) => String(((b ?? {}) as Record<string, unknown>).type ?? "");
  const pick = blocks.find((b) => type(b) === "summary") ?? blocks.find((b) => type(b) === "para" || type(b) === "hook");
  let s = clean(textOf(pick));
  if (!s) s = clean(String(piece.bodyHtml || "").replace(/<[^>]+>/g, " "));
  if (!s) s = clean(piece.title);
  /* 고지가 앞에 섞여 들어왔으면 떼어 낸다(본문 첫 블록이 고지인 채널이 있다). */
  if (piece.disclosure) s = clean(s.replace(String(piece.disclosure), ""));
  return cut(s, max);
}

const clean = (s: string) => String(s ?? "").replace(/\s+/g, " ").trim();
/** 낱말 중간에서 끊지 않는다(끊으면 «…설명입니 » 같은 꼴이 스니펫에 뜬다). */
function cut(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  const at = Math.max(head.lastIndexOf(" "), head.lastIndexOf("."), head.lastIndexOf("다"));
  return (at > max * 0.6 ? head.slice(0, at + 1) : head).trim();
}

/* ─────────────────────────── 주소(slug) ─────────────────────────── */

/* 국어의 로마자 표기법(문화체육관광부 고시) — 음절을 초·중·종성으로 쪼개 표에서 읽는다.
   🔴 자음동화(«신라→Silla» 같은 것)는 **넣지 않았다.** 그건 앞뒤 음절을 같이 봐야 하는 규칙이고,
      주소에 쓰는 글자라 **읽히기만 하면 된다**. 없는 정확도를 있는 척하지 않는다. */
const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const JUNG = ["a", "ae", "ya", "yae", "eo", "e", "yeo", "ye", "o", "wa", "wae", "oe", "yo", "u", "wo", "we", "wi", "yu", "eu", "ui", "i"];
const JONG = ["", "k", "k", "ks", "n", "nj", "nh", "t", "l", "lk", "lm", "lp", "ls", "lt", "lp", "lh", "m", "p", "ps", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];

/** 한글 → 로마자. 한글이 아닌 글자는 그대로 둔다. */
export function romanizeKo(input: string): string {
  let out = "";
  for (const ch of String(input ?? "")) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0xac00 && c <= 0xd7a3) {
      const i = c - 0xac00;
      out += CHO[Math.floor(i / 588)] + JUNG[Math.floor((i % 588) / 28)] + JONG[i % 28];
    } else out += ch;
  }
  return out;
}

/**
 * 글 주소의 뒷글자.
 *   🔴 **«주소에 키워드가 있으면 순위가 오른다»는 근거로 만들지 않는다** — 공식이 그걸 부정한다
 *      («순위 측면에서 도메인 이름의 키워드는 탐색경로에 표시되는 것 외에는 거의 영향을 미치지 않습니다»).
 *      만드는 이유는 **읽히고 공유되기 위해서**다: 우리가 안 주면 워드프레스가 한글 제목을 그대로 주소로 쓰고,
 *      그러면 `%EA%B0%80%EC%9D%84…` 같은 **사람이 못 읽는 주소**가 카톡·메일에 실려 나간다.
 *   빈 문자열이면 **보내지 않는다** — 그때는 워드프레스 기본값이 맞다(억지로 `post-123` 을 만들지 않는다).
 */
export function slugOf(piece: PublishPiece, max = 60): string {
  const s = romanizeKo(String(piece.title ?? ""))
    .toLowerCase()
    .replace(/['’"`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!s) return "";
  const cutAt = s.lastIndexOf("-", max);
  return (s.length <= max ? s : s.slice(0, cutAt > max * 0.5 ? cutAt : max)).replace(/^-+|-+$/g, "");
}

/* ─────────────────────────── Article JSON-LD ─────────────────────────── */

export interface ArticleLdOpts {
  /** 글쓴이로 보일 이름(계정 표시 이름 또는 핸들). 없으면 author 를 **안 넣는다**(빈 이름을 넣지 않는다). */
  authorName?: string;
  /** 발행 시각 ISO. 없으면 지금. */
  publishedAt?: string;
}

/**
 * Article 구조화 데이터 한 덩이 — 🔴 **살아 있는 유형만** 쓴다(Article · 위 머리말 참조).
 *   `headline` 은 화면에 보이는 제목과 **같아야 한다**(다르면 구글이 «불일치»로 무시한다).
 *   `image` 는 절대 주소만(상대 주소는 값이 없다) · 없으면 칸을 **안 만든다**(빈 배열을 넣지 않는다 · AC-9).
 */
export function articleJsonLd(piece: PublishPiece, opts: ArticleLdOpts = {}): Record<string, unknown> {
  const images = (piece.images ?? []).map((i) => String(i.url || "").trim()).filter((u) => /^https?:\/\//.test(u)).slice(0, 5);
  const when = opts.publishedAt || new Date().toISOString();
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: cut(clean(piece.title), 110),
    datePublished: when,
    dateModified: when,
  };
  const desc = excerptOf(piece);
  if (desc) ld.description = desc;
  if (images.length) ld.image = images;
  if (opts.authorName) ld.author = { "@type": "Person", name: String(opts.authorName).replace(/^@/, "").slice(0, 60) };
  return ld;
}

/** 본문 끝에 붙일 `<script type="application/ld+json">` 한 줄. */
export function articleJsonLdScript(piece: PublishPiece, opts: ArticleLdOpts = {}): string {
  /* `</script>` 가 본문 문자열에 섞여 스크립트를 조기 종료시키지 않게 막는다(JSON 안에서만 이스케이프해도 안전하다). */
  const json = JSON.stringify(articleJsonLd(piece, opts)).replace(/<\//g, "<\\/");
  return `\n<script type="application/ld+json">${json}</script>`;
}

/**
 * 🔴 **붙였다고 붙은 게 아니다** — 워드프레스는 `unfiltered_html` 권한이 없는 사용자의 `<script>` 를 **조용히 지운다**(KSES).
 *   그래서 발행 응답의 `content.rendered` 를 되읽어 **살아남았는지 확인**한다.
 *   «넣었다»는 증거가 아니다(AC-63) — 이건 그 교훈을 SEO 자리에 적용한 것이다.
 */
export function jsonLdSurvived(renderedHtml: unknown): boolean {
  return /application\/ld\+json/i.test(String(renderedHtml ?? ""));
}
