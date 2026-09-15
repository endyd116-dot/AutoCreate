/**
 * lib/revenue/common.ts — 커넥터 공통 소도구(자격 복호화 · HTTP · 실패 분류 · KST 날짜 · 환율).
 *   🔴 자격은 AES-256-GCM(`CREDS_ENC_KEY` 폴백 없음 · lib/creds-crypto). 평문은 커넥터 함수 안에서만 산다 — 반환값·raw·로그에 싣지 않는다.
 *   🔴 이 파일은 `runner-jobs`·`publish/**` 를 import 하지 않는다(AC-17).
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { decryptObj, credsEncConfigured } from "../creds-crypto";
import type { SyncFail, SyncFailReason } from "./types";

/* ───────── 자격 ───────── */
/** cred_enc → 객체. 없거나 못 풀면 null(= not_configured). 키 자체가 없으면(CREDS_ENC_KEY 미설정) 우리 쪽 문제라 provider 로 가른다. */
export function readCreds<T extends object>(credEnc: string | null | undefined): { ok: true; creds: T } | SyncFail {
  if (!credEnc) return fail("not_configured", false, "자격이 등록되지 않았어요.");
  if (!credsEncConfigured()) return fail("provider", false, "서버 암호화 키(CREDS_ENC_KEY)가 없어 자격을 읽지 못했어요.");
  const o = decryptObj<Record<string, unknown>>(credEnc) as T | null;
  if (!o) return fail("auth", false, "저장된 자격을 읽지 못했어요. 다시 연결해 주세요.");
  return { ok: true, creds: o };
}

export function fail(reason: SyncFailReason, retriable: boolean, detail?: string): SyncFail {
  return { ok: false, reason, retriable, ...(detail ? { detail: detail.slice(0, 300) } : {}) };
}

/* ───────── HTTP ───────── */
export interface HttpResult { ok: boolean; status: number; json: any; text: string }
/** JSON 호출(15초 타임아웃 · 예외를 던지지 않는다 · status 0 = 네트워크). */
export async function httpJson(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<HttpResult> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const text = await r.text();
    let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { /* 비 JSON */ }
    return { ok: r.ok, status: r.status, json, text: text.slice(0, 2000) };
  } catch (e) {
    return { ok: false, status: 0, json: null, text: String((e as Error)?.message ?? e).slice(0, 300) };
  } finally { clearTimeout(t); }
}
/** HTTP 실패 → 계약 사유. 401/403 = auth(고객 재연결) · 429 = rate_limit · 5xx·0 = provider(우리/상대 쪽 · 재시도). */
export function classifyHttp(r: HttpResult, what: string): SyncFail {
  const snippet = (r.text || JSON.stringify(r.json ?? "")).slice(0, 160);
  if (r.status === 401 || r.status === 403) return fail("auth", false, `${what} 인증 실패(${r.status}) — 다시 연결해 주세요.`);
  if (r.status === 429) return fail("rate_limit", true, `${what} 호출 한도(429).`);
  if (r.status === 0) return fail("provider", true, `${what} 네트워크 오류: ${snippet}`);
  if (r.status >= 500) return fail("provider", true, `${what} 서버 오류(${r.status}): ${snippet}`);
  return fail("provider", false, `${what} 응답 ${r.status}: ${snippet}`);
}

/* ───────── 날짜(KST) ───────── */
const KST_MS = 9 * 3600 * 1000;
export function kstToday(now = new Date()): string { return new Date(now.getTime() + KST_MS).toISOString().slice(0, 10); }
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** 기본 수집 범위 = 최근 7일(계약 §1.1 · 늦게 확정되는 소스를 되돌아 덮어쓴다). */
export function defaultRange(now = new Date()): { from: string; to: string } { const to = kstToday(now); return { from: addDays(to, -6), to }; }
/** 'YYYYMMDD' · 'YYYY-MM-DD' · ISO 시각 → KST YYYY-MM-DD. 못 읽으면 null(0 으로 채우지 않는다). */
export function toKstDay(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s); if (!Number.isFinite(t)) return null;
  return new Date(t + KST_MS).toISOString().slice(0, 10);
}
export function inRange(day: string, range: { from: string; to: string }): boolean { return day >= range.from && day <= range.to; }

/* ───────── 금액 ───────── */
/** «1,234.5» «₩1,234» «$3.20» → 숫자. 못 읽으면 null(AC-9 — 0 으로 채우지 않는다). */
export function parseMoney(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/[₩$€¥,\s원+]/g, "").trim();
  if (!s || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const x = Number(s); return Number.isFinite(x) ? x : null;
}
/**
 * 외화 → KRW. 환율 출처 우선순위: 소스 config.fxRate → env FX_<CUR>_KRW. 없으면 null(= 환산 불가 · 호출부가 not_configured 로 정직 반환).
 *   ⚠️ 환율을 «대충 1,300» 으로 박지 않는다 — 그 숫자가 화면의 «오늘 번 돈»이 된다.
 */
export function fxToKrw(amount: number, currency: string, config: Record<string, unknown>): { krw: number; fxRate: number; fxSource: string } | null {
  const cur = String(currency || "KRW").toUpperCase();
  if (cur === "KRW") return { krw: Math.round(amount), fxRate: 1, fxSource: "krw" };
  const fromCfg = Number(config?.fxRate); if (Number.isFinite(fromCfg) && fromCfg > 0) return { krw: Math.round(amount * fromCfg), fxRate: fromCfg, fxSource: "config.fxRate" };
  const fromEnv = Number(process.env[`FX_${cur}_KRW`]); if (Number.isFinite(fromEnv) && fromEnv > 0) return { krw: Math.round(amount * fromEnv), fxRate: fromEnv, fxSource: `env.FX_${cur}_KRW` };
  return null;
}
