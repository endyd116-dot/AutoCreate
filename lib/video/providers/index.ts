/**
 * lib/video/providers/index.ts — 컷 1개 생성의 단일 입구: provider 호출 → 결과 mp4 회수 → R2 저장 → ai_usage(purpose 'video_clip').
 *   AM 관례(video-clips.ts «임시 CDN 은 즉시 R2 로 회수»)를 AC r2.ts 로. 폴백 사다리(registry.fallbackProvider) 1단 · 정책 위반(P0)은 폴백하지 않는다(같은 프롬프트는 어디서도 막힌다).
 *   🔴 환각 0 규칙: i2v 입력에 인물 식별 사진 금지(PIPA — 호출부 게이트) · 프롬프트에 무인물 절(NO_REAL_PERSON) 은 scenes 가 붙인다.
 *   🔎 AM 원본: ../AutoMarketing/lib/video-clips.ts (관례 이식 2026-09-15)
 */
import { calcCost } from "../../ai-cost";
import { recordAiUsage } from "../../ai";
import { leaseAiKey, reportAiKeyOutcome, isRateLimitReason, redactKeys } from "../../ai-key";   // [R8 · §3.3] 키를 고르는 자리 한 곳 — 🔴 `GEMINI_API_KEYS` 만 꽂은 집에서 여기가 env 를 직접 읽으면 «키 없음»으로 죽는다
import { r2Configured, r2Put, safeKey } from "../../r2";
import { PROVIDERS, estimateClipCostUsd, fallbackProvider, type ProviderSpec } from "./registry";
import { omniGenerate, omniEditRetry, type OmniGenerateResult } from "./omni";
import { veoGenerate } from "./veo";
import { falGenerate } from "./fal";
import { generateImage } from "../../ai-image";
import { videoStub, noteVideoStub, type ProviderKey, type VideoSeconds } from "../types";

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
  /* [R8 · §3.3] 🔴 키는 `lib/ai-key.ts` 가 고른다(글·사진과 같은 풀). 여기서 env 를 직접 읽으면
     `GEMINI_API_KEYS` 만 꽂은 집에서 영상만 «키 없음»으로 죽는다. */
  const keyLease = leaseAiKey();
  const apiKey = keyLease?.key ?? "";
  if (!r2Configured()) return { ok: false, reason: "r2_not_configured", provider: inp.providerKey };
  if (videoStub()) {
    // 로컬 하니스(계약 §1.4b) — provider 호출 없이 고정 응답. R2 에는 «스텁» 표식이 든 자리 채움 바이트를 둔다(키가 없으면 payload 가 거짓말이 된다).
    noteVideoStub("video_clip", "컷 영상 자체(Veo/fal) · 그림 품질 · 심사 비전이 볼 프레임", "VIDEO_PROVIDER_STUB=1", "VIDEO_PROVIDER_STUB 을 끈다(🔴 건당 수 달러 — 2026-09-15 $3.63)");
    const key = safeKey(`autocreate/${inp.tenantId}/${inp.pieceId}/clips`, "mp4");
    const buf = Buffer.concat([Buffer.from("ACSTUBMP4\n", "utf8"), Buffer.alloc(12_000)]);
    try { await r2Put(key, buf, "video/mp4"); } catch (e) { return { ok: false, reason: `r2_put_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`, provider: inp.providerKey }; }
    void recordAiUsage({ tenantId: inp.tenantId, purpose: "video_clip", model: "stub", inTokens: 0, outTokens: 0, costUsd: 0, ref: inp.ref ?? `piece:${inp.pieceId}:cut${inp.cutIdx}` });
    return { ok: true, key, url: key, provider: inp.providerKey, model: "stub", costUsd: 0, durationSec: inp.durationSec };
  }
  let spec: ProviderSpec | null = PROVIDERS[inp.providerKey];
  let tried = 0;
  while (spec && tried < 2) {
    tried++;
    if (spec.gateway !== "fal" && !apiKey) return { ok: false, reason: "no_api_key", provider: spec.key };
    if (inp.mode === "i2v" && !spec.i2v) { spec = fallbackProvider(spec.key); continue; }
    const r = await callProvider(spec, inp, apiKey);
    /* 🔴 [R8 · §3.3] 빌렸으면 **결과를 돌려준다** — 안 알려 주면 쉬는 키가 영영 안 생겨 로테이션이 장식이 된다.
       429·할당량만 그 키를 쉬게 한다(정책 차단·모델 거부는 키 잘못이 아니다). */
    if (spec.gateway !== "fal") reportAiKeyOutcome(keyLease, r.ok ? "ok" : isRateLimitReason(r.reason) ? "rate_limited" : "error");
    if (!r.ok) {
      console.warn(`[video/providers] ${spec.key} 컷 ${inp.cutIdx} 실패: ${redactKeys(r.reason)}`);
      /* 🔴 [2026-09-21 B · drizzle/0084] **여기가 첫 번째 새던 자리다.** 여태 실패하면 그냥 폴백으로 넘어가서
         `ai_usage` 에 **한 줄도 안 남았다** — 폴백이 일어나면 provider 를 **둘 불렀는데 원장엔 한 줄**이었다.
         🔴 제공사가 에러를 낸 호출을 **청구하는지 우리는 모른다** ⇒ `costUsdMaybe` 를 **안 넘긴다(= NULL · 못 쟀음)**.
            여기서 0 을 적으면 «안 나갔다»가 되어 거짓이 된다(AC-9). */
      void recordAiUsage({ tenantId: inp.tenantId, purpose: "video_clip:fail", model: spec.model, inTokens: 0, outTokens: 0,
        costUsd: 0, failKind: "provider_failed", ref: inp.ref ?? `piece:${inp.pieceId}:cut${inp.cutIdx}` });
      if (r.policyBlocked) return { ok: false, reason: r.reason, policyBlocked: true, provider: spec.key };
      spec = inp.edit ? null : fallbackProvider(spec.key);   // 편집 재생성은 폴백 없음(같은 interaction 이 없다)
      continue;
    }
    /* 🔴 여기서부터 제공사는 **영상을 다 만들어 줬다** — 아래 두 실패는 «제공사 실패»가 아니라 **우리 쪽 사고**이고,
       그래서 **확실히 청구된다**. 금액을 아는 자리라 `costUsdMaybe` 에 **숫자를 적는다**(NULL 이 아니다). */
    const billed = spec.gateway === "omni" ? Math.round(inp.durationSec * 0.10 * 1000) / 1000 : estimateClipCostUsd(spec, inp.durationSec);
    const bytes = await fetchBytes(r.videoUrl);
    if (!bytes || bytes.length < 10_000) {
      // 🔴 두 번째 새던 자리 — 만들어진 영상을 **우리가 못 받아 왔다**. 돈은 이미 나갔다.
      void recordAiUsage({ tenantId: inp.tenantId, purpose: "video_clip:fail", model: spec.model, inTokens: 0, outTokens: 0,
        costUsd: 0, failKind: "download_failed", costUsdMaybe: billed, ref: inp.ref ?? `piece:${inp.pieceId}:cut${inp.cutIdx}` });
      return { ok: false, reason: "clip_download_failed", provider: spec.key };
    }
    const key = safeKey(`autocreate/${inp.tenantId}/${inp.pieceId}/clips`, "mp4");
    try { await r2Put(key, bytes, "video/mp4"); } catch (e) {
      // 🔴 세 번째 새던 자리 — 다 받아 놓고 **우리 저장소에 못 넣었다**. 돈은 이미 나갔다.
      void recordAiUsage({ tenantId: inp.tenantId, purpose: "video_clip:fail", model: spec.model, inTokens: 0, outTokens: 0,
        costUsd: 0, failKind: "store_failed", costUsdMaybe: billed, ref: inp.ref ?? `piece:${inp.pieceId}:cut${inp.cutIdx}` });
      return { ok: false, reason: `r2_put_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`, provider: spec.key };
    }
    const costUsd = billed;
    void recordAiUsage({ tenantId: inp.tenantId, purpose: "video_clip", model: spec.model, inTokens: 0, outTokens: Math.round(costUsd * 1_000_000 / 30), costUsd: costUsd || calcCost(spec.model, 0, 0), ref: inp.ref ?? `piece:${inp.pieceId}:cut${inp.cutIdx}` });
    return { ok: true, key, url: key, provider: spec.key, model: spec.model, interactionId: r.interactionId, costUsd, durationSec: inp.durationSec };
  }
  return { ok: false, reason: "no_provider_available", provider: inp.providerKey };
}

