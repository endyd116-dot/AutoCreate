/**
 * lib/billing/promotions.ts — 이벤트·쿠폰 **적용 규칙 한 곳**(계약 §2.1 ops-promotions · §2.4(2) · DESIGN §11.4 이벤트).
 *   표: promotions(kind trial_days|bonus_coin|referral · config · conditions · uses) · coupons(code · kind pct|krw · value · months · plan_keys · max_uses/used) · coupon_redemptions(coupon,tenant 유니크 · converted_at).
 *   ══ 어디서 쓰나 ══
 *     · trial_days   → `lib/plans.ts currentTrialDays()` 가 config.days 를 읽는다(가입 시).                — 여기서는 행 모양·CRUD 검증만.
 *     · bonus_coin   → `applyBonusCoins(tid, orderNo, packId, coins)` — 코인 충전 정산(coin-purchase settle) 뒤 보너스 grant(ref `bonus:{orderNo}` 멱등 · purchased 버킷 · +365일).
 *                      config { pct, packIds?:[], firstChargeOnly?:true } · 조건 conditions { planKeys?, signupAfter?, channels? }.
 *     · referral     → config { coins } · 🔴 추천 코드 입력 칸이 가입 화면·tenants 에 아직 없다(다음 라운드) — 등록·조회만 되고 자동 적용은 안 된다(정직).
 *     · coupon       → `validateCoupon` / `redeemCoupon`(subscription-change · 1테넌트 1회) · pct 는 장부 discount_pct/until · krw 는 coupon_code 를 장부에 두고 `quotePlan` 이 1회 차감 · 청구 성공 시 `markCouponConverted`.
 *   🔴 성과(stats.used / converted): used = 적용 횟수(promotions.uses · coupons.used) · converted = 그 뒤 유료 청구 성공(coupon_redemptions.converted_at · 이벤트는 audit `promo_applied` 테넌트 중 active 유료).
 *   이 파일은 cron·publish 를 import 하지 않는다(AC-17).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { utcDate } from "../db-util";
import { PURCHASE_VALID_DAYS } from "../coin-table";

const n = (v: unknown) => Number(v || 0);
const iso = (v: unknown) => utcDate(v)?.toISOString();
export type PromoKind = "trial_days" | "bonus_coin" | "referral";
export const PROMO_KINDS: readonly PromoKind[] = ["trial_days", "bonus_coin", "referral"];
export const PROMO_UNIT: Readonly<Record<PromoKind, "days" | "pct" | "coins">> = { trial_days: "days", bonus_coin: "pct", referral: "coins" };

export interface PromoTarget { plans?: string[]; signupAfter?: string; channels?: string[] }
export interface PromotionRow { id: number; kind: PromoKind; name: string; value: number; unit: "days" | "pct" | "coins"; startsAt: string | null; endsAt: string | null; target: PromoTarget; status: "scheduled" | "active" | "ended"; stats: { used: number; converted: number }; config: Record<string, unknown> }

function statusOf(active: boolean, startsAt: Date | null, endsAt: Date | null, now = Date.now()): "scheduled" | "active" | "ended" {
  if (!active) return "ended";
  if (startsAt && startsAt.getTime() > now) return "scheduled";
  if (endsAt && endsAt.getTime() < now) return "ended";
  return "active";
}
function targetOf(conditions: unknown): PromoTarget {
  const c = (conditions && typeof conditions === "object" && !Array.isArray(conditions) ? conditions : {}) as Record<string, unknown>;
  const t: PromoTarget = {};
  if (Array.isArray(c.planKeys) && c.planKeys.length) t.plans = c.planKeys.map(String);
  if (typeof c.signupAfter === "string" && c.signupAfter) t.signupAfter = c.signupAfter;
  if (Array.isArray(c.channels) && c.channels.length) t.channels = c.channels.map(String);
  return t;
}
/** promotions 1행 → 계약 §2.4(2) Promotion. */
export function toPromotionRow(r: Record<string, unknown>, converted = 0): PromotionRow {
  const kind = (PROMO_KINDS as readonly string[]).includes(String(r.kind)) ? String(r.kind) as PromoKind : "trial_days";
  const cfg = (r.config && typeof r.config === "object" && !Array.isArray(r.config) ? r.config : {}) as Record<string, unknown>;
  const value = kind === "trial_days" ? n(cfg.days ?? cfg.value) : kind === "bonus_coin" ? n(cfg.pct ?? cfg.value) : n(cfg.coins ?? cfg.value);
  const s = utcDate(r.starts_at), e = utcDate(r.ends_at);
  return { id: n(r.id), kind, name: String(r.name ?? ""), value, unit: PROMO_UNIT[kind], startsAt: s?.toISOString() ?? null, endsAt: e?.toISOString() ?? null,
    target: targetOf(r.conditions), status: statusOf(r.active !== false, s, e), stats: { used: n(r.uses), converted }, config: cfg };
}

