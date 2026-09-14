/**
 * lib/video/render-queue.ts — 렌더 큐 경계(계약 P1R5 §5 · B2 소유 · **B 가 `enqueueRender` 를 부른다**).
 *
 *   두 함수만 밖으로 낸다(글자 그대로):
 *     enqueueRender(pieceId, payload)  → { jobId, created }        // B(배경 함수)가 clips 를 다 만든 뒤 부른다
 *     finalizeRender(pieceId, report)  → { ok, next, retry }       // B2 reportJob 이 **R2 HEAD 확인 뒤** 부른다
 *
 *   🔴 상태를 쓰는 자리 분담(§5 · R2 §10 «두 곳에서 상태를 쓰지 않는다»):
 *      생성(script~clips) = B 배경 함수 · **render 이후 = 이 파일 한 벌** · 발행 = `finalizePublish`.
 *      그래서 piece 상태·`piece_assets(video/thumb)`·`meta.chainStage` 를 렌더 뒤에 쓰는 곳은 여기뿐이다.
 *   🔴 AC-17 순환 0 — 이 파일이 `runner-jobs` 를 import 하는 **한 방향**만 있다.
 *      `runner-jobs.reportJob` 은 반대로 이 파일을 **함수 안에서 동적으로** 부른다(정적이면 순환).
 *   🔴 멱등 — piece 당 열린 `render.video` 는 1개(enqueueJob dedupe) · 같은 key 로 두 번 finalize 해도 자산이 겹치지 않는다.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { writeAudit } from "../audit";
import { enqueueJob, type RunnerPayload, type RunnerJobKind } from "../runner-jobs";
/* 🔴 타입 정본은 B-1 의 `lib/video/types.ts` 한 곳(A 도 같은 파일을 본다). 여기서 다시 정의하지 않는다. */
import { RENDER_MAX_RETRY, type RenderPayload, type RenderReport, type JudgeResult } from "./types";
export type { RenderPayload, RenderReport } from "./types";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 잡 kind·우선순위 정본(B-1 이 이 이름으로 참조한다 · 계약 §2.1). */
export const RENDER_JOB_KIND: RunnerJobKind = "render.video";
export const RENDER_JOB_PRIORITY = 70;

/* 다시 구울 수 있는 횟수는 정본 상수(`RENDER_MAX_RETRY`)를 쓴다 — 두 벌이면 B 와 판정이 갈라진다. */
/** 이보다 짧거나 작으면 «구웠다»를 믿지 않는다(빈 mp4·헤더만 있는 파일 방어). */
const MIN_DURATION_MS = 1_000;
const MIN_BYTES = 50 * 1024;

export type RenderNext = "judging" | "requeued" | "in_review" | "failed";

/**
 * 렌더 잡 적재(B → B2). 멱등: piece 당 살아 있는 `render.video` 가 있으면 그 잡 id 를 돌려준다.
 *   payload.tenantId 로 테넌트를 잡는다(시그니처에 tid 를 더 받지 않는다 — §5 글자 그대로).
 */
