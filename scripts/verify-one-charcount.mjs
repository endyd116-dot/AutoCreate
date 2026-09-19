/**
 * scripts/verify-one-charcount.mjs — 🔴 «글자를 세는 법이 정말 하나인가» (수리 ⑤ · 2026-09-19).
 *
 *   왜 생겼나: 검수 화면 **한 곳**에 «지금 글은 91자»와 «지금 89자예요»가 같이 떴다(시나리오 A §9).
 *   블록으로 세는 쪽은 공백을 한 칸으로 줄여 세고, HTML 로 세던 쪽은 문단 줄바꿈을 그대로 세서 문단 둘이면 2가 어긋났다.
 *   🔴 **같은 사고가 2026-09-16 에 한 번 났었다**(«472자» ↔ «1,840자»). 그때 블록 쪽만 옮기고 HTML 쪽을 안 옮겼다.
 *      주석에는 «세는 자는 하나다»라고 **이미 적혀 있었다** — 주석이 코드보다 앞서 나간 자리(AC-59).
 *      ⇒ 말로 적어 두는 것으로는 안 막힌다. 그래서 이 자가 생겼다.
 *
 *   🔴 **이 자는 자기가 무엇을 세는지 말한다.**
 *
 *   무엇을 세나:
 *     ① `lib/blocks.ts` 에 **셈 규칙(`\s+`→한 칸)이 몇 번** 적혀 있나 — 두 번 이상이면 또 갈라진 것이다
 *     ② 제품 코드(`lib/**`·`netlify/functions/**`)에 `.length` 로 **직접 글자를 세는 자리**가 남아 있나
 *     ③ 두 자(`blocksCharCount`·`htmlCharCount`)가 같은 글에 **같은 값**을 주나 — 실제로 돌려서 잰다
 *
 *   쓰기: node scripts/verify-one-charcount.mjs
 */
import { readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const fails = [];
const notes = [];

/* ── ① 셈 규칙이 한 곳인가 ── */
const blocksSrc = readFileSync("lib/blocks.ts", "utf8");
const ruleHits = (blocksSrc.match(/replace\(\/\\s\+\/g,\s*" "\)/g) || []).length;
notes.push(`센 것: \`lib/blocks.ts\` 안에서 셈 규칙(\`replace(/\\s+/g," ")\`)이 적힌 횟수 = ${ruleHits}`);
if (ruleHits === 0) fails.push("🔴 셈 규칙이 `lib/blocks.ts` 에 없다 — `countPlainChars` 가 사라졌거나 다른 규칙이 됐다.");
if (ruleHits > 1) fails.push(`🔴 셈 규칙이 ${ruleHits}번 적혀 있다 — 또 갈라졌다. \`countPlainChars\` 하나만 남겨라.`);

for (const fn of ["countPlainChars", "blocksCharCount", "htmlCharCount"]) {
  const has = new RegExp("export function " + fn + "\\b").test(blocksSrc);
  notes.push(`센 것: \`lib/blocks.ts\` 가 \`${fn}\` 를 내보내나 = ${has}`);
  if (!has) fails.push(`🔴 \`${fn}\` 가 없다 — 세는 자가 빠졌다.`);
}

/* ── ② 제품 코드에 «직접 세는» 자리가 남아 있나 ── */
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (!/node_modules/.test(p)) walk(p); } else if (/\.ts$/.test(f)) files.push(p); } };
walk("lib"); walk("netlify/functions");

