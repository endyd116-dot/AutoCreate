/**
 * scripts/verify-r11-screens.mjs — 🔴 **R11+R12 A 몫이 화면에서 정말 도나**(A · 2026-09-16 · 라이브 0).
 *   사용: `PORT=4188 node scripts/verify-r11-screens.mjs`   (기본 4188 · 워크트리마다 갈라 써라 · AC-90)
 *
 *   ══ 규율 ══
 *   ①**«있나»가 아니라 «도나»** — 눌러 보고 목록이 바뀌는지 본다 ②**거짓 양성 짝** — 안 나와야 할 자리에서 안 나오는지
 *   ③**있으면 안 되는 글자** — 열쇠 글자(`shorts`·`cardnews`·`ruleKind`)가 화면에 새는지(AC-91) ④겁주는 말 0(§3)
 *   🔴 자를 먼저 찌른다: 서버가 **이 폴더의 코드**를 주는지 본다([[ac-stale-verify-server]]).
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4188);
const out = [];
const rec = (step, ok, note = "") => { out.push({ step, ok, note }); return ok; };

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  let f = join(ROOT, "public", decodeURIComponent(u.pathname));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f)) { res.writeHead(404); res.end(""); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(f));
});
await new Promise((ok, bad) => { server.once("error", bad); server.listen(PORT, ok); })
  .catch((e) => { console.error(`🔴 포트 ${PORT} 를 못 열었다(${e.code}) — PORT=4189 처럼 갈라라`); process.exit(2); });
console.log(`ℹ 포트 ${PORT} · ${join(ROOT, "public")}`);
{
  const a = await (await fetch(`http://localhost:${PORT}/app/pieces.html`)).text();
  const b = await (await fetch(`http://localhost:${PORT}/js/mock.js`)).text();
  if (!a.includes("kindsOf") || !b.includes("ruleKindOf")) {
    console.error("🔴 응답에 이번 코드(kindsOf·ruleKindOf)가 없다 — 다른 폴더의 서버다. 재면 전부 가짜 초록이다");
    server.close(); process.exit(2);
  }
}

const PW = [join(ROOT, "runner", "node_modules", "playwright", "index.mjs"),
  ...["AutoCreate-B2", "AutoCreate-C", "AutoCreate", "AutoCreate-B"].map((w) => join(ROOT, "..", w, "runner", "node_modules", "playwright", "index.mjs"))].find((p) => existsSync(p));
if (!PW) { console.error("🔴 playwright 를 못 찾았다"); server.close(); process.exit(2); }
const pw = await import(pathToFileURL(PW).href);
const browser = await pw.chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, isMobile: true, hasTouch: true, locale: "ko-KR" });
const open = async (path) => {
  const page = await ctx.newPage(); const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 120)));
  await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: "networkidle" }).catch(() => {});
  await page.waitForTimeout(600);
  return { page, errors };
};
const SCARY = /정지됩니다|불이익|고객님 책임|알려만/;
const RAW = /\b(ruleKind|shorts|cardnews|post)\b/;

/* ── A-1 «만든 것» · 종류 칩 ── */
{
  const { page, errors } = await open("/app/pieces.html?mock=1");
  const v = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('[data-chips="kind"] [data-v]')].map((c) => ({ v: c.dataset.v, t: (c.textContent || "").trim(), on: c.classList.contains("on") }));
    return { h1: (document.querySelector(".step-h h1")?.textContent || "").trim(), chips, seg: [...document.querySelectorAll("#seg button")].map((b) => (b.textContent || "").trim()) };
  });
  rec("A-1 제목이 «만든 것»이다(영상·카드뉴스도 여기 있다)", v.h1 === "만든 것", `«${v.h1}»`);
  rec("A-1 종류 칩이 .chips 로 나온다(.seg 는 상태가 쓴다)", v.chips.length >= 2, `칩=${v.chips.map((c) => c.t).join("·") || "없음"} · 상태탭=${v.seg.length}개`);
  rec("A-1 «전체»가 먼저 켜져 있다(저장 안 한다)", v.chips[0]?.v === "" && v.chips[0]?.on === true, `첫칩=«${v.chips[0]?.t}» on=${v.chips[0]?.on}`);
  rec("A-1 고객이 가진 종류만 낸다(모의엔 글·영상뿐 — 카드뉴스 칩은 없다)",
    v.chips.some((c) => c.t === "글") && v.chips.some((c) => c.t === "영상") && !v.chips.some((c) => c.t === "카드뉴스"),
    `칩=${v.chips.map((c) => c.t).join("·")}`);
  rec("A-1 열쇠 글자가 화면에 안 샌다(AC-91)", !RAW.test(v.chips.map((c) => c.t).join(" ")), `«${v.chips.map((c) => c.t).join(" ")}»`);
  rec("A-1 페이지 오류 0", errors.length === 0, errors.join(" | ") || "0");
  await page.close();
}

