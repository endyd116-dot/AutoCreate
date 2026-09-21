/**
 * lib/billing/ai-cost-cap.ts — AI 원가 상한(계약 §1.5 · DESIGN §19 운영 · AM `ai-meter` 관례).
 *   `settings.aiCostCapKrwPerDay`(없으면 플랜 기본값 PLAN_CAP_KRW) · `ai_usage.cost_usd` 의 **오늘(KST)** 합 × 환율(R3 fxToKrw · env FX_USD_KRW).
 *   초과 → 생성 거부 + 고객 알림 1건/일 + **운영 이상치 알림**(audit risk high · ops 대시보드가 읽는다).
 *   🔴 환율이 없으면 «원가 미환산» — 상한을 **잴 수 없으므로 막지 않는다**(0 으로 접어 통과시키는 것과 다르다 — `fxMissing:true` 를 응답·감사에 남긴다 · §0.1).
 *   🔎 AM 원본: ../AutoMarketing/lib/ai-meter.ts (관례 이식 2026-09-14 · 상한은 AC 플랜별 KRW)
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { planOf } from "../plans";
import { fxToKrw } from "../revenue/common";

const n = (v: unknown) => Number(v || 0);
/** 플랜별 기본 일 상한(원). 운영센터가 tenants.settings.aiCostCapKrwPerDay 로 덮는다. */
export const PLAN_CAP_KRW: Readonly<Record<string, number>> = { trial: 3_000, starter: 5_000, pro: 20_000, agency: 60_000 };

export interface CapCheck { ok: boolean; usedKrw: number | null; capKrw: number; fxMissing: boolean; usedUsd: number }
export async function checkAiCostCap(tid: number): Promise<CapCheck> {
  const [t] = await q(sql`SELECT plan_key, settings->>'aiCostCapKrwPerDay' AS cap FROM tenants WHERE id = ${tid}`);
  const planKey = String(t?.plan_key ?? "trial");
  const plan = await planOf(planKey);
  const capKrw = Number.isFinite(n(t?.cap)) && n(t?.cap) > 0 ? Math.floor(n(t?.cap)) : (PLAN_CAP_KRW[plan.key] ?? PLAN_CAP_KRW.trial);
  const [u] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage WHERE tenant_id = ${tid}
    AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`);
  const usedUsd = Number(u?.usd || 0);
  const fx = fxToKrw(usedUsd, "USD", {});
  if (!fx) return { ok: true, usedKrw: null, capKrw, fxMissing: true, usedUsd };   // 잴 수 없다 → 막지 않는다(0 이 아니라 «미환산»)
  return { ok: fx.krw <= capKrw, usedKrw: fx.krw, capKrw, fxMissing: false, usedUsd };
}

/** 생성 진입에서 부른다. 초과면 `res`(429 · reason "ai_cost_cap") 를 돌려주고 알림·감사를 남긴다(하루 1건). */
export async function requireAiBudget(tid: number): Promise<{ ok: true; check: CapCheck } | { ok: false; check: CapCheck; error: string }> {
  const check = await checkAiCostCap(tid);
  if (check.ok) return { ok: true, check };
  const [dup] = await q(sql`SELECT 1 FROM notifications WHERE tenant_id = ${tid} AND kind = 'ai_cost_cap' AND created_at > NOW() - interval '20 hours' LIMIT 1`);
  if (!dup) {
    /* 🔴 [2026-09-21 B · 사장님 결재 «실패도 글처럼»] **실패한 몫이 상한을 먹기 시작했다.**
       그러면 손님은 «나는 세 편밖에 안 만들었는데 왜 다 썼지?» 가 된다 — 영문을 모른 채 막히는 것이 제일 나쁘다(§9 «또렷하게»).
       🔴 **있을 때만 말한다** — 실패분이 0 인 날은 문장이 **한 글자도 안 달라진다**(무회귀).
          없는 걸 «0원이에요» 라고 말하면 그것도 군말이다.
       🔴 그리고 **겁주거나 탓하지 않는다**(§3) — «고객님 때문에»도 «정지됩니다»도 아니고 **사실 한 줄**이다.
          이 질의가 실패해도 알림은 나가야 하므로 실패는 삼킨다(문구만 종전과 같아진다). */
    let failLine = "";
    try {
      const [f] = await q(sql`SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_usage
        WHERE tenant_id = ${tid} AND fail_kind IS NOT NULL
          AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul')::date = (NOW() AT TIME ZONE 'Asia/Seoul')::date`);
      const fx = fxToKrw(Number(f?.usd ?? 0), "USD", {});
      if (fx && fx.krw > 0) failLine = ` 이 가운데 만들다 실패해서 다시 시도한 몫이 ${fx.krw.toLocaleString("ko-KR")}원이에요.`;
    } catch { /* 못 쟀으면 그 줄을 빼고 간다 — 지어내지 않는다 */ }
    await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${tid}, ${"ai_cost_cap"}, ${"오늘 만들 수 있는 양을 다 썼어요"}, ${`오늘 AI 사용이 하루 상한(${check.capKrw.toLocaleString("ko-KR")}원)에 닿았어요.${failLine} 내일 다시 이어서 만들어요.`}, ${"/app/home.html"})`);
    await writeAudit({ tenantId: tid, action: "ai_cost_cap_hit", actorType: "system", riskLevel: "high", detail: { usedKrw: check.usedKrw, capKrw: check.capKrw, usedUsd: check.usedUsd } });
  }
  return { ok: false, check, error: `오늘 AI 사용 상한(${check.capKrw.toLocaleString("ko-KR")}원)에 닿았어요. 내일 다시 이어서 만들 수 있어요.` };
}
