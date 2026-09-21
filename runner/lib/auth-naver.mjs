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
/**
 * classifyNaverSession — «로그인돼 있나»를 **순수하게** 가른다(2026-09-15 · 순수 함수로 분리).
 *   @param signals 요소 신호(2단계 판정용). 주면 `null` 을 내지 않고 반드시 true/false 를 낸다.
 *   @returns true(로그인됨) | false(로그아웃) | **null(주소만으로는 모름 — 요소로 한 번 더 본다)**
 *
 *   🔴 이 판정은 **양쪽이 다 비싸다**:
 *     · 로그아웃인데 «로그인됐다» → 로그인 단계를 건너뛰고 에디터에서 «세션 만료»로 죽는다(job #8 실측).
 *     · 로그인됐는데 «아니다»     → **매번 비밀번호 로그인**을 하고 그 반복이 캡차를 부른다(job #16 실측 · AC-19).
 *   그래서 **세 값**이다. 모르면 `null` 로 두고 요소를 한 번 더 본다 — «모른다»를 한쪽으로 접지 않는다(AC-9).
 *
 *   🔴 고친 것 둘(2026-09-15 · `scripts/verify-runner-auth.mts` 로 실측):
 *     ① 종전 주소 판정 `blog.naver.com/[A-Za-z0-9_-]{2,}` 은 **`PostList.naver` 같은 화면 이름도 id 로 읽었다.**
 *        제외 목록에 `MyBlog.naver` 와 `section.` 만 있어서, 그 밖의 `*.naver` 화면에 서 있으면
 *        **로그아웃인데 «로그인됐다»** 가 됐다(①번 실패 = 제일 비싼 쪽). ⇒ **«이름.naver» 는 id 가 아니다.**
 *     ② 마지막 폴백이 `a[href*="MyBlog"]` 였다 — «내 블로그» 링크는 **로그아웃 화면에도 있다**(눌러야 로그인으로 튕긴다).
 *        긍정 신호가 못 되는 걸 긍정 신호로 썼다. 게다가 주석은 «애매하면 로그아웃»이라 적혀 있는데
 *        코드는 그 자리에서 true 를 냈다 — 주석과 코드가 갈라져 있었다. ⇒ 뺐다.
 *        남은 진짜 긍정 신호는 **로그아웃 링크**(`nidlogin.logout`)뿐이다 — 그건 로그인 상태에서만 있다.
 */
