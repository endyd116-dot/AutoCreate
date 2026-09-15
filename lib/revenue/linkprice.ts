/**
 * lib/revenue/linkprice.ts — 링크프라이스(어필리에이트 실적 API `affiliate/order.php`). 계약 §1.2.
 *   GET https://api.linkprice.com/affiliate/order.php?a_id={affiliateId}&yyyymm={YYYYMM}&auth_key={key}
 *   응답 `{ result:"0", order_list:[{ day:"YYYYMMDD", u_id, sales, commission, status, ... }] }` — u_id 가 우리가 붙인 subId(=piece_{id}).
 *   자격: `cred_enc` = { affiliateId, authKey }. 금액은 KRW(국내). 범위가 두 달에 걸치면 월별로 두 번 부른다.
 *   ⚠️ 링크프라이스 실적은 승인(확정)까지 상태가 바뀐다 — 7일 되돌아 덮어쓰는 기본 범위가 그 흐름을 흡수한다.
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { pieceIdFromSubId } from "./upsert";
import { classifyHttp, fail, httpJson, inRange, parseMoney, readCreds, toKstDay } from "./common";
import type { RevenueRow, RevenueSourceRow, SyncResult } from "./types";

const API = "https://api.linkprice.com/affiliate/order.php";

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []; let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7));
  const ey = Number(to.slice(0, 4)), em = Number(to.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) { out.push(`${y}${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } if (out.length > 3) break; }
  return out;
}

export async function syncLinkprice(_tenantId: number, src: RevenueSourceRow, range: { from: string; to: string }): Promise<SyncResult> {
  const c = readCreds<{ affiliateId?: string; authKey?: string }>(src.credEnc);
  if (!c.ok) return c;
  const { affiliateId, authKey } = c.creds;
  if (!affiliateId || !authKey) return fail("not_configured", false, "링크프라이스 키가 없어요. 키를 넣으면 바로 가져와요.");

  const acc = new Map<string, RevenueRow & { amountRaw: number; n: number }>();
  let total = 0, bad = 0;
  for (const yyyymm of monthsBetween(range.from, range.to)) {
    const r = await httpJson(`${API}?${new URLSearchParams({ a_id: String(affiliateId), yyyymm, auth_key: String(authKey) })}`, {}, 20_000);
    if (!r.ok) return classifyHttp(r, "링크프라이스");
    if (r.json && r.json.result !== undefined && String(r.json.result) !== "0") {
      const msg = String(r.json.message ?? r.json.msg ?? "").slice(0, 120);
      if (/auth|key|권한|인증/i.test(msg)) return fail("auth", false, `링크프라이스 인증 실패: ${msg}`);
      return fail("provider", false, `링크프라이스 result ${r.json.result}: ${msg}`);
    }
    const list: any[] = Array.isArray(r.json?.order_list) ? r.json.order_list : Array.isArray(r.json?.list) ? r.json.list : [];
    if (!Array.isArray(r.json?.order_list) && !Array.isArray(r.json?.list) && r.json !== null) return fail("parse", false, "링크프라이스 응답 모양이 달라요(order_list 없음).");
    for (const o of list) {
      total++;
      const day = toKstDay(o?.day ?? o?.yyyymmdd ?? o?.trans_time); const amt = parseMoney(o?.commission ?? o?.commission_amount);
      if (!day || amt === null) { bad++; continue; }
      if (!inRange(day, range)) continue;
      const pieceId = pieceIdFromSubId(o?.u_id) ?? undefined;
      const accountId = src.accountId ?? undefined;
      const key = `${day}|${accountId ?? 0}|${pieceId ?? 0}`;
      const cur = acc.get(key) ?? { source: "linkprice", day, amountKrw: 0, amountRaw: 0, n: 0, currency: "KRW", ...(accountId ? { accountId } : {}), ...(pieceId ? { pieceId } : {}) };
      cur.amountRaw += amt; cur.n++;
      acc.set(key, cur);
    }
  }
  if (total && bad === total) return fail("parse", false, "링크프라이스 실적 행을 하나도 읽지 못했어요.");
  const rows: RevenueRow[] = [...acc.values()].map(({ amountRaw, n, ...x }) => ({ ...x, amountKrw: Math.round(amountRaw), raw: { orders: n } }));
  return { ok: true, rows };
}
