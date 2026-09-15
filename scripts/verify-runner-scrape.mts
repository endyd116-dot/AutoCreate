/**
 * scripts/verify-runner-scrape.mts — **표를 찾는 층**을 진짜 브라우저에서 돌려서 확인한다(2026-09-15 B2).
 *
 *   🔴 왜 여기가 중요한가: 아래 파서(`money.mjs`)가 아무리 튼튼해도, **어느 열이 날짜고 어느 열이 금액인지**를
 *      여기서 잘못 고르면 그 뒤는 전부 무의미하다. 그리고 이 층의 실패는 대부분 **조용하다** —
 *      «예상수익»을 «수익»으로 집어도 숫자는 멀쩡해 보이고, 행이 통째로 버려져도 «수익 0원»으로 보인다.
 *
 *   🔴 진짜 DOM 에서 돌린다. `findRevenueTable` 은 `page.evaluate` 로 DOM 을 읽으므로 가짜 객체로는 못 본다 —
 *      러너에 이미 있는 chromium 을 띄워 `setContent` 로 실제 표를 만들어 먹인다(AC-51: 돌려야 잡힌다).
 *
 *   실행: npx --yes tsx scripts/verify-runner-scrape.mts       (DB·네트워크 불필요 · 로컬 chromium)
 */
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
// playwright 는 **러너에만** 설치돼 있다(루트 node_modules 에 없다) — 러너 기준으로 해석한다.
const req = createRequire(path.join(ROOT, "runner", "package.json"));
const { chromium } = req("playwright") as typeof import("playwright");
const { findRevenueTable } = await import(pathToFileURL(path.join(ROOT, "runner", "lib", "scrape.mjs")).href) as {
  findRevenueTable: (p: unknown) => Promise<Record<string, unknown>>;
};

interface Want {
  found: boolean;
  /** 고른 열이 실제로 집어 오는 글자(열 번호가 아니라 **값**으로 적는다 — 번호는 표 모양이 바뀌면 의미가 없다). */
  day?: string;
  amount?: string;
  rows?: number;
  estimated?: boolean;
  summary?: number;
}
interface Case { name: string; html: string; want: Want; why: string }

const CASES: Case[] = [
  {
    name: "정상", why: "기준선",
    html: `<table><tr><th>날짜</th><th>노출수</th><th>수익</th></tr>
           <tr><td>09.13</td><td>1,000</td><td>1,200원</td></tr></table>`,
    want: { found: true, day: "09.13", amount: "1,200원", rows: 1 },
  },
  {
    name: "레이아웃 table 안에 진짜 표", why: "🔴 바깥 표의 칸 글자와 안쪽 행이 **한 격자로 섞인다**(중첩 선택자)",
    html: `<table><tr><td>
             <table><tr><th>날짜</th><th>수익</th></tr><tr><td>09.13</td><td>1,200원</td></tr></table>
           </td></tr></table>`,
    want: { found: true, day: "09.13", amount: "1,200원", rows: 1 },
  },
  {
    name: "colspan 으로 열이 밀린 행", why: "🔴 행이 통째로 버려져 **«수익 0원»** 이 된다(모른다 ≠ 0)",
    html: `<table><tr><th>날짜</th><th>노출수</th><th>수익</th></tr>
           <tr><td colspan="2">09.13 (집계중)</td><td>1,200원</td></tr></table>`,
    want: { found: true, day: "09.13 (집계중)", amount: "1,200원", rows: 1 },
  },
  {
    name: "합계 행이 섞여 있다", why: "🔴 «합계»는 날짜가 아니라 표 한 장이 통째로 parse 실패한다(흔한 표 모양)",
    html: `<table><tr><th>날짜</th><th>수익</th></tr>
           <tr><td>09.13</td><td>1,200원</td></tr>
           <tr><td>합계</td><td>1,200원</td></tr></table>`,
    want: { found: true, day: "09.13", amount: "1,200원", rows: 1, summary: 1 },
  },
  {
    name: "머리글이 날짜·금액 둘 다 매칭(«정산일자»)", why: "🔴 같은 열을 날짜로도 금액으로도 고른다",
    html: `<table><tr><th>정산일자</th><th>금액</th></tr>
           <tr><td>09.13</td><td>1,200원</td></tr></table>`,
    want: { found: true, day: "09.13", amount: "1,200원", rows: 1 },
  },
  {
    name: "금액 열이 둘(예상 / 확정)", why: "🔴🔴 **예상치를 확정 수익으로 적는다** — 숫자가 멀쩡해 보여 아무도 못 알아챈다",
    html: `<table><tr><th>날짜</th><th>예상수익</th><th>확정수익</th></tr>
           <tr><td>09.13</td><td>9,999원</td><td>1,200원</td></tr></table>`,
    want: { found: true, day: "09.13", amount: "1,200원", rows: 1, estimated: false },
  },
  {
    name: "예상 열밖에 없다", why: "예상만 있으면 **그걸 쓰되 «예상»이라고 표시**한다(안 쓰면 애드포스트가 아무것도 못 모은다)",
    html: `<table><tr><th>날짜</th><th>예상수입</th></tr>
           <tr><td>09.13</td><td>9,999원</td></tr></table>`,
    want: { found: true, day: "09.13", amount: "9,999원", rows: 1, estimated: true },
  },
  {
    name: "thead / tbody 로 나뉜 표", why: "실제 화면은 대부분 이 모양이다",
    html: `<table><thead><tr><th>일자</th><th>수입</th></tr></thead>
           <tbody><tr><td>09.13</td><td>1,200원</td></tr></tbody></table>`,
    want: { found: true, day: "09.13", amount: "1,200원", rows: 1 },
  },
  /* ── 음성 대조 — 여기서 found:true 가 나오면 이 검사는 «아무 표나 통과시키는» 검사다 ── */
  {
    name: "음성① 금액 열이 없는 표", why: "🔴 날짜만 있는 표를 수익표로 읽으면 안 된다",
    html: `<table><tr><th>날짜</th><th>노출수</th></tr><tr><td>09.13</td><td>1,000</td></tr></table>`,
    want: { found: false },
  },
  {
    name: "음성② 표가 아예 없다", why: "카드형 화면(미가입 안내 등)",
    html: `<div><p>날짜</p><p>수익 1,200원</p></div>`,
    want: { found: false },
  },
  {
    name: "음성③ 머리글만 있고 행이 0개", why: "행 0개는 «없음»이지 오류가 아니다 — 그러나 **표는 찾은 것**이다",
    html: `<table><tr><th>날짜</th><th>수익</th></tr></table>`,
    want: { found: true, rows: 0 },
  },
];