const raw = [];
for (const p of files) {
  /* 🔴 주석을 **줄 길이를 지키며** 지운다(줄 번호가 어긋나면 사람이 못 찾는다).
     줄머리가 `*`·`//` 인지만 보면 블록 주석의 «이어지는 줄»을 코드로 세게 된다 — 처음 이 자를 냈을 때 그렇게 틀렸다. */
  const src = readFileSync(p, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));
  /* 🔴 `[^)]*` 로 쓰면 **중첩 괄호를 못 넘는다** — `htmlToPlain(String(x)).length` 를 놓친다.
     처음 이 자를 낼 때 그렇게 썼고, **변이를 넣어 보고서야** 눈이 먼 걸 알았다(AC-108). 탐욕 `.*` 로 마지막 `)` 까지 간다. */
  src.split(/\r?\n/).forEach((line, i) => {
    if (/htmlToPlain\(.*\)\.length/.test(line)) raw.push(`${p.replace(/\\/g, "/")}:${i + 1}`);
    if (/blocksToPlain\(.*\)\.length/.test(line)) raw.push(`${p.replace(/\\/g, "/")}:${i + 1}`);
  });
}
notes.push(`센 것: 제품 코드(lib/**·netlify/functions/** · .ts ${files.length}개)에서 평문을 \`.length\` 로 **직접** 세는 자리 = ${raw.length}곳`);
if (raw.length) fails.push(`🔴 아직 직접 세는 자리가 있다 — \`countPlainChars\`(또는 \`htmlCharCount\`)를 써라: ${raw.join(" · ")}`);

/* ── ②-b 🔴 **저장한 직후에도 한 값인가** (2026-09-20 · «고치는 길» 걷기에서 나왔다) ──
   세는 자는 하나로 모았는데, **화면이 새 값을 안 받아** 또 두 숫자가 떴다:
   고치고 저장하면 검사 줄은 새 값(102자)인데 «이 글이 왜 이렇게 생겼나»의 분량은 **불러올 때 받은 옛 값**(50자) 그대로였다.
   ⇒ `pieces-update` 가 `actualChars` 를 **같은 자로 세어** 실어 보내고, 화면이 그걸 받아 다시 그린다.
   🔴 화면이 제 나름대로 세게 하면 안 된다 — 그러면 자가 다시 둘이 된다. */
