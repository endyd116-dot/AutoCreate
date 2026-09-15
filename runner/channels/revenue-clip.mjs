/**
 * runner/channels/revenue-clip.mjs — 네이버 클립 크리에이터 «인센티브 현황» 스크랩(계약 P1R3 §2.1 · DESIGN §9.0 클립 인센티브).
 *   AC 신규 2026-09-14(B2). 네이버 nid 세션은 블로그와 같다.
 *
 *   산출: `revenueRows`(인센티브 · 일별 또는 월별 — 화면이 주는 단위대로. 월별이면 그 달 1일로 적고 raw 에 `period:"month"` 를 남긴다).
 *   미가입(크리에이터 프로그램 미지원)은 상태(행 0개) · 표 못 읽음은 `parse` · 로그인 벽은 전이표. 규율은 애드포스트와 같다.
 *   ⚠️ 클립 크리에이터 화면 주소·표 모양은 **실측 전 추정**이다.
 */
import { shot, failShot, settle } from "../lib/browser.mjs";
import { BLOCK, ensureNaverLogin } from "../lib/auth-naver.mjs";
import { findRevenueTable, visibleText, gotoFirst, hasContent } from "../lib/scrape.mjs";
import { rowsToRevenue } from "../lib/money.mjs";

const PARSE = (msg) => Object.assign(new Error(`[block:parse] ${msg}`), { errorKind: "parse" });

/* 실측(2026-09-14 · 자사 네이버 계정): `clip.naver.com/` 이 **`/signup`(«10초 만에 프로필 만들기»)** 으로 보낸다 = 클립 프로필 미가입.
   프로필이 없으면 `/creator`·`/studio` 계열은 전부 «페이지 주소를 확인해 주세요»(404)다. 그래서 홈을 **먼저** 열어 상태를 가른다.
   `m.clip.naver.com` 은 존재하지 않는다(DNS NXDOMAIN). */
const NONE_RE = /프로필 만들기|signup|크리에이터\s*(지원|신청|모집)|프로그램에? 참여|참여하기|대상이 아닙|선정되지/;
const REPORT_URLS = [
  "https://clip.naver.com/",                  // 실측: 미가입이면 /signup 으로 리다이렉트
  "https://clip.naver.com/creator/incentive", // 가입 후 후보(미실측)
  "https://clip.naver.com/creator",
];

export async function run({ ctx, job, shotKey }) {
  const account = job.account ?? {};
  const page = ctx.pages()[0] ?? await ctx.newPage();
  try {
    const how = await ensureNaverLogin(page, account);
    await shot(page, shotKey, `00-로그인(${how})`);

    // /signup 리다이렉트는 그 자체가 답(미가입)이라 내용 검사 없이 «도착»으로 본다 · 클립 SPA 는 렌더가 느려 3.5초 준다(실측).
    const landed = await gotoFirst(page, REPORT_URLS, async (p) => !/nidlogin/i.test(p.url()) && (/\/signup/i.test(p.url()) || await hasContent(p)), 3500);
    if (!landed) {
      /* 🔴 «못 들어갔다»는 둘이다(AC-10): 로그인으로 튕겼으면 계정 문제(login_fail) · 주소가 전부 404 면 **우리 문제**(parse —
         화면 주소를 아직 모른다 · 실측 필요). 2026-09-14 실측에서 후보 주소 3개가 모두 404 인데 «세션 만료»로 적었다 — 거짓 안내다. */
      if (/nidlogin/i.test(page.url())) throw BLOCK("login_fail", "클립 크리에이터에 들어가려는데 다시 로그인을 요구했어요(세션 만료).");
      throw PARSE(`클립 크리에이터 화면 주소를 찾지 못했어요(후보 ${REPORT_URLS.length}개 전부 404/빈 화면 · 마지막 url=${page.url().slice(0, 60)}) — 주소 실측이 필요해요.`);
    }
    await settle(page, 1500);
    await shot(page, shotKey, "01-클립크리에이터");
    const seen = await visibleText(page);

    if (NONE_RE.test(seen) || /\/signup/i.test(page.url())) {
      return { revenueRows: [], notes: [`클립 미가입/미참여 화면(url=${page.url().slice(0, 40)} · «${seen.slice(0, 50)}…»)`] };
    }

    const table = await findRevenueTable(page);
    if (!table.found) {
      await shot(page, shotKey, "02-표없음");
      throw PARSE(`인센티브 표를 찾지 못했어요(table ${table.tables}개 · url=${page.url().slice(0, 60)} · 화면="${seen.slice(0, 80)}")`);
    }
    await shot(page, shotKey, "02-인센티브표");
    /* 🔴 «예상으로 읽었다»·«합계 행을 뺐다»는 **사람 눈에 닿아야 한다**(계산만 하고 아무도 안 읽으면 없는 기능).
       ⚠️ 이모지 금지(UX 헌장 §3) — 고객 화면에 그대로 나가는 글자다.
       ⚠️ `notes` 는 **서버에 저장되는 곳이 아직 없다**(러너 콘솔에만 남는다). 화면까지 가는 길은 `raw.amountEstimated`
          + `raw.amountHead` 쪽이다 — 집계(`lib/revenue/aggregate.ts`)가 그걸 읽어 문구를 만든다. */
    const scrapeNotes = [
      ...(table.amountEstimated ? [`«${table.header[table.amountIdx]}» 열로 읽었어요 — 확정 금액이 아니라 예상치예요`] : []),
      ...(table.summaryRows ? [`합계 행 ${table.summaryRows}줄은 뺐어요(데이터가 아니라 표가 더한 줄)`] : []),
    ];
    const parsed = rowsToRevenue("clip", table.rows.map((r) => ({ dayText: r[table.dayIdx], amountText: r[table.amountIdx], raw: { cells: r.slice(0, 6), period: /월/.test(table.header[table.dayIdx]) ? "month" : "day", ...(table.amountEstimated ? { amountEstimated: true, amountHead: String(table.header[table.amountIdx] ?? "").slice(0, 40) } : {}),
      /* 🔴 **러너는 `raw` 에 «사실»만 남기고 문장은 서버가 만든다**(메인 판정 2026-09-15).
         러너 노트를 저장할 자리를 새로 파면 «러너가 하는 말»이 또 하나의 진실 원천이 된다 — 그래서 숫자만 남긴다.
         `notes` 는 서버가 **버린다**(`RunnerReportOk` 에 칸이 없다) — 화면에 가야 할 것은 전부 여기로. */
      ...(table.summaryRows ? { rowsDropped: table.summaryRows } : {}) } })), { accountId: account.id });
    if (!parsed.ok) throw PARSE(`${parsed.reason} · 머리글=${JSON.stringify(table.header).slice(0, 80)}`);
    return { revenueRows: parsed.rows, notes: [`인센티브 ${parsed.rows.length}행(${table.where})`, ...scrapeNotes] };
  } catch (e) {
    await failShot(page, shotKey);
    throw e;
  }
}

export const channel = "clip";
