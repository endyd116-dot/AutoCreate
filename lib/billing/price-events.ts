/**
 * lib/billing/price-events.ts — **가격 개정 게이트**(계약 §2.1 ops-plans · §2.4(3) PriceEvent · DESIGN §11.4 «고지 발송 → 다음 결제주기부터» · AM `plan_price_events` 계승).
 *   ① 운영자가 개정 등록(`schedulePriceEvent`) → 그 플랜을 쓰는 고객 전원에게 **고지**(앱 알림 + 메일 · notified_count) → status `noticed`.
 *   ② `effective_at` 전까지 청구는 옛 가격(quotePlan 이 status noticed/applied + effective_at ≤ now 인 이벤트만 본다 · 고지 전 청구 불변).
 *   ③ `effective_at` 이 지나면 `applyDuePriceEvents()` 가 plans 의 표시가를 새 가격으로 바꾸고 status `applied`(멱등 · ops-plans 조회·청구 크론이 부른다).
 *   🔴 `subscriptions.price_locked_krw` 가 있는 테넌트는 quotePlan 에서 고정가가 이기므로 개정의 영향을 받지 않는다(고지 대상에서도 뺀다).
 *   plans.price_month/price_year 를 직접 고치는 경로는 없다 — 신규 플랜 생성(고객 0)만 예외.
 *   🔎 AM 원본: ../AutoMarketing/lib/billing.ts plan_price_events (관례 계승 2026-09-14)
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { jsonb, utcDate } from "../db-util";
import { sendEmail, simpleMail, siteUrl } from "../email";
import { planOf } from "../plans";

const n = (v: unknown) => Number(v || 0);
const won = (v: number) => `${v.toLocaleString("ko-KR")}원`;
export interface PriceEventRow { id: number; planKey: string; oldPriceKrw: number; newPriceKrw: number; oldPriceYearKrw?: number; newPriceYearKrw?: number; effectiveAt: string; noticeText: string; noticedAt?: string; status: "scheduled" | "noticed" | "applied" | "cancelled"; affected: number; appliedAt?: string; createdAt: string }

export function toPriceEventRow(r: Record<string, unknown>): PriceEventRow {
  const before = (r.before && typeof r.before === "object" ? r.before : {}) as Record<string, unknown>;
  const after = (r.after && typeof r.after === "object" ? r.after : {}) as Record<string, unknown>;
  const o: PriceEventRow = { id: n(r.id), planKey: String(r.plan_key), oldPriceKrw: n(before.priceMonth), newPriceKrw: n(after.priceMonth),
    effectiveAt: utcDate(r.effective_at)?.toISOString() ?? "", noticeText: String(r.notice_text ?? ""), status: (String(r.status ?? "scheduled") as PriceEventRow["status"]),
    affected: n(r.notified_count), createdAt: utcDate(r.created_at)?.toISOString() ?? "" };
  if (before.priceYear !== undefined) o.oldPriceYearKrw = n(before.priceYear);
  if (after.priceYear !== undefined) o.newPriceYearKrw = n(after.priceYear);
  const na = utcDate(r.notified_at); if (na) o.noticedAt = na.toISOString();
  const aa = utcDate(r.applied_at); if (aa) o.appliedAt = aa.toISOString();
  return o;
}

/** effective_at 이 지난 noticed 이벤트 → plans 표시가 갱신 + applied(멱등). 돌아온 수 = 이번에 적용한 이벤트 수. */
export async function applyDuePriceEvents(): Promise<number> {
  try {
    const due = await q(sql`SELECT id, plan_key, after FROM plan_price_events WHERE status = 'noticed' AND effective_at IS NOT NULL AND effective_at <= NOW() ORDER BY effective_at`);
    let applied = 0;
    for (const ev of due) {
      const after = (ev.after && typeof ev.after === "object" ? ev.after : {}) as Record<string, unknown>;
      const pm = n(after.priceMonth), py = n(after.priceYear);
      if (pm > 0) await q(sql`UPDATE plans SET price_month = ${pm}, price_year = ${py > 0 ? py : pm * 10}, updated_at = NOW() WHERE key = ${String(ev.plan_key)}`);
      const [u] = await q(sql`UPDATE plan_price_events SET status = 'applied', applied_at = NOW() WHERE id = ${n(ev.id)} AND status = 'noticed' RETURNING id`);
      if (u) { applied++; await writeAudit({ tenantId: null, action: "price_event_applied", actorType: "system", target: `price_event:${n(ev.id)}`, detail: { planKey: ev.plan_key, priceMonth: pm, priceYear: py } }); }
    }
    return applied;
  } catch (e) { console.warn("[price-events] apply 실패", String((e as Error)?.message ?? e).slice(0, 120)); return 0; }
}

export type ScheduleResult = { ok: true; event: PriceEventRow; notified: number } | { ok: false; step: "plan" | "price" | "effective" | "notice" | "pending"; error: string };
/**
 * 개정 등록 + 고지. effectiveAt 은 미래(최소 다음 날) · 같은 플랜에 아직 안 적용된 이벤트가 있으면 거절(하나씩).
 *   고지 대상 = 그 플랜의 trial/active/readonly/suspended 테넌트 중 price_locked_krw 없는 곳 · 알림 kind `price_change` + 대표 메일.
 */
