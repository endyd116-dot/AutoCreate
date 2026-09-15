/**
 * lib/publish-one.ts — «한 건 내보내기» **한 곳**(계약 P1R8 §4.2 · 종전 `lib/cron/publisher.ts` 안에 있던 몸통을 그대로 꺼냈다).
 *
 *   왜 꺼냈나: 고객이 «지금 올려»를 누르는 길(`/api/publish-now`)과 5분 크론이 **같은 규칙**으로 나가야 한다.
 *   두 벌로 두면 한쪽만 고쳐져 갈라진다(같은 글이 크론으로는 `awaiting_manual`, 손으로는 `failed` 가 되는 식).
 *   그래서 **상태를 쓰는 규칙·실패 분기·문구는 여기 하나**이고, 크론과 API 는 이 함수를 부르기만 한다.
 *
 *   ══ 하는 일 ══ due 한 건마다 `publishPiece()` 하나를 부르고 그 결과를 상태·알림·감사로 옮긴다(러너/API 판단·자격·최종 게이트는 전부 B2 안 · 계약 §10).
 *   ══ 상태를 쓰는 자리 ══ ① `via:"runner"` → piece·slot `publishing`(러너 오프라인이면 슬롯만 `awaiting_runner` — 발행 취소가 아니다)
 *      ② 실패 분기(gate·no_account… → `awaiting_manual` + 알림 / channel_error·network → 재시도 / unsupported·config → `failed`)
 *      `via:"api"` + `finalized` 는 B2 가 이미 썼다 → 건드리지 않는다.
 *   🔴 `unavailable`(포트 미연결)은 **아무 상태도 쓰지 않는다** — «아직 못 물어봤다»(config=failed 로 접으면 due 글이 전부 죽는다).
 *   🔎 출처: AC 신규(P1R2-B 의 publisher 몸통 → P1R8-B §4.2 에서 분리 · 2026-09-15).
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";
import { writeAudit } from "./audit";
import { backgroundBase } from "./site-url";
import { jsonb, utcDate } from "./db-util";
import { classifyAndApply } from "./account-health";
import { kstTimeText, notifyOnce, setSlot } from "./cron/base";
import { publishPiece, runnerOffline, type PublishFailReason } from "./cron/publish-port";

const n = (v: unknown) => Number(v || 0);
export const MAX_ATTEMPTS = 3;

/** [P1R5 B-1] 영상 업로드 배경 함수 호출(202) — 실패는 호출부가 awaiting_manual 로 종결한다(조용한 0건 금지). */
export async function triggerVideoPublish(tid: number, pieceId: number, slotId: number | null): Promise<boolean> {
  const secret = String(process.env.INTERNAL_SECRET ?? "").trim();
  if (!secret) { console.error("[publish-one] INTERNAL_SECRET 미설정 — 영상 업로드 호출 불가"); return false; }
  /* 🔴 AC-53 — 자기 호출은 **«지금 돌고 있는 이 배포»**로 가야 한다(로컬에서 라이브 배경 함수를 부르면 진짜 돈이 나간다). */
  let site: string;
  try { site = backgroundBase(); }
  catch (e) { console.error(`[publish-one] 배경 호출 주소 거부 — ${String((e as Error)?.message ?? e)}`); return false; }
  try {
    const r = await fetch(`${site}/api/publish-video-background`, { method: "POST", headers: { "Content-Type": "application/json", "x-internal-secret": secret }, body: JSON.stringify({ pieceId, tenantId: tid, ...(slotId ? { slotId } : {}) }), signal: AbortSignal.timeout(6_000) });
    if (r.status !== 202 && !r.ok) { console.error(`[publish-one] 영상 업로드 배경 함수 ${r.status}`); return false; }
    return true;
  } catch (e) {
    const err = e as Error;
    if (err?.name === "TimeoutError" || err?.name === "AbortError") return true;   // netlify dev 는 background 를 동기 실행(AC-12)
    console.error("[publish-one] 영상 업로드 호출 실패", String(err?.message ?? e));
    return false;
  }
}

/** 사람이 손봐야 끝나는 실패 — 재시도해도 같은 답이 온다. */
export const NEEDS_HUMAN: ReadonlySet<PublishFailReason> = new Set(["gate", "no_account", "no_creds", "account_blocked", "auth_failed", "provider_not_configured"]);
/** 아예 나갈 수 없는 실패 — 재시도 0. */
export const TERMINAL: ReadonlySet<PublishFailReason> = new Set(["unsupported_channel", "not_publishable", "config"]);
/** 실패 사유 → 계정 전이(자격·차단 계열만). 나머지는 계정 잘못이 아니다. */
const ACCOUNT_ERROR_OF: Partial<Record<PublishFailReason, "login_fail" | "account_blocked">> = { auth_failed: "login_fail", no_creds: "login_fail" };

