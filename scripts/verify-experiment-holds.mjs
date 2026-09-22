/**
 * scripts/verify-experiment-holds.mjs — 🔴 **«이 실험이 성립하나» — 우리 자들에게 대조군을 붙인다**
 *   (C · 2026-09-21 · AC-172 가 낳은 자)
 *
 *   ══ 왜 이 자인가 ══
 *   2026-09-21 메인이 넷리파이 env API 로 읽은 비밀값(별표16+뒤4자 = 20자)을 **제공사에 그대로 넣어**
 *   «401 이니 가짜 키다»라고 사장님께 보고했다. 🔴 **그 실험은 어떤 키를 넣어도 401 이었다** — 결과가
 *   재려던 것과 **무관**했다. 대조군이 없었던 것이다(AC-172 ①).
 *
 *   같은 병이 우리 하니스에도 있다. 이름만 다르다:
 *     · AC-121 «없어야 한다»는 대상을 못 찾아도 통과한다(부정형 단언)
 *     · AC-140 수리가 들어와 과녁이 사라지자 변이 셋이 **조용히 초록**으로 남았다
 *     · AC-161 ② `--only=` 로 좁히니 기댓말이 애초에 안 나와 «사라졌나»가 **언제나 참**이 됐다
 *     · AC-141 ② «모수 0» 을 통과로 썼다
 *   🔴 **넷은 한 병이다 — «판정이 재려는 것에 달려 있지 않다».**
 *
 *   ══ 그래서 무엇을 재나 (한 줄) ══
 *   🔴 **«제품을 통째로 비운 나무에서도 이 자가 초록이면, 그 초록은 제품을 보고 한 말이 아니다.»**
 *
 *   ══ 두 팔 ══
 *     A(대조군) = 추적되는 파일을 **그대로** 복사한 나무
 *     B(빈 제품) = 같은 나무인데 **제품 파일의 내용만 비웠다**(파일은 남기고 내용을 "" 로)
 *        비운 곳 : `scripts/` 와 아래 «그대로 두는 것»을 뺀 **추적되는 파일 전부**
 *        그대로  : `scripts/**`(자 자신) · package.json · package-lock.json · tsconfig.json
 *        🔴 자 자신을 안 비우는 까닭 — 비우면 자가 아예 안 돌아 **아무것도 못 잰다**.
 *
 *   ══ 판정 ══
 *     ✗  두 팔 **둘 다 종료코드 0** — 제품이 비었는데도 «전부 통과»다. 이 자의 초록은 제품과 무관하다.
 *     ✓  빈 팔에서 갈라진다(1·2·그 밖) — 판정이 제품에 달려 있다.
 *     ⊘  셋 중 하나 — ㈜출력이 **글자 하나 안 달라졌다**(안 읽었거나 · 읽고도 모수를 안 찍는다 — 🔴 이 둘은 **못 가른다**)
 *        ㈝**대조군에서부터 0 이 아니다**(지금 빨갛거나 못 재는 자) 또는 시간 초과 — **잴 자격이 없다**(AC-9).
 *        🔴 ⊘ 를 통과로 세지 않는다. 세면 이 자가 바로 그 병에 걸린다.
 *
 *   ══ 🔴 이 자가 재지 **않는** 것 (거짓 빨강을 미리 깎는다 · AC-112 ⑤) ══
 *     · «✗ 가 난 자는 나쁜 자다» 가 아니다. **«그 자가 지금 보는 것이 제품 밖에 있다»**는 뜻이다.
 *       docs 만 읽는 자 · 상수표만 보는 자는 여기서 ✗ 가 나도 **제 할 일은 한다**. 사람이 보고 가른다.
 *     · 브라우저·DB·네트워크를 쓰는 자는 **모수 밖**이다(돌리면 라이브를 건드린다 · §2 선).
 *
 *   ══ 쓰는 법 ══
 *     node scripts/verify-experiment-holds.mjs                 전수
 *     node scripts/verify-experiment-holds.mjs --only=key-con   이름에 그 글자가 든 자만
 *     node scripts/verify-experiment-holds.mjs --selftest       🔴 **자기 찌르기** — 아는 검체 둘로 이 자가 무는지 본다
 *
 *   종료코드: 0 = ✗ 0건 · 1 = ✗ 가 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, cpSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
/* 🔴 한 폴더를 두 판이 같이 쓰면 뒤에 도는 판이 앞 판의 팔을 지운다 — 실제로 밟았다(2026-09-21 C).
   배경에서 전수를 돌리면서 앞에서 `--only=` 로 한 번 더 돌렸는데, 뒤에 끝난 판의 `rmSync` 가
   **돌고 있는 판의 나무를** 지워 그 판이 죽었다. 자가 제 아레나를 난누어 쓰면 안 된다. */
