/* TF CARD — service worker (stabilny cache)
   Strategia:
   • pliki aplikacji (HTML/CSS/JS) → network-first: online zawsze świeże,
     offline z cache (brak „zacięć" na starej wersji)
   • ikony/obrazki → cache-first (szybko, rzadko się zmieniają)
   • Firebase / CDN → zawsze sieć (nie cache'ujemy)
*/
const CACHE = 'tfcard-v41';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './store.js',
  './app.js',
  './firebase-config.js',
  './manifest.webmanifest',
  './vending/',
  './vending/index.html',
  './tfkfcafe/',
  './tfkfcafe/index.html',
];
const ICONS = ['./icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll([...SHELL, ...ICONS]).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isExternal(url) {
  return url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firestore.googleapis.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('cloudflare.com') ||
    url.hostname.includes('qrserver.com');
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || isExternal(url)) return; // sieć, bez cache

  const isIcon = /\.(png|svg|ico|jpg|jpeg|webp)$/i.test(url.pathname);
  if (isIcon) {
    // ikony: cache-first (rzadko się zmieniają)
    e.respondWith(caches.match(req).then((c) => c || fetch(req).then((res) => {
      if (res && res.ok) { const cl = res.clone(); caches.open(CACHE).then((k) => k.put(req, cl)); }
      return res;
    })));
    return;
  }
  // HTML/CSS/JS: network-first — zawsze najnowsza wersja online; cache tylko offline
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) { const cl = res.clone(); caches.open(CACHE).then((c) => c.put(req, cl)); }
      return res;
    }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
  );
});
