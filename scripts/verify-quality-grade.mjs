/**
 * scripts/verify-quality-grade.mjs — 🔴 **«품질 최고등급»을 숫자로 만든다**
 *   (C · 2026-09-21 · 사장님 지시 «최대한 깔끔하고 편한 UI · 있을 거 다 있는 토스 같은 심플 · **품질은 최고등급**»)
 *
 *   ══ 왜 이 자인가 ══
 *   🔴 «최고등급»이 **말로만 있으면 아무도 못 지킨다.** 지킬 수 있으려면 **틀릴 수 있는 축**이어야 한다.
 *   그래서 새 화면 둘에 대고 «잴 수 있는 것»만 골라 축으로 세웠다.
 *
 *   ══ 🔴 내가 세는 모수(AC-114 — 다음 사람이 수를 맞댈 수 있어야 한다) ══
 *     **내리기** = `public/app/posts.html`(글 시트의 «이 글 내리기»·«신고에 답하기») + `public/js/ui.js` 의 `UI.takedownSheet`
 *     **프록시** = `public/app/accounts.html` 의 «프록시 주소» 칸 + `netlify/functions/ops-proxies.ts`(운영 API)
 *
 *   ══ 재는 축 ══
 *     ① 기다림이 있나            — 첫 화면에 «불러오는 중»이 보이나
 *     ② 🔴 **못 불러왔을 때 화면이 정직한가** — 오류 갈래가 **기다림 자리를 치우고** 다시 갈 길을 주나
 *          (치우지 않으면 손님은 **영원히 도는 뼈대**를 본다 — 흰 화면보다 나쁘다. 화면이 거짓말을 한다)
 *     ③ 빈 상태가 있나 + **그 자리에 갈 데가 있나**
 *     ④ 겁주는 문장 0            — CLAUDE §3(낱말이 통째로 한국어 문장이라 코드 이름과 안 겹친다)
 *     ⑤ 🔴 **마스킹된 값을 되돌려 저장하지 않나** — AC-172 의 **제품 판**
 *          (서버가 가려서 준 값을 화면이 칸에 채우고 그대로 되보내면 **진짜 값이 마스크로 덮인다**)
 *     ⑥ 🔴 **그 기능에 닿을 화면이 있나** — API 만 있고 부르는 화면이 0 이면 그 기능은 **없는 기능**이다(CLAUDE §4.8)
 *
 *   ══ 다른 자가 보는 축(여기서 **겹쳐 재지 않는다**) ══
 *     · 시스템 용어 0        → `verify-people-words.mjs`                 · 🔴 내 손으로 재려다 **세 번** 거짓 빨강을 냈다(아래 «못 만든 축»)
 *     · 단추마다 손이 붙었나 → `verify-hand-on-button.mjs`(브라우저)   · AC-123 — 정적으로 세면 거짓 빨강이 쏟아진다
 *     · 글자 대비 AA        → `verify-contrast.mjs`
 *     · 폰 폭 가로 스크롤 0  → `verify-r9-bleed-browser.mjs`
 *     · 막다른 골목 0        → `verify-r8-deadends.mjs`
 *     `--run` 을 주면 이 넷을 **실제로 돌려** 종료코드를 등급에 접는다. 안 주면 ⊘(«못 쟀음»)로 남긴다.
 *
 *   ══ 🔴 못 만든 축과 까닭(트리거가 «못 만들겠으면 까닭을 적어라»라고 했다) ══
 *     · **8px 그리드** — 못 만들겠다. 이 코드는 `font-size:12.5px`·`13.5px`·`gap:6px` 을 **글자와 미세 간격에
 *       정당하게** 쓴다. «8의 배수»로 재면 **맞는 코드가 빨개지고**, 그런 자는 사람이 곧 무시한다(AC-112 ⑤).
 *       ⇒ 판정하지 않고 **세어서 분포만 찍는다**(사람이 본다 · AC-163 ③ «나란히 놓기»).
 *
 *   ══ 등급 ══
 *     등급 = 통과한 축 ÷ **잰** 축. 🔴 ⊘ 는 **분모에서 뺀다**(«못 쟀음»을 통과로도 낙제로도 세지 않는다 · AC-9).
 *
 *   쓰는 법: node scripts/verify-quality-grade.mjs [--run] [--json]
 *   종료코드: 0 = ✗ 0건 · 1 = ✗ 가 있다 · 2 = 못 쟀다.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const RUN = process.argv.includes("--run");
const JSONOUT = process.argv.includes("--json");
const ALL = process.argv.includes("--all");   /* 🔴 «이 축을 화면 전체에 대 보면» — 두 화면만 고치면 같은 병이 열세 개 남는다 */
const read = (rel) => { const p = path.join(ROOT, rel); return existsSync(p) ? readFileSync(p, "utf8") : null; };

