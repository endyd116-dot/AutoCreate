/**
 * runner/channels/naver-blog.mjs — 네이버 블로그(스마트에디터 ONE) 발행.
 *   AM 원본: ../AutoMarketing/scripts/naver-blog-runner.mjs — 셀렉터·다중 폴백·팝업 처리·URL 회수를
 *            2026-09-14 이식(AC 잡 모양·RunnerErrorKind 로 개작). AM 이 실측으로 얻은 것을 그대로 가져온다:
 *
 *     · 에디터는 top 일 수도 **iframe 일 수도** 있다 → 최대 8라운드 **폴링**으로 컨텍스트를 정한다(단발 판정 금지).
 *     · 에디터 «밖»의 홍보 레이어와 «안»의 팝업(임시저장 복구·도움말)은 **다른 것**이다 — 따로, 매 라운드 걷어낸다.
 *       («7일간 보지 않기»를 먼저 누른다 — ✕ 로 닫으면 다음 회차에 같은 벽을 또 만난다.)
 *     · 글쓰기 화면에 못 갔으면 **대체 주소**로 한 번 더(`/postwrite` ↔ `?Redirect=Write`).
 *     · 사진은 1장씩 넣고 «자리 잡을 때까지» 기다린다(비동기 삽입이 쓰던 문단을 밀어낸다).
 *     · 여러 장 업로드 시 «사진 첨부 방식» 팝업이 뜬다 — **반드시 «개별사진»을 고른다**(✕ 로 닫으면 0장 삽입).
 *     · 발행 후 URL 은 «발행 전엔 없던» logNo 로 판정한다(기존 탭 오탐 방지).
 *
 *   🔴 실패는 정직 분류다 — 못 찾으면 `selector_changed`, 캡차면 `captcha`. «성공»으로 만들지 않는다.
 *   🔴 dryRun(카나리·검증)은 **임시저장까지만** 한다. 발행 버튼을 누르지 않는다.
 */
import { shot, failShot, settle, downloadImages, cleanupFiles } from "../lib/browser.mjs";
import { BLOCK, ensureNaverLogin } from "../lib/auth-naver.mjs";   // 로그인은 공용(애드포스트·클립과 같은 nid 세션)
import { createFormatState, markFormatDirty, breakFormatBeforePara, measureFormatBleed, bleedVerdict } from "../lib/format-bleed.mjs";

const B_TITLE = ".se-section-documentTitle .se-text-paragraph, .se-documentTitle .se-text-paragraph, .se-placeholder.__se_placeholder, .se-section-documentTitle";
const B_EDITOR = ".se-content, .se-container, .se-components-wrap";
const B_BODY = ".se-component.se-text .se-text-paragraph";

/* ═══ [P1R8 §3.3] 셀렉터 표 — 🔴 **여기 값은 «묶여 온 표»(zip 안의 기본값)다** ═══
   서버가 서명된 표를 내려 주면 그 칸이 이깁니다. 못 주거나 못 믿으면 **이 값 그대로** 돕니다.
   🔴 `S` 가 모듈 변수인 것이 안전한 이유 = 러너는 잡을 **한 건씩 순차로** 돈다(`core.mjs tick`).
      동시 실행을 만들게 되면 **여기를 먼저 고쳐야 한다**.
   ⚠️ 도구모음(`TOOLBAR_SELECTORS`)은 아직 표에 안 넣었다 — 종류가 많고 실패해도 **서식만 깎이지 글은 나간다**.
      먼저 «못 올린다»를 만드는 세 칸(제목·에디터·본문)부터 서버가 고칠 수 있게 한다. */
export const BUNDLED_SELECTORS = { title: B_TITLE, editor: B_EDITOR, body: B_BODY };
let S = { ...BUNDLED_SELECTORS };

/* ───────────────────── 팝업·레이어 ───────────────────── */

/** 에디터 «안»의 팝업(임시저장 복구·도움말). page 뿐 아니라 frame 도 받는다 — 에디터가 iframe 이면 팝업도 그 안에 뜬다. */
async function dismissEditorPopups(target) {
  for (const sel of [".se-popup-button-cancel", ".se-help-panel-close-button", 'button[class*="close"]']) {
    try {
      const btn = target.locator(sel).first();
      if (await btn.isVisible({ timeout: 1200 }).catch(() => false)) await btn.click({ timeout: 3000 }).catch(() => {});
    } catch { /* 무시 */ }
  }
}

/** 에디터 «밖»의 서비스 홍보 레이어. «N일간 보지 않기»를 먼저 — ✕ 로 닫으면 다음 회차에 또 만난다. */
async function dismissPromoLayers(page) {
  const targets = [page, ...page.frames().filter((f) => f !== page.mainFrame())];
  for (const t of targets) {
    for (const re of [/\d+일간 보지 않기/, /오늘 하루 보지 않기/, /다시 보지 않기/]) {
      try {
        const el = t.getByText(re).first();
        if (await el.isVisible({ timeout: 700 }).catch(() => false)) await el.click({ timeout: 3000 }).catch(() => {});
      } catch { /* 무시 */ }
    }
    for (const sel of ['[class*="layer"] button[class*="close"]', '[class*="popup"] button[class*="close"]', 'button[aria-label*="닫기"]']) {
      try {
        const el = t.locator(sel).first();
        if (await el.isVisible({ timeout: 600 }).catch(() => false)) await el.click({ timeout: 2500 }).catch(() => {});
      } catch { /* 무시 */ }
    }
  }
}

/* ───────────────────── 에디터 진입 ───────────────────── */

async function openEditor(page, blogId, shotKey) {
  const onWriteUrl = () => /postwrite|Redirect=Write|PostWriteForm/i.test(page.url());
  const urls = [`https://blog.naver.com/${blogId}/postwrite`, `https://blog.naver.com/${blogId}?Redirect=Write`];
  for (let attempt = 0; attempt < urls.length && !onWriteUrl(); attempt++) {
    await page.goto(urls[attempt], { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
    if (/nidlogin/i.test(page.url())) throw BLOCK("login_fail", "에디터에 들어가려는데 다시 로그인을 요구했어요(세션 만료).");
    await settle(page, 1500);
    await dismissPromoLayers(page);
  }
  await shot(page, shotKey, "01-에디터진입");

  /* 에디터 컨텍스트 판정은 **폴링**이다(단발 판정은 번들이 늦게 뜨면 top 으로 잘못 확정된다 — AM 실사고). */
  let ctx = page;
  let ready = false;
  for (let round = 0; round < 8 && !ready; round++) {
    await dismissPromoLayers(page);
    await dismissEditorPopups(page);
    if (await page.locator(`${S.editor}, ${S.title}`).first().isVisible({ timeout: 2000 }).catch(() => false)) { ctx = page; ready = true; break; }
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      if (await fr.locator(`${S.editor}, ${S.title}`).first().isVisible({ timeout: 1200 }).catch(() => false)) {
        ctx = fr; ready = true; await dismissEditorPopups(fr); break;
      }
    }
    if (!ready) await settle(page, 1000);
  }
  if (!ready) {
    /* top 의 innerText 는 «""» 로 나오기 일쑤다(본문이 iframe 안이라) — 프레임 텍스트까지 긁어
       «실제로 화면에 보이는 말»을 사유에 남긴다. 빈 문자열을 적으면 «백지였다»로 오독된다. */
    let seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      const t = ((await fr.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
      if (t.length > seen.length) seen = t;
    }
    /* 🔴 «화면을 못 찾았다»를 전부 selector_changed 로 적으면 **계정 문제가 우리 버그로 둔갑한다**
       (selector_changed 는 ourBug=true·risk high — 고객의 잘못된 블로그 주소로 개발자를 호출하게 된다).
       네이버가 «해당 블로그가 없습니다» 라고 말해 줬으면 그대로 믿는다 — AM 이 분류를 가른 이유가 이것이다.
       2026-09-14 로컬 왕복 실측에서 실제로 이 오분류가 나왔다(job #3). */
    if (/해당 블로그가 없|유효하지 않은 요청|존재하지 않는 블로그|블로그 아이디를 확인/.test(seen)) {
      throw BLOCK("login_fail", `네이버에 «${blogId}» 블로그가 없어요. 계정의 블로그 주소를 확인해 주세요.`);
    }
    if (/이용이 제한|제재|블라인드 처리/.test(seen)) throw BLOCK("suspended", "이 블로그는 네이버에서 이용이 제한된 상태예요.");
    if (/로그인/.test(seen) && /nidlogin|로그인이 필요/.test(`${page.url()} ${seen}`)) {
      throw BLOCK("login_fail", "글쓰기 화면에서 다시 로그인을 요구했어요(세션 만료).");
    }
    throw BLOCK("selector_changed", `글쓰기 화면을 찾지 못했어요 — url=${page.url().slice(0, 90)} · 화면="${seen.slice(0, 120)}"`);
  }
  await dismissEditorPopups(page);
  if (ctx !== page) await dismissEditorPopups(ctx);
  return ctx;
}

/** 여러 셀렉터 + DOM 직접 이벤트 폴백 클릭(가시성 판정에 걸리는 경우 회복). */
async function clickEditable(ctx, selector, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const loc = ctx.locator(selector).first();
      await loc.waitFor({ state: "visible", timeout: 10_000 });
      await loc.click({ timeout: 8000 });
      return true;
    } catch {
      if (attempt < retries) continue;
      const domOk = await ctx.evaluate((sel) => {
        let node = null;
        for (const part of sel.split(",")) { node = document.querySelector(part.trim()); if (node) break; }
        const ed = node && (node.querySelector('[contenteditable="true"]') || node);
        if (!ed) return false;
        ed.scrollIntoView({ block: "center" });
        const r = ed.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          ed.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
        }
        if (ed.focus) ed.focus();
        return true;
      }, selector).catch(() => false);
      if (domOk) return true;
      return false;
    }
  }
  return false;
}

