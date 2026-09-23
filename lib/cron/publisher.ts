/**
 * lib/cron/publisher.ts — 스텝 `publisher`(계약 §1 · §10 · DESIGN §5B.7 · §4.2). 5분마다 «시간 된 글»을 내보낸다.
 *
 *   ══ 이 스텝이 하는 일은 딱 하나 ══
 *     due(`pieces.status='scheduled'` ∧ `scheduled_for ≤ now`) 마다 **`publishPiece()` 하나만 부른다**(계약 §10).
 *     러너/API 판단 · 자격 복호화 · 최종 게이트(§16B) · 잡 적재 · `finalizePublish` 는 전부 B2 안이다 — 여기서 다시 짓지 않는다.
 *
 *   ══ 상태를 쓰는 자리는 둘뿐 ══
 *     ① `via:"runner"` → piece·slot 을 `publishing` 으로(잡을 넘겼다는 표시). 러너가 오프라인 30분+ 면 슬롯만 `awaiting_runner`
 *        — **발행 취소가 아니다**. 잡은 큐에 남아 있고, 러너가 켜지면 그대로 나간다. 사용자에겐 «왜 안 나갔는지»가 보인다.
 *     ② 실패 분기(아래 표). 🔴 **잡을 넘긴 뒤에는 그 piece/slot 을 쓰지 않는다** — 러너 보고 이후의 상태는 B2 가 종결한다(§10).
 *     `via:"api"` + `finalized` 는 B2 가 이미 다 썼다 → 건드리지 않는다(두 손이 같은 행을 쓰지 않는다).
 *
 *   ══ 실패 분기(B2 확정 어휘) ══
 *     gate · no_account · no_creds · account_blocked · auth_failed · provider_not_configured → `awaiting_manual` + 알림(사람이 손봐야 한다)
 *     channel_error · network(retriable)                                                    → 다음 5분 틱 재시도 · **3회 초과면** `awaiting_manual` + 알림
 *     unsupported_channel · not_publishable · config                                        → `failed` + 알림(재시도해도 소용없다)
 *     🔴 `unavailable`(포트 미연결) 은 위 어디도 아니다 — **아무 상태도 쓰지 않고** 정직하게 «아직 못 물어봤다»로 센다.
 *        이것을 `config`(=failed) 로 접으면 B2 머지 전에 due 글이 전부 죽는다.
 *
 *   재시도 횟수는 `pieces.meta.publishAttempts` — 성공하면 B2 가 status 를 바꾸므로 이 값은 더 늘지 않는다.
 *
 *   ══ [P1R5 B-1 수정] 영상(kind='video') 분기 ══
 *     mp4 업로드는 **서버가 스트리밍**한다(유튜브 resumable) — 동기 26초 안에 못 끝낸다. 그래서 이 스텝은 영상이면
 *     `publish-video-background`(15분)를 202 로 부르고 piece 를 `publishing` 으로만 표시한다(계약 v5.3 §2.3b).
 *     그 뒤 상태(posts·uploaded_private·실패 되돌림)는 배경 함수와 B2 의 finalizePublish 가 쓴다 — 여기서 다시 쓰지 않는다.
 *   🔎 출처: AC 신규(계약 P1R2-B · 생성 커밋 2026-09-14) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { requireWritable } from "../guards";
import { tenantPlan, requireCardBeforePublish } from "../plans";
import { activeBillingKey } from "../subscription";
import { notifyOnce, type CronStep, type StepOutcome } from "./base";
import { publishPortStatus } from "./publish-port";
/* 🔴 «한 건 내보내기» 몸통은 `lib/publish-one.ts` 한 곳이다(P1R8 §4.2) — 고객의 «지금 올려»(`/api/publish-now`)가 같은 함수를 쓴다.
   여기 다시 쓰면 두 벌이 되어 규칙이 갈라진다(크론으로는 awaiting_manual, 손으로는 failed 같은 식). */
import { publishOne } from "../publish-one";

const n = (v: unknown) => Number(v || 0);
const MAX_ATTEMPTS = 3;

