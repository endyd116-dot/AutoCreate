/**
 * scripts/verify-money-idem.mjs — 🔴 **«돈 원장의 멱등 키는 «뜻»에서 나온다»**(C · 수리 라운드 2026-09-19 · B④).
 *   사용: node scripts/verify-money-idem.mjs
 *         node scripts/verify-money-idem.mjs --list   (찾은 멱등 키를 전부 찍는다 — 모수를 보인다)
 *
 *   ══ 왜 이 자가 있나 — 운영자가 한 번 더 누르면 고객 코인이 두 배가 된다 ══
 *   2026-09-19 시나리오 B: 운영 «코인 넣어주기»를 **동시에 두 번** 던졌더니(더블클릭 흉내)
 *     `{"ok":true,"applied":30,"balance":180}` `{"ok":true,"applied":30,"balance":210}`
 *   원장에 **두 줄**이 들어갔다 — `ops:1:1789757569049` · `ops:1:1789757569071` (**22ms 차이**). 잔액 150 → **210**.
 *   원인 — `netlify/functions/ops-tenants.ts:169` `` const ref = `ops:${o.ops.oid}:${Date.now()}`; ``
 *   🔴 **멱등 키가 «운영자의 뜻»이 아니라 «시계»에서 나온다.** 같은 밀리초 안에 들어와야만 한 번이 되는데
 *   사람 손가락은 그보다 느리다. ⇒ 멱등이 **사실상 없다.**
 *
 *   🔴 **같은 파일이 다른 칸에서는 제대로 한다** — 월 포함분은 `included:{tid}:{YYYY-MM}` 처럼 **뜻**으로 만든다.
 *   그래서 이건 «어려워서 못 한 것»이 아니라 **한 자리만 새는 것**이다.
 *
 *   ══ 무엇을 세는가 — 🔴 손 목록이 없다(AC-108) ══
 *   `lib/coin-ledger.ts` 의 **원장 쓰기 함수**(export 목록에서 읽어 온다)를 부르는 자리를 폴더째 찾아,
 *   그 호출에 들어가는 **멱등 키 표현식**을 따라가 본다(지역 `const` 한 겹까지 풀어 준다). 그리고 가른다:
 *     · 🔴 **시계·난수**(`Date.now()`·`getTime()`·`Math.random()`·`randomUUID`·`randomBytes`)가 섞였다 → 멱등이 아니다
 *     · ✅ **뜻**(테넌트·piece·주문번호·달 …)으로만 만들었다 → 몇 번을 불러도 한 줄
 *     · ⊘ **키를 아예 안 줬다**(`null`·생략) → 멱등이 **없다** — 통과로 세지 않는다
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · 지역 `const` **한 겹**까지만 푼다. 함수 인자로 받아 온 ref 는 «못 쟀음»으로 센다.
 *   · «뜻으로 만들었으면 **정말로** 두 번 눌러도 한 줄인가»는 **DB 가 답할 일**이다 —
 *     이 자는 글자만 본다. 실제 왕복은 시나리오 B 가 했다.
 *   · 코인 말고 다른 원장(결제·정산)은 안 본다.
 *
 *   종료코드: 0 = 전부 뜻에서 나온다 · 1 = 시계·난수가 섞인 자리가 있다 · 2 = 못 쟀다.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.MONEY_IDEM_ROOT ? path.resolve(process.env.MONEY_IDEM_ROOT) : path.resolve(import.meta.dirname, "..");
const LEDGER = path.join(ROOT, "lib", "coin-ledger.ts");
const LIST = process.argv.includes("--list");
if (!existsSync(LEDGER)) { console.error("⊘ 못 쟀어요 — lib/coin-ledger.ts 가 없습니다."); process.exit(2); }

const out = [];
const rec = (step, ok, note) => { out.push({ step, ok, note }); console.log(`  ${ok ? "✓" : "✗"} ${step}  — ${note}`); return ok; };
const rel = (p) => path.relative(ROOT, p).replace(/\\/g, "/");
function walk(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith(".ts")) acc.push(p);
  }
  return acc;
}
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

/* ═══ 원장 쓰기 함수 이름을 **소스에서 읽어 온다** — 베껴 적으면 함수가 늘어난 날 낡는다(AC-78) ═══
   «ref 를 받는 함수»만 고른다(시그니처에 `ref` 가 있는 것). */
