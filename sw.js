// ComicCore service worker — PWA Day 1
// Strategy:
//  - HTML pages: network-first (always get your latest edits when online),
//    fall back to cache when offline.
//  - CSS/JS/images/fonts: cache-first, refreshed in the background.
//  - Supabase (or any cross-origin) requests: never touched, always go straight
//    to the network. Auth/data calls must never be served from cache.

const CACHE_VERSION = 'v1';
const CACHE_NAME = `comiccore-${CACHE_VERSION}`;

// Small "app shell" — safe, fast things to have ready before first paint.
// Intentionally NOT precaching the big editor pages (create.html, etc.) —
// those get cached automatically the first time you visit them instead.
const PRECACHE_URLS = [
  'manifest.json',
  'theme.css',
  'theme.js',
  'icons/icon-192.png',
  'icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only ever handle same-origin GET requests. Everything else (Supabase
  // REST/auth/storage calls, OAuth redirects, etc.) passes straight through.
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  const isHTML =
    req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() =>
          caches.match(req).then((cached) => cached || caches.match('index.html'))
        )
    );
    return;
  }

  // Static assets: serve from cache instantly if we have it, refresh in the
  // background either way so next time it's up to date.
  event.respondWith(
    caches.match(req).then((cached) => {
      const networkFetch = fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
