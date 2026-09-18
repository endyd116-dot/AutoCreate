/**
 * scripts/verify-audit-gap.mjs — 🔴 **«어떤 실패는 남기고 어떤 실패는 안 남긴다»**(C · 수리 라운드 2026-09-19 · B⑨).
 *   사용: node scripts/verify-audit-gap.mjs
 *         node scripts/verify-audit-gap.mjs --list   (본 함수를 전부 찍는다 — 모수를 보인다)
 *
 *   ══ 왜 이 자가 있나 ══
 *   2026-09-19 시나리오 B ⑱: **실패한 운영 로그인이 감사에 하나도 안 남는다.**
 *   없는 계정으로 세 번 두드려도 `audit_logs` 0행이고, DB 전체에 `ops_login_failed` 는 **0건**이다.
 *   ⇒ 누가 운영센터 문을 두드렸는지 **아무 기록이 없다.**
 *
 *   🔴 **그런데 같은 함수가 다른 실패는 남긴다** — `lib/auth-service.ts`:
 *     `:163` 잠김 → `writeAudit({ action: "ops_login_locked", riskLevel: "high" })` ✅
 *     `:170` 성공 → `writeAudit({ action: "ops_login" })` ✅
 *     `:155`·`:167` **비번·계정 틀림 → 아무것도 안 남긴다** ❌
 *   고객 쪽도 같은 모양이다(`:67`·`:78`).
 *   ⇒ 이건 «감사를 안 쓰기로 한 함수»가 아니다. **쓰는 함수인데 한 갈래만 빠졌다.**
 *
 *   ══ 무엇을 세는가 — 🔴 «보안 함수 목록» 같은 것을 안 만든다(AC-108) ══
 *   함수 몸통을 **중괄호 균형**으로 잘라, 그 안에서 **실패로 빠져나가는 자리**(`return { ok: false … }`)를 모으고
 *   각각 **바로 앞에 감사가 있나**를 본다. 그리고 **한 함수 안에서 갈린 것만** 빨강으로 센다:
 *     · 어떤 실패는 남기고(≥1) · 어떤 실패는 안 남긴다(≥1) → 🔴 **불일치**
 *     · 전부 남긴다 → ✅ · 전부 안 남긴다 → ⊘ **판정 안 함**(그 함수는 감사를 안 쓰기로 한 것일 수 있다)
 *   🔴 이렇게 하면 «어느 함수가 감사를 써야 하나»를 내가 정하지 않아도 된다 — **그 함수가 스스로 정해 놨다.**
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · «바로 앞»을 **글자 거리**(앞 400자)로 본다 — 멀리 떨어진 감사는 못 읽는다.
 *   · 감사를 **도우미 함수 안에서** 쓰면 못 본다(`writeAudit` 글자를 직접 찾는다).
 *   · «남겨야 옳은가»는 안 따진다 — **그 함수가 이미 남기고 있다**는 사실만 근거로 쓴다.
 *   · `throw` 로 빠져나가는 실패는 안 본다.
 *
 *   종료코드: 0 = 갈린 함수가 없다 · 1 = 있다 · 2 = 못 쟀다.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.AUDIT_GAP_ROOT ? path.resolve(process.env.AUDIT_GAP_ROOT) : path.resolve(import.meta.dirname, "..");
const DIRS = [path.join(ROOT, "lib"), path.join(ROOT, "netlify", "functions")];
const LIST = process.argv.includes("--list");
if (!DIRS.every(existsSync)) { console.error("⊘ 못 쟀어요 — lib/ 또는 netlify/functions/ 가 없습니다."); process.exit(2); }

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

/** 글자만 받아 재는 함수 — ⓪ 가 망가뜨린 글자를 먹일 수 있게 떼어 둔다(AC-34 · 잣대는 한 곳 · AC-109 ㉱). */
function scanSource(relPath, raw) {
  const src = codeOnly(raw);
  const fns = [];
  for (const m of src.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
    /* 🔴 **몸통의 `{` 는 «함수 이름 뒤 첫 `{`» 가 아니다** — 반환 타입이 중괄호를 갖고 있다:
         `function loginOperator(…): Promise<{ ok: true; op: OperatorRow } | { ok: false; … }> { …몸통… }`
       첫 판은 타입 안의 `{` 를 몸통 시작으로 보고 일찍 닫아 **`loginOperator` 를 통째로 놓쳤다**
       (고객 로그인만 잡고 **운영자 로그인은 못 잡았다** — 정작 시나리오가 지적한 쪽이 그쪽이다).
       ⇒ 인자 목록 `)` 를 먼저 닫고, 그 뒤 **꺾쇠 깊이가 0일 때** 나오는 첫 `{` 가 몸통이다. */
    let pi = m.index + m[0].length - 1, pd = 0, pEnd = -1;
    for (let i = pi; i < src.length; i++) {
      if (src[i] === "(") pd++;
      else if (src[i] === ")") { pd--; if (!pd) { pEnd = i; break; } }
    }
    if (pEnd < 0) continue;
    let open = -1, ad = 0;
    for (let i = pEnd + 1; i < src.length; i++) {
      const c = src[i];
      if (c === "<") ad++;
      else if (c === ">") { if (ad > 0) ad--; }
      else if (c === "{" && ad === 0) { open = i; break; }
      else if (c === ";" && ad === 0) break;               // 선언만 있고 몸통이 없다
    }
    if (open < 0) continue;
    let d = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "{") d++;
      else if (src[i] === "}") { d--; if (!d) { end = i; break; } }
    }
    if (end < 0) continue;
    const body = src.slice(open, end + 1);
    if (!body.includes("writeAudit")) continue;             // 감사를 아예 안 쓰는 함수는 볼 것 없다
    const exits = [];
    for (const r of body.matchAll(/return\s*\{\s*ok\s*:\s*false\b/g)) {
      const before = body.slice(Math.max(0, r.index - 400), r.index);
      exits.push({ line: lineOf(src, open + r.index), audited: before.includes("writeAudit") });
    }
    if (exits.length < 2) continue;                         // 갈릴 것이 없다
    /* 🔴 **«어느 함수를 재야 하나»를 내 목록으로 정하지 않는다 — 코드 자신의 어휘로 정한다.**
       첫 판은 «감사를 쓰면서 실패가 둘 이상»이면 전부 쟀더니 **아홉 중 일곱이 잡음**이었다:
       `publishInstagramFeed`·`publishToX`·`insertWordpressAdWidget` 처럼 **특별한 한 가지만** 남기고
       나머지 통신 오류는 그냥 돌려주는 것이 **정상**인 함수들이다(아홉 갈래 중 하나만 남긴다).
       ⇒ 판정은 **그 함수가 남기는 감사의 `action` 이름이 «인증»을 말할 때**로 좁힌다 —
          `login`·`auth`·`password`·`token`·`impersonat`. 🔴 이건 **리포가 스스로 붙인 이름**이지 내가 만든 목록이 아니다.
          나머지는 «△ 살펴볼 것»으로 찍는다(버리지 않는다). */
    const actions = [...body.matchAll(/action\s*:\s*["'`]([^"'`]+)["'`]/g)].map((a) => a[1]);
    const authish = actions.some((a) => /login|auth|password|token|impersonat/i.test(a));
    fns.push({ file: relPath, fn: m[1], line: lineOf(src, m.index), exits, actions: [...new Set(actions)], authish });
  }
  return fns;
}

const fns = [];
for (const d of DIRS) for (const f of walk(d)) fns.push(...scanSource(rel(f), readFileSync(f, "utf8")));

const isSplit = (f) => f.exits.some((e) => e.audited) && f.exits.some((e) => !e.audited);
const split = fns.filter((f) => isSplit(f) && f.authish);
const splitOther = fns.filter((f) => isSplit(f) && !f.authish);
const allAudited = fns.filter((f) => f.exits.every((e) => e.audited));
const noneAudited = fns.filter((f) => f.exits.every((e) => !e.audited));

console.log(`\n«어떤 실패는 남기고 어떤 실패는 안 남긴다» · ${new Date().toISOString()}`);
console.log(`■ 내가 세는 모수 — **감사를 쓰면서 실패 갈래가 둘 이상인 함수** ${fns.length}개`);
console.log(`   (전부 남김 ${allAudited.length} · 🔴 갈림 ${split.length} · ⊘ 전부 안 남김 ${noneAudited.length} — 마지막 것은 판정 안 함)`);
console.log("─".repeat(120));
if (LIST) for (const f of fns) console.log(`  ${f.exits.every((e) => e.audited) ? "✅전부" : f.exits.some((e) => e.audited) ? "🔴갈림" : "⊘전부안함"}  ${f.file}:${f.line} ${f.fn}()  실패 ${f.exits.length}갈래 중 남긴 것 ${f.exits.filter((e) => e.audited).length}`);

if (splitOther.length) {
  console.log(`
△ 살펴볼 것 — 감사 이름이 «인증»이 아닌 함수의 갈림(판정 밖 · **특별한 한 가지만 남기는 것이 정상**일 수 있다):`);
  for (const f of splitOther) console.log(`   · ${f.file}:${f.line} ${f.fn}()  실패 ${f.exits.length}갈래 중 남긴 것 ${f.exits.filter((e) => e.audited).length}  action[${f.actions.slice(0, 3).join(",")}]`);
  console.log("");
}
rec("🔴 **인증** 감사를 쓰는 함수가 어떤 실패만 골라 남기지 않는다", split.length === 0,
  split.length ? `갈린 함수 ${split.length}개 / 본 함수 ${fns.length}개` : `본 함수 ${fns.length}개 중 갈린 것 0개`);
for (const f of split) {
  const yes = f.exits.filter((e) => e.audited).map((e) => e.line);
  const no = f.exits.filter((e) => !e.audited).map((e) => e.line);
  console.log(`   🔴 ${f.file}:${f.line}  ${f.fn}()`);
  console.log(`      남기는 실패: ${yes.join("줄, ")}줄   ·   🔴 **안 남기는 실패: ${no.join("줄, ")}줄**`);
  console.log(`      ⇒ 이 함수는 **감사를 쓰기로 한 함수**다. 한 갈래만 빠진 것이니 «안 쓰기로 했다»가 아니다.`);
}
/* 🔴 대조군을 «전부 남기는 함수»로 잡았다가 **0개**라 자가 빨개졌다 — 이 리포엔 실패를 전부 남기는 함수가 없다.
   그건 제품이 틀린 게 아니라 **내 대조군이 틀린 것**이다. 이 자가 가르는 것은 «남겼나»가 아니라
   ①**인증이냐 아니냐** ②**갈렸나 아니냐** 둘이다. 그 둘이 실제로 갈리는지를 대조군으로 삼는다. */
rec("대조군 — **«인증 아닌 갈림»과 «전부 안 남김»이 실제로 갈린다**(이 자가 셋을 나눈다)",
  splitOther.length > 0 && noneAudited.length > 0,
  `인증 아닌 갈림 ${splitOther.length}개 · 전부 안 남김 ${noneAudited.length}개 · 인증 갈림 ${split.length}개`);
if (noneAudited.length) {
  console.log(`\n⊘ 판정 안 함 ${noneAudited.length}개 — 실패 갈래를 **하나도** 안 남기는 함수(그 함수는 감사를 안 쓰기로 한 것일 수 있다):`);
  for (const f of noneAudited.slice(0, 8)) console.log(`   · ${f.file}:${f.line} ${f.fn}()  실패 ${f.exits.length}갈래`);
  if (noneAudited.length > 8) console.log(`   · … 그 밖 ${noneAudited.length - 8}개`);
}

/* ═══ ⓪ 자기 찌르기 — 🔴 «우는가»를 잰다(AC-108) ═══
   🔴 **2026-09-19 · 제품 글자에서 떼어 냈다(AC-112 ⑥).**
   옛 판은 `lib/auth-service.ts` 의 줄을 닻으로 삼고 「**감사를 넣으면** 갈림이 줄어드나」로 찔렀다.
   그런데 B 가 그 셋을 다 닫자 **`baseSplit` 이 0** 이 되어 «0보다 작다»가 **구조적으로 불가능**해졌다 —
   자가 무력해서가 아니라 **줄일 것이 없어서** 못 도는 변이다(«고치는 변이»는 한 번 쓰고 죽는다).
   ⇒ 이제 **내가 지어 넣은 글자**에 찌른다. 제품이 어떻게 바뀌어도 이 변이는 **영원히 돈다.**
   방향도 뒤집었다 — «**갈림을 심으면 보나**». */
{
  const mk = (a1, a2) => [
    "export async function probeLoginXx(p: string): Promise<{ ok: true } | { ok: false; reason: string }> {",
    `  if (!p) { ${a1} return { ok: false, reason: "invalid" }; }`,
    `  if (p === "x") { ${a2} return { ok: false, reason: "locked" }; }`,
    '  await writeAudit({ tenantId: null, action: "probe_login" });',
    "  return { ok: true };",
    "}",
  ].join(String.fromCharCode(10));
  const AUD = (n) => `await writeAudit({ tenantId: null, action: "probe_login_${n}" });`;
  const splitOf = (src) => scanSource("lib/__probe__.ts", src).filter((f) => f.authish && f.exits.some((e) => e.audited) && f.exits.some((e) => !e.audited)).length;
  const noneOf = (src) => scanSource("lib/__probe__.ts", src).filter((f) => f.exits.length >= 2 && f.exits.every((e) => !e.audited)).length;

  /* ⓪a 🔴 **갈림을 심으면 본다** — 한 갈래만 감사를 뺀다. */
  rec("⓪a 자기 찌르기 — 🔴 **갈림을 심으면 잡는다**(고쳐진 뒤에도 도는 변이 · AC-112 ⑥)",
    splitOf(mk("", AUD("locked"))) === 1 && splitOf(mk(AUD("failed"), AUD("locked"))) === 0,
    `한 갈래만 빼면 ${splitOf(mk("", AUD("locked")))}개 · 둘 다 남기면 ${splitOf(mk(AUD("failed"), AUD("locked")))}개`);

  /* ⓪b 🔴 **전부 빼면 «갈림»이 아니라 «전부 안 남김»(⊘)** — 이 자는 «갈렸나»를 보지 «감사가 있나»를 보지 않는다. */
  const allGone = mk("", "").replace('await writeAudit({ tenantId: null, action: "probe_login" });', "");
  rec("⓪b 자기 찌르기 — **전부 빼면 «갈림»이 아니라 «전부 안 남김»(⊘)이 된다**(이 자는 «갈렸나»를 본다)",
    splitOf(allGone) === 0 && noneOf(mk("", "")) === 1,
    `전부 빼면 갈림 ${splitOf(allGone)}개 · 실패만 빼면 ⊘ ${noneOf(mk("", ""))}개`);

  /* ⓪c 🔴 **주석 속 감사는 «남겼다»로 안 센다**(AC-109 ①). */
  rec("⓪c 자기 찌르기 — **주석 속 감사는 «남겼다»로 안 센다**(AC-109 ①)",
    splitOf(mk(`/* ${AUD("failed")} */`, AUD("locked"))) === 1,
    `주석으로만 남기니 갈림 ${splitOf(mk(`/* ${AUD("failed")} */`, AUD("locked")))}개(코드로 세면 0이 나온다)`);

  /* ⓪d 🔴 **«인증»이 아닌 감사 이름이면 판정 밖이다**(거짓 빨강 방지 — 발행 함수가 특별한 하나만 남기는 것은 정상). */
  const notAuth = mk("", 'await writeAudit({ tenantId: null, action: "publish_queued" });').replace('action: "probe_login"', 'action: "publish_done"');
  rec("⓪d 자기 찌르기 — **감사 이름이 «인증»이 아니면 판정 밖**(거짓 빨강 방지)", splitOf(notAuth) === 0,
    `인증 아닌 이름으로 바꾸면 판정 대상 ${splitOf(notAuth)}개`);
}

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length} · 본 함수 ${fns.length}개(갈림 ${split.length} · 전부남김 ${allAudited.length} · ⊘ ${noneAudited.length})`);
console.log("🔴 이 자는 «그 함수가 이미 남기고 있나»만 근거로 쓴다 — «남겨야 옳은가»는 안 따진다(머리말).\n");
process.exit(fails.length ? 1 : 0);
