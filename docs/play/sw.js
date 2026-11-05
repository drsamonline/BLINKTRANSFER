// Service worker: cache the app shell so BlinkTransfer runs with no network.
// Runtime-caches same-origin GETs (including Vite's hashed assets) on first use.

const CACHE = 'blinktransfer-v4';
const SHELL = ['./', './index.html', './manifest.json', './icon-192.svg', './icon-512.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('blinktransfer-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  const url = new URL(request.url);
  const isCode =
    request.mode === 'navigate' ||
    /\.(html|css|js|json|webmanifest)$/i.test(url.pathname);

  // Documents and code are network-first. Cache-first HTML and CSS hid every
  // release: a pushed styles.css never reached the browser, so a new control
  // arrived unstyled and the app looked broken. Images and fonts stay
  // cache-first, which is what makes it work offline.
  if (isCode) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match('./index.html')),
        ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request)
          .then((response) => {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            return response;
          })
          .catch(() => caches.match('./index.html')),
    ),
  );
});
