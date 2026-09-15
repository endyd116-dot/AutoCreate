/**
 * lib/ai-verify.ts — 모델 **실측 4종**(text·json강제·googleSearch·image) 한 곳(CLAUDE §4.9 «우리 키로 불러 보고 넣는다»).
 *   🔴 크론(lib/cron/ai-model-watch.ts)과 스크립트(scripts/verify-ai-models.mjs)가 **같은 함수**를 부른다 — 판정 한 벌(메인 결정 1).
 *   🔴 순수 함수다 — DB·callGemini·프로젝트 의존 0(전역 fetch 만). 그래서 standalone .mjs 에서도 그대로 import 해 쓴다(Node 24 타입 스트립).
 *   세 값(AC-9): true=됨 · false=모델이 거부(미지원) · null=판정 불가(예산/네트워크). 지어내지 않는다.
 *   🔴 모델 이름 문자열은 여기서 만들지 않는다 — 인자로 받은 model 만 부른다(이름의 출처는 ai-models.ts·models.list).
 *   🔎 출처: AC 신규(계약 P1R4-B2 · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
export type Tri = boolean | null;
export interface ModelTest { text: Tri; json: Tri; googleSearch: Tri; image: Tri }

interface GenResp { candidates?: { content?: { parts?: { text?: string; inlineData?: unknown; inline_data?: unknown }[] } }[] }
function parts(j: unknown): { text?: string; inlineData?: unknown; inline_data?: unknown }[] {
  return (j as GenResp)?.candidates?.[0]?.content?.parts ?? [];
}
function joinText(j: unknown): string { return parts(j).map((p) => p?.text ?? "").join(""); }

/** 직접 fetch — 200+want()=true · 4xx(모델 거부)=false · 그 외/네트워크/예산=null. */
async function probe(model: string, apiKey: string, body: unknown, deadline: number, want: (j: unknown) => boolean): Promise<Tri> {
  const ms = deadline - Date.now();
  if (!apiKey || ms < 2_000) return null;
  try {
    const r = await fetch(`${GEMINI_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(Math.min(12_000, ms)) });
    if (r.status === 200) { const j = await r.json().catch(() => null); return want(j); }
    if (r.status >= 400 && r.status < 500) return false;   // 모델이 거부 = 미지원
    return null;                                           // 5xx 등 = 판정 불가
  } catch { return null; }                                 // 타임아웃/네트워크 = 판정 불가
}

/**
 * 모델 하나를 실측 4종. deadline 미지정이면 30초.
 *   🔴 [R8 · §3.3] **키는 호출부가 골라서 넘긴다**(`opts.apiKey`) — 고르는 자리는 `lib/ai-key.ts` **하나**다.
 *      이 파일이 그걸 직접 import 하지 않는 이유는 위 헤더의 «import 0» 때문이다:
 *      `scripts/verify-ai-models.mjs` 가 이 파일을 **Node 타입 스트립으로 그대로 로드**해서, 확장자 없는 import 가 있으면 깨진다.
 *      ⇒ 부르는 쪽 둘(`lib/cron/ai-model-watch.ts` · `scripts/verify-ai-models.mjs`)이 `leaseAiKey()` 로 골라 넘긴다.
 *   아래 env 폴백은 **아무도 안 넘겼을 때의 마지막 줄**이다(옛 호출부 무회귀). `GEMINI_API_KEYS` 만 꽂은 집에서는
 *   이 폴백이 비므로, 새 호출부는 반드시 `opts.apiKey` 를 넘긴다.
 */
export async function verifyModel(model: string, opts: { apiKey?: string; deadline?: number } = {}): Promise<ModelTest> {
  const apiKey = String(opts.apiKey ?? process.env.GEMINI_API_KEY ?? "").trim();
  const deadline = opts.deadline ?? Date.now() + 30_000;
  const t: ModelTest = { text: null, json: null, googleSearch: null, image: null };
  const hasText = (j: unknown) => parts(j).some((p) => typeof p?.text === "string" && p.text.length > 0);

  // 🔴 maxOutputTokens 를 넉넉히(256) + thinkingBudget:0. 작게 주면 사고형 모델이 예산을 사고에 다 써 «본문 0» 으로 200 을 돌려
  //    text 가 거짓 ✗ 가 된다(2026-09-14 실측으로 잡음 · gemini-3.8-flash 가 그랬다). 프로젝트 flash 호출과 같은 설정.
  t.text = await probe(model, apiKey, { contents: [{ role: "user", parts: [{ text: "한 단어로만 답해: 하늘은 무슨 색?" }] }], generationConfig: { maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } } }, deadline, hasText);
  t.json = await probe(model, apiKey, { contents: [{ role: "user", parts: [{ text: '사과 색을 {"color":"..."} JSON 으로만.' }] }], generationConfig: { responseMimeType: "application/json", maxOutputTokens: 256, thinkingConfig: { thinkingBudget: 0 } } }, deadline,
    (j) => {
      const txt = joinText(j).replace(/^\s*```[a-zA-Z]*\s*\n?/, "").replace(/\n?\s*```\s*$/, "").trim();
      if (!txt) return false;
      try { JSON.parse(txt); return true; } catch { return false; }
    });
  t.googleSearch = await probe(model, apiKey, { contents: [{ role: "user", parts: [{ text: "오늘 서울 날씨를 한 줄로 요약해." }] }], tools: [{ google_search: {} }] }, deadline,
    (j) => parts(j).some((p) => typeof p?.text === "string" && p.text.length > 0));
  t.image = await probe(model, apiKey, { contents: [{ role: "user", parts: [{ text: "a single red apple, plain white background" }] }], generationConfig: { responseModalities: ["IMAGE"] } }, deadline,
    (j) => parts(j).some((p) => p?.inlineData || p?.inline_data));
  return t;
}
