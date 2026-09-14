/**
 * lib/video/providers/veo.ts — Google Veo 3.1(Gemini API) 어댑터 · predictLongRunning 제출 + 폴링.
 *   AM 원본: ../AutoMarketing/lib/video-providers/veo.ts (복사 2026-09-15 · 원본 7fa294519 2026-08-03 · 무수정에 가까움)
 *   실측(AM): durationSeconds 는 **4·6·8 만**(5 → 400 · 올림 스냅) · 1:1 400(9:16/16:9 만) · `personGeneration:"dont_allow"` 400 → 인물 보호는 상류 게이트(PIPA i2v 입력 제외 · 무인물 프롬프트).
 *   키 = GEMINI_API_KEY. 동기 대기 0 — 폴링은 배경 함수(gen.ts)가 한다(Lite i2v 1~4분).
 */
import { assertProviderAllowed, type ProviderSpec } from "./registry";
import type { ClipPollResult, ClipSubmitResult } from "./fal";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface VeoSubmitInput { provider: ProviderSpec; apiKey: string; prompt: string; imageBase64?: string | null; imageMime?: string | null; durationSec: number; aspectRatio?: "9:16" | "1:1" | "16:9" }

/** Veo 가 실제로 받는 비율(1:1 없음). */
export function veoAspect(want?: string | null): "9:16" | "16:9" { return String(want ?? "").trim() === "16:9" ? "16:9" : "9:16"; }
/** 4·6·8 스냅(올림). */
export function veoDuration(wantSec: number): 4 | 6 | 8 { const w = Math.max(4, Math.min(8, Number(wantSec) || 6)); return ([4, 6, 8] as const).find((d) => d >= w) ?? 8; }

export async function veoSubmit(input: VeoSubmitInput, timeoutMs = 25_000): Promise<ClipSubmitResult> {
  assertProviderAllowed(input.provider.key, input.provider.model);
  if (!input.apiKey) return { ok: false, reason: "Gemini 키가 없어 Veo 생성을 건너뜁니다." };
  const instance: Record<string, unknown> = { prompt: String(input.prompt ?? "").slice(0, 1500) };
  if (input.imageBase64) instance.image = { bytesBase64Encoded: input.imageBase64, mimeType: input.imageMime || "image/jpeg" };
  const body = { instances: [instance], parameters: { aspectRatio: veoAspect(input.aspectRatio), durationSeconds: veoDuration(input.durationSec) } };
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${GEMINI_API_BASE}/models/${input.provider.model}:predictLongRunning?key=${input.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const txt = await resp.text();
    if (!resp.ok) return { ok: false, reason: `Veo 제출 실패 HTTP ${resp.status}: ${txt.slice(0, 200)}` };
    const o = JSON.parse(txt) as { name?: string };
    if (!o.name) return { ok: false, reason: `Veo 응답에 operation name 없음: ${txt.slice(0, 160)}` };
    return { ok: true, requestId: o.name, statusUrl: `${GEMINI_API_BASE}/${o.name}`, responseUrl: `${GEMINI_API_BASE}/${o.name}` };
  } catch (e) { return { ok: false, reason: `Veo 제출 예외: ${String((e as Error)?.message || e).slice(0, 200)}` }; }
  finally { clearTimeout(timer); }
}

export async function veoPoll(statusUrl: string, apiKey: string, timeoutMs = 15_000): Promise<ClipPollResult> {
  if (!apiKey) return { state: "failed", reason: "Gemini 키 없음" };
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${statusUrl}?key=${apiKey}`, { signal: ctrl.signal });
    if (!r.ok) return { state: "failed", reason: `Veo 상태조회 HTTP ${r.status}` };
    const o = (await r.json()) as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] }; generatedSamples?: { video?: { uri?: string } }[] } };
    if (o.error?.message) return { state: "failed", reason: `Veo 오류: ${String(o.error.message).slice(0, 180)}` };
    if (!o.done) return { state: "running" };
    const samples = o.response?.generateVideoResponse?.generatedSamples ?? o.response?.generatedSamples ?? [];
    const uri = samples[0]?.video?.uri;
    return uri ? { state: "done", videoUrl: `${uri}${uri.includes("?") ? "&" : "?"}key=${apiKey}` } : { state: "failed", reason: "Veo 결과에 video uri 없음" };
  } catch (e) { return { state: "failed", reason: `Veo 폴링 예외: ${String((e as Error)?.message || e).slice(0, 200)}` }; }
  finally { clearTimeout(timer); }
}

/** 제출 후 완료까지 기다린다(배경 함수 전용 · 예산 안에서 폴링 · 기본 6분·8초 간격). */
export async function veoGenerate(input: VeoSubmitInput, budgetMs = 6 * 60_000): Promise<ClipPollResult & { requestId?: string }> {
  const s = await veoSubmit(input);
  if (!s.ok || !s.statusUrl) return { state: "failed", reason: s.reason ?? "submit_failed" };
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    await new Promise((r) => setTimeout(r, 8_000));
    const p = await veoPoll(s.statusUrl, input.apiKey);
    if (p.state === "done" || p.state === "failed") return { ...p, requestId: s.requestId };
  }
  return { state: "failed", reason: `Veo 폴링 예산 초과(${Math.round(budgetMs / 1000)}s)`, requestId: s.requestId };
}
