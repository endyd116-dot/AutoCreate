/**
 * lib/cron/runner.ts — 크론 우산(계약 §1 · DESIGN §5B.7). 스텝 등록기 + 테넌트 루프 + 26초 예산 + 감사.
 *   AM 원본: ../AutoMarketing/netlify/functions/cron-tick-5m.ts · cron-tick-hourly.ts (우산 2개 관례 참고 · 2026-09-14)
 *     AM 은 «잡 레지스트리 + due 창(지금−N분, 지금]» 구조였다(잡마다 분 단위 선언). AC 의 스텝은 7개뿐이고 전부
 *     «테넌트를 한 바퀴 돈다»라서 due 창을 두지 않았다 — **틱 주기 = 스텝 주기**(이중 발화 0 · 창 계산 0).
 *     시각 게이트가 필요한 스텝(`slots.produce` 의 produceHour)은 스텝 안에서 KST 시(hour)를 본다.
 *
 *   ══ 이 파일이 지키는 것 ══
 *     ① **한 집이 죽어도 옆집은 산다** — 테넌트 단위 try/catch. 예외는 errors 로 세고 다음 테넌트로 간다.
 *     ② **조용한 누락 0**(PITFALLS #7) — «예외 없이 돌았다»는 통과가 아니다. 스텝마다 tenants/changed/skipped/errors 를 세어
 *        응답·콘솔·감사에 같은 숫자를 남긴다. 예산으로 미룬 테넌트는 detail.budgetSkipped 로 **따로** 보인다.
 *     ③ **26초 벽** — 틱 전체 예산 20초. 스텝마다 «남은 예산 ÷ 남은 스텝»을 배분해 앞 스텝이 뒤 스텝을 굶기지 않는다.
 *        예산이 끝나면 남은 테넌트는 다음 주기로 미룬다(취소가 아니다 — 다음 틱이 같은 조건을 다시 만난다).
 *     ④ **테넌트 순서 회전** — 매 틱 같은 순서로 돌면 뒤쪽 테넌트가 영원히 굶는다. 틱 번호로 시작 위치를 돌린다(결정론).
 *     ⑤ **게이트** — Netlify 스케줄 호출(`x-nf-event: schedule` 또는 본문 `next_run`) 이거나 `CRON_SECRET` 일치. 아니면 401.
 *        CRON_SECRET 미설정이면 수동 호출은 **막는다**(조용히 열리지 않는다).
 *
 *   감사: 틱마다 `cron_tick` 1행(모든 스텝의 숫자를 detail 에 — 0 도 포함 = 전건 기록) + 일이 있었던 스텝마다 `cron_<step>` 1행.
 *         action 의 점은 밑줄로(`slots.roll` → `cron_slots_roll` · audit_logs.action varchar(64)).
 */
import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { json } from "../response";
import { scheduleSettingsOf } from "../slots";
import { isGlobalStep, type AnyStep, type Every, type TenantCtx } from "./base";
import { rollStep } from "./roll";
import { assignTopicsStep } from "./assign-topics";
import { produceStep } from "./produce";
import { reviewDeadlineStep } from "./review-deadline";
import { publisherStep } from "./publisher";
import { learnStep } from "./learn";
import { reapStep } from "./reap";
import { videoSweepStep } from "./video-sweep";
import { revenueSyncStep } from "./revenue-sync";
import { billingChargeStep } from "./billing-charge";
import { trialExpireStep } from "./trial-expire";
import { csAutoTicketStep } from "./cs-auto-ticket";
import { runnerCanaryStep } from "./runner-canary";
import { aiModelWatchStep } from "./ai-model-watch";
import { tenantPurgeStep } from "./tenant-purge";
import { coinReconcileStep } from "./coin-reconcile";

/**
 * 틱 전체 예산(ms) — Netlify 동기 함수 26초 벽에서 6초 여유.
 *   `CRON_BUDGET_MS` 로 덮을 수 있다 — **로컬 검증 전용**이다(내 PC → Neon 은 질의당 ~300ms 라 같은 일이 수십 배 걸린다).
 *   프로덕션에는 설정하지 않는다: 26초를 넘기면 함수가 통째로 죽어 **그 틱의 감사·집계가 같이 사라진다**(무슨 일이 있었는지도 못 본다).
 */
