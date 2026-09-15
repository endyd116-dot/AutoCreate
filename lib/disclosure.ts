/**
 * lib/disclosure.ts — 광고·제휴 고지 정본 문구 + 첫 블록 고정 + 발행 직전 재검사(DESIGN §16B.2·§16B.4). AC 신규(2026-09-14 · 순수).
 *   정책 원문(재확인 2026-09-15 · 실조사 `docs/active/2026-09-15-R8A-voice-policy.md`):
 *     · 공정위 «추천·보증 등에 관한 표시·광고 심사지침» **2024-12-01 개정 시행** — 문자 매체는 **제목 또는 첫 부분** ·
 *       4원칙(표시 위치의 접근성 · 표현 형태의 인식 가능성 · 표시 내용의 명확성 · 사용 언어의 동일성).
 *       https://www.law.go.kr/LSW//admRulInfoP.do?admRulSeq=2100000190311
 *     · 🔴 **경제적 대가는 «제휴 수수료»만이 아니다** — «현금, 해당 상품, 상품권, 적립 포인트, 할인 혜택 … 구매링크 등을 통한
 *       매출실적에 따라 수수료를 받거나 구매 대금을 환급받는 경우». 그래서 이 파일의 축은 **대가 3종**이다:
 *       `affiliate`(수수료) · `sponsored`(현금·원고료·PPL) · `gift`(제품·서비스 무상 제공).
 *       🔴 R8-A §4 전까지는 `affiliate` 하나뿐이라 **협찬·무상 제공 글엔 고지가 아예 안 붙었다**(라이브 구멍 · 메인 지시로 수리).
 *     · 부적절한 표현(쓰지 않는다): «체험단» «체험 후기» «기자단» «내돈내산» «일주일동안 사용해 보았음» ·
 *       외국어 «AD» «PR» «Advertisement» «Thanks to» — 한국 소비자 대상이면 한글.
 *       https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1575&ccfNo=2&cciNo=3&cnpClsNo=1
 *     · 영상: «시작부분과 끝부분에 표시문구를 삽입하며 영상 중에 반복적으로» · «‘더보기’를 눌러야만 확인되는 경우는 부적절»
 *       → 우리는 **3초 자막 + 상시 배지 + 설명란 첫 줄** 3중(기준 초과).
 *     · 쿠팡 파트너스 공식 고지 문구 https://partners.coupang.com (1차 출처는 로그인 뒤 · §16B.4 분기 점검 항목).
 *   분기 1회 «정책 재확인» 운영 체크리스트(§16B.4). 문구 변경은 운영자만(코드 상수).
 */
import type { Block } from "./blocks";

/** [R8-A §4] 대가 3종 — 하나라도 참이면 고지가 켜진다(공정위 «경제적 이해관계»). */
export type CompensationKind = "affiliate" | "sponsored" | "gift";
export const COMPENSATION_LABEL: Readonly<Record<CompensationKind, string>> = {
  affiliate: "제휴 수수료", sponsored: "원고료·유료 광고", gift: "제품·서비스 무상 제공",
};
/** 화면·API 가 쓰는 입력 모양. `provider` 는 affiliate 일 때만 뜻이 있다. */
export interface Compensation { affiliate?: boolean; sponsored?: boolean; gift?: boolean; provider?: string | null }
/** 옛 호출부 호환 — 문자열(=provider)·null 이 오면 «제휴 1종»으로 읽는다(R8-A 전 코드는 affiliate 일 때만 불렀다). */
export type DisclosureInput = Compensation | string | null | undefined;

export const DISCLOSURE_TEXT = {
  /** affiliate · 쿠팡(공식 문구 전문). */
  coupang: "이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.",
  /** affiliate · 그 외 제휴. */
  generic: "이 글에는 제휴 링크가 포함되어 있으며, 구매 시 일정 수수료를 받을 수 있습니다.",
  /** [R8-A §4] sponsored — 현금·원고료·PPL. 본문에 «유료 광고»라고 그대로 쓴다(지침의 «명확성»). */
  sponsoredBody: "이 글은 광고주에게서 원고료 등 대가를 받고 작성한 유료 광고입니다.",
  /** [R8-A §4] gift — 제품·서비스 무상 제공. 🔴 «체험단»이라고 쓰지 않는다(지침이 부적절 예시로 든 낱말). */
  giftBody: "이 글은 광고주에게서 제품(또는 서비스)을 무상으로 제공받아 작성했습니다.",
  /** 영상 우상단 배지(짧은 형) — 종류별. */
  videoBadge: "광고 포함 · 파트너스 수수료",
  videoBadgeSponsored: "광고 포함 · 유료 광고",
  videoBadgeGift: "광고 포함 · 제품 제공",
  /** 짧은 라벨(화면 배지·목록용). */
  sponsored: "유료 광고 포함",
} as const;