const ARENA = path.join(ROOT, "_verify", `experiment-holds-${process.pid}`);   /* `_verify/` 는 .gitignore 에 있다 — 잔재가 커밋에 안 딸려간다 */
/* 🔴 60초로는 **무거운 자가 통째로 ⊘ 로 떨어진다** — `verify-deadends-meter` 는 실측 **190초**다(2026-09-23).
   ⊘ 는 «통과가 아니다»라 그대로 두면 「못 쟀음」이 쌓이기만 한다 ⇒ 넉넉히 준다.
   🔴 다만 **무한정은 아니다** — 안 끝나는 자는 «못 쟀음»이 맞다(그때는 까닭이 «시간 초과»로 남는다). */
const TIMEOUT_MS = Number(process.env.HOLDS_TIMEOUT_MS || 240_000);

const argOnly = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
const SELFTEST = process.argv.includes("--selftest");
/** 🔴 `--grow` — «모수가 **늘어야 할 때** 안 느나»(메인 물음 2026-09-22 · B 가 `subtitleFont` 로 밟은 병).
 *  AC-141 은 «모수 0 을 통과로 쓰지 마라»인데, **모수가 안 변한 것**은 그 축이 못 잡는다.
 *  ⇒ 팔 하나를 더 짓는다: **제품에 새 화면 한 장을 심은 판**. 자의 출력이 **글자 하나도 안 변하면**
 *     그 자는 «새로 생긴 것»을 안 센다 — 그게 이 모드가 찍는 것이다. */
const GROW = process.argv.includes("--grow");
const GROW_FILE = "public/app/zz-grown.html";
const GROW_BODY = [
  "<!doctype html>", "<html lang=\"ko\"><head><meta charset=\"utf-8\"><title>새 화면 · AutoCreate</title>",
  "<link rel=\"stylesheet\" href=\"/css/ac.css?v=23\"></head><body>",
  "<div class=\"shell\"><main class=\"page\" id=\"page\">",
  "<div id=\"list\"><div class=\"group\"><span class=\"sk\" style=\"height:40px\"></span></div></div>",
  "</main></div><script src=\"/js/ui.js?v=29\"></script>",
  "<script>(async () => { await UI.boot(\"schedule\");",
  "  const r = await UI.api(\"/api/zz-grown\"); if (!r.ok) { UI.toast(\"불러오지 못했어요\"); return; }",
  "})();</script></body></html>",
].join("\n");

/* ── 그대로 두는 것(비우지 않는다) ─────────────────────────────────────────── */
const KEEP_EXACT = new Set(["package.json", "package-lock.json", "tsconfig.json"]);
const keepWhole = (rel) => rel.startsWith("scripts/") || KEEP_EXACT.has(rel);

/* ── 모수에서 빼는 자(브라우저·DB·네트워크) ─────────────────────────────────── */
const LIVE_RE = /playwright|from "pg"|db\/index|\bfetch\(|neon|NETLIFY_DATABASE_URL|NETLIFY_AUTH_TOKEN/;

function tracked() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
  return out.split("\0").filter(Boolean);
}

