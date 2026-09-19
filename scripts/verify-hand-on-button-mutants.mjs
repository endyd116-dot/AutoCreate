/**
 * scripts/verify-hand-on-button-mutants.mjs — 🔴 **A 가 고친 `verify-hand-on-button` 이 «구멍을 사실로 옮겨» 감추지 않았나**
 *   (C · 2026-09-21)
 *
 *   ══ 왜 ══
 *   A 가 그 자를 `exit 2 → 0` 으로 만들었다. 옳은 방향이다(늘 ⊘ 인 자는 아무도 안 본다 · AC-95).
 *   🔴 **그런데 «⊘ 를 없앤다»와 «⊘ 를 감춘다»는 한 글자 차이다.** A 도 스스로 그걸 물었다:
 *     «내가 «구멍»을 «사실»로 옮겨 숨긴 데는 없나.»
 *   ⇒ 그 물음에 **말로 답하지 않고 변이로 답한다.** A 가 새로 단 세 가지 약속을 하나씩 깨 본다:
 *     ㉮ «그릴 단추가 애초에 없는 화면» — 단추가 생기면 **저절로 ⊘ 로 돌아온다**고 했다
 *     ㉯ «폼 칸을 채우고 다시 누른다» — 채운 뒤에도 아무 일 없으면 **여전히 빨강**이라고 했다
 *     ㉰ «열쇠 표» — 열쇠가 없으면 **정직하게 ⊘** 라고 했다
 *
 *   ══ 🔴 변이는 **사본**에서만 ══
 *   `public/` 과 `scripts/` 를 임시 폴더에 통째로 복사하고 **그 폴더에서** 자를 돌린다. 제품 파일 무접촉.
 *   `--only=` 로 한 화면만 재서 한 변이에 30초쯤 걸린다.
 *
 *   ══ 🔴 «그 축이 울었나»까지 본다(AC-121) ══
 *   종료코드만 보면 엉뚱한 축이 울어도 ✓ 가 된다 ⇒ 칸마다 «그 축이 낼 말»을 적고 **그 말이 나왔을 때만** 센다.
 *
 *   종료코드: 0 = 약속이 다 지켜진다 · 1 = 깨진 약속이 있다 · 2 = 못 쟀다.
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, mkdirSync, readdirSync, copyFileSync, statSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const ROOT = path.resolve(import.meta.dirname, "..");
const RULER = path.join(ROOT, "scripts", "verify-hand-on-button.mjs");
if (!existsSync(RULER)) { console.error("⊘ 못 쟀어요 — `scripts/verify-hand-on-button.mjs` 가 없다."); process.exit(2); }

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src)) {
    if (e === "node_modules" || e.startsWith(".")) continue;
    const s = path.join(src, e), d = path.join(dst, e);
    if (statSync(s).isDirectory()) copyDir(s, d); else copyFileSync(s, d);
  }
}

/** 사본을 만들고 transform 을 먹인 뒤 **그 사본에서** 자를 돌린다. */
function run(transform, only) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "ac-hand-"));
  try {
    copyDir(path.join(ROOT, "public"), path.join(dir, "public"));
    mkdirSync(path.join(dir, "scripts", "lib"), { recursive: true });
    copyFileSync(RULER, path.join(dir, "scripts", "verify-hand-on-button.mjs"));
    copyFileSync(path.join(ROOT, "scripts", "lib", "find-playwright.mjs"), path.join(dir, "scripts", "lib", "find-playwright.mjs"));
    /* 🔴 playwright 는 **원래 리포**에서 빌려 온다 — 사본에 node_modules 를 복사하지 않는다. */
    const changed = transform ? transform(dir) : true;
    let code = 0, out = "";
    const args = [path.join(dir, "scripts", "verify-hand-on-button.mjs")];
    if (only) args.push(`--only=${only}`);
    try { out = execFileSync(process.execPath, args, { cwd: dir, encoding: "utf8", env: { ...process.env, PW_DIR: path.join(ROOT, "runner") }, timeout: 600_000 }); }
    catch (e) { code = e.status ?? -1; out = String(e.stdout ?? "") + String(e.stderr ?? ""); }
    return { code, out, changed };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/* 🔴 **«기댓말이 사라졌나»로 판정하다 두 번 헛짚었다**(2026-09-21).
   `--only=terms.html` 로 돌리면 «화면 0개» 같은 글자는 **원래도 안 나온다** ⇒ 내 판정이 늘 «사라졌다»가 됐다.
   ⇒ 이제 **같은 `--only` 로 맨 판(대조군)을 먼저 돌리고**, «맨 판엔 없고 변이 판엔 있다»를 잰다.
   그래야 «내가 넣은 변이 때문에 달라졌다»를 말할 수 있다. 대조군은 `--only` 마다 한 번만 돌리고 재활용한다. */
const cases = [];
const add = (name, only, transform, mustAppear, want = true) => cases.push({ name, only, transform, mustAppear, want });
const baseCache = new Map();
function baseline(only) {
  if (!baseCache.has(only)) baseCache.set(only, run(null, only));
  return baseCache.get(only);
}

/* ㉮-1 A 의 약속: «나중에 단추가 생기면 저절로 ⊘ 로 올려 세운다» */
add("㉮-1 법 문서에 **평범한 `<button>`** 을 심으면 «사실»에서 빠져나온다", "terms.html", (d) => {
  const f = path.join(d, "public", "terms.html");
  const s = readFileSync(f, "utf8");
  writeFileSync(f, s.replace("</body>", '<button type="button" id="zzPlanted">심은 단추</button></body>'));
  return true;
}, "심은 단추", true);

/* ㉮-2 🔴 **내 예상이 틀렸고, 틀린 쪽이 A 에게 유리했다**(2026-09-21 · 재 보고 고쳤다).
   나는 «화면 소스에 `<button` 없이 `UI.seg(...)` 로만 단추를 만들면 A 의 잣대가 못 본다»고 봤다.
   재 보니 **본다.** 까닭: A 의 «소스에 단추 글자가 있나»는 **그 화면이 단추를 0개 그렸을 때만** 물어보는 되물음이다.
   `UI.seg` 로 만든 단추는 **실제로 그려지므로** 애초에 그 갈래로 안 간다 — 여느 화면처럼 세고 눌러 본다.
   ⇒ 🔴 **잣대는 중요한 자리에서 옳다.** 남는 위험은 좁다: «그릴 수 있는데 그리다 실패해서 0개인 화면»은
      소스에 `<button` 이 없으면 «사실»로 적힌다. 그건 이 변이가 못 재는 자리다(AC-9). */
add("㉮-2 🔴 `UI.seg()` 로만 단추를 만들면 잣대가 **못 본다**(구멍을 «사실»로 적는다)", "privacy.html", (d) => {
  const f = path.join(d, "public", "privacy.html");
  const s = readFileSync(f, "utf8");
  writeFileSync(f, s.replace("</body>",
    '<div id="zzHost"></div><script>document.getElementById("zzHost").innerHTML = UI.seg("zz", [["a","가"],["b","나"]], "a");</script></body>'));
  return true;
}, "본 단추 [1-9]", true);   // 🔴 **본다**(내 첫 예상이 틀렸다 — 위 주석)

/* ㉯ A 의 약속: «채운 뒤에도 아무 일 없으면 여전히 빨강» — 폼 안에 **죽은 submit** 을 심는다. */
add("㉯ 폼에 **죽은 단추**를 심으면, 칸을 채운 뒤에도 **빨강으로 센다**", "login.html", (d) => {
  const f = path.join(d, "public", "login.html");
  const s = readFileSync(f, "utf8");
  if (!/<form/.test(s)) throw new Error("login.html 에 폼이 없다 — 변이 자리를 못 찾았다");
  writeFileSync(f, s.replace(/(<form[^>]*>)/, '$1<button type="button" id="zzDeadInForm">심은 죽은 단추</button>'));
  return true;
}, "손이 안 붙은 단추 [1-9]", true);

/* ㉰ A 의 약속: «열쇠가 없으면 정직하게 ⊘» — 열쇠 표에서 team-accept 줄을 뺀다. */
add("㉰ 열쇠 표에서 한 줄을 빼면 **⊘ 로 돌아온다**", "team-accept.html", (d) => {
  const f = path.join(d, "scripts", "verify-hand-on-button.mjs");
  const s = readFileSync(f, "utf8");
  const next = s.replace(/"\/app\/team-accept\.html":\s*\{[^}]*\},?\n/, "");
  if (next === s) throw new Error("열쇠 표에서 그 줄을 못 찾았다");
  writeFileSync(f, next);
  return true;
}, "⊘ 못 쟀음|단추를 하나도 안 그린", true);

