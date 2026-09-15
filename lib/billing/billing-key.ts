/**
 * lib/billing/billing-key.ts — 결제 수단(빌링키) 등록·해제 + 카드 지문(계약 §1.2·§1.3 · DESIGN §12.3 재가입 남용).
 *   KICC 흐름(AM lib/kicc.ts 헤더): registerTrade({isBillingKey:true}) → authPageUrl(인증창) → 콜백 approveTrade(authorizationId) → billKey.
 *   AM 원본: ../AutoMarketing/netlify/functions/billing-key-return.ts(콜백 되파싱 관례) (이식 2026-09-14 · 표는 AC billing_keys)
 *
 *   ══ 카드 지문(card_fp) ══
 *     KICC 가 주는 마스킹 카드번호(`cardNumberMasked`)의 sha256 — 같은 카드로 체험을 두 번 쓰는 것을 막는 열쇠(§12.3).
 *     빌키 등록 시 다른 테넌트의 `trial_fp` 와 같으면 **이 테넌트의 체험을 즉시 끝낸다**(trial_ends_at = now · 알림 «이미 체험을 쓰셨어요»). 카드번호 자체는 어디에도 남기지 않는다.
 *   주문번호 `AC-BK-{tid}-{base36}`(인증 라인) · **`AC-BKK-…`(비인증 라인)** — 콜백엔 세션이 없고 빌키 행도 아직 없어서, 어느 MID 로 등록했는지를 **주문번호가 스스로 말한다**(승인은 같은 MID 여야 한다 · KICC 규칙).
 *   발급된 MID 는 `billing_keys.pg_mid` 에 남긴다 — 청구·삭제가 그 MID 로만 되기 때문(§1.6).
 */
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { tenantOwner } from "../subscription";
import type { PayRoute } from "../kicc";

const n = (v: unknown) => Number(v || 0);
/**
 * 주문번호가 **라인과 용도를 말한다**(콜백엔 세션도 빌키 행도 없다):
 *   `AC-BK-{tid}-{b36}`(인증) · `AC-BKK-…`(비인증) · 끝에 **`-p`** 면 **확인용 주문**(개통 실측 · 결과를 리다이렉트 대신 JSON 으로 돌려준다).
 */
export const bkOrderNo = (tid: number, route: PayRoute = "auth", nowMs = Date.now(), probe = false) => `AC-BK${route === "keyin" ? "K" : ""}-${tid}-${nowMs.toString(36)}${probe ? "-p" : ""}`;
export function parseBkOrder(orderNo: string): { tenantId: number; route: PayRoute; probe: boolean } | null {
  const m = /^AC-BK(K?)-(\d{1,12})-[0-9a-z]+(-p)?$/.exec(String(orderNo ?? "").trim());
  return m ? { tenantId: Number(m[2]), route: m[1] === "K" ? "keyin" : "auth", probe: !!m[3] } : null;
}
export function parseBkOrderNo(orderNo: string): number | null { return parseBkOrder(orderNo)?.tenantId ?? null; }
export function cardFingerprint(masked: string | null | undefined): string | null {
  const s = String(masked ?? "").replace(/\s|-/g, "");
  return s.length >= 8 ? createHash("sha256").update(s).digest("hex") : null;
}

export type StartKeyResult = { ok: true; orderNo: string; url: string; form: Record<string, string> } | { ok: false; step: "not_configured" | "register"; error: string };
export async function startBillingKey(tid: number, opts: { userAgent?: string | null; returnBase?: string; route?: PayRoute; probe?: boolean }): Promise<StartKeyResult> {
  const { isKiccConfigured, registerTrade, deviceTypeFromUA } = await import("../kicc");
  if (!isKiccConfigured()) return { ok: false, step: "not_configured", error: "결제 준비 중이에요 · 곧 열려요" };
  const route: PayRoute = opts.route === "keyin" ? "keyin" : "auth";   // 판정은 lib/pay-route.ts resolvePayRoute 한 곳
  const owner = await tenantOwner(tid);
  const orderNo = bkOrderNo(tid, route, Date.now(), opts.probe === true);   // probe = 개통 실측용(결과를 화면에 바로 보여 준다)
  const base = (opts.returnBase || process.env.SITE_URL || "").replace(/\/$/, "");
  const r = await registerTrade({ shopOrderNo: orderNo, amount: 0, goodsName: "결제 수단 등록", isBillingKey: true, returnUrl: `${base}/api/billing-key-return`, customerName: owner.name, customerEmail: owner.email ?? undefined, deviceTypeCode: deviceTypeFromUA(opts.userAgent), route });
  if (!r.success || !r.authPageUrl) return { ok: false, step: "register", error: r.errorMessage || "카드 등록창을 열지 못했어요." };
  return { ok: true, orderNo, url: r.authPageUrl, form: {} };
}

