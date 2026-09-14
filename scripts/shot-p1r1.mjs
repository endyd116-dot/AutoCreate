// scripts/shot-p1r1.mjs — P1R1 화면 하니스(C3): 폰 390 / 데스크톱 1280 으로 accounts→create→director→pieces→piece→schedule(+home·account) 왕복 스크린샷
//   + 콘솔 에러·pageerror·실패 요청 수집 + 헌장(DESIGN §13.0) 자동 검사(페이지당 보이는 `.btn.primary` ≤1 · `.hl .num` ≤1 · 이모지 0 · 시스템 용어 «테넌트/piece/슬롯/러너 잡» 0 · 가로 넘침 0).
//   playwright 는 ../AutoMarketing/node_modules 것을 쓴다(이 리포엔 없음). 실행 위치 무관 — 파일 위치 기준으로 찾는다.
//   사용: node scripts/shot-p1r1.mjs                      (BASE_URL 기본 http://localhost:8899 · 로그인 = TEST_EMAIL/TEST_PASSWORD · 하니스 C2 와 같은 계정)
//         MOCK=1 node scripts/shot-p1r1.mjs              (A 의 ?mock=1 층으로 — 백 없이 화면만)
//         PW_DIR=../AutoMarketing  (playwright 위치 덮어쓰기)
//   출력: _shots/p1r1/<page>-<vp>.png(+ -sheet.png) · _shots/p1r1/report-<ts>.json · 표(stdout).  초록 = 증거 아님 — 스샷을 눈으로 본다(PITFALLS #9).
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
if (existsSync(".env")) for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) { const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, ""); }
const BASE = (process.env.BASE_URL || "http://localhost:8899").replace(/\/$/, "");
const EMAIL = process.env.TEST_EMAIL || "c+p1@autocreate.test";
const PASSWORD = process.env.TEST_PASSWORD || "Cp1Verify2026x";
const MOCK = process.env.MOCK === "1";
const PW_DIR = resolve(process.env.PW_DIR || join(HERE, "../../AutoMarketing"));
const OUT = resolve(process.env.SHOT_DIR || join(HERE, "../_shots/p1r1"));
mkdirSync(OUT, { recursive: true });

const { chromium } = await import(pathToFileURL(join(PW_DIR, "node_modules/playwright/index.mjs")).href);

const VIEWPORTS = { phone: { width: 390, height: 844, isMobile: true, hasTouch: true }, desktop: { width: 1280, height: 800 } };
const FORBIDDEN = /테넌트|러너|piece|슬롯/i;   // «러너» 도 고객 화면 금지어(R2 §3 v3.1 · «내 PC» 로 말한다)
const EMOJI_HARD = /\p{Emoji_Presentation}/u;                 // 진짜 이모지(컬러 글리프) = FAIL
const EMOJI_SOFT = /\p{Extended_Pictographic}/u;              // ✎ ▦ 같은 딩뱃 = WARN(마크로 쓰는 중 · 헌장 «아이콘 1세트(선형)» 대상)

const results = [];
const rec = (page, vp, check, ok, note = "", evidence) => results.push({ page, vp, check, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note, evidence });

/* ── 페이지 목록(순서 = 왕복 순서) · 시트 여는 동작(있으면) ── */
function pages(ids) {
  const q = (u) => MOCK ? `${u}${u.includes("?") ? "&" : "?"}mock=1` : u;
  return [
    { key: "accounts", url: q("/app/accounts.html"), sheet: [".cg .cgi", "button:has-text('연결')"] },
    { key: "create", url: q("/app/create.html"), sheet: ["button:has-text('디렉터에게')", "a:has-text('디렉터에게')"] },
    { key: "director", url: q(`/app/director.html?topicId=${ids.topicId || 1}`), sheet: ["button:has-text('손보기')"] },
    { key: "pieces", url: q("/app/pieces.html"), sheet: [] },
    { key: "piece", url: q(`/app/piece.html?id=${ids.pieceId || 1}`), sheet: ["button:has-text('⋯')", ".appbar .ic:last-child", "button[aria-label*='더']"] },
    { key: "schedule", url: q("/app/schedule.html"), sheet: ["#mkRule", "button:has-text('자동 편성 켜기')", ".appbar .ic:last-child"] },
    { key: "home", url: q("/app/home.html"), sheet: [] },
    { key: "account", url: q("/app/account.html"), sheet: [] },
    // P1R2·R3 화면(계약 v2.11 §5 · v3.5)
    { key: "runner", url: q("/app/runner.html"), sheet: ["button:has-text('내 PC에서 켜기')", "button:has-text('켜기')"] },
    { key: "posts", url: q("/app/posts.html"), sheet: [] },
    { key: "notifications", url: q("/app/notifications.html"), sheet: [] },
    { key: "revenue", url: q("/app/revenue.html"), sheet: [] },
    { key: "ad-media", url: q("/app/ad-media.html"), sheet: [] },
    { key: "onboarding", url: "/onboarding.html", sheet: ["button:has-text('다음')"] },   // 영상 채널 «곧 열려요» 칩(라이브 4채널 active)
    { key: "login", url: "/login.html", sheet: [] },   // SSO 카드 회귀
  ].filter((p) => !process.env.PAGES || process.env.PAGES.split(",").includes(p.key));
}

