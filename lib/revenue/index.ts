/**
 * lib/revenue/index.ts — 수익 커넥터 진입점(계약 §1.1 `syncSource`) + `revenue_sources` 행 읽기/쓰기 한 곳.
 *   소스별 파일은 `SyncResult` 만 돌려준다. 여기서 ①토큰 갱신분 저장(credPatch) ②행 UPSERT(`upsert.ts` 한 함수) ③실패 기록을 한다.
 *   🔴 «없음»을 «0원»으로 쓰지 않는다(AC-9): 실패는 행을 만들지 않고 `revenue_sources.status/last_error/fail_count` 로 남긴다.
 *      **`not_configured` 는 에러가 아니다** — status 는 `not_configured` 그대로, fail_count 도 세지 않는다(재시도·알림 대상 아님).
 *   🔴 `runner-jobs`·`publish/**` 최상단 import 0(AC-17).
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { encryptObj } from "../creds-crypto";
import { jsonb, utcDate } from "../db-util";
import { syncAdsense } from "./adsense";
import { syncYoutube } from "./youtube";
import { syncCoupang } from "./coupang";
import { syncAliexpress } from "./aliexpress";
import { syncLinkprice } from "./linkprice";
import { defaultRange, fail } from "./common";
import { upsertRevenueRows, type UpsertResult } from "./upsert";
import { FRESHNESS_OF, isRevenueSource, type RevenueSource, type RevenueSourceRow, type SyncFailReason, type SyncResult } from "./types";

const n = (v: unknown) => Number(v || 0);
/** 연속 이만큼 실패하면 status=error + 알림(계약 §1.3). */
export const FAIL_THRESHOLD = 3;
/** API 커넥터가 있는 소스(러너·수동은 여기 없다). */
export const API_SOURCES: ReadonlySet<string> = new Set(["adsense", "youtube", "coupang", "aliexpress", "linkprice"]);

/* ───────── 커넥터 디스패치 ───────── */
export async function syncSource(tenantId: number, src: RevenueSourceRow, range: { from: string; to: string } = defaultRange()): Promise<SyncResult & { credPatch?: unknown }> {
  switch (src.source) {
    case "adsense": return syncAdsense(tenantId, src, range);
    case "youtube": return syncYoutube(tenantId, src, range);
    case "coupang": return syncCoupang(tenantId, src, range);
    case "aliexpress": return syncAliexpress(tenantId, src, range);
    case "linkprice": return syncLinkprice(tenantId, src, range);
    default: return fail("not_configured", false, `${src.source} 는 API 로 가져오는 소스가 아니에요(러너 또는 직접 입력).`);
  }
}

/* ───────── revenue_sources 행 ───────── */
export function toSourceRow(r: Record<string, unknown>): RevenueSourceRow {
  return {
    id: n(r.id), tenantId: n(r.tenant_id), source: String(r.source), accountId: r.account_id ? n(r.account_id) : null,
    method: String(r.method ?? "api"), status: String(r.status ?? "connected"), credEnc: r.cred_enc ? String(r.cred_enc) : null,
    lastSyncAt: utcDate(r.last_sync_at)?.toISOString() ?? null, lastError: r.last_error ? String(r.last_error) : null, failCount: n(r.fail_count),
    config: (r.config && typeof r.config === "object" && !Array.isArray(r.config) ? r.config : {}) as Record<string, unknown>,
  };
}
export async function listSourceRows(tid: number, onlyApi = false): Promise<RevenueSourceRow[]> {
  const rows = await q(sql`SELECT * FROM revenue_sources WHERE tenant_id = ${tid} ${onlyApi ? sql`AND source IN ('adsense','youtube','coupang','aliexpress','linkprice')` : sql``} ORDER BY source, account_id NULLS FIRST, id`);
  return rows.map(toSourceRow);
}

