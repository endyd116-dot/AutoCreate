/**
 * runner/lib/auth-kakao.mjs — 카카오 계정 로그인(공용). 티스토리·카카오 애드핏이 같은 카카오 세션을 쓴다.
 *   channels/tistory.mjs 에서 2026-09-14 실측(2단계 화면·5분 창·도메인 둘)으로 다듬은 것을 그대로 옮겼다 — 로직 변경 0.
 *   호출 전제: 서비스의 «카카오계정으로 로그인» 버튼이 있는 화면 **또는** 이미 accounts.kakao.com 에 있는 상태.
 */
import { shot, settle } from "./browser.mjs";

export const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

/** 카카오 인증 도메인은 둘이다 — 하나만 보면 중간 단계에서 «끝났다»고 착각한다(2026-09-14 실측). */
export const KAKAO_AUTH_HOST = /accounts\.kakao\.com|kauth\.kakao\.com/i;

/**
 * «계속하기 / 동의하고 계속하기 / 전체 동의» 누르기 — 카카오 OAuth 확인 화면(`kauth.kakao.com/oauth/authorize`).
 *   🔴 실측(job #73): `button:has-text('계속하기')` 가 **못 잡았다**(버튼이 <button> 이 아니거나 텍스트가 자식 span 에 있다).
 *   ⇒ **글자로 찾고** 클릭 가능한 조상(button/a/[role=button]/label)까지 올라가 누른다(AM «개별사진» 팝업과 같은 처치).
 *   반환 = 눌렀나.
 */
/**
 * passKakaoConsent — 카카오 «해당 카카오계정으로 …에 로그인합니다» 동의 화면을 통과한다(2026-09-14 근본 수리).
 *   실측(job #77): «계속하기» 를 getByRole 로 눌렀다고 로그는 찍혔지만 페이지가 안 넘어가 여기서 4분 소진.
 *   근본 원인 후보를 **찍어서** 가른다 — 버튼이 form submit 인가·계정 행 선택이 먼저인가·클릭이 헛맞았나.
 *   반환: true(통과 시도함) / false(동의 화면 아님).
 */
export async function passKakaoConsent(page, step) {
  const body = ((await page.locator("body").innerText().catch(() => "")) || "");
  const onConsent = /로그인합니다|계속하기|동의하고 계속하기/.test(body) && KAKAO_AUTH_HOST.test(page.url());
  if (!onConsent) return false;

  // 🔴 실패 직전 DOM 을 찍는다 — 버튼의 실체(tag·type·form·disabled·href)를 남겨 근본 원인을 본다.
  const dom = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button, a, input[type='submit']")]
      .filter((e) => /계속|동의|로그인|확인/.test(e.textContent || e.value || ""))
      .slice(0, 12).map((e) => ({
        tag: e.tagName.toLowerCase(), type: e.getAttribute("type"), text: (e.textContent || e.value || "").replace(/\s+/g, " ").trim().slice(0, 14),
        id: e.id || null, cls: (e.className || "").toString().slice(0, 40), href: e.getAttribute("href"),
        disabled: e.disabled === true || e.getAttribute("aria-disabled") === "true",
        inForm: !!e.closest("form"), vis: !!(e.offsetParent || e.getClientRects().length),
      }));
    const forms = [...document.querySelectorAll("form")].map((f) => ({ action: f.getAttribute("action"), method: f.getAttribute("method") })).slice(0, 4);
    const accounts = [...document.querySelectorAll("[class*='account'], [class*='item'], label, li")].filter((e) => /@/.test(e.textContent || "")).slice(0, 4).map((e) => ({ tag: e.tagName.toLowerCase(), cls: (e.className || "").toString().slice(0, 30), text: (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24) }));
    return { btns, forms, accounts };
  }).catch(() => null);
  if (process.env.RUNNER_DEBUG === "1") console.log("  · [consent DOM]", JSON.stringify(dom));

  const beforeUrl = page.url();
  /* 🔴 실측 DOM(job #82): 계정은 `div.box_account`(라디오 아님) · 제출은 `button.btn_confirm[type=submit]`(form method=post·action=null).
     ① 계정 박스를 먼저 눌러 «선택»을 확실히 하고 ② 정확한 confirm 버튼을 누르고 ③ 안 넘어가면 form.requestSubmit(JS)로 제출한다. */
  for (const sel of ["div.box_account", "div.user_account", "span.txt_account"]) {
    try { const a = page.locator(sel).first(); if (await a.isVisible({ timeout: 300 }).catch(() => false)) { await a.click({ timeout: 1500 }).catch(() => {}); break; } } catch { /* */ }
  }
  // URL 을 300ms 마다 3초간 훑어 **잠깐 티스토리로 튕겼다 되돌아오는지**(리다이렉트 루프) 까지 잡는다.
  const watchNav = async () => {
    for (let i = 0; i < 10; i++) {
      await settle(page, 300);
      const u = page.url();
      if (/tistory\.com/i.test(u)) return "tistory";
      if (!/\/authorize/.test(u) && u !== beforeUrl) return "moved";
    }
    return /\/authorize/.test(page.url()) ? "stuck" : "moved";
  };
  const confirm = page.locator("button.btn_confirm, button[type='submit'].btn_g, button[type='submit']").first();
  if (await confirm.isVisible({ timeout: 800 }).catch(() => false)) {
    await confirm.click({ timeout: 3000 }).catch(() => {});
    if (step) await step("consent-confirm");
    const r1 = await watchNav();
    if (process.env.RUNNER_DEBUG === "1") console.log(`  · [consent] confirm 클릭 후 → ${r1} (url=${page.url().slice(0, 60)})`);
    /* 🔴 근본 원인(job #84 확정): 클릭하면 tistory 로 잠깐 갔다 authorize 로 **되돌아온다**(리다이렉트 루프 — 티스토리 OAuth 콜백이
       자동화 컨텍스트에서 세션을 완성하지 못한다). tistory 로 튕긴 흔적이 보이면 콜백이 세션을 세웠을 수도 있으니 호출자가 확인한다.
       무한정 두드리지 않는다 — 사람이 완료해야 하는 화면은 session.login(헤드풀)로 넘긴다. */
    if (r1 === "tistory" || r1 === "moved") return true;
  }
  // ③ JS 폼 제출 — 버튼 클릭이 핸들러에 안 먹을 때(action=null·JS 제출형).
  const submitted = await page.evaluate(() => {
    const b = document.querySelector("button.btn_confirm, button[type='submit']");
    const f = b && b.closest("form");
    if (!f) return false;
    if (f.requestSubmit) { f.requestSubmit(b || undefined); return true; }
    f.submit(); return true;
  }).catch(() => false);
  if (step) await step("consent-requestSubmit");
  const r2 = await watchNav();
  if (process.env.RUNNER_DEBUG === "1") console.log(`  · [consent] requestSubmit(${submitted}) 후 → ${r2} (url=${page.url().slice(0, 60)})`);
  return true;
}