export type DisclosureKind = keyof typeof DISCLOSURE_TEXT;

/** 입력을 «켜진 대가 종류 + provider» 로 정규화. 순서는 affiliate → sponsored → gift 고정(문구 순서가 흔들리지 않게). */
export function normalizeCompensation(input: DisclosureInput): { kinds: CompensationKind[]; provider: string | null } {
  if (input === null || input === undefined || typeof input === "string") return { kinds: ["affiliate"], provider: (input as string | null) ?? null };
  const kinds: CompensationKind[] = [];
  if (input.affiliate) kinds.push("affiliate");
  if (input.sponsored) kinds.push("sponsored");
  if (input.gift) kinds.push("gift");
  return { kinds, provider: input.provider ?? null };
}

/**
 * piece.meta → 대가 3종.
 *   🔴 **소급 0**: 종류 칸이 없던 옛 글은 `adDisclosure:true` 를 «제휴»로 읽는다 — 이미 나간 글의 뜻이 바뀌지 않게.
 */
export function compensationOfMeta(m: Record<string, unknown> | null | undefined): Compensation & { kinds: CompensationKind[]; need: boolean } {
  const meta = (m ?? {}) as Record<string, unknown>;
  const affObj = meta.affiliate ?? meta.affiliateLink ?? meta.affiliateHint ?? null;
  const sponsored = meta.sponsored === true;
  const gift = meta.gift === true;
  const affiliate = !!affObj || (meta.adDisclosure === true && !sponsored && !gift);
  const provider = (affObj && typeof affObj === "object" ? String((affObj as Record<string, unknown>).provider ?? "") : "") || null;
  const { kinds } = normalizeCompensation({ affiliate, sponsored, gift, provider });
  return { affiliate, sponsored, gift, provider, kinds, need: kinds.length > 0 };
}

/** 한 종류의 본문 문장. */
export function disclosureSentence(kind: CompensationKind, provider?: string | null): string {
  if (kind === "affiliate") return provider === "coupang" ? DISCLOSURE_TEXT.coupang : DISCLOSURE_TEXT.generic;
  return kind === "sponsored" ? DISCLOSURE_TEXT.sponsoredBody : DISCLOSURE_TEXT.giftBody;
}
/**
 * 본문 첫머리 고지 문장. 🔴 **여러 종류면 전부 밝힌다**(문장을 잇는다) — 지침의 «명확성»은 «무엇을 받았나»를 말하라는 뜻이라
 * «대가를 받았습니다» 한 마디로 뭉뚱그리면 종류를 감춘 셈이 된다.
 */
export function disclosureTextFor(input: DisclosureInput): string {
  const { kinds, provider } = normalizeCompensation(input);
  if (!kinds.length) return "";
  return kinds.map((k) => disclosureSentence(k, provider)).join(" ");
}
export function disclosureBlock(input: DisclosureInput): Block {
  return { type: "disclosure", text: disclosureTextFor(input) };
}

const squash = (s: string | undefined) => String(s ?? "").replace(/\s+/g, "");
/** 고지 문구인지. `kinds` 를 주면 **그 종류가 전부** 들어 있어야 참(빠진 종류 = 고지 누락) · 안 주면 «어느 한 종류라도» 참. */
export function isDisclosureText(t: string | undefined, kinds?: CompensationKind[]): boolean {
  const s = squash(t);
  if (!s) return false;
  const has = (k: CompensationKind) => k === "affiliate"
    ? s.includes(squash(DISCLOSURE_TEXT.coupang)) || s.includes(squash(DISCLOSURE_TEXT.generic))
    : s.includes(squash(disclosureSentence(k)));
  if (kinds && kinds.length) return kinds.every(has);
  return (["affiliate", "sponsored", "gift"] as CompensationKind[]).some(has);
}

/**
 * ensureDisclosureFirst — 대가가 하나라도 있으면 blocks[0] 이 정본 고지 블록이 되게 강제. 중복은 제거. 사람이 지워도 다시 넣는다(§16B.4 «삭제 불가»).
 *   대가가 0 이면 손대지 않는다(사용자가 자기 고지를 넣었을 수 있다).
 */
export function ensureDisclosureFirst(blocks: Block[], input: DisclosureInput | boolean, provider?: string | null): Block[] {
  const comp: DisclosureInput = typeof input === "boolean"
    ? (input ? { affiliate: true, provider: provider ?? null } : { provider: provider ?? null })
    : (typeof input === "string" || input == null ? input : { ...input, provider: input.provider ?? provider ?? null });
  const { kinds } = normalizeCompensation(comp);
  if (!kinds.length) return blocks;
  const rest = blocks.filter((b) => b.type !== "disclosure");
  return [disclosureBlock(comp), ...rest];
}