/** 소스 행 확보(없으면 만든다 · (tenant,source,account) 유니크). 반환 = 행 id. */
export async function ensureSourceRow(tid: number, source: RevenueSource, accountId: number | null, patch: { credEnc?: string | null; config?: Record<string, unknown>; status?: string } = {}): Promise<number> {
  const method = FRESHNESS_OF[source] === "api" ? "api" : FRESHNESS_OF[source] === "runner" ? "runner" : "manual";
  const status = patch.status ?? (method === "api" && !patch.credEnc ? "not_configured" : "connected");
  const [r] = await q(sql`INSERT INTO revenue_sources (tenant_id, source, account_id, method, cred_enc, status, config)
    VALUES (${tid}, ${source}, ${accountId}, ${method}, ${patch.credEnc ?? null}, ${status}, ${jsonb(patch.config ?? {})})
    ON CONFLICT (tenant_id, source, COALESCE(account_id, 0)) DO UPDATE SET
      cred_enc = COALESCE(EXCLUDED.cred_enc, revenue_sources.cred_enc),
      config = revenue_sources.config || EXCLUDED.config,
      status = ${patch.status ?? sql`CASE WHEN EXCLUDED.cred_enc IS NOT NULL THEN 'connected' ELSE revenue_sources.status END`},
      ${patch.credEnc ? sql`fail_count = 0, last_error = NULL, last_error_kind = NULL,` : sql``}
      updated_at = NOW()
    RETURNING id`);
  const id = n(r?.id);
  const [chk] = await q(sql`SELECT jsonb_typeof(config) AS t FROM revenue_sources WHERE id = ${id}`);
  if (chk?.t !== "object") console.error("[revenue] revenue_sources.config jsonb_typeof !== object", chk);   // PITFALLS #1
  return id;
}

/** 자격 저장(암호화). 호출부가 평문 객체를 넘기면 여기서 바로 암호문이 된다 — 응답·로그에 평문이 남을 자리가 없다. */
export async function saveSourceCreds(tid: number, source: RevenueSource, accountId: number | null, creds: Record<string, unknown>, config: Record<string, unknown> = {}): Promise<number> {
  return ensureSourceRow(tid, source, accountId, { credEnc: encryptObj(creds), config, status: "connected" });
}

/* ───────── 한 소스 수집 + 기록(크론·수동 «지금 가져오기» 공용) ───────── */
export interface SourceSyncOutcome {
  sourceId: number; source: string; ok: boolean;
  reason?: SyncFailReason; retriable?: boolean; detail?: string;
  written?: number; rejected?: number;
  /** 이번 실패로 fail_count 가 임계에 닿아 status=error 로 바뀌었나(알림 트리거). */
  becameError?: boolean;
}

export async function syncAndRecord(tid: number, src: RevenueSourceRow, range?: { from: string; to: string }): Promise<SourceSyncOutcome> {
  const out: SourceSyncOutcome = { sourceId: src.id, source: src.source, ok: false };
  let r: Awaited<ReturnType<typeof syncSource>>;
  try { r = await syncSource(tid, src, range); }
  catch (e) { r = fail("provider", true, `커넥터 예외: ${String((e as Error)?.message ?? e).slice(0, 200)}`); }

  // 갱신된 토큰은 실패 여부와 무관하게 저장한다(안 그러면 다음 호출이 또 갱신한다).
  if (r.credPatch && typeof r.credPatch === "object") {
    await q(sql`UPDATE revenue_sources SET cred_enc = ${encryptObj(r.credPatch as Record<string, unknown>)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${src.id}`).catch((e) => console.error("[revenue] credPatch 저장 실패", e));
  }

  if (r.ok) {
    const u: UpsertResult = await upsertRevenueRows(tid, r.rows, "api");
    await q(sql`UPDATE revenue_sources SET status = 'connected', last_sync_at = NOW(), last_ok_at = NOW(), fail_count = 0, last_error = NULL, last_error_kind = NULL, updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${src.id}`);
    return { ...out, ok: true, written: u.written, rejected: u.rejected, ...(u.rejected ? { detail: u.rejectedReasons.join(" · ").slice(0, 300) } : {}) };
  }

  if (r.reason === "not_configured") {
    // 에러가 아니다 — 상태만 정직하게. 실패 횟수를 세지 않는다.
    await q(sql`UPDATE revenue_sources SET status = 'not_configured', last_error = ${r.detail ?? null}, last_error_kind = 'not_configured', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${src.id}`);
    return { ...out, ok: false, reason: r.reason, retriable: false, detail: r.detail };
  }
  const [row] = await q(sql`UPDATE revenue_sources SET fail_count = fail_count + 1, last_error = ${r.detail ?? r.reason}, last_error_kind = ${r.reason}, last_sync_at = NOW(),
      status = CASE WHEN fail_count + 1 >= ${FAIL_THRESHOLD} OR ${r.reason === "auth"} THEN 'error' ELSE status END, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${src.id} RETURNING fail_count, status`);
  const becameError = String(row?.status) === "error" && (n(row?.fail_count) === FAIL_THRESHOLD || r.reason === "auth");
  return { ...out, ok: false, reason: r.reason, retriable: r.retriable, detail: r.detail, becameError };
}

/** source 문자열 검사(API 공용). */
export function asSource(v: unknown): RevenueSource | null { return isRevenueSource(v) ? v : null; }
