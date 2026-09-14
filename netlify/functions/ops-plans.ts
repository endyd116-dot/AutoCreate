/**
 * 운영센터 · 요금제 메뉴(계약 §2.1 `ops-plans.ts` · §2.4(3) 행 모양 · DESIGN §11.4). 권한: **super_admin**(§0.2 — admin 은 요금제 불가).
 *   GET  /api/ops-plans                       → { ok, plans:[Plan], priceEvents:[PriceEvent] }   Plan 에 subscribers·mrrKrw 포함
 *   POST /api/ops-plans { key, name, priceMonthKrw, priceYearKrw?, …limits, features, public?, recommended? } → 신규 플랜(고객 0 이라 가격 직접) · 201
 *   POST /api/ops-plan-update { key, name?, maxAccounts?, coinsIncluded?, runnerDevices?, teamSeats?, maxRules?, horizonDays?, features?, public?, recommended?, requireCardBeforePublish? }
 *        🔴 가격 칸(priceMonthKrw/priceYearKrw)은 받지 않는다 → 400 step "price_gate" «가격은 가격 개정으로만» (기존 고객 고지 없이 바뀌는 길을 막는다).
 *   GET  /api/ops-coin-prices                 → { ok, packs:[{ id, krw, coins, bonusPct, oncePerTenant?, active }], table:{ blog, image, cardnews, video_15, video_30, video_60, persona, … } }
 *   POST /api/ops-coin-prices { packs?:[{ id, krw?, coins?, bonusPct?, oncePerTenant?, active? }], table?:{ item: coins } } → coin_price_overrides 오버레이(코드 기본값은 그대로) · 캐시 무효화
 *   POST /api/ops-price-event { planKey, newPriceKrw, newPriceYearKrw?, effectiveAt, noticeText } → 고지 발송 + 예약 · { ok, event, notified }
 *   POST /api/ops-price-event-cancel { id }
 */
import { sql } from "drizzle-orm";
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireAdmin } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { jsonb } from "../../lib/db-util";
import { loadPlans, type PlanDef } from "../../lib/plans";
import { PAID_PLANS } from "../../lib/subscription";
import { COIN_TABLE } from "../../lib/coin-table";
import { loadPacksAndTable, invalidatePackCache } from "../../lib/billing/packs";
import { applyDuePriceEvents, schedulePriceEvent, cancelPriceEvent, toPriceEventRow } from "../../lib/billing/price-events";

export const config = { path: ["/api/ops-plans", "/api/ops-plan-update", "/api/ops-coin-prices", "/api/ops-price-event", "/api/ops-price-event-cancel"] };
const n = (v: unknown) => Number(v || 0);
const FEATURE_KEYS = ["directorEdit", "autoSchedule", "failover", "managedRunner", "runnerRevenue", "teamApproval"] as const;
const LIMIT_KEYS = ["maxAccounts", "coinsIncluded", "runnerDevices", "teamSeats", "maxRules", "horizonDays"] as const;

