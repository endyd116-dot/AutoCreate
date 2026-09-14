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
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { jsonb, utcDate } from "../db-util";
import { classifyAndApply } from "../account-health";
import { kstTimeText, notifyOnce, setSlot, type CronStep, type StepOutcome } from "./base";
import { publishPiece, publishPortStatus, runnerOffline, type PublishFailReason } from "./publish-port";

const n = (v: unknown) => Number(v || 0);
const MAX_ATTEMPTS = 3;

/** 사람이 손봐야 끝나는 실패 — 재시도해도 같은 답이 온다. */
const NEEDS_HUMAN: ReadonlySet<PublishFailReason> = new Set(["gate", "no_account", "no_creds", "account_blocked", "auth_failed", "provider_not_configured"]);
/** 아예 나갈 수 없는 실패 — 재시도 0. */
const TERMINAL: ReadonlySet<PublishFailReason> = new Set(["unsupported_channel", "not_publishable", "config"]);
/** 실패 사유 → 계정 전이(자격·차단 계열만). 나머지는 계정 잘못이 아니다. */
const ACCOUNT_ERROR_OF: Partial<Record<PublishFailReason, "login_fail" | "account_blocked">> = { auth_failed: "login_fail", no_creds: "login_fail" };

const HUMAN: Record<PublishFailReason, string> = {
  gate: "발행 전 검사에 걸렸어요", no_account: "올릴 계정이 없어요", no_creds: "계정 로그인 정보가 없어요",
  account_blocked: "계정이 막혀 있어요", auth_failed: "로그인이 풀렸어요", provider_not_configured: "채널 연결 설정이 아직이에요",
  channel_error: "채널이 응답하지 않았어요", network: "인터넷 연결 문제였어요",
  unsupported_channel: "아직 지원하지 않는 채널이에요", not_publishable: "지금 상태로는 올릴 수 없어요", config: "서버 설정 문제예요",
};