/* ───────────────────── 본문 연주 ───────────────────── */

/**
 * 도구모음 셀렉터 — 🔴 AM 원본 `naver-blog-runner.mjs TOOLBAR_SELECTORS` **실측 정본** 그대로(이식 2026-09-14).
 *   ⚠️ 내가 처음에 추측으로 쓴 `data-name="horizontalLine"`(캐멀)은 **틀렸다** — 실제는 `horizontal-line`(하이픈)이고,
 *      그래서 구분선이 전부 «———» 텍스트 폴백으로 나갔다(2026-09-14 자사 계정 실증 스냅샷에서 확인).
 *      추측 셀렉터는 조용히 폴백으로 흘러 «되는 것처럼» 보인다 — AM 이 실측으로 박아 둔 값을 그대로 쓴다.
 */
const TOOLBAR_SELECTORS = {
  quotation: [
    "button.se-insert-quotation-default-toolbar-button",       // 실측 정본(label="인용구 추가")
    'button[data-name="quotation"]',
    'button[aria-label="인용구 추가"]',
  ],
  horizontalLine: [
    "button.se-insert-horizontal-line-default-toolbar-button", // 실측 정본(label="구분선 추가")
    'button[data-name="horizontal-line"]',
    'button[aria-label="구분선 추가"]',
  ],
  /* [R9-2] 🔴 **사람이 보는 이름으로도 찾는다** — AM 이 실물 툴팁으로 확정했다(2026-08-20 밤 사장님):
     「글자색과 글자 배경색은 팔레트가 아니라 **상단 기능창**에 있고, 툴팁 이름이 «글자색 변경»·«글자 배경색 변경»이다」.
     클래스 하나만 믿으면 네이버가 클래스를 바꾸는 날 조용히 0건이 된다 — 이름은 남는다. */
  hilite: [
    "button.se-background-color-toolbar-button",
    'button[aria-label*="배경색"]:not([aria-label*="글자색"])',
    'button[title*="배경색"]',
  ],
  fontColor: [
    "button.se-font-color-toolbar-button",
    'button[aria-label*="글자색"]:not([aria-label*="배경"])',
    'button[title*="글자색"]:not([title*="배경"])',
  ],
  underline: [
    "button.se-underline-toolbar-button",
    'button[aria-label*="밑줄"]',
    'button[title*="밑줄"]',
  ],
};

/* ═══ [R9-2] 강조 팔레트 — AM 실측 정본(팔레트에 **실제로 있는** 색) ═══
   🔴 `aria-label` 에 헥사가 들어 있다고 믿지 마라 — AM 이 그렇게 적어 뒀다가 셀렉터가 **영원히 0건**이었고
      하루를 버렸다. 라벨이 아니라 **실제 칠해진 배경색**으로 고른다(아래 pickPaletteIndex). */
const HILITE_HEX = ["#fff8b2", "#bdfbfa", "#c2f4db", "#fdd5f5", "#e3fdc8"];   // 형광펜(배경)
const FONTCOLOR_HEX = ["#ff0010"];                                            // 글자색(팔레트 실측 확인분)
const MARK_COLOR_FIXED = process.env.RUNNER_MARK_COLOR || "";                  // 지정 시 그 색으로 고정(수동 override)

/** 소제목·본문 글자 크기(AM 정본값). 🔴 켠 것은 반드시 끈다 — 아래 setFontSize 주석. */
const HEADING_FONT_SIZE = String(process.env.RUNNER_HEADING_SIZE || "19");
const BODY_FONT_SIZE = String(process.env.RUNNER_BODY_SIZE || "15");

/** 도구모음 버튼. 못 찾으면 false — 호출자가 «장식 없이» 내려앉힌다(글은 나간다). */
async function clickToolbarItem(ctx, kind) {
  for (const sel of TOOLBAR_SELECTORS[kind] ?? []) {
    try {
      const b = ctx.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click({ timeout: 4000 }); return true; }
    } catch { /* 다음 후보 */ }
  }
  return false;
}

/** 도구모음에서 글자 크기 한 번 고르기(선택 상태든 캐럿 상태든 같은 동작). AM 원본 setFontSize 이식. */
async function setFontSize(page, ctx, size) {
  try {
    const btn = ctx.locator("button.se-font-size-code-toolbar-button").first();
    if (!(await btn.isVisible({ timeout: 1200 }).catch(() => false))) return false;
    await btn.click({ timeout: 2500 });
    await settle(page, 400);
    for (const sel of [`button:has-text("${size}")`, `li:has-text("${size}")`, `[data-value="${size}"]`]) {
      const o = ctx.locator(sel).last();
      if (await o.isVisible({ timeout: 600 }).catch(() => false)) { await o.click({ timeout: 2000 }); return true; }
    }
    await page.keyboard.press("Escape").catch(() => {});
  } catch { /* 크기 실패 — 굵게로 남는다(글은 나간다) */ }
  return false;
}

/**
 * 🔴 방금 친 길이만큼 되짚어 잡고 소제목 크기를 준 뒤 **본문 크기로 되돌린다**(AM `sizeLastTyped` 이식).
 *   AM 이 실물에서 얻은 진범: **스마트에디터에서 글자 크기는 «커서»에 남는다.** 굵게는 토글이라 꺼지지만
 *   크기는 올린 뒤 되돌리지 않으면 **그 소제목 다음에 치는 모든 글자가 19로 이어진다**
 *   (사장님 «소제목만 크게 하랬더니 본문도 다 커져»의 정체 · 실물 #722·#747).
 */
async function sizeLastTyped(page, ctx, len) {
  if (!len || len > 90) return false;
  for (let i = 0; i < len; i++) await page.keyboard.press("Shift+ArrowLeft").catch(() => {});
  const done = await setFontSize(page, ctx, HEADING_FONT_SIZE);
  await page.keyboard.press("ArrowRight").catch(() => {});   // 선택 해제는 키보드로
  if (done) await setFontSize(page, ctx, BODY_FONT_SIZE).catch(() => {});   // 켠 것은 끈다
  return done;
}

/* ═══════════ [R9-2] 인라인 서식 — «치고 나서 되짚어 잡아 칠한다» ═══════════
 *
 *   🔴 **왜 캐럿 토글이 아닌가.** 이 에디터는 `getSelection()` 이 **항상 빈 문자열**이다(AM 실물 5/5) —
 *      캐럿에 굵게·색·밑줄이 켜져 있는지 **읽을 방법이 없다.** 읽지 못하는 상태를 토글로 끄는 것은 추측이고,
 *      틀리면 **반대로 켜 버린다**(AM 이 `Ctrl+U` 를 금지한 바로 그 이유 · 이 파일도 안 쓴다).
 *   ⇒ 대신 **선택 범위에** 먹인다: 평문으로 치고 → `Shift+ArrowLeft × len` 으로 방금 친 만큼 잡고 →
 *      도구모음을 누르고 → `ArrowRight` 로 푼다. 상태를 읽을 필요도, 토글할 필요도 없다.
 *      🔴 우리 `sizeLastTyped` 가 **이미 이 모양**이다 — 같은 뼈대에 색·밑줄을 얹는다(새 길을 내지 않는다).
 *   🔴 그리고 **칠한 직후 `markFormatDirty`** — 거기가 번짐의 출발점이다(`lib/format-bleed.mjs` 머리말).
 */

/** 색 순번 — 「칠한 티」를 없앤다(짝수=형광펜·홀수=글자색). 잡마다 새로 만든다(전역이면 다음 글이 앞 글 순번을 이어받는다). */
function createMarkSeq() { return { n: 0, hilite: 0, fontColor: 0 }; }

/**
 * 🔴 칠하기 **전에** «무엇을 잡았는지» 확인한다(AM #736 — 실물에서 문단이 한복판에서 갈렸다).
 *   `Shift+ArrowLeft` 가 «방금 친 구절»이 아니라 엉뚱한 곳을 잡고 있으면 — 조각을 친 직후 에디터가
 *   컴포넌트를 만들며 캐럿을 옮기면 그때부터 좌표가 어긋난다 — **칠하지 않고 물러난다.**
 *   ⚠️ 선택 «쓰기»는 못 읽어도 **마지막 문단의 꼬리**는 DOM 으로 정확히 읽힌다. 그 비대칭을 쓴다.
 *   안 칠한 강조는 아쉬울 뿐이지만, **잘못 칠한 강조는 글을 망가뜨린다.**
 */
async function tailMatches(ctx, expect) {
  const tail = await ctx.evaluate(() => {
    const ps = document.querySelectorAll(".se-component.se-text .se-text-paragraph");
    return (ps[ps.length - 1]?.textContent ?? "").slice(-80);
  }).catch(() => "");
  if (!tail) return true;                       // 못 읽었으면 막지 않는다(AC-92 — «모른다»를 «어긋났다»로 바꾸지 않는다)
  const norm = (s) => String(s).replace(/\s+/g, "");
  return norm(tail).endsWith(norm(expect));
}

