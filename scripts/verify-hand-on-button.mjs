/**
 * scripts/verify-hand-on-button.mjs — 🔴 **«그려졌는데 손이 안 붙은 단추»를 브라우저에서 잰다**
 *   (C · 첫 발행 라운드 2026-09-20)
 *
 *   사용: node scripts/verify-hand-on-button.mjs            (판정)
 *         node scripts/verify-hand-on-button.mjs --headed   (눈으로 보면서)
 *         node scripts/verify-hand-on-button.mjs --only=/app/piece.html
 *
 *   ══ 왜 이 자가 있나 ══
 *   2026-09-20 첫 실발행 때 **검사 90개가 전부 초록인 채로** 고장이 났다.
 *   «이대로 발행 예약» 단추가 **보이고 눌리는데 서버로 아무것도 안 갔다** — 토스트 0 · 콘솔 오류 0 · 호출 0.
 *   🔴 **조용해서 아무도 몰랐다.** 마크업도 있고 함수도 있고 `tsc` 도 0인데, **그 경로에서 손을 안 붙였다.**
 *   `verify-paint` 는 «칠해졌나»를 잰다 — 이 단추는 **지금도 훌륭하게 칠해진다.** 그래서 안 잡혔다.
 *   ⇒ 🔴 우리에게 없던 축: **«눌렀을 때 무슨 일이 일어나나».**
 *
 *   ══ 무엇을 세는가 ══
 *   ㉮ **처음 그려진 단추** — 화면이 뜬 직후 보이는 button 전부. 조상까지 훑어 손을 찾는다.
 *   ㉯ **시트 안 단추** — 줄(.row)을 눌러 열리는 바텀시트 안의 단추. 우리 화면은 여기에 단추가 더 많다.
 *   ㉱ **막다른 골목** — 그 상태에서 손님이 갈 수 있는 길이 **0개**인가(겉껍데기 빼고).
 *      🔴 **이 축은 2026-09-20 의 고장 ①을 못 잡는다 — 내가 수리 전 코드에 돌려 보고 확인했다.**
 *      그 화면(`awaiting_manual` 글)엔 사진 줄·검사 줄 같은 **다른 길이 있었고**, 없던 것은 **으뜸 단추**였다.
 *      «길이 0»과 «앞으로 갈 길이 0»은 다른 축이다. 뒤엣것은 A 의 `verify-cta-bound.mjs` 몫이다.
 *      그래도 이 축을 남긴다 — «아무것도 못 하는 화면»은 그 자체로 고장이고, 지금은 0곳이다.
 *   ㉰ **눌러서 확인** — 본 단추를 **전부** 실제로 눌러 본다.
 *      🔴 먼저 **화면이 조용해질 때까지 기다리고**(MutationObserver 가 0을 낼 때까지), 그 뒤에 누른다.
 *      호출 0 · 이동 0 · 새 창 0 · 파일창 0 · **DOM 변화 0** 이면 **그때 빨강이다.**
 *      🔴 두 겹인 이유: 위임(부모가 e.target.closest(...) 로 잡는 것)은 정적으로 못 가른다. **눌러 봐야 안다.**
 *
 *   ══ 🔴 손 목록이 없다(AC-108) ══
 *   public 아래 *.html 을 폴더째 훑는다. `?id=` 를 읽는 화면은 **모의 상태(sessionStorage)에서 id 를 스스로 꺼내**
 *   낱낱의 상태를 다 돈다(글 8개 · 계정 5개 …). 새 화면·새 상태가 생기면 자동으로 재는 대상이 된다.
 *
 *   ══ 🔴 이 자가 **못 재는 것**(못으로 박아 둔다 · AC-9) ══
 *   · **모의(mock.js)가 흉내 내지 않는 화면** — /ops/** 전부. 그 화면에서 /api/ 로 진짜 요청이 나가면
 *     그 화면은 **⊘ 로 적는다.** «단추 0개, 통과»라고 적지 않는다.
 *   · **손잡이(?gate=·?td= …)로만 열리는 갈래** — 모의 손잡이는 40개가 넘는다. 여기선 **id 상태만** 돈다.
 *   · **«토스트만 뜨고 실제로는 안 나갔다»** — 누른 뒤 DOM 이 바뀌면 «일어났다»로 본다.
 *     그 안쪽(보낸 키가 맞나)은 verify-key-contract 의 몫이다.
 *
 *   종료코드: 0 = 손 없는 단추 없음 · 1 = 있다 · 2 = 못 쟀다(playwright 없음 등).
 */
import { createServer } from "node:http";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { requirePlaywright } from "./lib/find-playwright.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const PUB = path.join(ROOT, "public");
const HEADED = process.argv.includes("--headed");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7);
/* 🔴 **기본은 «정적으로 못 가른 것»만 눌러 본다** — 본 단추를 다 누르면 20분이 넘고,
   20분 걸리는 자는 배치에서 아무도 안 돌린다(AC-95). «제자리»(그 단추에 직접 손이 붙은 것)는
   ⓪b·⓪c 가 증명한 대로 붙어 있는 것이라 건너뛴다.
   🔴 다만 그 손이 **빈 함수**면 이 자는 못 잡는다 — 그건 아래에 «못 쟀음»으로 적는다.
   `--press-all` 로 전부 눌러 본다(느리다 · 깊게 볼 때). */
const PRESS_ALL = process.argv.includes("--press-all");
if (!existsSync(PUB)) { console.error("⊘ 못 쟀어요 — public/ 이 없습니다."); process.exit(2); }

let fail = 0;
const unmeasured = [];
const say = (s = "") => console.log(s);

