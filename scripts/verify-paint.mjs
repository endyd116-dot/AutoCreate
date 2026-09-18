/**
 * scripts/verify-paint.mjs — 🔴 **«손님 눈에 정말 칠해지나»를 픽셀로 잰다**(C · 수리 라운드 2026-09-19).
 *   사용: node scripts/verify-paint.mjs           (판정)
 *         node scripts/verify-paint.mjs --headed  (눈으로 보면서)
 *
 *   ══ 왜 이 자가 있나 — CSS 한 줄은 어떤 정적 검사로도 못 잡는다 ══
 *   2026-09-19 시나리오 A 가 «첫 손님»으로 걸어 보니 **가입 화면의 약관 체크박스가 화면에 하나도 없었다.**
 *   손님은 «네 가지 약관에 모두 동의해 주세요»라는 말을 듣는데 **동의할 네모가 안 보인다.**
 *   🔴 그런데 마크업도 JS 도 API 도 서버 기록(`consents` 4행)도 **전부 맞다.** `tsc` 0 · `verify-r8-deadends` 135/0.
 *   원인은 `public/css/ac.css` 에 `.chk` 블록이 **두 번** 있고(257~262 · 301~306) 특이도가 같아 **속성별로 뒤가 이기는데**,
 *   `opacity:0`(258)만 뒷 블록이 다시 선언하지 않아 **살아남아** 22×22 네모가 **투명하게** 그려진 것이다.
 *   ⇒ **«규칙이 파일에 있나»로는 영원히 못 잡는다.** 칠해진 픽셀을 세야 잡힌다.
 *
 *   ══ 무엇을 세는가 — 두 가지만 본다 ══
 *   ① **보이나** — 그 컨트롤 자리를 찍어 **가장 흔한 색이 아닌 픽셀**(=칠해진 획)이 몇 개인가. 0이면 «없는 것»이다.
 *   ② **켜지면 달라 보이나** — 눌러서 켠 뒤 같은 자리를 다시 찍어 **그림이 바뀌는가.**
 *      🔴 ②가 없으면 «네모는 보이는데 켜졌는지 모르는» 화면을 통과시킨다.
 *
 *   ══ 🔴 손 목록이 없다(AC-108) ══
 *   `public/**\/*.html` 을 **폴더째 훑어** 켜고 끄는 컨트롤(`input[type=checkbox]`·`input[type=radio]`)이
 *   있는 화면을 스스로 찾는다. 새 화면이 생기면 **자동으로 재는 대상이 된다.**
 *
 *   ══ 🔴 이 자가 **아직 못 하는 것**(못으로 박아 둔다 · AC-109 ㉰) ══
 *   · 로그인이 필요한 화면(`/app/**`·`/ops/**`)은 **빈 껍데기로** 뜬다 — 거기 있는 컨트롤은 «못 쟀음»으로 적는다.
 *     (`register.html`·`login.html` 처럼 로그인 전 화면은 그대로 잰다 — 🔴 **첫 손님이 보는 화면이 거기다.**)
 *   · 다크 모드·다른 폭은 안 본다. 지금 잡은 병은 폭과 무관하다.
 *   · «보인다»가 «읽힌다»는 아니다 — 대비(명암)는 `verify-contrast.mjs` 몫이다.
 *
 *   종료코드: 0 = 다 칠해진다 · 1 = 안 보이는 컨트롤이 있다 · 2 = 못 쟀다(playwright 없음 등).
 */
import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { requirePlaywright } from "./lib/find-playwright.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const HEADED = process.argv.includes("--headed");
if (!existsSync(PUB)) { console.error("⊘ 못 쟀어요 — public/ 이 없습니다."); process.exit(2); }

const out = [];
const rec = (step, ok, note = "") => { out.push({ step, ok, note }); console.log(`  ${ok === "unmeasured" ? "⊘" : ok ? "✓" : "✗"} ${step}${note ? `  — ${note}` : ""}`); return ok; };
const unmeasured = (step, why) => rec(step, "unmeasured", why);

