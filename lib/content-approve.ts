/**
 * lib/content-approve.ts — 승인 **정본 한 벌**: 발행 직전 재검사(`recheckPiece`) + 승인 전이(`approvePiece`).
 *   AM 원본: ../AutoMarketing/lib/content-approve.ts (관례 이식 2026-09-14 — «원클릭 승인 + 금칙어 재검사» 구조. 검사 12키는 AC 의 `lib/ai-tell-gate.ts` 를 쓴다)
 *   출처: 본문 `recheckPiece` 는 P1R1 의 `netlify/functions/pieces.ts recheck()` 를 **옮겨 온 것**(복사가 아니라 이동 — 그쪽은 이제 이 파일을 부른다).
 *
 *   ══ 왜 옮겼나 ══
 *     R2 의 `slots.review_deadline`(조용하면 자동 승인)은 «`pieces-approve` 와 **같은 게이트**를 태운 뒤» 승인해야 한다.
 *     판정기가 함수 파일 안에 숨어 있으면 새 층(크론)이 그걸 못 불러 결국 한 벌을 더 만든다 — 그 순간 사람 승인과
 *     자동 승인의 기준이 갈라지고, 자동 승인만 정책 위반을 통과시킨다(PITFALLS #11-b «이미 있는 정본 판정기를 새 층이 안 부르는 것도 같은 죄»).
 *
 *   ══ 하드 게이트 ══
 *     12키 중 **법·돈·날조**에 걸리는 5키(고지·금칙어·제휴 링크 수·유사도·최상급)만 승인을 막는다(PITFALLS #19 «게이트는 사고 게이트만»).
 *     나머지(AI 티·구성·길이 등)는 점수로 보여 주되 승인을 막지 않는다 — 취향은 게이트가 아니라 프롬프트의 일이다.
 *
 *   🔴 자동 승인이 하드 게이트에 걸리면 **발행하지 않는다** — `awaiting_manual` + 알림. 조용한 통과 0(자동 승인으로 정책 위반이 나가는 일 0).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { jsonb, utcDate } from "./db-util";
import { contractFor, topicGroupOf, type TopicGroup } from "./writing-contracts";   // [R8 §2.1] 주제군 — 분량 폭이 여기에 달렸다
import { type Block, htmlToPlain } from "./blocks";
import { runGate, GATE_KEYS, GATE_LABEL, gateWeightOf, type GateReport, type GateCheck } from "./ai-tell-gate";
import { checkDisclosureHtml, checkVideoDisclosure } from "./disclosure";
import { findBannedWords, BLOG_EXTRA_BANNED } from "./banned-words";
import { maxSimilarity } from "./similarity";
import { personaTerms } from "./content-gen";
import { countAffiliateLinks } from "./publish/gate";
/* [R8-A §2 · B-1] 골격 지문 — 순수 모듈(DB 0). 여기서 최근 글을 읽어 넘겨 준다(ai-tell-gate 는 순수로 둔다 · AC-17). */
import { structurePrint, compareToRecent, printFromMeta, STRUCTURE_OVERLAP_MAX, type StructurePrint } from "./structure-print";
import { compensationOfMeta } from "./disclosure";            // [R8-A §4] 대가 3종 판정 한 곳
import { assessStockImage, stockSourceOf } from "./stock-safety";   // [P1R8] 광고성 글 + 사람·상표 스톡 금지
import { classifyBanned } from "./banned-words";              // [R8-A §4] 3층 사전
import { isHealthTopic } from "./banned-categories";          // [R8-A §4] 건강·의료 소재면 효능 표현이 바로 위법

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v || 0);

/** 승인을 **막는** 게이트 키(사고 게이트). 나머지는 보여만 준다. */
/* [R8-A §4] 🔴 `superlative` 를 **하드에서 뺀다**(B-1 지적 · 표시광고법 §5 는 낱말 금지가 아니라 실증 책임).
   그 축은 «낱말이 있나»만 봤고 근거를 보지 않아, «판매량 1위(2026년 9월 네이버 쇼핑 기준)» 처럼 **법이 허용하는 문장까지 승인을 막았다**.
   이제 `superlative` 는 같은 문장의 근거(기관·기간·수치)를 보고, 없을 때만 **보여 준다**(소프트).
   법 축을 막는 것은 `banned_words` 다 — 3층 사전(hard = 단정·효능 / needs_proof = 근거 없는 최상급)이 그 자리를 맡는다. */
