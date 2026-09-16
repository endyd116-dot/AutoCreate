/**
 * scripts/verify-deadends-meter.mjs — 🔴 **자를 재는 자**(C · R11-13 · 2026-09-17).
 *   사용: node scripts/verify-deadends-meter.mjs [--json] [--only=<심볼>] [--keep]
 *   종료코드: 0 통과 · 1 «거저 초록»을 찾음 · 2 못 쟀음(사본이 원본과 다르다 등)
 *
 *   ══ 왜 ══
 *   `verify-r8-deadends.mjs` 는 이 라운드의 **양심**이다 — A·B·B2 가 전부 «만들면 여기 줄을 박아라»로 일한다.
 *   🔴 **이 자가 속으면 이 라운드의 «배선했습니다» 전부가 빈말**이 된다.
 *   b-49 가 셈법을 찔러 «어떤 모양이 통과하나»를 가렸고(2026-09-16), **한 가지를 못 했다고 적었다**:
 *     > «`TARGETS` 68줄 중 **걸린 4줄만 직접 돌렸다.** 나머지 64줄은 «돌려서» 확인 안 했다 —
 *     >  내 분류기가 두 줄을 틀렸으니 **같은 오차가 있을 수 있다.** «64줄은 깨끗하다»고 말하지 않는다.»
 *   ⇒ 🔴 **이 파일이 그 64줄을 돌린다.** 물음은 하나다: «**그 줄이 가리키는 진짜 소비처를 다 가렸을 때, 여전히 초록인가?**»
 *
 *   ══ 어떻게 ══
 *   제품도 하니스도 **한 글자도 안 고친다.** 스크래치에 하니스 **사본**을 만들고 `read()` 한 줄에만
 *   `AC_HIDE`(가릴 파일 목록)·`AC_DUMP`(TARGETS 를 그대로 뱉기)를 끼운다.
 *   🔴 **사본이 원판과 같은 판정을 내는지 먼저 확인한다** — 그 확인이 없으면 잰 것은 자가 아니라 내 사본이다(b-49 규율).
 *   🔴 **목록은 하니스가 세는 그 규칙으로 뽑는다**(AC-97) — 손으로 옮겨 적지 않고 `AC_DUMP` 로 받아 온다.
 *
 *   ══ 세 갈래로 판정한다 ══
 *     ① **거저 초록**  — 진짜 소비처(호출 모양)를 다 가려도 **여전히 초록**. `place` 가 그 상태였다.
 *     ② **적는 곳만**  — 바깥이 0곳이고 **자기 파일(적는 쪽)만으로 초록**(`heroNeeded` 가 그 모양이었다).
 *     ③ **떠받치는 게 하나뿐** — 가리면 빨개지는 파일이 **딱 하나**. 그 파일이 지워지는 날 조용히 빨개진다(정보).
 *   🔴 «호출 모양»의 분류기는 틀릴 수 있다 — 그래서 **분류만 하지 않고 실제로 가려서 돌린다.**
 *      분류가 틀리면 결과가 이상하게 나오지 조용히 넘어가지 않는다(b-49 의 분류기가 두 줄을 틀렸던 그 자리).
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);
const JSON_OUT = ARGS.includes("--json");
const KEEP = ARGS.includes("--keep");
const ONLY = (ARGS.find((a) => a.startsWith("--only=")) || "").split("=")[1] || "";

const SELFTEST = ARGS.includes("--selftest");
/* 🔴 `AC_HARNESS` = 잴 하니스를 갈아 끼우는 자리. `--selftest` 가 **일부러 망가뜨린 하니스**를 여기로 물린다. */
const HARNESS = process.env.AC_HARNESS || join(ROOT, "scripts", "verify-r8-deadends.mjs");
const SCRATCH = process.env.CLAUDE_SCRATCHPAD || join(tmpdir(), "ac-c-meter");
const WORK = join(SCRATCH, "deadends-meter");
const COPY = join(WORK, "deadends-copy.mjs");

/* ═══ 사본 만들기 — `read()` 한 줄에만 끼운다 ═══ */
const READ_ORIG = 'const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return ""; } };';
const READ_NEW = [
  'const AC_HIDE = new Set(String(process.env.AC_HIDE || "").split("|").filter(Boolean));',
  'const read = (p) => { if (AC_HIDE.has(p)) return ""; try { return readFileSync(p, "utf8"); } catch { return ""; } };',
].join("\n");
const LOOP_ORIG = "for (const [label, sym, owner, harm, mode] of TARGETS) {";
const LOOP_NEW = [
  'if (process.env.AC_DUMP) { console.log(JSON.stringify(TARGETS)); process.exit(0); }',
  LOOP_ORIG,
].join("\n");

