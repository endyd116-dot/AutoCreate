/**
 * scripts/verify-401-meaning.mjs — 🔴 «401 이 세션 끊김인지, 그냥 틀린 값인지»를 화면이 가릴 수 있나 (수리 ② · 2026-09-19).
 *
 *   왜 생겼나: `public/js/ui.js UI.api` 가 **모든 401 을 «세션 끊김»으로** 읽어 refresh → 재시도 → `/login.html` 로 내보냈다.
 *   설정에서 현재 비밀번호를 한 번 틀리면 **세션이 멀쩡한 손님이 로그인 화면으로 쫓겨났고**, 서버가 보낸
 *   «현재 비밀번호가 맞지 않아요»(`step:"current"`)는 화면에 닿지도 못했다(시나리오 A §12).
 *
 *   🔴 **이 자는 자기가 무엇을 세는지 말한다** — 어제 당근 자가 초록이었던 이유가 «세는 화면이 하나»였기 때문이다.
 *
 *   무엇을 세나: 서버가 401 을 내는 **모든 자리의 `step` 값**을 긁어, `ui.js` 의 `SESSION_401` 목록과 **대조**한다.
 *     · 목록에 있는 step   = 세션 끊김 ⇒ 로그인으로 내보낸다(맞다)
 *     · 목록에 없는 step   = 도메인 사유 ⇒ 화면이 그 문장을 보여 준다(맞다)
 *     · 🔴 **분류가 빠진 step** = 아무도 정하지 않았다 ⇒ 운다
 *
 *   쓰기: node scripts/verify-401-meaning.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const fails = [];
const notes = [];

/* ── ① ui.js 가 실제로 가리고 있나 ── */
const ui = readFileSync("public/js/ui.js", "utf8");
const m = ui.match(/SESSION_401\s*=\s*\[([^\]]*)\]/);
if (!m) {
  fails.push("🔴 `ui.js` 에 `SESSION_401` 목록이 없다 — 401 을 가리지 않고 **전부 로그인으로 내보내는** 옛 모양이다.");
}
const sessionSteps = m ? [...m[1].matchAll(/"([a-z_]+)"/g)].map((x) => x[1]) : [];
notes.push(`센 것: \`ui.js\` 의 세션 취급 step 목록 = [${sessionSteps.join(", ")}]`);

const guarded = /res\.status === 401 && !opts\.noRedirect && sessionGone/.test(ui);
notes.push(`센 것: \`UI.api\` 의 401 분기가 \`sessionGone\` 을 보나 = ${guarded}`);
if (!guarded) fails.push("🔴 `UI.api` 의 401 분기가 `sessionGone` 을 안 본다 — 목록만 있고 안 쓰면 없는 것과 같다.");

/* ── ② 서버가 401 을 내는 자리 전수 — step 을 긁는다 ── */
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/node_modules/.test(p)) walk(p); } else if (/\.ts$/.test(f)) files.push(p); } };
walk("netlify/functions"); walk("lib");

const sites = [];          // { file, step }
const unlabeled = [];      // 401 인데 step 이 없는 자리
for (const p of files) {
  const src = readFileSync(p, "utf8");
  for (const hit of src.matchAll(/\{[^{}]*\}\s*,\s*401\s*\)/g)) {
    const body = hit[0];
    const s = body.match(/step:\s*"([a-z_]+)"/);
    if (s) sites.push({ file: p.replace(/\\/g, "/"), step: s[1] });
    else unlabeled.push(p.replace(/\\/g, "/"));
  }
}
const steps = [...new Set(sites.map((s) => s.step))].sort();
notes.push(`센 것: 서버가 401 을 내는 자리 ${sites.length}곳(파일 ${new Set(sites.map((s) => s.file)).size}개) · 나온 step = [${steps.join(", ")}]`);
notes.push(`센 것: 그중 세션으로 분류된 step = [${steps.filter((s) => sessionSteps.includes(s)).join(", ") || "없음"}] · 도메인(화면에 보여 줄 것) = [${steps.filter((s) => !sessionSteps.includes(s)).join(", ") || "없음"}]`);

/* ── ③ 분류가 빠진 게 없나 ── */
const KNOWN_DOMAIN = ["current", "invalid", "locked", "used", "seat"];   // 세션이 아니라 «값이 틀렸다/안 된다»는 뜻
const unclassified = steps.filter((s) => !sessionSteps.includes(s) && !KNOWN_DOMAIN.includes(s));
notes.push(`센 것: 분류가 빠진 step = [${unclassified.join(", ") || "없음"}]`);
if (unclassified.length) {
  for (const s of unclassified) {
    const where = [...new Set(sites.filter((x) => x.step === s).map((x) => x.file))].join(" · ");
    fails.push(`🔴 401 의 step \`"${s}"\` 이 어느 쪽인지 아무도 안 정했다(${where}) — 세션이면 \`ui.js SESSION_401\` 에, 아니면 이 자의 \`KNOWN_DOMAIN\` 에 넣어라.`);
  }
}
if (unlabeled.length) notes.push(`센 것: step 없이 401 을 내는 자리 ${unlabeled.length}곳(${[...new Set(unlabeled)].join(" · ")}) — step 이 없으면 화면은 **세션으로** 본다(옛 동작 유지)`);

/* ── ④ 양성 대조 — 도메인 401 이 하나도 없으면 이 자는 헛돈다 ── */
const domain = steps.filter((s) => !sessionSteps.includes(s));
if (!domain.length) fails.push("🔴 도메인 401 을 한 곳도 못 찾았다 — 이 자가 헛돌고 있다(비밀번호 바꾸기의 `step:\"current\"` 가 있어야 정상).");
if (!sites.some((s) => s.file.endsWith("auth-change-password.ts") && s.step === "current"))
  fails.push("🔴 `auth-change-password.ts` 의 `step:\"current\"` 를 못 찾았다 — 이 사고가 난 바로 그 자리다(자가 과녁을 잃었다).");

/* ── 보고 ── */
console.log("401 이 «세션»인지 «틀린 값»인지 가려지나(수리 ② · AC 시나리오 A §12) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** (안 적으면 초록이 거짓말을 한다)");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else console.log("■ 통과 — 401 자리마다 뜻이 정해져 있고, 화면이 그 뜻을 보고 갈린다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