/** 두 팔을 짓는다. blank=true 면 제품 파일의 **내용만** 비운다. */
function buildArm(name, files, blank) {
  const dir = path.join(ARENA, name);
  rmSync(dir, { recursive: true, force: true });
  for (const rel of files) {
    const src = path.join(ROOT, rel), dst = path.join(dir, rel);
    if (!existsSync(src)) continue;
    mkdirSync(path.dirname(dst), { recursive: true });
    if (blank && !keepWhole(rel)) writeFileSync(dst, "");
    else cpSync(src, dst);
  }
  return dir;
}

/** 한 자를 한 팔에서 돌린다. 🔴 **그 팔의 사본 스크립트**를 돌린다 — `import.meta.dirname` 를 쓰는 자가 절반이라 그래야 그 팔을 본다. */
function runIn(armDir, rel) {
  const script = path.resolve(armDir, rel);   /* 🔴 **절대 경로**다 — 상대로 넘기면 cwd 에 두 번 이어 붙어 `ERR_MODULE_NOT_FOUND` 가 난다(2026-09-23 실측) */
  if (!existsSync(script)) return { code: -2, out: "", why: "그 팔에 자가 없다" };
  /* 🔴 `.mts` 는 `tsx` 가 있어야 돈다. `tsx` 는 이 팔(`_verify/…`) 에서 위로 걸어 **리포의 node_modules** 를 찾는다
     — 그래서 팔을 리포 **안**에 둔 것이다(밖에 두면 패키지를 못 찾아 «사격장이 없는» 판정이 된다 · AC-190). */
  const argv = rel.endsWith(".mts") ? ["--import", "tsx", script] : [script];
  try {
    const out = execFileSync(process.execPath, argv, { cwd: armDir, encoding: "utf8", timeout: TIMEOUT_MS, maxBuffer: 32 << 20, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    if (e.killed || e.signal) return { code: -3, out: String(e.stdout ?? ""), why: `시간 초과(${TIMEOUT_MS / 1000}초)` };
    return { code: e.status ?? -1, out: String(e.stdout ?? "") + String(e.stderr ?? "") };
  }
}

/* ══════════════ 🔴 자기 찌르기 — 아는 검체 둘 ══════════════
   메인의 AC-172 가 가르쳐 준 것: **이 자 자신도 «두 갈래를 다 낼 수 있나»를 보여야 한다.**
   ㉮ «성립하지 않는 실험» 검체 — 제품을 안 읽고 언제나 초록인 자
   ㉯ «성립하는 실험» 검체   — 제품을 읽고 없으면 우는 자
   이 자가 ㉮ 를 ✗, ㉯ 를 ✓ 로 갈라야 한다. 한쪽이라도 못 가르면 이 자는 무디다. */
const SPECIMENS = {
  /* ㈞ 🔴 **AC-172 그 모양** — 읽긴 읽는다. 그런데 판정이 그 읽은 것에 **안 달려 있다**.
     메인의 탐침이 정확히 이것이었다 — 값을 읽어 제공사에 넣었고, 그 값이 무엇이든 401 이었다.
     🔴 첫 판 검체는 **아무것도 안 읽는** 것이었는데, 그건 «눈몄 자»가 아니라 «모수 밖»이다. 본뜨기를 고쳐 적는다. */
  "scripts/_specimen-vacuous.mjs":
    `import { readFileSync, existsSync } from \"node:fs\";\n` +
    `const p = \"lib/creds-crypto.ts\";\n` +
    `const s = existsSync(p) ? readFileSync(p, \"utf8\") : \"\";\n` +
    'console.log("  읽은 글자 " + s.length + "자");\n' +
    `console.log("  ✓ ① 계약이 지켜졌다");\nprocess.exit(0);\n`,
  /* ㈟ «성립하는 실험» — 읽고, 없으면 운다 */
  "scripts/_specimen-sound.mjs":
    `import { readFileSync, existsSync } from \"node:fs\";\n` +
    `const p = \"lib/creds-crypto.ts\";\n` +
    `const s = existsSync(p) ? readFileSync(p, \"utf8\") : \"\";\n` +
    `const ok = s.includes("maskProxyUrl");\n` +
    `console.log(ok ? "  ✓ ① maskProxyUrl 이 있다" : "  ✗ ① maskProxyUrl 이 없다");\n` +
    `process.exit(ok ? 0 : 1);\n`,
  /* ㈠ 🔴 **모수 밖** — 내가 비운 곳을 아예 안 읽는다. 이건 «눈몄 자»가 아니다 — 내 팔이 못 미치는 자리다.
     첫 전수에서 이런 자 셋을 ✗ 로 찍었다(AC-210 ②). 그 가름을 검체로 박아 둔다. */
  "scripts/_specimen-outofscope.mjs":
    `console.log("  ✓ ① 이 자는 제품을 안 읽는다");\nprocess.exit(0);\n`,
  /* ㅡ 🔴 **AC-172 그 모양 그대로** — 재려는 것이 **우리 나무 밖**에 있다(남의 API 가 준 값).
     메인은 넷리파이 env API 로 읽은 **마스킹된** 20자를 제공사에 넣고 401 을 받아 «가짜 키»라 결론했다.
     어떤 값을 넣어도 401 이라 **대조군이 없는 실험**이었다.
     🔴 **이 검체의 답은 ⊘ 이고, 그게 이 자의 한계다** — 내 대조군은 «우리 제품을 비운다»인데,
     그 실험의 주어는 제품이 아니라 **밖에서 받은 값**이라 팔을 비워도 아무것도 안 변한다.
     ⇒ «못 잡는다»를 **문장이 아니라 돌아가는 검체로** 남긴다. 다음 사람은 이걸 ✓ 로 뒤집는 것을 목표로 삼으면 된다. */
  "scripts/_specimen-external.mjs":
    `/* 남의 API 가 준 값을 재는 척 한다 — 우리 나무 밖이라 팔을 비워도 같다 */\n` +
    `const masked = \"****************abcd\";   // 별표16+뒤4자 = 20자\n` +
    `const ok = masked.length === 20 && !/^\\*/.test(masked);   // 이 판정은 제품과 무관하다\n` +
    `console.log(ok ? \"  ✓ ① 키가 살아 있다\" : \"  ✗ ① 가짜 키다\");\n` +
    `process.exit(0);\n`,
};

/** 🔴 `--grow --selftest` 전용 검체 셋 — **«안 움직였다»가 두 뜻인 것을 돌려서 보인다.**
 *  메인이 «가를 수 있나»를 물었다. 정적 신호로는 안 된다 — 폴더를 훑는 자 52개 중 18개가 **손 목록도** 쓴다.
 *  ⇒ 아는 검체 셋을 넣어 **㈟와 ㈠가 같은 답을 낸다**는 것을 보인다. 그게 «못 가른다»의 증명이다. */
const GROW_SPECIMENS = {
  /* ㈞ 성한 세는 자 — 폴더를 세어 수를 찍는다. 새 화면이 늘면 수가 움직인다 → ✓
     실패하면 이 모드가 아예 무디다는 뜻이다. */
  "scripts/_grow-counter.mjs":
    "import { readdirSync } from \"node:fs\";\n" +
    "const n = readdirSync(\"public/app\").filter((f) => f.endsWith(\".html\")).length;\n" +
    "console.log(\"  본 화면 \" + n + \"개\");\nprocess.exit(0);\n",
  /* ㈟ 🔴 **진짜 병** — «모든 화면을 봤다»고 **말하면서** 손 목록을 쓴다. 새 화면을 **안 센다.** */
  "scripts/_grow-blind.mjs":
    "const SCREENS = [\"home.html\", \"posts.html\"];   // 손 목록\n" +
    "console.log(\"  ✓ 모든 화면을 봤다 — \" + SCREENS.length + \"개\");\nprocess.exit(0);\n",
  /* ㈠ 세는 자가 **아니다** — 이름 붙은 검사 하나만 한다. 새 화면이 늘어도 움직일 **까닭이 없다**(멀줦하다). */
  "scripts/_grow-named.mjs":
    "import { readFileSync } from \"node:fs\";\n" +
    "const ok = readFileSync(\"public/app/posts.html\", \"utf8\").includes(\"이 글 내리기\");\n" +
    "console.log(ok ? \"  ✓ ① 내리기 단추가 있다\" : \"  ✗ ① 없다\");\nprocess.exit(0);\n",
};

/* ══════════════ 돌린다 ══════════════ */
console.log(GROW
  ? `🔴 «모수가 **늘어야 할 때** 느나» — 새 화면 한 장을 심고 출력이 움직이는지 본다 · ${new Date().toISOString()}`
  : `🔴 «이 실험이 성립하나» — 제품을 비운 팔에서도 초록인 자를 찾는다 · ${new Date().toISOString()}`);
console.log("═".repeat(118));

let files;
try { files = tracked(); }
catch (e) { console.error(`⊘ 못 쟀어요 — git ls-files 가 안 된다: ${e.message}`); process.exit(2); }
if (!files.length) { console.error("⊘ 못 쟀어요 — 추적되는 파일이 0개다."); process.exit(2); }

/* 🔴 모수를 **먼저 찍는다**(AC-114 ② — 다음 사람이 수를 맞댈 수 있어야 한다)
   🔴 **[2026-09-23 · AC-230] `.mts` 를 모수에 넣었다 — 여태 «모수의 절반»을 못 보고 있었다.**
   내가 «못 쟀음»으로 적어 둔 것이고, 메인이 «오늘 종일 잡은 그 병이 네 자에 그대로 있다»고 짚었다. 맞다.
   ⇒ `tsx` 로 돈다(`node --import tsx <절대경로>` · `cwd` 는 그 팔). **팔 안에서 실제로 도는 것을 먼저 확인했다**(AC-190 «사격장이 없으면 못 잰다»).
   ⚠️ 한 번 밟았다: 팔 경로를 **상대**로 넘겼더니 cwd 에 두 번 이어 붙어 `ERR_MODULE_NOT_FOUND` 가 났다 — **절대 경로로 넘긴다.** */
const allRulers = files.filter((f) => /^scripts\/verify-.*\.(mjs|mts)$/.test(f));
const MJS_N = files.filter((f) => /^scripts\/verify-.*\.mjs$/.test(f)).length;
const MTS_N = files.filter((f) => /^scripts\/verify-.*\.mts$/.test(f)).length;
const skipped = [];
let rulers = allRulers.filter((f) => {
  const src = readFileSync(path.join(ROOT, f), "utf8");
  if (LIVE_RE.test(src)) { skipped.push([f, "브라우저·DB·네트워크를 쓴다"]); return false; }
  if (/-mutants\.(mjs|mts)$/.test(f)) { skipped.push([f, "변이 하니스 — 제 손으로 사본을 짓는다(이 자의 팔과 겹친다)"]); return false; }
  if (f.endsWith("verify-experiment-holds.mjs")) { skipped.push([f, "이 자 자신"]); return false; }
  return true;
});
if (argOnly) rulers = rulers.filter((f) => f.includes(argOnly));

const mtsIn = rulers.filter((f) => f.endsWith(".mts")).length;
console.log(`■ 내가 세는 모수`);
console.log(`   추적 파일 ${files.length}개 · 그중 \`scripts/verify-*\` **${allRulers.length}개**(\`.mjs\` ${MJS_N} + \`.mts\` ${MTS_N})`);
console.log(`   └ 모수 밖 ${skipped.length}개(${[...new Set(skipped.map((s) => s[1]))].join(" · ")})`);
console.log(`   └ 🔴 **이번에 재는 자 ${rulers.length}개**${argOnly ? ` (--only=${argOnly} 로 좁혔다)` : ""} — 그중 \`.mts\` **${mtsIn}개**`);
/* 🔴 «몇에서 몇으로 늘었나»를 자가 스스로 말한다(메인 부탁 2026-09-23) */
console.log(`   🔴 **모수를 채웠다(AC-230)** — 어제까지 이 자는 \`.mjs\` 만 봤다: **${MJS_N}개 중 고른 ${rulers.length - mtsIn}개**.`);
console.log(`      오늘 \`.mts\` ${MTS_N}개를 넣어 **${rulers.length}개**가 됐다(늘어난 ${mtsIn}개 · \`node --import tsx\` 로 돈다).`);
console.log(`      어제 내가 «모수의 절반을 못 본다»고 «못 쟀음»에 적어 둔 그 자리다.`);
console.log(`   비우는 곳: 추적 파일 중 \`scripts/**\` 와 ${[...KEEP_EXACT].join("·")} 를 뺀 전부 — **파일은 남기고 내용만** ""`);
console.log("");

if (!rulers.length && !SELFTEST) { console.error("⊘ 못 쟀어요 — 잴 자가 0개다(--only 가 아무것도 안 골랐다)."); process.exit(2); }

/* 팔 둘을 **한 번만** 짓는다 */
const t0 = Date.now();
const armA = buildArm("A-control", files, false);
const armB = buildArm("B-blank", files, true);
let armC = null;
if (GROW) {
  armC = buildArm("C-grown", files, false);
  mkdirSync(path.join(armC, path.dirname(GROW_FILE)), { recursive: true });
  writeFileSync(path.join(armC, GROW_FILE), GROW_BODY);
}
if (SELFTEST) for (const [rel, body] of Object.entries(GROW ? GROW_SPECIMENS : SPECIMENS)) { for (const d of [armA, armB, armC].filter(Boolean)) { mkdirSync(path.join(d, path.dirname(rel)), { recursive: true }); writeFileSync(path.join(d, rel), body); } }
console.log(`   팔 둘을 지었다(${((Date.now() - t0) / 1000).toFixed(1)}초) — A=대조군 · B=제품을 비운 판`);
{
  /* 🔴 **팔이 정말 달라졌는지 본다** — 안 달라졌으면 이 자는 아무것도 안 잰 것이다(AC-112 ①) */
  const probe = "lib/creds-crypto.ts";
  const a = existsSync(path.join(armA, probe)) ? statSync(path.join(armA, probe)).size : -1;
  const b = existsSync(path.join(armB, probe)) ? statSync(path.join(armB, probe)).size : -1;
  if (a <= 0 || b !== 0) { console.error(`⊘ 못 쟀어요 — 팔이 안 갈렸다(${probe}: A=${a}바이트 · B=${b}바이트). 비우기가 안 먹었다.`); process.exit(2); }
  console.log(`   ✓ 팔이 갈렸다 — \`${probe}\` A=${a}바이트 · B=${b}바이트`);
}
console.log("");

/** 🔴 시각처럼 **매 번 달라지는 글자**를 걷는다 — 안 걷으면 모든 자의 출력이 달라 보인다.
 *  지금은 ISO 시각과 시계 둘뿐이다 — **숫자를 통째로 걷지 않는다**(«화면 0개»↔«화면 38개» 가 이 자의 핵심이다). */
const noClock = (s) => String(s)
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\d]*Z?/g, "<시각>")
  .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, "<시계>");