/** 테넌트가 이벤트 조건(대상 플랜·가입일·채널)에 드는가. */
async function tenantMatches(tid: number, target: PromoTarget): Promise<boolean> {
  if (!target.plans?.length && !target.signupAfter && !target.channels?.length) return true;
  const [t] = await q(sql`SELECT plan_key, created_at FROM tenants WHERE id = ${tid}`);
  if (!t) return false;
  if (target.plans?.length && !target.plans.includes(String(t.plan_key))) return false;
  if (target.signupAfter) { const c = utcDate(t.created_at); const a = new Date(target.signupAfter); if (!c || Number.isNaN(a.getTime()) || c.getTime() < a.getTime()) return false; }
  if (target.channels?.length) {
    const [a] = await q(sql`SELECT 1 FROM accounts WHERE tenant_id = ${tid} AND channel IN (${sql.join(target.channels.map((c) => sql`${c}`), sql`, `)}) LIMIT 1`);
    if (!a) return false;
  }
  return true;
}

/** 지금 살아 있는(활성 · 기간 안) 이벤트. */
export async function activePromotions(kind: PromoKind): Promise<PromotionRow[]> {
  const rows = await q(sql`SELECT * FROM promotions WHERE kind = ${kind} AND active = true AND (starts_at IS NULL OR starts_at <= NOW()) AND (ends_at IS NULL OR ends_at >= NOW()) ORDER BY created_at DESC`);
  return rows.map((r) => toPromotionRow(r));
}

/**
 * 보너스 코인 — 충전 정산 뒤 부른다. 첫 매칭 이벤트 1개만(중복 적용 없음). ref `bonus:{orderNo}` 로 멱등.
 *   firstChargeOnly 면 이 주문 이전에 paid 충전이 없을 때만 · packIds 가 있으면 그 팩만.
 */