/** PlanDef + 집계 → 계약 §2.4(3) Plan. */
function planRow(p: PlanDef, subscribers: number, mrrKrw: number): Record<string, unknown> {
  const f = p.features as unknown as Record<string, unknown>;
  return { key: p.key, name: p.name, priceMonthKrw: p.priceMonth, priceYearKrw: p.priceYear,
    maxAccounts: p.limits.maxAccounts, coinsIncluded: p.limits.coinsIncluded, runnerDevices: p.limits.runnerDevices, teamSeats: p.limits.teamSeats, maxRules: p.limits.maxRules ?? null, horizonDays: p.limits.horizonDays,
    features: { directorEdit: !!f.directorEdit, autoSchedule: !!f.autoSchedule, failover: !!f.failover, managedRunner: String(f.managedRunner ?? "no"), runnerRevenue: !!f.runnerRevenue, teamApproval: !!f.teamApproval },
    public: p.public, recommended: p.recommended, requireCardBeforePublish: f.requireCardBeforePublish === true, sort: p.sort, subscribers, mrrKrw };
}
function parseLimits(b: Record<string, unknown>, base: PlanDef["limits"]): { ok: true; limits: PlanDef["limits"] } | { ok: false; error: string } {
  const limits = { ...base };
  for (const k of LIMIT_KEYS) {
    if (b[k] === undefined) continue;
    if (k === "maxRules" && b[k] === null) { limits.maxRules = null; continue; }
    const v = Math.floor(n(b[k])); if (!Number.isFinite(v) || v < 0 || v > 100_000) return { ok: false, error: `${k} 값이 이상해요.` };
    (limits as unknown as Record<string, number>)[k] = v;
  }
  if (limits.horizonDays < 1) return { ok: false, error: "horizonDays 는 1 이상이에요." };
  return { ok: true, limits };
}
function parseFeatures(b: Record<string, unknown>, base: Record<string, unknown>): Record<string, unknown> {
  const f = { ...base };
  const src = (b.features && typeof b.features === "object" && !Array.isArray(b.features) ? b.features : {}) as Record<string, unknown>;
  for (const k of FEATURE_KEYS) {
    if (src[k] === undefined) continue;
    if (k === "managedRunner") f[k] = ["no", "option", "included"].includes(String(src[k])) ? String(src[k]) : "no";
    else f[k] = src[k] === true;
  }
  if (b.requireCardBeforePublish !== undefined) f.requireCardBeforePublish = b.requireCardBeforePublish === true;
  return f;
}

