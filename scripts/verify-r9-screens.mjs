// scripts/verify-r9-screens.mjs — 🔴 **R9·R10 화면을 브라우저로 읽어 잰다**(A · 2026-09-16 · AC-87 «낱말 grep 은 그렸다를 증명 못 한다»).
//   사용: node scripts/verify-r9-screens.mjs            (빨강 1건이라도 있으면 종료코드 1 · 서버 못 띄우면 2)
//         PORT=4187 PW_DIR=../AutoMarketing node scripts/verify-r9-screens.mjs --json
//   재는 것(폰 400 · 데스크톱 1280 × 라이트 · 다크):
//     ① 콘솔 오류 0 · pageerror 0
//     ② «있어야 하는 글자»(화면에 실제로 보이는 innerText 기준) + 🔴 «있으면 안 되는 글자»(서버 어휘·«최소»·시스템 용어) — 빠진 글자만 재면 새는 건 못 잡는다
//     ③ 헌장: 보이는 Primary 단추 ≤1(시트가 열리면 시트 안에서 ≤1) · 큰 숫자 ≤1 · UI 크롬에 이모지 0(글 본문·배운 스타일 목록은 **내용**이라 뺀다)
//     ④ 🔴 대비 4.5:1 — **렌더된 글자마다 getComputedStyle 로 잰다**(토큰 표는 대용물 · AC-81). 큰 글씨(24px↑·18.66px 굵게)는 3:1.
//     ⑤ 서식 마크가 실제로 그려졌나(형광펜 배경 · 밑줄) — CSS 가 있다가 아니라 계산된 스타일로
//     ⑥ 🔴 음성 대조(AC-87): 손잡이를 끄면 그 글자가 사라지나 · 칸을 일부러 숨기면 이 검사가 빨개지나 — 빨강을 못 내는 검사는 아무것도 못 잡는다
//   🔴 AC-90: 다른 워크트리의 옛 서버가 응답하면 «전부 통과»가 난다 — 포트를 따로 쓰고, 재기 전에 «이번에 고친 글자가 응답에 있나»를 먼저 센다.
//   출력: _shots/r9/<장면>-<폭>-<테마>.png(git 밖 · 눈으로 본다) + 표(stdout). 초록 = «켜지고 글자가 보인다»까지다(PITFALLS #9).
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { dirname, resolve, join, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
let PORT = Number(process.env.PORT || 4187);   /* 잡혀 있으면 4188…4196 으로 옮긴다(AC-90 · 다른 창을 막지 않는다) — 어느 포트인지 아래에서 찍는다 */
const PW_DIR = resolve(process.env.PW_DIR || join(HERE, "../../AutoMarketing"));
const OUT = resolve(process.env.SHOT_DIR || join(ROOT, "_shots/r9"));
const JSON_OUT = process.argv.includes("--json");
mkdirSync(OUT, { recursive: true });

const results = [];
const rec = (scene, vp, check, ok, note = "") => results.push({ scene, vp, check, ok: ok === "WARN" ? "WARN" : ok ? "PASS" : "FAIL", note: String(note).slice(0, 220) });

/* ── 정적 서버(public/) — 이 워크트리의 파일만 준다 ── */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  let f = join(ROOT, "public", decodeURIComponent(u.pathname));
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  if (!existsSync(f)) { res.writeHead(404); res.end(""); return; }
  res.writeHead(200, { "content-type": MIME[extname(f)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(f));
});
{
  let bound = false;
  for (let i = 0; i < 10 && !bound; i++) {
    bound = await new Promise((ok) => { const onErr = () => ok(false); server.once("error", onErr); server.listen(PORT, () => { server.off("error", onErr); ok(true); }); });
    if (!bound) { console.log("△ 포트 " + PORT + " 가 잡혀 있어 " + (PORT + 1) + " 로 옮긴다(AC-90)"); PORT++; }
  }
  if (!bound) { console.error("🔴 4187~4196 이 전부 잡혀 있다 — 남의 서버가 살아 있다. PORT= 로 지정하라(AC-90)."); process.exit(2); }
}
/* 🔴 AC-90 — 이번에 고친 글자가 응답에 있나(옛 서버가 응답하면 여기서 멈춘다) */
{
  const t = await (await fetch(`http://localhost:${PORT}/js/ui.js`)).text();
  if (!t.includes("UI.styleSheet = function")) { console.error("🔴 응답에 이번 글자(UI.styleSheet)가 없다 — 다른 폴더의 서버가 응답하고 있다"); server.close(); process.exit(2); }
}

const { chromium } = await import(pathToFileURL(join(PW_DIR, "node_modules/playwright/index.mjs")).href);
const browser = await chromium.launch({ headless: true });
const VIEW = { phone: { width: 400, height: 860, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, desktop: { width: 1280, height: 800 } };
const THEMES = ["light", "dark"];
const q = (u) => `${u}${u.includes("?") ? "&" : "?"}mock=1`;
/* 고객 화면에 있으면 안 되는 글자 — 서버·러너 어휘(why 값·키 이름) · «최소»(사장님) · 시스템 용어 */
const FORBID_ALL = ["url_para", "caret_drift", "channel_unsupported", "block_unsupported", "range_invalid", "formatUnused", "refUnused", "learned", "para_start", "defaultTier", "styleId", "piecesByTier", "테넌트", "러너 잡", "login_wall", "no_runner", "not_found", "undefined", "NaN", "[object"];

/* ── 장면 — 트리거 A-1~A-6 을 하나씩 짚는다 ── */
const SCENES = [
  { key: "piece-fmt", url: q("/app/piece.html?id=501&fmt=1"), wait: "#fmtunused:not([hidden])",
    need: ["이 채널에선 못 낸 꾸밈", "밑줄", "표", "핵심 강조", "나열 강조", "주소가 든 문단은 링크가 먼저라", "편집기에서 자리를 정확히 못 잡아", "핵심 강조 2곳", "기울임 — 이 채널에서는 낼 수 없는 꾸밈이라", "글 내용은 그대로예요", "등급", "보통", "든 코인", "2코인", "스타일", "살림 블로그 스타일"],
    forbid: ["최소", "못 낸 서식", "budget"], marks: true, negative: { hide: "#fmtunused", mustLose: "이 채널에선 못 낸 꾸밈" } },
  { key: "piece-plain", url: q("/app/piece.html?id=501"), wait: "#why:not([hidden])", need: ["등급", "보통", "이 계정에 걸어 둔 기본 스타일이에요", "다른 내 계정 글과", "22% 닮음", "4편과 견줬어요"], forbid: ["못 낸 꾸밈", "올려 봐야 아는 꾸밈", "돌려드렸어요", "measured"] },
  { key: "piece-fsc", url: q("/app/piece.html?id=501&fsc=1&gate=xacc&styleGone=1"), wait: "#fmtunused:not([hidden])",
    need: ["올라간 뒤 확인한 꾸밈", "다음 문단까지 이어진 문단이 12%", "끊지 못한 곳이 1곳", "글자 모양(“ ” · ———)으로 대신", "못 쟀어요", "견줄 다른 계정 글이 아직 없어서", "안 입고 썼어요", "스타일 없이 썼어요"], forbid: ["번짐", "bleed", "breakFails", "htmlMode"] },
  { key: "piece-settle", url: q("/app/piece.html?id=501&settle=1"), wait: "#why:not([hidden])", need: ["프리미엄", "1코인", "2코인은 돌려드렸어요", "내 사진으로 채워서"], forbid: ["3코인"] },
  { key: "piece-unknown-caps", url: q("/app/piece.html?id=502"), wait: "#fmtunused:not([hidden])", need: ["올려 봐야 아는 꾸밈", "올려 봐야 알아요", "핵심 강조", "나열 강조"], forbid: ["못 낸 꾸밈"] },
  /* [R11 A-3] 🔴 이 자가 **옛 이름표를 기다리고 있었다** — «배워 올 곳»을 제 그룹으로 세우며 줄 이름을 바꿨다(트리거 A-3).
     자와 화면이 어긋나면 «어느 쪽이 정본인가»부터 정한다(AC-101): **트리거가 정본**이고 이 자는 A 것이라 내가 같이 고친다.
     그룹 제목과 영상 줄도 need 에 넣는다 — 이름만 바꾸면 «그룹이 생겼나»는 여전히 아무도 안 본다. */
  { key: "create", url: q("/app/create.html"), wait: "#refPost:not([hidden])", need: ["배워 올 곳", "글 스타일 배우기", "영상 스타일 배우기", "코인 0"], forbid: ["하루 3개"] },
  { key: "create-sheet", url: q("/app/create.html"), wait: "#refPost:not([hidden])", actions: [{ click: "#refPost" }, { wait: "#rfList .stylerow" }],
    need: ["잘 된 글 주소", "이번 달 2/30개", "숫자와 목록", "남의 문장은 한 줄도 저장하지 않아요", "배운 스타일", "살림 블로그 스타일", "정리형 리뷰", "1.8배", "주소로 못 열면"], forbid: ["summary", "captionRate"], sheet: true,
    actions2: [{ click: "#rfList [data-open]" }, { wait: "#rfList [data-body]:not([hidden])" }], need2: ["문단 2~3줄", "이모지 ✅📌💡 를 문단 첫머리에", "밑줄 5곳", "사진 7장", "뼈대 · 첫 줄 → 소제목 → 문단", "기본에서 풀기", "지우기"] },
  { key: "ref-ok", url: q("/app/create.html"), wait: "#refPost:not([hidden])", actions: [{ click: "#refPost" }, { wait: "#rf input[name=url]" }, { fill: ["#rf input[name=url]", "https://blog.naver.com/someone/223000000"] }, { click: "#rfGo" }, { wait: "#rfState:not([hidden])" }, { sleep: 1500 }],
    need: ["차례를 기다리고 있어요"], forbid: [], sheet: true,
    actions2: [{ waitText: "아래 «배운 스타일»에서" }], need2: ["배웠어요 · 새로 배운 스타일", "이번 달 3/30개"] },
  { key: "ref-fail", url: q("/app/create.html?ref=fail"), wait: "#refPost:not([hidden])", actions: [{ click: "#refPost" }, { wait: "#rf input[name=url]" }, { fill: ["#rf input[name=url]", "https://blog.naver.com/someone/223000001"] }, { click: "#rfGo" }, { waitText: "로그인해야 보이는 글이라" }],
    need: ["로그인해야 보이는 글이라 저희가 못 열었어요", "2~6장 찍어서 올려 주세요", "찍은 화면 올리기", "글을 붙여 넣기"], forbid: ["login_wall", "책임", "불이익"], sheet: true,
    actions2: [{ click: "#rfPasteT" }, { wait: "#rfPaste:not([hidden])" }], need2: ["마지막 방법이에요", "꾸밈은 다 날아가고"] },
  { key: "ref-norunner", url: q("/app/create.html?ref=norunner"), wait: "#refPost:not([hidden])", actions: [{ click: "#refPost" }, { wait: "#rf input[name=url]" }, { fill: ["#rf input[name=url]", "https://blog.naver.com/someone/223000002"] }, { click: "#rfGo" }, { waitText: "내 PC 프로그램이 지금 꺼져 있어요" }],
    need: ["내 PC 프로그램이 지금 꺼져 있어요", "내 PC 프로그램을 켜면 저희가 열어서 배워요", "내 PC 프로그램 보기", "찍은 화면 올리기"], forbid: ["no_runner", "러너"], sheet: true },
  { key: "ref-quota", url: q("/app/create.html?ref=quota"), wait: "#refPost:not([hidden])", actions: [{ click: "#refPost" }, { wait: "#rf input[name=url]" }, { fill: ["#rf input[name=url]", "https://blog.naver.com/someone/223000003"] }, { click: "#rfGo" }, { waitText: "다 썼어요" }],
    need: ["이번 달 레퍼런스 30개를 다 썼어요", "다음 달 1일에 다시 열려요"], forbid: ["quota"], sheet: true },
  { key: "accounts-detail", url: q("/app/accounts.html"), wait: "#list [data-id=\"1\"]", actions: [{ click: "#list [data-id=\"1\"]" }, { wait: ".sheet.open .tierpick" }],
    need: ["글 등급", "간단히", "보통", "프리미엄", "AI가 사진 1장 · 핵심만 1,000자쯤", "AI가 사진 2~3장 · 목록·표까지 1,500자쯤", "AI가 사진 4~5장 · 자주 묻는 질문까지 2,000자쯤", "내 사진을 올리면 AI 사진을 대신하거나 더 얹어요", "1코인", "2코인", "3코인", "글 스타일", "살림 블로그 스타일", "1.8배", "스타일 배우기 · 관리"],
    forbid: [], sheet: true, tierOn: "보통" }   /* «최소» 는 등급 줄 전용 검사(tierpick)로 잰다 — «최소 간격» 안내는 다른 자리다 */,
  { key: "accounts-detail-rec0", url: q("/app/accounts.html?rec=0&styles=0"), wait: "#list [data-id=\"1\"]", actions: [{ click: "#list [data-id=\"1\"]" }, { wait: ".sheet.open .tierpick" }],
    need: ["아직 이 계정 글이 몇 편 안 돼서", "아직 배운 스타일이 없어요", "글 레퍼런스로 스타일 배우기 · 코인 0"], forbid: ["1.8배", "살림 블로그 스타일"], sheet: true },
  { key: "accounts-detail-notier", url: q("/app/accounts.html"), wait: "#list [data-id=\"3\"]", actions: [{ click: "#list [data-id=\"3\"]" }, { wait: ".sheet.open .tierpick" }],
    need: ["아직 안 골랐어요", "고르기 전엔 «간단히»로 만들어요"], forbid: [], sheet: true },
  { key: "director", url: q("/app/director.html?topicId=11"), wait: "#targets .row .r", need: ["보통 · 2코인", "프리미엄 · 3코인", "쓰는 코인"], forbid: ["코인 확인 중", "1장 = 1코인"] }   /* «7코인» 탐침은 «47코인»에도 걸린다(부분 문자열) — 등급별 값이 그대로 보이는지로 잰다 */,
  { key: "director-sheet", url: q("/app/director.html?topicId=11"), wait: "#targets .row .r", actions: [{ click: "#edit" }, { wait: ".sheet.open .tierpick" }, { sleep: 900 }],
    need: ["등급", "간단히", "보통", "프리미엄", "사진 자리", "코인은 안 늘어요", "이번 글만", "살림 블로그 스타일", "이 계정 기본"], forbid: ["1장 = 1코인", "최소", "…"], sheet: true, sumFlow: true },
  { key: "write", url: q("/app/write.html"), wait: "#stylez:not([hidden])", need: ["어떤 모양으로", "이 계정 기본", "살림 블로그 스타일", "정리형 리뷰", "내용은 그대로고 코인은 들지 않아요", "스타일 배우기 · 관리"], forbid: [] },
  { key: "plan", url: q("/app/plan.html"), wait: "#cards .group", need: ["글로 치면", "간단히 150편", "보통 75편", "프리미엄 50편", "간단히 40편", "보통 20편", "프리미엄 13편"], forbid: [] },
];

/* ── 페이지 안에서 재는 함수들 ── */
const IN_PAGE = {
  text: () => document.body.innerText,
  charter: () => {
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
    const sheet = document.querySelector(".sheet.open");
    const scope = sheet || document;
    const primary = [...scope.querySelectorAll(".btn.primary")].filter(vis).filter((b) => sheet ? true : !b.closest(".sheet")).length;
    const bigNum = [...document.querySelectorAll(".hl .num")].filter(vis).length;
    /* UI 크롬의 이모지 — 글 본문(.preview)·배운 스타일(.learned)·붙여 넣기 예시는 «내용»이라 뺀다 */
    const emoji = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const t = n.nodeValue; if (!/\p{Emoji_Presentation}/u.test(t)) continue; const el = n.parentElement; if (!el || el.closest(".preview,.learned,script,style") || !vis(el)) continue; emoji.push(t.trim().slice(0, 30)); }
    return { primary, bigNum, emoji, sheet: !!sheet };
  },
  contrast: () => {
    const toRGB = (s) => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (c) => 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    const blend = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
    const bodyBg = toRGB(getComputedStyle(document.body).backgroundColor);
    const base = bodyBg && bodyBg.a >= 1 ? bodyBg : { r: 255, g: 255, b: 255, a: 1 };
    const bgOf = (el) => { const stack = []; let e = el, img = false;
      while (e && e !== document.documentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage && cs.backgroundImage !== "none") img = true; const c = toRGB(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } e = e.parentElement; }
      let bg = base; for (let i = stack.length - 1; i >= 0; i--) bg = blend(stack[i], bg); return { bg, img }; };
    const out = []; const seen = new Set();
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
    while ((n = w.nextNode())) { const t = n.nodeValue.trim(); if (!t) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      if (el.closest('[aria-hidden="true"],script,style,.sk,.mk,figure,[hidden],.sheet:not(.open)')) continue;
      if (el.closest("button:disabled,[disabled]")) continue;
      const cs = getComputedStyle(el); if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      const fg = toRGB(cs.color); if (!fg) continue; const { bg, img } = bgOf(el); if (img) continue;
      const fgb = fg.a < 1 ? blend(fg, bg) : fg; const L1 = lum(fgb), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700; const min = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      if (ratio < min) out.push({ ratio: Math.round(ratio * 100) / 100, text: t.slice(0, 32), sel: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "") + (el.closest(".sheet") ? " (시트)" : ""), fg: cs.color, bg: `rgb(${bg.r | 0},${bg.g | 0},${bg.b | 0})` }); }
    return out;
  },
  marks: () => {
    const line = document.querySelector(".preview mark.line"), u = document.querySelector(".preview u"), value = document.querySelector(".preview mark.value");
    const tr = (s) => !s || s === "rgba(0, 0, 0, 0)" || s === "transparent";
    return { line: line ? !tr(getComputedStyle(line).backgroundColor) : null, u: u ? /underline/.test(getComputedStyle(u).textDecorationLine) : null, value: value ? parseInt(getComputedStyle(value).fontWeight, 10) >= 700 : null };
  },
  tierOn: () => { const on = document.querySelector(".sheet.open .tierpick .row.on"); return on ? on.innerText.trim() : null; },
  tierpickText: () => [...document.querySelectorAll(".tierpick")].map((e) => e.innerText).join("\n"),
};

