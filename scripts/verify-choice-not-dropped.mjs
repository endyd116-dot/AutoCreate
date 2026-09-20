/**
 * scripts/verify-choice-not-dropped.mjs — 🔴 **손님이 고른 것을 서버가 조용히 버리지 않나** (B · 2026-09-21)
 *
 *   ══ 왜 ══
 *   `plan.html` 의 카드 등록 시트가 «카드번호 직접 입력» 체크박스를 그리고 `payRoute:"keyin"` 을 보내는데,
 *   `billing-key-start` 는 그 값을 **읽지도 않았다.** 🔴 **물어 놓고 버리는 것**이 제일 나쁘다 — 고객은 고른 줄 안다.
 *
 *   🔴 **재 보니 «서버가 받으면 된다»가 답이 아니었다**(2026-09-21 실측):
 *     `lib/billing/billing-key.ts:43` 이 빌키 라인을 `isKeyinMidConfigured() ? "keyin" : (opts.route === "keyin" ? "keyin" : "auth")` 로 정한다.
 *       · 키인 MID **있으면** → 고객이 무엇을 고르든 **언제나 keyin**(고를 것이 없다)
 *       · 키인 MID **없으면** → keyin 을 골라도 `getKiccConfig("keyin")` 이 auth MID 로 떨어진다(고를 수가 없다)
 *     ⇒ **어느 쪽이든 선택이 결과를 못 바꾼다.** 그러니 받아 주는 건 **연극**이고, **묻지 않는 것**이 정답이다.
 *     대신 §9 대로 **무엇이 일어나는지 말해 준다**(`notice`).
 *
 *   ══ 무엇을 재나 (파일만 읽는다 · `safe`) ══
 *     ① 🔴 **화면이 보내는 `payRoute` 를 그 엔드포인트가 실제로 쓴다** — 안 쓰면 «물어 놓고 버리는» 것이다.
 *        «쓴다» = 그 파일이 `resolvePayRoute`/`wantsKeyin` 을 부른다(정본 한 곳 · 여기서 두 번째 판정을 만들지 않는다).
 *     ② 🔴 **못 고르는 자리에는 선택지를 안 띄운다** — 카드 등록은 `keyinOptionForBillingKey()`(= `available:false`)를 쓴다.
 *     ③ 🔴 **안 띄우는 대신 말해 준다**(§9) — 그 서술자의 `notice` 가 비어 있지 않다.
 *     대조군 — 정말 고를 수 있는 자리(코인 단건)는 **그대로 물어보고 그대로 쓴다**.
 *
 *   🔴 **이 자가 못 하는 것**(AC-9):
 *     · KICC 가 그 창을 실제로 어떻게 그리는지는 **못 잰다** — 라이브 실거래가 필요하고 그건 금지다(사장님 선).
 *       우리 쪽 배선까지만 잰다: «MID 가 갈리나 · 청구가 같은 MID 로 가나»는 코드로 확인했고 그 근거를 머리말에 적었다.
 *     · 화면이 `notice` 를 **그리는지**는 안 본다(서버가 싣는 데까지 · 그리는 건 A 몫).
 *
 *   백슬래시 없는 검사만(AC-100) · 주석을 걷고 센다(AC-109 ①).
 *
 *   쓰기: node scripts/verify-choice-not-dropped.mjs
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");
const codeOnly = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const noHtml = (s) => s.replace(/<!--[\s\S]*?-->/g, " ");
const TPL = noHtml(read("public/app/_tpl.txt"));
const ROUTE = codeOnly(read("lib/pay-route.ts"));

/** `/api/xxx` → 그 경로를 여는 함수 파일. */
const byRoute = new Map();
for (const f of readdirSync("netlify/functions")) {
  if (!f.endsWith(".ts")) continue;
  const p = path.join("netlify/functions", f);
  if (statSync(p).isDirectory()) continue;
  const src = read(p);
  const m = src.match(/export const config\s*=\s*\{[^}]*path:\s*(\[[^\]]*\]|"[^"]*")/);
  if (!m) continue;
  for (const r of m[1].matchAll(/"(\/api\/[a-z0-9-]+)"/g)) byRoute.set(r[1], p);
}