export type ApproveKeyResult = { ok: true; tenantId: number; last4: string | null; brand: string | null; trialEndedByFp: boolean } | { ok: false; tenantId?: number; reason: string };
/** 콜백 — 빌키 저장(기존 키는 비활성) + 카드 지문 + 재가입 남용 판정. */
export async function approveBillingKey(authorizationId: string, orderNo: string): Promise<ApproveKeyResult> {
  const parsed = parseBkOrder(orderNo);
  if (!parsed) return { ok: false, reason: "bad_order_no" };
  const tid = parsed.tenantId;
  const { approveTrade } = await import("../kicc");
  const a = await approveTrade({ authorizationId, shopOrderNo: orderNo, route: parsed.route });   // 승인은 등록과 같은 MID 로(KICC 규칙)
  if (!a.success || !a.billKey) {
    await writeAudit({ tenantId: tid, action: "billing_key_failed", actorType: "system", riskLevel: "medium", detail: { errorCode: a.errorCode ?? null, error: a.errorMessage ?? null } });
    return { ok: false, tenantId: tid, reason: a.errorMessage || a.errorCode || "approve_failed" };
  }
  const fp = cardFingerprint(a.cardNumberMasked);
  const last4 = String(a.cardNumberMasked ?? "").replace(/\D/g, "").slice(-4) || null;
  const brand = a.cardCompany ? String(a.cardCompany).slice(0, 40) : null;
  await q(sql`UPDATE billing_keys SET active = false, removed_at = NOW() WHERE tenant_id = ${tid} AND active = true`);
  await q(sql`INSERT INTO billing_keys (tenant_id, billing_key, card_label, active, card_fp, last4, brand, pg_mid) VALUES (${tid}, ${String(a.billKey)}, ${brand && last4 ? `${brand} ${last4}` : last4}, true, ${fp}, ${last4}, ${brand}, ${a.mallId ?? null})`);
  await q(sql`UPDATE subscriptions SET billing_key_missing_at = NULL, updated_at = NOW() WHERE tenant_id = ${tid}`);
  // 재가입 남용(§12.3): 다른 집이 같은 카드로 체험을 썼으면 이 집의 체험은 지금 끝난다.
  let trialEndedByFp = false;
  if (fp) {
    const [other] = await q(sql`SELECT id FROM tenants WHERE trial_fp = ${fp} AND id <> ${tid} LIMIT 1`);
    const [me] = await q(sql`SELECT status FROM tenants WHERE id = ${tid}`);
    if (other && String(me?.status) === "trial") {
      await q(sql`UPDATE tenants SET trial_ends_at = NOW(), trial_fp = ${fp}, updated_at = NOW() WHERE id = ${tid}`);
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"trial_reused"}, ${"이미 체험을 쓰셨어요"}, ${"이 카드로 체험을 이미 쓰신 적이 있어요. 요금제를 고르면 바로 이어서 할 수 있어요."}, ${"/app/plan.html"})`);
      trialEndedByFp = true;
    } else {
      await q(sql`UPDATE tenants SET trial_fp = COALESCE(trial_fp, ${fp}), updated_at = NOW() WHERE id = ${tid}`);
    }
  }
  // 🔴 감사에 MID 값 자체는 남기지 않는다(env 비밀) — 라인 이름만.
  await writeAudit({ tenantId: tid, action: "billing_key_registered", actorType: "system", target: `tenant:${tid}`, detail: { brand, last4, hasFp: !!fp, trialEndedByFp, route: parsed.route, cardBizGubun: a.cardBizGubun ?? null } });
  return { ok: true, tenantId: tid, last4, brand, trialEndedByFp };
}

export async function removeBillingKeyOf(tid: number, actorId: number | null): Promise<{ ok: boolean; removed: boolean }> {
  const [k] = await q(sql`SELECT id, billing_key, pg_mid FROM billing_keys WHERE tenant_id = ${tid} AND active = true AND removed_at IS NULL ORDER BY id DESC LIMIT 1`);
  if (!k) return { ok: true, removed: false };
  // 빌키 삭제도 **발급한 MID** 로만(KICC 규칙) — 옛 행(pg_mid NULL)은 midOrDefault 가 인증 MID 로 폴백.
  try { const { isKiccConfigured, removeBillingKey } = await import("../kicc"); if (isKiccConfigured()) await removeBillingKey({ billingKey: String(k.billing_key), mid: k.pg_mid ? String(k.pg_mid) : null }); } catch { /* PG 쪽 삭제 실패는 비치명 — 우리 쪽에서 비활성 */ }
  await q(sql`UPDATE billing_keys SET active = false, removed_at = NOW() WHERE id = ${n(k.id)}`);
  await q(sql`UPDATE subscriptions SET billing_key_missing_at = NOW(), updated_at = NOW() WHERE tenant_id = ${tid} AND status = 'active'`);
  await writeAudit({ tenantId: tid, action: "billing_key_removed", actorType: actorId ? "user" : "operator", actorId, target: `tenant:${tid}` });
  return { ok: true, removed: true };
}
