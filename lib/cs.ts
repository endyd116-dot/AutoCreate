/**
 * lib/cs.ts — 🔴 **티켓 생성 한 벌** `createTicket()`(계약 §5 · §2.1 ops-cs · DESIGN §11.4 CS).
 *   고객 «문의하기» · 시스템 자동 티켓(러너 실패·결제 실패·계정 정지 3회) · 운영 수동 — 셋 다 이 함수만 부른다.
 *
 *   ══ 규칙 ══
 *     · 시스템 티켓은 `autoKey` 로 멱등 — 같은 사유의 **열린** 티켓이 있으면 새로 만들지 않고 그 티켓에 메시지 1줄만 붙인다
 *       (유니크 (tenant_id, auto_key) WHERE auto_key IS NOT NULL · 해결된 뒤 같은 사유가 또 나면 새 티켓).
 *     · 컨텍스트 자동 첨부(고객이 안 적어도): 플랜·상태·코인·러너 온라인/전체·최근 오류 3건·앱 버전 → `tickets.context`(jsonb).
 *     · SLA 마감 = 생성 + 우선순위별 시간(SLA_HOURS 한 곳). 첫 답변 시각·마지막 메시지 시각을 유지한다(운영 통계 재료).
 *     · 이 파일은 cron·publish 를 import 하지 않는다(AC-17). 이메일은 호출부(ops-cs 답변)가 보낸다.
 *   🔎 출처: AC 신규(계약 P1R4-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { jsonb, utcDate } from "./db-util";
import { balance } from "./coin-ledger";

const n = (v: unknown) => Number(v || 0);

export type TicketSource = "app" | "email" | "kakao" | "system" | "ops";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "progress" | "hold" | "resolved";
/** 우선순위별 SLA(시간) — 정본 한 곳. */
export const SLA_HOURS: Readonly<Record<TicketPriority, number>> = { urgent: 4, high: 12, normal: 24, low: 72 };

export interface CreateTicketInput {
  tenantId: number | null;
  userId?: number | null;
  subject: string;
  text: string;
  source: TicketSource;
  priority?: TicketPriority;
  tags?: string[];
  attachments?: { key: string; url?: string }[];
  /** 시스템 티켓 멱등 키(예: `billing_fail:12:2026-09` · `runner_fail:acc:16`). 열린 같은 키가 있으면 재사용. */
  autoKey?: string;
  /** 없으면 자동 첨부. */
  context?: Record<string, unknown>;
  appVersion?: string;
}
export type CreateTicketResult = { ok: true; ticketId: number; created: boolean } | { ok: false; error: string };

/** 티켓에 자동으로 붙는 고객 컨텍스트(계약 §2.4(5) ops-ticket.context 모양). */
export async function ticketContext(tid: number, appVersion?: string): Promise<Record<string, unknown>> {
  try {
    const [t] = await q(sql`SELECT plan_key, status FROM tenants WHERE id = ${tid}`);
    const b = await balance(tid);
    const [r] = await q(sql`SELECT COUNT(*) FILTER (WHERE status = 'online')::int AS online, COUNT(*)::int AS total FROM runner_devices WHERE tenant_id = ${tid}`);
    const errs = await q(sql`SELECT created_at, action, COALESCE(detail->>'error', detail->>'reason', detail->>'errorKind', '') AS text FROM audit_logs
      WHERE tenant_id = ${tid} AND risk_level IN ('medium','high','critical') ORDER BY id DESC LIMIT 3`);
    return {
      planKey: String(t?.plan_key ?? ""), status: String(t?.status ?? ""), coins: b.balance,
      runner: { online: n(r?.online), total: n(r?.total) },
      recentErrors: errs.map((e) => ({ at: utcDate(e.created_at)?.toISOString() ?? "", kind: String(e.action), text: String(e.text ?? "").slice(0, 200) })),
      ...(appVersion ? { appVersion } : {}),
    };
  } catch { return {}; }
}

