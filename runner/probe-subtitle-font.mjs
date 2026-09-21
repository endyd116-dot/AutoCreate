/**
 * runner/probe-subtitle-font.mjs — 🔴 **«자막이 어느 폰트로 그려지나»를 실물로 잰다**(AC-202 · B2 2026-09-22).
 *   실행: runner 폴더에서 `node probe-subtitle-font.mjs [사진폴더]`
 *   🔴 **AI 를 부르지 않는다 · ffmpeg 를 돌리지 않는다 · 아무것도 발행하지 않는다.**
 *      `buildOverlayHtml` 이 내는 **그 페이지 그대로** 열어서 글자만 그려 보고 폰트를 잰다.
 *
 *   ══ 왜 ══
 *     `@font-face{src:local("Pretendard")}` 는 «그 PC 에 깔려 있으면»이다. 러너에 한글 폰트는 **0개**였다.
 *     ⇒ 지금까지 구운 자막이 전부 맑은 고딕이었는지 **숫자로** 본다. «고쳤다»보다 이게 먼저다.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { buildOverlayHtml } from "./channels/render-video.mjs";
import { measureOverlayFont, FONT_SAMPLE } from "./lib/font.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(HERE, "..", "_shots", "probe-subtitle-font");
mkdirSync(OUT, { recursive: true });

/* 실제 렌더가 쓰는 모양 그대로 — 쇼츠 1080×1920 · 자막 프리셋 기본. */
const payload = {
  out: { w: 1080, h: 1920 },
  overlay: { safeZone: { top: 220, bottom: 450, side: 60 }, badge: { text: "광고 · 제휴 링크 포함" } },
  captions: { preset: "keyword_center", phrases: [{ idx: 0, text: FONT_SAMPLE, keyword: "3만원", startMs: 0, endMs: 2000 }] },
};

const html = buildOverlayHtml(payload);
const pagePath = path.join(OUT, "overlay.html");
writeFileSync(pagePath, html, "utf8");

const ctx = await chromium.launchPersistentContext("", { headless: true, viewport: { width: 1080, height: 1920 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  await page.goto(pathToFileURL(pagePath).href, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => window.__ready);

  console.log("── @font-face 가 적힌 모양(코드에서 그대로)");
  console.log("   " + (html.match(/@font-face\{[^}]*\}/)?.[0] ?? "(없음)"));
  console.log("   " + (html.match(/body\{font-family:[^;]*/)?.[0] ?? "(없음)"));

  console.log("\n── 🔴 실제로 어느 폰트로 그려졌나");
  const v = await measureOverlayFont(page);
  console.log(`   판정 = ${v.kind}${v.family ? ` (${v.family})` : ""}${v.why ? ` · ${v.why}` : ""}`);
  console.log(`   body 스택 = ${v.bodyStack}`);
  console.log(`   @font-face 상태 = ${JSON.stringify(v.faces)}`);
  console.log(`   폭(px, 같은 문장 "${v.sample}"):`);
  const w = v.evidence?.widths ?? {};
  console.log(`     body 스택이 실제로 그린 것 = ${w.used}`);
  console.log(`     Pretendard 만 지정        = ${w.target}`);
  console.log(`     맑은 고딕만 지정          = ${w.fallbackNamed}`);
  console.log(`     🔴 없는 이름(브라우저 기본) = ${w.bogus}`);
  console.log(`   document.fonts.check = ${JSON.stringify(v.evidence?.checks)}`);
  console.log(`\n   ⇒ ${w.target === w.bogus ? "🔴 Pretendard 로 지정해도 **기본과 폭이 같다** = 안 걸렸다." : "Pretendard 가 기본과 다른 폭을 낸다 = 걸렸다."}`);
  console.log(`   ⇒ ${w.used === w.fallbackNamed ? "🔴 실제로 그려진 것은 **맑은 고딕**이다(폭이 정확히 같다)." : "실제로 그려진 것은 맑은 고딕이 아니다."}`);

  // 자막 한 장 — 눈으로도 보이게.
  await page.evaluate((s) => window.__show(s, { badge: true, endcard: false }), FONT_SAMPLE);
  writeFileSync(path.join(OUT, "01-자막-동봉.png"), await page.screenshot({ type: "png", omitBackground: false }));

  /* ═══ 🔴 **떨어질 때** — 동봉 폰트가 없으면 어떻게 되나 ═══
     「없어도 영상은 나온다」와 「그 사실이 남는다」를 **말이 아니라 실물로** 확인한다.
     파일을 지우지 않고, `url()` 만 뺀 같은 페이지를 열어 본다(= `fontFaceCss(null)` 이 내는 모양). */
  console.log("\n── 🔴 떨어질 때(동봉 폰트가 없는 셈 치고) — 영상이 나오나 · 기록되나");
  const fallbackHtml = html.replace(/src:url\("[^"]*"\) format\("woff2"\),/, "src:");
  const fbPath = path.join(OUT, "overlay-폴백.html");
  writeFileSync(fbPath, fallbackHtml, "utf8");
  console.log("   " + (fallbackHtml.match(/@font-face\{[^}]*\}/)?.[0] ?? "(없음)"));
  await page.goto(pathToFileURL(fbPath).href, { waitUntil: "load", timeout: 30_000 });
  await page.evaluate(() => window.__ready);
  const fb = await measureOverlayFont(page);
  console.log(`   판정 = ${fb.kind}${fb.family ? ` (${fb.family})` : ""}${fb.ambiguous ? " · 🔴 기본과 구별은 못 함" : ""} · ${fb.why ?? ""}`);
  console.log(`   @font-face 상태 = ${JSON.stringify(fb.faces)}`);
  console.log(`   폭 = ${fb.evidence?.widths?.used}  (동봉본은 ${v.evidence?.widths?.used})`);
  await page.evaluate((s) => window.__show(s, { badge: true, endcard: false }), FONT_SAMPLE);
  writeFileSync(path.join(OUT, "02-자막-폴백.png"), await page.screenshot({ type: "png", omitBackground: false }));
  const drawn = await page.evaluate(() => (document.getElementById("cap")?.innerText ?? "").trim().length);
  console.log(`   🔴 글자가 그려졌나 = ${drawn > 0 ? `예(${drawn}자) — 영상은 그대로 나온다` : "아니오 — 🔴 글자가 사라졌다"}`);
  console.log(`   🔴 기록되나       = ${fb.kind !== "bundled" ? `예 · formatMarks.subtitleFont = ${JSON.stringify({ kind: fb.kind, family: fb.family, ambiguous: fb.ambiguous ?? false })}` : "🔴 아니오(폴백인데 bundled 로 읽었다)"}`);
  console.log(`\n사진: ${OUT}`);
} finally { await ctx.close(); }