export const publisherStep: CronStep = {
  key: "publisher",
  every: "5m",
  needsAutoSchedule: false,   // 사람이 손으로 승인한 글도 나가야 한다 — 자동 편성과 무관.
  async run(ctx): Promise<StepOutcome> {
    const due = await q(sql`SELECT p.id, p.title, p.channel, p.account_id, p.slot_id, p.meta, p.scheduled_for, s.status AS slot_status
      FROM pieces p LEFT JOIN slots s ON s.id = p.slot_id
      WHERE p.tenant_id = ${ctx.tid} AND p.status = 'scheduled' AND p.scheduled_for IS NOT NULL AND p.scheduled_for <= NOW()
      ORDER BY p.scheduled_for, p.id LIMIT 50`);
    if (!due.length) return { changed: 0, skipped: 0 };

    // 커넥터가 없으면 **아무 것도 건드리지 않는다** — 한 번 크게 남기고 다음 주기로.
    if (await publishPortStatus() === "missing") {
      console.error(`[cron/publisher] tid=${ctx.tid} 발행 커넥터 미연결 — due ${due.length}건을 손대지 않고 미룬다`);
      await writeAudit({ tenantId: ctx.tid, action: "publish_connector_missing", actorType: "system", riskLevel: "high",
        target: `tenant:${ctx.tid}`, detail: { due: due.length, step: "publisher" } });
      await notifyOnce(ctx.tid, "publish_blocked", "발행 준비가 아직 끝나지 않았어요",
        `내보낼 글 ${due.length}건이 기다리고 있어요. 준비가 끝나면 자동으로 나가요.`, "/app/posts.html", { withinHours: 24 });
      return { changed: 0, skipped: due.length, detail: { connector: "missing", due: due.length } };
    }

    let published = 0, queued = 0, waitingRunner = 0, manual = 0, failed = 0, retry = 0, already = 0, deferred = 0;
    for (const p of due) {
      if (Date.now() >= ctx.deadline) { deferred++; continue; }
      const pieceId = n(p.id), slotId = p.slot_id ? n(p.slot_id) : null;
      const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
      const title = String(p.title || "글");

      const r = await publishPiece(ctx.tid, pieceId, { slotId });

      if (r.ok) {
        if (r.already) { already++; continue; }                 // 멱등 — 이미 나갔다. 아무 것도 쓰지 않는다.
        if (r.via === "api") {
          // B2 가 finalizePublish 까지 끝냈다(계약 §10). 우리가 슬롯을 또 쓰지 않는다.
          published++;
          if (!r.finalized) console.warn(`[cron/publisher] piece=${pieceId} via=api 인데 finalized 가 없다 — B2 종결 여부 확인 필요`);
          continue;
        }
        // via = runner — 잡이 큐에 들어갔다. 여기까지가 우리 몫이고, 그 뒤 상태는 B2 가 쓴다.
        const offline = runnerOffline(r.runner);
        await q(sql`UPDATE pieces SET status = 'publishing', updated_at = NOW() WHERE tenant_id = ${ctx.tid} AND id = ${pieceId} AND status = 'scheduled'`);
        if (slotId) await setSlot(ctx.tid, slotId, offline ? "awaiting_runner" : "publishing", offline ? "내 PC 프로그램이 꺼져 있어요 — 켜면 바로 나가요" : null);
        if (offline) {
          waitingRunner++;
          const when = kstTimeText(utcDate(p.scheduled_for), ctx.now);   // 문구 속 시각은 KST(§13.5)
          await notifyOnce(ctx.tid, "runner_offline", "내 PC 프로그램을 켜 주세요",
            `«${title}»${when ? ` 은(는) ${when}에 나갈 예정이었어요.` : " 을(를) 올리려면"} 내 PC 프로그램이 켜져 있어야 해요. 켜면 기다리던 글이 바로 나가요.`, "/app/runner.html", { withinHours: 6 });
        } else queued++;
        continue;
      }

      // ── 실패 ──
      if (r.unavailable) { deferred++; continue; }   // 포트 미연결(위에서 걸렀지만 경합 대비) — 상태 무접촉.
      const reason = r.reason;
      const attempts = n(meta.publishAttempts) + 1;

      // 자격·차단 계열은 계정 장부에도 남긴다(같은 계정으로 계속 때리지 않게 · §7.2).
      const ak = ACCOUNT_ERROR_OF[reason];
      if (ak && p.account_id) await classifyAndApply(n(p.account_id), ak === "account_blocked" ? "suspended" : "login_fail", { tenantId: ctx.tid, pieceId, detail: r.error });

      /* 🔴 `retriable:false` 는 사유가 무엇이든 **무조건** 존중한다(B2 2026-09-14).
         가장 무서운 경우: 발행은 성공했는데 finalize 가 실패한 건도 `{ ok:false, reason:"config", retriable:false }` 로 온다 —
         이걸 재시도하면 **남의 블로그에 같은 글이 두 번 올라간다**(되돌릴 수 없는 사고). B2 가 publish_finalize_failed(risk high) 를 이미 남긴다. */
      const terminal = TERMINAL.has(reason) || r.retriable === false;
      const human = NEEDS_HUMAN.has(reason);
      const exhausted = !terminal && !human && attempts > MAX_ATTEMPTS;

      if (!terminal && !human && !exhausted) {
        // 다음 5분 틱이 다시 본다 — 상태는 scheduled 그대로 두고 횟수만 센다.
        retry++;
        await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ publishAttempts: attempts, lastPublishError: `${reason}: ${r.error}`.slice(0, 300) })}, updated_at = NOW()
          WHERE tenant_id = ${ctx.tid} AND id = ${pieceId}`);
        continue;
      }

      const next = terminal ? "failed" : "awaiting_manual";
      const why = HUMAN[reason] ?? "발행에 실패했어요";
      await q(sql`UPDATE pieces SET status = ${next}, meta = meta || ${jsonb({ publishAttempts: attempts, failReason: `${why} (${reason})`, lastPublishError: String(r.error).slice(0, 300) })}, updated_at = NOW()
        WHERE tenant_id = ${ctx.tid} AND id = ${pieceId}`);
      if (slotId) await setSlot(ctx.tid, slotId, next === "failed" ? "failed" : "awaiting_manual", why);
      if (next === "failed") failed++; else manual++;
      await notifyOnce(ctx.tid, next === "failed" ? "publish_failed" : "publish_manual",
        next === "failed" ? "글을 올리지 못했어요" : "직접 올려 주셔야 해요",
        `«${title}» — ${why}. 발행함에서 본문을 복사해 직접 올리거나, 문제를 고치고 다시 시도해 주세요.`,
        `/app/posts.html?status=${next === "failed" ? "failed" : "awaiting_manual"}`, { withinHours: 6 });
      await writeAudit({ tenantId: ctx.tid, action: "publish_failed", actorType: "system", riskLevel: "medium", target: `piece:${pieceId}`,
        detail: { reason, attempts, retriable: r.retriable, to: next, error: String(r.error).slice(0, 300), slotId } });
    }

    const out: StepOutcome = { changed: published + queued + waitingRunner + manual + failed, skipped: already + retry + deferred };
    const detail: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ published, queued, waitingRunner, manual, failed, retry, already, deferred })) if (v) detail[k] = v;
    if (Object.keys(detail).length) out.detail = detail;
    return out;
  },
};
