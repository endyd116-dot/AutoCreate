// scripts/verify-pause-surface.mjs — 🔴 **잠깐 멈춤이 «화면에 닿나»**(§5B.11 (1-d) ②).
//   사용: node scripts/verify-pause-surface.mjs          (빨강 1건이라도 있으면 종료코드 1)
//         node scripts/verify-pause-surface.mjs --json
//
//   왜 이 자가 필요했나 — 🔴 **33축이 전부 초록인 채로 구멍이 열려 있었다**(2026-09-22).
//     B 의 `verify-pause-scope` 는 **서버**를 잰다: `loadPause()` 가 `backlog:{count}` 를 쉬든 안 쉬든 싣나.
//     그 축은 초록이었고 값도 라이브에서 실제로 왔다(778 · resume 을 안 불렀는데 count=1).
//     그런데 **화면 두 줄**이 그 값을 안 그렸다:
//       `home.html`   `bn.hidden = !(pz && pz.paused)`            → 깬 손님은 `paused=false` 라 배너가 통째로 숨는다
//       `settings`    `backlogRow()` 를 `if (PAUSE.paused)` 안에서만 부른다  → 같은 손님에게 안 그려진다
//     🔴 B 가 «내 자는 화면을 안 잰다»고 정확히 적어 뒀다. **그 사이가 비어 있었다.** 이 자가 그 사이다.
//     🔴 그리고 **주석은 맞게 적혀 있었다** — 코드가 안 따라갔다. 주석은 자가 아니다(AC-59 의 뒤집힌 얼굴).
//
//   재는 법: 정적 읽기가 아니라 **브라우저로 그 판을 띄워 본다**(모의 `?pause=woke` — 깬 손님 판).
//     🔴 «그렸다 ≠ 보인다»(PITFALLS #9) — 이 구멍이 바로 «코드에 있는데 화면에 없는» 꼴이라 눈으로 봐야 잡힌다.
//   playwright 는 ../AutoMarketing 것을 쓴다(이 리포엔 없다 · 형제 하니스와 같은 규율).
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, join, extname, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const JSON_OUT = process.argv.includes("--json");
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PW_DIR = resolve(process.env.PW_DIR || join(ROOT, "../AutoMarketing"));
const PW = join(PW_DIR, "node_modules/playwright/index.mjs");
const PORT = Number(process.env.PORT || 8931);   // 🔴 워크트리마다 포트를 가른다(옛 폴더가 답하면 «내 코드가 섰다»가 거짓이 된다)

const results = [];
const rec = (step, ok, note = "") => { results.push({ step, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note }); return !!ok; };

if (!existsSync(PW)) {
  console.log("⊘ 못 쟀어요 — playwright 가 없다(PW_DIR 로 알려 주세요). **못 쟀음은 통과가 아니다**(AC-9).");
  process.exit(2);
}

/* ── 정적 서버(public/) ── */
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

/** 한 판을 띄워 «쉼 줄»이 어떻게 보이나를 읽는다. */
async function look(page, qs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 1400 }, isMobile: true });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(String(e.message).slice(0, 120)));
  await pg.goto(`http://localhost:${PORT}/app/${page}?mock=1&${qs}`, { waitUntil: "networkidle" });
  await pg.waitForTimeout(600);
  const out = await pg.evaluate(() => {
    const vis = (el) => !!el && el.offsetParent !== null && !el.hidden;
    const bn = document.querySelector("#pauseBn");
    const body = document.querySelector("#pauseBody");
    return {
      bannerShown: vis(bn) || (bn && bn.hidden === false),
      bannerText: bn ? (document.querySelector("#pauseBnT") || {}).textContent || "" : "",
      bodyText: body ? body.innerText.replace(/\s+/g, " ") : "",
      hasChoose: !!document.querySelector("#pBacklog") || !!(document.querySelector("#pauseResume") || {}).textContent?.includes("밀린 글"),
    };
  });
  await ctx.close();
  return { ...out, errs };
}