/* ═══════════ 정지 이미지 컷(계약 §1.4c(2) · 토킹 포맷) ═══════════
 *   🔴 스킵하지 않는다 — 스킵하면 러너가 `clipKey`·`imageKey` 둘 다 없는 장면을 받아 **검은 화면**이 된다(계약 §2.1 «둘 중 하나»).
 *   경로 = 조사 §F `CHAIN_IMAGE`($0.04/장 · `lib/ai-image.ts` 재사용 · ai_usage purpose 'image') → 러너가 Ken Burns 로 움직인다. */
export interface GenerateStillInput { tenantId: number; pieceId: number; cutIdx: number; prompt: string; ref?: string }
export type GenerateStillResult = { ok: true; key: string; model: string; costUsd: number } | { ok: false; reason: string };

/** 컷 프롬프트에서 카메라 워크 절을 뺀다 — 정지 한 장에 «push-in» 을 시키면 모델이 흔들린 그림을 낸다. */
export function stillPromptOf(prompt: string): string {
  return String(prompt || "").split("\n").filter((l) => !/^\s*CAMERA\b/i.test(l)).join("\n").trim();
}

export async function generateStill(inp: GenerateStillInput): Promise<GenerateStillResult> {
  if (!r2Configured()) return { ok: false, reason: "r2_not_configured" };
  const ref = inp.ref ?? `piece:${inp.pieceId}:still${inp.cutIdx}`;
  if (videoStub()) {
    noteVideoStub("video_still", "정지 컷 그림(1×1 투명 PNG 가 들어간다)", "VIDEO_PROVIDER_STUB=1", "VIDEO_PROVIDER_STUB 을 끈다");
    const key = safeKey(`autocreate/${inp.tenantId}/${inp.pieceId}/stills`, "png");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    try { await r2Put(key, png, "image/png"); } catch (e) { return { ok: false, reason: `r2_put_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
    void recordAiUsage({ tenantId: inp.tenantId, purpose: "image", model: "stub", inTokens: 0, outTokens: 0, costUsd: 0, ref });
    return { ok: true, key, model: "stub", costUsd: 0 };
  }
  const r = await generateImage({ prompt: stillPromptOf(inp.prompt), aspect: "9:16", tenantId: inp.tenantId, ref, keyPrefix: `autocreate/${inp.tenantId}/${inp.pieceId}/stills`, timeoutMs: 90_000 });
  if (!r.ok) { console.warn(`[video/providers] 정지 컷 ${inp.cutIdx} 실패: ${r.reason}`); return { ok: false, reason: r.reason }; }
  return { ok: true, key: r.key, model: r.model, costUsd: r.costUsd };
}