export const HUMAN: Record<PublishFailReason, string> = {
  gate: "발행 전 검사에 걸렸어요", no_account: "올릴 계정이 없어요", no_creds: "계정 로그인 정보가 없어요",
  account_blocked: "계정이 막혀 있어요", auth_failed: "로그인이 풀렸어요", provider_not_configured: "채널 연결 설정이 아직이에요",
  channel_error: "채널이 응답하지 않았어요", network: "인터넷 연결 문제였어요",
  // 실패가 아니라 «아직 처리 중» — 다음 틱에 같은 컨테이너로 다시 올린다(중복 게시 0).
  video_processing: "영상을 채널이 아직 처리하고 있어요",
  unsupported_channel: "아직 지원하지 않는 채널이에요", not_publishable: "지금 상태로는 올릴 수 없어요", config: "서버 설정 문제예요",
};

/** 내보내기 한 건의 결과 — 크론은 세고, API 는 사람말로 바꿔 돌려준다. */
export type PublishOneOutcome =
  | { kind: "published"; finalized: boolean }
  | { kind: "queued" }                                   // 영상 배경 업로드로 넘겼다
  | { kind: "publishing"; offline: false }               // 러너 잡 적재(온라인)
  | { kind: "publishing"; offline: true }                // 러너 잡 적재(오프라인 — 켜면 나간다)
  | { kind: "already" }                                  // 멱등 — 이미 나갔다
  | { kind: "unavailable" }                              // 커넥터 미연결 — 아무 상태도 안 썼다
  | { kind: "retry"; reason: PublishFailReason; error: string; attempts: number }
  | { kind: "manual"; reason: PublishFailReason; why: string; error: string }
  | { kind: "failed"; reason: PublishFailReason; why: string; error: string };

/** DB 한 행 그대로 받는다(크론의 SELECT · API 의 SELECT 가 같은 칸을 준다). 칸 이름만 맞으면 된다. */
export type PublishOneRow = Record<string, unknown>;

/**
 * publishOne — 이 글 한 건을 내보낸다(크론·«지금 올리기» 공용).
 *   `actor`: "cron" | "user" — 감사·알림 문구는 같고, 부른 쪽만 기록에 남는다.
 *   🔴 이 함수는 **상태를 자기가 쓴다**(위 표) — 호출부는 세거나 사람말로 옮기기만 한다.
 */