/** 팔레트에서 **실제 칠해진 색**이 가장 가까운 칸을 고른다. 너무 멀면 -1(엉뚱한 색을 칠하지 않는다). */
async function pickPaletteIndex(ctx, hex) {
  const want = { r: parseInt(hex.slice(1, 3), 16), g: parseInt(hex.slice(3, 5), 16), b: parseInt(hex.slice(5, 7), 16) };
  return await ctx.evaluate((w) => {
    const els = [...document.querySelectorAll(".se-color-palette")];
    let best = -1, bestD = Infinity;
    els.forEach((e, i) => {
      if ((e.className || "").toString().includes("no-col")) return;   // «색 없음» 칸은 건너뛴다
      const m = getComputedStyle(e).backgroundColor.match(/(\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return;
      const d = (+m[1] - w.r) ** 2 + (+m[2] - w.g) ** 2 + (+m[3] - w.b) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= 3000 ? best : -1;
  }, want).catch(() => -1);
}

/**
 * 방금 친 `len` 글자에 마크 하나를 먹인다. @returns "ok" | "caret_drift" | "channel_unsupported"
 *   🔴 실패 사유를 **갈라서** 돌려준다 — «안 됐다» 한 덩어리로 세면 다음 사람이 또 헤맨다(AM 이 전부 catch 로 삼켜
 *      형광펜 0개로 나간 날 로그가 아무 말도 안 했다).
 */
async function applyMark(page, ctx, len, expect, kind, seq, fmt) {
  const cap = kind === "line" ? 140 : kind === "underline" ? 80 : 60;
  if (!len || len > cap) return "channel_unsupported";
  /* `expect` 가 있으면 «내가 방금 친 것을 잡고 있나»를 확인한다. 문단 가운데를 되짚어 칠할 때는
     호출자가 문단 전체를 한 번 대조해 두므로 여기서는 건너뛴다(그때 `expect` 를 안 준다). */
  if (expect && !(await tailMatches(ctx, expect))) return "caret_drift";

  for (let i = 0; i < len; i++) await page.keyboard.press("Shift+ArrowLeft").catch(() => {});

  let ok = false;
  try {
    if (kind === "bold" || kind === "value" || kind === "row") {
      /* 굵게는 «점·나열·굵게»에만 — 문장 전체(line)를 굵게 하면 문단이 통째로 무거워져 오히려 안 읽힌다(AM). */
      await page.keyboard.press("Control+b").catch(() => {});
      ok = true;
    }
    if (kind !== "bold") {
      /* 🔴 면 강조(line)는 **배경색**이 맞다(AM 2026-08-21) — 문장 전체를 빨간 글씨로 두면 경고문처럼 읽힌다.
         나열(row)은 순번을 안 쓴다(항목마다 색이 돌면 알록달록해져 «통일»이 깨진다 — 사장님 지적). */
      const n = seq.n++;
      const useHilite = kind === "underline" ? false : (!MARK_COLOR_FIXED && (kind === "line" || kind === "row" || n % 2 === 0));
      if (kind === "underline") {
        ok = await clickToolbarItem(ctx, "underline");
        if (!ok) return "channel_unsupported";
      } else {
        const hex = MARK_COLOR_FIXED
          || (useHilite ? (kind === "row" ? HILITE_HEX[0] : HILITE_HEX[seq.hilite++ % HILITE_HEX.length])
            : FONTCOLOR_HEX[seq.fontColor++ % FONTCOLOR_HEX.length]);
        const opened = await clickToolbarItem(ctx, useHilite ? "hilite" : "fontColor");
        if (!opened) { await page.keyboard.press("ArrowRight").catch(() => {}); return "channel_unsupported"; }
        await settle(page, 500);
        const idx = await pickPaletteIndex(ctx, hex);
        if (idx >= 0) { await ctx.locator(".se-color-palette").nth(idx).click({ timeout: 2000 }).catch(() => { ok = false; }); ok = true; }
        else {
          await page.keyboard.press("Escape").catch(() => {});
          console.log(`  · 강조 ${useHilite ? "형광펜" : "글자색"} 실패 — 팔레트에서 ${hex} 근처 색을 못 찾았어요.`);
        }
      }
    }
  } catch { /* 아래 해제로 내려간다 */ }

  /* 🔴 선택 해제는 **반드시 키보드로**(AM 9차 · DB 원문 대조로 확정) — DOM Range 로 풀었더니 강조 구절이 통째로 증발했다. */
  await page.keyboard.press("ArrowRight").catch(() => {});
  /* 🔴 **칠한 직후**가 번짐의 출발점이다. 켰든 못 켰든 «건드렸으면» 적는다 —
     못 켰다고 깨끗하다는 보장이 없다(팔레트를 열었다 닫은 것도 캐럿을 건드린다). */
  markFormatDirty(fmt, `${kind} 적용`);
  return ok ? "ok" : "channel_unsupported";
}

async function attachImage(page, ctx, file, missed) {
  const sels = ['button[data-name="image"]', ".se-toolbar-item-image button", 'button[title*="사진"]', 'button:has-text("사진")'];
  for (const sel of sels) {
    try {
      const btn = ctx.locator(sel).first();
      if (!(await btn.isVisible({ timeout: 2000 }).catch(() => false))) continue;
      const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 12_000 }), btn.click()]);
      await chooser.setFiles([file]);
      await settle(page, 3500);
      /* 여러 장일 때 «사진 첨부 방식» 팝업이 뜬다 — ✕ 로 닫으면 **한 장도 안 들어간다**(AM 실사고).
         «개별사진» 은 button 이 아니라 카드/라벨 구조라 getByText 우선 + 클릭 가능한 조상 폴백. */
      const indiv = ctx.getByText("개별사진", { exact: true }).first();
      if (await indiv.isVisible({ timeout: 3000 }).catch(() => false)) {
        await indiv.click({ timeout: 4000 }).catch(async () => {
          await indiv.locator('xpath=ancestor-or-self::*[self::button or @role="button" or self::a][1]').first().click({ timeout: 4000 }).catch(() => {});
        });
        await settle(page, 1200);
      }
      return true;
    } catch { /* 다음 셀렉터 */ }
  }
  missed.image++;
  return false;
}

/**
 * 🔴 moveCaretToEnd — AM 이 실물 대조로 확정한 방어(원본 `naver-blog-runner.mjs` #738·#742 · 이식 2026-09-14).
 *
 *   사진·인용구·구분선 **뒤에는 쓸 자리가 없다**. 그 상태로 그냥 타자를 치면 에디터 캐럿이 문서 끝이 아니라
 *   **직전 글 문단 한복판**에 있어서, 다음 문장이 앞 문단을 두 동강 낸다(AM 실물: 한 문장이 세 조각·
 *   인용구가 맨 뒤로 밀림·본문 1,606자가 인용 안에 갇힘). 조용히 망가지는 종류의 실패라 더 나쁘다.
 *   ⇒ 문서의 **마지막 컴포넌트**가 글이 아니면, 에디터가 주는 «본문 추가»(`se-canvas-bottom-button`)로
 *      끝에 **새 글 칸**을 만든다. 새 칸은 비어 있어 한복판에 끼어들 수가 없다.
 *   ⚠️ «본문 추가»는 hover 영역이라 isVisible 이 false 로 나올 때가 있다 — 안 보이면 끝으로 스크롤 + force.
 */
/** 문서의 `.se-component` 수 — «새 칸이 **정말** 생겼나»를 세는 자(클릭 성공 여부가 아니라 **결과**를 본다). */
const compCount = (ctx) => ctx.evaluate(() => document.querySelectorAll(".se-component").length).catch(() => -1);

/**
 * «본문 추가»를 누른다(세 겹). 🔴 **누르기만 한다** — 생겼는지 판정은 호출자 몫이다.
 *   실측(2026-09-14 `runner/probe-editor.mjs` 덤프):
 *     · `button.se-canvas-bottom-button __edge-area` — **존재하지만 `vis:false`**(hover 영역이라 Playwright 가 숨김으로 본다)
 *     · `div.se-canvas-bottom` — 그 **보이는 부모**(텍스트 «본문 추가»)
 *   종전엔 버튼이 안 보이면 force 클릭만 했는데 그게 자주 빗나가 «본문 추가» 실패가 글당 6건 났다(실측).
 *   ⇒ 보이는 부모를 먼저 누르고, 그다음 버튼 force, 마지막으로 DOM 직접 이벤트까지 세 겹.
 */
async function clickAddTextBlock(page, ctx) {
  const btn = ctx.locator(".se-canvas-bottom-button").first();
  const box = ctx.locator(".se-canvas-bottom").first();
  await ctx.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
  if (await btn.isVisible({ timeout: 800 }).catch(() => false)) await btn.click({ timeout: 4000 }).catch(() => {});
  else if (await box.isVisible({ timeout: 800 }).catch(() => false)) await box.click({ timeout: 4000 }).catch(() => {});
  else await btn.click({ timeout: 3000, force: true }).catch(() => {});
  await settle(page, 500);
}

