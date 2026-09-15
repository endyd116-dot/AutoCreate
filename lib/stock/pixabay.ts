/**
 * lib/stock/pixabay.ts — **1순위 제공사**(계약 P1R8 §10 · 조사 `docs/active/2026-09-15-image-sourcing-policy.md` §1.4).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음. 공식 문서 https://pixabay.com/api/docs/
 *
 *   ══ 왜 Pixabay 가 1순위인가 ══
 *     다른 곳은 «hotlink 로 쓰라»고 하는데 Pixabay 만 **반대로 요구한다** —
 *     «Permanent hotlinking of images … is **not allowed**. If you intend to use the images, please **download them to your server first**.»
 *     우리는 어차피 R2 에 내려받아 러너가 에디터에 올린다. **제공사 요구와 우리 방식이 정확히 같은 유일한 곳**이다.
 *
 *   ══ 지키는 것(전부 공식 문서 문장) ══
 *     ① 내려받아 우리 서버에 둔다 — `attach.ts` 가 한다.
 *     ② «Requests must be **cached for 24 hours**» — `cache.ts`.
 *     ③ «**100 requests per 60 seconds**» — `cache.ts RATE`(80 으로 낮춰 잡았다).
 *     ④ «**Show your users where the images and videos are from**, whenever search results are displayed» —
 *        후보마다 `sourceUrl`(그 사진의 Pixabay 페이지)을 들고 다닌다. 화면·글 하단 크레딧이 이 값을 쓴다.
 *     ⑤ `safesearch=true` 고정 — 고객 블로그에 나가는 사진이다.
 *
 *   ══ 🔴 안 하는 것 ══
 *     `people`·`brand` 를 **짐작해서 채우지 않는다.** Pixabay 응답에는 그런 필드가 **없다** → 언제나 `null`(모름).
 *     태그로 대신 판정하면 AC-57(대용물)이다. 태그는 `tags` 에 원문 그대로 실어 B3 `peopleHintFromTags` 가 **힌트로만** 쓰게 둔다.
 */
import { STOCK_TIMEOUT_MS, type StockCandidate, type StockProvider, type StockSearchOutcome } from "./types";
import { queryKeyOf, rateAllows, readCache, writeCache } from "./cache";

const API = "https://pixabay.com/api/";
export const PIXABAY_LICENSE_URL = "https://pixabay.com/service/license-summary/";

/** 🔴 키가 없으면 «키 없음»이라고 말한다 — 조용히 0건이 아니다(CLAUDE §8 «키 꽂으면 즉시 가동»). */
function apiKey(): string { return String(process.env.PIXABAY_API_KEY ?? "").trim(); }

/** Pixabay 가 받는 언어 코드(그 외는 보내지 않는다 — 400 방지). 한국어 `ko` 있다. */
const LANGS = new Set(["cs", "da", "de", "en", "es", "fr", "id", "it", "hu", "nl", "no", "pl", "pt", "ro", "sk", "fi", "sv", "tr", "vi", "th", "bg", "ru", "el", "ja", "ko", "zh"]);

interface PixabayHit {
  id?: number; pageURL?: string; tags?: string; previewURL?: string; webformatURL?: string; largeImageURL?: string;
  imageWidth?: number; imageHeight?: number; user?: string;
}
interface PixabayBody { total?: number; totalHits?: number; hits?: PixabayHit[] }

