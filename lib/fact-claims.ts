/**
 * lib/fact-claims.ts — 글 안의 **수치**를 «우리가 준 숫자»와 «모델이 지어낸 숫자»로 가른다(계약 P1R8 §2.4 · B-1 2026-09-15).
 *   🔎 출처: AC 신규(B-1 · 2026-09-15) — AM 원본 없음. 🔴 **순수 리프**(DB·AI·네트워크 0 · 타입만 import).
 *
 *   ══ 🔴 이름을 정확히 한다 — 이건 «팩트체크»가 아니다 ══
 *     우리는 **«이 숫자가 사실인가»를 알 수 없다.** 알 수 있는 것은 단 하나 —
 *     **«그 숫자를 우리가 줬나»** 다. 그래서 판정 기준을 그 문장 그대로 둔다(AC-57 «판정하려는 것과 실제로 보는 것이 다르면 언젠가 갈라진다»).
 *       · `given` — 우리가 프롬프트에 넣어 준 숫자다(제휴 상품 가격 · 검색량 · 페르소나 사정 …).
 *       · `self`  — **모델이 스스로 만든 숫자다.** 맞을 수도 있고 틀릴 수도 있다. 우리는 모른다.
 *     🔴 화면도 그렇게 말해야 한다: «틀렸어요»가 아니라 **«이 숫자는 우리가 준 게 아니에요 — 확인해 주세요»**.
 *
 *   ══ 🔴 «준 숫자»를 어디서 읽나 — **프롬프트 문자열 그 자체** ══
 *     재료 목록을 여기서 다시 조립하면 프롬프트와 **언젠가 갈라진다**(하나를 고치고 다른 하나를 안 고친다).
 *     그래서 `buildPrompt()` 가 실제로 만든 **그 문자열**에서 숫자를 뽑는다 — 갈릴 수가 없다(AC-70 «같은 입력»).
 *
 *   ══ 🔴 막지 않는다(CLAUDE §9) ══
 *     세어서 `pieces.meta.numberClaims` 에 적고 검수 화면이 보여 준다. 발행을 막지 않는다.
 *     프롬프트에는 이미 «근거 없는 수치·통계 금지»가 있다(⑤칸) — 그런데 **지키는지 아무도 안 쟀다.** 이 파일이 잰다.
 *
 *   ══ 못 재는 것(정직 · AC-9) ══
 *     · «3만원»과 «30,000원» 을 **같은 값으로 못 본다** — 한글 수 단위는 안 편다. 그래서 «준 숫자»인데 `self` 로 나올 수 있다(안전한 쪽).
 *     · 「3가지」처럼 **글의 구조를 세는 숫자**는 주장이 아니다 — `kind: "structural"` 로 갈라 화면이 덜 시끄럽게 한다.
 *     · 숫자가 **맞는지**는 영원히 모른다. 이 파일은 «누가 만든 숫자인가»까지다.
 */
import type { Block } from "./blocks";

export type ClaimBasis = "given" | "self";
export type ClaimKind = "money" | "percent" | "year" | "structural" | "count";

export interface NumericClaim {
  /** 원문 숫자 그대로(«12,800» · «3.5»). 화면이 본문에서 찾아 표시할 때 쓴다. */
  num: string;
  /** 그 숫자가 들어간 짧은 문맥(앞뒤 · 최대 60자). 화면이 «어디에 있는 숫자인지» 보여 준다. */
  context: string;
  basis: ClaimBasis;
  kind: ClaimKind;
  /** 몇 번째 블록인가 — 검수 화면이 그 블록으로 스크롤한다. */
  blockIndex: number;
  /**
   * 🔴 **직접 확인이 꼭 필요한 숫자인가** = 우리가 안 준 **돈·비율**(틀리면 표시광고법으로 가는 둘).
   *   화면이 `basis`·`kind` 로 **다시 계산하지 않게** 항목에 실어 보낸다(A 요청 2026-09-15) —
   *   다시 계산하게 두면 우리가 셈을 바꾸는 날 **화면만 옛 셈으로** 남는다(AC-57 · 같은 판정을 두 곳에서 하지 않는다).
   */
  risky: boolean;
}

/** 숫자 한 덩이 — 천 단위 쉼표·소수점까지. 🔴 앞뒤 경계를 둬 «1.234»(금액)를 날짜로 읽던 사고를 피한다(AC-57 사촌). */
const NUM_RE = /(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d.,])\d+(?:\.\d+)?/g;

/** 비교용 정규화 — 쉼표를 떼고 뒤따르는 0 만 정리(«12,800» ↔ «12800»). */
const norm = (s: string) => String(s).replace(/,/g, "").replace(/^0+(?=\d)/, "");

