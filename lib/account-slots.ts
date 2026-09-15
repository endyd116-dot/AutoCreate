/**
 * lib/account-slots.ts — «계정 1개 + 전용 IP» 30일권(계약 P1R7 §3.6 · 사장님 지시 2026-09-15).
 *
 *   ══ 왜 30일권인가 ══
 *     IP 는 **월 과금**이다(proxy-cost §2). «한 번 사면 끝»으로 팔면 둘째 달부터 우리가 손해를 본다.
 *     그래서 30일권 + 자동 갱신으로 팔고, 갱신일에 코인을 다시 받는다(크론 `slot.renew`).
 *
 *   ══ 흐름(없는 걸 팔지 않는다) ══
 *     구매 → 슬롯 `waiting_ip`(**미차감** · 계정 한도는 늘어난다 — 그 슬롯에 붙일 계정을 만들 수 있어야 하니까)
 *       → 계정 연결 시 슬롯에 붙이고 **B2 `assignProxy(accountId)`** 를 부른다(lib/proxy-port.ts · IP 배정은 B2 정본)
 *       → `{ proxyId }` 면 **그때** 첫 기간을 받고 `active`(30일) · `{ pending }` 이면 «IP 준비 중» 그대로(크론이 매일 다시 묻는다)
 *     구매 때 첫 기간만큼의 잔액은 있어야 한다(검사만 · 차감은 배정 날) — 코인 0 으로 «IP 준비 중» 계정을 무한정 쓰는 구멍을 막는다.
 *
 *   ══ 잔액이 모자라면 ══ 그 **슬롯 하나만 «쉼»**(paused). 다른 계정·다른 기능은 그대로 돈다(§3.6-2). 쉬는 동안 그 계정은
 *     한도에서 빠지고 자동 편성에서 제외된다(`pausedAccountIds`). 코인이 채워지면 다음 크론이 다시 받고 켠다(다시 사라고 하지 않는다).
 *   ══ 환불 ══ 남은 기간 환불 없음(IP 를 월 단위로 우리가 낸다) · 다음 갱신 끄기만(`auto_renew=false`) · 끝나면 `releaseProxy`.
 *
 *   🔴 멱등 ref = `slot:{slotId}:{기간 번호}`(`periods_charged`+1) — 기간마다 유일하고, 크론이 여러 번 돌아도 같은 번호라 한 번만 받는다.
 *      ⚠️ 계약 초안의 `{YYYYMM}`(달)에는 구멍이 둘 있었다(둘 다 2026-09-15 스모크에서 잡았다):
 *        ① 31일 달의 1일에 산 슬롯은 30일 뒤가 **같은 달 31일** → 키가 겹쳐 **한 달치 공짜**.
 *        ② 날짜(YYYYMMDD)로 바꿔도 «같은 날 개시 → 쉼 → 재개»면 이미 받은 키를 다시 만나 **안 받고 재개**된다.
 *      기간 번호는 둘 다 막는다 — 못 받은 기간은 번호가 그대로라 재시도가 되고, 받은 기간은 두 번 받지 않는다.
 *   🔎 출처: AC 신규(계약 §3.6·푸시 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { utcDate } from "./db-util";
import { consume, balance } from "./coin-ledger";
import { accountSlotProduct, ACCOUNT_SLOT_DAYS, type AccountSlotKind } from "./plans";
import { COIN_KRW } from "./coin-table";
import { assignProxy, releaseProxy } from "./proxy-port";

const n = (v: unknown) => Number(v || 0);
/** 차감 멱등 키 — 기간 번호(1부터). 같은 기간을 다시 시도하면 같은 키라 두 번 받지 않는다. */
export const slotRef = (slotId: number, period: number): string => `slot:${slotId}:${Math.max(1, Math.floor(period))}`;
export const MAX_SLOTS_PER_BUY = 10;

