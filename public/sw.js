/* AutoCreate 서비스워커 — [R7 §4.4] 알림(웹푸시) + 딥링크만 맡는다.
   🔴 캐시(오프라인 셸)는 여기서 하지 않는다 — 화면이 서버 값에 매여 있어(편성표·수익) 옛 화면을 되살리면 «틀린 숫자»를 보여 주게 된다.
   🔴 알림 문구는 서버가 만든 사람말을 그대로 띄운다(여기서 다시 쓰지 않는다 · 두 곳에서 갈리면 말이 어긋난다). */
const TAG = "autocreate";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: e.data && e.data.text ? e.data.text() : "" }; }
  const title = String(d.title || "AutoCreate");
  const body = String(d.body || d.desc || "");
  const link = String(d.link || d.url || "/app/notifications.html");
  e.waitUntil(self.registration.showNotification(title, {
    body,
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: String(d.tag || TAG),
    renotify: false,
    data: { link },
  }));
});

/* 알림을 누르면 이미 열린 창이 있으면 그 창을 그 화면으로 옮기고, 없으면 새로 연다(두 개씩 열리지 않게). */
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/app/notifications.html";
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin !== self.location.origin) continue;
      await c.focus();
      if ("navigate" in c) { try { await c.navigate(link); } catch { /* 같은 창에서 못 옮기면 그대로 둔다 */ } }
      return;
    }
    await self.clients.openWindow(link);
  })());
});
