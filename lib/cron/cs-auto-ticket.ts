/**
 * lib/cron/cs-auto-ticket.ts — 스텝 `cs.auto_ticket`(계약 §2.1 ops-cs «자동 티켓» · DESIGN §11.4 CS). hourly 우산 · 테넌트별.
 *   규칙(«3회 반복» · 최근 72시간 · 같은 사유는 주 1건 · `createTicket` 한 벌 · autoKey 로 멱등):
 *     ① 러너 실패   runner_jobs status failed ≥ 3          → `runner_fail:{tid}:{KST 주}`     태그 러너 · high
 *     ② 결제 실패   subscriptions.fail_count ≥ 3            → `billing_fail:{tid}:{period}`   (applyChargeResult 가 정지 때 같은 키로 만든다 — 열려 있으면 건너뜀)
 *     ③ 계정 정지   audit account_transition action=suspend ≥ 3 → `account_suspended:{tid}:{KST 주}` 태그 계정 · high
 *   열린 같은 키가 있으면 **아무것도 하지 않는다**(매시간 메시지가 붙어 시끄러워지는 것을 막는다). 해결된 뒤 다음 주에 또 반복되면 새 티켓.
 *   🔎 출처: AC 신규(계약 P1R4-B §2.1·§2.3 운영센터 6메뉴 + 원격접속 60분 · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { createTicket } from "../cs";
import type { CronStep, StepOutcome } from "./base";

const n = (v: unknown) => Number(v || 0);
export const AUTO_TICKET_THRESHOLD = 3;
export const AUTO_TICKET_WINDOW_HOURS = 72;

/** KST 기준 ISO 주 라벨 'YYYY-Www'. */
export function kstWeekOf(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600_000);
  const day = (k.getUTCDay() + 6) % 7;                       // 월=0
  const thu = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate() - day + 3));
  const y0 = new Date(Date.UTC(thu.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thu.getTime() - y0.getTime()) / 86400_000 - 3 + ((y0.getUTCDay() + 6) % 7)) / 7);
  return `${thu.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function hasOpen(tid: number, autoKey: string): Promise<boolean> {
  const [r] = await q(sql`SELECT 1 FROM tickets WHERE tenant_id = ${tid} AND auto_key = ${autoKey} AND status <> 'resolved' LIMIT 1`);
  return !!r;
}

export const csAutoTicketStep: CronStep = {
  key: "cs.auto_ticket",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx): Promise<StepOutcome> {
    const tid = ctx.tid;
    const week = kstWeekOf(ctx.now);
    const detail: Record<string, unknown> = {};
    let changed = 0;

    // ① 러너 실패
    const [rf] = await q(sql`SELECT COUNT(*) AS c, string_agg(DISTINCT COALESCE(error_kind, 'unknown'), ', ') AS kinds, string_agg(DISTINCT kind, ', ') AS jobs
      FROM runner_jobs WHERE tenant_id = ${tid} AND status = 'failed' AND updated_at > NOW() - (${AUTO_TICKET_WINDOW_HOURS} || ' hours')::interval`);
    if (n(rf?.c) >= AUTO_TICKET_THRESHOLD) {
      const key = `runner_fail:${tid}:${week}`;
      if (!await hasOpen(tid, key)) {
        const r = await createTicket({ tenantId: tid, subject: `러너 실패 ${n(rf.c)}회(${AUTO_TICKET_WINDOW_HOURS}시간)`, text: `최근 ${AUTO_TICKET_WINDOW_HOURS}시간 동안 러너 작업이 ${n(rf.c)}번 실패했어요.\n작업: ${rf.jobs ?? "-"}\n사유: ${rf.kinds ?? "-"}\n고객 PC 러너·계정 로그인·셀렉터를 확인해 주세요.`, source: "system", priority: "high", tags: ["자동", "러너"], autoKey: key });
        if (r.ok && r.created) { changed++; detail.runnerFail = r.ticketId; }
      }
    }
    // ② 결제 실패
    const [bf] = await q(sql`SELECT s.fail_count, s.period_start, s.cycle, i.period FROM subscriptions s
      LEFT JOIN LATERAL (SELECT period FROM invoices x WHERE x.tenant_id = s.tenant_id AND x.kind = 'subscription' AND x.status = 'failed' ORDER BY x.updated_at DESC LIMIT 1) i ON true
      WHERE s.tenant_id = ${tid}`);
    if (n(bf?.fail_count) >= AUTO_TICKET_THRESHOLD) {
      const period = String(bf?.period ?? "unknown");
      const key = `billing_fail:${tid}:${period}`;
      if (!await hasOpen(tid, key)) {
        const r = await createTicket({ tenantId: tid, subject: `결제 실패 ${n(bf.fail_count)}회(${period})`, text: `카드 청구가 ${n(bf.fail_count)}회 연속 실패했어요. 고객에게 결제 수단 확인을 안내해 주세요.`, source: "system", priority: "high", tags: ["자동", "결제"], autoKey: key });
        if (r.ok && r.created) { changed++; detail.billingFail = r.ticketId; }
      }
    }
    // ③ 계정 정지
    const [as] = await q(sql`SELECT COUNT(*) AS c, string_agg(DISTINCT target, ', ') AS targets FROM audit_logs
      WHERE tenant_id = ${tid} AND action = 'account_transition' AND detail->>'action' = 'suspend' AND created_at > NOW() - (${AUTO_TICKET_WINDOW_HOURS} || ' hours')::interval`);
    if (n(as?.c) >= AUTO_TICKET_THRESHOLD) {
      const key = `account_suspended:${tid}:${week}`;
      if (!await hasOpen(tid, key)) {
        const r = await createTicket({ tenantId: tid, subject: `계정 정지 ${n(as.c)}회(${AUTO_TICKET_WINDOW_HOURS}시간)`, text: `최근 ${AUTO_TICKET_WINDOW_HOURS}시간 동안 계정이 ${n(as.c)}번 정지됐어요(${as.targets ?? "-"}). 캐던스·계정 상태·플랫폼 제재 여부를 확인해 주세요.`, source: "system", priority: "high", tags: ["자동", "계정"], autoKey: key });
        if (r.ok && r.created) { changed++; detail.accountSuspended = r.ticketId; }
      }
    }
    return { changed, skipped: 0, ...(Object.keys(detail).length ? { detail } : {}) };
  },
};
