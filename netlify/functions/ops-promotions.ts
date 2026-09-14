/**
 * 운영센터 · 이벤트 메뉴(계약 §2.1 `ops-promotions.ts` · §2.4(2) 행 모양 · DESIGN §11.4). 권한: admin 이상(§0.2 «이벤트»).
 *   GET  /api/ops-promotions?page&kind&status      → { ok, promotions:[Promotion], total, page }
 *   POST /api/ops-promotions { id?, kind, name, value, startsAt?, endsAt?, target?, active?, config? } → 생성/수정(id 있으면 수정) · { ok, promotion }
 *        · 끄기 = { id, active:false } · 예약 = startsAt 미래 · 종료 = endsAt.
 *   GET  /api/ops-coupons?page&status               → { ok, coupons:[Coupon], total, page }
 *   POST /api/ops-coupons { id?, code, kind:"pct"|"krw", value, maxUses?, startsAt?, endsAt?, plans?, months?, name?, active? } → { ok, coupon }
 *   GET  /api/ops-coupon-redemptions?couponId&page  → { ok, redemptions:[Redemption], total, page }
 *   적용 규칙은 lib/billing/promotions.ts(가입 체험일 · 충전 보너스 · 구독 쿠폰). 성과: used = 적용 수 · converted = 적용 뒤 유료 활성(이벤트) / 청구 성공(쿠폰).
 */
import { sql, type SQL } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { jsonb, utcDate } from "../../lib/db-util";
import { loadPlans } from "../../lib/plans";
import { pageOf } from "../../lib/ops/period";
import { toPromotionRow, toCouponRow, parsePromotionInput, parseCouponInput } from "../../lib/billing/promotions";

