/**
 * scripts/probe-dead-selectors.mjs — 🔴 **한 번도 안 걸리는 셀렉터가 또 있나**(AC-205 · B2 · 2026-09-23).
 *   실행: `node scripts/probe-dead-selectors.mjs`  (playwright 는 `_lib/find-playwright.mjs` 가 찾아 준다)
 *   네트워크 0 · 발행 0 · 빈 페이지에 대고 **파싱되나**만 본다.
 *
 *   ══ 🔴 왜 이걸 골랐나 ══
 *     어제 제일 무거웠던 결함은 «로직이 틀린 것»이 아니라 **«코드가 아예 안 도는 것»**이었다:
 *     `locator("text=이용이 제한, text=제재")` 가 콤마 때문에 **한 문자열**로 읽혀 **한 번도 안 걸렸고**,
 *     그래서 **제재당한 계정에 계속 글을 밀어 넣었다.**
 *     🔴 **그건 갈래를 세어도 안 보인다** — 표에는 멀쩡히 한 줄로 있었다. **돌려 봐야** 보였다.
 *     ⇒ 같은 부류가 더 있나를 **지금, 발행 없이** 셀 수 있다. 그게 이 판에 할 수 있는 가장 값진 일이라고 봤다.
 *
 *   ══ 🔴 왜 «안 보이나» — 삼키는 자리가 같이 있다 ══
 *     셀렉터 호출은 거의 다 `.catch(() => 0)` · `.catch(() => false)` 로 감싸 있다.
 *     그러면 **터지는 셀렉터**와 **못 찾은 셀렉터**가 **같은 값**이 된다 — 터져도 «없네» 로 읽힌다.
 *     그래서 이 탐침은 둘을 **가려서** 센다(AC-9: ✗ 와 ⊘ 를 섞지 않는다).
 *
 *   ══ 못 재는 것(정직하게) ══
 *     ⊘ **«실제 화면에서 맞나»는 못 잰다** — 빈 페이지에 대는 것이라 «파싱은 되는데 과녁이 틀린» 셀렉터는 못 잡는다.
 *       그건 실물 발행이 답한다(지금은 공개 발행 0). 여기는 **«문법적으로 죽었나»**까지다.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
/* 🔴 playwright 는 `runner/node_modules` 에만 있다 — **이미 있는 관례**를 쓴다(새 길을 내지 않는다).
   없으면 **exit 2(«못 쟀다»)** 다. 「통과」라고 말하지 않는다(AC-9 · 그 파일 머리말 그대로). */
import { requirePlaywright } from "./_lib/find-playwright.mjs";
import { codeOnlyKeepIndex } from "./_lib/code-only.mjs";

const { chromium } = await requirePlaywright();
const ROOT = path.resolve(import.meta.dirname, "..");
const files = [];
for (const d of ["runner/channels", "runner/lib"]) {
  const abs = path.join(ROOT, d);
  for (const f of readdirSync(abs)) if (f.endsWith(".mjs")) files.push(path.join(abs, f));
}