/* ═══ 대상 화면을 **폴더에서** 고른다 — 손 목록 0 ═══ */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const CONTROL_RE = /<input[^>]*type\s*=\s*["'](?:checkbox|radio)["']/i;
const pages = walk(PUB)
  .filter((f) => CONTROL_RE.test(readFileSync(f, "utf8")))
  .map((f) => "/" + path.relative(PUB, f).replace(/\\/g, "/"));
/** 로그인 뒤 화면은 빈 껍데기로 뜬다 — 재면 «없다»가 나와 **거짓 빨강**이 된다. 갈라 둔다. */
const needsLogin = (p) => p.startsWith("/app/") || p.startsWith("/ops/");

/* ═══ 정적 서버 ═══ */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  let p = path.join(PUB, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(PUB)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404, { "content-type": "application/json" }).end("{}"); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ═══ 🔴 칠해진 픽셀 세기 ═══
   찍은 PNG 를 **브라우저 안으로 되돌려** canvas 로 풀어 센다(노드에 PNG 해독기를 안 들인다).
   «칠해진 획» = **가장 흔한 색이 아닌 픽셀**. 투명하게 그려지면 그 자리가 배경 한 색이라 0 이 된다. */
const COUNT_IN_PAGE = async (b64) => {
  const img = new Image();
  img.src = "data:image/png;base64," + b64;
  await img.decode();
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const tally = new Map();
  let sig = 0;
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i] << 24 | d[i + 1] << 16 | d[i + 2] << 8 | d[i + 3]) >>> 0;
    tally.set(k, (tally.get(k) ?? 0) + 1);
    sig = (sig * 31 + k) >>> 0;
  }
  let top = 0;
  for (const v of tally.values()) if (v > top) top = v;
  const total = d.length / 4;
  return { total, painted: total - top, colors: tally.size, sig };
};

/** 그 요소 자리를 찍어 «칠해진 획»을 센다. 크기가 0이면 잴 것도 없다. */
async function paintOf(page, handle) {
  /* 🔴 **먼저 화면 안으로 굴려 온다** — 접힌 아래에 있으면 찍는 자리가 «화면 밖»이라 playwright 가 던진다.
     처음 돌렸을 때 `/register.html`(약관 네모 넷 — **이 일의 본체**)이 바로 그 이유로 통째로 «못 열었다»가 됐다. */
  await handle.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { /* 못 굴려도 아래에서 크기로 가른다 */ });
  const box = await handle.boundingBox();
  if (!box || box.width < 1 || box.height < 1) return { zero: true, painted: 0, colors: 0, sig: 0, box };
  const vp = page.viewportSize() ?? { width: 390, height: 844 };
  const pad = 2;
  /* 찍는 자리를 화면 안으로 자른다 — 밖으로 한 픽셀만 나가도 던진다. */
  const x = Math.max(0, Math.min(box.x - pad, vp.width - 1));
  const y = Math.max(0, Math.min(box.y - pad, vp.height - 1));
  const width = Math.max(1, Math.min(box.width + pad * 2, vp.width - x));
  const height = Math.max(1, Math.min(box.height + pad * 2, vp.height - y));
  let png;
  try { png = await page.screenshot({ clip: { x, y, width, height } }); }
  catch (e) { return { zero: true, painted: 0, colors: 0, sig: 0, box, shotFailed: String(e.message).slice(0, 60) }; }
  const r = await page.evaluate(COUNT_IN_PAGE, png.toString("base64"));
  return { zero: false, ...r, box };
}

const pw = await requirePlaywright();
const browser = await pw.chromium.launch({ headless: !HEADED });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul", deviceScaleFactor: 2 });

console.log(`\n«손님 눈에 정말 칠해지나» — 칠해진 픽셀로 잰다 · ${new Date().toISOString()}`);
console.log(`대상 화면 ${pages.length}개(폴더에서 스스로 찾았다 · 손 목록 0)`);