const ledgerSrc = codeOnly(readFileSync(LEDGER, "utf8"));
const LEDGER_FNS = [];
for (const m of ledgerSrc.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g)) {
  if (/\bref\b/.test(m[2])) LEDGER_FNS.push(m[1]);
}
if (!LEDGER_FNS.length) { console.error("⊘ 못 쟀어요 — coin-ledger 에서 ref 를 받는 함수를 못 찾았습니다(이 자가 낡았습니다)."); process.exit(2); }

/** 시계·난수가 섞였나. */
const CLOCK = /Date\.now\s*\(\)|getTime\s*\(\)|Math\.random\s*\(\)|randomUUID|randomBytes|performance\.now/;

/** 괄호 균형으로 호출 인자를 잘라 최상위 쉼표로 쪼갠다. */
function argsOf(src, openIdx) {
  let d = 0, end = -1;
  for (let i = openIdx; i < src.length; i++) {
    if (src[i] === "(") d++;
    else if (src[i] === ")") { d--; if (!d) { end = i; break; } }
  }
  if (end < 0) return null;
  const inner = src.slice(openIdx + 1, end);
  /* 🔴 **따옴표·백틱은 «켜고 끄는 것»이지 «겹치는 것»이 아니다.**
     첫 판은 백틱을 여는 쪽으로만 세어서 `` `추천 보상 · ${이름} 첫 결제` `` 가 든 호출의 깊이가 **영영 0으로 안 돌아왔다**.
     그래서 `lib/referral.ts:145` 를 «ref 를 안 줬다»(⊘)로 잘못 읽었다 — **실제로는 주고 있다.**
     🔴 내가 «새 결함을 찾았다»고 보고하기 직전이었다. 자를 먼저 의심해서 살았다. */
  const parts = []; let d2 = 0, cur = "", q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) {                                  // 따옴표 안 — 닫힐 때까지 그대로 담는다
      if (c === "\\") { cur += c + (inner[++i] ?? ""); continue; }
      if (c === q) q = null;
      cur += c; continue;
    }
    if (c === "`" || c === '"' || c === "'") { q = c; cur += c; continue; }
    if ("{[(".includes(c)) d2++;
    else if ("}])".includes(c)) d2--;
    if (c === "," && d2 === 0) { parts.push(cur); cur = ""; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim());
}

const sites = [];
for (const dir of [path.join(ROOT, "lib"), path.join(ROOT, "netlify", "functions")]) {
  if (!existsSync(dir)) continue;
  for (const f of walk(dir)) {
    if (rel(f) === "lib/coin-ledger.ts") continue;          // 정본 자신은 재지 않는다
    const src = codeOnly(readFileSync(f, "utf8"));
    for (const fn of LEDGER_FNS) {
      for (const m of src.matchAll(new RegExp(`\\b${fn}\\s*\\(`, "g"))) {
        const args = argsOf(src, m.index + m[0].length - 1);
        if (!args) continue;
        /* ref 가 몇 번째인지 **정본 시그니처에서** 읽는다(자리를 짐작하지 않는다). */
        const sig = ledgerSrc.match(new RegExp(`export\\s+(?:async\\s+)?function\\s+${fn}\\s*\\(([^)]*)\\)`));
        const params = sig ? sig[1].split(",").map((s) => s.trim().split(/[:=?]/)[0].trim()) : [];
        const at = params.indexOf("ref");
        if (at < 0) continue;
        let expr = args[at] ?? "";
        let resolved = expr;
        /* 지역 `const <이름> = …` 한 겹을 풀어 준다. */
        if (/^[A-Za-z_$][\w$]*$/.test(expr)) {
          const dm = src.match(new RegExp(`const\\s+${expr}\\s*=\\s*([^;]+);`));
          if (dm) resolved = dm[1].trim();
        }
        const missing = expr === "" || /^null$/.test(expr) || /^undefined$/.test(expr);
        sites.push({
          file: rel(f), line: lineOf(src, m.index), fn, expr, resolved,
          clock: CLOCK.test(resolved), missing,
          unresolved: !missing && /^[A-Za-z_$][\w$]*$/.test(expr) && resolved === expr,
        });
      }
    }
  }
}

console.log(`\n«돈 원장의 멱등 키는 «뜻»에서 나온다» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — \`lib/coin-ledger.ts\` 에서 **ref 를 받는 함수** ${LEDGER_FNS.length}개(${LEDGER_FNS.join(" · ")}) 를 부르는 자리 **${sites.length}곳**`);
console.log("─".repeat(120));
if (LIST) for (const s of sites) console.log(`  ${s.clock ? "🔴시계" : s.missing ? "⊘없음" : s.unresolved ? "⊘못품" : "✅뜻"}  ${s.file}:${s.line} ${s.fn}  ref = ${s.resolved.slice(0, 70)}`);

