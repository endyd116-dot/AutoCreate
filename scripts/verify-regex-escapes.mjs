/**
 * scripts/verify-regex-escapes.mjs — 🔴 **정규식의 백슬래시가 한 겹 먹혀 낱글자가 된 자리**(AC-192 · B 2026-09-22)
 *
 *   ══ 왜 이 자인가 ══
 *   `verify-ai-usage-leaks.mjs` 의 `[,\s}]` 가 **`[,s}]` 로 깨져 있었다.** `\s`(공백)가 **글자 `s`** 가 된 것이다.
 *   그런데 **초록이었다** — 실제 인자가 `costUsd: 0,` 이라 **쉼표로 우연히 맞았기 때문**이다.
 *   ⇒ 🔴 **깨진 자는 «틀렸다»고 말해 주지 않는다. 우연히 맞는 동안 조용하다.** 그게 이 병의 무서운 점이다.
 *
 *   ══ 어디서 먹히나(AC-100 · 2026-09-22 재현) ══
 *   셸을 거쳐 파일을 쓰면 **`\\` 가 `\` 로 한 겹 준다.** 실측:
 *     히어독에 `seven:\\s` 를 넣었더니 파일엔 `seven:\s` 가 앉았다(인용 히어독 `<<'EOF'` 인데도).
 *     홑 `\s` 는 살아남았다 — 즉 **`\\s` 로 쓴 자리가 `\s` 로, `\s` 를 한 번 더 거치면 `s` 로** 준다.
 *   ⇒ 🔴 **정규식이 든 파일은 셸(heredoc·sed·perl -e·python -c)로 쓰지 않는다.** 편집 도구로 직접 쓴다.
 *
 *   ══ 재는 것 ══
 *     ① 문자 클래스  — `[…]` 안에 **구두점과 섞인 맨 `s`·`d`·`w`·`b`** 가 있나(= `\s` 가 흘린 자국)
 *     ② 문자열 정규식 — `new RegExp("…\s…")` 처럼 **보통 문자열 안의 홑 백슬래시**(JS 가 먹어 글자만 남는다)
 *     ③ 🔴 자기시험    — 이 자가 정말 무는가(깨진 본·성한 본을 넣어 보고 가르나). ③이 울면 ①②를 믿지 않는다
 *
 *   🔴 **모수를 말한다** — «검사한 정규식 N개 / 훑은 파일 M개». 0 을 통과로 쓰지 않는다(AC-141 ②).
 *   종료코드: 0 = 깨진 곳 없다 · 1 = 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { codeOnly } from "./_lib/code-only.mjs";

const ROOT = process.cwd();
const DIRS = ["scripts", "lib", "netlify/functions", "db", "public/js"];
const EXT = new Set([".mjs", ".js", ".ts", ".mts"]);
const SKIP = new Set(["node_modules", ".git", "dist", ".netlify", "vendor"]);

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!existsSync(abs)) return out;
  for (const e of readdirSync(abs)) {
    if (SKIP.has(e)) continue;
    const rel = path.join(dir, e);
    if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (EXT.has(path.extname(e))) out.push(rel.split(path.sep).join("/"));
  }
  return out;
}

/* ───────── 뜯기 ─────────
   정규식 리터럴을 대충 집는다. 나눗셈(`a / b`)과 가르지 못하는 자리가 있어 **앞 글자를 본다** —
   `=`·`(`·`,`·`!`·`&`·`|`·`?`·`{`·`[`·`:`·`;`·`return`·줄머리 뒤에 오는 `/` 만 정규식으로 센다.
   🔴 놓치는 쪽으로 틀린다(오탐보다 낫다) — 대신 **놓친 수를 모수에 적어** 0 을 통과로 쓰지 않는다. */
