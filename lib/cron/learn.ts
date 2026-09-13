/**
 * lib/cron/learn.ts — 스텝 `slots.learn`(계약 §1 · DESIGN §5B.7 · §5B.5). 매시 · 발행한 글의 성과를 회수해 되먹인다.
 *
 *   ══ 언제 무엇을 재나 ══
 *     발행 후 **6 · 24 · 72시간** 지점마다 한 번씩 조회·좋아요·댓글을 회수한다(마일스톤 3개).
 *     이미 잰 지점은 `posts.stats.synced` 에 남아 다시 재지 않는다(멱등 — 매시 돌아도 채널 API 를 세 번만 두드린다).
 *
 *   ══ 누가 재나 ══
 *     API 채널(blogger·wordpress·threads…) → B2 커넥터의 `fetchStats`(포트).
 *     러너 채널(naver_blog·tistory)        → `revenue.stats` 잡 적재(러너가 브라우저로 본다). 같은 (piece, 마일스톤) 잡은 한 번만.
 *     🔴 커넥터·적재기가 아직 없으면 **0 으로 적지 않는다** — «못 물어봤다»로 세고 다음 주기에 다시 온다.
 *        «조회 0회»와 «못 읽었다»를 같은 0 으로 적으면 성과 학습이 통째로 오염된다(PITFALLS 9-g 와 같은 결).
 *
 *   ══ 되먹임 2줄 ══
 *     ① `topics.factors.performance` — 그 소재로 만든 글들의 조회수 정규화 값(0~1).
 *        `performance = clamp01(log10(views+1) / log10(10000))` — 1만 조회에서 1.0. 소재 점수식이 이 값을 곱한다(`lib/topics.computeScore`).
 *        여러 글이 한 소재에서 나왔으면 **최고값**을 쓴다(한 채널에서 터진 소재는 좋은 소재다).
 *     ② `bestHoursFor()` — 계정별로 «최근 30일 성과가 가장 좋았던 발행 시각(KST)»(§5B.5 «auto» 의 학습 항목).
 *        ⚠️ `accounts.golden_hours` 에 **쓰지 않는다** — 그 칸은 사용자가 고정하는 값이다(`/api/accounts-update` 가 쓴다).
 *           학습값으로 덮으면 사용자가 고른 시각이 조용히 사라진다. 대신 이 함수를 편성(rollSlots)이 **읽어** 후보 순서를 정한다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { jsonb, utcDate } from "../db-util";
import { clamp01 } from "../topics";
import { type CronStep, type StepOutcome } from "./base";
import { enqueueRunnerJob, fetchPostStats, viaOf } from "./publish-port";

const n = (v: unknown) => Number(v || 0);
/** 회수 시점(발행 후 시간). 각 지점은 한 번만 잰다. */
export const MILESTONES = [6, 24, 72] as const;
export type Milestone = typeof MILESTONES[number];

/** 조회수 → 0~1 성과값. 1만 조회 = 1.0(로그 스케일 — 100 과 1,000 의 차이가 1,000 과 10,000 의 차이와 같게). */
export function performanceOf(views: number): number {
  if (!(Number(views) > 0)) return 0;
  return Math.round(clamp01(Math.log10(Number(views) + 1) / Math.log10(10000)) * 100) / 100;
}

/** 이 post 가 지금 재야 할 마일스톤(아직 안 잰 것 중 시각이 지난 가장 큰 값). 없으면 null. */
export function dueMilestone(publishedAt: Date, synced: number[], now: Date): Milestone | null {
  const ageH = (now.getTime() - publishedAt.getTime()) / 3600_000;
  let out: Milestone | null = null;
  for (const m of MILESTONES) if (ageH >= m && !synced.includes(m)) out = m;
  return out;
}

