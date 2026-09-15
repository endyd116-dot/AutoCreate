/**
 * scripts/_teardown.mjs — 하니스 공용 «치우고 끝낸다»(계약 P1R7 §3.5 · B2 러너 하니스 teardown 방식 그대로).
 *   왜: 검증 하니스가 만든 테넌트가 라이브에 쌓여 **운영 숫자(테넌트 수·MRR·AI 원가)를 오염**시켰다(2026-09-15 대청소 88집).
 *   규율 3(순서까지 B2 와 같다): ① **보존 id 우선 거부** ② 상태 확인(구독 살아 있으면 손대지 않는다) ③ 실행.
 *   🔴 절대 던지지 않는다 — teardown 이 실패해서 검증 결과가 사라지면 안 된다(결과 출력 전에 부르는 `finally` 용).
 *
 *   쓰는 법:
 *     import { teardownRun } from "./_teardown.mjs";
 *     const note = await teardownRun(sql, { tenants: made, since: T0, operatorIds: [opId], label: "P1R2" });
 *     rec("정리(teardown)", !note.failed, note.text);
 *
 *   두 갈래:
 *     · **하니스가 만든 테넌트**(보존 밖) → 통째로 삭제(FK 위상은 «되는 것부터» 4패스 · tenant_id 칸 있는 표 자동 열거).
 *     · **보존 테넌트**(3·13·109·116·198 — C검증·B2실증·애드포스트·사장님 계정) → 집은 남기고 **이번 실행이 만든 행만**(created_at ≥ since) 지운다.
 */
export const PROTECT = new Set([3, 13, 109, 116, 198]);
/** 보존 테넌트에서 «이번 실행 산출물»만 지울 때 건드리는 표(시각 칸이 있고, 지워도 다음 실행이 다시 만드는 것들). */
export const ARTIFACT_TABLES = ["piece_assets", "posts", "runner_jobs", "slots", "pieces", "briefs", "topics", "notifications", "revenue_daily", "revenue_sources", "cadence_rules", "personas", "consents"];
/** 지우지 않는 표 — 원가 이력·결제 이력(대청소 스크립트와 같은 판단). */
export const KEEP_TABLES = new Set(["tenants", "ai_usage", "invoices"]);

const num = (v) => Number(v || 0);

