/* LAN Share service worker — kept intentionally minimal.
   Its only job is to make the app installable; all requests go to the
   network so updates apply immediately and nothing goes stale. */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Pass-through: no caching.
});
