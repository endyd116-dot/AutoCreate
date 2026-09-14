/**
 * lib/video/providers/index.ts — 컷 1개 생성의 단일 입구: provider 호출 → 결과 mp4 회수 → R2 저장 → ai_usage(purpose 'video_clip').
 *   AM 관례(video-clips.ts «임시 CDN 은 즉시 R2 로 회수»)를 AC r2.ts 로. 폴백 사다리(registry.fallbackProvider) 1단 · 정책 위반(P0)은 폴백하지 않는다(같은 프롬프트는 어디서도 막힌다).
 *   🔴 환각 0 규칙: i2v 입력에 인물 식별 사진 금지(PIPA — 호출부 게이트) · 프롬프트에 무인물 절(NO_REAL_PERSON) 은 scenes 가 붙인다.
 */
import { calcCost } from "../../ai-cost";
import { recordAiUsage } from "../../ai";
import { r2Configured, r2Put, safeKey } from "../../r2";
import { PROVIDERS, estimateClipCostUsd, fallbackProvider, type ProviderSpec } from "./registry";
import { omniGenerate, omniEditRetry, type OmniGenerateResult } from "./omni";
import { veoGenerate } from "./veo";
import { falGenerate } from "./fal";
import type { ProviderKey, VideoSeconds } from "../types";

export interface GenerateClipInput {
  tenantId: number; pieceId: number; cutIdx: number;
  prompt: string; providerKey: ProviderKey; seconds: VideoSeconds; durationSec: number;
  mode: "t2v" | "i2v"; imageBase64?: string | null; imageMime?: string | null; imageUrl?: string | null;
  /** 편집 재생성(Omni) — 직전 interaction id + 수정 지시. */
  edit?: { previousInteractionId: string | null; fix: string } | null;
  ref?: string;
}
export type GenerateClipResult =
  | { ok: true; key: string; url: string; provider: ProviderKey; model: string; interactionId?: string; costUsd: number; durationSec: number }
  | { ok: false; reason: string; policyBlocked?: boolean; provider: ProviderKey };

async function fetchBytes(url: string, timeoutMs = 120_000): Promise<Buffer | null> {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try { const r = await fetch(url, { signal: ctrl.signal }); if (!r.ok) return null; return Buffer.from(await r.arrayBuffer()); }
  catch { return null; } finally { clearTimeout(t); }
}

async function callProvider(spec: ProviderSpec, inp: GenerateClipInput, apiKey: string): Promise<{ ok: true; videoUrl: string; interactionId?: string } | { ok: false; reason: string; policyBlocked?: boolean }> {
  if (spec.gateway === "omni") {
    const r: OmniGenerateResult = inp.edit ? await omniEditRetry(apiKey, inp.edit.previousInteractionId, inp.prompt, inp.edit.fix) : await omniGenerate({ apiKey, input: inp.prompt, aspectRatio: "9:16", resolution: "720p" });
    if (!r.ok || !r.videoUrl) return { ok: false, reason: r.reason ?? "omni_failed", policyBlocked: r.policyBlocked };
    return { ok: true, videoUrl: r.videoUrl, interactionId: r.interactionId };
  }
  if (spec.gateway === "gemini") {
    const r = await veoGenerate({ provider: spec, apiKey, prompt: inp.prompt, imageBase64: inp.mode === "i2v" ? inp.imageBase64 : null, imageMime: inp.imageMime, durationSec: inp.durationSec, aspectRatio: "9:16" });
    if (r.state !== "done" || !r.videoUrl) return { ok: false, reason: r.reason ?? "veo_failed", policyBlocked: /safety|policy|blocked/i.test(String(r.reason ?? "")) };
    return { ok: true, videoUrl: r.videoUrl };
  }
  const r = await falGenerate({ provider: spec, prompt: inp.prompt, imageUrl: inp.mode === "i2v" ? inp.imageUrl : null, durationSec: inp.durationSec, aspectRatio: "9:16" });
  if (r.state !== "done" || !r.videoUrl) return { ok: false, reason: r.reason ?? "fal_failed" };
  return { ok: true, videoUrl: r.videoUrl };
}

/** generateClip — provider 호출 → mp4 회수 → R2 `autocreate/{tid}/{pieceId}/clips/…` → 비용 기록. 실패 시 사다리 1단 폴백(정책 차단 제외). */
export async function generateClip(inp: GenerateClipInput): Promise<GenerateClipResult> {
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!r2Configured()) return { ok: false, reason: "r2_not_configured", provider: inp.providerKey };
  let spec: ProviderSpec | null = PROVIDERS[inp.providerKey];
  let tried = 0;
  while (spec && tried < 2) {
    tried++;
    if (spec.gateway !== "fal" && !apiKey) return { ok: false, reason: "no_api_key", provider: spec.key };
    if (inp.mode === "i2v" && !spec.i2v) { spec = fallbackProvider(spec.key); continue; }
    const r = await callProvider(spec, inp, apiKey);
    if (!r.ok) {
      console.warn(`[video/providers] ${spec.key} 컷 ${inp.cutIdx} 실패: ${r.reason}`);
      if (r.policyBlocked) return { ok: false, reason: r.reason, policyBlocked: true, provider: spec.key };
      spec = inp.edit ? null : fallbackProvider(spec.key);   // 편집 재생성은 폴백 없음(같은 interaction 이 없다)
      continue;
    }
    const bytes = await fetchBytes(r.videoUrl);
    if (!bytes || bytes.length < 10_000) return { ok: false, reason: "clip_download_failed", provider: spec.key };
    const key = safeKey(`autocreate/${inp.tenantId}/${inp.pieceId}/clips`, "mp4");
    try { await r2Put(key, bytes, "video/mp4"); } catch (e) { return { ok: false, reason: `r2_put_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`, provider: spec.key }; }
    const costUsd = spec.gateway === "omni" ? Math.round(inp.durationSec * 0.10 * 1000) / 1000 : estimateClipCostUsd(spec, inp.durationSec);
    void recordAiUsage({ tenantId: inp.tenantId, purpose: "video_clip", model: spec.model, inTokens: 0, outTokens: Math.round(costUsd * 1_000_000 / 30), costUsd: costUsd || calcCost(spec.model, 0, 0), ref: inp.ref ?? `piece:${inp.pieceId}:cut${inp.cutIdx}` });
    return { ok: true, key, url: key, provider: spec.key, model: spec.model, interactionId: r.interactionId, costUsd, durationSec: inp.durationSec };
  }
  return { ok: false, reason: "no_provider_available", provider: inp.providerKey };
}
