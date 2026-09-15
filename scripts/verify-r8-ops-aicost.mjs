// scripts/verify-r8-ops-aicost.mjs — [R8 · E1 · A] 🔴 **운영 매출 화면이 AI 원가 분해를 진짜로 «그리나»**.
//   B 의 사슬 검사(`verify-r8-deadends.mjs`)는 «화면 파일에 그 낱말이 있나» 를 센다 — 그건 **배선**의 증거지 **그림**의 증거가 아니다.
//   낱말만 적어 두고 `display:none` 이거나 예외로 죽으면 그 검사는 여전히 초록이다. 그래서 여기서는 **브라우저로 띄워서 글자를 읽는다.**
//
//   재는 것(mock 층 `?mock=1` 위 · AI 실호출 0 · 서버 0):
//     ① 용도·모델·제공사 막대가 **서버가 준 순서 그대로** 그려졌나(제공사는 🔴 **호출 수** 순 — 돈으로 다시 정렬하면 빨강)
//     ② «부른 횟수» · «우리가 안은 몫» · «가른 몫» 이 **글자로** 나오나
//     ③ 🔴 0 을 «없음» 으로 감추지 않나(`?over=0` → «아직 없어요» · `?ai=0` → 빈 상태 문장) — AC-9
//     ④ 콘솔 에러·pageerror 0 · 가로 넘침 0 · 이모지 0(DESIGN §13.0)
//   🔴 양성 대조: 이미 그리던 «AI 원가» 합계 줄이 안 보이면 **이 검사 자체가 고장 난 것**이다(빨강을 믿지 마라).
//
//   playwright 는 ../AutoMarketing/node_modules 것을 쓴다(이 리포엔 없다 · shot-p1r1.mjs 와 같은 관례).
//   사용: node scripts/verify-r8-ops-aicost.mjs            (PORT=8907 · PW_DIR 로 playwright 위치 덮어쓰기)
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PUB = join(ROOT, "public");
const PORT = Number(process.env.PORT || 8907);
const results = [];
const rec = (step, ok, note) => { results.push({ step, ok, note: String(note ?? "") }); };

/* ── playwright 찾기(이 리포엔 없다) ── */
const PW_DIR = resolve(ROOT, process.env.PW_DIR || "../AutoMarketing");
const pwEntry = join(PW_DIR, "node_modules/playwright/index.mjs");
if (!existsSync(pwEntry)) {
  console.error(`playwright 를 못 찾았다: ${pwEntry}\n  PW_DIR=<playwright 가 설치된 리포> 로 알려 줘.`);
  process.exit(2);
}
const { chromium } = await import(pathToFileURL(pwEntry).href);