/* ── 헌장 검사(페이지 안에서 실행) ── */
const CHARTER = () => {
  const vis = (el) => (typeof el.checkVisibility === "function" ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : !!el.offsetParent);
  const inSheet = (el) => !!el.closest(".sheet");
  const primaries = [...document.querySelectorAll(".btn.primary")].filter(vis);
  const nums = [...document.querySelectorAll(".hl .num")].filter(vis);
  const clone = (document.querySelector("main") || document.body).cloneNode(true); clone.querySelectorAll(".mk, script, style").forEach((e) => e.remove()); document.body.appendChild(clone); clone.style.cssText = "position:absolute;left:-9999px;top:0";
  const text = clone.innerText || ""; clone.remove();   // 채널 마크(.mk)는 이모지 검사 제외(마크는 헌장상 허용 컬러)
  const cta = [...document.querySelectorAll(".cta .btn.primary, .btn.primary")].filter(vis).length;
  return {
    primaryPage: primaries.filter((e) => !inSheet(e) && !e.closest(".row")).length, primaryRow: primaries.filter((e) => !inSheet(e) && e.closest(".row")).length, primarySheet: primaries.filter(inSheet).length,
    bigNum: nums.length, text, scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    sheetOpen: !!document.querySelector(".sheet"), buttonsSmall: [...document.querySelectorAll("button, a.btn, .row.tap")].filter((e) => !e.closest(".cal")).filter(vis).filter((e) => {
      const r0 = e.getBoundingClientRect(); if (r0.height <= 0 || r0.height >= 44) return false;
      e.scrollIntoView({ block: "center", inline: "nearest" }); const r = e.getBoundingClientRect();   // 화면 밖 요소는 elementFromPoint 가 null — 보이는 자리로 옮겨 잰다
      // 눌리는 영역 = 가운데 x 축에서 위·아래로 elementFromPoint 가 이 요소(또는 자손)를 돌려주는 구간 — 투명 오버레이(::before)까지 포함해 잰다
      const cx = Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)); const hits = (el) => !!el && (el === e || e.contains(el));
      let count = 0;   // 세로 축에서 실제로 눌리는 정수 좌표 수(오버레이 포함) — 44 미만이면 작다
      for (let y = Math.max(0, Math.floor(r.top) - 12); y <= Math.min(window.innerHeight - 1, Math.ceil(r.bottom) + 12); y++) if (hits(document.elementFromPoint(cx, y))) count++;
      return count < 42;   // 정수 표본·서브픽셀 오차 2px 허용(43 은 통과 · 40 은 잡는다)
    }).length,
    cta,
  };
};