const targets = SELFTEST ? Object.keys(GROW ? GROW_SPECIMENS : SPECIMENS) : rulers;
const rows = [];
for (const rel of targets) {
  const a = runIn(armA, rel);
  if (a.why) { rows.push({ rel, mark: "⊘", say: `대조군에서 ${a.why}` }); continue; }
  if (a.code !== 0) { rows.push({ rel, mark: "⊘", say: `대조군이 초록이 아니다(종료코드 ${a.code}) — **이 자로는 못 잰다**` }); continue; }
  if (GROW) {
    /* 🔴 «늘어야 할 때 느나» — 새 화면을 심은 팔과 대조군의 출력을 맞댄다.
       글자 하나도 안 변하면 그 자는 **새로 생긴 것을 안 센다**(B 가 `subtitleFont` 로 밟은 병 · 메인 물음 2026-09-22). */
    const c = runIn(armC, rel);
    if (c.why) { rows.push({ rel, mark: "⊘", say: `늘린 팔에서 ${c.why}` }); continue; }
    const moved = noClock(a.out) !== noClock(c.out);
    /* 🔴 **이것은 판정이 아니다 — 세어서 나란히 놓는 것이다**(AC-163 ③).
       첫 판은 «안 움직이면 ✗» 로 찍었다가 바로 거짓 빨강을 냈다: `verify-r8-deadends` 는 `public/**` 을 읽지만
       **화면을 세는 자가 아니라 «이름 붙은 검사 140개»를 도는 자**라, 빈 화면 한 장이 늘어도 움직일 까닭이 없다.
       ⇒ «안 움직였다»는 **① 새것을 안 센다** 또는 **② 애초에 세는 자가 아니다** 둘 중 하나이고,
          🔴 **이 모드로는 그 둘을 못 가른다.** 그래서 **사람이 보라고 찍기만** 하고 등급에 안 넣는다(⊘). */
    rows.push({ rel, mark: moved ? "✓" : "⊘",
      say: moved ? `새 화면 한 장을 심으니 **출력이 움직였다** — 이 자는 새것을 센다`
        : `움직임 0 — **새것을 안 세거나**, 애초에 «세는 자»가 아니다. 🔴 **이 모드로는 못 가른다**(사람이 보라)` });
    continue;
  }
  const b = runIn(armB, rel);
  if (b.why) { rows.push({ rel, mark: "⊘", say: `빈 팔에서 ${b.why}` }); continue; }
  if (b.code === 0) {
    /* 🔴 둘 다 0 이면 두 갈래다 — **이 자가 무언가 달라진 것을 보긴 했나**로 가른다.
       본 것이 없으면(출력이 글자 하나 안 달라졌으면) 내가 비운 곳을 **안 읽는 자**다 — ✗ 가 아니라 ⊘(모수 밖).
       첫 판은 이걸 소스에서 낱말로 짐작했다가 **양쪽으로** 틀렸다(못 보는 자를 ✗, 보는 자를 ⊘). 짐작하지 말고 재라. */
    const same = noClock(a.out) === noClock(b.out);
    if (same) rows.push({ rel, mark: "⊘", say: `제품을 비웠는데 출력이 **글자 하나 안 달라졌다** — 🔴 안 읽었거나, 읽고도 **무엇을 읽었는지 안 찍는다**(AC-114). 이 자로는 못 가른다 — 먼저 그 자가 제 모수를 찍게 하라` });
    else rows.push({ rel, mark: "✗", say: `🔴 **제품을 통째로 비웠고 출력도 달라졌는데 종료코드는 0** — 보고도 «통과»라 했다(모수 0 을 통과로 쓴 것 · AC-141 ②)`, a, b });
  }
  else rows.push({ rel, mark: "✓", say: `빈 팔에서 갈라진다(A=0 → B=${b.code})` });
}

