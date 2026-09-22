// scripts/verify-left-edge.mjs — 🔴 **«같은 묶음 안의 줄들이 같은 데서 시작하나»**(§13.0 8px 그리드·정렬).
//   사용: node scripts/verify-left-edge.mjs            (빨강 1건이라도 있으면 종료코드 1)
//         node scripts/verify-left-edge.mjs --json
//         PAGES=plans.html,accounts.html node scripts/verify-left-edge.mjs   (표본 바꾸기)
//
//   왜 생겼나 — 🔴 **사장님이 라이브에서 찾으셨다**(2026-09-23): «설정 1섹션·2섹션이 왼쪽으로 붙어 있어».
//     `.group` 안에서 `.gt`(제목)와 `.row` 는 좌 16px 인데 `.fr` 만 좌 0 이었다(`.fr` 은 원래 **바텀시트용**이고,
//     시트가 자기 여백을 주니 0 이 맞다 — 그게 페이지 `.group` 안으로 들어오면서 **들여쓰기를 잃었다**).
//     🔴 `class="fr"` 는 **90곳 · 화면 12개**에 있었다. 설정만의 문제가 아니었다.
//   🔴 왜 **아무 자도 못 잡았나** — `verify-pages`(켜지나) · `verify-contrast`(글자 대비) · `verify-r9-bleed`(가로 넘침)
//     어느 것도 **«같은 묶음 안의 왼쪽 시작점»**을 안 본다. 그래서 90곳이 오래 있었다. 품질 등급 100점도 이걸 안 봤다
//     (**100점은 «다 좋다»가 아니라 «그 17가지는 좋다»였다**).
//   🔴 재는 법: 정적으로는 안 보인다 — CSS 상속·덮어쓰기의 **결과**라서 **브라우저로 실제 좌표를 잰다**
//     (`verify-pause-surface` 와 같은 규율 · PITFALLS #9 «그렸다 ≠ 보인다»).
//
//   playwright 는 ../AutoMarketing 것을 쓴다(이 리포엔 없다 · 형제 하니스와 같은 규율).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const JSON_OUT = process.argv.includes("--json");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PW = join(resolve(process.env.PW_DIR || join(ROOT, "../AutoMarketing")), "node_modules/playwright/index.mjs");
const PORT = Number(process.env.PORT || 8941);   // 🔴 워크트리마다 포트를 가른다(옛 폴더가 답하면 «내 코드가 섰다»가 거짓이 된다)
/* 표본 = `.fr` 이 많은 화면 셋. 전부 도는 것보다 **여기서 어긋나면 어디서든 어긋난다**(같은 CSS 한 벌이라). */
const PAGES = (process.env.PAGES || "plans.html,accounts.html,settings.html").split(",").map((s) => s.trim()).filter(Boolean);
const TOL = 1;   // 반올림 오차만 봐준다(1px)

const results = [];
const rec = (step, ok, note = "") => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note }); return !!ok; };