/* ── public/ 정적 서버(백 없이 화면만) ── */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  let p = join(PUB, decodeURIComponent(url.pathname));
  if (!p.startsWith(PUB)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404, { "content-type": "text/plain" }).end("404"); return; }
  res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(PORT, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await chromium.launch();
const errs = [];
const open = async (qs) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  page.on("console", (m) => { if (m.type() === "error") errs.push(`${qs} console: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => { errs.push(`${qs} pageerror: ${String(e).slice(0, 160)}`); });
  await page.goto(`${BASE}/ops/${qs}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return page;
};
const txt = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, " ").trim()).catch(() => "");
const rows = (page, sel) => page.$$eval(`${sel} .bar`, (els) => els.map((e) => ({
  n: e.querySelector(".n")?.textContent.replace(/\s+/g, " ").trim() ?? "",
  v: e.querySelector(".v")?.textContent.replace(/\s+/g, " ").trim() ?? "",
  w: Number((e.querySelector(".fill")?.style.width || "0").replace("%", "")) })));

try {
  /* ══ ① 값이 있는 보통 상태 ══ */
  const page = await open("?mock=1");

  /* 🔴 양성 대조 — 원래 그리던 합계 줄. 이게 비면 셈법이 고장 난 것이다(아래 빨강을 믿지 마라). */
  const total = await txt(page, "#ai");
  rec("🔴 검사 자체가 도나(양성 대조 · 원래 그리던 «AI 원가» 합계 줄)", /\$|원/.test(total), total ? `합계 줄 «${total}»` : "🔴 합계 줄마저 비었다 — 화면이 안 떴거나 mock 이 안 걸렸다");

  const purpose = await rows(page, "#aiPurpose");
  rec("용도별 막대를 그리나(🔴 제일 위 · «글이 비싸다» 오해를 푸는 자리)", purpose.length >= 3 && /사진/.test(purpose[0]?.n || ""),
    purpose.length ? `${purpose.length}줄 · 첫 줄 «${purpose[0].n} ${purpose[0].v}»` : "0줄 — 안 그린다");
  rec("용도별이 «얼마»와 «몇 번»을 같이 말하나", purpose.every((r) => /\$/.test(r.v) && /회/.test(r.v)),
    purpose.map((r) => r.v).slice(0, 3).join(" · ") || "—");
  /* 🔴 용도는 서버가 **돈 순**으로 준다 — 화면이 순서를 안 바꿨나(막대 길이가 내림차순인지로 잰다). */
  rec("용도별 순서를 화면이 뒤집지 않았나(서버 = 돈 순)", purpose.every((r, i) => i === 0 || r.w <= purpose[i - 1].w),
    purpose.map((r) => `${r.n}:${r.w}%`).join(" ") || "—");

  const model = await rows(page, "#aiModel");
  rec("모델별 막대를 그리나", model.length >= 2, model.length ? `${model.length}줄 · 첫 줄 «${model[0].n} ${model[0].v}»` : "0줄");

  /* 🔴 제공사는 **호출 수** 순이다 — 화면이 돈으로 다시 줄 세우면 «어디에 많이 기대나» 가 사라진다. */
  const prov = await rows(page, "#aiProvider");
  rec("제공사별 막대를 그리나(🔴 호출 수를 앞에 말하나)", prov.length >= 1 && /^\d[\d,]*회/.test(prov[0]?.v || ""),
    prov.length ? `${prov.length}줄 · 첫 줄 «${prov[0].n} ${prov[0].v}»` : "0줄 — 제공사가 하나뿐이라도 한 줄은 나와야 한다");

  rec("«부른 횟수» 를 글자로 말하나", /[\d,]+회/.test(await txt(page, "#aiCalls")), await txt(page, "#aiCalls"));

  const over = await txt(page, "#aiOver"), overWhy = await txt(page, "#aiOverWhy");
  rec("«우리가 안은 몫» 을 코인·편수로 말하나", /코인/.test(over) && /편/.test(over), `«${over}»`);
  /* 🔴 손실로만 읽히면 안 된다 — «스톡이 비어서 AI 가 다 구웠다» 는 신호라 재고를 채우라는 말이다(B 계약). */
  rec("🔴 «안은 몫» 이 손실이 아니라 **신호**로 읽히나(스톡·재고를 말하나)", /스톡|재고/.test(overWhy), overWhy ? `«${overWhy.slice(0, 60)}…»` : "설명 한 줄이 없다");

  const ex = await txt(page, "#aiExcluded");
  rec("🔴 «뺀 몫» 이 **숨긴 게 아니라 가른 것**으로 보이나", /가른/.test(ex) && /\$/.test(ex), ex ? `«${ex.slice(0, 70)}…»` : "빈 줄");

  /* ── 헌장(DESIGN §13.0) — 이모지 0 · 가로 넘침 0 ── */
  const body = await page.$eval("body", (b) => b.innerText);
  const emoji = body.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || [];
  rec("이모지 0(§13.0)", emoji.length === 0, emoji.length ? `이모지 ${emoji.length}개 [${[...new Set(emoji)].join("")}]` : "없다");
  for (const w of [390, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 1400 });
    await page.waitForTimeout(150);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    rec(`가로 넘침 0(${w}px)`, over <= 1, over <= 1 ? "없다" : `${over}px 넘친다`);
  }
  await page.close();

  /* ══ ② 🔴 0 을 «없음» 으로 감추지 않나(AC-9) ══ */
  const zero = await open("?mock=1&over=0");
  const zOver = await txt(zero, "#aiOver");
  rec("🔴 «안은 몫» 이 0이면 «아직 없어요»(0 을 감추지 않는다 · AC-9)", /아직 없어요/.test(zOver), `«${zOver}»`);
  rec("0일 때는 «스톡» 설명을 붙이지 않나(없는 일을 설명하지 않는다)", !/스톡/.test(await txt(zero, "#aiOverWhy")), await txt(zero, "#aiOverWhy") || "(빈 줄)");
  await zero.close();

  /* ══ ③ 호출이 아예 0건인 달 — 막대 자리가 «사라지지» 않고 말로 남나 ══ */
  const none = await open("?mock=1&ai=0");
  rec("AI 호출 0건인 달 — 용도별이 빈 문장으로 남나(자리가 사라지지 않는다)", /아직 없어요/.test(await txt(none, "#aiPurpose")), await txt(none, "#aiPurpose") || "(빈 칸)");
  rec("AI 호출 0건인 달 — 제공사별도 말로 남나", /아직 없어요/.test(await txt(none, "#aiProvider")), await txt(none, "#aiProvider") || "(빈 칸)");
  rec("AI 호출 0건인 달 — «가른 몫» 도 0을 말하나", /없어요/.test(await txt(none, "#aiExcluded")), await txt(none, "#aiExcluded") || "(빈 줄)");
  await none.close();

  rec("콘솔 에러·pageerror 0", errs.length === 0, errs.length ? errs.slice(0, 3).join(" | ") : "없다");
} finally {
  await browser.close();
  server.close();
}

const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
console.log(`\nR8 · E1 — 운영 매출 화면이 AI 원가 분해를 «그리나»(브라우저) · ${new Date().toISOString()}\n${"─".repeat(150)}`);
for (const r of results) console.log(`${r.ok ? "✓" : "✗"} ${w(r.step, 62)} ${w(r.note, 84)}`);
const bad = results.filter((r) => !r.ok);
console.log(`${"─".repeat(150)}\n${results.length - bad.length}/${results.length} 초록${bad.length ? ` · 🔴 빨강 ${bad.length}` : ""}\n`);
process.exit(bad.length ? 1 : 0);
