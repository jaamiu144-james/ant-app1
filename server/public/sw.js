/* ---------------------------------------------------------------------
   sw.js — service worker for the hosted Ant App. Makes the app
   installable and lets it reopen (the shell, not live data) when the
   connection drops mid-session.

   What this does and doesn't cover, on purpose:
   - Page loads (/, /app, /login, /pricing) go to the network first —
     these carry the tenant's actual data/edition, so a stale cached copy
     would be actively wrong. Only falls back to a cached copy (or the
     offline page) when the network is unreachable.
   - /api/* is never touched here — always goes straight to the network.
     Ant App's data isn't cached for offline editing; src/lib/cloud.js
     already reports a save failure to the person instead of silently
     losing it, which is the honest behavior for a multi-tenant app that
     doesn't (yet) have an offline-first sync engine.
   - Static assets (icons, the manifest) are cache-first, since they never
     change without a new SW version.
--------------------------------------------------------------------- */
const CACHE_VERSION = 'ant-app-shell-v1';
const PRECACHE_URLS = [
  '/offline.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (event)=>{
  event.waitUntil(
    caches.open(CACHE_VERSION).then(cache=> cache.addAll(PRECACHE_URLS)).then(()=> self.skipWaiting())
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

  if(url.origin !== self.location.origin) return; // don't touch cross-origin (Stripe, etc.)
  if(url.pathname.startsWith('/api/')) return;     // always live — see note above

  if(request.mode === 'navigate'){
    event.respondWith(
      fetch(request)
        .then(res=>{
          caches.open(CACHE_VERSION).then(cache=> cache.put(request, res.clone()));
          return res;
        })
        .catch(()=> caches.match(request).then(cached=> cached || caches.match('/offline.html')))
    );
    return;
  }

  // Static assets — cache-first.
  event.respondWith(
    caches.match(request).then(cached=>{
      if(cached) return cached;
      return fetch(request).then(res=>{
        if(res.ok) caches.open(CACHE_VERSION).then(cache=> cache.put(request, res.clone()));
        return res;
      });
    })
  );
});
