/**
 * lib/cron/coin-reconcile.ts — 스텝 `coin.reconcile`(P1R7 B3 · 전수조사 §3.3 «AM coin-reconcile 미이식»).
 *   **주 1회**(월요일 KST 06:00) 코인 원장을 대조하고, **어긋난 행이 있을 때만** 운영 감사에 남긴다. 0건이면 조용하다.
 *
 *   ══ 왜 크론인가 ══
 *     스크립트만 있으면 아무도 안 돌린다. 원장이 어긋나는 사고(차감 두 번·돈 받고 코인 미지급)는 **고객이 먼저 알아채고 문의로 온다** —
 *     그때는 이미 신뢰가 깎인 뒤다. 주 1회면 «다음 주 안에는 우리가 먼저 안다».
 *
 *   ══ 규율 ══
 *     · 판정기는 `lib/coin-reconcile.ts` **한 벌**(사람이 돌리는 스크립트와 같은 함수 · 두 벌이면 말이 갈린다).
 *     · **읽기만** 한다 — 고치지 않는다(원장 행을 지우면 추적이 끊긴다 · 무엇을 할지는 사람이 정한다).
 *     · 전역 스텝인데 우산은 테넌트마다 run() 을 부른다 → `ops_settings` 에 **주 1회 잠금**(원자적 선점)으로 첫 호출만 실제 대조.
 *     · 조용한 0건 금지의 **반대쪽**도 지킨다: 0건이면 감사를 남기지 않는다(매주 «이상 없음» 로그가 쌓이면 진짜 신호가 묻힌다).
 *       대신 스텝 반환값(detail)에는 항상 실행 사실이 남는다(크론 콘솔·`cron_tick` 감사).
 *   🔎 출처: AC 신규(계약 R7-B3 5 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { jsonb } from "../db-util";
import { reconcileCoins, RECONCILE_LABEL, type ReconcileKind } from "../coin-reconcile";
import { kstHour, kstToday, type CronStep, type TenantCtx, type StepOutcome, NOOP } from "./base";

/** 대조 시각(KST) · 요일(0=일 … 1=월) — 🔴 로컬 검증 손잡이(`CRON_FORCE_RECONCILE=1` 은 **수동 호출일 때만** 듣는다). */
const RUN_HOUR = Math.max(0, Math.min(23, Number(process.env.COIN_RECONCILE_HOUR ?? 6)));
const RUN_WEEKDAY = 1;
const FORCE = process.env.CRON_FORCE_RECONCILE === "1";

/** KST 요일(0=일). DB 를 타지 않는 순수 산술(+9h) — `kstHour` 와 같은 눈금. */
function kstWeekday(now: Date): number { return new Date(now.getTime() + 9 * 3600_000).getUTCDay(); }

export const coinReconcileStep: CronStep = {
  key: "coin.reconcile",
  every: "hourly",
  needsAutoSchedule: false,   // 돈 장부 — 고객의 자동 편성과 무관
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    const forced = FORCE && ctx.manual;
    if (!forced && (kstWeekday(ctx.now) !== RUN_WEEKDAY || kstHour(ctx.now) !== RUN_HOUR)) return NOOP;

    /* 주 1회 잠금 — 오늘(KST) 날짜를 원자적으로 선점한다(우산이 테넌트 수만큼 부르므로 첫 호출만 통과). */
    if (!forced) {
      /* 🔴 INSERT 의 VALUES 에 **오늘 날짜를 이미 넣는다** — `{day:null}` 로 넣으면 첫 주에 두 번째 테넌트 호출이 DO UPDATE 를 통과해
         **대조가 두 번 돈다**(2026-09-15 프로브에서 실제로 재현: 1회차 true · 2회차 true). 선점은 «첫 줄부터» 오늘이어야 한다. */
      const claim = await q(sql`INSERT INTO ops_settings (key, value, updated_at)
        VALUES ('coin_reconcile', jsonb_build_object('day', (${kstToday()})::text), NOW())
        ON CONFLICT (key) DO UPDATE SET value = jsonb_set(COALESCE(ops_settings.value, '{}'::jsonb), '{day}', to_jsonb((${kstToday()})::text)), updated_at = NOW()
        WHERE COALESCE(ops_settings.value->>'day', '') IS DISTINCT FROM (${kstToday()})::text
        RETURNING key`);
      if (!claim.length) return { changed: 0, skipped: 1, detail: { reason: "already-ran-this-week" } };
    }

    const findings = await reconcileCoins(null);   // 전 테넌트(전역 스텝)
    if (!findings.length) return { changed: 0, skipped: 0, detail: { checked: "all", findings: 0 } };

    /* 어긋난 행이 있을 때만 — 종류별로 묶어 한 줄, 그리고 집별 상세를 detail 에. */
    const byKind = new Map<ReconcileKind, number>();
    for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
    const tenants = [...new Set(findings.map((f) => f.tid))];
    await writeAudit({
      tenantId: null, action: "coin_reconcile_mismatch", actorType: "system", target: "coin_ledger", riskLevel: "high",
      detail: {
        total: findings.length,
        byKind: Object.fromEntries([...byKind].map(([k, v]) => [RECONCILE_LABEL[k], v])),
        tenants,
        samples: findings.slice(0, 20),   // 전부 싣지 않는다(감사 한 줄이 비대해지면 아무도 안 읽는다)
      },
    });
    return { changed: findings.length, skipped: 0, detail: { findings: findings.length, tenants: tenants.length } };
  },
};
