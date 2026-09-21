/**
 * lib/cron/pause-watch.ts — 🔴 **«멈춤»에는 «깨워 주기»가 같이 있어야 한다**(DESIGN §5B.11(3) · AC-220).
 *   🔎 출처: AC 신규(AM 원본 없음).
 *
 *   ══ 왜 이 스텝이 있나 — 사장님 물음이 그대로 명세다 ══
 *     «근데 크론 멈췄다는 걸 **내가 까먹으면** 어떡해?»
 *     ⇒ 멈추는 기능만 만들면 **«쉬는 줄 모르고 몇 달»** 이 된다. 그게 해지보다 나쁘다 — 손님은 돈을 내면서 아무것도 못 받는다.
 *
 *   ══ 하는 일 셋 ══
 *     ① **하루 전 예고** — `pause_until` 이 24시간 안이면 «내일 다시 시작해요»
 *     ② **저절로 깨우기** — `pause_until` 이 지났으면 깨우고 «다시 시작했어요» + 🔴 **밀린 글을 모아 «N건 있어요»**
 *     ③ **7일마다 «아직 쉬는 중»** — `pause_until` 이 NULL(«내가 켤 때까지»)인 집. `pause_notified_at` 이 멱등 키다
 *
 *   🔴 **깨울 때 밀린 글을 «올리지» 않는다**(설계 (1-b) · §9) — 모아서 **보여 주고** 고르는 것은 손님이다.
 *      그래서 알림에 **수를 적는다**: «밀린 글 N건이 있어요»가 없으면 손님은 그 글들이 **사라진 줄 안다**.
 *
 *   🔴 이 스텝은 `stopsWhenPaused` 를 **켜지 않는다**(기본 false) — 쉬는 집을 도는 것이 이 스텝의 일이다.
 *      켜면 «쉬는 집은 안 본다»가 되어 **영영 안 깨운다.** 이 파일에서 가장 조용히 틀릴 수 있는 한 줄이다.
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { utcDate } from "../db-util";
import { writeAudit } from "../audit";
import { holdBacklog, countBacklog, pauseViewOf } from "../tenant-pause";
import type { CronStep, StepOutcome } from "./base";

const DAY_MS = 86400_000;
/** «아직 쉬는 중» 을 얼마 만에 한 번 알리나 — 설계 (3) «7일마다». */
export const PAUSE_REMIND_DAYS = 7;

export const pauseWatchStep: CronStep = {
  key: "tenant.pause_watch",
  every: "hourly",
  needsAutoSchedule: false,   // 자동 편성과 무관 — 쉬는 집을 깨우는 일이다
  /* 🔴 **켜지 않는다.** 아래 머리말의 그 한 줄 — 켜면 쉬는 집을 안 봐서 영영 안 깨운다. */
  stopsWhenPaused: false,
  async run(ctx): Promise<StepOutcome> {
    const [t] = await q(sql`SELECT paused_at, pause_until, pause_reason, pause_notified_at FROM tenants WHERE id = ${ctx.tid}`);
    const pausedAt = utcDate(t?.paused_at);
    if (!pausedAt) return { changed: 0, skipped: 0 };        // 안 쉬는 집 — 할 일 없다
    const until = utcDate(t?.pause_until);
    const now = ctx.now;
    const view = pauseViewOf(t as Record<string, unknown>, now);

    /* ── ② 저절로 깨우기 — 기한이 지났다 ── */
    if (until && until.getTime() <= now.getTime()) {
      /* 🔴 **먼저 모으고** 깨운다. 순서가 거꾸로면 그 한 틱 사이에 `publisher` 가 돌아
         **지나간 글이 한꺼번에 나간다**(설계 (1-b) 가 막으려는 바로 그것). */
      const held = await holdBacklog(ctx.tid, now);
      await q(sql`UPDATE tenants SET paused_at = NULL, pause_until = NULL, pause_reason = NULL, pause_notified_at = NULL, updated_at = NOW()
        WHERE id = ${ctx.tid}`);
      const total = await countBacklog(ctx.tid);
      const body = total
        /* 🔴 **수를 적는다** — 안 적으면 손님은 그 글들이 사라진 줄 안다. 그리고 **고르는 것은 손님**이다(§9). */
        ? `쉬는 동안 발행 시각이 지난 글 ${total}건을 그대로 두었어요. 차례로 올릴지, 그냥 둘지 고르실 수 있어요.`
        : "오늘부터 예정대로 다시 만들고 올려요.";
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
        VALUES (${ctx.tid}, ${"pause_resumed"}, ${"다시 시작했어요"}, ${body}, ${"/app/posts.html"})`).catch(() => []);
      await writeAudit({ tenantId: ctx.tid, action: "tenant_resume", actorType: "system", target: `tenant:${ctx.tid}`,
        detail: { auto: true, pausedDays: view.days, backlog: total }, riskLevel: "low" });
      return { changed: 1, skipped: 0, detail: { resumed: true, backlog: total, held } };
    }

    /* ── ① 하루 전 예고 ── */
    if (until && until.getTime() - now.getTime() <= DAY_MS) {
      const already = utcDate(t?.pause_notified_at);
      /* 같은 예고를 매시 보내지 않는다 — `pause_notified_at` 이 하루 안에 찍혀 있으면 건너뛴다. */
      if (already && now.getTime() - already.getTime() < DAY_MS) return { changed: 0, skipped: 1, detail: { willWakeSoon: true } };
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
        VALUES (${ctx.tid}, ${"pause_wake_soon"}, ${"내일 다시 시작해요"},
          ${"쉬기로 한 기간이 내일 끝나요. 더 쉬고 싶으시면 설정에서 기간을 늘릴 수 있어요."}, ${"/app/settings.html"})`).catch(() => []);
      await q(sql`UPDATE tenants SET pause_notified_at = NOW(), updated_at = NOW() WHERE id = ${ctx.tid}`);
      return { changed: 1, skipped: 0, detail: { wakeSoon: true } };
    }

    /* ── ③ «내가 켤 때까지» 인 집에 7일마다 — 🔴 사장님 «까먹으면?» 의 자리 ── */
    if (!until) {
      const last = utcDate(t?.pause_notified_at) ?? pausedAt;
      if (now.getTime() - last.getTime() < PAUSE_REMIND_DAYS * DAY_MS) return { changed: 0, skipped: 1, detail: { stillPaused: true } };
      /* 🔴 **겁주지 않는다**(§3) — «수익이 줄어요» 같은 말을 쓰지 않는다. 사실 한 줄 + 되돌릴 길 한 줄이다. */
      await q(sql`INSERT INTO notifications (tenant_id, kind, title, body, link)
        VALUES (${ctx.tid}, ${"pause_still"}, ${"아직 쉬는 중이에요"},
          ${`${view.days}일째 쉬고 있어요. 언제든 다시 시작할 수 있어요.`}, ${"/app/settings.html"})`).catch(() => []);
      await q(sql`UPDATE tenants SET pause_notified_at = NOW(), updated_at = NOW() WHERE id = ${ctx.tid}`);
      return { changed: 1, skipped: 0, detail: { reminded: true, days: view.days } };
    }

    return { changed: 0, skipped: 1, detail: { stillPaused: true } };
  },
};
