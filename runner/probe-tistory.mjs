/**
 * runner/probe-tistory.mjs — 티스토리 글쓰기 화면 **실측 DOM 덤프**(읽기 전용 · verify-tistory 세션 재사용).
 *   실행: runner 폴더에서 `node probe-tistory.mjs <host>`  (예: note83685.tistory.com)
 *   🔴 아무것도 쓰지 않는다 — 글을 만들지도 저장하지도 않는다. 모드 버튼·저장/완료 버튼·에디터 형태를 읽기만.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const host = process.argv[2] || "note83685.tistory.com";

const ctx = await chromium.launchPersistentContext(path.join(ROOT, "profiles", "verify-tistory"), {
  headless: true, locale: "ko-KR", timezoneId: "Asia/Seoul", viewport: { width: 1440, height: 960 },
  args: ["--disable-blink-features=AutomationControlled", "--no-first-run"],
});
const page = ctx.pages()[0] ?? await ctx.newPage();

try {
  await page.goto(`https://${host}/manage/newpost/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(4000);
  // 복구 팝업 닫기
  for (const sel of ["button:has-text('취소')", ".btn_cancel", "button[class*='cancel']"]) {
    try { const b = page.locator(sel).first(); if (await b.isVisible({ timeout: 1000 }).catch(() => false)) { await b.click().catch(() => {}); break; } } catch { /* */ }
  }
  await page.waitForTimeout(1500);
  console.log("url:", page.url());

  const dump = await page.evaluate(() => {
    const desc = (el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      cls: (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 3).join(" ") || null,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 16) || null,
      vis: !!(el.offsetParent || el.getClientRects().length),
    });
    const pick = (sel) => [...document.querySelectorAll(sel)].slice(0, 20).map(desc);
    return {
      title: pick("#post-title-inp, input[placeholder*='제목'], .textarea_tit, textarea"),
      // 하단 버튼 영역(저장·완료·발행)
      bottomButtons: [...document.querySelectorAll("button, a[role='button'], .btn, [class*='btn']")]
        .filter((el) => /저장|완료|발행|공개/.test(el.textContent || ""))
        .slice(0, 15).map(desc),
      // 모드 전환(기본/마크다운/HTML)
      modeButtons: [...document.querySelectorAll("button, a, [role='button'], [class*='mode']")]
        .filter((el) => /모드|HTML|기본|마크다운/.test(el.textContent || ""))
        .slice(0, 15).map(desc),
      // 에디터 형태
      editors: { tinymceIfr: !!document.querySelector("iframe#editor-tistory_ifr, iframe[id*='editor']"), codemirror: !!document.querySelector(".CodeMirror"), contenteditable: document.querySelectorAll("[contenteditable='true']").length },
      iframes: [...document.querySelectorAll("iframe")].map((f) => f.id || f.name || "(no-id)").slice(0, 8),
    };
  });
  console.log(JSON.stringify(dump, null, 1));
} finally {
  await ctx.close();
}
