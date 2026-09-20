/**
 * verify-keyin-notice-shown — «카드 등록 창이 어떻게 열리는지» 그 한 줄이 **손님 눈에 닿나**
 *
 *   ══ 왜 이 자가 있나 ══
 *   카드 등록(빌키)은 고객이 결제 라인을 **못 고른다**(lib/pay-route.ts `keyinOptionForBillingKey()` 가 available:false 고정).
 *   §9 는 «막지 않는 대신 **말해 준다**»이고, 그 말은 `notice` 한 줄이다.
 *   그런데 화면이 안내를 «고를 수 있을 때만» 그리면 available:false 와 함께 **통째로 사라진다** —
 *   🔴 **막지도 않고 말해 주지도 않는** 상태가 된다. 이 자는 그 한 줄이 **진짜 눈에 보이는지**를 브라우저에서 잰다.
 *
 *   ══ 무엇을 재나(다섯 축) ══
 *     ① 서버가 지은 두 문장을 lib/pay-route.ts 에서 뽑는다 — **문장의 정본은 서버다(AC-52)**
 *     ② 모의(public/js/mock.js)가 **같은 문장**을 갖고 있나 — 사본이 어긋나면 화면을 봐도 거짓이다
 *     ③ 브라우저에서 «카드 등록»을 눌러 **시트가 열리고** 그 문장이 **눈에 보이나**
 *        (DOM 에 있나가 아니다 — offsetParent · 넓이 · 가림 · 글자색까지 본다)
 *     ④ 두 갈래를 다 본다 — 키인 MID **있음** / **없음**(= `?keyinMid=0` · **지금 라이브가 이쪽**)
 *     ⑤ 🔴 안내만 있고 체크박스가 없는 판에서 «카드 등록하러 가기»가 **죽지 않나**
 *        (안내를 실으려고 시트를 열게 만들었으니, 없는 #keyin 을 읽으면 그 단추가 죽는다 — 내가 만든 새 위험을 내가 잰다)
 *
 *   종료코드: 0 = 닿는다 · 1 = 안 닿는다 · 2 = 못 쟀다(playwright 없음 · 서버 모양이 바뀜 등)
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { requirePlaywright } from "./lib/find-playwright.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const say = (s = "") => console.log(s);
let fail = 0;
const unmeasured = [];

say("🔴 카드 등록 안내 한 줄이 손님 눈에 닿나 · " + new Date().toISOString());
say("─".repeat(104));

/* ═══ ① 서버가 정본 ═══ */
const SRC = path.join(ROOT, "lib", "pay-route.ts");
if (!existsSync(SRC)) { say("⊘ 못 쟀어요 — lib/pay-route.ts 가 없습니다."); process.exit(2); }
const ts = readFileSync(SRC, "utf8");
const at = ts.indexOf("export async function keyinOptionForBillingKey");
if (at < 0) { say("⊘ 못 쟀어요 — lib/pay-route.ts 에 keyinOptionForBillingKey 가 없습니다(서버가 모양을 바꿨나)."); process.exit(2); }
/* 🔴 함수 머리부터 **줄 맨 앞의 `}`** 까지가 몸통이다 — 괄호를 세지 않는다([^)]* 로 중첩 괄호를 넘을 수 없다) */
const bodyEnd = ts.indexOf("\n}", at);
const body = ts.slice(at, bodyEnd < 0 ? ts.length : bodyEnd);
/* 삼항의 두 팔만 고른다 — 줄 맨 앞이 `?` 또는 `:` 인 줄. 폴백의 `keyinLabel: "…"` 은 줄 맨 앞이 아니라 안 걸린다. */
const arms = [...body.matchAll(/^\s*[?:]\s*"([^"]+)"/gm)].map((m) => m[1]);
if (arms.length !== 2) {
  say(`⊘ 못 쟀어요 — 서버 문장을 2개 뽑아야 하는데 ${arms.length}개가 나왔습니다(삼항 모양이 바뀐 듯).`);
  arms.forEach((a) => say(`   · ${a}`));
  process.exit(2);
}
const [SAY_MID_ON, SAY_MID_OFF] = arms;   // ? = MID 있음 · : = MID 없음(라이브)
say("① 서버가 지은 문장 2개 — **이것이 정본이다**");
say(`   · MID 있음 : «${SAY_MID_ON}»`);
say(`   · MID 없음 : «${SAY_MID_OFF}»  ← 🔴 지금 라이브`);
say("");

