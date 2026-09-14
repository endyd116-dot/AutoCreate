/**
 * lib/ai.ts — Gemini 호출 래퍼(폴백 체인 · JSON 모드 · 미터링). AM 원본: ../AutoMarketing/lib/ai.ts (복사 2026-09-14)
 *   가져온 것: fetch 본문·generationConfig·thinkingBudget 처리(mode flash=0 · pro=답변 예산 + 사고 몫)·에러 분류(isRetryable)·
 *             잘림(MAX_TOKENS) 실패 처리·머리 모델 혼잡 재시도·벽시계 예산(budgetMs)·모델별 비용(ai-cost).
 *   뺀 것: plan-gate·ai_feature_settings cap·BYO 키·결과 캐시·프롬프트 캐시·googleSearch(이 라운드 미사용).
 *   바꾼 것: 시그니처를 객체 하나로(`callGemini({ purpose, chain, system, user, json, tenantId, ref })`) ·
 *           JSON 파싱 실패 시 **같은 모델 1회 재요청** 후 다음 모델 · 비용은 `ai_usage` 1행(purpose·model·토큰·cost_usd·ref).
 *   🔴 모델 이름 문자열 금지 — `lib/ai-models.ts` 에서 import 한 체인만 받는다. DB 오버레이(`ai_model_overrides.role`)가 있으면 그 체인이 이긴다(60초 캐시·graceful).
 *   graceful: throw 금지 — 실패는 { ok:false, reason, trace }.
 */
import { db } from "../db/index";
import { sql } from "drizzle-orm";
import { calcCost } from "./ai-cost";
import * as M from "./ai-models";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export interface AiAttempt { model: string; ok: boolean; reason?: string; ms: number }

export interface AiOk {
  ok: true;
  text: string;
  /** json:true 일 때만 — 파싱된 값. */
  json?: unknown;
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  trace: AiAttempt[];
}
export interface AiFail { ok: false; text: null; reason: string; trace: AiAttempt[] }

export type AiRole = "high" | "low" | "director" | "landing" | "image";

export interface CallGeminiArgs {
  /** ai_usage.purpose — «무슨 일에 썼나»(topics·director·content·image·gate…). */
  purpose: string;
  /** 모델 체인(ai-models.ts 의 CHAIN_*). role 을 주면 DB 오버레이가 이긴다. */
  chain: string[];
  role?: AiRole;
  system?: string;
  user: string;
  /** JSON 모드 — responseMimeType:"application/json" + 파싱 검증(실패 시 같은 모델 1회 재요청). */
  json?: boolean;
  tenantId?: number | null;
  ref?: string | null;
  maxOutputTokens?: number;
  /** pro = 사고 ON(디렉터·긴 글) · flash = 사고 OFF(대량·간단). 기본 flash. */
  mode?: "pro" | "flash";
  temperature?: number;
  timeoutMs?: number;
  /** 체인 전체 벽시계 예산(동기 함수 26초 벽 방어). 미지정 = 끝까지. */
  budgetMs?: number;
  headRetries?: number;
}

/* ───────── 사고 몫(AM ★THINKCAP) ───────── */
export const PRO_THINKING_HEADROOM = 4096;
export const PRO_OUTPUT_CEILING = 32768;

/** 재시도성 오류 — 다음 모델로 넘어갈 가치가 있는 것(AM isRetryable 그대로 · 400 도 모델별 거부일 수 있어 포함). */
function isRetryable(reason: string): boolean {
  return ["503", "429", "404", "500", "502", "UNAVAILABLE", "NOT_FOUND", "overloaded", "high demand",
    "timeout", "timed out", "abort", "Abort", "network", "empty_response", "json_parse_failed", "truncated",
    "gemini_error_400", "INVALID_ARGUMENT", "fetch_failed"].some((s) => reason.includes(s));
}

interface SingleResult {
  ok: boolean; text?: string; reason?: string;
  inputTokens: number; outputTokens: number; cachedTokens: number; thoughtTokens: number;
}

