/**
 * lib/cron/base.ts — 크론 스텝이 공유하는 것들: 타입 · KST 소도구 · 알림(중복 억제) · 슬롯 상태 쓰기 한 곳.
 *   계약 §1(스텝 계약) · DESIGN §5B.6(슬롯 상태기계) · §5B.4(변수 8).
 *
 *   ⚠️ 시각 규칙(PITFALLS #4 · AC-5): timestamp 칸은 tz 없는 UTC 저장이다.
 *     ① Date 객체를 sql 템플릿에 바인딩하지 않는다 — `.toISOString()` 문자열 + `::timestamptz AT TIME ZONE 'UTC'`.
 *     ② «이번 주(KST)»·«오늘(KST)» 같은 경계는 SQL 안에서 만든다(`kstWeekStartUtc()`·`kstTodayUtc()`) — 드라이버 시간대 변환 0.
 *     ③ 예외는 «지금 KST 몇 시인가»(`kstHour`) 뿐이다 — DB 를 타지 않는 순수 산술(+9h)이라 드라이버 tz 와 무관하다.
 */
import { sql, type SQL } from "drizzle-orm";
import { q } from "../accounts";
import type { ScheduleSettings } from "../slots";

/* ───────── 타입 ───────── */
export type Every = "5m" | "hourly";

/** 한 테넌트를 한 스텝이 도는 동안의 문맥. */
export interface TenantCtx {
  tid: number;
  key: string;
  planKey: string;
  settings: ScheduleSettings;
  /** tenants.settings 원본(스케줄 밖 값이 필요한 스텝용 — 예: coinAutoUsePurchased). */
  raw: Record<string, unknown>;
  /** 이번 틱의 기준 시각(틱 안에서 고정 — 스텝마다 now 가 흔들리지 않게). */
  now: Date;
  /** 이 스텝이 이 틱에서 쓸 수 있는 마지막 시각(ms · Date.now() 와 비교). 넘기면 남은 일은 다음 주기로. */
  deadline: number;
  /** 수동 강제 실행(`?secret=`)인가 — 시각 게이트(produceHour 등)를 로그에 남기는 용도. */
  manual: boolean;
}

/** 스텝 1회의 결과. changed/skipped 는 «건» 단위(테넌트 단위가 아니다 — 예산으로 미룬 테넌트는 우산이 detail 에 센다). */
export interface StepOutcome {
  changed: number;
  skipped: number;
  detail?: Record<string, unknown>;
}
export const NOOP: StepOutcome = { changed: 0, skipped: 0 };

export interface CronStep {
  /** 계약 §1 의 step 이름 그대로(`slots.roll` 등). 감사 action 은 `cron_` + 점→밑줄(`cron_slots_roll`). */
  key: string;
  every: Every;
  /**
   * 자동 편성(`settings.autoSchedule`)이 꺼져 있으면 건너뛰나.
   *   🔴 true = 편성표가 만드는 것(roll·assign·produce·review_deadline) — 꺼 뒀는데 글이 생기면 그것이 AC-2 사고다.
   *   false = 사람이 만든 글도 먹여 살려야 하는 것(publisher·learn·reap) — 자동 편성과 무관하게 돈다.
   */
  needsAutoSchedule: boolean;
  run(ctx: TenantCtx): Promise<StepOutcome>;
}

/* ───────── KST 소도구 ───────── */
const KST_MS = 9 * 3600 * 1000;
/** 지금(또는 주어진 시각)의 KST «시»(0~23). 순수 산술 — DB·드라이버 tz 무관. */
export function kstHour(now: Date): number { return new Date(now.getTime() + KST_MS).getUTCHours(); }
/** 'HH:MM' → 시(0~23). 형식이 틀리면 기본값. */
export function hourOf(hhmm: string, dflt = 6): number {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || ""));
  const h = m ? Number(m[1]) : NaN;
  return Number.isInteger(h) && h >= 0 && h <= 23 ? h : dflt;
}

