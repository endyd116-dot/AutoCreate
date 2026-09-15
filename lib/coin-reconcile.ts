/**
 * lib/coin-reconcile.ts — 코인 **원장 대조 판정기 한 벌**(AM `coin-reconcile.ts` 자리 · 전수조사 §3.3 «AM 재사용 맵» 빈칸).
 *   소비처 둘이 **같은 판정기**를 쓴다(두 벌을 만들면 사람 눈과 크론이 서로 다른 말을 한다 · PITFALLS #11-b):
 *     · `scripts/verify-coin-reconcile.mts` — 사람이 볼 때(전 테넌트·표로 출력)
 *     · `lib/cron/coin-reconcile.ts`        — 주 1회 스스로(어긋난 행 있을 때만 운영 감사·알림)
 *
 *   ══ 무엇을 세나 ══
 *     잔액은 «원장 합»이다(`coin-ledger.readBalance`). 합이 자기 자신과 같은지 묻는 것은 **항등식**이라 아무것도 못 잡는다(AC-33).
 *     그래서 **합을 못 믿게 만드는 행**을 센다:
 *       ① 음수 잔액 — `readBalance` 가 `Math.max(0, …)` 로 가리는 값(차감이 두 번 들어간 흔적)
 *       ② 소비 ref 중복 — 한 ref 에 consume 3행 이상 또는 같은 bucket 두 번(2행은 included·purchased 분할이라 **정상**)
 *       ③ 환급 초과 — 한 piece 의 환급(`grant` + ref `refund:piece:…`) 합 > 차감 합
 *       ④ 충전 미지급 — `coin_orders.status='paid'` 인데 `kind='purchase' · ref=주문번호` 행이 0건(돈은 받고 코인은 안 준 사고)
 *       ⑤ 만료 규칙 — 충전분(`purchased`)에 만료 없음(1년 · §12.1) · 월 포함분(`ref included:…`)에 만료 없음(그달 말)
 *          🔴 운영자 지급·환급은 만료가 없는 것이 **정상**이라 세지 않는다(정상을 결함으로 세면 아무도 이 표를 안 본다).
 *   🔴 **읽기만 한다** — INSERT·UPDATE·DELETE 0. 고칠지는 사람이 정한다(원장 행을 지우는 순간 추적이 끊긴다).
 *   🔎 출처: AC 신규(2026-09-15 · AM 재사용 맵의 coin-reconcile 자리 — 코드는 AC 원장 규약으로 새로 씀. AM 원본 복사 0)
 */
import { sql } from "drizzle-orm";
import { db } from "../db/index";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Number(v ?? 0);

export type ReconcileKind = "negative_balance" | "consume_dup" | "refund_over" | "paid_not_granted" | "no_expiry";
export interface ReconcileFinding { tid: number; kind: ReconcileKind; label: string; detail: string }
export const RECONCILE_LABEL: Readonly<Record<ReconcileKind, string>> = {
  negative_balance: "음수 잔액", consume_dup: "소비 중복", refund_over: "환급 초과", paid_not_granted: "충전 미지급", no_expiry: "만료 없는 지급",
};

