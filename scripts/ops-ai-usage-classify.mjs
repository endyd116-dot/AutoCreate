/**
 * scripts/ops-ai-usage-classify.mjs — AI 원장(`ai_usage`)의 **분류 소급 채우기**(P1R8-B · 메인 라이브 실측 2026-09-15).
 *   기본은 **드라이런**(아무것도 안 바꾼다) · 실제 반영은 `--apply` + 🔴 **사장님이 그 창에서 직접 Allow**(AC-50).
 *
 *   왜: 분류가 부모(tenants)에 있어서, **테넌트를 지우면 그 집이 쓴 돈이 «진짜 고객 비용»으로 넘어갔다**(고아 103행 $9.98).
 *     이제 분류를 행이 갖는다(0022 · `ai_usage.is_internal`·`synthetic`) — 지난 행만 한 번 채우면 된다.
 *   무엇을 채우나(셋 다 «지우기»가 아니라 «표시»다 — 돈 기록은 지우지 않는다):
 *     ① 내부 표시가 살아 있는 테넌트의 행           → is_internal = true
 *     ② **고아 행**(테넌트가 지워졌다)              → is_internal = true   (지금 고아는 전부 삭제된 테스트 집이다)
 *     ③ **가짜 행**(실제 호출이 아님)               → synthetic  = true
 *        판정: `model ILIKE '%smoke%'|'%stub%'|'c-verify'` 또는 **토큰 0인데 비용 > 0**(상한 시험용으로 적어 넣은 행).
 *   🔴 실제 호출인데 토큰이 0으로 기록될 일은 없다(토큰 0이면 recordAiUsage 가 아예 안 부른다 · lib/ai.ts).
 *
 *   사용: node scripts/ops-ai-usage-classify.mjs            # 드라이런(표만 출력)
 *         node scripts/ops-ai-usage-classify.mjs --apply    # 실제 반영(사장님 Allow 뒤)
 */
import postgres from "postgres";
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  if (!line.includes("=") || line.startsWith("#")) continue;
  const i = line.indexOf("="); const k = line.slice(0, i).trim();
  if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
}
const APPLY = process.argv.includes("--apply");
const sql = postgres(process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL, { ssl: "require", max: 1 });
const usd = (v) => `$${(Math.round(Number(v || 0) * 10000) / 10000).toFixed(4)}`;

const SYNTHETIC = sql`(a.model ILIKE '%smoke%' OR a.model ILIKE '%stub%' OR a.model ILIKE 'c-verify%' OR (a.in_tokens = 0 AND a.out_tokens = 0 AND a.cost_usd > 0))`;
try {
  const [now] = await sql`SELECT COUNT(*)::int AS rows, COALESCE(SUM(cost_usd),0) AS usd FROM ai_usage`;
  const [orphan] = await sql`SELECT COUNT(*)::int AS rows, COALESCE(SUM(a.cost_usd),0) AS usd FROM ai_usage a
    WHERE a.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id) AND NOT a.is_internal`;
  const [internal] = await sql`SELECT COUNT(*)::int AS rows, COALESCE(SUM(a.cost_usd),0) AS usd FROM ai_usage a
    WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id AND t.is_internal) AND NOT a.is_internal`;
  const [fake] = await sql`SELECT COUNT(*)::int AS rows, COALESCE(SUM(a.cost_usd),0) AS usd FROM ai_usage a WHERE ${SYNTHETIC} AND NOT a.synthetic`;
  const [after] = await sql`SELECT COUNT(*)::int AS rows, COALESCE(SUM(a.cost_usd),0) AS usd FROM ai_usage a
    WHERE NOT a.is_internal AND NOT ${SYNTHETIC}
      AND (a.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id AND NOT t.is_internal))`;
  const samples = await sql`SELECT a.id, a.tenant_id, a.purpose, a.model, a.in_tokens, a.out_tokens, a.cost_usd FROM ai_usage a
    WHERE ${SYNTHETIC} AND NOT a.synthetic ORDER BY a.cost_usd DESC LIMIT 8`;

  console.log(`■ ai_usage 분류 ${APPLY ? "반영" : "드라이런(아무것도 안 바꾼다)"}`);
  console.log(`총 ${now.rows}행 ${usd(now.usd)}`);
  console.log(`  ① 내부 테넌트인데 표시 없음 : ${internal.rows}행 ${usd(internal.usd)} → is_internal = true`);
  console.log(`  ② 고아(테넌트 삭제됨)       : ${orphan.rows}행 ${usd(orphan.usd)} → is_internal = true`);
  console.log(`  ③ 가짜 행(실제 호출 아님)    : ${fake.rows}행 ${usd(fake.usd)} → synthetic = true`);
  for (const s of samples) console.log(`      · id ${s.id} t${s.tenant_id ?? "-"} ${s.purpose}/${s.model} tok ${s.in_tokens}/${s.out_tokens} ${usd(s.cost_usd)}`);
  console.log(`⇒ 반영 뒤 «고객 AI 원가» = ${after.rows}행 ${usd(after.usd)}`);

  if (!APPLY) { console.log("\n드라이런 끝 — 실제 반영은 --apply(🔴 사장님 Allow 뒤)."); process.exit(0); }
  const a1 = await sql`UPDATE ai_usage a SET is_internal = true WHERE EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id AND t.is_internal) AND NOT a.is_internal RETURNING a.id`;
  const a2 = await sql`UPDATE ai_usage a SET is_internal = true WHERE a.tenant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id) AND NOT a.is_internal RETURNING a.id`;
  const a3 = await sql`UPDATE ai_usage a SET synthetic = true WHERE ${SYNTHETIC} AND NOT a.synthetic RETURNING a.id`;
  const [fin] = await sql`SELECT COUNT(*)::int AS rows, COALESCE(SUM(a.cost_usd),0) AS usd FROM ai_usage a
    WHERE NOT a.is_internal AND NOT a.synthetic AND (a.tenant_id IS NULL OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = a.tenant_id AND NOT t.is_internal))`;
  await sql`INSERT INTO audit_logs (tenant_id, action, actor_type, risk_level, target, detail)
    VALUES (NULL, ${"ops_ai_usage_classify"}, ${"operator"}, ${"medium"}, ${"ai_usage"},
      ${sql.json({ internalMarked: a1.length, orphanMarked: a2.length, syntheticMarked: a3.length, customerRows: fin.rows, customerUsd: Number(fin.usd) })})`;
  console.log(`\n반영 완료 — 내부 ${a1.length} · 고아 ${a2.length} · 가짜 ${a3.length} → 고객 AI 원가 ${fin.rows}행 ${usd(fin.usd)} (감사 1행 남김)`);
} finally { await sql.end(); }