export type SlotStatus = "waiting_ip" | "active" | "paused" | "cancelled";
export interface SlotView {
  id: number; kind: AccountSlotKind; status: SlotStatus; coins: number; krw: number;
  accountId: number | null; proxyId: number | null; autoRenew: boolean; periodsCharged: number;
  startedAt?: string; expiresAt?: string; daysLeft?: number; pausedAt?: string; label: string; managed: boolean;
}
function toView(r: Record<string, unknown>): SlotView {
  const p = accountSlotProduct(r.kind);
  const exp = utcDate(r.expires_at);
  const o: SlotView = {
    id: n(r.id), kind: String(r.kind) as AccountSlotKind, status: String(r.status) as SlotStatus,
    coins: n(r.coins_per_period), krw: n(r.coins_per_period) * COIN_KRW,
    accountId: r.account_id ? n(r.account_id) : null, proxyId: r.proxy_id ? n(r.proxy_id) : null,
    autoRenew: r.auto_renew === true, periodsCharged: n(r.periods_charged), label: p?.label ?? String(r.kind), managed: p?.managed === true,
  };
  const st = utcDate(r.started_at); if (st) o.startedAt = st.toISOString();
  if (exp) { o.expiresAt = exp.toISOString(); o.daysLeft = Math.max(0, Math.ceil((exp.getTime() - Date.now()) / 86400_000)); }
  const pa = utcDate(r.paused_at); if (pa) o.pausedAt = pa.toISOString();
  return o;
}

/** 이 테넌트의 슬롯(취소 제외 · 최신순). */
export async function listSlots(tid: number): Promise<SlotView[]> {
  const rows = await q(sql`SELECT * FROM account_slots WHERE tenant_id = ${tid} AND status <> 'cancelled' ORDER BY id DESC`);
  return rows.map(toView);
}
/** 계정 한도에 더해 주는 수 = 쓸 수 있는 슬롯(active + waiting_ip — 붙일 계정을 만들 수 있어야 한다 · **paused 는 세지 않는다**). */
export async function activeSlotCount(tid: number): Promise<number> {
  try {
    const [r] = await q(sql`SELECT COUNT(*)::int AS c FROM account_slots WHERE tenant_id = ${tid} AND status IN ('active', 'waiting_ip')`);
    return n(r?.c);
  } catch (e) { console.warn("[slots] activeSlotCount 실패 — 0", String((e as Error)?.message ?? e).slice(0, 80)); return 0; }
}
/** 쉬는 슬롯에 물린 계정 id — 자동 편성에서 빼는 쪽이 읽는다(그 계정만 «쉼»). */
export async function pausedAccountIds(tid: number): Promise<number[]> {
  const rows = await q(sql`SELECT account_id FROM account_slots WHERE tenant_id = ${tid} AND status = 'paused' AND account_id IS NOT NULL`);
  return rows.map((r) => n(r.account_id));
}

/* ───────── 차감(개시·갱신·복구 공용) ───────── */
/**
 * chargeSlot — 이 슬롯의 **다음 기간**을 받는다. 성공하면 `periods_charged` 를 올린다(= 다음 멱등 키).
 *   실패(잔액 부족)면 번호는 그대로라 다음 크론이 같은 기간을 다시 시도한다.
 */