export async function clickContinue(page, step) {
  const candidates = [
    { kind: "role", name: /^(계속하기|동의하고 계속하기|계속)$/ },
    { kind: "text", text: "계속하기" },
    { kind: "text", text: "동의하고 계속하기" },
    { kind: "css", sel: "#agreeAll, label[for='agreeAll']" },
    { kind: "css", sel: "button[type='submit'], .btn_agree, .btn_confirm, a.btn_g.highlight, button.btn_g.highlight" },
  ];
  for (const c of candidates) {
    try {
      let loc = c.kind === "role" ? page.getByRole("button", { name: c.name }).first()
        : c.kind === "text" ? page.getByText(c.text, { exact: true }).first()
          : page.locator(c.sel).first();
      if (!(await loc.isVisible({ timeout: 500 }).catch(() => false))) continue;
      // 글자 노드면 클릭 가능한 조상으로
      if (c.kind === "text") {
        const anc = loc.locator("xpath=ancestor-or-self::*[self::button or self::a or @role='button' or self::label][1]").first();
        if (await anc.isVisible({ timeout: 300 }).catch(() => false)) loc = anc;
      }
      await loc.click({ timeout: 4000 });
      if (step) await step(`k3b-계속하기(${c.kind})`);
      return true;
    } catch { /* 다음 후보 */ }
  }
  return false;
}

/**
 * 카카오 계정 로그인(실측 2026-09-14 · 자사 테스트 블로그) — 티스토리 사용자의 다수가 이 경로다.
 *   `tistory.com/auth/login` → «카카오계정으로 로그인» → `accounts.kakao.com` → (동의) → 리다이렉트.
 *   🔴 2단계·기기 확인이 붙으면 **정직 실패**한다 — 자동으로 뚫으려 들면 계정이 잠긴다(헤드풀 재로그인으로 보낸다).
 */