/* ═══ ① 🔴 깬 손님(`paused=false` · 밀린 글 3건) — **이 판이 구멍이었다** ═══ */
const wokeHome = await look("home.html", "pause=woke");
rec("🔴 깬 손님(paused=false · 밀린 글>0) — 홈에 그 줄이 보인다", wokeHome.bannerShown && !wokeHome.errs.length,
  wokeHome.errs.length ? `화면 오류 — ${wokeHome.errs[0]}` : wokeHome.bannerShown ? `« ${wokeHome.bannerText} »` : "🔴 **안 보인다** — 깬 손님은 `paused=false` 라 숨는다(그게 AC-221 의 화면 쪽 반쪽이다)");

/* 🔴 **말이 갈리나** — 이미 깼는데 «지금은 쉬고 있어요»면 거짓말이다. */
rec("🔴 깬 손님에게 «쉬고 있어요»라고 하지 않는다", wokeHome.bannerShown && !wokeHome.bannerText.includes("쉬고 있어요"),
  wokeHome.bannerShown ? (wokeHome.bannerText.includes("쉬고 있어요") ? `🔴 이미 깼는데 «쉬고 있어요»라고 한다 — « ${wokeHome.bannerText} »` : `« ${wokeHome.bannerText} »`) : "줄이 안 보여서 못 쟀다");

const wokeSet = await look("settings.html", "pause=woke");
rec("🔴 깬 손님 — 설정에 «고르기»가 있다", wokeSet.hasChoose && !wokeSet.errs.length,
  wokeSet.errs.length ? `화면 오류 — ${wokeSet.errs[0]}` : wokeSet.hasChoose ? `« ${wokeSet.bodyText.slice(0, 90)} »` : "🔴 **고를 자리가 없다** — 저절로 깬 손님은 영영 못 고른다");

/* ═══ ② 쉬는 중 + 밀린 글 — 원래 되던 길이 그대로인가(되돌아가지 않았나) ═══ */
const restBack = await look("settings.html", "pause=backlog");
rec("쉬는 중 + 밀린 글 — 설정에 «고르기»가 있다", restBack.hasChoose, restBack.hasChoose ? `« ${restBack.bodyText.slice(0, 80)} »` : "🔴 없다");
const restHome = await look("home.html", "pause=on");
rec("쉬는 중 — 홈이 «쉬고 있어요 · N일째»를 말한다", restHome.bannerShown && restHome.bannerText.includes("쉬고 있어요"), `« ${restHome.bannerText} »`);

/* ═══ ③ 🔴 조용해야 할 때 조용한가 — 안 쉬고 밀린 글도 없으면 아무 말도 없어야 한다 ═══ */
const quiet = await look("home.html", "");
rec("🔴 안 쉬고 밀린 글도 없으면 그 줄이 **없다**(거짓 경보 0)", !quiet.bannerShown, quiet.bannerShown ? `🔴 괜한 줄이 뜬다 — « ${quiet.bannerText} »` : "조용하다");

await browser.close();
srv.close();

/* ── 냄 ── */
if (JSON_OUT) { console.log(JSON.stringify({ results }, null, 2)); }
else {
  const W = 66;
  console.log(`🔴 잠깐 멈춤이 «화면에 닿나» — 깬 손님 판까지 · ${new Date().toISOString()}`);
  console.log("─".repeat(118));
  for (const r of results) console.log(`  ${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${r.step.padEnd(W)} ${r.note}`);
  console.log("─".repeat(118));
  const bad = results.filter((r) => r.ok === "FAIL").length;
  console.log(`■ 축 ${results.length}개 — 빨강 ${bad}개`);
  console.log("🔴 이 자는 **화면**을 잰다 — 서버 쪽은 `verify-pause-scope`(B) 가 잰다. 둘이 짝이다(한쪽만 초록이면 손님에겐 아무것도 안 닿는다).");
}
process.exit(results.some((r) => r.ok === "FAIL") ? 1 : 0);
