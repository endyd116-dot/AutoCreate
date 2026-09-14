/**
 * lib/cron/review-deadline.ts — 스텝 `slots.review_deadline`(계약 §1 · DESIGN §5B.6 검수창 · §5B.4 reviewPolicy).
 *   매시. 검수창(제작 D-3 ~ 발행 D-0)이 닫히는 순간을 집행한다. 정책은 둘뿐이다.
 *
 *   ══ `silence_approves`(기본 · «조용하면 그대로 나가요») ══
 *     발행일 **02:00 KST**(슬롯의 `review_deadline` — rollSlots 가 슬롯을 만들 때 박아 둔다)가 지났고 아직 `in_review` 이고
 *     사람이 반려하지 않았으면 → **`pieces-approve` 와 같은 게이트**(`lib/content-approve.approvePiece`)를 태운 뒤 approved+scheduled.
 *     🔴 게이트 하드 실패(고지·금칙어·제휴 링크 수·유사도·최상급)면 **발행하지 않는다** — piece·슬롯 `awaiting_manual` + 알림.
 *        «자동 승인»이 정책 위반을 통과시키는 경로는 0이어야 한다(그 한 건이 계정 정지·공정위 문제로 온다).
 *
 *   ══ `require_confirm`(«반드시 컨펌») ══
 *     ① D-0 **08:00 KST** 에 «오늘 나갈 글 확인해 주세요» 알림 1회(자동 승인 없음).
 *     ② 발행 시각이 됐는데도 여전히 `in_review` 면 발행하지 않고 `awaiting_manual` + 알림 — 사람이 승인해야 나간다.
 *        (publisher 는 `scheduled` 만 집어 가므로, 이쪽이 «왜 안 나갔는지»를 화면에 남기는 유일한 자리다. 조용한 0건 금지.)
 *
 *   ⚠️ 사람이 만든 글은 건드리지 않는다 — 창은 `slots.review_deadline IS NOT NULL`(= rollSlots 가 만든 자동 슬롯)에만 있다.
 *      사람이 «만들기»로 만든 piece 의 슬롯은 `origin='manual'` 이고 review_deadline 이 없다 → 자동 승인 대상이 아니다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { jsonb, utcDate } from "../db-util";
import { approvePiece } from "../content-approve";
import { kstHour, kstTimeText, notifyOnce, setSlot, type CronStep, type StepOutcome } from "./base";

const n = (v: unknown) => Number(v || 0);

/** 사람이 손댄 흔적이 있으면 «조용»이 아니다 — 반려·수정은 자동 승인을 막는다. */
const NOT_SILENT = sql`(p.meta->>'rejectReason') IS NULL`;