const TICK_BUDGET_MS = Math.max(3_000, Math.min(600_000, Number(process.env.CRON_BUDGET_MS) || 20_000));
/** 뒤 스텝에 반드시 남겨 두는 몫(스텝당). 앞 스텝이 예산을 다 먹어도 뒤 스텝이 «한 건은» 해 볼 수 있게. */
const MIN_STEP_MS = 1_500;

/** 🔴 스텝 등록기 — 계약 §1 표 그대로. 순서 = 의존 순서(roll → assign → produce → review → learn). */
export const STEPS: AnyStep[] = [
  rollStep,            // hourly · 슬롯 생성(멱등)
  assignTopicsStep,    // hourly · 소재 배정
  produceStep,         // hourly(produceHour 시각에만) · D-3 제작
  reviewDeadlineStep,  // hourly · 검수창 마감
  learnStep,           // hourly · 발행 성과 회수
  revenueSyncStep,     // hourly(06:00 KST · 쿠팡 13:00) · 수익 회수(P1R3)
  billingChargeStep,   // hourly(09:00 KST) · 정기 청구·재시도·해지·연납 포함분(P1R4)
  trialExpireStep,     // hourly · 체험 D-3/D-1/D-0 알림(09:00) · 종료 → readonly(P1R4)
  csAutoTicketStep,    // hourly · 러너 실패·결제 실패·계정 정지 3회 → 시스템 티켓(P1R4 §2.1)
  runnerCanaryStep,    // hourly(05:00 KST 게이트) · 셀렉터 카나리 평가(P1R4 · 하루 1회 잠금)
  aiModelWatchStep,    // hourly(auto 승격 점검 매시간 · 발굴은 월 06:00 KST 주 1회) · AI 모델 감시(P1R4)
  coinReconcileStep,   // hourly(월 06:00 KST 주 1회 · 전역 1잠금) · 코인 원장 대조 — 어긋난 행 있을 때만 감사(P1R7 B3)
  tenantPurgeStep,     // hourly(04:00 KST 게이트 = 하루 1회) · **global** — 탈퇴 30일 지난 집 파기 + 내부 표시 동기화(P1R7 §3.1·§3.4)
  publisherStep,       // 5m · due 발행
  videoSweepStep,      // 5m · 멈춘 영상 체인 재개·종결(P1R5 §1.5)
  reapStep,            // 5m · 러너 잡 타임아웃 회수
];

export type { Every } from "./base";

export interface StepReport { step: string; tenants: number; changed: number; skipped: number; errors: number; detail?: Record<string, unknown> }

/* ───────── 게이트 ───────── */
function eq(a: string, b: string): boolean {
  const x = Buffer.from(String(a ?? ""), "utf8"), y = Buffer.from(String(b ?? ""), "utf8");
  if (x.length !== y.length || !x.length) return false;
  try { return timingSafeEqual(x, y); } catch { return false; }
}
/**
 * 스케줄 호출인가. Netlify 는 스케줄 호출에 `x-nf-event: schedule` 을 싣고, 본문에 `{ next_run }` 을 준다.
 *   둘 중 하나만 있어도 통과 — 한쪽이 런타임 판올림으로 사라져도 크론이 조용히 멈추지 않게(두 신호).
 */
async function isScheduled(req: Request): Promise<boolean> {
  if (String(req.headers.get("x-nf-event") ?? "").toLowerCase() === "schedule") return true;
  try {
    const body = await req.clone().json() as { next_run?: unknown };
    return typeof body?.next_run === "string" && !!body.next_run;
  } catch { return false; }
}
function secretOk(req: Request): boolean {
  const secret = String(process.env.CRON_SECRET ?? "").trim();
  if (!secret) return false;   // 미설정 = 수동 호출 불가(안전핀이 아니라 잠금)
  const h = String(req.headers.get("x-cron-secret") ?? "");
  let qp = "";
  try { qp = new URL(req.url).searchParams.get("secret") ?? ""; } catch { /* */ }
  return eq(h, secret) || eq(qp, secret);
}

/* ───────── 테넌트 ───────── */
interface TenantRow { tid: number; key: string; planKey: string; raw: Record<string, unknown> }
/** 활성 테넌트 = status trial|active. 정지·해지 테넌트는 크론이 건드리지 않는다. */
async function activeTenants(): Promise<TenantRow[]> {
  const rows = await q(sql`SELECT id, key, plan_key, settings FROM tenants WHERE status IN ('trial','active') ORDER BY id`);
  return rows.map((r) => ({
    tid: Number(r.id), key: String(r.key ?? ""), planKey: String(r.plan_key ?? "trial"),
    raw: (r.settings && typeof r.settings === "object" && !Array.isArray(r.settings) ? r.settings : {}) as Record<string, unknown>,
  }));
}

