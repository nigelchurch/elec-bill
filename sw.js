// Service worker: a script the browser runs in the background, separate from the
// page. It intercepts every network request the app makes. Here it stores all
// app files in a cache on install, then serves them from that cache, which is
// what makes the app work fully offline.
//
// IMPORTANT: when you change ANY app file, bump CACHE_VERSION. The browser sees
// sw.js has changed, installs the new version, downloads fresh copies of the
// files, and deletes the old cache.

const CACHE_VERSION = 'v14';
const CACHE_NAME = `elecbill-${CACHE_VERSION}`;

// Every file the app needs. Paths are relative to this file (works on GitHub Pages
// where the app lives under /<repo-name>/).
const APP_FILES = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css',
  'js/app.js',
  'js/db.js',
  'js/csv.js',
  'js/calc.js',
  'js/format.js',
  'js/daily.js',
  'js/history.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// 1. Install: download and cache all app files.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_FILES))
      .then(() => self.skipWaiting()) // activate immediately, don't wait for old tabs to close
  );
});

// 2. Activate: delete caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('elecbill-') && k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // take control of already-open pages
  );
});

// 3. Fetch: cache first, fall back to the network.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request, { ignoreSearch: true })
      .then((cached) => cached || fetch(event.request))
  );
});
