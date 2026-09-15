/**
 * POST /api/coin-transfer { coins } → { ok, coins, balance, amOrderNo, expiresAt }   (계약 P1R6 §1.4 · 화면 public/app/coins.html «코인 가져오기»)
 *   AM 에 차감 요청(lib/am-bridge.ts amDebit) → 성공하면 AC 원장 transferIn(kind transfer · purchased · +365일 · ref `transfer:AM:{amOrderNo}` 멱등) → 감사 `coin_transfer_in`.
 *   🔴 키 없으면 200 { ok:false, step:"not_configured" }(화면 «준비 중» 시트) · 원격접속 중 403 { gated:true }(화면이 시트를 닫는다) · 실패 시 AC 에 아무것도 남기지 않는다.
 *   🔴 부분 성공 금지: AM 은 뺐는데 AC 기입이 실패하면 amCancel 로 되돌리고(최선 노력) 감사 high + CS 티켓 — 사람이 맞춘다.
 *   범위: 1회 1~1,000코인 · 정수 · 같은 테넌트 동시 요청은 각각 다른 requestId(AM 쪽 멱등은 requestId · AC 쪽은 amOrderNo).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser, denyIfImpersonating } from "../../lib/guards";
import { clientIp } from "../../lib/auth";
import { writeAudit } from "../../lib/audit";
import { q } from "../../lib/accounts";
import { sql } from "drizzle-orm";
import { transferIn } from "../../lib/coin-ledger";
import { amDebit, amCancel, isAmBridgeConfigured } from "../../lib/am-bridge";
import { createTicket } from "../../lib/cs";

export const config = { path: "/api/coin-transfer" };
const MAX_PER_REQUEST = 1000;

export default async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = requireUser(req); if (!auth.ok) return auth.res;
  const imp = denyIfImpersonating(auth.user); if (imp) return json({ ok: false, error: "원격접속 중에는 코인을 옮길 수 없어요.", step: "impersonation", gated: true }, 403);
  const tid = auth.tid; const uid = Number(auth.user.uid); const ip = clientIp(req);
  try {
    const b = await readJson<{ coins?: unknown }>(req);
    const coins = Math.floor(Number(b.coins));
    if (!Number.isFinite(coins) || coins <= 0) return badRequest("옮길 코인 수를 적어 주세요.", "coins");
    if (coins > MAX_PER_REQUEST) return badRequest(`한 번에 ${MAX_PER_REQUEST.toLocaleString("ko-KR")}코인까지 옮길 수 있어요.`, "coins");
    if (!isAmBridgeConfigured()) return json({ ok: false, step: "not_configured", error: "아직 준비 중이에요" });
    const [t] = await q(sql`SELECT t.key, (SELECT u.email FROM users u WHERE u.tenant_id = t.id AND u.role = 'owner' ORDER BY u.id LIMIT 1) AS email FROM tenants t WHERE t.id = ${tid}`);
    if (!t) return json({ ok: false, error: "계정을 찾을 수 없어요.", step: "tenant" }, 404);

    // ① AM 차감 — 실패면 여기서 끝(AC 흔적 0 · 감사만).
    const d = await amDebit({ acTenantKey: String(t.key), email: t.email ? String(t.email) : null, coins });
    if (!d.ok) {
      await writeAudit({ tenantId: tid, action: "coin_transfer_in_denied", actorType: "user", actorId: uid, ip, detail: { coins, step: d.step, error: d.error, requestId: d.requestId } });
      return json({ ok: false, step: d.step, error: d.error }, d.step === "network" ? 502 : 400);
    }
    // ② AC 기입(멱등 ref) — 실패면 되돌린다.
    const ref = `transfer:AM:${d.amOrderNo}`;
    const g = await transferIn(tid, d.debited, ref, "AM", { actorId: uid });
    if (!g.ok) {
      const c = await amCancel({ requestId: d.requestId, amOrderNo: d.amOrderNo });
      await writeAudit({ tenantId: tid, action: "coin_transfer_in_failed", actorType: "user", actorId: uid, ip, riskLevel: "high", target: `am:${d.amOrderNo}`, detail: { coins: d.debited, ref, error: g.error ?? null, cancelled: c.ok, cancelError: c.error ?? null, requestId: d.requestId } });
      if (!c.ok) await createTicket({ tenantId: tid, subject: `코인 이전 불일치 — AM 차감 ${d.debited} · AC 기입 실패(${d.amOrderNo})`, text: `AM 주문 ${d.amOrderNo} 는 빠졌는데 AC 원장 기입이 실패했고 되돌림도 안 됐어요(${c.error ?? "-"}). 사람이 맞춰 주세요.`, source: "system", priority: "urgent", tags: ["코인", "이전"], autoKey: `coin_transfer:${d.amOrderNo}` });
      return json({ ok: false, step: "ledger", error: c.ok ? "옮기지 못했어요 · 저쪽 코인은 그대로예요. 잠시 뒤 다시 해 주세요." : "옮기는 중에 문제가 생겼어요 · 확인해서 맞춰 드릴게요." }, 500);
    }
    await writeAudit({ tenantId: tid, action: "coin_transfer_in", actorType: "user", actorId: uid, ip, target: `am:${d.amOrderNo}`, detail: { coins: d.debited, requested: coins, ref, already: g.already, granted: g.granted, balance: g.balance, remainingAm: d.remaining, expiresAt: g.expiresAt, requestId: d.requestId } });
    return json({ ok: true, coins: g.granted || d.debited, balance: g.balance, amOrderNo: d.amOrderNo, expiresAt: g.expiresAt, already: g.already });
  } catch (err) { return jsonError("coin_transfer", err); }
};