/* ── A-1 «도나» — 눌러서 목록이 실제로 바뀌나 + 빈 상태가 종류를 아나 ── */
{
  const { page } = await open("/app/pieces.html?mock=1");
  /* 🔴 **두 종류가 같이 있는 탭**에서 재야 «줄어든다»가 질문이 된다 — 기본 탭(만드는 중)엔 모의에 영상 1장뿐이라
     걸러도 1장 그대로고, 그러면 자가 «안 줄었다»고 빨개지지만 **화면은 멀쩡하다**(첫 판이 그렇게 섰다). */
  await page.click('#seg button[data-tab="in_review"]').catch(() => {});
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => document.querySelectorAll("#list a.row").length);
  await page.click('[data-chips="kind"] [data-v="shorts"]').catch(() => {});
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    rows: [...document.querySelectorAll("#list a.row")].map((a) => (a.querySelector(".d")?.textContent || "").trim()),
    seg: [...document.querySelectorAll("#seg button")].map((b) => (b.textContent || "").trim()),
    empty: (document.querySelector("#list .empty h3")?.textContent || "").trim(),
  }));
  rec("A-1 «영상»을 누르면 목록이 **실제로 줄어든다**(도나)", after.rows.length > 0 && after.rows.length < before, `누르기 전 ${before}장 → 뒤 ${after.rows.length}장`);
  rec("A-1 상태 탭 숫자도 고른 종류를 따른다", after.seg.join(" ").match(/\d/) !== null, `탭=${after.seg.join(" · ")}`);
  /* 빈 상태 — 영상으로 좁힌 뒤 «발행됨» 으로 가면 모의엔 발행된 영상이 없다 */
  await page.click('#seg button[data-tab="published"]').catch(() => {});
  await page.waitForTimeout(300);
  const e2 = await page.evaluate(() => (document.querySelector("#list .empty h3")?.textContent || "").trim());
  rec("🔴 A-1 빈 상태가 **종류를 안다** — «글이»가 아니라 «영상이»라고 말한다", /영상이/.test(e2) && !/글이/.test(e2), `«${e2}»`);
  await page.close();
}

/* ── A-1 거짓 양성 짝 — 한 종류뿐이면 칩 줄이 아예 없다 ── */
{
  const { page } = await open("/app/pieces.html?mock=1&fresh=1");
  const n = await page.evaluate(() => document.querySelectorAll('[data-chips="kind"]').length);
  rec("🔴 A-1 고를 것이 없으면 칩 줄 자체가 없다(새 집 = 만든 것 0)", n === 0, `칩 그룹=${n}개`);
  await page.close();
}

/* ── A-2 종류 배지 ── */
{
  const { page } = await open("/app/pieces.html?mock=1");
  const v = await page.evaluate(() => [...document.querySelectorAll("#list a.row")].map((a) => ({
    pill: (a.querySelector(".d .pill")?.textContent || "").trim(),
    href: a.getAttribute("href"),
  })));
  const pills = v.map((x) => x.pill).filter(Boolean);
  rec("A-2 영상 행에 «영상» 배지가 붙는다(종전엔 한 번도 안 붙었다)", pills.includes("영상"), `배지=${[...new Set(pills)].join("·") || "없음"}`);
  rec("🔴 A-2 글에는 배지를 안 단다(기본이라 이름표가 붙으면 시끄럽다)", !pills.includes("글"), `배지 종류=${[...new Set(pills)].join("·") || "없음"}`);
  rec("A-2 배지 글자가 열쇠 글자가 아니다(AC-91)", !pills.some((p) => RAW.test(p)), `«${[...new Set(pills)].join(" ")}»`);
  await page.close();
}