/** DOM 에서 직접 이벤트를 쏜다 — 마지막 안전벨트(AM `clickEditable` 관례). */
async function dispatchAddTextBlock(ctx) {
  await ctx.evaluate(() => {
    const el = document.querySelector(".se-canvas-bottom-button") || document.querySelector(".se-canvas-bottom");
    if (!el) return false;
    el.scrollIntoView({ block: "end" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
      el.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y }));
    }
    return true;
  }).catch(() => false);
}

/**
 * 🔴 **무조건 새 글 칸을 만들고 캐럿을 거기 둔다**(AM `freshTextBlockForUrl` 과 **같은 뜻**).
 *
 *   ⚠️ **이 함수가 없어서 «번짐 끊기»가 통째로 무력했다**(2026-09-16 C 가 진짜 Chromium 으로 잡았다).
 *      나는 이식 계획서에 「`freshTextBlockForUrl` 은 이미 우리 안에 있다 — `moveCaretToEnd` 가 같은 일을 한다」고
 *      적었는데 **틀렸다**: `moveCaretToEnd` 는 «마지막 컴포넌트가 글이 **아닐 때만**» 새 칸을 만든다.
 *      그런데 서식을 칠한 **직후엔 마지막이 언제나 글**이라 그 분기에 영영 못 들어가고, 남은 경로(문단 클릭 + End)는
 *      **인라인 span 안에 캐럿을 둔다** — 서식이 그대로 이어진다. AM 은 **조건 없이** 누른다. 그 한 줄 차이였다.
 *      ⇒ 실측: 밑줄 마크 뒤 평문 3문단이 **통문단 밑줄** · `--mutate=break` 로 끊기를 빼도 **결과가 같았다**
 *        (= 끊기가 있으나 없으나 같다 = 아무 일도 안 하고 있었다).
 *
 *   🔴 **«눌렀다»가 아니라 «생겼다»로 판정한다.** 종전 `breaks` 는 클릭 성공을 세고 있었고, 그래서
 *      `breaks:4 · breakFails:0` 인데 **새 칸은 0개**였다 — 숫자가 거짓말을 했다(AC-9 의 계수판).
 */
async function freshTextBlock(page, ctx) {
  const before = await compCount(ctx);
  if (before < 0) return false;
  await clickAddTextBlock(page, ctx);
  if ((await compCount(ctx)) <= before) { await dispatchAddTextBlock(ctx); await settle(page, 600); }
  if ((await compCount(ctx)) <= before) return false;   // 🔴 안 생겼으면 실패다(«눌렀으니 됐겠지» 금지)

  /* 칸을 «만드는 것»과 캐럿이 «거기 가는 것»은 다른 일이다(AM #747) — 만든 칸을 실제로 클릭해 데려온다. */
  const fresh = ctx.locator(".se-component.se-text").last().locator(".se-text-paragraph").last();
  const ok = await fresh.click({ timeout: 2500 }).then(() => true).catch(() => false);
  await page.keyboard.press("End").catch(() => {});
  return ok;
}

async function moveCaretToEnd(page, ctx, missed) {
  try {
    const lastIsText = async () => await ctx.evaluate(() => {
      const comps = document.querySelectorAll(".se-component");
      const last = comps[comps.length - 1];
      return !!(last && /(^|\s)se-text(\s|$)/.test((last.className || "").toString()));
    }).catch(() => false);

    if (!(await lastIsText())) {
      await clickAddTextBlock(page, ctx);
      if (!(await lastIsText())) await dispatchAddTextBlock(ctx);
      await settle(page, 600);
      /* 🔴 «본문 추가»가 실패했으면 **여기서 멈춘다**. 아래 폴백(마지막 글 문단 클릭)은 컴포넌트 **앞**의
         문단을 짚어 캐럿을 **문서 한복판**에 꽂는다 — 그러면 다음 문장이 앞 문단 사이에 끼어들어
         글 순서가 뒤바뀐다(2026-09-14 실증: 체크리스트 두 줄이 뒤집혀 나왔다 · AM #742 와 같은 자리).
         못 만들었으면 조용히 중간을 짚느니 아무것도 안 하는 편이 낫다(다음 op 가 이어 쓴다). */
      if (!(await lastIsText())) {
        if (missed) missed.caretEnd++;
        return false;
      }
    }
    /* 마지막 글 문단을 실제로 클릭하고 End 로 줄 끝에 붙인다(에디터는 DOM Range 를 모른다 — 클릭·키보드만 안다).
       🔴 그리고 **써 보고 확인한다**. «클릭했으니 됐겠지»는 거짓 양성이다 — 컴포넌트가 비동기로 자리를 잡는 동안
       클릭이 옛 좌표를 짚으면 캐럿이 문서 한복판에 남고, 다음 문장이 앞 문단 사이에 끼어들어 **글 순서가 뒤바뀐다**.
       2026-09-14 실증에서 같은 원고가 실행마다 체크리스트 순서를 바꿔 내놨다(비결정적 = 경쟁).
       AM 이 인용 탈출에서 얻은 결론과 같다: **관측이 아니라 실행만이 믿을 수 있는 판정이다.** */
    for (let attempt = 0; attempt < 3; attempt++) {
      const para = ctx.locator(".se-component.se-text").last().locator(".se-text-paragraph").last();
      if (!(await para.isVisible({ timeout: 1500 }).catch(() => false))) break;
      await para.click({ timeout: 4000 }).catch(() => {});
      await page.keyboard.press("End").catch(() => {});

      /* 표식은 **보이는 글자**로 쓴다. 제로폭 문자는 키보드 이벤트로 아예 안 들어가는 경우가 있어
         «못 찾음»이 되고, 그걸 실패로 세면 **멀쩡한 캐럿을 실패로 보고한다**(내 첫 구현이 그랬다 —
         6건 실패가 전부 이 거짓 양성이었을 수 있다). 찾을 수 있는 글자를 쓰고 바로 지운다. */
      const MARK = "⁣x";   // invisible separator + x — 눈에 거의 안 띄고 textContent 로는 찾힌다
      await page.keyboard.type(MARK).catch(() => {});
      const at = await ctx.evaluate((mark) => {
        const comps = [...document.querySelectorAll(".se-component")];
        return { idx: comps.findIndex((c) => (c.textContent || "").includes(mark)), total: comps.length };
      }, MARK).catch(() => ({ idx: -1, total: 0 }));
      for (let i = 0; i < MARK.length; i++) await page.keyboard.press("Backspace").catch(() => {});

      if (at.idx === at.total - 1 && at.idx >= 0) return true;    // 진짜로 문서 끝이다
      if (at.idx < 0) return true;                                /* 표식을 못 넣었다 = **판정 불가**.
        실패로 세지 않는다 — «모르겠다»를 «틀렸다»로 적으면 보고서가 거짓말을 한다(AC-9 의 반대편 얼굴).
        캐럿 위치는 앞의 클릭+End 로 최선을 다한 상태다. */
      await settle(page, 500);                                    // 엉뚱한 컴포넌트에 들어갔다 — 한 박자 쉬고 다시
    }
  } catch { /* 못 잡아도 글은 계속 — 다음 op 가 이어 쓴다 */ }
  if (missed) missed.caretEnd++;
  return false;
}

/**
 * 🔴 인용 블록 탈출 — AM 이 **세 번 고치고 세 번 재발한** 자리다(원본 주석 그대로 이식 2026-09-14).
 *   실물 사고: #742 본문 1,606자 · #747 1,760자 · #748 1,970자가 **통째로 인용 안에 갇혔다**(매번 마지막 인용).
 *   AM 이 틀렸던 판정법들: ①`document.getSelection()` ②«마지막 컴포넌트가 인용이 아니면 나온 것»
 *   ③Enter 횟수로 세기 ④«moveCaretToEnd 한 줄이면 된다» — **전부 거짓 양성**이었다.
 *   ⇒ 두 겹 + «써 보고 확인»:
 *     ① 마지막 컴포넌트가 인용이 **아닐 때까지** Enter(최대 4회 · 횟수가 아니라 «나왔는지»로 센다)
 *     ② moveCaretToEnd 로 끝을 잡는다(하나가 실패해도 다른 하나가 받는다)
 *     ③ 🔴 **한 글자 쳐 보고** 그게 인용 안에 들어가는지 본다 — 관측이 아니라 실행이 유일하게 믿을 수 있는 판정이다.
 *        (제로폭 문자라 자국 0 · 바로 Backspace)
 *     ④ 인용의 기본 글자 크기는 **19**라 빠져나와도 커서에 남는다 → 본문 크기로 되돌린다(실물 #747).
 */
async function escapeQuote(page, ctx, missed) {
  const lastIsQuote = async () => await ctx.evaluate(() => {
    const c = document.querySelectorAll(".se-component");
    return /se-quotation/.test((c[c.length - 1]?.className || "").toString());
  }).catch(() => false);

  for (let i = 0; i < 4 && (await lastIsQuote()); i++) await page.keyboard.press("Enter").catch(() => {});
  await moveCaretToEnd(page, ctx, missed);

  // ③ 써 보고 확인 — 이게 유일하게 믿을 수 있는 판정이다.
  await page.keyboard.type("​").catch(() => {});
  const stuck = await ctx.evaluate(() => {
    const c = document.querySelectorAll(".se-component");
    return /se-quotation/.test((c[c.length - 1]?.className || "").toString());
  }).catch(() => false);
  await page.keyboard.press("Backspace").catch(() => {});

  if (stuck) {
    for (let i = 0; i < 3 && (await lastIsQuote()); i++) await page.keyboard.press("Enter").catch(() => {});
    await moveCaretToEnd(page, ctx, missed);
    if (await lastIsQuote()) {
      missed.quoteEscape++;   // 조용히 넘기지 않는다 — 뒤 본문이 인용에 갇힌다
      console.log("  · ⚠️ 인용에서 빠져나오지 못했습니다 — 뒤 본문이 인용에 갇힐 수 있어요.");
    }
  }
  // ④ 인용 기본 크기(19)가 커서에 남는다 — 본문 크기로 되돌린다.
  await setFontSize(page, ctx, BODY_FONT_SIZE).catch(() => {});
}