/* ═══ 화면 목록 — 손 목록 0 ═══ */
function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out;
}
const pages = walk(PUB).map((f) => "/" + path.relative(PUB, f).replace(/\\/g, "/")).sort()
  /* 🔴 Git Bash(MSYS)가 `--only=/app/x.html` 의 앞 슬래시를 윈도 경로로 바꿔 버린다 — 꼬리만 맞춰도 받는다. */
  .filter((p) => !ONLY || p === ONLY || p.endsWith("/" + ONLY.split("/").pop()) || p.includes(ONLY));

/* ═══ 정적 서버 ═══ */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json", ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  let p = path.join(PUB, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(PUB)) { res.writeHead(403).end(); return; }
  if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, "index.html");
  if (!existsSync(p)) { res.writeHead(404, { "content-type": "application/json" }).end('{"ok":false,"error":"mock 밖"}'); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream", "cache-control": "no-store" });
  res.end(readFileSync(p));
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ═══ 브라우저 ═══ */
const { chromium } = await requirePlaywright();
const browser = await chromium.launch({ headless: !HEADED });
const pg = await browser.newPage({ viewport: { width: 420, height: 900 } });

/* 🔴 **페이지 스크립트보다 먼저** 들어가야 한다 — mock.js 도 ui.js 도 이 뒤에 실린다. */
await pg.addInitScript(() => {
  const orig = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, f, o) {
    try {
      if (t === "click" || t === "pointerup" || t === "mouseup") this.__acClick = (this.__acClick || 0) + 1;
      if (t === "submit") this.__acSubmit = (this.__acSubmit || 0) + 1;
    } catch { /* 얼어붙은 객체 */ }
    return orig.call(this, t, f, o);
  };
  window.__acNet = [];
  const rf = window.fetch;
  window.fetch = function (input, init) {
    const u = String((input && input.url) || input || "");
    if (u.includes("/api/")) window.__acNet.push(u);   // 🔴 모의가 안 잡은 길 = 진짜 요청 = «모의 밖 화면»
    return rf.call(this, input, init);
  };
});

/** 단추 재기 — 브라우저 안에서 돈다. scopeSel 이 있으면 그 안만. */
const MEASURE = (scopeSel) => {
  const root = scopeSel ? document.querySelector(scopeSel) : document;
  if (!root) return [];
  const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0.01 && r.width > 1 && r.height > 1; };
  const out = [];
  let n = 0;
  for (const b of root.querySelectorAll('button, [role="button"]')) {
    if (!vis(b) || b.disabled || b.getAttribute("aria-disabled") === "true") continue;
    let hand = "없음", where = "";
    if (b.onclick || b.getAttribute("onclick") || b.__acClick) hand = "제자리";
    else {
      for (let p = b.parentElement; p; p = p.parentElement) {
        if (p.onclick || p.getAttribute("onclick") || p.__acClick) { hand = "위임"; where = p.tagName.toLowerCase() + (p.id ? "#" + p.id : p.className ? "." + String(p.className).split(/\s+/)[0] : ""); break; }
      }
    }
    if (hand === "없음" && b.type === "submit" && b.form && (b.form.onsubmit || b.form.__acSubmit)) hand = "폼";
    if (hand === "없음" && b.closest("a[href]")) hand = "링크";
    const mark = `${scopeSel ? "s" : "p"}${n++}`;
    b.setAttribute("data-ac-probe", mark);
    out.push({
      mark, hand, where, id: b.id || "",
      row: b.classList.contains("row"),
      data: [...b.attributes].filter((a) => a.name.startsWith("data-") && a.name !== "data-ac-probe").map((a) => a.name).join(" "),
      text: (b.textContent || "").replace(/\s+/g, " ").trim().slice(0, 30) || (b.getAttribute("aria-label") || "").slice(0, 30),
    });
  }
  return out;
};

/* 🔴 «누르니 새 창이 떴다»·«파일이 내려왔다»도 **무언가 일어난 것**이다 —
   안 세면 target=_blank 단추가 전부 «죽었다»로 찍힌다. */
/* 🔴 **파일 고르기 창**도 «일어난 일»이다 — `pick.onclick = () => file.click()`(ui.js photoSheet)은
   DOM 도 안 바꾸고 API 도 안 부른다. 안 세면 **멀쩡히 사는 단추가 «죽었다»로 찍힌다**(2026-09-20 실제로 그랬다). */
let popped = 0, downloaded = 0, chose = 0;
pg.context().on("page", (np) => { popped++; np.close().catch(() => {}); });
pg.on("download", () => { downloaded++; });
pg.on("filechooser", (fc) => { chose++; fc.setFiles([]).catch(() => {}); });
pg.on("dialog", (d) => { chose++; d.dismiss().catch(() => {}); });   // alert·confirm 도 마찬가지

/** 한 화면을 띄운다. 돌려주는 것 = 모의가 못 잡아 **진짜로 나간** /api/ 요청들.
    🔴 모의 상태를 **매번 지운다** — 앞 단추가 바꾼 상태를 물려받으면 같은 자를 두 번 돌렸을 때 답이 달라진다. */
async function open(url) {
  await pg.evaluate(() => { try { sessionStorage.clear(); localStorage.clear(); } catch { /* 막힌 저장소 */ } }).catch(() => {});
  await pg.goto(BASE + url, { waitUntil: "load" }).catch(() => {});
  /* 🔴 1초를 기다린다 — 어떤 화면은 «못 찾았어요» 뒤 **900ms 에 스스로 다른 데로 보낸다**(piece.html).
     700ms 만 기다리면 그 화면을 재다가 **재는 도중에 다른 화면으로 넘어가** 엉뚱한 단추를 적는다. */
  await pg.waitForTimeout(1000);
  const net = await pg.evaluate(() => (window.__acNet || []).slice()).catch(() => []);
  return { net, here: pg.url() === BASE + url, at: pg.url().replace(BASE, "") };
}

