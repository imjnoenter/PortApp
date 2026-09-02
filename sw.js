const CACHE = 'portfolio-v2';

const PRECACHE = [
  './',
  'icons/icon.svg',
  'manifest.json',
];

// Dynamic data hosts — always bypass cache.
// Anything polled on the refresh cadence MUST be listed here. Caching a quote endpoint is both
// wrong (a stale price can be served on a network blip) and expensive on disk: Cache Storage does
// not reclaim an overwritten entry immediately — it dooms it and purges when the cache backend
// closes. A 114KB quote response rewritten every 60s therefore accrues roughly 1.3GB/week of
// doomed entries in the Chrome profile on C: while the tab stays open, and only frees on close.
const BYPASS = [
  'docs.google.com',
  'script.google.com',
  'corsproxy.io',
  'quote.cnbc.com',      // live quotes + overnight futures, hit every 60s
  'open.er-api.com',     // FX rate, hit every refresh
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'finance.yahoo.com',
  'fonts.googleapis.com',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(PRECACHE.map(url => c.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);

  // Pass through live data sources uncached
  if (BYPASS.some(h => url.hostname.includes(h))) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok && res.type !== 'opaque') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      }).catch(() => cached); // return stale on network failure

      // Cache-first for CDN assets, network-first for the app shell
      const isCDN = url.hostname.includes('jsdelivr') || url.hostname.includes('unpkg') || url.hostname.includes('gstatic');
      return isCDN && cached ? cached : (network || cached);
    })
  );
});
