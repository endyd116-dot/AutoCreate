/**
 * runner/channels/tistory.mjs — 티스토리 발행(신규 · Open API 는 2024-02 종료라 러너만이 길이다).
 *   AC 신규 2026-09-14(B2). 구조는 네이버 러너와 같고 **셀렉터만 티스토리 것**이다.
 *
 *   🔴 전략: **HTML 모드 우선.** 티스토리 에디터는 모드를 «기본/마크다운/HTML» 로 고를 수 있고,
 *      HTML 모드에서는 `bodyHtml`(§4B 렌더 계약 정본)을 **그대로** 넣을 수 있다 —
 *      한 글자씩 연주하는 것보다 서식이 정확하고, 셀렉터 의존도 훨씬 낮다(도구모음을 안 건드린다).
 *      HTML 모드를 못 열면 기본 모드에서 ops 를 연주하는 폴백으로 내려앉는다(글은 나간다 · 장식은 준다).
 *
 *   🔴 로그인은 **두 길**이다: 티스토리 자체 아이디 · **카카오 계정**(실측상 다수가 이쪽).
 *      카카오 경로는 자동 로그인을 시도하되, **캡차·2단계·기기 확인이 뜨면 즉시 정직 실패**하고
 *      헤드풀 재로그인(session.login)으로 보낸다 — 자동으로 뚫으려 들면 계정이 잠긴다.
 */
import { shot, failShot, settle, downloadImages, cleanupFiles } from "../lib/browser.mjs";
import { BLOCK, KAKAO_AUTH_HOST, kakaoLogin } from "../lib/auth-kakao.mjs";   // 카카오 로그인은 공용(애드핏과 같은 세션)


const TITLE_SEL = '#post-title-inp, input[placeholder*="제목"], .textarea_tit';
const MODE_OPEN_SEL = "#editor-mode-layer-btn-open, .btn_editor_mode, button[class*='mode']";
const HTML_MODE_SEL = "#editor-mode-html, [data-mode='html'], li:has-text('HTML')";
const CM_SEL = ".CodeMirror";
/* 실측(2026-09-14 job #74 · TinyMCE 티스토리 에디터): 하단에 «임시저장 N»(저장) · «완료»(발행 레이어 열기),
   우상단에 «기본모드 ∨»(모드 전환). 텍스트가 자식 span 에 있어 :has-text 가 못 잡을 수 있어 getByText 폴백을 함께 쓴다. */
const DONE_SEL = "#publish-layer-btn, button:has-text('완료'), a:has-text('완료')";
const SAVE_SEL = "#save-btn, button:has-text('임시저장'), a:has-text('임시저장'), .btn_save, [class*='save']";
const PUBLISH_SEL = "#publish-btn, .btn_publish, button:has-text('공개 발행'), button:has-text('공개'), button:has-text('발행')";

function blogHost(handle) {
  const h = String(handle ?? "").replace(/^@/, "").trim();
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) { try { return new URL(h).host; } catch { return null; } }
  if (h.includes(".")) return h;                       // 커스텀 도메인 또는 xxx.tistory.com
  return `${h}.tistory.com`;
}

