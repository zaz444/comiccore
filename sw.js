// ComicCore service worker — PWA Day 1 + Day 2 (offline comics)
// Strategy:
//  - HTML pages: network-first (always get your latest edits when online),
//    fall back to cache when offline.
//  - CSS/JS/icons: cache-first, refreshed in the background.
//  - Supabase REST/Auth/Realtime calls: never cached, always go straight to
//    the network. Auth/data calls must never be served stale.
//  - Supabase Storage (comic snapshots, sprites, backgrounds): cache-first,
//    refreshed in the background — this is what actually makes comic
//    *artwork* viewable offline, not just metadata.

const CACHE_VERSION = 'v2';
const CACHE_NAME = `comiccore-${CACHE_VERSION}`;

// Small "app shell" — safe, fast things to have ready before first paint.
// Intentionally NOT precaching the big editor pages (create.html, etc.) —
// those get cached automatically the first time you visit them instead.
const PRECACHE_URLS = [
  'manifest.json',
  'theme.css',
  'theme.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-192-maskable.png',
  'icons/icon-512-maskable.png'
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

  // Only ever handle GET requests.
  if (req.method !== 'GET') return;

  const isSupabase = url.hostname.endsWith('.supabase.co');

  if (isSupabase) {
    // REST/Auth/Realtime calls must always hit the network live — never cache
    // auth tokens, query results, or anything that can go stale and lie to the app.
    const isLiveApi =
      url.pathname.includes('/rest/') ||
      url.pathname.includes('/auth/') ||
      url.pathname.includes('/realtime/');
    if (isLiveApi) return;

    // Everything else on a Supabase host is Storage — actual comic artwork,
    // frame snapshots, sprites, backgrounds. These are static files, safe (and
    // valuable) to cache so comics can actually be *read* offline, not just
    // have their metadata available. Cache-first, refreshed in the background.
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
    return;
  }

  // Anything else cross-origin (fonts, etc.) — pass straight through.
  if (url.origin !== location.origin) return;

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
