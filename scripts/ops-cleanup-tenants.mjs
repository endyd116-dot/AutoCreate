/**
 * scripts/ops-cleanup-tenants.mjs — 하니스가 남긴 테스트 테넌트 정리(재사용 · 2026-09-15 `ops_live_cleanup` 일반화).
 *
 *   node scripts/ops-cleanup-tenants.mjs                       # 드라이런(기본) — 삭제 예정 목록·표별 행 수만 출력 · 아무것도 안 지운다
 *   node scripts/ops-cleanup-tenants.mjs --apply               # 실제 삭제(🔴 라이브 · 사장님 Allow 뒤에만)
 *     --keep=200,210,211              지금 하니스가 쓰는 테넌트(보호 목록에 더한다 · 각자 끝나고 자기가 지운다)
 *     --revenue-test-rows             보호 테넌트 3 의 revenue_daily 테스트 입력(sponsor manual · meta manual · adpost runner)도 지운다
 *     --include-unknown               테스트 도메인이 아닌 이메일(실고객 의심)도 삭제 대상에 넣는다(기본은 제외·경고만)
 *     --no-r2                         R2 접두(autocreate/{tid}/) 삭제를 건너뛴다
 *
 *   ══ 규칙 ══
 *   · 🔴 보호 목록 하드코딩 PROTECT(3·13·109·116·198) — 무슨 옵션을 줘도 절대 안 지운다.
 *   · 삭제 대상 = 나머지 전부 중 «테스트 도메인»(autocreate.test · test.local · autocreate.dev · example.invalid) 또는 사용자 없는 테넌트.
 *     그 밖의 도메인은 실고객 의심 → 기본 제외 + 경고(`--include-unknown` 으로만 포함).
 *   · 표는 information_schema 로 **자동 열거**(tenant_id 칸 가진 표 전부) → FK 위상 정렬(참조하는 표 먼저) → tenant_id 없는 자식 표(ticket_messages·refresh_tokens 류)는 FK 를 따라 서브쿼리로.
 *     빠지는 표 0 — 새 표가 생겨도 스크립트를 안 고친다.
 *   · `ai_usage` 는 **지우지 않는다**(원가 이력 · tenant_id 만 남는다 · 대시보드 원가 합은 유지).
 *   · 삭제 전 스냅샷 감사 1행(`ops_live_cleanup` · tid 목록·표별 행 수·옵션) → 삭제 → 되읽기(남은 테넌트·활성 유료·activeTenants).
 *   · R2: 삭제 tid 마다 lib/r2.ts `r2DeletePrefix("autocreate/{tid}/")`(dryRun 연동 · R2 미설정이면 건너뛴다).
 *   · DB 풀은 이 스크립트 하나(postgres · max 1) — lib 풀을 같이 열지 않는다(AC-41).
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");   // 한글 경로 %ENC 문제 — fileURLToPath 로만
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const a = args.find((x) => x.startsWith(`${k}=`)); return a ? a.slice(k.length + 1) : ""; };
const APPLY = flag("--apply");
const PROTECT = [3, 13, 109, 116, 198];
const KEEP = opt("--keep").split(",").map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
const TEST_DOMAINS = ["autocreate.test", "test.local", "autocreate.dev", "example.invalid"];
const NEVER_DELETE_TABLES = new Set(["ai_usage", "tenants"]);

const env = Object.fromEntries(fs.readFileSync(path.join(ROOT, ".env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
for (const [k, v] of Object.entries(env)) if (!process.env[k]) process.env[k] = v;
const sql = postgres(process.env.NETLIFY_DATABASE_URL, { ssl: "require", prepare: false, max: 1 });
const n = (v) => Number(v || 0);
const log = (...a) => console.log(...a);

try {
  log(`■ ops-cleanup-tenants · ${APPLY ? "🔴 APPLY(실제 삭제)" : "드라이런(아무것도 안 지움)"} · 보호 ${PROTECT.join(",")}${KEEP.length ? ` · keep ${KEEP.join(",")}` : ""}`);
  const protect = new Set([...PROTECT, ...KEEP]);

  /* 1. 후보 — 보호 제외 · 도메인 판정 */
  const rows = await sql`SELECT t.id, t.name, t.status, t.plan_key, t.created_at,
      (SELECT string_agg(u.email, ',') FROM users u WHERE u.tenant_id = t.id) AS emails,
      (SELECT COUNT(*) FROM billing_keys b WHERE b.tenant_id = t.id AND b.active) AS bk,
      (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id = t.id AND i.status IN ('paid','refunded')) AS inv
    FROM tenants t ORDER BY t.id`;
  const targets = [], unknown = [], kept = [];
  for (const r of rows) {
    const id = n(r.id);
    if (protect.has(id)) { kept.push(r); continue; }
    const emails = String(r.emails || "");
    const domains = emails ? emails.split(",").map((e) => e.split("@")[1] || "") : [];
    const isTest = !emails || domains.every((d) => TEST_DOMAINS.includes(d));
    if (!isTest && !flag("--include-unknown")) { unknown.push(r); continue; }
    targets.push(r);
  }
  const tids = targets.map((r) => n(r.id));
  log(`총 ${rows.length} · 남길 ${kept.length}(${kept.map((r) => `${r.id} ${r.name}`).join(" · ")})`);
  if (unknown.length) log(`⚠️ 실고객 의심(테스트 도메인 아님 · 기본 제외): ${unknown.map((r) => `${r.id} ${r.emails}`).join(" · ")}`);
  const moneyTargets = targets.filter((r) => n(r.bk) > 0 || n(r.inv) > 0);
  if (moneyTargets.length) log(`⚠️ 삭제 대상 중 빌키·결제 인보이스 있는 곳: ${moneyTargets.map((r) => `${r.id}(bk ${r.bk} · inv ${r.inv})`).join(" · ")}`);
  log(`삭제 대상 ${tids.length}곳: ${tids.join(",")}`);

  /* 2. 표 자동 열거 + FK 위상 정렬 */
  const tt = await sql`SELECT DISTINCT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id'`;
  const tenantTables = tt.map((x) => String(x.table_name)).filter((t) => !NEVER_DELETE_TABLES.has(t));
  const fks = await sql`SELECT tc.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'`;
  const set = new Set(tenantTables);
  // 참조하는 표(child)를 참조되는 표(parent)보다 먼저 지운다.
  const order = []; const seen = new Set();
  const visit = (t, stack = new Set()) => {
    if (seen.has(t) || !set.has(t)) return; if (stack.has(t)) return;
    stack.add(t);
    for (const f of fks) if (String(f.parent) === t && set.has(String(f.child)) && String(f.child) !== t) visit(String(f.child), stack);
    stack.delete(t); seen.add(t); order.push(t);
  };
  for (const t of tenantTables) visit(t);
  // tenant_id 없는 자식 표(부모가 tenant 표) — FK 를 따라 서브쿼리로 지운다.
  const orphanChildren = fks.filter((f) => !set.has(String(f.child)) && !NEVER_DELETE_TABLES.has(String(f.child)) && set.has(String(f.parent)) && String(f.parent) !== "tenants");
  const tenantsChildren = fks.filter((f) => !set.has(String(f.child)) && String(f.parent) === "tenants" && !NEVER_DELETE_TABLES.has(String(f.child)));

  /* 3. 행 수(드라이런·스냅샷 공용) */
  const counts = {};
  if (tids.length) {
    for (const t of order) { const [c] = await sql`SELECT COUNT(*) AS c FROM ${sql(t)} WHERE tenant_id = ANY(${tids})`; if (n(c.c)) counts[t] = n(c.c); }
    for (const f of orphanChildren) { const [c] = await sql`SELECT COUNT(*) AS c FROM ${sql(String(f.child))} WHERE ${sql(String(f.col))} IN (SELECT id FROM ${sql(String(f.parent))} WHERE tenant_id = ANY(${tids}))`; if (n(c.c)) counts[`${f.child}(via ${f.parent})`] = n(c.c); }
    const [ai] = await sql`SELECT COUNT(*) AS c FROM ai_usage WHERE tenant_id = ANY(${tids})`;
    log(`표별 행 수(삭제 예정):`, JSON.stringify(counts));
    log(`ai_usage 는 보존(해당 tid 행 ${ai.c}건 · 원가 이력)`);
  }

  /* 4. revenue_daily 테스트 행(보호 테넌트 3) */
  let revRows = [];
  if (flag("--revenue-test-rows")) {
    revRows = await sql`SELECT id, source, freshness, amount_krw, day FROM revenue_daily WHERE tenant_id = 3
      AND ((source = 'sponsor' AND freshness = 'manual') OR (source = 'meta' AND freshness = 'manual') OR (source = 'adpost' AND freshness = 'runner')) ORDER BY id`;
    log(`revenue_daily(t3) 테스트 행 ${revRows.length}건: ${revRows.map((r) => `#${r.id} ${r.source}/${r.freshness} ₩${n(r.amount_krw).toLocaleString("ko-KR")} ${String(r.day).slice(0, 10)}`).join(" · ")}`);
  }

  /* 5. R2 접두(드라이런은 목록만) */
  let r2 = null;
  if (!flag("--no-r2") && tids.length) {
    try {
      const { register } = await import("tsx/esm/api");
      register();
      const mod = await import(pathToFileURL(path.join(ROOT, "lib/r2.ts")).href);
      if (!mod.r2Configured()) log("R2 미설정 — 접두 삭제 건너뜀");
      else {
        r2 = { listed: 0, deleted: 0, failed: 0 };
        for (const tid of tids) {
          const r = await mod.r2DeletePrefix(`autocreate/${tid}/`, { dryRun: !APPLY });
          r2.listed += r.listed; r2.deleted += r.deleted; r2.failed += r.failed;
        }
        log(`R2: ${APPLY ? `삭제 ${r2.deleted}/${r2.listed}${r2.failed ? ` · 실패 ${r2.failed}` : ""}` : `삭제 예정 객체 ${r2.listed}개`}`);
      }
    } catch (e) { log("R2 단계 건너뜀(모듈 로드 실패):", String(e?.message ?? e).slice(0, 120)); }
  }

  if (!APPLY) { log("\n드라이런 끝 — 지운 것 없음. 실제 삭제는 --apply."); await sql.end(); process.exit(0); }
  if (!tids.length && !revRows.length) { log("지울 것 없음."); await sql.end(); process.exit(0); }

  /* 6. 🔴 APPLY — 스냅샷 감사 → 삭제 → 되읽기 */
  const snapshot = { tids, tenants: targets.map((r) => ({ id: n(r.id), name: r.name, emails: r.emails, status: r.status, plan: r.plan_key })), counts, revenueTestRows: revRows.map((r) => n(r.id)), keep: [...protect], options: args };
  await sql`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, action, target, detail, risk_level)
    VALUES (NULL, 'operator', NULL, 'ops_live_cleanup', ${`ops-cleanup-tenants ${new Date().toISOString()}`}, ${JSON.stringify(snapshot)}::jsonb, 'high')`;
  const [chk] = await sql`SELECT jsonb_typeof(detail) AS t FROM audit_logs WHERE action = 'ops_live_cleanup' ORDER BY id DESC LIMIT 1`;
  if (chk?.t !== "object") throw new Error("스냅샷 감사 jsonb 이상 — 중단");
  log("스냅샷 감사 남김");

  const deleted = {};
  if (tids.length) {
    for (const f of orphanChildren) { const r = await sql`DELETE FROM ${sql(String(f.child))} WHERE ${sql(String(f.col))} IN (SELECT id FROM ${sql(String(f.parent))} WHERE tenant_id = ANY(${tids}))`; if (r.count) deleted[`${f.child}(via ${f.parent})`] = r.count; }
    for (const t of order) { const r = await sql`DELETE FROM ${sql(t)} WHERE tenant_id = ANY(${tids})`; if (r.count) deleted[t] = r.count; }
    for (const f of tenantsChildren) { const r = await sql`DELETE FROM ${sql(String(f.child))} WHERE ${sql(String(f.col))} = ANY(${tids})`; if (r.count) deleted[`${f.child}(via tenants)`] = r.count; }
    const r = await sql`DELETE FROM tenants WHERE id = ANY(${tids})`; deleted.tenants = r.count;
    log("삭제:", JSON.stringify(deleted));
  }
  if (revRows.length) { const r = await sql`DELETE FROM revenue_daily WHERE id = ANY(${revRows.map((x) => n(x.id))})`; log(`revenue_daily(t3) 테스트 행 삭제 ${r.count}`); }

  /* 7. 되읽기 */
  const [left] = await sql`SELECT COUNT(*) AS c FROM tenants`;
  const [act] = await sql`SELECT COUNT(*) FILTER (WHERE status = 'active') AS active, COUNT(*) FILTER (WHERE status = 'active' AND plan_key <> 'trial') AS paid FROM tenants`;
  const paidRows = await sql`SELECT t.id, t.plan_key, p.price_month, s.price_locked_krw, s.cycle FROM tenants t LEFT JOIN plans p ON p.key = t.plan_key LEFT JOIN subscriptions s ON s.tenant_id = t.id WHERE t.status = 'active' AND t.plan_key <> 'trial'`;
  const mrr = paidRows.reduce((a, r) => a + (r.price_locked_krw !== null && r.price_locked_krw !== undefined ? n(r.price_locked_krw) : (r.cycle === "year" ? n(r.price_month) : n(r.price_month))), 0);
  const remaining = await sql`SELECT id, name FROM tenants ORDER BY id`;
  log(`되읽기: 남은 테넌트 ${left.c}(${remaining.map((r) => `${r.id} ${r.name}`).join(" · ")}) · activeTenants ${act.active} · 활성 유료 ${act.paid} · MRR ≈ ${mrr.toLocaleString("ko-KR")}`);
  await sql.end();
} catch (e) {
  console.error("❌", e?.message ?? e);
  await sql.end().catch(() => {});
  process.exit(1);
}
