/**
 * lib/cron/post-alive.ts — 올린 글이 **아직 살아 있나** 확인하기(계약 P1R7 §2 마무리 · 메인 결정 2026-09-15).
 *
 *   🔴 왜 지금 만드나: `verify.post_alive` 는 잡 종류·우선순위·보고 처리·러너 채널이 **전부 있었는데
 *      그 잡을 만드는 코드가 0건**이었다(B2 전수조사 정정 · `grep -r post_alive lib/ netlify/` = 선언 3곳뿐).
 *      즉 «발행 후 삭제 감지»가 **한 번도 돈 적이 없다** — `account-health.ts` 가 건강점수에서 −10 을 깎는
 *      그 신호(`posts.stats.alive = false`)가 영원히 안 들어왔다.
 *      사장님이 실발행을 시작하시면 «올렸는데 지워졌나»를 아무도 안 보는 상태가 바로 생긴다.
 *
 *   규칙(메인 결정): **발행 성공 7일 뒤 1회.**
 *     · 왜 7일: 플랫폼이 지우는 건 보통 며칠 안이고, 하루 만에 보면 «아직 심사 중»을 죽은 것으로 읽는다.
 *     · 왜 1회: 매일 보면 글 수만큼 잡이 쌓인다(계정 20개 × 하루 1건이면 한 달에 600건). 한 번이면 충분하다.
 *
 *   🔴 **영구 멱등**이다. `enqueueJob` 의 `dedupe` 는 «살아 있는 잡»만 막으므로(끝난 잡은 또 만든다)
 *      여기서는 **`posts.stats.alive7At` 표식**으로 «이미 걸었다»를 기억한다 —
 *      적재 시점에 찍으므로 잡이 실패해도 **다시 쌓이지 않는다**(잡 자체의 재시도는 큐가 한다).
 *   🔎 출처: AC 신규(계약 P1R7-B2 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { db } from "../../db/index";
import { jsonb } from "../db-util";
import type { CronStep, StepOutcome } from "./base";

type Row = Record<string, unknown>;
const q = async (s: ReturnType<typeof sql>): Promise<Row[]> => (await db.execute(s)) as unknown as Row[];
const n = (v: unknown) => Math.floor(Number(v ?? 0)) || 0;

/** 발행 뒤 이만큼 지나면 한 번 본다. */
export const ALIVE_CHECK_DAYS = 7;
/** 한 틱에 너무 많이 걸지 않는다(러너가 다른 일을 못 하게 되면 안 된다). */
const PER_TICK = 20;

export const postAliveStep: CronStep = {
  key: "post.alive",
  every: "hourly",
  needsAutoSchedule: false,
  async run(ctx): Promise<StepOutcome> {
    /* 대상: 7일 지났고 · 주소가 있고 · 아직 안 걸어 본 글.
       🔴 러너 채널만 본다 — API 채널(블로거·WP·유튜브)은 우리가 API 로 상태를 읽을 수 있고,
          러너가 브라우저로 열 이유가 없다(러너 시간은 발행에 쓴다). */
    const rows = await q(sql`
      SELECT p.id, p.piece_id, p.account_id, p.external_url, p.channel, pc.title
        FROM posts p
        LEFT JOIN pieces pc ON pc.id = p.piece_id
       WHERE p.tenant_id = ${ctx.tid}
         AND p.external_url IS NOT NULL
         AND p.published_at < NOW() - (${ALIVE_CHECK_DAYS} * INTERVAL '1 day')
         AND p.channel IN ('naver_blog','tistory')
         AND (p.stats->>'alive7At') IS NULL
       ORDER BY p.published_at
       LIMIT ${PER_TICK}`);
    if (!rows.length) return { changed: 0, skipped: 0 };

    // 🔴 import 는 함수 안에서(AC-17 — `runner-jobs` 가 크론을 보지 않게 방향을 하나로 둔다).
    const { enqueueJob } = await import("../runner-jobs");

    let made = 0, skipped = 0;
    for (const r of rows) {
      if (Date.now() >= ctx.deadline) { skipped++; continue; }
      const postId = n(r.id);
      /* 🔴 **표식을 먼저 찍는다.** 잡을 먼저 만들고 표식을 나중에 찍으면, 그 사이에 틱이 끊겼을 때
         같은 글에 잡이 두 번 쌓인다(끝난 잡은 dedupe 가 못 막는다). 표식이 먼저면 최악이 «한 번도 안 걺»인데
         그건 다음 사람이 알아채기 쉽고, «계속 쌓임»은 아무도 모른 채 큐만 막힌다. */
      const marked = await q(sql`UPDATE posts SET stats = COALESCE(stats, '{}'::jsonb) || ${jsonb({ alive7At: new Date().toISOString() })}
        WHERE id = ${postId} AND (stats->>'alive7At') IS NULL RETURNING id`);
      if (!marked.length) { skipped++; continue; }        // 다른 틱이 방금 집어갔다

      await enqueueJob({
        tenantId: ctx.tid, kind: "verify.post_alive",
        accountId: r.account_id ? n(r.account_id) : null,
        pieceId: r.piece_id ? n(r.piece_id) : null,
        /* 🔴 칸 이름 두 개가 **둘 다** 있어야 이 기능이 성립한다. 하나만 있으면 조용히 아무 일도 안 일어난다:
             · `externalUrl` — **러너**가 이 이름으로 읽는다(`post-alive.mjs`). 없으면 «확인할 글 주소가 없어요»로 실패.
             · `postId`      — **서버**가 이 이름으로 읽는다(`runner-jobs.ts` «통계·생존 확인» 분기 `n(payload.postId)`).
                               🔴 없으면 `if (postId)` 가 거짓이라 **병합을 통째로 건너뛴다** — 러너가 «죽었다»를
                               정확히 판정해 보내도 그 답이 **버려진다**. 처음 이 스텝을 쓸 때 이 칸을 빠뜨려서,
                               «삭제 감지»가 코드상으로는 완성인데 실제로는 한 글자도 안 적히는 상태였다.
                               `posts.stats.alive='false'` 는 `account-health.ts` 가 건강점수에서 −10 을 깎는 재료다.
           (선례: `lib/cron/learn.ts` 의 `revenue.stats` 적재도 `payload.postId` 로 같은 분기를 탄다.) */
        /* `title` 은 **서버**가 쓴다 — 같은 주소를 쿠키 없이 한 번 더 열어 «남이 볼 수 있나»를 볼 때,
           제목이 있어야 «정말 그 글이 보인다»를 말할 수 있다(제목이 없으면 블로그 첫 화면으로 튕긴 것도 «찾았다»가 된다). */
        payload: { externalUrl: String(r.external_url), channel: String(r.channel ?? ""), postId, title: String(r.title ?? "") } as never,
        dedupe: true,
      });
      made++;
    }
    return made || skipped ? { changed: made, skipped, detail: { checked: made, days: ALIVE_CHECK_DAYS } } : { changed: 0, skipped: 0 };
  },
};
