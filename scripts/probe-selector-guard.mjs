/**
 * scripts/probe-selector-guard.mjs — 🔴 **내가 «죽었다»고 거부하는 모양이 정말 죽었나**(AC-205 · B2 · 2026-09-23).
 *   실행: `node scripts/probe-selector-guard.mjs` · 네트워크 0 · 발행 0 · 빈 페이지에만 댄다.
 *
 *   🔴 **이 탐침이 `selector-guard.mjs` 의 근거다.** 거부 규칙을 «그럴 것 같아서» 넣으면
 *      멀쩡한 서버 수리를 묻어 버린다 — **거짓 빨강은 조용한 초록만큼 나쁘다**(오늘 B 에게 배운 것).
 *      ⇒ 규칙마다 **진짜 브라우저**에 대고 「정말 못 쓰나」를 보이고, **대조군**으로 「멀쩡한 건 통과하나」도 본다.
 *
 *   ⚠️ 새 거부 규칙을 넣으려면 **여기에 줄을 먼저 더해** 죽은 것을 보이고 나서 넣어라.
 */
import { requirePlaywright } from "./_lib/find-playwright.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = await requirePlaywright();
const ROOT = path.resolve(import.meta.dirname, "..");
const { selectorLooksDead } = await import(pathToFileURL(path.join(ROOT, "runner", "lib", "selector-guard.mjs")).href);

/** `want` — `dead` = 브라우저에서 **못 쓴다**(터지거나 실제 과녁에 0) · `alive` = 쓸 수 있다. */
const CASES = [
  /* ═══ 거부해야 하는 것 — 전부 실측으로 죽은 것만 ═══ */
  { sel: "text=이용이 제한, text=제재", want: "dead", note: "🔴 어제 그것 — 안 터지고 조용히 한 문자열" },
  { sel: "text=가, text=나", want: "dead", note: "같은 꼴(짧게)" },
  { sel: "div[", want: "dead", note: "대괄호가 안 닫힌다" },
  { sel: "button:has-text(", want: "dead", note: "괄호가 안 닫힌다" },
  { sel: 'div[aria-label="열기', want: "dead", note: "따옴표가 안 닫힌다" },
  { sel: "", want: "dead", note: "빈 값" },
  /* ═══ 🔴 대조군 — **통과해야** 하는 것(여기서 거부하면 서버 수리가 묻힌다) ═══ */
  { sel: "div#x.y", want: "alive", note: "평범한 CSS" },
  { sel: "text=보기글", want: "alive", note: "엔진 하나" },
  { sel: "div, span", want: "alive", note: "🔴 **CSS 목록은 멀쩡하다** — 콤마만 보고 거부하면 안 된다" },
  { sel: '[aria-label="a, b"]', want: "alive", note: "🔴 **따옴표 안의 콤마**도 멀쩡하다" },
  { sel: 'button:has-text("확인")', want: "alive", note: "has-text 는 괄호가 맞는다" },
  { sel: "#a > .b:nth-child(2)", want: "alive", note: "중첩 괄호" },
  { sel: 'div[data-x="]"]', want: "alive", note: "🔴 **따옴표 안의 대괄호** — 세면 안 된다" },
];

const ctx = await chromium.launchPersistentContext("", { headless: true });
const page = ctx.pages()[0] ?? await ctx.newPage();
let agree = 0; let disagree = 0;
try {
  /* 과녁이 **실제로 있는** 화면 — 「죽었다」가 «없어서»가 아니라 «못 써서»임을 가르려면 필요하다. */
  await page.setContent(`<body>
    <div id=x class=y>보기글</div><span>스팬</span>
    <div>이 블로그는 이용이 제한된 상태입니다</div>
    <div>운영원칙 위반으로 제재되었습니다</div>
    <button>확인</button><div id=a><i class=b></i><i class=b>둘</i></div>
    <div aria-label="a, b">라벨</div><div data-x="]">대괄호</div>
  </body>`);

  console.log("■ 규칙마다 — **브라우저가 실제로 어떻게 답하나** vs 내 판정\n");
  for (const c of CASES) {
    let browser;
    try { browser = (await page.locator(c.sel).count()) > 0 ? "쓸 수 있다" : "0개(과녁 없음)"; }
    catch { browser = "터진다"; }
    /* 🔴 「조용히 한 문자열」은 **안 터지고 0** 으로 나온다 — 그래서 `text=…, text=…` 는
       화면에 그 문구가 **있는데도** 0 이다. 그게 이 표의 첫 줄이 보이는 것이다. */
    const mine = selectorLooksDead(c.sel);
    const browserDead = browser === "터진다" || (c.want === "dead" && browser === "0개(과녁 없음)");
    const ok = mine.dead === (c.want === "dead");
    if (ok) agree++; else disagree++;
    console.log(`  ${ok ? "✓" : "🔴"} ${String(c.sel || "(빈 값)").slice(0, 34).padEnd(36)} 브라우저=${browser.padEnd(14)} 내판정=${mine.dead ? `거부(${mine.why})` : "통과"}`);
    console.log(`       ${c.note}${ok ? "" : "  🔴 **어긋난다 — 규칙을 고쳐라**"}`);
    if (c.want === "dead" && !browserDead) {
      console.log("       ⚠️ 🔴 **브라우저는 죽었다고 안 한다** — 내가 «죽었다»고 단정할 근거가 약하다. 규칙을 다시 봐라.");
    }
  }
} finally { await ctx.close(); }

console.log(`\n${disagree === 0 ? "🟢" : "🔴"} 내 판정과 뜻이 맞는 줄 ${agree} · 어긋난 줄 ${disagree}`);
console.log("⊘ **못 재는 것**: 「파싱은 되는데 **과녁이 틀린**」 셀렉터는 여기서 못 잡는다 — 실물 화면이 답한다.");
process.exit(disagree === 0 ? 0 : 1);
