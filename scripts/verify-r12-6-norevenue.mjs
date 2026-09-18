// scripts/verify-r12-6-norevenue.mjs — 🔴 **«광고가 안 붙는 채널»을 화면이 정말 말하나**(R12-6 · 계약 §7).
//   사용: node scripts/verify-r12-6-norevenue.mjs        (빨강 1건이라도 있으면 종료코드 1)
//
//   왜 따로 있나 — `verify-r8-deadends` 는 **글자만** 본다(«화면에 `noRevenueChannel` 이 있나»).
//   그런데 이 칸의 값은 **무슨 말을 하느냐**에 있다(§9-① «막지 않기로 했으면 말은 또렷해야 한다»).
//   그래서 여긴 **돌려 본다** — ui.js·mock.js 를 그대로 태우고, accountGroup 은 **빌드된 화면에서 떼어** 돌린다.
//   🔴 베껴 쓰지 않는다 — 베껴 쓰면 원본을 고쳐도 옛 줄이 계속 초록이다.
//   🔴 불을 잡는 것이 아니라 **거짓말을** 잡는다: «0원이 맞아요»를 **돈이 들어온 달에** 말하면 빨강이다.
import { readFileSync } from "node:fs";
import vm from "node:vm";

const store = new Map();
const noop = () => {};
const el = () => ({ style: { cssText: "", setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop }, setAttribute: noop, appendChild: noop, querySelector: () => null, querySelectorAll: () => [], dataset: {}, textContent: "", innerHTML: "", hidden: false, closest: () => null });
const win = { fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }) };
const ctx = vm.createContext({
  window: win,
  document: { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], readyState: "complete",
    documentElement: el(), body: { ...el(), contains: () => false }, createElement: el, head: el() },
  location: { pathname: "/app/revenue.html", search: "?mock=1", origin: "https://x.test", href: "", assign: noop },
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
  sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) },
  navigator: { userAgent: "node" }, fetch: async () => ({ ok: false, status: 0, json: async () => ({}) }),
  Response: class { constructor() { this.ok = true; } },
  requestAnimationFrame: () => 0, performance: { now: () => 0 },
  setTimeout, clearTimeout, console, URL, URLSearchParams, Intl, Date, JSON, Math,
});
vm.runInContext(readFileSync("public/js/ui.js", "utf8"), ctx);
vm.runInContext(readFileSync("public/js/mock.js", "utf8"), ctx);
const UI = win.UI;
vm.runInContext("globalThis.UI = window.UI;", ctx);   // 실제 화면에선 UI 가 전역이다(window.UI) — vm 에선 손으로 이어 준다
let fail = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${extra ? "  " + extra : ""}`); if (!cond) fail++; };

/* ── ① 서버(모의)가 두 칸을 정말 싣나 ── */
const accs = await UI.api("/api/accounts-list");
const daangn = (accs.channels || []).find((c) => c.key === "daangn");
ok("계정 목록이 당근을 준다", !!daangn);
ok("그 채널에 monetizable:false 가 붙는다", daangn && daangn.monetizable === false, JSON.stringify(daangn && daangn.monetizable));
ok("광고 붙는 채널엔 키가 없다(AC-9)", (accs.channels || []).find((c) => c.key === "naver_blog")?.monetizable === undefined);

const sum = await UI.api("/api/revenue-summary");
ok("수익 응답 맨 위에 noRevenueChannels 가 온다", Array.isArray(sum.noRevenueChannels) && sum.noRevenueChannels.includes("daangn"), JSON.stringify(sum.noRevenueChannels));

/* ── ② 화면이 그걸 말하나 — 빌드된 revenue.html 의 accountGroup 을 그대로 떼어 돌린다 ── */
const page = readFileSync("public/app/revenue.html", "utf8");
const a = page.indexOf("function accountGroup() {");
const b = page.indexOf("\n}", a);
const fnSrc = page.slice(a, b + 2);
ok("빌드된 화면에서 accountGroup 을 떼었다", a > 0 && fnSrc.includes("noRevenueChannels"));

const run = (SUM) => vm.runInContext(`(function(){ const SUM = ${JSON.stringify(SUM)}; ${fnSrc} return accountGroup(); })()`, ctx);

const html1 = run({ noRevenueChannels: ["daangn"], byAccount: [] });
ok("당근만 가진 집 — 막대가 없어도 말은 한다", html1.includes("0원이 맞아요") && html1.includes("banner info"));
ok("  그 말이 흰 바닥(.group) 안에 있다", html1.includes('class="group"'));

const html2 = run({ noRevenueChannels: ["daangn"], byAccount: [
  { accountId: 1, handle: "cook_a", channel: "naver_blog", krw: 120000 },
  { accountId: 6, handle: "danggeun_e", channel: "daangn", krw: 0, noRevenueChannel: true }] });
ok("0원 줄이 «왜 0원인지»를 옆에 단다", html2.includes("광고가 안 붙어요"));
/* 🔴 [변이가 잡았다] 줄이 **있을 때**도 배너를 다는지는 아무도 안 재고 있었다 — 배너를 통째 떼내도 초록이었다.
   «계정이 하나도 없는 집»만 재고 있었기 때문이다(그 길은 앞에서 반환한다). 보통의 집이 바로 이 줄이다. */
ok("  🔴 줄이 있는 집에서도 두 줄 말을 한다", html2.includes("banner info") && html2.includes("0원이 맞아요") && html2.includes("손님을 데려오는 용"));
ok("  그 말이 막대 위에 먼저 온다(흘려보내지 않는다)", html2.indexOf("banner info") < html2.indexOf(`<div class="bars">`));
const rowOf = (h, who) => (h.split(`<div class="bar `).find((x) => x.includes(who)) || "");
ok("  그 줄에 잉크(1등)를 주지 않는다", !rowOf(html2, "danggeun").startsWith("top"), JSON.stringify(rowOf(html2, "danggeun").slice(0, 12)));
ok("  광고 붙는 1등은 잉크 그대로", rowOf(html2, "cook_a").startsWith("top"));
ok("  🔴 줄을 숨기지 않는다(§9) — 금액도 그대로", html2.includes("danggeun_e"));

const html3 = run({ noRevenueChannels: ["daangn"], byAccount: [
  { accountId: 6, handle: "danggeun_e", channel: "daangn", krw: 90000, noRevenueChannel: true }] });
ok("🔴 그 채널에 협찬이 들어온 달엔 «0원이 맞아요»라고 안 한다", !html3.includes("0원이 맞아요"), "(거짓말 방지)");

const html4 = run({ byAccount: [{ accountId: 1, handle: "cook_a", channel: "naver_blog", krw: 120000 }] });
ok("광고 붙는 채널만 있는 집엔 아무 말도 안 한다(소음 0)", !html4.includes("banner"));

console.log(fail ? `\nFAIL ${fail}` : "\nFAIL 0");
process.exit(fail ? 1 : 0);