/**
 * 🔴 발행 직전 서식 스윕(AM `sweepFormatting` 의 AC 판 · 이식 2026-09-14).
 *   계획(ops)이 약속한 모양과 **실물 DOM** 을 대조한다. AM 교훈대로 **자르거나 다시 쓰지 않는다** —
 *   ①소제목 크기만 되살리고(그 자리만) ②나머지 어긋남은 **숫자로 보고**한다.
 *   왜 «고치지 않고 보고»가 기본인가: AM 이 이 층에서 사고를 냈다(좋은 코드 두 개가 연쇄로 50자 H1 을 25자로 줄였다).
 *   검증 안 된 자동 수리는 멀쩡한 글을 건드린다 — 우리는 **본 것을 말하는 것**부터 한다.
 */
async function sweepFormatting(page, ctx, plan, missed) {
  const want = plan.ops.filter((o) => o.op === "heading").map((o) => String(o.text).trim());
  if (!want.length) return { checked: 0, headingWrong: 0, repaired: 0 };

  const rows = await ctx.evaluate(() => {
    const out = [];
    document.querySelectorAll(".se-component.se-text .se-text-paragraph").forEach((p) => {
      const span = p.querySelector("span") || p;
      out.push({
        text: (p.textContent || "").replace(/\s+/g, " ").trim(),
        size: parseInt(String(getComputedStyle(span).fontSize || "0"), 10) || 0,
        bold: ["700", "bold", "600"].includes(String(getComputedStyle(span).fontWeight)),
      });
    });
    return out;
  }).catch(() => []);
  if (!rows.length) return { checked: 0, headingWrong: 0, repaired: 0 };

  const headSize = Number(HEADING_FONT_SIZE) || 19;
  const bodySize = Number(BODY_FONT_SIZE) || 15;
  let headingWrong = 0, repaired = 0, bodyTooBig = 0;

  for (const row of rows) {
    const isHeading = want.some((h) => h && row.text === h);
    if (isHeading && row.size < headSize) {
      headingWrong++;
      /* 그 소제목만 다시 잡아 크기를 준다 — 문단을 끝에서부터 되짚는 게 아니라 **그 문단을 직접 클릭**하고
         Home→Shift+End 로 그 줄만 잡는다(다른 줄에 번지지 않게). 실패해도 글은 그대로 나간다. */
      try {
        const para = ctx.locator(".se-component.se-text .se-text-paragraph", { hasText: row.text }).first();
        if (await para.isVisible({ timeout: 1200 }).catch(() => false)) {
          await para.click({ timeout: 3000 });
          await page.keyboard.press("Home").catch(() => {});
          await page.keyboard.press("Shift+End").catch(() => {});
          if (await setFontSize(page, ctx, HEADING_FONT_SIZE)) repaired++;
          await page.keyboard.press("ArrowRight").catch(() => {});
          await setFontSize(page, ctx, BODY_FONT_SIZE).catch(() => {});   // 켠 것은 끈다
        }
      } catch { /* 못 고쳐도 보고에는 남는다 */ }
    }
    // 🔴 본문이 소제목 크기로 번진 자리(AM 실물 #747 — 지면의 19px 가 54곳이었다)
    if (!isHeading && row.text && row.size > bodySize) bodyTooBig++;
  }

  if (bodyTooBig) missed.bodyTooBig = (missed.bodyTooBig ?? 0) + bodyTooBig;
  return { checked: rows.length, headingWrong, repaired };
}

/**
 * @param fmt  `createFormatState()` 한 벌(안 주면 안에서 만든다). 🔴 **하니스가 잡마다 새 상태로** 돌릴 수 있게 열어 둔다.
 * @param applied  실제로 «누른» 마크 수를 담는 그릇(계획의 `planned`·`kept` 와 짝 — 계획에 있는 것과 실제로 낸 것은 다르다).
 */