async function callSingleModel(model: string, a: CallGeminiArgs, apiKey: string, timeoutMs: number): Promise<SingleResult> {
  const empty = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, thoughtTokens: 0 };
  if (!apiKey) return { ok: false, reason: "no_api_key", ...empty };
  const endpoint = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;
  const mode = a.mode ?? "flash";
  const baseMax = a.maxOutputTokens ?? (a.json ? 4096 : 2048);
  const thinkAllow = mode === "pro" ? Math.max(0, Math.min(PRO_THINKING_HEADROOM, PRO_OUTPUT_CEILING - baseMax)) : 0;
  const generationConfig: Record<string, unknown> = {
    temperature: a.temperature ?? (a.json ? 0.2 : 0.4),
    maxOutputTokens: baseMax + thinkAllow,
    ...(a.json ? { responseMimeType: "application/json" } : {}),
    thinkingConfig: { thinkingBudget: thinkAllow },
  };
  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: a.user }] }],
    generationConfig,
  };
  if (a.system) body.systemInstruction = { parts: [{ text: a.system }] };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      return { ok: false, reason: `gemini_error_${resp.status}: ${errText.slice(0, 200)}`, ...empty };
    }
    const data = (await resp.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
    };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p?.text ?? "").join("");
    const inputTokens = data.usageMetadata?.promptTokenCount ?? 0;
    const thoughtTokens = data.usageMetadata?.thoughtsTokenCount ?? 0;   // 사고 토큰은 출력 단가로 과금된다 — 합산(AM ★THINKON)
    const outputTokens = (data.usageMetadata?.candidatesTokenCount ?? 0) + thoughtTokens;
    const cachedTokens = data.usageMetadata?.cachedContentTokenCount ?? 0;
    if (!text) return { ok: false, reason: "empty_response", inputTokens, outputTokens, cachedTokens, thoughtTokens };
    const finishReason = String(data.candidates?.[0]?.finishReason ?? "").toUpperCase();
    if (finishReason === "MAX_TOKENS" || finishReason === "LENGTH") {
      return { ok: false, reason: `truncated_${finishReason.toLowerCase()}`, inputTokens, outputTokens, cachedTokens, thoughtTokens };
    }
    return { ok: true, text, inputTokens, outputTokens, cachedTokens, thoughtTokens };
  } catch (err) {
    const aborted = (err as Error)?.name === "AbortError";
    return { ok: false, reason: aborted ? `timeout_${timeoutMs}ms` : `fetch_failed: ${String(err).slice(0, 200)}`, ...empty };
  } finally { clearTimeout(timer); }
}

/* ───────── DB 오버레이(ai_model_overrides) — 60초 캐시 · graceful ─────────
 *   DESIGN §10 / DDL 0006 주석 정본: `chain`=현재 적용 중 · `candidate`=카나리 중인 새 체인 · `canary_pct`=candidate 트래픽 비율.
 *     → 요청마다 canary_pct% 는 candidate 로, 나머지는 baseline(chain 있으면 chain · 없으면 코드 기본) 으로 간다.
 *     candidate 가 없으면(승격 완료·미설정) 항상 baseline — canary_pct 는 candidate 가 있을 때만 의미.
 *   🔴 캐시는 «결정»이 아니라 «원본 오버레이»를 60초 담는다 — 주사위는 호출마다 굴린다(60초 동안 한 결정에 고정되면 10% 카나리가
 *      60초 단위 all-or-nothing 이 된다). P1R4-B2 에서 candidate 인지로 확장(그전엔 chain@canary_pct vs 코드였다 · 라이브 행 0건이라 안전).
 */
const overlayCache = new Map<string, { baseline: string[] | null; candidate: string[] | null; pct: number; at: number }>();
export async function resolveChain(role: AiRole | undefined, codeChain: string[]): Promise<string[]> {
  if (!role) return codeChain;
  let ov = overlayCache.get(role);
  if (!ov || Date.now() - ov.at >= 60_000) {
    let baseline: string[] | null = null, candidate: string[] | null = null, pct = 100;
    try {
      const rows = (await db.execute(sql`SELECT chain, candidate, canary_pct FROM ai_model_overrides WHERE role = ${role} LIMIT 1`)) as unknown as { chain: unknown; candidate: unknown; canary_pct: unknown }[];
      const r = rows[0];
      if (r) {
        if (Array.isArray(r.chain) && r.chain.length) baseline = (r.chain as unknown[]).map(String).filter(Boolean);
        if (Array.isArray(r.candidate) && r.candidate.length) candidate = (r.candidate as unknown[]).map(String).filter(Boolean);
        pct = Number(r.canary_pct ?? 100);
      }
    } catch { /* 오버레이 조회 실패 — 코드 체인 */ }
    ov = { baseline, candidate, pct, at: Date.now() };
    overlayCache.set(role, ov);
  }
  const base = ov.baseline ?? codeChain;
  if (ov.candidate && ov.candidate.length && ov.pct >= Math.random() * 100) return ov.candidate;
  return base;
}

