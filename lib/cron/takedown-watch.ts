/**
 * lib/cron/takedown-watch.ts — 스텝 `takedown.watch`(DESIGN §5E.2-④ · hourly 우산 · KST 10:00 게이트 = 하루 1번 · **global**).
 *   🔴 **자동으로 정지하지 않는다.** 기한이 지난 통지를 **운영 대기열에 올리고**(시스템 티켓 1건 · 감사) 고객에게 한 번 더 알린다.
 *      계정 해제·서비스 정지는 사람이 `/api/ops-takedown-action` 에서 누른다 — 통지는 틀린 것도 오고, 그 둘은 되돌릴 수 없다.
 *   D-1 안내도 여기서(«내일까지예요») — 조용히 기한이 지나가지 않게.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { createTicket } from "../cs";
import { dueNotices } from "../takedown";
import { kstHour, type GlobalStep, type StepOutcome } from "./base";

export const TAKEDOWN_HOUR_KST = 10;

export const takedownWatchStep: GlobalStep = {
  key: "takedown.watch",
  every: "hourly",
  scope: "global",
  async run(ctx): Promise<StepOutcome> {
    if (!ctx.manual && kstHour(ctx.now) !== TAKEDOWN_HOUR_KST) return { changed: 0, skipped: 0 };
    let changed = 0;
    const detail: Record<string, unknown> = {};

    // D-1 안내(기한 하루 전 · 통지당 1회)
    const soon = await q(sql`SELECT id, tenant_id, reason FROM takedown_notices
      WHERE status = 'open' AND due_at > NOW() AND due_at <= NOW() + interval '1 day'
        AND NOT EXISTS (SELECT 1 FROM notifications x WHERE x.tenant_id = takedown_notices.tenant_id AND x.kind = 'takedown_due_soon' AND x.created_at > NOW() - interval '3 days') LIMIT 50`);
    for (const s of soon) {
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${Number(s.tenant_id)}, ${"takedown_due_soon"}, ${"내일까지 신고된 글을 내려 주세요"},
        ${`${String(s.reason ?? "").slice(0, 200)}\n\n내일까지 조치가 없으면 그 계정의 연결이 해제될 수 있어요. «대신 내려 주기»를 눌러 주셔도 돼요.`}, ${"/app/settings.html#takedown"})`);
      changed++;
    }
    if (soon.length) detail.dueSoon = soon.length;

    // 기한 초과 → 운영 대기열(티켓 1건 · 멱등) — 🔴 여기서 아무것도 정지시키지 않는다
    const due = await dueNotices(50);
    for (const d of due) {
      const r = await createTicket({ tenantId: d.tenantId, subject: `신고 #${d.id} — 기한이 지났어요(운영 확인 필요)`,
        text: `${d.reason}\n\n기한: ${d.dueAt}\n운영센터에서 «계정 연결 해제» 또는 «서비스 정지»를 사람이 눌러야 합니다(자동 정지 없음).`,
        source: "system", priority: "urgent", tags: ["신고"], autoKey: `takedown_overdue:${d.id}` });
      if (r.ok && r.created) changed++;
    }
    if (due.length) detail.overdue = due.length;

    if (changed || due.length) await writeAudit({ tenantId: null, action: "cron_takedown_watch", actorType: "system", riskLevel: due.length ? "high" : "low", target: "cron:takedown.watch", detail });
    return { changed, skipped: 0, detail: Object.keys(detail).length ? detail : undefined };
  },
};
