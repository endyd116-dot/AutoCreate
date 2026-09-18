/**
 * lib/text-style-read.ts — **AI 비전이 캡처를 읽는다 → 숫자·목록만**(R10-2 · 설계 §3.4 · B · 2026-09-16).
 *   🔎 출처: AC 신규 — 호출 관례는 `lib/video/reference.ts analyzeReference`(callGeminiJson · 모델 체인 · ai_usage 공짜로 얻는다)를 따랐다.
 *
 *   · 캡처는 `inlineImages` 로 모델에 실린다(`lib/ai.ts` · text 파트보다 앞 · 응답 캐시는 안 탄다).
 *   · 🔴 **실호출 금지 지시(트리거)** — 로컬 `AI_STUB=1` 이면 예시 JSON(`TEXT_STYLE_RAW_EXAMPLE`)을 돌려준다(원가 0 · ai_usage 0). 배포 런타임에서는 스텁이 안 켜진다(`lib/ai-stub.ts` 안전핀).
 *   · 여기서 돌려주는 것은 **raw** 다 — 소독은 저장 직전 `createTextStyle` 한 곳에서(문이 하나 · §3.5). 이 파일은 모델 응답을 믿지 않는다.
 *   · 복붙(paste)은 글자만 보내므로 꾸밈·사진을 못 본다 — 프롬프트가 그 사실을 말하고, 저장은 `learned.measured` 로 «못 쟀다»를 든다.
 */
import { callGeminiJson } from "./ai";
import { MODEL_VISION } from "./ai-models";
import { aiStubActive } from "./ai-stub";
import { TEXT_STYLE_PROMPT, TEXT_STYLE_RAW_EXAMPLE } from "./text-style";

export interface StyleShot { mime: string; data: string; h?: number; i?: number }
export type ReadResult = { ok: true; raw: unknown; model: string } | { ok: false; error: string };

/** 캡처 여러 장 → raw. 장수·순서만 프롬프트에 말한다(주소·제목은 안 보낸다 — 모델에게도 «어디 글인지»는 필요 없다). */
export async function readTextStyleFromShots(tenantId: number, shots: StyleShot[], opts: { ref?: string } = {}): Promise<ReadResult> {
  if (!shots.length) return { ok: false, error: "읽을 화면이 없어요." };
  /* 🔴 [2026-09-19 수리 3판 · C `verify-stub-silence` · AC-111] **가짜를 돌려줬으면 말한다.**
     옛 판은 `model:"stub"` 이라는 **값으로만** 말했다 — 그 값을 읽는 사람이 없으면 «고정 표본이 들어갔다»는 사실이
     **어디에도 안 남는다.** 화면엔 진짜로 배워 온 것처럼 보인다. 같은 파일 묶음의 `lib/ai.ts` 관례(`[ai-stub]`)로 찍는다. */
  if (aiStubActive()) {
    console.info(`[ai-stub] text_style(캡처 ${shots.length}장) — 고정 응답(실호출 0 · 원가 0 · ai_usage 0). 🔴 못 재는 것: 이 글의 진짜 문단·강조·사진 모양(표본이 대신 들어간다). 진짜로 보려면 AI_STUB 을 끄세요.`);
    return { ok: true, raw: TEXT_STYLE_RAW_EXAMPLE, model: "stub" };
  }
  const user = [TEXT_STYLE_PROMPT, "", `캡처 ${shots.length}장(위에서 아래로 · 조각은 10~15% 겹친다 — 겹친 문단은 한 번만 센다). 폰 폭이라 한 줄이 짧다 — 줄 수는 보이는 그대로 센다.`].join("\n");
  const r = await callGeminiJson<Record<string, unknown>>({
    purpose: "text_style", chain: [MODEL_VISION], user, inlineImages: shots.map((s) => ({ mime: s.mime, data: s.data })),
    tenantId, ref: opts.ref ?? `style:${tenantId}:${Date.now()}`, mode: "flash", temperature: 0.2, maxOutputTokens: 3000, timeoutMs: 90_000,
  });
  if (!r.ok) return { ok: false, error: `화면을 읽지 못했어요(${r.reason.slice(0, 80)}). 다시 해 보거나 화면을 직접 찍어 올려 주세요.` };
  return { ok: true, raw: r.data, model: r.model };
}

/** 복붙 글 → raw(꾸밈·사진은 못 본다 · 마지막 예비). 🔴 본문은 모델에 보내고 **저장하지 않는다**(소독기가 문장을 안 받는다). */
export async function readTextStyleFromText(tenantId: number, text: string, opts: { ref?: string } = {}): Promise<ReadResult> {
  const t = String(text ?? "").trim();
  if (t.length < 200) return { ok: false, error: "글이 너무 짧아요 — 200자는 넘어야 모양을 잴 수 있어요." };
  /* 🔴 위와 같다 — 복붙 길은 꾸밈·사진을 애초에 못 보는데다 스텁까지 타면 **두 겹으로 가짜**다. 그러니 더 말해야 한다. */
  if (aiStubActive()) {
    console.info(`[ai-stub] text_style(복붙 ${t.length}자) — 고정 응답(실호출 0 · 원가 0 · ai_usage 0). 🔴 못 재는 것: 문단·말투·구성까지 전부 표본이다(강조·사진은 복붙이라 원래도 0). 진짜로 보려면 AI_STUB 을 끄세요.`);
    return { ok: true, raw: { ...TEXT_STYLE_RAW_EXAMPLE, shape: { ...TEXT_STYLE_RAW_EXAMPLE.shape, emphasis: { kinds: [], perPost: 0, on: [] }, photos: { count: 0, where: [], captionRate: 0, kinds: [] } } }, model: "stub" };
  }
  const user = [TEXT_STYLE_PROMPT, "", "아래는 복붙한 글(꾸밈·사진은 날아갔다 — 강조·사진 칸은 0 으로 두고 문단·말투·구성만 잰다):", "─────", t.slice(0, 12_000), "─────"].join("\n");
  const r = await callGeminiJson<Record<string, unknown>>({
    purpose: "text_style", chain: [MODEL_VISION], user, tenantId, ref: opts.ref ?? `style:${tenantId}:${Date.now()}`, mode: "flash", temperature: 0.2, maxOutputTokens: 3000, timeoutMs: 60_000,
  });
  if (!r.ok) return { ok: false, error: `글을 읽지 못했어요(${r.reason.slice(0, 80)}). 잠시 뒤 다시 해 주세요.` };
  return { ok: true, raw: r.data, model: r.model };
}