const upd = readFileSync("netlify/functions/pieces.ts", "utf8");
/* 🔴 `[^)]*` 는 **중첩 괄호를 못 넘는다** — 이 라운드에서만 네 번째다. 괄호를 세지 말고 **그 줄 안에** 둘 다 있나로 본다. */
const sendsChars = upd.split(/\r?\n/).some((l) => /return json\(\{\s*ok:\s*true,\s*gate,\s*bodyHtml/.test(l) && /actualChars/.test(l));
const tplPiece = readFileSync("public/app/_tpl.txt", "utf8");
const takesChars = /r\.actualChars === "number"[\s\S]{0,120}?renderWhy\(/.test(tplPiece);
const genPiece = readFileSync("public/app/piece.html", "utf8");
const genTakes = /r\.actualChars === "number"/.test(genPiece);
notes.push(`센 것: 저장 응답이 \`actualChars\` 를 실어 보내나 = ${sendsChars} · 화면이 그걸 받아 다시 그리나 = ${takesChars} · 생성물에도 들어갔나 = ${genTakes}`);
if (!sendsChars) fails.push("🔴 `pieces-update` 가 `actualChars` 를 안 보낸다 — 저장 직후 화면에 **옛 글자 수와 새 글자 수가 같이** 뜬다.");
if (!takesChars) fails.push("🔴 화면이 저장 응답의 `actualChars` 를 안 받는다 — 새로고침해야 맞아진다(손님은 두 숫자를 본다).");
if (takesChars && !genTakes) fails.push("🔴 `_tpl.txt` 만 고치고 `build-pages` 를 안 돌렸다(AC-105).");
/* 화면이 제 나름대로 세고 있지 않나 */
const ownCount = /replace\(\/\\s\+\/g, ?" "\)\.(trim\(\)\.)?length/.test(tplPiece);
notes.push(`센 것: 화면(\`_tpl.txt\`)이 **제 나름대로** 글자를 세는 자리가 있나 = ${ownCount}`);
if (ownCount) fails.push("🔴 화면이 직접 글자를 센다 — 세는 자가 둘이 되면 2026-09-19 에 고친 병이 그대로 다시 난다.");

/* ── ③ 두 자가 같은 글에 **같은 값**을 주나 — 규칙만 보지 않고 진짜로 돌려서 잰다 ──
   `lib/blocks.ts` 는 확장자 없는 임포트를 쓰므로 맨 node 로는 못 끌어온다 ⇒ 리포의 `tsx` 로 돌린다. */
{
  const probe = `
import { blocksCharCount, htmlCharCount } from "../lib/blocks";
const cases = [
  ["두 문단(이 사고가 난 모양)", [{type:"para",text:"가나다라마바사."},{type:"para",text:"아자차카타파하."}], "<p>가나다라마바사.</p><p>아자차카타파하.</p>"],
  ["한 문단",                   [{type:"para",text:"가나다라마바사."}],                                   "<p>가나다라마바사.</p>"],
  ["줄바꿈이 섞인 글",           [{type:"para",text:"가나다\\n라마바"}],                                    "<p>가나다<br>라마바</p>"],
];
console.log(JSON.stringify(cases.map(([n,b,h]) => [n, blocksCharCount(b), htmlCharCount(h)])));
`;
  const tmp = join("scripts", "_charcount-probe.mts");
  let out = null;
  globalThis.__ranProbe = false;
  try {
    writeFileSync(tmp, probe, "utf8");
    const r = spawnSync("npx", ["tsx", tmp], { encoding: "utf8", timeout: 180000, shell: process.platform === "win32" });
    const line = (r.stdout || "").trim().split(/\r?\n/).pop();
    out = line && line.startsWith("[") ? JSON.parse(line) : null;
    if (!out) notes.push(`센 것: 두 자를 실제로 돌려 보기 — ⊘ **못 쟀다**(tsx 가 값을 안 줬다: ${(r.stderr || "").trim().split(/\r?\n/)[0] || "출력 없음"}). 규칙 대조(①②)만 했다.`);
  } catch (e) {
    notes.push(`센 것: 두 자를 실제로 돌려 보기 — ⊘ **못 쟀다**(${e.message.slice(0, 60)}). 규칙 대조(①②)만 했다.`);
  } finally { try { unlinkSync(tmp); } catch { /* empty */ } }

  if (out) {
    globalThis.__ranProbe = true;
    for (const [name, a, b] of out) {
      notes.push(`센 것: «${name}» → 블록 자 ${a}자 · HTML 자 ${b}자`);
      if (a !== b) fails.push(`🔴 «${name}»에서 두 자가 다르다(블록 ${a} ≠ HTML ${b}) — 같은 화면에 두 숫자가 뜬다.`);
    }
    if (!out.length) fails.push("🔴 견본을 하나도 못 쟀다 — 이 자가 헛돌고 있다(양성 대조 실패).");
  }
}

/* ── 보고 ── */
console.log("글자를 세는 법이 하나인가(수리 ⑤ · AC 시나리오 A §9) · " + new Date().toISOString());
console.log("─".repeat(108));
console.log("■ 🔴 이 자가 **무엇을 셌나** (안 적으면 초록이 거짓말을 한다)");
for (const n of notes) console.log("   · " + n);
console.log("");
if (fails.length) { console.log("■ 실패"); for (const f of fails) console.log("   " + f); }
else if (globalThis.__ranProbe) console.log("■ 통과 — 셈 규칙이 한 곳이고, 직접 세는 자리가 없고, **돌려서 재 보니** 두 자가 같은 값을 줬다.");
/* 🔴 못 잰 것을 «통과»라고 말하지 않는다(AC-9) — 처음 이 자를 냈을 때 그렇게 말했다. */
else console.log("■ 통과(일부) — 셈 규칙이 한 곳이고 직접 세는 자리도 없다. ⊘ **다만 두 자를 돌려서 대보지는 못했다** — 규칙 대조까지만 초록이다.");
console.log("─".repeat(108));
console.log(`PASS ${fails.length ? 0 : notes.length} · FAIL ${fails.length}`);
process.exit(fails.length ? 1 : 0);