/* ═══ ② 모의 사본이 같은가 ═══ */
const mockPath = path.join(PUB, "js", "mock.js");
const mock = existsSync(mockPath) ? readFileSync(mockPath, "utf8") : "";
/* 주석 안의 글자를 증거로 세지 않는다 */
const decomment = (s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
const mockCode = decomment(mock);
const missing = [SAY_MID_ON, SAY_MID_OFF].filter((s) => !mockCode.includes(s));
if (!mock) { unmeasured.push("public/js/mock.js 가 없어 사본을 못 봤다"); }
else if (missing.length) {
  fail++;
  say("🔴 ② 모의가 서버와 **다른 문장**을 들고 있다 — 화면을 봐도 거짓이 된다(AC-52)");
  missing.forEach((s) => say(`   · 모의에 없음: «${s}»`));
  say("   고치는 곳: public/js/mock.js 의 keyinForBillingKey()");
} else say("✓ ② 모의가 서버와 **같은 문장** 2개를 들고 있다");
/* 빌키 갈래가 코인용 keyinOption() 을 쓰고 있으면 모양부터 틀렸다 */
if (mockCode.includes("o.keyin = keyinOption()")) {
  fail++;
  say("🔴 ② 모의 `subscription` 이 **코인용** keyinOption() 을 준다 — 빌키는 available:false 고정이라 모양이 다르다");
}
say("");

/* ═══ 정적 서버 ═══ */
if (!existsSync(PUB)) { say("⊘ 못 쟀어요 — public/ 이 없습니다."); process.exit(2); }
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  let p = path.join(PUB, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(PUB)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404, { "content-type": "application/json" }).end('{"ok":false,"error":"mock 밖"}'); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

let chromium;
try { ({ chromium } = await requirePlaywright()); }
catch (e) { say("⊘ 못 쟀어요 — playwright 를 찾지 못했습니다: " + e.message); server.close(); process.exit(2); }
const browser = await chromium.launch({ headless: true });

/** 그 마디가 **정말 눈에 보이나** — DOM 에 있나가 아니다. */
const VISIBLE = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { found: false };
  const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
  const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
  const top = document.elementFromPoint(cx, cy);
  return {
    found: true, text: (el.textContent || "").trim(),
    laidOut: !!el.offsetParent, w: Math.round(r.width), h: Math.round(r.height),
    display: cs.display, visibility: cs.visibility, opacity: cs.opacity, color: cs.color,
    covered: !!(top && top !== el && !el.contains(top)),
    coveredBy: top && top !== el && !el.contains(top) ? (top.tagName.toLowerCase() + (top.className ? "." + String(top.className).split(" ")[0] : "")) : "",
  };
};