/** 이번 주(월요일 00:00 KST)를 **UTC 벽시계 timestamp** 로 — `created_at`(tz 없는 UTC) 과 직접 비교 가능. */
export function kstWeekStartUtc(): SQL { return sql`((date_trunc('week', (NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')`; }
/** 오늘(KST) 00:00 을 UTC 벽시계 timestamp 로. */
export function kstTodayStartUtc(): SQL { return sql`((date_trunc('day', (NOW() AT TIME ZONE 'Asia/Seoul')) AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'UTC')`; }
/** 오늘(KST) 날짜 — SQL 안에서 만든 date. */
export function kstToday(): SQL { return sql`(NOW() AT TIME ZONE 'Asia/Seoul')::date`; }

/** Date → sql 바인딩(AC-5: Date 객체 금지 · 문자열 + 캐스트). */
export function ts(d: Date): SQL { return sql`${d.toISOString()}::timestamptz AT TIME ZONE 'UTC'`; }

/* ───────── 알림 ───────── */
/**
 * notifyOnce — 같은 (tenant, kind, 제목) 알림이 `withinHours` 안에 있으면 **쓰지 않는다**.
 *   크론은 같은 조건을 매 시간 다시 만난다(코인 부족·소재 없음·러너 오프라인) — 중복 알림이 곧 «알림을 끄는 이유»가 된다.
 *   `byKind`: 제목에 숫자가 섞이는 알림(«소재 12개 정했어요»)은 숫자가 바뀔 때마다 «다른 제목»이 되어 중복 억제가 풀린다.
 *     그런 종류는 **kind 단위**로 억제한다(테넌트당 그 종류의 알림은 창 안에 1건).
 *   반환 = 실제로 새로 쓴 알림 1건인가. 실패는 비치명(throw 0) — 알림 장애가 편성을 멈추지 않는다.
 */
export async function notifyOnce(tid: number, kind: string, title: string, body: string, link: string, opts: { withinHours?: number; byKind?: boolean } = {}): Promise<boolean> {
  const withinHours = Math.max(1, Math.round(opts.withinHours ?? 20));
  try {
    const t = title.slice(0, 160);
    const k = kind.slice(0, 32);
    const [dup] = opts.byKind
      ? await q(sql`SELECT 1 FROM notifications WHERE tenant_id = ${tid} AND kind = ${k}
          AND created_at > NOW() - (${withinHours} || ' hours')::interval LIMIT 1`)
      : await q(sql`SELECT 1 FROM notifications WHERE tenant_id = ${tid} AND kind = ${k} AND title = ${t}
          AND created_at > NOW() - (${withinHours} || ' hours')::interval LIMIT 1`);
    if (dup) return false;
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${k}, ${t}, ${body.slice(0, 2000)}, ${link.slice(0, 200)})`);
    return true;
  } catch (e) { console.error("[cron/notify] 실패", kind, String((e as Error)?.message ?? e).slice(0, 120)); return false; }
}

/** withTimeout — 오래 걸릴 수 있는 일(LLM 호출)에 우산 예산을 씌운다. 시간이 지나면 «못 했다»로 돌려주고 원래 일은 흘려보낸다(rejection 은 삼킨다). */
export async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = p.catch((e) => { console.warn("[cron] 흘려보낸 작업 실패", String((e as Error)?.message ?? e).slice(0, 120)); return null as T | null; });
  try {
    return await Promise.race([guarded, new Promise<null>((res) => { timer = setTimeout(() => res(null), Math.max(500, ms)); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/* ───────── 슬롯 상태 쓰기(한 경로) ───────── */
/**
 * setSlot — 슬롯 상태 전이 한 곳(§5B.6). note 는 사람말 사유.
 *   멱등: 같은 상태로 다시 쓰면 0행(변경 수를 부풀리지 않는다) — 반환 = 실제로 바뀐 행이 있나.
 *   🔴 piece 생성 뒤의 `in_review`·`failed` 동기화는 여기가 아니라 `lib/content-gen.ts`(배경 함수 말미) 한 곳이다 — 두 곳에서 쓰지 않는다.
 */
export async function setSlot(tid: number, slotId: number, status: string, note?: string | null): Promise<boolean> {
  const r = await q(sql`UPDATE slots SET status = ${status}, ${note === undefined ? sql`note = note` : sql`note = ${note === null ? null : String(note).slice(0, 300)}`}, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${slotId} AND status <> ${status} RETURNING id`);
  return r.length > 0;
}