async function run() {
  const browser = await chromium.launch({ headless: true });
  const ids = {};
  for (const [vp, size] of Object.entries(VIEWPORTS)) {
    const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, locale: "ko-KR", timezoneId: "Asia/Seoul", baseURL: BASE, deviceScaleFactor: 1 });
    // 로그인(API · 컨텍스트 쿠키 공유) — mock 모드도 로그인은 필요(UI.boot 가 auth-me 를 부른다)
    const lg = await ctx.request.post("/api/auth-login", { data: { email: EMAIL, password: PASSWORD, remember: true } });
    if (!lg.ok()) { const rg = await ctx.request.post("/api/auth-register", { data: { email: EMAIL, password: PASSWORD, name: "C검증" } }); rec("login", vp, "auth", rg.ok(), `login ${lg.status()} → register ${rg.status()}`); }
    else rec("login", vp, "auth", true, `login ${lg.status()}`);
    // 실 데이터 id(하니스 C2 가 만든 것) — mock 이면 1
    if (!MOCK && !ids.topicId) {
      try { const t = await (await ctx.request.get("/api/topics-list?status=candidate")).json(); ids.topicId = t.topics?.[0]?.id; } catch { /* 없음 */ }
      try { const p = await (await ctx.request.get("/api/pieces-list?status=all")).json(); ids.pieceId = (p.pieces || []).find((x) => x.status === "in_review")?.id || p.pieces?.[0]?.id; } catch { /* 없음 */ }
    }
    for (const pg of pages(ids)) {
      const page = await ctx.newPage();
      const errors = [], failed = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
      page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message || e).slice(0, 200)));
      page.on("response", (r) => { if (r.status() >= 400 && !/auth-refresh|favicon/.test(r.url())) failed.push(`${r.status()} ${r.url().replace(BASE, "")}`); });
      let ok = true;
      try { await page.goto(pg.url, { waitUntil: "networkidle", timeout: 30000 }); } catch (e) { ok = false; rec(pg.key, vp, "goto", false, String(e.message).slice(0, 120)); }
      await page.waitForTimeout(800);
      const finalUrl = page.url().replace(BASE, "");
      rec(pg.key, vp, "url 유지(로그인 리다이렉트 없음)", !/login\.html/.test(finalUrl), finalUrl);
      const shot = join(OUT, `${pg.key}-${vp}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const c = await page.evaluate(CHARTER).catch(() => null); await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      if (c) {
        rec(pg.key, vp, "Primary 버튼 ≤1(페이지)", c.primaryPage <= 1, `${c.primaryPage}개`, shot);
        if (c.primaryRow) rec(pg.key, vp, "행 안 Primary(헌장 §13.0 «화면당 1개»와 충돌)", "WARN", `목록 행 액션 ${c.primaryRow}개 — 설계 판단 필요`, shot);
        rec(pg.key, vp, "큰 숫자 ≤1", c.bigNum <= 1, `${c.bigNum}개`);
        const hard = c.text.match(new RegExp(EMOJI_HARD.source, "gu")) || []; const soft = (c.text.match(new RegExp(EMOJI_SOFT.source, "gu")) || []).filter((ch) => !EMOJI_HARD.test(ch));
        rec(pg.key, vp, "이모지 0", hard.length === 0, hard.length ? `«${hard.join("")}»` : "");
        if (soft.length) rec(pg.key, vp, "딩뱃 마크(선형 아이콘 권장)", "WARN", `«${[...new Set(soft)].join("")}»`);
        const sys = c.text.match(new RegExp(FORBIDDEN.source, "gi")) || [];
        rec(pg.key, vp, "시스템 용어 0", sys.length === 0, sys.length ? `«${[...new Set(sys)].join(",")}»` : "");
        rec(pg.key, vp, "가로 넘침 0", c.scrollW <= c.innerW + 1, `scrollWidth ${c.scrollW} / ${c.innerW}`);
        if (c.buttonsSmall) rec(pg.key, vp, "터치 44px 미만 버튼(눌리는 영역 기준)", "WARN", `${c.buttonsSmall}개`);
      }
      if (pg.key === "accounts") { const g = await page.evaluate(() => [...document.querySelectorAll(".cg .cgi")].filter((e) => e.checkVisibility()).map((e) => (e.textContent || "").trim().slice(0, 8))).catch(() => []); rec(pg.key, vp, "계정 연결 그리드 = 글 4채널만(영상 6채널 숨김)", g.length === 4 && !g.some((t) => /쇼츠|클립|릴스|틱톡|인스타|쓰레드/.test(t)), g.join(",")); }
      rec(pg.key, vp, "콘솔 에러 0", errors.length === 0, errors.slice(0, 3).join(" | "));
      rec(pg.key, vp, "실패 요청(≥400) 0", failed.length === 0, failed.slice(0, 4).join(" | "));
      // 시트 열기(왕복) — 첫 셀렉터가 있으면 클릭 → 시트 스샷 → 시트 안 Primary ≤1
      if (ok && pg.sheet.length) {
        let opened = false;
        for (const sel of pg.sheet) {
          const el = page.locator(sel).first();
          if (await el.count() && await el.isVisible().catch(() => false)) {
            await el.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500);
            if (await page.locator(".sheet").count()) { opened = true; const s2 = join(OUT, `${pg.key}-${vp}-sheet.png`); await page.screenshot({ path: s2, fullPage: false }).catch(() => {}); const c2 = await page.evaluate(CHARTER).catch(() => null); rec(pg.key, vp, "시트 열림 · 시트 Primary ≤1", !!c2 && c2.primarySheet <= 1, `${sel} → primary ${c2?.primarySheet}`, s2); const sys2 = (c2?.text || "").match(new RegExp(FORBIDDEN.source, "gi")) || []; if (sys2.length) rec(pg.key, vp, "시트 시스템 용어 0", false, `«${[...new Set(sys2)].join(",")}»`); }
            break;
          }
        }
        if (!opened) rec(pg.key, vp, "시트 열기", "WARN", `셀렉터 못 찾음: ${pg.sheet.join(" / ")}`);
      }
      // 뒤로가기 왕복(폰) — 앱바 뒤로 버튼 있으면 누르고 페이지가 남아 있는지
      await page.close();
    }
    await ctx.close();
  }
  await browser.close();
  const fails = results.filter((r) => r.ok === "FAIL").length, warns = results.filter((r) => r.ok === "WARN").length;
  const w = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
  console.log(`\nP1R1 C3 화면 하니스 · ${BASE}${MOCK ? " (mock)" : ""} · ${new Date().toISOString()}\n${"─".repeat(120)}`);
  for (const r of results) console.log(`${r.ok === "PASS" ? "✓" : r.ok === "WARN" ? "△" : "✗"} ${w(r.page, 9)} ${w(r.vp, 8)} ${w(r.check, 30)} ${w(r.note, 60)}`);
  console.log(`${"─".repeat(120)}\nPASS ${results.length - fails - warns} · FAIL ${fails} · WARN ${warns} · 스샷 ${OUT}`);
  const out = join(OUT, `report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify({ base: BASE, mock: MOCK, at: new Date().toISOString(), results }, null, 2));
  console.log(`→ ${out}`);
  process.exit(fails ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
