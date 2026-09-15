/**
 * lib/cross-account.ts — 🔴 **계정 간 본문 유사도**(R9-8 · R8 잔여 «위험도 1번» · B · 2026-09-16).
 *   🔎 출처: AC 신규(AM 원본 없음 — AM 은 계정이 하나라 이 축이 없다).
 *
 *   ══ 왜 ══
 *     `content-gen.ts` 의 유사도는 «같은 brief»·«같은 계정 최근 30일»만 봤다. 그런데 우리 고객은 **계정 하나 = IP 하나**로 여러 계정을 굴린다 —
 *     IP 는 돈 주고 나눠 놓고 **글 내용 쪽엔 그 방어가 없었다.** 플랫폼이 «같은 사람이 여러 계정»을 잡을 때 제일 먼저 보는 게 그것이다.
 *   ══ 규칙 ══
 *     · 같은 집(tenant)의 **다른 계정** 최근 `CROSS_ACCOUNT_BODY_DAYS` 일 글(영상 제외 · 최대 `CROSS_ACCOUNT_BODY_LIMIT` 편)과 본문 2-gram 자카드.
 *     · 🔴 교차 테넌트는 보지 않는다(설계 §5F «집계된 숫자만») — WHERE tenant_id 가 그 선이다.
 *     · 🔴 막지 않는다(§9) — 재고 말해 준다. 겹치면 생성이 한 번 다시 쓴다(같은 brief 겹침과 같은 손잡이).
 *     · 🔴 못 재는 둘을 «0점»과 가른다(AC-9): 이 글에 계정이 없다(`no_account`) · 견줄 다른 계정 글이 없다(`no_other_account_posts`).
 *   ══ 한 곳 ══
 *     생성(`content-gen`)과 재검사(`content-approve.recheckPiece`)가 **이 함수 하나**를 부른다 — 자가 둘이면 «잰 값은 같은데 기준이 다른» 상태가 된다.
 *     🔴 별도 파일인 이유: content-gen ↔ content-approve 가 서로를 import 하면 고리다(AC-17). 둘 다 여기만 본다.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { htmlToPlain } from "./blocks";
import { maxSimilarity, CROSS_ACCOUNT_BODY_DAYS, CROSS_ACCOUNT_BODY_LIMIT } from "./similarity";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v || 0);

/** `runGate` 의 `crossAccount` 입력 그대로. */
export interface CrossAccountGateInput { measured: boolean; score: number; against?: string; reason?: string }
/** `pieces.meta.crossSimilarity` 에 적는 모양 — 숫자·id 만(본문·제목 0). */
export interface CrossAccountMeta { measured: boolean; score: number; compared: number; against?: { pieceId: number; accountId: number }; reason?: string }

export async function crossAccountSimilarity(tid: number, pieceId: number, accountId: number | null, plain: string): Promise<{ gate: CrossAccountGateInput; meta: CrossAccountMeta }> {
  if (!accountId) return { gate: { measured: false, score: 0, reason: "no_account" }, meta: { measured: false, score: 0, compared: 0, reason: "no_account" } };
  const rows: Row[] = await q(sql`SELECT p.id, p.account_id, a.handle, p.body FROM pieces p
      LEFT JOIN accounts a ON a.id = p.account_id AND a.tenant_id = p.tenant_id
     WHERE p.tenant_id = ${tid} AND p.id <> ${pieceId} AND p.body IS NOT NULL AND p.kind <> 'video'
       AND p.account_id IS NOT NULL AND p.account_id <> ${accountId}
       AND p.created_at > NOW() - make_interval(days => ${CROSS_ACCOUNT_BODY_DAYS})
     ORDER BY p.id DESC LIMIT ${CROSS_ACCOUNT_BODY_LIMIT}`)
    .catch((e: unknown) => { console.error("[cross-account] 조회 실패 — «못 쟀어요»로 간다", String((e as Error)?.message ?? e).slice(0, 120)); return [] as Row[]; });
  if (!rows.length) return { gate: { measured: false, score: 0, reason: "no_other_account_posts" }, meta: { measured: false, score: 0, compared: 0, reason: "no_other_account_posts" } };
  const s = maxSimilarity(plain, rows.map((o) => htmlToPlain(String(o.body))));
  const hit = s.index >= 0 ? rows[s.index] : null;
  const score = Math.round(s.score * 1000) / 1000;
  return {
    gate: { measured: true, score, ...(hit ? { against: `다른 계정${hit.handle ? `(@${String(hit.handle)})` : ""} 글 #${n(hit.id)}` } : {}) },
    meta: { measured: true, score, compared: rows.length, ...(hit ? { against: { pieceId: n(hit.id), accountId: n(hit.account_id) } } : {}) },
  };
}
