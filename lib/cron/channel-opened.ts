/**
 * lib/cron/channel-opened.ts — 스텝 `channel.opened`(P1R7 B3 · A 여정 6번 «준비 중 채널을 골라 뒀는데 그 값이 어디로 갔는지 안 보인다»).
 *   AC 신규(2026-09-15).
 *
 *   ══ 무슨 문제였나 ══
 *     온보딩은 `planned` 채널도 고르게 하고 그 값을 `tenants.settings.channels` 에 **이미 저장한다**(라이브 5집이 그렇게 골라 뒀다 ·
 *     그중 전부가 `youtube_shorts`). 그런데 계정 연결 화면은 `active` 만 그리니 고객이 보기엔 **고른 것이 사라진다**.
 *     → 고른 값을 «관심 채널»로 인정하고, **그 채널이 열리는 순간 1회 알린다.** 고객이 다시 들어올 이유가 생긴다.
 *
 *   ══ 규율 ══
 *     · **한 채널당 한 번만**(멱등) — 기록은 `notifications.kind = "channel_opened:{채널}"` 한 곳(새 표·새 칸 0).
 *       그 kind 행이 이미 있으면 다시 만들지 않는다(«48시간 중복 억제»가 아니라 **영구**).
 *     · 관심 없는 집에는 안 보낸다(`settings.channels` 에 그 채널이 있어야 한다) — 잔소리 0.
 *     · 레지스트리를 누가 어떻게 켰든(운영센터 화면·SQL·시드) 이 스텝이 잡는다 — «켜는 자리»에 로직을 붙이면 다른 길로 켰을 때 조용히 샌다.
 *   🔴 이 파일은 `publish`·`runner-jobs` 를 import 하지 않는다(AC-17 · 순수 SQL + 알림).
 */
import { sql } from "drizzle-orm";
import { q } from "../accounts";
import { writeAudit } from "../audit";
import { notifyOnce, type CronStep, type TenantCtx, type StepOutcome, NOOP } from "./base";

/** 열린 채널 목록은 테넌트마다 다시 읽을 필요가 없다 — 한 틱(60초) 안에서는 같다. */
let cache: { at: number; rows: { key: string; label: string }[] } | null = null;
const CACHE_MS = 60_000;

async function activeChannels(): Promise<{ key: string; label: string }[]> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await q(sql`SELECT key, label FROM channel_registry WHERE status = 'active' ORDER BY sort, key`);
  const out = rows.map((r) => ({ key: String(r.key), label: String(r.label || r.key) }));
  cache = { at: Date.now(), rows: out };
  return out;
}

export const channelOpenedStep: CronStep = {
  key: "channel.opened",
  every: "hourly",
  needsAutoSchedule: false,   // 자동 편성과 무관 — 관심 채널이 열렸다는 소식
  async run(ctx: TenantCtx): Promise<StepOutcome> {
    const picked = Array.isArray(ctx.raw.channels) ? (ctx.raw.channels as unknown[]).map(String) : [];
    if (!picked.length) return NOOP;                      // 고른 적이 없다 = 알릴 것도 없다
    const open = await activeChannels();
    const hits = open.filter((c) => picked.includes(c.key));
    if (!hits.length) return NOOP;

    let sent = 0;
    for (const c of hits) {
      const kind = `channel_opened:${c.key}`.slice(0, 32);
      // 🔴 영구 멱등 — 기간 조건 없이 «그 kind 가 이 집에 있었나»만 본다(한 채널당 평생 한 번).
      const [dup] = await q(sql`SELECT 1 FROM notifications WHERE tenant_id = ${ctx.tid} AND kind = ${kind} LIMIT 1`);
      if (dup) continue;
      const ok = await notifyOnce(ctx.tid, kind,
        `${c.label} 연결이 열렸어요`,
        `처음에 고르셨던 ${c.label} 를 이제 연결할 수 있어요. «내 계정»에서 붙이면 바로 편성에 들어가요.`,
        "/app/accounts.html", { withinHours: 24 * 365 * 10, byKind: true });
      if (ok) {
        sent++;
        await writeAudit({ tenantId: ctx.tid, action: "channel_opened_notified", actorType: "system", target: `channel:${c.key}`, detail: { channel: c.key } });
      }
    }
    return sent ? { changed: sent, skipped: hits.length - sent, detail: { channels: hits.map((c) => c.key), sent } } : NOOP;
  },
};