export const HARD_GATE_KEYS: readonly string[] = ["disclosure", "banned_words", "affiliate_count", "similarity", "ad_pointing", "stock_safe"];
/** 이 게이트 결과가 승인을 막는가. */
export function hardFailures(gate: GateReport): GateCheck[] {
  return gate.checks.filter((c) => !c.pass && HARD_GATE_KEYS.includes(c.key));
}
/**
 * [P1R5 §1.4-5·§0.1-7] 영상 심사의 **P0 축**도 승인을 막는다(forbidden·disclosure·duration_fit·frames_not_blank).
 *   P1·P2 는 기록만 — 화면이 축 목록으로 보여 주되 «이대로 예약»을 막지 않는다(3등급 규칙).
 *   `hardFailures` 와 나눠 둔 이유: 축 키(duration_fit·frames_not_blank)는 GateKey 12 에 대응물이 없다.
 */
export function judgeBlockers(gate: GateReport): { key: string; label: string; detail?: string }[] {
  return (gate.judge?.axes ?? []).filter((a) => !a.pass && a.grade === "P0").map((a) => ({ key: a.key, label: a.label, ...(a.detail ? { detail: a.detail } : {}) }));
}

/* ═══════════ [P1R7 B3] 링크 열림 검사 — **소프트**(경고) · DESIGN §4.2 «코드 게이트(…링크)» · AM `content-link-verify` 자리 ═══════════
 *   🔴 **하드가 아니다**(HARD_GATE_KEYS 에 넣지 않는다): 링크가 안 열리는 건 우리 잘못이 아닐 수 있고(상대 사이트 점검 중·봇 차단),
 *      하드로 걸면 그날 발행이 통째로 멈춘다. 그래서 «발행은 가되 검수 화면이 말해 주는» 자리다.
 *   🔴 **리다이렉트는 정상이다** — 제휴 링크(쿠팡 딥링크)는 원래 여러 번 튄다. **최종 200 이면 통과**.
 *   🔴 **못 잰 것은 실패가 아니다**(AC-9): 네트워크가 막힌 환경·타임아웃은 `pass:true` + «확인 못 함» 으로 둔다.
 *      «없음»을 «깨졌음»으로 적으면 고객이 멀쩡한 글을 고치러 간다.
 *   비용 상한: 링크 **3개까지 · 전체 3초**(병렬 · 크론이 200건을 도는 자리라 편당 상한이 곧 틱 예산이다).
 */
export const LINK_CHECK_KEY = "link_check" as const;
export const STRUCTURE_KEY = "structure_repeat" as const;

/**
 * [R8 §5D.3-3 · §9] 🔴 **직접 쓴 글(`origin:"self"`)의 게이트 적용표** — **두 값**이다: `soft`(돌고 말해 준다) · `off`(안 쟀다).
 *
 *   ══ 왜 하드가 없나(사장님 지시 2026-09-15 · CLAUDE §9) ══
 *     «말해 주기로 내려. **고객 계정이야. 우리가 책임지는 게 아니야.**» — 막는 게이트는 **0개**다.
 *     🔴 **검사를 지우는 게 아니다.** 계속 돌고 결과를 보여 준다. 막지만 않는다 — 말해 주려면 재야 한다.
 *     🔴 «막으면 공장이 선다» — 고객이 «알아서 올려»를 켰는데 우리가 조용히 안 올리면 그게 더 나쁘다.
 *
 *   ══ 안 재는 것은 하나뿐 ══
 *     **AI 티 계열 + `structure_repeat`** — 사람이 쓴 글에 «AI 같다»를 들이대는 것은 뜻이 없고, 골격도 우리가 만든 것이 아니다.
 *     🔴 **모르는 축은 `soft`**(`selfGateLevelOf`) — 새 축이 조용히 «안 재는 쪽»으로 기우는 것을 막는다.
 *     무게(`weight`)는 `lib/ai-tell-gate.ts GATE_WEIGHT` 한 곳이다 — 막지 않는 대신 **읽는 순서**를 준다.
 */
export type SelfGateLevel = "soft" | "off";
export const SELF_GATE_LEVEL: Readonly<Record<string, SelfGateLevel>> = {
  /* ── 안 잰다: «AI 같다»를 사람 글에 들이대는 것은 뜻이 없다 ── */
  cliche: "off", para_repeat: "off", bullet_ratio: "off", sentence_variance: "off", translationese: "off", persona: "off",
  [STRUCTURE_KEY]: "off",                     // 우리가 만든 골격이 아니다
  /* ── 돈다(말해 준다) — 법이든 플랫폼이든 채널 계약이든 **막지는 않는다** ── */
  disclosure: "soft", banned_words: "soft", ad_pointing: "soft",
  stock_safe: "soft",                         // [P1R8 B3] 스톡 사진(사람·상표) — 제3자가 다치는 축이지만 **막지는 않는다**(§9 최종)
  affiliate_count: "soft", similarity: "soft", superlative: "soft",
  length: "soft", visual_min: "soft", link_check: "soft",
};
export function selfGateLevelOf(key: string): SelfGateLevel { return SELF_GATE_LEVEL[key] ?? "soft"; }

