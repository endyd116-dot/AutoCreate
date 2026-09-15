/**
 * lib/retract-port.ts — 🔴 **B ↔ B2 경계**: «올라간 글 내리기»(DESIGN §5E.1-② · `publish.retract`).
 *   잡(채널별 삭제 핸들러·러너 스크립트)은 **B2 몫**이다. B 는 «누가 언제 부를 수 있나»(통지 대응 §5E.2)만 안다.
 *   🔴 B2 가 아직 `publish.retract` 를 만들지 않았으면 **`unavailable`**(정직) — 화면은 «직접 내려 주세요 + 그 글 링크»로 받는다.
 *      🔴 **없는 길을 단추로 만들지 않는다**(DESIGN §5E.3 · 티스토리 «떼기»에서 배운 것).
 *   멱등: 이미 내려간 글에 또 걸어도 «없음»이 성공이다(그건 B2 잡의 규율 · 여기서는 같은 잡을 두 번 안 넣는다 — enqueueJob 이 dedupe).
 */
import { RUNNER_JOB_KINDS, enqueueJob, type RunnerJobKind } from "./runner-jobs";

const RETRACT_KIND = "publish.retract" as const;
/** B2 의 잡 어휘에 `publish.retract` 가 들어왔나 — 들어오면 그날부터 «대신 내려 주기»가 열린다(코드 변경 0). */
export function retractAvailable(): boolean { return (RUNNER_JOB_KINDS as readonly string[]).includes(RETRACT_KIND); }

export type RetractResult = { ok: true; jobId: number; already?: boolean } | { ok: false; unavailable?: boolean; error?: string };
/** 그 글을 내려 달라(또는 `verifyOnly` = 정말 내려갔는지만 확인). 코인 0 · 실패는 던지지 않는다. */
export async function enqueueRetract(tid: number, inp: { pieceId: number; accountId?: number | null; verifyOnly?: boolean }): Promise<RetractResult> {
  const kind: string = inp.verifyOnly ? "verify.post_alive" : RETRACT_KIND;
  if (!(RUNNER_JOB_KINDS as readonly string[]).includes(kind)) return { ok: false, unavailable: true };
  try {
    const r = await enqueueJob({ tenantId: tid, kind: kind as RunnerJobKind, pieceId: inp.pieceId, accountId: inp.accountId ?? null,
      payload: { reason: "takedown", verifyOnly: inp.verifyOnly === true }, priority: 1 });
    return { ok: true, jobId: r.id, ...(r.created ? {} : { already: true }) };
  } catch (e) { return { ok: false, error: String((e as Error)?.message ?? e).slice(0, 200) }; }
}