async function walk(label, qs, expect) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push("[pageerror] " + e.message));
  pg.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text()); });

  await pg.goto(`${BASE}/app/plan.html?mock=1${qs}`, { waitUntil: "load" }).catch(() => {});
  await pg.waitForTimeout(900);

  const btn = await pg.$("#cardAdd, #cardChange");
  if (!btn) { unmeasured.push(`${label} — «카드 등록» 단추를 못 찾았다(#cardAdd·#cardChange 둘 다 없음)`); await ctx.close(); return; }
  await btn.click().catch(() => {});
  await pg.waitForTimeout(700);

  const sheetOpen = await pg.$(".sheet");
  if (!sheetOpen) {
    fail++;
    say(`🔴 ③ ${label} — «카드 등록»을 눌렀는데 **시트가 안 열린다** ⇒ 안내 한 줄이 **아무에게도 안 닿는다**`);
    say(`      막지도 않고 말해 주지도 않는 자리다(§9). 고치는 곳: public/app/_tpl.txt 의 addCard()`);
    if (errs.length) say(`      브라우저가 뱉은 것: ${errs.join(" | ")}`);
    await ctx.close(); return;
  }

  const v = await pg.evaluate(VISIBLE, "#keyinNote");
  if (!v.found) {
    fail++;
    say(`🔴 ③ ${label} — 시트는 열렸는데 안내 줄(#keyinNote)이 **그려지지 않았다**`);
    await ctx.close(); return;
  }
  const bad = [];
  if (!v.laidOut) bad.push("자리를 안 차지한다(offsetParent 없음)");
  if (v.w < 40 || v.h < 8) bad.push(`크기가 ${v.w}×${v.h}`);
  if (v.visibility !== "visible") bad.push("visibility:" + v.visibility);
  if (Number(v.opacity) < 0.5) bad.push("opacity:" + v.opacity);
  if (v.covered) bad.push("가려졌다 — 그 자리에 있는 것: " + v.coveredBy);
  if (v.text !== expect) bad.push(`문장이 다르다 — 화면은 «${v.text}»`);

  if (bad.length) { fail++; say(`🔴 ③ ${label} — 안내가 **손님 눈에 안 닿는다**: ${bad.join(" · ")}`); }
  else say(`✓ ③ ${label} — 안내가 보인다(${v.w}×${v.h} · ${v.color}) — «${v.text}»`);

  /* ═══ ⑤ 안내만 있는 판에서 «카드 등록하러 가기»가 죽지 않나 ═══ */
  const hasChk = await pg.$("#keyin");
  const before = pg.url();
  const moved = await pg.evaluate(() => { window.__went = null; const f = HTMLFormElement.prototype.submit; HTMLFormElement.prototype.submit = function () { window.__went = this.action || "form"; }; return typeof f === "function"; });
  await pg.click("#go").catch(() => {});
  await pg.waitForTimeout(900);
  const went = await pg.evaluate(() => window.__went).catch(() => null);
  const gone = !(await pg.$(".sheet"));
  const acted = !!went || gone || pg.url() !== before;
  if (!acted) {
    fail++;
    say(`🔴 ⑤ ${label} — «카드 등록하러 가기»를 눌렀는데 **아무 일도 안 난다**${hasChk ? "" : " (체크박스 없는 판 — 없는 #keyin 을 읽어 던지는지 보라)"}`);
    if (errs.length) say(`      브라우저가 뱉은 것: ${errs.join(" | ")}`);
  } else say(`✓ ⑤ ${label} — 단추가 살아 있다(체크박스 ${hasChk ? "있음" : "없음"} · ${went ? "결제창으로 넘어감" : gone ? "시트가 닫힘" : "화면이 바뀜"})`);

  if (errs.length) { fail++; say(`🔴 ${label} — 브라우저가 오류를 뱉었다: ${errs.join(" | ")}`); }
  void moved;
  await ctx.close();
}

say("③⑤ 브라우저에서 눌러 본다 — 390×844 · ko-KR · Asia/Seoul");
await walk("MID 있음(기본)", "", SAY_MID_ON);
await walk("MID 없음(= 지금 라이브 · ?keyinMid=0)", "&keyinMid=0", SAY_MID_OFF);

await browser.close(); server.close();

say("");
if (unmeasured.length) { say("⊘ 못 쟀음 — 통과로 세지 않는다(AC-9)"); unmeasured.forEach((u) => say("   · " + u)); }
say("─".repeat(104));
say("🔴 이 자가 **무엇을 셌나** — 서버 문장 2개(lib/pay-route.ts 가 정본) · 모의 사본 2개 · 화면 2갈래(눌러서 시트를 열고 #keyinNote 를 **보이는지**까지) · 그 판의 으뜸 단추 2개(눌러서 무언가 나는지)");
say("🔴 이 자가 **못 재는 것** — 진짜 KICC 창이 실제로 어느 쪽으로 열리는지(그건 서버·결제사 몫이다) · 문장이 **맞는 말인지**(문장의 옳고 그름은 사람이 본다)");
if (fail) { say(`\n🔴 ${fail}건 — 말해 주기가 손님에게 안 닿는다`); process.exit(1); }
say("\n✅ 카드 등록 안내가 두 갈래 다 손님 눈에 닿는다");
process.exit(0);
