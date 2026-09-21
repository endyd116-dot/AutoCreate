/**
 * scripts/probe-verifier-softness.mjs — 🔴 **내 자들이 무른가**를 변이로 잰다(AC-216 · B2 · 2026-09-22).
 *   실행: `node scripts/probe-verifier-softness.mjs`   (🔴 커밋 안 된 변경이 있으면 안 돈다 — 아래 안전장치)
 *
 *   🔴 **이 파일은 `scripts/lib/block.mjs` 머리말이 대는 증거다.** 거기 적힌 「조용한 초록 둘」이
 *      이 하니스로 나온 값이라, 커밋해 두지 않으면 그 인용이 **허공을 가리킨다**
 *      — 오늘 하루가 「가리키는 곳이 없는 말」로 데인 날이라 같은 실수를 안 하려고 옮겨 왔다.
 *
 *   무엇을 하나: 제품 파일에 변이를 넣고 자를 돌려, **자가 그걸 잡는지** 본다.
 *     · 내용 변이(가드를 뺀다)   → 자는 **빨강(1)** 을 내야 한다(제품이 틀렸다)
 *     · 경계 변이(닻을 지운다)   → 자는 **⊘(2)** 를 내야 한다(자가 못 쟀다)
 *   🔴 **판정을 냈다는 증거**(마지막 줄)를 요구한다 — 없으면 `⊘ 못 쟀음`이다.
 *      첫 판에 이 하니스 자신이 종료코드만 보고 「자가 아니라고 했다」와 「**자를 못 돌렸다**」를 뭉갰다
 *      (윈도에서 `npx` 가 `npx.cmd` 라 `shell:true` 없이는 안 뜬다 · code -1 · 출력 0).
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

/** @returns {{kind:"pass"|"fail"|"unmeasured", code:number, tail:string}} */
function runVerifier(cmd, args) {
  let out = ""; let code = 0;
  /* 🔴 윈도에서 `npx` 는 `npx.cmd` 라 `shell:true` 없이는 **아예 안 뜬다**(code -1 · 출력 0).
     첫 판에 그걸 «자가 빨강»으로 읽었다 — 그게 바로 ✗ 와 ⊘ 를 섞은 값이다. */
  try { out = execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], shell: true }); }
  catch (e) { code = e.status ?? -1; out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  const tail = out.trim().split("\n").slice(-2).join(" ").slice(0, 120);
  /* 🔴 **판정을 냈다는 증거**를 요구한다 — 내 자들은 마지막에 «🟢 pass N · fail M» 을 찍는다.
     그 줄이 없으면 자가 돌다 만 것이고, 그건 «틀렸다»가 아니라 **«못 쟀다»**다. */
  const verdict = /🟢 pass \d+ · fail 0/.test(out) ? "pass"
    : /🔴 pass \d+ · fail [1-9]/.test(out) ? "fail"
      : /막힌 것 \d+ · .*안 막힌 것 0/.test(out) ? "pass"
        : /안 막힌 것 [1-9]/.test(out) ? "fail"
          : "unmeasured";
  return { kind: verdict, code, tail };
}
const runMts = (f) => runVerifier("npx", ["--yes", "tsx", f]);
const runMjs = (f) => runVerifier("node", [f]);
const show = (r) => `${r.kind === "pass" ? "초록" : r.kind === "fail" ? "빨강" : "⊘ 못 쟀음"}(code ${r.code})`;