async function chargeSlot(tid: number, slot: Record<string, unknown>, actorId: number | null): Promise<{ ok: boolean; charged: number; need?: number; balance: number; period: number }> {
  const coins = n(slot.coins_per_period);
  const kind = String(slot.kind) as AccountSlotKind;
  const period = n(slot.periods_charged) + 1;
  const ref = slotRef(n(slot.id), period);
  const r = await consume(tid, kind, ref, { cost: coins, reason: `${accountSlotProduct(kind)?.label ?? kind} ${ACCOUNT_SLOT_DAYS}일(${period}기)`, actorId, allowPurchased: true });
  if (!r.ok) return { ok: false, charged: 0, need: r.reason === "insufficient" ? n((r as { need?: number }).need) : coins, balance: r.balance, period };
  await q(sql`UPDATE account_slots SET periods_charged = ${period}, updated_at = NOW() WHERE id = ${n(slot.id)} AND periods_charged < ${period}`);
  return { ok: true, charged: r.charged, balance: r.balance, period };
}
const plus30 = (now: Date) => new Date(now.getTime() + ACCOUNT_SLOT_DAYS * 86400_000).toISOString();
const notify = (tid: number, kind: string, title: string, body: string, link = "/app/accounts.html") =>
  q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${kind}, ${title}, ${body}, ${link})`);

/**
 * activateSlot — 계정이 붙은 슬롯에 IP 를 붙이고(B2) 첫 기간을 받는다. 연결 직후와 크론(IP 대기 재시도)이 같은 함수를 쓴다.
 *   결과: "active"(배정+차감) · "pending"(IP 준비 중 · 미차감) · "paused"(배정됐는데 코인 부족 → 그 슬롯만 쉼) · "noop"(계정 없음).
 */
export async function activateSlot(tid: number, slotId: number, actorId: number | null, now = new Date()): Promise<"active" | "pending" | "paused" | "noop"> {
  const [s] = await q(sql`SELECT * FROM account_slots WHERE id = ${slotId} AND tenant_id = ${tid} AND status = 'waiting_ip'`);
  if (!s || !s.account_id) return "noop";
  const accountId = n(s.account_id);
  const a = s.proxy_id ? { proxyId: n(s.proxy_id) } : await assignProxy(accountId);   // B2 정본 — 재고 없으면 pending
  if (!("proxyId" in a) || !a.proxyId) return "pending";
  await q(sql`UPDATE account_slots SET proxy_id = ${a.proxyId}, updated_at = NOW() WHERE id = ${slotId}`);
  const c = await chargeSlot(tid, { ...s, proxy_id: a.proxyId }, actorId);
  if (!c.ok) {
    await q(sql`UPDATE account_slots SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = ${slotId}`);
    await notify(tid, "account_slot_paused", "코인이 모자라 계정 하나가 쉬어요", `전용 IP 는 준비됐는데 코인 ${n(s.coins_per_period)}개가 모자라요. 채우면 그 계정만 바로 돌아가요.`, "/app/coins.html");
    await writeAudit({ tenantId: tid, action: "account_slot_paused", actorType: "system", riskLevel: "medium", target: `slot:${slotId}`, detail: { at: "activate", need: c.need ?? null, balance: c.balance } });
    return "paused";
  }
  await q(sql`UPDATE account_slots SET status = 'active', started_at = NOW(), expires_at = ${plus30(now)}::timestamptz AT TIME ZONE 'UTC', last_charged_at = NOW(), paused_at = NULL, updated_at = NOW() WHERE id = ${slotId}`);
  await notify(tid, "account_slot_ready", "전용 IP 가 준비됐어요", `계정 슬롯이 열렸어요(${ACCOUNT_SLOT_DAYS}일권 · 코인 ${n(s.coins_per_period)}개 빠졌어요).`);
  await writeAudit({ tenantId: tid, action: "account_slot_assigned", actorType: actorId ? "user" : "system", actorId, target: `slot:${slotId}`, detail: { accountId, proxyId: a.proxyId, charged: c.charged, period: c.period } });
  return "active";
}

/* ───────── 구매 ───────── */
export type BuyResult =
  | { ok: true; slots: SlotView[]; balance: number; waitingIp: number }
  | { ok: false; step: "kind" | "count" | "coins" | "write"; error: string; need?: number; balance?: number };
/**
 * buyAccountSlots — 코인으로 계정 슬롯을 산다. **여기서는 차감하지 않는다**(IP 가 배정되는 날 받는다 · 없는 걸 팔지 않는다).
 *   대신 첫 기간만큼의 잔액은 있어야 한다(검사) — 코인 0 으로 «IP 준비 중» 계정을 무한정 쓰는 구멍 방지. 부족하면 아무것도 만들지 않는다.
 */
export async function buyAccountSlots(tid: number, kindIn: unknown, countIn: unknown, actorId: number | null): Promise<BuyResult> {
  const p = accountSlotProduct(kindIn);
  if (!p) return { ok: false, step: "kind", error: "어떤 상품인지 골라 주세요." };
  const count = Math.floor(Number(countIn ?? 1));
  if (!Number.isFinite(count) || count < 1 || count > MAX_SLOTS_PER_BUY) return { ok: false, step: "count", error: `한 번에 ${MAX_SLOTS_PER_BUY}개까지 살 수 있어요.` };
  const b0 = await balance(tid);
  const need = p.coins * count;
  if (b0.balance < need) return { ok: false, step: "coins", error: `코인이 ${need - b0.balance}개 모자라요. 첫 30일치(${need}코인)는 있어야 해요.`, need: need - b0.balance, balance: b0.balance };
  const made: SlotView[] = [];
  for (let i = 0; i < count; i++) {
    const [row] = await q(sql`INSERT INTO account_slots (tenant_id, kind, status, coins_per_period) VALUES (${tid}, ${p.kind}, ${"waiting_ip"}, ${p.coins}) RETURNING *`);
    if (!row) return { ok: false, step: "write", error: "계정 자리를 만들지 못했어요. 잠시 뒤 다시 해 주세요." };
    made.push(toView(row));
  }
  await writeAudit({ tenantId: tid, action: "account_slot_buy", actorType: actorId ? "user" : "system", actorId, target: `slots:${made.map((m) => m.id).join(",")}`,
    detail: { kind: p.kind, count, coinsEach: p.coins, slotIds: made.map((m) => m.id), balance: b0.balance, note: "차감은 IP 배정 시" } });
  await notify(tid, "account_slot_bought", `계정 슬롯 ${count}개를 샀어요`, `계정 연결 화면에서 새 계정을 붙이면 전용 IP 를 붙여 드려요. 코인 ${p.coins}개는 IP 가 준비되는 날 빠져요.`);
  return { ok: true, slots: made, balance: b0.balance, waitingIp: made.length };
}

/** 자동 갱신 끄기·켜기(환불은 없다 — 다음 갱신만 멈춘다). */
export async function setSlotAutoRenew(tid: number, slotId: number, on: boolean, actorId: number | null): Promise<{ ok: boolean; slot?: SlotView; error?: string }> {
  const [row] = await q(sql`UPDATE account_slots SET auto_renew = ${on}, updated_at = NOW() WHERE id = ${slotId} AND tenant_id = ${tid} AND status <> 'cancelled' RETURNING *`);
  if (!row) return { ok: false, error: "그 계정 자리를 찾을 수 없어요." };
  await writeAudit({ tenantId: tid, action: "account_slot_auto_renew", actorType: "user", actorId, target: `slot:${slotId}`, detail: { autoRenew: on } });
  return { ok: true, slot: toView(row) };
}

/** 계정을 남는 슬롯에 붙이고(계정 추가 직후) 바로 IP 배정·첫 차감을 시도한다. 슬롯이 없으면 null(플랜 포함분 계정). */
export async function attachAccountToSlot(tid: number, accountId: number, actorId: number | null = null): Promise<(SlotView & { activation: "active" | "pending" | "paused" | "noop" }) | null> {
  const [row] = await q(sql`UPDATE account_slots SET account_id = ${accountId}, updated_at = NOW()
    WHERE id = (SELECT id FROM account_slots WHERE tenant_id = ${tid} AND status IN ('waiting_ip', 'active') AND account_id IS NULL ORDER BY id LIMIT 1) RETURNING *`);
  if (!row) return null;
  await writeAudit({ tenantId: tid, action: "account_slot_attach", actorType: "user", actorId, target: `slot:${n(row.id)}`, detail: { accountId } });
  const activation = await activateSlot(tid, n(row.id), actorId);
  const [after] = await q(sql`SELECT * FROM account_slots WHERE id = ${n(row.id)}`);
  return { ...toView(after ?? row), activation };
}

/* ───────── 크론(배정 재시도 · 안내 · 갱신 · 쉼/복구) ───────── */
export interface SlotCronResult { assigned: number; noticed: number; renewed: number; paused: number; resumed: number; ended: number; detail: Record<string, unknown> }
/**
 * runSlotCycle — 하루 1번(크론 `slot.renew`).
 *   ① 계정이 붙은 `waiting_ip` 슬롯에 IP 배정 재시도(B2) → 되면 그때 첫 차감·개시 ② 만료 D-3 안내 1회
 *   ③ 만료일: auto_renew 면 다음 기간 차감 → 30일 연장 · 잔액 부족이면 **그 슬롯만 paused** · auto_renew 꺼졌으면 cancelled + `releaseProxy`
 *   ④ 쉬던 슬롯은 코인이 채워지면 다시 켠다(고객이 충전하면 자동 복구 — 다시 사라고 하지 않는다)
 */
export async function runSlotCycle(now = new Date(), limit = 50): Promise<SlotCronResult> {
  const out: SlotCronResult = { assigned: 0, noticed: 0, renewed: 0, paused: 0, resumed: 0, ended: 0, detail: {} };

  // ① IP 대기(계정 붙은 것만) → 배정 재시도
  const waiting = await q(sql`SELECT id, tenant_id FROM account_slots WHERE status = 'waiting_ip' AND account_id IS NOT NULL ORDER BY id LIMIT ${limit}`);
  for (const s of waiting) {
    const r = await activateSlot(n(s.tenant_id), n(s.id), null, now);
    if (r === "active") out.assigned++; else if (r === "paused") out.paused++;
  }

  // ② D-3 안내(자동 갱신이 켜진 것만 · 기간당 1회)
  const soon = await q(sql`SELECT id, tenant_id, coins_per_period FROM account_slots
    WHERE status = 'active' AND auto_renew = true AND expires_at > NOW() AND expires_at <= NOW() + interval '3 days'
      AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.tenant_id = account_slots.tenant_id AND x.kind = 'account_slot_renew_soon' AND x.created_at > NOW() - interval '20 days') LIMIT ${limit}`);
  for (const s of soon) {
    await notify(n(s.tenant_id), "account_slot_renew_soon", "계정 슬롯이 곧 갱신돼요", `3일 뒤에 코인 ${n(s.coins_per_period)}개가 빠지고 ${ACCOUNT_SLOT_DAYS}일 더 이어져요. 그만 쓰시려면 계정 화면에서 «다음 갱신 끄기» 를 눌러 주세요.`);
    out.noticed++;
  }

  // ③ 만료 처리
  const due = await q(sql`SELECT * FROM account_slots WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= NOW() ORDER BY expires_at LIMIT ${limit}`);
  for (const s of due) {
    const tid = n(s.tenant_id);
    if (s.auto_renew !== true) {
      await q(sql`UPDATE account_slots SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE id = ${n(s.id)}`);
      if (s.account_id) await releaseProxy(n(s.account_id));   // IP 는 풀로(우리 월 비용을 멈춘다)
      await notify(tid, "account_slot_ended", "계정 슬롯이 끝났어요", "자동 갱신을 꺼 두셔서 오늘로 끝났어요. 그 계정은 자동 편성에서 빠져요. 다시 쓰시려면 계정 화면에서 새로 사면 돼요.");
      await writeAudit({ tenantId: tid, action: "account_slot_ended", actorType: "system", target: `slot:${n(s.id)}`, detail: { reason: "auto_renew_off", accountId: s.account_id ? n(s.account_id) : null } });
      out.ended++;
      continue;
    }
    const c = await chargeSlot(tid, s, null);   // 기간 번호가 올라가므로 달·날짜가 겹쳐도 새 기간은 새 키다
    if (c.ok) {
      await q(sql`UPDATE account_slots SET expires_at = ${plus30(now)}::timestamptz AT TIME ZONE 'UTC', last_charged_at = NOW(), paused_at = NULL, updated_at = NOW() WHERE id = ${n(s.id)}`);
      await writeAudit({ tenantId: tid, action: "account_slot_renew", actorType: "system", target: `slot:${n(s.id)}`, detail: { charged: c.charged, period: c.period, balance: c.balance } });
      out.renewed++;
    } else {
      await q(sql`UPDATE account_slots SET status = 'paused', paused_at = NOW(), updated_at = NOW() WHERE id = ${n(s.id)}`);
      await notify(tid, "account_slot_paused", "코인이 모자라 계정 하나가 쉬어요", `코인 ${n(s.coins_per_period)}개를 채우면 그 계정만 바로 다시 돌아가요. 다른 계정은 그대로 돌고 있어요.`, "/app/coins.html");
      await writeAudit({ tenantId: tid, action: "account_slot_paused", actorType: "system", riskLevel: "medium", target: `slot:${n(s.id)}`, detail: { at: "renew", need: c.need ?? null, balance: c.balance } });
      out.paused++;
    }
  }

  // ④ 쉬던 슬롯 복구(코인이 채워졌으면) — 이번 실행에서 막 쉰 것은 건드리지 않는다(같은 잔액으로 곧바로 다시 물어봐야 답이 같다)
  const paused = await q(sql`SELECT * FROM account_slots WHERE status = 'paused' AND auto_renew = true AND paused_at < NOW() - interval '1 minute' ORDER BY paused_at LIMIT ${limit}`);
  for (const s of paused) {
    const tid = n(s.tenant_id);
    const c = await chargeSlot(tid, s, null);
    if (!c.ok) continue;
    await q(sql`UPDATE account_slots SET status = 'active', expires_at = ${plus30(now)}::timestamptz AT TIME ZONE 'UTC', last_charged_at = NOW(), paused_at = NULL, updated_at = NOW() WHERE id = ${n(s.id)}`);
    await notify(tid, "account_slot_resumed", "쉬던 계정이 다시 돌아가요", `코인이 채워져서 계정 슬롯을 다시 열었어요(${ACCOUNT_SLOT_DAYS}일).`);
    await writeAudit({ tenantId: tid, action: "account_slot_resumed", actorType: "system", target: `slot:${n(s.id)}`, detail: { charged: c.charged, period: c.period } });
    out.resumed++;
  }

  out.detail = { assigned: out.assigned, noticed: out.noticed, renewed: out.renewed, paused: out.paused, resumed: out.resumed, ended: out.ended };
  return out;
}
