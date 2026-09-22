/**
 * scripts/_tmp/probe-text-selector.mjs — 🔴 `locator("text=A, text=B")` 가 정말 **둘 다** 보나(임시 · 읽기만).
 *   `runner/channels/naver-blog.mjs:1125` 가 `page.locator("text=이용이 제한, text=제재")` 로
 *   **계정 제재**를 잡는다. 콤마가 CSS 목록 문법이라 `text=` 엔진과 섞이면 **한 문자열로 읽힐** 수 있다.
 *   그러면 그 가지는 **한 번도 안 걸린다** — «제재당했는데 «주소를 회수 못 했어요»로 끝난다».
 *   🔴 네트워크 0 · 발행 0 · 로컬 HTML 만 연다.
 */
/* 🔴 **이 파일은 커밋된 코드가 대는 증거다** — `_tmp/` 에 두면 그 인용이 **허공을 가리킨다.**
 *   ⚠️ 나는 이 실수를 **한 판 전에 고치고 바로 다음 판에서 또 했다**(2026-09-23).
 *      「증거를 대려면 그 증거가 커밋돼 있어야 한다」를 배워 놓고, 새 판을 시작하자마자 같은 자리에 빠졌다.
 *      ⇒ **재는 하니스는 처음부터 `scripts/` 에 만든다.** `_tmp/` 는 두 번 안 볼 것만.
 */

import { chromium } from "playwright";

const PAGES = {
  "제재 문구만 있는 화면": "<body><div>이 블로그는 이용이 제한된 상태입니다</div></body>",
  "«제재» 낱말만 있는 화면": "<body><div>운영원칙 위반으로 제재되었습니다</div></body>",
  "둘 다 없는 평범한 화면": "<body><div>글이 발행되었습니다</div></body>",
  "🔴 통째로 적힌 화면(오해의 여지)": "<body><div>이용이 제한, text=제재</div></body>",
};

const SELECTORS = [
  ['지금 코드', "text=이용이 제한, text=제재"],
  ['고친 꼴(둘을 따로)', "text=이용이 제한"],
  ['고친 꼴(둘을 따로) 2', "text=제재"],
  ['정규식 한 방', "text=/이용이 제한|제재|운영원칙/"],
];

const ctx = await chromium.launchPersistentContext("", { headless: true });
const page = ctx.pages()[0] ?? await ctx.newPage();
try {
  console.log("■ 화면 × 셀렉터 — 숫자는 `count()`\n");
  const head = ["화면".padEnd(30), ...SELECTORS.map(([n]) => n.padEnd(22))].join("");
  console.log("  " + head);
  for (const [label, html] of Object.entries(PAGES)) {
    await page.setContent(html);
    const cells = [];
    for (const [, sel] of SELECTORS) {
      const n = await page.locator(sel).count().catch((e) => `ERR:${String(e.message).slice(0, 12)}`);
      cells.push(String(n).padEnd(22));
    }
    console.log("  " + label.padEnd(30) + cells.join(""));
  }
  console.log("\n🔴 «지금 코드» 열이 첫 두 줄에서 0 이면 **그 가지는 한 번도 안 걸린다**.");
} finally { await ctx.close(); }
