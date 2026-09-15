/**
 * scripts/verify-coin-reconcile.mts — 코인 **원장 대조**(AM `coin-reconcile.ts` 자리 · 전수조사 §3.3 «AM 재사용 맵»에서 비어 있던 한 칸).
 *   `npx tsx --env-file=.env scripts/verify-coin-reconcile.mts [--tid 123] [--json]`
 *
 *   ══ 왜 있나 ══
 *     잔액은 «원장 합»이다(`lib/coin-ledger.ts readBalance`). 그런데 원장에 **잘못된 행**이 들어가면 잔액은 조용히 틀린다 —
 *     고객은 «코인이 왜 이것밖에 없지»를 묻고, 우리는 어디서 어긋났는지 뒤늦게 찾는다. 이 스크립트는 **읽기만** 하면서
 *     «합이 맞나»가 아니라 **«합을 못 믿게 만드는 행이 있나»** 를 센다(합은 정의상 언제나 자기 자신과 같다 — AC-33 항등식 함정).
 *
 *   ══ 세는 것(테넌트마다) ══
 *     ① 음수 잔액(bucket 별) — `readBalance` 가 `Math.max(0, …)` 로 가려 버리는 값. 가려진 음수는 **차감이 두 번 들어간 흔적**이다.
 *     ② 소비 ref 중복 — 한 `ref` 에 consume 이 3행 이상이거나 같은 bucket 이 두 번(2행은 included·purchased 분할이라 **정상**).
 *     ③ 환급 초과 — 한 piece 의 환급(`grant` + ref `refund:piece:…`) 합 > 차감 합(돌려준 게 더 많다).
 *     ④ 결제된 충전인데 원장 행이 없음 — `coin_orders.status='paid'` 인데 `kind='purchase' · ref=주문번호` 행이 0건(돈은 받고 코인은 안 준 사고).
 *     ⑤ 만료 규칙 어긋남 — 충전분(`purchased`)에 `expires_at` 없음(1년 · §12.1) · 월 포함분(`ref included:…`)에 만료 없음(그달 말).
 *   🔴 읽기 전용 — INSERT·UPDATE·DELETE 0. 고칠 것은 사람이 판단한다(원장 행을 지우는 순간 추적이 끊긴다).
 *   🔴 «없음»을 «괜찮음»으로 적지 않는다(AC-9) — 테넌트가 0이면 그렇게 말한다.
 */
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Number(v ?? 0);
const argv = process.argv.slice(2);
const TID = Number(argv[argv.indexOf("--tid") + 1] || 0) || null;
const AS_JSON = argv.includes("--json");

interface Finding { tid: number; kind: string; detail: string }