export async function enqueueRender(pieceId: number, payload: RenderPayload): Promise<{ jobId: number; created: boolean }> {
  const tenantId = n(payload?.tenantId);
  if (!tenantId) throw new Error("[render-queue] payload.tenantId 가 없어요.");
  const j = await enqueueJob({
    tenantId, kind: RENDER_JOB_KIND, pieceId,
    payload: payload as unknown as RunnerPayload,
    dedupe: true,
  });
  // 화면이 «지금 굽는 중»을 그릴 수 있게 단계와 잡 id 를 남긴다(B-1 계약: meta.stage='render' · renderJobId).
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ stage: "render", chainStage: "render", renderJobId: j.id })}, updated_at = NOW()
    WHERE id = ${pieceId} AND tenant_id = ${tenantId}`);
  if (j.created) {
    await writeAudit({ tenantId, action: "render_enqueued", actorType: "system", target: `piece:${pieceId}`,
      detail: { jobId: j.id, scenes: payload.scenes?.length ?? 0, seconds: payload.out?.maxSeconds ?? null }, riskLevel: "low" });
    /* 🔴 적재하는 지금 이미 러너가 없다면 **그 자리에서** 말한다(§7-2). 30분을 기다렸다 말하면
       고객은 그동안 «왜 안 되지»만 겪는다. 잡은 큐에 그대로 둔다 — 켜면 바로 이어 굽는다. */
    const why = await offlineReason(tenantId).catch(() => null);
    if (why) await markAwaitingRunner(tenantId, pieceId, why);
  }
  return { jobId: j.id, created: j.created };
}

/**
 * B-1 의 심사(`lib/video/judge.ts judgeVideo`) — **함수 안 동적 import**(AC-17 순환 0 · 메인 정리).
 *   실물이 들어와 지정자를 리터럴로 되돌렸다 → 타입까지 검사된다(`JudgeResult` 정본 사용).
 *   🔴 호출이 터져도 **null** — «판정했다»고 꾸미지 않는다. 호출부가 `chainStage="judging"` 에서 멈춘다(가짜 통과 0).
 */
async function tryJudge(pieceId: number): Promise<JudgeResult | null> {
  try {
    const { judgeVideo } = await import("./judge");
    return await judgeVideo(pieceId);
  } catch (e) {
    console.error("[render-queue] judgeVideo 실패", String((e as Error)?.message ?? e).slice(0, 160));
    return null;
  }
}

/**
 * 렌더 결과 확정. 호출 전에 **reportJob 이 R2 HEAD 로 파일 실존을 확인**했다(여기선 크기·길이 상식 검사만 한다).
 *   next: judging(심사 대기) · in_review(통과 → 사람 검수) · requeued(다시 굽기) · failed(포기).
 */
export async function finalizeRender(pieceId: number, report: RenderReport): Promise<{ ok: boolean; next: RenderNext; retry: number; reason?: string }> {
  const [p] = await q(sql`SELECT id, tenant_id, status, meta FROM pieces WHERE id = ${pieceId} LIMIT 1`);
  if (!p) return { ok: false, next: "failed", retry: 0, reason: "piece_not_found" };
  const tid = n(p.tenant_id);
  const meta = (p.meta && typeof p.meta === "object" ? { ...(p.meta as Record<string, unknown>) } : {}) as Record<string, unknown>;
  const retry = n(meta.renderRetry);

  /* ① 상식 검사 — 파일은 있는데 «빈 영상»인 경우(인코딩이 중간에 끊겼다). 다시 굽는다. */
  if (report.durationMs < MIN_DURATION_MS || report.bytes < MIN_BYTES) {
    const nextRetry = retry + 1;
    const giveUp = nextRetry > RENDER_MAX_RETRY;
    await q(sql`UPDATE pieces SET status = ${giveUp ? "failed" : String(p.status)},
        meta = meta || ${jsonb({ renderRetry: nextRetry, chainStage: giveUp ? "failed" : "render", failReason: giveUp ? "영상이 계속 비어 있어요(인코딩 실패)" : undefined })},
        updated_at = NOW() WHERE id = ${pieceId}`);
    await writeAudit({ tenantId: tid, action: "render_too_small", actorType: "system", target: `piece:${pieceId}`,
      detail: { durationMs: report.durationMs, bytes: report.bytes, retry: nextRetry, giveUp }, riskLevel: "high" });
    if (!giveUp) await requeueRender(tid, pieceId);
    return { ok: false, next: giveUp ? "failed" : "requeued", retry: nextRetry, reason: "empty_render" };
  }

  /* ② 자산 기록 — 같은 piece 의 이전 video/thumb 는 지우고 새로 넣는다(재렌더 시 중복 방지 · 멱등). */
  await q(sql`DELETE FROM piece_assets WHERE tenant_id = ${tid} AND piece_id = ${pieceId} AND kind IN ('video','thumb')`);
  await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort)
    VALUES (${tid}, ${pieceId}, 'video', ${report.key.slice(0, 240)},
            ${jsonb({ durationMs: report.durationMs, bytes: report.bytes, frameCount: report.frameCount })}, 0)`);
  if (report.posterKey) {
    await q(sql`INSERT INTO piece_assets (tenant_id, piece_id, kind, r2_key, meta, sort)
      VALUES (${tid}, ${pieceId}, 'thumb', ${report.posterKey.slice(0, 240)}, ${jsonb({ from: "render" })}, 1)`);
  }

  /* ③ 심사 — 통과해야 사람 검수(in_review)로 간다. 아직 심사기가 없으면 «judging» 에서 정직하게 멈춘다. */
  await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ chainStage: "judging", render: { key: report.key, posterKey: report.posterKey || null, durationMs: report.durationMs, bytes: report.bytes, frameCount: report.frameCount } })},
      updated_at = NOW() WHERE id = ${pieceId}`);

  const judged = await tryJudge(pieceId);
  if (!judged) {
    await writeAudit({ tenantId: tid, action: "render_done", actorType: "system", target: `piece:${pieceId}`,
      detail: { key: report.key, durationMs: report.durationMs, bytes: report.bytes, judge: "pending(심사기 미배선)" }, riskLevel: "low" });
    return { ok: true, next: "judging", retry, reason: "judge_unavailable" };
  }

  if (judged.grade === "P0" || !judged.pass) {
    const nextRetry = retry + 1;
    const giveUp = judged.grade === "P0" || nextRetry > RENDER_MAX_RETRY;   // P0(정책 위반)은 다시 굽지 않는다
    await q(sql`UPDATE pieces SET status = ${giveUp ? "failed" : String(p.status)},
        meta = meta || ${jsonb({ renderRetry: nextRetry, chainStage: giveUp ? "failed" : "render", judgeGrade: judged.grade, failReason: giveUp ? (judged.grade === "P0" ? "정책에 어긋나는 영상이라 올리지 않았어요" : "영상 품질이 기준에 못 미쳐요") : undefined })},
        updated_at = NOW() WHERE id = ${pieceId}`);
    await writeAudit({ tenantId: tid, action: "render_judge_failed", actorType: "system", target: `piece:${pieceId}`,
      detail: { grade: judged.grade, retry: nextRetry, giveUp }, riskLevel: "high" });
    if (!giveUp) await requeueRender(tid, pieceId);
    return { ok: false, next: giveUp ? "failed" : "requeued", retry: nextRetry, reason: `judge_${judged.grade}` };
  }

  await q(sql`UPDATE pieces SET status = 'in_review',
      meta = meta || ${jsonb({ chainStage: "done", judgeGrade: judged.grade, judgeRepaired: !!judged.repaired })},
      updated_at = NOW() WHERE id = ${pieceId}`);
  await writeAudit({ tenantId: tid, action: "render_done", actorType: "system", target: `piece:${pieceId}`,
    detail: { key: report.key, durationMs: report.durationMs, grade: judged.grade }, riskLevel: "low" });
  return { ok: true, next: "in_review", retry };
}

/* ───────── 러너가 꺼져 있을 때(계약 §7-2 · R2 규칙 그대로) ─────────
 *   렌더는 **고객 PC** 가 해야 한다. 그 PC 가 꺼져 있으면 잡은 큐에 남고 아무 일도 일어나지 않는다 —
 *   그 상태를 **말하지 않으면** 고객은 «영상이 안 만들어진다»만 겪는다(조용한 정지 금지 · PITFALLS #7).
 *   그래서 30분 넘게 집어 갈 러너가 없으면 그 글을 `awaiting_runner` 로 두고 홈 «해야 할 일»에 띄운다.
 *   잡은 **큐에 그대로 둔다** — 러너를 켜면 바로 이어서 굽는다(취소가 아니다).
 */
const RUNNER_WAIT_MIN = 30;

/** 지금 이 테넌트에 잡을 집어 갈 러너가 있나. 없으면 사람말 사유. */
async function offlineReason(tid: number): Promise<string | null> {
  const { fleetState } = await import("../runner-jobs");   // AC-17 경계는 함수 안에서
  const f = await fleetState(tid);
  if (!f.devices) return "내 PC 프로그램이 아직 연결되지 않았어요";
  if (!f.online && (f.offlineMin ?? 999) >= RUNNER_WAIT_MIN) return "내 PC 프로그램이 꺼져 있어요";
  return null;
}

async function markAwaitingRunner(tid: number, pieceId: number, why: string): Promise<void> {
  const r = await q(sql`UPDATE pieces SET status = 'awaiting_runner',
      meta = meta || ${jsonb({ failReason: `${why} — 켜 두시면 이어서 영상을 만들어요` })}, updated_at = NOW()
    WHERE tenant_id = ${tid} AND id = ${pieceId} AND status <> 'awaiting_runner' RETURNING id`);
  if (!r.length) return;   // 이미 그 상태 — 알림을 두 번 보내지 않는다
  const { notifyRunnerNeeded } = await import("./render-notify");
  await notifyRunnerNeeded(tid, why);
  await writeAudit({ tenantId: tid, action: "render_awaiting_runner", actorType: "system", target: `piece:${pieceId}`,
    detail: { why }, riskLevel: "medium" });
}

/**
 * 30분 넘게 기다린 렌더 잡을 훑어 «러너 꺼짐»을 알린다. 5분 틱(publisher)에서 부른다.
 *   멱등 — 이미 awaiting_runner 인 글은 건너뛴다(알림 1회).
 */
export async function sweepRenderAwaitingRunner(tid: number): Promise<number> {
  const stuck = await q(sql`SELECT id, piece_id FROM runner_jobs
    WHERE tenant_id = ${tid} AND kind = 'render.video' AND status = 'queued'
      AND created_at <= NOW() - (${RUNNER_WAIT_MIN} * INTERVAL '1 minute')
      AND piece_id IS NOT NULL`);
  if (!stuck.length) return 0;
  const why = await offlineReason(tid);
  if (!why) return 0;   // 러너는 살아 있다 — 단지 아직 못 집었을 뿐(우선순위·타임박스)
  let marked = 0;
  for (const j of stuck) { await markAwaitingRunner(tid, n(j.piece_id), why); marked++; }
  return marked;
}

/** 같은 payload 로 다시 굽는다 — 직전 렌더 잡의 payload 를 그대로 쓴다(B 에게 되묻지 않는다). */
async function requeueRender(tid: number, pieceId: number): Promise<void> {
  const [prev] = await q(sql`SELECT payload FROM runner_jobs
    WHERE tenant_id = ${tid} AND piece_id = ${pieceId} AND kind = 'render.video'
    ORDER BY id DESC LIMIT 1`);
  const payload = prev?.payload && typeof prev.payload === "object" ? prev.payload as RenderPayload : null;
  if (!payload) return;   // payload 를 잃었으면 조용히 다시 굽지 않는다(B 의 스위퍼가 본다)
  await enqueueRender(pieceId, payload).catch((e) => console.error("[render-queue] 재적재 실패", String((e as Error)?.message ?? e).slice(0, 120)));
}
