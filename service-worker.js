const CACHE_NAME = "runica-cache-v1";
const APP_SHELL = [
  "/index.html",
  "/master.html",
  "/manifest.json",
  "/css/style.css",
  "/js/firebase-config.js",
  "/js/app.js",
  "/js/master.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// Estrategia: network-first para todo lo que sea Firebase / CDN de MindAR,
// cache-first solo para el shell propio de la app (para que funcione offline
// aunque el escaneo AR y la sincronización necesiten red real).
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isOwnAsset = APP_SHELL.some((path) => url.pathname === path);

  if (isOwnAsset) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