export const publisherStep: CronStep = {
  key: "publisher",
  every: "5m",
  needsAutoSchedule: false,   // 사람이 손으로 승인한 글도 나가야 한다 — 자동 편성과 무관.
  /* 🔴 [AC-220 · DESIGN §5B.11(1)] **«잠깐 멈춤»에는 이 스텝도 쉰다** — 예약된 것이 «취소»가 아니라 **대기**한다.
     ⚠️ 위 `needsAutoSchedule:false` 와 **모순이 아니다**: 두 축이 다르다.
        «자동 편성을 꺼 뒀다» = 새 자리를 안 만들 뿐 **이미 승인된 글은 나간다** ↔ «쉬는 중» = **아무 글도 저절로 안 나간다**.
     🔴 그래도 **손으로 «지금 올리기»는 그대로 된다** — 그 길은 이 크론이 아니라 `publish-now` API 다(설계 (1) 오른쪽 칸). */
  stopsWhenPaused: true,
  async run(ctx): Promise<StepOutcome> {
    // readonly·suspended 는 발행도 멈춘다(P1R4 §1.3) — due 글은 scheduled 그대로 두고(결제하면 이어서 나간다) 센다.
    const w = await requireWritable(ctx.tid);
    if (!w.ok) return { changed: 0, skipped: 0, detail: { blocked: w.reason } };
    // P1R4 §1.5 — 플랜 토글 requireCardBeforePublish: 결제 수단이 없으면 첫 발행을 미룬다(글은 scheduled 그대로 · 알림 1건/일).
    const tp = await tenantPlan(ctx.tid);
    if (requireCardBeforePublish(tp.plan) && !(await activeBillingKey(ctx.tid))) {
      await notifyOnce(ctx.tid, "card_required", "발행 전에 결제 수단을 등록해 주세요", "카드를 등록하면 기다리던 글이 바로 나가요.", "/app/plan.html", { withinHours: 24 });
      return { changed: 0, skipped: 0, detail: { blocked: "card_required" } };
    }
    /* P1R5 §7-2 — 렌더는 **고객 PC** 가 한다. 30분 넘게 집어 갈 러너가 없으면 그 글을 `awaiting_runner` 로 두고
       «내 PC 프로그램을 켜 주세요»를 홈에 띄운다(조용한 정지 금지). 잡은 큐에 그대로 — 켜면 이어서 굽는다.
       비치명: 실패해도 발행 본류를 막지 않는다. */
    const { sweepRenderAwaitingRunner } = await import("../video/render-queue");
    const renderWaiting = await sweepRenderAwaitingRunner(ctx.tid).catch(() => 0);

    const due = await q(sql`SELECT p.id, p.title, p.channel, p.kind, p.account_id, p.slot_id, p.meta, p.scheduled_for, s.status AS slot_status
      FROM pieces p LEFT JOIN slots s ON s.id = p.slot_id
      WHERE p.tenant_id = ${ctx.tid} AND p.status = 'scheduled' AND p.scheduled_for IS NOT NULL AND p.scheduled_for <= NOW()
      ORDER BY p.scheduled_for, p.id LIMIT 50`);
    if (!due.length) return renderWaiting ? { changed: 0, skipped: 0, detail: { renderWaiting } } : { changed: 0, skipped: 0 };

    // 커넥터가 없으면 **아무 것도 건드리지 않는다** — 한 번 크게 남기고 다음 주기로.
    if (await publishPortStatus() === "missing") {
      console.error(`[cron/publisher] tid=${ctx.tid} 발행 커넥터 미연결 — due ${due.length}건을 손대지 않고 미룬다`);
      await writeAudit({ tenantId: ctx.tid, action: "publish_connector_missing", actorType: "system", riskLevel: "high",
        target: `tenant:${ctx.tid}`, detail: { due: due.length, step: "publisher" } });
      /* 🔴 [R17-B2 · B 의 AC-273 «기본값이 자른다» 를 내 쪽에 돌려 잡았다]
         `due` 는 위에서 **`LIMIT 50`** 으로 집은 배열이다. 그 길이를 고객에게 «N건 기다려요»로 말하면,
         60건이 밀려 있을 때 **«50건»이라고 말한다** — 고객은 그게 전부인 줄 안다.
         🔴 빨강이 안 뜨고 **초록이 뜬다**(수가 멀쩡해 보여 아무도 못 알아챈다).
         ⇒ 고객에게 말하는 수는 **따로 센다.** 이 갈래는 «커넥터가 없다»라 드물게만 도니 질의 한 번이 싸다.
         세다 실패하면 **수를 빼고 말한다** — 지어내지 않는다(AC-9). */
      const [tot] = await q(sql`SELECT COUNT(*)::int AS c FROM pieces
        WHERE tenant_id = ${ctx.tid} AND status = 'scheduled' AND scheduled_for IS NOT NULL AND scheduled_for <= NOW()`)
        .catch(() => []);
      const waiting = Number((tot as { c?: unknown } | undefined)?.c ?? 0) || 0;
      await notifyOnce(ctx.tid, "publish_blocked", "발행 준비가 아직 끝나지 않았어요",
        waiting ? `내보낼 글 ${waiting}건이 기다리고 있어요. 준비가 끝나면 자동으로 나가요.`
                : "내보낼 글이 기다리고 있어요. 준비가 끝나면 자동으로 나가요.", "/app/posts.html", { withinHours: 24 });
      return { changed: 0, skipped: due.length, detail: { connector: "missing", due: due.length, waiting } };
    }

    let published = 0, queued = 0, waitingRunner = 0, manual = 0, failed = 0, retry = 0, already = 0, deferred = 0;
    for (const p of due) {
      if (Date.now() >= ctx.deadline) { deferred++; continue; }
      const out = await publishOne(ctx.tid, p, { now: ctx.now, actor: "cron" });
      switch (out.kind) {
        case "published": published++; break;
        case "queued": queued++; break;
        case "publishing": out.offline ? waitingRunner++ : queued++; break;      // 러너 잡 적재 = «큐에 넣었다»(종전 집계와 같은 칸 · 발행 완료가 아니다)
        case "already": already++; break;
        case "unavailable": deferred++; break;                                   // 포트 미연결 — 상태 무접촉(위에서 걸렀지만 경합 대비)
        case "retry": retry++; break;
        case "manual": manual++; break;
        case "failed": failed++; break;
      }
    }

    const out: StepOutcome = { changed: published + queued + waitingRunner + manual + failed, skipped: already + retry + deferred };
    const detail: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ published, queued, waitingRunner, manual, failed, retry, already, deferred, renderWaiting })) if (v) detail[k] = v;
    if (Object.keys(detail).length) out.detail = detail;
    return out;
  },
};
