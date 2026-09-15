/**
 * lib/cs-inbound.ts — **앱 밖에서 온 문의**(이메일 답장 · 카카오 채널)를 티켓함 한 목록으로(계약 P1R8-B §4.3 · DESIGN §11.4).
 *
 *   ══ 무엇이 빠져 있었나 ══
 *     `tickets.channel` 에 `email`·`kakao` 값은 **처음부터 있었다.** 그런데 **그 길로 들어올 문이 없었다** —
 *     운영자가 답변 메일을 보내면 고객은 거기에 **답장**을 하는데, 그 답장은 대표 메일함에서 끝나고 티켓엔 안 붙었다.
 *     설계가 «한 목록»이라 적어 둔 그 목록에서 **바깥에서 온 것만** 빠져 있었다.
 *
 *   ══ 이 파일이 지키는 것 다섯 ══
 *     ① 🔴 **같은 메시지를 두 번 적지 않는다.** 메일·카카오 웹훅은 **재시도가 규격**이다(공급사가 200 을 못 받으면 또 보낸다).
 *        멱등의 전부는 `ticket_messages.external_id` 유일 제약이고, 이 파일은 그 제약을 **믿고** 쓴다(조회로 막지 않는다 — 경합이 있다).
 *     ② 🔴 **우리 고객이 아니어도 버리지 않는다.** 보낸 사람을 못 찾으면 `tenant_id` 를 비우고 `from_email` 만 적는다.
 *        버리면 그 사람은 답을 영영 못 받고, 우리는 «문의가 없었다»고 착각한다(조용한 0건 · CLAUDE §4.7).
 *     ③ 🔴 **자동응답과 우리 메일은 안 받는다.** 부재중 자동회신에 우리가 또 답하면 **메일 루프**가 돈다(둘 다 기계다).
 *     ④ 실타래를 잇는다 — 제목의 `[AC-123]` → 스레드 id → 같은 사람의 최근 열린 티켓 순.
 *     ⑤ 해결된 티켓에 새 말이 오면 **다시 연다**(SLA 시계도 다시 건다). «해결»은 우리 판단이지 고객 판단이 아니다.
 *
 *   🔴 공급사 키·시크릿은 **이 파일에 없다** — 문(`netlify/functions/cs-inbound.ts`)이 확인하고, 값은 로그·응답·감사 어디에도 안 찍는다.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { createTicket, SLA_HOURS, type TicketPriority } from "./cs";
import { jsonb } from "./db-util";

const n = (v: unknown) => Number(v || 0);

export type InboundSource = "email" | "kakao";

export interface InboundMessage {
  source: InboundSource;
  /** 🔴 공급사 메시지 id — **멱등의 전부**. 없으면 받지 않는다(두 번 붙는 것보다 안 받는 게 낫다). */
  externalId: string;
  /** 메일 스레드·카카오 방 id. 있으면 같은 티켓에 잇는다. */
  threadRef?: string | null;
  from: { email?: string | null; name?: string | null; userKey?: string | null };
  subject?: string | null;
  text: string;
  attachments?: { key: string; url?: string }[];
  /** 메일 헤더(자동응답·루프 판정용). 키는 소문자로 넘긴다. */
  headers?: Record<string, string>;
}

export type InboundResult =
  | { ok: true; ticketId: number; created: boolean; appended: boolean; tenantId: number | null; reason?: string }
  | { ok: false; error: string; step: string };

/** 나가는 메일 제목에 박는 실타래 표시 — 고객이 답장하면 이 글자로 티켓을 찾는다. */
export function subjectWithRef(subject: string, ticketId: number): string {
  const ref = `[AC-${Math.floor(Number(ticketId) || 0)}]`;
  return String(subject ?? "").includes(ref) ? String(subject) : `${ref} ${subject ?? ""}`.trim().slice(0, 160);
}

