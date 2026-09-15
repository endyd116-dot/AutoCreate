/**
 * scripts/verify-goal-reach.mts — 🔴 **AC-72 가 다시 나는지 «진짜 함수»로 잰다**(C · R8 마감 · 2026-09-16).
 *   사용: npx tsx scripts/verify-goal-reach.mts      (읽기 전용 — SELECT 만)
 *
 *   ══ 🔴 내가 한 번 틀린 자리라 적어 둔다 ══
 *   처음에 나는 «`goalRules` 에 `mixed` 열쇠가 있나»를 정규식으로 물었고 **«없다 ⇒ AC-72 재발»** 이라고 찍었다.
 *   틀렸다. 수리는 **열쇠를 더한 것이 아니라 물음을 바꾼 것**이다(`resolveGoalDetail` — «값이 있나»가 아니라
 *   «**이 채널에 규칙이 있는 목적인가**»). 옛 물음으로 재면 고친 것을 «안 고쳤다»고 말한다 — AC-70 그대로다.
 *   ⇒ 그래서 이 파일은 **그 함수를 그대로 부른다**. 라이브에 실제로 들어 있는 goal 값 × 우리가 파는 채널 전부.
 *
 *   판정: 어떤 (채널, goal) 짝에서든 **규칙이 0줄이면 열림**. 규칙이 붙으면(brief 든 채널 기본이든) 닫힘.
 *   🔴 «채널 기본으로 떨어졌다»도 통과다 — 떨어뜨리는 게 수리의 내용이었고, `briefGoalIgnored` 로 남는다.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolveGoalDetail, WRITING_CONTRACTS } from "../lib/writing-contracts";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}
const URLSTR = process.env.NETLIFY_DATABASE_URL_UNPOOLED || process.env.NETLIFY_DATABASE_URL;
if (!URLSTR) { console.error("🔴 NETLIFY_DATABASE_URL 이 없다"); process.exit(2); }

const { default: postgres } = await import("postgres");
const sqlc = postgres(URLSTR, { ssl: "require", max: 1 });

let live: { g: string; n: number }[] = [];
try {
  live = (await sqlc`SELECT COALESCE(goal,'(null)') AS g, COUNT(*)::int AS n
    FROM briefs GROUP BY 1 ORDER BY 2 DESC`) as unknown as { g: string; n: number }[];
} finally {
  await sqlc.end({ timeout: 5 });
}

/* 🔴 **두 물음을 가른다 — 안 가르면 둘 다 거짓말이 된다.**
     ㉠ 규칙표를 **가진** 채널에서 라이브 goal 값이 규칙에 닿나 → 이게 AC-72 축이다. 하나라도 0줄이면 **재발**.
     ㉡ 규칙표가 **아예 없는** 채널 → 그 채널은 어떤 goal 로도 규칙을 준 적이 없다. 그건 재발이 아니라
        «짧은 글·영상 채널에 수익 목적 규칙을 둘 것인가»라는 **설계 물음**이다. 실패로 세면 AC-72 가 영영 빨강이고,
        빨강이 늘 있으면 아무도 안 본다. ⇒ 따로 세어 **보고만** 한다. */
const all = Object.keys(WRITING_CONTRACTS);
const withTable = all.filter((ch) => Object.keys(WRITING_CONTRACTS[ch]?.goalRules ?? {}).length > 0);
const noTable = all.filter((ch) => !withTable.includes(ch));
const rows: string[] = [];
let starved = 0;
let checked = 0;

for (const { g, n } of live) {
  const briefGoal = g === "(null)" ? null : g;
  const hits: string[] = [];
  for (const ch of withTable) {
    /* 제휴가 붙은 글은 언제나 `affiliate` 로 가므로 이 축의 위험이 아니다 — 안 붙은 쪽만 잰다. */
    const res = resolveGoalDetail({ affiliate: false, briefGoal, channel: ch });
    const rules = WRITING_CONTRACTS[ch]?.goalRules?.[res.goal] ?? [];
    checked++;
    if (!rules.length) { starved++; hits.push(`  ✗ ${ch} → ${res.goal}(${res.source}) · 규칙 **0줄** 🔴`); }
  }
  rows.push(`  ${hits.length ? "✗" : "✓"} goal=${String(briefGoal).padEnd(8)} (${String(n).padStart(4)}건) → 규칙표 가진 채널 ${withTable.length}개 ${hits.length ? `중 ${hits.length}개 미달` : "전부 규칙이 붙는다"}`);
  rows.push(...hits);
}

/* 🔴 «mixed» 가 실제로 어디로 떨어지고 그 사실이 남는지 한 줄로 보여 준다 — 다음 사람이 또 추적하지 않게. */
const sample = resolveGoalDetail({ affiliate: false, briefGoal: "mixed", channel: "naver_blog" });
console.log(`\nAC-72 — 라이브 goal 값이 실제로 규칙을 받나(진짜 함수로 잼) · ${new Date().toISOString()}\n${"─".repeat(112)}`);
console.log(`라이브 goal 값 ${live.length}종 × **규칙표를 가진** 채널 ${withTable.length}개(${withTable.join(",")}) = 짝 ${checked}개`);
for (const r of rows) console.log(r);
console.log(`\n본보기: brief goal="mixed" · naver_blog → goal=${sample.goal} · 출처=${sample.source} · 떨어뜨린 값=${sample.briefGoalIgnored}`);
console.log(`  ⇒ 수리는 «열쇠를 더한 것»이 아니라 «물음을 바꾼 것»이다 — 그래서 옛 잣대(«goalRules 에 mixed 가 있나»)로는 영영 빨강이다.`);
console.log(`${"─".repeat(112)}`);
console.log(starved
  ? `🔴 **규칙을 한 줄도 못 받는 짝 ${starved}개** — AC-72 재발`
  : `✅ AC-72 닫힘 — 규칙표를 가진 채널에서 라이브 goal 값 ${live.length}종이 전부 규칙을 받는다`);
console.log(`\n🟠 **따로 볼 것(재발 아님 · 설계 물음)**: 규칙표가 아예 없는 채널 ${noTable.length}개 — ${noTable.join(", ")}`);
console.log(`   이 채널들은 어떤 goal 로도 수익 목적 규칙을 받은 적이 **한 번도 없다**(짧은 글·영상 축).`);
console.log(`   «둘 것인가»는 설계가 정할 일이라 여기서는 **세어서 보여 주기만** 한다 — 실패로 세면 이 검사가 늘 빨강이고, 늘 빨강이면 아무도 안 본다.`);
process.exit(starved ? 1 : 0);
