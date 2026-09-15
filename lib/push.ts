/**
 * lib/push.ts — 웹푸시(기기 알림 · 메인 발주 2026-09-15 · A 의 `public/sw.js`·설정 «알림» 토글과 짝).
 *
 *   🔴 **키 없으면 `not_configured`** — 거짓으로 켜지 않는다. 화면은 그 상태를 그대로 «기기 알림은 아직 준비 중이에요»로 말한다.
 *      env: `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`(mailto: 또는 https:) — 키 발급·등록은 메인(Netlify env).
 *   🔴 **문구는 알림함과 한 출처** — 푸시는 `notifications` 행(title·body·link)을 그대로 실어 보낸다. 여기서 문장을 다시 짓지 않는다.
 *   🔴 **죽은 구독은 지운다** — 410 Gone·404 는 그 기기가 없어진 것이다(안 지우면 영원히 실패한다). 그 밖의 실패는 경고만
 *      (알림함에는 이미 들어갔으니 고객 체감 0).
 *   보내는 시점: 크론 5분 스텝 `push.fanout`(lib/cron/push-fanout.ts)이 **아직 안 쏜 알림**(`notifications.pushed_at IS NULL`)을 모아 쏜다.
 *      왜 그 자리인가: 알림 INSERT 자리가 코드 곳곳에 46군데다 — 한 곳(팬아웃)에서 쏘면 «어떤 알림은 푸시가 안 가는» 구멍이 안 생긴다.
 *      대신 최대 5분 늦다(정직하게 적어 둔다).
 *   🔎 출처: AC 신규(계약 §3.6·푸시 · 생성 커밋 2026-09-15) — AM 원본 없음.
 */
import { sql } from "drizzle-orm";
import { q } from "./accounts";

const n = (v: unknown) => Number(v || 0);
export interface PushSubscriptionInput { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } | null }

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && String(process.env.VAPID_PUBLIC_KEY).length > 20);
}
export function vapidPublicKey(): string | null { return pushConfigured() ? String(process.env.VAPID_PUBLIC_KEY) : null; }
function vapidSubject(): string {
  const s = String(process.env.VAPID_SUBJECT ?? "").trim();
  return /^(mailto:|https:\/\/)/i.test(s) ? s : "mailto:support@autocreate.kr";
}

