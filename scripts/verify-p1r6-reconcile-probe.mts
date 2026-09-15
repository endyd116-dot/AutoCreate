/**
 * scripts/verify-p1r6-reconcile-probe.mts — C 소유 **원가 확정 프로브**(P1R6 · `lib/video/cost.ts reconcilePieceCost`).
 *   `npx tsx --env-file=.env scripts/verify-p1r6-reconcile-probe.mts --tid <테스트 테넌트>`
 *
 *   되짚는 것: 컷은 만들었는데 `ai_usage` 기록이 유실된 경우(배경 함수가 중간에 죽는 등) **합이 복구되는가**,
 *   그리고 **두 번 불러도 두 번 더하지 않는가**(멱등 — 안 그러면 달러 캡이 헛돈을 세서 멀쩡한 고객을 막는다).
 *   🔴 테스트 테넌트에서만 · 만든 행은 끝에서 지운다.
 */
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { jsonb } from "../lib/db-util";
import { reconcilePieceCost } from "../lib/video/cost";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Number(v ?? 0);
const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const TID = Number(process.argv[process.argv.indexOf("--tid") + 1] || 0);

async function main() {
  if (!TID) { out("프로브 인자", false, "--tid <테스트 테넌트> 가 필요하다"); return; }
  const [t] = await q(sql`SELECT (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) AS email FROM tenants t WHERE id = ${TID}`);
  if (!String(t?.email ?? "").endsWith("@autocreate.test")) { out("테스트 테넌트 가드", false, `tid ${TID} 은 테스트 집이 아니다`); return; }

  let pieceId = 0;
  try {
    const [p] = await q(sql`INSERT INTO pieces (tenant_id, channel, kind, status, title, meta)
      VALUES (${TID}, 'youtube_shorts', 'video', 'in_review', 'C R6 원가 확정', ${jsonb({ stage: "done" })}) RETURNING id`);
    pieceId = Number(p?.id);
    // 컷 3장: 자산에는 원가가 남았는데 ai_usage 에는 **1장만** 기록된 상태를 만든다(배경 함수가 중간에 죽은 모양).
    for (const [i, usd] of [[0, 0.2], [1, 0.2], [2, 0.2]] as [number, number][]) {
      await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort)
        VALUES (${TID}, ${pieceId}, 'clip', ${`probe/${pieceId}/cut${i}.mp4`}, ${jsonb({ costUsd: usd, provider: "probe" })}, ${i})`);
    }
    await q(sql`INSERT INTO ai_usage (tenant_id, purpose, model, in_tokens, out_tokens, cost_usd, ref, synthetic)
      VALUES (${TID}, 'video_clip', 'probe', 0, 0, 0.2, ${`piece:${pieceId}:cut0`}, true)`);   /* [P1R8] 실제 호출이 아닌 행은 표시한다(운영 «AI 원가»에서 빠진다) */

    const first = await reconcilePieceCost(TID, pieceId);
    const [after1] = await q(sql`SELECT COALESCE(SUM(cost_usd),0) AS usd FROM ai_usage WHERE tenant_id = ${TID} AND ref LIKE ${`%${pieceId}%`}`);
    out("컷 원가가 유실돼도 끝에서 합이 복구된다(자산 $0.60 vs 기록 $0.20 → +$0.40)",
      Math.abs(first.addedUsd - 0.4) < 0.001 && Math.abs(n(after1?.usd) - 0.6) < 0.001,
      `added $${first.addedUsd} · 합계 $${n(after1?.usd).toFixed(4)}`);

    const second = await reconcilePieceCost(TID, pieceId);
    const [after2] = await q(sql`SELECT COALESCE(SUM(cost_usd),0) AS usd FROM ai_usage WHERE tenant_id = ${TID} AND ref LIKE ${`%${pieceId}%`}`);
    out("🔴 두 번 불러도 두 번 더하지 않는다(멱등 — 헛돈을 세면 멀쩡한 고객이 캡에 막힌다)",
      second.addedUsd === 0 && Math.abs(n(after2?.usd) - n(after1?.usd)) < 0.000001,
      `2회차 added $${second.addedUsd} · 합계 $${n(after2?.usd).toFixed(4)}(불변)`);

    const rows = await q(sql`SELECT purpose, ref FROM ai_usage WHERE tenant_id = ${TID} AND purpose = 'video_reconcile'`);
    out("보정분은 `purpose:\"video_reconcile\"` 로 따로 보인다(원가와 보정을 섞지 않는다)",
      rows.length === 1 && String(rows[0].ref) === `video_reconcile:${pieceId}`, `${rows.length}행 · ref ${rows[0]?.ref ?? "-"}`);

    const [aud] = await q(sql`SELECT COUNT(*) AS c FROM audit_logs WHERE tenant_id = ${TID} AND action = 'ai_usage_reconciled'`);
    out("보정 사실이 감사에 남는다(조용한 보정 0)", Number(aud?.c) >= 1, `감사 ${aud?.c}건`);
  } catch (e) {
    out("프로브 예외", false, String((e as Error)?.stack ?? e).slice(0, 180));
  } finally {
    if (pieceId) {
      await q(sql`DELETE FROM piece_assets WHERE piece_id = ${pieceId}`).catch(() => []);
      await q(sql`DELETE FROM ai_usage WHERE tenant_id = ${TID} AND (ref LIKE ${`piece:${pieceId}:%`} OR ref = ${`video_reconcile:${pieceId}`})`).catch(() => []);
      await q(sql`DELETE FROM audit_logs WHERE tenant_id = ${TID} AND action = 'ai_usage_reconciled'`).catch(() => []);
      await q(sql`DELETE FROM pieces WHERE id = ${pieceId}`).catch(() => []);
    }
    out("프로브 정리(piece·자산·원가·감사 행)", true, `piece ${pieceId || "-"}`);
    await pgClient.end().catch(() => {});
  }
}
await main();
