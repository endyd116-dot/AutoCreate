/**
 * 운영센터 · 고객 메뉴(계약 §2.1 `ops-tenants.ts` · §2.3 원격접속 · DESIGN §11.4). R1 `ops-center.ts` 에서 쪼갬 — 옛 경로·응답 키는 그대로 살리고 R4 몫을 더한다.
 *   GET  /api/ops-tenants?q&plan&status&page&internal 목록(표) — 플랜·상태·체험 D-·코인·계정 수·마지막 발행·건강 · `page`·`total`
 *        🔴 [P1R7 §3.4] **내부 테스트 집(`is_internal`)은 기본 목록에서 빠진다** · `?internal=1` 이면 같이 보인다(행에 `isInternal:true`).
 *        응답 `internal:{ excluded, hidden }` = 이번 조건에서 숨긴 집 수 — «몇 집이 안 보이는지»를 화면이 말할 수 있어야 한다.
 *   GET  /api/ops-tenant?id                          상세 — 계정/러너/편성 상태 · **셋업 체크리스트 `setup:{ accounts, adMedia, rules, firstPublish }`**(v4 이름 · R1 이름 폐기) · 구독 장부 · 카드 · 인보이스 · 티켓 · 메모
 *   POST /api/ops-tenant-update { id, planKey?, status?, trialEndsAt?, note?, priceLockedKrw?, isInternal? }   (admin) — 정본 직접 수정(감사 high) · priceLockedKrw = 가입 시점 가격 고정(가격 개정이 못 건드림 · null 로 해제)
 *        isInternal = «내부 테스트» 손 표시(P1R7 §3.4) — 자동 규칙(우리 도메인·하니스 키)으로 켜진 것도 여기서 끌 수 있다(손이 이긴다 · 크론이 다시 켜지 않는다).
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
import { excludeInternalSelf, includeInternalOf } from "../../lib/ops/internal";
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
    createdAt: iso(r.created_at) ?? "", ownerEmail: r.owner_email ? String(r.owner_email) : null, isInternal: r.is_internal === true,
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
      const inc = includeInternalOf(url);   // [P1R7 §3.4] 기본 = 내부 테스트 집 제외
      const base: SQL = sql`(${s} = '' OR LOWER(t.name) LIKE ${"%" + s + "%"} OR LOWER(t.key) LIKE ${"%" + s + "%"} OR EXISTS (SELECT 1 FROM users u WHERE u.tenant_id = t.id AND LOWER(u.email) LIKE ${"%" + s + "%"}))
          AND (${status} = '' OR t.status = ${status}) AND (${plan} = '' OR t.plan_key = ${plan})`;
      const where: SQL = sql`${base}${excludeInternalSelf(sql`t`, inc)}`;
      const [cnt] = await q(sql`SELECT COUNT(*) AS c FROM tenants t WHERE ${where}`);
      const [hid] = await q(sql`SELECT COUNT(*)::int AS c FROM tenants t WHERE ${base} AND t.is_internal`);
      const rows = await q(sql`SELECT t.id, t.key, t.name, t.plan_key, t.status, t.trial_ends_at, t.created_at, t.ops_note, t.is_internal,
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
      return json({ ok: true, tenants: rows.map((r) => tenantRow(r, now)), total: n(cnt?.c), page, size, internal: { excluded: !inc, hidden: inc ? 0 : n(hid?.c) } });
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
      /* 🔴 [2026-09-19 수리 · 시나리오 B ③] 화면이 그리는 모양 그대로 — `{text, by, at}`.
         보조 SELECT 라 실패하면 **빈 배열로 계속**한다(CLAUDE §4.1 · DDL 0083 이 아직 안 걸린 순간에도 상세는 열려야 한다). */
      let notes: { text: string; by: string; at: string }[] = [];
      try {
        const nr = await q(sql`SELECT text, operator, created_at FROM ops_tenant_notes WHERE tenant_id = ${id} ORDER BY id DESC LIMIT 20`);
        notes = nr.map((r) => ({ text: String(r.text ?? ""), by: String(r.operator ?? "운영자"), at: iso(r.created_at) ?? "" }));
      } catch { notes = []; }
      // 광고 매체 = 수익 커넥터가 있거나 계정에 광고 식별자(애드포스트 미디어·애드센스 pub)가 붙어 있으면 «연결됨».
      const adMedia = sources.length > 0 || accounts.some((a) => { const m = (a.monetize && typeof a.monetize === "object" ? a.monetize : {}) as Record<string, unknown>; return !!(m.adpostMediaId || m.adsensePub || m.coupangPartnerId); });
      const setup = { accounts: accounts.length > 0, adMedia, rules: n(rules?.c) > 0, firstPublish: n(posts?.c) > 0 };
      const health = accounts.length ? Math.round(accounts.reduce((a, r) => a + n(r.health_score), 0) / accounts.length) : null;
      const body: Record<string, unknown> = {
        /* 🔴 [2026-09-19 수리 · 시나리오 B ④(상세)] **화면이 읽는 이름을 같이 싣는다.**
           실측으로 세 자리가 «서버는 보내는데 화면은 다른 이름을 읽어» 영원히 안 뜨고 있었다 —
             `coinsSplit`(화면) ↔ `coinDetail`(서버) · `slots.planned`(화면) ↔ `slots.upcoming`(서버) · `notes`(화면) ↔ `note`(서버).
           옛 이름은 **지우지 않는다**(다른 데서 읽을 수 있다 · 무회귀). 새 이름을 **더한다.** */
        ok: true, tenant: t, users, accounts: accounts.map(({ monetize: _m, ...rest }) => rest), runners,
        coins: coins.balance, coinDetail: coins, coinsSplit: coins,
        slots: { ...(slots as Record<string, unknown>), planned: n((slots as Record<string, unknown>)?.upcoming) },
        notes, audit, setup, sources,
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
      const b = await readJson<{ id?: number; planKey?: string; status?: string; trialEndsAt?: string; note?: string; priceLockedKrw?: number | null; isInternal?: boolean }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const plans = await loadPlans();
      if (b.planKey && !plans.find((p) => p.key === b.planKey)) return badRequest("없는 플랜이에요.", "plan");
      if (b.status && !TENANT_STATUSES.includes(b.status)) return badRequest("status");
      const trialIso = b.trialEndsAt ? utcDate(b.trialEndsAt)?.toISOString() ?? null : null;
      if (b.trialEndsAt && !trialIso) return badRequest("trialEndsAt");
      /* 🔴 파라미터에 **형을 붙인다**(`::text`·`::boolean`) — 안 붙이면 전부 NULL 로 들어올 때 42P18(«파라미터 형을 못 정한다»)로 터진다.
         2026-09-15 실측: `{ id, isInternal:false }` 만 보내면 나머지가 NULL 이 되어 이 UPDATE 가 통째로 실패했다(PITFALLS · ops-cs 와 같은 함정). */
      const st = b.status || null;
      await q(sql`UPDATE tenants SET
          plan_key = COALESCE(${b.planKey || null}::text, plan_key),
          status = COALESCE(${st}::text, status),
          readonly_at = CASE WHEN ${st}::text = 'readonly' THEN COALESCE(readonly_at, NOW()) WHEN ${st}::text IS NULL THEN readonly_at ELSE NULL END,
          suspended_at = CASE WHEN ${st}::text = 'suspended' THEN COALESCE(suspended_at, NOW()) WHEN ${st}::text IS NULL THEN suspended_at ELSE NULL END,
          trial_ends_at = COALESCE(${trialIso}::timestamptz AT TIME ZONE 'UTC', trial_ends_at),
          ops_note = COALESCE(${typeof b.note === "string" ? b.note.slice(0, 2000) : null}::text, ops_note),
          is_internal = COALESCE(${typeof b.isInternal === "boolean" ? b.isInternal : null}::boolean, is_internal),   -- 🔴 형 붙이지 않으면 42P18(파라미터 형 추론 불가 · PITFALLS)
          internal_manual_at = CASE WHEN ${typeof b.isInternal === "boolean" ? b.isInternal : null}::boolean IS NULL THEN internal_manual_at ELSE NOW() END,   -- 손이 이긴다(크론이 다시 안 켠다)
          updated_at = NOW() WHERE id = ${id}`);
      if (b.priceLockedKrw !== undefined) {   // 가격 고정(계약 §2.1 ops-plans «price_locked_krw 있는 테넌트는 유지») — 장부가 없으면(체험) 만들어 둔다
        const locked = b.priceLockedKrw === null ? null : Math.max(0, Math.floor(n(b.priceLockedKrw)));
        if (locked !== null && locked <= 0) return badRequest("priceLockedKrw 는 1원 이상이거나 null(해제)이에요.");
        await q(sql`INSERT INTO subscriptions (tenant_id, plan_key, status, cycle, period_start, period_end, price_locked_krw, updated_at)
          VALUES (${id}, ${b.planKey || sql`(SELECT plan_key FROM tenants WHERE id = ${id})`}, ${"pending"}, ${"month"}, NOW(), NOW(), ${locked}, NOW())
          ON CONFLICT (tenant_id) DO UPDATE SET price_locked_krw = EXCLUDED.price_locked_krw, updated_at = NOW()`);
      }
      await writeAudit({ tenantId: id, action: "ops_tenant_update", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { planKey: b.planKey, status: b.status, trialEndsAt: trialIso, note: b.note, priceLockedKrw: b.priceLockedKrw, isInternal: b.isInternal } });
      return json({ ok: true });
    }

    /* ── 코인 지급/회수(admin) ── */
    if (path.endsWith("/ops-coins-grant")) {
      const g = await requireAdmin(req, [...ADMIN]); if (!g.ok) return g.res;
      const b = await readJson<{ id?: number; coins?: number; reason?: string; idem?: string }>(req);
      const id = n(b.id); const coins = Math.trunc(n(b.coins));
      if (!id || !coins || Math.abs(coins) > 10_000) return badRequest("id·coins(±10,000 이내)");
      const reason = (b.reason || "운영자 지급").slice(0, 200);
      /* 🔴 [2026-09-19 수리 · 시나리오 B ④] **멱등 키가 «뜻»이 아니라 «시계»에서 나왔다.**
         옛 판은 `ops:<oid>:${Date.now()}` 라 **누를 때마다 다른 키**였다 — 같은 내용을 동시에 두 번 던지니
         22ms 차이로 **두 줄이 들어갔다**(150 → 210코인 · 실측). 원장 자체는 이미 멱등하다
         (`coin_ledger` 의 `(tenant_id, kind, ref, bucket)` ON CONFLICT DO NOTHING) — **키만 틀렸던 것**이다.
         같은 파일의 월 포함분은 처음부터 뜻으로 만든 키였다(`included:<tid>:2026-09`) — 그건 몇 번을 불러도 한 줄이다.
         고친 것 둘:
           ① 화면이 **시트를 열 때 만든 `idem`** 을 보내면 그것을 쓴다 — 더블클릭이든 재시도든 **같은 키**다.
           ② `idem` 이 없으면 **뜻으로 만든다** — 같은 운영자·같은 집·같은 수·같은 사유는 **1분 안에서 한 번**.
              (안전망이지 정답이 아니다. 뜻이 있어 한 번 더 주려면 1분 뒤이거나 사유를 달리 적으면 된다.) */
      const idem = String(b.idem ?? "").trim().slice(0, 64).replace(/[^A-Za-z0-9_-]/g, "");
      const minute = Math.floor(Date.now() / 60_000);
      const reasonKey = reason.replace(/\s+/g, " ").trim().slice(0, 40);
      const ref = idem ? `ops:${o.ops.oid}:${idem}` : `ops:${o.ops.oid}:${id}:${coins}:${reasonKey}:${minute}`;
      let applied = 0;
      let duplicate = false;
      if (coins > 0) { const r = await grant(id, coins, reason, o.ops.oid, ref); applied = r.granted; duplicate = r.ok && r.granted === 0; }
      else {
        // 회수는 포함분 잔량까지만(잔액을 음수로 만들지 않는다 · 충전분 회수는 환불 경로가 따로).
        const bal = await balance(id);
        applied = -Math.min(Math.abs(coins), Math.max(0, bal.included));
        /* 🔴 회수도 같은 자를 쓴다 — 여기는 `grant()` 를 안 지나므로 **ON CONFLICT 를 손으로** 적는다(없으면 두 번 빠진다). */
        if (applied) {
          const r = await q(sql`INSERT INTO coin_ledger (tenant_id, kind, bucket, delta, ref, reason, actor_id)
            VALUES (${id}, ${"revoke"}, ${"included"}, ${applied}, ${ref}, ${reason}, ${o.ops.oid})
            ON CONFLICT (tenant_id, kind, ref, bucket) WHERE ref IS NOT NULL DO NOTHING RETURNING id`);
          if (!r.length) { applied = 0; duplicate = true; }
        }
      }
      await writeAudit({ tenantId: id, action: "ops_coins_grant", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { requested: coins, applied, reason, duplicate } });
      const after = await balance(id);
      /* 🔴 «두 번째는 안 들어갔다»를 화면이 **말할 수 있게** 돌려준다 — 조용히 0 을 주면 운영자는 «또 들어갔나?» 싶어 또 누른다. */
      return json({ ok: true, applied, balance: after.balance, ...(duplicate ? { duplicate: true, message: "아까 넣은 것과 같아서 한 번만 들어갔어요." } : {}) });
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
      /* 🔴 [2026-09-19 수리 · 시나리오 B ②] **같은 플랜이면 구독 장부를 건드리지 않는다.**
         화면의 「플랜 · 상태」 시트는 상태만 바꿀 때도 이 손을 먼저 불렀다(플랜 칩 기본값 = 지금 플랜).
         그런데 아래 UPSERT 는 같은 플랜이어도 **`cancel_at_period_end=false` · `pending_plan_key=NULL` ·
         결제일 재설정**까지 한다 ⇒ 고객이 걸어 둔 **해지 예약이 조용히 풀려 다음 달에 또 결제됐다**(실측 증명).
         돈은 «아무것도 안 바뀌었을 때 아무것도 안 하는 것»이 기본이다. 청구(`charge:true`)는 뜻이 분명하니 지나간다. */
      if (b.charge !== true && planKey === String(t.plan_key)) {
        return json({ ok: true, charged: false, planKey, cycle, unchanged: true,
          error: null, message: "이미 같은 요금제예요 — 구독·결제일은 그대로 두었어요." });
      }
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

    /* ── 운영 메모(operator+) ──
       🔴 [2026-09-19 수리 · 시나리오 B ③] **옛 판은 메모를 잃고 있던 것까지 지웠다.**
         화면은 `{ id, text }` 를 보내는데 서버는 `b.note` 만 읽어 `note = ""` 가 됐고, 그걸로 `ops_note` 를 덮었다.
         그런데 응답은 `ok:true` — 시트가 닫히며 «저장됐다»는 모양이 된다. **오류 한 글자 안 떴다**(실측).
       고친 것 셋:
         ① **두 이름을 다 받는다**(`text` 가 화면의 말 · `note` 는 옛 계약) — 어느 쪽이 와도 저장된다.
         ② **빈 말로는 덮지 않는다** — 둘 다 없으면 400. 지우려면 뜻을 갖고 빈 문자열을 보내야 한다.
         ③ **쌓는다** — `ops_tenant_notes` 에 누가·언제와 함께 넣고(DDL 0083), `ops_note` 는 **최근 한 줄**로 같이 갱신(목록 미리보기 무회귀).
       🔴 감사에 **내용 앞머리**를 남긴다 — 옛 판은 `{length:0}` 뿐이라 «메모를 남겼다»는 기록만 있고 내용이 어디에도 없었다. */
    if (path.endsWith("/ops-tenant-note")) {
      const b = await readJson<{ id?: number; note?: string; text?: string }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const raw = b.text ?? b.note;
      if (typeof raw !== "string") return badRequest("메모를 적어 주세요.", "text");
      const note = raw.trim().slice(0, 2000);
      if (!note) return badRequest("메모를 적어 주세요.", "text");
      const at = new Date();
      await q(sql`INSERT INTO ops_tenant_notes (tenant_id, operator_id, operator, text, created_at)
                  VALUES (${id}, ${o.ops.oid}, ${String(o.ops.name || "운영자").slice(0, 120)}, ${note}, ${ts(at)})`);
      await q(sql`UPDATE tenants SET ops_note = ${note}, updated_at = NOW() WHERE id = ${id}`);
      await writeAudit({ tenantId: id, action: "ops_tenant_note", actorType: "operator", actorId: o.ops.oid, ip, detail: { length: note.length, head: note.slice(0, 120) } });
      return json({ ok: true, note, at: at.toISOString() });
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
