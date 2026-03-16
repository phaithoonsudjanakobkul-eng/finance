// PSLink Service Worker v1.0.0
const CACHE = 'pslink-v1';

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

// Minimal SW — enables PWA install prompt on Android/Chrome
self.addEventListener('fetch', event => {
  // Pass through all requests (no offline caching needed for Gist-based app)
});
