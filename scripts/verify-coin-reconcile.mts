/**
 * scripts/verify-coin-reconcile.mts — 코인 **원장 대조**(사람이 볼 때). 판정기는 `lib/coin-reconcile.ts` 한 벌을 쓴다
 *   (크론 스텝 `coin.reconcile` 과 **같은 함수** — 두 벌이면 사람 눈과 크론이 서로 다른 말을 한다 · PITFALLS #11-b).
 *   `npx tsx --env-file=.env scripts/verify-coin-reconcile.mts [--tid 123] [--json]`
 *   🔴 읽기 전용(INSERT·UPDATE·DELETE 0) · «없음»을 «괜찮음»으로 적지 않는다(AC-9 — 0집이면 그렇게 말한다).
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { reconcileCoins, balancesOf, type ReconcileFinding } from "../lib/coin-reconcile";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Number(v ?? 0);
const argv = process.argv.slice(2);
const TID = Number(argv[argv.indexOf("--tid") + 1] || 0) || null;
const AS_JSON = argv.includes("--json");

async function main() {
  const tenants = await q(TID
    ? sql`SELECT id, key, plan_key FROM tenants WHERE id = ${TID}`
    : sql`SELECT id, key, plan_key FROM tenants ORDER BY id`);
  if (!tenants.length) { console.log(TID ? `테넌트 ${TID} 이 없다.` : "테넌트가 0집이다."); return; }

  const findings = await reconcileCoins(TID);
  const balOf = await balancesOf(TID);

  if (AS_JSON) { console.log(JSON.stringify({ at: new Date().toISOString(), tenants: tenants.length, findings }, null, 2)); return; }
  console.log(`코인 원장 대조 · 테넌트 ${tenants.length}집 · ${new Date().toISOString()}`);
  console.log("─".repeat(100));
  if (!findings.length) {
    console.log("어긋난 행 0 — 검사 5종(음수 잔액 · 소비 중복 · 환급 초과 · 충전 미지급 · 만료 없는 지급) 전부 걸린 것 없음.");
  } else {
    const byTid = new Map<number, ReconcileFinding[]>();
    for (const f of findings) byTid.set(f.tid, [...(byTid.get(f.tid) ?? []), f]);
    for (const [tid, list] of [...byTid].sort((a, b) => a[0] - b[0])) {
      const t = tenants.find((x) => n(x.id) === tid);
      console.log(`\n■ 테넌트 ${tid}${t ? ` (${t.key} · ${t.plan_key})` : ""} · 지금 잔액 ${balOf.get(tid) ?? 0}코인`);
      for (const f of list) console.log(`  ✗ ${f.label} — ${f.detail}`);
    }
    console.log("\n" + "─".repeat(100));
    console.log(`총 ${findings.length}건 — 🔴 이 스크립트는 **고치지 않는다**. 원장 행을 지우면 추적이 끊기니, 무엇을 할지는 사람이 정한다.`);
  }
  process.exitCode = findings.length ? 1 : 0;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => pgClient.end().catch(() => {}));
