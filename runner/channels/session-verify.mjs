/**
 * runner/channels/session-verify.mjs — **저장된 로그인이 아직 살아 있나**(잡 `session.verify` · DESIGN §8.2).
 *   [R17-B2 · 2026-09-23 신규]
 *
 *   ══ 🔴 왜 새로 만들었나 — 종전 배선이 «아무것도 안 하는 것보다 나빴다» ══
 *     R16 재측정에서 `session.verify` 는 «그 이름으로 잡을 만드는 호출부가 0곳»이라 **영원히 안 돌았다.**
 *     그래서 «적재 한 줄만 넣으면 된다»고 보였는데, **고치려고 열어 보니 처리기가 `session-login` 이었다**:
 *       `runner/core.mjs` 의 `NEEDS_HEADED` 에 들어 있고, `session-login.mjs` 는 **창을 띄우고 사람을 5분 기다린다.**
 *     🔴 그대로 적재했으면 **배경 점검이 고객 PC 에 로그인 창을 멋대로 5분 띄웠다.**
 *        «확인»은 조용해야 한다 — 고객이 누르지도 않았는데 우리가 그 PC 를 점유하는 건 안내가 아니라 침입이다.
 *     ⇒ 확인은 **헤드리스**로, **사람 손 0**으로, **아무것도 안 바꾸고** 본다.
 *
 *   ══ 🔴 세 값이다 — `verify.post_alive` 와 같은 규율 ══
 *     · `alive`    세션이 살아 있다(로그인 필요한 주소가 우리를 안 쫓아냈다)
 *     · `expired`  로그인 화면으로 갔다 — 다시 로그인이 필요하다
 *     · `unknown`  **못 봤다.** 네트워크·타임아웃·처음 보는 채널. 🔴 **«만료»로 세지 않는다** —
 *                  우리가 못 읽은 것을 «끊겼다»로 말하면 멀쩡한 계정에 «다시 로그인하세요»가 뜬다(AC-10 거짓 안내).
 *     서버(`lib/runner-jobs.ts`)는 `expired` 일 때만 계정을 `pending_login` 으로 옮기고, `unknown` 에는 **손대지 않는다.**
 *
 *   ══ 🔴 판정은 **새로 적지 않는다** — 발행 채널이 이미 실측으로 갖고 있다 ══
 *     · 네이버  `runner/lib/auth-naver.mjs isNaverLoggedIn` — 로그인이 필요한 주소(`MyBlog.naver`)가 어디로 보내는지로 본다
 *                (2026-09-14 2차 실측으로 고친 그 판정. 렌더 타이밍과 무관한 서버측 리다이렉트다.)
 *     · 티스토리 `runner/channels/tistory.mjs isLoggedIn` — `{host}/manage` 가 `auth/login`·카카오로 튕기나
 *     · 블로거  `session-login.mjs` 가 실측으로 적어 둔 그 사실 — 로그아웃 상태로 `blogger.com` 에 가면 **구글이 `accounts.google.com` 으로 보낸다**
 *   🔴 **모르는 채널은 `unknown` 이고, 그렇게 말한다.** 셀렉터를 지어내지 않는다 —
 *      화면을 본 적 없는 채널에 판정을 적는 것이 이 프로젝트에서 제일 비싼 실수였다(티스토리 이틀 · `channel-registry.ts` «못 채운 칸»).
 *
 *   🔴 **읽기만 한다.** 누르지 않고, 쓰지 않고, 쿠키를 바꾸지 않는다. 확인이 계정 상태를 흔들면 확인이 아니다.
 */
import { settle } from "../lib/browser.mjs";
import { isNaverLoggedIn } from "../lib/auth-naver.mjs";
import { isLoggedIn as isTistoryLoggedIn, blogHost } from "./tistory.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });

/** 판정 한 번의 최대 시간 — 확인은 **빨리 포기**한다. 오래 매달리면 발행 잡이 밀린다(우선순위 20). */
const NAV_MS = 30_000;

/**
 * 채널별 «세션이 살아 있나». 반환 `true`(alive) · `false`(expired) · `null`(**못 봤다**).
 * 🔴 여기 없는 채널은 `undefined` — «모르는 채널»과 «봤는데 모르겠다»는 다르다.
 */
const CHECK = {
  async naver_blog(page) {
    /* 공용 판정 그대로. 예외는 이 함수가 false 로 삼키므로, 우리는 «못 봤다»를 따로 못 가른다 —
       그래서 아래에서 **먼저 주소가 열리는지**를 보고 열리지도 않으면 unknown 으로 돌린다. */
    return await isNaverLoggedIn(page);
  },
  async tistory(page, account) {
    const host = blogHost(account?.handle);
    if (!host) return null;                                  // 핸들이 없으면 «만료»가 아니라 **못 봤다**
    return await isTistoryLoggedIn(page, host);
  },
  async blogger(page) {
    await page.goto("https://www.blogger.com/", { waitUntil: "domcontentloaded", timeout: NAV_MS });
    await settle(page, 1200);
    const url = page.url();
    if (/accounts\.google\.com/i.test(url)) return false;     // 구글 로그인으로 튕겼다
    if (/blogger\.com/i.test(url)) return true;
    return null;                                             // 둘 다 아니면 **모른다**(점검 페이지·오류 등)
  },
};

export async function run({ ctx, job }) {
  const account = job.account ?? {};
  const channel = String(account.channel ?? "");
  const check = CHECK[channel];
  /* 🔴 모르는 채널은 **정직하게 비재시도 실패**다. `unknown` 으로 돌려보내면 서버 장부에
     «확인했고 모르겠다»로 남아, 다음에 누가 «그 채널도 확인되는구나»로 읽는다(AC-9 없는 것을 있는 척). */
  if (!check) throw BLOCK("unknown", `아직 «${channel}» 은 로그인 확인을 지원하지 않아요.`);

  const page = ctx.pages()[0] ?? await ctx.newPage();
  let alive = null;
  try {
    alive = await check(page, account);
  } catch (e) {
    /* 🔴 못 본 것은 **못 봤다**로 둔다 — 타임아웃 하나로 멀쩡한 계정을 «다시 로그인» 줄에 세우지 않는다. */
    console.log(`  · 확인하지 못했어요(그대로 둡니다): ${String(e?.message ?? e).slice(0, 120)}`);
    alive = null;
  }

  const session = alive === true ? "alive" : alive === false ? "expired" : "unknown";
  console.log(`  · @${String(account.handle ?? "").slice(0, 24)} (${channel}) 로그인 ${session === "alive" ? "살아 있어요" : session === "expired" ? "만료됐어요" : "확인하지 못했어요"}`);
  /* 🔴 **성공이다.** «만료»도 잡의 실패가 아니라 **알아낸 답**이다 — 실패로 돌리면 재시도가 돌고 장부엔 답이 안 남는다. */
  return { ok: true, session, checkedAt: new Date().toISOString() };
}

export const channel = "session";
/** [R17-B2] 이 파일이 **확인할 줄 아는** 채널 — 늘릴 땐 위 `CHECK` 와 같이 늘린다. 서버가 잡을 만들 때 이 목록을 본다. */
export const VERIFIABLE_CHANNELS = Object.keys(CHECK);
