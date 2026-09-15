// scripts/verify-r8-deadends.mjs — 🔴 **«정의는 있는데 부르는 자리가 없는 것»을 한꺼번에 센다**(C · R8 · AC-69/AC-29).
//   사용: node scripts/verify-r8-deadends.mjs [--json]
//
//   왜: 2026-09-15 하루에만 **다섯 번** 나왔다 — `post_alive` 적재 0 · `learn.ts` · `ads.*` · `coinCostOverlay` · `blocksCharCount`.
//       그리고 순수 함수 하니스는 이걸 **절대 못 잡는다**: 함수 자체는 맞게 동작하므로 14/14 초록이 나온다.
//       «있나»를 **«정의가 있나»가 아니라 «호출이 있나»로** 세야 한다(R8 계약 §7 · 메인 지시).
//
//   세는 법(정직하게):
//     · 제품 호출 = `lib/**`·`netlify/functions/**`·`runner/**`·`public/**` 에서 **자기 파일을 뺀** 등장 횟수
//     · 🔴 `scripts/**`(하니스)는 **호출로 세지 않는다** — 검사가 자기를 부르는 건 «쓰인다»가 아니다
//     · 🔴 `docs/**` 도 세지 않는다 — 문서에 적혀 있는 것은 «한다»가 아니다(AC-59)
//     · import 줄만 있고 실제 호출이 없으면 **«임포트만»** 으로 따로 적는다(그것도 죽은 통로다)
import { readFileSync, readdirSync, statSync } from "node:fs";

const JSON_OUT = process.argv.includes("--json");
const results = [];
const rec = (step, ok, note = "") => { results.push({ step, ok: ok === "WARN" ? "WARN" : !!ok, note }); };
const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };
const walk = (dir, exts, out = []) => {
  let e = []; try { e = readdirSync(dir); } catch { return out; }
  for (const f of e) {
    if (f === "node_modules" || f.startsWith(".")) continue;
    const p = `${dir}/${f}`;
    if (statSync(p).isDirectory()) walk(p, exts, out); else if (exts.some((x) => f.endsWith(x))) out.push(p);
  }
  return out;
};