function makeCopy() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  let src = readFileSync(HARNESS, "utf8");
  for (const [a, b] of [[READ_ORIG, READ_NEW], [LOOP_ORIG, LOOP_NEW]]) {
    const hits = src.split(a).length - 1;
    if (hits !== 1) return { ok: false, why: `앵커가 ${hits}곳이다(1곳이어야 한다): ${a.slice(0, 48)}…` };
    src = src.split(a).join(b);
  }
  writeFileSync(COPY, src, "utf8");
  return { ok: true };
}

/** 하니스를 돌려 JSON 판정을 받는다. `file` 은 원판(HARNESS) 또는 사본(COPY). */
function run(file, hide = []) {
  const r = spawnSync(process.execPath, [file, "--json"], {
    cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 120_000,
    env: { ...process.env, AC_HIDE: hide.join("|"), AC_DUMP: "" },
  });
  try { return JSON.parse(String(r.stdout || "")).results; } catch { return null; }
}
function dumpTargets() {
  const r = spawnSync(process.execPath, [COPY], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, AC_DUMP: "1", AC_HIDE: "" } });
  try { return JSON.parse(String(r.stdout || "")); } catch { return null; }
}

/* ═══ «호출 모양»인가 — 분류기(틀릴 수 있다. 그래서 돌려서 확인한다) ═══
   문자열·주석은 하니스가 이미 걷지 **않는다**(그게 b-49 가 찾은 구멍이다) — 여기선 우리가 걷고 본다. */
