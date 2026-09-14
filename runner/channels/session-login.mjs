/**
 * runner/channels/session-login.mjs — 헤드풀 로그인(계약 §2 `session.login` · DESIGN §7.2 재로그인 흐름).
 *   사람이 창에서 직접 로그인한다 → 쿠키를 회수해 서버로 올린다(`runner-session-upload`).
 *
 *   🔴 여기가 캡차·2단계·기기등록의 **정답**이다. 자동 로그인으로 뚫으려 들면 계정이 잠긴다.
 *      AM 실측: 사람이 한 번 풀어 준 세션을 저장하자 다음 실행부터 로그인 단계 자체가 사라졌다.
 *   🔴 평문(쿠키)은 HTTPS 본문으로만 나간다 — 파일·로그에 남기지 않는다.
 */
import { shot, settle } from "../lib/browser.mjs";
import { passKakaoConsent } from "../lib/auth-kakao.mjs";
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
  while (Date.now() < deadline) {
    await settle(page, 2000);
    if (page.isClosed()) throw BLOCK("login_fail", "로그인 창이 닫혔어요. 앱에서 다시 시도해 주세요.");
    try {
      // 카카오 동의 화면이면 대신 눌러 준다(2FA 는 사람이 이미 함). naver 는 이 함수가 false 로 넘긴다.
      if (channel === "tistory") await passKakaoConsent(page).catch(() => {});
      if (target.done(page)) { await settle(page, 2500); done = true; break; }
    } catch { /* 이동 중 */ }
  }
  if (!done) throw BLOCK("login_fail", `${Math.round(WAIT_MS / 60_000)}분 안에 로그인이 끝나지 않았어요. 앱에서 다시 시도해 주세요.`);

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