const RE_LITERAL = /(^|[=(,:[!&|?{;\s])\/(?![*/])((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+)\/[gimsuyd]*/g;
/* 보통 문자열 안의 홑 백슬래시 — `new RegExp("\d+")` 는 JS 가 그 백슬래시를 먹어 `d+` 가 된다. */
const RE_STRINGY = /new RegExp\(\s*(["'])((?:\\.|(?!\1)[\s\S])*?)\1/g;

/** 정규식 본문에서 **진짜 문자 클래스**만 뜯는다.
 *  🔴 정규식으로 `[…]` 를 집으면 **이스케이프된 `\[` 를 클래스 시작으로 읽는다** — 첫 판에서 오탐 7건이 전부 이것이었다.
 *  ⇒ 글자를 하나씩 걸으며 **백슬래시 다음 글자는 건너뛴다.** */
export function classesOf(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "\\") { i++; continue; }
    if (body[i] !== "[") continue;
    let j = i + 1;
    for (; j < body.length; j++) {
      if (body[j] === "\\") { j++; continue; }
      if (body[j] === "]") break;
    }
    if (j >= body.length) break;                 // 안 닫혔다 — 우리가 잘못 뜯은 것이다. 버린다
    out.push(body.slice(i, j + 1));
    i = j;
  }
  return out;
}

/** 클래스 안에서 «구두점과 섞인 맨 s/d/w/b» 를 찾는다 = `\` 를 흘린 자국. */
export function brokenClass(cls) {
  const inner = cls.slice(1, -1).replace(/^\^/, "");
  const members = inner
    .replace(/\\u\{[0-9a-fA-F]+\}/g, "\u0000")   // `\u{1F300}` — 통째로 하나의 글자다
    .replace(/\\u[0-9a-fA-F]{4}/g, "\u0000")
    .replace(/\\x[0-9a-fA-F]{2}/g, "\u0000")
    .replace(/\\./g, "\u0000");                  // 나머지 성한 이스케이프
  const noRanges = members.replace(/[A-Za-z0-9]-[A-Za-z0-9]/g, "\u0000"); // `a-z` 같은 범위도 지운다
  const bare = [...noRanges].filter((c) => "sdwbSDWB".includes(c));
  if (!bare.length) return null;
  const punct = [...noRanges].filter((c) => c !== "\u0000" && !/[A-Za-z0-9]/.test(c));
  if (!punct.length) return null;                          // `[sdw]` 처럼 글자만이면 일부러 쓴 것이다
  return { bare: bare.join(""), punct: punct.join("") };
}

/** 보통 문자열 안에서 «JS 가 먹어 없어질 홑 백슬래시» 를 찾는다. */
export function brokenStringRegex(src) {
  const hits = [];
  for (const m of src.matchAll(/\\(.)/g)) {
    // JS 문자열이 이해하는 것(`\\` `\n` `\t` `\"` …)은 지나간다. 정규식 전용 글자가 홑으로 있으면 먹힌다.
    if ("sSdDwWbB".includes(m[1])) hits.push(m[0]);
  }
  return hits;
}

/* ───────── ③ 자기시험 — 먼저 한다(대조군 없이 재지 않는다 · AC-161) ───────── */
const SELFTEST = [
  ["[,s}]", true, "실제로 깨져 있던 그 글자"],
  ["[,\\s}]", false, "성한 본"],
  ["[^\\d.]", false, "성한 본(부정 클래스)"],
  ["[.d]", true, "`\\d` 가 흘린 자국"],
  ["[a-z0-9_.-]", false, "범위·구두점만 — 맨 s/d/w 가 없다"],
  ["[sdw]", false, "글자만 골라 담은 클래스 — 일부러 쓴 것"],
  ["[\\w.-]", false, "성한 본"],
  ["[ \\t]", false, "성한 본"],
  ["[\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}]", false, "코드포인트 범위 — 16진의 B·F 를 맨 글자로 세면 안 된다"],
];
const selfFails = [];
for (const [cls, shouldBite, why] of SELFTEST) {
  const bit = brokenClass(cls) !== null;
  if (bit !== shouldBite) selfFails.push(`${cls} — ${shouldBite ? "물어야 하는데 안 물었다" : "안 물어야 하는데 물었다"}(${why})`);
}
/* 🔴 **뜯기 자체도 시험한다** — 첫 판의 오탐 7건은 「어느 `[` 가 클래스인가」를 틀려서 났다. 잡는 글자가 아니라 **뜯는 눈**이 병이었다. */
const TEAR = [
  ["<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>", 1, "이스케이프된 `\\[` 는 클래스가 아니다 — 진짜는 `[\\s\\S]` 하나"],
  ["\\[block:([a-z_]+)\\]", 1, "같은 자리 — 진짜는 `[a-z_]` 하나"],
  ["costUsd: 0(?![.\\d])", 1, "`[.\\d]` 하나"],
  ["^[=(,:]$", 1, "클래스 하나"],
];
for (const [body, want, why] of TEAR) {
  const got = classesOf(body).length;
  if (got !== want) selfFails.push(`뜯기 — /${body}/ 에서 클래스 ${want}개를 봐야 하는데 ${got}개를 봤다(${why})`);
}
if (brokenStringRegex('"\\\\d+"').length !== 0) selfFails.push('new RegExp("\\\\d") — 성한 본을 물었다');
if (brokenStringRegex('"\\d+"').length !== 1) selfFails.push('new RegExp("\\d") — 깨진 본을 안 물었다');
if (selfFails.length) {
  console.log("⊘ 못 쟀어요 — 🔴 **이 자의 자기시험이 먼저 떨어졌다.** 아래를 고치기 전엔 ①②의 초록을 믿지 마라.");
  for (const s of selfFails) console.log(`   · ${s}`);
  process.exit(2);
}

/* ───────── 훑기 ───────── */
const files = DIRS.flatMap((d) => walk(d));
if (!files.length) { console.log("⊘ 못 쟀어요 — 훑을 파일이 하나도 없다(폴더가 맞나)."); process.exit(2); }

let nLiterals = 0, nStringy = 0, nCommentLines = 0;
const hits = [];
for (const f of files) {
  const raw = readFileSync(path.join(ROOT, f), "utf8");
  const lines = raw.split("\n");
  /* 🔴 **주석은 빼되 `codeOnly` 의 결과를 본문으로 쓰지는 않는다.**
     그 도구는 `https?:\/\/` 같은 정규식이 든 줄을 **잘라먹는다**(자기 머리말에 적혀 있는 한계다).
     하필 이 자가 보는 것이 정규식이라 그걸 본문으로 쓰면 **보던 줄이 사라진다.**
     ⇒ 「그 줄이 통째로 주석인가」만 그 도구에 묻고(줄 수를 보존하니 줄 번호가 맞는다), **읽기는 원문으로** 한다. */
  const stripped = codeOnly(raw).split("\n");
  lines.forEach((ln, i) => {
    if (ln.trim() && !(stripped[i] ?? "").trim()) { nCommentLines++; return; }   // 통째로 주석인 줄
    for (const m of ln.matchAll(RE_LITERAL)) {
      nLiterals++;
      for (const cls of classesOf(m[2])) {
        const b = brokenClass(cls);
        if (b) hits.push({ f, line: i + 1, kind: "①", what: cls, why: `맨 «${b.bare}» 가 구두점 «${b.punct}» 과 섞여 있다 — \\${b.bare[0]} 가 흘린 자국`, ctx: ln.trim().slice(0, 110) });
      }
    }
    for (const m of ln.matchAll(RE_STRINGY)) {
      nStringy++;
      const b = brokenStringRegex(m[2]);
      if (b.length) hits.push({ f, line: i + 1, kind: "②", what: m[0].slice(0, 60), why: `보통 문자열 안의 홑 «${b.join(" ")}» — JS 가 먹어 글자만 남는다(\\\\ 로 써야 한다)`, ctx: ln.trim().slice(0, 110) });
    }
  });
}

console.log("─".repeat(100));
console.log(`정규식의 먹힌 백슬래시 — 훑은 파일 ${files.length}개 · 집은 정규식 리터럴 ${nLiterals}개 · new RegExp("…") ${nStringy}개 · 건너뛴 주석 줄 ${nCommentLines}개 · 깨진 곳 ${hits.length}`);
console.log(`  ✓ ③ 자기시험 — 잡는 눈 ${SELFTEST.length}종 · 뜯는 눈 ${TEAR.length}종이 모두 제 답을 냈다(이 자를 믿을 근거)`);
if (!hits.length) console.log("  ✓ ①② 깨진 곳 없다");
for (const h of hits) {
  console.log(`  ✗ ${h.kind} ${h.f}:${h.line}  ${h.what}`);
  console.log(`        ${h.why}`);
  console.log(`        ${h.ctx}`);
}
console.log("─".repeat(100));
if (hits.length) console.log("🔴 고칠 때 **셸로 쓰지 마라**(heredoc·sed·perl -e 는 백슬래시를 한 겹 먹는다 · AC-100). 편집 도구로 직접 고친다.");
process.exit(hits.length ? 1 : 0);
