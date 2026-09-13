/**
 * lib/disclosure.ts — 광고·제휴 고지 정본 문구 + 첫 블록 고정 + 발행 직전 재검사(DESIGN §16B.2·§16B.4). AC 신규(2026-09-14 · 순수).
 *   정책 원문(확인일 2026-09-14):
 *     · 공정위 «추천·보증 등에 관한 표시·광고 심사지침»(2024-12 강화) — 본문 첫머리 · 본문과 같은 크기 이상 · 흐림 금지
 *     · 쿠팡 파트너스 공식 고지 문구 https://partners.coupang.com (활동 고지 의무)
 *   분기 1회 «정책 재확인» 운영 체크리스트(§16B.4).
 *   문구 변경은 운영자만(코드 상수).
 */
import type { Block } from "./blocks";

export const DISCLOSURE_TEXT = {
  coupang: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.",
  generic: "이 글에는 제휴 링크가 포함되어 있으며, 구매 시 일정 수수료를 받을 수 있습니다.",
  videoBadge: "광고 포함 · 파트너스 수수료",
  sponsored: "유료 광고 포함",
} as const;

export type DisclosureKind = keyof typeof DISCLOSURE_TEXT;

export function disclosureTextFor(provider: string | null | undefined): string {
  return provider === "coupang" ? DISCLOSURE_TEXT.coupang : DISCLOSURE_TEXT.generic;
}
export function disclosureBlock(provider: string | null | undefined): Block {
  return { type: "disclosure", text: disclosureTextFor(provider) };
}

/** 고지 문구인지(정본 2종 중 하나를 포함). */
export function isDisclosureText(t: string | undefined): boolean {
  const s = String(t ?? "").replace(/\s+/g, "");
  return s.includes(DISCLOSURE_TEXT.coupang.replace(/\s+/g, "")) || s.includes(DISCLOSURE_TEXT.generic.replace(/\s+/g, ""));
}

/**
 * ensureDisclosureFirst — affiliate 면 blocks[0] 이 disclosure 블록(정본 문구)이 되게 강제. 중복은 제거. 사람이 지워도 다시 넣는다(§16B.4 «삭제 불가»).
 *   affiliate 아니면 disclosure 블록을 그대로 둔다(사용자가 협찬 고지를 넣었을 수 있다).
 */
export function ensureDisclosureFirst(blocks: Block[], affiliate: boolean, provider: string | null | undefined): Block[] {
  if (!affiliate) return blocks;
  const rest = blocks.filter((b) => b.type !== "disclosure");
  return [disclosureBlock(provider), ...rest];
}

export interface DisclosureCheck { ok: boolean; detail?: string }
/** checkDisclosure — 발행 직전 재검사: affiliate 면 첫 블록이 정본 문구인가 · 제휴 링크 블록이 있는데 고지가 없나. */
export function checkDisclosure(blocks: Block[], meta: { affiliate?: unknown; adDisclosure?: boolean } | null | undefined): DisclosureCheck {
  const hasAffiliateBlock = blocks.some((b) => b.type === "affiliate");
  const need = !!(meta?.affiliate) || meta?.adDisclosure === true || hasAffiliateBlock;
  if (!need) return { ok: true };
  const first = blocks[0];
  if (!first || first.type !== "disclosure") return { ok: false, detail: "제휴 고지가 본문 첫머리에 없어요." };
  if (!isDisclosureText(first.text)) return { ok: false, detail: "고지 문구가 정본과 달라요." };
  return { ok: true };
}

/** HTML 본문에서도 재검사(사람 수정 후 bodyHtml 이 정본일 때). 첫 의미 블록이 고지인가. */
export function checkDisclosureHtml(html: string, need: boolean): DisclosureCheck {
  if (!need) return { ok: true };
  const m = /<(p|div|blockquote|section)[^>]*class="[^"]*ac-disclosure[^"]*"[^>]*>([\s\S]*?)<\/\1>/i.exec(html);
  if (!m) return { ok: false, detail: "제휴 고지가 본문에 없어요." };
  const before = html.slice(0, m.index).replace(/<[^>]+>/g, "").trim();
  if (before.length > 0) return { ok: false, detail: "제휴 고지가 본문 첫머리가 아니에요." };
  if (!isDisclosureText(m[2].replace(/<[^>]+>/g, ""))) return { ok: false, detail: "고지 문구가 정본과 달라요." };
  return { ok: true };
}
