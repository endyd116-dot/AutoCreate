/**
 * lib/cron/reuse-schedule.ts — 스텝 `reuse.schedule`(hourly · R18 «한 번 만들어 여러 곳에» · B2 · 2026-09-26). **새 Netlify 함수 0**.
 *
 *   ══ 왜 ══
 *     파생은 B `deriveVideoPieces` 끝에서 바로 얹힌다(«B2 SEAM»). 그런데 거기서 못 얹는 경우가 셋 있다 —
 *       ① 그날 몫이 14일 내내 차 있었다(`scheduleDerived` 가 «기다린다»고 알렸다) ② 계정이 잠깐 못 쓰는 상태였다 ③ 얹는 도중 오류.
 *     그대로 두면 파생은 «예약됨 · 시각 없음»으로 **영영 머문다** — 발행 크론은 `scheduled_for IS NOT NULL` 만 줍는다.
 *     = 조용한 0건(PITFALLS #7). ⇒ 매시 한 번 **시각 없는 파생**을 줍는다(B 계약 v1.2 의 줍는 조건 그대로).
 *
 *   ══ 성질 ══
 *     · `needsAutoSchedule:false` — 고객이 «여러 곳에 올리기»를 켰으면 자동 편성 스위치와 무관하게 얹는다(사람이 승인한 원본의 파생이다).
 *     · `stopsWhenPaused:false` — 🔴 설계 §5B.11(1) 의 «멈추는 것»은 **왼쪽 넷뿐**이다(`roll`·`assign`·`produce`·`publisher` · `verify-pause-scope ②` 가 잰다).
 *        여기를 다섯째로 세우면 «쉼»이 넓어진다. 멈출 까닭도 없다 — 시각을 박는 것은 **내보내는 것이 아니고**(발행 크론이 쉰다),
 *        쉬는 사이 그 시각이 지나면 깰 때 `holdBacklog` → `releaseBacklog` 가 **가족 시차를 맞춰** 다시 얹는다(`lib/tenant-pause.ts`).
 *     · 한 번에 원본 20개 · 틱 예산을 넘으면 다음 틱으로 미룬다.
 *   🔎 출처: AC 신규(R18) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { scheduleDerived, UNPLACED_STATUS } from "../derived-schedule";
import { NOOP, type CronStep, type StepOutcome, type TenantCtx } from "./base";

const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;
/** 한 틱에 손대는 원본 수. */
export const REUSE_SWEEP_MAX = 20;

export const reuseScheduleStep: CronStep = {
  key: "reuse.schedule",
  every: "hourly",
  needsAutoSchedule: false,
  stopsWhenPaused: false,
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    /* 🔴 줍는 조건은 B 계약 v1.2 글자 그대로 — `origin_piece_id IS NOT NULL AND status = 'scheduled' AND scheduled_for IS NULL`. */
    const rows = await q(sql`SELECT origin_piece_id AS o, MIN(id) AS first FROM pieces
      WHERE tenant_id = ${ctx.tid} AND origin_piece_id IS NOT NULL AND status = ${UNPLACED_STATUS} AND scheduled_for IS NULL
      GROUP BY origin_piece_id ORDER BY MIN(id) LIMIT ${REUSE_SWEEP_MAX}`);
    if (!rows.length) return NOOP;
    let placed = 0, waiting = 0, dropped = 0, notReady = 0, deferred = 0, errors = 0;
    for (const r of rows) {
      if (Date.now() > ctx.deadline) { deferred++; continue; }
      try {
        const out = await scheduleDerived(ctx.tid, n(r.o), { now: ctx.now });
        if (!out.ok) { notReady++; continue; }   // 원본이 아직 시각이 없다(검수 중 등) — 다음 틱
        placed += out.placed.length; waiting += out.waiting.length; dropped += out.dropped.length;
      } catch (e) {
        errors++;
        console.error(`[reuse.schedule] tid=${ctx.tid} origin=${n(r.o)}`, String((e as Error)?.message ?? e).slice(0, 160));
      }
    }
    const detail: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ placed, waiting, dropped, notReady, deferred, errors })) if (v) detail[k] = v;
    return { changed: placed + dropped, skipped: waiting + notReady + deferred + errors, ...(Object.keys(detail).length ? { detail } : {}) };
  },
};
