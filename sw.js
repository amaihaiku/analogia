'use strict';
/* ═══════════════════════════════════════
   ANALOGIA — sw.js
   Cache-first PWA Service Worker
═══════════════════════════════════════ */

const CACHE_NAME = 'analogia-v1';

const APP_SHELL = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './antik_keret_web.png',
];

/* ── Install: pre-cache app shell ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

/* ── Activate: delete old cache versions ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

/* ── Fetch: cache-first strategy ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Ne cache-elje a luts/ mappa .cube fájljait
  if (url.pathname.includes('/luts/') || url.pathname.endsWith('.cube')) {
    event.respondWith(fetch(event.request));
    return;
  }

  // Csak same-origin GET kéréseket kezel
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        // Nem volt cache-ben: network
        return fetch(event.request)
          .then(response => {
            // Csak érvényes választ cache-elünk
            if (!response || response.status !== 200 || response.type !== 'basic') {
              return response;
            }
            const toCache = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, toCache));
            return response;
          })
          .catch(() => {
            // Network sem elérhető: offline fallback
            return caches.match('./index.html');
          });
      })
  );
});