async function runScene(sc, vpName, theme) {
  const ctx = await browser.newContext({ viewport: { width: VIEW[vpName].width, height: VIEW[vpName].height }, isMobile: !!VIEW[vpName].isMobile, hasTouch: !!VIEW[vpName].hasTouch, deviceScaleFactor: VIEW[vpName].deviceScaleFactor || 1, colorScheme: theme, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e.message || e).slice(0, 160)));
  page.on("requestfailed", (r) => { if (!/mock-r2|favicon/.test(r.url())) errors.push("request failed: " + r.url().slice(-60)); });
  const tag = `${sc.key}-${vpName}-${theme}`;
  try {
    await page.goto(`http://localhost:${PORT}${sc.url}`, { waitUntil: "load" });
    if (sc.wait) await page.waitForSelector(sc.wait, { timeout: 8000 });
    await page.waitForTimeout(700);
    const act = async (steps) => { for (const s of steps || []) {
      if (s.click) await page.click(s.click);
      if (s.fill) await page.fill(s.fill[0], s.fill[1]);
      if (s.wait) await page.waitForSelector(s.wait, { timeout: 8000 });
      if (s.waitText) await page.waitForFunction((t) => document.body.innerText.includes(t), s.waitText, { timeout: 12000 });
      if (s.sleep) await page.waitForTimeout(s.sleep);
    } await page.waitForTimeout(500); };
    await act(sc.actions);
    let text = await page.evaluate(IN_PAGE.text);
    await page.screenshot({ path: join(OUT, `${tag}.png`), fullPage: !sc.sheet });
    /* ② 글자 */
    const miss = (sc.need || []).filter((t) => !text.includes(t));
    rec(sc.key, `${vpName}/${theme}`, "있어야 하는 글자가 보인다", miss.length === 0, miss.length ? `없음: ${miss.join(" · ")}` : `${(sc.need || []).length}가지`);
    const leak = [...FORBID_ALL, ...(sc.forbid || [])].filter((t) => text.includes(t));
    rec(sc.key, `${vpName}/${theme}`, "🔴 있으면 안 되는 글자가 없다", leak.length === 0, leak.length ? `샜다: ${leak.join(" · ")}` : "0");
    if (sc.tierOn) { const on = await page.evaluate(IN_PAGE.tierOn); rec(sc.key, `${vpName}/${theme}`, "계정 기본 등급이 골라져 있다(서버 값)", !!on && on.includes(sc.tierOn), on || "고른 줄 없음"); }
    /* 등급 줄 안에 «최소»가 없다(사장님) */
    if (/tierpick/.test(sc.wait || "") || sc.tierOn || sc.sumFlow) { const tp = await page.evaluate(IN_PAGE.tierpickText); if (tp) rec(sc.key, `${vpName}/${theme}`, "등급 줄에 «최소»가 없다", !tp.includes("최소"), tp.includes("최소") ? "«최소» 가 있다" : "없음"); }
    /* ③ 헌장 */
    const ch = await page.evaluate(IN_PAGE.charter);
    rec(sc.key, `${vpName}/${theme}`, `Primary 단추 ≤1${ch.sheet ? "(시트 안)" : ""}`, ch.primary <= 1, `${ch.primary}개`);
    rec(sc.key, `${vpName}/${theme}`, "큰 숫자 ≤1", ch.bigNum <= 1, `${ch.bigNum}개`);
    rec(sc.key, `${vpName}/${theme}`, "UI 크롬에 이모지 0(본문·배운 목록 제외)", ch.emoji.length === 0, ch.emoji.slice(0, 3).join(" | ") || "0");
    /* ④ 대비 */
    const bad = await page.evaluate(IN_PAGE.contrast);
    rec(sc.key, `${vpName}/${theme}`, "🔴 대비 4.5:1(렌더된 글자 전수)", bad.length === 0, bad.length ? `${bad.length}건 — ` + bad.slice(0, 3).map((b) => `${b.sel} «${b.text}» ${b.ratio} (${b.fg} on ${b.bg})`).join(" | ") : "미달 0");
    /* ⑤ 마크 */
    if (sc.marks) { const m = await page.evaluate(IN_PAGE.marks); rec(sc.key, `${vpName}/${theme}`, "서식 마크가 실제로 그려진다(형광펜 배경·밑줄·핵심 굵게)", m.line === true && m.u === true && m.value === true, JSON.stringify(m)); }
    /* 두 번째 동작(펼치기 · 흐름 끝) */
    if (sc.actions2) { await act(sc.actions2); text = await page.evaluate(IN_PAGE.text); await page.screenshot({ path: join(OUT, `${tag}-2.png`) });
      const miss2 = (sc.need2 || []).filter((t) => !text.includes(t)); rec(sc.key, `${vpName}/${theme}`, "두 번째 동작 뒤 글자가 보인다", miss2.length === 0, miss2.length ? `없음: ${miss2.join(" · ")}` : `${(sc.need2 || []).length}가지`);
      const leak2 = [...FORBID_ALL, ...(sc.forbid || [])].filter((t) => text.includes(t)); rec(sc.key, `${vpName}/${theme}`, "🔴 두 번째 동작 뒤에도 새는 글자 0", leak2.length === 0, leak2.join(" · ") || "0");
      const bad2 = await page.evaluate(IN_PAGE.contrast); rec(sc.key, `${vpName}/${theme}`, "🔴 대비 4.5:1(두 번째 동작 뒤)", bad2.length === 0, bad2.length ? `${bad2.length}건 — ` + bad2.slice(0, 3).map((b) => `${b.sel} «${b.text}» ${b.ratio}`).join(" | ") : "미달 0"); }
    /* 디렉터 시트 — 등급을 바꾸면 합계가 서버 견적으로 바뀐다(«…» → 숫자 · 화면 셈 0) */
    if (sc.sumFlow) {
      const before = await page.evaluate(() => (document.querySelector("#sum") || {}).textContent);
      await page.click(".sheet.open section:not([data-video]) .tierpick [data-v=premium]");
      await page.waitForTimeout(1200);
      const afterV = await page.evaluate(() => (document.querySelector("#sum") || {}).textContent);
      rec(sc.key, `${vpName}/${theme}`, "등급을 바꾸면 합계가 서버 견적으로 바뀐다", !!afterV && afterV !== "…" && afterV !== "?" && afterV !== before, `${before} → ${afterV}`);
      /* 🔴 **바꾼 그 줄**의 코인을 본다 — 전체를 합쳐 /3코인/ 로 재면 옆 줄(원래 프리미엄)에 걸려 가짜 초록이 난다(2026-09-16 에 실제로 그랬다). */
      const costTxt = await page.evaluate(() => (document.querySelector(".sheet.open section:not([data-video]) [data-cost]") || {}).textContent || "");
      rec(sc.key, `${vpName}/${theme}`, "바꾼 글의 코인이 서버 값(3코인)으로 다시 적힌다", costTxt.trim() === "3코인", costTxt);
      await page.screenshot({ path: join(OUT, `${tag}-3.png`) });
    }
    /* ⑥ 음성 대조 — 칸을 일부러 숨기면 «있어야 하는 글자» 검사가 빨개져야 한다 */
    if (sc.negative && vpName === "phone" && theme === "light") {
      await page.addStyleTag({ content: `${sc.negative.hide}{display:none!important}` });
      const t2 = await page.evaluate(IN_PAGE.text);
      rec(sc.key, `${vpName}/${theme}`, "🔴 음성 대조 — 칸을 숨기면 이 검사가 빨개진다(검사가 살아 있다)", !t2.includes(sc.negative.mustLose), t2.includes(sc.negative.mustLose) ? "숨겨도 글자가 남는다 — 검사가 innerText 가 아니라 소스를 보고 있다" : "숨기니 사라졌다 — 검사가 진짜 렌더를 본다");
    }
    /* ① 콘솔 */
    rec(sc.key, `${vpName}/${theme}`, "콘솔 오류 0", errors.length === 0, errors.slice(0, 2).join(" | ") || "0");
  } catch (e) {
    await page.screenshot({ path: join(OUT, `${tag}-ERR.png`) }).catch(() => {});
    rec(sc.key, `${vpName}/${theme}`, "🔴 장면이 끝까지 가지 못했다", false, String(e.message || e).split("\n")[0].slice(0, 200));
  } finally { await ctx.close(); }
}