/** tenant_id 칸이 있는 표(보존 표 제외). */
async function tenantTables(sql) {
  const rows = await sql`SELECT DISTINCT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY table_name`;
  return rows.map((r) => String(r.table_name)).filter((t) => !KEEP_TABLES.has(t));
}
/** tenant_id 없이 FK 로만 매달린 자식(ticket_messages 등) — 부모 서브쿼리로 먼저 지운다. */
async function orphanChildren(sql, parents) {
  const fks = await sql`SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent, ccu.column_name AS pcol
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  return fks.filter((f) => parents.has(String(f.parent)) && !parents.has(String(f.child)) && !KEEP_TABLES.has(String(f.child)))
    .map((f) => ({ child: String(f.child), col: String(f.col), parent: String(f.parent), pcol: String(f.pcol) }));
}
/** 살아 있는 유료 구독이면 손대지 않는다(검증 중 실수로 고객 집을 지우는 것 방지 — 두 번째 잠금). */
async function hasLiveSubscription(sql, tid) {
  try {
    const [s] = await sql`SELECT status, cancel_at_period_end FROM subscriptions WHERE tenant_id = ${tid}`;
    return !!s && String(s.status) === "active" && s.cancel_at_period_end !== true;
  } catch { return false; }
}

/**
 * teardownRun(sql, opts) — 하니스 끝(성공·실패·예외 모두)에서 부른다.
 *   opts: { tenants:number[] · since?:Date|string(보존 테넌트 산출물 기준 시각) · operatorIds?:number[] · label?:string · dryRun?:boolean }
 *   반환: { text, deleted, kept, artifacts, failed } — `text` 를 그대로 결과표 note 에 넣으면 된다.
 */
export async function teardownRun(sql, opts = {}) {
  const out = { text: "", deleted: [], kept: [], artifacts: 0, failed: false };
  if (!sql) { out.text = "DB 연결 없음 — 정리 건너뜀"; out.failed = true; return out; }
  const ids = [...new Set((opts.tenants || []).map(num).filter((x) => x > 0))];
  const since = opts.since ? new Date(opts.since).toISOString() : null;
  try {
    const tables = await tenantTables(sql);
    const parents = new Set([...tables, "tenants"]);
    const orphans = await orphanChildren(sql, parents);

    for (const tid of ids) {
      // ① 보존 id 우선 — 집은 절대 지우지 않는다. since 가 있으면 이번 실행 산출물만 지운다.
      if (PROTECT.has(tid)) {
        out.kept.push(tid);
        if (!since || opts.dryRun) continue;
        for (const tb of ARTIFACT_TABLES) {
          try {
            const del = await sql.unsafe(`DELETE FROM ${tb} WHERE tenant_id = $1 AND created_at >= $2 RETURNING 1`, [tid, since]);
            out.artifacts += del.length;
          } catch { /* 시각 칸이 없는 표는 건너뛴다 */ }
        }
        continue;
      }
      // ② 상태 확인 — 살아 있는 구독이면 건드리지 않는다.
      if (await hasLiveSubscription(sql, tid)) { out.kept.push(tid); continue; }
      if (opts.dryRun) { out.deleted.push(tid); continue; }
      // ③ 실행 — 고아 자식 → 테넌트 표 4패스 → tenants.
      for (const f of orphans) {
        try { await sql.unsafe(`DELETE FROM ${f.child} WHERE ${f.col} IN (SELECT ${f.pcol} FROM ${f.parent} WHERE tenant_id = $1)`, [tid]); } catch { /* */ }
      }
      let left = [...tables];
      for (let pass = 0; pass < 4 && left.length; pass++) {
        const next = [];
        for (const tb of left) { try { await sql.unsafe(`DELETE FROM ${tb} WHERE tenant_id = $1`, [tid]); } catch { next.push(tb); } }
        left = next;
      }
      try { await sql.unsafe(`DELETE FROM invoices WHERE tenant_id = $1`, [tid]); } catch { /* 하니스 테넌트의 결제 이력은 보존 대상이 아니다(실결제 0) */ }
      try { await sql.unsafe(`DELETE FROM tenants WHERE id = $1`, [tid]); out.deleted.push(tid); }
      catch (e) { out.failed = true; console.error(`[teardown] tenants ${tid} 삭제 실패 — ${String(e?.message ?? e).slice(0, 120)}`); }
    }

    // 임시 운영자(하니스가 만든 것)
    for (const oid of [...new Set((opts.operatorIds || []).map(num).filter((x) => x > 0))]) {
      if (opts.dryRun) continue;
      try { await sql.unsafe(`DELETE FROM audit_logs WHERE actor_id = $1 AND actor_type = 'operator'`, [oid]); } catch { /* */ }
      try { await sql.unsafe(`DELETE FROM operators WHERE id = $1`, [oid]); } catch { /* */ }
    }
  } catch (e) {
    out.failed = true;
    out.text = `정리 실패 — ${String(e?.message ?? e).slice(0, 160)}`;
    console.error("[teardown] 실패", e);
    return out;
  }
  const bits = [];
  if (out.deleted.length) bits.push(`삭제 ${out.deleted.length}집(${out.deleted.join(",")})`);
  if (out.kept.length) bits.push(`보존 ${out.kept.length}집(${out.kept.join(",")})${since ? ` · 산출물 ${out.artifacts}행 정리` : ""}`);
  if (!bits.length) bits.push("지울 것 없음");
  out.text = `${opts.label ? opts.label + " " : ""}${bits.join(" · ")}${opts.dryRun ? " (드라이런)" : ""}`;
  return out;
}