export async function applyBonusCoins(tid: number, orderNo: string, packId: string, coins: number, actorId: number | null): Promise<{ bonus: number; promoId: number | null }> {
  try {
    const promos = await activePromotions("bonus_coin");
    for (const p of promos) {
      const pct = n(p.config.pct ?? p.value); if (pct <= 0) continue;
      const packIds = Array.isArray(p.config.packIds) ? p.config.packIds.map(String) : [];
      if (packIds.length && !packIds.includes(packId)) continue;
      if (p.config.firstChargeOnly === true) {
        const [prev] = await q(sql`SELECT 1 FROM coin_orders WHERE tenant_id = ${tid} AND status = 'paid' AND order_no <> ${orderNo} LIMIT 1`);
        if (prev) continue;
      }
      if (!await tenantMatches(tid, p.target)) continue;
      const bonus = Math.floor(coins * pct / 100); if (bonus <= 0) continue;
      const ins = await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason, actor_id, expires_at)
        VALUES (${tid}, ${"grant"}, ${"purchased"}, ${bonus}, ${`bonus:${orderNo}`}, ${`이벤트 «${p.name}» 보너스 ${bonus}코인(${pct}%)`.slice(0, 200)}, ${actorId}, NOW() + (${PURCHASE_VALID_DAYS} || ' days')::interval)
        ON CONFLICT (tenant_id, kind, ref, bucket) WHERE ref IS NOT NULL DO NOTHING RETURNING id`);
      if (!ins.length) return { bonus: 0, promoId: p.id };   // 이미 준 주문(재승인)
      await q(sql`UPDATE promotions SET uses = uses + 1, updated_at = NOW() WHERE id = ${p.id}`);
      await writeAudit({ tenantId: tid, action: "promo_applied", actorType: "system", target: `promotion:${p.id}`, detail: { kind: "bonus_coin", orderNo, packId, coins, pct, bonus } });
      return { bonus, promoId: p.id };
    }
  } catch (e) { console.warn("[promotions] bonus 적용 실패(충전은 정상)", String((e as Error)?.message ?? e).slice(0, 120)); }
  return { bonus: 0, promoId: null };
}

/* ───────── 쿠폰 ───────── */
export type CouponKind = "pct" | "krw";
export interface CouponRow { id: number; code: string; kind: CouponKind; value: number; maxUses: number | null; used: number; startsAt: string | null; endsAt: string | null; plans?: string[]; months: number | null; status: "scheduled" | "active" | "ended"; name?: string }
export function toCouponRow(r: Record<string, unknown>): CouponRow {
  const s = utcDate(r.starts_at), e = utcDate(r.ends_at);
  const kind: CouponKind = String(r.kind) === "krw" ? "krw" : "pct";
  const plans = Array.isArray(r.plan_keys) ? r.plan_keys.map(String) : [];
  const o: CouponRow = { id: n(r.id), code: String(r.code), kind, value: n(r.value), maxUses: r.max_uses === null || r.max_uses === undefined ? null : n(r.max_uses), used: n(r.used),
    startsAt: s?.toISOString() ?? null, endsAt: e?.toISOString() ?? null, months: r.months === null || r.months === undefined ? null : n(r.months), status: statusOf(r.active !== false, s, e) };
  if (plans.length) o.plans = plans;
  if (r.name) o.name = String(r.name);
  return o;
}
export type CouponCheck = { ok: true; coupon: CouponRow } | { ok: false; reason: "not_found" | "inactive" | "window" | "exhausted" | "plan" | "already"; error: string };
/** 코드 검증(적용은 안 함 · 미리보기용). */
export async function validateCoupon(tid: number, code: unknown, planKey?: string): Promise<CouponCheck> {
  const c = String(code ?? "").trim().toUpperCase().slice(0, 40);
  if (!c) return { ok: false, reason: "not_found", error: "쿠폰 코드를 입력해 주세요." };
  const [r] = await q(sql`SELECT * FROM coupons WHERE UPPER(code) = ${c} LIMIT 1`);
  if (!r) return { ok: false, reason: "not_found", error: "없는 쿠폰 코드예요." };
  const cp = toCouponRow(r);
  if (cp.status === "ended") return { ok: false, reason: r.active === false ? "inactive" : "window", error: "기간이 지난 쿠폰이에요." };
  if (cp.status === "scheduled") return { ok: false, reason: "window", error: "아직 시작하지 않은 쿠폰이에요." };
  if (cp.maxUses !== null && cp.used >= cp.maxUses) return { ok: false, reason: "exhausted", error: "쿠폰이 모두 사용됐어요." };
  if (planKey && cp.plans?.length && !cp.plans.includes(planKey)) return { ok: false, reason: "plan", error: `이 쿠폰은 ${cp.plans.join("·")} 요금제에만 쓸 수 있어요.` };
  const [dup] = await q(sql`SELECT 1 FROM coupon_redemptions WHERE coupon_id = ${cp.id} AND tenant_id = ${tid} LIMIT 1`);
  if (dup) return { ok: false, reason: "already", error: "이미 쓴 쿠폰이에요." };
  return { ok: true, coupon: cp };
}
/**
 * 적용 — coupon_redemptions(1테넌트 1회) + coupons.used + 장부: pct → discount_pct/until(months · NULL=1개월) · krw → coupon_code(quotePlan 이 1회 차감).
 *   장부 행이 없으면(체험) 만들어 둔다(period 는 청구 성공 시 applyChargeResult 가 덮는다).
 */
export async function redeemCoupon(tid: number, code: unknown, planKey: string, actorId: number | null = null): Promise<CouponCheck> {
  const v = await validateCoupon(tid, code, planKey);
  if (!v.ok) return v;
  const cp = v.coupon;
  const ins = await q(sql`INSERT INTO coupon_redemptions (coupon_id, tenant_id) VALUES (${cp.id}, ${tid}) ON CONFLICT (coupon_id, tenant_id) DO NOTHING RETURNING id`);
  if (!ins.length) return { ok: false, reason: "already", error: "이미 쓴 쿠폰이에요." };
  await q(sql`UPDATE coupons SET used = used + 1, updated_at = NOW() WHERE id = ${cp.id}`);
  const months = Math.max(1, cp.months ?? 1);
  if (cp.kind === "pct") {
    await q(sql`INSERT INTO subscriptions (tenant_id, plan_key, status, cycle, period_start, period_end, discount_pct, discount_until, coupon_code, updated_at)
      VALUES (${tid}, ${planKey}, ${"pending"}, ${"month"}, NOW(), NOW(), ${Math.min(100, cp.value)}, NOW() + (${months} || ' months')::interval, ${cp.code}, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET discount_pct = EXCLUDED.discount_pct, discount_until = EXCLUDED.discount_until, coupon_code = EXCLUDED.coupon_code, updated_at = NOW()`);
  } else {
    await q(sql`INSERT INTO subscriptions (tenant_id, plan_key, status, cycle, period_start, period_end, coupon_code, updated_at)
      VALUES (${tid}, ${planKey}, ${"pending"}, ${"month"}, NOW(), NOW(), ${cp.code}, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET coupon_code = EXCLUDED.coupon_code, updated_at = NOW()`);
  }
  await writeAudit({ tenantId: tid, action: "coupon_redeemed", actorType: actorId ? "user" : "system", actorId, target: `coupon:${cp.id}`, detail: { code: cp.code, kind: cp.kind, value: cp.value, months: cp.months, planKey } });
  return { ok: true, coupon: cp };
}
/** 장부의 krw 쿠폰이 아직 안 쓰였으면 그 금액(quotePlan 이 1회 차감). */
export async function pendingKrwCoupon(tid: number, couponCode: string | null): Promise<{ id: number; code: string; krw: number } | null> {
  if (!couponCode) return null;
  const [r] = await q(sql`SELECT c.id, c.code, c.value FROM coupons c JOIN coupon_redemptions cr ON cr.coupon_id = c.id AND cr.tenant_id = ${tid}
    WHERE UPPER(c.code) = ${couponCode.toUpperCase()} AND c.kind = 'krw' AND cr.converted_at IS NULL LIMIT 1`);
  return r ? { id: n(r.id), code: String(r.code), krw: n(r.value) } : null;
}
/** 청구 성공 → 이 테넌트의 미전환 쿠폰을 «전환»으로 · krw 쿠폰은 장부 coupon_code 를 비운다(1회). */
export async function markCouponConverted(tid: number, orderNo: string | null): Promise<void> {
  try {
    const rows = await q(sql`UPDATE coupon_redemptions cr SET converted_at = NOW(), order_no = COALESCE(cr.order_no, ${orderNo}) FROM coupons c
      WHERE cr.coupon_id = c.id AND cr.tenant_id = ${tid} AND cr.converted_at IS NULL RETURNING c.kind`);
    if (rows.some((r) => String(r.kind) === "krw")) await q(sql`UPDATE subscriptions SET coupon_code = NULL, updated_at = NOW() WHERE tenant_id = ${tid}`);
  } catch (e) { console.warn("[promotions] converted 표시 실패", String((e as Error)?.message ?? e).slice(0, 120)); }
}

/** 운영센터 CRUD 입력 검증 — 이벤트. */
export function parsePromotionInput(b: Record<string, unknown>): { ok: true; kind: PromoKind; name: string; config: Record<string, unknown>; conditions: Record<string, unknown>; startsAt: string | null; endsAt: string | null; active: boolean } | { ok: false; error: string } {
  const kind = String(b.kind ?? "") as PromoKind;
  if (!PROMO_KINDS.includes(kind)) return { ok: false, error: "kind 는 trial_days · bonus_coin · referral 중 하나예요." };
  const name = String(b.name ?? "").trim().slice(0, 80); if (!name) return { ok: false, error: "이벤트 이름을 적어 주세요." };
  const value = Math.floor(n(b.value)); if (value <= 0) return { ok: false, error: "값(일수·%·코인)은 1 이상이어야 해요." };
  const cfgIn = (b.config && typeof b.config === "object" && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>;
  const config: Record<string, unknown> = { value, unit: PROMO_UNIT[kind] };
  if (kind === "trial_days") config.days = Math.min(90, value);
  if (kind === "bonus_coin") { config.pct = Math.min(200, value); if (Array.isArray(cfgIn.packIds)) config.packIds = cfgIn.packIds.map(String).slice(0, 10); if (cfgIn.firstChargeOnly === true) config.firstChargeOnly = true; }
  if (kind === "referral") config.coins = Math.min(1000, value);
  const t = (b.target && typeof b.target === "object" && !Array.isArray(b.target) ? b.target : {}) as Record<string, unknown>;
  const conditions: Record<string, unknown> = {};
  if (Array.isArray(t.plans) && t.plans.length) conditions.planKeys = t.plans.map(String).slice(0, 10);
  if (typeof t.signupAfter === "string" && !Number.isNaN(new Date(t.signupAfter).getTime())) conditions.signupAfter = new Date(t.signupAfter).toISOString();
  if (Array.isArray(t.channels) && t.channels.length) conditions.channels = t.channels.map(String).slice(0, 20);
  const startsAt = b.startsAt ? iso(b.startsAt) ?? null : null, endsAt = b.endsAt ? iso(b.endsAt) ?? null : null;
  if (b.startsAt && !startsAt) return { ok: false, error: "startsAt 형식이 틀렸어요." };
  if (b.endsAt && !endsAt) return { ok: false, error: "endsAt 형식이 틀렸어요." };
  if (startsAt && endsAt && startsAt > endsAt) return { ok: false, error: "종료가 시작보다 빨라요." };
  return { ok: true, kind, name, config, conditions, startsAt, endsAt, active: b.active !== false };
}
/** 운영센터 CRUD 입력 검증 — 쿠폰. */
export function parseCouponInput(b: Record<string, unknown>): { ok: true; code: string; kind: CouponKind; value: number; maxUses: number | null; startsAt: string | null; endsAt: string | null; plans: string[] | null; months: number | null; name: string | null; active: boolean } | { ok: false; error: string } {
  const code = String(b.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
  if (code.length < 3) return { ok: false, error: "쿠폰 코드는 영문·숫자 3자 이상이에요." };
  const kind: CouponKind = String(b.kind) === "krw" ? "krw" : String(b.kind) === "pct" ? "pct" : (null as unknown as CouponKind);
  if (!kind) return { ok: false, error: "kind 는 pct 또는 krw 예요." };
  const value = Math.floor(n(b.value));
  if (value <= 0 || (kind === "pct" && value > 100)) return { ok: false, error: kind === "pct" ? "할인율은 1~100 이에요." : "할인 금액은 1원 이상이에요." };
  const maxUses = b.maxUses === null || b.maxUses === undefined || b.maxUses === "" ? null : Math.max(1, Math.floor(n(b.maxUses)));
  const months = b.months === null || b.months === undefined || b.months === "" ? null : Math.min(24, Math.max(1, Math.floor(n(b.months))));
  const plans = Array.isArray(b.plans) && b.plans.length ? b.plans.map(String).slice(0, 10) : null;
  const startsAt = b.startsAt ? iso(b.startsAt) ?? null : null, endsAt = b.endsAt ? iso(b.endsAt) ?? null : null;
  if (b.startsAt && !startsAt) return { ok: false, error: "startsAt 형식이 틀렸어요." };
  if (b.endsAt && !endsAt) return { ok: false, error: "endsAt 형식이 틀렸어요." };
  return { ok: true, code, kind, value, maxUses, startsAt, endsAt, plans, months, name: b.name ? String(b.name).slice(0, 80) : null, active: b.active !== false };
}
