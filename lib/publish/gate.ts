/**
 * lib/publish/gate.ts — 발행 직전 본문 준비 + 최종 게이트(DESIGN §16B.4 «발행 직전 재검사» · 계약 §3).
 *   AC 신규 2026-09-14(B2). 순수에 가깝다 — DB·네트워크 접근 0(호출자가 저장한다).
 *
 *   왜 «또» 검사하나: 검수창에서 사람이 본문을 고칠 수 있고(고지 삭제 포함), 승인 후 발행까지 시간이 뜬다.
 *   **남의 서버로 나가기 직전**이 마지막으로 **볼** 기회다.
 *
 *   🔴 **2026-09-15 사장님 지시(`CLAUDE.md §9`)**: «말해 주기로 내려. **고객 계정이야. 우리가 책임지는 게 아니야.**»
 *      ⇒ **여기서 발행을 세우지 않는다.** 검사는 그대로 돌고 결과를 남기지만, 호출부(`lib/publish/index.ts`)가
 *         `ok:false` 로 막던 것을 없앴다. 쿠팡 수익 몰수·애드센스 정지는 **위험이지 우리가 대신 판단할 일이 아니다** —
 *         우리 몫은 **또렷하게 말하고**(감사 `publish_gate_risks` · `gate_report` 저장 · 발행함 표시)
 *         **되돌릴 길**(§5E «이 글 내리기»)을 같이 주는 것이다.
 *      🔴 **①고지 복원은 그대로 한다** — 그건 막는 게 아니라 **대신 넣어 주는 것**이라 §9-4(«대신 해 줄 건 대신»)에 맞는다.
 *
 *   하는 일 3가지
 *     ① 고지 복원 — 제휴 글인데 `<div class="disclosure">` 가 첫 요소가 아니면 **정본 문구로 다시 넣는다**(§16B.1 본문 첫머리).
 *     ② 애드센스 자리 실체화 — `<div class="adsense"></div>` 를 계정의 애드센스 코드로 바꾸고 «광고» 라벨을 붙인다(§16B.3
 *        «광고 자리 본문과 혼동 금지»). 애드센스 키가 없으면 빈 자리를 **지운다**(빈 div 를 남기지 않는다).
 *     ③ 세는 것 3가지 — 고지·광고법 금칙어·제휴 링크 ≤2. 🔴 **실패해도 발행은 나간다**(경고다 · 위 §9).
 */
import { GATE_LABEL, type GateCheck, type GateReport } from "../ai-tell-gate";
import { checkDisclosureHtml, disclosureTextFor } from "../disclosure";
import { findBannedWords, BLOG_EXTRA_BANNED } from "../banned-words";
import { htmlToPlain } from "../blocks";
import { creditLines } from "../photo-source";
import type { PublishImage } from "./contract";

export interface GateSubject {
  channel: string;
  title: string;
  bodyHtml: string;
  /** [2026-09-16] 크레딧을 쓰기 위한 재료 — 스톡 사진이 있으면 본문 끝에 «작가 · Pexels (주소)» 한 벌이 붙는다. */
  images?: PublishImage[];
  /** 제휴가 붙은 글인가(meta.affiliate 또는 meta.adDisclosure). */
  affiliate?: { provider?: string } | null;
  adDisclosure?: boolean;
}
export interface GateAccountHints {
  /** 애드센스 게시자 ID(`ca-pub-…`) — 있으면 adsense 블록을 실제 코드로. */
  adsensePub?: string;
}

export interface PublishGateResult {
  ok: boolean;
  report: GateReport;
  /** 준비가 끝난 본문(고지 복원·애드센스 실체화 반영). 실패해도 준비분은 돌려준다(저장은 호출자 판단). */
  bodyHtml: string;
  /** 본문이 실제로 바뀌었나(바뀌었으면 호출자가 pieces.body 를 갱신한다 — «올린 것 = 저장된 것»). */
  changed: boolean;
}

