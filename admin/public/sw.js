// Minimal app-shell cache. /api/admin/* GETs use stale-while-revalidate so reads stay available offline.
const VERSION = 'bgc-admin-v1';
const API_CACHE = 'bgc-admin-api-v1';
const SHELL = ['/', '/index.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION && k !== API_CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  if (url.pathname.startsWith('/api/admin/') && e.request.method === 'GET') {
    e.respondWith((async () => {
      const cache = await caches.open(API_CACHE);
      const cached = await cache.match(e.request);
      const networkPromise = fetch(e.request).then(async (res) => {
        if (res.ok) {
          const body = await res.clone().text();
          const headers = new Headers(res.headers);
          headers.set('x-cache-stamp', String(Date.now()));
          if (!headers.get('Content-Type')) {
            headers.set('Content-Type', 'application/json');
          }
          const stamped = new Response(body, {
            status: res.status,
            statusText: res.statusText,
            headers,
          });
          cache.put(e.request, stamped.clone());
          return stamped;
        }
        return res;
      }).catch(() => cached);

      if (cached) {
        e.waitUntil(networkPromise);
        return cached;
      }
      return networkPromise;
    })());
    return;
  }

  // Never cache other API calls — always go to network.
  if (url.pathname.startsWith('/api/') || url.hostname.includes('workers.dev')) {
    return;
  }

  // Same-origin GET only.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  // SPA navigation: try network, fall back to cached shell.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html').then((r) => r || Response.error()))
    );
    return;
  }

  // Static assets: cache-first.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
