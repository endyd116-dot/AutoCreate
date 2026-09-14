/**
 * runner/lib/scrape.mjs — 수익 화면 공용 읽기(계약 P1R3 §2.1). 표를 «찾아서 읽는다», 만들어 채우지 않는다.
 *
 *   🔴 AC-9 — 표를 못 찾으면 `{ found:false }`, 찾았는데 한 칸이라도 못 읽으면 호출자가 `errorKind:"parse"` 로 보고한다.
 *   🔴 AC-10 — «표가 없다»는 두 가지다: ①미가입/미등록(계정 문제 · 정직한 상태) ②화면이 바뀜(우리 버그). 호출자가
 *      화면 문구로 ①을 먼저 가려낸 뒤 남는 것만 ②로 적는다.
 *
 *   표 찾기 규칙: 페이지(프레임 포함)의 모든 <table> 중 머리글에 «날짜 계열» 과 «금액 계열» 낱말이 **둘 다** 있는 첫 표.
 *   카드/리스트형 화면(표가 아닌)은 채널 모듈이 따로 읽는다.
 */

const DAY_HEAD = /일자|날짜|일별|date|day|기간/i;
const AMOUNT_HEAD = /수입|수익|금액|amount|revenue|income|정산/i;

/**
 * findRevenueTable — 첫 «일자×금액» 표를 셀 문자열 격자로 돌려준다.
 * @returns { found:true, dayIdx, amountIdx, header:string[], rows:string[][], where:"page"|"frame" } | { found:false, tables:number }
 */
export async function findRevenueTable(page) {
  const targets = [page, ...page.frames().filter((f) => f !== page.mainFrame())];
  let tables = 0;
  for (const t of targets) {
    const grids = await t.evaluate(() => {
      const out = [];
      for (const tb of document.querySelectorAll("table")) {
        const rows = [...tb.querySelectorAll("tr")].map((tr) => [...tr.querySelectorAll("th,td")].map((c) => (c.textContent || "").replace(/\s+/g, " ").trim()));
        if (rows.length) out.push(rows);
      }
      return out;
    }).catch(() => []);
    tables += grids.length;
    for (const rows of grids) {
      const header = rows[0] ?? [];
      const dayIdx = header.findIndex((h) => DAY_HEAD.test(h));
      const amountIdx = header.findIndex((h) => AMOUNT_HEAD.test(h));
      if (dayIdx < 0 || amountIdx < 0) continue;
      return { found: true, dayIdx, amountIdx, header, rows: rows.slice(1).filter((r) => r.length > Math.max(dayIdx, amountIdx)), where: t === page ? "page" : "frame" };
    }
  }
  return { found: false, tables };
}

/** 화면에 보이는 글자(프레임 포함) — 상태 판정용. */
export async function visibleText(page, max = 4000) {
  const parts = [];
  for (const t of [page, ...page.frames().filter((f) => f !== page.mainFrame())]) {
    const s = ((await t.locator("body").innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (s) parts.push(s);
  }
  return parts.join(" ¶ ").slice(0, max);
}

/** 화면에 «내용»이 있나 — 빈 흰 화면(SPA 404·차단)은 도착이 아니다(2026-09-14 실측: adpost /dashboard/income 이 흰 화면이었다). */
export async function hasContent(page, minChars = 40) {
  const t = await visibleText(page, 400);
  if (t.length < minChars) return false;
  // 🔴 «내용이 있는 404»도 도착이 아니다(2026-09-14 실측: clip.naver.com/creator/incentive 가 «페이지 주소를 확인해 주세요» 를 냈다).
  return !NOT_FOUND_RE.test(t);
}
/** 서비스별 404 문구 — 네이버·카카오 공통으로 흔한 것들. */
export const NOT_FOUND_RE = /페이지 주소를 확인|페이지를 찾을 수 없|삭제된 것 같아요|존재하지 않는 페이지|요청하신 페이지|잘못된 접근|404 Not Found|Page not found/i;

/** 후보 주소를 차례로 열어 «로그인 요구»가 아니고 판정 함수가 true 인 첫 화면에 선다. */
export async function gotoFirst(page, urls, accept, settleMs = 2500) {
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
      await page.waitForTimeout(settleMs);
      const ok = await accept(page);
      // 주소 실측을 위한 자취 — 후보마다 «어디로 갔고 무엇이 보였나»를 남긴다(RUNNER_DEBUG=1).
      if (process.env.RUNNER_DEBUG === "1") console.log(`    · gotoFirst ${url} → ${page.url().slice(0, 70)} · ${ok ? "도착" : "거절"} · "${(await visibleText(page, 120))}"`);
      if (ok) return url;
    } catch (e) {
      if (process.env.RUNNER_DEBUG === "1") console.log(`    · gotoFirst ${url} → 오류 ${String(e?.message ?? e).slice(0, 60)}`);
    }
  }
  return null;
}
