/**
 * lib/stock/pexels.ts — **2순위 제공사**(계약 P1R8 §10 · 조사 `docs/active/2026-09-15-image-sourcing-policy.md` §1.4).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음. 공식 문서 https://www.pexels.com/api/documentation/
 *
 *   ══ 왜 2순위인가 ══
 *     라이선스는 Pixabay 만큼 넉넉한데(«All photos and videos on Pexels are **free to use**»), **크레딧 의무가 더 무겁다** —
 *     «show a **prominent link to Pexels**» + «Always **credit our photographers** when possible».
 *     글 하단에 줄이 하나 더 붙는다는 뜻이라, 같은 값이면 Pixabay 를 먼저 쓴다. 🔴 값이 없으면(1순위가 0건) 여기가 답이다.
 *
 *   ══ 지키는 것(전부 공식 문서 문장) ══
 *     ① «200 per hour · 20,000 per month» — `cache.ts RATE`(160/시간으로 낮춰 잡았다).
 *     ② 크레딧 — `author`(photographer) + `sourceUrl`(그 사진의 Pexels 페이지)을 반드시 들고 다닌다.
 *        `lib/photo-source.ts creditLineOf()` 가 이 둘로 «작가 · Pexels (주소)» 한 줄을 만든다.
 *     ③ 내려받아 우리 서버에 둔다 — Pexels 는 hotlink 를 막지 않지만, **네이버·티스토리 에디터가 어차피 자기 저장소로 가져간다**.
 *        경로를 제공사마다 다르게 두면 «이 사진 어디 있나»가 두 갈래가 된다.
 *
 *   ══ 🔴 안 하는 것 ══
 *     `people`·`brand` 를 짐작해서 채우지 않는다 — Pexels 응답에도 그런 필드가 **없다** → 언제나 `null`(모름 · AC-57).
 *     🔴 이게 라이선스상 제일 아픈 자리다: Pexels 는 «Don't **imply endorsement** … by people or brands» 를 요구하는데
 *     **그 판정에 필요한 값을 제공사가 주지 않는다.** 그래서 우리는 태그 힌트로 **순위를 낮출** 뿐 «없다»고 단정하지 않는다.
 */
import { STOCK_TIMEOUT_MS, type StockCandidate, type StockProvider, type StockSearchOutcome } from "./types";
import { queryKeyOf, rateAllows, readCache, writeCache } from "./cache";

const API = "https://api.pexels.com/v1/search";
export const PEXELS_LICENSE_URL = "https://www.pexels.com/license/";

function apiKey(): string { return String(process.env.PEXELS_API_KEY ?? "").trim(); }

interface PexelsPhoto {
  id?: number; width?: number; height?: number; url?: string; alt?: string;
  photographer?: string; photographer_url?: string;
  src?: { original?: string; large2x?: string; large?: string; medium?: string; small?: string; tiny?: string };
}
interface PexelsBody { total_results?: number; photos?: PexelsPhoto[] }

function toCandidate(p: PexelsPhoto): StockCandidate | null {
  const id = p.id;
  /* 큰 판부터 고른다 — 블로그 본문에 실릴 크기다. 원본(original)은 수 MB 라 받지 않는다(상한 4MB · `photo-source.ts`). */
  const dl = String(p.src?.large2x ?? p.src?.large ?? p.src?.medium ?? "").trim();
  if (!id || !dl) return null;
  return {
    provider: "pexels",
    id: String(id),
    downloadUrl: dl,
    previewUrl: String(p.src?.medium ?? p.src?.small ?? p.src?.tiny ?? dl),
    width: Math.floor(Number(p.width ?? 0)) || 0,
    height: Math.floor(Number(p.height ?? 0)) || 0,
    author: p.photographer ? String(p.photographer) : null,
    sourceUrl: p.url ? String(p.url) : null,
    licenseUrl: PEXELS_LICENSE_URL,
    people: null,   /* 🔴 응답에 없다(AC-57) */
    brand: null,
    /* Pexels 는 태그 배열을 주지 않는다 — 설명문(`alt`)을 낱말로 쪼개 힌트 재료로 쓴다.
       🔴 이건 **힌트일 뿐**이다: B3 `peopleHintFromTags` 는 한 방향(«있다»만 올린다)이라 이 재료로 «없다»가 나오지 않는다. */
    tags: String(p.alt ?? "").split(/[\s,]+/).map((t) => t.trim()).filter(Boolean).slice(0, 20),
    alt: p.alt ? String(p.alt) : null,
  };
}