/* 🔴 **이 자가 무엇을 세어 그 수가 나왔는지 스스로 찍는다**(메인 지시 2026-09-19).
   같은 것을 **다른 모수**로 세어 서로 다른 수를 말하는 병이 이 리포에서 오늘만 세 번째다.
   실제로 한 번 갈렸다 — 나는 «16곳 중 14곳», A 는 «10곳». **둘 다 내부적으로 맞았고 모수만 달랐다**:
     · 내 16 = `public/**` 의 `class="chk"` **전부**(서빙 안 되는 정본 `app/_tpl.txt` 5곳 포함)
     · A 의 11 = **실제로 서빙되는 화면**만(정본 제외) · 그중 `<i>` 마크업 1곳은 이미 보이고 있었다 → 10
     · 산수: 14 − 10 = 4 = `_tpl.txt` 의 5 − 그중 `<i>` 1.
   ⇒ 이제 **자가 제 모수를 적는다.** 수를 말할 거면 «무엇을 세었나»를 같이 말해야 한다(AC-109 ㉮). */
{
  const chkFiles = [];
  for (const f of walk(PUB).concat(readdirSync(path.join(PUB, "app"), { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".txt")).map((e) => path.join(PUB, "app", e.name)))) {
    const src = readFileSync(f, "utf8");
    const n = (src.match(/class="chk"/g) ?? []).length;
    if (!n) continue;
    const withI = (src.match(/class="chk"[^>]*><input[^>]*><i>/g) ?? []).length;
    chkFiles.push({ file: "/" + path.relative(PUB, f).replace(/\\/g, "/"), n, withI, served: f.endsWith(".html") });
  }
  const total = chkFiles.reduce((s, c) => s + c.n, 0);
  const servedN = chkFiles.filter((c) => c.served).reduce((s, c) => s + c.n, 0);
  console.log(`\n■ 내가 세는 모수 — \`class="chk"\` **${total}곳** (서빙되는 화면 ${servedN}곳 + 서빙 안 되는 정본 ${total - servedN}곳)`);
  for (const c of chkFiles) console.log(`   ${c.served ? "화면" : "정본"}  ${c.file.padEnd(24)} ${c.n}곳${c.withI ? ` (그중 <i> 마크업 ${c.withI})` : ""}`);
  console.log(`   🔴 아래 «본 판정»이 실제로 브라우저로 여는 것은 **서빙되는 화면 중 로그인 전 것**뿐이다 — 나머지는 ⊘ 로 적는다.`);
}
console.log("─".repeat(112));

