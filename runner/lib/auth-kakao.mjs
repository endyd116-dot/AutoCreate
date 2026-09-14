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
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && await stillAuth()) await settle(page, 2000);
    seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    await step("k3-2단계후");
  }

  /* 🔴 카카오 인증이 끝나도 **티스토리로 돌아오는 콜백**이 남아 있다. 그게 끝나기 전에 다음 단계로 가면
     «로그인은 됐는데 관리 화면에 못 들어갔다»가 된다(2026-09-14 실측 job #13 — 화면은 티스토리 로그인 페이지였다).
     주소가 tistory 로 돌아올 때까지 최대 30초 기다린다. */
  {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && !/tistory\.com/i.test(page.url())) {
      if (KAKAO_AUTH_HOST.test(page.url()) && waitMs <= 0) break;   // 운영(헤드리스)에서는 붙들지 않는다
      await settle(page, 1500);
    }
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
