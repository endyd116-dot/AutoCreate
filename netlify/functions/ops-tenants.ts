/**
 * 운영센터 · 고객 메뉴(계약 §2.1 `ops-tenants.ts` · §2.3 원격접속 · DESIGN §11.4). R1 `ops-center.ts` 에서 쪼갬 — 옛 경로·응답 키는 그대로 살리고 R4 몫을 더한다.
 *   GET  /api/ops-tenants?q&plan&status&page        목록(표) — 플랜·상태·체험 D-·코인·계정 수·마지막 발행·건강 · `page`·`total`
 *   GET  /api/ops-tenant?id                          상세 — 계정/러너/편성 상태 · **셋업 체크리스트 `setup:{ accounts, adMedia, rules, firstPublish }`**(v4 이름 · R1 이름 폐기) · 구독 장부 · 카드 · 인보이스 · 티켓 · 메모
 *   POST /api/ops-tenant-update { id, planKey?, status?, trialEndsAt?, note?, priceLockedKrw? }   (admin) — 정본 직접 수정(감사 high) · priceLockedKrw = 가입 시점 가격 고정(가격 개정이 못 건드림 · null 로 해제)
 *   POST /api/ops-coins-grant  { id, coins, reason }                             (admin) — +는 grant(included·만료 없음) · −는 회수(포함분 잔량까지만)
 *   POST /api/ops-trial-extend { id, days }                                      (admin) — 체험 연장 · readonly 였으면 trial 로 복귀 + 알림
 *   POST /api/ops-plan-change  { id, planKey, cycle?, charge? }                  (admin) — charge:true 면 실제 청구(changePlan · source ops) · 아니면 무상 전환(장부·포함분·감사)
 *   POST /api/ops-tenant-note  { id, note }                                      (operator+) — 운영 메모
 *   POST /api/ops-impersonate  { id } · /api/ops-impersonate-end                (operator+) — 60분 상한 토큰 · 시작/종료 감사 + 고객 알림 «운영자가 설정을 도와드렸어요»
 *   권한(§0.2): 열람·메모·원격접속 = operator 이상 · 수정·코인·체험·플랜 = admin 이상(super_admin 은 전부).
 */
import { sql, type SQL } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { signImpersonationToken, verifyUser, userCookie, clearCookie, USER_COOKIE, clientIp, IMPERSONATION_MAX_MIN } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { loadPlans, currentTrialDays, planOf } from "../../lib/plans";
import { balance, grant, grantIncluded } from "../../lib/coin-ledger";
import { readLedger, activeBillingKey, changePlan, kstMonthOf, periodEndOf, isPaidPlan, type Cycle } from "../../lib/subscription";
import { q } from "../../lib/accounts";
import { utcDate } from "../../lib/db-util";
import { pageOf, ts } from "../../lib/ops/period";
import { jsonWithCookies } from "./_resp";

export const config = { path: ["/api/ops-tenants", "/api/ops-tenant", "/api/ops-tenant-update", "/api/ops-coins-grant", "/api/ops-trial-extend", "/api/ops-plan-change", "/api/ops-tenant-note", "/api/ops-impersonate", "/api/ops-impersonate-end"] };

const n = (v: unknown) => Number(v || 0);
const iso = (v: unknown) => utcDate(v)?.toISOString();
const TENANT_STATUSES = ["trial", "active", "past_due", "readonly", "suspended", "cancelled", "closed"];
const ADMIN = ["admin", "super_admin"] as const;