/** 그 숫자가 무엇을 말하나 — 바로 뒤(또는 앞)에 붙은 단위로 본다. */
function kindOf(text: string, start: number, end: number): ClaimKind {
  const after = text.slice(end, end + 6);
  const before = text.slice(Math.max(0, start - 2), start);
  if (/^\s*%/.test(after) || /퍼센트|프로/.test(after)) return "percent";
  if (/^\s*(원|만원|억원|달러|엔)/.test(after) || /₩|\$/.test(before)) return "money";
  if (/^\s*년/.test(after) && /^(19|20)\d{2}$/.test(text.slice(start, end))) return "year";
  /* 🔴 «3가지» «2단계» «5개» 는 주장이 아니라 **글의 구조를 세는 말**이다 — 같은 무게로 보여 주면 화면이 시끄러워
     진짜 위험한 숫자(가격·비율)가 묻힌다. 갈라 둔다. */
  if (/^\s*(가지|단계|번째|개$|개\s|개의|줄|칸)/.test(after)) return "structural";
  return "count";
}

/** 블록 하나에서 사람이 읽는 글자만 뽑는다(프롬프트·URL 은 뺀다 — 독자에게 안 보이는 글자다). */
function textOf(b: Block): string {
  const parts: string[] = [];
  if (typeof b.text === "string") parts.push(b.text);
  if (Array.isArray(b.items)) parts.push(...b.items.map((x) => String(x)));
  if (Array.isArray(b.rows)) for (const r of b.rows) if (Array.isArray(r)) parts.push(...r.map((x) => String(x)));
  if (b.type === "image" && typeof b.caption === "string") parts.push(b.caption);
  return parts.join(" ");
}

/**
 * 글 안의 수치를 가른다.
 *   @param blocks     생성된 블록(고지·해시태그 포함 그대로 — 자리만 세면 된다)
 *   @param promptUser `buildPrompt().user` **그 문자열**. 🔴 재료를 다시 조립하지 않는다(위 헤더).
 */
export function findNumericClaims(blocks: Block[], promptUser: string): NumericClaim[] {
  const given = new Set<string>();
  for (const m of String(promptUser ?? "").matchAll(NUM_RE)) given.add(norm(m[0]));

  const out: NumericClaim[] = [];
  const seen = new Set<string>();
  (Array.isArray(blocks) ? blocks : []).forEach((b, i) => {
    /* 고지 문장은 우리가 넣는 정본이다 — 거기 숫자가 있어도 모델의 주장이 아니다. */
    if (!b || b.type === "disclosure" || b.type === "hashtags") return;
    const text = textOf(b);
    if (!text) return;
    for (const m of text.matchAll(NUM_RE)) {
      const num = m[0];
      const start = m.index ?? 0;
      const kind = kindOf(text, start, start + num.length);
      const basis: ClaimBasis = given.has(norm(num)) ? "given" : "self";
      /* 같은 숫자가 같은 블록에 여러 번 나오면 한 번만 — 화면이 같은 말을 반복하지 않게. */
      const key = `${i}:${norm(num)}:${kind}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        num, basis, kind, blockIndex: i, risky: isRisky(basis, kind),
        context: text.slice(Math.max(0, start - 20), start + num.length + 20).replace(/\s+/g, " ").trim().slice(0, 60),
      });
    }
  });
  return out;
}

/**
 * 🔴 **«직접 확인이 꼭 필요한가»의 판정 한 곳.** 항목(`risky`)과 요약(`summary.risky`)이 **같은 함수**를 본다 —
 *   두 곳에서 따로 세면 언젠가 «항목은 3개인데 요약은 2개»가 된다(AC-57).
 */
function isRisky(basis: ClaimBasis, kind: ClaimKind): boolean {
  return basis === "self" && (kind === "money" || kind === "percent");
}

/** 검수 화면·되짚기가 쓰는 한 줄 요약. 🔴 «구조를 세는 숫자»는 **따로 센다**(위험한 숫자가 묻히지 않게). */
export interface ClaimSummary { total: number; given: number; self: number; structural: number; risky: number }
export function summarizeClaims(claims: NumericClaim[]): ClaimSummary {
  const s: ClaimSummary = { total: claims.length, given: 0, self: 0, structural: 0, risky: 0 };
  for (const c of claims) {
    if (c.kind === "structural") { s.structural++; continue; }
    if (c.basis === "given") s.given++;
    else s.self++;
    /* 🔴 항목이 이미 들고 있는 값을 그대로 센다 — 여기서 다시 판정하면 항목과 요약이 갈린다(`isRisky` 한 곳). */
    if (c.risky) s.risky++;
  }
  return s;
}

/**
 * 사람이 읽는 한 줄 — 🔴 **«틀렸다»고 말하지 않는다.** 우리는 맞는지 모른다(위 헤더).
 *   확인할 것이 없으면 `null`(없는 걱정을 만들지 않는다).
 */
export function claimsLine(s: ClaimSummary): string | null {
  if (!s.self) return null;
  if (s.risky) return `직접 확인이 필요한 숫자가 ${s.self}개 있어요(그중 금액·비율 ${s.risky}개). 우리가 준 자료에 없는 숫자예요.`;
  return `직접 확인이 필요한 숫자가 ${s.self}개 있어요. 우리가 준 자료에 없는 숫자예요.`;
}