export interface DisclosureCheck { ok: boolean; detail?: string }
/** checkDisclosure — 발행 직전 재검사: 대가가 있으면 첫 블록이 «그 종류 전부»의 정본 문구인가. */
export function checkDisclosure(blocks: Block[], meta: Record<string, unknown> | null | undefined): DisclosureCheck {
  const hasAffiliateBlock = blocks.some((b) => b.type === "affiliate");
  const comp = compensationOfMeta(meta);
  const kinds: CompensationKind[] = hasAffiliateBlock && !comp.kinds.includes("affiliate") ? ["affiliate", ...comp.kinds] : comp.kinds;
  if (!kinds.length) return { ok: true };
  const first = blocks[0];
  if (!first || first.type !== "disclosure") return { ok: false, detail: "대가를 받은 글이라 고지가 본문 첫머리에 있어야 해요(공정위 추천·보증 심사지침 2024-12-01)." };
  if (!isDisclosureText(first.text, kinds)) {
    const miss = kinds.filter((k) => !isDisclosureText(first.text, [k])).map((k) => COMPENSATION_LABEL[k]);
    return { ok: false, detail: miss.length ? `고지 문구에 «${miss.join(" · ")}» 가 빠졌어요.` : "고지 문구가 정본과 달라요." };
  }
  return { ok: true };
}

/** HTML 본문에서도 재검사(사람 수정 후 bodyHtml 이 정본일 때). 첫 의미 블록이 고지인가. `kinds` 를 주면 종류까지 본다. */
export function checkDisclosureHtml(html: string, need: boolean | Compensation, kinds?: CompensationKind[]): DisclosureCheck {
  const want = typeof need === "boolean" ? (kinds ?? []) : normalizeCompensation(need).kinds;
  const on = typeof need === "boolean" ? need : want.length > 0;
  if (!on) return { ok: true };
  const m = /<div[^>]*class="[^"]*\bdisclosure\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html);
  if (!m) return { ok: false, detail: "대가를 받은 글이라 고지가 본문에 있어야 해요." };
  const before = html.slice(0, m.index).replace(/<[^>]+>/g, "").trim();
  if (before.length > 0) return { ok: false, detail: "고지가 본문 첫머리가 아니에요(공정위: 제목 또는 첫 부분)." };
  if (!isDisclosureText(m[1].replace(/<[^>]+>/g, ""), want.length ? want : undefined)) return { ok: false, detail: "고지 문구가 정본과 달라요." };
  return { ok: true };
}

/* ═══ P1R5 §1.8 — 영상 고지 소비처(§16B.1 영상: 시작 3초 자막 + 우상단 상시 배지 + 설명란 첫 줄 공식 문구) ═══ */
/** 우상단 배지 문구(짧은 형) — 대가 종류별. 여러 종류면 «광고 포함» 하나로 묶는다(배지는 짧아야 읽힌다). */
export function videoBadgeText(input?: DisclosureInput): string {
  const { kinds } = normalizeCompensation(input === undefined ? { affiliate: true } : input);
  if (kinds.length !== 1) return kinds.length ? "광고 포함" : "";
  return kinds[0] === "affiliate" ? DISCLOSURE_TEXT.videoBadge
    : kinds[0] === "sponsored" ? DISCLOSURE_TEXT.videoBadgeSponsored : DISCLOSURE_TEXT.videoBadgeGift;
}
/** 설명란·캡션 첫 줄 = 공식 문구 전문(유튜브 설명란·릴스 캡션·쓰레드 첫 줄 공통). */
export function videoDescriptionFirstLine(input: DisclosureInput): string { return disclosureTextFor(input); }
/** 시작 3초 자막 문구(짧은 형 + «광고»). */
export function videoOpeningCaption(input?: DisclosureInput): string {
  const badge = videoBadgeText(input === undefined ? { affiliate: true } : input);
  return badge || "광고 포함";
}
export interface VideoDisclosureInput { badge: string | null; disclosureCaption: string | null; descriptionFirstLine: string }
/** checkVideoDisclosure — 대가가 있으면 배지·시작 자막·설명란 첫 줄 셋 다 있어야 통과(approve·publish 직전 재검사). */
export function checkVideoDisclosure(v: VideoDisclosureInput, meta: Record<string, unknown> | null | undefined): DisclosureCheck {
  const comp = compensationOfMeta(meta);
  if (!comp.need) return { ok: true };
  const miss: string[] = [];
  if (!v.badge || !v.badge.includes("광고")) miss.push("우상단 배지");
  if (!v.disclosureCaption || !v.disclosureCaption.includes("광고")) miss.push("시작 3초 자막");
  if (!isDisclosureText(v.descriptionFirstLine, comp.kinds)) miss.push("설명란 첫 줄 공식 문구");
  return miss.length ? { ok: false, detail: `고지 누락(${comp.kinds.map((k) => COMPENSATION_LABEL[k]).join(" · ")}): ${miss.join(" · ")}` } : { ok: true };
}
