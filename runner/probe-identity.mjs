/**
 * runner/probe-identity.mjs — 🔴 «지금 내가 어느 블로그에 쓰고 있나» **실측 탐침**(AC-201 · B2 2026-09-21).
 *   실행: runner 폴더에서 `node probe-identity.mjs [사진폴더]`   (기본 `../_shots/probe-identity`)
 *   🔴 **아무것도 쓰지 않는다** — 로그인 0 · 글 0 · 임시저장 0 · 발행 0. 페이지 두 개를 열어 **읽기만** 한다.
 *
 *   ══ 이 탐침이 죽인 가설(2026-09-21 · 세 번 돌렸다) ══
 *     가설: «AM `detectBlogIdOnPage` 처럼 BlogHome 의 링크 최빈값을 쓰면 내 블로그를 알 수 있다.»
 *     실측(로그아웃 · 세 번):
 *       1회차 링크 96 · 아이디 84 · 최빈 5회 = aronmovie · liferecord689 · winsighting …
 *       2회차 같은 화면          최빈 5회 = nuk1905 · lbmoon68 · minahan …
 *       3회차 같은 화면          최빈 5회 = vicoy · uijae0622 · jae_ilsang …
 *     ⇒ 🔴 **전부 남의 블로그였고 매번 달랐다.** 그 값은 «내 블로그»가 아니라 «오늘 네이버가 미는 블로그»다.
 *        `readMyBlogId` 에서 그 사다리를 **뺐다**(`runner/lib/auth-naver.mjs` 머리말).
 *
 *   ══ 아직 **못 쟨** 것 ══
 *     🔴 **로그인 상태의 `MyBlog.naver` 리다이렉트** — 이 PC 에 로그인된 네이버 프로필이 없다(발행한 러너는 다른 기기).
 *        로그아웃 쪽(→ `nid.naver.com/nidlogin.login`)만 실물로 확인했다.
 *        ⇒ 로그인 프로필이 있는 기기에서 `node probe-identity.mjs` 를 한 번 돌려 **`via:"myblog"` 와 실제 아이디**를 확인해야
 *           «이 방법이 된다»가 실증이 된다. 그 전까지는 **스모크**다.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { readMyBlogId, blogIdFromUrl, pickBlogIdFromLinks, judgeBlogIdentity } from "./lib/auth-naver.mjs";

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const OUT = process.argv[2] || path.join(HERE, "..", "_shots", "probe-identity");
const HANDLE = process.argv[3] || "endy1116";   // 댈 장부 값(읽기만 — 이 계정에 아무것도 쓰지 않는다)
mkdirSync(OUT, { recursive: true });

/* 🔴 빈 문자열 = **프로필 없이**(일회용 컨텍스트). 저장된 로그인을 건드리지 않는다.
   로그인 상태로 재려면 러너 프로필 경로를 여기에 넣어 돌린다. */
const PROFILE = process.env.AC_PROBE_PROFILE || "";
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: process.env.HEADED !== "1", viewport: { width: 1280, height: 900 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  console.log(`── ① MyBlog.naver — 로그인이 필요한 주소가 **어디로 보내나**${PROFILE ? " (저장된 프로필)" : " (로그아웃)"}`);
  await page.goto("https://blog.naver.com/MyBlog.naver", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(1200);
  console.log("   url =", page.url().slice(0, 110));
  console.log("   id  =", blogIdFromUrl(page.url()), "   ← 로그인돼 있으면 여기 **내 블로그 아이디**가 나온다");
  await page.screenshot({ path: path.join(OUT, "01-myblog.png") });

  console.log("\n── ② BlogHome 링크 최빈값 — 🔴 **뺀 사다리**가 무엇을 내는지(다시 넣지 말라는 증거)");
  await page.goto("https://section.blog.naver.com/BlogHome.naver", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const hrefs = await page.locator('a[href*="blog.naver.com/"]').evaluateAll((els) => els.map((e) => e.getAttribute("href") || "")).catch(() => []);
  const ids = hrefs.map(blogIdFromUrl).filter(Boolean);
  const freq = {}; for (const i of ids) freq[i] = (freq[i] ?? 0) + 1;
  console.log("   링크", hrefs.length, "· 아이디로 읽힌 것", ids.length);
  console.log("   최빈 5 =", JSON.stringify(Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5)));
  console.log("   pickBlogIdFromLinks →", pickBlogIdFromLinks(hrefs), "   ← 🔴 내 블로그가 아니면 그게 이 사다리를 뺀 이유다");
  await page.screenshot({ path: path.join(OUT, "02-bloghome.png") });

  console.log("\n── ③ readMyBlogId 통째로 + 판정");
  const r = await readMyBlogId(page);
  console.log("   readMyBlogId =", JSON.stringify(r));
  console.log(`   judge(handle=${HANDLE}) =`, JSON.stringify(judgeBlogIdentity({ handle: HANDLE, observed: r.blogId, via: r.via, confirmed: null })));
  await page.screenshot({ path: path.join(OUT, "03-끝.png") });
  console.log(`\n사진: ${OUT}`);
} finally { await ctx.close(); }
