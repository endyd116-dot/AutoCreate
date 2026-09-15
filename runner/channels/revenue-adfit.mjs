/**
 * runner/channels/revenue-adfit.mjs — 카카오 애드핏 «보고서» 스크랩(계약 P1R3 §2.1 · DESIGN §9.1).
 *   AC 신규 2026-09-14(B2). 카카오 계정 세션은 티스토리와 같다(lib/auth-kakao.mjs).
 *
 *   산출: `revenueRows`(일별 수입). 규율은 애드포스트와 같다 — 미가입은 상태(행 0개), 표 못 읽음은 `parse`, 로그인 벽은 전이표.
 *   ⚠️ 애드핏 화면 주소·표 모양은 **실측 전 추정**이다(자사 카카오 계정이 2단계를 넘어야 실측 가능).
 */
import { shot, failShot, settle } from "../lib/browser.mjs";
import { BLOCK, KAKAO_AUTH_HOST, kakaoLogin } from "../lib/auth-kakao.mjs";
import { findRevenueTable, visibleText, gotoFirst, hasContent } from "../lib/scrape.mjs";
import { rowsToRevenue } from "../lib/money.mjs";

const PARSE = (msg) => Object.assign(new Error(`[block:parse] ${msg}`), { errorKind: "parse" });

const NONE_RE = /애드핏\s*(가입|시작)|가입하기|매체 등록|매체를 등록|이용 신청|약관 동의/;
const PENDING_RE = /심사\s*중|검수\s*중|승인\s*대기/;
const REPORT_URLS = [
  "https://adfit.kakao.com/report",
  "https://adfit.kakao.com/dashboard",
  "https://adfit.kakao.com/",
];

async function ensureKakaoLogin(page, account, shotKey) {
  await page.goto("https://adfit.kakao.com/", { waitUntil: "domcontentloaded", timeout: 40_000 }).catch(() => {});
  await settle(page, 2000);
  const loggedOut = KAKAO_AUTH_HOST.test(page.url()) || (await page.locator("a:has-text('로그인'), button:has-text('로그인'), a[href*='login']").count().catch(() => 0)) > 0;
  if (!loggedOut) return "cookie";
  if (!account?.login?.id || !account?.login?.pw) throw BLOCK("login_fail", "저장된 카카오 로그인이 만료됐어요. 앱에서 «다시 로그인»을 눌러 주세요.");
  if (!KAKAO_AUTH_HOST.test(page.url())) {
    // 애드핏 화면의 «로그인» → 카카오 인증으로 넘어간다.
    await page.locator("a:has-text('로그인'), button:has-text('로그인'), a[href*='login']").first().click({ timeout: 6000 }).catch(() => {});
    await settle(page, 2500);
  }
  await kakaoLogin(page, account.login.id, account.login.pw, shotKey);
  return "password";
}

export async function run({ ctx, job, shotKey }) {
  const account = job.account ?? {};
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    const how = await ensureKakaoLogin(page, account, shotKey);
    await shot(page, shotKey, `00-로그인(${how})`);

    const landed = await gotoFirst(page, REPORT_URLS, async (p) => !KAKAO_AUTH_HOST.test(p.url()) && await hasContent(p));
    if (!landed) {
      /* 🔴 «못 들어갔다»는 둘이다(AC-10): 로그인으로 튕겼으면 계정 문제(login_fail) · 주소가 전부 404 면 **우리 문제**(parse —
         화면 주소를 아직 모른다 · 실측 필요). 2026-09-14 실측에서 후보 주소 3개가 모두 404 인데 «세션 만료»로 적었다 — 거짓 안내다. */
      if (KAKAO_AUTH_HOST.test(page.url())) throw BLOCK("login_fail", "애드핏에 들어가려는데 다시 로그인을 요구했어요(세션 만료).");
      throw PARSE(`애드핏 화면 주소를 찾지 못했어요(후보 ${REPORT_URLS.length}개 전부 404/빈 화면 · 마지막 url=${page.url().slice(0, 60)}) — 주소 실측이 필요해요.`);
    }
    await settle(page, 1500);
    await shot(page, shotKey, "01-애드핏");
    const seen = await visibleText(page);

    if (NONE_RE.test(seen)) return { revenueRows: [], adpostState: undefined, notes: [`애드핏 미가입/매체 미등록 화면(«${seen.slice(0, 60)}…»)`] };
    if (PENDING_RE.test(seen)) return { revenueRows: [], notes: ["애드핏 심사 중 화면"] };

    const table = await findRevenueTable(page);
    if (!table.found) {
      await shot(page, shotKey, "02-표없음");
      throw PARSE(`수입 표를 찾지 못했어요(table ${table.tables}개 · url=${page.url().slice(0, 60)} · 화면="${seen.slice(0, 80)}")`);
    }
    await shot(page, shotKey, "02-수입표");
    /* 🔴 «예상으로 읽었다»·«합계 행을 뺐다»는 **사람 눈에 닿아야 한다**(계산만 하고 아무도 안 읽으면 없는 기능).
       ⚠️ 이모지 금지(UX 헌장 §3) — 고객 화면에 그대로 나가는 글자다.
       ⚠️ `notes` 는 **서버에 저장되는 곳이 아직 없다**(러너 콘솔에만 남는다). 화면까지 가는 길은 `raw.amountEstimated`
          + `raw.amountHead` 쪽이다 — 집계(`lib/revenue/aggregate.ts`)가 그걸 읽어 문구를 만든다. */
    const scrapeNotes = [
      ...(table.amountEstimated ? [`«${table.header[table.amountIdx]}» 열로 읽었어요 — 확정 금액이 아니라 예상치예요`] : []),
      ...(table.summaryRows ? [`합계 행 ${table.summaryRows}줄은 뺐어요(데이터가 아니라 표가 더한 줄)`] : []),
    ];
    const parsed = rowsToRevenue("adfit", table.rows.map((r) => ({ dayText: r[table.dayIdx], amountText: r[table.amountIdx], raw: { cells: r.slice(0, 6), ...(table.amountEstimated ? { amountEstimated: true, amountHead: String(table.header[table.amountIdx] ?? "").slice(0, 40) } : {}) } })), { accountId: account.id });
    if (!parsed.ok) throw PARSE(`${parsed.reason} · 머리글=${JSON.stringify(table.header).slice(0, 80)}`);
    return { revenueRows: parsed.rows, notes: [`수입 ${parsed.rows.length}행(${table.where})`, ...scrapeNotes] };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  }
}

export const channel = "adfit";
