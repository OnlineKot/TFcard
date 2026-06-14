/* TF CARD — service worker (PWA: instalacja na pulpit + tryb offline powłoki) */
const CACHE = 'tfcard-v13';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './store.js',
  './app.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './vending/',
  './vending/index.html',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Firebase / sieć: zawsze online (sync danych), nie cache'ujemy
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('gstatic.com') || url.hostname.includes('googleapis.com')) {
    return;
  }
  if (e.request.method !== 'GET') return;
  // Powłoka aplikacji: cache-first z aktualizacją w tle
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return res;
      }).catch(() => cached);
      return cached || net;
    })
  );
});
