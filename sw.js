/* ═══════════════════════════════════════
   ANALOGIA — sw.js (Pass-Through Smart PWA Bypass)
   Enables 100% PWA installability on Android/iOS
   while bypassing local storage caching to eliminate 
   the developer cache prison.
═══════════════════════════════════════ */
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  // Pass-through hálózati átjáró gyorsítótárazás nélkül
  e.respondWith(fetch(e.request));
});