export const reviewDeadlineStep: CronStep = {
  key: "slots.review_deadline",
  every: "hourly",
  needsAutoSchedule: true,
  async run(ctx): Promise<StepOutcome> {
    let approved = 0, blocked = 0, pending = 0, notified = 0;
    const hour = kstHour(ctx.now);

    if (ctx.settings.reviewPolicy === "silence_approves") {
      // 마감이 지난 in_review — review_deadline 은 D-0 02:00 KST 로 박혀 있다(UTC 저장 · 비교도 UTC).
      const due = await q(sql`SELECT p.*, s.id AS sid FROM slots s JOIN pieces p ON p.id = s.piece_id
        WHERE s.tenant_id = ${ctx.tid} AND s.status = 'in_review' AND p.status = 'in_review'
          AND s.review_deadline IS NOT NULL AND s.review_deadline <= NOW() AND ${NOT_SILENT}
        ORDER BY s.publish_at NULLS LAST, s.id LIMIT 200`);
      for (const p of due) {
        if (Date.now() >= ctx.deadline) { pending++; continue; }
        const pieceId = n(p.id), slotId = n(p.sid);
        const r = await approvePiece(ctx.tid, p, { now: ctx.now });
        if (r.ok) {
          approved++;
          await writeAudit({ tenantId: ctx.tid, action: "piece_approve", actorType: "system", target: `piece:${pieceId}`,
            detail: { by: "cron", step: "slots.review_deadline", policy: "silence_approves", scheduledFor: r.scheduledFor, gateOk: r.gate.ok, slotId } });
          continue;
        }
        if (r.step === "state") { pending++; continue; }   // 그새 사람이 바꿨다 — 다음 주기가 다시 본다
        // 🔴 게이트 하드 실패 = 자동으로 내보내지 않는다.
        blocked++;
        const why = r.gate.checks.filter((c) => !c.pass).map((c) => c.label).slice(0, 3).join(" · ") || "확인 필요";
        await q(sql`UPDATE pieces SET status = 'awaiting_manual', meta = meta || ${jsonb({ failReason: `자동 승인을 멈췄어요 — ${why}` })}, updated_at = NOW() WHERE tenant_id = ${ctx.tid} AND id = ${pieceId}`);
        await setSlot(ctx.tid, slotId, "awaiting_manual", `자동 승인 보류 — ${why}`);
        if (await notifyOnce(ctx.tid, "review_blocked", "그대로 내보내기 전에 봐 주세요",
          `«${String(p.title || "글")}» 이(가) ${why} 때문에 자동 승인을 멈췄어요. 고치고 승인해 주세요.`, `/app/piece.html?id=${pieceId}`)) notified++;
        await writeAudit({ tenantId: ctx.tid, action: "piece_auto_approve_blocked", actorType: "system", riskLevel: "medium", target: `piece:${pieceId}`,
          detail: { step: "slots.review_deadline", failed: r.gate.checks.filter((c) => !c.pass).map((c) => c.key), slotId } });
      }
    } else {
      // require_confirm — 자동 승인 0. D-0 08:00 에 한 번 부르고, 발행 시각을 넘기면 «안 나갔다»를 남긴다.
      if (hour === 8) {
        const [today] = await q(sql`SELECT COUNT(*) AS c, MIN(s.publish_at) AS first_at FROM slots s JOIN pieces p ON p.id = s.piece_id
          WHERE s.tenant_id = ${ctx.tid} AND s.slot_date = (NOW() AT TIME ZONE 'Asia/Seoul')::date AND p.status = 'in_review'`);
        const cnt = n(today?.c);
        const when = kstTimeText(utcDate(today?.first_at), ctx.now);   // 문구 속 시각은 KST(§13.5)
        if (cnt && await notifyOnce(ctx.tid, "review_confirm", `오늘 나갈 글 ${cnt}건을 확인해 주세요`,
          `«반드시 확인» 으로 설정해 두셨어요. 승인하지 않으면 오늘은 나가지 않아요.${when ? ` 첫 글은 ${when} 예정이에요.` : ""}`, "/app/pieces.html?status=in_review", { byKind: true })) notified++;
      }
      const late = await q(sql`SELECT p.id, p.title, s.id AS sid FROM slots s JOIN pieces p ON p.id = s.piece_id
        WHERE s.tenant_id = ${ctx.tid} AND s.status = 'in_review' AND p.status = 'in_review'
          AND s.publish_at IS NOT NULL AND s.publish_at <= NOW() ORDER BY s.id LIMIT 200`);
      for (const p of late) {
        const pieceId = n(p.id), slotId = n(p.sid);
        await q(sql`UPDATE pieces SET status = 'awaiting_manual', meta = meta || ${jsonb({ failReason: "승인을 기다리다 발행 시각이 지났어요." })}, updated_at = NOW() WHERE tenant_id = ${ctx.tid} AND id = ${pieceId}`);
        if (await setSlot(ctx.tid, slotId, "awaiting_manual", "승인 전에 발행 시각이 지났어요")) blocked++;
        if (await notifyOnce(ctx.tid, "review_missed", "확인을 못 받아 나가지 못했어요",
          `«${String(p.title || "글")}» 이(가) 승인을 기다리다 발행 시각을 넘겼어요. 지금 승인하면 다시 잡아 드려요.`, `/app/piece.html?id=${pieceId}`)) notified++;
      }
    }

    const out: StepOutcome = { changed: approved + blocked, skipped: pending };
    const detail: Record<string, unknown> = { policy: ctx.settings.reviewPolicy };
    if (approved) detail.approved = approved;
    if (blocked) detail.blocked = blocked;
    if (notified) detail.notified = notified;
    if (approved || blocked || notified) out.detail = detail;
    return out;
  },
};
