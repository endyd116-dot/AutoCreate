/**
 * scripts/verify-selector-guard.mts — 🔴 «죽은 셀렉터»를 경계에서 막나(AC-205 · B2 · 2026-09-23).
 *   사용: `npx --yes tsx scripts/verify-selector-guard.mts` · 네트워크 0 · **브라우저 0** · DB 0
 *
 *   ══ 왜 ══
 *     어제 `locator("text=이용이 제한, text=제재")` 가 **한 번도 안 걸려** 제재당한 계정에 계속 글을 밀어 넣었다.
 *     소스에 있던 건 고쳤는데, 🔴 **같은 모양이 서버 레시피로 들어올 수 있다** — `recipe.sel()` 이
 *     「비어 있지 않으면」 무엇이든 썼다. 레시피는 러너 재배포 없이 셀렉터를 고치는 길이라 **오타 한 번이면 나간다.**
 *
 *   ══ 재는 것 ══
 *     ① 판정 — 거부표 / 🔴 **통과표(대조군)**. 멀쩡한 걸 거부하면 **서버 수리가 묻힌다**
 *     ② 경계 — `recipe.sel()` 이 실제로 되돌리나 · `rejected` 에 남나 · **잡은 멈추지 않나**(§9)
 *     ③ 보고 — 거부가 **조용하지 않나**(`core.mjs` 가 싣나)
 *     ④ 🔴 변이 — 규칙을 어긋내면 잡히나 · **탐침이 이를 잃으면** 잡히나
 *
 *   🔴 거부 규칙의 근거는 `scripts/probe-selector-guard.mjs` 다 — **진짜 브라우저로** 13줄을 확인했다(13/0).
 *      그 탐침 없이 규칙을 늘리지 마라. 「의심스럽다」는 거부 사유가 아니다.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { stripComments } from "./lib/block.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const { selectorLooksDead, SELECTOR_REJECT_SAY } = await import(
  pathToFileURL(path.join(ROOT, "runner", "lib", "selector-guard.mjs")).href
) as {
  selectorLooksDead: (s: unknown) => { dead: boolean; why: string };
  SELECTOR_REJECT_SAY: Record<string, string>;
};
const { makeRecipe } = await import(pathToFileURL(path.join(ROOT, "runner", "lib", "recipe.mjs")).href) as {
  makeRecipe: (r: unknown, bundled: Record<string, string>, v: string) => { sel: (n: string) => string; rejected: { name: string; why: string }[] };
};
const code = (rel: string) => stripComments(readFileSync(path.join(ROOT, rel), "utf8"));

let pass = 0; let fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}${extra ? `\n      ${extra}` : ""}`); } };

/* ═══ ① 판정표 — 거부 / 통과. 🔴 통과표가 거부표보다 중요하다(거짓 빨강이 더 비쌀 수 있다) ═══ */
const REJECT: [string, string][] = [
  ["text=이용이 제한, text=제재", "engines_joined_by_comma"],
  ["text=가, text=나", "engines_joined_by_comma"],
  ["css=div, text=가", "engines_joined_by_comma"],
  ["div[", "unbalanced_bracket"],
  ["div]", "unbalanced_bracket"],
  ["button:has-text(", "unbalanced_paren"],
  ["button)", "unbalanced_paren"],
  ['div[aria-label="열기', "unclosed_quote"],
  ["", "empty"],
  ["   ", "empty"],
];
const ALLOW = [
  "div#x.y", "text=보기글",
  "div, span",                     // 🔴 CSS 목록은 멀쩡하다
  '[aria-label="a, b"]',           // 🔴 따옴표 안의 콤마
  'div[data-x="]"]',               // 🔴 따옴표 안의 대괄호
  'button:has-text("확인")', "#a > .b:nth-child(2)",
  '.se-popup button:has-text("발행"), .layer_btn_area button:has-text("발행")',   // 🔴 실제 코드에 있는 꼴
  "text=/이용이 제한|제재/",         // 🔴 정규식 — 콤마 없다
];

console.log("① 판정 — 거부표 10줄 · 🔴 통과표(대조군) 9줄");
for (const [sel, why] of REJECT) {
  const r = selectorLooksDead(sel);
  ok(`거부: «${(sel || "(빈 값)").slice(0, 30)}» → ${why}`, r.dead && r.why === why, `dead=${r.dead} why=${r.why}`);
}
for (const sel of ALLOW) {
  const r = selectorLooksDead(sel);
  ok(`🔴 통과: «${sel.slice(0, 44)}»`, !r.dead, `거부됨(${r.why}) — 서버 수리가 묻힌다`);
}
ok("거부 사유마다 사람말이 있다", REJECT.every(([, why]) => typeof SELECTOR_REJECT_SAY[why] === "string"),
  REJECT.map(([, w]) => w).filter((w) => !SELECTOR_REJECT_SAY[w]).join(","));
ok("사람말에 겁주는 말 0", !/정지|불이익|책임|경고|위반/.test(Object.values(SELECTOR_REJECT_SAY).join(" ")));

