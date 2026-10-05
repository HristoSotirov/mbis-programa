// Cache name is stamped with the deploy's git SHA by .github/workflows/deploy.yml
// (see the "Stamp service worker" step) so every new deploy gets a brand new
// cache and old assets are dropped automatically — no manual version bumps.
const VERSION = '__BUILD_ID__';
const CACHE_NAME = 'mbis-programa-' + VERSION;

const APP_SHELL = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // HTML pages and the schedule data: always try the network first, so a
  // new deploy or an updated events.json shows up immediately. Fall back
  // to the cache only when offline.
  const isFreshFirst = req.mode === 'navigate' || url.pathname.endsWith('/data/events.json');
  if (isFreshFirst) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Everything else (css/js/icons): cache-first, since the versioned
  // cache name already guarantees a fresh copy after each deploy.
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
      return res;
    }))
  );
});