/** `off` 인 축들 — 화면·모의가 목록으로 쓸 때. 정본은 `SELF_GATE_LEVEL` 이다(목록을 따로 들고 있으면 서버와 갈린다 · AC-52). */
export const SELF_SKIPPED_GATE_KEYS: readonly string[] = Object.entries(SELF_GATE_LEVEL).filter(([, v]) => v === "off").map(([k]) => k);

/**
 * 게이트 결과에 ① 정책을 입힌다 — 축을 **빼지 않고** `level` 을 붙이고, `off` 는 «안 쟀다»로 표시한다(«조용히 다 끄기» 금지 · §4.7).
 *   🔴 왜 «돌리고 나서 버리나»: `runGate` 안에 «사람 글이면 건너뛰기» 분기를 넣으면 그 문은 나중에 안 닫힌다(AC-65).
 *      순수 함수는 그대로 두고 **쓰는 쪽에서 값을 버린다** — 버린 값은 응답에도 안 싣는다(잰 척하지 않는다).
 *   `ok` 는 «모든 검사를 통과했나»라는 **알림**이다 — 막는 것과는 상관이 없다(막는 축이 0개다).
 */
/**
 * [R8 §9] 보고서의 모든 축에 **무게**를 채운다 — `runGate` 밖에서 만든 축(고지 HTML 판정·링크·골격)도 빠지지 않게 **한 자리**에서 입힌다.
 *   🔴 만드는 자리마다 손으로 붙이면 한 군데는 반드시 빠진다(스모크에서 실제로 빠졌다).
 */
function withWeights(report: GateReport): GateReport {
  return { ...report, checks: report.checks.map((c) => (c.weight ? c : { ...c, weight: gateWeightOf(c.key) })) };
}

export function applySelfGatePolicy(report: GateReport): GateReport {
  const checks: GateCheck[] = report.checks.map((c) => {
    const level = selfGateLevelOf(c.key);
    if (level === "off") return { key: c.key, label: c.label, pass: true, skipped: true, skipReason: "self", level, weight: c.weight, detail: "사람이 쓴 글이라 이 검사는 하지 않았어요" };
    return { ...c, level };
  });
  return { ...report, checks, ok: checks.every((c) => c.pass) };
}

/**
 * [R8-A §2 · B-1] **골격 반복** — 같은 테넌트·같은 채널의 최근 글과 **구조**가 얼마나 겹치나.
 *   🔴 `similarity`(글자 2-gram)로는 안 잡힌다: 우리 `structure` 는 채널당 format 3~5개 **고정 배열**이라
 *      같은 채널에 10편을 쓰면 골격이 3~5가지로 돈다. 단어만 바꾸면 유사도는 낮게 나오지만 **사람은 첫눈에 안다**.
 *   🔴 **소프트**다(HARD_GATE_KEYS 밖) — 초기엔 표본이 적어 오탐이 나고, 하드로 걸면 첫 고객이 글을 못 낸다.
 *   🔴 **못 잰 것은 실패가 아니다**(AC-9): 견줄 글이 없으면 `pass:true` + «견줄 글이 없어요».
 */
