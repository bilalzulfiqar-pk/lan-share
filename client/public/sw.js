/* LAN Share Service Worker
   Guaranteed Freshness: Network-First with Offline Cache Fallback for static app shell.
   Never caches socket.io, signaling, or API requests. Updates apply immediately. */

const CACHE_NAME = 'lan-share-shell-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html'
];

self.addEventListener('install', (event) => {
  if (event && typeof event.waitUntil === 'function' && typeof caches !== 'undefined') {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
    );
  }
  if (typeof self.skipWaiting === 'function') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  if (event && typeof event.waitUntil === 'function') {
    const claimPromise = (self.clients && typeof self.clients.claim === 'function')
      ? self.clients.claim()
      : Promise.resolve();

    const cleanup = (typeof caches !== 'undefined')
      ? caches.keys().then((keys) => Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )).catch(() => {})
      : Promise.resolve();

    event.waitUntil(Promise.all([claimPromise, cleanup]));
  } else if (self.clients && typeof self.clients.claim === 'function') {
    self.clients.claim();
  }
});

self.addEventListener('fetch', (event) => {
  if (!event || !event.request) return;
  const { request } = event;
  if (request.method !== 'GET') return;

  const urlStr = request.url || '';
  let pathname = '';
  let origin = '';

  try {
    if (typeof URL !== 'undefined') {
      const parsed = new URL(urlStr, (self.location && self.location.href) || 'https://lan-share.vercel.app');
      pathname = parsed.pathname;
      origin = parsed.origin;
    }
  } catch {
    // fallback
  }

  if (!pathname) {
    const match = urlStr.match(/^https?:\/\/[^/]+(\/[^?#]*)?/);
    pathname = match ? (match[1] || '/') : '/';
    origin = match ? match[0].replace(/(\/[^?#]*)?$/, '') : '';
  }

  // Same origin only
  if (self.location && self.location.origin && origin && origin !== self.location.origin) {
    return;
  }

  // Explicit bypass: Static SEO assets, APIs, health, and real-time signaling
  const bypassPaths = [
    '/robots.txt',
    '/sitemap.xml',
    '/llms.txt',
    '/banner.svg',
    '/favicon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/manifest.webmanifest',
    '/health',
    '/turn'
  ];

  if (
    bypassPaths.includes(pathname) ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/socket.io/')
  ) {
    return;
  }

  // Only handle app shell and static bundles
  const isAppShell = pathname === '/' || pathname === '/index.html' || pathname.startsWith('/assets/');
  if (!isAppShell) {
    return;
  }

  if (typeof fetch !== 'function' || typeof caches === 'undefined' || typeof event.respondWith !== 'function') {
    return;
  }

  event.respondWith(
    fetch(request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone)).catch(() => {});
        }
        return networkResponse;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === 'navigate') {
          const fallback = await caches.match('/index.html') || await caches.match('/');
          if (fallback) return fallback;
        }
        return new Response('Offline: LAN Share requires a network connection to load.', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain' }
        });
      })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});