export default async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
  const o = requireAdmin(req, ["super_admin"]); if (!o.ok) return o.res;
  const ip = clientIp(req);
  try {
    /* ── 코인 팩·단가 ── */
    if (path.endsWith("/ops-coin-prices")) {
      if (req.method === "GET") {
        const { packs, table } = await loadPacksAndTable(true);
        return json({ ok: true, packs: packs.map((p) => ({ id: p.id, krw: p.krw, coins: p.coins, bonusPct: p.bonusPct, ...(p.oncePerTenant ? { oncePerTenant: true } : {}), active: p.active })), table, defaults: { table: COIN_TABLE } });
      }
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<{ packs?: Record<string, unknown>[]; table?: Record<string, unknown> }>(req);
      const changed: string[] = [];
      for (const p of Array.isArray(b.packs) ? b.packs : []) {
        const id = String(p.id ?? "").trim().replace(/[^a-z0-9_]/g, "").slice(0, 24); if (!id) continue;
        const value: Record<string, unknown> = {};
        if (p.krw !== undefined) { const v = Math.floor(n(p.krw)); if (v <= 0) return badRequest(`${id}: 가격은 1원 이상이에요.`); value.krw = v; }
        if (p.coins !== undefined) { const v = Math.floor(n(p.coins)); if (v <= 0) return badRequest(`${id}: 코인은 1 이상이에요.`); value.coins = v; }
        if (p.bonusPct !== undefined) value.bonusPct = Math.max(0, Math.floor(n(p.bonusPct)));
        if (typeof p.oncePerTenant === "boolean") value.oncePerTenant = p.oncePerTenant;
        const active = p.active !== false;
        value.active = active;
        await q(sql`INSERT INTO coin_price_overrides (key, kind, value, active, updated_by, updated_at) VALUES (${`pack:${id}`}, ${"pack"}, ${jsonb(value)}, ${active}, ${o.ops.oid}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = coin_price_overrides.value || EXCLUDED.value, active = EXCLUDED.active, updated_by = EXCLUDED.updated_by, updated_at = NOW()`);
        changed.push(`pack:${id}`);
      }
      const table = (b.table && typeof b.table === "object" && !Array.isArray(b.table) ? b.table : {}) as Record<string, unknown>;
      for (const [item, coins] of Object.entries(table)) {
        if (!(item in COIN_TABLE)) return badRequest(`${item}: 단가표에 없는 항목이에요.`);
        const v = Math.floor(n(coins)); if (v < 0 || v > 10_000) return badRequest(`${item}: 코인 수가 이상해요.`);
        await q(sql`INSERT INTO coin_price_overrides (key, kind, value, active, updated_by, updated_at) VALUES (${`item:${item}`}, ${"item"}, ${jsonb({ coins: v })}, true, ${o.ops.oid}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, active = true, updated_by = EXCLUDED.updated_by, updated_at = NOW()`);
        changed.push(`item:${item}`);
      }
      if (changed.length) {
        const [chk] = await q(sql`SELECT COUNT(*) FILTER (WHERE jsonb_typeof(value) <> 'object') AS bad FROM coin_price_overrides`);
        if (n(chk?.bad)) console.error("[ops-plans] coin_price_overrides jsonb_typeof 이상", chk);   // PITFALLS #1
      }
      invalidatePackCache();
      await writeAudit({ tenantId: null, action: "ops_coin_prices_update", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", detail: { changed, packs: b.packs, table } });
      const after = await loadPacksAndTable(true);
      return json({ ok: true, changed, packs: after.packs, table: after.table });
    }

    /* ── 가격 개정 ── */
    if (path.endsWith("/ops-price-event")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<{ planKey?: string; newPriceKrw?: number; newPriceYearKrw?: number | null; effectiveAt?: string; noticeText?: string }>(req);
      const r = await schedulePriceEvent({ planKey: String(b.planKey ?? ""), newPriceKrw: n(b.newPriceKrw), newPriceYearKrw: b.newPriceYearKrw ?? null, effectiveAt: String(b.effectiveAt ?? ""), noticeText: String(b.noticeText ?? ""), operatorId: o.ops.oid });
      if (!r.ok) return json({ ok: false, step: r.step, error: r.error }, 400);
      return json({ ok: true, event: r.event, notified: r.notified }, 201);
    }
    if (path.endsWith("/ops-price-event-cancel")) {
      if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
      const b = await readJson<{ id?: number }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      const r = await cancelPriceEvent(id, o.ops.oid);
      return r.ok ? json({ ok: true }) : json({ ok: false, error: r.error, step: "state" }, 400);
    }

    /* ── 플랜 목록 ── */
    if (path.endsWith("/ops-plans") && req.method === "GET") {
      await applyDuePriceEvents();   // 적용일이 지난 개정을 표시가에 반영(멱등)
      const plans = await loadPlans();
      const agg = await q(sql`SELECT t.plan_key, COUNT(*) AS c, COALESCE(SUM(CASE WHEN s.cycle = 'year' THEN COALESCE(s.price_locked_krw, p.price_year) / 12.0 ELSE COALESCE(s.price_locked_krw, p.price_month) END
          * (100 - CASE WHEN s.discount_pct > 0 AND (s.discount_until IS NULL OR s.discount_until > NOW()) THEN s.discount_pct ELSE 0 END) / 100.0), 0) AS mrr
        FROM tenants t LEFT JOIN subscriptions s ON s.tenant_id = t.id LEFT JOIN plans p ON p.key = t.plan_key WHERE t.status = 'active' GROUP BY t.plan_key`);
      const aggOf = new Map(agg.map((r) => [String(r.plan_key), { c: n(r.c), mrr: Math.round(n(r.mrr)) }]));
      const [trialCount] = await q(sql`SELECT COUNT(*) AS c FROM tenants WHERE status = 'trial'`);
      const rows = plans.map((p) => planRow(p, p.key === "trial" ? n(trialCount?.c) : (aggOf.get(p.key)?.c ?? 0), PAID_PLANS.has(p.key) ? (aggOf.get(p.key)?.mrr ?? 0) : 0));
      const events = await q(sql`SELECT * FROM plan_price_events ORDER BY id DESC LIMIT 50`);
      return json({ ok: true, plans: rows, priceEvents: events.map(toPriceEventRow) });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<Record<string, unknown>>(req);
    const key = String(b.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 32);
    if (!key) return badRequest("key");
    const plans = await loadPlans();
    const cur = plans.find((p) => p.key === key);

    /* ── 신규 플랜 ── */
    if (path.endsWith("/ops-plans")) {
      if (cur) return badRequest("이미 있는 플랜 key 예요. 수정은 ops-plan-update 로.", "exists");
      const name = String(b.name ?? "").trim().slice(0, 60); if (!name) return badRequest("name");
      const pm = Math.floor(n(b.priceMonthKrw)); if (pm < 0) return badRequest("priceMonthKrw");
      const py = b.priceYearKrw !== undefined ? Math.floor(n(b.priceYearKrw)) : pm * 10;
      const base = plans.find((p) => p.key === "pro") ?? plans[0];
      const lim = parseLimits(b, base.limits); if (!lim.ok) return badRequest(lim.error);
      const feat = parseFeatures(b, base.features as unknown as Record<string, unknown>);
      const sort = b.sort !== undefined ? Math.floor(n(b.sort)) : (Math.max(0, ...plans.map((p) => p.sort)) + 1);
      await q(sql`INSERT INTO plans (key, name, price_month, price_year, limits, features, public, recommended, sort) VALUES (${key}, ${name}, ${pm}, ${py}, ${jsonb(lim.limits)}, ${jsonb(feat)}, ${b.public === true}, ${b.recommended === true}, ${sort})`);
      await writeAudit({ tenantId: null, action: "ops_plan_create", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", target: `plan:${key}`, detail: { name, priceMonth: pm, priceYear: py, limits: lim.limits, features: feat } });
      const p = (await loadPlans()).find((x) => x.key === key)!;
      return json({ ok: true, plan: planRow(p, 0, 0) }, 201);
    }

    /* ── 플랜 수정(가격 제외) ── */
    if (path.endsWith("/ops-plan-update")) {
      if (!cur) return json({ ok: false, error: "없는 플랜이에요.", step: "plan" }, 404);
      if (b.priceMonthKrw !== undefined || b.priceYearKrw !== undefined) return json({ ok: false, step: "price_gate", error: "가격은 «가격 개정»(고지 → 적용일)으로만 바꿀 수 있어요." }, 400);
      const name = b.name !== undefined ? String(b.name).trim().slice(0, 60) : cur.name; if (!name) return badRequest("name");
      const lim = parseLimits(b, cur.limits); if (!lim.ok) return badRequest(lim.error);
      const feat = parseFeatures(b, cur.features as unknown as Record<string, unknown>);
      const pub = b.public !== undefined ? b.public === true : cur.public;
      const rec = b.recommended !== undefined ? b.recommended === true : cur.recommended;
      const sort = b.sort !== undefined ? Math.floor(n(b.sort)) : cur.sort;
      await q(sql`UPDATE plans SET name = ${name}, limits = ${jsonb(lim.limits)}, features = ${jsonb(feat)}, public = ${pub}, recommended = ${rec}, sort = ${sort}, updated_at = NOW() WHERE key = ${key}`);
      const [chk] = await q(sql`SELECT jsonb_typeof(limits) AS l, jsonb_typeof(features) AS f FROM plans WHERE key = ${key}`);
      if (chk && (chk.l !== "object" || chk.f !== "object")) console.error("[ops-plans] plans jsonb_typeof 이상", chk);   // PITFALLS #1
      await writeAudit({ tenantId: null, action: "ops_plan_update", actorType: "operator", actorId: o.ops.oid, ip, riskLevel: "high", target: `plan:${key}`, detail: { before: { name: cur.name, limits: cur.limits, features: cur.features, public: cur.public, recommended: cur.recommended }, after: { name, limits: lim.limits, features: feat, public: pub, recommended: rec } } });
      const p = (await loadPlans()).find((x) => x.key === key)!;
      return json({ ok: true, plan: planRow(p, 0, 0) });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("ops_plans", err); }
};
