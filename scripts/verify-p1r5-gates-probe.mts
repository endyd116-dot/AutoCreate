/**
 * scripts/verify-p1r5-gates-probe.mts — C 소유 **절대 게이트 프로브**(CLAUDE §4.7 · PITFALLS AC-2).
 *
 *   `npx tsx --env-file=.env scripts/verify-p1r5-gates-probe.mts --tid <테스트 테넌트> [--topic <id>]`
 *   `scripts/verify-p1r5.mjs` 의 `rules` 절이 자식으로 실행하고 `RESULT {json}` 줄을 읽는다.
 *
 *   HTTP 밖에서만 잴 수 있는 것을 잰다 — `/api/director-confirm` 은 사람 경로라 `origin:"manual"` 을 **명시**하므로,
 *   «슬롯 없는 자동 생성»은 API 로 재현되지 않는다(계약 §1.4b: 새 손잡이 없이 `confirm({origin:"auto"})` 를 slotId 없이).
 *     ① 슬롯 없는 자동 생성 → 거부 + `audit_logs(piece_slotless_blocked · risk high)` + piece 0 + 코인 0
 *     ② 같은 조건의 사람 경로(`origin:"manual"`) → 통과(게이트가 사람까지 막으면 그건 다른 사고다)
 *     ③ 다계정 변주 결정론 — 같은 brief 의 i 번째 영상은 훅·팔레트·보이스가 서로 다르고, 다시 물어도 같은 값(`variantFor`)
 *   🔴 테스트 테넌트에서만 · 만든 piece·slot·코인은 끝에서 되돌린다.
 */
import "./_lib/load-env.mjs";   // [R17-B2] 🔴 맨 위 — 없으면 db/index 가 빈 URL 로 풀을 만들어 `read ECONNRESET` 이라는 **가짜 빨강**을 낸다
import { sql } from "drizzle-orm";
import { db, pgClient } from "../db/index";
import { propose, confirm, variantFor } from "../lib/director";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
const out = (step: string, ok: boolean | "WARN", note: string) => console.log(`RESULT ${JSON.stringify({ step, ok, note })}`);
const TID = Number(process.argv[process.argv.indexOf("--tid") + 1] || 0);

async function freshTopic(tid: number): Promise<number> {
  const [t] = await q(sql`SELECT id FROM topics WHERE tenant_id = ${tid} AND status = 'candidate'
    AND id NOT IN (SELECT COALESCE(topic_id, 0) FROM pieces WHERE tenant_id = ${tid}) ORDER BY id DESC LIMIT 1`);
  return n(t?.id);
}
const coins = async (tid: number) => n((await q(sql`SELECT COALESCE(SUM(delta), 0) AS b FROM coin_ledger WHERE tenant_id = ${tid}`))[0]?.b);
const audits = async (tid: number, since: Date) => await q(sql`SELECT action, risk_level FROM audit_logs
  WHERE tenant_id = ${tid} AND action = 'piece_slotless_blocked' AND created_at > ${since.toISOString()}::timestamptz AT TIME ZONE 'UTC'`);

