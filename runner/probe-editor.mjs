/**
* runner/probe-editor.mjs — 네이버 스마트에디터 ONE **실측 DOM 덤프**(읽기 전용 진단).
 *   실행: `node probe-editor.mjs <blogId>` (runner 폴더에서)   (runner/profiles/verify-naver_blog 세션 재사용)
 *
 *   🔴 아무것도 쓰지 않는다 — 글을 만들지도, 저장하지도, 발행하지도 않는다. 화면을 **읽기만** 한다.
 *   왜: 셀렉터를 추측으로 넣으면 조용히 폴백으로 흘러 «되는 것처럼» 보인다(2026-09-14 `horizontalLine` 사고).
 *       AM 에 없는 자리(«본문 추가» 버튼 등)는 이렇게 **실물에서 이름을 받아 적는다**.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blogId = process.argv[2] || process.env.TEST_NAVER_ID;
if (!blogId) { console.error("사용법: runner 폴더에서 node probe-editor.mjs <blogId>"); process.exit(2); }

const ctx = await chromium.launchPersistentContext(path.join(ROOT, "runner", "profiles", "verify-naver_blog"), {
  headless: true, locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: { width: 1440, height: 960 },
  args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();

try {
  await page.goto(`https://blog.naver.com/${blogId}/postwrite`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(6000);

  // 에디터 컨텍스트 찾기(top 또는 iframe)
  let ed = page;
  for (const fr of page.frames()) {
    if (fr === page.mainFrame()) continue;
    if (await fr.locator(".se-content, .se-container").first().isVisible({ timeout: 1500 }).catch(() => false)) { ed = fr; break; }
  }
  console.log(`\n에디터 컨텍스트: ${ed === page ? "top(page)" : "iframe"}\n`);

  const dump = await ed.evaluate(() => {
    const out = {};
    const desc = (el) => ({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 4).join(" "),
      name: el.getAttribute("data-name") || null,
      aria: el.getAttribute("aria-label") || null,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 20) || null,
      vis: !!(el.offsetParent || el.getClientRects().length),
    });
    // ① 도구모음 버튼 전수(data-name·aria-label)
    out.toolbar = [...document.querySelectorAll(".se-toolbar button, button[class*='se-']")].slice(0, 60).map(desc);
    // ② «본문 추가» 후보 — 캔버스 아래 hover 영역
    out.bottomButton = [...document.querySelectorAll("[class*='canvas-bottom'], [class*='edge-area'], [class*='add-block'], [class*='__se_add']")].map(desc);
    // ③ 문단 스타일 드롭다운(본문/소제목)
    out.paragraphStyle = [...document.querySelectorAll("button[class*='font-size'], button[class*='text-style'], [class*='se-document-toolbar'] button")].slice(0, 20).map(desc);
    // ④ 현재 컴포넌트 구성
    out.components = [...document.querySelectorAll(".se-component")].map((c) => (c.className || "").toString().split(/\s+/).find((x) => /^se-(text|quotation|image|horizontalLine|horizontal-line|oglink)$/.test(x)) || "?");
    return out;
  });

  console.log("■ «본문 추가» 후보 (se-canvas-bottom-button 이 실제로 있나)");
  console.log(dump.bottomButton.length ? JSON.stringify(dump.bottomButton, null, 1) : "  (0건 — 이 이름으로는 없다)");
  console.log("\n■ 문단 스타일·글자 크기 버튼");
  console.log(JSON.stringify(dump.paragraphStyle, null, 1));
  console.log("\n■ 도구모음 버튼(앞 60개)");
  for (const b of dump.toolbar) if (b.name || b.aria) console.log(`  ${b.vis ? "보임" : "숨김"} · ${b.cls} · data-name=${b.name} · aria=${b.aria}`);
  console.log("\n■ 현재 컴포넌트:", dump.components.join(" > ") || "(없음)");
} finally {
  await ctx.close();
}