async function isLoggedIn(page, host) {
  try {
    await page.goto(`https://${host}/manage`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const url = page.url();
    if (/auth\/login|accounts\.kakao\.com/i.test(url)) return false;
    return (await page.locator("#kakaoHead, .wrap_admin, #mArticle, [class*='admin']").count().catch(() => 0)) > 0 || /\/manage/i.test(url);
  } catch { return false; }
}


/** 티스토리 자체 아이디 로그인. 카카오 경로면 위 함수로 넘어간다. */
async function loginWithIdPw(page, id, pw, shotKey) {
  await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  if (/accounts\.kakao\.com/i.test(page.url()) || String(process.env.AC_TISTORY_LOGIN ?? "") === "kakao") {
    return kakaoLogin(page, id, pw, shotKey);
  }
  const idBox = page.locator("#loginId, input[name='loginId'], input[type='email']").first();
  if (!(await idBox.isVisible({ timeout: 6000 }).catch(() => false))) {
    throw BLOCK("login_fail", "티스토리 로그인 화면을 찾지 못했어요. 앱에서 «다시 로그인»을 눌러 주세요.");
  }
  await idBox.fill(id).catch(() => {});
  await page.locator("#loginPw, input[name='password'], input[type='password']").first().fill(pw).catch(() => {});
  await page.locator("button[type='submit'], .btn_login, button:has-text('로그인')").first().click({ timeout: 8000 }).catch(() => {});
  await settle(page, 4000);
  // 🔴 여기도 «보이는 글자»로 — 원본 HTML 에는 스크립트·클래스명에 captcha 가 흔히 들어 있다(AC-10 · 거짓 안내 방지).
  const seenSelf = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  if (/자동입력 방지|보안문자|캡차/.test(seenSelf)) throw BLOCK("captcha", "티스토리가 자동입력 방지를 띄웠어요.");
  if (/auth\/login/i.test(page.url())) throw BLOCK("login_fail", "아이디 또는 비밀번호가 맞지 않아요.");
}

/** 글쓰기 화면 진입 + 임시저장 복구 팝업 닫기. */
async function openEditor(page, host, shotKey) {
  await page.goto(`https://${host}/manage/newpost/`, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  if (/auth\/login|accounts\.kakao\.com/i.test(page.url())) throw BLOCK("login_fail", "글쓰기에 들어가려는데 다시 로그인을 요구했어요(세션 만료).");
  await settle(page, 1800);
  // «작성 중인 글이 있습니다» 복구 팝업 — 취소(새 글로 간다).
  for (const sel of ["button:has-text('취소')", ".btn_cancel", "#mceu_cancel", "button[class*='cancel']"]) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
    } catch { /* 무시 */ }
  }
  await shot(page, shotKey, "01-에디터진입");
  // 🔴 실측 DOM 덤프(RUNNER_DEBUG=1) — 이 화면은 세션이 안 남아 매번 2FA 라, 한 번 뜰 때 실제 버튼·모드·에디터 이름을 받아 적는다.
  if (process.env.RUNNER_DEBUG === "1") {
    const d = await page.evaluate(() => {
      const desc = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${(el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".")}[${(el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 12)}]`;
      const btns = [...document.querySelectorAll("button, a[role='button'], [class*='btn']")].filter((e) => /저장|완료|발행|공개|모드|HTML|기본/.test(e.textContent || "")).slice(0, 20).map(desc);
      const ifr = [...document.querySelectorAll("iframe")].map((f) => f.id || f.name || "(no-id)");
      const titles = [...document.querySelectorAll("input,textarea")].filter((e) => /제목|title/i.test((e.placeholder || "") + (e.id || "") + (e.className || ""))).map(desc);
      return { btns, ifr, titles, ce: document.querySelectorAll("[contenteditable='true']").length };
    }).catch(() => null);
    console.log("  · [probe] 버튼:", JSON.stringify(d?.btns)); console.log("  · [probe] iframe:", JSON.stringify(d?.ifr), "제목칸:", JSON.stringify(d?.titles), "ce:", d?.ce);
  }
  if (!(await page.locator(TITLE_SEL).first().isVisible({ timeout: 10_000 }).catch(() => false))) {
    const seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    throw BLOCK("selector_changed", `글쓰기 화면을 찾지 못했어요 — url=${page.url().slice(0, 90)} · 화면="${seen.slice(0, 120)}"`);
  }
}

/** HTML 모드로 전환하고 bodyHtml 을 통째로 넣는다. 성공 = true. */
async function tryHtmlMode(page, bodyHtml, shotKey) {
  try {
    const opener = page.locator(MODE_OPEN_SEL).first();   // 실측: button#editor-mode-layer-btn-open
    if (!(await opener.isVisible({ timeout: 3000 }).catch(() => false))) return false;
    await opener.click({ timeout: 4000 });
    await settle(page, 800);
    /* 🔴 실측(job #75): 레이어 안 «HTML» 항목이 <button>·[data-mode] 가 아니라 텍스트 노드일 수 있어 CSS 로 못 잡았다.
       카카오 «계속하기» 와 같은 처치 — 글자로 찾고 클릭 가능한 조상까지 올라가 누른다. 열린 레이어 DOM 도 덤프(RUNNER_DEBUG). */
    if (process.env.RUNNER_DEBUG === "1") {
      const layer = await page.evaluate(() => [...document.querySelectorAll("a,button,li,span,div")]
        .filter((e) => /HTML|마크다운|기본모드/.test(e.textContent || "") && (e.textContent || "").length < 20)
        .slice(0, 12).map((e) => `${e.tagName.toLowerCase()}${e.id ? "#" + e.id : ""}.${(e.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 2).join(".")}[${(e.textContent || "").trim().slice(0, 10)}]`)).catch(() => []);
      console.log("  · [probe] 모드 레이어:", JSON.stringify(layer));
    }
    let clicked = false;
    const cssItem = page.locator(HTML_MODE_SEL).first();
    if (await cssItem.isVisible({ timeout: 1500 }).catch(() => false)) { await cssItem.click({ timeout: 3000 }); clicked = true; }
    else {
      const byText = page.getByText("HTML", { exact: true }).first();
      if (await byText.isVisible({ timeout: 1500 }).catch(() => false)) {
        const anc = byText.locator("xpath=ancestor-or-self::*[self::button or self::a or self::li or @role='menuitem'][1]").first();
        await (await anc.isVisible({ timeout: 300 }).catch(() => false) ? anc : byText).click({ timeout: 3000 });
        clicked = true;
      }
    }
    if (!clicked) return false;
    await settle(page, 1500);
    // 모드 전환 확인 팝업(«HTML 모드로 바꾸면 편집이 제한될 수 있습니다» 등) — 확인/예.
    for (const sel of ["button:has-text('확인')", "button:has-text('예')", ".btn_confirm", "button[class*='confirm']", ".btn_g.highlight"]) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1000 }).catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
    }
    await settle(page, 1200);
    if (!(await page.locator(CM_SEL).first().isVisible({ timeout: 5000 }).catch(() => false))) return false;
    /* CodeMirror 는 키 입력으로 긴 HTML 을 넣으면 자동 들여쓰기·괄호 보정이 끼어든다 —
       인스턴스 API 로 값을 **그대로** 세팅한다(그게 HTML 모드를 고른 이유다). */
    const set = await page.evaluate((html) => {
      const el = document.querySelector(".CodeMirror");
      const cm = el && el.CodeMirror;
      if (!cm) return false;
      cm.setValue(html);
      cm.refresh();
      return cm.getValue().length > 0;
    }, String(bodyHtml ?? "")).catch(() => false);
    if (!set) return false;
    await shot(page, shotKey, "02-HTML모드본문");
    return true;
  } catch { return false; }
}

/**
 * 본문 편집 영역에 **확실히** 포커스를 준다. 못 주면 던진다.
 *   🔴 2026-09-14 실측(job #119 · 사장님 확인): 종전 코드는
 *      `page.locator("#editor-tistory, .CodeMirror, [contenteditable], iframe#editor-tistory_ifr").first().click().catch(()=>{})`
 *      였다. ① TinyMCE 본문은 **iframe 안**이라 부모 문서 셀렉터로는 안 잡히고 ② 클릭 실패를 **조용히 삼켜서**
 *      직전에 제목칸(textarea#post-title-inp)에 있던 포커스가 그대로 남았다 →
 *      **본문 전체가 제목칸에 입력됐다**(본문 빈칸 · Enter 도 제목이 먹어 문단 구분 소멸).
 *      눈 감고 타자를 치느니 멈추는 게 낫다 — 실패는 던진다.
 */
async function focusEditorBody(page) {
  // ① TinyMCE 본문(iframe) — 프레임 안의 body 를 직접 클릭해야 그 문서로 포커스가 간다.
  try {
    await page.frameLocator("iframe#editor-tistory_ifr").locator("body").first().click({ timeout: 6000 });
    return "iframe";
  } catch { /* 다음 후보 */ }
  // ② CodeMirror(HTML·마크다운 모드)
  const cm = page.locator(".CodeMirror").first();
  if (await cm.isVisible({ timeout: 1500 }).catch(() => false)) { await cm.click({ timeout: 6000 }).catch(() => {}); return "codemirror"; }
  // ③ 부모 문서의 contenteditable(제목칸은 textarea 라 여기 안 걸린다)
  const ce = page.locator("[contenteditable='true']").first();
  if (await ce.isVisible({ timeout: 1500 }).catch(() => false)) { await ce.click({ timeout: 6000 }).catch(() => {}); return "contenteditable"; }
  throw BLOCK("selector_changed", "본문 편집 영역에 포커스를 주지 못했어요(제목칸에 쓸 위험이 있어 중단했어요).");
}

/** 지금 본문에 들어 있는 글자(되읽기용). 못 읽으면 빈 문자열. */
async function readBodyText(page) {
  try {
    const t = await page.frameLocator("iframe#editor-tistory_ifr").locator("body").first().innerText({ timeout: 3000 });
    if (t) return t;
  } catch { /* 다음 */ }
  try { return await page.locator(".CodeMirror").first().innerText({ timeout: 1500 }); } catch { /* 다음 */ }
  try { return await page.locator("[contenteditable='true']").first().innerText({ timeout: 1500 }); } catch { /* 없음 */ }
  return "";
}

/** 기본 모드 폴백 — ops 를 연주한다(장식은 줄지만 글은 나간다). */
async function playOpsFallback(page, plan, files, shotKey, missed) {
  const where = await focusEditorBody(page);
  console.log(`  · 기본 모드 본문 포커스: ${where}`);
  let wrote = false;
  for (const op of plan.ops) {
    if (op.op === "note") continue;
    if (op.op === "image") {
      const file = files.get(op.url);
      if (!file) { missed.imageDownload++; continue; }
      const sels = ["button[data-name='image']", ".btn_image", "button[title*='사진']", "button:has-text('사진')"];
      let done = false;
      for (const sel of sels) {
        try {
          const btn = page.locator(sel).first();
          if (!(await btn.isVisible({ timeout: 1500 }).catch(() => false))) continue;
          const [chooser] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10_000 }), btn.click()]);
          await chooser.setFiles([file]);
          await settle(page, 3000);
          done = true; break;
        } catch { /* 다음 */ }
      }
      if (!done) missed.image++;
      wrote = true;
      continue;
    }
    const text = op.op === "list" ? `• ${op.text}` : op.op === "check" ? `☑ ${op.text}`
      : op.op === "quote" ? `“${op.text}”` : op.op === "divider" ? "———"
        : op.op === "link" ? `${op.text} ${op.url}` : String(op.text ?? "");
    if (!text) continue;
    if (wrote) await page.keyboard.press("Enter").catch(() => {});
    await page.keyboard.insertText(text);
    wrote = true;
    await settle(page, 200, 500);
  }
  await shot(page, shotKey, "02-기본모드본문");
  /* 🔴 되읽기 — 본문이 비어 있으면 타자가 **다른 칸으로 샌** 것이다(제목칸 사고의 재발 방지).
     «썼다»고 보고하고 넘어가면 제목에 본문이 통째로 들어간 글이 임시저장된다. */
  if (wrote) {
    const got = (await readBodyText(page)).trim();
    if (!got) throw BLOCK("selector_changed", "본문에 글이 들어가지 않았어요(타자가 다른 칸으로 샜을 수 있어요).");
  }
  return wrote;
}

/** 발행 레이어: 카테고리·공개·태그 → 확정. dryRun 이면 레이어 전에 임시저장하고 끝낸다. */
async function finishPublish(page, plan, options, shotKey, dryRun) {
  if (dryRun) {
    /* 🔴 임시저장 버튼을 CSS 로 못 찾으면 글자로(«임시저장») 찾고 클릭 가능한 조상까지 올라간다.
       그래도 없으면 — TinyMCE 티스토리는 **자동 저장**이 돈다(«자동 저장 완료 HH:MM:SS»). 그 지표가 보이면
       드라이런의 목표(발행 없이 초안 저장)는 이미 이뤄진 것이라 성공으로 본다(임시저장까지만 · 발행 0). */
    let saved = false;
    let save = page.locator(SAVE_SEL).first();
    if (!(await save.isVisible({ timeout: 3000 }).catch(() => false))) {
      const byText = page.getByText("임시저장", { exact: false }).first();
      if (await byText.isVisible({ timeout: 2000 }).catch(() => false)) {
        save = byText.locator("xpath=ancestor-or-self::*[self::button or self::a or @role='button'][1]").first();
        if (!(await save.isVisible({ timeout: 500 }).catch(() => false))) save = byText;
      } else { save = null; }
    }
    if (save) { await save.click({ timeout: 6000 }).catch(() => {}); await settle(page, 2500); saved = true; }
    const autosaved = await page.getByText(/자동 저장 완료/).first().isVisible({ timeout: 3000 }).catch(() => false);
    await shot(page, shotKey, "90-임시저장");
    if (!saved && !autosaved) throw BLOCK("selector_changed", "임시저장 버튼도 자동저장 지표도 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
    return { dryRun: true, notes: [saved ? "임시저장 클릭" : "자동저장 확인(버튼 미발견)"] };
  }

  const done = page.locator(DONE_SEL).first();
  if (!(await done.isVisible({ timeout: 4000 }).catch(() => false))) throw BLOCK("selector_changed", "«완료» 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
  await done.click({ timeout: 8000 });
  await settle(page, 1500);
  await shot(page, shotKey, "91-발행레이어");

  // 카테고리(지정이 있을 때만 · 없으면 블로그 기본값)
  const wantCat = String(options?.category ?? "").trim();
  if (wantCat) {
    try {
      await page.locator("#category-btn, .btn_category").first().click({ timeout: 3000 });
      await settle(page, 500);
      await page.getByText(wantCat, { exact: true }).first().click({ timeout: 3000 });
      await settle(page, 400);
    } catch { /* 기본 카테고리로 나간다 */ }
  }
  // 공개 설정 — 명시적으로 «공개».
  await page.locator("#open20, input[value='20']").first().check({ force: true }).catch(async () => {
    await page.getByText("공개", { exact: true }).first().click({ timeout: 2500 }).catch(() => {});
  });
  // 태그
  const tags = (plan.tags ?? []).slice(0, 10);
  if (tags.length) {
    try {
      const box = page.locator("#tagText, input[placeholder*='태그']").first();
      if (await box.isVisible({ timeout: 2000 }).catch(() => false)) {
        await box.click({ timeout: 3000 });
        for (const t of tags) { await page.keyboard.type(t, { delay: 12 }); await page.keyboard.press("Enter"); await settle(page, 120); }
      }
    } catch { /* 태그 실패해도 발행은 계속 */ }
  }
  await settle(page, 800, 1800);

  const before = page.url();
  const pub = page.locator(PUBLISH_SEL).first();
  if (!(await pub.isVisible({ timeout: 4000 }).catch(() => false))) throw BLOCK("selector_changed", "«공개 발행» 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
  await pub.click({ timeout: 8000 });

  // 발행되면 글 주소(/{entryId} 또는 /entry/...)로 이동한다.
  let found = null;
  for (let waited = 0; waited < 45_000 && !found; waited += 600) {
    for (const p of page.context().pages()) {
      const u = p.url();
      if (u === before) continue;
      const m = /^https?:\/\/[^/]+\/(?:entry\/[^/?#]+|(\d+))(?:[/?#]|$)/i.exec(u);
      if (m && !/manage/i.test(u)) { found = { url: u.split("#")[0], id: m[1] ?? null }; break; }
    }
    if (found) break;
    await settle(page, 600);
  }
  await shot(page, shotKey, "92-발행후");
  if (!found) throw BLOCK("unknown", `발행 후 글 주소를 회수하지 못했어요(현재 ${page.url().slice(0, 70)}).`);
  return { externalUrl: found.url, channelRef: found.id ? `tistory:${found.id}` : `tistory:${found.url.slice(-40)}` };
}

/* ───────────────────── 진입점 ───────────────────── */

export async function run({ ctx, job, plan, shotKey, dryRun }) {
  const account = job.account ?? {};
  const host = blogHost(account.handle);
  if (!host) throw BLOCK("login_fail", "티스토리 블로그 주소(핸들)가 없어요. 계정을 다시 연결해 주세요.");

  const page = ctx.pages()[0] ?? await ctx.newPage();
  const missed = { image: 0, imageDownload: 0, htmlMode: 0 };
  /* 🔴 실패 스냅샷은 모든 단계를 덮는다(네이버와 같은 수리 · 2026-09-14 실측에서 로그인 실패 시 사진이 0장이었다). */
  let files = null;
  try {
  if (!(await isLoggedIn(page, host))) {
    /* 🔴 근본 수리(job #77~#84 실측): **카카오 계정은 무인 자동 로그인을 하지 않는다.**
       카카오는 2단계(휴대폰 승인) + 동의 화면 + OAuth 콜백을 거치는데, 콜백이 자동화 컨텍스트에서 세션을 완성하지 못하고
       티스토리 로그인으로 **되돌아오는 리다이렉트 루프**가 있다(FAIL 스냅샷 = 티스토리 로그인 페이지). 봇이 뚫을 수 있는 화면이 아니다.
       ⇒ 사람이 «다시 로그인»(session.login · 헤드풀)으로 **한 번** 로그인해 쿠키를 저장하면, 이후 발행은 그 쿠키(claim 이 실어 준다)로 돈다.
          이게 실제 사용자 흐름이다. 여기서 자동 로그인으로 계정을 위험에 빠뜨리지 않는다. */
    if (account.login?.method === "kakao") {
      throw BLOCK("login_fail", "카카오 로그인은 창에서 한 번 직접 해 주셔야 해요. 앱에서 «다시 로그인»을 누르면 창이 열리고, 그 로그인 세션으로 이후 글이 자동으로 올라갑니다.");
    }
    if (!account.login?.id || !account.login?.pw) throw BLOCK("login_fail", "저장된 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
    await loginWithIdPw(page, account.login.id, account.login.pw, shotKey);
    /* 🔴 카카오 동의 뒤 티스토리 OAuth 콜백이 자동화에서 세션을 못 세우고 authorize 로 되돌아오는 루프가 있다(job #84 실측).
       콜백이 세션을 세웠을 수도 있어 «에디터로 직접» 몇 번 가 본다(OAuth 춤이 멈춘 뒤 정착할 시간). 그래도 안 서면
       그건 사람이 완료해야 하는 화면이라 — 자동 재시도로 뚫지 않고 «다시 로그인»(헤드풀 세션 로그인)으로 정직하게 넘긴다. */
    let settled = false;
    for (let i = 0; i < 3 && !settled; i++) { if (await isLoggedIn(page, host)) settled = true; else await settle(page, 2500); }
    if (!settled) throw BLOCK("login_fail", "카카오 로그인이 자동으로 끝나지 않았어요(로그인 화면이 되돌아와요). 앱에서 «다시 로그인»을 눌러 창에서 직접 한 번 로그인해 주시면 그 세션으로 자동 발행됩니다.");
  }
  await shot(page, shotKey, "00-로그인확인");

  await openEditor(page, host, shotKey);

  // 제목 — 🔴 실측(job #75): fill 이 조용히 빗나가 제목이 **본문에 섞여 들어갔다**. 채운 뒤 값을 되읽어 확인하고,
  //   비었으면 클릭 후 타자로 다시(그래도 비면 notes 로 보고 · 조용히 넘기지 않는다).
  const titleText = String(job.payload?.title ?? "");
  const titleBox = page.locator("textarea#post-title-inp, #post-title-inp, .textarea_tit").first();
  const titleNotes = [];
  if (await titleBox.isVisible({ timeout: 8000 }).catch(() => false)) {
    await titleBox.fill(titleText).catch(() => {});
    if ((await titleBox.inputValue().catch(() => "")) !== titleText) {
      await titleBox.click({ timeout: 4000 }).catch(() => {});
      await page.keyboard.press("Control+A").catch(() => {});
      await page.keyboard.type(titleText, { delay: 8 }).catch(() => {});
    }
    const got = await titleBox.inputValue().catch(() => "");
    if (got !== titleText) titleNotes.push(`제목 입력 확인 실패(들어간 값 "${got.slice(0, 20)}")`);
  } else {
    titleNotes.push("제목 칸을 못 찾았어요(textarea#post-title-inp)");
  }
  await settle(page, 600);

  files = await downloadImages(plan.ops.filter((o) => o.op === "image").map((o) => o.url));
  {
    // 본문 — HTML 모드 우선(가장 안전), 안 되면 연주 폴백.
    const notes = [];
    const html = await tryHtmlMode(page, job.payload?.bodyHtml, shotKey);
    if (!html) {
      missed.htmlMode++;
      notes.push("HTML 모드를 열지 못해 기본 모드로 넣었어요(서식 일부 폴백)");
      const wrote = await playOpsFallback(page, plan, files, shotKey, missed);
      if (!wrote) throw BLOCK("selector_changed", "본문에 한 글자도 넣지 못했어요.");
    }
    /* 🔴 제목 오염 검사 — 본문 타자가 제목칸으로 새면 제목에 글이 통째로 들어간다(2026-09-14 실측 job #119).
       본문을 넣은 **뒤** 제목을 다시 읽어 확인하고, 어긋났으면 제목을 되돌린 뒤 사실을 남긴다(조용히 넘기지 않는다). */
    if (titleText) {
      const titleAfter = await titleBox.inputValue().catch(() => "");
      if (titleAfter !== titleText) {
        notes.push(`제목이 본문 입력에 오염돼 되돌렸어요(들어가 있던 길이 ${titleAfter.length})`);
        await titleBox.fill(titleText).catch(() => {});
      }
    }
    if (missed.image) notes.push(`사진 버튼 ${missed.image}건 미발견`);
    if (missed.imageDownload) notes.push(`사진 ${missed.imageDownload}장 내려받기 실패`);
    notes.push(...titleNotes);
    notes.push(...(plan.stats.notes ?? []));

    const out = await finishPublish(page, plan, job.payload?.options, shotKey, dryRun);
    return { ...out, notes: [...notes, ...(out.notes ?? [])] };
  }
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  } finally {
    if (files) cleanupFiles(files);
  }
}

export const channel = "tistory";
