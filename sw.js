/**
 * Layer 3 — service worker for the GitHub Pages static build.
 *
 * Strategy (kept deliberately simple and offline-safe):
 * - install: precache the app shell (/, /ziwei, manifest, icons).
 *   Each URL is cached individually so one failure never breaks install.
 * - activate: delete caches from older versions, take control immediately.
 * - fetch:
 *   - navigations → network-first, falling back to the cached shell
 *     (ignoreSearch, so /ziwei?d=... works offline once visited);
 *   - same-origin static assets (/_next/static/, /icons/, .js/.css/
 *     .json/.webmanifest) → stale-while-revalidate;
 *   - everything else → network-first with cache fallback.
 *
 * NOTES:
 * - This file is served as-is from /purple-star-chart/sw.js; it is NOT
 *   processed by Next.
 * - Deployed as a GitHub Pages PROJECT site
 *   (https://germanhkregister.github.io/purple-star-chart/), so all paths
 *   are based at /purple-star-chart/. For a user/org site
 *   (<user>.github.io) or custom domain, re-base the paths to / — see the
 *   project-site report.
 * - Birth data never touches the network through this worker: chart
 *   computation is local, and query strings are never sent anywhere
 *   by the fetch handler (cache.match with ignoreSearch stays local).
 */
const CACHE = 'ziwei-v1';
const PRECACHE = [
  '/purple-star-chart/',
  '/purple-star-chart/ziwei',
  '/purple-star-chart/manifest.webmanifest',
  '/purple-star-chart/icons/icon-192.png',
  '/purple-star-chart/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of PRECACHE) {
        try {
          await cache.add(url);
        } catch (e) {
          // Tolerate a single precache failure (e.g. first deploy race).
          console.warn('[sw] precache failed for', url, e);
        }
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/purple-star-chart/_next/static/') ||
    url.pathname.startsWith('/purple-star-chart/icons/') ||
    /\.(?:js|css|json|webmanifest|png|svg|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache third parties

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE);
          cache.put(request, fresh.clone());
          return fresh;
        } catch (e) {
          const cached =
            (await caches.match(request, { ignoreSearch: true })) ||
            (await caches.match('/purple-star-chart/ziwei')) ||
            (await caches.match('/purple-star-chart/'));
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => null);
        return cached || (await network) || Response.error();
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      try {
        return await fetch(request);
      } catch (e) {
        return (await caches.match(request)) || Response.error();
      }
    })(),
  );
});
