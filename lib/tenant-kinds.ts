/**
 * lib/tenant-kinds.ts — «이 집이 무엇을 만드나»(글 · 영상) 한 곳.
 *
 *   🔴 **정본을 `lib/` 로 옮긴 까닭**(2026-09-21 B): 이 판정이 `netlify/functions/tenant-settings.ts` 안에 있어서,
 *      `lib/director.ts` 가 쓰려면 **lib → netlify/functions** 로 층을 거꾸로 타야 했다(리포에 그런 임포트는 0곳이었다).
 *      판정은 `lib/` 에 두고 문(handler)이 가져다 쓴다 — 옛 임포트 자리는 재수출로 그대로 산다(소급 0).
 *
 *   🔎 출처: AC 신규 — `netlify/functions/tenant-settings.ts`(R7 §1.1)에서 옮겨 옴. 규칙은 **글자 그대로** 유지.
 */

/**
 * [R7 §1.1] `kinds` 정규화 — 🔴 «글»은 밑바탕이라 **항상 남는다**(영상만 켜고 글을 끄는 길은 없다 · 끄면 만들 게 없어진다).
 *   저장된 값이 없거나 이상하면 `["text"]`(= 영상 꺼짐)로 본다 — **온보딩을 안 거친 테넌트도 토글이 보이고 꺼짐으로 표시된다**(§1.1).
 *   덮어쓰기 금지: 화면이 `{ kinds:["text","video"] }` 를 보내든 `{ kinds:["video"] }` 를 보내든 결과는 병합된 정규형이다.
 */
export function normalizeKinds(raw: unknown): ("text" | "video")[] {
  const list = Array.isArray(raw) ? raw.map(String) : [];
  return list.includes("video") ? ["text", "video"] : ["text"];
}

/**
 * 저장값 → 화면이 쓰는 모양(A §5.1).
 *   🔴 `kindsSet:false` = **온보딩을 안 거쳤다**(우리가 기본값을 보여 준 것) — «껐다»와 **다른 말**이다.
 *      둘을 뭉개면 화면이 «영상 꺼짐»이라고 단정하게 되고, 한 번도 안 물어 본 고객에게 **물을 기회가 사라진다**.
 */
export function kindsView(settings: Record<string, unknown>): { kinds: ("text" | "video")[]; kindsSet: boolean } {
  const has = Array.isArray(settings.kinds) && (settings.kinds as unknown[]).length > 0;
  return { kinds: normalizeKinds(settings.kinds), kindsSet: has };
}

/** 이 집이 영상을 켰나. 한 줄이지만 **묻는 자리가 늘 같게** 하려고 둔다(각자 `includes("video")` 를 적으면 규칙이 갈린다). */
export function videoOn(settings: Record<string, unknown>): boolean {
  return normalizeKinds(settings.kinds).includes("video");
}
