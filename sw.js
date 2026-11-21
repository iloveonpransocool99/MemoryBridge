/* ============================================================
   sw.js — MemoryBridge service worker.

   Caches ONLY the static app shell: HTML, CSS, JS, icons,
   manifest. User photos, audio recordings, and generated videos
   are never cached here and never leave the device — they live
   in page memory (blob/object URLs) and localStorage stories.

   Strategy: cache-first for the static shell, refreshed in the
   background so updates arrive after the next launch.
   ============================================================ */

const CACHE_NAME = 'memorybridge-static-v7';

// Every static asset of the app shell, relative to the service
// worker's location (the app root).
const STATIC_ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/storage.js',
  './js/video-export.js',
  './js/talking.js',
  './js/birthday.js',
  './js/memories.js',
  './js/wish-assistant.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle same-origin GET requests. Anything else (and every
  // POST/PUT) passes straight through untouched.
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Blob/object URLs and anything with a query that looks dynamic are
  // never intercepted — private media stays out of the cache.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const isStaticAsset = STATIC_ASSETS.some((asset) => {
    const assetUrl = new URL(asset, self.location.origin);
    return assetUrl.pathname === url.pathname;
  });

  if (!isStaticAsset) {
    // Not part of the app shell: never cache, never intercept.
    return;
  }

  // NETWORK-FIRST for app shell files: users always get the newest
  // HTML/CSS/JS when online; the cache is only the offline fallback.
  // (Cache-first here made stale-code bugs very hard to see.)
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true }).then((cached) =>
          cached || new Response('Offline and not cached.', { status: 503 })
        )
      )
  );
});