export async function schedulePriceEvent(input: { planKey: string; newPriceKrw: number; newPriceYearKrw?: number | null; effectiveAt: string; noticeText: string; operatorId: number }): Promise<ScheduleResult> {
  const plan = await planOf(input.planKey);
  if (!plan || plan.key !== input.planKey || plan.key === "trial") return { ok: false, step: "plan", error: "개정할 수 있는 유료 플랜이 아니에요." };
  const pm = Math.floor(n(input.newPriceKrw)); if (pm <= 0) return { ok: false, step: "price", error: "새 월 가격(공급가 · 원)을 적어 주세요." };
  const py = input.newPriceYearKrw ? Math.floor(n(input.newPriceYearKrw)) : pm * 10;
  const eff = utcDate(input.effectiveAt);
  if (!eff || eff.getTime() < Date.now() + 86400_000) return { ok: false, step: "effective", error: "적용일은 최소 내일 이후여야 해요(고지 뒤 적용 · 30일 이상을 권해요)." };
  const notice = String(input.noticeText ?? "").trim().slice(0, 2000);
  if (notice.length < 10) return { ok: false, step: "notice", error: "고객에게 보낼 고지 문구를 적어 주세요(10자 이상)." };
  const [pending] = await q(sql`SELECT id FROM plan_price_events WHERE plan_key = ${plan.key} AND status IN ('scheduled','noticed') LIMIT 1`);
  if (pending) return { ok: false, step: "pending", error: "아직 적용되지 않은 개정이 있어요. 그 개정을 취소하거나 적용된 뒤에 등록해 주세요." };

  const [ev] = await q(sql`INSERT INTO plan_price_events (plan_key, before, after, effective_at, notice_text, status, operator_id)
    VALUES (${plan.key}, ${jsonb({ priceMonth: plan.priceMonth, priceYear: plan.priceYear })}, ${jsonb({ priceMonth: pm, priceYear: py })}, ${eff.toISOString()}::timestamptz AT TIME ZONE 'UTC', ${notice}, ${"scheduled"}, ${input.operatorId}) RETURNING *`);
  const id = n(ev?.id);
  // 고지 — 대상 테넌트 전원(고정가 제외).
  const targets = await q(sql`SELECT t.id, t.name, (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS email
    FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id
    WHERE t.plan_key = ${plan.key} AND t.status IN ('trial','active','readonly','suspended','past_due') AND (s.price_locked_krw IS NULL)`);
  const effKst = new Date(eff.getTime() + 9 * 3600_000);
  const effText = `${effKst.getUTCFullYear()}년 ${effKst.getUTCMonth() + 1}월 ${effKst.getUTCDate()}일`;
  const title = `${plan.name} 요금이 ${effText}부터 바뀌어요`;
  const body = `월 ${won(plan.priceMonth)} → ${won(pm)}(부가세 별도). ${notice}`;
  let notified = 0;
  for (const t of targets) {
    try {
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${n(t.id)}, ${"price_change"}, ${title}, ${body}, ${"/app/plan.html"})`);
      if (t.email) await sendEmail(String(t.email), `[AutoCreate] ${title}`, simpleMail(title, body, { label: "요금제 보기", url: `${siteUrl()}/app/plan.html` }));
      notified++;
    } catch (e) { console.warn("[price-events] 고지 실패 tid=", t.id, String((e as Error)?.message ?? e).slice(0, 80)); }
  }
  const [row] = await q(sql`UPDATE plan_price_events SET status = 'noticed', notified_at = NOW(), notified_count = ${notified} WHERE id = ${id} RETURNING *`);
  await writeAudit({ tenantId: null, action: "price_event_scheduled", actorType: "operator", actorId: input.operatorId, riskLevel: "high", target: `price_event:${id}`,
    detail: { planKey: plan.key, before: { priceMonth: plan.priceMonth, priceYear: plan.priceYear }, after: { priceMonth: pm, priceYear: py }, effectiveAt: eff.toISOString(), notified, targets: targets.length } });
  return { ok: true, event: toPriceEventRow(row ?? ev), notified };
}

/** 취소 — noticed/scheduled 만. 취소 고지도 보낸다(같은 대상). */
export async function cancelPriceEvent(id: number, operatorId: number): Promise<{ ok: boolean; error?: string }> {
  const [ev] = await q(sql`SELECT * FROM plan_price_events WHERE id = ${id}`);
  if (!ev) return { ok: false, error: "개정이 없어요." };
  if (!["scheduled", "noticed"].includes(String(ev.status))) return { ok: false, error: "이미 적용됐거나 취소된 개정이에요." };
  await q(sql`UPDATE plan_price_events SET status = 'cancelled' WHERE id = ${id}`);
  const plan = await planOf(String(ev.plan_key));
  if (n(ev.notified_count) > 0) {
    const targets = await q(sql`SELECT id FROM tenants WHERE plan_key = ${String(ev.plan_key)} AND status IN ('trial','active','readonly','suspended','past_due')`);
    for (const t of targets) await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${n(t.id)}, ${"price_change_cancelled"}, ${`${plan.name} 요금 변경이 취소됐어요`}, ${"안내드렸던 요금 변경은 진행하지 않아요. 지금 요금 그대로예요."}, ${"/app/plan.html"})`);
  }
  await writeAudit({ tenantId: null, action: "price_event_cancelled", actorType: "operator", actorId: operatorId, riskLevel: "medium", target: `price_event:${id}`, detail: { planKey: ev.plan_key } });
  return { ok: true };
}
