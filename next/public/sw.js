// Service worker: lets the app open without a connection, showing the last figures it had.
//
// The app's own files: network first, the cached copy when offline. Hashed build assets and web
// fonts never change under the same URL, so those are cache first. Live data (the sheet, the
// script, quotes) is never touched: a stale price shown as current would be worse than none.
const CACHE = 'portapp-next-v1';
const LIVE = ['docs.google.com', 'script.google.com', 'script.googleusercontent.com', 'quote.cnbc.com', 'generativelanguage.googleapis.com', 'api.frankfurter.app'];
const FOREVER = ['fonts.gstatic.com', 'fonts.googleapis.com', 'financialmodelingprep.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()),
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (LIVE.some(h => url.hostname.endsWith(h))) return;
  const own = url.origin === self.location.origin;
  if (!own && !FOREVER.some(h => url.hostname.endsWith(h))) return;

  const put = res => { if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; };
  if (!own || url.pathname.includes('/assets/')) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(put)));
  } else {
    e.respondWith(fetch(req).then(put).catch(() => caches.match(req).then(hit => hit || caches.match('./'))));
  }
});
