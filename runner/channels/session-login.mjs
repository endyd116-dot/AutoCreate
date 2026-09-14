/**
 * runner/channels/session-login.mjs — 헤드풀 로그인(계약 §2 `session.login` · DESIGN §7.2 재로그인 흐름).
 *   사람이 창에서 직접 로그인한다 → 쿠키를 회수해 서버로 올린다(`runner-session-upload`).
 *
 *   🔴 여기가 캡차·2단계·기기등록의 **정답**이다. 자동 로그인으로 뚫으려 들면 계정이 잠긴다.
 *      AM 실측: 사람이 한 번 풀어 준 세션을 저장하자 다음 실행부터 로그인 단계 자체가 사라졌다.
 *   🔴 평문(쿠키)은 HTTPS 본문으로만 나간다 — 파일·로그에 남기지 않는다.
 */
import { shot, settle } from "../lib/browser.mjs";
import { passKakaoConsent, kakaoLogin } from "../lib/auth-kakao.mjs";
import { uploadSession } from "../lib/api.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

/** 사람이 로그인을 끝낼 때까지 기다리는 시간(기본 5분). */
const WAIT_MS = Number(process.env.AC_LOGIN_WAIT_MS ?? 5 * 60_000);

const TARGETS = {
  /* 구글(블로거 대시보드 «수익» 탭 읽기용). 자동 로그인은 절대 안 한다 — 봇 탐지·2단계가 가장 세다. 사람이 창에서 한다. */
  blogger: {
    loginUrl: "https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fwww.blogger.com%2F",
    homeUrl: "https://www.blogger.com/",
    done: (page) => /blogger\.com/i.test(page.url()) && !/accounts\.google\.com/i.test(page.url()),
    cookieUrls: ["https://www.blogger.com", "https://accounts.google.com", "https://google.com"],
    tips: ["구글 계정으로 로그인해 주세요(2단계가 있으면 휴대폰에서 승인)."],
  },
  naver_blog: {
    loginUrl: "https://nid.naver.com/nidlogin.login",
    homeUrl: "https://blog.naver.com",
    done: (page) => !/nidlogin/i.test(page.url()),
    cookieUrls: ["https://naver.com", "https://blog.naver.com", "https://nid.naver.com"],
    /* 🔴 «로그인 상태 유지»를 켜야 세션이 장수명 쿠키가 된다 — 안 켜면 창을 닫는 순간 만료돼
       저장해도 다음 회차에 다시 로그인을 물어본다(AM 이 근본 수리한 자리). */
    tips: ["«로그인 상태 유지»를 꼭 켜 주세요(안 켜면 다음에 또 로그인해야 해요)."],
  },
  tistory: {
    loginUrl: "https://www.tistory.com/auth/login",
    homeUrl: "https://www.tistory.com",
    /* 🔴 완료 = **티스토리 서비스 도메인에 실제 도착**(관리/블로그). kauth·accounts·auth/login 은 아직 진행 중 —
       종전 `!/auth\/login|accounts\.kakao\.com/` 은 kauth.kakao.com 동의 화면을 «완료»로 오판정했다(job #87). */
    done: (page) => /(^|\.)tistory\.com/i.test((() => { try { return new URL(page.url()).host; } catch { return ""; } })()) && !/\/auth\/login/i.test(page.url()),
    cookieUrls: ["https://www.tistory.com", "https://tistory.com", "https://accounts.kakao.com", "https://kauth.kakao.com"],
    /* 🔴 실측(2026-09-14 자사 테스트 블로그 note83685): 카카오 계정은 아이디·비밀번호가 맞아도 **2단계 인증**에서 멈춘다
       («카카오톡으로 로그인 확인 메시지가 전송되었습니다» · 남은 시간 5분). 그 화면에
       «이 브라우저에서 2단계 인증 사용 안 함» 체크가 있고, **그걸 켜야** 다음부터 자동 발행이 로그인 없이 돈다.
       우리가 대신 켜지 않는다 — 계정 보안 설정은 주인이 정할 일이다. 대신 그 자리에서 알려 준다. */
    tips: [
      "카카오톡으로 온 «로그인 확인» 메시지를 눌러 주세요(2단계 인증).",
      "그 화면의 «이 브라우저에서 2단계 인증 사용 안 함»을 켜 두면 다음부터 자동으로 올라가요.",
    ],
    /* 🔴 첫 화면의 노란 «카카오계정으로 로그인» 은 **우리가 눌러 준다** — 자격증명이 아니라 단순 이동이다.
       2026-09-14 실측(job #103): 이 버튼을 사람이 찾아 눌러야 해서, 창만 띄워 두고 5분을 그대로 흘려보냈다
       (스냅샷 00-로그인창 이 첫 화면 그대로였다). 사람 손은 **카카오 아이디·비번·2단계**에만 가야 한다. */
    enter: async (page) => {
      const btn = page.locator([
        'a:has-text("카카오계정으로 로그인")',
        'button:has-text("카카오계정으로 로그인")',
        'a[href*="/auth/login/kakao"]',
        "a.link_kakao_id",
      ].join(", ")).first();
      await btn.click({ timeout: 6000 });
    },
  },
};

