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
import { referralRewardCoins } from "../../lib/referral";

export const config = { path: ["/api/ops-promotions", "/api/ops-coupons", "/api/ops-coupon-redemptions", "/api/ops-referrals"] };
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
        /* 🔴 [R17] 추천은 `promo_applied` 를 **안 남긴다** — 보상 경로가 다르다(`lib/referral.ts` 는 `referral_reward` 를 쓴다).
           그대로 두면 추천인 이벤트의 «전환» 칸이 **영원히 0** 이고, 화면은 그걸 «아무도 안 왔다»로 읽는다.
           «0 이 사실이 아닌데 0 으로 보이는 것»이 제일 나쁘다 — 실제로 보상이 나간 수(이벤트 기간 안)로 센다. */
        for (const r of rows.filter((x) => String(x.kind) === "referral")) {
          try {
            const [rc] = await q(sql`SELECT COUNT(*) AS c FROM tenants t, promotions p WHERE p.id = ${n(r.id)} AND t.referral_rewarded_at IS NOT NULL
              AND (p.starts_at IS NULL OR t.referral_rewarded_at >= p.starts_at) AND (p.ends_at IS NULL OR t.referral_rewarded_at <= p.ends_at)`);
            convOf.set(`promotion:${n(r.id)}`, n(rc?.c));
          } catch { /* 보조 집계 실패는 목록을 막지 않는다(CLAUDE §4.1) */ }
        }
        let list = rows.map((r) => toPromotionRow(r, convOf.get(`promotion:${n(r.id)}`) ?? 0));
        if (status) list = list.filter((p) => p.status === status);
        return json({ ok: true, promotions: list, total: n(cnt?.c), page, size });
      }
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      /* 🔴 [2026-09-19 수리 2판] **매크로·FAQ 와 똑같은 봉투 병이 여기에도 있었다.**
         화면(`ops/promo.html`)이 보내는 것: `{ action:"save", id?, promotion:{…} }` · `{ action:"end", id }`
         옛 판은 **평면 몸통만** 봐서 ① 저장은 `parsePromotionInput` 이 `kind`·`name` 을 못 찾아 400,
         ② 「끝내기」는 `active` 를 안 보내니 토글 분기에도 안 걸려 **아무 일도 안 났다.**
         🔴 `verify-key-contract` 는 이 자리를 «몸통을 통째로 넘긴다»며 **판정 못 함(⊘)** 으로 비켜 갔다 —
            ⊘ 는 «괜찮다»가 아니다(AC-9). 열어 보니 실제로 고장이었다. 봉투를 뜯고 옛 평면 모양도 그대로 받는다. */
      const body = await readJson<Record<string, unknown>>(req);
      const envP = (body.promotion && typeof body.promotion === "object" ? body.promotion : {}) as Record<string, unknown>;
      const b = { ...body, ...envP } as Record<string, unknown>;
      const id = n(b.id);
      /* 「끝내기」 = 끄기. 화면은 `action:"end"` 로 말한다(옛 `{id, active:false}` 도 그대로 받는다). */
      if (id && b.action === "end") b.active = false;
      if (id && typeof b.active === "boolean" && b.kind === undefined && b.name === undefined) {   // 켜기/끄기만
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

    /* ── 🔴 [R17] 추천인 — 운영이 «누가 누굴 데려와 얼마 받았나»를 보는 자리(읽기 전용) ──
       여태 추천은 `promo.html` 의 **종류 이름표**로만 있었다: 원장(`coin_ledger` ref `referral:{inviter}:{invitee}`)과
       감사(`referral_attached`·`referral_reward`·`referral_blocked`)에 다 남는데 **운영이 볼 문이 0곳**이었다(§4.8 «API 만 있으면 없는 기능»).
       새 파일을 안 판다 — 이벤트 함수의 분기로 붙인다(`director-settings` 선례). 쓰기 없음: 막지도 풀지도 않고 **보여만 준다**(§9). */
    if (path.endsWith("/ops-referrals")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const { page, size, offset } = pageOf(url);
      const only = (url.searchParams.get("status") || "").trim();   // rewarded | blocked | waiting | ""
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM tenants WHERE referred_by IS NOT NULL`);
      const rows = await q(sql`SELECT t.id AS invitee_tid, t.name AS invitee_name, t.plan_key AS invitee_plan, t.status AS invitee_status,
          t.created_at AS joined_at, t.referral_rewarded_at, t.referral_blocked_at, t.referral_block_reason,
          inv.id AS inviter_tid, inv.name AS inviter_name,
          (SELECT COALESCE(SUM(l.delta), 0) FROM coin_ledger l WHERE l.ref = 'referral:' || inv.id || ':' || t.id AND l.delta > 0) AS coins
        FROM tenants t JOIN tenants inv ON inv.id = t.referred_by
        WHERE t.referred_by IS NOT NULL
        ORDER BY COALESCE(t.referral_rewarded_at, t.referral_blocked_at, t.created_at) DESC, t.id DESC LIMIT ${size} OFFSET ${offset}`);
      /* 🔴 `joinedAt` 은 «연결한 시각»이 아니라 **가입 시각**이다 — 연결은 가입 때 1회뿐이라 같은 값이지만, 이름은 있는 그대로 적는다(AC-114). */
      let list = rows.map((r) => {
        const o: Record<string, unknown> = {
          inviteeTid: n(r.invitee_tid), inviteeName: String(r.invitee_name ?? ""), inviteePlan: String(r.invitee_plan ?? ""), inviteeStatus: String(r.invitee_status ?? ""),
          inviterTid: n(r.inviter_tid), inviterName: String(r.inviter_name ?? ""), joinedAt: iso(r.joined_at) ?? "",
          coins: n(r.coins), state: r.referral_rewarded_at ? "rewarded" : r.referral_blocked_at ? "blocked" : "waiting",
        };
        if (iso(r.referral_rewarded_at)) o.rewardedAt = iso(r.referral_rewarded_at);
        if (iso(r.referral_blocked_at)) o.blockedAt = iso(r.referral_blocked_at);
        if (r.referral_block_reason) o.blockReason = String(r.referral_block_reason);
        return o;
      });
      if (only) list = list.filter((x) => x.state === only);
      /* 요약은 **전체**를 센다(한 쪽만 보고 판단하지 않도록 · 페이지와 겹쳐 세지 않는다). */
      let summary = { attached: n(cnt?.c), rewarded: 0, blocked: 0, waiting: 0, coins: 0 };
      try {
        const [sm] = await q(sql`SELECT COUNT(*) FILTER (WHERE referral_rewarded_at IS NOT NULL) AS rewarded,
            COUNT(*) FILTER (WHERE referral_blocked_at IS NOT NULL) AS blocked FROM tenants WHERE referred_by IS NOT NULL`);
        const [cs] = await q(sql`SELECT COALESCE(SUM(delta), 0) AS c FROM coin_ledger WHERE ref LIKE 'referral:%' AND delta > 0`);
        summary = { attached: n(cnt?.c), rewarded: n(sm?.rewarded), blocked: n(sm?.blocked),
          waiting: Math.max(0, n(cnt?.c) - n(sm?.rewarded) - n(sm?.blocked)), coins: n(cs?.c) };
      } catch { /* 보조 집계 실패는 목록을 막지 않는다 */ }
      const { coins: rewardCoins } = await referralRewardCoins();
      return json({ ok: true, referrals: list, summary, rewardCoins, total: n(cnt?.c), page, size });
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
      /* 🔴 [2026-09-19 수리 2판] 프로모션과 같은 병 — 화면은 `{ action:"save", coupon:{…} }` · `{ action:"end", id }` 로 보낸다. */
      const body = await readJson<Record<string, unknown>>(req);
      const envC = (body.coupon && typeof body.coupon === "object" ? body.coupon : {}) as Record<string, unknown>;
      const b = { ...body, ...envC } as Record<string, unknown>;
      const id = n(b.id);
      if (id && b.action === "end") b.active = false;
      if (id && typeof b.active === "boolean" && b.code === undefined && b.kind === undefined) {
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
