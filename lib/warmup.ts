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
 *   🔎 출처: AC 신규(계약 P1R7-B2 2.6 · 생성 커밋 2026-09-15) — AM 원본 없음.
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
/**
 * 🔴 **워밍업은 «하드»가 아니다**(CLAUDE §9 · 사장님 지시 2026-09-15).
 *   «새 계정은 주 1건»이라는 규칙은 **어디에도 없다** — 플랫폼 문서에 그런 문장이 없고, **우리 추정**이다
 *   (간격 30분과 똑같다 · `docs/active/2026-09-15-proxy-cost.md` §6.3b).
 *   §9 의 하드 셋(①법령 위반 ②제3자가 다침 ③되돌릴 수 없음) 중 **어디에도 안 든다** —
 *   올린 글은 이제 **내릴 수 있고**(DESIGN §5E), 되돌릴 수 없는 건 «계정 정지»인데 그건 **위험**이지 확정이 아니다.
 *
 *   ⚠️ 종전엔 주간 할당을 넘기면 **0 을 반환**했다. 그러면 그 계정이 **발행 풀에서 통째로 빠져**
 *      (`director.ts:168` · `director-auto.ts:72` 가 `postsToday < dailyCap` 로 거른다)
 *      고객은 «오늘 하나 더»가 아니라 **«이번 주 끝»**을 맞고, 화면에는 **이유도 안 보인다**.
 *      «과한 정도»가 아니라 고장이었다.
 *
 *   ⇒ **`override` 를 받는다**: 고객이 «오늘은 하나 더 올릴래»를 **직접 눌렀을 때만** 주간 0 을 넘긴다.
 *     🔴 **끄는 것이 아니다**(끄는 건 `warmup_off` 가 따로 있다) — **그 회차만** 넘긴다. 저장하지 않는다.
 *     🔴 하루 상한(`WARMUP_DAILY_CAP`)은 그대로다 — «오늘 하나 더»지 «오늘 무제한»이 아니다.
 *     🔴 그리고 **`daily_cap`(고객이 정한 값)은 넘기지 않는다** — 우리 추정을 넘기는 것과
 *        고객이 스스로 정한 값을 우리가 넘겨 주는 것은 다르다. 후자면 그 설정이 무의미해진다.
 */
export interface CapOpts {
  /** 고객이 «이번만 넘길래»를 **직접 눌렀나**. 자동 편성(크론)은 절대 true 로 부르지 않는다. */
  override?: boolean;
}
export function effectiveDailyCap(storedCap: number, inp: WarmupInput, now: Date = new Date(), opts?: CapOpts): number {
  const cap = Math.max(0, Math.floor(Number(storedCap) || 0));
  const st = warmupState(inp, now);
  if (!st.active) return cap;
  const week = Number(inp.postsThisWeek);
  if (Number.isFinite(week) && st.weeklyQuota !== null && week >= st.weeklyQuota) {
    /* 주간 할당을 다 썼다 — 자동 편성은 여기서 멈춘다(0). 고객이 직접 눌렀으면 **하루 한 건**은 열어 준다.
       🔴 `cap` 을 넘지 않는다: 고객이 daily_cap 을 0 으로 뒀으면 그건 «올리지 마»라는 고객의 뜻이다. */
    return opts?.override ? Math.min(cap, WARMUP_DAILY_CAP) : 0;
  }
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

/**
 * warmupRisk — 🔴 **막지 않고 말한다**(간격·새벽과 같은 방식). 화면이 그대로 보여 준다.
 *   경우마다 **다른 문구**여야 한다 — 같으면 고객이 «왜 지금 그런지»를 모른다.
 *   @returns 위험 한 줄(워밍업이 아니면 null)
 */
export function warmupRisk(inp: WarmupInput, now: Date = new Date()): string | null {
  const st = warmupState(inp, now);
  if (!st.active) return null;
  const week = Number(inp.postsThisWeek);
  const full = Number.isFinite(week) && st.weeklyQuota !== null && week >= st.weeklyQuota;
  if (full) {
    /* 🔴 [CLAUDE §3 · 사장님 2026-09-15] «정지될 수 있어요»로 끝내지 않는다 — 막지도 않으면서 불안만 주는 말이 **게이트보다 나쁘다**.
       ①사실 한 줄 ②왜 그렇게 권하는지 ③고르는 것은 고객, 순서로 말한다. 위험은 **재료**로 주고 판단은 고객이 한다. */
    return `만든 지 얼마 안 된 계정이라 이번 주 권장량(${st.weeklyQuota}건)을 이미 채웠어요. `
      + "새 계정은 천천히 늘릴수록 오래 잘 돌아서 이렇게 권해 드려요.";
  }
  return `만든 지 얼마 안 된 계정이라 천천히 올리는 중이에요(${st.label}). 하루 1건까지 권해요.`;
}
