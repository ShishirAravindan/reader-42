// Service worker: the app shell, precached.
//
// Scope is deliberately narrow. This worker owns exactly the shell — the
// HTML, bundle, styles, manifest, icons — so the app cold-opens with no
// network. Library traffic (/lib/* in dev, and whatever a transport fetches)
// is never intercepted here: book bytes and sidecars belong to the on-device
// book cache, which the transport layer owns explicitly.
//
// Strategy is cache-first with a background refresh: the cached shell is
// served immediately (the under-a-second product law), and a fresh copy is
// fetched behind it so the next open picks up a deployed update. Bumping
// VERSION drops the old cache wholesale on activate.
//
// Plain JS on purpose: the worker ships as-is, outside the bundle.

const VERSION = 'shell-v3';
const SHELL = [
  '/',
  '/app.js',
  '/styles.css',
  '/manifest.webmanifest',
  '/icon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/fonts/Literata-var.woff2',
  '/fonts/Literata-Italic-var.woff2',
  '/fonts/AtkinsonHyperlegible-Regular.woff2',
  '/fonts/AtkinsonHyperlegible-Bold.woff2',
  '/fonts/AtkinsonHyperlegible-Italic.woff2',
  '/fonts/AtkinsonHyperlegible-BoldItalic.woff2',
  '/fonts/OpenDyslexic-Regular.woff2',
  '/fonts/OpenDyslexic-Bold.woff2',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/lib/')) return; // library bytes are the transport's business
  // Hash routing means every navigation is the shell document.
  const path = event.request.mode === 'navigate' ? '/' : url.pathname;
  if (!SHELL.includes(path)) return;
  event.respondWith(fromCacheThenRefresh(path));
});

async function fromCacheThenRefresh(path) {
  const cache = await caches.open(VERSION);
  const cached = await cache.match(path);
  const refresh = fetch(path)
    .then((res) => {
      if (res.ok) cache.put(path, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) return cached;
  const fresh = await refresh;
  if (fresh) return fresh;
  return new Response('offline and not cached', { status: 503 });
}
