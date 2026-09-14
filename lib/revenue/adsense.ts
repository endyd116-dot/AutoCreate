/**
 * lib/revenue/adsense.ts — 구글 애드센스(AdSense Management API v2 · `adsense.readonly`). 계약 §1.2 · DESIGN §9.1.
 *   accounts.list → accounts/{id}/reports:generate(dateRange CUSTOM · dimensions DATE·DOMAIN_NAME·PAGE_URL · metric ESTIMATED_EARNINGS · currencyCode KRW).
 *   귀속: PAGE_URL → `posts.external_url`(정규화 비교) → piece · DOMAIN_NAME → `config.domainToAccount`(사용자가 사이트↔계정을 이어 둔 표) → account.
 *   🔴 원문 일부는 raw 에(진단) · 토큰은 절대 안 넣는다. 파싱이 어긋나면 rows 를 0 으로 채우지 않고 `parse` 로 돌려준다(AC-9).
 *   자격: `revenue_sources.cred_enc` = OAuthToken(JSON · AES-256-GCM). 만료 임박은 ensureFresh 가 갱신 → `credPatch` 로 돌려주면 호출부가 저장.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import type { OAuthToken } from "../oauth-providers";
import { classifyHttp, fail, httpJson, inRange, parseMoney, readCreds, toKstDay } from "./common";
import { ensureFresh } from "./google-oauth";
import type { RevenueRow, RevenueSourceRow, SyncResult } from "./types";

export type SyncResultWithCred = SyncResult & { credPatch?: OAuthToken };
const API = "https://adsense.googleapis.com/v2";

/** 사이트 URL 정규화 — 스킴·www·꼬리 슬래시·쿼리 제거(퍼블리셔 URL 과 posts.external_url 이 같은 글을 가리켜도 글자가 다르다). */
export function normUrl(u: unknown): string {
  return String(u ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}

export async function syncAdsense(tenantId: number, src: RevenueSourceRow, range: { from: string; to: string }): Promise<SyncResultWithCred> {
  const c = readCreds<OAuthToken>(src.credEnc);
  if (!c.ok) return c;
  const fr = await ensureFresh(c.creds);
  if (!fr.ok) return fail("auth", false, `구글 토큰 갱신 실패(${fr.reason}) — 다시 연결해 주세요.`);
  const token = fr.token;
  const H = { Authorization: `Bearer ${token.accessToken}` };

  // 1) 애드센스 계정 id(pub-…) — config 에 있으면 그것, 없으면 첫 계정.
  let account = String(src.config?.adsenseAccount ?? "");
  if (!account) {
    const a = await httpJson(`${API}/accounts`, { headers: H });
    if (!a.ok) return { ...classifyHttp(a, "애드센스 계정 조회"), ...(fr.changed ? { credPatch: token } : {}) };
    account = String(a.json?.accounts?.[0]?.name ?? "");
    if (!account) return fail("not_configured", false, "이 구글 계정에 애드센스 계정이 없어요. 애드센스 가입 후 다시 연결해 주세요.");
  }

  // 2) 리포트
  const [fy, fm, fd] = range.from.split("-").map(Number), [ty, tm, td] = range.to.split("-").map(Number);
  const p = new URLSearchParams({ dateRange: "CUSTOM", "startDate.year": String(fy), "startDate.month": String(fm), "startDate.day": String(fd), "endDate.year": String(ty), "endDate.month": String(tm), "endDate.day": String(td), currencyCode: "KRW", reportingTimeZone: "ACCOUNT_TIME_ZONE" });
  for (const d of ["DATE", "DOMAIN_NAME", "PAGE_URL"]) p.append("dimensions", d);
  p.append("metrics", "ESTIMATED_EARNINGS");
  const r = await httpJson(`${API}/${account}/reports:generate?${p}`, { headers: H }, 25_000);
  if (!r.ok) return { ...classifyHttp(r, "애드센스 리포트"), ...(fr.changed ? { credPatch: token } : {}) };

  const headers: string[] = Array.isArray(r.json?.headers) ? r.json.headers.map((h: any) => String(h?.name ?? "")) : [];
  const iDate = headers.indexOf("DATE"), iDom = headers.indexOf("DOMAIN_NAME"), iUrl = headers.indexOf("PAGE_URL"), iAmt = headers.indexOf("ESTIMATED_EARNINGS");
  if (iDate < 0 || iAmt < 0) return fail("parse", false, `애드센스 응답 모양이 달라요(headers=${headers.join(",")})`);
  const rowsIn: any[] = Array.isArray(r.json?.rows) ? r.json.rows : [];

  // 귀속 재료 — 이 테넌트의 발행 URL → piece/account.
  const posts = await q(sql`SELECT piece_id, account_id, external_url FROM posts WHERE tenant_id = ${tenantId} AND external_url IS NOT NULL ORDER BY id DESC LIMIT 2000`);
  const byUrl = new Map(posts.map((x) => [normUrl(x.external_url), { pieceId: Number(x.piece_id), accountId: x.account_id ? Number(x.account_id) : undefined }]));
  const domainToAccount = (src.config?.domainToAccount && typeof src.config.domainToAccount === "object" ? src.config.domainToAccount : {}) as Record<string, unknown>;

  // 같은 (day, account, piece) 로 합산(PAGE_URL 여러 개가 한 piece 에 모일 수 있다).
  const acc = new Map<string, RevenueRow & { amountRaw: number }>();
  let bad = 0;
  for (const row of rowsIn) {
    const cells: any[] = Array.isArray(row?.cells) ? row.cells : [];
    const day = toKstDay(cells[iDate]?.value); const amt = parseMoney(cells[iAmt]?.value);
    if (!day || amt === null) { bad++; continue; }
    if (!inRange(day, range)) continue;
    const url = iUrl >= 0 ? normUrl(cells[iUrl]?.value) : ""; const dom = iDom >= 0 ? normUrl(cells[iDom]?.value) : "";
    const hit = url ? byUrl.get(url) : undefined;
    const accountId = hit?.accountId ?? (dom && Number.isFinite(Number(domainToAccount[dom])) ? Number(domainToAccount[dom]) : src.accountId ?? undefined);
    const pieceId = hit?.pieceId;
    const key = `${day}|${accountId ?? 0}|${pieceId ?? 0}`;
    const cur = acc.get(key) ?? { source: "adsense", day, amountKrw: 0, amountRaw: 0, currency: "KRW", ...(accountId ? { accountId } : {}), ...(pieceId ? { pieceId } : {}), raw: { account, domains: [] as string[] } };
    cur.amountRaw += amt;
    if (dom && Array.isArray((cur.raw as any).domains) && (cur.raw as any).domains.length < 5 && !(cur.raw as any).domains.includes(dom)) (cur.raw as any).domains.push(dom);
    acc.set(key, cur);
  }
  if (rowsIn.length && bad === rowsIn.length) return fail("parse", false, "애드센스 행을 하나도 읽지 못했어요(날짜·금액 형식).");
  const rows: RevenueRow[] = [...acc.values()].map(({ amountRaw, ...r }) => ({ ...r, amountKrw: Math.round(amountRaw) }));
  return { ok: true, rows, ...(fr.changed ? { credPatch: token } : {}) };
}