/** 🔴 «눌렀더니 무슨 일이 일어났나» — **가만 놔둔 것(대조)**과 견준다. */
const ARM = () => {
  window.__acMut = 0; window.__acApi = 0;
  if (!window.__acArmed) {
    window.__acArmed = true;
    const o = window.UI && window.UI.api;
    if (o) window.UI.api = function (...a) { window.__acApi++; return o.apply(this, a); };
    new MutationObserver((ms) => { window.__acMut += ms.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  }
};
const WIN = 600;
/* 🔴 **«가만 둔 것과 견준다»를 버렸다**(2026-09-20 · 첫 판에 거짓 빨강 36개를 냈다).
   모의 화면은 가만 둬도 움직이고(배지·스켈레톤·이미지) 그 움직임이 **시간이 갈수록 잦아든다** —
   누르기 **전**에 잰 대조값은 부풀려져 있어서, 진짜로 일이 난 단추가 «대조보다 적게 움직였다»로 빨개졌다.
   (`/app/revenue.html` 의 날짜 칸 17개가 통째로 그렇게 빨갰다.)
   ⇒ 이제 **먼저 화면이 조용해질 때까지 기다린다.** 조용해진 뒤엔 **한 번이라도 움직이면** 일이 난 것이다.
   🔴 끝내 안 조용해지는 화면은 **판정하지 않고 «못 쟀음»으로 적는다** — 그게 정직하다. */
/* `retry` = 칸을 채운 뒤 **한 번만** 다시 누르는 길(아래 `blockedByForm` 블록). 되풀이를 막는 표다. */
async function press(mark, retry) {
  await pg.evaluate(ARM).catch(() => {});
  let quiet = false, lastNoise = -1;
  for (let i = 0; i < 6 && !quiet; i++) {
    await pg.evaluate(() => { window.__acMut = 0; }).catch(() => {});
    await pg.waitForTimeout(300);
    lastNoise = await pg.evaluate(() => Number(window.__acMut || 0)).catch(() => 0);
    quiet = lastNoise === 0;
  }
  const idle = lastNoise;
  if (!quiet) return { idle, mut: 0, api: 0, moved: false, gone: false, nothing: false, restless: true };
  /* 🔴 단추가 화면 밖이면 누르기 전에 스크롤이 일어난다 — 그 움직임을 «눌러서 난 일»로 세면 안 된다. */
  const pt = await pg.evaluate((m) => {
    const e = document.querySelector(`[data-ac-probe="${m}"]`);
    if (!e) return null;
    e.scrollIntoView({ block: "center", behavior: "instant" });
    const r = e.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 1), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    const covered = !(top === e || e.contains(top));
    /* 🔴 **이미 골라져 있는 칩**은 다시 눌러도 아무것도 안 바뀐다 — 그게 맞는 동작이다.
       `UI.bindChips` 는 `x.classList.toggle("on", x === c)` 라 이미 `.on` 인 칩은 DOM 이 **한 번도** 안 움직이고,
       손으로 맨 화면(`/ops/ai.html` 의 `#mode`)은 아예 `if (mode === s.updateMode) return;` 으로 **일부러** 일찍 돌아간다.
       🔴 그래서 «`[data-chips]` 안»으로만 보면 모자란다 — **고른 칸 무리(`.seg`·`.chips`·`.tierpick`)** 전부를 본다.
       이걸 «죽은 단추»로 세면 세그먼트가 통째로 빨개진다(2026-09-20 첫 판에 실제로 그랬다). */
    const group = e.closest("[data-chips], .seg, .chips, .tierpick");
    const already = !!(group && e.classList.contains("on") && !e.closest("[data-multi]"));
    return { x, y, covered, already, topTag: top ? top.tagName.toLowerCase() + (top.id ? "#" + top.id : top.className ? "." + String(top.className).split(/\s+/)[0] : "") : "없음" };
  }, mark).catch(() => null);
  if (!pt) return { idle, mut: 0, api: 0, moved: false, gone: false, nothing: false, missing: true };
  /* 🔴 **가운데가 다른 것에 가려져 있으면 누르지 않는다.** 그대로 누르면 **덮은 쪽**이 눌려서
     «눌렀더니 화면이 넘어갔다» = «살아 있다» 로 잘못 읽힌다(2026-09-20 에 내 자가 이걸로 스스로를 못 믿었다). */
  if (pt.covered) return { idle, mut: 0, api: 0, moved: false, gone: false, nothing: false, covered: true, topTag: pt.topTag };
  if (pt.already) return { idle, mut: 0, api: 0, moved: false, gone: false, nothing: false, alreadyOn: true };
  await pg.waitForTimeout(250);
  await pg.evaluate(() => { window.__acMut = 0; window.__acApi = 0; }).catch(() => {});
  /* 🔴 **«그 자리로 데려다주기»도 일어난 일이다** — `#wayAi` 는 `scrollIntoView` 만 한다(DOM 0 · 호출 0).
     스크롤을 안 세면 «데려다주는 단추»가 전부 죽은 것으로 찍힌다(2026-09-20 실측). */
    const SCROLLPOS = () => {
    let s = String(Math.round(window.scrollY)) + ":" + Math.round(document.scrollingElement ? document.scrollingElement.scrollTop : 0);
    for (const el of document.querySelectorAll("main, .page, .sheet, [style*='overflow']")) s += "|" + Math.round(el.scrollTop);
    return s;
  };
  const scroll0 = await pg.evaluate(SCROLLPOS).catch(() => "");
  const before = pg.url(), pop0 = popped, dl0 = downloaded, ch0 = chose;
  await pg.mouse.click(pt.x, pt.y).catch(() => {});
  await pg.waitForTimeout(WIN);
  const scroll1 = await pg.evaluate(SCROLLPOS).catch(() => scroll0);
  const r = await pg.evaluate(() => ({ mut: Number(window.__acMut || 0), api: Number(window.__acApi || 0), armed: !!window.__acArmed })).catch(() => ({ mut: 0, api: 0, armed: false }));
  const moved = pg.url() !== before;
  const gone = !r.armed;   // 문서가 갈렸다(이동·새로고침) = 무언가 일어난 것이다
  const scrolled = scroll1 !== scroll0;   // 그 자리로 데려다줬다
  const opened = popped > pop0 || downloaded > dl0 || chose > ch0;   // 새 창·내려받기·파일 고르기 창도 «일어난 일»이다
  /* 🔴 **폼이 스스로 막은 것**을 «죽은 단추»로 세면 안 된다 — 빈 필수 칸이 있으면 브라우저가 전송을
     막고 말풍선만 띄운다(DOM 0 · 호출 0). 그건 단추가 죽은 게 아니라 **내가 칸을 안 채운 것**이다. */
  let blockedByForm = gone ? false : await pg.evaluate((m) => {
    const e = document.querySelector(`[data-ac-probe="${m}"]`);
    const f = e && e.form;
    return !!(f && typeof f.checkValidity === "function" && !f.checkValidity());
  }, mark).catch(() => false);

  /* 🔴 [2026-09-21 · A] **칸을 채우고 한 번 더 눌러 본다.**
     여태 이 자는 «내가 칸을 안 채운 것»이라 적고 **⊘ 로 남겼다** — 로그인·가입·비번찾기 등 **10곳**이 그렇게 영영 안 쟀다.
     그런데 «칸을 안 채운 것»이면 **채우면 잴 수 있다.** 안 재고 ⊘ 로 두면 그 단추는 아무도 안 보는 것이다(AC-95).
     🔴 채우는 값은 **모양만 맞춘 가짜**다(모의 층이라 아무 데도 안 나간다 · `?mock=1`).
     🔴 그래도 못 채우면(고르는 칸·파일 칸 등) **그대로 ⊘ 다** — 억지로 통과시키지 않는다(AC-9). */
  if (blockedByForm && !retry) {
    const filled = await pg.evaluate((m) => {
      const e = document.querySelector(`[data-ac-probe="${m}"]`); const f = e && e.form;
      if (!f) return false;
      const V = { email: "walk@example.com", password: "WalkTest2026!", url: "https://example.com/post", tel: "01012345678",
        number: "1", date: "2020-01-01", search: "시험", text: "시험 입력" };
      for (const el of f.querySelectorAll("input,textarea,select")) {
        if (!el.required || el.disabled || el.type === "hidden") continue;
        if (el.type === "checkbox" || el.type === "radio") { if (!el.checked) { el.checked = true; el.dispatchEvent(new Event("change", { bubbles: true })); } continue; }
        if (el.tagName === "SELECT") { const o = [...el.options].find((x) => x.value); if (!o) return false; el.value = o.value; }
        else if (el.type === "file") return false;                      // 파일은 못 채운다 — 정직하게 ⊘
        else if (!el.value) el.value = V[el.type] || V[el.name] || V.text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return f.checkValidity();
    }, mark).catch(() => false);
    if (filled) {
      const again = await press(mark, true);                            // 🔴 한 번만 다시 — 무한 되풀이 금지
      return { ...again, refilled: true };
    }
  }
  return { ...r, idle, moved, gone, opened, scrolled, blockedByForm,
    nothing: !moved && !gone && !opened && !scrolled && !blockedByForm && r.api === 0 && r.mut === 0 };
}

/* ═══ 화면 × 상태 — 🔴 손 목록 0 ═══ */
/** 그 화면이 id 를 읽나 — 소스에서 본다. */
const readsId = (p) => /UI\.qs\.get\(\s*["']id["']\s*\)/.test(readFileSync(path.join(PUB, p.slice(1)), "utf8"));
/** 화면 이름 → 모의 상태의 배열 이름(piece→pieces · account→accounts). */
const collNames = (p) => { const b = path.basename(p, ".html"); return [b + "s", b.replace(/y$/, "ies"), b]; };

/**
 * 🔴 [2026-09-21 · A] **«열쇠 표»** — 이 화면을 열려면 주소에 무엇이 더 있어야 하나.
 *   이 자가 «늘 exit 2» 이던 까닭의 절반이 이것이었다(AC-95 «늘 ⊘ 인 자는 곧 아무도 안 본다»).
 *   🔴 **모의는 이미 닿고 있었다** — 자가 **열쇠를 안 넣어서** 빈 껍데기를 보고 «못 쟀다»고 적었다:
 *     · `team-accept.html` — `mock.js` 의 `team-invite-info` 는 **token 만 있으면** 답한다(빈 token 이면 410)
 *     · `receipt.html` — `invoice` 모의는 답하는데, 이 자가 찾던 목록 이름이 `receipts` 라 **`billing.invoices` 를 못 찾았다**
 *   점(`.`)으로 파고든다. 값이 배열이면 각 `id` 로 상태를 하나씩 연다.
 */
const KEYS = {
  "/app/team-accept.html": { param: "token", fixed: "mock-invite-token" },
  "/receipt.html": { param: "id", from: "billing.invoices" },
  /* 디렉터는 «소재»를 들고서만 여는 화면이다(`director.html:29` — 없으면 만들기로 보낸다 · 설계다).
     모의의 소재 하나를 들려 보낸다. 🔴 모의 층이라 `director-propose` 도 가짜다 — **진짜 AI 는 안 부른다.** */
  "/app/director.html": { param: "topicId", from: "topics" },
};
const dig = (o, dotted) => dotted.split(".").reduce((a, k) => (a == null ? a : a[k]), o);

let mockState = {};
async function loadMockState() {
  await open("/app/pieces.html?mock=1");
  mockState = await pg.evaluate(() => { try { return JSON.parse(sessionStorage.getItem("acMockState") || "{}"); } catch { return {}; } }).catch(() => ({}));
}

const roster = [];       // 🔴 **본 단추 전부** — 정적으로 «붙은 것처럼 보이는» 것도 뺴지 않는다(⓪d 가 그 이유다)
const found = [];        // 눌러 봐도 아무 일 없던 것 = 확정
const covered = [];      // 가운데가 다른 것에 가려져 **누를 수조차 없던** 것 — 살펴볼 것
const emptyPages = [];   // 아무것도 안 그린 화면 — «단추 0개, 통과»로 적으면 거짓말이다
const noButtonPages = [];   // [2026-09-21] **그릴 단추가 애초에 없는 화면**(법 문서·숫자 대시보드) — 사실이지 구멍이 아니다
const deadEnds = [];     // 🔴 막다른 골목 — 이 상태에서 손님이 갈 수 있는 길이 0
const seen = { pages: 0, states: 0, buttons: 0, sheets: 0, pressed: 0 };

say("🔴 손이 안 붙은 단추 — 브라우저에서 눌러 본다 · " + new Date().toISOString());
say("─".repeat(112));
await loadMockState();

for (const p of pages) {
  const mocked = p.startsWith("/app/") || ["/onboarding.html", "/receipt.html", "/register.html"].includes(p);
  const states = [""];
  /* [2026-09-21] 열쇠 표(위 KEYS 주석) — 넣을 열쇠가 있으면 **그 상태로만** 잰다(빈 껍데기를 세지 않는다). */
  const key = KEYS[p];
  if (key) {
    if (key.fixed) states.length = 0, states.push(`&${key.param}=${encodeURIComponent(key.fixed)}`);
    else {
      const arr = dig(mockState, key.from);
      if (Array.isArray(arr) && arr.length) { states.length = 0; for (const it of arr) if (it && it.id != null) states.push(`&${key.param}=${it.id}`); }
      else unmeasured.push(`${p} — 열쇠 \`${key.param}\` 를 \`${key.from}\` 에서 못 찾았다 — **모의 상태에 그 목록을 채워라**`);
    }
  }
  /* 🔴 [2026-09-21] `?id=` 를 읽는 화면은 **맨 주소로 열면 스스로 다른 화면으로 보낸다**(설계다 — `piece.html:29` 류).
     그 상태를 «못 쟀음»으로 세면 **영영 안 지워지는 ⊘** 가 된다 — 정작 `?id=` 상태는 바로 아래에서 제대로 잰다.
     ⇒ 열 수 있는 id 를 찾으면 **맨 상태는 빼고** 그 상태들만 잰다. 못 찾으면 그때는 정직하게 ⊘ 다. */
  if (!key && mocked && readsId(p)) {
    const names = collNames(p);
    const arr = names.map((n) => mockState[n]).find((a) => Array.isArray(a) && a.length);
    if (arr) { const ids = arr.filter((it) => it && it.id != null); if (ids.length) states.length = 0; for (const it of ids) states.push(`&id=${it.id}`); }
    else unmeasured.push(`${p} — \`?id=\` 를 읽는데 모의 상태에서 그 목록(${names.join("·")})을 못 찾았다 — **한 상태만 쟀다**`);
  }
  seen.pages++;
  let outside = null;
  for (const st of states) {
    const url = `${p}?mock=1${st}`;
    const o = await open(url);
    if (o.net.length) { outside = o.net[0]; break; }   // 🔴 모의 밖 화면 — 재면 거짓말이 된다
    /* 🔴 스스로 다른 화면으로 보낸 자리는 **여기서 재지 않는다** — 재면 옆 화면 단추를 이 화면 것으로 적는다. */
    if (!o.here) { unmeasured.push(`${url} — 이 화면이 스스로 ${o.at} 로 보냈다 — **여기선 못 쟀음**(간 곳은 그 화면 차례에 잰다)`); continue; }
    seen.states++;
    const list = await pg.evaluate(MEASURE, null);
    seen.buttons += list.length;
    /* 🔴 아무것도 안 그린 화면을 «단추 0개, 통과»로 적으면 그게 바로 조용한 거짓 초록이다.
       🔴 [2026-09-21 · A] 다만 **«그릴 단추가 애초에 없는 화면»과 «모의가 못 닿아 빈 껍데기인 화면»은 다르다.**
          한 칸에 섞어 두어 이 자가 «늘 exit 2» 였다(AC-95). 둘을 **재서** 가른다 —
          그 화면 파일 안에 단추를 만들 글자(`<button` · `class="btn` · `.tap`)가 **하나도 없으면** 그릴 수가 없다.
          실측(2026-09-21): terms·privacy·paid-terms·automation-notice 는 소스에 0개(법 문서다) ·
          ops/index 도 0개(숫자만 그리는 대시보드다) ⇒ 이 다섯은 **사실이지 구멍이 아니다.**
          반대로 team-accept 는 `<button` 1 · `.btn` 3 이라 **그릴 수 있는데 안 그린 것** = 진짜 구멍(열쇠로 열었다). */
    if (!list.length) {
      const src = readFileSync(path.join(PUB, p.slice(1)), "utf8");
      if (/<button|class="btn|class="row tap/.test(src)) emptyPages.push(url);
      else noButtonPages.push(url);
    }
    for (const b of list) roster.push({ page: p, url, scope: "화면", opener: null, ...b });

    /* ═══ ㉱ 🔴 **막다른 골목** — 이 상태에서 손님이 갈 수 있는 길이 0인가 ═══
       2026-09-20 첫 실발행의 고장 ①이 바로 이것이었다. 메인은 «죽은 단추»라고 했지만 A 가 브라우저로 재 보니
       `awaiting_manual` 글 화면엔 **단추가 아예 없었다** — 배지에 «확인 필요»만 뜨고 무엇을 확인할지도, 다음 수도 없었다.
       🔴 그래서 ㉮~㉰(«단추가 죽었나»)만으로는 **그 고장을 영영 못 잡는다.** 없는 단추는 죽을 수도 없다.
       세는 자리: `main.page` 안 — 늘 있는 겉껍데기(아래 탭바·옆 레일·위 뒤로가기)는 뺀다. 그것들은 «이 화면의 길»이 아니다. */
    const ways = await pg.evaluate(() => {
      const host = document.querySelector("main.page") || document.body;
      const vis = (e) => { const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== "none" && s.visibility !== "hidden" && +s.opacity > 0.01 && r.width > 1 && r.height > 1; };
      const chrome = (e) => !!e.closest("nav.tabs, nav.rail, .appbar, .seg");
      let n = 0;
      for (const e of host.querySelectorAll('button, [role="button"], a[href]')) {
        if (!vis(e) || chrome(e) || e.disabled) continue;
        const href = e.getAttribute && e.getAttribute("href");
        if (href && (href.startsWith("#") || href.startsWith("javascript:"))) continue;
        n++;
      }
      return { n, text: (host.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70) };
    }).catch(() => ({ n: -1, text: "" }));
    if (ways.n === 0) deadEnds.push({ url, mocked, text: ways.text });

    /* ㉯ 시트 — 줄(.row)을 눌러 연다 */
    for (const om of list.filter((b) => b.row).map((b) => b.mark)) {
      await pg.click(`[data-ac-probe="${om}"]`, { timeout: 2000, force: true }).catch(() => {});
      await pg.waitForTimeout(450);
      if (pg.url() !== BASE + url) { await open(url); await pg.evaluate(MEASURE, null); continue; }   // 줄이 다른 화면으로 갔다
      if (!(await pg.$(".sheet"))) continue;
      seen.sheets++;
      const sl = await pg.evaluate(MEASURE, ".sheet");
      seen.buttons += sl.length;
      for (const b of sl) roster.push({ page: p, url, scope: "시트", opener: om, ...b });
      await pg.evaluate(() => document.querySelectorAll(".sheet,.sheet-bg").forEach((x) => x.remove()));
      await pg.waitForTimeout(120);
      await pg.evaluate(MEASURE, null);   // 표식을 다시 매긴다(시트가 지워졌으니)
    }
  }
  /* 🔴 [2026-09-21 · A] 모의 밖으로 나간 화면이라도, **그릴 단추가 애초에 없으면** 잴 것도 없다.
     `/index.html` 이 그렇다 — `location.replace("/app/home.html")` 한 줄짜리 문지기다(소스에 단추 0개).
     그걸 «못 쟀음»으로 세면 영영 안 지워지는 ⊘ 가 된다(AC-95). **재서** 가른다 — 나중에 단추가 생기면 저절로 ⊘ 로 돌아온다. */
  if (outside) {
    const src = readFileSync(path.join(PUB, p.slice(1)), "utf8");
    if (/<button|class="btn|class="row tap/.test(src)) unmeasured.push(`${p} — 모의가 이 화면을 안 흉내 낸다(${outside.replace(BASE, "")} 가 진짜로 나갔다) — **⊘ 못 쟀음**`);
    else noButtonPages.push(`${p} (모의 밖이지만 **그릴 단추가 0개**다)`);
  }
}

/* ═══ ㉰ 🔴 **전부 눌러 본다** ═══
   정적으로 «붙었다»고 본 것도 뺴지 않는다 — ⓪d 가 보여 준 그대로, **위임은 정적으로 못 가른다.**
   본 단추가 수백 개라 오래 걸린다. 그래도 이 자의 값은 여기 있다. */
const tally = { 제자리: [0, 0], 위임: [0, 0], 폼: [0, 0], 링크: [0, 0], 없음: [0, 0] };   // [일어남, 아무 일 없음]
const skipped = roster.filter((r) => !PRESS_ALL && r.hand === "제자리").length;
let alreadyOn = 0;   // 이미 골라진 칩 — 다시 눌러도 안 바뀌는 게 맞다(판정 밖)
for (const s of roster) {
  if (!PRESS_ALL && s.hand === "제자리") continue;
  await open(s.url);
  await pg.evaluate(MEASURE, null);
  if (s.opener) {
    await pg.click(`[data-ac-probe="${s.opener}"]`, { timeout: 2000, force: true }).catch(() => {});
    await pg.waitForTimeout(450);
    await pg.evaluate(MEASURE, ".sheet").catch(() => []);
  }
  const r = await press(s.mark);
  seen.pressed++;
  if (r.nothing) { found.push({ ...s, r }); (tally[s.hand] ||= [0, 0])[1]++; }
  else if (r.covered) covered.push({ ...s, r });
  else if (r.missing) unmeasured.push(`${s.url} «${s.text}» — 눌러 보려 하니 그 단추가 없어졌다(다시 그려졌다) — **⊘ 못 쟀음**`);
  else if (r.restless) unmeasured.push(`${s.url} «${s.text}» — 화면이 **끝내 조용해지지 않아**(1.8초 동안 계속 움직였다) 눌러도 가를 수 없다 — **⊘ 못 쟀음**`);
  else if (r.alreadyOn) alreadyOn++;
  else if (r.blockedByForm) unmeasured.push(`${s.url} «${s.text}» — 폼의 **빈 필수 칸** 때문에 전송이 막혔다(단추가 죽은 게 아니다) — **⊘ 못 쟀음**`);
  else (tally[s.hand] ||= [0, 0])[0]++;
}

/* ═══ ⓪ 자기 찌르기 — 🔴 «자를 냈다»가 아니라 «변이를 넣으면 우는가» ═══ */
const probes = [];
async function selfProbe(name, plant, wantCry) {
  await open("/app/pieces.html?mock=1");
  const id = await pg.evaluate(plant);
  const list = await pg.evaluate(MEASURE, null);
  const hit = list.find((b) => b.id === id);
  let cry = !!hit && hit.hand === "없음";
  if (cry) { const r = await press(hit.mark); cry = r.nothing; }
  const ok = cry === wantCry;
  probes.push({ name, ok, note: hit ? `자가 본 손=«${hit.hand}» · 울었나=${cry}` : "🔴 자가 그 단추를 아예 못 봤다" });
  if (!ok) fail++;
}
/* 🔴 심는 단추는 **아무것도 못 덮는 자리**에 둔다 — 제품의 고정 탭바에 가리면
   내 마우스가 탭바를 눌러 «살아 있다»로 읽힌다(2026-09-20 에 실제로 그렇게 속았다). */
const plantDead = () => { const b = document.createElement("button"); b.id = "zzDead"; b.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;width:160px;height:36px"; b.textContent = "심은 죽은 단추"; document.body.appendChild(b); return "zzDead"; };
const plantLive = () => { const b = document.createElement("button"); b.id = "zzLive"; b.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;width:160px;height:36px"; b.textContent = "심은 산 단추"; b.onclick = () => { document.title = "눌렸다 " + Date.now(); }; document.body.appendChild(b); return "zzLive"; };
const plantLive2 = () => { const b = document.createElement("button"); b.id = "zzLive2"; b.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647;width:160px;height:36px"; b.textContent = "심은 산 단추2"; b.addEventListener("click", () => { document.title = "눌렸다2 " + Date.now(); }); document.body.appendChild(b); return "zzLive2"; };
/** 🔴 조상엔 손이 있는데 **이 단추는 안 잡는** 위임 — 정적으로는 «붙었다»로 보인다. */
const plantDeadDelegate = () => {
  const w = document.createElement("div"); w.id = "zzWrap"; w.style.cssText = "position:fixed;top:8px;left:8px;z-index:2147483647";
  w.addEventListener("click", (e) => { if (e.target.closest("[data-zz]")) document.title = "위임 " + Date.now(); });
  const b = document.createElement("button"); b.id = "zzDeadDel"; b.style.cssText = "width:160px;height:36px"; b.textContent = "위임이 안 잡는 단추";
  w.appendChild(b); document.body.appendChild(w); return "zzDeadDel";
};

await selfProbe("⓪a 손 없는 단추를 심으면 운다", plantDead, true);
await selfProbe("⓪b onclick 이 붙은 단추엔 안 운다(거짓 빨강 없음)", plantLive, false);
await selfProbe("⓪c addEventListener 로 붙인 단추에도 안 운다", plantLive2, false);
let d4 = "";
{
  await open("/app/pieces.html?mock=1");
  await pg.evaluate(plantDeadDelegate);
  const list = await pg.evaluate(MEASURE, null);
  const hit = list.find((b) => b.id === "zzDeadDel");
  const staticSays = hit ? hit.hand : "못 봄";
  let pressSays = "—";
  if (hit) { const r = await press(hit.mark); pressSays = r.nothing ? "아무 일도 안 남" : `뭔가 일어남(api=${r.api} mut=${r.mut} idle=${r.idle} moved=${r.moved} gone=${r.gone} armed=${r.armed})`; }
  const ok = staticSays === "위임" && pressSays === "아무 일도 안 남";
  probes.push({ name: "⓪d 위임이 **안 잡는** 단추 — 정적으론 «붙음», 눌러 보면 «아무 일 없음»", ok, note: `정적=«${staticSays}» · 눌러 보니=«${pressSays}»` });
  if (!ok) fail++;
  else d4 = "  🔴 ⓪d 가 이 자의 값이다 — **정적 검사 혼자서는 이 단추를 영영 초록으로 통과시킨다.**";
}

/* ═══ 판정 ═══ */
say("");
say("⓪ 자기 찌르기 — 🔴 «자를 냈다»가 아니라 «변이를 넣으면 우는가»");
for (const p of probes) say(`  ${p.ok ? "✓" : "✗"} ${p.name}  — ${p.note}`);
if (d4) say(d4);
say("");
say(`■ 잰 모수 — 화면 ${seen.pages}개 · 상태 ${seen.states}가지 · 연 시트 ${seen.sheets}개 · 본 단추 ${seen.buttons}개 · 눌러 본 단추 ${seen.pressed}개`);
if (skipped) {
  say(`   🔴 «제자리»(그 단추에 직접 손이 붙은 것) ${skipped}개는 **안 눌러 봤다** — \`--press-all\` 로 전부 눌러 본다.`);
  say("      그 손이 **빈 함수**면 이 자는 못 잡는다 — 그건 이 자가 **못 재는 것**이다(AC-9).");
  /* 🔴 [2026-09-21 · A] **이 줄이 이 자를 «늘 exit 2» 로 만들던 구조적 원인이다**(AC-95).
     기본 모드는 «제자리» 단추를 **일부러** 안 누른다(404개를 다 누르면 몇십 분이다) — 그건 **모드 선택**이지 구멍이 아니다.
     매번 구멍으로 세면 종료코드가 **영원히 2** 라, 진짜 구멍이 생겨도 아무도 못 알아챈다.
     ⇒ 위 두 줄로 **크게 말하되**, 구멍으로는 `--press-all` 을 켠 판에서만 센다.
     🔴 «말은 하되 세지 않는다»가 아니다 — `--press-all` 을 켜면 그때 남는 것은 **진짜 구멍**으로 센다. */
  if (PRESS_ALL) unmeasured.push(`«제자리» 단추 ${skipped}개 — \`--press-all\` 인데도 못 눌렀다`);
  else say("      (기본 모드가 일부러 안 누르는 것이라 **구멍으로 세지 않는다** — 세면 종료코드가 늘 2 가 되어 아무도 안 본다 · AC-95)");
}
say("");
if (found.length) {
  fail++;
  say(`🔴 손이 안 붙은 단추 ${found.length}개 — **그려지고 눌리는데 아무 일도 안 난다**`);
  for (const f of found) {
    say(`   · ${f.url}  ${f.scope}${f.opener ? `(줄 «${f.opener}» 을 눌러 연 시트)` : ""}`);
    say(`       «${f.text}»${f.id ? ` id=${f.id}` : ""}${f.data ? ` [${f.data}]` : ""}`);
    say(`       눌러 보니 — UI.api 호출 ${f.r.api}회 · 화면 이동 없음 · 새 창·파일창 없음 · 스크롤도 안 움직임 · **조용해진 뒤 DOM 변화 ${f.r.mut}회**`);
  }
} else {
  say(`✅ 손이 안 붙은 단추 0개 — 눌러 본 ${seen.pressed}개가 모두 무언가를 했다`);
}
if (alreadyOn) say(`  · 이미 골라져 있던 칩 ${alreadyOn}개는 판정 밖 — 다시 눌러도 안 바뀌는 게 **맞는 동작**이다.`);
if (covered.length) {
  say("");
  say(`  △ 살펴볼 것 — **가운데가 다른 것에 가려진** 단추 ${covered.length}개(눌러 보지 못했다)`);
  for (const c of covered) say(`     · ${c.url} «${c.text}» — 그 자리에 있는 것: ${c.r.topTag}`);
  say("     🔴 판정에 넣지 않는다 — 스크롤 위치에 따라 달라진다. 다만 **손님도 거기선 못 누른다.**");
}
say("");
say("  ■ 교차표 — **정적으로 본 손** × **눌러 본 결과**(🔴 모수를 찍는다 · AC-114)");
for (const [k, v] of Object.entries(tally)) if (v[0] || v[1]) say(`     ${k.padEnd(4)} — 일어남 ${v[0]}개 · 아무 일 없음 ${v[1]}개`);
say("     🔴 «위임» 칸에 «아무 일 없음»이 있으면 그것이 **정적 검사가 영영 못 잡는 자리**다(⓪d).");
const deadApp = deadEnds.filter((d) => d.url.startsWith("/app/"));
const deadOther = deadEnds.filter((d) => !d.url.startsWith("/app/"));
say("");
if (deadApp.length) {
  fail++;
  say(`🔴 막다른 골목 ${deadApp.length}곳 — **그 상태에서 손님이 할 수 있는 것이 하나도 없다**`);
  for (const d of deadApp) say(`   · ${d.url}
       화면에 적힌 말: «${d.text}»`);
  say("   🔴 겉껍데기(아래 탭바·옆 레일·뒤로가기)는 세지 않았다 — 그건 «이 화면의 길»이 아니다.");
} else {
  say("✅ 막다른 골목 0곳 — 잰 모든 상태에 갈 길이 하나 이상 있다");
  say("   🔴 다만 이 축은 **2026-09-20 의 고장 ①을 못 잡는다**(수리 전 코드에 돌려 봤다 — 그때도 0곳이었다).");
  say("      없던 것은 «길»이 아니라 **«으뜸 단추»**였다 — 그 축은 verify-cta-bound.mjs(A) 가 잰다.");
}
if (deadOther.length) say(`  △ 살펴볼 것 — 제품 밖 화면 중 길이 0인 곳 ${deadOther.length}곳: ${deadOther.map((d) => d.url).join(" · ")}`);
if (emptyPages.length) {
  say("");
  say(`⊘ 단추를 하나도 안 그린 화면 ${emptyPages.length}개 — **«통과»가 아니라 «못 쟀음»이다**`);
  for (const u of emptyPages) say(`   · ${u}`);
  say("   🔴 로그인 뒤 화면은 모의 밖이면 빈 껍데기로 뜬다. 거기 있는 단추는 **아무도 안 쟀다.**");
}
/* 🔴 [2026-09-21 · A] **사실은 사실대로 적는다** — 숨기면 그게 «검사를 끈 것»이다(AC-95).
   소스에 단추를 만들 글자가 하나도 없는 화면이다. 나중에 누가 단추를 넣으면 **자동으로 위 ⊘ 칸으로 옮겨 간다.** */
if (noButtonPages.length) {
  say("");
  say(`ℹ️ 그릴 단추가 **애초에 없는** 화면 ${noButtonPages.length}개 — 구멍이 아니라 사실이다(소스에 \`<button\`·\`class="btn\`·\`row tap\` 이 0개)`);
  for (const u of noButtonPages) say(`   · ${u}`);
  say("   🔴 여기에 나중에 단추가 생기면 이 자가 **저절로 ⊘ 로 올려 세운다** — 목록을 손으로 적지 않는다.");
}
if (unmeasured.length) {
  say("");
  say(`⊘ 못 쟀음 ${unmeasured.length}개 — **통과가 아니다**(AC-9)`);
  for (const u of unmeasured) say(`   · ${u}`);
}
say("─".repeat(112));
say("🔴 이 자는 «칠해졌나»(verify-paint)와 다른 축이다 — 저 단추는 **지금도 훌륭하게 칠해진다.**");

await browser.close();
server.close();
/* 🔴 빨강이 먼저다(1). 빨강이 없어도 **못 잰 자리가 있으면 «통과»가 아니다**(2 · AC-9). */
const gaps = unmeasured.length + emptyPages.length;
process.exit(fail ? 1 : gaps ? 2 : 0);