export const config = { path: ["/api/ops-promotions", "/api/ops-coupons", "/api/ops-coupon-redemptions"] };
const n = (v: unknown) => Number(v || 0);
const iso = (v: unknown) => utcDate(v)?.toISOString();
const tsOrNull = (v: string | null): SQL => (v ? sql`${v}::timestamptz AT TIME ZONE 'UTC'` : sql`NULL`);

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
  const o = await requireAdmin(req, ["admin", "super_admin"]); if (!o.ok) return o.res;
  const ip = clientIp(req);
  try {
    /* ── 이벤트 ── */
    if (path.endsWith("/ops-promotions")) {
      if (req.method === "GET") {
        const { page, size, offset } = pageOf(url);
        const kind = (url.searchParams.get("kind") || "").trim();
        const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM promotions WHERE (${kind} = '' OR kind = ${kind})`);
        const rows = await q(sql`SELECT * FROM promotions WHERE (${kind} = '' OR kind = ${kind}) ORDER BY active DESC, created_at DESC LIMIT ${size} OFFSET ${offset}`);
        // 성과(전환) = 이 이벤트가 적용된 테넌트(audit promo_applied) 중 지금 유료 활성.
        const conv = rows.length ? await q(sql`SELECT a.target, COUNT(DISTINCT a.tenant_id) AS c FROM audit_logs a JOIN tenants t ON t.id = a.tenant_id
          WHERE a.action = 'promo_applied' AND t.status = 'active' AND t.plan_key <> 'trial'
            AND a.target IN (${sql.join(rows.map((r) => sql`${`promotion:${n(r.id)}`}`), sql`, `)}) GROUP BY a.target`) : [];
        const convOf = new Map(conv.map((c) => [String(c.target), n(c.c)]));
        const status = (url.searchParams.get("status") || "").trim();
        let list = rows.map((r) => toPromotionRow(r, convOf.get(`promotion:${n(r.id)}`) ?? 0));
        if (status) list = list.filter((p) => p.status === status);
        return json({ ok: true, promotions: list, total: n(cnt?.c), page, size });
      }
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<Record<string, unknown>>(req);
      const id = n(b.id);
      if (id && Object.keys(b).length <= 2 && typeof b.active === "boolean") {   // 켜기/끄기만
        const [r] = await q(sql`UPDATE promotions SET active = ${b.active}, updated_at = NOW() WHERE id = ${id} RETURNING *`);
        if (!r) return json({ ok: false, error: "이벤트가 없어요.", step: "not_found" }, 404);
        await writeAudit({ tenantId: null, action: "ops_promotion_toggle", actorType: "operator", actorId: o.ops.oid, ip, target: `promotion:${id}`, detail: { active: b.active } });
        return json({ ok: true, promotion: toPromotionRow(r) });
      }
      const p = parsePromotionInput(b);
      if (!p.ok) return badRequest(p.error);
      const [r] = id
        ? await q(sql`UPDATE promotions SET kind = ${p.kind}, name = ${p.name}, config = ${jsonb(p.config)}, conditions = ${jsonb(p.conditions)}, starts_at = ${tsOrNull(p.startsAt)}, ends_at = ${tsOrNull(p.endsAt)}, active = ${p.active}, updated_at = NOW() WHERE id = ${id} RETURNING *`)
        : await q(sql`INSERT INTO promotions (kind, name, config, conditions, starts_at, ends_at, active) VALUES (${p.kind}, ${p.name}, ${jsonb(p.config)}, ${jsonb(p.conditions)}, ${tsOrNull(p.startsAt)}, ${tsOrNull(p.endsAt)}, ${p.active}) RETURNING *`);
      if (!r) return json({ ok: false, error: "이벤트가 없어요.", step: "not_found" }, 404);
      const [chk] = await q(sql`SELECT jsonb_typeof(config) AS c, jsonb_typeof(conditions) AS d FROM promotions WHERE id = ${n(r.id)}`);
      if (chk && (chk.c !== "object" || chk.d !== "object")) console.error("[ops-promotions] jsonb_typeof 이상", chk);   // PITFALLS #1
      await writeAudit({ tenantId: null, action: id ? "ops_promotion_update" : "ops_promotion_create", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "medium", target: `promotion:${n(r.id)}`, detail: { kind: p.kind, name: p.name, config: p.config, conditions: p.conditions, startsAt: p.startsAt, endsAt: p.endsAt, active: p.active } });
      return json({ ok: true, promotion: toPromotionRow(r) }, id ? 200 : 201);
    }

    /* ── 쿠폰 ── */
    if (path.endsWith("/ops-coupons")) {
      if (req.method === "GET") {
        const { page, size, offset } = pageOf(url);
        const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM coupons`);
        const rows = await q(sql`SELECT c.*, (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id = c.id AND r.converted_at IS NOT NULL) AS converted FROM coupons c ORDER BY c.active DESC, c.created_at DESC LIMIT ${size} OFFSET ${offset}`);
        const status = (url.searchParams.get("status") || "").trim();
        let list = rows.map((r) => ({ ...toCouponRow(r), converted: n(r.converted) }));
        if (status) list = list.filter((c) => c.status === status);
        return json({ ok: true, coupons: list, total: n(cnt?.c), page, size });
      }
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<Record<string, unknown>>(req);
      const id = n(b.id);
      if (id && Object.keys(b).length <= 2 && typeof b.active === "boolean") {
        const [r] = await q(sql`UPDATE coupons SET active = ${b.active}, updated_at = NOW() WHERE id = ${id} RETURNING *`);
        if (!r) return json({ ok: false, error: "쿠폰이 없어요.", step: "not_found" }, 404);
        await writeAudit({ tenantId: null, action: "ops_coupon_toggle", actorType: "operator", actorId: o.ops.oid, ip, target: `coupon:${id}`, detail: { active: b.active } });
        return json({ ok: true, coupon: toCouponRow(r) });
      }
      const c = parseCouponInput(b);
      if (!c.ok) return badRequest(c.error);
      if (c.plans) { const plans = await loadPlans(); const bad = c.plans.filter((k) => !plans.find((p) => p.key === k)); if (bad.length) return badRequest(`없는 플랜: ${bad.join(", ")}`, "plan"); }
      const [dup] = await q(sql`SELECT id FROM coupons WHERE UPPER(code) = ${c.code} AND id <> ${id} LIMIT 1`);
      if (dup) return badRequest("같은 코드의 쿠폰이 이미 있어요.", "code");
      const plansJson = c.plans ? jsonb(c.plans) : sql`NULL`;
      const [r] = id
        ? await q(sql`UPDATE coupons SET code = ${c.code}, kind = ${c.kind}, value = ${c.value}, plan_keys = ${plansJson}, max_uses = ${c.maxUses}, starts_at = ${tsOrNull(c.startsAt)}, ends_at = ${tsOrNull(c.endsAt)}, months = ${c.months}, name = ${c.name}, active = ${c.active}, updated_at = NOW() WHERE id = ${id} RETURNING *`)
        : await q(sql`INSERT INTO coupons (code, kind, value, plan_keys, max_uses, starts_at, ends_at, months, name, active) VALUES (${c.code}, ${c.kind}, ${c.value}, ${plansJson}, ${c.maxUses}, ${tsOrNull(c.startsAt)}, ${tsOrNull(c.endsAt)}, ${c.months}, ${c.name}, ${c.active}) RETURNING *`);
      if (!r) return json({ ok: false, error: "쿠폰이 없어요.", step: "not_found" }, 404);
      await writeAudit({ tenantId: null, action: id ? "ops_coupon_update" : "ops_coupon_create", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "medium", target: `coupon:${n(r.id)}`, detail: { code: c.code, kind: c.kind, value: c.value, maxUses: c.maxUses, plans: c.plans, months: c.months, startsAt: c.startsAt, endsAt: c.endsAt, active: c.active } });
      return json({ ok: true, coupon: toCouponRow(r) }, id ? 200 : 201);
    }

    /* ── 쿠폰 사용 내역 ── */
    if (path.endsWith("/ops-coupon-redemptions")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const couponId = n(url.searchParams.get("couponId"));
      const { page, size, offset } = pageOf(url);
      const where = sql`(${couponId} = 0 OR r.coupon_id = ${couponId})`;
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM coupon_redemptions r WHERE ${where}`);
      const rows = await q(sql`SELECT r.id, r.coupon_id, r.tenant_id, r.created_at, r.order_no, r.converted_at, t.name AS tenant_name, t.plan_key, c.code, c.kind, c.value,
          (SELECT i.amount FROM invoices i WHERE i.tenant_id = r.tenant_id AND i.order_no = r.order_no LIMIT 1) AS charged_supply
        FROM coupon_redemptions r JOIN tenants t ON t.id = r.tenant_id JOIN coupons c ON c.id = r.coupon_id
        WHERE ${where} ORDER BY r.id DESC LIMIT ${size} OFFSET ${offset}`);
      const plans = await loadPlans();
      const redemptions = rows.map((r) => {
        // 할인액: krw 쿠폰 = 액면 · pct 쿠폰 = 청구 공급가 기준 역산(청구 전이면 플랜 월가 기준 추정 · 없으면 키 생략).
        const kind = String(r.kind), value = n(r.value);
        let discountKrw: number | undefined;
        if (kind === "krw") discountKrw = value;
        else { const base = r.charged_supply !== null && r.charged_supply !== undefined ? Math.round(n(r.charged_supply) * 100 / Math.max(1, 100 - value)) : (plans.find((p) => p.key === String(r.plan_key))?.priceMonth ?? 0); if (base > 0) discountKrw = Math.round(base * value / 100); }
        const o2: Record<string, unknown> = { id: n(r.id), couponId: n(r.coupon_id), code: String(r.code), tenantId: n(r.tenant_id), tenantName: String(r.tenant_name ?? ""), at: iso(r.created_at) ?? "", planKey: String(r.plan_key ?? "") };
        if (discountKrw !== undefined) o2.discountKrw = discountKrw;
        if (iso(r.converted_at)) o2.convertedAt = iso(r.converted_at);
        if (r.order_no) o2.orderNo = String(r.order_no);
        return o2;
      });
      return json({ ok: true, redemptions, total: n(cnt?.c), page, size });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("ops_promotions", err); }
};