export async function playOps(page, ctx, plan, files, shotKey, missed, fmt = createFormatState(), applied = null) {
  let wrote = false;
  const seq = createMarkSeq();
  const acc = applied ?? { value: 0, line: 0, row: 0, bold: 0, underline: 0 };
  /* 🔴 **경계용 `fresh` 는 `moveCaretToEnd` 가 아니다**(2026-09-16 C 실측으로 고쳤다).
     `moveCaretToEnd` 는 «마지막이 글이 **아닐 때만**» 새 칸을 만든다 — 서식을 칠한 직후엔 마지막이 **언제나 글**이라
     그 분기에 영영 못 들어가고, 남은 경로(문단 클릭+End)는 **인라인 span 안에 캐럿을 둬 서식을 그대로 잇는다.**
     ⇒ 끊기는 **무조건 새 칸을 만드는** 함수여야 한다. 두 함수는 이름이 비슷할 뿐 **다른 일**이다. */
  const fresh = () => freshTextBlock(page, ctx);

  /* 🔴 **문단 경계의 규칙**(AM 이 URL 전용 방어를 «한 곳의 규칙»으로 올린 그 자리).
     앞 문단이 색·굵게·밑줄·인용을 남겼으면 **새 글 칸**에서 시작한다 — 새 칸은 서식을 안 물려받는다(실측 성질).
     깨끗하면 아무 일도 안 한다(왕복 0 · 무회귀). 🔴 **이 한 줄이 «어느 지점부터 끝까지»를 문단 하나에 가둔다.** */
  const boundary = () => breakFormatBeforePara(fmt, fresh);

  /* 🔴 **끊기가 새 칸을 만들었으면 Enter 를 또 치지 않는다** — 새 칸이 곧 새 줄이다.
     둘 다 하면 마크가 있는 글마다 **빈 줄이 하나씩 쌓인다**(AM 은 이걸 감수했지만 우리는 «생겼나»를 값으로 알고 있으니 안 해도 된다). */
  const type = async (text) => {
    const broke = await boundary();
    if (wrote && !broke) await page.keyboard.press("Enter").catch(() => {});
    await page.keyboard.insertText(String(text));
    wrote = true;
  };

  /** 조각들을 **치면서 바로** 칠한다(되돌아가지 않는다 — AM 8차 확정: 「다 쓰고 나중에 칠하기」는 실물이 무너졌다). */
  /** 조각 하나를 못 냈다고 적는다 — 🔴 조용히 안 버린다(AC-9 · A 가 사람말 칩으로 그린다). */
  const noteMarkFail = (kind, why, sample) => {
    missed.markFail = missed.markFail ?? [];
    if (missed.markFail.length < 40) missed.markFail.push({ kind, why, sample: String(sample).slice(0, 24) });
  };

  /**
   * 🔴 **문단을 먼저 전부 평문으로 치고, 그다음 되짚어 칠한다**(2026-09-16 C 실측으로 뒤집었다).
   *
   *   ══ 왜 바꿨나 — «조각 경계»는 아무도 안 끊고 있었다 ══
   *     종전엔 «치고 바로 칠하기»였다. 그러면 칠한 뒤 `ArrowRight` 로 푼 **캐럿이 서식 span 안**에 남고,
   *     이어서 다음 조각을 치면 그 조각이 **서식을 물려받는다.** C 가 진짜 Chromium 으로 잡은 실물:
   *       계획 «밑줄 한 토막»(5자) → 실물 **21자**(문단 끝까지 밑줄) · 계획 «12,400원» → «12,400원 입니다.»
   *     문단 **경계**는 `freshTextBlock` 이 끊지만 조각 **경계**는 끊는 사람이 없었다.
   *     🔴 그리고 이건 «통문단»이 아니라 «부분»이라 `measureFormatBleedIn` 도 **못 본다** — 자가검사가 통과시킨다.
   *
   *   ══ ⚠️ AM 은 이 길에서 한 번 실패했다 — 그래서 무엇이 다른지 적어 둔다 ══
   *     AM 주석: 「문단을 다 쓰고 나중에 칠하기」는 실물이 무너졌다(노란 도배·문단 두 동강) —
   *     **에디터가 컴포넌트를 만들며 문단 구조를 바꾸면 «끝에서 N번째» 좌표가 통째로 어긋난다.**
   *     그 컴포넌트는 **주소가 만드는 링크카드**였다. 우리는 다르다:
   *       ① 🔴 **주소가 든 문단은 계획층이 강조를 통째로 걷는다**(`url_para`) — 마크가 있는 문단엔 URL 이 **없다**.
   *          ⇒ 칠하는 동안 비동기로 생길 컴포넌트가 없다(AM 이 무너진 그 조건이 성립하지 않는다).
   *       ② 🔴 칠하기 **전에 문단 글자를 통째로 대조**한다 — 어긋나면 **한 조각도 안 칠하고 물러난다.**
   *          AM 에는 이 대조가 없었다(`colorLastTyped` 의 꼬리 확인은 그 사고 **뒤에** 생겼다).
   *       ③ 좌표는 **문단 끝에서 왼쪽으로만** 간다(`End` 를 안 쓴다 — 문단이 줄바꿈되면 `End` 는 **줄 끝**이라 틀린다).
   *     그래도 남는 위험은 있다 ⇒ 어긋나면 **안 칠하고 `caret_drift` 로 적는다.** 안 칠한 강조는 아쉬울 뿐이지만
   *     잘못 칠한 강조는 글을 망가뜨린다(AM #736 의 결론 그대로).
   */
  const typeParts = async (op, prefix = "") => {
    const parts = (Array.isArray(op.parts) && op.parts.length ? op.parts : [{ t: String(op.text ?? ""), mark: null }])
      .filter((p) => p.t);
    const broke = await boundary();
    if (wrote && !broke) await page.keyboard.press("Enter").catch(() => {});

    /* ① 전부 평문으로 — 이 순간 문단 안에 **서식 span 이 하나도 없다**(물려받을 것이 없다).
       🔴 [R12-5] `prefix`(목록 «• » · 체크 «☑ »)는 **조각이 아니다** — 우리가 붙이는 글머리라 마크가 안 걸린다.
          그런데 **글자 수는 차지한다** ⇒ 아래 좌표를 그만큼 민다. 안 밀면 강조가 **한 낱말씩 왼쪽으로 어긋난다**. */
    const joined = String(prefix) + parts.map((p) => p.t).join("");
    await page.keyboard.insertText(joined);
    wrote = true;
    await settle(page, 300, 600);

    /* 조각마다 문단 안 위치 [s, e) — 칠하기는 글자 수를 **안 바꾸므로** 이 좌표는 끝까지 유효하다. */
    let at = String(prefix).length;
    const spans = parts.map((p) => { const s = at; at += p.t.length; return { p, s, e: at }; }).filter((x) => x.p.mark);
    if (!spans.length) return;

    /* ② 🔴 칠하기 전에 **문단 글자를 통째로 대조**한다(AM 에 없던 문). 어긋나면 한 조각도 안 칠한다. */
    if (!(await tailMatches(ctx, joined.slice(-60)))) {
      for (const x of spans) noteMarkFail(x.p.mark, "caret_drift", x.p.t);
      return;
    }

    /* ③ 오른쪽 조각부터 되짚어 칠한다 — 캐럿은 문단 끝에 있고 **왼쪽으로만** 간다. */
    let fromEnd = 0;                                   // 문단 끝에서 캐럿까지 몇 글자인가
    for (const x of [...spans].sort((a, b) => b.e - a.e)) {
      const stepLeft = (joined.length - x.e) - fromEnd;
      for (let i = 0; i < stepLeft; i++) await page.keyboard.press("ArrowLeft").catch(() => {});
      /* `expect` 를 안 넘긴다 — 꼬리 대조는 위에서 문단 전체로 이미 했다(가운데를 칠할 땐 꼬리가 기댓값과 다르다). */
      const r = await applyMark(page, ctx, x.e - x.s, "", x.p.mark, seq, fmt);
      if (r === "ok") acc[x.p.mark] = (acc[x.p.mark] ?? 0) + 1;
      else noteMarkFail(x.p.mark, r, x.p.t);
      /* 칠한 뒤 `ArrowRight` 로 풀면 캐럿은 그 조각의 **끝**에 있다. */
      fromEnd = joined.length - x.e;
      await settle(page, 400, 900);                    // 팔레트가 닫히고 커서 서식이 확정된 뒤에 다음 조각으로
    }
  };

  for (const op of plan.ops) {
    switch (op.op) {
      case "para":
        if (Array.isArray(op.parts) && op.parts.some((p) => p.mark)) await typeParts(op);
        else await type(op.text);
        await settle(page, 250, 600);
        break;
      case "note": break;   // 사람이 읽는 메모 — 본문에 넣지 않는다(보고에만 실린다)
      case "heading": {
        /* 🔴 소제목 = «굵게 + 글자 크기»다(AM 정본). 스마트에디터 ONE 에는 h2 버튼이 없다 —
           내가 추측으로 쓴 `data-name="header2"` 는 존재하지 않아 **소제목이 본문과 똑같이 나갔다**
           (2026-09-14 실증 스냅샷에서 «결론부터»가 평문이었다). 크기는 **반드시 되돌린다**(sizeLastTyped). */
        const brokeH = await boundary();     // 🔴 소제목도 문단이다 — 앞 문단의 색을 물려받으면 소제목이 빨개진다
        if (wrote && !brokeH) await page.keyboard.press("Enter").catch(() => {});
        const text = String(op.text);
        await page.keyboard.press("Control+b").catch(() => {});
        await page.keyboard.type(text, { delay: 6 }).catch(async () => { await page.keyboard.insertText(text); });
        /* 🔴 [2026-09-20 · AM `writeParts` 에서 배웠다] **굵게 «해제» 실패를 삼키지 않는다.**
           여긴 선택이 아니라 **캐럿 토글**이라 해제가 안 되면 **다음 문단이 통째로 굵어진다.**
           그런데 `breakFormatBeforePara` 는 🔴 **`dirty` 가 아니면 아무것도 안 한다** — 즉 조용히 넘기면
           끊기도 안 걸려 번짐이 그대로 나간다(우리 `applyMark` 의 마크들은 선택 기반이라 이 자리만 그렇다).
           🔴 **다시 토글하지 않는다**(AM 의 판단 그대로) — 켜졌는지 **읽을 수 없으니** 재시도가 «반대로 켜기»가 된다.
              대신 «더럽다»고 적어 **다음 문단을 새 칸에서** 시작하게 한다. */
        await page.keyboard.press("Control+b").catch(() => { markFormatDirty(fmt, "소제목 굵게 해제 실패"); });
        const sized = await sizeLastTyped(page, ctx, text.length);
        if (!sized) missed.heading++;     // 굵게로는 남는다 — 조용히 넘기지 않고 센다
        await page.keyboard.press("Enter").catch(() => {});
        wrote = true;
        await settle(page, 400, 900);
        break;
      }
      case "quote": {
        const brokeQ = await boundary();
        if (wrote && !brokeQ) await page.keyboard.press("Enter").catch(() => {});
        const opened = await clickToolbarItem(ctx, "quotation");
        if (!opened) {
          missed.quote++;
          await page.keyboard.insertText(`“${op.text}”`);   // 인용 컴포넌트를 못 열면 인용부호로라도 세운다
          await page.keyboard.press("Enter").catch(() => {});
        } else {
          await page.keyboard.type(String(op.text), { delay: 6 }).catch(async () => { await page.keyboard.insertText(String(op.text)); });
          /* 🔴 인용은 **그 자체가 색·가운데·기울임**이다 — 빠져나와도 캐럿에 남는다(사장님이 보신 «가운데·기울임 번짐»).
             AM 이 이 자리에 `markFormatDirty("인용구(색·정렬·기울임)")` 를 박아 뒀고, 그게 변이 m3 의 축이다. */
          markFormatDirty(fmt, "인용구(색·정렬·기울임)");
          await settle(page, 500, 1200);
          await escapeQuote(page, ctx, missed);
        }
        wrote = true;
        await shot(page, shotKey, op.role === "disclosure" ? "02-고지" : "인용구");
        await settle(page, 900);
        break;
      }
      case "divider": {
        if (wrote) await page.keyboard.press("Enter").catch(() => {});
        if (await clickToolbarItem(ctx, "horizontalLine")) {
          // AM 관례 — 구분선 뒤는 End+Enter 로 새 줄을 연다(컴포넌트 뒤에 캐럿이 붙어 있지 않게).
          await page.keyboard.press("End").catch(() => {});
          await page.keyboard.press("Enter").catch(() => {});
        } else {
          missed.divider++;
          await page.keyboard.press("Enter").catch(() => {});   // 폴백은 빈 줄로 숨을 준다(문단이 붙는 것보다 낫다)
        }
        wrote = true;
        await settle(page, 800);
        await moveCaretToEnd(page, ctx, missed);   // 🔴 구분선도 컴포넌트
        break;
      }
      /* 🔴 [R12-5] 목록 항목·표 칸 **안**의 꾸밈. R9 는 문단까지였다.
         🔴 **번짐이 여기서 다시 난다** — 항목 하나에 칠하면 다음 항목까지 따라간다(«어느 지점부터 끝까지 빨강»의 목록판).
         ⇒ 항목마다 `typeParts` 를 탄다. 그 안에 R9 의 세 겹이 다 있다:
            ① `boundary()` 로 **항목 경계에서 끊고** ② 칠하기 전 **꼬리를 대조**하고 ③ **오른쪽부터 되짚어** 칠한다.
         마크가 없는 항목은 **종전 `type()` 그대로**다(무회귀 — 왕복이 안 늘어난다). */
      case "list":
        if (Array.isArray(op.parts) && op.parts.some((p) => p.mark)) await typeParts(op, "• ");
        else await type(`• ${op.text}`);
        await settle(page, 200, 500); break;
      case "check":
        if (Array.isArray(op.parts) && op.parts.some((p) => p.mark)) await typeParts(op, "☑ ");
        else await type(`☑ ${op.text}`);
        await settle(page, 200, 500); break;
      case "faq":
        if (Array.isArray(op.parts) && op.parts.some((p) => p.mark)) await typeParts(op, "");
        else await type(op.text);
        await settle(page, 200, 500); break;
      case "link": await type(`${op.text} ${op.url}`); await settle(page, 300, 700); break;
      case "image": {
        const file = files.get(op.url);
        if (!file) { missed.imageDownload++; break; }   // 내려받기 실패분 — 글은 계속
        if (wrote) await page.keyboard.press("Enter").catch(() => {});
        const countImgs = async () => await ctx.locator(".se-component.se-image").count().catch(() => 0);
        const before = await countImgs();
        await attachImage(page, ctx, file, missed);
        /* 🔴 사진이 «자리 잡을 때까지» 기다린다 — 비동기 삽입이 쓰던 문단을 밀어내 글을 한복판에서 가른다(AM #737). */
        const deadline = Date.now() + 8000;
        let last = before, stable = 0, grew = false;
        while (Date.now() < deadline) {
          await settle(page, 350);
          const now = await countImgs();
          if (now !== last) { last = now; stable = 0; if (now > before) grew = true; continue; }
          if (grew && ++stable >= 3) break;
        }
        if (!grew) missed.imageSettle++;
        await settle(page, 800);
        await moveCaretToEnd(page, ctx, missed);   // 🔴 사진이 완전히 앉은 뒤 끝으로(AM #737·#742)
        if (op.caption) { await page.keyboard.insertText(String(op.caption)); }
        wrote = true;
        await settle(page, 1000);
        break;
      }
      case "tags": {
        /* 태그 줄은 **글의 맨 끝**에. 링크카드(se-oglink)가 비동기로 생기면 캐럿이 중간에 남는다(AM #723) —
           카드가 «더 이상 안 생긴다»를 확인한 뒤 끝을 다시 잡는다(최대 6초 · 안 생겨도 진행). */
        const cardCount = async () => await ctx.locator(".se-component.se-oglink, .se-oglink").count().catch(() => 0);
        const deadline = Date.now() + 6000;
        let last = await cardCount(), stable = 0;
        while (Date.now() < deadline) {
          await settle(page, 400);
          const now = await cardCount();
          if (now !== last) { last = now; stable = 0; continue; }
          if (++stable >= 4) break;
        }
        await moveCaretToEnd(page, ctx, missed);
        /* 🔴 **태그 줄도 문단이다**(2026-09-16 · 끊기 사고를 고치다 같은 병을 여기서 하나 더 찾았다).
           종전엔 여기만 `boundary()` 를 안 지났다 — 앞 문단이 색·밑줄을 남겼으면 **해시태그 줄이 통째로 물든다.**
           🔴 그리고 태그는 **글의 마지막 줄**이라 뒤에 아무 문단도 없다 = **아무도 대신 끊어 주지 않는다.**
           `moveCaretToEnd` 는 여기서 새 칸을 안 만든다(마지막이 글이라 조건에 안 걸린다) — 그게 이 병의 같은 뿌리다. */
        const brokeTags = await boundary();
        if (wrote && !brokeTags) await page.keyboard.press("Enter").catch(() => {});
        await page.keyboard.insertText(String(op.text));
        wrote = true;
        await settle(page, 300);
        break;
      }
      default: if (op.text) await type(op.text);
    }
  }
  await shot(page, shotKey, "03-본문완성", true);
  /* 🔴 «썼나»만 돌려주면 서식을 **실제로 냈는지**를 아무도 못 본다 — 계획(planned/kept)과 실물(applied)은 다르다.
     `fmt` 도 같이 돌린다: 끊기가 몇 번 돌았나(`breaks`)·몇 번 실패했나(`breakFails`)가 곧 번짐의 크기다. */
  return { wrote, applied: acc, fmt };
}

