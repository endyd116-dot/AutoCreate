/**
 * lib/cron/tenant-purge.ts — 스텝 `tenant.purge`(계약 P1R7 §3.1 · hourly 우산 · **KST 04:00 게이트 = 하루 1번**).
 *   ① 기한(=탈퇴 + 30일) 지난 테넌트의 데이터 파기(`lib/account-close.ts purgeTenant` — 보호 id·구독 확인은 그 안에서 한 번 더).
 *   ② 파기 D-3 안내 1회(알림 · 되돌릴 마지막 기회) — 「조용히 지워지는 일」이 없게.
 *   ③ 내부 테스트 표시 자동 켜기(§3.4 `syncInternalFlags`) — 하루 1번이면 충분하다(운영 숫자에서 빠진다).
 *   🔴 **global 스텝**이다(테넌트 루프 밖). 탈퇴한 집은 status readonly 라 우산의 활성 테넌트 목록(trial|active)에 없다 —
 *      테넌트 스텝으로 만들면 «아무도 안 도는 스텝»이 된다.
 *   🔴 한 틱에 최대 5집만 파기한다(R2 삭제가 느릴 수 있다 · 남은 곳은 다음 틱 = 1시간 뒤 · 기한은 이미 지났으니 급하지 않다).
 *   🔎 출처: AC 신규(계약 P1R7-B §3 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { utcDate } from "../db-util";
import { duePurgeTenants, purgeTenant } from "../account-close";
import { syncInternalFlags } from "../ops/internal";
import { kstHour, type GlobalStep, type StepOutcome } from "./base";

export const PURGE_HOUR_KST = 4;
const MAX_PER_TICK = 5;

export const tenantPurgeStep: GlobalStep = {
  key: "tenant.purge",
  every: "hourly",
  scope: "global",
  async run(ctx): Promise<StepOutcome> {
    if (!ctx.manual && kstHour(ctx.now) !== PURGE_HOUR_KST) return { changed: 0, skipped: 0 };
    const detail: Record<string, unknown> = {};
    let changed = 0, skipped = 0;

    // ② D-3 안내(되돌릴 마지막 기회) — 알림 1회(같은 kind 가 이미 있으면 건너뛴다).
    const soon = await q(sql`SELECT id, purge_at FROM tenants WHERE purge_at IS NOT NULL AND purged_at IS NULL
      AND purge_at > NOW() AND purge_at <= NOW() + interval '3 days'
      AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.tenant_id = tenants.id AND x.kind = 'account_purge_soon') LIMIT 50`);
    for (const s of soon) {
      const at = utcDate(s.purge_at);
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${Number(s.id)}, ${"account_purge_soon"}, ${"곧 데이터가 지워져요"},
        ${`${at ? at.toISOString().slice(0, 10) : "곧"} 이후 계정과 만든 것들이 모두 지워져요. 지금 «되돌리기»를 누르면 그대로 돌아와요.`}, ${"/app/settings.html"})`);
      changed++;
    }
    if (soon.length) detail.noticed = soon.length;

    // ① 파기
    const due = await duePurgeTenants(MAX_PER_TICK);
    const purged: Record<string, unknown>[] = [];
    for (const tid of due) {
      if (Date.now() >= ctx.deadline) { skipped++; continue; }
      const r = await purgeTenant(tid, { now: ctx.now });
      if (r.ok) { changed++; purged.push({ tid, rows: r.rows ?? 0, r2: r.r2?.deleted ?? 0 }); }
      else { skipped++; purged.push({ tid, refused: r.reason }); }
    }
    if (purged.length) detail.purged = purged;

    // ③ 내부 표시 자동 켜기(운영 숫자에서 제외 · §3.4)
    try { const m = await syncInternalFlags(); if (m.marked) { detail.internalMarked = m.marked; changed += m.marked; } }
    catch (e) { console.warn("[cron:tenant.purge] 내부 표시 동기화 실패", String((e as Error)?.message ?? e).slice(0, 100)); }

    if (due.length || soon.length) await writeAudit({ tenantId: null, action: "cron_tenant_purge", actorType: "system", riskLevel: due.length ? "high" : "low", target: "cron:tenant.purge", detail });
    return { changed, skipped, detail: Object.keys(detail).length ? detail : undefined };
  },
};
