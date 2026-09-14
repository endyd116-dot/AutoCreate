/**
 * lib/video/providers/omni.ts — Gemini Omni(Interactions API) 어댑터 · 동기 ~35s · 대화형 편집 재생성.
 *   AM 원본: ../AutoMarketing/lib/video-providers/omni.ts (복사 2026-09-15 · 원본 5710e7faf 2026-09-03 · 무수정에 가까움 · 모델명은 ai-models)
 *   실측 계약(AM SHORTS1-C): 편집 왕복(previous_interaction_id)에는 video task 를 싣지 않는다(같이 보내면 400) · 새 생성은 task 명시.
 *   가격 ≈ $0.10/s → 8초 $0.80. 9:16/16:9 만(1:1 400). 정책 위반(P0)만 policyBlocked 로 표시 — 그 외 실패는 양산 철학대로 «통과 후보».
 */
import { MODEL_OMNI } from "../../ai-models";
import { assertProviderAllowed } from "./registry";

const INTERACTIONS_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
export const OMNI_USD_PER_SEC = 0.10;

export interface OmniGenerateInput { apiKey: string; input: string; previousInteractionId?: string | null; aspectRatio?: "9:16" | "16:9"; resolution?: "720p" | "1080p" }
export interface OmniGenerateResult { ok: boolean; interactionId?: string; videoUrl?: string; reason?: string; policyBlocked?: boolean }

function digUri(o: unknown): string | null {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): string | null => {
    if (!v || typeof v !== "object" || depth > 6 || seen.has(v)) return null;
    seen.add(v);
    const rec = v as Record<string, unknown>;
    for (const k of ["uri", "url", "video_uri", "videoUri", "file_uri", "fileUri"]) { const s = rec[k]; if (typeof s === "string" && /^https?:\/\//.test(s)) return s; }
    for (const val of Object.values(rec)) {
      if (Array.isArray(val)) { for (const it of val) { const r = walk(it, depth + 1); if (r) return r; } }
      else { const r = walk(val, depth + 1); if (r) return r; }
    }
    return null;
  };
  return walk(o, 0);
}
function digId(o: unknown): string | null {
  const rec = (o && typeof o === "object" ? o : {}) as Record<string, unknown>;
  for (const k of ["id", "interaction_id", "interactionId", "name"]) { const s = rec[k]; if (typeof s === "string" && s.trim()) return s.trim(); }
  return null;
}
const POLICY_RE = /safety|policy|blocked|prohibit|violat|harm/i;

/** omniGenerate — 컷 1개 동기 생성. */
export async function omniGenerate(input: OmniGenerateInput, timeoutMs = 120_000): Promise<OmniGenerateResult> {
  assertProviderAllowed("omni", MODEL_OMNI);
  if (!input.apiKey) return { ok: false, reason: "Gemini 키가 없어 Omni 생성을 건너뜁니다." };
  const isEdit = !!input.previousInteractionId;
  const body: Record<string, unknown> = {
    model: MODEL_OMNI,
    input: String(input.input ?? "").slice(0, 4000),
    ...(isEdit ? {} : { generation_config: { video_config: { task: "text_to_video" } } }),
    response_format: { type: "video", aspect_ratio: input.aspectRatio === "16:9" ? "16:9" : "9:16", resolution: input.resolution === "1080p" ? "1080p" : "720p", delivery: "uri" },
  };
  if (isEdit) body.previous_interaction_id = input.previousInteractionId;
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(`${INTERACTIONS_URL}?key=${input.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
    const txt = await resp.text();
    if (!resp.ok) return { ok: false, reason: `Omni HTTP ${resp.status}: ${txt.slice(0, 220)}`, ...(POLICY_RE.test(txt) ? { policyBlocked: true } : {}) };
    let o: unknown; try { o = JSON.parse(txt); } catch { return { ok: false, reason: `Omni 응답 JSON 아님: ${txt.slice(0, 160)}` }; }
    const uri = digUri(o); const id = digId(o);
    if (!uri) {
      const keys = o && typeof o === "object" ? Object.keys(o as object).join(",") : typeof o;
      return { ok: false, reason: `Omni 결과에 video uri 없음(응답 키: ${keys})`, ...(POLICY_RE.test(txt) ? { policyBlocked: true } : {}), ...(id ? { interactionId: id } : {}) };
    }
    return { ok: true, videoUrl: `${uri}${uri.includes("?") ? "&" : "?"}key=${input.apiKey}`, ...(id ? { interactionId: id } : {}) };
  } catch (e) { return { ok: false, reason: `Omni 예외: ${String((e as Error)?.message || e).slice(0, 200)}` }; }
  finally { clearTimeout(timer); }
}

/** omniEditRetry — «1회 대안 재생성»: 직전 interaction 을 수정 지시로 고친다(재프롬프트 0). id 없으면 원 프롬프트 + REVISION. */
export async function omniEditRetry(apiKey: string, previousInteractionId: string | null, originalPrompt: string, fixInstruction: string): Promise<OmniGenerateResult> {
  if (previousInteractionId) return omniGenerate({ apiKey, input: fixInstruction, previousInteractionId });
  return omniGenerate({ apiKey, input: `${originalPrompt}\n\nREVISION: ${fixInstruction}` });
}
