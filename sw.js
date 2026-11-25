// The game that lived at this address before (SKITCH) installed a cache-first service worker at
// this same path. This one replaces it: it takes over at once, deletes every cache, unregisters
// itself and reloads open pages, so nobody is left looking at the old game. Shmoove itself does
// not use a service worker.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map((n) => caches.delete(n)));
    await self.registration.unregister();
    const pages = await self.clients.matchAll({ type: 'window' });
    await Promise.all(pages.map((c) => c.navigate(c.url).catch(() => undefined)));
  })());
});