export function classifyNaverSession(url, signals) {
  const u = String(url ?? "");
  if (/nidlogin/i.test(u)) return false;                       // 로그인 화면으로 튕겼다(돌아갈 주소가 쿼리에 실려 있어도 여긴 로그인 화면이다)

  if (!signals) {
    /* 주소로만 보는 1단계. `blog.naver.com/<id>` 인가 — 🔴 `<id>` 가 «이름.naver» 면 사람 id 가 아니다. */
    const m = /^https?:\/\/blog\.naver\.com\/([A-Za-z0-9_-]{2,})(?:[/?#]|$)/i.exec(u);
    if (m && !/\.naver$/i.test(m[1])) return true;
    return null;                                               // 모른다 — 호출자가 요소로 한 번 더 본다
  }

  /* 요소로 보는 2단계. **긍정 신호는 로그아웃 링크 하나뿐**이다. */
  if (Number(signals.logoutLinks ?? 0) > 0) return true;
  if (Number(signals.loginLinks ?? 0) > 0) return false;
  // 🔴 애매하면 **로그아웃**으로 본다 — 한 번 더 로그인하는 비용 < 조용히 실패하는 비용.
  return false;
}

export async function isNaverLoggedIn(page) {
  try {
    /* 🔴 2차 실측(2026-09-14 · 세션이 살아 있는 프로필로 재검): 종전 판정(blog.naver.com 의 로그아웃 링크·내 메뉴)은
       `section.blog.naver.com` SPA 가 **렌더되기 전(domcontentloaded)** 에 세고 있어서 살아 있는 세션에도 false 를 냈다.
       그래서 **매번 비밀번호 로그인**을 했고, 그 반복이 job #16 의 캡차를 불렀다. 긍정 신호를 잘못 골랐던 것이다.
       ⇒ 로그인이 필요한 주소(`MyBlog.naver`)를 열어 **어디로 보내는지**로 판정한다 — 로그인돼 있으면 `blog.naver.com/{내id}` 로,
          아니면 `nidlogin` 으로 간다. 렌더 타이밍과 무관한 서버측 판정이다. */
    await page.goto("https://blog.naver.com/MyBlog.naver", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await settle(page, 1200);
    const byUrl = classifyNaverSession(page.url());
    if (byUrl !== null) return byUrl;
    // 주소만으론 모른다 — 렌더를 기다렸다가 **요소**로 한 번 더 본다(판정 규칙은 위 순수 함수가 갖고 있다).
    await settle(page, 1500);
    const logoutLinks = await page.locator('a[href*="nidlogin.logout"]').count().catch(() => 0);
    const loginLinks = await page.locator('a[href*="nidlogin.login"]').count().catch(() => 0);
    return classifyNaverSession(page.url(), { logoutLinks, loginLinks });
  } catch { return false; }
}

/**
 * classifyNaverLoginWall — 로그인 시도 뒤 «무슨 벽에 막혔나»를 **순수하게** 가른다(2026-09-15 · 순수 함수로 분리).
 *   @returns { kind, message } | null(벽 없음 = 통과)
 *
 *   🔴 이 판정이 계정 상태를 움직인다(`lib/account-health.ts` 전이표):
 *        `login_fail`·`captcha` → 계정을 **`pending_login`** 으로 밀고 고객에게 «다시 로그인하세요»를 시킨다.
 *        `unknown`             → 계정은 **그대로**, 건강도만 깎인다(계정 잘못이 아니다).
 *      그래서 **모를 때 login_fail 을 쓰면 안 된다** — 멀쩡한 계정을 멈춰 세우고, 고객이 시키는 대로 재로그인을
 *      반복하면 그게 캡차를 부른다(이 파일 위쪽 job #16 실측이 바로 그 경로였다).
 *
 *   🔴 **종전에 여기 마지막 줄이 «아이디 또는 비밀번호가 맞지 않아요» 였다.** 로그인 화면에 남아 있기만 하면
 *      이유를 불문하고 그렇게 말했다 — 제출이 안 먹었든, 네이버가 새 안내 화면을 띄웠든, 느렸든.
 *      맞는 비밀번호를 쓴 고객에게 «비밀번호가 틀렸다»고 하고 계정을 세우는 것이라, **거짓 안내 + 비싼 부작용**이다.
 *      ⇒ 네이버가 **그렇게 말할 때만** 그렇게 부른다. 아니면 «끝나지 않았어요»(unknown)로 정직하게 남긴다(AC-10·AC-9).
 *
 *   🔴 순수 함수인 이유: 실계정 로그인은 **시도 자체가 캡차를 부른다**(AC-19). 그래서 화면 모양만 넣어 돌려 본다
 *      (`scripts/verify-runner-auth.mts`).
 */
export function classifyNaverLoginWall(url, seen, hasCaptchaEl = false) {
  const u = String(url ?? "");
  const t = String(seen ?? "");
  /* 🔴 벽 판정은 **로그인 도메인/화면일 때만** 한다. 성공해서 블로그로 넘어왔는데 그 글에 «2단계 인증» 같은
     낱말이 있다고 실패로 뒤집으면, 멀쩡한 계정을 멈춰 세운다(성공을 실패로 만드는 게 제일 나쁘다). */
  const onAuth = /nid\.naver\.com|nidlogin|captcha|deviceConfirm|idSafetyRelease|deviceRegist|need2|otp/i.test(u);
  if (!onAuth) return null;

  if (/captcha/i.test(u) || hasCaptchaEl) return { kind: "captcha", message: "네이버가 자동입력 방지(캡차)를 띄웠어요." };
  /* «처음 보는 기기»와 «보호조치»는 **다른 일**이다. 한 문구로 뭉뚱그리면 고객이 엉뚱한 걸 하고 돌아온다. */
  if (/idSafetyRelease/i.test(u)) {
    return { kind: "login_fail", message: "네이버가 이 계정에 **보호조치**를 걸었어요. 네이버에서 직접 해제한 뒤 «다시 로그인»을 눌러 주세요." };
  }
  if (/deviceConfirm|deviceRegist/i.test(u)) {
    return { kind: "login_fail", message: "네이버가 «처음 보는 기기»라며 등록을 요구했어요. 창에서 직접 로그인해 기기를 등록해 주세요." };
  }
  if (/need2|otp/i.test(u) || /2단계 인증/.test(t)) {
    return { kind: "login_fail", message: "이 계정은 **2단계 인증**이 켜져 있어 자동 로그인이 되지 않아요(비밀번호를 다시 넣어도 안 풀려요). 창에서 직접 로그인해 주세요." };
  }
  if (!/nidlogin/i.test(u)) return null;                       // 로그인 화면을 벗어났다 = 통과

  // 네이버가 **자기 입으로** 자격 오류라고 말할 때만 그렇게 부른다.
  if (/아이디 또는 비밀번호를? 잘못|비밀번호가 일치하지|등록되지 않은 아이디|다시 확인해\s*주세요/.test(t)) {
    return { kind: "login_fail", message: "아이디 또는 비밀번호가 맞지 않아요." };
  }
  /* 🔴 여기가 핵심 — **이유를 모르면 모른다고 한다.** 계정은 건드리지 않고(unknown = 전이 없음) 화면 글자를 남겨
     사람이 무엇이 있었는지 볼 수 있게 한다. 모르는 것을 «비밀번호 틀림»으로 바꾸지 않는다(AC-9). */
  return { kind: "unknown", message: `네이버 로그인이 끝나지 않았어요(이유를 확인하지 못했어요) — 화면="${t.slice(0, 120)}"` };
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
  const hasCaptchaEl = (await page.locator("#captcha, .captcha_wrap").count().catch(() => 0)) > 0;
  // 🔴 판정은 **화면에 보이는 글자**로(원본 HTML 로 재면 스크립트 속 낱말에 오분류된다 — 카카오 쪽에서 피 본 함정).
  const seen = ((await page.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  const wall = classifyNaverLoginWall(url, seen, hasCaptchaEl);
  if (wall) throw BLOCK(wall.kind, wall.message);
}

/** 로그인 보장 — 쿠키가 살아 있으면 건너뛰고, 아니면 id/pw 로 들어간다. */
export async function ensureNaverLogin(page, account) {
  if (await isNaverLoggedIn(page)) return "cookie";
  if (!account?.login?.id || !account?.login?.pw) throw BLOCK("login_fail", "저장된 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
  await naverLogin(page, account.login.id, account.login.pw);
  return "password";
}

/* ═══════════════════════ 🔴 «지금 내가 어느 블로그에 쓰고 있나» (AC-201 · B2 2026-09-21) ═══════════════════════
 *
 *   ══ 왜 ══
 *     `runner/channels/naver-blog.mjs` 는 `account.handle` 을 **그대로 믿고** `blog.naver.com/{handle}/postwrite` 로 간다.
 *     🔴 그 아이디가 틀리면 네이버는 **404 를 주지 않고 로그인한 사람의 블로그로 조용히 데려간다.**
 *        AM 실사고(2026-09 NAVERPUB): 원장 `qj_academy`(없는 아이디) → 네이버가 자사 `with_walk_on_office` 로 리다이렉트
 *        → **남의 블로그에 남의 글이 올라갔다.** 그리고 우리는 끝까지 «맞게 올렸다»고 알고 있었다.
 *     이 자리만은 **되돌릴 수 없다** — 남의 블로그에 한 번 나가면 우리가 못 내린다(§5E ③을 안 만들기로 했다).
 *
 *   ══ 사다리는 **하나**다 — 둘째를 만들었다가 **재 보고 뺐다**(2026-09-21) ══
 *     `myblog` — `blog.naver.com/MyBlog.naver` 는 **로그인이 필요한 주소**라 네이버가 «그 세션의 블로그»로 보낸다.
 *     서버측 리다이렉트라 렌더 타이밍과 무관하고, 남의 블로그가 섞일 길이 없다.
 *     (`isNaverLoggedIn` 이 이미 같은 주소로 로그인 여부를 판정한다 — 그때 **버리던 아이디**를 여기서 줍는 것이다.)
 *
 *   🔴 ══ 뺀 사다리와 왜 뺐는지 — AM `detectBlogIdOnPage` (2026-09-21 실측으로 죽였다) ══
 *     AM 은 `section.blog.naver.com/BlogHome.naver` 의 링크에서 아이디를 모아 **최빈값**(빈도 ≥2)을
 *     «내 블로그»로 삼는다. 그럴듯해서 폴백으로 넣었다가 **실제로 세 번 열어 봤다**(로그아웃 · 같은 화면):
 *       1회차 링크 96개 · 아이디 84개 · 최빈 5회 = aronmovie · liferecord689 · winsighting …
 *       2회차 같은 화면                 최빈 5회 = nuk1905 · lbmoon68 · minahan …
 *       3회차 같은 화면                 최빈 5회 = vicoy · uijae0622 · jae_ilsang …
 *     ⇒ **전부 생판 남의 블로그였고, 세 번이 서로 다 달랐다.** 이 화면의 최빈값은 «내 블로그»가 아니라
 *        **«오늘 네이버가 미는 블로그»**다 — 틀릴 뿐 아니라 **재현되지도 않는다.**
 *     🔴 그리고 그게 왜 위험한가(발행이 아니라 **장부**가 문제다):
 *        판정기는 약한 증거로 «다르다»를 선언하지 않으니 발행은 안 틀린다. 그런데 서버가 그 값을
 *        `accounts.identity.observed` 에 적고, 화면이 «이 주소가 맞나요?»로 **남의 블로그를 내밀고**,
 *        고객이 «맞아요»를 누르면 `confirmed` → `expectBlogId` 가 된다.
 *        ⇒ **가드가 자기 폴백에 무장해제된다.** 폴백이 본체를 죽이는 모양이라 없는 편이 낫다.
 *     ⚠️ 로그인 상태에서는 내 블로그가 더 자주 나올 **수도** 있다 — 그건 **안 재 봤다**(로컬에 로그인 프로필이 없다).
 *        재 보지 않은 것을 폴백으로 두지 않는다(AC-9). 이 파일 위쪽에서 `a[href*="MyBlog"]` 를 뺀 것과 **같은 판단**이다.
 *     `pickBlogIdFromLinks` 는 **남겨 뒀다**(`scripts/verify-blog-identity.mts` 가 지킨다) —
 *     다시 쓰려면 **로그인 상태로 재 보고** 쓰라는 뜻이다.
 *
 *   🔴 이 비대칭은 **비용이 비대칭이기 때문**이다: 헛된 «다르다» = 한 번 물어보면 끝 ·
 *      놓친 «다르다» = **남의 블로그에 발행**(되돌릴 수 없다). 그래도 약한 증거로 막지는 않는다 —
 *      멀쩡한 계정에 엉뚱한 주소를 들이미는 것도 값이 있다. 그래서 **못 쟀으면 못 쟀다고 한다**(AC-9).
 */

/** 블로그 아이디가 아닌 것들 — 네이버 화면 이름이 주소 첫 칸에 온다(AM NON_IDS + `*.naver` 규칙). */
export const NAVER_NON_IDS = new Set([
  "BlogHome", "FrontMain", "PostList", "MyBlog", "PostView", "PostThumbnailList", "GoBlogHome",
  "gnb", "section", "recommendation", "prologue", "guestbook", "api", "rss", "m",
]);

/**
 * 주소 한 개에서 블로그 아이디를 뽑는다(순수). 아이디가 아니면 **null**.
 *   🔴 `classifyNaverSession` 이 피 흘려 배운 규칙을 그대로 쓴다 — **«이름.naver» 는 아이디가 아니다.**
 *      그 줄이 없으면 `PostList.naver` 같은 화면 이름을 사람 아이디로 읽는다(2026-09-15 실측 ①번 실패).
 */
export function blogIdFromUrl(url) {
  const m = /^https?:\/\/(?:m\.)?blog\.naver\.com\/([A-Za-z0-9_-]{2,30})(?:[/?#]|$)/i.exec(String(url ?? "").trim());
  if (!m) return null;
  const id = m[1];
  if (/\.naver$/i.test(id) || NAVER_NON_IDS.has(id)) return null;
  return id;
}

/**
 * 링크 무더기에서 «내 블로그»를 고른다(순수 · AM `detectBlogIdOnPage` 의 최빈값 규칙).
 *   🔴 빈도 `minCount` 미만이면 **null** — 한 번 스친 링크를 «내 블로그»로 집으면 이웃 블로그를 집는다.
 */
export function pickBlogIdFromLinks(hrefs, minCount = 2) {
  const count = new Map();
  for (const h of hrefs ?? []) { const id = blogIdFromUrl(h); if (id) count.set(id, (count.get(id) ?? 0) + 1); }
  /* 🔴 동점이면 **아이디 사전순**으로 못 박는다 — Map 순서(=문서 등장 순서)에 맡기면 같은 화면에서
     실행마다 다른 답이 나오고, 그러면 «다르다»가 떴다 말았다 한다(재현 안 되는 판정이 제일 나쁘다). */
  const ranked = [...count.entries()].sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const top = ranked[0];
  return top && top[1] >= minCount ? top[0] : null;
}

/**
 * 🔴 지금 로그인된 세션이 **실제로 가진 블로그 주소**를 읽는다.
 *   @returns `{ blogId, via, why }` — 못 읽으면 `blogId:null` 과 사유(**「못 쟀음」이지 「같다」가 아니다**).
 *   ⚠️ 던지지 않는다 — 신원을 못 읽었다고 발행을 멈추면 그게 «모른다로 막기»다(§9 · AC-9).
 */
export async function readMyBlogId(page) {
  /* 로그인이 필요한 주소로 가서 **어디로 보내는지** 본다(서버측 판정 · 렌더 타이밍 무관).
     🔴 못 읽으면 **거기서 끝난다 — 폴백을 두지 않는다.** 둘째 사다리를 만들었다가 재 보니
        남의 블로그를 집어 왔다(위 머리말 실측). 「모른다」를 그럴듯한 값으로 메우지 않는다(AC-9). */
  try {
    await page.goto("https://blog.naver.com/MyBlog.naver", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await settle(page, 1000);
    const id = blogIdFromUrl(page.url());
    if (id) return { blogId: id, via: "myblog", why: null };
    if (/nidlogin/i.test(page.url())) return { blogId: null, via: null, why: "logged_out" };
    return { blogId: null, via: null, why: `unexpected_url:${page.url().slice(0, 40)}` };
  } catch (e) {
    return { blogId: null, via: null, why: `read_failed:${String(e?.message ?? e).slice(0, 40)}` };
  }
}

/**
 * 🔴 판정(순수) — 장부의 handle 과 실제로 본 블로그를 댄다.
 *   @param handle    장부에 적힌 블로그 아이디(`accounts.handle`)
 *   @param observed  러너가 실제로 본 아이디(못 봤으면 null)
 *   @param via       어느 사다리로 봤나(`myblog` 만 «다르다»를 선언할 수 있다)
 *   @param confirmed 고객이 «이 주소가 맞다»고 이미 확인해 준 아이디(`accounts.identity.confirmed`)
 *   @returns kind —
 *     `match`      장부와 같다 → 그대로 간다
 *     `confirmed`  장부와는 다른데 **고객이 이미 확인한 주소**다 → 그대로 간다(🔴 네이버는 아이디와 블로그 주소가 다를 수 있다)
 *     `mismatch`   🔴 다른 블로그다 → **아무것도 쓰기 전에 멈추고 한 번 묻는다**(되돌릴 수 없는 동작의 확인 · §9 밖)
 *     `unmeasured` 못 쟀거나 약한 증거뿐 → 그대로 가되 **「못 쟀음」으로 남긴다**(AC-9)
 */
export function judgeBlogIdentity({ handle, observed, via, confirmed }) {
  const want = String(handle ?? "").replace(/^@/, "").trim().toLowerCase();
  const got = String(observed ?? "").trim().toLowerCase();
  const okd = String(confirmed ?? "").trim().toLowerCase();
  if (!got) return { kind: "unmeasured", want, got: null, via: via ?? null, why: "not_read" };
  if (want && got === want) return { kind: "match", want, got, via: via ?? null };
  if (okd && got === okd) return { kind: "confirmed", want, got, via: via ?? null };
  /* 🔴 약한 증거(`links`)로는 «다르다»를 선언하지 않는다 — 그 화면엔 이웃·추천 블로그 링크가 섞여 있다. */
  if (via !== "myblog") return { kind: "unmeasured", want, got, via: via ?? null, why: "weak_evidence" };
  /* 장부가 **비어 있으면** 댈 것이 없다 — 막지 말고 본 것을 적어 준다(신규 연결 직후 · AM 도 이때는 폴백한다). */
  if (!want) return { kind: "unmeasured", want, got, via, why: "no_handle" };
  return { kind: "mismatch", want, got, via };
}