/** 발행 레이어의 태그란. 실패해도 발행은 계속(본문 끝 해시태그로 이중 포착). */
async function fillTags(page, tags) {
  const list = (tags ?? []).map((t) => String(t).replace(/^#+/, "").trim()).filter(Boolean).slice(0, 10);
  if (!list.length) return 0;
  for (const sel of ["#tag-input", 'input[placeholder*="태그"]', 'input[id*="tag"]', '[class*="tag_input"] input', '[class*="tag"] input[type="text"]']) {
    try {
      const box = page.locator(sel).first();
      if (!(await box.isVisible({ timeout: 1500 }).catch(() => false))) continue;
      await box.click({ timeout: 3000 });
      for (const t of list) { await page.keyboard.type(t, { delay: 12 }); await page.keyboard.press("Enter"); await settle(page, 150); }
      return list.length;
    } catch { /* 다음 */ }
  }
  return 0;
}

/* ───────────────────── 발행 / 임시저장 ───────────────────── */

const postMatch = (u) => {
  const mp = String(u).match(/blog\.naver\.com\/([^/?]+)\/(\d+)/);
  if (mp) return { blogId: mp[1], logNo: mp[2] };
  const mq = String(u).match(/[?&]logNo=(\d+)/);
  if (mq) { const mb = String(u).match(/[?&]blogId=([^&]+)/); return { blogId: mb ? mb[1] : null, logNo: mq[1] }; }
  return null;
};

/** 🔴 dryRun 경로 — 임시저장까지만. «올라갔다»고 말하지 않는다. */
async function saveDraft(page, ctx, shotKey) {
  for (const sel of ['button:has-text("저장")', '.save_btn__bzc5B', 'button[class*="save"]', '[data-testid*="save"]']) {
    try {
      const b = ctx.locator(sel).first();
      if (!(await b.isVisible({ timeout: 2000 }).catch(() => false))) continue;
      await b.click({ timeout: 5000 });
      await settle(page, 2500);
      await shot(page, shotKey, "90-임시저장");
      return true;
    } catch { /* 다음 */ }
  }
  throw BLOCK("selector_changed", "임시저장 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
}

async function publishNow(page, ctx, tags, blogId, shotKey, title, categoryHint) {
  // 1차 발행(우상단) → 발행 설정 레이어
  let opened = false;
  for (const sel of ['button:has-text("발행")', '[data-testid="publishBtn"]', 'button[class*="publish"]']) {
    try {
      const b = ctx.locator(sel).first();
      if (await b.isVisible({ timeout: 2500 }).catch(() => false)) { await b.click({ timeout: 6000 }); opened = true; break; }
    } catch { /* 다음 */ }
  }
  if (!opened) throw BLOCK("selector_changed", "발행 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
  await settle(page, 1200);
  await shot(page, shotKey, "91-발행레이어");

  /* 🔴 게시판(카테고리) 선택 — AM 이 8차 진단으로 확정한 자리(원본 `naver-blog-runner.mjs` · 이식 2026-09-14).
     네이버는 게시판이 안 골라져 있으면 발행을 받지 않는다. 항목의 클릭 타깃은 내부 `a` 가 아니라 **`li` 자체**다.
     ⚠️ isVisible 로 거르지 않는다 — 작은 화면에서 항목이 뷰포트 밖이면 전부 탈락해 «게시판 없음»이 된다(AM 실사고).
        존재+텍스트로 후보를 잡고, 클릭할 때 scrollIntoView 로 올린다.
     고를 때: 지정 카테고리(payload.options.category) > 제목 낱말이 겹치는 게시판 > 첫 실게시판. */
  try {
    const items = await page.locator('li[class*="item__"]').all();
    const hint = String(categoryHint ?? "").trim();
    const toks = new Set(String(title ?? "").replace(/[()[\]·,!?]/g, " ").split(/\s+/).filter((w) => w.length >= 2));
    let best = null, bestScore = -1;
    const seen = [];
    for (const it of items) {
      const txt = (((await it.textContent().catch(() => "")) || "").replace(/하위 카테고리/g, "").replace(/카테고리 (열기|닫기)/g, "").trim());
      if (!txt || txt === "게시판" || txt === "전체 글감") continue;
      seen.push(txt.slice(0, 16));
      let score = 0;
      if (hint && txt.includes(hint)) score += 100;
      for (const t of toks) if (txt.includes(t)) score += 2;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    if (best) {
      await best.scrollIntoViewIfNeeded().catch(() => {});
      await settle(page, 300);
      await best.click({ timeout: 4000 }).catch(async () => {
        await best.click({ timeout: 4000, force: true }).catch(async () => {
          await best.locator("a, span, label, div").first().click({ timeout: 3000, force: true }).catch(() => {});
        });
      });
      await settle(page, 800);
    } else if (items.length) {
      // 조용히 넘기지 않는다 — 게시판이 없으면 발행이 거절된다(사람이 블로그에 게시판을 하나 만들어야 한다).
      console.log(`  · 게시판 후보를 찾지 못했어요(후보=${JSON.stringify(seen).slice(0, 80)})`);
    }
  } catch { /* 게시판 처리 실패는 발행을 막지 않는다 — 확정 단계에서 네이버가 말해 준다 */ }

  await fillTags(page, tags).catch(() => 0);
  // 사람이 설정을 훑는 정도의 지연(기계적 즉시 확정 패턴 회피).
  await settle(page, 900, 2300);

  const preLogNos = new Set(page.context().pages().map((p) => (postMatch(p.url()) || {}).logNo).filter(Boolean));

  let confirmed = false;
  for (const sel of [
    '[data-testid="seOnePublishBtn"]',
    '.se-popup-dim button:has-text("발행"), .se-popup button:has-text("발행")',
    '.layer_btn_area button:has-text("발행")',
    'button[class*="confirm"]:has-text("발행")',
  ]) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 2500 }).catch(() => false)) { await b.click({ timeout: 8000 }); confirmed = true; break; }
    } catch { /* 다음 */ }
  }
  if (!confirmed) throw BLOCK("selector_changed", "확정 발행 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");

  /* 발행 후 글은 (a)이 탭이 이동하거나 (b)새 탭이 열린다 — 컨텍스트의 **모든 탭**에서
     «발행 전엔 없던» logNo 를 찾는다. page.url() 만 보면 새 탭 케이스를 실패로 오보고하고,
     재시도가 중복 글을 만든다(AM 실사고). */
  let found = null;
  for (let waited = 0; waited < 45_000 && !found; waited += 600) {
    for (const p of page.context().pages()) {
      const pm = postMatch(p.url());
      if (pm?.logNo && !preLogNos.has(pm.logNo)) { found = pm; break; }
    }
    if (found) break;
    if ((await page.locator("text=페이지를 찾을 수 없습니다").count().catch(() => 0)) > 0) {
      throw BLOCK("network", "네이버가 발행 처리 중 오류 페이지를 돌려줬어요(해외 IP 차단이 의심돼요).");
    }
    if ((await page.locator("text=이용이 제한, text=제재").count().catch(() => 0)) > 0) {
      throw BLOCK("suspended", "이 계정은 네이버에서 이용이 제한된 상태예요.");
    }
    await settle(page, 600);
  }
  await shot(page, shotKey, "92-발행후");
  if (!found) throw BLOCK("unknown", `발행 후 글 주소를 회수하지 못했어요(탭 ${page.context().pages().length}개 · 현재 ${page.url().slice(0, 70)}).`);
  const realBlogId = found.blogId || blogId;
  return { externalUrl: `https://blog.naver.com/${realBlogId}/${found.logNo}`, channelRef: `naverblog:${found.logNo}` };
}

