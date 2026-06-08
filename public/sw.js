const CACHE_NAME = 'daily-screen-v11';
const SHELL_ASSETS = [
  '/',
  '/public/style.css',
  '/public/display.js',
  '/public/i18n.js',
];

// Install: cache the app shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch strategy:
// - API calls: network-first, cache fallback (stale data > no data)
// - Shell assets: cache-first, network fallback
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/')) {
    // Network-first for API. On failure, fall back to the cache entry for the
    // EXACT same request (query string included → same date), and never resolve
    // to `undefined` — that makes respondWith fail as a network error and the
    // page silently keeps stale data. Return a tagged 503 the page can detect.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          // Cache successful GET responses
          if (e.request.method === 'GET' && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(e.request);
          return cached || new Response(
            JSON.stringify({ error: 'offline', offline: true }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
          );
        })
    );
  } else {
    // Cache-first for shell
    e.respondWith(
      caches.match(e.request).then((cached) => cached || fetch(e.request))
    );
  }
});
