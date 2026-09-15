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
/** 확정된 돈으로 보이는 머리글(여럿일 때 **이쪽을 먼저** 고른다). */
const CONFIRMED_HEAD = /확정|지급|정산|최종/;
/** 아직 확정이 아닌 돈. 이걸 «수익»으로 적으면 고객 화면에 **없는 돈**이 찍힌다. */
const ESTIMATED_HEAD = /예상|추정|예측/;
/** 날짜 칸에 오는 «합계» 계열 — 데이터 행이 아니라 표가 스스로 더한 줄이다. */
const SUMMARY_DAY = /^(합계|총계|소계|누계|누적|전체|total|sum)$/i;

/**
 * findRevenueTable — 첫 «일자×금액» 표를 셀 문자열 격자로 돌려준다.
 *
 *   🔴 2026-09-15 실측(`scripts/verify-runner-scrape.mts` · 진짜 DOM)으로 **여섯 가지**가 드러나 고쳤다.
 *      이 층의 실패는 대부분 **조용하다** — 숫자는 멀쩡해 보이고 오류도 안 난다:
 *        ① 레이아웃 `<table>` 안에 진짜 표가 있으면 **바깥 칸 글자와 안쪽 행이 한 격자로 섞였다**
 *           (`tb.querySelectorAll("tr")` 는 **자손 표의 행까지** 가져온다). → 감싸는 표는 건너뛰고 행은 `:scope` 로 제 것만.
 *        ② `colspan` 을 안 펴서 칸 수가 모자란 행이 **통째로 버려졌다** → 표에 돈이 가득한데 **«수익 0원»**(모른다 ≠ 0 · AC-9).
 *        ③ «합계» 행이 데이터로 섞여 들어가 `parseDayKst("합계")` 가 null → **표 한 장이 통째로 실패**(흔한 표 모양이다).
 *        ④ «정산일자» 처럼 머리글 하나가 날짜·금액 **둘 다** 매칭하면 같은 열을 둘로 골랐다.
 *        ⑤🔴 금액 열이 둘이면(«예상수익»·«확정수익») **앞엣것**을 골랐다 — 예상치를 확정 수익으로 적는다.
 *        ⑥ 예상밖에 없을 때 그 사실을 아무 데도 안 남겼다.
 *
 * @returns { found:true, dayIdx, amountIdx, header, rows, where, amountEstimated, summaryRows, amountCandidates }
 *        | { found:false, tables:number }
 */