/** 🔴 **열거다 — 전부 센다**(유일성 아님 · `unique` 를 여기 대면 모수가 1로 줄어 조용한 초록이 된다). */
const found = [];
const seenKey = new Set();
for (const abs of files) {
  const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
  const src = codeOnlyKeepIndex(readFileSync(abs, "utf8"));
  /* ① `locator("…")` · `waitForSelector("…")` · `$$("…")` 에 **글자 그대로** 들어간 것 */
  for (const m of src.matchAll(/(?:locator|waitForSelector|\$\$?)\(\s*(["'])((?:\\.|(?!\1)[^\\])+)\1/g)) {
    const sel = m[2];
    const line = src.slice(0, m.index).split("\n").length;
    const key = `${rel}:${line}:${sel}`;
    if (!seenKey.has(key)) { seenKey.add(key); found.push({ rel, line, sel, from: "call" }); }
  }
  /* ② 셀렉터 **표**(`BUNDLED_SELECTORS = { key: "…" }`) — 러너가 `S.key` 로 꺼내 쓴다 */
  const tbl = src.indexOf("BUNDLED_SELECTORS");
  if (tbl >= 0) {
    const body = src.slice(tbl, src.indexOf("\n};", tbl) + 3);
    for (const m of body.matchAll(/^\s*[\w$]+\s*:\s*(["'])((?:\\.|(?!\1)[^\\])+)\1/gm)) {
      const sel = m[2];
      const line = src.slice(0, tbl + m.index).split("\n").length;
      const key = `${rel}:${line}:${sel}`;
      if (!seenKey.has(key)) { seenKey.add(key); found.push({ rel, line, sel, from: "table" }); }
    }
  }
}

/* 표에서 온 값 중 셀렉터가 아닌 것(문구·URL 등)은 뺀다 — 과녁을 넓히면 거짓 빨강이 난다. */
const looksSelector = (s) =>
  /[.#\[\]>:]|^text=|^css=|^xpath=|^role=|has-text|internal:/.test(s) && !/^https?:\/\//.test(s) && s.length <= 300;
const cand = found.filter((f) => looksSelector(f.sel));

/* 🔴 **모수를 정직하게 적는다.** 내 정규식은 **글자 그대로**의 셀렉터만 본다 —
   `locator(`${x}`)` · `locator(S.title)` · `locator(sel)` 처럼 **변수·템플릿**으로 들어가는 것은 못 본다.
   그 값은 `BUNDLED_SELECTORS`(여기서 보는 표) 아니면 **서버 레시피**(`recipe.sel(k)`)에서 온다 —
   뒤엣것은 소스에 없으니 **원리적으로 못 잰다.**
   ⚠️ 이걸 안 적으면 «53개 다 통과»가 «러너 셀렉터는 다 멀쩡하다»로 읽힌다. 그게 조용한 초록이다. */
let callTotal = 0; let callDynamic = 0;
for (const abs of files) {
  const src = codeOnlyKeepIndex(readFileSync(abs, "utf8"));
  for (const m of src.matchAll(/locator\(\s*(.)/g)) {
    callTotal++;
    if (m[1] !== '"' && m[1] !== "'") callDynamic++;     // 백틱·변수·배열 …
  }
}
console.log(`■ 셀렉터 후보 **${cand.length}개** (셀렉터가 아니라 거른 것 ${found.length - cand.length}개 · 파일 ${files.length}개)`);
console.log(`   ⊘ **내가 못 보는 것**: \`locator(…)\` 총 ${callTotal}회 중 **${callDynamic}회가 변수·템플릿**이라 글자를 모른다.`);
console.log(`      그중 표(BUNDLED_SELECTORS)에서 오는 값은 위 후보에 들어 있고, **서버 레시피에서 오는 값은 소스에 없어 못 잰다.**\n`);

const ctx = await chromium.launchPersistentContext("", { headless: true });
const page = ctx.pages()[0] ?? await ctx.newPage();
const dead = []; const mixed = []; const okList = [];
try {
  await page.setContent("<body><div id=x class=y>보기글</div></body>");
  for (const c of cand) {
    /* 🔴 **터지나**를 본다 — 제품 코드는 `.catch(() => 0)` 로 삼켜서 «없네»로 읽는다. */
    let err = null;
    try { await page.locator(c.sel).count(); } catch (e) { err = String(e.message).split("\n")[0].slice(0, 90); }
    /* 🔴 **콤마로 엔진을 섞은 것** — 터지지 않고 **조용히 한 문자열**이 된다(어제 그 병). */
    const enginesJoined = /,/.test(c.sel) && (c.sel.match(/(?:^|,)\s*(?:text|css|xpath|role|id|data-testid)=/g) ?? []).length > 1;
    if (err) dead.push({ ...c, err });
    else if (enginesJoined) mixed.push(c);
    else okList.push(c);
  }
} finally { await ctx.close(); }

console.log(`■ 🔴 **터지는 셀렉터** ${dead.length}개  — 제품에선 \`.catch(()=>0)\` 이 삼켜 «없네»로 읽힌다`);
for (const d of dead) console.log(`   ${d.rel}:${d.line} [${d.from}]  «${d.sel.slice(0, 70)}»\n      ${d.err}`);

console.log(`\n■ 🔴 **콤마로 엔진을 섞은 것** ${mixed.length}개 — 안 터지고 **조용히 한 문자열**이 된다(어제 그 병)`);
for (const d of mixed) console.log(`   ${d.rel}:${d.line} [${d.from}]  «${d.sel.slice(0, 70)}»`);

console.log(`\n■ 통과 ${okList.length}개`);

/* ═══ 🔴 **자기시험 — 이 탐침에 이가 있나** ═══
 *   「0개 나왔다」는 **탐침이 아무것도 못 보는 경우에도** 나온다. 어제 배운 그대로라,
 *   **알려진 죽은 셀렉터**를 도로 넣어 보고 **잡히는지**부터 본다. 안 잡히면 위 0 은 뜻이 없다.
 */
console.log("\n■ 🔴 자기시험 — 알려진 죽은 것을 넣으면 잡히나");
{
  const KNOWN = [
    { name: "어제 그 셀렉터(콤마로 엔진 섞기)", sel: "text=이용이 제한, text=제재", want: "mixed" },
    { name: "문법이 깨진 셀렉터", sel: "div[", want: "dead" },
    { name: "(대조군) 멀쩡한 셀렉터", sel: "div#x.y", want: "ok" },
  ];
  const ctx2 = await chromium.launchPersistentContext("", { headless: true });
  const pg = ctx2.pages()[0] ?? await ctx2.newPage();
  let teeth = 0;
  try {
    await pg.setContent("<body><div id=x class=y>보기글</div></body>");
    for (const k of KNOWN) {
      let err = null;
      try { await pg.locator(k.sel).count(); } catch (e) { err = String(e.message).split("\n")[0]; }
      const enginesJoined = /,/.test(k.sel) && (k.sel.match(/(?:^|,)\s*(?:text|css|xpath|role|id|data-testid)=/g) ?? []).length > 1;
      const got = err ? "dead" : enginesJoined ? "mixed" : "ok";
      const good = got === k.want;
      if (good) teeth++;
      console.log(`   ${good ? "✓" : "🔴"} ${k.name} → ${got}${good ? "" : ` (${k.want} 이어야 한다)`}`);
    }
  } finally { await ctx2.close(); }
  if (teeth !== KNOWN.length) {
    console.log("\n🔴 **자기시험이 깨졌다 — 위의 «0개»는 뜻이 없다.** 탐침을 먼저 고쳐라.");
    process.exit(2);
  }
  console.log("   ⇒ 이가 있다. 위의 0 은 «훑은 범위 안에서는 없다»는 뜻이다.");
}
console.log(`\n⊘ **못 재는 것**: 빈 페이지에 대는 것이라 «파싱은 되는데 **과녁이 틀린**» 셀렉터는 못 잡는다.`);
console.log(`   그건 실물 발행이 답한다(지금 공개 발행 0). 여기는 «문법적으로 죽었나»까지다.`);
process.exit(dead.length + mixed.length === 0 ? 0 : 1);