export async function checkStructure(tid: number, p: Row, blocks: Block[]): Promise<GateCheck> {
  const label = GATE_LABEL[STRUCTURE_KEY];
  if (!blocks.length) return { key: STRUCTURE_KEY, label, pass: true, detail: "블록이 없어 재지 못했어요" };
  const mine = structurePrint(blocks);
  let recent: { id: number; print: StructurePrint }[] = [];
  try {
    const rows = await q(sql`SELECT id, meta->'structurePrint' AS sp FROM pieces
      WHERE tenant_id = ${tid} AND id <> ${n(p.id)} AND channel = ${String(p.channel ?? "")} AND kind <> 'video'
        AND meta->'structurePrint' IS NOT NULL AND created_at > NOW() - interval '30 days'
      ORDER BY id DESC LIMIT 10`);
    recent = rows.map((r) => ({ id: n(r.id), print: printFromMeta(r.sp) })).filter((x): x is { id: number; print: StructurePrint } => !!x.print);
  } catch (e) { console.warn("[content-approve] 골격 지문 조회 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
  const cmp = compareToRecent(mine, recent);
  if (!cmp.compared) return { key: STRUCTURE_KEY, label, pass: true, detail: "견줄 최근 글이 없어요(아직 못 쟀어요)" };
  const pass = cmp.overlap < STRUCTURE_OVERLAP_MAX;
  return { key: STRUCTURE_KEY, label, pass,
    detail: pass ? `가장 닮은 글과 ${Math.round(cmp.overlap * 100)}%(기준 ${Math.round(STRUCTURE_OVERLAP_MAX * 100)}% 미만 · ${cmp.compared}편과 견줌)`
      : `최근 글 #${cmp.againstId} 과 구조가 ${Math.round(cmp.overlap * 100)}% 겹쳐요 — 다음 글은 다른 구성으로 써 주세요` };
}
const LINK_CHECK_MAX = 3;
const LINK_CHECK_MS = 3000;

/** 본문 HTML 에서 바깥 링크(http/https)만 · 중복 제거 · 앞에서 N개. */
export function outboundLinks(html: string, max = LINK_CHECK_MAX): string[] {
  const out: string[] = [];
  for (const m of String(html || "").matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    const u = m[1].replace(/&amp;/g, "&");
    if (!out.includes(u)) out.push(u);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * HEAD(리다이렉트 따라감) → 최종 상태.
 *   🔴 **HEAD 가 나쁘게 답하면 GET 으로 한 번 더 확인한 뒤에야 «죽었다»고 한다** — 멀쩡한 사이트가 HEAD 에 404·403 을 주는 일이 흔하다
 *      (실측 2026-09-15: daum.net 은 HEAD 404 · GET 200). 한 번 더 묻지 않으면 고객이 멀쩡한 글을 고치러 간다 —
 *      거짓 경고 한 번이 이 검사를 영영 못 믿게 만든다.
 */
async function linkAlive(url: string, signal: AbortSignal): Promise<{ ok: boolean; status: number | null }> {
  try {
    const head = await fetch(url, { method: "HEAD", redirect: "follow", signal });
    if (head.status < 400) return { ok: true, status: head.status };
    const get = await fetch(url, { method: "GET", redirect: "follow", signal });   // HEAD 를 싫어하는 서버 확인
    return { ok: get.status < 400, status: get.status };
  } catch { return { ok: false, status: null }; }   // 네트워크·타임아웃 = 판정 불가(호출자가 실패로 세지 않는다)
}

/** 링크 검사 1건 → GateCheck. 링크가 없으면 통과(검사할 것이 없다). */
export async function checkLinks(html: string): Promise<GateCheck> {
  const label = GATE_LABEL[LINK_CHECK_KEY];
  const links = outboundLinks(html);
  if (!links.length) return { key: LINK_CHECK_KEY, label, pass: true };
  const signal = AbortSignal.timeout(LINK_CHECK_MS);
  const results = await Promise.all(links.map(async (u) => ({ u, ...(await linkAlive(u, signal)) })));
  const dead = results.filter((r) => r.status !== null && !r.ok);        // 상대가 «없다»고 답한 것만 실패
  const unknown = results.filter((r) => r.status === null);              // 못 잰 것 — 실패로 세지 않는다(AC-9)
  if (dead.length) {
    const host = (u: string) => { try { return new URL(u).host; } catch { return u.slice(0, 40); } };
    return { key: LINK_CHECK_KEY, label, pass: false, detail: dead.map((d) => `${host(d.u)}(${d.status})`).join(" · ") + " 가 안 열려요" };
  }
  if (unknown.length === results.length) return { key: LINK_CHECK_KEY, label, pass: true, detail: "지금은 확인하지 못했어요(네트워크)" };
  return { key: LINK_CHECK_KEY, label, pass: true };
}

/**
 * 본문 HTML 의 제휴 링크 수 — 🔴 **세는 곳은 한 곳**이다(`lib/publish/gate.ts countAffiliateLinks`).
 *   2026-09-15(C): 여기와 게이트에 같은 셈이 **두 벌** 있었고 둘 다 한 링크를 2개로 셌다(같은 `<a>` 가 class 와 쿠팡 href 를
 *   둘 다 가져서). 검수창의 «제휴 링크 N개» 와 발행 직전 판정이 갈라지지 않도록 이제 같은 함수를 부른다(AC-29).
 */
export const affiliateLinkCount = countAffiliateLinks;

/** 스톡 사진 안전 검사 키. */
export const STOCK_KEY = "stock_safe" as const;
/**
 * [P1R8 §5.1-앞] 이 글에 붙은 사진 중 **스톡**이 광고성 글 규칙에 걸리나(판정은 `lib/stock-safety.ts` · 여기는 재료만 읽는다).
 *   🔴 **지금은 대부분 «검사할 것이 없음»으로 통과한다** — 스톡 조달(B-1 `lib/stock/`)이 아직 `piece_assets.meta.stock` 을 안 적기 때문이다.
 *      값이 적히기 시작하면 **이 코드를 고치지 않아도 게이트가 켜진다**(없는 것을 있는 척하지 않는다 · AC-9).
 *   🔴 **하드**다(`HARD_GATE_KEYS`) — 라이선스 위반은 «보여만 주고 넘어갈» 종류가 아니다. 걸리면 사진을 바꾸거나 광고를 빼야 한다.
 */
export async function checkStockSafety(tid: number, p: Row): Promise<GateCheck> {
  const label = GATE_LABEL[STOCK_KEY];
  const paid = compensationOfMeta((p.meta || {}) as Record<string, unknown>).need;
  let rows: Row[] = [];
  try {
    rows = await q(sql`SELECT id, meta FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${n(p.id)} AND meta IS NOT NULL ORDER BY sort, id`);
  } catch (e) {
    console.warn("[content-approve] 스톡 출처 조회 실패", String((e as Error)?.message ?? e).slice(0, 120));
    return { key: STOCK_KEY, label, pass: true, detail: "사진 출처를 읽지 못했어요(검사 못 함)" };
  }
  const stocks = rows.map((r) => ({ id: n(r.id), src: stockSourceOf(r.meta) })).filter((x): x is { id: number; src: NonNullable<ReturnType<typeof stockSourceOf>> } => !!x.src);
  if (!stocks.length) return { key: STOCK_KEY, label, pass: true, ...(paid ? { detail: "스톡 사진이 없어요(우리가 만든 그림·고객 사진)" } : {}) };
  const bad = stocks.map((x) => ({ id: x.id, v: assessStockImage(x.src, { paid }) })).filter((x) => !x.v.ok);
  if (!bad.length) return { key: STOCK_KEY, label, pass: true, detail: `스톡 ${stocks.length}장 확인` };
  const first = bad[0];
  return { key: STOCK_KEY, label, pass: false, detail: `사진 ${bad.length}장: ${first.v.reason}${first.v.law ? ` (${first.v.law})` : ""}` };
}

/**
 * recheckPiece — 발행 직전 재검사(승인·수정 공용). 고지·금칙어·제휴 링크 수·유사도 + 12키 게이트.
 *   블록이 정본이면 블록 기준, 사용자가 HTML 을 고쳤으면(`meta.editedByUser`) HTML 기준(구조 검사는 태그로 근사).
 */
/**
 * [R8 §2.1] 그 글에 **적용된** 주제군 — 생성 때 적어 둔 값이 정본이고, 없을 때만(옛 글) 형식·제목으로 다시 잰다.
 *   🔴 다시 잴 때는 `intent` 가 없다 — 생성 때와 다른 답이 나올 수 있다. 그래서 적어 두는 쪽이 먼저다.
 */
function groupOfMeta(m: Record<string, unknown>, p: Row): TopicGroup | null {
  const saved = String(m.topicGroup ?? "");
  if (saved === "review" || saved === "info" || saved === "life") return saved;
  const fmt = String(p.format || m.format || "") || null;
  return fmt ? topicGroupOf({ format: fmt, intent: null, title: String(p.title ?? "") }) : null;
}

export async function recheckPiece(tid: number, p: Row): Promise<GateReport> {
  if (String(p.kind) === "video") return await recheckVideoPiece(tid, p);
  const m = (p.meta || {}) as Record<string, unknown>;
  const blocks = (Array.isArray(p.blocks) ? p.blocks : []) as Block[];
  const html = String(p.body || "");
  const edited = m.editedByUser === true;
  const plain = htmlToPlain(html);
  const comp = compensationOfMeta(m);                       // [R8-A §4] 대가 3종(제휴·협찬·무상 제공) — 하나라도 참이면 고지가 필요하다
  const need = comp.need;
  /* [R8 §2.1] 분량 폭은 **주제군**에 달렸다. 생성 때 적어 둔 값을 그대로 쓴다 — 여기서 다시 계산하면 `intent` 가 없어 다른 답이 나온다.
     그러면 «잰 값은 같은데 기준이 다른» 상태가 된다(AC-70 의 사촌). */
  const group = groupOfMeta(m, p);
  /* [R8 §5D] 어떻게 만들어졌나 — 판정 말투(분량)와 ①에서 안 재는 축을 가르는 값. 옛 글은 "auto". */
  const origin = String(p.origin ?? "auto");
  const checks: GateCheck[] = [];
  const c = await contractFor(String(p.channel), m.emotionKey ? String(m.emotionKey) : null);
  const [acc] = p.account_id ? await q(sql`SELECT persona_id FROM accounts WHERE tenant_id = ${tid} AND id = ${n(p.account_id)}`) : [undefined];
  const [pe] = acc?.persona_id ? await q(sql`SELECT profile FROM personas WHERE id = ${n(acc.persona_id)}`) : await q(sql`SELECT profile FROM personas WHERE tenant_id = ${tid} ORDER BY id LIMIT 1`);
  const terms = personaTerms((pe?.profile || {}) as Record<string, unknown>);
  const others = await q(sql`SELECT id, body FROM pieces WHERE tenant_id = ${tid} AND id <> ${n(p.id)} AND body IS NOT NULL AND (brief_id = ${p.brief_id ? n(p.brief_id) : -1} OR (account_id = ${p.account_id ? n(p.account_id) : -1} AND created_at > NOW() - interval '30 days')) ORDER BY id DESC LIMIT 12`);
  const sim = maxSimilarity(plain, others.map((o) => htmlToPlain(String(o.body))));
  if (!edited && blocks.length) {
    const g = runGate({ blocks, contract: c, personaTerms: terms, meta: { affiliate: m.affiliate ?? m.affiliateHint ?? null, adDisclosure: comp.need, sponsored: comp.sponsored, gift: comp.gift }, similarity: { score: sim.score, against: sim.index >= 0 ? `글 #${others[sim.index]?.id}` : undefined }, title: String(p.title || ""), group, origin });
    const link = await checkLinks(html);   // [P1R7 B3] 소프트 — 승인을 막지 않는다(HARD_GATE_KEYS 밖)
    const st = await checkStructure(tid, p, blocks);   // [R8-A B-1] 소프트 — 골격이 매번 같으면 AI 티다
    const stock = await checkStockSafety(tid, p);      // [P1R8 B3] 스톡 사진 안전(광고성 글 + 사람·상표) — 제3자가 다치는 축
    const full: GateReport = withWeights({ ...g, checks: [...g.checks, link, st, stock], ok: g.ok && link.pass && st.pass && stock.pass });
    return origin === "self" ? applySelfGatePolicy(full) : full;
  }
  // bodyHtml 정본 — 같은 12키(구조 검사는 HTML 태그로 근사)
  const base = runGate({ blocks: [{ type: "para", text: plain }], contract: { ...c, visualMin: {} }, personaTerms: terms, meta: { affiliate: null, adDisclosure: false }, similarity: { score: sim.score }, title: String(p.title || ""), group, origin });
  for (const k of GATE_KEYS) {
    const from = base.checks.find((x) => x.key === k)!;
    if (k === "disclosure") { const d = checkDisclosureHtml(html, need, comp.kinds); checks.push({ key: k, label: GATE_LABEL[k], pass: d.ok, ...(d.detail ? { detail: d.detail } : {}) }); continue; }
    if (k === "visual_min") {
      const cnt = (re: RegExp) => (html.match(re) || []).length; const miss: string[] = []; const vm = c.visualMin;
      if (vm.quote && cnt(/<blockquote(?![^>]*disclosure)/gi) < vm.quote) miss.push(`인용구 ${cnt(/<blockquote(?![^>]*disclosure)/gi)}/${vm.quote}`);
      if (vm.divider && cnt(/<hr/gi) < vm.divider) miss.push(`구분선 ${cnt(/<hr/gi)}/${vm.divider}`);
      if (vm.image && cnt(/<img/gi) < vm.image) miss.push(`사진 ${cnt(/<img/gi)}/${vm.image}`);
      if (vm.h2 && cnt(/<h2/gi) < vm.h2) miss.push(`소제목 ${cnt(/<h2/gi)}/${vm.h2}`);
      if (vm.tableOrList && cnt(/<(table|ul|ol)/gi) < vm.tableOrList) miss.push(`표 또는 리스트 0/${vm.tableOrList}`);
      if (vm.adsense && cnt(/class="adsense"/gi) < vm.adsense) miss.push(`광고 자리 ${cnt(/class="adsense"/gi)}/${vm.adsense}`);
      checks.push({ key: k, label: GATE_LABEL[k], pass: miss.length === 0, ...(miss.length ? { detail: miss.join(" · ") } : {}) }); continue;
    }
    if (k === "affiliate_count") { const links = affiliateLinkCount(html); checks.push({ key: k, label: GATE_LABEL[k], pass: links <= 2, ...(links > 2 ? { detail: `제휴 링크 ${links}개(2개 이하)` } : {}) }); continue; }
    if (k === "banned_words") { const cb = classifyBanned(`${p.title}\n${plain}`, { paid: comp.need, health: isHealthTopic(`${p.title}\n${plain}`) }); const b = [...cb.hard, ...cb.needsProof].map((h) => `«${h.word}»(${h.law})`); checks.push({ key: k, label: GATE_LABEL[k], pass: !b.length, ...(b.length ? { detail: b.join(", ") } : {}) }); continue; }
    checks.push(from);
  }
  checks.push(await checkLinks(html));   // [P1R7 B3] 소프트 링크 검사(HTML 정본 경로도 같은 한 벌)
  checks.push(await checkStockSafety(tid, p));   // [P1R8 B3] 스톡 사진 안전(HTML 정본 경로도 같은 한 벌 · 두 경로가 갈라지지 않게)
  /* [R8 §5D] 직접 쓴 글은 HTML 이 정본이라 **이 경로로 온다** — ① 정책은 여기서도 같이 입힌다(한 곳만 입히면 화면이 갈린다). */
  const out: GateReport = withWeights({ ok: checks.every((x) => x.pass), checks, rewritten: false });
  return origin === "self" ? applySelfGatePolicy(out) : out;
}

/** [P1R5 §1.4-6] 영상에 해당하는 GateKey — HTML 을 전제하는 4키(visual_min·affiliate_count·bullet_ratio·para_repeat)는 영상에 뜻이 없어 빼고, 나머지 8키를 **대본 말**로 잰다. */
export const VIDEO_GATE_KEYS: readonly string[] = ["cliche", "translationese", "sentence_variance", "superlative", "persona", "banned_words", "similarity", "disclosure", "ad_pointing"];

/**
 * recheckVideoPiece — 영상 검수 재검사(계약 §1.8 «approve·publish 직전 재검사» · §1.4-6).
 *   말(대본)은 글과 **같은 판정기**(`runGate`)로 재고, 고지는 영상 3종(배지·시작 3초 자막·설명란 첫 줄)으로,
 *   화면 품질은 `gate_report.judge`(생성 때 `judgeVideo` 가 남긴 축)를 **다시 읽어** 싣는다.
 *   🔴 심사를 여기서 다시 돌리지 않는다 — 판정은 `finalizeRender` 한 곳(R2 §10 «두 곳에서 상태를 쓰지 않는다»). 여기서는 읽어 게이트로 옮길 뿐이다.
 */
export async function recheckVideoPiece(tid: number, p: Row): Promise<GateReport> {
  const m = (p.meta || {}) as Record<string, unknown>;
  const script = (m.script ?? null) as { lines?: { text?: unknown }[] } | null;
  const spoken = (script?.lines ?? []).map((l) => String(l?.text ?? "")).filter(Boolean).join("\n");
  const description = String(p.body || "");                       // 설명란(첫 줄 고지)
  const plain = [spoken, description].filter(Boolean).join("\n");
  const c = await contractFor(String(p.channel), m.emotionKey ? String(m.emotionKey) : null);
  const [acc] = p.account_id ? await q(sql`SELECT persona_id FROM accounts WHERE tenant_id = ${tid} AND id = ${n(p.account_id)}`) : [undefined];
  const [pe] = acc?.persona_id ? await q(sql`SELECT profile FROM personas WHERE id = ${n(acc.persona_id)}`) : await q(sql`SELECT profile FROM personas WHERE tenant_id = ${tid} ORDER BY id LIMIT 1`);
  const terms = personaTerms((pe?.profile || {}) as Record<string, unknown>);
  // 대본 유사도 — 같은 brief 형제 + 같은 계정 30일(글과 같은 규칙 · §1.9 «텍스트 유사도는 대본에 그대로»)
  const others = await q(sql`SELECT id, meta FROM pieces WHERE tenant_id = ${tid} AND kind = 'video' AND id <> ${n(p.id)}
    AND (brief_id = ${p.brief_id ? n(p.brief_id) : -1} OR (account_id = ${p.account_id ? n(p.account_id) : -1} AND created_at > NOW() - interval '30 days')) ORDER BY id DESC LIMIT 12`);
  const otherTexts = others.map((o) => {
    const om = (o.meta || {}) as Record<string, unknown>;
    const ls = ((om.script ?? {}) as { lines?: { text?: unknown }[] }).lines ?? [];
    return ls.map((l) => String(l?.text ?? "")).join("\n");
  }).filter(Boolean);
  const sim = maxSimilarity(spoken, otherTexts);

  const base = runGate({ blocks: [{ type: "para", text: plain }], contract: { ...c, visualMin: {} }, personaTerms: terms, meta: { affiliate: null, adDisclosure: false }, similarity: { score: sim.score, against: sim.index >= 0 ? `영상 #${others[sim.index]?.id}` : undefined }, title: String(p.title || "") });
  const checks: GateCheck[] = base.checks.filter((x) => VIDEO_GATE_KEYS.includes(x.key));

  // 고지 = 영상 3종(배지·시작 3초 자막·설명란 첫 줄) — HTML 판정을 쓰지 않는다.
  const payload = (m.render ?? null) as { overlay?: { badge?: { text?: unknown } | null }; disclosureCaption?: { text?: unknown } | null } | null;
  const d = checkVideoDisclosure(
    { badge: payload?.overlay?.badge ? String(payload.overlay.badge.text ?? "") : null,
      disclosureCaption: payload?.disclosureCaption ? String(payload.disclosureCaption.text ?? "") : null,
      descriptionFirstLine: description.split("\n")[0] ?? "" },
    { affiliate: m.affiliate ?? m.affiliateLink ?? m.affiliateHint ?? null, adDisclosure: m.adDisclosure === true },
  );
  const di = checks.findIndex((x) => x.key === "disclosure");
  const dCheck: GateCheck = { key: "disclosure", label: GATE_LABEL.disclosure, pass: d.ok, ...(d.detail ? { detail: d.detail } : {}) };
  if (di >= 0) checks[di] = dCheck; else checks.push(dCheck);

  // 심사 축 — 생성 때 남은 것을 그대로 싣는다(없으면 «아직 안 구웠다»는 뜻 · 축 없음은 실패가 아니다).
  const prev = (p.gate_report && typeof p.gate_report === "object" ? p.gate_report : null) as GateReport | null;
  const judge = prev?.judge;
  return { ok: checks.every((x) => x.pass) && !(judge?.axes ?? []).some((a) => !a.pass && a.grade === "P0"), checks, rewritten: false, ...(judge ? { judge } : {}) };
}

export type ApproveResult =
  | { ok: true; status: "scheduled"; scheduledFor: string; gate: GateReport; alreadyScheduled?: boolean }
  | { ok: false; step: "gate"; gate: GateReport; error: string }
  | { ok: false; step: "state"; error: string };

/**
 * approvePiece — 승인 전이 **한 곳**: 게이트 재검사 → approved+scheduled(piece·slot 동시) → 감사는 호출부가.
 *   사람(`/api/pieces-approve`)과 크론(`slots.review_deadline`)이 같은 이 함수를 부른다 — 두 기준이 갈라질 여지 0.
 *
 *   시각: piece.scheduled_for → meta.scheduleAt → +1시간. 지금으로부터 5분 안이면 15분 뒤로 민다(발행 직전 승인 사고 방지).
 *     ⚠️ 자동 승인(D-0 02:00)은 발행 시각이 보통 몇 시간 뒤라 이 보정에 걸리지 않는다 — 걸린다면 그 자체가 «너무 늦게 승인됐다»는 신호다.
 */
export async function approvePiece(tid: number, p: Row, opts: { now?: Date } = {}): Promise<ApproveResult> {
  const id = n(p.id);
  const st = String(p.status);
  const now = opts.now ?? new Date();
  if (st === "scheduled" || st === "approved") {
    const at = utcDate(p.scheduled_for)?.toISOString() ?? now.toISOString();
    return { ok: true, status: "scheduled", scheduledFor: at, gate: (p.gate_report && typeof p.gate_report === "object" ? p.gate_report : { ok: true, checks: [], rewritten: false }) as GateReport, alreadyScheduled: true };
  }
  if (st !== "in_review" && st !== "draft") return { ok: false, step: "state", error: "지금 상태에서는 승인할 수 없어요." };

  const gate = await recheckPiece(tid, p);
  /* [R8 §9] 직접 쓴 글은 **자기 표**로 막는다 — 플랫폼 정책은 하드가 아니다(막으면 공장이 선다).
     🔴 AI 가 쓴 글의 표(`HARD_GATE_KEYS`)는 B3 이 §9 잣대로 다시 세는 중이다 — 두 곳에서 각자 좁히지 않게 여기선 갈래만 둔다. */
  /* [R8 §9] 🔴 막는 축은 **0개**다(`HARD_GATE_KEYS` 를 B3 이 비운다) — 갈래를 여기 또 만들지 않는다.
     검사는 계속 돌고 결과는 `gate` 로 나간다. 막지만 않는다. */
  const hard = hardFailures(gate);
  const judged = judgeBlockers(gate);   // [P1R5] 영상 심사 P0(정책·고지·길이·빈 프레임)도 승인을 막는다 · P1/P2 는 통과
  if (hard.length || judged.length) {
    await q(sql`UPDATE pieces SET gate_report = ${jsonb(gate)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${id}`);
    return { ok: false, step: "gate", gate, error: "발행 전 확인이 필요해요." };
  }
  const m = (p.meta || {}) as Record<string, unknown>;
  const at = utcDate(p.scheduled_for) ?? (m.scheduleAt ? new Date(String(m.scheduleAt)) : null) ?? new Date(now.getTime() + 3600_000);
  const atIso = (at.getTime() < now.getTime() + 5 * 60_000 ? new Date(now.getTime() + 15 * 60_000) : at).toISOString();
  await q(sql`UPDATE pieces SET status = 'scheduled', scheduled_for = ${atIso}::timestamptz AT TIME ZONE 'UTC', gate_report = ${jsonb(gate)}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${id}`);
  if (p.slot_id) await q(sql`UPDATE slots SET status = 'scheduled', publish_at = ${atIso}::timestamptz AT TIME ZONE 'UTC', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${n(p.slot_id)}`);
  return { ok: true, status: "scheduled", scheduledFor: atIso, gate };
}
