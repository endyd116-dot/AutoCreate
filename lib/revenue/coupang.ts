/**
 * lib/revenue/coupang.ts — 쿠팡 파트너스 실적(Open API · HMAC · `reports/commission`). 계약 §1.2 · DESIGN §9.1(일 1회 13:00 KST).
 *   GET /v2/providers/affiliate_open_api/apis/openapi/v1/reports/commission?startDate=YYYYMMDD&endDate=YYYYMMDD
 *   응답 data[] 행에 `date`·`commission`·`subId`(·`orderId` 등) — subId = `piece_{pieceId}`(R1 규약 · lib/affiliate-coupang.subIdFor) 로 piece 직결.
 *   서명·호출은 R1 의 `coupangCall`(같은 서명기 한 벌). 키는 계정별 `revenue_sources.cred_enc` → 없으면 env(COUPANG_PARTNERS_*) 폴백.
 *   ⚠️ 쿠팡은 subId 없는 실적(직접 링크·타 경로)도 준다 — piece 미귀속으로 소스 계정에 남긴다(버리지 않는다).
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { coupangCall, envCoupangKeys, type CoupangKeys } from "../affiliate-coupang";
import { pieceIdFromSubId } from "./upsert";
import { fail, inRange, parseMoney, readCreds, toKstDay } from "./common";
import type { RevenueRow, RevenueSourceRow, SyncResult } from "./types";

const REPORT_PATH = "/v2/providers/affiliate_open_api/apis/openapi/v1/reports/commission";
const ymd = (d: string) => d.replace(/-/g, "");

export async function syncCoupang(_tenantId: number, src: RevenueSourceRow, range: { from: string; to: string }): Promise<SyncResult> {
  let keys: CoupangKeys | null = null;
  if (src.credEnc) {
    const c = readCreds<{ accessKey?: string; secretKey?: string }>(src.credEnc);
    if (!c.ok) return c;
    if (c.creds.accessKey && c.creds.secretKey) keys = { accessKey: String(c.creds.accessKey), secretKey: String(c.creds.secretKey) };
  }
  keys = keys ?? envCoupangKeys();
  if (!keys) return fail("not_configured", false, "쿠팡 파트너스 API 키가 없어요. 키를 넣으면 바로 가져와요.");

  const r = await coupangCall(keys, "GET", REPORT_PATH, { startDate: ymd(range.from), endDate: ymd(range.to) });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) return fail("auth", false, `쿠팡 인증 실패(${r.status}) — 키를 확인해 주세요.`);
    if (r.status === 429) return fail("rate_limit", true, "쿠팡 호출 한도(429).");
    return fail("provider", r.status === 0 || r.status >= 500, `쿠팡 응답 ${r.status}: ${JSON.stringify(r.json ?? "").slice(0, 160)}`);
  }
  // rCode "0" = 성공(쿠팡 규약). 다른 코드는 상대 쪽 신호.
  if (r.json && r.json.rCode !== undefined && String(r.json.rCode) !== "0") return fail("provider", false, `쿠팡 rCode ${r.json.rCode}: ${String(r.json.rMessage ?? "").slice(0, 120)}`);
  const data: any[] = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : [];

  const acc = new Map<string, RevenueRow & { amountRaw: number; n: number }>();
  let bad = 0;
  for (const it of data) {
    const day = toKstDay(it?.date ?? it?.orderDate ?? it?.commissionDate);
    const amt = parseMoney(it?.commission ?? it?.commissionPrice ?? it?.commissionAmount);
    if (!day || amt === null) { bad++; continue; }
    if (!inRange(day, range)) continue;
    const pieceId = pieceIdFromSubId(it?.subId) ?? undefined;
    const accountId = src.accountId ?? undefined;
    const key = `${day}|${accountId ?? 0}|${pieceId ?? 0}`;
    const cur = acc.get(key) ?? { source: "coupang", day, amountKrw: 0, amountRaw: 0, n: 0, currency: "KRW", ...(accountId ? { accountId } : {}), ...(pieceId ? { pieceId } : {}), raw: { subIds: [] as string[] } };
    cur.amountRaw += amt; cur.n++;
    const sid = String(it?.subId ?? ""); if (sid && (cur.raw as any).subIds.length < 5 && !(cur.raw as any).subIds.includes(sid)) (cur.raw as any).subIds.push(sid);
    acc.set(key, cur);
  }
  if (data.length && bad === data.length) return fail("parse", false, "쿠팡 실적 행을 하나도 읽지 못했어요(날짜·commission 형식).");
  const rows: RevenueRow[] = [...acc.values()].map(({ amountRaw, n, ...x }) => ({ ...x, amountKrw: Math.round(amountRaw), raw: { ...(x.raw as object), orders: n } }));
  return { ok: true, rows };
}
