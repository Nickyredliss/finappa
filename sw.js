/* Finappa service worker — офлайн-режим.
   Стратегия: кэшируем оболочку при установке; отдаём из кэша,
   в фоне обновляем из сети (stale-while-revalidate). */
const CACHE = "finappa-v30";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  /* cache:"reload" — иначе «./» может приехать из HTTP-кэша браузера
     и оболочка застрянет на прошлой версии, хотя index.html уже новый */
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  /* Кэшируем только свою оболочку. Ответы сервера (синхронизация, инбокс)
     мимо кэша: иначе приложение видит прошлый ответ и черновик приезжает
     только со второго открытия. */
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const fresh = fetch(e.request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});

/* Push-уведомления о подписках */
self.addEventListener("push", (e) => {
  let payload = { title: "Finappa", body: "" };
  try { payload = e.data.json(); } catch {}
  e.waitUntil(self.registration.showNotification(payload.title || "Finappa", {
    body: payload.body || "",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    data: payload,
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if ("focus" in c) return c.focus();
    return clients.openWindow("./");
  }));
});
