/**
 * GET /api/coins-balance — 코인 잔액(원장 합산) + 최근 내역. 계약 P1R1 §6.
 *   { ok:true, balance, included, purchased, recent:[{ kind, delta, item?, reason?, createdAt }] }
 */
import { json, jsonError } from "../../lib/response";
import { requireUser } from "../../lib/guards";
import { balance, recentLedger } from "../../lib/coin-ledger";
export const config = { path: "/api/coins-balance" };

export default async (req: Request): Promise<Response> => {
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  try {
    const b = await balance(auth.tid);
    const recent = (await recentLedger(auth.tid, 20)).map((r) => {
      const o: Record<string, unknown> = { kind: r.kind, delta: r.delta, createdAt: r.createdAt };
      if (r.item) o.item = r.item;
      if (r.reason) o.reason = r.reason;
      return o;
    });
    return json({ ok: true, balance: b.balance, included: b.included, purchased: b.purchased, recent });
  } catch (err) { return jsonError("coins_balance", err); }
};