/** Pexels 사진이 올라와 있는 호스트 — 내려받기는 여기서만. */
export const PEXELS_IMAGE_HOSTS = ["images.pexels.com", "pexels.com"] as const;

export const pexels: StockProvider = {
  name: "pexels",
  licenseUrl: PEXELS_LICENSE_URL,
  imageHosts: PEXELS_IMAGE_HOSTS,
  configured: () => !!apiKey(),

  async search(a): Promise<StockSearchOutcome> {
    const key = apiKey();
    if (!key) return { provider: "pexels", ok: false, candidates: [], reason: "no_key", detail: "Pexels 사진 열쇠가 아직 안 꽂혀 있어요." };

    const count = Math.min(80, Math.max(1, Math.floor(a.count)));   /* per_page 는 80 까지 */
    const query = String(a.query ?? "").trim().slice(0, 100);
    if (!query) return { provider: "pexels", ok: false, candidates: [], reason: "empty", detail: "무엇을 찾을지 알려 주세요." };
    /* Pexels 의 지역 값은 `ko-KR` 꼴이다(`ko` 가 아니다 — 400 이 아니라 **조용히 무시**되므로 여기서 맞춰 준다). */
    const locale = a.lang === "ko" || !a.lang ? "ko-KR" : a.lang.includes("-") ? a.lang : `${a.lang}-${a.lang.toUpperCase()}`;

    const ck = queryKeyOf({ query, count, lang: locale });
    const hit = await readCache("pexels", ck);
    if (hit) return { provider: "pexels", ok: true, cached: true, candidates: parsePexelsBody(hit) };

    const gate = await rateAllows("pexels");
    if (!gate.ok) return { provider: "pexels", ok: false, candidates: [], reason: "rate_limited", detail: "사진을 너무 빨리 찾고 있어요. 잠시 뒤에 다시 시도해 주세요." };

    const url = `${API}?query=${encodeURIComponent(query)}&per_page=${count}&locale=${encodeURIComponent(locale)}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), a.timeoutMs ?? STOCK_TIMEOUT_MS);
    try {
      /* 🔴 Pexels 는 `Authorization` 에 **Bearer 없이 키만** 넣는다(공식 문서 예시 그대로). */
      const resp = await fetch(url, { signal: ctrl.signal, headers: { Authorization: key, Accept: "application/json" } });
      if (!resp.ok) {
        const t = await resp.text().catch(() => "");
        console.warn(`[stock:pexels] HTTP ${resp.status} ${t.slice(0, 160)}`);
        return { provider: "pexels", ok: false, candidates: [], reason: "http_error", detail: "사진 제공사가 지금 응답하지 않아요." };
      }
      const body = (await resp.json()) as PexelsBody;
      await writeCache("pexels", ck, body);
      const candidates = parsePexelsBody(body);
      return candidates.length ? { provider: "pexels", ok: true, candidates }
        : { provider: "pexels", ok: true, candidates: [], reason: "empty", detail: "그 낱말로는 사진을 못 찾았어요." };
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      console.warn(`[stock:pexels] ${aborted ? "시간 초과" : "호출 실패"}`, String((e as Error)?.message ?? e).slice(0, 120));
      return { provider: "pexels", ok: false, candidates: [], reason: "network", detail: "사진을 찾는 데 실패했어요." };
    } finally { clearTimeout(timer); }
  },
};

/** 응답 → 후보. 🔴 **내보내는 이유**: `pixabay.ts` 와 같다 — 실호출 전까지 고정 표본으로 매핑을 확인한다. */
export function parsePexelsBody(body: unknown): StockCandidate[] {
  const photos = (body as PexelsBody)?.photos;
  if (!Array.isArray(photos)) return [];
  return photos.map(toCandidate).filter((c): c is StockCandidate => !!c);
}
