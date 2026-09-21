/**
 * scripts/probe-verifier-overlap.mjs — 🔴 **두 자가 정말 겹치나**를 축마다 깨서 잰다(AC-214·216 · B2 · 2026-09-22).
 *   실행: `node scripts/probe-verifier-overlap.mjs`   (🔴 커밋 안 된 변경이 있으면 안 돈다 — 아래 안전장치)
 *
 *   🔴 **이 파일은 `scripts/verify-ops-recovered-shown.mjs` 머리말의 표가 대는 증거다.**
 *      C 가 「이제 겹친다」고 했을 때 **말로 받지 않고** 이걸로 쟀고, 그 결과로 내 자에서 축 셋을 **지웠다**.
 *      커밋해 두지 않으면 그 표가 **허공을 가리킨다.**
 *
 *   무엇을 하나: 축을 **하나씩만** 깨서 두 자를 나란히 돌린다.
 *   🔴 「호출이 있나」만 깨면 둘 다 잡는 게 당연하다 — **축을 갈라야** «누가 무엇을 지키는지»가 보인다.
 */
/* ═══ 🔴 **안전장치 — 이 하니스는 소스 파일을 잠깐 고친다** ═══
 *   변이를 넣고 자를 돌린 뒤 `finally` 로 되돌린다. 그래도 **중간에 죽으면 트리가 더럽게 남는다.**
 *   ⇒ **작업 중인 변경이 있으면 아예 안 돈다.** 그래야 사고가 나도 `git checkout -- <파일>` 로 되돌릴 수 있다.
 *      (오늘 B 가 `git checkout` 으로 자기 편집을 날린 일이 있었다 — 되돌릴 수 있게 해 두는 게 그 값이다.)
 */
import { execFileSync as _exec } from "node:child_process";
{
  let dirty = "";
  try { dirty = _exec("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).trim(); }
  catch { /* git 이 없으면 그냥 돈다 */ }
  if (dirty) {
    console.error("🔴 커밋 안 된 변경이 있어 돌리지 않습니다 — 이 하니스는 소스를 잠깐 고칩니다.");
    console.error("   먼저 커밋하거나 치운 뒤에 다시 돌리세요. 지금 더러운 파일:");
    console.error(dirty.split("\n").slice(0, 8).map((l) => "     " + l).join("\n"));
    process.exit(2);
  }
}

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const F = "netlify/functions/ops-runners.ts";
function run(script) {
  let out = ""; let code = 0;
  try { out = execFileSync("node", [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { code = e.status ?? -1; out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  /* 🔴 «판정을 냈다»는 증거를 요구한다 — 없으면 ⊘(자를 못 돌렸다). */
  const judged = /안 막힌 것 \d/.test(out) || /pass \d+ · fail \d+/.test(out);
  return { code, judged, kind: !judged ? "⊘못돌림" : code === 0 ? "초록" : "빨강" };
}
const C = () => run("scripts/verify-requeue-guarded.mjs");
const B2 = () => run("scripts/verify-ops-requeue-doors.mjs");

/* 🔴 내 자가 지키는 **네 축** — 각각을 따로 깬다. «호출이 있나»만 깨면 둘 다 잡는 게 당연하다. */
const AXES = [
  { 축: "①순서 — 되돌린 **뒤에** 묻는다(호출은 그대로 있다)",
    f: (t) => t.replace(
      "        const recovered = await reconcileClaimed();\n        const released = await q(sql`UPDATE runner_jobs SET status = 'queued'",
      "        const released = await q(sql`UPDATE runner_jobs SET status = 'queued'")
      .replace("await writeAudit({ tenantId: dev.tenant_id ? n(dev.tenant_id) : null, action: \"ops_runner_release\"",
        "const recovered = await reconcileClaimed();\n        await writeAudit({ tenantId: dev.tenant_id ? n(dev.tenant_id) : null, action: \"ops_runner_release\"") },
  { 축: "②remove 가 **DELETE 뒤에** 묻는다(호출은 그대로 있다)",
    f: (t) => t.replace(
      "        const recovered = await reconcileClaimed();\n        /* 🔴 `RETURNING` 을 붙였다(B 지적)",
      "        /* 🔴 `RETURNING` 을 붙였다(B 지적)")
      .replace("        await q(sql`DELETE FROM runner_devices WHERE id = ${id}`);",
        "        await q(sql`DELETE FROM runner_devices WHERE id = ${id}`);\n        const recovered = await reconcileClaimed();") },
  { 축: "③운영자에게 안 보여 준다(응답·감사에서 recovered 를 뺀다)",
    f: (t) => t.replace(/, recovered \}\);/g, " });").replace(/, recovered \}, riskLevel/g, " }, riskLevel") },
  { 축: "④호출 자체를 뺀다(대조군 — 이건 둘 다 잡아야 정상)",
    f: (t) => t.replace(/const recovered = await reconcileClaimed\(\);/g, "const recovered = [];") },
];

const orig = readFileSync(F, "utf8");
console.log(`기준: C=${C().kind}  B2=${B2().kind}\n`);
let onlyB2 = 0;
for (const a of AXES) {
  const mutated = a.f(orig);
  if (mutated === orig) { console.log(`  ⊘ 변이가 아무것도 안 바꿨다 — ${a.축}`); continue; }
  try {
    writeFileSync(F, mutated, "utf8");
    const c = C(), b = B2();
    const gap = c.kind === "초록" && b.kind !== "초록";
    if (gap) onlyB2++;
    console.log(`  C=${c.kind.padEnd(6)} B2=${b.kind.padEnd(6)} ${gap ? "🔴 **B2 만 잡는다**" : c.kind !== "초록" && b.kind !== "초록" ? "둘 다 잡는다(겹침)" : "확인 필요"}  — ${a.축}`);
  } finally { writeFileSync(F, orig, "utf8"); }
}
console.log(`\n${onlyB2 === 0 ? "⇒ 🔴 내 자는 **군더더기다** — 지워도 된다" : `⇒ **B2 만 잡는 축 ${onlyB2}개** — 그 축은 남겨야 한다`}`);
console.log(`되돌린 뒤: C=${C().kind}  B2=${B2().kind}`);