/** 목록 1행(R1 키 유지 + R4 추가 · 없는 값은 키를 싣지 않는다). */
function tenantRow(r: Record<string, unknown>, now: number): Record<string, unknown> {
  const o: Record<string, unknown> = {
    id: n(r.id), key: String(r.key), name: String(r.name), planKey: String(r.plan_key), status: String(r.status),
    createdAt: iso(r.created_at) ?? "", ownerEmail: r.owner_email ? String(r.owner_email) : null,
    accounts: n(r.accounts), coins: n(r.coins), lastPostAt: iso(r.last_post_at) ?? null,
    runners: { online: n(r.runners_online), total: n(r.runners_total) }, openTickets: n(r.open_tickets),
  };
  const te = utcDate(r.trial_ends_at);
  if (te) { o.trialEndsAt = te.toISOString(); o.trialDaysLeft = Math.ceil((te.getTime() - now) / 86400_000); }
  if (r.health !== null && r.health !== undefined) o.health = Math.round(n(r.health));
  if (r.ops_note) o.note = String(r.ops_note);
  return o;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
  const o = await requireAdmin(req); if (!o.ok) return o.res;
  const ip = clientIp(req);
  try {
    /* ── 목록 ── */
    if (path.endsWith("/ops-tenants")) {
      const s = (url.searchParams.get("q") || "").trim().toLowerCase();
      const status = (url.searchParams.get("status") || "").trim();
      const plan = (url.searchParams.get("plan") || "").trim();
      const { page, size, offset } = pageOf(url);
      const where: SQL = sql`(${s} = '' OR LOWER(t.name) LIKE ${"%" + s + "%"} OR LOWER(t.key) LIKE ${"%" + s + "%"} OR EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND LOWER(u.email) LIKE ${"%" + s + "%"}))
          AND (${status} = '' OR t.status = ${status}) AND (${plan} = '' OR t.plan_key = ${plan})`;
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM tenants t WHERE ${where}`);
      const rows = await q(sql`SELECT t.id, t.key, t.name, t.plan_key, t.status, t.trial_ends_at, t.created_at, t.ops_note,
          (SELECT email FROM users u WHERE u.tenant_id = t.id AND u.role = 'owner' ORDER BY id LIMIT 1) AS owner_email,
          (SELECT COUNT(*) FROM accounts a WHERE a.tenant_id = t.id) AS accounts,
          (SELECT AVG(health_score) FROM accounts a WHERE a.tenant_id = t.id) AS health,
          (SELECT COALESCE(SUM(delta), 0) FROM coin_ledger c WHERE c.tenant_id = t.id AND (c.expires_at IS NULL OR c.expires_at > NOW())) AS coins,
          (SELECT MAX(published_at) FROM posts p WHERE p.tenant_id = t.id) AS last_post_at,
          (SELECT COUNT(*) FROM runner_devices d WHERE d.tenant_id = t.id AND d.status = 'online') AS runners_online,
          (SELECT COUNT(*) FROM runner_devices d WHERE d.tenant_id = t.id) AS runners_total,
          (SELECT COUNT(*) FROM tickets k WHERE k.tenant_id = t.id AND k.status IN ('open','progress')) AS open_tickets
        FROM tenants t WHERE ${where}
        ORDER BY t.created_at DESC LIMIT ${size} OFFSET ${offset}`);
      const now = Date.now();
      return json({ ok: true, tenants: rows.map((r) => tenantRow(r, now)), total: n(cnt?.c), page, size });
    }

    /* ── 상세 ── */
    if (path.endsWith("/ops-tenant")) {
      const id = n(url.searchParams.get("id"));
      if (!id) return badRequest("id");
      const [t] = await q(sql`SELECT * FROM tenants WHERE id = ${id}`);
      if (!t) return json({ ok: false, error: "고객이 없어요.", step: "tenant" }, 404);
      const users = await q(sql`SELECT id, email, name, role, email_verified_at, last_login_at FROM users WHERE tenant_id = ${id} ORDER BY id`);
      const accounts = await q(sql`SELECT id, channel, handle, status, health_score, posts_today, daily_cap, last_post_at, monetize FROM accounts WHERE tenant_id = ${id} ORDER BY channel, id`);
      const runners = await q(sql`SELECT id, name, kind, status, last_seen_at, version FROM runner_devices WHERE tenant_id = ${id}`);
      const coins = await balance(id);
      const [slots] = await q(sql`SELECT COUNT(*) FILTER (WHERE status IN ('planned','topic_assigned','producing','in_review','approved','scheduled')) AS upcoming,
                                        COUNT(*) FILTER (WHERE status = 'published') AS published FROM slots WHERE tenant_id = ${id}`);
      const audit = await q(sql`SELECT id, action, actor_type, actor_id, risk_level, created_at FROM audit_logs WHERE tenant_id = ${id} ORDER BY id DESC LIMIT 20`);
      const [rules] = await q(sql`SELECT COUNT(*) AS c FROM cadence_rules WHERE tenant_id = ${id} AND active = true`);
      const sources = await q(sql`SELECT source, method, status, last_sync_at FROM revenue_sources WHERE tenant_id = ${id}`);
      const [posts] = await q(sql`SELECT COUNT(*) AS c, MAX(published_at) AS last FROM posts WHERE tenant_id = ${id}`);
      const invoices = await q(sql`SELECT id, kind, period, amount, vat_krw, total_krw, status, paid_at, attempts, next_retry_at, refunded_krw, created_at FROM invoices WHERE tenant_id = ${id} ORDER BY id DESC LIMIT 10`);
      const tickets = await q(sql`SELECT id, subject, status, priority, sla_due_at, created_at FROM tickets WHERE tenant_id = ${id} AND status <> 'resolved' ORDER BY id DESC LIMIT 10`);
      const ledger = await readLedger(id);
      const key = await activeBillingKey(id);
      // 광고 매체 = 수익 커넥터가 있거나 계정에 광고 식별자(애드포스트 미디어·애드센스 pub)가 붙어 있으면 «연결됨».
      const adMedia = sources.length > 0 || accounts.some((a) => { const m = (a.monetize && typeof a.monetize === "object" ? a.monetize : {}) as Record<string, unknown>; return !!(m.adpostMediaId || m.adsensePub || m.coupangPartnerId); });
      const setup = { accounts: accounts.length > 0, adMedia, rules: n(rules?.c) > 0, firstPublish: n(posts?.c) > 0 };
      const health = accounts.length ? Math.round(accounts.reduce((a, r) => a + n(r.health_score), 0) / accounts.length) : null;
      const body: Record<string, unknown> = {
        ok: true, tenant: t, users, accounts: accounts.map(({ monetize: _m, ...rest }) => rest), runners, coins: coins.balance, coinDetail: coins, slots, audit, setup, sources,
        posts: { total: n(posts?.c), lastAt: iso(posts?.last) ?? null },
        invoices: invoices.map((r) => ({ id: n(r.id), kind: String(r.kind), period: String(r.period), amountKrw: n(r.amount), vatKrw: n(r.vat_krw), totalKrw: r.total_krw === null ? n(r.amount) + n(r.vat_krw) : n(r.total_krw),
          status: String(r.status), attempts: n(r.attempts), refundedKrw: n(r.refunded_krw), ...(iso(r.paid_at) ? { paidAt: iso(r.paid_at) } : {}), ...(iso(r.next_retry_at) ? { nextRetryAt: iso(r.next_retry_at) } : {}), createdAt: iso(r.created_at) ?? "" })),
        tickets: tickets.map((r) => ({ id: n(r.id), subject: String(r.subject), status: String(r.status), priority: String(r.priority), ...(iso(r.sla_due_at) ? { slaDueAt: iso(r.sla_due_at) } : {}), createdAt: iso(r.created_at) ?? "" })),
        billingKey: key ? { has: true, ...(key.last4 ? { last4: key.last4 } : {}), ...(key.brand ? { brand: key.brand } : {}) } : { has: false },
        note: t.ops_note ? String(t.ops_note) : "",
      };
      if (health !== null) body.health = health;
      if (ledger) body.subscription = { planKey: ledger.planKey, cycle: ledger.cycle, status: ledger.status, periodStart: ledger.periodStart?.toISOString() ?? null, periodEnd: ledger.periodEnd?.toISOString() ?? null,
        nextBillingAt: ledger.nextBillingAt?.toISOString() ?? null, failCount: ledger.failCount, cancelAtPeriodEnd: ledger.cancelAtPeriodEnd, pendingPlanKey: ledger.pendingPlanKey ?? null, pendingCycle: ledger.pendingCycle ?? null,
        discountPct: ledger.discountPct, priceLockedKrw: ledger.priceLockedKrw };
      return json(body);
    }

    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);

    /* ── 정본 직접 수정(admin) ── */
    if (path.endsWith("/ops-tenant-update")) {
      const g = await requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; planKey?: string; status?: string; trialEndsAt?: string; note?: string; priceLockedKrw?: number | null }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const plans = await loadPlans();
      if (b.planKey && !plans.find((p) => p.key === b.planKey)) return badRequest("없는 플랜이에요.", "plan");
      if (b.status && !TENANT_STATUSES.includes(b.status)) return badRequest("status");
      const trialIso = b.trialEndsAt ? utcDate(b.trialEndsAt)?.toISOString() ?? null : null;
      if (b.trialEndsAt && !trialIso) return badRequest("trialEndsAt");
      await q(sql`UPDATE tenants SET
          plan_key = COALESCE(${b.planKey || null}, plan_key),
          status = COALESCE(${b.status || null}, status),
          readonly_at = CASE WHEN ${b.status || null} = 'readonly' THEN COALESCE(readonly_at, NOW()) WHEN ${b.status || null} IS NULL THEN readonly_at ELSE NULL END,
          suspended_at = CASE WHEN ${b.status || null} = 'suspended' THEN COALESCE(suspended_at, NOW()) WHEN ${b.status || null} IS NULL THEN suspended_at ELSE NULL END,
          trial_ends_at = COALESCE(${trialIso}::timestamptz AT TIME ZONE 'UTC', trial_ends_at),
          ops_note = COALESCE(${typeof b.note === "string" ? b.note.slice(0, 2000) : null}, ops_note),
          updated_at = NOW() WHERE id = ${id}`);
      if (b.priceLockedKrw !== undefined) {   // 가격 고정(계약 §2.1 ops-plans «price_locked_krw 있는 테넌트는 유지») — 장부가 없으면(체험) 만들어 둔다
        const locked = b.priceLockedKrw === null ? null : Math.max(0, Math.floor(n(b.priceLockedKrw)));
        if (locked !== null && locked <= 0) return badRequest("priceLockedKrw 는 1원 이상이거나 null(해제)이에요.");
        await q(sql`INSERT INTO subscriptions (tenant_id, plan_key, status, cycle, period_start, period_end, price_locked_krw, updated_at)
          VALUES (${id}, ${b.planKey || sql`(SELECT plan_key FROM tenants WHERE id = ${id})`}, ${"pending"}, ${"month"}, NOW(), NOW(), ${locked}, NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET price_locked_krw = EXCLUDED.price_locked_krw, updated_at = NOW()`);
      }
      await writeAudit({ tenantId: id, action: "ops_tenant_update", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { planKey: b.planKey, status: b.status, trialEndsAt: trialIso, note: b.note, priceLockedKrw: b.priceLockedKrw } });
      return json({ ok: true });
    }

    /* ── 코인 지급/회수(admin) ── */
    if (path.endsWith("/ops-coins-grant")) {
      const g = await requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; coins?: number; reason?: string }>(req);
      const id = n(b.id); const coins = Math.trunc(n(b.coins));
      if (!id || !coins || Math.abs(coins) > 10_000) return badRequest("id·coins(±10,000 이내)");
      const reason = (b.reason || "운영자 지급").slice(0, 200);
      const ref = `ops:${o.ops.oid}:${Date.now()}`;
      let applied = 0;
      if (coins > 0) { const r = await grant(id, coins, reason, o.ops.oid, ref); applied = r.granted; }
      else {
        // 회수는 포함분 잔량까지만(잔액을 음수로 만들지 않는다 · 충전분 회수는 환불 경로가 따로).
        const bal = await balance(id);
        applied = -Math.min(Math.abs(coins), Math.max(0, bal.included));
        if (applied) await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason, actor_id) VALUES (${id}, ${"revoke"}, ${"included"}, ${applied}, ${ref}, ${reason}, ${o.ops.oid})`);
      }
      await writeAudit({ tenantId: id, action: "ops_coins_grant", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { requested: coins, applied, reason } });
      const after = await balance(id);
      return json({ ok: true, applied, balance: after.balance });
    }

    /* ── 체험 연장(admin) ── */
    if (path.endsWith("/ops-trial-extend")) {
      const g = await requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; days?: number }>(req);
      const id = n(b.id); const days = Math.trunc(n(b.days));
      if (!id || days < 1 || days > 90) return badRequest("id·days(1~90)");
      const [t] = await q(sql`SELECT status, trial_ends_at FROM tenants WHERE id = ${id}`);
      if (!t) return json({ ok: false, error: "고객이 없어요.", step: "tenant" }, 404);
      if (!["trial", "readonly"].includes(String(t.status))) return badRequest("체험 중이거나 체험이 끝난 고객만 연장할 수 있어요.", "status");
      const [u] = await q(sql`UPDATE tenants SET trial_ends_at = GREATEST(COALESCE(trial_ends_at, NOW()), NOW()) + (${days} || ' days')::interval,
          status = 'trial', readonly_at = NULL, updated_at = NOW() WHERE id = ${id} RETURNING trial_ends_at`);
      const until = iso(u?.trial_ends_at) ?? null;
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${id}, ${"trial_extended"}, ${`체험이 ${days}일 늘어났어요`}, ${"운영자가 체험 기간을 연장해 드렸어요. 이어서 편하게 써 보세요."}, ${"/app/home.html"})`);
      await writeAudit({ tenantId: id, action: "ops_trial_extend", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "medium", detail: { days, from: String(t.status), until } });
      return json({ ok: true, trialEndsAt: until });
    }

    /* ── 플랜 변경(admin) — charge:true 면 실제 청구 · 아니면 무상 전환(운영 재량 · 감사 high) ── */
    if (path.endsWith("/ops-plan-change")) {
      const g = await requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; planKey?: string; cycle?: string; charge?: boolean }>(req);
      const id = n(b.id); const planKey = String(b.planKey || ""); const cycle: Cycle = b.cycle === "year" ? "year" : "month";
      if (!id || !planKey) return badRequest("id·planKey");
      const plans = await loadPlans();
      if (!plans.find((p) => p.key === planKey)) return badRequest("없는 플랜이에요.", "plan");
      const [t] = await q(sql`SELECT status, plan_key FROM tenants WHERE id = ${id}`);
      if (!t) return json({ ok: false, error: "고객이 없어요.", step: "tenant" }, 404);
      if (b.charge === true) {
        if (!await isPaidPlan(planKey)) return badRequest("청구는 유료 플랜만 할 수 있어요.", "plan");
        const r = await changePlan(id, planKey, cycle, { actorId: o.ops.oid, source: "ops" });
        await writeAudit({ tenantId: id, action: "ops_plan_change", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { from: String(t.plan_key), to: planKey, cycle, charge: true, result: r } });
        if (!r.ok) return json({ ok: false, step: r.step, error: r.error, ...(r.totalKrw !== undefined ? { totalKrw: r.totalKrw } : {}) }, r.step === "not_configured" ? 200 : 400);
        return json({ ...r, charged: true });
      }
      const now = new Date();
      if (planKey === "trial") {
        const days = await currentTrialDays();
        await q(sql`UPDATE tenants SET plan_key = 'trial', status = 'trial', readonly_at = NULL, suspended_at = NULL,
            trial_ends_at = GREATEST(COALESCE(trial_ends_at, NOW()), NOW() + (${days} || ' days')::interval), updated_at = NOW() WHERE id = ${id}`);
      } else {
        const end = periodEndOf(now, cycle);
        await q(sql`UPDATE tenants SET plan_key = ${planKey}, status = 'active', readonly_at = NULL, suspended_at = NULL, updated_at = NOW() WHERE id = ${id}`);
        await q(sql`INSERT INTO subscriptions (tenant_id, plan_key, status, cycle, period_start, period_end, next_billing_at, billing_day, fail_count, pending_plan_key, pending_cycle, cancel_at_period_end, updated_at)
          VALUES (${id}, ${planKey}, ${"active"}, ${cycle}, ${ts(now)}, ${ts(end)}, ${ts(end)}, ${Math.min(28, new Date(now.getTime() + 9 * 3600_000).getUTCDate())}, 0, NULL, NULL, false, NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET plan_key = EXCLUDED.plan_key, status = 'active', cycle = EXCLUDED.cycle, period_start = EXCLUDED.period_start, period_end = EXCLUDED.period_end,
            next_billing_at = EXCLUDED.next_billing_at, fail_count = 0, pending_plan_key = NULL, pending_cycle = NULL, cancel_at_period_end = false, updated_at = NOW()`);
        const plan = await planOf(planKey);
        await grantIncluded(id, plan.limits.coinsIncluded, kstMonthOf(now), o.ops.oid);
      }
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${id}, ${"plan_changed"}, ${"요금제가 바뀌었어요"}, ${`운영자가 ${plans.find((p) => p.key === planKey)?.name ?? planKey} 로 바꿔 드렸어요.`}, ${"/app/plan.html"})`);
      await writeAudit({ tenantId: id, action: "ops_plan_change", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { from: String(t.plan_key), fromStatus: String(t.status), to: planKey, cycle, charge: false } });
      return json({ ok: true, charged: false, planKey, cycle });
    }

    /* ── 운영 메모(operator+) ── */
    if (path.endsWith("/ops-tenant-note")) {
      const b = await readJson<{ id?: number; note?: string }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const note = String(b.note ?? "").slice(0, 2000);
      await q(sql`UPDATE tenants SET ops_note = ${note}, updated_at = NOW() WHERE id = ${id}`);
      await writeAudit({ tenantId: id, action: "ops_tenant_note", actorType: "operator", actorId: o.ops.oid, ip, detail: { length: note.length } });
      return json({ ok: true, note });
    }

    /* ── 원격접속(operator+) — 60분 상한 · 시작 감사 + 알림 ── */
    if (path.endsWith("/ops-impersonate")) {
      const b = await readJson<{ id?: number }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const [t] = await q(sql`SELECT id, key, name FROM tenants WHERE id = ${id}`);
      const [u] = await q(sql`SELECT id, email, name, role FROM users WHERE tenant_id = ${id} AND role = 'owner' ORDER BY id LIMIT 1`);
      if (!t || !u) return json({ ok: false, error: "고객 또는 소유자가 없어요.", step: "tenant" }, 404);
      const at = Date.now(), until = at + IMPERSONATION_MAX_MIN * 60_000;
      const token = signImpersonationToken({ uid: n(u.id), tid: id, role: "owner", email: String(u.email), name: (u.name as string) || undefined, imp: { by: o.ops.oid, byName: o.ops.name, tid: id, tenantKey: String(t.key), at, until } });
      await writeAudit({ tenantId: id, action: "ops_impersonate_start", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { maxMin: IMPERSONATION_MAX_MIN, until: new Date(until).toISOString() } });
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body) VALUES (${id}, ${"ops_assist"}, ${"운영자가 설정을 도와드리고 있어요"}, ${`${o.ops.name || "운영자"}님이 원격으로 접속했어요(최대 ${IMPERSONATION_MAX_MIN}분). 끝나면 알려드릴게요.`})`);
      return jsonWithCookies({ ok: true, redirect: "/app/home.html", until: new Date(until).toISOString() }, [userCookie(token, IMPERSONATION_MAX_MIN * 60)]);
    }
    if (path.endsWith("/ops-impersonate-end")) {
      const cur = verifyUser(req);
      const imp = cur?.imp ?? null;
      const tid = imp ? n(imp.tid) : null;
      const minutes = imp?.at ? Math.max(0, Math.round((Date.now() - imp.at) / 60_000)) : null;
      await writeAudit({ tenantId: tid, action: "ops_impersonate_end", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "medium", detail: { minutes } });
      if (tid) await q(sql`INSERT INTO notifications (tenant_id, kind, title, body) VALUES (${tid}, ${"ops_assist_end"}, ${"운영자가 설정을 도와드렸어요"}, ${`${o.ops.name || "운영자"}님의 원격접속이 끝났어요${minutes !== null ? `(${minutes}분)` : ""}. 바뀐 내용은 활동 기록에서 볼 수 있어요.`})`);
      return jsonWithCookies({ ok: true, tenantId: tid, minutes }, [clearCookie(USER_COOKIE)]);
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("ops_tenants", err); }
};
