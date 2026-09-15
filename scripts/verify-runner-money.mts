/**
 * scripts/verify-runner-money.mts — 화면의 글자를 **돈과 날짜**로 바꾸는 층을 실제로 돌려서 확인한다(2026-09-15 B2).
 *
 *   🔴 왜 여기부터인가: adfit·clip 실측은 계정에 막혀 있다(카카오 2단계 · 클립 미가입).
 *      그런데 **화면을 열기만 하면 그다음은 전부 이 층을 지난다** — 주소가 맞아도 여기가 틀리면
 *      «수익 12,340원»이 조용히 다른 숫자·다른 날짜가 된다. 계정 없이 지금 확인할 수 있는 건 여기다.
 *
 *   🔴 이 층의 실패는 **소리가 안 난다.** 잘못 읽은 금액도 숫자고, 잘못 읽은 날짜도 날짜다.
 *      그래서 «못 읽으면 null»(AC-9)이 지켜지는지를 **틀린 성공 쪽으로** 집중해서 본다.
 *
 *   실행: npx --yes tsx scripts/verify-runner-money.mts      (DB·네트워크·브라우저 불필요)
 */
import { parseKrw, parseDayKst, parseMonthKst, todayKst, rowsToRevenue } from "../runner/lib/money.mjs";

/** 시각을 고정한다 — «오늘»이 움직이면 어제 초록이던 게 오늘 빨강이 된다(재현 가능해야 한다). */
const NOW = new Date("2026-09-15T05:00:00Z");   // KST 2026-09-15 14:00

interface C { in: string; want: unknown; why: string }

const MONEY: C[] = [
  { in: "12,340원",        want: 12340, why: "보통 모양" },
  { in: "₩ 12 340",        want: 12340, why: "통화기호·공백" },
  { in: "+1,200",          want: 1200,  why: "증감 표기의 +" },
  { in: "１２０",           want: 120,   why: "전각 숫자" },
  { in: "0",               want: 0,     why: "🔴 0원은 **값**이다(null 이 아니다) — 진짜 0원과 못 읽음을 갈라야 한다" },
  { in: "-500",            want: -500,  why: "차감·환불" },
  { in: "12,340원(예상)",   want: null,  why: "🔴 «예상»이 붙으면 확정 금액이 아니다 — 못 읽음으로 둔다" },
  { in: "약 1,000원",       want: null,  why: "🔴 «약»은 어림수 — 숫자만 뽑아 1000 으로 적으면 거짓이 된다" },
  { in: "",                want: null,  why: "빈 칸" },
  { in: "-",               want: null,  why: "표의 «없음» 표시(대시)를 0 으로 바꾸지 않는다" },
];

const DATES: C[] = [
  { in: "2026.09.14",      want: "2026-09-14", why: "연도 있음" },
  { in: "2026-09-14",      want: "2026-09-14", why: "하이픈" },
  { in: "2026년 9월 14일",  want: "2026-09-14", why: "한글" },
  { in: "09.14",           want: "2026-09-14", why: "연도 없음 → 올해" },
  { in: "09/14",           want: "2026-09-14", why: "슬래시" },
  { in: "9월 14일",         want: "2026-09-14", why: "한글·연도 없음" },
  { in: "12.31",           want: "2025-12-31", why: "🔴 연도 없는 **미래** 날짜 = 작년(연말 경계) — 이건 접는 게 맞다" },
  { in: "26.09.14",        want: "2026-09-14", why: "두 자리 연도" },
  { in: "26.12.31",        want: "2026-12-31", why: "🔴 연도를 **명시**한 미래 날짜는 접으면 안 된다(26 = 2026)" },
  { in: "25.12.31",        want: "2025-12-31", why: "두 자리 연도(작년)" },
  { in: "1.234",           want: null,         why: "🔴 **금액처럼 생긴 것이 날짜가 되면 안 된다** — 열이 밀렸을 때 이게 마지막 방어선이다" },
  { in: "12,340",          want: null,         why: "🔴 금액이 날짜 칸에 들어온 경우" },
  { in: "abc",             want: null,         why: "글자" },
  { in: "",                want: null,         why: "빈 칸" },
];

let pass = 0; const fails: string[] = [];
const check = (label: string, got: unknown, want: unknown, input: string, why: string) => {
  const ok = got === want;
  if (ok) pass++; else fails.push(`${label} «${input}» — 기대 ${JSON.stringify(want)} · 실제 ${JSON.stringify(got)}  (${why})`);
  console.log(`  ${ok ? "✓" : "✗"} ${label} «${input}»`.padEnd(38) + `→ ${String(got).padEnd(12)} ${why}`);
};

console.log(`\n  돈·날짜 읽기 실측 — 기준 시각 KST ${todayKst(NOW)}\n`);
console.log("  [금액]");
for (const c of MONEY) check("금액", parseKrw(c.in), c.want, c.in, c.why);
console.log("\n  [날짜]");
for (const c of DATES) check("날짜", parseDayKst(c.in, NOW), c.want, c.in, c.why);