/* ═══ 돌린다 ═══ */
console.log("🔴 A 가 고친 `verify-hand-on-button` 에 변이를 넣어 본다 · " + new Date().toISOString());
console.log("─".repeat(116));
console.log("   («구멍을 사실로 옮겨 숨기지 않았나» — A 가 스스로 물은 것에 변이로 답한다)");
console.log("");

let bad = 0;
for (const c of cases) {
  let r;
  try { r = run(c.transform, c.only); }
  catch (e) { console.log(`  ✗ ${c.name}  — 🔴 변이를 못 넣었다: ${String(e?.message ?? e).slice(0, 90)}`); bad++; continue; }
  /* 🔴 **자가 «못 쟀음»(2)으로 끝났으면 아무것도 잰 게 아니다.** 첫 판에 playwright 를 못 찾아 전부 exit 2 였는데,
     «기댓말이 사라졌다»만 보던 내 판정이 그걸 **«울었다»로 읽었다** — 가짜 ✓ 둘이 나왔다(AC-112 ②).
     ⇒ 재지도 못한 판은 **✗ 로 떨군다.** «변이가 먹혔다»는 **잰 판에서만** 할 수 있는 말이다. */
  /* 🔴 **exit 2 에는 두 뜻이 있다** — «playwright 가 없어 못 돌았다»와 «자가 ⊘ 라고 판정했다».
     처음엔 둘을 같이 «못 쟀다»로 떨궜는데, ㉰ 는 **⊘ 가 나오는 것이 정답**이라 멀쩡한 칸을 ✗ 로 찍었다.
     ⇒ **안 돈 것만** 떨군다(자가 아무것도 안 찍었거나 playwright 안내가 찍혔을 때). */
  if (/playwright 를 못 찾았습니다/.test(r.out) || !/잰 모수/.test(r.out)) {
    console.log(`  ✗ ${c.name}`);
    console.log(`       🔴 **아무것도 못 쟀다**(종료코드 ${r.code}) — 이 판은 판정할 수 없다`);
    bad++; continue;
  }
  const b = baseline(c.only);
  if (b.code === 2 || /못 쟀어요/.test(b.out)) { console.log(`  ✗ ${c.name}
       🔴 **대조군을 못 쟀다** — 판정할 수 없다`); bad++; continue; }
  const re = new RegExp(c.mustAppear);
  const inBase = re.test(b.out), inMut = re.test(r.out);
  /* 🔴 대조군에 이미 그 말이 있으면 **변이 때문이 아니다** — 판정 못 한다. */
  if (inBase) { console.log(`  ✗ ${c.name}
       🔴 **대조군에도 «${c.mustAppear}» 가 있다** — 변이 탓이라 말할 수 없다`); bad++; continue; }
  const ok = c.want ? inMut : !inMut;
  if (!ok) bad++;
  const verdict = c.want
    ? (inMut ? `울었다 — 맨 판엔 없고 변이 판에만 «${c.mustAppear}»` : `🔴 **안 울었다** — 변이를 넣었는데 «${c.mustAppear}» 가 안 나온다`)
    : (inMut ? `어라, 봤다 — 잣대가 내 예상보다 낫다(«${c.mustAppear}» 가 나왔다)` : `🔴 **예상대로 못 봤다** — 이 자의 눈이 먼 자리`);
  console.log(`  ${ok ? "✓" : "✗"} ${c.name}`);
  console.log(`       ${verdict} · 종료코드 ${r.code}(대조군 ${b.code})`);
}

console.log("─".repeat(116));
console.log(`■ 변이 ${cases.length}개 중 **예상대로 ${cases.length - bad}개** · 어긋난 것 ${bad}개`);
console.log("🔴 이 자는 제품을 재지 않는다 — **A 가 고친 자를 잰다.**");
process.exit(bad ? 1 : 0);
