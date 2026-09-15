/**
 * lib/revenue/upsert.ts — 🔴 **수익 행을 DB 에 쓰는 유일한 함수**(계약 P1R3 §5 · B↔B2 경계).
 *   B 의 API 커넥터·수동 입력·B2 의 러너 report 가 전부 이 함수만 부른다. 두 손이 같은 표를 쓰지 않는다.
 *
 *   ══ 멱등(§0) ══
 *     유니크 `(tenant_id, source, account_id, piece_id, day)` + UPSERT. 같은 날 여러 번 수집해도 1행이고,
 *     재수집은 **덮어쓴다**(늦게 확정되는 소스가 정상이다 — 어제 300원이 오늘 320원으로 바뀌는 게 애드센스다).
 *     ⚠️ account_id·piece_id 가 NULL 일 수 있어 유니크 인덱스는 `COALESCE(...,0)` 표현식 인덱스다 — ON CONFLICT 도 같은 식으로 잡는다.
 *
 *   ══ «없음»을 «0원»으로 쓰지 않는다(AC-9) ══
 *     여기는 **받은 행만** 쓴다. 행을 «만들어 채우는» 로직은 없다 — 수집 실패는 호출부가 revenue_sources.status 로 남긴다.
 *     amountKrw 가 숫자가 아니거나 음수가 아닌 정수가 아니면 그 행은 **버리고 센다**(rejected · 0 으로 고쳐 넣지 않는다).
 *
 *   ══ 검증 ══
 *     day 는 KST YYYY-MM-DD 문자열이어야 한다(Date 바인딩 금지 · AC-5). source 는 enum. raw 는 jsonb 헬퍼(PITFALLS #1).
 *     🔴 raw 에 토큰·키가 실리면 안 된다 — 커넥터가 책임지지만 여기서도 흔한 키 이름을 한 번 걸러 낸다(방어선 2).
 *   이 파일은 `runner-jobs`·`publish/**` 를 import 하지 않는다(AC-17).
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { jsonb } from "../db-util";
import { isRevenueSource, type Freshness, type RevenueRow } from "./types";

const n = (v: unknown) => Number(v || 0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** raw 에서 걸러 낼 키(대소문자 무시 · 부분 일치). */
const SECRET_KEY_RE = /token|secret|password|passwd|apikey|api_key|accesskey|access_key|authorization|cookie|credential/i;

export interface UpsertResult { written: number; rejected: number; rejectedReasons: string[] }

/** raw 정리 — 비밀 냄새가 나는 키는 값을 지운다. 깊이 3까지만(그 이상은 통째로 문자열화 길이 제한). */
export function scrubRaw(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v !== "object") return typeof v === "string" ? v.slice(0, 500) : v;
  if (depth >= 3) return "[…]";
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => scrubRaw(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>).slice(0, 40)) out[k] = SECRET_KEY_RE.test(k) ? "[redacted]" : scrubRaw(val, depth + 1);
  return out;
}

/**
 * upsertRevenueRows(tenantId, rows, freshness) — 계약 §5 시그니처 그대로.
 *   반환 = 실제로 쓴 수 / 버린 수(+사유). 던지지 않는다(한 행의 문제가 나머지를 막지 않는다 · 행 단위 격리).
 */
export async function upsertRevenueRows(tenantId: number, rows: RevenueRow[], freshness: Freshness): Promise<UpsertResult> {
  const tid = Math.floor(Number(tenantId) || 0);
  const out: UpsertResult = { written: 0, rejected: 0, rejectedReasons: [] };
  if (tid <= 0 || !Array.isArray(rows) || !rows.length) return out;
  const fresh: Freshness = freshness === "runner" || freshness === "manual" ? freshness : "api";

  for (const r of rows) {
    const reason = validate(r);
    if (reason) { out.rejected++; if (out.rejectedReasons.length < 10) out.rejectedReasons.push(reason); continue; }
    const accountId = r.accountId ? Math.floor(r.accountId) : null;
    const pieceId = r.pieceId ? Math.floor(r.pieceId) : null;
    const amount = Math.trunc(r.amountKrw);
    const currency = String(r.currency || "KRW").toUpperCase().slice(0, 3);
    const fx = r.fxRate !== undefined && Number.isFinite(Number(r.fxRate)) && Number(r.fxRate) > 0 ? Number(r.fxRate) : null;
    const raw = r.raw === undefined ? null : scrubRaw(r.raw);
    try {
      await q(sql`INSERT INTO revenue_daily (tenant_id, source, account_id, piece_id, day, amount_krw, currency, fx_rate, freshness, raw)
        VALUES (${tid}, ${String(r.source)}, ${accountId}, ${pieceId}, ${r.day}::date, ${amount}, ${currency}, ${fx}, ${fresh}, ${raw === null ? null : jsonb(raw)})
        ON CONFLICT (tenant_id, source, COALESCE(account_id, 0), COALESCE(piece_id, 0), day)
        DO UPDATE SET amount_krw = EXCLUDED.amount_krw, currency = EXCLUDED.currency, fx_rate = EXCLUDED.fx_rate,
                      freshness = EXCLUDED.freshness, raw = EXCLUDED.raw, updated_at = NOW()`);
      out.written++;
    } catch (e) {
      out.rejected++;
      const msg = String((e as Error)?.message ?? e).slice(0, 120);
      if (out.rejectedReasons.length < 10) out.rejectedReasons.push(`db: ${msg}`);
      console.error(`[revenue/upsert] tid=${tid} source=${String(r.source)} day=${r.day} 실패 — ${msg}`);
    }
  }
  if (out.written) {
    // 쓴 직후 모양 확인까지가 쓰기다(PITFALLS #1) — 마지막 raw 가 jsonb object/array 인지.
    const [chk] = await q(sql`SELECT jsonb_typeof(raw) AS t FROM revenue_daily WHERE tenant_id = ${tid} AND raw IS NOT NULL ORDER BY id DESC LIMIT 1`).catch(() => []);
    if (chk && !["object", "array"].includes(String(chk.t))) console.error("[revenue/upsert] raw jsonb_typeof 이상", chk);
  }
  return out;
}

/** 행 검증 — 통과면 null, 아니면 사람이 읽는 사유. */
export function validate(r: RevenueRow): string | null {
  if (!r || typeof r !== "object") return "row 아님";
  if (!isRevenueSource(r.source)) return `source 어휘 밖: ${String((r as { source?: unknown }).source)}`;
  if (typeof r.day !== "string" || !DAY_RE.test(r.day)) return `day 형식(KST YYYY-MM-DD) 아님: ${String(r.day)}`;
  const a = Number(r.amountKrw);
  if (!Number.isFinite(a) || a < 0) return `amountKrw 가 음수·비수치: ${String(r.amountKrw)}`;   // 0 은 «진짜 0원»이라 허용(AC-9 · 없음≠0 은 «행을 안 만드는» 쪽으로 지킨다)
  if (r.accountId !== undefined && r.accountId !== null && !(Number.isInteger(r.accountId) && r.accountId > 0)) return "accountId 형식";
  if (r.pieceId !== undefined && r.pieceId !== null && !(Number.isInteger(r.pieceId) && r.pieceId > 0)) return "pieceId 형식";
  return null;
}

/** subId → pieceId. R1 규약 `piece_{id}`(lib/affiliate-coupang subIdFor) · 계약 표기 `p{id}` 도 받는다. 아니면 null. */
export function pieceIdFromSubId(subId: unknown): number | null {
  const s = String(subId ?? "").trim();
  const m = /^(?:piece_|p)(\d{1,12})$/.exec(s);
  return m ? n(m[1]) : null;
}