/** 화면 하나를 재고 [{sel, painted, changed}] 를 돌려준다. */
async function measurePage(url, { mutateCss = null } = {}) {
  const page = await context.newPage();
  page.on("pageerror", () => { /* 로그인 뒤 화면은 API 401 로 던진다 — 픽셀만 본다 */ });
  await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(250);
  if (mutateCss) await page.addStyleTag({ content: mutateCss });
  await page.waitForTimeout(80);
  const handles = await page.$$('input[type="checkbox"], input[type="radio"]');
  const rows = [];
  for (const h of handles) {
    if (!(await h.isVisible().catch(() => false)) && !(await h.boundingBox())) { /* 아예 없는 것도 잰다 */ }
    const before = await paintOf(page, h);
    /* 눌러서 켠다 — label 이 감싸고 있으면 label 을 눌러야 켜진다(마크업을 짐작하지 않는다). */
    await h.evaluate((el) => { el.checked = !el.checked; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForTimeout(60);
    const after = await paintOf(page, h);
    const id = await h.evaluate((el) => el.getAttribute("name") || el.getAttribute("id") || el.className || "(이름없음)");
    rows.push({ id, painted: before.painted, zero: before.zero, changed: before.sig !== after.sig, colors: before.colors });
  }
  await page.close();
  return rows;
}

/* ═══ ⓪ 자기 찌르기 — 🔴 이 자가 정말 우는가를 **먼저** 본다(AC-108) ═══
   멀쩡한 컨트롤에 `opacity:0` 을 씌워 «안 보이게» 만들고, 이 자가 그걸 빨갛게 보는지 확인한다.
   ⓪ 가 초록이 아니면 아래 판정은 **믿을 값이 없다.** */
{
  /* 🔴 **제품의 컨트롤을 대조군으로 쓰면 안 된다** — 첫 판에서 `/login.html` 을 골랐는데
     그 화면의 유일한 네모가 **바로 지금 망가진 그것**이라, «그대로 0 → 눈가림 뒤 0» 이 나와
     ⓪ 가 빨개졌다. 🔴 **제품이 고장 났다고 자가 스스로를 못 믿게 되면 안 된다.**
     ⇒ 대조군은 **내가 심은, 반드시 보이는 네모**다. 이건 제품 상태와 무관하게 늘 같다. */
  const probe = await context.newPage();
  await probe.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
  const PLANT = `<label style="display:block;padding:20px"><input id="__probe" type="checkbox"
      style="appearance:none;-webkit-appearance:none;width:22px;height:22px;border:2px solid #111;background:#fff;display:block"></label>`;
  const measureProbe = async (css) => {
    await probe.evaluate((html) => { document.body.insertAdjacentHTML("afterbegin", html); }, PLANT);
    if (css) await probe.addStyleTag({ content: css });
    await probe.waitForTimeout(80);
    const h = await probe.$("#__probe");
    const r = await paintOf(probe, h);
    await probe.evaluate(() => { document.querySelector("#__probe")?.closest("label")?.remove(); });
    return r;
  };
  const good = await measureProbe(null);
  rec("⓪a 자기 찌르기 — **반드시 보이는 네모**를 심으면 칠해진 획이 잡힌다(대조군)", good.painted > 0,
    `심은 네모의 칠해진 획 ${good.painted}px · 색 ${good.colors}가지`);
  const blind = await measureProbe("#__probe{opacity:0 !important}");
  rec("⓪b 자기 찌르기 — 그 네모에 `opacity:0` 을 씌우면 **획이 사라진다**(이 자가 오늘 병을 본다)",
    good.painted > 0 && blind.painted === 0, `눈가림 뒤 획 ${blind.painted}px`);
  const gone = await measureProbe("#__probe{display:none !important}");
  rec("⓪c 자기 찌르기 — `display:none` 도 본다(크기 0 을 «칠해졌다»로 세지 않는다)", gone.zero || gone.painted === 0,
    gone.zero ? "크기 0 으로 잡힌다" : `획 ${gone.painted}px`);
  await probe.close();
}

/* ═══ ⓵ 뿌리를 잰다 — **`.chk` 규칙 자체가 무엇을 그리나** ═══
   위 ① 은 «그 화면에서 보이나»를 잰다. 그런데 로그인 뒤 화면(`/app/**`·`/ops/**`)은 빈 껍데기로 떠서 못 잰다.
   🔴 그 구멍을 뿌리로 메운다 — 리포에 실제로 있는 **`.chk` 마크업 모양**을 뽑아 `ac.css` 만 걸고 혼자 그려 본다.
   ⇒ 로그인과 무관하게 «이 앱의 네모는 칠해지나»가 잡힌다. **16곳이 한 축으로 닫힌다.**
   🔴 모양이 **두 벌**이라는 것도 여기서 드러난다:
     · `<input><i></i>`  — 옛 방식(`ac.css:259` 의 `<i>` 가 네모를 그린다) · `app/settings.html` 이 이 모양
     · `<input>` 만       — 새 방식(`ac.css:302` 의 input 자신이 네모) · `register.html` 이 이 모양
   두 벌이 한 스타일시트 안에서 싸우는 것이 이번 병의 뿌리다. */
{
  const shapes = new Map();   // hasI → { html, from }
  for (const f of walk(PUB)) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/<label[^>]*class="chk"[^>]*>([\s\S]{0,300}?)<\/label>/g)) {
      const inner = m[1];
      if (!/<input/.test(inner)) continue;
      const hasI = /<i\s*>\s*<\/i>|<i\/?>/.test(inner);
      if (!shapes.has(hasI)) shapes.set(hasI, { html: m[0], from: "/" + path.relative(PUB, f).replace(/\\/g, "/") });
    }
  }
  if (!shapes.size) unmeasured("⓵ 뿌리 — `.chk` 마크업 모양", "리포에서 `.chk` 라벨을 못 찾았다");
  for (const [hasI, s] of shapes) {
    const page = await context.newPage();
    await page.goto(BASE + "/register.html", { waitUntil: "domcontentloaded" });
    await page.evaluate((html) => { document.body.innerHTML = `<div style="padding:24px">${html}</div>`; }, s.html);
    await page.waitForTimeout(120);
    const h = await page.$(".chk input");
    if (!h) { unmeasured(`⓵ 뿌리 — \`.chk\` ${hasI ? "«<i> 있는»" : "«<i> 없는»"} 모양`, "심은 마크업에서 input 을 못 찾았다"); await page.close(); continue; }
    /* 「보이는 네모」는 input 일 수도 <i> 일 수도 있다 — **둘 중 큰 쪽**을 본다(마크업을 짐작하지 않는다). */
    const target = hasI ? (await page.$(".chk i")) ?? h : h;
    const off = await paintOf(page, target);
    await h.evaluate((el) => { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForTimeout(80);
    const on = await paintOf(page, target);
    rec(`⓵ 뿌리 — \`.chk\` ${hasI ? "«<i> 있는»" : "«<i> 없는»"} 모양이 칠해지고 켜면 달라진다  (${s.from})`,
      !off.zero && off.painted > 0 && off.sig !== on.sig,
      off.zero ? "크기 0" : `끈 상태 획 ${off.painted}px → 켠 상태 ${on.painted}px · ${off.sig !== on.sig ? "달라진다" : "🔴 안 달라진다"}`);
    await page.close();
  }
}

/* ═══ ⓶ 🔴 **«절대 화면에 뜨면 안 되는 낱말»** — 누가 봐도 사고인 것만 ═══
   시나리오 A 가 «화면에 영어 식별자가 새는지»를 물었다. 🔴 **그건 못 잰다** — `piece`·`slot` 같은 낱말은
   **우리 코드 이름이면서 동시에 손님에게 보여도 되는 말**일 수 있어 기계가 못 가른다. 그건 «못 쟀음»으로 둔다.
   대신 **누가 봐도 사고인 것**만 좁게 잰다 — `undefined` · `NaN` · `[object Object]` · `null` 같은 것.
   이건 뜻이 하나뿐이라 거짓 빨강이 안 난다.
   🔴 **글자로 뜨는 것**과 **속성값에 든 것**을 가른다(메인 지시) — `title="undefined"` 는 눈엔 안 보여도 같은 사고고,
   **뜨는 쪽이 더 급하다.** 그래서 뜨는 것만 판정하고 속성 쪽은 «△ 살펴볼 것»으로 찍는다. */
{
  const ACCIDENT = ["undefined", "NaN", "[object Object]", "[Object]"];
  const visible = [];
  const inAttr = [];
  for (const url of pages.filter((p) => !needsLogin(p))) {
    const page = await context.newPage();
    page.on("pageerror", () => { /* 픽셀·글자만 본다 */ });
    try {
      await page.goto(BASE + url, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(250);
      const found = await page.evaluate((words) => {
        const out = { text: [], attr: [] };
        /* ① 손님 눈에 **글자로** 뜨는 것 — 보이는 요소의 텍스트만 본다(script·style 제외). */
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const p = n.parentElement;
          if (!p || ["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(p.tagName)) continue;
          const cs = getComputedStyle(p);
          if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
          const t = (n.nodeValue || "").trim();
          if (!t) continue;
          for (const w of words) if (t.includes(w)) out.text.push({ word: w, snip: t.slice(0, 60), tag: p.tagName });
        }
        /* ② 속성값에 든 것 — 눈엔 안 보이지만 같은 사고다. */
        for (const el of document.querySelectorAll("*")) {
          for (const a of el.attributes) {
            for (const w of words) if (String(a.value).includes(w)) out.attr.push({ word: w, attr: a.name, tag: el.tagName, snip: String(a.value).slice(0, 40) });
          }
        }
        return out;
      }, ACCIDENT);
      for (const t of found.text) visible.push({ url, ...t });
      for (const a of found.attr) inAttr.push({ url, ...a });
    } catch (e) { console.log(`  ⊘ ${url} — 사고 낱말을 못 쟀다: ${String(e.message).slice(0, 60)}`); }
    await page.close();
  }
  /* 🔴 **초록이 나왔으면 «울 수 있나»부터 증명한다** — 안 그러면 «태어나자마자 초록»이다(AC-108).
     사고 낱말을 **일부러 심어** 이 축이 그걸 보는지, 그리고 **숨긴 것은 안 세는지**(거짓 빨강 방지) 확인한다. */
  {
    const probe = await context.newPage();
    await probe.goto(BASE + "/login.html", { waitUntil: "domcontentloaded" });
    const scan = async () => probe.evaluate((words) => {
      const out = [];
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const p = n.parentElement;
        if (!p || ["SCRIPT", "STYLE", "TEMPLATE", "NOSCRIPT"].includes(p.tagName)) continue;
        const cs = getComputedStyle(p);
        if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
        for (const x of words) if ((n.nodeValue || "").includes(x)) out.push(x);
      }
      return out;
    }, ACCIDENT);
    await probe.evaluate(() => { document.body.insertAdjacentHTML("afterbegin", `<p id="__acc">값: undefined</p>`); });
    const seen = await scan();
    await probe.evaluate(() => { document.querySelector("#__acc").style.display = "none"; });
    const hidden = await scan();
    await probe.evaluate(() => { document.querySelector("#__acc")?.remove(); });
    rec("⓪d 자기 찌르기 — **사고 낱말을 심으면 잡는다**(이 축이 빈 초록이 아니다)", seen.includes("undefined"), `심은 뒤 «${seen.join(",") || "못 봄"}»`);
    rec("⓪e 자기 찌르기 — **숨긴 것은 안 센다**(손님 눈에 안 보이면 이 축 밖 · 거짓 빨강 방지)", !hidden.includes("undefined"), `숨긴 뒤 «${hidden.join(",") || "안 봄"}»`);
    await probe.close();
  }

  rec("⓶ 🔴 손님 눈에 **사고 낱말**(undefined·NaN·[object Object])이 글자로 뜨지 않는다", visible.length === 0,
    visible.length ? `뜨는 자리 ${visible.length}곳` : `로그인 전 화면 ${pages.filter((p) => !needsLogin(p)).length}개에서 0곳`);
  for (const v of visible) console.log(`   🔴 ${v.url}  <${v.tag}> 안에 «${v.word}» — «${v.snip}»`);
  if (inAttr.length) {
    console.log(`\n△ 살펴볼 것 — **속성값**에 든 사고 낱말(눈엔 안 보이지만 같은 사고 · 판정 밖):`);
    for (const a of inAttr.slice(0, 12)) console.log(`   · ${a.url}  <${a.tag} ${a.attr}="…${a.snip}…">  «${a.word}»`);
    if (inAttr.length > 12) console.log(`   · … 그 밖 ${inAttr.length - 12}곳`);
  }
  unmeasured("⓶ «영어 식별자가 새나»", "`piece`·`slot` 같은 낱말은 **코드 이름이면서 손님말일 수도** 있어 기계가 못 가른다 — 억지로 올리면 거짓 빨강이 쏟아진다(AC-95)");
}

/* ═══ ① 본 판정 ═══ */
let badTotal = 0, okTotal = 0, unmeasuredTotal = 0;
const badDetail = [];
for (const url of pages) {
  let rows;
  try { rows = await measurePage(url); }
  catch (e) { unmeasuredTotal++; console.log(`  ⊘ ${url} — 못 열었다: ${String(e.message).slice(0, 80)}`); continue; }
  if (!rows.length) {
    /* 마크업엔 있는데 화면엔 안 뜬다 — 로그인 뒤 화면이면 «못 쟀음», 아니면 그 자체가 결함이다. */
    if (needsLogin(url)) { unmeasuredTotal++; console.log(`  ⊘ ${url} — 로그인 뒤 화면이라 컨트롤이 안 그려졌다(못 쟀음 · 통과 아님)`); }
    else { badTotal++; badDetail.push({ url, id: "(전부)", why: "마크업엔 있는데 화면에 하나도 안 그려졌다" }); }
    continue;
  }
  for (const r of rows) {
    if (r.zero || r.painted === 0) { badTotal++; badDetail.push({ url, id: r.id, why: r.zero ? "크기가 0 이다" : "칠해진 획이 0 — 손님 눈에 안 보인다" }); }
    else if (!r.changed) { badTotal++; badDetail.push({ url, id: r.id, why: `보이기는 한다(획 ${r.painted}px) — 그런데 **켜도 그림이 안 바뀐다**` }); }
    else okTotal++;
  }
}

console.log("─".repeat(112));
rec("🔴 켜고 끄는 컨트롤이 **손님 눈에 보이고, 켜면 달라 보인다**", badTotal === 0,
  badTotal ? `안 보이거나 표시가 안 나는 컨트롤 ${badTotal}개 (멀쩡한 것 ${okTotal}개)` : `${okTotal}개 전부 보이고 켜면 달라진다`);
for (const b of badDetail) console.log(`   🔴 ${b.url}  [${b.id}]  ${b.why}`);
if (unmeasuredTotal) console.log(`\n⊘ 못 쟀음 ${unmeasuredTotal}화면 — **통과가 아니다**(로그인 뒤 화면은 빈 껍데기로 뜬다 · AC-9)`);

await browser.close();
server.close();

const fails = out.filter((o) => o.ok === false);
const unk = out.filter((o) => o.ok === "unmeasured");
console.log(`\nPASS ${out.filter((o) => o.ok === true).length} · FAIL ${fails.length} · ⊘ ${unk.length + unmeasuredTotal}`);
console.log("🔴 이 자는 «보이나»만 잰다 — 읽히나(대비)는 `verify-contrast.mjs` 몫이다.\n");
process.exit(fails.length ? 1 : 0);