console.log("\n② 경계 — `recipe.sel()` 이 실제로 되돌리나");
{
  const bundled = { pubBtn: "button.ok", title: "input.t" };
  /* 서명 없는 레시피는 `decideRecipe` 가 안 쓴다 — 그때도 **묶여 온 값**이 나와야 한다(무회귀). */
  const noServer = makeRecipe(null, bundled, "1.4.0");
  ok("서버 표가 없으면 묶여 온 값", noServer.sel("pubBtn") === "button.ok");
  ok("서버 표가 없으면 거부도 0", noServer.rejected.length === 0);
  /* 🔴 `makeRecipe` 는 서명을 보므로 여기서 서버 값을 통과시킬 수 없다 —
     **`sel()` 의 갈래 자체**를 재려면 순수 함수로 재는 게 정직하다(위 ①). 경계는 **소스로** 못 박는다. */
  const rc = code("runner/lib/recipe.mjs");
  ok("🔴 `sel()` 이 `selectorLooksDead` 를 실제로 부른다", /sel\(name\)\s*\{[\s\S]{0,400}selectorLooksDead/.test(rc),
    "🔴 안 부르면 서버가 민 죽은 셀렉터가 그대로 나간다");
  ok("🔴 거부하면 **묶여 온 값으로 되돌린다**(멈추지 않는다 · §9)", /return bundled\?\.\[name\] \?\? ""/.test(rc));
  ok("🔴 거부를 `rejected` 에 남긴다(조용하지 않다)", /rejected\.push\(/.test(rc));
  ok("같은 칸을 두 번 적지 않는다(보고가 도배되지 않게)", /rejected\.some\(/.test(rc));
  ok("🔴 `sel()` 이 throw 하지 않는다(잡을 죽이지 않는다)", !/sel\(name\)\s*\{[\s\S]{0,400}throw /.test(rc));
}

console.log("\n③ 보고 — 거부가 조용하지 않나");
{
  const cc = code("runner/core.mjs");
  ok("🔴 `core.mjs` 가 `recipeRejected` 를 보고에 싣는다", /seen\.recipeRejected\s*=/.test(cc),
    "🔴 안 실으면 서버 표가 깨진 채로 조용히 돈다 — 어제 그 셀렉터와 같은 모양이 된다");
  ok("사람이 읽을 로그도 남긴다", /서버 셀렉터 표에서/.test(cc));
}

console.log("\n④ 🔴 변이 — 규칙을 어긋내면 잡히나");
{
  type J = (s: string) => boolean;
  const real: J = (s) => selectorLooksDead(s).dead;
  const MUT: { name: string; f: J }[] = [
    { name: "🔴 V1 콤마만 보고 거부한다 → **CSS 목록이 묻힌다**(거짓 빨강)", f: (s) => /,/.test(s) },
    { name: "🔴 V2 따옴표를 안 가린다 → `[aria-label=\"a, b\"]` 가 묻힌다", f: (s) => (s.match(/(?:^|,)\s*(?:text|css)\s*=/g) ?? []).length > 1 || /,/.test(s) },
    { name: "V3 괄호 짝을 안 본다", f: (s) => selectorLooksDead(s).why.startsWith("engines") || !s.trim() },
    { name: "🔴 V4 아예 안 막는다(늘 통과) — 이 기능을 뺀 것", f: () => false },
    { name: "🔴 V5 다 막는다(늘 거부) — 서버 수리가 통째로 묻힌다", f: () => true },
  ];
  const ALL: [string, boolean][] = [
    ...REJECT.map(([s]) => [s, true] as [string, boolean]),
    ...ALLOW.map((s) => [s, false] as [string, boolean]),
  ];
  for (const m of MUT) {
    const caught = ALL.filter(([s, want]) => m.f(s) !== want);
    ok(`${m.name} — 잡힘(${caught.length}줄)`, caught.length > 0, "🔴 아무 줄도 못 잡는다 = 그 규칙은 아무도 안 지킨다");
  }
  ok("(대조군) 진짜 판정은 표와 어긋나지 않는다", ALL.every(([s, want]) => real(s) === want),
    ALL.filter(([s, want]) => real(s) !== want).map(([s]) => s).join(" | "));
}

console.log("\n⑤ 🔴 탐침이 이를 잃지 않았나(근거가 살아 있나)");
{
  const pr = code("scripts/probe-selector-guard.mjs");
  ok("🔴 탐침이 **진짜 브라우저**를 쓴다(내 의견이 아니라 실측이 근거다)", /requirePlaywright|chromium/.test(pr));
  ok("🔴 탐침에 **대조군**(통과해야 하는 것)이 있다", /want: "alive"/.test(pr));
  ok("🔴 탐침이 어제 그 셀렉터를 줄로 갖고 있다", /text=이용이 제한, text=제재/.test(pr));
  const dp = code("scripts/probe-dead-selectors.mjs");
  ok("🔴 전수 탐침에 **자기시험**이 있다(0개가 «못 보는 것»이 아님을 보인다)", /자기시험/.test(dp));
  ok("🔴 전수 탐침이 **못 보는 모수**를 적는다(변수·템플릿)", /callDynamic/.test(dp));
}

console.log(`\n${fail === 0 ? "🟢" : "🔴"} pass ${pass} · fail ${fail}`);
process.exit(fail === 0 ? 0 : 1);
