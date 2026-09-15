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
 *
 *   ══ [P1R7 B3] 플랜이 자동 승인을 막는 경우(DESIGN §5B.9 «Pro = … 자동 승인») ══
 *     `reviewPolicy` 의 **기본값이 `silence_approves`** 라, 저장을 막는 것(rules-settings 402)만으로는 아무것도 안 바뀐다 —
 *     화면엔 «자동 승인은 Pro 부터»라고 쓰고 실제로는 자동 승인되는 «거짓말» 상태가 된다. 그래서 판정을 **여기 한 곳**에서 한다:
 *       **저장된 값이 없고**(= 기본값으로 자동 승인 중) **플랜이 자동 승인을 안 주면** → `require_confirm` 가지로 간다.
 *     🔴 **소급 0** — `settings.reviewPolicy` 를 이미 저장해 둔 집은 그 값 그대로다(어제까지 나가던 글이 오늘 조용히 멈추지 않는다).
 *     🔴 **조용한 0건 금지**(AC-16) — 그 가지가 이미 ①08:00 «오늘 나갈 글 확인해 주세요» ②발행 시각 넘기면 `awaiting_manual` + 알림을
 *        하고 있다. 플랜 때문에 들어온 집은 문구만 «요금제» 말로 바꾼다(«반드시 확인으로 설정해 두셨어요» 는 그 집 이야기가 아니다).
 *   🔎 출처: AC 신규(계약 P1R2-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { jsonb, utcDate } from "../db-util";
import { approvePiece } from "../content-approve";
import { needsOwnerApproval, notifyOwnersWaiting } from "../team";   // [R8 §4.5] 팀 승인이 걸린 글은 마감 자동 승인에서 뺀다
import { kstHour, kstTimeText, notifyOnce, setSlot, type CronStep, type StepOutcome } from "./base";
import { planOf, autoApproveAllowed } from "../plans";   // [P1R7 B3] 자동 승인 플랜 게이트(§5B.9)
import { accountsTrust } from "../account-trust";       // [P1R8 §9] 신뢰는 **알려 주는 축**이다 — 막지 않는다(사장님 지시 2026-09-15)

const n = (v: unknown) => Number(v || 0);

/** 사람이 손댄 흔적이 있으면 «조용»이 아니다 — 반려·수정은 자동 승인을 막는다. */
const NOT_SILENT = sql`(p.meta->>'rejectReason') IS NULL`;

export const reviewDeadlineStep: CronStep = {
  key: "slots.review_deadline",
  every: "hourly",
  needsAutoSchedule: true,
  async run(ctx): Promise<StepOutcome> {
    let approved = 0, blocked = 0, pending = 0, notified = 0, untrusted = 0;
    /* [R8 §4.5] 주인을 기다리느라 이번에 안 건드린 글 수 — 🔴 «조용히 0건»이 되지 않게 **센다**. */
    let teamWaitTotal = 0;
    const hour = kstHour(ctx.now);

    /* [P1R7 B3] 플랜 게이트 — «저장된 값 없음 + 플랜이 자동 승인 불가» 일 때만 require_confirm 처럼 판정한다(위 주석). */
    let policy = ctx.settings.reviewPolicy;
    let forcedByPlan = false;
    if (policy === "silence_approves" && ctx.raw.reviewPolicy !== "silence_approves") {
      const plan = await planOf(ctx.planKey);
      if (!autoApproveAllowed(ctx.planKey, plan)) { policy = "require_confirm"; forcedByPlan = true; }
    }

    if (policy === "silence_approves") {
      // 마감이 지난 in_review — review_deadline 은 D-0 02:00 KST 로 박혀 있다(UTC 저장 · 비교도 UTC).
      const due = await q(sql`SELECT p.*, s.id AS sid FROM slots s JOIN pieces p ON p.id = s.piece_id
        WHERE s.tenant_id = ${ctx.tid} AND s.status = 'in_review' AND p.status = 'in_review'
          AND s.review_deadline IS NOT NULL AND s.review_deadline <= NOW() AND ${NOT_SILENT}
        ORDER BY s.publish_at NULLS LAST, s.id LIMIT 200`);
      /* [P1R8 §5.2 → §9] 🔴 **신뢰 계정은 «막는 축»이 아니라 «알려 주는 축»이다**(사장님 전역 지시 2026-09-15 · CLAUDE §9 «게이트는 최소화»).
         설계(§4.2)는 자동 승인을 계정 단위 신뢰로 말하고, 코드엔 테넌트 스위치 + 요금제 게이트뿐이었다 — 그 빈자리를 판정기로 채웠다.
         🔴 **그런데 막는 데 쓰면 안 된다**: 라이브 실측에서 계정 12개가 **전부 «아직»**이었다(실발행이 없어서).
            그대로 막으면 «알아서 올려»를 켠 고객의 글이 **한 편도 안 나간다** — 막아서 공장을 세우는 쪽이 더 나쁘다.
         ⇒ **자동 승인은 그대로 하고**, 처음 몇 편은 «한 번 보시는 게 좋아요»를 **알림·감사로만** 남긴다.
         🔴 워밍업도 여기서 막지 않는다 — 계정 보호는 **발행량**이 하는 일이고 이미 `effectiveDailyCap` 이 하루 상한으로 막는다.
            같은 것을 두 곳에서 막으면 «왜 안 나가지»가 두 배로 어려워진다(AC-29 «게이트 호출처는 한 곳»). */
      const trustMap = await accountsTrust(ctx.tid, due.map((x) => n(x.account_id)).filter(Boolean));
      /* 🔴 [R8 §4.5] **팀 승인이 걸린 글은 «조용하면 발행»에서 뺀다.**
         그 집이 «사람이 봐야 한다»를 켰는데 우리 크론이 마감에 자동 승인하면 **그 집 규칙이 우리 기계에 먹힌다.**
         대신 **주인에게 알린다**(하루 한 번) — 안 알리면 그 글은 조용히 사라진다(CLAUDE §4.7). */
      for (const p of due) {
        if (Date.now() >= ctx.deadline) { pending++; continue; }
        const pieceId = n(p.id), slotId = n(p.sid);
        if (p.created_by && await needsOwnerApproval(ctx.tid, p.created_by)) { teamWaitTotal++; continue; }
        const accId = n(p.account_id);
        const trust = accId ? trustMap.get(accId) : undefined;
        if (accId && trust && !trust.trusted) {
          untrusted++;   // 막지 않는다 — 센다(운영이 «아직 처음인 계정으로 자동 발행 중»을 본다)
          if (await notifyOnce(ctx.tid, `trust_review:${accId}`.slice(0, 32), "처음 몇 편은 한 번 보시는 게 좋아요",
            /* 🔴 [2026-09-16 · AC-92 훑기] 종전엔 `?? "이 계정은 이제 막 시작했어요"` 였다 —
               지금은 `trusted === reasons.length === 0` 이라 **닿지 않는 문장**이지만, 닿는 날에는
               **계정 나이에 대한 없는 사실**을 지어내게 된다(오래된 계정에도 «이제 막 시작했어요»라고 한다).
               사유를 모르면 **사유를 말하지 않는다** — 권하는 말은 그대로 할 수 있다. */
            `${trust.reasons[0] ? `${trust.reasons[0]} — ` : ""}그대로 두면 예정대로 나가요. 검수에서 미리 보실 수도 있어요.`,
            `/app/piece.html?id=${pieceId}`)) notified++;
          await writeAudit({ tenantId: ctx.tid, action: "auto_approve_untrusted", actorType: "system", target: `piece:${pieceId}`,
            detail: { accountId: accId, evidence: trust.evidence, reasons: trust.reasons, slotId, blocked: false } });
          /* 🔴 `continue` 하지 않는다 — 알리고 **그대로 승인으로 간다**(§9). */
        }
        const r = await approvePiece(ctx.tid, p, { now: ctx.now });
        if (r.ok) {
          approved++;
          await writeAudit({ tenantId: ctx.tid, action: "piece_approve", actorType: "system", target: `piece:${pieceId}`,
            detail: { by: "cron", step: "slots.review_deadline", policy: "silence_approves", scheduledFor: r.scheduledFor, gateOk: r.gate.ok, slotId } });
          continue;
        }
        if (r.step === "state") { pending++; continue; }   // 그새 사람이 바꿨다 — 다음 주기가 다시 본다
        /* 🔴 위에서 이미 걸렀지만 한 겹 더 — 이 크론이 그 집 «팀 승인»을 절대 대신 누르지 않게(두 겹으로 막는 값이 있는 자리다). */
        if (r.step === "team_approval") { teamWaitTotal++; continue; }
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
        const why = forcedByPlan
          ? "지금 요금제에서는 검수를 눌러야 글이 나가요(«조용하면 발행»은 Pro 부터예요)."
          : "«반드시 확인» 으로 설정해 두셨어요. 승인하지 않으면 오늘은 나가지 않아요.";
        if (cnt && await notifyOnce(ctx.tid, "review_confirm", `오늘 나갈 글 ${cnt}건을 확인해 주세요`,
          `${why}${when ? ` 첫 글은 ${when} 예정이에요.` : ""}`, "/app/pieces.html?status=in_review", { byKind: true })) notified++;
      }
      const late = await q(sql`SELECT p.id, p.title, s.id AS sid FROM slots s JOIN pieces p ON p.id = s.piece_id
        WHERE s.tenant_id = ${ctx.tid} AND s.status = 'in_review' AND p.status = 'in_review'
          AND s.publish_at IS NOT NULL AND s.publish_at <= NOW() ORDER BY s.id LIMIT 200`);
      for (const p of late) {
        const pieceId = n(p.id), slotId = n(p.sid);
        await q(sql`UPDATE pieces SET status = 'awaiting_manual', meta = meta || ${jsonb({ failReason: "승인을 기다리다 발행 시각이 지났어요." })}, updated_at = NOW() WHERE tenant_id = ${ctx.tid} AND id = ${pieceId}`);
        if (await setSlot(ctx.tid, slotId, "awaiting_manual", "승인 전에 발행 시각이 지났어요")) blocked++;
        if (await notifyOnce(ctx.tid, "review_missed", "확인을 못 받아 나가지 못했어요",
          `«${String(p.title || "글")}» 이(가) 승인을 기다리다 발행 시각을 넘겼어요. 지금 승인하면 다시 잡아 드려요.${forcedByPlan ? " 검수를 눌러야 나가요 — «조용하면 발행»은 Pro 부터예요." : ""}`, `/app/piece.html?id=${pieceId}`)) notified++;
      }
    }

    /* 🔴 기다리는 글이 있으면 **주인에게 알린다** — 이게 «조용히 0건 금지»의 짝이다. */
    if (teamWaitTotal) await notifyOwnersWaiting(ctx.tid);
    const out: StepOutcome = { changed: approved + blocked, skipped: pending + teamWaitTotal };
    // 🔴 `stored` 는 **저장된 원본**(대개 없음)이다 — 기본값을 적으면 «왜 require_confirm 이 됐나»를 감사에서 못 읽는다.
    const detail: Record<string, unknown> = { policy, ...(forcedByPlan ? { forcedByPlan: true, planKey: ctx.planKey, stored: ctx.raw.reviewPolicy ?? null } : {}) };
    if (approved) detail.approved = approved;
    if (blocked) detail.blocked = blocked;
    if (untrusted) detail.untrusted = untrusted;   // [P1R8 §9] 아직 처음인 계정의 글을 **그대로 내보낸** 건수(막지 않는다 · 알림만)
    if (notified) detail.notified = notified;
    if (approved || blocked || notified) out.detail = detail;
    return out;
  },
};