const DISCLOSURE_RE = /<div[^>]*class="[^"]*\bdisclosure\b[^"]*"[^>]*>[\s\S]*?<\/div>\s*/gi;
/* 빈 광고 자리 두 가지 모양을 같은 규칙으로 실체화한다:
 *   · P1R1 §4B `adsense` 블록 → `<div class="adsense"></div>`
 *   · P1R3 §2.2 [v3.4] B 의 렌더가 첫 소제목 뒤·마지막 문단 앞에 비워 두는 `<div class="ad-slot" data-slot="mid"></div>`
 * 키가 있으면 유닛으로, 없으면 **자리를 지운다**(빈 div 를 남의 블로그에 남기지 않는다). 네이버는 채널에서 걸러 호출한다. */
const ADSENSE_SLOT_RE = /<div[^>]*class="[^"]*\b(?:adsense|ad-slot)\b[^"]*"[^>]*>\s*<\/div>/gi;

/** 고지를 본문 첫 요소로 강제(있던 것은 전부 제거하고 정본 하나만 둔다). pieces.ts 의 ensureDisclosureHtml 과 같은 규칙. */
export function ensureDisclosureFirstHtml(html: string, provider: string | null | undefined, comp?: { affiliate?: boolean; sponsored?: boolean; gift?: boolean }): string {
  /* [R8-A §4] 대가 3종 — 종류를 주면 그 종류의 문장을 전부 싣는다(옛 호출부는 provider 만 줘서 제휴 1종으로 읽힌다). */
  const text = comp ? disclosureTextFor({ ...comp, provider: provider ?? null }) : disclosureTextFor(provider);
  const stripped = String(html || "").replace(DISCLOSURE_RE, "");
  return `<div class="disclosure">${text}</div>\n${stripped}`;
}

/**
 * 애드센스 자리 실체화(§4B «실제 코드 삽입은 발행 커넥터 R2»).
 *   키가 있으면 ins 태그 + 라벨 · 없으면 빈 자리 제거.
 *   ⚠️ 네이버 블로그는 애드센스를 붙일 수 없다(애드포스트) — 채널에서 걸러 호출한다.
 */
export function materializeAdsense(html: string, adsensePub?: string): string {
  const pub = String(adsensePub ?? "").trim();
  if (!pub) return String(html || "").replace(ADSENSE_SLOT_RE, "");
  const unit = `<div class="adsense"><span class="ad-label">광고</span>`
    + `<ins class="adsbygoogle" style="display:block" data-ad-client="${pub}" data-ad-format="auto" data-full-width-responsive="true"></ins>`
    + `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(pub)}" crossorigin="anonymous"></script>`
    + `<script>(adsbygoogle = window.adsbygoogle || []).push({});</script></div>`;
  return String(html || "").replace(ADSENSE_SLOT_RE, unit);
}

/**
 * 제휴 링크 수 — **`<a>` 하나를 1개로** 센다. 조건은 둘 중 하나: 렌더 계약의 `class="affiliate"` **또는**
 * 쿠팡 도메인 직링크(사람이 손으로 붙인 것까지 센다).
 *
 * 🔴 2026-09-15(C · R7 §1 되짚기): 예전 구현은 두 조건을 **따로 더했다**. 그런데 `lib/blocks.ts:74` 의 렌더러는
 *    `<a class="affiliate" href="https://link.coupang.com/…">` 로 **둘 다** 내놓는다 → 상품 1개가 2개로 세어졌다.
 *    결과: 설계 §16B 의 «2개 이하» 가 실제로는 «1개 이하» 로 동작해 **쿠팡 상품 2개짜리 정상 글이 발행 직전에 막혔다**
 *    (`ok:false` → `awaiting_manual` → 고객에게 «직접 올려 주세요»). 게이트가 나쁜 글이 아니라 고객을 막고 있었다.
 */
export function countAffiliateLinks(html: string): number {
  const tags = String(html || "").match(/<a\b[^>]*>/gi) || [];
  return tags.filter((t) => /class="[^"]*\baffiliate\b[^"]*"/i.test(t)
    || /href="https?:\/\/(link\.coupang|coupa\.ng|www\.coupang)/i.test(t)).length;
}

/** 애드센스를 붙일 수 있는 채널(네이버 블로그는 애드포스트라 제외). */
export const ADSENSE_CHANNELS: ReadonlySet<string> = new Set(["tistory", "blogger", "wordpress"]);

const CREDIT_RE = /<div[^>]*class="[^"]*photo-credit[^"]*"[^>]*>[\s\S]*?<\/div>\s*/gi;

/**
 * 🔴 스톡 사진 크레딧을 **본문 끝에 넣어 준다**(2026-09-16 메인 · A 가 «부르는 곳 0» 을 잡았다).
 *
 *   왜 여기인가: 이건 **막는 일이 아니라 대신 해 주는 일**이다(CLAUDE §9-4 — 고지 문장을 넣어 주는 것과 같은 자리).
 *   왜 해야 하는가: Pexels·Pixabay 약관이 **작가·출처 표기를 요구**하고, `lib/stock/index.ts:22` 가 스스로
 *     «**키가 죽는 진짜 경로는 크레딧 미표기**»라고 적어 뒀다. 키가 죽으면 **스톡이 통째로 멈춘다**
 *     — 그러면 사진이 다시 전부 AI 로 구워지고 편당 원가가 세 배가 된다(2026-09-15 실측 ₩134 → ₩458).
 *   🔴 사장님이 «무시해도 된다»고 하신 것은 **사람·상표 판정**이지 **약관 준수가 아니다**(`lib/stock/index.ts:24`).
 *
 *   멱등: 이미 붙어 있던 크레딧 덩이는 지우고 정본 하나만 둔다(고지와 같은 규칙).
 *   스톡이 하나도 없으면 **아무것도 안 붙인다**(빈 덩이를 남의 블로그에 남기지 않는다).
 */
export function ensurePhotoCreditHtml(html: string, images: PublishImage[] | undefined): string {
  const lines = creditLines((images ?? []).map((i) => ({ source: i.source ?? null, stock: i.stock ?? null })));
  const stripped = String(html || "").replace(CREDIT_RE, "");
  if (!lines.length) return stripped;
  const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `${stripped}
<div class="photo-credit"><p>사진 출처</p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></div>`;
}

/**
 * runPublishGate — 발행 직전 준비 + 검사.
 *   🔴 `ok` 는 **«검사를 다 지났나»**일 뿐 **«발행해도 되나»가 아니다**(`CLAUDE.md §9` · 사장님 2026-09-15).
 *      호출부는 이 값으로 **막지 않는다** — 감사·`gate_report`·화면에 쓰고 **그대로 내보낸다.**
 *      막고 싶어지거든 §9 를 먼저 읽어라. 되돌리지 말고 이유를 읽으라고 남기는 줄이다.
 *   검사 키는 §4 GateKey 어휘 그대로 3개(disclosure·banned_words·affiliate_count) — A 화면이 같은 label 로 그린다.
 */
export function runPublishGate(subject: GateSubject, account?: GateAccountHints): PublishGateResult {
  const before = String(subject.bodyHtml || "");
  const needDisclosure = !!subject.affiliate || subject.adDisclosure === true || /class="affiliate"/.test(before);
  const provider = subject.affiliate?.provider ?? "coupang";

  // ① 고지 복원 — 사람이 지웠어도 다시 넣는다(§16B.4 «삭제 불가»).
  let html = before;
  if (needDisclosure && !checkDisclosureHtml(html, true).ok) html = ensureDisclosureFirstHtml(html, provider);

  // ② 애드센스 자리 실체화(채널이 받을 수 있을 때만).
  html = ADSENSE_CHANNELS.has(subject.channel) ? materializeAdsense(html, account?.adsensePub) : materializeAdsense(html, undefined);

  // ②-b 🔴 스톡 사진 크레딧 — 막는 게 아니라 **대신 넣어 준다**(§9-4 · 고지와 같은 자리).
  html = ensurePhotoCreditHtml(html, subject.images);

  // ③ 센다.
  const checks: GateCheck[] = [];

  const dis = checkDisclosureHtml(html, needDisclosure);
  checks.push({ key: "disclosure", label: GATE_LABEL.disclosure, pass: dis.ok, ...(dis.detail ? { detail: dis.detail } : {}) });

  const plain = `${subject.title}\n${htmlToPlain(html)}`;
  const banned = findBannedWords(plain, BLOG_EXTRA_BANNED);
  checks.push({ key: "banned_words", label: GATE_LABEL.banned_words, pass: banned.length === 0, ...(banned.length ? { detail: `«${banned.slice(0, 3).join("», «")}»` } : {}) });

  const links = countAffiliateLinks(html);
  checks.push({ key: "affiliate_count", label: GATE_LABEL.affiliate_count, pass: links <= 2, ...(links > 2 ? { detail: `제휴 링크 ${links}개(2개 이하)` } : {}) });

  const ok = checks.every((c) => c.pass);
  return { ok, report: { ok, checks, rewritten: html !== before }, bodyHtml: html, changed: html !== before };
}