const clockSites = sites.filter((s) => s.clock);
const meaning = sites.filter((s) => !s.clock && !s.missing && !s.unresolved);
const unknown = sites.filter((s) => s.missing || s.unresolved);

rec("🔴 멱등 키에 **시계·난수**가 섞이지 않았다", clockSites.length === 0,
  clockSites.length ? `시계에서 나오는 키 ${clockSites.length}곳 / 전체 ${sites.length}곳` : `전체 ${sites.length}곳 중 시계 0곳`);
for (const s of clockSites) {
  console.log(`   🔴 ${s.file}:${s.line}  ${s.fn}(…)`);
  console.log(`      ref = ${s.resolved.slice(0, 90)}`);
  console.log(`      ⇒ 같은 밀리초 안에 들어와야만 한 번이 된다. **사람 손가락은 그보다 느리다** — 두 번 누르면 두 줄이 박힌다(돈이다).`);
}
rec("대조군 — **뜻으로 만든 키도 실제로 있다**(이 자가 둘을 가른다)", meaning.length > 0,
  meaning.length ? `${meaning.length}곳 (예: ${meaning.slice(0, 3).map((s) => `${s.file}:${s.line}`).join(", ")})` : "🔴 하나도 없다 — 가른 적이 없다");
if (unknown.length) {
  console.log(`\n⊘ 못 쟀음 ${unknown.length}곳 — **통과가 아니다**(AC-9):`);
  for (const s of unknown) console.log(`   · ${s.file}:${s.line} ${s.fn}  ${s.missing ? "🔴 멱등 키를 아예 안 줬다(ref null) — 몇 번 불러도 막을 것이 없다" : `ref 가 «${s.expr}» 인데 어디서 오는지 못 따라갔다`}`);
}

/* ═══ ⓪ 자기 찌르기 — 🔴 «우는가»를 잰다(AC-108) ═══ */
{
  const judge = (list) => list.filter((s) => s.clock).length;
  rec("⓪a 자기 찌르기 — **뜻으로 바꾸면 그 빨강이 사라진다**(늘 빨간 자가 아니다)",
    judge(sites.map((s) => (s.clock ? { ...s, resolved: "`ops:${oid}:${id}:${coins}`", clock: false } : s))) < clockSites.length || clockSites.length === 0,
    `바꾼 뒤 ${judge(sites.map((s) => (s.clock ? { ...s, clock: false } : s)))}곳`);
  rec("⓪b 자기 찌르기 — **멀쩡한 키에 시계를 섞으면 운다**",
    judge(meaning.map((s) => ({ ...s, resolved: s.resolved + " + Date.now()", clock: CLOCK.test(s.resolved + " + Date.now()") }))) === meaning.length,
    `${meaning.length}곳 전부에 시계를 섞으면 ${judge(meaning.map((s) => ({ ...s, clock: CLOCK.test(s.resolved + " + Date.now()") })))}곳이 운다`);
  /* 🔴 **주석 속 `Date.now()` 를 세지 않는다**(AC-109 ①) — 이 자는 `codeOnly` 를 거치므로 원리상 안 세지만, 재 둔다. */
  const commentedProbe = codeOnly("const ref = `a:${b}`; /* 옛 코드: `ops:${oid}:${Date.now()}` */");
  rec("⓪c 자기 찌르기 — **주석 속 시계는 안 센다**(AC-109 ①)", !CLOCK.test(commentedProbe), `주석 걷은 뒤: «${commentedProbe.trim().slice(0, 40)}»`);
  rec("⓪d 자기 찌르기 — **키를 안 준 자리는 «통과»가 아니라 «못 쟀음»이다**(AC-9)", true,
    `지금 ⊘ ${unknown.length}곳 — 초록으로 세지 않는다`);
}

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length} · 원장 호출 ${sites.length}곳(시계 ${clockSites.length} · 뜻 ${meaning.length} · ⊘ ${unknown.length})`);
console.log("🔴 이 자는 **글자**만 본다 — «정말 두 번 눌러도 한 줄인가»는 DB 가 답한다(시나리오 B 가 왕복으로 쟀다).\n");
process.exit(fails.length ? 1 : 0);
