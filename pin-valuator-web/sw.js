// sw.js — minimal cache-first service worker. Without this registered,
// iOS will still let you "Add to Home Screen," but the app is more likely
// to show a blank white screen on slow/offline loads since nothing is
// cached locally.

const CACHE_NAME = 'pin-valuator-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/db.js',
  './js/photos.js',
  './js/filtering.js',
  './js/pin-tag-extractor.js',
  './js/ocr.js',
  './js/image-match-service.js',
  './js/price-service.js',
  './js/identify-pipeline.js',
  './js/lot-detection.js',
  './js/scan.js',
  './js/lot-scan.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Network-first for anything outside our own origin (API calls) so we
  // never serve stale data for things like price lookups; cache-first for
  // our own static assets so the shell loads instantly.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
