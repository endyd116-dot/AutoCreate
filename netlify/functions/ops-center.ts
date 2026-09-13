/**
 * 종합 운영센터 API 묶음(Phase 0 골격 · DESIGN §11.4). 한 파일·여러 경로(폭발 반경 최소).
 *   GET  /api/ops-dashboard            우리 매출·MRR·가입·활성·체험·코인·AI 원가·마진
 *   GET  /api/ops-tenants?q=&status=   고객 목록
 *   GET  /api/ops-tenant?id=           고객 상세(계정·러너·슬롯·코인·최근 감사)
 *   POST /api/ops-tenant-update { id, planKey?, status?, trialEndsAt?, note? }         (admin)
 *   POST /api/ops-coins-grant  { id, coins, reason }                                    (admin) — 원장 grant(included·만료 없음)
 *   POST /api/ops-impersonate  { id }  → 고객 쿠키(imp) 발급 → /app/home.html          (operator)
 *   POST /api/ops-impersonate-end      → 고객 쿠키 삭제
 *   GET  /api/ops-audit?tenantId=&limit=
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireOps } from "../../lib/guards";
import { signImpersonationToken, userCookie, clearCookie, USER_COOKIE, clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { loadPlans } from "../../lib/plans";
import { COIN_KRW } from "../../lib/coin-table";
import { db } from "../../db/index";
import { sql } from "drizzle-orm";
import { jsonWithCookies } from "./_resp";

export const config = { path: ["/api/ops-dashboard", "/api/ops-tenants", "/api/ops-tenant", "/api/ops-tenant-update", "/api/ops-coins-grant", "/api/ops-impersonate", "/api/ops-impersonate-end", "/api/ops-audit"] };

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname;
  const o = requireOps(req); if (!o.ok) return o.res;
  try {
    /* ── 매출 대시보드 ── */
    if (path.endsWith("/ops-dashboard")) {
      const [sub] = await q(sql`SELECT
          COALESCE(SUM(CASE WHEN kind='subscription' AND status='paid' AND paid_at >= date_trunc('month', NOW()) THEN amount END),0) AS sub_month,
          COALESCE(SUM(CASE WHEN kind='coin' AND status='paid' AND paid_at >= date_trunc('month', NOW()) THEN amount END),0) AS coin_month,
          COALESCE(SUM(CASE WHEN status='paid' AND paid_at >= date_trunc('day', NOW()) THEN amount END),0) AS today
        FROM invoices`);
      const [t] = await q(sql`SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status='trial') AS trial,
          COUNT(*) FILTER (WHERE status='active') AS active,
          COUNT(*) FILTER (WHERE status IN ('past_due','readonly')) AS at_risk,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS new_month,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('day', NOW())) AS new_today
        FROM tenants`);
      const plans = await loadPlans();
      const byPlan = await q(sql`SELECT plan_key, COUNT(*) AS c FROM tenants WHERE status='active' GROUP BY plan_key`);
      const mrr = byPlan.reduce((acc, r) => acc + n(r.c) * (plans.find((p) => p.key === r.plan_key)?.priceMonth || 0), 0);
      const [coins] = await q(sql`SELECT
          COALESCE(SUM(CASE WHEN kind='purchase' AND created_at >= date_trunc('month', NOW()) THEN delta END),0) AS sold,
          COALESCE(-SUM(CASE WHEN kind='consume' AND created_at >= date_trunc('month', NOW()) THEN delta END),0) AS consumed
        FROM coin_ledger`);
      const [ai] = await q(sql`SELECT COALESCE(SUM(cost_usd),0) AS usd FROM ai_usage WHERE created_at >= date_trunc('month', NOW())`);
      const fx = Number(process.env.USD_KRW || 1400);
      const aiKrw = Math.round(n(ai?.usd) * fx);
      const revenueMonth = n(sub?.sub_month) + n(sub?.coin_month);
      const [pub] = await q(sql`SELECT COUNT(*) AS c FROM posts WHERE published_at >= date_trunc('month', NOW())`);
      const [rev] = await q(sql`SELECT COALESCE(SUM(amount_krw),0) AS krw FROM revenue_daily WHERE day >= date_trunc('month', NOW())::date`);
      const [tk] = await q(sql`SELECT COUNT(*) FILTER (WHERE status IN ('open','progress')) AS open FROM tickets`);
      return json({ ok: true, month: {
        revenue: revenueMonth, subscription: n(sub?.sub_month), coin: n(sub?.coin_month), today: n(sub?.today), mrr, arr: mrr * 12,
        aiCostKrw: aiKrw, marginKrw: revenueMonth - aiKrw, coinsSold: n(coins?.sold), coinsConsumed: n(coins?.consumed), coinKrw: COIN_KRW,
        published: n(pub?.c), customerRevenueKrw: n(rev?.krw), openTickets: n(tk?.open),
      }, tenants: { total: n(t?.total), trial: n(t?.trial), active: n(t?.active), atRisk: n(t?.at_risk), newMonth: n(t?.new_month), newToday: n(t?.new_today),
        byPlan: byPlan.map((r) => ({ planKey: r.plan_key, count: n(r.c) })) } });
    }

    /* ── 고객 목록 ── */
    if (path.endsWith("/ops-tenants")) {
      const s = (url.searchParams.get("q") || "").trim().toLowerCase();
      const status = url.searchParams.get("status") || "";
      const rows = await q(sql`SELECT t.id, t.key, t.name, t.plan_key, t.status, t.trial_ends_at, t.created_at,
          (SELECT email FROM users u WHERE u.tenant_id = t.id AND u.role='owner' ORDER BY id LIMIT 1) AS owner_email,
          (SELECT COUNT(*) FROM accounts a WHERE a.tenant_id = t.id) AS accounts,
          (SELECT COALESCE(SUM(delta),0) FROM coin_ledger c WHERE c.tenant_id = t.id AND (c.expires_at IS NULL OR c.expires_at > NOW())) AS coins,
          (SELECT MAX(published_at) FROM posts p WHERE p.tenant_id = t.id) AS last_post_at
        FROM tenants t
        WHERE (${s} = '' OR LOWER(t.name) LIKE ${"%" + s + "%"} OR LOWER(t.key) LIKE ${"%" + s + "%"} OR EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND LOWER(u.email) LIKE ${"%" + s + "%"}))
          AND (${status} = '' OR t.status = ${status})
        ORDER BY t.created_at DESC LIMIT 200`);
      return json({ ok: true, tenants: rows.map((r) => ({ id: n(r.id), key: r.key, name: r.name, planKey: r.plan_key, status: r.status, trialEndsAt: r.trial_ends_at, createdAt: r.created_at, ownerEmail: r.owner_email, accounts: n(r.accounts), coins: n(r.coins), lastPostAt: r.last_post_at })) });
    }

    /* ── 고객 상세 ── */
    if (path.endsWith("/ops-tenant")) {
      const id = n(url.searchParams.get("id"));
      if (!id) return badRequest("id");
      const [t] = await q(sql`SELECT * FROM tenants WHERE id = ${id}`);
      if (!t) return json({ ok: false, error: "고객이 없어요.", step: "tenant" }, 404);
      const users = await q(sql`SELECT id, email, name, role, email_verified_at, last_login_at FROM users WHERE tenant_id = ${id} ORDER BY id`);
      const accounts = await q(sql`SELECT id, channel, handle, status, health_score, posts_today, daily_cap, last_post_at FROM accounts WHERE tenant_id = ${id} ORDER BY channel, id`);
      const runners = await q(sql`SELECT id, name, kind, status, last_seen_at, version FROM runner_devices WHERE tenant_id = ${id}`);
      const [coins] = await q(sql`SELECT COALESCE(SUM(delta),0) AS balance FROM coin_ledger WHERE tenant_id = ${id} AND (expires_at IS NULL OR expires_at > NOW())`);
      const [slots] = await q(sql`SELECT COUNT(*) FILTER (WHERE status IN ('planned','topic_assigned','producing','in_review','approved','scheduled')) AS upcoming,
                                        COUNT(*) FILTER (WHERE status='published') AS published FROM slots WHERE tenant_id = ${id}`);
      const audit = await q(sql`SELECT id, action, actor_type, actor_id, risk_level, created_at FROM audit_logs WHERE tenant_id = ${id} ORDER BY id DESC LIMIT 20`);
      const rules = await q(sql`SELECT COUNT(*) AS c FROM cadence_rules WHERE tenant_id = ${id} AND active = true`);
      const sources = await q(sql`SELECT source, method, status, last_sync_at FROM revenue_sources WHERE tenant_id = ${id}`);
      const setup = { accountsConnected: accounts.length > 0, revenueSource: sources.length > 0, rule: n(rules[0]?.c) > 0, firstPublish: n(slots?.published) > 0 };
      return json({ ok: true, tenant: t, users, accounts, runners, coins: n(coins?.balance), slots, audit, setup, sources });
    }

    /* ── 고객 수정(admin) ── */
    if (path.endsWith("/ops-tenant-update")) {
      const g = requireOps(req, "admin"); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; planKey?: string; status?: string; trialEndsAt?: string; note?: string }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const plans = await loadPlans();
      if (b.planKey && !plans.find((p) => p.key === b.planKey)) return badRequest("없는 플랜이에요.", "plan");
      if (b.status && !["trial", "active", "past_due", "readonly", "closed"].includes(b.status)) return badRequest("status");
      await q(sql`UPDATE tenants SET
          plan_key = COALESCE(${b.planKey || null}, plan_key),
          status = COALESCE(${b.status || null}, status),
          trial_ends_at = COALESCE(${b.trialEndsAt ? new Date(b.trialEndsAt).toISOString() : null}::timestamptz AT TIME ZONE ${"UTC"}, trial_ends_at),
          updated_at = NOW() WHERE id = ${id}`);
      await writeAudit({ tenantId: id, action: "ops_tenant_update", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req), riskLevel: "high", detail: { planKey: b.planKey, status: b.status, trialEndsAt: b.trialEndsAt, note: b.note } });
      return json({ ok: true });
    }

    /* ── 코인 지급(admin) — 원장 grant · included 버킷 · 만료 없음(AM 규율) ── */
    if (path.endsWith("/ops-coins-grant")) {
      const g = requireOps(req, "admin"); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; coins?: number; reason?: string }>(req);
      const id = n(b.id); const coins = Math.trunc(n(b.coins));
      if (!id || !coins || Math.abs(coins) > 10_000) return badRequest("id·coins(±10,000 이내)");
      const ref = `ops:${o.ops.oid}:${Date.now()}`;
      await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason, actor_id)
                  VALUES (${id}, ${coins > 0 ? "grant" : "revoke"}, ${"included"}, ${coins}, ${ref}, ${(b.reason || "운영자 지급").slice(0, 200)}, ${o.ops.oid})`);
      await writeAudit({ tenantId: id, action: "ops_coins_grant", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req), riskLevel: "high", detail: { coins, reason: b.reason } });
      const [c] = await q(sql`SELECT COALESCE(SUM(delta),0) AS balance FROM coin_ledger WHERE tenant_id = ${id} AND (expires_at IS NULL OR expires_at > NOW())`);
      return json({ ok: true, balance: n(c?.balance) });
    }

    /* ── 원격접속 — 고객 owner 신원으로 imp 토큰(결제 차단·배너·감사) ── */
    if (path.endsWith("/ops-impersonate")) {
      const b = await readJson<{ id?: number }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const [t] = await q(sql`SELECT id, key, name FROM tenants WHERE id = ${id}`);
      const [u] = await q(sql`SELECT id, email, name, role FROM users WHERE tenant_id = ${id} AND role = 'owner' ORDER BY id LIMIT 1`);
      if (!t || !u) return json({ ok: false, error: "고객 또는 소유자가 없어요.", step: "tenant" }, 404);
      const token = signImpersonationToken({ uid: n(u.id), tid: id, role: "owner", email: String(u.email), name: (u.name as string) || undefined, imp: { by: o.ops.oid, byName: o.ops.name, tid: id, tenantKey: String(t.key) } });
      await writeAudit({ tenantId: id, action: "ops_impersonate_start", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req), riskLevel: "high" });
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body) VALUES (${id}, ${"ops_assist"}, ${"운영자가 설정을 도와드리고 있어요"}, ${`${o.ops.name || "운영자"}님이 원격으로 접속했어요. 끝나면 알려드릴게요.`})`);
      return jsonWithCookies({ ok: true, redirect: "/app/home.html" }, [userCookie(token)]);
    }
    if (path.endsWith("/ops-impersonate-end")) {
      await writeAudit({ tenantId: null, action: "ops_impersonate_end", actorType: "operator", actorId: o.ops.oid, ip: clientIp(req) });
      return jsonWithCookies({ ok: true }, [clearCookie(USER_COOKIE)]);
    }

    /* ── 감사 로그 ── */
    if (path.endsWith("/ops-audit")) {
      const tid = n(url.searchParams.get("tenantId"));
      const limit = Math.min(200, n(url.searchParams.get("limit")) || 50);
      const rows = await q(sql`SELECT id, tenant_id, actor_type, actor_id, action, target, risk_level, ip, created_at FROM audit_logs
        WHERE (${tid} = 0 OR tenant_id = ${tid}) ORDER BY id DESC LIMIT ${limit}`);
      return json({ ok: true, rows });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("ops_center", err); }
};
