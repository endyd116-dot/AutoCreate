/**
 * lib/cron/trial-expire.ts — 스텝 `trial.expire`(계약 §1.3 · DESIGN §12.3). hourly 우산.
 *   · D-3 · D-1 · D-0: **알림함 + 메일** 각 1회(KST 09:00 · 멱등 = notifyOnce byKind 48h + 메일은 알림이 새로 났을 때만).
 *   · 종료(trial_ends_at ≤ now · 매시 판정): `tenants.status='readonly'` + readonly_at + 알림 «체험이 끝났어요 · 30일 뒤 데이터 파기 안내»(파기 자체는 R5 · 안내만).
 *     readonly = 열람 O · 생성/발행 X(`requireWritable` 이 막는다). 결제하면 applyChargeResult 가 active 로 풀어 준다.
 *   ⚠️ trial 인데 trial_ends_at 이 없으면 건드리지 않는다(«없음»을 «끝남»으로 읽지 않는다).
 *   🔎 출처: AC 신규(계약 P1R4-B §1·§2 코인·구독·체험·게이트·남용 · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { utcDate } from "../db-util";
import { sendEmail, simpleMail, siteUrl } from "../email";
import { tenantOwner } from "../subscription";
import { hourOf, kstHour, notifyOnce, type CronStep, type StepOutcome } from "./base";

export const NOTICE_HOUR = 9;
const KST_MS = 9 * 3600_000;
const kstDay = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400_000);

export const trialExpireStep: CronStep = {
  key: "trial.expire",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx): Promise<StepOutcome> {
    const [t] = await q(sql`SELECT status, trial_ends_at, name FROM tenants WHERE id = ${ctx.tid}`);
    if (!t || String(t.status) !== "trial") return { changed: 0, skipped: 0 };
    const ends = utcDate(t.trial_ends_at);
    if (!ends) return { changed: 0, skipped: 1, detail: { noTrialEnd: true } };
    const detail: Record<string, unknown> = {};
    let changed = 0;

    // 종료 — 매시 판정.
    if (ends.getTime() <= ctx.now.getTime()) {
      await q(sql`UPDATE tenants SET status = 'readonly', readonly_at = NOW(), updated_at = NOW() WHERE id = ${ctx.tid} AND status = 'trial'`);
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${ctx.tid}, ${"trial_ended"}, ${"체험이 끝났어요"},
        ${"만든 글·편성표·수익은 그대로 볼 수 있어요. 새로 만들거나 발행하려면 요금제를 골라 주세요. 30일 동안 요금제를 고르지 않으면 데이터가 지워질 수 있어요(미리 한 번 더 알려드릴게요)."}, ${"/app/plan.html"})`);
      const owner = await tenantOwner(ctx.tid);
      // 🔴 [2026-09-15 C · AC-36] 던지고 잊으면 «체험 끝» 메일이 조용히 사라진다(크론도 끝나면 인보케이션이 닫힌다) — await.
      if (owner.email) await sendEmail(owner.email, "[AutoCreate] 체험이 끝났어요 — 요금제를 고르면 바로 이어져요", simpleMail("체험이 끝났어요", "만든 글과 편성표는 그대로 있어요. 요금제를 고르면 오늘부터 바로 이어서 만들고 발행할 수 있어요.", { label: "요금제 고르기", url: `${siteUrl()}/app/plan.html` }));
      await writeAudit({ tenantId: ctx.tid, action: "trial_expired", actorType: "system", detail: { trialEndsAt: ends.toISOString() } });
      return { changed: 1, skipped: 0, detail: { readonly: true } };
    }

    // D-3 · D-1 · D-0 알림(KST 09:00 · 각 1회).
    const want = typeof ctx.raw.trialNoticeHour === "string" ? hourOf(ctx.raw.trialNoticeHour, NOTICE_HOUR) : NOTICE_HOUR;
    if (kstHour(ctx.now) !== want) return { changed: 0, skipped: 0 };
    const left = daysBetween(kstDay(ctx.now), kstDay(ends));
    const milestone = left === 3 ? "trial_d3" : left === 1 ? "trial_d1" : left === 0 ? "trial_d0" : null;
    if (!milestone) return { changed: 0, skipped: 0, detail: { daysLeft: left } };
    const title = left === 0 ? "오늘 체험이 끝나요" : `체험이 ${left}일 남았어요`;
    const body = left === 0 ? "오늘까지 만들고 발행할 수 있어요. 요금제를 고르면 끊기지 않고 이어져요." : `${left}일 뒤에 체험이 끝나요. 요금제를 미리 고르면 편성표가 끊기지 않아요.`;
    if (await notifyOnce(ctx.tid, milestone, title, body, "/app/plan.html", { byKind: true, withinHours: 48 })) {
      changed++; detail.notified = milestone;
      const owner = await tenantOwner(ctx.tid);
      // 🔴 [2026-09-15 C · AC-36 + AC-9] await 하고 **보낸 결과 그대로** 적는다 — 종전엔 던지고 잊고 detail.mailed=true 로 «보냈다» 고 말했다.
      if (owner.email) detail.mailed = await sendEmail(owner.email, `[AutoCreate] ${title}`, simpleMail(title, body, { label: "요금제 보기", url: `${siteUrl()}/app/plan.html` }));
    }
    return { changed, skipped: 0, detail: { ...detail, daysLeft: left } };
  },
};
