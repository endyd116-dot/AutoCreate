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

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

const TITLE_SEL = '#post-title-inp, input[placeholder*="제목"], .textarea_tit';
const MODE_OPEN_SEL = "#editor-mode-layer-btn-open, .btn_editor_mode, button[class*='mode']";
const HTML_MODE_SEL = "#editor-mode-html, [data-mode='html'], li:has-text('HTML')";
const CM_SEL = ".CodeMirror";
const DONE_SEL = "#publish-layer-btn, button:has-text('완료')";
const SAVE_SEL = "#save-btn, button:has-text('저장')";
const PUBLISH_SEL = "#publish-btn, .btn_publish, button:has-text('공개 발행')";

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

/**
 * 카카오 계정 로그인(실측 2026-09-14 · 자사 테스트 블로그) — 티스토리 사용자의 다수가 이 경로다.
 *   `tistory.com/auth/login` → «카카오계정으로 로그인» → `accounts.kakao.com` → (동의) → 리다이렉트.
 *   🔴 2단계·기기 확인이 붙으면 **정직 실패**한다 — 자동으로 뚫으려 들면 계정이 잠긴다(헤드풀 재로그인으로 보낸다).
 */
async function loginWithKakao(page, id, pw) {
  // 티스토리 로그인 화면의 «카카오계정으로 로그인» 버튼(이미 카카오 페이지면 건너뛴다).
  if (!/accounts\.kakao\.com/i.test(page.url())) {
    for (const sel of ["a.btn_login.link_kakao_id", "a[class*='kakao']", "button[class*='kakao']", "text=카카오계정으로 로그인"]) {
      try {
        const b = page.locator(sel).first();
        if (await b.isVisible({ timeout: 2500 }).catch(() => false)) { await b.click({ timeout: 6000 }); break; }
      } catch { /* 다음 */ }
    }
    await settle(page, 2500);
  }
  if (!/accounts\.kakao\.com/i.test(page.url())) {
    throw BLOCK("selector_changed", `카카오 로그인 화면으로 넘어가지 못했어요 — url=${page.url().slice(0, 80)}`);
  }

  const idBox = page.locator("input[name='loginId'], #loginId--1, input[type='email']").first();
  const pwBox = page.locator("input[name='password'], #password--1, input[type='password']").first();
  if (!(await idBox.isVisible({ timeout: 8000 }).catch(() => false))) {
    throw BLOCK("selector_changed", "카카오 로그인 폼을 찾지 못했어요(화면이 바뀐 것 같아요).");
  }
  await idBox.fill(id).catch(() => {});
  await pwBox.fill(pw).catch(() => {});
  await page.locator("button[type='submit'], .btn_g.highlight.submit, button:has-text('로그인')").first().click({ timeout: 8000 }).catch(() => {});
  await settle(page, 5000);

  // 동의 화면(첫 연결 시) — 전체 동의 후 계속.
  for (const sel of ["#agreeAll", "label[for='agreeAll']", "button:has-text('동의하고 계속하기')", "button:has-text('계속하기')"]) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1500 }).catch(() => false)) { await b.click({ timeout: 4000 }).catch(() => {}); await settle(page, 1500); }
    } catch { /* 무시 */ }
  }

  const url = page.url();
  const body = await page.content().catch(() => "");
  if (/captcha|자동입력 방지|보안문자/i.test(body)) throw BLOCK("captcha", "카카오가 자동입력 방지를 띄웠어요.");
  if (/2단계|인증번호|otp|verify/i.test(`${url} ${body.slice(0, 4000)}`) && /accounts\.kakao\.com/i.test(url)) {
    throw BLOCK("login_fail", "카카오 2단계 인증이 필요해요. 앱에서 «다시 로그인»을 눌러 창에서 직접 로그인해 주세요.");
  }
  if (/accounts\.kakao\.com/i.test(page.url())) throw BLOCK("login_fail", "카카오 아이디 또는 비밀번호가 맞지 않아요.");
}