async function main() {
  const findings: Finding[] = [];
  const tenants = await q(TID
    ? sql`SELECT id, key, plan_key FROM tenants WHERE id = ${TID}`
    : sql`SELECT id, key, plan_key FROM tenants ORDER BY id`);
  if (!tenants.length) { console.log(TID ? `테넌트 ${TID} 이 없다.` : "테넌트가 0집이다."); return; }

  /* ① 음수 잔액 — readBalance 가 0 으로 가리는 값을 **가리기 전에** 본다. */
  const neg = await q(sql`SELECT tenant_id, bucket, SUM(delta)::int AS s FROM coin_ledger
    WHERE (expires_at IS NULL OR expires_at > NOW()) ${TID ? sql`AND tenant_id = ${TID}` : sql``}
    GROUP BY tenant_id, bucket HAVING SUM(delta) < 0 ORDER BY tenant_id`);
  for (const r of neg) findings.push({ tid: n(r.tenant_id), kind: "음수 잔액", detail: `bucket ${r.bucket} 합 ${n(r.s)} — 화면엔 0 으로 보인다(차감 중복 의심)` });

  /* ② 소비 ref 중복 — 코인은 piece 당 1회(멱등 ref).
     🔴 한 ref 에 **2행**은 정상이다 — 차감이 included·purchased 로 갈릴 수 있다(coin-ledger.ts:92 두 번 INSERT).
        그래서 «3행 이상» 또는 «같은 bucket 이 두 번»만 센다(유니크 (tenant,kind,ref,bucket) 를 우회한 흔적). */
  const dup = await q(sql`SELECT tenant_id, ref, COUNT(*)::int AS c, COUNT(DISTINCT bucket)::int AS b, SUM(delta)::int AS s FROM coin_ledger
    WHERE kind = 'consume' AND ref IS NOT NULL ${TID ? sql`AND tenant_id = ${TID}` : sql``}
    GROUP BY tenant_id, ref HAVING COUNT(*) > 2 OR COUNT(*) <> COUNT(DISTINCT bucket) ORDER BY tenant_id, ref`);
  for (const r of dup) findings.push({ tid: n(r.tenant_id), kind: "소비 중복", detail: `ref ${r.ref} 에 consume ${n(r.c)}행(bucket ${n(r.b)}종 · 합 ${n(r.s)}) — piece 당 1회 위반 의심` });

  /* ③ 환급 초과 — 한 piece 에서 돌려준 양이 가져간 양보다 많다.
     환급은 **kind 'grant' + ref `refund:piece:{id}:c{n}`**(coin-ledger.ts:127) · 차감은 `piece:{id}`·`piece:{id}:img{i}` — 그래서 piece id 로 모은다. */
  const over = await q(sql`WITH x AS (
      SELECT tenant_id,
        CASE WHEN ref LIKE 'refund:piece:%' THEN split_part(ref, ':', 3) ELSE split_part(ref, ':', 2) END AS pid,
        CASE WHEN kind = 'consume' THEN -delta ELSE 0 END AS consumed,
        CASE WHEN kind = 'grant' AND ref LIKE 'refund:piece:%' THEN delta ELSE 0 END AS refunded
      FROM coin_ledger
      WHERE ref IS NOT NULL AND (ref LIKE 'piece:%' OR ref LIKE 'refund:piece:%') ${TID ? sql`AND tenant_id = ${TID}` : sql``})
    SELECT tenant_id, pid, SUM(consumed)::int AS consumed, SUM(refunded)::int AS refunded FROM x
    GROUP BY tenant_id, pid HAVING SUM(refunded) > SUM(consumed) ORDER BY tenant_id`);
  for (const r of over) findings.push({ tid: n(r.tenant_id), kind: "환급 초과", detail: `piece ${r.pid}: 차감 ${n(r.consumed)} · 환급 ${n(r.refunded)}` });

  /* ④ 결제된 충전인데 원장 행 0 — 돈은 받고 코인은 안 준 경우(주문번호로 대조). */
  const paidNoGrant = await q(sql`SELECT o.tenant_id, o.order_no, o.coins, o.krw FROM coin_orders o
    WHERE o.status = 'paid' ${TID ? sql`AND o.tenant_id = ${TID}` : sql``}
      AND NOT EXISTS (SELECT 1 FROM coin_ledger l WHERE l.tenant_id = o.tenant_id AND l.kind = 'purchase' AND l.ref = o.order_no)
    ORDER BY o.tenant_id, o.id`);
  for (const r of paidNoGrant) findings.push({ tid: n(r.tenant_id), kind: "충전 미지급", detail: `주문 ${r.order_no}(₩${n(r.krw)} · ${n(r.coins)}코인) 결제됐는데 원장 행 0` });

  /* ⑤ 만료 규칙 — **충전분은 1년**(§12.1) · **월 포함분은 그달 말**(ref `included:{tid}:{YYYY-MM}`).
     🔴 운영자 지급·환급(kind 'grant' · ref refund:… 또는 없음)은 **만료가 없는 것이 정상**이라 세지 않는다 — 정상을 결함으로 세면 이 표를 아무도 안 본다. */
  const noExpiry = await q(sql`SELECT tenant_id, bucket, COUNT(*)::int AS c FROM coin_ledger
    WHERE delta > 0 AND expires_at IS NULL ${TID ? sql`AND tenant_id = ${TID}` : sql``}
      AND (bucket = 'purchased' OR ref LIKE 'included:%')
    GROUP BY tenant_id, bucket ORDER BY tenant_id`);
  for (const r of noExpiry) findings.push({ tid: n(r.tenant_id), kind: "만료 없는 지급", detail: `bucket ${r.bucket} ${n(r.c)}행 — ${r.bucket === "purchased" ? "충전분 1년 유효" : "월 포함분 그달 말"} 규칙과 다르다` });

  /* 요약 — 잔액도 함께 보여 준다(사람이 «이 집이 지금 얼마»를 같이 봐야 판단한다). */
  const bal = await q(sql`SELECT tenant_id, COALESCE(SUM(delta),0)::int AS s FROM coin_ledger
    WHERE (expires_at IS NULL OR expires_at > NOW()) ${TID ? sql`AND tenant_id = ${TID}` : sql``} GROUP BY tenant_id`);
  const balOf = new Map(bal.map((r) => [n(r.tenant_id), n(r.s)]));

  if (AS_JSON) { console.log(JSON.stringify({ at: new Date().toISOString(), tenants: tenants.length, findings }, null, 2)); return; }
  console.log(`코인 원장 대조 · 테넌트 ${tenants.length}집 · ${new Date().toISOString()}`);
  console.log("─".repeat(100));
  if (!findings.length) { console.log(`어긋난 행 0 — 검사 5종(음수 잔액 · 소비 중복 · 환급 초과 · 충전 미지급 · 만료 없는 지급) 전부 걸린 것 없음.`); }
  else {
    const byTid = new Map<number, Finding[]>();
    for (const f of findings) byTid.set(f.tid, [...(byTid.get(f.tid) ?? []), f]);
    for (const [tid, list] of [...byTid].sort((a, b) => a[0] - b[0])) {
      const t = tenants.find((x) => n(x.id) === tid);
      console.log(`\n■ 테넌트 ${tid}${t ? ` (${t.key} · ${t.plan_key})` : ""} · 지금 잔액 ${balOf.get(tid) ?? 0}코인`);
      for (const f of list) console.log(`  ✗ ${f.kind} — ${f.detail}`);
    }
    console.log(`\n─`.repeat(1) + "─".repeat(99));
    console.log(`총 ${findings.length}건 — 🔴 이 스크립트는 **고치지 않는다**. 원장 행을 지우면 추적이 끊기니, 무엇을 할지는 사람이 정한다.`);
  }
  process.exitCode = findings.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pgClient.end().catch(() => {}));