const CASES = [
  {
    자: "verify-subtitle-font.mts", 실행: () => runMts("scripts/verify-subtitle-font.mts"),
    변이: [
      { name: "②고정 창(+700) — 러너 렌더 분기에서 formatMarks 를 뺀다",
        file: "runner/core.mjs",
        find: 'return { ok: true, render: out.render, shotKey, notes: out.notes ?? [], ...(out.formatMarks ? { formatMarks: out.formatMarks } : {}) };',
        to:   'return { ok: true, render: out.render, shotKey, notes: out.notes ?? [] };' },
      { name: "②고정 창(+900) — 서버 렌더 분기에서 applyFormatMarksToPiece 를 뺀다",
        file: "lib/runner-jobs.ts",
        find: '    await applyFormatMarksToPiece(tid, pieceId ?? 0, okBody.formatMarks);\n    const r = okBody.render;',
        to:   '    const r = okBody.render;' },
      { name: "🔴 ③경계 — 닻(`RENDER_KINDS.has(job.kind)`)을 지운다 = **덩이를 못 잡게 만든다**",
        file: "runner/core.mjs",
        find: 'if (RENDER_KINDS.has(job.kind)) {',
        to:   'if (RENDER_KINDS_RENAMED.has(job.kind)) {' },
      { name: "🔴 ③경계 — 서버 닻(`if (kind === \"render.video\")`)을 지운다",
        file: "lib/runner-jobs.ts",
        find: '  if (kind === "render.video") {\n    /* [AC-202]',
        to:   '  if (kind === "render_video_renamed") {\n    /* [AC-202]' },
    ],
  },
  {
    자: "verify-ops-requeue-doors.mjs", 실행: () => runMjs("scripts/verify-ops-requeue-doors.mjs"),
    변이: [
      { name: "①파일 전체 — remove 갈래 안에서 호출을 뺀다",
        file: "netlify/functions/ops-runners.ts",
        find: '        const recovered = await reconcileClaimed();\n        /* 🔴 `RETURNING` 을 붙였다(B 지적)',
        to:   '        const recovered = [];\n        /* 🔴 `RETURNING` 을 붙였다(B 지적)' },
      { name: "🔴 ③경계 — 갈래 닻(`action === \"remove\"`)을 지운다 = **덩이를 못 잡게 만든다**",
        file: "netlify/functions/ops-runners.ts",
        find: 'if (action === "remove") {',
        to:   'if (action === "remove_renamed") {' },
      { name: "🔴 ①창이 EOF 까지인 것을 쓴다 — 호출을 **갈래 밖(파일 끝)** 으로 옮긴다",
        file: "netlify/functions/ops-runners.ts",
        find: '        const recovered = await reconcileClaimed();\n        /* 🔴 `RETURNING` 을 붙였다(B 지적)',
        to:   '        const recovered = [];\n        /* 🔴 `RETURNING` 을 붙였다(B 지적)',
        also: { find: 'return json({ ok: false, error: "not_found", step: "route" }, 404);',
                to: 'void reconcileClaimed;\n    return json({ ok: false, error: "not_found", step: "route" }, 404);' } },
    ],
  },
];

for (const c of CASES) {
  const base = c.실행();
  console.log(`\n══ ${c.자}   기준 = ${show(base)}   «${base.tail}»`);
  if (base.kind !== "pass") { console.log("  ⊘ 기준이 초록이 아니라 변이를 못 잰다(먼저 초록으로 만들어라)"); continue; }
  for (const m of c.변이) {
    const files = [[m.file, readFileSync(m.file, "utf8")]];
    if (m.also) files.push([m.file, null]);
    const orig = files[0][1];
    if (!orig.includes(m.find) || (m.also && !orig.includes(m.also.find))) { console.log(`  ⊘ 변이 자리를 못 찾음 — ${m.name}`); continue; }
    try {
      let t = orig.replace(m.find, m.to);
      if (m.also) t = t.replace(m.also.find, m.also.to);
      writeFileSync(m.file, t, "utf8");
      const r = c.실행();
      const good = r.kind === "fail" || r.kind === "unmeasured";
      console.log(`  ${good ? "✓ 잡힘" : "🔴 **조용한 초록**"}  ${show(r)}  — ${m.name}`);
    } finally { writeFileSync(m.file, orig, "utf8"); }
  }
  console.log(`  되돌린 뒤 = ${show(c.실행())}`);
}
