/**
 * runner/lib/money.mjs — 화면에서 읽은 금액·날짜를 서버 계약 모양으로(순수 · IO 0). 계약 P1R3 §2.1·§0.
 *
 *   🔴 AC-9 — «못 읽음»과 «0원»은 다르다. 파싱 함수는 실패를 **null** 로 돌려주고, 호출자는 null 을 0 으로 바꾸지 않는다.
 *   숫자 정규화: «원 · , · 공백 · ＋ · + · ₩ · 전각 숫자» → 정수. 소수점은 반올림하지 않고 **버림**(원 단위 아래는 없다).
 *   날짜: 화면의 «2026.09.14» · «2026-09-14» · «09/14» · «9월 14일» → KST `YYYY-MM-DD`. 연도가 없으면 오늘(KST) 기준으로 채운다.
 */

const FULLWIDTH_DIGITS = "０１２３４５６７８９";
function normalizeDigits(s) {
  return String(s ?? "").replace(/[０-９]/g, (ch) => String(FULLWIDTH_DIGITS.indexOf(ch)));
}

/** «12,340원» «₩ 12 340» «+1,200» «１２０» → 12340 · 못 읽으면 null(0 이 아니다). */
export function parseKrw(text) {
  const s = normalizeDigits(text).replace(/[원₩＋+\s]/g, "").replace(/,/g, "").trim();
  if (!s) return null;
  const m = /^-?\d+(?:\.\d+)?$/.exec(s);
  if (!m) return null;
  const v = Math.trunc(Number(s));
  return Number.isFinite(v) ? v : null;
}

/** 오늘(KST) YYYY-MM-DD. */
export function todayKst(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * 화면 날짜 → KST YYYY-MM-DD. 지원: 2026.09.14 · 2026-09-14 · 2026/09/14 · 26.09.14 · 09.14 · 09/14 · 9월 14일 · 2026년 9월 14일.
 *   연도가 없으면 올해(KST). 미래 날짜가 되면(연말·연초 경계) 작년으로 접는다. 못 읽으면 null.
 */
export function parseDayKst(text, now = new Date()) {
  const s = normalizeDigits(text).trim();
  const today = todayKst(now);
  const yNow = Number(today.slice(0, 4));
  let y, mo, d;
  let m;
  /* 🔴 `yearGiven` — **화면이 연도를 말했나**. 아래 «작년으로 접기»가 이 값에만 걸린다.
     종전엔 «원문에 네 자리 숫자가 있나»(`!/\d{4}/.test(s)`)로 대신 봤는데, 그건 틀린 대용물이었다:
     «26.12.31» 은 연도를 **명시**했는데도 점이 끼어 있어 네 자리 연속 숫자가 없다 → 연도 없는 것으로 오해 →
     **2025-12-31 로 접혔다**(실측 2026-09-15 · `scripts/verify-runner-money.mts`). 수익이 통째로 다른 해에 붙는다. */
  let yearGiven = false;
  if ((m = /(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/.exec(s))) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); yearGiven = true; }
  else if ((m = /^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s))) { y = 2000 + Number(m[1]); mo = Number(m[2]); d = Number(m[3]); yearGiven = true; }
  /* 🔴 앞뒤로 숫자가 더 붙어 있으면 **날짜가 아니다**(`(?<!\d)` · `(?!\d)`).
     종전엔 경계가 없어 «1.234»(금액)가 «1월 23일»로 읽혔다 — 뒤의 «4» 를 조용히 버리고 **그럴듯한 날짜**를 만들어 냈다.
     표의 열이 밀렸을 때 그걸 붙잡는 마지막 방어선이 여기라, 여기서 새면 엉뚱한 날짜에 돈이 붙고 아무도 모른다. */
  else if ((m = /(?<!\d)(\d{1,2})[.\-/월]\s*(\d{1,2})일?(?!\d)/.exec(s))) { y = yNow; mo = Number(m[1]); d = Number(m[2]); }
  else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  let out = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  // 연도를 **안 말한** 미래 날짜 = 작년(연말·연초 경계). 말했으면 그대로 믿는다.
  if (out > today && !yearGiven) out = `${y - 1}-${out.slice(5)}`;
  return out;
}