async function main() {
  if (!TID) { out("프로브 인자", false, "--tid <테스트 테넌트> 가 필요하다"); return; }
  const [t] = await q(sql`SELECT (SELECT email FROM users WHERE tenant_id = t.id ORDER BY id LIMIT 1) AS email FROM tenants t WHERE id = ${TID}`);
  if (!String(t?.email ?? "").endsWith("@autocreate.test")) { out("테스트 테넌트 가드", false, `tid ${TID} 은 테스트 집이 아니다`); return; }

  const madePieces: number[] = [];
  try {
    /* ① 슬롯 없는 자동 생성 = 거부(fail-closed) */
    const topicA = await freshTopic(TID);
    if (!topicA) { out("① 슬롯 없는 자동 생성 → piece_slotless_blocked", "WARN", "쓸 수 있는 소재가 없어 못 쟀다"); }
    else {
      const pA = await propose(TID, topicA);
      if (!pA.ok) out("① 슬롯 없는 자동 생성 → piece_slotless_blocked", "WARN", `제안 실패 ${pA.step}: ${pA.error}`);
      else {
        const t0 = new Date(Date.now() - 5_000); const c0 = await coins(TID);
        const r = await confirm(TID, pA.brief.id, [], null, { origin: "auto" });            // 🔴 slotId 없이 · 자동 경로
        const c1 = await coins(TID);
        const gate = await audits(TID, t0);
        const ids = ((r as { pieceIds?: number[] }).pieceIds ?? []).map(Number).filter(Boolean);
        madePieces.push(...ids);
        out("① 슬롯 없는 자동 생성(origin auto · slotId 없음) → 거부 + 감사 piece_slotless_blocked(risk high) + piece 0 + 코인 0",
          !(r as { ok?: boolean }).ok && ids.length === 0 && c0 === c1 && gate.length >= 1 && gate.every((g) => g.risk_level === "high"),
          `ok=${(r as { ok?: boolean }).ok} step=${(r as { step?: string }).step ?? "-"} pieces=${ids.length} 코인 ${c0}→${c1} 감사 ${gate.length}건/${gate[0]?.risk_level ?? "-"}`);
      }
    }

    /* ② 같은 조건의 사람 경로는 통과해야 한다 — 게이트가 사람까지 막으면 그것도 사고다 */
    const topicB = await freshTopic(TID);
    if (!topicB) out("② 사람 경로(origin manual · slotId 없음) → 통과", "WARN", "쓸 수 있는 소재가 없어 못 쟀다");
    else {
      const pB = await propose(TID, topicB);
      if (!pB.ok) out("② 사람 경로(origin manual · slotId 없음) → 통과", "WARN", `제안 실패 ${pB.step}`);
      else {
        const r = await confirm(TID, pB.brief.id, [], null, { origin: "manual" });
        const ids = ((r as { pieceIds?: number[] }).pieceIds ?? []).map(Number).filter(Boolean);
        madePieces.push(...ids);
        out("② 사람 경로(origin manual · slotId 없음) → 통과 · 슬롯은 manual 로 새로 생긴다",
          !!(r as { ok?: boolean }).ok && ids.length >= 1,
          `ok=${(r as { ok?: boolean }).ok} step=${(r as { step?: string }).step ?? "-"} pieces=${ids.join(",") || 0}`);
      }
    }

    /* ③ 변주 결정론 — 같은 brief 안 i 번째끼리 다르고, 다시 물으면 같다 */
    const v0 = variantFor(0, 101), v1 = variantFor(1, 102), v0again = variantFor(0, 101);
    const differs = v0.hookType !== v1.hookType && v0.palette !== v1.palette;
    const stable = JSON.stringify(v0) === JSON.stringify(v0again);
    out("③ 다계정 변주 결정론 — i 가 다르면 훅·팔레트가 다르고, 같은 입력이면 같은 값(재제안 흔들림 0)",
      differs && stable, `i0 ${v0.hookType}/${v0.palette} · i1 ${v1.hookType}/${v1.palette} · 재호출 동일 ${stable}`);
  } catch (e) {
    out("프로브 예외", false, String((e as Error)?.stack ?? e).slice(0, 180));
  } finally {
    for (const id of madePieces) {
      await q(sql`DELETE FROM piece_assets WHERE piece_id = ${id}`).catch(() => []);
      await q(sql`UPDATE slots SET piece_id = NULL WHERE piece_id = ${id}`).catch(() => []);
      await q(sql`DELETE FROM pieces WHERE id = ${id}`).catch(() => []);
    }
    out("프로브 정리(만든 piece 행)", true, `pieces ${madePieces.join(",") || "0"}`);
    await pgClient.end().catch(() => {});
  }
}
await main();