if (!existsSync(PW)) { console.log("⊘ 못 쟀어요 — playwright 가 없다(PW_DIR 로 알려 주세요). **못 쟀음은 통과가 아니다**(AC-9)."); process.exit(2); }

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png" };
const PUB = join(ROOT, "public");
const srv = createServer((req, res) => {
  const p = decodeURIComponent((req.url || "/").split("?")[0]);
  let f = join(PUB, p);
  try { if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html"); } catch { /* noop */ }
  if (!f.startsWith(PUB) || !existsSync(f)) { res.writeHead(404); return res.end("no"); }
  res.writeHead(200, { "Content-Type": TYPES[extname(f)] || "application/octet-stream" });
  res.end(readFileSync(f));
});
await new Promise((ok) => srv.listen(PORT, ok));
const { chromium } = await import(pathToFileURL(PW).href);
const browser = await chromium.launch();

/** 한 화면의 `.group` 들을 돌며 «묶음 안 왼쪽 시작점»과 «오른쪽 잘림»을 잰다. */
async function measure(page) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1600 }, isMobile: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e.message).slice(0, 110)));
  await pg.goto(`http://localhost:${PORT}/app/${page}?mock=1`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(700);
  const out = await pg.evaluate((tol) => {
    const vis = (el) => el.offsetParent !== null && el.getBoundingClientRect().width > 0;
    /* 🔴 **첫 판이 틀렸다**: 안쪽 글자 상자(`.l`·`.fl`)를 쟀더니 **아이콘 있는 줄**이 66px 어긋난 것으로 나왔다 —
       마크는 줄의 일부지 어긋남이 아니다. ⇒ **줄 자체의 «내용이 시작하는 x»**(테두리 왼쪽 + padding-left)를 잰다.
       그게 사장님이 보신 «왼쪽으로 붙었다»의 정체다(줄의 들여쓰기).
       🔴 그리고 `.fr` 은 `.group` 의 **직계**가 아닐 수 있다(안에 감싼 div 가 있다) — `closest('.group')` 로 묶는다.
          첫 판은 직계만 봐서 `plans` 의 `.fr` 10줄을 **0줄로 셌다**(자가 눈이 먼 것이다). */
    const all = [...document.querySelectorAll(".gt, .row, .fr")].filter(vis);
    const byGroup = new Map();
    let frCount = 0; const clipped = [];
    for (const el of all) {
      if (el.closest(".sheet")) continue;            // 🔴 시트는 자기 여백이 있다 — 여기선 안 본다
      const g = el.closest(".group"); if (!g || !vis(g)) continue;
      const kind = el.classList.contains("gt") ? "gt" : el.classList.contains("row") ? "row" : "fr";
      if (kind === "fr") frCount++;
      const cs = getComputedStyle(el);
      const x = Math.round(el.getBoundingClientRect().left + parseFloat(cs.paddingLeft || "0"));
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push({ kind, x, text: (el.innerText || "").replace(/\s+/g, " ").slice(0, 30) });
      /* 오른쪽 잘림 — 줄 안의 것이 줄 밖으로 나갔나(들여쓰면 폭이 좁아지니 같이 본다) */
      const gr = el.getBoundingClientRect();
      for (const c of el.querySelectorAll("*")) {
        if (!vis(c)) continue;
        const cr = c.getBoundingClientRect();
        if (cr.width > 0 && cr.right > gr.right + tol) { clipped.push(`${kind} « ${(el.innerText || "").replace(/\s+/g, " ").slice(0, 22)} » ${Math.round(cr.right - gr.right)}px`); break; }
      }
    }
    const bad = []; let checked = 0;
    for (const marks of byGroup.values()) {
      if (marks.length < 2) continue;
      checked++;
      const xs = marks.map((m) => m.x), lo = Math.min(...xs), hi = Math.max(...xs);
      if (hi - lo > tol) bad.push({ diff: hi - lo, say: marks.map((m) => `${m.kind}@${m.x}`).slice(0, 6).join(" ") });
    }
    return { groups: byGroup.size, checked, frCount, bad, clipped: [...new Set(clipped)],
      over: document.documentElement.scrollWidth > window.innerWidth + 1 };
  }, tolArg());
  await ctx.close();
  return { ...out, errs };
}
function tolArg() { return TOL; }

let totalFr = 0, totalBad = 0, totalClip = 0;
for (const page of PAGES) {
  const m = await measure(page);
  totalFr += m.frCount; totalBad += m.bad.length; totalClip += m.clipped.length;
  rec(`🔴 ${page} — 묶음 안 왼쪽 시작점이 같다`, m.bad.length === 0 && !m.errs.length,
    m.errs.length ? `화면 오류 — ${m.errs[0]}`
      : m.bad.length ? `🔴 묶음 ${m.bad.length}개가 어긋난다(잰 묶음 ${m.checked} · fr ${m.frCount}줄) — ${m.bad.slice(0, 2).map((b) => `${b.diff}px 차이 [${b.say}]`).join(" | ")}`
      : `묶음 ${m.checked}개 · fr ${m.frCount}줄 — 다 같은 데서 시작한다`);
  /* 🔴 **들여쓰면 좁아진다** — 좁아진 폭에서 토글·칩·스테퍼가 밀려 나가는지 같이 본다(고치다 다른 걸 깨지 않게). */
  rec(`${page} — 줄 안의 것이 오른쪽으로 안 밀린다`, m.clipped.length === 0,
    m.clipped.length ? `🔴 ${m.clipped.length}곳 — ${m.clipped.slice(0, 2).join(" | ")}` : "0곳");
  rec(`${page} — 폰 390 가로 넘침 0`, !m.over, m.over ? "🔴 가로로 넘친다" : "0");
}

await browser.close();
srv.close();

if (JSON_OUT) console.log(JSON.stringify({ results, totalFr }, null, 2));
else {
  console.log(`🔴 «같은 묶음 안에서 같은 데서 시작하나» — 폰 390 · ${new Date().toISOString()}`);
  console.log("─".repeat(118));
  for (const r of results) console.log(`  ${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${r.step.padEnd(52)} ${r.note}`);
  console.log("─".repeat(118));
  console.log(`■ 표본 ${PAGES.length}화면 · fr ${totalFr}줄 — 어긋난 묶음 ${totalBad}개 · 밀린 것 ${totalClip}곳`);
  console.log("🔴 표본 밖 화면은 **못 쟀음**이다 — 통과로도 낙제로도 안 센다(AC-9). `PAGES=` 로 넓힐 수 있다.");
}
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