export async function kakaoLogin(page, id, pw, shotKey) {
  /* 🔴 로그인 단계마다 스냅샷·주소를 남긴다(AC-10 «실패 스냅샷은 첫 단계부터»).
     카카오→티스토리 OAuth 왕복은 화면이 여러 번 갈아타서, 마지막 화면만 보면 «어디서 끊겼는지»를 알 수 없다
     (2026-09-14 실측에서 두 번 헛짚었다 — 끝 화면은 둘 다 «티스토리 로그인 페이지»로 똑같았다). */
  const step = async (name) => {
    await shot(page, shotKey, name);
    console.log(`  · [${name}] ${page.url().slice(0, 90)}`);
  };
  await step("k0-티스토리로그인화면");
  // 티스토리 로그인 화면의 «카카오계정으로 로그인» 버튼(이미 카카오 페이지면 건너뛴다).
  if (!KAKAO_AUTH_HOST.test(page.url())) {
    for (const sel of ["a.btn_login.link_kakao_id", "a[class*='kakao']", "button[class*='kakao']", "text=카카오계정으로 로그인"]) {
      try {
        const b = page.locator(sel).first();
        if (await b.isVisible({ timeout: 2500 }).catch(() => false)) { await b.click({ timeout: 6000 }); break; }
      } catch { /* 다음 */ }
    }
    await settle(page, 2500);
    await step("k1-카카오이동");
  }
  if (!KAKAO_AUTH_HOST.test(page.url())) {
    throw BLOCK("selector_changed", `카카오 로그인 화면으로 넘어가지 못했어요 — url=${page.url().slice(0, 80)}`);
  }

  const idBox = page.locator("input[name='loginId'], #loginId--1, input[type='email']").first();
  const pwBox = page.locator("input[name='password'], #password--1, input[type='password']").first();
  const formShown = await idBox.isVisible({ timeout: 8000 }).catch(() => false);
  if (formShown) {
    await idBox.fill(id).catch(() => {});
    await pwBox.fill(pw).catch(() => {});
    await page.locator("button[type='submit'], .btn_g.highlight.submit, button:has-text('로그인')").first().click({ timeout: 8000 }).catch(() => {});
    await settle(page, 5000);
    await step("k2-비밀번호제출");
  } else {
    /* 🔴 프로필에 카카오 세션이 남아 있으면 **로그인 폼이 아예 안 뜬다**(«계속하기»·동의 화면이거나 바로 리다이렉트).
       그걸 «폼을 못 찾았다»(selector_changed = 우리 버그)로 적으면 멀쩡한 흐름에 딱지가 붙는다(AC-10).
       폼이 없으면 이미 인증된 것으로 보고 다음 단계로 넘어간다. */
    await step("k2-폼없음(세션유지 추정)");
  }

  // 동의 화면(첫 연결 시) — 전체 동의 후 계속.
  for (const sel of ["#agreeAll", "label[for='agreeAll']", "button:has-text('동의하고 계속하기')", "button:has-text('계속하기')"]) {
    try {
      const b = page.locator(sel).first();
      if (await b.isVisible({ timeout: 1500 }).catch(() => false)) { await b.click({ timeout: 4000 }).catch(() => {}); await settle(page, 1500); }
    } catch { /* 무시 */ }
  }

  /* 🔴 판정은 **화면에 보이는 글자**로 한다. `page.content()`(원본 HTML)로 재면 스크립트·URL 안의 «verify»
     한 글자에 2단계로 오분류되고, 그러면 «2단계를 끄세요»라는 **거짓 안내**가 고객에게 나간다(AM 이 피 본 함정).
     2026-09-14 자사 테스트 계정 드라이런에서 실제 2단계 화면을 확인하며 이 자리를 innerText 로 바꿨다. */
  let seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();

  /* 사람이 옆에 있을 때만(헤드풀 검증·카나리) 2단계 승인을 **기다려 준다**. 기본값 0 = 기다리지 않는다.
     🔴 운영(헤드리스)에서는 절대 기다리면 안 된다 — 아무도 없는 창 앞에서 잡을 붙들고 큐를 굶긴다.
     그래서 옵트인 env(`AC_2FA_WAIT_MS`)로만 열린다. */
  const waitMs = Number(process.env.AC_2FA_WAIT_MS ?? 0) || 0;
  if (waitMs > 0 && /2단계 인증|인증번호를 입력|카카오톡으로/.test(seen)) {
    console.log(`  · 카카오 2단계 인증 화면입니다 — 카카오톡에서 «확인»을 눌러 주세요(최대 ${Math.round(waitMs / 1000)}초 대기).`);
    console.log("    ▸ 그 화면의 «이 브라우저에서 2단계 인증 사용 안 함»도 켜 두시면 다음부터 이 단계가 사라집니다.");
    /* 🔴 카카오 인증 도메인은 **둘**이다(`accounts.kakao.com` · `kauth.kakao.com`). 하나만 보고 기다리면
       중간 단계로 넘어가는 순간 «끝났다»고 착각하고 빠져나온다 — 2026-09-14 실측에서 30초 만에 빠져나와
       콜백이 완료되기 전에 다음 단계로 갔다. 도메인 둘 **또는** 화면에 2단계 문구가 남아 있으면 계속 기다린다. */
    const stillAuth = async () => {
      if (KAKAO_AUTH_HOST.test(page.url())) return true;
      const t = ((await page.locator("body").innerText().catch(() => "")) || "");
      return /2단계 인증|카카오톡으로 로그인 확인|인증번호를 입력/.test(t);
    };
    /* 🔴 2단계 «승인»은 사람이 카카오톡에서 한다 — 우리는 기다린다. 승인 뒤 뜨는 «계속하기»(동의) 화면만 눌러 준다.
       ⚠️ job #76: 매 2초 무조건 클릭 → 80회 폭주. ⇒ «계속하기 글자가 실제로 보일 때만» 누르고, 누른 뒤엔 그 화면이
       **사라질 때까지 기다린 다음** 루프를 잇는다(같은 화면을 두 번 두드리지 않는다 · 최대 5회). */
    const deadline = Date.now() + waitMs;
    let continues = 0;
    while (Date.now() < deadline && await stillAuth()) {
      // 동의 화면이면 통과 시도(계정 선택 + 제출 버튼 여러 후보). 2단계 대기 화면이면 passKakaoConsent 가 false 로 넘긴다.
      if (continues < 6 && await passKakaoConsent(page, step)) { continues++; await settle(page, 1500); continue; }
      await settle(page, 2000);
    }
    seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    await step("k3-2단계후");
  }

  /* 🔴 카카오 인증이 끝나도 **티스토리로 돌아오는 콜백**이 남아 있다. 그게 끝나기 전에 다음 단계로 가면
     «로그인은 됐는데 관리 화면에 못 들어갔다»가 된다(2026-09-14 실측 job #13 — 화면은 티스토리 로그인 페이지였다).
     주소가 tistory 로 돌아올 때까지 최대 30초 기다린다. */
  {
    /* 🔴 실측(2026-09-14 job #66 · 사장님 승인 후): 2단계를 통과하면 `kauth.kakao.com/oauth/authorize?prompt=select_account` 에
       **«해당 카카오계정으로 티스토리에 로그인합니다 · [계속하기]»** 확인 화면이 한 번 더 뜬다. 동의 버튼 탐색이 2단계 대기 **앞에서만**
       돌아 이 화면을 아무도 안 눌렀고, 콜백 대기 30초가 그냥 흘러 «관리 화면에 못 들어갔다»가 됐다.
       ⇒ 콜백을 기다리는 동안 카카오 도메인에 «계속하기/동의하고 계속하기/agreeAll» 이 보이면 누른다(매 바퀴). */
    const deadline = Date.now() + 30_000;
    let tries = 0;
    while (Date.now() < deadline && !/tistory\.com/i.test(page.url())) {
      if (KAKAO_AUTH_HOST.test(page.url())) {
        if (tries < 6 && await passKakaoConsent(page, step)) { tries++; await settle(page, 1500); continue; }
        if (waitMs <= 0) break;   // 운영(헤드리스) — 사람 없으면 붙들지 않는다
      }
      await settle(page, 1500);
    }
    // 🔴 여기까지 왔는데 tistory 로 못 갔으면 그 화면을 찍어 둔다(근본 원인 · 사장님 지시).
    if (!/tistory\.com/i.test(page.url())) await shot(page, shotKey, "k4x-콜백막힘");
    seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    await step("k4-콜백후");
  }

  if (/자동입력 방지|보안문자|캡차/.test(seen)) throw BLOCK("captcha", "카카오가 자동입력 방지를 띄웠어요.");
  if (/2단계 인증|인증번호를 입력|카카오톡으로 인증/.test(seen)) {
    throw BLOCK("login_fail", "카카오 2단계 인증이 필요해요. 앱에서 «다시 로그인»을 눌러 창에서 직접 로그인해 주세요.");
  }
  if (/새로운 기기|기기 등록|이 기기를 등록/.test(seen)) {
    throw BLOCK("login_fail", "카카오가 «처음 보는 기기»라며 확인을 요구했어요. 앱에서 «다시 로그인»을 눌러 주세요.");
  }
  if (/accounts\.kakao\.com/i.test(page.url())) {
    if (/비밀번호가 일치하지|아이디 또는 비밀번호|다시 확인해 주세요/.test(seen)) throw BLOCK("login_fail", "카카오 아이디 또는 비밀번호가 맞지 않아요.");
    throw BLOCK("login_fail", `카카오 로그인이 끝나지 않았어요 — 화면="${seen.slice(0, 120)}"`);
  }
}
