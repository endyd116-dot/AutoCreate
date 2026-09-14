/**
 * runner/channels/ads-setup-tistory.mjs — 티스토리 «수익 → 애드센스» 연결 **상태 읽기**(계약 P1R3 §2.2 · DESIGN §9.0).
 *   AC 신규 2026-09-14(B2).
 *
 *   🔴 **읽기만 한다.** 설정을 바꾸는 것(애드센스 연동·광고 위치)은 사용자가 헤드풀로 승인한 경우만이고, 그 경로는
 *      이 잡이 아니라 `session.login` 창에서 사람이 직접 한다. 우리가 남의 수익 설정을 임의로 건드리지 않는다.
 *   산출: `adsense:{ linked, state, detail }` — 화면 문구로 «연결됨/미연결/심사중»을 가른다. 못 가르면 `state:"unknown"`(거짓 단정 금지).
 *   ⚠️ 수익 설정 주소는 **실측 전 추정**(`/manage/adsense` 계열). 자사 블로그가 카카오 2단계를 넘어야 확정된다.
 */
import { shot, failShot, settle } from "../lib/browser.mjs";
import { BLOCK, KAKAO_AUTH_HOST, kakaoLogin } from "../lib/auth-kakao.mjs";
import { visibleText, gotoFirst } from "../lib/scrape.mjs";

function blogHost(handle) {
  const h = String(handle ?? "").replace(/^@/, "").trim();
  if (!h) return null;
  if (/^https?:\/\//i.test(h)) { try { return new URL(h).host; } catch { return null; } }
  return h.includes(".") ? h : `${h}.tistory.com`;
}

const LINKED_RE = /연동\s*(완료|됨)|연결\s*(완료|됨)|승인\s*(완료|됨)|광고\s*(게재|노출)\s*중|사용\s*중/;
const PENDING_RE = /심사\s*중|검토\s*중|승인\s*대기|준비\s*중/;
const NOT_RE = /연동하기|연결하기|애드센스\s*(계정)?\s*연결|시작하기|신청하기|연동되지|연결되지/;

export async function run({ ctx, job, shotKey }) {
  const account = job.account ?? {};
  const host = blogHost(account.handle);
  if (!host) throw BLOCK("login_fail", "티스토리 블로그 주소(핸들)가 없어요.");
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    // 로그인 확인 — 관리 화면이 로그인으로 튕기면 카카오로 들어간다(티스토리 채널과 같은 길).
    await page.goto(`https://${host}/manage`, { waitUntil: "domcontentloaded", timeout: 40_000 }).catch(() => {});
    await settle(page, 1500);
    if (/auth\/login|accounts\.kakao\.com/i.test(page.url())) {
      if (!account.login?.id || !account.login?.pw) throw BLOCK("login_fail", "저장된 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
      if (!KAKAO_AUTH_HOST.test(page.url())) await page.goto("https://www.tistory.com/auth/login", { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => {});
      await kakaoLogin(page, account.login.id, account.login.pw, shotKey);
    }
    await shot(page, shotKey, "00-관리화면");

    const landed = await gotoFirst(page, [
      `https://${host}/manage/adsense`,
      `https://${host}/manage/setting/adsense`,
      `https://${host}/manage/monetize`,
      `https://${host}/manage/setting/monetize`,
    ], async (p) => !/auth\/login|accounts\.kakao\.com/i.test(p.url()) && /manage/.test(p.url()));
    if (!landed) throw BLOCK("login_fail", "수익 설정 화면에 들어가지 못했어요(세션 만료).");
    await shot(page, shotKey, "01-수익설정");
    const seen = await visibleText(page);

    let state = "unknown", linked = false;
    if (LINKED_RE.test(seen)) { state = "linked"; linked = true; }
    else if (PENDING_RE.test(seen)) state = "pending";
    else if (NOT_RE.test(seen)) state = "not_linked";
    // 화면을 못 가르면 «모른다»로 남긴다 — 거짓 단정보다 낫다(AC-9). 문구를 detail 에 실어 사람이 볼 수 있게.
    return { adsense: { linked, state, detail: seen.slice(0, 160) }, notes: [`애드센스 상태: ${state}`] };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  }
}

export const channel = "ads";
