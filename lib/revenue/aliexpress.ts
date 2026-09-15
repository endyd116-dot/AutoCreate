/**
 * lib/revenue/aliexpress.ts — 알리익스프레스 어필리에이트(Affiliate API · `aliexpress.affiliate.order.list`). 계약 §1.2.
 *   게이트웨이 https://api-sg.aliexpress.com/sync · 서명 = HMAC-SHA256(app_secret, 정렬된 파라미터 연결) 대문자 HEX(sign_method sha256).
 *   자격: `cred_enc` = { appKey, appSecret, trackingId? }. 주문 목록(start_time~end_time · status Payment Completed 등)을
 *   일별로 합산 · `tracking_id`/`sub_id`(=piece_{id}) 로 piece 귀속. 커미션은 **USD** → `fxToKrw`(config.fxRate → env FX_USD_KRW).
 *   🔴 환율이 없으면 «대충» 환산하지 않고 not_configured(«환율을 넣어 주세요»)로 정직 반환한다 — 그 숫자가 «오늘 번 돈»이 된다.
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { createHmac } from "node:crypto";
import { pieceIdFromSubId } from "./upsert";
import { classifyHttp, fail, fxToKrw, httpJson, inRange, parseMoney, readCreds, toKstDay } from "./common";
import type { RevenueRow, RevenueSourceRow, SyncResult } from "./types";

const GATEWAY = "https://api-sg.aliexpress.com/sync";

function signTop(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params).sort().map((k) => k + params[k]).join("");
  return createHmac("sha256", secret).update(base, "utf8").digest("hex").toUpperCase();
}

export async function syncAliexpress(_tenantId: number, src: RevenueSourceRow, range: { from: string; to: string }): Promise<SyncResult> {
  const c = readCreds<{ appKey?: string; appSecret?: string; trackingId?: string }>(src.credEnc);
  if (!c.ok) return c;
  const { appKey, appSecret, trackingId } = c.creds;
  if (!appKey || !appSecret) return fail("not_configured", false, "알리 앱 키가 없어요. 키를 넣으면 바로 가져와요.");
  const fxProbe = fxToKrw(1, "USD", src.config);
  if (!fxProbe) return fail("not_configured", false, "USD→KRW 환율이 없어요(소스 설정 fxRate 또는 서버 FX_USD_KRW). 환율을 넣으면 바로 가져와요.");

  const params: Record<string, string> = {
    app_key: String(appKey), method: "aliexpress.affiliate.order.list", sign_method: "sha256", timestamp: String(Date.now()), v: "2.0", format: "json",
    start_time: `${range.from} 00:00:00`, end_time: `${range.to} 23:59:59`, status: "Payment Completed", page_size: "50", page_no: "1",
    fields: "order_id,paid_time,estimated_paid_commission,commission_rate,sub_id,tracking_id,order_status",
    ...(trackingId ? { tracking_id: String(trackingId) } : {}),
  };
  params.sign = signTop(params, String(appSecret));
  const r = await httpJson(`${GATEWAY}?${new URLSearchParams(params)}`, { method: "POST" }, 25_000);
  if (!r.ok) return classifyHttp(r, "알리 어필리에이트");
  if (r.json?.error_response) {
    const code = String(r.json.error_response.code ?? ""), msg = String(r.json.error_response.msg ?? "").slice(0, 120);
    if (/IllegalAccessToken|InvalidSignature|Unauthorized|appkey/i.test(msg + code)) return fail("auth", false, `알리 인증 실패: ${msg}`);
    return fail("provider", false, `알리 오류 ${code}: ${msg}`);
  }
  // TOP 응답: { aliexpress_affiliate_order_list_response: { resp_result: { result: { orders: { order: [...] } } } } }
  const result = r.json?.aliexpress_affiliate_order_list_response?.resp_result?.result;
  const orders: any[] = Array.isArray(result?.orders?.order) ? result.orders.order : Array.isArray(result?.orders) ? result.orders : [];
  if (!result) return fail("parse", false, "알리 응답 모양이 달라요(resp_result.result 없음).");

  const acc = new Map<string, RevenueRow & { usd: number; n: number }>();
  let bad = 0;
  for (const o of orders) {
    const day = toKstDay(o?.paid_time ?? o?.order_time); const usd = parseMoney(o?.estimated_paid_commission ?? o?.commission);
    if (!day || usd === null) { bad++; continue; }
    if (!inRange(day, range)) continue;
    const pieceId = pieceIdFromSubId(o?.sub_id) ?? undefined;
    const accountId = src.accountId ?? undefined;
    const key = `${day}|${accountId ?? 0}|${pieceId ?? 0}`;
    const cur = acc.get(key) ?? { source: "aliexpress", day, amountKrw: 0, usd: 0, n: 0, ...(accountId ? { accountId } : {}), ...(pieceId ? { pieceId } : {}) };
    cur.usd += usd; cur.n++;
    acc.set(key, cur);
  }
  if (orders.length && bad === orders.length) return fail("parse", false, "알리 주문 행을 하나도 읽지 못했어요.");
  const rows: RevenueRow[] = [];
  for (const { usd, n, ...x } of acc.values()) {
    const fx = fxToKrw(usd, "USD", src.config)!;   // 위에서 환율 존재를 확인했다
    rows.push({ ...x, amountKrw: fx.krw, currency: "USD", fxRate: fx.fxRate, raw: { usd: Math.round(usd * 100) / 100, orders: n, fxSource: fx.fxSource } });
  }
  return { ok: true, rows };
}