/** 제목·본문에서 `[AC-123]` 을 찾는다. 답장 제목은 «Re: [AC-123] …» 이라 제목만 봐도 대개 잡힌다. */
export function ticketRefIn(...texts: (string | null | undefined)[]): number | null {
  for (const t of texts) {
    const m = /\[AC-(\d{1,12})\]/i.exec(String(t ?? ""));
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * 🔴 **자동응답·대량 메일·우리 자신**이면 받지 않는다.
 *   부재중 회신에 답하면 저쪽도 기계라 또 답한다 — 둘 다 기계인 무한 루프는 **사람이 끊어야** 끝난다.
 *   근거는 추측이 아니라 표준 헤더다(RFC 3834 `auto-submitted` · 통용되는 `precedence`·`x-auto-response-suppress`).
 */
export function isAutoReply(headers?: Record<string, string> | null, fromEmail?: string | null): { skip: boolean; why: string } {
  const h = headers ?? {};
  const get = (k: string) => String(h[k] ?? h[k.toLowerCase()] ?? "").toLowerCase();
  const auto = get("auto-submitted");
  if (auto && auto !== "no") return { skip: true, why: "auto-submitted" };
  if (["bulk", "list", "junk"].includes(get("precedence"))) return { skip: true, why: "precedence" };
  if (get("x-autoreply") === "yes" || get("x-autorespond")) return { skip: true, why: "x-autoreply" };
  if (get("list-unsubscribe")) return { skip: true, why: "list-mail" };
  /* 우리가 보낸 메일이 되돌아온 경우 — 보낸이가 우리 주소면 받지 않는다(루프의 반쪽). */
  const me = String(process.env.RESEND_FROM ?? "").toLowerCase();
  const meAddr = /<([^>]+)>/.exec(me)?.[1] ?? me;
  const from = String(fromEmail ?? "").toLowerCase().trim();
  if (meAddr && from && from === meAddr) return { skip: true, why: "self" };
  return { skip: false, why: "" };
}

/** 보낸 사람 → 우리 고객인가. 이메일만 본다(카카오는 아직 이어 줄 열쇠가 없다 — 없는 것을 있는 척하지 않는다). */
async function matchTenant(email?: string | null): Promise<{ tenantId: number | null; userId: number | null }> {
  const e = String(email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) return { tenantId: null, userId: null };
  try {
    const [u] = await q(sql`SELECT id, tenant_id FROM users WHERE lower(email) = ${e} ORDER BY id LIMIT 1`);
    return u ? { tenantId: n(u.tenant_id) || null, userId: n(u.id) || null } : { tenantId: null, userId: null };
  } catch { return { tenantId: null, userId: null }; }
}

/** 이어 붙일 티켓 찾기 — ① 제목의 `[AC-n]` ② 실타래 id ③ 같은 사람의 최근 열린 티켓(14일). */
async function findThread(m: InboundMessage, fromEmail: string | null, tenantId: number | null): Promise<number | null> {
  const ref = ticketRefIn(m.subject, m.text);
  if (ref) {
    const [t] = await q(sql`SELECT id FROM tickets WHERE id = ${ref}`);
    if (t) return n(t.id);
  }
  const thread = String(m.threadRef ?? "").trim().slice(0, 190);
  if (thread) {
    const [t] = await q(sql`SELECT id FROM tickets WHERE external_ref = ${thread} ORDER BY (status <> 'resolved') DESC, id DESC LIMIT 1`);
    if (t) return n(t.id);
  }
  if (fromEmail) {
    const [t] = await q(sql`SELECT id FROM tickets
      WHERE status <> 'resolved' AND created_at > NOW() - interval '14 days'
        AND (lower(from_email) = ${fromEmail} ${tenantId ? sql`OR tenant_id = ${tenantId}` : sql``})
      ORDER BY id DESC LIMIT 1`);
    if (t) return n(t.id);
  }
  return null;
}

/**
 * receiveInbound — 바깥에서 온 말 한 통을 티켓함에 넣는다.
 *   🔴 **웹훅에 500 을 주지 않는다**(공급사가 영원히 재시도한다) — 실패도 `ok:false` 로 돌려주고 문이 200 을 준다.
 */
export async function receiveInbound(m: InboundMessage): Promise<InboundResult> {
  const source: InboundSource = m.source === "kakao" ? "kakao" : "email";
  const externalId = String(m.externalId ?? "").trim().slice(0, 190);
  const text = String(m.text ?? "").trim().slice(0, 8000);
  if (!externalId) return { ok: false, error: "메시지 id 가 없어요.", step: "external_id" };
  if (!text) return { ok: false, error: "내용이 비어 있어요.", step: "empty" };

  const fromEmail = String(m.from?.email ?? "").trim().toLowerCase().slice(0, 190) || null;
  const auto = isAutoReply(m.headers, fromEmail);
  if (auto.skip) return { ok: true, ticketId: 0, created: false, appended: false, tenantId: null, reason: `skipped:${auto.why}` };

  /* 🔴 이미 받은 메시지인가 — 유일 제약이 최종 방어선이지만, 먼저 물어보면 «이미 처리»를 정직하게 말할 수 있다. */
  const [dup] = await q(sql`SELECT ticket_id FROM ticket_messages WHERE external_id = ${externalId} LIMIT 1`);
  if (dup) return { ok: true, ticketId: n(dup.ticket_id), created: false, appended: false, tenantId: null, reason: "duplicate" };

  const who = await matchTenant(fromEmail);
  const subject = String(m.subject ?? "").replace(/^\s*(re|fwd|답장|전달)\s*:\s*/i, "").replace(/\[AC-\d+\]\s*/i, "").trim().slice(0, 160)
    || (source === "kakao" ? "카카오 채널 문의" : "메일 문의");
  const attachments = Array.isArray(m.attachments) ? m.attachments.slice(0, 10) : [];
  const thread = String(m.threadRef ?? "").trim().slice(0, 190) || null;

  try {
    let ticketId = await findThread(m, fromEmail, who.tenantId);
    let created = false;
    if (!ticketId) {
      const r = await createTicket({
        tenantId: who.tenantId, userId: who.userId, subject, text, source,
        priority: "normal" as TicketPriority, tags: [source],
        ...(attachments.length ? { attachments } : {}),
        /* 🔴 테넌트를 못 찾으면 컨텍스트가 없다 — **빈 객체를 넣지 «모르는 것을 지어내지»** 않는다(AC-9). */
        ...(who.tenantId ? {} : { context: { unclaimed: true, from: fromEmail ?? m.from?.userKey ?? "" } }),
      });
      if (!r.ok) return { ok: false, error: r.error, step: "create" };
      ticketId = r.ticketId; created = true;
      /* 첫 줄은 `createTicket` 이 이미 넣었다 — 그 줄에 바깥 표시를 달아 준다(같은 말을 두 번 넣지 않는다). */
      await q(sql`UPDATE ticket_messages SET external_id = ${externalId}, source = ${source}
        WHERE ticket_id = ${ticketId} AND external_id IS NULL AND id = (SELECT MIN(id) FROM ticket_messages WHERE ticket_id = ${ticketId})`);
      await q(sql`UPDATE tickets SET external_ref = COALESCE(external_ref, ${thread}), from_email = COALESCE(from_email, ${fromEmail}), from_name = COALESCE(from_name, ${String(m.from?.name ?? "").slice(0, 120) || null}) WHERE id = ${ticketId}`);
    } else {
      await q(sql`INSERT INTO ticket_messages (ticket_id, author_type, author_id, body, attachments, external_id, source)
        VALUES (${ticketId}, ${"customer"}, ${who.userId}, ${text}, ${attachments.length ? jsonb(attachments) : null}, ${externalId}, ${source})
        ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING`);
      /* 🔴 해결된 티켓에 새 말이 오면 **다시 연다** — «해결»은 우리 판단이고, 고객이 다시 물었으면 안 끝난 것이다.
         SLA 시계도 다시 건다(안 걸면 그 티켓만 영원히 «늦지 않은» 상태가 된다). */
      await q(sql`UPDATE tickets SET
          status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END,
          resolved_at = CASE WHEN status = 'resolved' THEN NULL ELSE resolved_at END,
          sla_due_at = CASE WHEN status = 'resolved' THEN NOW() + (${SLA_HOURS.normal} || ' hours')::interval ELSE sla_due_at END,
          external_ref = COALESCE(external_ref, ${thread}),
          from_email = COALESCE(from_email, ${fromEmail}),
          tenant_id = COALESCE(tenant_id, ${who.tenantId}),
          last_message_at = NOW(), updated_at = NOW()
        WHERE id = ${ticketId}`);
    }
    const [own] = await q(sql`SELECT tenant_id FROM tickets WHERE id = ${ticketId}`);
    return { ok: true, ticketId, created, appended: !created, tenantId: own?.tenant_id ? n(own.tenant_id) : null };
  } catch (e) {
    console.error("[cs-inbound] 받기 실패", source, String((e as Error)?.message ?? e).slice(0, 200));
    return { ok: false, error: "문의를 받지 못했어요.", step: "write" };
  }
}