const b = await chromium.launch({ headless: true });
const page = await b.newPage();
let pass = 0; const fails: string[] = [];
console.log("\n  수익 표 찾기 실측 (진짜 DOM)\n");

for (const c of CASES) {
  await page.setContent(`<html><body>${c.html}</body></html>`);
  const r = await findRevenueTable(page) as {
    found: boolean; dayIdx?: number; amountIdx?: number; header?: string[]; rows?: string[][];
    amountEstimated?: boolean; summaryRows?: number; tables?: number;
  };
  const bad: string[] = [];
  if (r.found !== c.want.found) bad.push(`found 기대 ${c.want.found} · 실제 ${r.found}`);
  if (c.want.found && r.found) {
    const rows = r.rows ?? [];
    if (c.want.rows !== undefined && rows.length !== c.want.rows) bad.push(`행 수 기대 ${c.want.rows} · 실제 ${rows.length}`);
    if (c.want.day !== undefined) {
      const got = rows[0]?.[r.dayIdx ?? -1];
      if (got !== c.want.day) bad.push(`날짜칸 기대 «${c.want.day}» · 실제 «${got}»`);
    }
    if (c.want.amount !== undefined) {
      const got = rows[0]?.[r.amountIdx ?? -1];
      if (got !== c.want.amount) bad.push(`금액칸 기대 «${c.want.amount}» · 실제 «${got}»`);
    }
    if (c.want.estimated !== undefined && !!r.amountEstimated !== c.want.estimated) bad.push(`예상표시 기대 ${c.want.estimated} · 실제 ${!!r.amountEstimated}`);
    if (c.want.summary !== undefined && (r.summaryRows ?? 0) !== c.want.summary) bad.push(`합계행 기대 ${c.want.summary} · 실제 ${r.summaryRows ?? 0}`);
  }
  if (!bad.length) pass++; else fails.push(`${c.name} — ${bad.join(" · ")}   (${c.why})`);
  console.log(`  ${bad.length ? "✗" : "✓"} ${c.name}`);
  if (bad.length) {
    for (const x of bad) console.log(`      ${x}`);
    console.log(`      머리글=${JSON.stringify(r.header ?? null)} rows=${JSON.stringify(r.rows ?? null)}`);
  }
}
await b.close();

/* 🔴 «전부 found» 나 «전부 not found» 면 검사가 아무것도 안 보는 것이다. */
const positives = CASES.filter((c) => c.want.found).length;
const negatives = CASES.length - positives;
console.log(`\n  ${positives > 0 && negatives > 0 ? "✓" : "✗"} 음성 대조 — 찾아야 할 표 ${positives}개 · 찾으면 안 되는 것 ${negatives}개`);
if (!(positives > 0 && negatives > 0)) fails.push("케이스가 한쪽뿐이다 — 초록이어도 의미가 없다");

console.log(`\n  통과 ${pass}/${CASES.length}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 날짜·금액 열을 정확히 고르고, 밀린 행도 합계 행도 놓치지 않는다.\n");
