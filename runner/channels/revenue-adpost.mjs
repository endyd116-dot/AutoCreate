/**
 * runner/channels/revenue-adpost.mjs — 네이버 애드포스트 «수입 현황» 스크랩(계약 P1R3 §2.1 · DESIGN §9.0·§9.1).
 *   AC 신규 2026-09-14(B2). 네이버 nid 세션은 블로그와 같다(lib/auth-naver.mjs).
 *
 *   산출: `revenueRows`(일별 수입 · 미디어=블로그 계정 귀속) + `adpostState`("none"|"pending"|"approved").
 *   🔴 세 가지를 섞지 않는다(AC-9·AC-10):
 *     · **미등록/심사중** — 가입·미디어 등록 안내 화면 = 정직한 계정 상태. 행 0개 + `adpostState`. 실패가 아니다(그것도 실증이다).
 *     · **표를 못 찾음 / 한 칸이라도 못 읽음** — `errorKind:"parse"`(우리 버그) + 스냅샷. 0 으로 채우지 않는다.
 *     · **로그인 벽** — `login_fail`/`captcha`(전이표 · 계정 문제).
 *   🔴 스냅샷 필수(`RUNNER_SHOTS`). 파싱은 lib/money.mjs(원·콤마·공백·＋ 정규화 · 정수).
 *   ⚠️ 애드포스트 화면 주소·표 모양은 **실측 전 추정**이다 — 자사 계정 실측 결과로 확정한다(아래 URL 후보를 늘리는 식으로).
 */
import { shot, failShot, settle } from "../lib/browser.mjs";
import { BLOCK, ensureNaverLogin } from "../lib/auth-naver.mjs";
import { findRevenueTable, visibleText, gotoFirst, hasContent } from "../lib/scrape.mjs";
import { rowsToRevenue } from "../lib/money.mjs";

const PARSE = (msg) => Object.assign(new Error(`[block:parse] ${msg}`), { errorKind: "parse" });

/** 가입·미디어 등록 안내 화면 = 미등록. 심사 중 문구 = pending. */
const NONE_RE = /애드포스트\s*(가입|시작)|가입하기|회원가입|미디어를? 등록|미디어 등록|서비스 이용 신청|이용약관 동의/;
const PENDING_RE = /심사\s*중|검수\s*중|승인\s*대기|보류/;
const APPROVED_RE = /수입\s*현황|수입현황|일별\s*수입|정산|지급/;

/** 수입 현황 후보 주소(실측 전) — 첫 화면이 «로그인 요구»가 아니면 선다. */
const REPORT_URLS = [
  "https://adpost.naver.com/dashboard/income",
  "https://adpost.naver.com/dashboard",
  "https://adpost.naver.com/report/income",
  "https://adpost.naver.com/",
];

export async function run({ ctx, job, shotKey }) {
  const account = job.account ?? {};
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    const how = await ensureNaverLogin(page, account);
    await shot(page, shotKey, `00-로그인(${how})`);

    const landed = await gotoFirst(page, REPORT_URLS, async (p) => !/nidlogin/i.test(p.url()) && await hasContent(p));
    if (!landed) {
      /* 🔴 «못 들어갔다»는 둘이다(AC-10): 로그인으로 튕겼으면 계정 문제(login_fail) · 주소가 전부 404 면 **우리 문제**(parse —
         화면 주소를 아직 모른다 · 실측 필요). 2026-09-14 실측에서 후보 주소 3개가 모두 404 인데 «세션 만료»로 적었다 — 거짓 안내다. */
      if (/nidlogin/i.test(page.url())) throw BLOCK("login_fail", "애드포스트에 들어가려는데 다시 로그인을 요구했어요(세션 만료).");
      throw PARSE(`애드포스트 화면 주소를 찾지 못했어요(후보 ${REPORT_URLS.length}개 전부 404/빈 화면 · 마지막 url=${page.url().slice(0, 60)}) — 주소 실측이 필요해요.`);
    }
    await settle(page, 1500);
    await shot(page, shotKey, "01-애드포스트");
    const seen = await visibleText(page);

    // ① 계정 상태부터 가른다(정직한 «없음»).
    if (NONE_RE.test(seen) && !APPROVED_RE.test(seen)) {
      return { revenueRows: [], adpostState: "none", notes: [`애드포스트 미등록 화면(«${seen.slice(0, 60)}…»)`] };
    }
    if (PENDING_RE.test(seen) && !APPROVED_RE.test(seen)) {
      return { revenueRows: [], adpostState: "pending", notes: ["애드포스트 심사 중 화면"] };
    }

    // ② 수입 표를 찾는다.
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
    const parsed = rowsToRevenue("adpost", table.rows.map((r) => ({ dayText: r[table.dayIdx], amountText: r[table.amountIdx], raw: { cells: r.slice(0, 6), ...(table.amountEstimated ? { amountEstimated: true, amountHead: String(table.header[table.amountIdx] ?? "").slice(0, 40) } : {}) } })), { accountId: account.id });
    if (!parsed.ok) throw PARSE(`${parsed.reason} · 머리글=${JSON.stringify(table.header).slice(0, 80)}`);

    return { revenueRows: parsed.rows, adpostState: "approved", notes: [`수입 ${parsed.rows.length}행(${table.where})`, ...scrapeNotes] };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  }
}

export const channel = "adpost";
