/**
 * lib/ai-image.ts — Gemini 이미지 생성 → R2 업로드 → 공개 URL. AM 원본: ../AutoMarketing/lib/creative-image-gen.ts (호출 본문 발췌 2026-09-14 · 편집·참조이미지·띠 검출은 뺐다)
 *   generateImage({ prompt, aspect, tenantId, ref }) → CHAIN_IMAGE 순서 폴백 → PNG bytes → r2Put → { url, key }.
 *   🔴 시스템 규칙 고정(DESIGN §5C.3·§19): 이미지 안에 **한글/문자 굽지 않기** · 실존 인물 실사 금지 · 브랜드 로고 금지 · 상품 이미지는 API 제공분만.
 *   비용: ai_usage(purpose "image") — 장당 출력 토큰 기준(ai-cost 표).
 *   graceful: 실패 { ok:false, reason } — 호출부가 «이미지 없음»으로 진행할지 정한다(생성 함수는 실패 시 piece failed).
 */
import { CHAIN_IMAGE } from "./ai-models";
import { calcCost } from "./ai-cost";
import { recordAiUsage, resolveChain } from "./ai";
import { r2Configured, r2Put, safeKey } from "./r2";
import { aiStubImagesActive, aiStubImage, AI_STUB_MODEL } from "./ai-stub";   // [R8 §2.1] 사진만 고정 응답(글 실험에서 값의 85%를 버리지 않게)

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
/** Gemini 이미지가 받는 비율 값(그 외는 보내지 않는다 — 400 방지). */
const GEMINI_ASPECTS = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"]);

export type ImageAspect = "1:1" | "4:3" | "9:16" | "16:9" | "3:4";

/** 고정 규칙 — 프롬프트 앞에 항상 붙는다. 한글 텍스트 요구 금지·실존 인물·로고 금지. */
export const IMAGE_SYSTEM_RULES = [
  "Photorealistic or clean illustration for a Korean lifestyle blog post.",
  "Absolutely NO text, letters, numbers, captions, watermarks, or signage of any language inside the image.",
  "No real people's likeness, no celebrities, no identifiable faces of real persons; no brand logos or trademarks.",
  "Natural Korean everyday setting (home, street, shop, nature) when a place is implied; realistic lighting; no collage or split panels.",
].join(" ");

export interface GenerateImageArgs {
  prompt: string;
  aspect?: ImageAspect;
  tenantId?: number | null;
  ref?: string | null;
  /** R2 키 접두 — 기본 `autocreate/{tenantId}`(버킷은 AM·MIS 와 공유 siren-uploads · prefix 로 격리). */
  keyPrefix?: string;
  timeoutMs?: number;
}
export type GenerateImageResult =
  | { ok: true; url: string; key: string; model: string; mime: string; costUsd: number }
  | { ok: false; reason: string };

async function callImageModel(model: string, prompt: string, aspect: string | null, apiKey: string, timeoutMs: number):
  Promise<{ ok: true; b64: string; mime: string; inTok: number; outTok: number } | { ok: false; reason: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE"] };
    if (aspect && GEMINI_ASPECTS.has(aspect)) generationConfig.imageConfig = { aspectRatio: aspect };
    const resp = await fetch(`${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig }),
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return { ok: false, reason: `gemini_error_${resp.status}: ${t.slice(0, 160)}` };
    }
    const data = (await resp.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string }; inline_data?: { data?: string; mime_type?: string } }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const inTok = data.usageMetadata?.promptTokenCount ?? 0;
    const outTok = data.usageMetadata?.candidatesTokenCount ?? 1290;   // 미보고 시 장당 표준값(보수)
    for (const p of data.candidates?.[0]?.content?.parts ?? []) {
      const b64 = p.inlineData?.data ?? p.inline_data?.data;
      const mime = p.inlineData?.mimeType ?? p.inline_data?.mime_type ?? "image/png";
      if (b64) return { ok: true, b64, mime, inTok, outTok };
    }
    return { ok: false, reason: "empty_image" };
  } catch (e) {
    return { ok: false, reason: (e as Error)?.name === "AbortError" ? `timeout_${timeoutMs}ms` : `fetch_failed: ${String(e).slice(0, 120)}` };
  } finally { clearTimeout(timer); }
}

export async function generateImage(a: GenerateImageArgs): Promise<GenerateImageResult> {
  /* [R8 §2.1] 사진 대체 스위치(`AI_STUB_IMAGE=1` · 로컬 전용 · `lib/ai-stub.ts`) — R2 에도 아무것도 쓰지 않는다.
     🔴 `ai_usage` 에 적지 않는다(안 쓴 돈을 세지 않는다) · 원가 0 · 모델 «stub».
     🔴 이미지 **블록**은 그대로 둔다 — 블록을 빼면 `visual_min` 축이 걸려 실험에 잡음이 낀다. 끄는 것은 «굽기»뿐이다. */
  if (aiStubImagesActive()) {
    const st = aiStubImage();
    console.info("[ai-stub] image — 고정 응답(실호출 0 · 원가 0 · R2 쓰기 0)");
    return { ok: true, url: st.url, key: st.key, model: AI_STUB_MODEL, mime: st.mime, costUsd: 0 };
  }
  const apiKey = String(process.env.GEMINI_API_KEY ?? "").trim();
  if (!apiKey) return { ok: false, reason: "no_api_key" };
  if (!r2Configured()) return { ok: false, reason: "r2_not_configured" };
  const prompt = `${IMAGE_SYSTEM_RULES}\n\nScene: ${String(a.prompt || "").trim().slice(0, 1200)}`;
  const aspect = a.aspect && GEMINI_ASPECTS.has(a.aspect) ? a.aspect : "4:3";
  const chain = await resolveChain("image", CHAIN_IMAGE);
  let lastReason = "no_model";
  for (const model of chain) {
    const r = await callImageModel(model, prompt, aspect, apiKey, a.timeoutMs ?? 90_000);
    if (!r.ok) { lastReason = r.reason; console.warn(`[ai-image] ${model} 실패: ${r.reason}`); if (/401|403|no_api_key/.test(r.reason)) break; continue; }
    const costUsd = calcCost(model, r.inTok, r.outTok);
    /* 🔴 AC-36 — 돈 기록은 **await**(이미지는 원가의 85%다 · 메인 실측 2026-09-15: 글 3편 $0.98 중 사진 18장이 $0.83).
       이미지 생성 자체가 수 초라 쓰기 한 번은 체감이 없고, 새면 «썼는데 원장에 없는 돈»이 된다(`reconcilePieceCost` 는 그물이지 정본이 아니다). */
    await recordAiUsage({ tenantId: a.tenantId, purpose: "image", model, inTokens: r.inTok, outTokens: r.outTok, costUsd, ref: a.ref });
    const ext = r.mime.includes("jpeg") || r.mime.includes("jpg") ? "jpg" : r.mime.includes("webp") ? "webp" : "png";
    const key = safeKey(a.keyPrefix || `autocreate/${a.tenantId ?? 0}`, ext);
    try {
      const put = await r2Put(key, Buffer.from(r.b64, "base64"), r.mime);
      return { ok: true, url: put.url, key, model, mime: r.mime, costUsd };
    } catch (e) { return { ok: false, reason: `r2_put_failed: ${String((e as Error)?.message ?? e).slice(0, 120)}` }; }
  }
  return { ok: false, reason: lastReason };
}
