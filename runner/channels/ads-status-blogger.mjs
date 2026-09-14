/**
 * runner/channels/ads-status-blogger.mjs — 블로거 대시보드 «수익(Earnings)» 탭 **상태 읽기**(계약 v3.4 §2.2 · 읽기만).
 *   AC 신규 2026-09-14(B2). 배경: Blogger API v3 에는 템플릿/수익 리소스가 없어(8개 리소스뿐) 화면을 읽는 수밖에 없다.
 *
 *   🔴 구글 로그인은 **자동화하지 않는다** — 봇 탐지·2단계가 가장 세다. 프로필에 구글 세션이 없으면 `login_fail` 로
 *      정직하게 돌려보내고, 사람이 `session.login`(헤드풀 · blogger 타깃)으로 한 번 들어와 세션을 남긴다.
 *   산출: `adsense:{ linked, state, detail }`. 못 가르면 `unknown`.
 */
import { shot, failShot, settle } from "../lib/browser.mjs";
import { visibleText } from "../lib/scrape.mjs";

const BLOCK = (kind, msg) => Object.assign(new Error(`[block:${kind}] ${msg}`), { errorKind: kind });
const LINKED_RE = /AdSense\s*(계정이|가)?\s*(연결|연동)됨|연결된 AdSense|광고 게재 중|Your AdSense account is linked|Ads are showing/i;
const PENDING_RE = /검토 중|심사 중|under review|pending/i;
const NOT_RE = /AdSense\s*(에)?\s*가입|AdSense 계정 만들기|Sign up for AdSense|연결하기|아직 자격이 없|not eligible|not yet eligible/i;

export async function run({ ctx, job, shotKey }) {
  const account = job.account ?? {};
  const blogId = String(job.payload?.blogId ?? "").trim();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    const url = blogId ? `https://www.blogger.com/blog/earnings/${encodeURIComponent(blogId)}` : "https://www.blogger.com/";
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 }).catch(() => {});
    await settle(page, 3000);
    await shot(page, shotKey, "00-블로거");
    if (/accounts\.google\.com/i.test(page.url())) {
      throw BLOCK("login_fail", `구글 로그인이 필요해요(@${String(account.handle ?? "").slice(0, 30)}). 앱에서 «다시 로그인»을 눌러 창에서 직접 로그인해 주세요.`);
    }
    const seen = await visibleText(page);
    let state = "unknown", linked = false;
    if (LINKED_RE.test(seen)) { state = "linked"; linked = true; }
    else if (PENDING_RE.test(seen)) state = "pending";
    else if (NOT_RE.test(seen)) state = "not_linked";
    return { adsense: { linked, state, detail: seen.slice(0, 160) }, notes: [`블로거 애드센스 상태: ${state}`] };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  }
}

export const channel = "ads";