/* ───────── 틱 ───────── */
/**
 * runTick — 우산 본체. 두 크론 함수가 `every` 만 바꿔 부른다.
 *   반환 = 계약 §1 응답 `{ ok:true, ran:[StepReport] }`.
 */
export interface RunTickOpts {
  /**
   * 이 테넌트 하나만 돈다(수동 호출 전용 · `/api/cron-run?tid=`).
   *   왜 있나: 우산은 활성 테넌트를 **전부** 돈다. 검증할 때 남의 집 17채를 같이 돌면
   *   ①예산이 쪼개져 내가 보려던 스텝이 `budgetSkipped` 로 밀리고 ②숫자가 남의 집 것과 섞여 재현이 안 된다.
   *   스케줄 호출에는 적용되지 않는다(전체를 돌아야 한다).
   */
  onlyTid?: number | null;
}

export async function runTick(every: Every, req: Request, opts: RunTickOpts = {}): Promise<Response> {
  const t0 = Date.now();
  const manual = !(await isScheduled(req));
  if (manual && !secretOk(req)) {
    console.warn(`[cron:${every}] 401 — 스케줄 호출도 아니고 CRON_SECRET 도 아니다`);
    return json({ ok: false, error: "크론 호출 권한이 없어요.", step: "auth" }, 401);
  }
  const now = new Date();
  const deadline = t0 + TICK_BUDGET_MS;

  let tenants: TenantRow[];
  try {
    tenants = await activeTenants();
    const only = Math.floor(Number(opts.onlyTid) || 0);
    if (only > 0) tenants = tenants.filter((t) => t.tid === only);   // 수동 검증 — 한 집만
  }
  catch (e) {
    console.error(`[cron:${every}] 테넌트 조회 실패`, e);
    await writeAudit({ tenantId: null, action: "cron_tick", riskLevel: "high", detail: { every, error: String((e as Error)?.message ?? e).slice(0, 300) } });
    return json({ ok: false, error: "테넌트를 읽지 못했어요.", step: "tenants" }, 500);
  }

  const steps = STEPS.filter((s) => s.every === every);
  // 회전 시작 위치(결정론) — 매 틱 같은 순서로 돌지 않게(뒤쪽 테넌트 기아 방지).
  const periodMs = every === "5m" ? 5 * 60_000 : 60 * 60_000;
  const offset = tenants.length ? Math.floor(now.getTime() / periodMs) % tenants.length : 0;
  const ordered = tenants.length ? [...tenants.slice(offset), ...tenants.slice(0, offset)] : [];

  const ran: StepReport[] = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    /* 예산 배분 — «남은 예산 ÷ 남은 스텝»(균등 분할)은 틀렸다.
       균등 분할은 **일이 있는 스텝을 정확히 그만큼 굶긴다**: 5스텝이면 한 스텝의 몫이 20초 중 4초뿐이라,
       한 자리에 그보다 오래 걸리는 `slots.produce` 가 매 틱 «시작도 못 하고 deferred» 가 된다
       (2026-09-14 로컬 실측: 3자리 전건 유예 · 원인은 이 식이었다).
       그래서 «뒤 스텝 몫만 떼고 나머지는 다 쓰라»로 바꾼다 — 한가한 스텝은 일이 없으면 즉시 끝나 예산을 쥐고 있지 않고,
       일이 있는 스텝은 실제로 일할 수 있다. 뒤 스텝은 최소 `MIN_STEP_MS` 를 보장받는다(완전 기아 0). */
    const stepsLeft = steps.length - i;
    const remain = Math.max(0, deadline - Date.now());
    const reserve = (stepsLeft - 1) * MIN_STEP_MS;
    const stepDeadline = Date.now() + Math.max(MIN_STEP_MS, remain - reserve);
    const rep: StepReport = { step: step.key, tenants: 0, changed: 0, skipped: 0, errors: 0 };
    const budgetSkipped: number[] = [];
    const autoOff: number[] = [];
    const details: Record<string, unknown>[] = [];

    /* global 스텝 — 테넌트 루프 밖에서 한 번(탈퇴 파기처럼 «활성 테넌트 목록에 없는 집»을 도는 일).
       숫자 계약은 같다: tenants 는 1(이 스텝 자체)로 세고 changed/skipped/detail 은 그대로 싣는다. */
    if (isGlobalStep(step)) {
      rep.tenants = 1;
      try {
        const out = await step.run({ now, deadline: stepDeadline, manual });
        rep.changed += Math.max(0, out.changed | 0);
        rep.skipped += Math.max(0, out.skipped | 0);
        if (out.detail && Object.keys(out.detail).length) rep.detail = out.detail;
      } catch (e) {
        rep.errors++;
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        console.error(`[cron:${every}] step=${step.key} (global) 실패 — ${msg}`);
        await writeAudit({ tenantId: null, action: auditAction(step.key), riskLevel: "medium", target: `cron:${step.key}`, detail: { every, error: msg } });
      }
      ran.push(rep);
      console.log(`[cron:${every}] ${step.key} (global) → changed=${rep.changed} skipped=${rep.skipped} errors=${rep.errors}`);
      if (rep.changed > 0 || rep.errors > 0) await writeAudit({ tenantId: null, action: auditAction(step.key), riskLevel: rep.errors ? "medium" : "low", target: `cron:${step.key}`, detail: { every, ...rep } });
      continue;
    }

    for (const t of ordered) {
      if (Date.now() >= stepDeadline) { budgetSkipped.push(t.tid); continue; }
      const settings = scheduleSettingsOf(t.raw);
      if (step.needsAutoSchedule && !settings.autoSchedule) { autoOff.push(t.tid); continue; }
      const ctx: TenantCtx = { tid: t.tid, key: t.key, planKey: t.planKey, settings, raw: t.raw, now, deadline: stepDeadline, manual };
      rep.tenants++;
      try {
        const out = await step.run(ctx);
        rep.changed += Math.max(0, out.changed | 0);
        rep.skipped += Math.max(0, out.skipped | 0);
        if (out.detail && Object.keys(out.detail).length) details.push({ tid: t.tid, ...out.detail });
      } catch (e) {
        rep.errors++;
        const msg = String((e as Error)?.message ?? e).slice(0, 300);
        console.error(`[cron:${every}] step=${step.key} tenant=${t.tid} 실패 — ${msg}`);
        await writeAudit({ tenantId: t.tid, action: auditAction(step.key), riskLevel: "medium", target: `cron:${step.key}`, detail: { every, error: msg } });
      }
    }

    const detail: Record<string, unknown> = {};
    if (budgetSkipped.length) detail.budgetSkipped = budgetSkipped.length;
    if (autoOff.length) detail.autoScheduleOff = autoOff.length;
    if (details.length) detail.tenants = details.slice(0, 20);
    if (Object.keys(detail).length) rep.detail = detail;
    ran.push(rep);

    console.log(`[cron:${every}] ${step.key} → tenants=${rep.tenants} changed=${rep.changed} skipped=${rep.skipped} errors=${rep.errors}` +
      `${budgetSkipped.length ? ` budgetSkipped=${budgetSkipped.length}` : ""}${autoOff.length ? ` autoOff=${autoOff.length}` : ""}`);
    // 일이 있었던 스텝만 개별 감사 행(무동작까지 행을 남기면 원장이 크론 로그가 된다 — 무동작은 아래 cron_tick 이 0 으로 기록한다).
    if (rep.changed > 0 || rep.errors > 0 || budgetSkipped.length > 0) {
      await writeAudit({ tenantId: null, action: auditAction(step.key), riskLevel: rep.errors ? "medium" : "low", target: `cron:${step.key}`, detail: { every, ...rep } });
    }
  }

  const ms = Date.now() - t0;
  // 전건 기록 — 이 한 행에 모든 스텝의 숫자(0 포함)가 들어간다. «아무 일도 없었다»도 증거로 남는다(PITFALLS #7).
  await writeAudit({ tenantId: null, action: "cron_tick", riskLevel: "low", target: `cron:${every}`, detail: { every, ms, tenants: tenants.length, manual, onlyTid: opts.onlyTid ?? null, ran } });
  console.log(`[cron:${every}] 끝 ${ms}ms · 테넌트 ${tenants.length} · 스텝 ${ran.length}`);
  return json({ ok: true, ran, ms, tenants: tenants.length });
}

function auditAction(stepKey: string): string { return `cron_${stepKey.replace(/\./g, "_")}`.slice(0, 64); }
