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

/**
 * 이름 하나의 제품 호출처를 센다.
 *   🔴 [2026-09-15 C 수리] 첫 판은 **정의 파일을 통째로 뺐다.** 그래서 «자기 파일 안에서 불리는» 함수가
 *      «제품 호출 0곳» 이라는 **가짜 빨강**으로 나왔다(`channelSpec`·`classifyFpBinding` — 둘 다 자기 파일이 쓴다).
 *      죽은 통로의 뜻은 «아무도 안 부른다» 이지 «남의 파일이 안 부른다» 가 아니다.
 *   ⇒ 정의 파일도 센다. 다만 **정의 줄 자체**(`export function X` · `const X =` · `type X`)는 호출이 아니라서 뺀다.
 */
function callSites(name, ownerFile) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${esc}\\b`);
  const defRe = new RegExp(`^\\s*(export\\s+)?(async\\s+)?(function|const|let|var|type|interface|class)\\s+${esc}\\b`);
  const hits = [];
  let importOnly = 0, own = 0;
  for (const [p, code] of CODE) {
    const lines = code.split("\n").filter((l) => re.test(l));
    if (!lines.length) continue;
    const real = lines.filter((l) => !/^\s*import\b/.test(l) && !/^\s*export\s+\{/.test(l) && !/^\s*}\s*from\s+/.test(l) && !defRe.test(l));
    if (!real.length) { importOnly++; continue; }
    if (p === ownerFile) own += real.length; else hits.push(`${p}(${real.length})`);
  }
  return { hits, importOnly, own };
}

/* ═══ R8 에서 새로 생긴 것들 — «만들었다»고 보고된 물건의 목록 ═══
   각 항목: [사람이 읽는 이름, 심볼, 정의 파일, 이게 죽으면 무슨 일이 나나] */
const TARGETS = [
  ["간격 정책(사장님 «10:00/10:05»)", "gapMinFor", "lib/publish-gap.ts", "편성이 옛 상수 30분을 계속 써서 계정을 붙여 올릴 수 없다"],
  ["간격 정책 — 고객이 내릴 수 있는 바닥", "floorMin", "lib/publish-gap.ts", "«5분까지 내릴 수 있다»가 화면에 영영 안 닿는다", "external"],
  ["채널 «성질» 정본", "channelSpec", "lib/channel-registry.ts", "채널마다 다른 성질을 각자 추측해서 또 갈라진다"],
  ["내려 주기 — 할 수 있나", "canRetract", "lib/channel-registry.ts", "«내릴 수 있다»를 아무도 안 물어 유튜브가 조용히 열린다"],
  ["내려 주기 — 실제 수행", "retractPost", "lib/publish/retract.ts", "«내려 줘» 단추가 아무것도 안 한다"],
  ["코인 단가 정본", "coinCostOf", "lib/coin-table.ts", "운영자가 고친 코인 값이 아무 데도 안 닿는다"],
  ["본문 글자 수", "blocksCharCount", "lib/blocks.ts", "분량 판정이 대용물(태그 길이)로 흐른다", "external"],
  ["러너 지문 구속", "classifyFpBinding", "lib/runner-jobs.ts", "훔친 토큰이 다른 PC 에서 그대로 통한다"],
  ["스톡 사진 찾기(§10 사진값)", "searchStock", "lib/stock/index.ts", "사진이 전부 AI 로만 만들어져 편당 원가의 85%가 그대로 남는다"],
  ["스톡 사진 붙이기(§10 사진값)", "attachStockPhoto", "lib/stock/attach.ts", "찾기만 되고 글에 못 붙여 «고를 수는 있는데 쓸 수는 없는» 기능이 된다"],
  /* ── [P1R8 §3.3 · B2] 셀렉터 표(recipe) — 이 라운드에 통째로 새로 생긴 사슬이라 **양끝을 다 센다** ── */
  ["셀렉터 표 — 서버가 잡에 실어 준다", "recipeForRunner", "lib/recipe-store.ts", "표를 만들어 놓고 **아무 잡에도 안 실려** 러너가 영영 묶여 온 표만 쓴다"],
  ["셀렉터 표 — 운영이 올린다", "putRecipe", "lib/recipe-store.ts", "표를 **넣을 길이 없어** 배포 기계가 통째로 죽은 채 초록으로 보인다"],
  ["셀렉터 표 — 넓히기", "promoteCandidate", "lib/recipe-store.ts", "후보가 영원히 카나리 단계에 머문다(화면엔 «시험 중»으로 보인다)"],
  ["셀렉터 표 — 되돌리기", "rollbackCandidate", "lib/recipe-store.ts", "깨진 표가 퍼진 채 아무도 못 되돌린다"],
  /* 🔴 제품이 부르는 이름은 `makeRecipe` 다 — 판정 자체(`decideRecipe`)는 **일부러 안쪽에 두고**
     하니스(`scripts/verify-recipe.mts`)로만 직접 잰다(순수 함수라 그래야 양성·음성을 같은 수로 잴 수 있다).
     그래서 여기서 세는 것은 «제품이 실제로 부르는 문»이어야 한다 — 이 검사가 그걸 짚어 줘서 고쳤다. */
  ["셀렉터 표 — 러너가 믿을지 판정", "makeRecipe", "runner/lib/recipe.mjs", "검증 없이 쓰거나 멀쩡한 표를 다 버린다(둘 다 조용하다)"],
  ["🔴 셀렉터 표 — 채널이 실제로 그 값을 쓰나", "BUNDLED_SELECTORS", "runner/channels/tistory.mjs", "표를 내려 줘도 채널이 **옛 상수**를 그대로 써서 배포가 아무것도 안 바꾼다"],
  ["로그인 보관 상태 — 잰다", "probeFleet", "runner/lib/profile-seal.mjs", "«리눅스가 몇 대인가»를 영영 모른 채 봉인을 만들지 말지 정하게 된다"],
];

for (const [label, sym, owner, harm, mode] of TARGETS) {
  const ownerSrc = read(owner);
  const defined = ownerSrc.includes(sym);
  if (!defined) { rec(`죽은 통로 — ${label}(\`${sym}\`)`, "WARN", `정의 파일 ${owner} 에서 이름을 못 찾았다 — 이름이 바뀌었나(검사를 고쳐라)`); continue; }
  const { hits, importOnly, own } = callSites(sym, owner);
  /* 🔴 `external` = **남이 읽으라고 만든 값**(화면·편성이 소비할 값). 자기 파일 안 등장은 타입 선언·자기 참조라 «소비»가 아니다.
     함수는 자기 파일이 써도 «쓰인다»가 맞지만, 내보내려고 만든 **값**은 바깥에서 읽혀야 산 것이다.
     🔴 이 구분이 없으면 `floorMin` 이 «자기 파일 8곳»으로 **초록이 되어 버린다**(그 8곳은 전부 타입·자기 참조다). */
  const ok = mode === "external" ? hits.length > 0 : hits.length + own > 0;
  rec(`🔴 죽은 통로 — ${label}(\`${sym}\`) 을 **제품이 부른다**`, ok,
    `바깥 ${hits.length}곳${hits.length ? ` [${hits.join(" · ")}]` : ""} · 자기 파일 ${own}곳${importOnly ? ` · 임포트만 ${importOnly}곳` : ""}`
    + (mode === "external" ? " (바깥에서 읽혀야 산 값)" : "") + (ok ? "" : ` ⇒ ${harm}`));
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