const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
for (const sc of SCENES) { if (only && !sc.key.startsWith(only)) continue;
  for (const vp of Object.keys(VIEW)) for (const th of THEMES) await runScene(sc, vp, th); }
await browser.close(); server.close();

/* ── 출력 ── */
const pass = results.filter((r) => r.ok === "PASS").length, fail = results.filter((r) => r.ok === "FAIL").length, warn = results.filter((r) => r.ok === "WARN").length;
writeFileSync(join(OUT, `report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
if (JSON_OUT) console.log(JSON.stringify({ results }, null, 2));
else {
  const w = (x, n) => String(x ?? "").slice(0, n).padEnd(n);
  console.log(`\nR9·R10 화면을 브라우저로 잰다 · ${new Date().toISOString()} · 포트 ${PORT}\n${"─".repeat(150)}`);
  for (const r of results) if (r.ok !== "PASS") console.log(`${r.ok === "WARN" ? "△" : "✗"} ${w(r.scene, 20)} ${w(r.vp, 14)} ${w(r.check, 44)} ${r.note}`);
  console.log(`${"─".repeat(150)}\nPASS ${pass} · FAIL ${fail} · WARN ${warn} · 장면 ${SCENES.length} × 폰·데스크톱 × 라이트·다크 · 스샷 ${OUT}`);
  console.log("🔴 초록은 «켜지고 글자가 보이고 대비가 넘는다»까지다 — 잘 만들었는지는 스샷을 눈으로 본다(PITFALLS #9).");
}
process.exit(fail ? 1 : 0);
