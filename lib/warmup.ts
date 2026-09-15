/**
 * lib/warmup.ts — 계정 워밍업(계약 P1R7 §2.6 · 사장님 지시 2026-09-15).
 *
 *   새 계정을 첫날부터 하루 1건씩 돌리는 것이 **대량 정지의 1번 원인**이다.
 *   IP 를 나누는 것(§2.5 · 돈이 든다)보다 **앞선 방어이고 0원**이다(원가표 §6.3).
 *   그래서 2~4주에 걸쳐 천천히 올린다: **1주차 주 1건 · 2주차 주 2건 · 3주차 주 3건 · 4주차부터 정상.**
 *
 *   ── 설계에서 지킨 것 두 개 ────────────────────────────────────────────────
 *   🔴 ① **`daily_cap` 을 DB 에 덮어쓰지 않는다.** 저장값은 «고객의 뜻»이다.
 *        덮어쓰면 워밍업이 끝날 때 무엇으로 되돌릴지 알 수 없고, 고객은 «내가 정한 값이 왜 바뀌었지»를 본다.
 *        그래서 **판정 시점에 유효 상한을 계산**한다 — 이 파일이 그 계산의 단일 출처다.
 *   🔴 ② **새 게이트를 만들지 않는다.** 캐던스를 보는 자리가 이미 셋이라(director·director-auto·account-health)
 *        게이트를 하나 더 만들면 넷이 된다. 대신 **게이트가 읽는 값(`AccountRow.dailyCap`) 자체를 유효값으로** 만든다 —
 *        그러면 기존 세 자리가 **코드를 안 고쳐도** 워밍업을 따른다.
 *
 *   ── 기준일 ────────────────────────────────────────────────────────────────
 *   `opened_at`(계정을 만든 날 · 고객이 알면 입력) > `created_at`(우리와 연결한 날).
 *   🔴 3년 된 계정을 «새 계정»처럼 묶으면 고객만 손해다 — 오래된 계정은 첫 주부터 정상으로 돈다.
 */

/** 주차별 **주간** 허용 건수. 4주차부터는 null = 제한 없음(고객의 `daily_cap` 이 그대로 산다). */
const WEEKLY_QUOTA: readonly (number | null)[] = [1, 2, 3];
/** 워밍업 중에는 하루에 몇 건까지 — 주간 할당이 남아 있어도 하루에 몰아 쓰지 않게. */
const WARMUP_DAILY_CAP = 1;

export interface WarmupInput {
  /** 계정을 만든 날(있으면 이게 기준). */
  openedAt?: Date | string | null;
  /** 우리와 연결한 날(accounts.created_at). */
  createdAt?: Date | string | null;
  /** 고객이 껐나. */
  off?: boolean | null;
  /** 이번 주(월~일 KST)에 이 계정이 이미 올린 건수. 모르면 생략 — 주간 판정은 건너뛴다. */
  postsThisWeek?: number | null;
}

export interface WarmupState {
  /** 지금 워밍업 중인가. */
  active: boolean;
  /** 1·2·3 주차(워밍업 중일 때만) · 아니면 0. */
  week: number;
  /** 이번 주 허용 건수(워밍업 중일 때만) · 아니면 null. */
  weeklyQuota: number | null;
  /** 사람이 읽는 한 줄(화면이 그대로 쓴다). 워밍업이 아니면 빈 문자열. */
  label: string;
}

const toDate = (v: unknown): Date | null => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d : null;
};

/** 기준일로부터 지난 일수(0 이상). 기준일을 모르면 null(= 워밍업 판정 불가 → 하지 않는다). */
function daysSince(inp: WarmupInput, now: Date): number | null {
  const base = toDate(inp.openedAt) ?? toDate(inp.createdAt);
  if (!base) return null;
  const ms = now.getTime() - base.getTime();
  return ms < 0 ? 0 : Math.floor(ms / 86_400_000);
}

/**
 * 지금 이 계정이 워밍업의 어디쯤인가.
 *   🔴 기준일을 **모르면 워밍업을 하지 않는다**(AC-9 — «모른다»를 «새 계정»으로 바꾸지 않는다).
 *      옛 계정 행에 날짜가 비어 있다고 갑자기 주 1건으로 묶으면, 잘 돌던 고객이 이유 없이 멈춘다.
 */
export function warmupState(inp: WarmupInput, now: Date = new Date()): WarmupState {
  const none: WarmupState = { active: false, week: 0, weeklyQuota: null, label: "" };
  if (inp.off) return none;
  const days = daysSince(inp, now);
  if (days === null) return none;
  const week = Math.floor(days / 7);            // 0 = 1주차
  if (week >= WEEKLY_QUOTA.length) return none; // 4주차부터 정상
  const quota = WEEKLY_QUOTA[week];
  return {
    active: true,
    week: week + 1,
    weeklyQuota: quota,
    label: `천천히 올리는 중이에요 · ${week + 1}주차(이번 주 ${quota}건까지)`,
  };
}

/**
 * **유효 하루 상한** — 게이트가 실제로 볼 값.
 *   워밍업 중이면 ①하루 1건으로 낮추고 ②이번 주 할당을 다 썼으면 **0**(= 오늘은 더 못 올린다).
 *   🔴 `postsThisWeek` 를 모르면 주간 판정을 **건너뛴다**(하루 상한만 적용) — 모르는 값으로 막지 않는다.
 */
export function effectiveDailyCap(storedCap: number, inp: WarmupInput, now: Date = new Date()): number {
  const cap = Math.max(0, Math.floor(Number(storedCap) || 0));
  const st = warmupState(inp, now);
  if (!st.active) return cap;
  const week = Number(inp.postsThisWeek);
  if (Number.isFinite(week) && st.weeklyQuota !== null && week >= st.weeklyQuota) return 0;
  return Math.min(cap, WARMUP_DAILY_CAP);
}

/**
 * 워밍업 중 **최소 발행 간격**(분). 간격도 함께 늘린다 — 하루 1건이어도 «매일 같은 시각 정각»은 기계 티가 난다.
 *   고객이 정한 값보다 **짧아지지 않는다**(늘리기만 한다).
 */
export function effectiveMinGapMin(storedGap: number, inp: WarmupInput, now: Date = new Date()): number {
  const gap = Math.max(0, Math.floor(Number(storedGap) || 0));
  return warmupState(inp, now).active ? Math.max(gap, 360) : gap;   // 6시간
}