const out = [];
const rec = (step, ok, note) => { out.push({ ok }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };

console.log(`\n«손님이 고른 것을 서버가 조용히 버리지 않나» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — 화면이 여는 /api 경로 ${byRoute.size}개 중 **payRoute 를 보내는 자리**`);
console.log("─".repeat(120));

/**
 * ① 🔴 화면이 `payRoute` 를 **붙이는 모든 자리**를 세고, 그 몸통이 **어느 엔드포인트로 흘러가나**를 따라간다.
 *
 *   🔴 [2026-09-21 메인이 세서 갈랐다] 첫 판은 **모양 둘만** 알았다(①`UI.api(…)` 한 문장 안 ②`const 이름 = (…) => {…}` 도우미).
 *      그런데 결제 쪽은 **셋째 모양**이었다 — `onclick` 에 **붙이는** 화살표(=`const` 가 아니다)에서 붙이고,
 *      보내는 것도 `UI.api` 가 아니라 **`startCard(body)` 라는 한 겹 건너간 함수**였다.
 *      ⇒ 그 자리가 **모수에 아예 안 들어와** 내 자는 초록, C 의 `verify-key-contract` 는 빨강 — **둘이 다른 말을 했다.**
 *      **AC-119 그 모양**: 축이 «어느 문법의» 문인지 못 말하면 옆에 다른 모양이 생기는 순간 무력해진다.
 *
 *   ⇒ 이제 **문법이 아니라 값의 흐름**으로 센다: `x.payRoute =` 를 **전부** 찾고, 그 `x` 가 닿는 `UI.api` 를 **한 겹 이상** 따라간다.
 *   🔴 못 따라가는 모양은 **«못 쟀음»으로 찍는다**(AC-9) — 조용히 빼면 이번 같은 일이 또 난다.
 *   🔴 **«보내는 자리 0» 을 통과로 쓰지 않는다** — 그건 «정직한 0» 일 수도, **눈이 먼 것**일 수도 있다. 0 이면 «못 쟀음».
 */
let unmeasured = 0;
{
  /** 이름이 붙은 함수 몸통(대략) — `function f(…) {` · `const f = (…) => {` 둘 다. */
  const bodyOfFn = (name) => {
    const i = TPL.search(new RegExp(`(?:function\\s+${name}\\s*\\(|const\\s+${name}\\s*=\\s*(?:async\\s*)?\\()`));
    return i < 0 ? "" : TPL.slice(i, i + 700);
  };
  /** 그 창 안에서 처음 나오는 `/api/…` 하나. */
  const apiIn = (s) => (s.match(/UI\.api\("(\/api\/[a-z0-9-]+)"/) || [])[1] ?? null;

  const attach = [...TPL.matchAll(/(\w+)\.payRoute\s*=/g)];
  const resolved = [], blind = [];
  for (const m of attach) {
    const v = m[1];
    /* 🔴 창을 **그 줄 끝까지**로 묶는다. 처음엔 900자를 봤는데 **다음 함수까지 넘어가** 엉뚱한 `/api/plans` 를 물었다
       (넓게 보면 못 보던 것을 보는 게 아니라 **틀린 것을 본다**). 이 리포는 한 줄에 흐름이 다 있는 문체라 줄이 곧 그 흐름이다. */
    const eol = TPL.indexOf("\n", m.index);
    const ahead = TPL.slice(m.index, eol < 0 ? m.index + 400 : eol);
    /* ㉮ 같은 흐름 안에서 바로 보낸다 */
    let route = apiIn(ahead);
    /* ㉯ 한 겹 건너간다 — `startCard(body)` 처럼 그 몸통을 넘겨받는 함수 */
    if (!route) {
      for (const c of ahead.matchAll(new RegExp(`\\b(\\w+)\\(\\s*${v}\\s*\\)`, "g"))) {
        const r = apiIn(bodyOfFn(c[1]));
        if (r) { route = r; break; }
      }
    }
    /* ㉰ 몸통을 **돌려주는** 도우미 — 부르는 자리에서 다음 줄에 보낸다(`keyinBody`) */
    if (!route) {
      /* 🔴 감싸는 **함수** 이름을 집는다. 첫 판은 `lastIndexOf("const ")` 로 집었는데 — 바로 앞의 `const el = …` 을 물어
         도우미 이름을 영영 못 찾았다(그래서 코인 쪽이 «못 따라갔다»로 빠졌다). **함수 꼴인 `const` 만** 본다. */
      const before = TPL.slice(0, m.index);
      const fns = [...before.matchAll(/(?:function\s+(\w+)\s*\(|const\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)/g)];
      const name = fns.length ? (fns[fns.length - 1][1] ?? fns[fns.length - 1][2]) : null;
      if (name && new RegExp(`return\\s+${v}`).test(ahead)) {
        for (const c of TPL.matchAll(new RegExp(`\\b${name}\\(`, "g"))) {
          const r = apiIn(TPL.slice(c.index, c.index + 600));
          if (r) { route = r; break; }
        }
      }
    }
    const near = TPL.slice(Math.max(0, m.index - 60), m.index + 40).replace(/\s+/g, " ").trim();
    if (route) resolved.push({ route, near }); else blind.push(near);
  }

  const dropped = [];
  for (const { route, near } of resolved) {
    const file = byRoute.get(route);
    const src = file ? codeOnly(read(file)) : "";
    if (!/resolvePayRoute\(|wantsKeyin\(/.test(src)) dropped.push(`${route}${file ? `(${path.basename(file)})` : "(서버 파일을 못 찾았다)"} ← «${near.slice(-46)}»`);
  }
  const routes = [...new Set(resolved.map((r) => r.route))];
  const ok = attach.length > 0 && blind.length === 0 && dropped.length === 0;
  rec("① 🔴 화면이 보내는 `payRoute` 를 그 엔드포인트가 **실제로 쓴다**", ok,
    !attach.length ? "🔴 `payRoute` 를 붙이는 자리를 하나도 못 찾았다 — **통과가 아니라 못 쟀음**이다(정직한 0 인지 눈이 먼 것인지 가릴 수 없다)"
      : dropped.length ? `🔴 물어 놓고 버리는 자리 ${dropped.length}곳: ${dropped.join(" · ")} — 고객은 고른 줄 안다`
        : blind.length ? `⊘ 붙이는 자리 ${attach.length}곳 중 ${blind.length}곳은 **어디로 가는지 못 따라갔다**: ${blind.join(" · ")}`
          : `붙이는 ${attach.length}곳 → 엔드포인트 ${routes.length}개(${routes.join(", ")})가 전부 \`resolvePayRoute\`(정본)를 지난다`);
  if (!attach.length || blind.length) unmeasured++;
}

/* ② 못 고르는 자리에는 선택지를 안 띄우나 */
{
  const sub = codeOnly(read("netlify/functions/subscription.ts"));
  const usesBk = /keyinOptionForBillingKey\(\)/.test(sub);
  const usesPlain = /[^A-Za-z]keyinOption\(\)/.test(sub);
  const declared = /available: false/.test(ROUTE) && /export async function keyinOptionForBillingKey/.test(ROUTE);
  rec("② 🔴 **못 고르는 자리에는 선택지를 안 띄운다**(카드 등록)", usesBk && !usesPlain && declared,
    !declared ? "🔴 `keyinOptionForBillingKey`(available:false)가 없다"
      : usesPlain ? "🔴 카드 등록이 단건용 서술자(`keyinOption`)를 쓴다 — 고를 수 없는 것을 물어보게 된다"
        : usesBk ? "카드 등록은 `available:false` 를 내려보낸다 — 화면이 체크박스를 아예 안 그린다"
          : "🔴 카드 등록이 어떤 서술자도 안 쓴다");
}

/* ③ 안 띄우는 대신 말해 주나(§9) */
{
  const body = (ROUTE.match(/export async function keyinOptionForBillingKey[\s\S]*?\n\}/) || [""])[0];
  const notices = [...body.matchAll(/notice:[\s\S]*?\n/g)].map((m) => m[0]);
  const hasBoth = /isKeyinMidConfigured\(\)\s*\?/.test(body) && (body.match(/"[^"]*요\./g) || []).length >= 2;
  rec("③ 🔴 **안 띄우는 대신 말해 준다**(§9 — 막는 게 아니라 알려 주는 것)", hasBoth,
    hasBoth ? "키인 MID 가 있을 때와 없을 때 **각각** 무슨 창이 열리는지 한 문장씩 내려보낸다"
      : `🔴 \`notice\` 가 비었거나 한 경우만 말한다(${notices.length}개) — 안 띄우기만 하면 그냥 사라진 것이다`);
}

/* 대조군 — 정말 고를 수 있는 자리는 그대로 물어보고 그대로 쓴다 */
{
  const coin = codeOnly(read("netlify/functions/coin-purchase.ts"));
  const asks = /keyinOption\(\)/.test(coin);
  const uses = /resolvePayRoute\(/.test(coin);
  rec("대조군 — **고를 수 있는 자리는 그대로 둔다**(이 자가 «다 지워라»가 아니다)", asks && uses,
    asks && uses ? "코인 단건은 `keyinOption()` 으로 물어보고 `resolvePayRoute()` 로 쓴다 — 이 모양이 정답이다"
      : `🔴 단건 쪽이 무너졌다 — 물어보나=${asks} · 쓰나=${uses}`);
}

console.log("─".repeat(120));
const bad = out.filter((x) => !x.ok).length;
console.log(bad ? `🔴 FAIL ${bad} / ${out.length}` : `PASS ${out.length} · FAIL 0`);
console.log("🔴 이 자는 **우리 배선**까지 잰다 — KICC 창이 실제로 어떻게 뜨는지는 라이브 실거래가 필요해 못 잰다(머리말).");
/* 🔴 «못 쟀음»은 **통과가 아니다**(AC-9) — 빨강이 없어도 종료코드 2 로 내보내 배치가 초록으로 세지 않게 한다. */
if (!bad && unmeasured) console.log("⊘ 못 쟀음 — 재료가 없거나 흐름을 못 따라갔다. **통과가 아니다.**");
process.exit(bad ? 1 : (unmeasured ? 2 : 0));