/* ───────────────────── 진입점 ───────────────────── */

/**
 * run — 잡 1건. ctx 는 호출자가 연 **이 잡 전용** 컨텍스트다(AC-3).
 * @returns { externalUrl, channelRef, notes } · dryRun 이면 { dryRun:true, notes }
 */
export async function run({ ctx, job, plan, shotKey, dryRun, recipe }) {
  /* [P1R8 §3.3] 서버 표가 있으면 그 칸만 덮는다(나머지는 묶여 온 값 그대로). */
  S = { ...BUNDLED_SELECTORS };
  if (recipe) for (const k of Object.keys(BUNDLED_SELECTORS)) { const v = recipe.sel(k); if (v && v !== BUNDLED_SELECTORS[k]) S[k] = v; }
  const account = job.account ?? {};
  const blogId = String(account.handle ?? "").replace(/^@/, "").trim();
  if (!blogId) throw BLOCK("login_fail", "블로그 아이디(핸들)가 없어요. 계정을 다시 연결해 주세요.");

  const page = ctx.pages()[0] ?? await ctx.newPage();
  const missed = { quote: 0, divider: 0, heading: 0, quoteEscape: 0, caretEnd: 0, image: 0, imageDownload: 0, imageSettle: 0 };
  /* 🔴 실패 스냅샷은 **모든 단계**를 덮는다. 종전에는 본문 단계부터만 감쌌는데, 실제로 가장 흔한 실패는
     그 앞(로그인·에디터 진입)에서 난다 — 2026-09-14 로컬 왕복에서 FAIL.png 가 안 남아 그 사실이 드러났다.
     «무엇에 막혔나»는 화면을 봐야 안다(AM 눈검사 규율). */
  let files = null;
  try {
    // ① 로그인 — 쿠키가 살아 있으면 건너뛴다(공용 lib/auth-naver.mjs).
    await ensureNaverLogin(page, account);
    await shot(page, shotKey, "00-로그인확인");

    // ② 에디터
    const ed = await openEditor(page, blogId, shotKey);

    // ③ 제목
    if (!(await clickEditable(ed, S.title))) throw BLOCK("selector_changed", "제목 칸을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
    await page.keyboard.insertText(String(job.payload?.title ?? ""));
    await settle(page, 600);

    // ④ 본문
    if (!(await clickEditable(ed, S.body))) throw BLOCK("selector_changed", "본문 칸을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
    files = await downloadImages(plan.ops.filter((o) => o.op === "image").map((o) => o.url));
    const fmt = createFormatState();
    const played = await playOps(page, ed, plan, files, shotKey, missed, fmt);
    if (!played.wrote) throw BLOCK("selector_changed", "본문에 한 글자도 넣지 못했어요.");

    /* 🔴 발행 직전 서식 스윕 — 계획과 실물을 대조한다(실패해도 발행은 계속). */
    const sweep = await sweepFormatting(page, ed, plan, missed).catch(() => ({ checked: 0, headingWrong: 0, repaired: 0 }));
    await shot(page, shotKey, "04-스윕후", true);

    // ⑤ 발행 또는 임시저장
    const notes = [];
    if (missed.quote) notes.push(`인용구 ${missed.quote}건 폴백`);
    if (missed.divider) notes.push(`구분선 ${missed.divider}건 폴백`);
    if (missed.heading) notes.push(`소제목 ${missed.heading}건 크기 미적용(굵게만)`);
    if (missed.quoteEscape) notes.push(`🔴 인용 탈출 실패 ${missed.quoteEscape}건 — 뒤 본문이 인용에 갇혔을 수 있어요`);
    if (missed.caretEnd) notes.push(`🔴 «본문 추가» 실패 ${missed.caretEnd}건 — 컴포넌트 뒤 글 순서가 어긋났을 수 있어요`);
    if (missed.bodyTooBig) notes.push(`🔴 본문 ${missed.bodyTooBig}줄이 소제목 크기로 번졌어요`);
    if (sweep.checked) notes.push(`서식 스윕: 문단 ${sweep.checked}개 · 소제목 크기 어긋남 ${sweep.headingWrong}건(되살림 ${sweep.repaired}건)`);
    if (missed.image) notes.push(`사진 버튼 ${missed.image}건 미발견`);
    if (missed.imageDownload) notes.push(`사진 ${missed.imageDownload}장 내려받기 실패`);
    if (missed.imageSettle) notes.push(`사진 ${missed.imageSettle}건 자리 확인 실패`);
    if (fmt.breakFails) notes.push(`🔴 서식 끊기 ${fmt.breakFails}건 실패 — 그 뒤 문단이 앞 서식을 물려받았을 수 있어요`);
    notes.push(...(plan.stats.notes ?? []));

    /* [R9-2/5] 🔴 서식 재료를 보고에 싣는다 — 서버(B)가 `meta.formatUnused` 로 옮겨 적고 화면(A)이 사람말 칩으로 그린다.
       계획이 **내려던 것**(planned) · 상한을 넘긴 뒤 **남은 것**(kept) · 실제로 **누른 것**(applied) 셋이 다 다르다.
       ⚠️ 셋을 한 숫자로 뭉치면 «상한 때문»인지 «에디터가 안 받아서»인지 못 가린다 — 다음 수리가 추측에서 시작한다. */
    const formatMarks = {
      planned: plan.stats.marks?.planned ?? null,
      kept: plan.stats.marks?.kept ?? null,
      applied: played.applied,
      demoted: [...(plan.stats.demoted ?? []), ...(missed.markFail ?? [])],
      breaks: fmt.breaks,
      breakFails: fmt.breakFails,
    };

    /* ═══ 🔴 발행 직전 자기검사 — 이 라운드에서 가장 중요한 문 ═══
       ⚠️ **이건 CLAUDE §9 가 말하는 게이트가 아니다**(계약서 §4-1). «고객 글에 대한 우리 판단»이 아니라
          **«우리 러너가 방금 망쳤다»**는 작업 품질 검사다 — 고객이 쓴 글이 아니라 *우리가 누른 버튼*을 잰다.
          글 전체가 빨강·가운데·기울임으로 물든 것은 «고객의 선택»이 아니라 **우리 도구의 고장**이고,
          그대로 나가면 사장님이 **발행물로** 알게 된다(실제로 그랬다). 조용히 나가느니 멈추는 게 낫다.
       🔴 임시저장(dryRun)도 잰다 — 카나리가 «멀쩡하다»고 말한 뒤 본 발행에서 터지면 카나리가 무슨 소용인가. */
    const bleed = await measureFormatBleed(ed, { headingSize: Number(HEADING_FONT_SIZE) || 19, bodySize: Number(BODY_FONT_SIZE) || 15 });
    const verdict = bleedVerdict(bleed);
    notes.push(verdict.line);
    if (bleed) formatMarks.bleed = bleed;
    if (verdict.stop) {
      await shot(page, shotKey, "05-서식번짐-발행중단", true).catch(() => {});
      console.error(`  · 🔴 ${verdict.reason}`);
      throw BLOCK("format_bleed", verdict.reason);
    }

    if (dryRun) { await saveDraft(page, ed, shotKey); return { dryRun: true, notes, formatMarks }; }
    const out = await publishNow(page, ed, plan.tags, blogId, shotKey, job.payload?.title, job.payload?.options?.category);
    return { ...out, notes, formatMarks };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  } finally {
    if (files) cleanupFiles(files);
  }
}

export const channel = "naver_blog";
