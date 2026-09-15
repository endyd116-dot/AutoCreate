/**
 * 웹푸시(기기 알림 · 메인 발주 2026-09-15 · A 의 public/sw.js·설정 «알림» 토글과 짝).
 *   GET  /api/push-key                      → { ok, publicKey } | { ok:false, step:"not_configured" }   🔴 키 없으면 **정직하게 꺼진다**(거짓으로 켜지 않는다)
 *   POST /api/push-subscribe { endpoint, keys:{p256dh,auth} }  (또는 { subscription:{…} }) → { ok, devices }
 *   POST /api/push-unsubscribe { endpoint } → { ok, removed, devices }
 *   보내는 쪽은 크론 5분 스텝 `push.fanout` — 알림함 행(title·body·link)을 그대로 실어 보낸다(문구 한 출처 · lib/push.ts).
 */
import { json, jsonError, badRequest } from "../../lib/response";
import { readJson } from "../../lib/validate";
import { requireUser } from "../../lib/guards";
import { writeAudit } from "../../lib/audit";
import { pushConfigured, vapidPublicKey, savePushSubscription, deletePushSubscription, countPushSubscriptions, type PushSubscriptionInput } from "../../lib/push";

export const config = { path: ["/api/push-key", "/api/push-subscribe", "/api/push-unsubscribe"] };
const routeOf = (req: Request) => new URL(req.url).pathname.replace(/\/index\.html?$/, "").replace(/\.html?$/, "");

export default async (req: Request): Promise<Response> => {
  const path = routeOf(req);
  try {
    if (path.endsWith("/push-key")) {
      if (req.method !== "GET") return json({ ok: false, error: "method" }, 405);
      const key = vapidPublicKey();
      if (!key) return json({ ok: false, step: "not_configured", error: "기기 알림은 아직 준비 중이에요." });
      return json({ ok: true, publicKey: key });
    }
    const auth = requireUser(req); if (!auth.ok) return auth.res;
    if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
    const b = await readJson<PushSubscriptionInput & { subscription?: PushSubscriptionInput; endpoint?: unknown }>(req);

    if (path.endsWith("/push-subscribe")) {
      if (!pushConfigured()) return json({ ok: false, step: "not_configured", error: "기기 알림은 아직 준비 중이에요." });
      const sub = (b.subscription ?? b) as PushSubscriptionInput;   // A 는 `sub.toJSON()` 을 그대로 보낸다 · 계약은 { subscription } — 둘 다 받는다
      const r = await savePushSubscription(auth.tid, Number(auth.user.uid), sub, req.headers.get("user-agent"));
      if (!r.ok) return badRequest(r.error ?? "구독 정보를 확인해 주세요.", "subscription");
      const devices = await countPushSubscriptions(auth.tid);
      await writeAudit({ tenantId: auth.tid, action: "push_subscribe", actorType: "user", actorId: Number(auth.user.uid), detail: { devices } });   // 🔴 endpoint(기기 주소)는 감사에 싣지 않는다
      return json({ ok: true, devices });
    }
    if (path.endsWith("/push-unsubscribe")) {
      const removed = await deletePushSubscription(auth.tid, b.endpoint);
      const devices = await countPushSubscriptions(auth.tid);
      return json({ ok: true, removed, devices });
    }
    return json({ ok: false, error: "not found" }, 404);
  } catch (err) { return jsonError("push", err); }
};