export async function publishOne(tid: number, p: PublishOneRow, opts: { now?: Date; actor?: "cron" | "user" } = {}): Promise<PublishOneOutcome> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "cron";
  const pieceId = n(p.id), slotId = p.slot_id ? n(p.slot_id) : null;
  const meta = (p.meta && typeof p.meta === "object" ? p.meta : {}) as Record<string, unknown>;
  const title = String(p.title || "글");

  /* [P1R5 B-1] 영상 = 배경 업로드로 넘긴다(동기 26초 안에 mp4 를 못 올린다). 호출 실패는 삼키지 않는다(AC-16). */
  if (String(p.kind) === "video") {
    const fired = await triggerVideoPublish(tid, pieceId, slotId);
    if (fired) {
      await q(sql`UPDATE pieces SET status = 'publishing', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId} AND status IN ('scheduled', 'approved')`);
      if (slotId) await setSlot(tid, slotId, "publishing", null);
      return { kind: "queued" };
    }
    await q(sql`UPDATE pieces SET status = 'awaiting_manual', meta = meta || ${jsonb({ publishFail: { reason: "config", error: "업로드를 시작하지 못했어요(서버 설정)." } })}, updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId} AND status IN ('scheduled', 'approved')`);
    if (slotId) await setSlot(tid, slotId, "awaiting_manual", "업로드를 시작하지 못했어요");
    await notifyOnce(tid, "publish_manual", "영상 업로드에 손이 필요해요", `«${title}» 업로드를 시작하지 못했어요.`, "/app/posts.html", { withinHours: 6 });
    return { kind: "manual", reason: "config", why: "업로드를 시작하지 못했어요", error: "배경 함수 호출 실패" };
  }

  const r = await publishPiece(tid, pieceId, { slotId, actor });

  if (r.ok) {
    if (r.already) return { kind: "already" };              // 멱등 — 이미 나갔다. 아무 것도 쓰지 않는다.
    if (r.via === "api") {
      // B2 가 finalizePublish 까지 끝냈다(계약 §10). 우리가 슬롯을 또 쓰지 않는다.
      if (!r.finalized) console.warn(`[publish-one] piece=${pieceId} via=api 인데 finalized 가 없다 — B2 종결 여부 확인 필요`);
      return { kind: "published", finalized: r.finalized === true };
    }
    // via = runner — 잡이 큐에 들어갔다. 여기까지가 우리 몫이고, 그 뒤 상태는 B2 가 쓴다.
    const offline = runnerOffline(r.runner);
    await q(sql`UPDATE pieces SET status = 'publishing', updated_at = NOW() WHERE tenant_id = ${tid} AND id = ${pieceId} AND status IN ('scheduled', 'approved')`);
    if (slotId) await setSlot(tid, slotId, offline ? "awaiting_runner" : "publishing", offline ? "내 PC 프로그램이 꺼져 있어요 — 켜면 바로 나가요" : null);
    if (offline) {
      const when = kstTimeText(utcDate(p.scheduled_for), now);   // 문구 속 시각은 KST(§13.5)
      await notifyOnce(tid, "runner_offline", "내 PC 프로그램을 켜 주세요",
        `«${title}»${when ? ` 은(는) ${when}에 나갈 예정이었어요.` : " 을(를) 올리려면"} 내 PC 프로그램이 켜져 있어야 해요. 켜면 기다리던 글이 바로 나가요.`, "/app/runner.html", { withinHours: 6 });
      return { kind: "publishing", offline: true };
    }
    return { kind: "publishing", offline: false };
  }

  // ── 실패 ──
  if (r.unavailable) return { kind: "unavailable" };   // 포트 미연결 — 상태 무접촉.
  const reason = r.reason;
  const attempts = n(meta.publishAttempts) + 1;

  // 자격·차단 계열은 계정 장부에도 남긴다(같은 계정으로 계속 때리지 않게 · §7.2).
  const ak = ACCOUNT_ERROR_OF[reason];
  if (ak && p.account_id) await classifyAndApply(n(p.account_id), ak === "account_blocked" ? "suspended" : "login_fail", { tenantId: tid, pieceId, detail: r.error });

  /* 🔴 `retriable:false` 는 사유가 무엇이든 **무조건** 존중한다(B2 2026-09-14).
     가장 무서운 경우: 발행은 성공했는데 finalize 가 실패한 건도 `{ ok:false, reason:"config", retriable:false }` 로 온다 —
     이걸 재시도하면 **남의 블로그에 같은 글이 두 번 올라간다**(되돌릴 수 없는 사고). */
  const human = NEEDS_HUMAN.has(reason);
  const terminal = TERMINAL.has(reason) || (r.retriable === false && !human);
  const exhausted = !terminal && !human && attempts > MAX_ATTEMPTS;

  if (!terminal && !human && !exhausted) {
    // 다음 5분 틱이 다시 본다 — 상태는 scheduled 그대로 두고 횟수만 센다.
    await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ publishAttempts: attempts, lastPublishError: `${reason}: ${r.error}`.slice(0, 300) })}, updated_at = NOW()
      WHERE tenant_id = ${tid} AND id = ${pieceId}`);
    return { kind: "retry", reason, error: String(r.error), attempts };
  }

  const next = terminal ? "failed" : "awaiting_manual";
  /* 🔴 «계정이 없다»가 **두 가지 다른 상황**이다(P1R7 §1.2 이후): 글 = 계정을 연결하지 않은 것 · 영상 = 일부러 계정 없이 만든 것.
     같은 reason 에 같은 문구를 주면 영상 고객은 하지 않아도 될 일을 하러 간다. */
  const why = (reason === "no_account" && String(p.kind) === "video")
    ? "앱에서 직접 올려 주세요 — 영상을 내려받아 올리면 돼요"
    : HUMAN[reason] ?? "발행에 실패했어요";
  await q(sql`UPDATE pieces SET status = ${next}, meta = meta || ${jsonb({ publishAttempts: attempts, failReason: `${why} (${reason})`, lastPublishError: String(r.error).slice(0, 300) })}, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${pieceId}`);
  if (slotId) await setSlot(tid, slotId, next === "failed" ? "failed" : "awaiting_manual", why);
  await notifyOnce(tid, next === "failed" ? "publish_failed" : "publish_manual",
    next === "failed" ? "글을 올리지 못했어요" : "직접 올려 주셔야 해요",
    // 영상은 «본문을 복사해» 가 말이 안 된다 — 할 일이 내려받아 올리기다.
    `«${title}» — ${why}. ${String(p.kind) === "video" ? "발행함에서 영상을 내려받아 올리고, 올린 주소를 적어 주세요." : "발행함에서 본문을 복사해 직접 올리거나, 문제를 고치고 다시 시도해 주세요."}`,
    `/app/posts.html?status=${next === "failed" ? "failed" : "awaiting_manual"}`, { withinHours: 6 });
  await writeAudit({ tenantId: tid, action: "publish_failed", actorType: actor === "user" ? "user" : "system", riskLevel: "medium", target: `piece:${pieceId}`,
    detail: { reason, attempts, retriable: r.retriable, to: next, error: String(r.error).slice(0, 300), slotId, actor } });
  return next === "failed"
    ? { kind: "failed", reason, why, error: String(r.error) }
    : { kind: "manual", reason, why, error: String(r.error) };
}
