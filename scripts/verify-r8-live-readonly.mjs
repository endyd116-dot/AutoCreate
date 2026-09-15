/**
 * scripts/verify-r8-live-readonly.mjs — 🔴 **라이브를 읽기만 한다**(C · R8 배포 전 대조 · 2026-09-16).
 *   사용: node scripts/verify-r8-live-readonly.mjs
 *
 *   ══ 🔴 이 파일은 쓰지 않는다 ══
 *     SELECT 만 있다. INSERT·UPDATE·DELETE·DDL 이 한 줄도 없고, 아래 `guard()` 가 **실행 직전에 다시 확인**한다.
 *     라이브 변경은 그 창에서 사장님이 Allow 하는 것이고(AC-50), 검증 창이 몰래 할 일이 아니다.
 *     보존 테넌트(3·13·109·116·198·451)는 **읽지도 바꾸지도 않는다** — 집계에서만 스쳐 간다.
 *     `ai_usage` 는 어떤 정리에서도 안 지운다(여기서는 읽기만이라 해당 없음).
 *
 *   ══ 무엇을 묻나 ══
 *     ① **BYO(고객 키)로 찍힌 `ai_usage` 행이 있나** — BYO 입구는 껐다(`lib/ops/features.ts`). 있으면 «꺼진 기능이 뒤에서 도는» 것이다.
 *     ② **brief 의 `goal` 분포** — AC-72(«mixed» 가 규칙 표에 열쇠가 없어 56%가 굶었다)가 **다시 나는지**.
 *     ③ **미배포 DDL 이 라이브에 들어가 있나** — 0034 `pieces.created_by` 가 없으면 팀 승인 두 겹 중 첫 겹이 죽는다.
 *     ④ **AI 키 값이 `ai_usage` 어디에도 조각으로 남지 않았나** — 로테이션이 들어온 뒤 새로 생긴 위험.
 */
import { readFileSync, existsSync } from "node:fs";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const URLSTR = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
if (!URLSTR) { console.error("🔴 NETLIFY_DATABASE_URL 이 없다 — .env 확인"); process.exit(2); }

/** 🔴 실행 직전 재확인 — 이 스크립트가 나중에 고쳐져도 쓰기가 섞이면 여기서 멈춘다. */
const guard = (text) => {
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|copy)\b/i.test(text)) {
    console.error(`🔴 읽기 전용 스크립트에 쓰기 문장이 섞였다 — 중단한다:\n${text.slice(0, 200)}`);
    process.exit(3);
  }
  return text;
};

const { default: postgres } = await import("postgres");
const sqlc = postgres(URLSTR, { ssl: "require", max: 1 });
const ask = async (label, text, params = []) => {
  guard(text);
  try { return { label, rows: await sqlc.unsafe(text, params) }; }
  catch (e) { return { label, err: String(e?.message ?? e).slice(0, 200) }; }
};

const out = [];
const say = (s) => out.push(s);

