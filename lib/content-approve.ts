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
import { contractFor } from "./writing-contracts";
import { type Block, htmlToPlain } from "./blocks";
import { runGate, GATE_KEYS, GATE_LABEL, type GateReport, type GateCheck } from "./ai-tell-gate";
import { checkDisclosureHtml } from "./disclosure";
import { findBannedWords, BLOG_EXTRA_BANNED } from "./banned-words";
import { maxSimilarity } from "./similarity";
import { personaTerms } from "./content-gen";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v || 0);

/** 승인을 **막는** 게이트 키(사고 게이트). 나머지는 보여만 준다. */
export const HARD_GATE_KEYS: readonly string[] = ["disclosure", "banned_words", "affiliate_count", "similarity", "superlative"];
/** 이 게이트 결과가 승인을 막는가. */
export function hardFailures(gate: GateReport): GateCheck[] {
  return gate.checks.filter((c) => !c.pass && HARD_GATE_KEYS.includes(c.key));
}

/** 본문 HTML 의 제휴 링크 수(쿠팡 도메인 + affiliate 클래스). */
export function affiliateLinkCount(html: string): number {
  return (html.match(/class="affiliate"/g) || []).length + (html.match(/href="https?:\/\/(link\.coupang|coupa\.ng|www\.coupang)/g) || []).length;
}

/**
 * recheckPiece — 발행 직전 재검사(승인·수정 공용). 고지·금칙어·제휴 링크 수·유사도 + 12키 게이트.
 *   블록이 정본이면 블록 기준, 사용자가 HTML 을 고쳤으면(`meta.editedByUser`) HTML 기준(구조 검사는 태그로 근사).
 */
export async function recheckPiece(tid: number, p: Row): Promise<GateReport> {
  const m = (p.meta || {}) as Record<string, unknown>;
  const blocks = (Array.isArray(p.blocks) ? p.blocks : []) as Block[];
  const html = String(p.body || "");
  const edited = m.editedByUser === true;
  const plain = htmlToPlain(html);
  const need = !!m.affiliate || m.adDisclosure === true || !!m.affiliateHint;
  const checks: GateCheck[] = [];
  const c = await contractFor(String(p.channel), m.emotionKey ? String(m.emotionKey) : null);
  const [acc] = p.account_id ? await q(sql`SELECT persona_id FROM accounts WHERE id = ${n(p.account_id)}`) : [undefined];
  const [pe] = acc?.persona_id ? await q(sql`SELECT profile FROM personas WHERE id = ${n(acc.persona_id)}`) : await q(sql`SELECT profile FROM personas WHERE tenant_id = ${tid} ORDER BY id LIMIT 1`);
  const terms = personaTerms((pe?.profile || {}) as Record<string, unknown>);
  const others = await q(sql`SELECT id, body FROM pieces WHERE tenant_id = ${tid} AND id <> ${n(p.id)} AND body IS NOT NULL AND (brief_id = ${p.brief_id ? n(p.brief_id) : -1} OR (account_id = ${p.account_id ? n(p.account_id) : -1} AND created_at > NOW() - interval '30 days')) ORDER BY id DESC LIMIT 12`);
  const sim = maxSimilarity(plain, others.map((o) => htmlToPlain(String(o.body))));
  if (!edited && blocks.length) {
    return runGate({ blocks, contract: c, personaTerms: terms, meta: { affiliate: m.affiliate ?? m.affiliateHint ?? null, adDisclosure: m.adDisclosure === true }, similarity: { score: sim.score, against: sim.index >= 0 ? `글 #${others[sim.index]?.id}` : undefined }, title: String(p.title || "") });
  }
  // bodyHtml 정본 — 같은 12키(구조 검사는 HTML 태그로 근사)
  const base = runGate({ blocks: [{ type: "para", text: plain }], contract: { ...c, visualMin: {} }, personaTerms: terms, meta: { affiliate: null, adDisclosure: false }, similarity: { score: sim.score }, title: String(p.title || "") });
  for (const k of GATE_KEYS) {
    const from = base.checks.find((x) => x.key === k)!;
    if (k === "disclosure") { const d = checkDisclosureHtml(html, need); checks.push({ key: k, label: GATE_LABEL[k], pass: d.ok, ...(d.detail ? { detail: d.detail } : {}) }); continue; }
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
    if (k === "banned_words") { const b = findBannedWords(`${p.title}\n${plain}`, BLOG_EXTRA_BANNED); checks.push({ key: k, label: GATE_LABEL[k], pass: !b.length, ...(b.length ? { detail: b.join(", ") } : {}) }); continue; }
    checks.push(from);
  }
  return { ok: checks.every((x) => x.pass), checks, rewritten: false };
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
  const hard = hardFailures(gate);
  if (hard.length) {
    await q(sql`UPDATE pieces SET gate_report = ${jsonb(gate)}, updated_at = NOW() WHERE id = ${id}`);
    return { ok: false, step: "gate", gate, error: "발행 전 확인이 필요해요." };
  }
  const m = (p.meta || {}) as Record<string, unknown>;
  const at = utcDate(p.scheduled_for) ?? (m.scheduleAt ? new Date(String(m.scheduleAt)) : null) ?? new Date(now.getTime() + 3600_000);
  const atIso = (at.getTime() < now.getTime() + 5 * 60_000 ? new Date(now.getTime() + 15 * 60_000) : at).toISOString();
  await q(sql`UPDATE pieces SET status = 'scheduled', scheduled_for = ${atIso}::timestamptz AT TIME ZONE 'UTC', gate_report = ${jsonb(gate)}, updated_at = NOW() WHERE id = ${id}`);
  if (p.slot_id) await q(sql`UPDATE slots SET status = 'scheduled', publish_at = ${atIso}::timestamptz AT TIME ZONE 'UTC', updated_at = NOW() WHERE id = ${n(p.slot_id)}`);
  return { ok: true, status: "scheduled", scheduledFor: atIso, gate };
}
