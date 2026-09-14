/**
 * runner/lib/auth-naver.mjs — 네이버 로그인(공용). 네이버 블로그·애드포스트·클립이 같은 nid 세션을 쓴다.
 *   channels/naver-blog.mjs 에서 2026-09-14 실측·수리(AC-9·AC-10 반영)된 것을 그대로 옮겼다 — 로직 변경 0.
 *   🔴 실패는 마커(`[block:kind]`)로 정직 분류 · 재시도는 호출자가 하지 않는다(네이버는 반복 실패로 계정을 잠근다).
 */
import { settle } from "./browser.mjs";

export const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

/* ───────────────────── 로그인 ───────────────────── */

/**
 * 로그인 여부 — 🔴 **긍정 신호로만** 판정한다.
 *   종전에 «nidlogin 주소가 아니면 로그인됨» 으로 뒀더니 로그아웃 상태의 blog.naver.com 도 통과해
 *   **로그인 단계를 통째로 건너뛰고** 에디터에서 «세션 만료»로 죽었다(2026-09-14 자사 테스트 계정 실측 job #8).
 *   «아닌 것이 없다» 는 «맞다» 가 아니다 — 로그아웃 링크(=로그인 상태의 증거)를 본다.
 *   판정이 애매하면 **로그아웃으로 본다**(한 번 더 로그인하는 비용 < 조용히 실패하는 비용).
 */
export async function isNaverLoggedIn(page) {
  try {
    await page.goto("https://blog.naver.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (/nidlogin/i.test(page.url())) return false;
    const out = await page.locator('a[href*="nidlogin.logout"], a[href*="nid.naver.com/nidlogin.logout"]').count().catch(() => 0);
    if (out > 0) return true;
    // 로그인 링크가 보이면 확실히 로그아웃 상태.
    const inLink = await page.locator('a[href*="nidlogin.login"], a:has-text("로그인")').count().catch(() => 0);
    if (inLink > 0) return false;
    // 내 블로그 메뉴(로그인해야 뜬다) — 마지막 긍정 신호.
    return (await page.locator('.gnb_my, [class*="MyArea"], a[href*="MyBlog"]').count().catch(() => 0)) > 0;
  } catch { return false; }
}

/** id/pw 자동 로그인. 캡차·기기등록·2단계는 **정직 실패**(사람이 해야 풀린다). */
export async function naverLogin(page, id, pw) {
  await page.goto("https://nid.naver.com/nidlogin.login", { waitUntil: "domcontentloaded", timeout: 30_000 });
  /* 이미 로그인돼 있으면 네이버가 로그인 화면에서 되돌려 보낸다 — 그걸 «폼을 못 찾았다»(selector_changed)로
     읽으면 멀쩡한 계정에 «우리 버그» 딱지가 붙는다. 폼이 없고 주소도 로그인 화면이 아니면 그냥 통과시킨다. */
  // domcontentloaded 직후 바로 입력하면 폼 JS 초기화 전이라 값이 유실된다(AM 실측) — 보일 때까지 기다린다.
  const formShown = await page.locator("#id").waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);
  if (!formShown && !/nidlogin/i.test(page.url())) return;
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

  /* 사람이 옆에 있을 때만(헤드풀 검증·재로그인) 캡차·기기확인을 **기다려 준다**. 기본값 0 = 기다리지 않는다.
     🔴 운영(헤드리스)에서는 절대 기다리면 안 된다 — 아무도 없는 창 앞에서 잡을 붙들고 큐를 굶긴다. */
  const waitMs = Number(process.env.AC_2FA_WAIT_MS ?? 0) || 0;
  if (waitMs > 0 && /captcha|deviceConfirm|idSafetyRelease|need2/i.test(page.url())) {
    console.log(`  · 네이버가 추가 확인을 요구했어요 — 창에서 직접 풀어 주세요(최대 ${Math.round(waitMs / 1000)}초 대기).`);
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline && /captcha|deviceConfirm|idSafetyRelease|need2|nidlogin/i.test(page.url())) await settle(page, 2000);
  }

  const url = page.url();
  if (/captcha/i.test(url) || (await page.locator("#captcha, .captcha_wrap").count().catch(() => 0)) > 0) {
    throw BLOCK("captcha", "네이버가 자동입력 방지(캡차)를 띄웠어요.");
  }
  if (/deviceConfirm|idSafetyRelease|deviceRegist/i.test(url)) throw BLOCK("login_fail", "네이버가 «처음 보는 기기»라며 등록을 요구했어요.");
  if (/need2|otp/i.test(url)) throw BLOCK("login_fail", "이 계정은 2단계 인증이 켜져 있어 자동 로그인이 되지 않아요.");
  if (/nidlogin/i.test(page.url())) throw BLOCK("login_fail", "아이디 또는 비밀번호가 맞지 않아요.");
}

/** 로그인 보장 — 쿠키가 살아 있으면 건너뛰고, 아니면 id/pw 로 들어간다. */
export async function ensureNaverLogin(page, account) {
  if (await isNaverLoggedIn(page)) return "cookie";
  if (!account?.login?.id || !account?.login?.pw) throw BLOCK("login_fail", "저장된 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
  await naverLogin(page, account.login.id, account.login.pw);
  return "password";
}