/* HTML 주석은 증거가 아니다(AC-112 의 A 판 · «주석을 증거로 읽음») */
const noComments = (s) => String(s || "").replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/* ── 모수 ─────────────────────────────────────────────────────────────── */
const SCREENS = [
  { key: "내리기", file: "public/app/posts.html", extra: ["public/js/ui.js"], api: ["/api/post-retract", "/api/takedowns"] },
  { key: "프록시", file: "public/app/accounts.html", extra: [], api: ["/api/ops-proxies", "/api/ops-proxy-assign"] },
];

const missing = SCREENS.filter((s) => read(s.file) === null);
if (missing.length) { console.error(`⊘ 못 쟀어요 — 화면 파일이 없다: ${missing.map((m) => m.file).join(" · ")}`); process.exit(2); }

/* ── 축 ───────────────────────────────────────────────────────────────── */
const SYSTEM_WORDS = ["테넌트", "러너 잡", "러너 job", "piece", "gate_report", "tenant", "payload", "endpoint", "slot"];
const SCARY = ["정지됩니다", "불이익", "알려만 드립니다", "알려만 드렸", "고객님 책임", "책임지지 않습니다", "책임이 있습니다"];

/** 🔴 **손님 눈에 닿는 글자만** 뽑는다 — 파일 전체에서 낱말을 찾으면 코드 이름이 걸린다.
 *  실제로 밟았다(2026-09-21 C): 첫 판이 `body: { endpoint: sub.endpoint }` 를 «기계말»로 찍었다.
 *  그건 **서버에 보내는 칸 이름**이지 손님이 읽는 글자가 아니다(AC-112 ⑤ — 거짓 빨강).
 *  ⇒ ㉮ HTML 글 마디 `>…<` ㉯ **한글이 든** 따옴표·백틱 토막 — 이 둘만 본다.
 *  ⚠️ **못 보는 것**: 한글이 하나도 없는 영어 라벨. 그건 이 축이 «못 쟀다»(AC-9). */
function visibleText(src) {
  /* 🔴 **`${…}` 는 글자가 아니라 코드다** — 안 걷으면 `${p.pieceId ? …}` 의 «piece» 가 «기계말»로 찍힌다.
     두 번째로 밟은 같은 병이다(2026-09-21 C · 한 번은 파일 전체, 한 번은 치환 안). 겹을 하나씩 벗겨야 한다. */
  const noSub = (s) => { let t = String(s); for (let i = 0; i < 4; i++) t = t.replace(/\$\{[^{}]*\}/g, " "); return t.replace(/\$\{[\s\S]*?\}/g, " "); };
  const out = [];
  for (const m of src.matchAll(/>([^<>]*[가-힣][^<>]*)</g)) out.push(noSub(m[1]));
  for (const m of src.matchAll(/"([^"\n]*[가-힣][^"\n]*)"|'([^'\n]*[가-힣][^'\n]*)'|`([^`]*[가-힣][^`]*)`/g)) out.push(noSub(m[1] || m[2] || m[3]));
  return out.join("\n");
}

/** `if (!r.ok) …` 의 **그 갈래 몸통만** 잘라 낸다.
 *  🔴 첫 판은 «앞 400자» 창으로 봤다가 **두 줄 아래 성공 갈래의 `render()`** 를 제 것으로 읽고
 *     posts.html 을 초록으로 찍었다 — 같은 고장이 있는데도. AC-113 그 얼굴(창이 옆을 먹는다). */