const w = Math.max(...targets.map((t) => t.length), 10);
for (const r of rows) console.log(`  ${r.mark} ${r.rel.padEnd(w)}  ${r.say}`);

/* ✗ 가 난 자는 **두 팔의 초록 줄을 나란히 놓는다** — 판단은 사람이 한다(AC-163 ③) */
const bad = rows.filter((r) => r.mark === "✗");
if (bad.length && !SELFTEST) {
  console.log("");
  console.log("── 🔴 ✗ 가 난 자의 «두 팔에 똑같이 뜬 초록 줄»(사람이 보라 · 자는 판단하지 않는다) ──");
  for (const r of bad.slice(0, 12)) {
    const ok = (s) => s.split("\n").filter((l) => /✓/.test(l)).map((l) => l.trim());
    const shared = ok(r.a.out).filter((l) => ok(r.b.out).includes(l));
    console.log(`  · ${r.rel} — 두 팔 공통 초록 ${shared.length}줄${shared.length ? ":" : " (출력에 ✓ 줄이 없다 — 종료코드로만 말하는 자)"}`);
    for (const l of shared.slice(0, 3)) console.log(`      ${l.slice(0, 104)}`);
  }
}

console.log("═".repeat(118));
const n = (m) => rows.filter((r) => r.mark === m).length;
console.log(`■ 잰 자 ${rows.length}개 — ✓ ${n("✓")} · 🔴 ✗ ${n("✗")} · ⊘ ${n("⊘")}`);
console.log(`   ⊘ 는 **통과가 아니다** — 대조군이 초록이 아니라 잴 자격이 없는 자다(AC-9).`);

