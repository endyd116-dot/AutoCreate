/**
 * lib/naver-volume.ts — 네이버 검색광고 키워드툴(월 검색량·경쟁도). AM 원본: ../AutoMarketing/lib/ads-naver.ts (signedHeaders·getKeywordIdeas·parseVol 발췌 2026-09-14)
 *   서명: X-Signature = Base64(HMAC-SHA256(SECRET, `${ts}.${method}.${path}`)) + X-Timestamp·X-API-KEY·X-Customer.
 *   GET /keywordstool?hintKeywords=a,b,c&showDetail=1 (힌트 ≤5 · 공백 포함 시 400 → 공백 제거).
 *   env: NAVER_SEARCHAD_ACCESS_LICENSE · NAVER_SEARCHAD_SECRET_KEY · NAVER_SEARCHAD_CUSTOMER_ID.
 *   🔴 환각 0: 수치는 이 응답값만. 키 없음·실패 → 빈 배열(graceful · 호출부는 volume 키를 생략한다).
 */
import crypto from "node:crypto";

const BASE = "https://api.searchad.naver.com";

export interface KeywordVolume { keyword: string; pcVolume: number; mobileVolume: number; compIdx: string }

function cfg(): { license: string; secret: string; customer: string } | null {
  const license = String(process.env.NAVER_SEARCHAD_ACCESS_LICENSE ?? "").trim();
  const secret = String(process.env.NAVER_SEARCHAD_SECRET_KEY ?? "").trim();
  const customer = String(process.env.NAVER_SEARCHAD_CUSTOMER_ID ?? "").trim();
  return license && secret && customer ? { license, secret, customer } : null;
}
export function naverVolumeConfigured(): boolean { return !!cfg(); }

function signedHeaders(method: string, path: string, c: NonNullable<ReturnType<typeof cfg>>): Record<string, string> {
  const ts = Date.now().toString();
  const sig = crypto.createHmac("sha256", c.secret).update(`${ts}.${method}.${path}`, "utf8").digest("base64");
  return { "Content-Type": "application/json; charset=UTF-8", "X-Timestamp": ts, "X-API-KEY": c.license, "X-Customer": c.customer, "X-Signature": sig };
}

/** "< 10" 같은 문자열·숫자 모두 정수로. */
function parseVol(v: unknown): number {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  if (!s) return 0;
  if (s.includes("<")) return 5;
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

export const normKw = (s: string) => String(s || "").replace(/\s+/g, "").normalize("NFC").toLowerCase();

/** 키워드툴 1콜(힌트 ≤5). 실패·미설정 → []. */
async function keywordToolOnce(hints: string[]): Promise<KeywordVolume[]> {
  const c = cfg(); if (!c) return [];
  const seeds = [...new Set(hints.map((h) => String(h).replace(/\s+/g, "")).filter(Boolean))].slice(0, 5);
  if (!seeds.length) return [];
  const path = "/keywordstool";
  const qs = new URLSearchParams({ hintKeywords: seeds.join(","), showDetail: "1" }).toString();
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const r = await fetch(`${BASE}${path}?${qs}`, { method: "GET", headers: signedHeaders("GET", path, c), signal: ctrl.signal });
    if (!r.ok) { console.warn(`[naver-volume] keywordstool ${r.status} ${(await r.text().catch(() => "")).slice(0, 120)}`); return []; }
    const j = (await r.json()) as { keywordList?: Record<string, unknown>[] };
    if (!Array.isArray(j.keywordList)) return [];
    return j.keywordList.map((k) => ({ keyword: String(k.relKeyword ?? ""), pcVolume: parseVol(k.monthlyPcQcCnt), mobileVolume: parseVol(k.monthlyMobileQcCnt), compIdx: String(k.compIdx ?? "") })).filter((k) => k.keyword);
  } catch (e) { console.warn("[naver-volume] keywordstool 실패", String((e as Error)?.message ?? e).slice(0, 100)); return []; }
  finally { clearTimeout(t); }
}

/**
 * lookupVolumes — 키워드들의 월 검색량(정확 매칭 · 공백 제거 기준). 5개씩 묶어 조회 · 연관어도 함께 돌려준다.
 *   반환 Map<normKw, KeywordVolume>. 없으면 빈 Map(호출부가 «미상» 처리 — 0 으로 저장하지 않는다).
 */
export async function lookupVolumes(keywords: string[]): Promise<Map<string, KeywordVolume>> {
  const out = new Map<string, KeywordVolume>();
  if (!naverVolumeConfigured()) return out;
  const uniq = [...new Set(keywords.map(normKw).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 5) {
    const list = await keywordToolOnce(uniq.slice(i, i + 5));
    for (const k of list) { const key = normKw(k.keyword); if (!out.has(key)) out.set(key, k); }
    if (i + 5 < uniq.length) await new Promise((r) => setTimeout(r, 250));   // 레이트리밋 완충
  }
  return out;
}
