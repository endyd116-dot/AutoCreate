/**
 * lib/cron/revenue-sync.ts — 스텝 `revenue.sync`(계약 §1.3 · DESIGN §9.1). hourly 우산 · **KST 판정**.
 *   기본 **06:00 KST** 에 API 소스를 하루 1회 · **쿠팡은 13:00 KST**(파트너스 실적 확정 시각 뒤). 수동 실행(`?secret=`)도 같은 시각 규칙 —
 *   테스트는 `settings.revenueSyncHour`(HH:MM · 선택)로 시각을 옮겨서 한다(produceHour 와 같은 방식).
 *
 *   ══ 규칙 ══
 *     · 테넌트 회전·예산·격리는 우산(`runner.ts`) 그대로. 한 틱에서 테넌트당 소스 **MAX_PER_TICK 개**(외부 API 는 느리다).
 *     · 결과: `cron_tick` 1행(우산) + 일 있은 소스별 개별 감사 `revenue_sync_source`(source·rows·reason).
 *     · **연속 3회 실패**(또는 auth 즉시) → `revenue_sources.status='error'` + 알림함 1건 «구글 연결이 끊겼어요 · 다시 연결하기» ·
 *       같은 소스 **24시간 1건**(error_notified_at 으로 중복 방지).
 *     · `not_configured` 는 에러가 아니다 — 세지도 알리지도 않는다(화면이 «키를 넣으면 바로 가져와요»로 그린다 · AC-10).
 *     · «없음»은 «0원»이 아니다(AC-9) — 실패는 행을 만들지 않는다(index.ts syncAndRecord 가 지킨다).
 *   자동 편성과 무관하게 돈다(needsAutoSchedule=false) — 수익은 편성표를 안 써도 들어온다.
 *   🔎 출처: AC 신규(계약 P1R3-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { listSourceRows, syncAndRecord } from "../revenue/index";
import { judgeAndNotify, refreshYppStats } from "../ad-eligibility";
import { isCustomerSide } from "../revenue/types";
import { hourOf, kstHour, notifyOnce, type CronStep, type StepOutcome } from "./base";

/** 소스별 수집 시각(KST 시). 없는 소스는 DEFAULT_HOUR. */
export const SYNC_HOUR_OF: Readonly<Record<string, number>> = { coupang: 13 };
export const DEFAULT_HOUR = 6;
const MAX_PER_TICK = 6;

const SOURCE_LABEL: Record<string, string> = { adsense: "구글 애드센스", youtube: "유튜브", coupang: "쿠팡 파트너스", aliexpress: "알리 어필리에이트", linkprice: "링크프라이스" };