export async function createTicket(input: CreateTicketInput): Promise<CreateTicketResult> {
  const subject = String(input.subject ?? "").trim().slice(0, 160);
  const text = String(input.text ?? "").trim().slice(0, 8000);
  if (!subject || !text) return { ok: false, error: "제목과 내용이 필요해요." };
  const priority: TicketPriority = (["low", "normal", "high", "urgent"] as const).includes(input.priority as TicketPriority) ? input.priority as TicketPriority : "normal";
  const source: TicketSource = (["app", "email", "kakao", "system", "ops"] as const).includes(input.source) ? input.source : "app";
  const tags = Array.isArray(input.tags) ? [...new Set(input.tags.map((t) => String(t).slice(0, 30)))].slice(0, 10) : [];
  const tid = input.tenantId ? Math.floor(input.tenantId) : null;
  const autoKey = input.autoKey ? String(input.autoKey).slice(0, 80) : null;
  try {
    // 시스템 티켓 멱등 — 열린 같은 키가 있으면 메시지만 덧붙인다.
    if (autoKey && tid) {
      const [open] = await q(sql`SELECT id FROM tickets WHERE tenant_id = ${tid} AND auto_key = ${autoKey} AND status <> 'resolved' LIMIT 1`);
      if (open) {
        await q(sql`INSERT INTO ticket_messages (ticket_id, author_type, author_id, body, attachments) VALUES (${n(open.id)}, ${"system"}, ${null}, ${text}, ${null})`);
        await q(sql`UPDATE tickets SET last_message_at = NOW(), updated_at = NOW() WHERE id = ${n(open.id)}`);
        return { ok: true, ticketId: n(open.id), created: false };
      }
      // 해결된 옛 티켓이 유니크를 잡고 있으면 그 키를 비워 새 티켓이 들어갈 자리를 만든다(같은 사유 재발 = 새 티켓).
      await q(sql`UPDATE tickets SET auto_key = NULL WHERE tenant_id = ${tid} AND auto_key = ${autoKey} AND status = 'resolved'`);
    }
    const context = input.context ?? (tid ? await ticketContext(tid, input.appVersion) : {});
    const [t] = await q(sql`INSERT INTO tickets (tenant_id, user_id, channel, source, subject, status, priority, tags, context, auto_key, sla_due_at, last_message_at)
      VALUES (${tid}, ${input.userId ?? null}, ${source === "ops" ? "app" : source}, ${source}, ${subject}, ${"open"}, ${priority}, ${jsonb(tags)}, ${jsonb(context)}, ${autoKey},
              NOW() + (${SLA_HOURS[priority]} || ' hours')::interval, NOW()) RETURNING id`);
    const ticketId = n(t?.id);
    await q(sql`INSERT INTO ticket_messages (ticket_id, author_type, author_id, body, attachments)
      VALUES (${ticketId}, ${source === "system" ? "system" : source === "ops" ? "operator" : "customer"}, ${input.userId ?? null}, ${text}, ${input.attachments?.length ? jsonb(input.attachments.slice(0, 10)) : null})`);
    const [chk] = await q(sql`SELECT jsonb_typeof(context) AS t, jsonb_typeof(tags) AS g FROM tickets WHERE id = ${ticketId}`);
    if (chk && (chk.t !== "object" || chk.g !== "array")) console.error("[cs] tickets jsonb_typeof 이상", chk);   // PITFALLS #1
    return { ok: true, ticketId, created: true };
  } catch (e) {
    console.error("[cs] createTicket 실패", String((e as Error)?.message ?? e).slice(0, 200));
    return { ok: false, error: "문의를 남기지 못했어요. 잠시 뒤 다시 해 주세요." };
  }
}

/** 티켓 1행 → 계약 §2.4(5) Ticket 모양. */
export function toTicketRow(r: Record<string, unknown>): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: n(r.id), tenantId: r.tenant_id ? n(r.tenant_id) : null, tenantName: r.tenant_name ? String(r.tenant_name) : "",
    subject: String(r.subject ?? ""), status: String(r.status ?? "open"), priority: String(r.priority ?? "normal"),
    tags: Array.isArray(r.tags) ? r.tags : [], source: String(r.source ?? r.channel ?? "app"),
    createdAt: utcDate(r.created_at)?.toISOString() ?? "", updatedAt: utcDate(r.updated_at)?.toISOString() ?? "",
  };
  if (r.assignee_id) o.assignee = { id: n(r.assignee_id), name: r.assignee_name ? String(r.assignee_name) : "" };
  const sla = utcDate(r.sla_due_at); if (sla) o.slaDueAt = sla.toISOString();
  if (r.satisfaction !== null && r.satisfaction !== undefined) o.rating = n(r.satisfaction) > 0;
  return o;
}
