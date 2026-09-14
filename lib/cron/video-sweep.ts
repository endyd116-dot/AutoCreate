/**
 * lib/cron/video-sweep.ts — 스텝 `video.sweep`(5m · 계약 P1R5 §1.5). **새 Netlify 함수 0** — `cron-tick-5m` 우산의 스텝으로 등록.
 *   AM 원본 교훈: SHORTSBILL 실측 — 첫 실행이 15분에서 흔적 없이 사라지는데 «멈춘 previewing 을 훑는 크론이 0개»였다(그래서 사장님 화면에서 «영원히 안 나온다»).
 *   대상: pieces kind='video' AND status='generating' AND updated_at < now() - 20분.
 *   판정: chainStage 있으면 이어달리기 재디스패치(상한 3) · 없으면 처음부터 · 상한 초과 → failed + 환급 + 알림.
 *   🔴 잠금(meta.chainLock 20분)을 먼저 본다 — 이미 도는 편은 건드리지 않는다. stage 'render' 는 러너 잡이 살아 있으면 건드리지 않는다(reap 이 회수).
 *   회차 상한 5건(비용 폭주 0 · 한 편 재개 = 컷 생성비).
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import { refundPiece } from "../coin-ledger";
import { triggerVideo } from "../video/gen";
import { CHAIN_LOCK_MIN, CHAIN_RESUME_MAX, CHAIN_STALE_MIN } from "../video/types";
import { NOOP, type CronStep, type StepOutcome, type TenantCtx } from "./base";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
/** 한 회차에 손대는 최대 편 수. */
export const SWEEP_MAX = 5;

export const videoSweepStep: CronStep = {
  key: "video.sweep",
  every: "5m",
  // 사람이 만든 영상도 멈추면 주워야 한다 — 자동 편성과 무관(publisher·reap 과 같은 부류).
  needsAutoSchedule: false,
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    const rows = await q(sql`SELECT id, slot_id, meta, updated_at FROM pieces
      WHERE tenant_id = ${ctx.tid} AND kind = 'video' AND status = 'generating'
        AND updated_at < NOW() - (${CHAIN_STALE_MIN} || ' minutes')::interval
      ORDER BY updated_at LIMIT ${SWEEP_MAX}`);
    if (!rows.length) return NOOP;
    let changed = 0, skipped = 0;
    const detail: Record<string, unknown> = { resumed: 0, restarted: 0, failed: 0, locked: 0, rendering: 0 };
    for (const r of rows) {
      if (Date.now() > ctx.deadline) { skipped++; continue; }
      const pieceId = n(r.id); const meta = (r.meta ?? {}) as Record<string, unknown>;
      const lock = meta.chainLock as { at?: string } | null | undefined;
      if (lock?.at && Date.now() - new Date(lock.at).getTime() < CHAIN_LOCK_MIN * 60_000) { detail.locked = n(detail.locked) + 1; skipped++; continue; }
      const stage = String(meta.stage ?? "script");
      if (stage === "render") {
        // 러너가 잡을 들고 있으면 우리 일이 아니다(reap 이 회수 → 그때 다시 이 스텝이 본다).
        const [job] = await q(sql`SELECT id FROM runner_jobs WHERE tenant_id = ${ctx.tid} AND piece_id = ${pieceId} AND kind = 'render.video' AND status IN ('queued','claimed') LIMIT 1`);
        if (job) { detail.rendering = n(detail.rendering) + 1; skipped++; continue; }
      }
      const resume = n((meta.chainResume as { count?: number } | undefined)?.count);
      if (resume >= CHAIN_RESUME_MAX) {
        const refunded = await refundPiece(ctx.tid, pieceId);
        const reason = `제작이 멈춰서 멈춤 처리했어요(마지막 단계: ${stage}).`;
        await q(sql`UPDATE pieces SET status = 'failed', meta = meta || ${jsonb({ stage: "failed", chainLock: null, failReason: reason, refunded })}, updated_at = NOW() WHERE id = ${pieceId}`);
        if (r.slot_id) await q(sql`UPDATE slots SET status = 'failed', note = ${reason}, updated_at = NOW() WHERE id = ${n(r.slot_id)}`);
        await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link) VALUES (${ctx.tid}, ${"piece_failed"}, ${"영상을 만들지 못했어요"}, ${`${reason} 코인 ${refunded}개는 돌려드렸어요.`}, ${"/app/pieces.html?status=failed"})`);
        detail.failed = n(detail.failed) + 1; changed++; continue;
      }
      const hasProgress = !!meta.chainStage;
      await q(sql`UPDATE pieces SET meta = meta || ${jsonb({ chainResume: { count: resume + 1, at: new Date().toISOString() }, chainLock: null })}, updated_at = NOW() WHERE id = ${pieceId}`);
      const fired = await triggerVideo(pieceId, ctx.tid, hasProgress);
      if (fired) { detail[hasProgress ? "resumed" : "restarted"] = n(detail[hasProgress ? "resumed" : "restarted"]) + 1; changed++; }
      else skipped++;
      console.warn(`[video.sweep] tid=${ctx.tid} piece=${pieceId} stage=${stage} ${hasProgress ? "이어달리기" : "처음부터"} ${resume + 1}/${CHAIN_RESUME_MAX} fired=${fired}`);
    }
    return { changed, skipped, detail };
  },
};
