/**
 * scripts/verify-server-time.mjs — 🔴 **«서버가 DB 시각을 제 시간대로 읽는다»**(C · 수리 라운드 2026-09-19).
 *   사용: node scripts/verify-server-time.mjs
 *         node scripts/verify-server-time.mjs --list   (본 자리를 전부 찍는다 · 안전한 것 포함)
 *
 *   ══ 왜 이 자가 있나 — 라이브가 «우연히» 안전하다 ══
 *   2026-09-19 시나리오 A 가 로그인을 다섯 번 틀려 잠근 뒤 **여섯 번째에 그냥 들어가졌다.**
 *   같은 순간·같은 계정·같은 DB 인데 **프로세스 시간대만** 바꾸니 판정이 갈렸다:
 *     `TZ=UTC`(= Netlify 함수 기본) → «여러 번 실패해서 15분 잠겼어요» ✅ 잠긴다
 *     `TZ=Asia/Seoul`(내 PC)        → `{"ok":true}` 🔴 **열린다**
 *   원인 — `lib/auth-service.ts:68`
 *     `if (user.locked_until && new Date(user.locked_until) > new Date()) …`
 *   `locked_until` 은 `timestamp without time zone` 이고 **UTC 로 저장**돼 있는데, postgres.js 는 그 값을
 *   **프로세스 지역시**로 읽는다. ⇒ KST 프로세스에선 9시간 과거로 읽혀 **잠금(15분)이 시차(9시간)보다 짧으니 언제나 «안 잠김»**.
 *
 *   🔴 **지금 라이브는 안전하다. 문제는 그게 우연이라는 것이다** — 코드가 «UTC 로 돌아 주기»에 기대고 있고
 *   아무도 그렇게 적어 두지 않았다. CLAUDE §4.5b 가 금지한 자리이고, `lib/db-util.ts utcDate()` 가 이미 있다.
 *
 *   ══ 무엇을 세는가 — 🔴 한 건이 아니라 **축**이다 ══
 *   `lib/**` · `netlify/functions/**` 에서 **DB 시각 칸**(snake_case 이름이 `_at`·`_until`·`_for`·`_date`·`_ends` 로 끝남)을
 *   `new Date(…)` / `Date.parse(…)` 에 **그대로** 넣는 자리를 폴더째 찾는다. 다음 중 하나면 **안전**으로 센다:
 *     ① `utcDate(…)` 를 거친다(정본 · `lib/db-util.ts`)   ② 뒤에 `Z` 를 붙여 UTC 로 못 박는다   ③ 이미 `Z`·오프셋이 붙은 값이다
 *   셋 다 아니면 **빨강** — 그 자리는 «서버가 어느 시간대로 도는가»에 판정이 매달려 있다.
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · 칸 이름이 시각처럼 안 생겼으면(`ts`·`when`) 못 본다. 이 리포의 관례는 `_at` 계열이다.
 *   · `timestamptz` 칸(드라이버가 바르게 읽는다)과 `timestamp` 칸을 **글자로는 못 가른다** —
 *     그래서 `Z` 를 붙인 자리도 «안전»으로 센다(붙이면 어느 쪽이든 UTC 로 고정된다).
 *   · 화면 쪽(`toLocale*`·`datetime-local`)은 `verify-kst-surface.mjs` 몫이다. 여기는 **서버**만 본다.
 *
 *   종료코드: 0 = 시간대에 안 매달린다 · 1 = 매달린 자리가 있다 · 2 = 못 쟀다.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.env.SERVER_TIME_ROOT ? path.resolve(process.env.SERVER_TIME_ROOT) : path.resolve(import.meta.dirname, "..");
const LIST = process.argv.includes("--list");
const DIRS = [path.join(ROOT, "lib"), path.join(ROOT, "netlify", "functions")];
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

/** DB 시각 칸처럼 생긴 이름. 🔴 정본은 `lib/db-util.ts utcDate()` — 이 자는 «그걸 거쳤나»를 본다. */
const TIME_COL = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)*_(?:at|until|for|date|ends)\b/;
/** 그 자리가 UTC 로 못 박혔나 — `Z` 를 붙였거나 `utcDate()` 를 거쳤거나. */
const PINNED = /utcDate\s*\(|["'`]Z["'`]|Z`|\+\s*["'`]Z/;

/** 소스 글자만 받아 재는 함수 — ⓪ 가 **망가뜨린 글자**를 먹일 수 있게 떼어 둔다(진짜 소스 무접촉 · AC-34). */
function scanSource(relPath, raw) {
  const src = codeOnly(raw);
  const found = [];
  for (const m of src.matchAll(/\b(?:new\s+Date|Date\.parse)\s*\(/g)) {
    /* 괄호 균형으로 인자를 잘라 온다. */
    const open = m.index + m[0].length - 1;
    let d = 0, end = -1;
    for (let i = open; i < src.length; i++) {
      if (src[i] === "(") d++;
      else if (src[i] === ")") { d--; if (!d) { end = i; break; } }
    }
    if (end < 0) continue;
    const arg = src.slice(open + 1, end);
    if (!TIME_COL.test(arg)) continue;                 // DB 시각 칸이 아니면 볼 것 없다
    found.push({ file: relPath, line: lineOf(src, m.index), arg: arg.replace(/\s+/g, " ").trim().slice(0, 80), safe: PINNED.test(arg) });
  }
  return found;
}

const sites = [];
for (const d of DIRS) for (const f of walk(d)) sites.push(...scanSource(rel(f), readFileSync(f, "utf8")));
const unsafe = sites.filter((s) => !s.safe);
const safe = sites.filter((s) => s.safe);

console.log(`\n«서버가 DB 시각을 제 시간대로 읽는다» — 시간대에 매달린 판정 찾기 · ${new Date().toISOString()}`);
console.log(`DB 시각 칸을 Date 로 넘기는 자리 ${sites.length}곳(폴더에서 스스로 찾았다 · 손 목록 0)`);
console.log("─".repeat(120));
if (LIST) for (const s of sites) console.log(`  ${s.safe ? "안전" : "🔴위험"}  ${s.file}:${s.line}  ${s.arg}`);

rec("🔴 DB 시각 칸을 **UTC 로 못 박고** 읽는다(`utcDate()` 또는 `Z`)", unsafe.length === 0,
  unsafe.length ? `시간대에 매달린 자리 ${unsafe.length}곳 / 전체 ${sites.length}곳` : `${sites.length}곳 전부 못 박혀 있다`);
for (const s of unsafe) {
  console.log(`   🔴 ${s.file}:${s.line}`);
  console.log(`      new Date(${s.arg})`);
  console.log(`      ⇒ 프로세스가 UTC 로 돌면 맞고, KST 로 돌면 **9시간 어긋난다**. 지금 라이브가 맞는 것은 **우연**이다.`);
}
rec("대조군 — **못 박힌 자리도 실제로 있다**(이 자가 둘을 가른다)", safe.length > 0,
  safe.length ? `못 박은 자리 ${safe.length}곳 (예: ${safe.slice(0, 3).map((s) => `${s.file}:${s.line}`).join(", ")})` : "🔴 하나도 없다 — 가른 적이 없다");

/* ═══ ⓪ 자기 찌르기 — 🔴 «우는가»를 잰다(AC-108) ═══ */
{
  /* ⓪a **이 병이 진짜로 무는가** — 같은 글자를 두 시간대에서 읽어 본다.
     🔴 이게 없으면 이 자는 «규약을 어겼다»만 말하고 «그래서 뭐가 틀어지나»는 못 말한다. */
  const probe = 'const s="2026-09-18 18:48:08"; process.stdout.write(String(new Date(s).getTime()));';
  const at = (tz) => Number(execFileSync(process.execPath, ["-e", probe], { env: { ...process.env, TZ: tz }, encoding: "utf8" }));
  let utc = 0, kst = 0, ranTz = true;
  try { utc = at("UTC"); kst = at("Asia/Seoul"); } catch { ranTz = false; }
  const gapH = ranTz ? Math.round((utc - kst) / 3_600_000) : 0;
  rec("⓪a 자기 찌르기 — 같은 글자를 **두 시간대에서 읽으면 실제로 어긋난다**(이 병이 무는 병이다)",
    ranTz && gapH === 9, ranTz ? `UTC ↔ Asia/Seoul 차이 ${gapH}시간 (잠금 15분보다 훨씬 크다)` : "⊘ TZ 를 바꿔 못 띄웠다");

  /* ⓪b **고치면 빨강이 사라진다** — 위험한 자리에 `utcDate()` 를 씌워 본다. */
  const authRaw = readFileSync(path.join(ROOT, "lib", "auth-service.ts"), "utf8");
  const fixed = authRaw.replace("new Date(user.locked_until)", "utcDate(user.locked_until)");
  const fixedUnsafe = scanSource("lib/auth-service.ts", fixed).filter((s) => !s.safe);
  const beforeUnsafe = scanSource("lib/auth-service.ts", authRaw).filter((s) => !s.safe);
  rec("⓪b 자기 찌르기 — **`utcDate()` 를 씌우면 그 빨강이 사라진다**(늘 빨간 자가 아니다)",
    fixed !== authRaw && fixedUnsafe.length < beforeUnsafe.length,
    fixed === authRaw ? "🔴 닻을 못 찾았다 — 이 변이표가 낡았다" : `고치기 전 ${beforeUnsafe.length}곳 → 고친 뒤 ${fixedUnsafe.length}곳`);

  /* ⓪c **못 박힌 자리의 `Z` 를 떼면 운다** — 안전으로 세던 자리가 위험으로 넘어와야 한다. */
  const teamRaw = readFileSync(path.join(ROOT, "lib", "team.ts"), "utf8");
  const stripped = teamRaw.replace(/new Date\(`\$\{String\(r\.expires_at\)\}Z`\)/g, "new Date(String(r.expires_at))");
  const strippedUnsafe = scanSource("lib/team.ts", stripped).filter((s) => !s.safe);
  rec("⓪c 자기 찌르기 — **못 박은 `Z` 를 떼면 운다**(안전/위험을 글자로 제대로 가른다)",
    stripped !== teamRaw && strippedUnsafe.length > 0,
    stripped === teamRaw ? "🔴 닻을 못 찾았다" : `Z 를 떼니 위험 ${strippedUnsafe.length}곳이 됐다`);

  /* ⓪d 🔴 **주석 속 코드를 세지 않는다**(AC-109 ①). */
  const commented = authRaw.replace("if (user.locked_until && new Date(user.locked_until) > new Date())",
    "/* 옛 코드: if (user.locked_until && new Date(user.locked_until) > new Date()) */ if (false)");
  const commentedUnsafe = scanSource("lib/auth-service.ts", commented).filter((s) => !s.safe);
  rec("⓪d 자기 찌르기 — **주석 속 `new Date(locked_until)` 은 안 센다**(AC-109 ①)",
    commented !== authRaw && commentedUnsafe.length < beforeUnsafe.length,
    commented === authRaw ? "🔴 닻을 못 찾았다" : `주석으로 감싸니 ${beforeUnsafe.length} → ${commentedUnsafe.length}곳`);
}

console.log("─".repeat(120));
const fails = out.filter((o) => !o.ok);
console.log(`PASS ${out.length - fails.length} · FAIL ${fails.length} · 본 자리 ${sites.length}곳(위험 ${unsafe.length} · 안전 ${safe.length})`);
console.log("🔴 이 자는 **서버**만 본다 — 화면 쪽 KST 는 `verify-kst-surface.mjs` 몫이다.\n");
process.exit(fails.length ? 1 : 0);
