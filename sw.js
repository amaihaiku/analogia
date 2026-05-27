/* ═══════════════════════════════════════
   ANALOGIA — Service Worker v21
   Stratégia:
   - app.js / style.css / index.html: NETWORK-FIRST (mindig a legújabb, ha van net),
     cache csak offline fallback. Így a frissítés azonnal érvényesül.
   - képek / fontok / filterek: CACHE-FIRST (gyors, ritkán változik).
   - aktiváláskor a régi verziójú cache-ek törlődnek.
═══════════════════════════════════════ */

const VERSION = 'v24';
const CACHE = 'analogia-' + VERSION;

// Előre cache-elendő statikus elemek (a verziózott query nélkül is)
const PRECACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './fx.js',
  './manifest.json',
  './antik_keret_web.png',
  './icon-512.png',
  './icon-180.png',
  './filters/kodachrome.js',
  './filters/kodak_portra.js',
  './filters/fuji_velvia.js',
  './filters/cinestill.js',
  './filters/teal_orange.js',
  './filters/bleach.js',
  './filters/cross.js',
  './filters/highcontrast_bw.js',
  './filters/l_monochrome.js',
  './filters/infrared.js'
];

self.addEventListener('install', (e) => {
  // Az új SW azonnal aktívvá váljon, ne várjon a régi lapok bezárására
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      // egyenként, hogy egy hiányzó fájl ne buktassa az egész telepítést
      Promise.allSettled(PRECACHE.map((url) => c.add(url)))
    )
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      // Régi verziójú cache-ek törlése
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('analogia-') && k !== CACHE)
            .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Eldönti, hogy egy kérés "kódfájl"-e (network-first), vagy eszköz (cache-first)
function isCodeAsset(url) {
  return /\.(html|js|css)(\?|$)/i.test(url) || url.endsWith('/');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Külső erőforrás (pl. Google Fonts) — hagyjuk a hálózatra, cache fallbackkel
  if (url.origin !== self.location.origin) {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req))
    );
    return;
  }

  if (isCodeAsset(url.pathname + url.search)) {
    // NETWORK-FIRST: friss kód, ha van net; offline esetén cache
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((m) => m || caches.match('./index.html')))
    );
  } else {
    // CACHE-FIRST: képek, fontok, filterek
    e.respondWith(
      caches.match(req).then((m) =>
        m || fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
      )
    );
  }
});
