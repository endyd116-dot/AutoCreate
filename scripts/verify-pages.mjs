// scripts/verify-pages.mjs — 🔴 **빌드된 화면이 켜지기는 하나**(문법·셸 뼈대). 서버도 브라우저도 안 켠다.
//   사용: node scripts/verify-pages.mjs        (빨강 1건이라도 있으면 종료코드 1)
//         node scripts/verify-pages.mjs --json
//
//   왜 따로 있나 — 사이에 구멍이 하나 있었다:
//     · `build-pages.mjs` 는 **템플릿을 붙이기만** 한다. 붙인 결과가 JS 로서 말이 되는지는 안 본다(오타 하나로 그 화면은 통째로 빈 화면이 된다).
//     · `shot-p1r1.mjs` 는 그걸 잡지만 **playwright + 뜬 서버**가 있어야 돌아서, 평소엔 아무도 안 돌린다.
//     · 라벨·죽은통로 하니스는 **문자열**만 본다 — 그 파일이 실행되는지는 안 본다.
//   ⇒ `node --check` 한 번이면 «그 화면이 켜지긴 하나»가 공짜로 잡힌다. 🔴 초록이 «잘 만들었다»는 뜻은 아니다(스샷은 따로 본다 · PITFALLS #9).
//
//   덤으로 두 가지를 더 본다(빌드가 깨졌을 때만 나는 증상):
//     · 템플릿 표식(`--- script ---` · `=== 파일명 |`)이 결과물에 새어 나왔나 — 새면 그 화면은 글자가 깨진 채로 뜬다
//     · 충돌 표식(`<<<<<<<` 따위)이 남았나 — 2026-09-15 에 **실제로 푸시된 적이 있다**(AC-67)
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const JSON_OUT = process.argv.includes("--json");
const DIRS = ["public/app", "public/ops"];
const results = [];
const rec = (step, ok, note = "") => { results.push({ step, ok: !!ok, note }); };
const OUT = `${tmpdir()}/ac-verify-pages`;
mkdirSync(OUT, { recursive: true });

/** 빌드 산출물의 <script> 본문(빌드가 감싼 `(async () => { … })();`)만 떠서 문법을 잰다. */
function scriptOf(src) {
  const i = src.lastIndexOf("<script>\n(async () => {");
  if (i < 0) return null;
  const s = src.indexOf("{", src.indexOf("(async () => {", i)) + 1;
  const e = src.lastIndexOf("})();");
  return s > 0 && e > s ? src.slice(s, e) : null;
}

const CONFLICT = /^(<{7}|={7}|>{7})[ \t]/m;   // 머지 충돌 표식 — 줄머리에서만(문서의 «====» 구분선을 오인하지 않게)
const TPL_LEAK = /^--- script ---$|^=== [^\n|]+\|/m;

let files = 0;
for (const dir of DIRS) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { rec(`${dir} 를 읽지 못했다`, false, "빌드를 먼저 돌려라(node scripts/build-pages.mjs)"); continue; }
  for (const f of entries) {
    if (!f.endsWith(".html")) continue;
    const p = `${dir}/${f}`;
    const src = readFileSync(p, "utf8");
    files++;

    const body = scriptOf(src);
    if (body === null) { rec(`${p} — 스크립트가 없다`, true, "정적 화면(로그인 등)"); }
    else {
      const tmp = `${OUT}/${dir.replace(/\//g, "_")}_${f.replace(/\.html$/, "")}.mjs`;
      writeFileSync(tmp, `(async () => {${body}})();`, "utf8");
      try { execFileSync(process.execPath, ["--check", tmp], { stdio: "pipe" }); rec(`${p} — 스크립트가 켜진다`, true, `${(body.length / 1024).toFixed(1)}KB`); }
      catch (e) { rec(`🔴 ${p} — 스크립트가 깨졌다`, false, String(e.stderr ?? e).split("\n").filter((l) => /SyntaxError|\^/.test(l)).slice(0, 2).join(" ").slice(0, 120)); }
    }
    if (CONFLICT.test(src)) rec(`🔴 ${p} — 머지 충돌 표식이 남았다`, false, "«<<<<<<<» 가 화면에 그대로 뜬다");
    if (TPL_LEAK.test(src)) rec(`🔴 ${p} — 템플릿 표식이 새어 나왔다`, false, "«--- script ---» / «=== 파일 |» 이 결과물에 있다");
  }
}
/* 셸 뼈대 — 빌드가 통째로 이상해지면 여기부터 무너진다. */
rec("화면을 하나라도 찾았다", files > 0, `${files}장`);
for (const [p, must] of [["public/app/home.html", ["<nav class=\"rail\"", "<nav class=\"tabs\"", "/js/ui.js"]], ["public/ops/index.html", ["/js/ops.js"]]]) {
  const src = readFileSync(p, "utf8").slice(0, 4000);
  const miss = must.filter((m) => !src.includes(m));
  rec(`셸 뼈대가 있다 — ${p}`, miss.length === 0, miss.length ? `없는 것 ${miss.join(" · ")}` : must.length + "가지");
}
/* 🔴 화면이 읽는 공용 층도 같이 잰다 — 여기가 깨지면 **모든** 화면이 한꺼번에 죽는다. */
for (const p of ["public/js/ui.js", "public/js/mock.js", "public/js/ops.js", "public/js/mock-ops.js"]) {
  let ok = true, note = "";
  try { statSync(p); } catch { rec(`공용 층 ${p}`, true, "없음(선택)"); continue; }
  try { execFileSync(process.execPath, ["--check", p], { stdio: "pipe" }); note = `${(readFileSync(p, "utf8").length / 1024).toFixed(1)}KB`; }
  catch (e) { ok = false; note = String(e.stderr ?? e).split("\n").filter((l) => /SyntaxError/.test(l)).slice(0, 1).join(" ").slice(0, 120); }
  rec(`${ok ? "" : "🔴 "}공용 층이 켜진다 — ${p}`, ok, note);
}

if (JSON_OUT) console.log(JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\n빌드된 화면이 켜지나 · ${new Date().toISOString()}\n${"─".repeat(120)}`);
  for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 56)} ${w(r.note, 60)}`);
  const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
  console.log(`${"─".repeat(120)}\nPASS ${pass} · FAIL ${fail}`);
  console.log("🔴 초록은 «켜진다»까지다 — 잘 만들었는지는 스샷을 눈으로 본다(PITFALLS #9).");
}
process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
