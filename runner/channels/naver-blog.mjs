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

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

const TITLE_SEL = ".se-section-documentTitle .se-text-paragraph, .se-documentTitle .se-text-paragraph, .se-placeholder.__se_placeholder, .se-section-documentTitle";
const EDITOR_SEL = ".se-content, .se-container, .se-components-wrap";
const BODY_SEL = ".se-component.se-text .se-text-paragraph";

/* ───────────────────── 로그인 ───────────────────── */

async function isLoggedIn(page) {
  try {
    await page.goto("https://blog.naver.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (/nidlogin/i.test(page.url())) return false;
    return (await page.locator('a[href*="logout"], .gnb_my, [class*="MyArea"]').count().catch(() => 0)) > 0
      || !/nidlogin/i.test(page.url());
  } catch { return false; }
}

/** id/pw 자동 로그인. 캡차·기기등록·2단계는 **정직 실패**(사람이 해야 풀린다). */
async function loginWithIdPw(page, id, pw) {
  await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  // domcontentloaded 직후 바로 입력하면 폼 JS 초기화 전이라 값이 유실된다(AM 실측) — 보일 때까지 기다린다.
  await page.locator("#id").waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  await settle(page, 500);
  await page.fill("#id", id).catch(() => {});
  await page.fill("#pw", pw).catch(() => {});
  if (!(await page.inputValue("#id").catch(() => ""))) { await page.click("#id").catch(() => {}); await page.keyboard.insertText(id); }
  if (!(await page.inputValue("#pw").catch(() => ""))) { await page.click("#pw").catch(() => {}); await page.keyboard.insertText(pw); }
  const gotId = await page.inputValue("#id").catch(() => "");
  const gotPw = await page.inputValue("#pw").catch(() => "");
  if (!gotId || !gotPw) throw BLOCK("selector_changed", "로그인 폼에 아이디/비밀번호를 넣지 못했어요(네이버 로그인 화면이 바뀐 것 같아요).");

  /* «로그인 상태 유지» — 미체크면 세션 쿠키라 창을 닫으면 만료된다(저장해도 재사용 불가 · AM 근본 수리).
     hidden 스위치라 isChecked 판정이 불안정해서 force check + 라벨 클릭 폴백. */
  await page.locator('input[name="smart_LEVEL"]').check({ force: true }).catch(async () => {
    await page.locator('.login_stay, label:has-text("로그인 상태 유지")').first().click({ timeout: 3000 }).catch(() => {});
  });

  await page.locator("#loginBtn_row:visible, #loginBtn_column:visible").first().click({ timeout: 10_000 })
    .catch(async () => { await page.getByRole("button", { name: "로그인", exact: true }).first().click({ timeout: 8000 }); });
  await settle(page, 4000);

  const url = page.url();
  if (/captcha/i.test(url) || (await page.locator("#captcha, .captcha_wrap").count().catch(() => 0)) > 0) {
    throw BLOCK("captcha", "네이버가 자동입력 방지(캡차)를 띄웠어요.");
  }
  if (/deviceConfirm|idSafetyRelease|deviceRegist/i.test(url)) throw BLOCK("login_fail", "네이버가 «처음 보는 기기»라며 등록을 요구했어요.");
  if (/need2|otp/i.test(url)) throw BLOCK("login_fail", "이 계정은 2단계 인증이 켜져 있어 자동 로그인이 되지 않아요.");
  if (/nidlogin/i.test(page.url())) throw BLOCK("login_fail", "아이디 또는 비밀번호가 맞지 않아요.");
}

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
    if (await page.locator(`${EDITOR_SEL}, ${TITLE_SEL}`).first().isVisible({ timeout: 2000 }).catch(() => false)) { ctx = page; ready = true; break; }
    for (const fr of page.frames()) {
      if (fr === page.mainFrame()) continue;
      if (await fr.locator(`${EDITOR_SEL}, ${TITLE_SEL}`).first().isVisible({ timeout: 1200 }).catch(() => false)) {
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

/** 도구모음 버튼(인용구·구분선 등). 못 찾으면 false — 호출자가 «장식 없이» 내려앉힌다(글은 나간다). */
async function clickToolbarItem(ctx, name) {
  const sels = [
    `button[data-name="${name}"]`,
    `.se-toolbar-item-${name} button`,
    `button[data-log*="${name}"]`,
  ];
  for (const sel of sels) {
    try {
      const b = ctx.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click({ timeout: 4000 }); return true; }
    } catch { /* 다음 */ }
  }
  return false;
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

async function playOps(page, ctx, plan, files, shotKey, missed) {
  let wrote = false;
  const type = async (text) => {
    if (wrote) await page.keyboard.press("Enter").catch(() => {});
    await page.keyboard.insertText(String(text));
    wrote = true;
  };

  for (const op of plan.ops) {
    switch (op.op) {
      case "para": await type(op.text); await settle(page, 250, 600); break;
      case "note": break;   // 사람이 읽는 메모 — 본문에 넣지 않는다(보고에만 실린다)
      case "heading": {
        // 소제목: 에디터의 제목 스타일이 있으면 쓰고, 없으면 굵게로 내려앉는다(글은 나간다).
        if (wrote) await page.keyboard.press("Enter").catch(() => {});
        const styled = await clickToolbarItem(ctx, op.level === 3 ? "header3" : "header2");
        if (!styled) { missed.heading++; await page.keyboard.press("Control+b").catch(() => {}); }
        await page.keyboard.insertText(String(op.text));
        if (!styled) await page.keyboard.press("Control+b").catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
        wrote = true;
        await settle(page, 400, 900);
        break;
      }
      case "quote": {
        if (wrote) await page.keyboard.press("Enter").catch(() => {});
        const opened = await clickToolbarItem(ctx, "quotation");
        if (!opened) {
          missed.quote++;
          await page.keyboard.insertText(`“${op.text}”`);   // 인용 컴포넌트를 못 열면 인용부호로라도 세운다
        } else {
          await page.keyboard.insertText(String(op.text));
        }
        await page.keyboard.press("Enter").catch(() => {});
        wrote = true;
        await shot(page, shotKey, op.role === "disclosure" ? "02-고지" : "인용구");
        await settle(page, 900);
        break;
      }
      case "divider": {
        if (wrote) await page.keyboard.press("Enter").catch(() => {});
        if (!(await clickToolbarItem(ctx, "horizontalLine"))) { missed.divider++; await page.keyboard.insertText("———"); }
        wrote = true;
        await settle(page, 800);
        break;
      }
      case "list": await type(`• ${op.text}`); await settle(page, 200, 500); break;
      case "check": await type(`☑ ${op.text}`); await settle(page, 200, 500); break;
      case "faq": await type(op.text); await settle(page, 200, 500); break;
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
        if (op.caption) { await page.keyboard.insertText(String(op.caption)); }
        wrote = true;
        await settle(page, 1000);
        break;
      }
      case "tags": await type(op.text); await settle(page, 300); break;
      default: if (op.text) await type(op.text);
    }
  }
  await shot(page, shotKey, "03-본문완성");
  return wrote;
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

async function publishNow(page, ctx, tags, blogId, shotKey) {
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
export async function run({ ctx, job, plan, shotKey, dryRun }) {
  const account = job.account ?? {};
  const blogId = String(account.handle ?? "").replace(/^@/, "").trim();
  if (!blogId) throw BLOCK("login_fail", "블로그 아이디(핸들)가 없어요. 계정을 다시 연결해 주세요.");

  const page = ctx.pages()[0] ?? await ctx.newPage();
  const missed = { quote: 0, divider: 0, heading: 0, image: 0, imageDownload: 0, imageSettle: 0 };

  // ① 로그인 — 쿠키가 살아 있으면 건너뛴다.
  if (!(await isLoggedIn(page))) {
    if (!account.login?.id || !account.login?.pw) {
      throw BLOCK("login_fail", "저장된 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
    }
    await loginWithIdPw(page, account.login.id, account.login.pw);
  }
  await shot(page, shotKey, "00-로그인확인");

  // ② 에디터
  const ed = await openEditor(page, blogId, shotKey);

  // ③ 제목
  if (!(await clickEditable(ed, TITLE_SEL))) throw BLOCK("selector_changed", "제목 칸을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
  await page.keyboard.insertText(String(job.payload?.title ?? ""));
  await settle(page, 600);

  // ④ 본문
  if (!(await clickEditable(ed, BODY_SEL))) throw BLOCK("selector_changed", "본문 칸을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
  const files = await downloadImages(plan.ops.filter((o) => o.op === "image").map((o) => o.url));
  try {
    const wrote = await playOps(page, ed, plan, files, shotKey, missed);
    if (!wrote) throw BLOCK("selector_changed", "본문에 한 글자도 넣지 못했어요.");

    // ⑤ 발행 또는 임시저장
    const notes = [];
    if (missed.quote) notes.push(`인용구 ${missed.quote}건 폴백`);
    if (missed.divider) notes.push(`구분선 ${missed.divider}건 폴백`);
    if (missed.heading) notes.push(`소제목 ${missed.heading}건 굵게 폴백`);
    if (missed.image) notes.push(`사진 버튼 ${missed.image}건 미발견`);
    if (missed.imageDownload) notes.push(`사진 ${missed.imageDownload}장 내려받기 실패`);
    if (missed.imageSettle) notes.push(`사진 ${missed.imageSettle}건 자리 확인 실패`);
    notes.push(...(plan.stats.notes ?? []));

    if (dryRun) { await saveDraft(page, ed, shotKey); return { dryRun: true, notes }; }
    const out = await publishNow(page, ed, plan.tags, blogId, shotKey);
    return { ...out, notes };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  } finally {
    cleanupFiles(files);
  }
}

export const channel = "naver_blog";