/* ── 월 단위 — 클립 인센티브는 **월별로만** 주는 화면이 있다(채널 주석: «월별이면 그 달 1일로 적고»).
      🔴 그 «적는다»가 실제로는 구현이 없어 월별 표가 통째로 `parse` 실패했다(2026-09-15 실측). ── */
console.log("\n  [월 단위]");
const MONTHS: C[] = [
  { in: "2026.09",      want: "2026-09-01", why: "그 달 1일로" },
  { in: "2026-09",      want: "2026-09-01", why: "하이픈" },
  { in: "2026년 9월",    want: "2026-09-01", why: "한글" },
  { in: "9월",          want: "2026-09-01", why: "연도 없음 → 올해" },
  { in: "2026.13",      want: null,         why: "13월은 없다" },
  { in: "12,340",       want: null,         why: "🔴 금액이 월 칸에 들어온 경우" },
  { in: "2026.09.14",   want: null,         why: "🔴 **일 단위는 월로 읽지 않는다** — 날짜가 있는데 1일로 뭉개면 안 된다" },
  { in: "abc",          want: null,         why: "글자" },
];
for (const c of MONTHS) check("월", parseMonthKst(c.in, NOW), c.want, c.in, c.why);

/* ── 표 한 장 단위 — 한 행이라도 못 읽으면 **전체 실패**여야 한다(부분 성공을 0 으로 채우면 합계가 거짓이 된다) ── */
console.log("\n  [표 한 장]");
const tableCases: { name: string; rows: { dayText: string; amountText: string; raw?: Record<string, unknown> }[]; wantOk: boolean; why: string }[] = [
  {
    name: "정상 3행", wantOk: true, why: "전부 읽힌다",
    rows: [{ dayText: "09.13", amountText: "1,200원" }, { dayText: "09.14", amountText: "0" }, { dayText: "09.15", amountText: "3,400원" }],
  },
  {
    name: "가운데 행 금액 깨짐", wantOk: false, why: "🔴 부분 성공 금지 — 2행만 적으면 합계가 거짓이 된다",
    rows: [{ dayText: "09.13", amountText: "1,200원" }, { dayText: "09.14", amountText: "집계 중" }, { dayText: "09.15", amountText: "3,400원" }],
  },
  {
    name: "열이 밀려 금액이 날짜 칸에", wantOk: false, why: "🔴 밀린 표를 «성공»으로 읽으면 엉뚱한 날에 돈이 붙는다",
    rows: [{ dayText: "1,200", amountText: "09.13" }],
  },
  { name: "빈 표", rows: [], wantOk: true, why: "행 0개 = «없음»이지 오류가 아니다(미가입 계정이 그렇다)" },
  {
    name: "월별 표(머리글이 «월»)", wantOk: true, why: "클립 인센티브 — 그 달 1일로 적는다",
    rows: [{ dayText: "2026.08", amountText: "50,000원", raw: { period: "month" } }],
  },
  {
    name: "🔴 월 글자인데 «월» 선언 없음", wantOk: false, why: "선언 없이 월로 받아 주면 **열이 밀린 표**를 성공으로 읽는다",
    rows: [{ dayText: "2026.08", amountText: "50,000원" }],
  },
];
for (const t of tableCases) {
  const r = rowsToRevenue("adfit", t.rows) as { ok: boolean; reason?: string };
  const ok = r.ok === t.wantOk;
  if (ok) pass++; else fails.push(`표 «${t.name}» — 기대 ok=${t.wantOk} · 실제 ok=${r.ok} (${t.why})`);
  console.log(`  ${ok ? "✓" : "✗"} 표 «${t.name}»`.padEnd(38) + `→ ok=${String(r.ok).padEnd(6)} ${r.reason ?? ""} ${ok ? "" : "← " + t.why}`);
}

/* 🔴 음성 대조 — «전부 null» 이나 «전부 통과» 면 이 검사는 아무것도 안 보는 것이다. */
const moneyVals = MONEY.map((c) => parseKrw(c.in));
const dateVals = DATES.map((c) => parseDayKst(c.in, NOW));
const spread = moneyVals.some((v) => v !== null) && moneyVals.some((v) => v === null)
  && dateVals.some((v) => v !== null) && dateVals.some((v) => v === null);
console.log(`\n  ${spread ? "✓" : "✗"} 음성 대조 — 값과 null 이 ${spread ? "둘 다 나온다" : "🔴 한쪽만 나온다(검사가 헛돈다)"}`);
if (!spread) fails.push("판정이 한쪽으로 쏠렸다 — 초록이어도 의미가 없다");

const total = MONEY.length + DATES.length + MONTHS.length + tableCases.length;
console.log(`\n  통과 ${pass}/${total}`);
if (fails.length) { console.error("\n  ✗ 실패:\n" + fails.map((f) => `    · ${f}`).join("\n") + "\n"); process.exitCode = 1; }
else console.log("\n  ✓ 돈과 날짜를 정확히 읽는다(못 읽는 것은 null 로 둔다).\n");