/** 티스토리 자체 아이디 로그인. 카카오 경로면 위 함수로 넘어간다. */
async function loginWithIdPw(page, id, pw) {
  await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  if (/accounts\.kakao\.com/i.test(page.url()) || String(process.env.AC_TISTORY_LOGIN ?? "") === "kakao") {
    return loginWithKakao(page, id, pw);
  }
  const idBox = page.locator("#loginId, input[name='loginId'], input[type='email']").first();
  if (!(await idBox.isVisible({ timeout: 6000 }).catch(() => false))) {
    throw BLOCK("login_fail", "티스토리 로그인 화면을 찾지 못했어요. 앱에서 «다시 로그인»을 눌러 주세요.");
  }
  await idBox.fill(id).catch(() => {});
  await page.locator("#loginPw, input[name='password'], input[type='password']").first().fill(pw).catch(() => {});
  await page.locator("button[type='submit'], .btn_login, button:has-text('로그인')").first().click({ timeout: 8000 }).catch(() => {});
  await settle(page, 4000);
  if (/captcha|보안문자/i.test(await page.content().catch(() => ""))) throw BLOCK("captcha", "티스토리가 자동입력 방지를 띄웠어요.");
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
  if (!(await page.locator(TITLE_SEL).first().isVisible({ timeout: 10_000 }).catch(() => false))) {
    const seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    throw BLOCK("selector_changed", `글쓰기 화면을 찾지 못했어요 — url=${page.url().slice(0, 90)} · 화면="${seen.slice(0, 120)}"`);
  }
}

/** HTML 모드로 전환하고 bodyHtml 을 통째로 넣는다. 성공 = true. */
async function tryHtmlMode(page, bodyHtml, shotKey) {
  try {
    const opener = page.locator(MODE_OPEN_SEL).first();
    if (!(await opener.isVisible({ timeout: 3000 }).catch(() => false))) return false;
    await opener.click({ timeout: 4000 });
    await settle(page, 600);
    const htmlItem = page.locator(HTML_MODE_SEL).first();
    if (!(await htmlItem.isVisible({ timeout: 3000 }).catch(() => false))) return false;
    await htmlItem.click({ timeout: 4000 });
    await settle(page, 1500);
    // 모드 전환 확인 팝업(«HTML 모드로 바꾸면 서식이…») — 확인.
    for (const sel of ["button:has-text('확인')", ".btn_confirm", "button[class*='confirm']"]) {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1200 }).catch(() => false)) { await b.click({ timeout: 3000 }).catch(() => {}); break; }
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

/** 기본 모드 폴백 — ops 를 연주한다(장식은 줄지만 글은 나간다). */
async function playOpsFallback(page, plan, files, shotKey, missed) {
  const body = page.locator("#editor-tistory, .CodeMirror, [contenteditable='true'], iframe#editor-tistory_ifr").first();
  await body.click({ timeout: 8000 }).catch(() => {});
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
  return wrote;
}

/** 발행 레이어: 카테고리·공개·태그 → 확정. dryRun 이면 레이어 전에 임시저장하고 끝낸다. */
async function finishPublish(page, plan, options, shotKey, dryRun) {
  if (dryRun) {
    const save = page.locator(SAVE_SEL).first();
    if (!(await save.isVisible({ timeout: 3000 }).catch(() => false))) throw BLOCK("selector_changed", "임시저장 버튼을 찾지 못했어요(에디터 화면이 바뀐 것 같아요).");
    await save.click({ timeout: 6000 });
    await settle(page, 2500);
    await shot(page, shotKey, "90-임시저장");
    return { dryRun: true };
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
    if (!account.login?.id || !account.login?.pw) throw BLOCK("login_fail", "저장된 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
    // 로그인 방식(카카오/자체)은 계정 자격에 실려 온다(없으면 화면을 보고 판단).
    if (account.login.method === "kakao") process.env.AC_TISTORY_LOGIN = "kakao";
    await loginWithIdPw(page, account.login.id, account.login.pw);
    if (!(await isLoggedIn(page, host))) throw BLOCK("login_fail", "로그인은 됐는데 이 블로그의 관리 화면에 들어가지 못했어요.");
  }
  await shot(page, shotKey, "00-로그인확인");

  await openEditor(page, host, shotKey);

  // 제목
  const title = page.locator(TITLE_SEL).first();
  await title.click({ timeout: 8000 }).catch(() => {});
  await title.fill(String(job.payload?.title ?? "")).catch(async () => {
    await page.keyboard.insertText(String(job.payload?.title ?? ""));
  });
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
    if (missed.image) notes.push(`사진 버튼 ${missed.image}건 미발견`);
    if (missed.imageDownload) notes.push(`사진 ${missed.imageDownload}장 내려받기 실패`);
    notes.push(...(plan.stats.notes ?? []));

    const out = await finishPublish(page, plan, job.payload?.options, shotKey, dryRun);
    return { ...out, notes };
  }
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  } finally {
    if (files) cleanupFiles(files);
  }
}

export const channel = "tistory";