/** 대조 — `tid` 를 주면 그 집만. 반환은 «어긋난 행» 목록(빈 배열 = 걸린 것 없음). */
export async function reconcileCoins(tid?: number | null): Promise<ReconcileFinding[]> {
  const only = tid ? sql`AND tenant_id = ${tid}` : sql``;
  const out: ReconcileFinding[] = [];
  const push = (kind: ReconcileKind, t: unknown, detail: string) => out.push({ tid: n(t), kind, label: RECONCILE_LABEL[kind], detail });

  // ① 음수 잔액 — 화면에 0 으로 가려지기 전의 값
  for (const r of await q(sql`SELECT tenant_id, bucket, SUM(delta)::int AS s FROM coin_ledger
    WHERE (expires_at IS NULL OR expires_at > NOW()) ${only}
    GROUP BY tenant_id, bucket HAVING SUM(delta) < 0 ORDER BY tenant_id`)) {
    push("negative_balance", r.tenant_id, `bucket ${r.bucket} 합 ${n(r.s)} — 화면엔 0 으로 보인다(차감 중복 의심)`);
  }

  // ② 소비 ref 중복 — 2행(included+purchased 분할)은 정상
  for (const r of await q(sql`SELECT tenant_id, ref, COUNT(*)::int AS c, COUNT(DISTINCT bucket)::int AS b, SUM(delta)::int AS s FROM coin_ledger
    WHERE kind = 'consume' AND ref IS NOT NULL ${only}
    GROUP BY tenant_id, ref HAVING COUNT(*) > 2 OR COUNT(*) <> COUNT(DISTINCT bucket) ORDER BY tenant_id, ref`)) {
    push("consume_dup", r.tenant_id, `ref ${r.ref} 에 consume ${n(r.c)}행(bucket ${n(r.b)}종 · 합 ${n(r.s)}) — piece 당 1회 위반 의심`);
  }

  // ③ 환급 초과 — 환급은 kind 'grant' + ref `refund:piece:{id}:c{n}` · 차감은 `piece:{id}`·`piece:{id}:img{i}`
  for (const r of await q(sql`WITH x AS (
      SELECT tenant_id,
        CASE WHEN ref LIKE 'refund:piece:%' THEN split_part(ref, ':', 3) ELSE split_part(ref, ':', 2) END AS pid,
        CASE WHEN kind = 'consume' THEN -delta ELSE 0 END AS consumed,
        CASE WHEN kind = 'grant' AND ref LIKE 'refund:piece:%' THEN delta ELSE 0 END AS refunded
      FROM coin_ledger WHERE ref IS NOT NULL AND (ref LIKE 'piece:%' OR ref LIKE 'refund:piece:%') ${only})
    SELECT tenant_id, pid, SUM(consumed)::int AS consumed, SUM(refunded)::int AS refunded FROM x
    GROUP BY tenant_id, pid HAVING SUM(refunded) > SUM(consumed) ORDER BY tenant_id`)) {
    push("refund_over", r.tenant_id, `piece ${r.pid}: 차감 ${n(r.consumed)} · 환급 ${n(r.refunded)}`);
  }

  // ④ 결제된 충전인데 원장 행 0
  for (const r of await q(sql`SELECT o.tenant_id, o.order_no, o.coins, o.krw FROM coin_orders o
    WHERE o.status = 'paid' ${tid ? sql`AND o.tenant_id = ${tid}` : sql``}
      AND NOT EXISTS (SELECT 1 FROM coin_ledger l WHERE l.tenant_id = o.tenant_id AND l.kind = 'purchase' AND l.ref = o.order_no)
    ORDER BY o.tenant_id, o.id`)) {
    push("paid_not_granted", r.tenant_id, `주문 ${r.order_no}(₩${n(r.krw)} · ${n(r.coins)}코인) 결제됐는데 원장 행 0`);
  }

  // ⑤ 만료 규칙
  for (const r of await q(sql`SELECT tenant_id, bucket, COUNT(*)::int AS c FROM coin_ledger
    WHERE delta > 0 AND expires_at IS NULL ${only} AND (bucket = 'purchased' OR ref LIKE 'included:%')
    GROUP BY tenant_id, bucket ORDER BY tenant_id`)) {
    push("no_expiry", r.tenant_id, `bucket ${r.bucket} ${n(r.c)}행 — ${r.bucket === "purchased" ? "충전분 1년 유효" : "월 포함분 그달 말"} 규칙과 다르다`);
  }

  return out;
}

/** 잔액(만료 제외) — 표에 «지금 얼마»를 같이 보여 줄 때 쓴다. */
export async function balancesOf(tid?: number | null): Promise<Map<number, number>> {
  const rows = await q(sql`SELECT tenant_id, COALESCE(SUM(delta),0)::int AS s FROM coin_ledger
    WHERE (expires_at IS NULL OR expires_at > NOW()) ${tid ? sql`AND tenant_id = ${tid}` : sql``} GROUP BY tenant_id`);
  return new Map(rows.map((r) => [n(r.tenant_id), n(r.s)]));
}
