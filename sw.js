/* Finappa service worker — офлайн-режим.
   Стратегия: кэшируем оболочку при установке; отдаём из кэша,
   в фоне обновляем из сети (stale-while-revalidate). */
const CACHE = "finappa-v40";
/* Оболочка у приложения одна, а адресов у неё много: «?draft=…» (инбокс),
   «?section=tasks» (уведомление), «?action=…» (ярлык). Ключ в кэше должен
   быть один — канонический. */
const SHELL = new URL("./index.html", self.location).href;
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
      /* Подчищаем адреса с параметрами, если такие осели раньше: при
         ignoreSearch именно они подменяли свежую оболочку. */
      .then(() => caches.open(CACHE))
      .then((c) => c.keys().then((rs) => Promise.all(rs.filter((r) => new URL(r.url).search).map((r) => c.delete(r)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  /* Кэшируем только свою оболочку. Ответы сервера (синхронизация, инбокс)
     мимо кэша: иначе приложение видит прошлый ответ и черновик приезжает
     только со второго открытия. */
  if (new URL(e.request.url).origin !== self.location.origin) return;
  /* Открытие приложения по ЛЮБОМУ адресу отдаёт одну и ту же оболочку и
     кладёт её в кэш под каноническим ключом. Иначе так: человек один раз
     открыл «?section=tasks» из уведомления, ответ осел отдельной записью, а
     потом caches.match(..., {ignoreSearch:true}) стал отдавать её вместо
     свежей — и приложение молча застряло на прошлой версии. Поймано 28.08 на
     собственном кэше. */
  if (e.request.mode === "navigate" || e.request.destination === "document") {
    e.respondWith(
      caches.match(SHELL).then((cached) => {
        const fresh = fetch(e.request)
          .then((res) => {
            if (res && res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(SHELL, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((cached) => {
      const fresh = fetch(e.request)
        .then((res) => {
          /* Записи с параметрами в кэш не кладём вовсе — см. выше. */
          if (res && res.ok && !new URL(e.request.url).search) {
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
  /* Уведомление обязано открывать свой раздел: пуш про дело — «Дела», про
     черновик — «Деньги». Иначе напоминание превращается в «открой и найди»,
     а это ровно та потеря, из-за которой о деле и забывают. */
  const data = e.notification.data || {};
  const url = data.section === "tasks" ? "./?section=tasks" : "./";
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (!("focus" in c)) continue;
      if (data.section && "navigate" in c) return c.navigate(url).then((x) => (x || c).focus());
      return c.focus();
    }
    return clients.openWindow(url);
  }));
});