/* ───────── 미터링(ai_usage 1행 · 실패 무해) ───────── */
export async function recordAiUsage(row: { tenantId?: number | null; purpose: string; model: string; inTokens: number; outTokens: number; costUsd: number; ref?: string | null }): Promise<void> {
  try {
    await db.execute(sql`INSERT INTO ai_usage (tenant_id, purpose, model, in_tokens, out_tokens, cost_usd, ref)
      VALUES (${row.tenantId ?? null}, ${row.purpose.slice(0, 40)}, ${row.model.slice(0, 60)}, ${Math.trunc(row.inTokens)}, ${Math.trunc(row.outTokens)}, ${row.costUsd.toFixed(6)}, ${row.ref ? String(row.ref).slice(0, 120) : null})`);
  } catch (e) { console.warn("[ai_usage] 기록 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
}

/** JSON 텍스트 — 코드펜스·앞뒤 잡음 제거 후 파싱. 실패 null. */
export function parseJsonLoose(text: string): unknown | null {
  let s = String(text ?? "").trim();
  s = s.replace(/^\s*```[a-zA-Z]*\s*\n?/, "").replace(/\n?\s*```\s*$/, "").trim();
  try { return JSON.parse(s); } catch { /* 계속 */ }
  const a = s.search(/[{[]/);
  const b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* 계속 */ } }
  return null;
}

/**
 * callGemini — 체인 순서대로 폴백. JSON 모드는 파싱까지 성공해야 성공.
 *   파싱 실패: 같은 모델 1회 재요청(트리거 B1) → 그래도 실패면 다음 모델.
 */
export async function callGemini(a: CallGeminiArgs): Promise<AiOk | AiFail> {
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  const trace: AiAttempt[] = [];
  if (!apiKey) return { ok: false, text: null, reason: "no_api_key", trace };
  const resolved = await resolveChain(a.role, a.chain);
  const chain = resolved.length ? resolved : [M.MODEL_DEFAULT];
  const mode = a.mode ?? "flash";
  const MIN_MODEL_MS = 2500;
  const chainStart = Date.now();
  const HEAD_RETRY_MAX = Math.max(0, Math.floor(a.headRetries ?? 1));
  let headRetried = 0;
  let parseRetried = false;
  let lastReason = "no_model";
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    let timeoutMs = a.timeoutMs ?? 60_000;
    if (typeof a.budgetMs === "number" && a.budgetMs > 0) {
      const remaining = a.budgetMs - (Date.now() - chainStart);
      if (remaining < MIN_MODEL_MS) { lastReason = `chain_budget_exhausted_${a.budgetMs}ms`; trace.push({ model, ok: false, reason: lastReason, ms: 0 }); break; }
      timeoutMs = Math.min(timeoutMs, remaining);
    }
    const mStart = Date.now();
    const r = await callSingleModel(model, a, apiKey, timeoutMs);
    let parsed: unknown = undefined;
    let parseFailed = false;
    if (r.ok && r.text && a.json) { parsed = parseJsonLoose(r.text); if (parsed === null) parseFailed = true; }
    const okEff = !!(r.ok && r.text) && !parseFailed;
    trace.push({ model, ok: okEff, reason: okEff ? undefined : (parseFailed ? "json_parse_failed" : (r.reason ?? "unknown")), ms: Date.now() - mStart });
    // 실패한 호출도 토큰은 나갔다 — 기록한다(비용은 실제).
    if (r.inputTokens || r.outputTokens) {
      void recordAiUsage({ tenantId: a.tenantId, purpose: okEff ? a.purpose : `${a.purpose}:fail`, model, inTokens: r.inputTokens, outTokens: r.outputTokens, costUsd: calcCost(model, r.inputTokens, r.outputTokens, r.cachedTokens), ref: a.ref });
    }
    if (okEff) {
      if (i > 0) console.info(`[gemini-${mode}] 폴백 #${i + 1} 성공: ${model} (1차 ${chain[0]} 실패: ${lastReason.slice(0, 80)})`);
      return { ok: true, text: r.text!, json: parsed, model, costUsd: calcCost(model, r.inputTokens, r.outputTokens, r.cachedTokens), inputTokens: r.inputTokens, outputTokens: r.outputTokens, thoughtTokens: r.thoughtTokens, trace };
    }
    lastReason = parseFailed ? "json_parse_failed" : (r.reason ?? "unknown");
    console.warn(`[gemini-${mode}] ${i + 1}/${chain.length} ${model} 실패: ${lastReason.slice(0, 120)}`);
    if (parseFailed && !parseRetried) { parseRetried = true; i--; continue; }   // 같은 모델 1회 재요청
    if (!isRetryable(lastReason)) break;
    const busy = /503|429|overloaded|high demand|UNAVAILABLE/i.test(lastReason);
    const budgetLeft = typeof a.budgetMs === "number" && a.budgetMs > 0 ? a.budgetMs - (Date.now() - chainStart) : Infinity;
    const waitMs = Math.round(2500 * 2 ** headRetried * (0.75 + Math.random() * 0.5));
    if (i === 0 && busy && headRetried < HEAD_RETRY_MAX && budgetLeft > waitMs + MIN_MODEL_MS) {
      headRetried += 1;
      await new Promise((s) => setTimeout(s, waitMs));
      i--; continue;
    }
  }
  return { ok: false, text: null, reason: lastReason, trace };
}

/** JSON 모드 편의 — 성공 시 T, 실패 null(사유는 console). */
export async function callGeminiJson<T = unknown>(a: Omit<CallGeminiArgs, "json">): Promise<{ ok: true; data: T; model: string } | { ok: false; reason: string }> {
  const r = await callGemini({ ...a, json: true });
  if (!r.ok) return { ok: false, reason: r.reason };
  return { ok: true, data: r.json as T, model: r.model };
}