export const revenueSyncStep: CronStep = {
  key: "revenue.sync",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx): Promise<StepOutcome> {
    const nowH = kstHour(ctx.now);
    // 테스트·운영 오버라이드(HH:MM) — 없으면 소스별 기본 시각.
    const override = typeof ctx.raw.revenueSyncHour === "string" ? hourOf(ctx.raw.revenueSyncHour, -1) : -1;
    const sources = (await listSourceRows(ctx.tid, true)).filter((s) => {
      const want = override >= 0 ? override : (SYNC_HOUR_OF[s.source] ?? DEFAULT_HOUR);
      return want === nowH;
    });
    // 하루 1회(기본 시각): 신청 조건 판정·알림(§1.5) — 수익 소스가 없는 집도 애드포스트 조건은 채워 간다.
    const dailyHour = override >= 0 ? override : DEFAULT_HOUR;
    let eligibility: Record<string, number> | null = null;
    if (nowH === dailyHour) {
      const y = await refreshYppStats(ctx.tid);
      const j = await judgeAndNotify(ctx.tid);
      eligibility = { yppRefreshed: y.refreshed, yppSkipped: y.skipped, eligibilityNotified: j.notified };
    }
    /* ★C(P1R4) fix: 러너 스크랩 소스(adpost·adfit·clip)는 아무도 잡을 적재하지 않았다(revenue-sync 는 API 소스만 · 러너는 잡이 있어야 움직인다)
       → 애드포스트 수익이 자동으로는 영영 안 모였다(R3 §1.3 «일 1회» · §2.1 잡 3종). dailyHour 에 계정별 1건 적재(enqueueJob 이 queued/claimed 중복을 막는다) ·
       플랜 runnerRevenue(Starter 없음 · 계약 §1.4)가 없으면 적재하지 않고 detail 에 남긴다. 경계 import 는 함수 안에서(AC-17). */
    let scrapeQueued = 0, scrapeGated = 0;
    if (nowH === dailyHour) {
      const runnerSources = (await listSourceRows(ctx.tid)).filter((s) => ["adpost", "adfit", "clip"].includes(s.source) && s.status === "connected" && s.accountId);
      if (runnerSources.length) {
        const { tenantPlan } = await import("../plans");
        const { plan } = await tenantPlan(ctx.tid);
        if (!plan.features.runnerRevenue) scrapeGated = runnerSources.length;
        else {
          const { enqueueJob } = await import("../runner-jobs");
          for (const s of runnerSources) {
            const kind = (`revenue.${s.source}`) as "revenue.adpost" | "revenue.adfit" | "revenue.clip";
            const j = await enqueueJob({ tenantId: ctx.tid, kind, accountId: s.accountId, payload: { source: s.source, sourceId: s.id } });
            if (j.created) scrapeQueued++;
          }
        }
      }
    }
    if (!sources.length) {
      const detail: Record<string, unknown> = { ...(scrapeQueued ? { scrapeQueued } : {}), ...(scrapeGated ? { scrapeGated } : {}), ...(ctx.manual ? { skippedByHour: `${nowH}시(기본 ${DEFAULT_HOUR}시 · 쿠팡 ${SYNC_HOUR_OF.coupang}시)` } : {}), ...(eligibility ?? {}) };
      return { changed: (eligibility?.eligibilityNotified ?? 0) + scrapeQueued, skipped: scrapeGated, ...(Object.keys(detail).length ? { detail } : {}) };
    }

    let synced = 0, rows = 0, notConfigured = 0, failed = 0, deferred = 0, notified = eligibility?.eligibilityNotified ?? 0, done = 0;
    const bySource: Record<string, unknown>[] = [];
    for (const src of sources) {
      if (done >= MAX_PER_TICK || ctx.deadline - Date.now() < 8_000) { deferred++; continue; }
      done++;
      const r = await syncAndRecord(ctx.tid, src);
      if (r.ok) {
        synced++; rows += r.written ?? 0;
        bySource.push({ source: src.source, sourceId: src.id, rows: r.written, rejected: r.rejected ?? 0 });
        await writeAudit({ tenantId: ctx.tid, action: "revenue_sync_source", actorType: "system", target: `revenue_source:${src.id}`, detail: { source: src.source, rows: r.written, rejected: r.rejected ?? 0, ...(r.detail ? { detail: r.detail } : {}) } });
        continue;
      }
      if (r.reason === "not_configured") { notConfigured++; continue; }   // 에러 아님 — 세지 않는다
      failed++;
      bySource.push({ source: src.source, sourceId: src.id, reason: r.reason, retriable: r.retriable ?? false });
      await writeAudit({ tenantId: ctx.tid, action: "revenue_sync_source", actorType: "system", riskLevel: isCustomerSide(r.reason!) ? "low" : "medium",
        target: `revenue_source:${src.id}`, detail: { source: src.source, reason: r.reason, retriable: r.retriable, detail: r.detail, becameError: !!r.becameError } });
      if (r.becameError) {
        // 24시간 1건 — error_notified_at 이 그 문지기다.
        const [gate] = await q(sql`UPDATE revenue_sources SET error_notified_at = NOW() WHERE tenant_id = ${ctx.tid} AND id = ${src.id}
          AND (error_notified_at IS NULL OR error_notified_at < NOW() - interval '24 hours') RETURNING id`);
        if (gate) {
          const label = SOURCE_LABEL[src.source] ?? src.source;
          const customer = isCustomerSide(r.reason!);
          if (await notifyOnce(ctx.tid, "revenue_error", customer ? `${label} 연결이 끊겼어요` : `${label} 수익을 못 가져왔어요`,
            customer ? `${label} 에 다시 연결해 주세요. 그전까지는 수익이 집계에 안 잡혀요.` : `${label} 쪽 응답이 이상해요. 저희가 확인 중이에요 — 수익은 되돌아가서 다시 가져와요.`,
            "/app/ad-media.html", { withinHours: 24 })) notified++;
        }
      }
    }
    const out: StepOutcome = { changed: synced + failed, skipped: notConfigured + deferred };
    const detail: Record<string, unknown> = { hour: nowH, ...(eligibility ?? {}) };
    for (const [k, v] of Object.entries({ synced, rows, failed, notConfigured, deferred, notified })) if (v) detail[k] = v;
    if (bySource.length) detail.sources = bySource.slice(0, 10);
    out.detail = detail;
    return out;
  },
};