function toCandidate(h: PixabayHit): StockCandidate | null {
  const id = h.id;
  /* 내려받을 주소가 없으면 후보가 아니다 — «보여는 주는데 못 가져오는 사진»을 목록에 넣지 않는다. */
  const dl = String(h.largeImageURL ?? h.webformatURL ?? "").trim();
  if (!id || !dl) return null;
  return {
    provider: "pixabay",
    id: String(id),
    downloadUrl: dl,
    previewUrl: String(h.previewURL ?? h.webformatURL ?? dl),
    width: Math.floor(Number(h.imageWidth ?? 0)) || 0,
    height: Math.floor(Number(h.imageHeight ?? 0)) || 0,
    author: h.user ? String(h.user) : null,
    sourceUrl: h.pageURL ? String(h.pageURL) : null,
    licenseUrl: PIXABAY_LICENSE_URL,
    people: null,   /* 🔴 응답에 없다 — 모르면 모른다고 적는다(AC-57) */
    brand: null,
    tags: String(h.tags ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    alt: null,      /* Pixabay 는 설명문을 주지 않는다 — alt 는 호출부가 태그·장면으로 만든다 */
  };
}

/** Pixabay 사진이 올라와 있는 호스트 — 내려받기는 여기서만(`types.ts hostAllowed` 설명). */
export const PIXABAY_IMAGE_HOSTS = ["pixabay.com", "cdn.pixabay.com"] as const;

export const pixabay: StockProvider = {
  name: "pixabay",
  licenseUrl: PIXABAY_LICENSE_URL,
  imageHosts: PIXABAY_IMAGE_HOSTS,
  configured: () => !!apiKey(),

  async search(a): Promise<StockSearchOutcome> {
    const key = apiKey();
    if (!key) return { provider: "pixabay", ok: false, candidates: [], reason: "no_key", detail: "Pixabay 사진 열쇠가 아직 안 꽂혀 있어요." };

    const lang = a.lang && LANGS.has(a.lang) ? a.lang : "ko";
    const count = Math.min(200, Math.max(3, Math.floor(a.count)));   /* per_page 는 3~200 만 받는다 */
    const query = String(a.query ?? "").trim().slice(0, 100);        /* 공식 문서: q 는 100자까지 */
    if (!query) return { provider: "pixabay", ok: false, candidates: [], reason: "empty", detail: "무엇을 찾을지 알려 주세요." };

    const ck = queryKeyOf({ query, count, lang });
    const hit = await readCache("pixabay", ck);
    if (hit) return { provider: "pixabay", ok: true, cached: true, candidates: parsePixabayBody(hit) };

    const gate = await rateAllows("pixabay");
    if (!gate.ok) return { provider: "pixabay", ok: false, candidates: [], reason: "rate_limited", detail: "사진을 너무 빨리 찾고 있어요. 잠시 뒤에 다시 시도해 주세요." };

    const url = `${API}?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&lang=${lang}`
      + `&image_type=photo&safesearch=true&per_page=${count}&order=popular`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), a.timeoutMs ?? STOCK_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.warn(`[stock:pixabay] HTTP ${resp.status} ${t.slice(0, 160)}`);
        return { provider: "pixabay", ok: false, candidates: [], reason: "http_error", detail: "사진 제공사가 지금 응답하지 않아요." };
      }
      const body = (await resp.json()) as PixabayBody;
      /* 🔴 부른 **직후** 보관한다 — 이 행이 곧 «불렀다»의 기록이라 상한 세기가 여기에 기댄다(빈 결과도 보관한다: 같은 검색어를 또 묻지 않게). */
      await writeCache("pixabay", ck, body);
      const candidates = parsePixabayBody(body);
      return candidates.length ? { provider: "pixabay", ok: true, candidates }
        : { provider: "pixabay", ok: true, candidates: [], reason: "empty", detail: "그 낱말로는 사진을 못 찾았어요." };
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      console.warn(`[stock:pixabay] ${aborted ? "시간 초과" : "호출 실패"}`, String((e as Error)?.message ?? e).slice(0, 120));
      return { provider: "pixabay", ok: false, candidates: [], reason: "network", detail: "사진을 찾는 데 실패했어요." };
    } finally { clearTimeout(timer); }
  },
};

/** 응답 → 후보. 🔴 **내보내는 이유**: 우리 키가 없어 실호출로 못 재는 동안, 하니스가 실제 응답 모양(고정 표본)으로 이 매핑을 확인한다. */
export function parsePixabayBody(body: unknown): StockCandidate[] {
  const hits = (body as PixabayBody)?.hits;
  if (!Array.isArray(hits)) return [];
  return hits.map(toCandidate).filter((c): c is StockCandidate => !!c);
}
