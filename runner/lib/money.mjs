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
  if ((m = /(\d{4})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})/.exec(s))) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else if ((m = /^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s))) { y = 2000 + Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else if ((m = /(\d{1,2})[.\-/월]\s*(\d{1,2})일?/.exec(s))) { y = yNow; mo = Number(m[1]); d = Number(m[2]); }
  else return null;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  let out = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  if (out > today && y === yNow && !/\d{4}/.test(s)) out = `${y - 1}-${out.slice(5)}`;   // 연도 없는 미래 날짜 = 작년
  return out;
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
    const day = parseDayKst(r.dayText, opts.now);
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
