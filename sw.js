const CACHE = 'portfolio-v1';

const PRECACHE = [
  './',
  'icons/icon.svg',
  'manifest.json',
];

// Dynamic data hosts — always bypass cache
const BYPASS = [
  'docs.google.com',
  'script.google.com',
  'corsproxy.io',
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