/** 구독 저장(같은 endpoint 는 갱신 · 기기 1개 = 행 1개). */
export async function savePushSubscription(tid: number, uid: number | null, sub: PushSubscriptionInput, ua: string | null): Promise<{ ok: boolean; error?: string }> {
  const endpoint = String(sub?.endpoint ?? "").trim();
  const p256dh = String(sub?.keys?.p256dh ?? "").trim();
  const auth = String(sub?.keys?.auth ?? "").trim();
  if (!/^https:\/\//i.test(endpoint) || !p256dh || !auth) return { ok: false, error: "구독 정보가 올바르지 않아요." };
  await q(sql`INSERT INTO push_subscriptions (tenant_id, user_id, endpoint, p256dh, auth, user_agent)
    VALUES (${tid}, ${uid}, ${endpoint}, ${p256dh.slice(0, 200)}, ${auth.slice(0, 100)}, ${(ua ?? "").slice(0, 200) || null})
    ON CONFLICT (endpoint) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
      user_agent = COALESCE(EXCLUDED.user_agent, push_subscriptions.user_agent), fail_count = 0`);
  return { ok: true };
}
export async function deletePushSubscription(tid: number, endpoint: unknown): Promise<number> {
  const e = String(endpoint ?? "").trim(); if (!e) return 0;
  const r = await q(sql`DELETE FROM push_subscriptions WHERE tenant_id = ${tid} AND endpoint = ${e} RETURNING id`);
  return r.length;
}
export async function countPushSubscriptions(tid: number): Promise<number> {
  const [r] = await q(sql`SELECT COUNT(*)::int AS c FROM push_subscriptions WHERE tenant_id = ${tid}`);
  return n(r?.c);
}

export interface PushPayload { title: string; body: string; link: string; kind?: string }
export interface PushSendResult { sent: number; removed: number; failed: number }
/**
 * sendToTenant — 그 테넌트의 모든 기기에 한 건. 던지지 않는다(알림함은 이미 들어갔다).
 *   410/404 = 사라진 기기 → 행 삭제 · 나머지 실패 = fail_count++ 후 경고(5회 넘으면 지운다 — 영원히 실패하는 행을 남기지 않는다).
 */
export async function sendToTenant(tid: number, p: PushPayload): Promise<PushSendResult> {
  const out: PushSendResult = { sent: 0, removed: 0, failed: 0 };
  if (!pushConfigured()) return out;
  const subs = await q(sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE tenant_id = ${tid}`);
  if (!subs.length) return out;
  const webpush = (await import("web-push")).default;
  webpush.setVapidDetails(vapidSubject(), String(process.env.VAPID_PUBLIC_KEY), String(process.env.VAPID_PRIVATE_KEY));
  const payload = JSON.stringify({ title: p.title, body: p.body, link: p.link, tag: p.kind ?? "autocreate" });
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: String(s.endpoint), keys: { p256dh: String(s.p256dh), auth: String(s.auth) } }, payload, { TTL: 3600 });
      await q(sql`UPDATE push_subscriptions SET last_sent_at = NOW(), fail_count = 0 WHERE id = ${n(s.id)}`);
      out.sent++;
    } catch (e) {
      const code = n((e as { statusCode?: number })?.statusCode);
      if (code === 404 || code === 410) { await q(sql`DELETE FROM push_subscriptions WHERE id = ${n(s.id)}`); out.removed++; continue; }
      const [row] = await q(sql`UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ${n(s.id)} RETURNING fail_count`);
      if (n(row?.fail_count) >= 5) { await q(sql`DELETE FROM push_subscriptions WHERE id = ${n(s.id)}`); out.removed++; }
      out.failed++;
      console.warn("[push] 전송 실패", code || "-", String((e as Error)?.message ?? e).slice(0, 120));
    }
  }
  return out;
}

/**
 * pushPendingNotifications — 아직 안 쏜 알림을 모아 보낸다(크론 5분 스텝이 부른다).
 *   🔴 오래된 알림은 쏘지 않는다(기본 60분) — 배포·장애로 밀린 알림이 한꺼번에 울리면 그게 더 나쁘다. 표시만 하고 넘어간다.
 */
export async function pushPendingNotifications(limit = 100, maxAgeMin = 60): Promise<{ notifications: number; sent: number; removed: number; failed: number; skippedOld: number }> {
  const out = { notifications: 0, sent: 0, removed: 0, failed: 0, skippedOld: 0 };
  const rows = await q(sql`SELECT id, tenant_id, kind, title, body, link, created_at FROM notifications
    WHERE pushed_at IS NULL ORDER BY id DESC LIMIT ${Math.max(1, Math.min(500, limit))}`);
  if (!rows.length) return out;
  const old = rows.filter((r) => Date.now() - new Date(String(r.created_at).replace(" ", "T") + "Z").getTime() > maxAgeMin * 60_000);
  if (old.length) {
    await q(sql`UPDATE notifications SET pushed_at = NOW() WHERE id IN (${sql.join(old.map((r) => sql`${n(r.id)}`), sql`, `)})`);
    out.skippedOld = old.length;
  }
  const fresh = rows.filter((r) => !old.includes(r));
  if (!fresh.length || !pushConfigured()) {
    if (fresh.length) await q(sql`UPDATE notifications SET pushed_at = NOW() WHERE id IN (${sql.join(fresh.map((r) => sql`${n(r.id)}`), sql`, `)})`);   // 키 없으면 표시만(다음에 키가 꽂혀도 옛 알림을 울리지 않는다)
    return out;
  }
  for (const r of fresh) {
    const res = await sendToTenant(n(r.tenant_id), { title: String(r.title ?? ""), body: String(r.body ?? ""), link: String(r.link ?? "/app/notifications.html"), kind: String(r.kind ?? "") });
    await q(sql`UPDATE notifications SET pushed_at = NOW() WHERE id = ${n(r.id)}`);
    out.notifications++; out.sent += res.sent; out.removed += res.removed; out.failed += res.failed;
  }
  return out;
}
