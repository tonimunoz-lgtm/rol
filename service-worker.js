const CACHE_NAME = "runica-cache-v3";
const APP_SHELL = [
  "/index.html",
  "/master.html",
  "/manifest.json",
  "/css/style.css",
  "/js/firebase-config.js",
  "/js/app.js",
  "/js/master.js",
  // Reinos — juego independiente, mismo service worker compartido.
  "/reinos.html",
  "/manifest-reinos.json",
  "/js/reinos.js",
  "/js/reinos-utils.js",
  "/icons-reinos/icon-192.png",
  "/icons-reinos/icon-512.png",
  "/icons-reinos/icon-maskable-512.png",
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

// Estrategia: network-first para el shell propio de la app (así siempre ves
// la última versión desplegada), con fallback a caché solo si no hay red
// (para que funcione offline). Los recursos externos (Firebase, CDN de
// MindAR) no se tocan aquí, se gestionan solos.
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const isOwnAsset = APP_SHELL.some((path) => url.pathname === path);

  if (isOwnAsset) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  }
});
