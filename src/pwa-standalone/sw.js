/* ---------------------------------------------------------------------
   sw.js — service worker for the standalone downloadable Ant App
   editions. These are fully self-contained (all data lives in this
   browser's localStorage, no server involved at all), so unlike the
   hosted app's service worker, this one just needs to make the page
   installable and reopenable offline — there's no live data to keep
   fresh from a network, since there's no network dependency to begin
   with once the page has loaded once.

   Only requires this file + manifest.webmanifest + icons/ to sit next
   to the .html file on whatever static host serves it (this doesn't do
   anything useful opened straight from disk via file:// — browsers
   don't register service workers for that origin).
--------------------------------------------------------------------- */
const CACHE_VERSION = 'ant-app-standalone-v1';

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache=> cache.addAll([
      './manifest.webmanifest',
      './icons/icon-192.png',
      './icons/icon-512.png',
      './icons/apple-touch-icon.png',
    ]).catch(()=>{ /* fine if any of these 404 on a given host layout */ }))
      .then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', (event)=>{
  event.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>k!==CACHE_VERSION).map(k=>caches.delete(k))))
      .then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', (event)=>{
  const { request } = event;
  const url = new URL(request.url);
  if(url.origin !== self.location.origin) return;

  // Cache-first, and lazily cache the app page itself on first load
  // (its filename varies per edition, so it isn't precached by name).
  event.respondWith(
    caches.match(request).then(cached=>{
      if(cached) return cached;
      return fetch(request).then(res=>{
        if(res.ok) caches.open(CACHE_VERSION).then(cache=> cache.put(request, res.clone()));
        return res;
      }).catch(()=> cached);
    })
  );
});