try {
  /* ③ 먼저 — 이 판이 라이브에 들어간 판인지 알아야 나머지 해석이 선다. */
  const cols = await ask("컬럼", `
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema='public'
       AND ((table_name='pieces'    AND column_name IN ('created_by','meta'))
         OR (table_name='ai_usage'  AND column_name IN ('key_source','source','provider','tenant_id','model','cost_usd'))
         OR (table_name='briefs'    AND column_name='goal'))
     ORDER BY table_name, column_name`);
  const have = new Set((cols.rows ?? []).map((r) => `${r.table_name}.${r.column_name}`));
  say(`\n■ ③ 라이브 스키마 — 이 판이 들어가 있나`);
  say(`   pieces.created_by (DDL 0034 · 팀 승인 첫 겹) : ${have.has("pieces.created_by") ? "✅ 있다" : "🔴 **없다** — 팀 승인 두 겹 중 첫 겹(review-deadline.ts:81)이 라이브에선 죽어 있다(둘째 겹만 남는다)"}`);
  say(`   briefs.goal (AC-72 축)                      : ${have.has("briefs.goal") ? "✅ 있다" : "— 없다"}`);
  say(`   ai_usage 의 키 출처 칸                       : ${[...have].filter((x) => x.startsWith("ai_usage.")).join(", ") || "(없음)"}`);

  /* ① BYO 로 찍힌 ai_usage 가 있나 — 칸 이름을 모르니 있는 칸으로만 묻는다. */
  say(`\n■ ① BYO(고객 키)로 찍힌 AI 사용 행이 있나 — 입구를 껐으니 **0 이어야 한다**`);
  const keyCol = ["key_source", "source"].find((c) => have.has(`ai_usage.${c}`));
  if (!keyCol) {
    say("   🟠 ai_usage 에 «키 출처» 칸이 아직 없다 — **BYO 로 쓴 건과 우리 키로 쓴 건을 사후에 가를 수 없다**.");
    say("      (지금은 입구가 닫혀 있어 사고는 안 나지만, 다시 열 때 이 칸이 먼저 있어야 한다.)");
  } else {
    const r = await ask("byo", `SELECT ${keyCol} AS k, COUNT(*)::int AS n, ROUND(SUM(COALESCE(cost_usd,0))::numeric, 4) AS usd
       FROM ai_usage GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
    if (r.err) say(`   🔴 못 읽었다: ${r.err}`);
    else {
      for (const x of r.rows) say(`   ${String(x.k ?? "(null)").padEnd(14)} ${String(x.n).padStart(7)}행  $${x.usd}`);
      const byo = r.rows.filter((x) => /byo|customer|tenant|own/i.test(String(x.k ?? "")));
      say(`   ⇒ ${byo.length ? `🔴 **BYO 로 찍힌 행이 ${byo.reduce((a, b) => a + b.n, 0)}건 있다** — 껐다는 기능이 돌았다는 뜻이다` : "✅ BYO 로 찍힌 행 0 — 입구가 닫힌 그대로다"}`);
    }
  }

  /* ④ 키 값이 어디 남았나 — 32자 이상 이어지는 영숫자 토막(AIza… 모양)을 모델·오류 칸에서 찾는다. */
  say(`\n■ ④ AI 키 값이 라이브 표에 조각으로라도 남았나 — **0 이어야 한다**`);
  const leak = await ask("leak", `SELECT COUNT(*)::int AS n FROM ai_usage
     WHERE model ~ '(AIza|sk-)[A-Za-z0-9_-]{10,}'`);
  if (leak.err) say(`   🟠 못 읽었다(칸이 없을 수 있다): ${leak.err}`);
  else say(`   ai_usage.model 에 키 모양 문자열: ${leak.rows[0].n}건 ${leak.rows[0].n ? "🔴" : "✅"}`);

  /* ② brief goal 분포 — AC-72 */
  say(`\n■ ② brief 의 수익 목적(goal) 분포 — AC-72 가 다시 나는지`);
  if (!have.has("briefs.goal")) say("   — briefs.goal 칸이 없다");
  else {
    const g = await ask("goal", `SELECT COALESCE(goal,'(null)') AS g, COUNT(*)::int AS n,
        MAX(created_at) AS last FROM briefs GROUP BY 1 ORDER BY 2 DESC LIMIT 20`);
    if (g.err) say(`   🔴 못 읽었다: ${g.err}`);
    else {
      const total = g.rows.reduce((a, b) => a + b.n, 0);
      for (const x of g.rows) say(`   ${String(x.g).padEnd(14)} ${String(x.n).padStart(6)}건  ${total ? Math.round((x.n / total) * 100) : 0}%  마지막 ${x.last ? new Date(x.last).toISOString().slice(0, 16) : "—"}`);
      const mixed = g.rows.find((x) => String(x.g) === "mixed");
      say(`   ⇒ mixed = ${mixed ? `${mixed.n}건(${Math.round((mixed.n / total) * 100)}%)` : "0건"}`);
      say(`   🔴 판정은 **코드가 그 열쇠를 받나**로 한다 — 아래 ⑤.`);
    }
  }

  /* ⑤ 🔴 **여기서 판정하지 않는다.** 나는 처음에 «`goalRules` 에 `mixed` 열쇠가 있나»를 정규식으로 물어
        «AC-72 재발»이라고 찍었다 — **틀렸다.** 수리는 열쇠를 더한 게 아니라 물음을 바꾼 것이라
        (`resolveGoalDetail`: «값이 있나»가 아니라 «이 채널에 규칙이 있는 목적인가»), 옛 잣대로는 영영 빨강이다(AC-70 을 내가 밟았다).
        ⇒ 판정은 **그 함수를 그대로 부르는** `scripts/verify-goal-reach.mts` 가 한다. 여기서는 분포만 보여 준다. */
  say(`\n■ ⑤ AC-72 판정은 여기서 안 한다 — `);
  say(`   npx tsx scripts/verify-goal-reach.mts (진짜 함수 × 라이브 값). 낱말 정규식으로 재면 고친 것을 «안 고쳤다»고 말한다.`);
} finally {
  await sqlc.end({ timeout: 5 });
}

console.log(`\n라이브 읽기 전용 대조 — R8 배포 전 · ${new Date().toISOString()}\n${"─".repeat(110)}`);
for (const l of out) console.log(l);
console.log(`${"─".repeat(110)}\n🔴 이 스크립트는 SELECT 만 했다(쓰기 0).`);