export const learnStep: CronStep = {
  key: "slots.learn",
  every: "hourly",
  needsAutoSchedule: false,   // 사람이 만든 글의 성과도 재야 소재 점수가 산다.
  async run(ctx): Promise<StepOutcome> {
    // 72시간 + 여유까지만 본다(그 뒤엔 잴 마일스톤이 없다).
    const posts = await q(sql`SELECT po.id, po.piece_id, po.account_id, po.channel, po.stats, po.published_at, p.topic_id
      FROM posts po LEFT JOIN pieces p ON p.id = po.piece_id
      WHERE po.tenant_id = ${ctx.tid} AND po.published_at > NOW() - interval '5 days'
      ORDER BY po.published_at DESC LIMIT 200`);
    if (!posts.length) return { changed: 0, skipped: 0 };

    let synced = 0, queued = 0, unavailable = 0, notDue = 0, deferred = 0;
    const topicBest = new Map<number, number>();

    for (const po of posts) {
      if (Date.now() >= ctx.deadline) { deferred++; continue; }
      const publishedAt = utcDate(po.published_at);
      if (!publishedAt) { notDue++; continue; }
      const stats = (po.stats && typeof po.stats === "object" && !Array.isArray(po.stats) ? po.stats : {}) as Record<string, unknown>;
      const done = Array.isArray(stats.synced) ? (stats.synced as unknown[]).map(Number).filter(Number.isFinite) : [];
      const m = dueMilestone(publishedAt, done, ctx.now);

      // 마일스톤이 안 됐어도 이미 잰 조회수는 소재 되먹임에 쓴다(재조회 0).
      const known = n(stats.views);
      if (po.topic_id && known > 0) topicBest.set(n(po.topic_id), Math.max(topicBest.get(n(po.topic_id)) ?? 0, performanceOf(known)));
      if (!m) { notDue++; continue; }

      const via = await viaOf(String(po.channel));
      if (via === "runner") {
        // 러너가 브라우저로 본다 — 같은 (piece, 마일스톤) 잡은 한 번만.
        const job = await enqueueRunnerJob(ctx.tid, {
          kind: "revenue.stats", accountId: po.account_id ? n(po.account_id) : null, pieceId: n(po.piece_id),
          payload: { postId: n(po.id), milestoneH: m, dedupe: `stats:${n(po.piece_id)}:${m}` }, priority: 80,
        });
        if (job.ok) { queued++; if (!job.already) await markQueued(ctx.tid, n(po.id), [...done, m]); }
        else if (job.unavailable) unavailable++;
        continue;
      }

      const r = await fetchPostStats(ctx.tid, n(po.piece_id));
      if (!r) { unavailable++; continue; }   // 못 물어봤다 — 0 으로 적지 않는다.
      const next: Record<string, unknown> = {
        ...stats,
        ...(r.views !== undefined ? { views: Math.max(0, Math.trunc(r.views)) } : {}),
        ...(r.likes !== undefined ? { likes: Math.max(0, Math.trunc(r.likes)) } : {}),
        ...(r.comments !== undefined ? { comments: Math.max(0, Math.trunc(r.comments)) } : {}),
        ...(r.alive !== undefined ? { alive: !!r.alive } : {}),
        lastSyncAt: ctx.now.toISOString(),
        synced: [...new Set([...done, m])].sort((a, b) => a - b),
      };
      await q(sql`UPDATE posts SET stats = ${jsonb(next)} WHERE tenant_id = ${ctx.tid} AND id = ${n(po.id)}`);
      synced++;
      const views = n(next.views);
      if (po.topic_id && views > 0) topicBest.set(n(po.topic_id), Math.max(topicBest.get(n(po.topic_id)) ?? 0, performanceOf(views)));
    }

    // 소재 되먹임 — factors 는 jsonb 병합(다른 팩터를 덮지 않는다).
    let fed = 0;
    for (const [topicId, perf] of topicBest) {
      const r = await q(sql`UPDATE topics SET factors = factors || ${jsonb({ performance: perf })}
        WHERE tenant_id = ${ctx.tid} AND id = ${topicId} AND COALESCE((factors->>'performance')::numeric, 0) < ${perf} RETURNING id`);
      fed += r.length;
    }
    if (fed) {
      const [chk] = await q(sql`SELECT jsonb_typeof(factors) AS t FROM topics WHERE tenant_id = ${ctx.tid} AND id = ${[...topicBest.keys()][0]}`);
      if (chk && chk.t !== "object") console.error("[cron/learn] topics.factors jsonb_typeof !== object", chk);   // 쓴 직후 확인까지가 쓰기다(PITFALLS #1)
    }

    const out: StepOutcome = { changed: synced + queued + fed, skipped: notDue + unavailable + deferred };
    const detail: Record<string, unknown> = {};
    for (const [k, v] of Object.entries({ synced, queued, fed, unavailable, deferred })) if (v) detail[k] = v;
    if (Object.keys(detail).length) out.detail = detail;
    return out;
  },
};

/**
 * 러너 잡을 넣었으면 그 마일스톤을 «요청함»으로 표시 — 러너가 보고하면 B2 가 실제 수치를 채운다.
 *   표시를 안 하면 매시 같은 잡을 또 넣는다(큐가 통계 잡으로 막힌다). 값은 JS 에서 합쳐 통째로 쓴다(jsonb 병합 · PITFALLS #1).
 */
async function markQueued(tid: number, postId: number, synced: number[]): Promise<void> {
  const uniq = [...new Set(synced)].sort((a, b) => a - b);
  await q(sql`UPDATE posts SET stats = stats || ${jsonb({ synced: uniq, statsRequestedAt: new Date().toISOString() })} WHERE tenant_id = ${tid} AND id = ${postId}`);
}

/**
 * bestHoursFor — 계정별 «최근 30일 성과가 가장 좋았던 발행 시각(KST 시)» 순서(§5B.5 «auto» 학습).
 *   편성(`rollSlots`)이 채널 기본 후보를 이 순서로 **정렬만** 한다 — 없는 시각을 만들지 않는다(기본표 밖으로 나가지 않는다).
 *   데이터가 없으면 빈 배열 → 호출부는 기본표 순서를 그대로 쓴다(«모르면 기본값», 조용한 왜곡 0).
 *   🔴 시각 계산은 SQL 안에서 KST 로(PITFALLS #4) — 드라이버 시간대 변환 0.
 */
export async function bestHoursFor(tid: number): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  try {
    const rows = await q(sql`SELECT po.account_id,
        EXTRACT(HOUR FROM (po.published_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Seoul'))::int AS h,
        AVG(COALESCE((po.stats->>'views')::numeric, 0)) AS avg_views, COUNT(*) AS c
      FROM posts po
      WHERE po.tenant_id = ${tid} AND po.account_id IS NOT NULL AND po.published_at > NOW() - interval '30 days'
        AND (po.stats->>'views') IS NOT NULL
      GROUP BY 1, 2 HAVING COUNT(*) >= 2
      ORDER BY 1, 3 DESC`);
    for (const r of rows) {
      const aid = n(r.account_id);
      out.set(aid, [...(out.get(aid) ?? []), n(r.h)]);
    }
  } catch (e) { console.warn("[cron/learn] bestHoursFor 실패 — 기본표 순서를 쓴다", String((e as Error)?.message ?? e).slice(0, 120)); }
  return out;
}
