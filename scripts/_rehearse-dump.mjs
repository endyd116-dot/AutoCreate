// scripts/_rehearse-dump.mjs — [R8 리허설] 첫 발행 경로를 **화면으로 걸어 보고 글자를 뽑는다**(판정은 사람이 한다).
//   🔴 실호출·실발행 0 — `?mock=1` 모의 층 위에서만 걷는다.
//   사용: node scripts/_rehearse-dump.mjs [단계키...]      (없으면 전부)
//   출력: _shots/rehearse/<키>.txt (화면 글자) + stdout 요약.  🔴 초록/빨강을 안 낸다 — 이건 **재는 도구**다.
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUB = join(ROOT, "public");
const OUT = join(ROOT, "_shots/rehearse");
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT || 8908);

const PW_DIR = resolve(ROOT, process.env.PW_DIR || "../AutoMarketing");
const pwEntry = join(PW_DIR, "node_modules/playwright/index.mjs");
if (!existsSync(pwEntry)) { console.error(`playwright 없음: ${pwEntry}`); process.exit(2); }
const { chromium } = await import(pathToFileURL(pwEntry).href);

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  let p = join(PUB, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(PUB)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404).end("404"); return; }
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${PORT}`;

/* ── 걸어 볼 칸 ── 각 칸: [키, 주소, 설명, 사후동작?] */
const STEPS = [
  ["1a-home-fresh",     "/app/home.html?mock=1&fresh=1",                 "①계정 0 인 집의 첫 화면 — 무엇부터 하라고 하나"],
  ["1b-accounts-fresh", "/app/accounts.html?mock=1&fresh=1",             "①계정 연결 화면(빈 집) — 네이버를 어떻게 붙이나"],
  ["1c-accounts-add",   "/app/accounts.html?mock=1&fresh=1",             "①네이버 붙이기 시트를 연 상태", "addSheet"],
  ["1d-accounts-pend",  "/app/accounts.html?mock=1",                     "①`pending_login` 계정이 있는 집 — «로그인 한 번»이 닿나"],
  ["1e-home-pend",      "/app/home.html?mock=1",                         "①홈 «해야 할 일» 에 그 줄이 뜨나", "todoFirst"],
  ["1f-runner-off",     "/app/runner.html?mock=1&runner=off",            "①내 PC 프로그램이 꺼져 있을 때 — 무엇을 하라고 하나"],
  ["1g-connect-first",  "/app/accounts.html?mock=1&fresh=1",             "①🔴 네이버를 **처음** 붙인 직후 그 줄이 뭐라고 하나", "connectNaver"],
  ["2a1-to-director",   "/app/create.html?mock=1&oneCh=1",               "②«디렉터에게» 를 눌러 실제로 넘어가나", "toDirector"],
  ["2a-create",         "/app/create.html?mock=1&oneCh=1",               "②소재 고르기(네이버만 있는 집)"],
  ["2b-director",       "/app/director.html?mock=1&oneCh=1",             "②디렉터 — 확인하고 만들기"],
  ["2c-pieces",         "/app/pieces.html?mock=1",                       "②만들어진 글 목록"],
  ["2d-piece",          "/app/piece.html?mock=1&id=501",                 "②🔴 검수 — **네이버 글**(사장님 경로) · 새 줄들이 뜨나"],
  ["2d2-piece-video",   "/app/piece.html?mock=1&id=509",                 "②검수 — 영상(참고)"],
  ["2e-piece-claims",   "/app/piece.html?mock=1&id=501&claims=1",        "②근거 없는 수치가 섞인 글"],
  ["2c2-pieces-sched",  "/app/pieces.html?mock=1&tab=scheduled",         "②🔴 «예약됨» 탭을 곧장 열면 뭐가 있나(승인 뒤 도착 화면)"],
  ["2c3-pieces-pub",    "/app/pieces.html?mock=1&tab=published",         "②«발행됨» 탭"],
  ["2c4-pieces-order",  "/app/pieces.html?tab=scheduled&mock=1",         "②🔴 같은 화면을 **차례만 바꿔** 연다(승인 뒤 UI.go 가 만드는 그 주소)"],
  ["3a-schedule",       "/app/schedule.html?mock=1",                     "③편성표 — 언제 만들어지나"],
  ["3b-schedule-auto",  "/app/schedule.html?mock=1&pw=auto",             "③자동 편성을 꺼 둔 집"],
  ["4a-piece-gate",     "/app/piece.html?mock=1&id=501&gate=soft",       "④발행 직전 — 위험을 말해 주나(막지 않나)"],
  ["4b-piece-adpoint",  "/app/piece.html?mock=1&id=501&gate=adpoint",    "④광고 가리킴이 걸린 글"],
  ["4c-pubnow-cadence", "/app/piece.html?mock=1&id=501&pubnow=cadence",  "④지금 올리기 — 캐던스에 걸린 길"],
  ["4d-pubnow-offline", "/app/piece.html?mock=1&id=501&pubnow=offline",  "④지금 올리기 — 내 PC 가 꺼져 있다"],
  ["4f-pubnow-ok",      "/app/piece.html?mock=1&id=503",                 "④예약된 글에 «지금 올리기» 가 있나", "pubNow"],
  ["4c2-pubnow-cad",    "/app/piece.html?mock=1&id=503&pubnow=cadence",  "④🔴 지금 올리기 — 캐던스에 걸린 길(막지 않고 말하나)", "pubNow"],
  ["4d2-pubnow-off",    "/app/piece.html?mock=1&id=503&pubnow=offline",  "④🔴 지금 올리기 — 내 PC 가 꺼져 있다", "pubNow"],
  ["4g-pubnow-gate",    "/app/piece.html?mock=1&id=503&pubnow=gate",     "④지금 올리기 — 검사에 걸린 길", "pubNow"],
  ["5a-posts",          "/app/posts.html?mock=1",                        "⑤나간 글 — 주소가 열리나 · 내리기가 보이나"],
  ["4e-approve",        "/app/piece.html?mock=1&id=501",                 "④🔴 «이대로 발행 예약» 을 실제로 눌러 본다", "approve"],
  ["5a2-post-open",     "/app/posts.html?mock=1",                        "⑤나간 글 한 줄을 열면 «글 보기»·«내리기» 가 있나", "openPost"],
  ["5c2-td-open",       "/app/posts.html?mock=1&td=noway",               "⑤🔴 못 내리는 채널인데 배너는 «대신 내려 드릴 수도»라고 한다 — 열면 뭐라 하나", "openTd"],
  ["5b-revenue",        "/app/revenue.html?mock=1",                      "⑤수익 화면에 그 계정이 뜨나"],
  ["5c-td-noway",       "/app/posts.html?mock=1&td=noway",               "⑤우리가 못 내리는 채널"],
  ["5d-td-open",        "/app/posts.html?mock=1&td=open",                "⑤음성 대조 — 우리가 **대신 내릴 수 있는** 채널이면 원래 문장이 나오나"],
  ["6a-notifications",  "/app/notifications.html?mock=1",                "⑥알림함 — 실패가 어떻게 말해지나"],
  ["6b-home-fail",      "/app/home.html?mock=1&runner=off",              "⑥러너가 꺼진 집의 홈"],
];

const only = process.argv.slice(2);
const browser = await chromium.launch();
const summary = [];

for (const [key, path, desc, act] of STEPS) {
  if (only.length && !only.some((o) => key.startsWith(o))) continue;
  const page = await browser.newPage({ viewport: { width: 390, height: 1600 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(`pageerror: ${String(e).slice(0, 200)}`));
  page.on("console", (m) => { if (m.type() === "error") errs.push(`console: ${m.text().slice(0, 200)}`); });
  let note = "";
  try {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    if (act === "addSheet") {
      /* 네이버 마크를 누른다 — 사장님이 실제로 누르실 그 칸이다. 못 찾으면 그것 자체가 결과다. */
      const btn = await page.$(".cgi");
      if (btn) { await btn.click(); await page.waitForTimeout(800); note = `«${(await btn.textContent()).replace(/\s+/g, " ").trim().slice(0, 24)}» 눌렀다`; }
      else note = "🔴 누를 채널 마크(.cgi)를 못 찾았다";
    }
    if (act === "todoFirst") {
      const row = await page.$("#todo .row, #todo a, .todo .row");
      if (row) { note = `«해야 할 일» 첫 줄 = «${(await row.textContent()).replace(/\s+/g, " ").trim().slice(0, 50)}» · href=${await row.getAttribute("href")}`; }
      else note = "🔴 «해야 할 일» 에 누를 줄이 없다";
    }
    /* ── 실제로 누르며 걷는 길(한 화면 스냅샷으로는 안 보이는 칸) ── */
    if (act === "connectNaver") {
      await (await page.$(".cgi")).click(); await page.waitForTimeout(600);
      await page.fill('.sheet input[name=loginId]', "endyd_blog");
      await page.fill('.sheet input[name=password]', "pw1234");
      await page.click('.sheet button[type=submit]'); await page.waitForTimeout(1500);
      note = "네이버 계정을 **처음** 붙였다 — 그 줄이 무엇이라 말하나";
    }
    if (act === "toDirector") {
      const b = await page.$("[data-go]");
      if (b) { await b.click(); await page.waitForTimeout(1600); note = `«디렉터에게» 누른 뒤 = ${page.url().replace(/^https?:\/\/[^/]+/, "")}`; }
      else note = "🔴 «디렉터에게» 를 못 눌렀다";
    }
    if (act === "approve") {
      const b = await page.$("button.btn.primary");
      if (b) { const label = (await b.textContent()).trim(); await b.click();
        /* 🔴 넘어간 화면이 **다 그려질 때까지** 기다린다 — 일찍 찍으면 «빈 화면»이라는 가짜 결론이 난다. */
        await page.waitForTimeout(1200);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(2500);
        note = `«${label}» 누른 뒤 = ${page.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 60)}`; }
      else note = "🔴 누를 primary 가 없다";
    }
    if (act === "openPost") {
      const r = await page.$(".row.tap");
      if (r) { await r.click(); await page.waitForTimeout(900); note = "나간 글 한 줄을 열었다"; }
      else note = "🔴 열 줄이 없다";
    }
    if (act === "openTd") {
      const b = await page.$(".banner button, .banner a");
      if (b) { await b.click(); await page.waitForTimeout(900); note = `«${(await b.textContent()).trim()}» 눌렀다`; }
      else note = "🔴 신고 배너에 누를 것이 없다";
    }
    if (act === "pubNow") {
      const b = await page.$("#pubNow");
      if (b) { await b.click(); await page.waitForTimeout(1600); note = "«지금 올리기» 눌렀다"; }
      else note = "🔴 «지금 올리기» 단추가 없다(이 글 상태로는 안 나오는 길)";
    }
    const text = await page.evaluate(() => {
      /* 🔴 `offsetParent !== null` 만 보면 **바텀시트(position:fixed)를 통째로 못 본다** — 시트가 이 제품의 주 손잡이다. */
      const vis = (el) => { const s = getComputedStyle(el); if (s.display === "none" || s.visibility === "hidden") return false;
        const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      /* 🔴 «누를 수 있는 것» 을 좁게 보면 «갈 길이 없다» 는 가짜 결론이 난다 — 행(.row)·링크·토글까지 센다. */
      const btns = [...document.querySelectorAll("button, a[href], .tap, [role=button]")].filter(vis)
        .map((b) => `[${b.tagName.toLowerCase()}.${(b.className || "").toString().trim().replace(/\s+/g, ".") || "-"}]${b.getAttribute("href") ? " →" + b.getAttribute("href") : ""} ${b.textContent.replace(/\s+/g, " ").trim().slice(0, 70)}`);
      const sheet = document.querySelector(".sheet");
      return { body: document.body.innerText, buttons: btns, sheet: sheet && vis(sheet) ? sheet.innerText : "" };
    });
    const dump = `# ${key} — ${desc}\n# ${path}\n${note ? "# " + note + "\n" : ""}${errs.length ? "# 🔴 " + errs.join(" | ") + "\n" : ""}\n`
      + `── 화면 글자 ──\n${text.body}\n\n── 보이는 단추 ──\n${text.buttons.join("\n")}\n`
      + (text.sheet ? `\n── 열린 시트 ──\n${text.sheet}\n` : "");
    writeFileSync(join(OUT, key + ".txt"), dump, "utf8");
    summary.push({ key, desc, len: text.body.length, btns: text.buttons.length, errs: errs.length, note });
  } catch (e) {
    writeFileSync(join(OUT, key + ".txt"), `# ${key} — ${desc}\n# ${path}\n🔴 못 걸었다: ${String(e).slice(0, 300)}\n`, "utf8");
    summary.push({ key, desc, len: 0, btns: 0, errs: errs.length + 1, note: "못 걸었다: " + String(e).slice(0, 80) });
  }
  await page.close();
}
await browser.close();
server.close();

const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\n첫 발행 경로 리허설 — 화면 글자를 뽑았다(판정은 사람이 한다) · ${new Date().toISOString()}\n${"─".repeat(120)}`);
for (const s of summary) console.log(`${s.errs ? "🔴" : "  "} ${w(s.key, 20)} ${w(s.desc, 44)} 글자 ${w(s.len, 6)} 단추 ${w(s.btns, 4)} ${s.note}${s.errs ? ` · 에러 ${s.errs}` : ""}`);
console.log(`${"─".repeat(120)}\n→ ${OUT}\n`);
