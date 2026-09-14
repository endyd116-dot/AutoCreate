/**
 * lib/video/providers/fal.ts — fal.ai 통합 레이어(Wan 2.2 · Hailuo 02 · Kling) · queue REST 직접 호출(SDK 의존 0).
 *   AM 원본: ../AutoMarketing/lib/video-providers/fal.ts (복사 2026-09-15 · 원본 18a6167fe 2026-08-01 · 무수정에 가까움)
 *   키 = FAL_KEY(FAL_API_KEY 허용). 없으면 정직 실패(registry.pickProvider 가 애초에 fal 을 고르지 않는다 — «키 꽂으면 즉시»).
 */
import { assertProviderAllowed, type ProviderSpec } from "./registry";

const FAL_QUEUE_BASE = "https://queue.fal.run";
export function falKey(): string { return (process.env.FAL_KEY || process.env.FAL_API_KEY || "").trim(); }

export interface ClipSubmitResult { ok: boolean; requestId?: string; statusUrl?: string; responseUrl?: string; reason?: string }
export interface ClipPollResult { state: "queued" | "running" | "done" | "failed"; videoUrl?: string; reason?: string }
export interface FalSubmitInput { provider: ProviderSpec; imageUrl?: string | null; prompt: string; durationSec: number; aspectRatio?: "9:16" | "1:1" | "16:9" }

export async function falSubmit(input: FalSubmitInput, timeoutMs = 20_000): Promise<ClipSubmitResult> {
  assertProviderAllowed(input.provider.key, input.provider.model);
  const key = falKey();
  if (!key) return { ok: false, reason: "FAL_KEY 가 설정되지 않아 fal 생성을 건너뜁니다." };
  const body: Record<string, unknown> = { prompt: String(input.prompt ?? "").slice(0, 1500), duration: Math.max(3, Math.min(10, Math.round(Number(input.durationSec) || 5))) };
  if (input.imageUrl) body.image_url = input.imageUrl;
  if (input.aspectRatio) body.aspect_ratio = input.aspectRatio;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${FAL_QUEUE_BASE}/${input.provider.model}`, { method: "POST", signal: ctrl.signal, headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const txt = await resp.text();
    if (!resp.ok) return { ok: false, reason: `fal 제출 실패 HTTP ${resp.status}: ${txt.slice(0, 200)}` };
    const o = JSON.parse(txt) as { request_id?: string; status_url?: string; response_url?: string };
    if (!o.request_id) return { ok: false, reason: `fal 응답에 request_id 없음: ${txt.slice(0, 160)}` };
    return { ok: true, requestId: o.request_id, statusUrl: o.status_url || `${FAL_QUEUE_BASE}/${input.provider.model}/requests/${o.request_id}/status`, responseUrl: o.response_url || `${FAL_QUEUE_BASE}/${input.provider.model}/requests/${o.request_id}` };
  } catch (e) { return { ok: false, reason: `fal 제출 예외: ${String((e as Error)?.message || e).slice(0, 200)}` }; }
  finally { clearTimeout(timer); }
}

export async function falPoll(statusUrl: string, responseUrl: string, timeoutMs = 15_000): Promise<ClipPollResult> {
  const key = falKey();
  if (!key) return { state: "failed", reason: "FAL_KEY 없음" };
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(statusUrl, { headers: { Authorization: `Key ${key}` }, signal: ctrl.signal });
    if (!r.ok) return { state: "failed", reason: `fal 상태조회 HTTP ${r.status}` };
    const st = String(((await r.json()) as { status?: string }).status ?? "").toUpperCase();
    if (st === "IN_QUEUE") return { state: "queued" };
    if (st === "IN_PROGRESS") return { state: "running" };
    if (st !== "COMPLETED") return { state: "failed", reason: `fal 상태 ${st || "unknown"}` };
    const rr = await fetch(responseUrl, { headers: { Authorization: `Key ${key}` }, signal: ctrl.signal });
    if (!rr.ok) return { state: "failed", reason: `fal 결과조회 HTTP ${rr.status}` };
    const o = (await rr.json()) as { video?: { url?: string }; videos?: { url?: string }[] };
    const url = o.video?.url || o.videos?.[0]?.url;
    return url ? { state: "done", videoUrl: url } : { state: "failed", reason: "fal 결과에 video url 없음" };
  } catch (e) { return { state: "failed", reason: `fal 폴링 예외: ${String((e as Error)?.message || e).slice(0, 200)}` }; }
  finally { clearTimeout(timer); }
}

/** 제출 후 완료까지(배경 함수 전용 · 기본 8분 · 10초 간격). */
export async function falGenerate(input: FalSubmitInput, budgetMs = 8 * 60_000): Promise<ClipPollResult & { requestId?: string }> {
  const s = await falSubmit(input);
  if (!s.ok || !s.statusUrl || !s.responseUrl) return { state: "failed", reason: s.reason ?? "submit_failed" };
  const t0 = Date.now();
  while (Date.now() - t0 < budgetMs) {
    await new Promise((r) => setTimeout(r, 10_000));
    const p = await falPoll(s.statusUrl, s.responseUrl);
    if (p.state === "done" || p.state === "failed") return { ...p, requestId: s.requestId };
  }
  return { state: "failed", reason: `fal 폴링 예산 초과(${Math.round(budgetMs / 1000)}s)`, requestId: s.requestId };
}