/** 제품 파일 전부(하니스·문서 제외). */
const PRODUCT = [
  ...walk("lib", [".ts", ".mts"]),
  ...walk("netlify/functions", [".ts", ".mts"]),
  ...walk("runner", [".mjs", ".js"]),
  ...walk("public", [".js", ".html"]),
];
const SRC = new Map(PRODUCT.map((p) => [p, read(p)]));
/** 주석을 걷어 낸 본문 — «주석에만 적혀 있는 호출»을 호출로 세지 않기 위해(AC-59). */
const CODE = new Map([...SRC].map(([p, t]) => [p, t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")]));

/** 이름 하나의 제품 호출처를 센다. `ownerFile` 은 정의가 있는 파일(자기 자신은 안 센다). */
function callSites(name, ownerFile) {
  const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
  const hits = [];
  let importOnly = 0;
  for (const [p, code] of CODE) {
    if (p === ownerFile) continue;
    const lines = code.split("\n").filter((l) => re.test(l));
    if (!lines.length) continue;
    const real = lines.filter((l) => !/^\s*import\b/.test(l) && !/^\s*export\s+\{/.test(l) && !/^\s*}\s*from\s+/.test(l));
    if (real.length) hits.push(`${p}(${real.length})`);
    else importOnly++;
  }
  return { hits, importOnly };
}

/* ═══ R8 에서 새로 생긴 것들 — «만들었다»고 보고된 물건의 목록 ═══
   각 항목: [사람이 읽는 이름, 심볼, 정의 파일, 이게 죽으면 무슨 일이 나나] */
const TARGETS = [
  ["간격 정책(사장님 «10:00/10:05»)", "gapMinFor", "lib/publish-gap.ts", "편성이 옛 상수 30분을 계속 써서 계정을 붙여 올릴 수 없다"],
  ["간격 정책 — 고객이 내릴 수 있는 바닥", "floorMin", "lib/publish-gap.ts", "«5분까지 내릴 수 있다»가 화면에 영영 안 닿는다"],
  ["채널 «성질» 정본", "channelTraits", "lib/channel-registry.ts", "채널마다 다른 성질을 각자 추측해서 또 갈라진다"],
  ["내려 주기", "canRetract", "lib/publish/retract.ts", "«내릴 수 있다»를 아무도 안 물어 유튜브가 조용히 열린다"],
  ["코인 원가 오버레이", "coinCostOverlay", "lib/plans.ts", "운영자가 고친 코인 값이 아무 데도 안 닿는다"],
  ["본문 글자 수", "blocksCharCount", "lib/blocks.ts", "분량 판정이 대용물(태그 길이)로 흐른다"],
  ["러너 지문 구속", "verifyFingerprint", "lib/runner-jobs.ts", "훔친 토큰이 다른 PC 에서 그대로 통한다"],
];

for (const [label, sym, owner, harm] of TARGETS) {
  const ownerSrc = read(owner);
  const defined = ownerSrc.includes(sym);
  if (!defined) { rec(`죽은 통로 — ${label}(\`${sym}\`)`, "WARN", `정의 파일 ${owner} 에서 이름을 못 찾았다 — 이름이 바뀌었나(검사를 고쳐라)`); continue; }
  const { hits, importOnly } = callSites(sym, owner);
  const ok = hits.length > 0;
  rec(`🔴 죽은 통로 — ${label}(\`${sym}\`) 을 **제품이 부른다**`, ok,
    ok ? `호출 ${hits.join(" · ")}`
       : `제품 호출 **0곳**${importOnly ? `(임포트만 ${importOnly}곳)` : ""} ⇒ ${harm}`);
}

/* ═══ 짝 검사: 옛 상수가 아직 살아 있나 — 새 정본을 만들었는데 옛 값이 그대로면 «하나가 썩는다»(AC-64) ═══ */
const OLD = [
  ["간격 30분 상수", "ACCOUNT_GAP_MIN", "lib/best-time.ts", "gapMinFor", "lib/publish-gap.ts"],
];
for (const [label, oldSym, oldOwner, newSym, newOwner] of OLD) {
  const { hits: oldHits } = callSites(oldSym, oldOwner);
  const { hits: newHits } = callSites(newSym, newOwner);
  rec(`🔴 옛 값과 새 정본 — «${label}» 을 쓰는 곳이 새 정본으로 옮겨졌나`, oldHits.length === 0 || newHits.length > 0,
    `옛 \`${oldSym}\` 쓰는 곳 ${oldHits.length}곳 [${oldHits.join(" · ")}] ↔ 새 \`${newSym}\` 쓰는 곳 ${newHits.length}곳`
    + (oldHits.length && !newHits.length ? " ⇒ 🔴 **새 정본은 아무도 안 부르고 옛 값이 전부 돌고 있다**" : ""));
}

/* ═══ 주석이 코드보다 앞서 나가지 않았나(AC-59) ═══ */
const gapSrc = read("lib/publish-gap.ts");
const claimsSingleSource = /값이 나오는 곳은 여기 하나다|한 곳에서만 나온다/.test(gapSrc);
const bestTimeHasOwn = /export const ACCOUNT_GAP_MIN\s*=/.test(read("lib/best-time.ts"));
rec("🔴 주석이 코드보다 앞서 나가지 않았나(AC-59)", !(claimsSingleSource && bestTimeHasOwn),
  claimsSingleSource && bestTimeHasOwn
    ? "publish-gap.ts 는 «값이 나오는 곳은 여기 하나»라고 적었는데 best-time.ts 에 `ACCOUNT_GAP_MIN` 이 그대로 있다 — 주석이 거짓이다"
    : "주석과 코드가 같다");

if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nR8 죽은 통로 전수(AC-69 · «정의가 있나»가 아니라 «호출이 있나») · ${new Date().toISOString()}\n${"─".repeat(140)}`);
  for (const r of results) console.log(`${r.ok === "WARN" ? "△" : r.ok ? "✓" : "✗"} ${w(r.step, 60)} ${w(r.note, 76)}`);
  const pass = results.filter((r) => r.ok === true).length, fail = results.filter((r) => r.ok === false).length, warn = results.filter((r) => r.ok === "WARN").length;
  console.log(`${"─".repeat(140)}\nPASS ${pass} · FAIL ${fail} · WARN ${warn}`);
  console.log("🔴 하니스(scripts/**)·문서(docs/**)는 호출로 세지 않는다 — 검사가 자기를 부르는 건 «쓰인다»가 아니다.");
}
process.exit(results.some((r) => r.ok === false) ? 1 : 0);