export async function findRevenueTable(page) {
  const targets = [page, ...page.frames().filter((f) => f !== page.mainFrame())];
  let tables = 0;
  for (const t of targets) {
    const grids = await t.evaluate(() => {
      const out = [];
      for (const tb of document.querySelectorAll("table")) {
        /* 🔴 다른 표를 품고 있는 표는 **레이아웃 껍데기**다 — 건너뛰고 안쪽 진짜 표를 본다.
           (`querySelectorAll` 은 자손까지 훑으므로 안쪽 표는 이 반복에서 따로 나온다.) */
        if (tb.querySelector("table")) continue;
        const trs = tb.querySelectorAll(":scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr");
        const rows = [...trs].map((tr) => {
          const cells = [];
          for (const c of tr.querySelectorAll(":scope > th, :scope > td")) {
            const txt = (c.textContent || "").replace(/\s+/g, " ").trim();
            /* `colspan` 을 **펴서** 칸 번호를 머리글과 맞춘다. 안 펴면 그 행은 칸이 모자라 버려지고,
               버려진 행은 «수익이 없는 날»처럼 보인다(그게 제일 나쁜 종류다). 상한 20 은 폭주 방지. */
            const span = Math.max(1, Math.min(20, parseInt(c.getAttribute("colspan") || "1", 10) || 1));
            for (let k = 0; k < span; k++) cells.push(txt);
          }
          return cells;
        });
        if (rows.length) out.push(rows);
      }
      return out;
    }).catch(() => []);
    tables += grids.length;
    for (const rows of grids) {
      const header = rows[0] ?? [];
      const dayIdx = header.findIndex((h) => DAY_HEAD.test(h));
      if (dayIdx < 0) continue;
      /* 🔴 금액 열은 **날짜 열이 아닌 것들 중에서** 고른다(«정산일자» 가 둘 다 매칭한다).
         그리고 여럿이면 **확정 쪽을 먼저** 고른다 — 예상치를 수익으로 적으면 고객 화면에 없는 돈이 찍힌다. */
      const cands = header.map((h, i) => ({ i, h })).filter((c) => c.i !== dayIdx && AMOUNT_HEAD.test(c.h));
      if (!cands.length) continue;
      const pick = cands.find((c) => CONFIRMED_HEAD.test(c.h) && !ESTIMATED_HEAD.test(c.h))
        ?? cands.find((c) => !ESTIMATED_HEAD.test(c.h))
        ?? cands[0];
      /* 예상밖에 없으면 **그걸 쓰되 표시한다.** 안 쓰면 애드포스트처럼 «예상 수입»만 주는 화면에서 아무것도 못 모은다 —
         쓰되 «예상»이라고 말하지 않으면 그게 «틀린 성공»이다. 둘 다 피하는 길은 «쓰고 + 표시»뿐이다. */
      const amountEstimated = ESTIMATED_HEAD.test(pick.h);
      const wide = rows.slice(1).filter((r) => r.length > Math.max(dayIdx, pick.i));
      /* «합계» 행은 데이터가 아니다 — **빼되 몇 줄 뺐는지 돌려준다**(조용히 버리지 않는다 · 호출자가 노트에 적는다). */
      const body = wide.filter((r) => !SUMMARY_DAY.test(String(r[dayIdx] ?? "").trim()));
      return {
        found: true, dayIdx, amountIdx: pick.i, header, rows: body, where: t === page ? "page" : "frame",
        amountEstimated, summaryRows: wide.length - body.length,
        amountCandidates: cands.map((c) => c.h),
      };
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

/**
 * 🔴 «준비됐나»를 **조건으로** 판정한다 — 잠으로 대신하지 않는다(2026-09-15 · AC-57 의 같은 모양).
 *
 *   종전엔 `waitForTimeout(settleMs)` 한 번 자고 **딱 한 번** 봤다. 그래서 양쪽으로 갈라졌다(실측 · `scripts/verify-runner-wait.mts`):
 *     · 1.2초 뒤에 그려지는 화면을 300ms 만에 재고 «내용 없음» → 채널이 «주소를 못 찾았어요(**우리 버그**)»라고
 *       거짓 보고를 낸다. 화면은 멀쩡했다. (클립 채널에 «SPA 는 렌더가 느려 3.5초 준다»고 **상수를 키운 자국**이 남아 있다 —
 *       상수를 키우는 건 이 문제를 미루는 것이지 푸는 게 아니다.)
 *     · 대기값이 크면 **준비가 끝나도 끝까지 잔다**(실측: 8000 을 주면 8067ms). 잡마다 몇 초씩 크론 예산을 갉아먹는다.
 *   ⇒ 조건이 참이 될 때까지 훑고, 되면 **즉시** 나오고, 안 되면 «안 됐다»고 말한다.
 *
 *   @returns 조건이 참이 됐나(true) / 시간 안에 안 됐나(false) — «못 기다렸다»를 «참»으로 바꾸지 않는다(AC-9).
 */
export async function waitFor(page, cond, maxMs, pollMs = 250) {
  const deadline = Date.now() + Math.max(0, Number(maxMs) || 0);
  for (;;) {
    if (await cond(page).catch(() => false)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await page.waitForTimeout(Math.min(pollMs, left)).catch(() => {});
  }
}

/**
 * 🔴 «준비됐나»를 볼 때의 **최소 기다림**. 호출자가 더 짧은 값을 줘도 이만큼은 본다.
 *   호출자의 값은 원래 «사람처럼 쉬는 시간»(봇탐지 완화)이라 **준비 판정의 예산으로는 너무 짧다** —
 *   그 둘을 한 숫자로 쓰던 것이 위 두 실패의 뿌리다. 훑기는 준비되면 바로 나오므로 이 값을 키워도 평소 비용은 0 이다.
 */
export const READY_MIN_MS = 4000;

/** 후보 주소를 차례로 열어 «로그인 요구»가 아니고 판정 함수가 true 인 첫 화면에 선다. */
export async function gotoFirst(page, urls, accept, settleMs = 2500) {
  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
      // `settleMs` 는 이제 «잘 시간»이 아니라 «**최대** 기다릴 시간»이다(준비되면 그 전에 나온다).
      const ok = await waitFor(page, accept, Math.max(Number(settleMs) || 0, READY_MIN_MS));
      // 주소 실측을 위한 자취 — 후보마다 «어디로 갔고 무엇이 보였나»를 남긴다(RUNNER_DEBUG=1).
      if (process.env.RUNNER_DEBUG === "1") console.log(`    · gotoFirst ${url} → ${page.url().slice(0, 70)} · ${ok ? "도착" : "거절"} · "${(await visibleText(page, 120))}"`);
      if (ok) return url;
    } catch (e) {
      if (process.env.RUNNER_DEBUG === "1") console.log(`    · gotoFirst ${url} → 오류 ${String(e?.message ?? e).slice(0, 60)}`);
    }
  }
  return null;
}