export async function run({ ctx, job, token, shotKey }) {
  const account = job.account ?? {};
  const channel = String(account.channel ?? "");
  const target = TARGETS[channel];
  if (!target) throw BLOCK("unknown", `아직 «${channel}» 은 창 로그인을 지원하지 않아요.`);

  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.goto(target.loginUrl, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => {});
  await shot(page, shotKey, "00-로그인창");
  /* 로그인 «시작» 버튼까지는 우리가 눌러 사람을 아이디/비번 화면 앞에 데려다 놓는다(자격증명 입력은 사람 몫).
     실패해도 치명적이지 않다 — 사람이 직접 누르면 된다. */
  if (target.enter) {
    await target.enter(page).catch(() => {});
    await settle(page, 2500);
    await shot(page, shotKey, "01-로그인화면");
  }

  /* 🔴 아이디·비밀번호는 **우리가 채운다** — 사람 손은 «2단계 인증»에만 간다(위 안내 문구가 약속하는 바 그대로).
     ⚠️ 폐지한 것은 «무인 자동로그인»(사람 없이 발행 잡이 혼자 로그인 → 카카오 OAuth 콜백 루프)이지,
        **사람이 보는 앞에서 자격을 채워 주는 것**이 아니다. 이 둘을 같이 걷어내는 바람에 안내는
        «2단계만 눌러 주세요»인데 정작 아이디·비번이 비어 있었다(2026-09-14 실측 job #103·#105·#111 · 사장님 확인).
     실패해도 치명적이지 않다 — 사람이 창에서 직접 입력하면 된다(자격은 러너 메모리에만 있고 로그·파일에 남기지 않는다). */
  if (channel === "tistory" && account.login?.id && account.login?.pw) {
    console.log("  · 아이디·비밀번호를 대신 입력합니다 — 사장님은 «2단계 인증»만 해 주세요.");
    await kakaoLogin(page, account.login.id, account.login.pw, shotKey)
      .catch((e) => console.log(`  · 자동 입력을 못 했어요(창에서 직접 입력해 주세요): ${String(e?.message ?? e).slice(0, 90)}`));
    await settle(page, 1500);
  }

  console.log("");
  console.log("  ┌───────────────────────────────────────────────────────────┐");
  console.log(`  │  열린 창에서 «${String(account.handle ?? "").slice(0, 20)}» 계정으로 로그인해 주세요.`);
  console.log("  │  로그인이 끝나면 자동으로 저장됩니다(창을 닫지 마세요).");
  for (const line of target.tips ?? []) console.log(`  │  ▸ ${line}`);
  console.log(`  │  최대 ${Math.round(WAIT_MS / 60_000)}분 기다립니다.`);
  console.log("  └───────────────────────────────────────────────────────────┘");
  console.log("");

  /* 사람이 아이디·비번·2단계(휴대폰 승인)를 한다. 카카오 «계속하기»(동의) 화면은 우리가 눌러 준다 —
     그 화면은 봇 판정 대상이 아니라 사람 세션의 단순 확인이라, 여기서 통과시켜 주면 사람 부담이 준다(2026-09-14 근본 수리).
     🔴 완료 판정은 target.done(반드시 tistory/naver 서비스 도메인 도달) 로 — kauth·accounts 중간 화면을 «완료»로 오판정하지 않는다. */
  const deadline = Date.now() + WAIT_MS;
  let done = false;
  /* 🔴 화면 이동을 **추적**한다(사장님 지시 2026-09-14: «실패하기 직전에 사진을 찍어 어떤 플로우로 가는지 보고 근본수리»).
     로그인이 5분 안에 안 끝났을 때 «어디서 멈췄나»를 모르면 고칠 수가 없다 — URL 이 바뀔 때마다 한 줄 남기고,
     끝내 실패하면 **그 순간의 화면**을 99-멈춘화면 으로 찍는다. */
  const trail = [];
  let lastUrl = "";
  while (Date.now() < deadline) {
    await settle(page, 2000);
    if (page.isClosed()) {
      throw BLOCK("login_fail", `로그인 창이 닫혔어요. 앱에서 다시 시도해 주세요.${trail.length ? ` (마지막 화면: ${trail[trail.length - 1]})` : ""}`);
    }
    try {
      const u = page.url();
      if (u && u !== lastUrl) {
        lastUrl = u;
        trail.push(u.slice(0, 120));
        console.log(`  · 지금 화면 → ${u.slice(0, 110)}`);
      }
      // 카카오 동의 화면이면 대신 눌러 준다(2FA 는 사람이 이미 함). naver 는 이 함수가 false 로 넘긴다.
      if (channel === "tistory") await passKakaoConsent(page).catch(() => {});
      if (target.done(page)) { await settle(page, 2500); done = true; break; }
    } catch { /* 이동 중 */ }
  }
  if (!done) {
    await shot(page, shotKey, "99-멈춘화면").catch(() => {});
    console.log(`  · 거쳐 간 화면 ${trail.length}개: ${trail.join(" → ").slice(0, 500)}`);
    throw BLOCK("login_fail", `${Math.round(WAIT_MS / 60_000)}분 안에 로그인이 끝나지 않았어요. 멈춘 화면: ${lastUrl.slice(0, 100) || "(알 수 없음)"}`);
  }

  // 홈으로 한 번 더 들러 서비스 쿠키까지 받는다(로그인 도메인 쿠키만으로는 부족할 수 있다).
  await page.goto(target.homeUrl, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
  await settle(page, 1500);
  await shot(page, shotKey, "01-로그인완료");

  const cookies = await ctx.cookies(target.cookieUrls).catch(() => []);
  if (!cookies.length) throw BLOCK("login_fail", "로그인 정보를 읽지 못했어요. 다시 한 번 시도해 주세요.");

  // 🔴 평문 쿠키는 여기서 바로 서버(HTTPS)로. 화면·파일에는 개수만 남는다.
  const up = await uploadSession(token, Number(account.id), cookies, new Date().toISOString());
  if (!up?.ok) throw BLOCK("unknown", `로그인 정보를 서버에 저장하지 못했어요(${String(up?.error ?? "").slice(0, 60)}).`);

  console.log(`  ✓ 로그인 정보를 저장했어요(쿠키 ${cookies.length}개). 이제 예약된 글이 자동으로 올라갑니다.`);
  return { sessionSaved: true, cookies: cookies.length, notes: [`쿠키 ${cookies.length}개 저장`] };
}

export const channel = "session";
