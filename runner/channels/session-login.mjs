/**
 * runner/channels/session-login.mjs — 헤드풀 로그인(계약 §2 `session.login` · DESIGN §7.2 재로그인 흐름).
 *   사람이 창에서 직접 로그인한다 → 쿠키를 회수해 서버로 올린다(`runner-session-upload`).
 *
 *   🔴 여기가 캡차·2단계·기기등록의 **정답**이다. 자동 로그인으로 뚫으려 들면 계정이 잠긴다.
 *      AM 실측: 사람이 한 번 풀어 준 세션을 저장하자 다음 실행부터 로그인 단계 자체가 사라졌다.
 *   🔴 평문(쿠키)은 HTTPS 본문으로만 나간다 — 파일·로그에 남기지 않는다.
 */
import { shot, settle } from "../lib/browser.mjs";
import { uploadSession } from "../lib/api.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

/** 사람이 로그인을 끝낼 때까지 기다리는 시간(기본 5분). */
const WAIT_MS = Number(process.env.AC_LOGIN_WAIT_MS ?? 5 * 60_000);

const TARGETS = {
  naver_blog: {
    loginUrl: "https://nid.naver.com/nidlogin.login",
    homeUrl: "https://blog.naver.com",
    done: (page) => !/nidlogin/i.test(page.url()),
    cookieUrls: ["https://naver.com", "https://blog.naver.com", "https://nid.naver.com"],
  },
  tistory: {
    loginUrl: "https://www.tistory.com/auth/login",
    homeUrl: "https://www.tistory.com",
    done: (page) => !/auth\/login|accounts\.kakao\.com/i.test(page.url()),
    cookieUrls: ["https://www.tistory.com", "https://tistory.com"],
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
  console.log(`  │  최대 ${Math.round(WAIT_MS / 60_000)}분 기다립니다.`);
  console.log("  └───────────────────────────────────────────────────────────┘");
  console.log("");

  // 사람이 끝낼 때까지 폴링. 캡차·2단계는 사람이 푼다 — 우리는 기다리기만 한다.
  const deadline = Date.now() + WAIT_MS;
  let done = false;
  while (Date.now() < deadline) {
    await settle(page, 2000);
    if (page.isClosed()) throw BLOCK("login_fail", "로그인 창이 닫혔어요. 앱에서 다시 시도해 주세요.");
    try { if (target.done(page)) { await settle(page, 2500); done = true; break; } } catch { /* 이동 중 */ }
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