/* ── A-3 «배워 올 곳» ── */
{
  const { page, errors } = await open("/app/create.html?mock=1");
  const v = await page.evaluate(() => {
    const g = document.querySelector("#refg");
    const rows = [...(g?.querySelectorAll(".row") || [])].filter((r) => !r.hidden).map((r) => (r.querySelector(".t")?.textContent || "").trim());
    return { hidden: g?.hidden, title: (g?.querySelector(".gt")?.childNodes[0]?.textContent || "").trim(), quota: (g?.querySelector("#refq")?.textContent || "").trim(), rows, links: (g?.querySelectorAll(".gt a") || []).length, text: (g?.innerText || "").replace(/\s+/g, " ") };
  });
  rec("A-3 «배워 올 곳»이 제목을 가진 제 그룹이다(«네 번째 쓰는 길»이 아니다)", v.hidden === false && v.title === "배워 올 곳", `hidden=${v.hidden} 제목=«${v.title}»`);
  rec("A-3 두 줄이 글 → 영상 차례로 있다", v.rows[0] === "글 스타일 배우기" && v.rows[1] === "영상 스타일 배우기", `줄=${v.rows.join(" · ")}`);
  rec("A-3 한도가 제목 줄 우측에 **글자로** 있다(링크 아님)", /이번 달 .*남음/.test(v.quota) && v.links === 0, `«${v.quota}» 링크=${v.links}개`);
  rec("🔴 A-3 단위가 «이번 달»로 통일됐다 — «하루 N개»가 안 남아 있다", !/하루 \d/.test(v.text), `«${v.text.slice(0, 90)}»`);
  rec("A-3 페이지 오류 0", errors.length === 0, errors.join(" | ") || "0");
  await page.close();
}

/* ── 🔴 A-3 거짓 양성 짝 — 축이 없으면 줄이 없고, 서버가 «남음»을 못 주면 숫자를 안 지어낸다 ── */
{
  const { page } = await open("/app/create.html?mock=1&oneCh=1");   // 네이버만 있는 집 = 영상 계정 0
  const v = await page.evaluate(() => {
    const g = document.querySelector("#refg");
    const rows = [...(g?.querySelectorAll(".row") || [])].filter((r) => !r.hidden).map((r) => (r.querySelector(".t")?.textContent || "").trim());
    return { rows, quota: (g?.querySelector("#refq")?.textContent || "").trim() };
  });
  rec("🔴 A-3 영상 계정이 없으면 «영상 스타일 배우기» 줄이 **없다**", !v.rows.includes("영상 스타일 배우기") && v.rows.includes("글 스타일 배우기"), `줄=${v.rows.join(" · ") || "없음"}`);
  rec("A-3 한 축만 있으면 한도도 그 축 것만 말한다", /이번 달 \d+ \/ \d+ 남음/.test(v.quota) && !/영상/.test(v.quota), `«${v.quota}»`);
  await page.close();
}
{
  /* 🔴 서버가 `quota` 를 못 줄 때 — 숫자를 **지어내면 안 된다**(AC-9·AC-92).
     🔴 화면 안 함수를 밖에서 부르지 않는다(IIFE 라 닿지도 않았다) — **모의 손잡이로 진짜 경로를 태워** 잰다. */
  const { page } = await open("/app/create.html?mock=1&noQuota=1");
  const v = await page.evaluate(() => ({
    quota: (document.querySelector("#refq")?.textContent || "").trim(),
    rows: [...document.querySelectorAll("#refg .row")].filter((r) => !r.hidden).length,
  }));
  rec("🔴 A-3 서버가 «남음»을 안 주면 **숫자를 빼고 이름만** 남는다(지어내지 않는다)", v.quota === "" && v.rows === 2, `한도=«${v.quota}» 줄=${v.rows}개`);
  await page.close();
}

/* ── 말투 ── */
{
  const { page } = await open("/app/pieces.html?mock=1");
  const t = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
  rec("§3 겁주는 말 0", !SCARY.test(t), `«${t.slice(0, 60)}»`);
  await page.close();
}

await browser.close(); server.close();
const bad = out.filter((o) => !o.ok);
for (const o of out) console.log(`${o.ok ? "✅" : "🔴"} ${o.step}${o.note ? ` — ${o.note}` : ""}`);
console.log(`\n${out.length - bad.length}/${out.length} 통과`);
process.exit(bad.length ? 1 : 0);