function bailBlock(src) {
  const i = src.search(/if\s*\(\s*!\s*r\.ok\s*\)/);
  if (i < 0) return null;
  const rest = src.slice(i);
  const b = rest.indexOf("{", rest.indexOf(")"));
  const semi = rest.indexOf(";");
  if (b < 0 || (semi >= 0 && semi < b)) return rest.slice(0, semi < 0 ? 200 : semi + 1);   /* 중괄호 없는 한 문장짜리 */
  let d = 0; for (let k = b; k < rest.length; k++) { if (rest[k] === "{") d++; else if (rest[k] === "}") { d--; if (!d) return rest.slice(b, k + 1); } }
  return rest.slice(b, b + 400);
}

/** 서버가 **가려서** 주는 응답 칸을 `lib/**` 에서 뽑는다 — 손 목록은 낡는다(AC-113). */
function maskedKeys() {
  const out = new Map();
  const walk = (dir) => { for (const e of readdirSync(path.join(ROOT, dir))) { const rel = `${dir}/${e}`; const st = statSync(path.join(ROOT, rel)); if (st.isDirectory()) walk(rel); else if (/\.ts$/.test(rel)) {
    const src = noComments(readFileSync(path.join(ROOT, rel), "utf8"));
    /*  o.proxyUrl = px;  …앞줄에 `const px = maskProxyUrl(...)`  /  `key: maskFoo(...)` 두 모양을 다 본다 */
    for (const m of src.matchAll(/(?:^|[\s{,])(\w+)\s*:\s*(mask\w+)\s*\(/g)) out.set(m[1], `${rel} → ${m[2]}()`);
    for (const m of src.matchAll(/const\s+(\w+)\s*=\s*(mask\w+)\s*\([^)]*\)\s*;[\s\S]{0,120}?\bo\.(\w+)\s*=\s*\1\b/g)) out.set(m[3], `${rel} → ${m[2]}()`);
  } } };
  try { walk("lib"); } catch { /* 못 읽으면 빈 손으로 — ⊘ 가 된다 */ }
  return out;
}
const MASKED = maskedKeys();

/** 그 화면이 **칸에 채우고 되보내는** 키를 찾는다. */
function roundTripped(src) {
  const hits = [];
  const code = noComments(src);
  for (const [key, where] of MASKED) {
    const fills = new RegExp(`<input[^>]*value="\\$\\{[^}]*\\b${key}\\b`).test(code);           /* 칸에 채운다 */
    const sends = new RegExp(`\\b${key}\\s*:\\s*(?!.*\\bmask)`, "").test(code) && new RegExp(`\\b${key}\\s*:`).test(code);
    if (fills && sends) hits.push({ key, where });
  }
  return hits;
}

/** «그 API 를 부르는 화면이 있나» */
function reachedBy(apiPaths) {
  const found = [];
  const walk = (dir) => { for (const e of readdirSync(path.join(ROOT, dir))) { const rel = `${dir}/${e}`; const st = statSync(path.join(ROOT, rel)); if (st.isDirectory()) walk(rel); else if (/\.(html|js|txt)$/.test(rel) && !/\/js\/mock\.js$/.test(rel)) {
    const src = noComments(readFileSync(path.join(ROOT, rel), "utf8"));
    for (const a of apiPaths) if (src.includes(a)) found.push(`${rel} → ${a}`);
  } } };
  try { walk("public"); } catch { return null; }
  return found;
}

/* ── 잰다 ─────────────────────────────────────────────────────────────── */
const rows = [];
const say = (screen, axis, mark, note) => rows.push({ screen, axis, mark, note });

for (const S of SCREENS) {
  const raw = read(S.file);
  const src = noComments(raw);
  const all = src + (S.extra.map((e) => noComments(read(e) || "")).join("\n"));

  /* ① 기다림 */
  const skel = (raw.match(/class="sk"/g) || []).length;
  say(S.key, "① 기다림이 있나", skel ? "✓" : "✗", skel ? `첫 화면에 뼈대 ${skel}개` : "첫 화면에 기다림 표시가 없다 — 손님이 흰 화면을 본다");

  /* ② 🔴 못 불러왔을 때 화면이 정직한가 */
  const loadFn = (src.match(/async function load\s*\([\s\S]*?\n}/) || [""])[0] || src;
  const blk = bailBlock(loadFn);
  /* 🔴 **그 갈래 몸통 안에서만** 본다 — 화면을 다시 그리거나, 다시 부를 문을 주거나 */
  const clears = blk !== null && /(innerHTML|render\s*\(|다시 |새로고침|retry|load\s*\()/.test(blk);
  if (!skel) say(S.key, "② 못 불러왔을 때 화면이 정직한가", "⊘", "기다림 자리가 없어 «치우나»를 물을 수 없다(모수 0 — 통과로 세지 않는다)");
  else if (blk === null) say(S.key, "② 못 불러왔을 때 화면이 정직한가", "⊘", "첫 불러오기의 오류 갈래를 못 찾았다 — **못 쟀음**(AC-9)");
  else say(S.key, "② 못 불러왔을 때 화면이 정직한가", clears ? "✓" : "✗",
    clears ? `오류 갈래가 기다림 자리를 치운다 — \`${blk.replace(/\s+/g, " ").slice(0, 60)}\``
      : `🔴 **오류면 잠깐 뜨는 알림 하나 띄우고 돌아간다** — 뼈대 ${skel}개가 그대로 남아 손님은 **영원히 도는 화면**을 본다(다시 누를 곳도 없다) · 그 갈래 전부: \`${blk.replace(/\s+/g, " ").slice(0, 72)}\``);

  /* ③ 빈 상태 + 갈 데
     🔴 «갈 데»는 **문만이 아니다.** 빈 상태가 «위에서 채널 마크를 누르면 바로 연결할 수 있어요»처럼
        **이 화면에서 할 일을 가리키면** 그것도 갈 데다. 첫 판은 단추만 세다가 맞는 화면을 빨갛게 찍었다. */
  const blocks = [...src.matchAll(/class="empty"[\s\S]{0,500}?<\/div>/g)].map((m) => m[0]);
  const withWay = blocks.filter((b) => /class="btn|href="/.test(b) || /누르면|눌러|골라|해 보세요|확인해|연결할 수 있어요|만들어 보세요/.test(b));
  say(S.key, "③ 빈 상태 + 갈 데가 있나", !blocks.length ? "✗" : withWay.length === blocks.length ? "✓" : "✗",
    !blocks.length ? "빈 상태 문장이 없다" : withWay.length === blocks.length ? `빈 상태 ${blocks.length}곳 · 모두 갈 데(문 또는 «어디를 누르면») 가 붙어 있다` : `빈 상태 ${blocks.length}곳 중 ${blocks.length - withWay.length}곳에 **갈 데가 없다**(막다른 골목)`);

  /* ④⑤ 는 🔴 **못 만들겠다** — 아래 «못 만든 축»에 까닭을 적고 `verify-people-words.mjs` 에 넘긴다.
     다만 **겁주는 말**은 낱말이 통째로 한국어 문장이라 코드 이름과 겹칠 일이 없다 — 이것만 남긴다. */
  const vis = visibleText(all);
  const scary = SCARY.filter((w) => vis.includes(w));
  say(S.key, "④ 겁주는 문장 0", scary.length ? "✗" : "✓", scary.length ? `겁주는 말 — ${scary.map((w) => `«${w}»`).join(" · ")}` : `겁주는 말 0 (손님 눈에 닿는 글자 ${vis.length}자에서 ${SCARY.length}개 문장을 뒤졌다)`);

  /* ⑤ 🔴 마스킹 되돌리기 */
  if (!MASKED.size) say(S.key, "⑤ 마스킹된 값을 되돌려 저장하지 않나", "⊘", "서버가 가려서 주는 칸을 하나도 못 찾았다 — **못 쟀음**(모수 0)");
  else { const rt = roundTripped(src);
    say(S.key, "⑤ 마스킹된 값을 되돌려 저장하지 않나", rt.length ? "✗" : "✓",
      rt.length ? `🔴 **${rt.map((h) => `«${h.key}»`).join(" · ")} — 서버가 가려서 준 값을 칸에 채우고 그대로 되보낸다**(${rt[0].where}) · 저장할 때마다 진짜 값이 마스크로 덮인다`
        : `가려서 주는 칸 ${MASKED.size}개(${[...MASKED.keys()].join("·")}) 중 되보내는 것 0`);
  }

  /* ⑥ 닿을 화면이 있나 */
  const reach = reachedBy(S.api);
  if (reach === null) say(S.key, "⑥ 그 기능에 닿을 화면이 있나", "⊘", "public/ 을 못 읽었다");
  else say(S.key, "⑥ 그 기능에 닿을 화면이 있나", reach.length ? "✓" : "✗",
    reach.length ? `${reach.length}곳이 부른다 — ${reach.slice(0, 2).join(" · ")}` : `🔴 **${S.api.join(" · ")} 를 부르는 화면이 0곳** — 만들어 놓고 아무도 못 쓴다(CLAUDE §4.8 «API 로만 실증한 기능은 없는 기능»)`);
}

/* ── 넘기는 축 ────────────────────────────────────────────────────────── */
const HANDOFF = [
  ["시스템 용어 0 (기계말)", "scripts/verify-people-words.mjs"],
  ["단추마다 손이 붙었나", "scripts/verify-hand-on-button.mjs"],
  ["글자 대비 AA", "scripts/verify-contrast.mjs"],
  ["폰 폭 가로 스크롤 0", "scripts/verify-r9-bleed-browser.mjs"],
  ["막다른 골목 0", "scripts/verify-r8-deadends.mjs"],
];
for (const [axis, script] of HANDOFF) {
  if (!existsSync(path.join(ROOT, script))) { say("두 화면", axis, "⊘", `그 자가 없다(${script})`); continue; }
  if (!RUN) { say("두 화면", axis, "⊘", `**못 쟀음** — 그 자를 안 돌렸다. \`--run\` 을 주면 돌린다(${path.basename(script)})`); continue; }
  try { execFileSync(process.execPath, [path.join(ROOT, script)], { cwd: ROOT, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] });
    say("두 화면", axis, "✓", `${path.basename(script)} 종료코드 0`);
  } catch (e) { say("두 화면", axis, e.status === 2 ? "⊘" : "✗", `${path.basename(script)} 종료코드 ${e.status ?? "?"}${e.status === 2 ? "(그 자가 «못 쟀음»이라 했다)" : ""}`); }
}

/* ── 🔴 못 만든 축 — 세기만 한다 ──────────────────────────────────────── */
const gridNote = (() => {
  const px = [];
  for (const S of SCREENS) for (const m of noComments(read(S.file)).matchAll(/(?:margin|padding|gap|top|bottom|left|right)\s*:\s*([^;"']+)/g))
    for (const v of m[1].matchAll(/(-?\d+(?:\.\d+)?)px/g)) px.push(Math.abs(Number(v[1])));
  const on = px.filter((v) => v % 8 === 0).length, four = px.filter((v) => v % 8 !== 0 && v % 4 === 0).length;
  return { total: px.length, on, four, other: px.length - on - four };
})();

/* ── 🔴 --all : ①②③ 축을 **화면 전체**에 대 본다 ──────────────── */
let sweep = null;
if (ALL) {
  const seen = [], stuck = [], unmeasured = [], noSkel = [];
  for (const dir of ["public/app", "public/ops"]) { for (const e of readdirSync(path.join(ROOT, dir))) {
    if (!/\.html$/.test(e)) continue;
    const rel = `${dir}/${e}`, raw = read(rel), src = noComments(raw);
    const sk = (raw.match(/class="sk"/g) || []).length;
    if (!sk) { noSkel.push(rel); continue; }
    seen.push(rel);
    const lf = (src.match(/async function load\s*\([\s\S]*?\n}/) || [""])[0] || src;
    const blk = bailBlock(lf);
    if (blk === null) { unmeasured.push(rel); continue; }
    if (!/(innerHTML|render\s*\(|다시 |새로고침|retry|load\s*\()/.test(blk)) stuck.push(rel);
  } }
  sweep = { seen, stuck, unmeasured, noSkel };
}

/* ── 찍는다 ───────────────────────────────────────────────────────────── */
if (JSONOUT) { console.log(JSON.stringify({ rows, grid: gridNote }, null, 2)); }
else {
  console.log(`🔴 «품질 최고등급»을 숫자로 — 새 화면 둘 · ${new Date().toISOString()}`);
  console.log("═".repeat(122));
  console.log("■ 내가 세는 모수");
  for (const S of SCREENS) console.log(`   ${S.key} = ${S.file}${S.extra.length ? " + " + S.extra.join(" + ") : ""} (API ${S.api.join(" · ")})`);
  console.log(`   서버가 **가려서** 주는 응답 칸 ${MASKED.size}개를 \`lib/**\` 에서 뽑았다: ${[...MASKED.keys()].join(" · ") || "(없음)"}`);
  console.log("");
  let cur = "";
  for (const r of rows) { if (r.screen !== cur) { console.log(`── ${r.screen} ──`); cur = r.screen; } console.log(`  ${r.mark} ${r.axis.padEnd(34)} ${r.note}`); }
  console.log("");
  console.log("── 🔴 못 만든 축(까닭을 적는다) ──");
  console.log(`  ⊘ **시스템 용어 0 을 내 손으로 재는 것** — 못 만들겠다. HTML+JS 한 파일에서 «손님이 읽는 글자»만 뽑는 일을`);
  console.log(`     이 판에 **세 번** 시도했고 세 번 다 거짓 빨강을 냈다: ①파일 전체를 뒤져 \`body:{endpoint:…}\` 를 잡았고`);
  console.log(`     ②\`\${…}\` 치환 안의 \`p.pieceId\` 에서 «piece» 를 잡았고 ③백틱 한 덩이가 **여러 줄의 코드를 품어** «tenant»·«slot» 을 잡았다.`);
  console.log(`     ⇒ \`verify-people-words.mjs\` 는 이 함정을 **낱말 고르기로** 피해 놨다 — «테넌트»·«러너 잡»·«piece 를» 처럼`);
  console.log(`     **코드 이름이 될 수 없는 것**만 센다. 겹쳐 만들지 않고 그 자에 넘긴다(위 «넘기는 축»).`);
  console.log(`  ⊘ 8px 그리드 — **판정하지 않는다.** 이 코드는 6px·12.5px 을 글자·미세 간격에 정당하게 쓴다.`);
  console.log(`     «8의 배수»로 재면 맞는 코드가 빨개지고, 그런 자는 사람이 곧 무시한다(AC-112 ⑤). **세어서 분포만 둔다**:`);
  console.log(`     두 화면의 여백 값 ${gridNote.total}개 — 8의 배수 ${gridNote.on} · 4의 배수(8 아님) ${gridNote.four} · 그 밖 ${gridNote.other}`);
  console.log("═".repeat(122));
  const n = (m) => rows.filter((r) => r.mark === m).length;
  const judged = n("✓") + n("✗");
  console.log(`■ 축 ${rows.length}개 — ✓ ${n("✓")} · 🔴 ✗ ${n("✗")} · ⊘ ${n("⊘")}`);
  console.log(`■ 🔴 **등급 = ${judged ? Math.round((n("✓") / judged) * 100) : 0}점** (통과 ${n("✓")} ÷ **잰** 축 ${judged}) — ⊘ ${n("⊘")}개는 분모에서 뺐다(«못 쟀음»을 통과로도 낙제로도 세지 않는다 · AC-9)`);
  if (!RUN) console.log(`   \`--run\` 을 주면 넘긴 축 ${HANDOFF.length}개를 실제로 돌려 등급에 접는다.`);
  if (sweep) {
    console.log("");
    console.log("── 🔴 ② 축을 **화면 전체**에 대 본다(--all) ──");
    console.log(`   기다림(뼈대)을 그리는 화면 **${sweep.seen.length}개** · 그리지 않는 화면 ${sweep.noSkel.length}개(모수 밖)`);
    console.log(`   🔴 **못 불러오면 뼈대가 영원히 남는 화면 ${sweep.stuck.length}개** · 치우는 화면 ${sweep.seen.length - sweep.stuck.length - sweep.unmeasured.length}개 · ⊘ 못 재음 ${sweep.unmeasured.length}개`);
    for (const f of sweep.stuck) console.log(`      · ${f}`);
    if (sweep.unmeasured.length) console.log(`      ⊘ 첫 불러오기의 오류 갈래를 못 찾은 화면: ${sweep.unmeasured.join(" · ")}`);
  }
}
process.exit(rows.some((r) => r.mark === "✗") ? 1 : 0);
