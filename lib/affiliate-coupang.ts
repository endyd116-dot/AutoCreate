/**
 * lib/affiliate-coupang.ts — 쿠팡 파트너스 Open API(상품 검색 · 딥링크 · subId=piece). AC 신규(2026-09-14 · 공식 문서 규격).
 *   인증: Authorization: CEA algorithm=HmacSHA256, access-key=…, signed-date=yyMMdd'T'HHmmss'Z'(UTC), signature=hex(HMAC-SHA256(secret, signedDate+method+path+query))
 *   검색  GET  /v2/providers/affiliate_open_api/apis/openapi/v1/products/search?keyword=&limit=&subId=
 *   딥링크 POST /v2/providers/affiliate_open_api/apis/openapi/v1/deeplink  { coupangUrls:[…], subId }
 *   키 = 계정별(account_creds kind "coupang" · 복호화는 director 안에서만 · 응답 평문 0) · 없으면 env COUPANG_PARTNERS_* 자사 기본값 · 그것도 없으면 not_configured.
 *   🔴 §16B.3: 상품 이미지·가격은 **API 응답값만**(affiliate.imageUrl·price) · 링크는 API 로 생성(subId 포함).
 *   graceful: throw 금지.
 */
import crypto from "node:crypto";

const DOMAIN = "https://api-gateway.coupang.com";
const SEARCH_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/products/search";
const DEEPLINK_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink";

export interface CoupangKeys { accessKey: string; secretKey: string }
export interface CoupangProduct { productId: string; productName: string; productPrice: number; productImage: string; productUrl: string; isRocket: boolean; categoryName?: string }

export function envCoupangKeys(): CoupangKeys | null {
  const a = String(process.env.COUPANG_PARTNERS_ACCESS_KEY ?? "").trim(), s = String(process.env.COUPANG_PARTNERS_SECRET_KEY ?? "").trim();
  return a && s ? { accessKey: a, secretKey: s } : null;
}

function signedDate(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(now.getUTCFullYear()).slice(2)}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}T${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}Z`;
}
function authHeader(keys: CoupangKeys, method: string, path: string, query: string): string {
  const dt = signedDate();
  const sig = crypto.createHmac("sha256", keys.secretKey).update(dt + method + path + query, "utf8").digest("hex");
  return `CEA algorithm=HmacSHA256, access-key=${keys.accessKey}, signed-date=${dt}, signature=${sig}`;
}

/** 서명 호출(HMAC) — 상품 검색·딥링크(여기)와 수익 리포트(lib/revenue/coupang.ts)가 같은 서명기를 쓴다 — 한 벌(P1R3 에서 export). */
export async function coupangCall(keys: CoupangKeys, method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown): Promise<{ ok: boolean; status: number; json: any }> {
  const qs = new URLSearchParams(query).toString();
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetch(`${DOMAIN}${path}${qs ? `?${qs}` : ""}`, {
      method, signal: ctrl.signal,
      headers: { Authorization: authHeader(keys, method, path, qs), "Content-Type": "application/json;charset=UTF-8" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json: any = null; try { json = await r.json(); } catch { /* */ }
    return { ok: r.ok, status: r.status, json };
  } catch (e) { return { ok: false, status: 0, json: { error: String((e as Error)?.message ?? e).slice(0, 120) } }; }
  finally { clearTimeout(t); }
}

/** 상품 검색(≤limit). 실패 []. */
export async function searchProducts(keys: CoupangKeys, keyword: string, limit = 5, subId?: string): Promise<CoupangProduct[]> {
  const kw = String(keyword || "").trim(); if (!kw) return [];
  const q: Record<string, string> = { keyword: kw, limit: String(Math.max(1, Math.min(10, limit))) };
  if (subId) q.subId = subId;
  const r = await coupangCall(keys, "GET", SEARCH_PATH, q);
  if (!r.ok || String(r.json?.rCode) !== "0") { console.warn(`[coupang] search ${r.status} ${JSON.stringify(r.json ?? "").slice(0, 160)}`); return []; }
  const list = (r.json?.data?.productData ?? []) as Record<string, unknown>[];
  return list.map((p) => ({
    productId: String(p.productId ?? ""), productName: String(p.productName ?? ""), productPrice: Number(p.productPrice ?? 0),
    productImage: String(p.productImage ?? ""), productUrl: String(p.productUrl ?? ""), isRocket: !!p.isRocket, categoryName: p.categoryName ? String(p.categoryName) : undefined,
  })).filter((p) => p.productId && p.productUrl);
}

/** 딥링크(subId 포함 단축 URL). 실패 null. */
export async function deeplink(keys: CoupangKeys, url: string, subId: string): Promise<string | null> {
  const r = await coupangCall(keys, "POST", DEEPLINK_PATH, {}, { coupangUrls: [url], subId });
  if (!r.ok || String(r.json?.rCode) !== "0") { console.warn(`[coupang] deeplink ${r.status} ${JSON.stringify(r.json ?? "").slice(0, 160)}`); return null; }
  const d = (r.json?.data ?? [])[0];
  return d?.shortenUrl ? String(d.shortenUrl) : null;
}

/** subId 규격: 영숫자·언더스코어 ≤ 50 — `piece_123`. */
export function subIdFor(pieceId: number): string { return `piece_${pieceId}`; }