if (SELFTEST) {
  /* 🔴 판정표를 **먼저** 적고 맞대는 것 — ㉮ 는 ✗ 여야 하고 ㉯ 는 ✓ 여야 한다 */
  const got = (rel) => (rows.find((r) => r.rel === rel) || {}).mark;
  /* 🔴 `--grow` 의 판정표는 **따로다** — 이 표가 이 판의 답이다(메인 물음 «가를 수 있나»).
     ㉯`_grow-blind`(진짜 병 — «모든 화면을 봤다»고 **말하면서** 손 목록을 쓴다)와
     ㉰`_grow-named`(멀쩡 — 애초에 세는 자가 아니다)가 **같은 ⊘ 로 나오는 것**을 기대값으로 못 박는다.
     🔴 **둘이 갈라지는 날 이 판정표가 맨 먼저 빨개지면서 «드디어 가른다»고 알려 준다.** */
  const wantGrow = { "scripts/_grow-counter.mjs": "✓", "scripts/_grow-blind.mjs": "⊘", "scripts/_grow-named.mjs": "⊘" };
  const want = GROW ? wantGrow : { "scripts/_specimen-vacuous.mjs": "✗", "scripts/_specimen-sound.mjs": "✓", "scripts/_specimen-outofscope.mjs": "⊘",
    /* 🔴 AC-172 모양은 **못 잡는다** — 기대값을 ⊘ 로 적어 둔다(잡게 되면 이 줄이 맨먼저 울면서 «드디어 된다»고 알려 준다) */
    "scripts/_specimen-external.mjs": "⊘" };
  let miss = 0;
  console.log("");
  console.log("── 🔴 자기 찌르기 판정표(먼저 적고 맞댄다) ──");
  for (const [rel, expect] of Object.entries(want)) {
    const g = got(rel), ok = g === expect;
    if (!ok) miss++;
    console.log(`  ${ok ? "✓" : "✗"} ${rel} — 기대 ${expect} · 나온 것 ${g ?? "(못 돌았다)"}`);
  }
  console.log(miss ? "  🔴 **이 자는 두 갈래를 못 가른다 — 무디다.**" : "  이 자는 세 갈래를 다 가른다(아는 검체 셋으로 확인 — ✗ 눈먼 자 · ✓ 성한 자 · ⊘ 모수 밖).");
  rmSync(ARENA, { recursive: true, force: true });
  process.exit(miss ? 1 : 0);
}

rmSync(ARENA, { recursive: true, force: true });
process.exit(GROW ? 0 : bad.length ? 1 : 0);   /* 🔴 `--grow` 는 **보고서**다 — 판정하지 않는다(거짓 빨강을 바로 냈다) */
