/**
 * 계정 슬롯(«계정 1개 + 전용 IP» 30일권 · 계약 P1R7 §3.6 · 사장님 지시 2026-09-15). 고객 본인만(원격접속 중 구매 금지).
 *   GET  /api/account-slots                          → { ok, slots:[SlotView], offers:[{ kind, coins, krw, days, label, desc, managed }], balance, includedAccounts, usedAccounts, canAddNow }
 *   POST /api/account-slot-buy { kind, count? }      → { ok, slots, balance, waitingIp } · 400 step:"coins"(need·balance) | "kind" | "count"
 *   POST /api/account-slot-renew { id, autoRenew }   → { ok, slot }   자동 갱신 끄기/켜기(환불 없음 · 다음 갱신만)
 *   🔴 없는 걸 팔지 않는다: 구매 시점엔 차감 0 — 계정을 붙이면 B2 `assignProxy` 가 IP 를 주고 **그날** 첫 30일치가 빠진다(재고 없으면 «IP 준비 중» · 크론이 매일 다시 묻는다).
 *      구매 때 첫 30일치 잔액은 있어야 한다(검사만) — 코인 0 으로 «준비 중» 계정을 무한정 쓰는 구멍 방지.
 *   🔴 값(24·50코인)은 서버가 준다 — 화면에 숫자를 적지 않는다(lib/plans.ts ACCOUNT_SLOT_PRODUCTS · 원가 근거 proxy-cost.md).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, denyIfImpersonating, requireWritable } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";
import { balance } from "../../lib/coin-ledger";
import { accountSlotOffers, tenantPlan } from "../../lib/plans";
import { listSlots, buyAccountSlots, setSlotAutoRenew, activeSlotCount } from "../../lib/account-slots";

export const config = { path: ["/api/account-slots", "/api/account-slot-buy", "/api/account-slot-renew"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");
const n = (v: unknown) => Number(v || 0);

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const tid = auth.tid; const uid = Number(auth.user.uid);
  try {
    if (path.endsWith("/account-slots")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const [slots, bal, { plan }, slotsNow] = await Promise.all([listSlots(tid), balance(tid), tenantPlan(tid), activeSlotCount(tid)]);
      const [used] = await q(sql`SELECT COUNT(*)::int AS c FROM accounts WHERE tenant_id = ${tid} AND COALESCE(last_error_kind,'') <> 'removed'`);
      const includedAccounts = n(plan.limits.maxAccounts);
      return json({ ok: true, slots, offers: accountSlotOffers(), balance: bal.balance,
        includedAccounts, extraSlots: slotsNow, usedAccounts: n(used?.c), canAddNow: n(used?.c) < includedAccounts + slotsNow,
        note: "남은 기간 환불은 없어요. 다음 갱신만 끌 수 있어요." });
    }
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const imp = denyIfImpersonating(auth.user); if (imp) return json({ ok: false, error: "원격접속 중에는 살 수 없어요.", step: "impersonation", gated: true }, 403);

    if (path.endsWith("/account-slot-buy")) {
      const w = await requireWritable(tid); if (!w.ok) return w.res;
      const b = await readJson<{ kind?: unknown; count?: unknown }>(req);
      const r = await buyAccountSlots(tid, b.kind, b.count ?? 1, uid);
      if (!r.ok) return json({ ok: false, error: r.error, step: r.step, ...(r.need !== undefined ? { need: r.need } : {}), ...(r.balance !== undefined ? { balance: r.balance } : {}) }, 400);
      return json({ ok: true, slots: r.slots, balance: r.balance, waitingIp: r.waitingIp }, 201);
    }
    if (path.endsWith("/account-slot-renew")) {
      const b = await readJson<{ id?: unknown; autoRenew?: unknown }>(req);
      const id = n(b.id); if (!id) return badRequest("id");
      if (typeof b.autoRenew !== "boolean") return badRequest("autoRenew");
      const r = await setSlotAutoRenew(tid, id, b.autoRenew, uid);
      if (!r.ok) return json({ ok: false, error: r.error, step: "not_found" }, 404);
      return json({ ok: true, slot: r.slot });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("account_slots", err); }
};