/**
 * 월 단위 표기 → 그 달 **1일**(KST `YYYY-MM-01`). 지원: 2026.09 · 2026-09 · 2026년 9월 · 9월. 못 읽으면 null.
 *
 *   🔴 왜 필요한가: 클립 인센티브는 **월별로만** 주는 화면이 있다. 채널 주석은 «월별이면 그 달 1일로 적고»라고
 *      적어 뒀는데 **그 «적는다»가 구현이 없어서**, 월별 표를 만나면 `parseDayKst` 가 null 을 내고
 *      표 한 장이 통째로 `parse` 실패했다(2026-09-15 실측). 문서에만 있고 코드에 없던 동작이다.
 *
 *   🔴 **일(day)까지 있는 글자는 월로 읽지 않는다.** «2026.09.14» 를 1일로 뭉개면 그날 수익이 그 달 1일로 옮겨 가고,
 *      합계는 맞는데 날짜별 그래프가 조용히 거짓이 된다. 애매하면 읽지 않는 쪽이다(AC-9).
 */
export function parseMonthKst(text, now = new Date()) {
  const s = normalizeDigits(text).trim();
  if (!s) return null;
  // 일까지 있는 모양이면 월이 아니다(위 🔴).
  if (/(\d{4})[.\-/년]\s*\d{1,2}[.\-/월]\s*\d{1,2}/.test(s)) return null;
  if (/^\d{2}[.\-/]\d{1,2}[.\-/]\d{1,2}/.test(s)) return null;
  const yNow = Number(todayKst(now).slice(0, 4));
  let y, mo, m;
  if ((m = /(?<!\d)(\d{4})[.\-/년]\s*(\d{1,2})월?(?!\d)/.exec(s))) { y = Number(m[1]); mo = Number(m[2]); }
  else if ((m = /(?<!\d)(\d{1,2})월(?!\d)/.exec(s))) { y = yNow; mo = Number(m[1]); }   // 연도 없으면 올해
  else return null;
  if (!(mo >= 1 && mo <= 12)) return null;
  return `${y}-${String(mo).padStart(2, "0")}-01`;
}

/**
 * 표 한 장 → RevenueRow[] 재료. rows 는 [{ dayText, amountText, ...extra }].
 *   한 행이라도 못 읽으면 **전체를 실패**로 돌린다(부분 성공을 0 으로 채우면 합계가 거짓이 된다 · AC-9).
 *   반환 { ok:true, rows } | { ok:false, reason, at }.
 */
export function rowsToRevenue(source, rows, opts = {}) {
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    /* 🔴 월 단위 되돌림은 **그 표가 «월»이라고 말했을 때만** 쓴다(`raw.period === "month"` — 채널이 머리글을 보고 넣는다).
       선언 없이 월 표기를 받아 주면, **열이 밀린 표**(금액 칸에 «2026.08» 같은 게 들어온 경우)를 «성공»으로 읽게 된다.
       그 선언이 바로 «이 칸은 날짜가 아니라 달이다»라는 화면의 진술이라, 그게 있을 때만 믿는다. */
    const wantsMonth = !!r.raw && typeof r.raw === "object" && r.raw.period === "month";
    let day = parseDayKst(r.dayText, opts.now);
    if (day === null && wantsMonth) day = parseMonthKst(r.dayText, opts.now);
    const amountKrw = parseKrw(r.amountText);
    if (!day) return { ok: false, reason: `날짜를 못 읽음(${i}행: «${String(r.dayText).slice(0, 20)}»)`, at: i };
    if (amountKrw === null) return { ok: false, reason: `금액을 못 읽음(${i}행: «${String(r.amountText).slice(0, 20)}»)`, at: i };
    const row = { source, day, amountKrw, currency: "KRW" };
    if (opts.accountId) row.accountId = opts.accountId;
    if (r.raw !== undefined) row.raw = r.raw;
    out.push(row);
  }
  return { ok: true, rows: out };
}