function stripStringsAndComments(text) {
  let s = text
    .replace(/[/][*][\s\S]*?[*][/]/g, " ")
    .replace(/(^|[^:])[/][/].*/g, "$1 ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  // 템플릿 리터럴은 `${...}` **안**이 코드다 — 바깥 글자만 지운다.
  s = s.replace(/`(?:[^`\\]|\\.)*`/g, (m) => (m.match(/[$][{][^}]*[}]/g) || []).join(" "));
  s = s.replace(/"(?:[^"\\\n]|\\.)*"/g, " ").replace(/'(?:[^'\\\n]|\\.)*'/g, " ");
  return s;
}
/** 이 줄이 «그 이름을 실제로 쓰는» 모양인가(호출·속성 읽기·구조분해·임포트). */
function isStrongLine(line, sym) {
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const re of [
    new RegExp(`${esc}\\s*[(]`),          // 부른다
    new RegExp(`[.]\\s*${esc}\\b`),       // 속성으로 읽는다
    new RegExp(`\\b${esc}\\s*[:,}]`),     // 객체 키 · 구조분해
    new RegExp(`\\b${esc}\\s*=`),         // 대입
    new RegExp(`<\\s*${esc}\\b`),         // 타입 인자
    new RegExp(`\\b${esc}\\s*[?&|)\\]]`), // 조건·인자 끝
  ]) if (re.test(line)) return true;
  return false;
}
/** 🔴 심볼이 **식별자가 아니면**(잡 kind `reference.capture` · 타입 조각 `place?: { name` 처럼)
 *  그 이름은 **원래 문자열 안에 산다.** 그때 문자열을 걷으면 진짜 배선을 «산문»으로 오판한다.
 *  ⚠️ b-49 가 `SURFACES` 에 대해 적은 것과 같은 말이다 — «거긴 일부러 문자열을 찾는 자리다. 두 셈법을 가른 채로 둬라.»
 *     2026-09-17 C: 이 가름을 안 넣었더니 `reference.capture` 가 «거저 초록»으로 **거짓 빨강**이 났다(돌려서 잡았다). */
const isIdent = (sym) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(sym);
/** 파일이 그 심볼을 «쓰는» 곳인가 — 식별자면 문자열·주석을 걷고, 아니면 본문 그대로 본다. */
function classify(file, sym) {
  let text = "";
  try { text = readFileSync(join(ROOT, file), "utf8"); } catch { return "weak"; }
  if (!isIdent(sym)) {
    // 주석만 걷는다(주석에 적힌 것은 «한다»가 아니다 · AC-59). 문자열은 남긴다 — 거기가 배선이다.
    const c = text.replace(/[/][*][\s\S]*?[*][/]/g, " ").replace(/(^|[^:])[/][/].*/g, "$1 ").replace(/<!--[\s\S]*?-->/g, " ");
    return c.includes(sym) ? "strong" : "gone";
  }
  const code = stripStringsAndComments(text);
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = new RegExp(`(^|[^A-Za-z0-9_$])${esc}`);
  const lines = code.split("\n").filter((l) => word.test(l));
  if (!lines.length) return "gone";                         // 문자열·주석을 걷으면 사라진다 = 산문·URL·CSS
  return lines.some((l) => isStrongLine(l, sym)) ? "strong" : "weak";
}

/* ═══ 🔴 음성 대조 — **이 자가 «거저 초록»을 정말 잡나** ═══
   «0건»은 «다 깨끗하다»일 수도 있고 **«이 자가 아무것도 안 본다»**일 수도 있다(AC-99 ⑨ · AC-100 ⑦).
   ⇒ 메인이 2026-09-16 에 고친 `place` 줄을 **옛 심볼로 되돌린 하니스**를 만들어 물리고, 이 자가 빨개지는지 본다.
      옛 `place` 는 b-49 가 «진짜 소비처를 다 가려도 바깥 12곳으로 초록»이라고 실측한 바로 그 줄이다. */
function selftest() {
  /* 🔴 `WORK` 밖에 둔다 — 자식이 `makeCopy()` 에서 `WORK` 를 통째로 지운다(자기가 물린 하니스를 스스로 지웠다 · 2026-09-17 C). */
  const DIR = join(SCRATCH, "deadends-meter-selftest");
  mkdirSync(DIR, { recursive: true });
  const a = '"place?: { name", "lib/blocks.ts"';
  const b = '"place", "lib/blocks.ts"';
  /** 하니스 소스에 옛 `place` 심볼을 되심고, 그 하니스를 물려 이 자를 돌린다. */
  const probe = (name, src) => {
    if (src.split(a).length - 1 !== 1) return { why: `음성 대조를 심을 자리를 못 찾았다(${a})` };
    const f = join(DIR, `${name}.mjs`);
    writeFileSync(f, src.split(a).join(b), "utf8");
    const r = spawnSync(process.execPath, [join(ROOT, "scripts", "verify-deadends-meter.mjs")], {
      cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600_000,
      env: { ...process.env, AC_HARNESS: f },
    });
    rmSync(f, { force: true });
    return { txt: String(r.stdout || "") + String(r.stderr || "") };
  };

  /* ① 🔴 **고치기 전 하니스**(베이스 커밋의 것)에 옛 `place` 를 되심는다 — b-49 가 «바깥 12곳으로 초록»이라 실측한 그 판.
        여기서 «거저 초록»이 안 뜨면 **이 자가 아무것도 안 보는 것**이다. */
  let beforeSrc = "";
  try { beforeSrc = String(spawnSync("git", ["show", `${process.env.AC_BASE || "9d81a2b"}:scripts/verify-r8-deadends.mjs`], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).stdout || ""); } catch { /* 아래에서 처리 */ }
  const NL0 = String.fromCharCode(10);
  console.log(NL0 + "═══ 음성 대조 — 옛 `place` 심볼을 되심고 두 판을 맞댄다 ═══");
  if (!beforeSrc.trim()) { console.log("⊘ 못 쟀음 — 베이스 커밋의 하니스를 못 꺼냈다"); process.exit(2); }
  const before = probe("harness-before", beforeSrc);
  if (before.why) { console.log(`⊘ 못 쟀음 — ${before.why}`); process.exit(2); }
  const sawBefore = /^✗ place[^A-Za-z0-9_]/m.test(before.txt);
  console.log(`${sawBefore ? "✓" : "🔴"} 고치기 전 하니스(${(process.env.AC_BASE || "9d81a2b")}) + 옛 \`place\` → ${sawBefore ? "«거저 초록»으로 잡는다" : "**못 잡았다 — 이 자의 초록을 믿지 마라**"}`);
  if (sawBefore) console.log(`    ${(before.txt.split(NL0).find((l) => l.trim().startsWith("✗ place")) || "").trim().slice(0, 150)}`);

  /* ② **고친 뒤 하니스**(지금 워킹트리)에 같은 옛 심볼을 되심는다 — ③(문자열 리터럴 제외)이 그 길을 막았으면 더는 «거저 초록»이 아니다. */
  const after = probe("harness-after", readFileSync(join(ROOT, "scripts", "verify-r8-deadends.mjs"), "utf8"));
  if (after.why) { console.log(`⊘ 못 쟀음 — ${after.why}`); process.exit(2); }
  const sawAfter = /^✗ place[^A-Za-z0-9_]/m.test(after.txt);
  const afterLine = (after.txt.split(NL0).find((l) => l.trim().startsWith("△ place") || l.trim().startsWith("✗ place")) || "").trim();
  console.log(`${sawAfter ? "🔴" : "✓"} 고친 뒤 하니스 + 같은 옛 \`place\` → ${sawAfter ? "**아직도 «거저 초록»이다 — ③ 이 그 길을 못 막았다**" : "더는 «거저 초록»이 아니다(③ 문자열 리터럴 제외가 그 길을 막았다)"}`);
  if (afterLine) console.log(`    ${afterLine.slice(0, 150)}`);

  console.log(sawBefore && !sawAfter
    ? "⇒ 🔴 **이 자는 «거저 초록»을 잡고, ③ 은 그 길을 실제로 막았다.** «거저 초록 0건»은 «안 본다»가 아니다."
    : "⇒ 🔴 **둘 중 하나가 어긋났다 — 이 자의 초록도 ③ 의 효과도 믿지 마라.**");
  process.exit(sawBefore && !sawAfter ? 0 : 1);
}
const rows = [];
function main() {
  if (SELFTEST) return selftest();
  const mk = makeCopy();
  if (!mk.ok) { console.log(`⊘ 못 쟀음 — 사본을 못 만들었다: ${mk.why}`); process.exit(2); }

  /* 🔴 사본 ≡ 원판 확인 — 이게 없으면 잰 것은 자가 아니라 내 사본이다. */
  const orig = run(HARNESS), copy = run(COPY);
  if (!orig || !copy) { console.log("⊘ 못 쟀음 — 하니스가 JSON 을 안 냈다"); process.exit(2); }
  const same = orig.length === copy.length && orig.every((r, i) => r.step === copy[i].step && r.ok === copy[i].ok && r.note === copy[i].note);
  if (!same) {
    console.log(`⊘ 못 쟀음 — 사본이 원판과 다른 판정을 낸다(원판 ${orig.length}줄 · 사본 ${copy.length}줄). 사본으로 잰 값은 자를 잰 게 아니다.`);
    process.exit(2);
  }
  console.log(`사본 ≡ 원판 확인 — ${orig.length}줄 · note 까지 글자 그대로 같다`);

  const targets = dumpTargets();
  if (!targets) { console.log("⊘ 못 쟀음 — TARGETS 를 못 받았다"); process.exit(2); }
  console.log(`TARGETS ${targets.length}줄 — 하니스가 세는 그 목록 그대로 받았다(AC-97: 대용물로 뽑지 않는다)\n`);

  const byStep = new Map(orig.map((r) => [r.step, r]));
  /* 🔴 다른 줄의 정본 파일도 가린다 — 그 줄은 WARN 이 되지만 **지금 보는 줄**의 판정은 안 흔든다. */

  for (const [label, sym, owner, , mode] of targets) {
    if (ONLY && sym !== ONLY) continue;
    const step = `🔴 죽은 통로 — ${label}(\`${sym}\`) 을 **제품이 부른다**`;
    const r = byStep.get(step);
    if (!r) { rows.push({ sym, label, verdict: "⊘", note: "이 줄의 판정을 못 찾았다(하니스가 바뀌었나)" }); continue; }
    if (r.ok !== true) { rows.push({ sym, label, verdict: "—", note: `이미 초록이 아니다(${r.ok === "WARN" ? "WARN" : "FAIL"})` }); continue; }

    const parse = (note) => {
      const m = String(note).match(/바깥 (\d+)곳(?: \[([^\]]*)\])? · 자기 파일 (\d+)곳/);
      return { files: m && m[2] ? m[2].split(" · ").map((x) => x.replace(/\(\d+\)$/, "")) : [], own: m ? Number(m[3]) : 0 };
    };
    const { files: outside, own } = parse(r.note);

    /* 바깥 파일을 «쓰는 곳(strong)»과 «아닌 곳(weak: 문자열·산문·다른 뜻)»으로 가른다.
       🔴 분류기는 틀릴 수 있다 — 그래서 분류로 **판정하지 않고**, 분류한 것을 **가려서 실제로 돌린다.**
       판정은 돌린 뒤의 «바깥이 몇 곳 남았나»로 한다(하니스 자신의 셈). */
    const strong = [], weak = [];
    for (const f of outside) (classify(f, sym) === "strong" ? strong : weak).push(f);

    const after = strong.length ? run(COPY, strong) : orig;
    const r2 = after ? after.find((x) => x.step === step) : null;
    if (!r2) { rows.push({ sym, label, verdict: "⊘", kind: "unknown", note: "가리고 돌렸는데 판정을 못 읽었다" }); continue; }
    const post = parse(r2.note);

    let verdict, kind, note;
    if (r2.ok !== true) {
      /* 🔴 쓰는 곳을 가리니 빨개졌다 = **이 줄은 진짜로 그 배선을 재고 있다.** */
      verdict = "산 줄"; kind = "alive";
      note = `쓰는 곳 ${strong.length}개를 가리니 빨개진다 [${strong.join(" · ")}]${weak.length ? ` · 안 센 곳 ${weak.length}: ${weak.join(" · ")}` : ""}`;
    } else if (post.files.length > 0) {
      /* 🔴 쓰는 곳을 다 가렸는데 **바깥이 아직 남아 초록** = 거저 초록(`place` 가 그 상태였다). */
      verdict = "🔴 거저 초록"; kind = "free-green";
      note = `쓰는 곳 ${strong.length}개를 다 가려도 **바깥 ${post.files.length}곳으로 초록** — 떠받치는 것: ${post.files.join(" · ")}`;
    } else if (post.own > 0) {
      /* 자기 파일이 떠받친다. 하니스가 **일부러 그렇게 센다**(2026-09-15 C 수리: «자기 파일 안에서만 불리는» 함수의 가짜 빨강을 없앴다).
         🔴 그래도 값은 있다 — 바깥 소비처가 내일 통째로 지워져도 이 줄은 안 빨개진다. 빨강으로는 안 세고 **적어 둔다**. */
      verdict = "자기 파일만"; kind = "own-only";
      note = `쓰는 곳 ${strong.length}개를 다 가려도 **자기 파일 ${post.own}곳으로 초록** — 바깥이 다 지워져도 이 줄은 안 빨개진다`
        + (mode === "external" ? " ⚠️ external 인데 자기 파일로 초록이면 하니스를 봐라" : "");
    } else { verdict = "⊘"; kind = "unknown"; note = `초록인데 바깥도 자기 파일도 0이다(하니스를 봐라) · note=${String(r2.note).slice(0, 80)}`; }

    /* 떠받치는 게 하나뿐인 줄은 따로 적는다(정보 — 그 파일이 바뀌는 날 조용히 빨개진다) */
    const sole = kind === "alive" && outside.length === 1 && own === 0;
    if (sole) note += " · 🔸 떠받치는 파일이 하나뿐";
    rows.push({ sym, label, verdict, kind, sole, outside, strong, weak, note });
  }

  if (!KEEP) try { rmSync(WORK, { recursive: true, force: true }); } catch { /* 무시 */ }

  const free = rows.filter((r) => r.kind === "free-green");
  const ownOnly = rows.filter((r) => r.kind === "own-only");
  const sole = rows.filter((r) => r.sole);
  const unknown = rows.filter((r) => r.kind === "unknown");
  if (JSON_OUT) { console.log(JSON.stringify({ at: new Date().toISOString(), rows }, null, 2)); }
  else {
    const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
    console.log(`${"─".repeat(150)}`);
    for (const r of rows) {
      const mark = r.kind === "free-green" ? "✗" : r.kind === "alive" ? "✓" : r.kind === "unknown" ? "⊘" : "△";
      if (mark === "✓" && !r.sole && !KEEP) continue;         // 산 줄은 조용히(떠받치는 게 하나면 적는다)
      console.log(`${mark} ${w(r.sym, 30)} ${w(r.verdict, 12)} ${r.note}`);
    }
    console.log(`${"─".repeat(150)}`);
    console.log(`전체 ${rows.length}줄 — ✓ 산 줄 ${rows.filter((r) => r.kind === "alive").length}(그중 🔸 떠받치는 게 하나 ${sole.length}) · 🔴 거저 초록 ${free.length} · △ 자기 파일만 ${ownOnly.length} · ⊘ ${unknown.length}`);
    console.log("🔴 «거저 초록» = 그 배선이 내일 통째로 지워져도 이 줄은 초록으로 남는다. 심볼을 그 배선에만 있는 글자로 바꿔라.");
    console.log("△ «자기 파일만» = 하니스가 일부러 그렇게 센다(가짜 빨강을 없앤 2026-09-15 수리) — 빨강은 아니지만, 바깥이 다 지워져도 안 빨개진다.");
  }
  process.exit(free.length ? 1 : 0);
}
main();
