// @ts-nocheck
// PSLink v2 service worker — minimal precache + offline fallback.
//
// Cache strategy:
//   - On install: precache the shell (HTML + main JS chunk)
//   - On fetch:
//       same-origin asset → cache-first, fall through to network on miss,
//                            update cache on 200
//       cross-origin       → network-first (data: APIs, R2, OpenRouter)
//
// CACHE_NAME bumps on every visual-phase commit that ships SW changes.
// Outdated caches are pruned on activate.

const CACHE_NAME = 'pslink-v2-2026-05-11';
const SHELL_URLS = [
    './',
    './index.html',
    './main.js',
    './manifest.webmanifest',
];

self.addEventListener('install', (e) => {
    e.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        await Promise.allSettled(SHELL_URLS.map((u) => cache.add(u).catch(() => {})));
        self.skipWaiting();
    })());
});

self.addEventListener('activate', (e) => {
    e.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    const sameOrigin = url.origin === self.location.origin;

    if (sameOrigin) {
        // Cache-first
        e.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            const cached = await cache.match(req);
            if (cached) return cached;
            try {
                const res = await fetch(req);
                if (res && res.status === 200 && res.type === 'basic') {
                    cache.put(req, res.clone());
                }
                return res;
            } catch (_e) {
                // Last-resort offline fallback for navigation requests
                if (req.mode === 'navigate') {
                    const shell = await cache.match('./index.html');
                    if (shell) return shell;
                }
                throw _e;
            }
        })());
        return;
    }

    // Cross-origin: network-first, no caching. (APIs, R2, OpenRouter, TradingView, etc.)
    // Leave the default behaviour by NOT calling respondWith — browser handles it.
});
