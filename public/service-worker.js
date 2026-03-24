// Kill service worker — unregisters itself and clears all caches.
// The old CRA build registered a service worker that persists in users'
// browsers even after we removed the code. This file replaces it,
// nukes the cache, and self-destructs.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((name) => caches.delete(name)))
    ).then(() => self.clients.matchAll()).then((clients) => {
      clients.forEach((client) => client.navigate(client.url));
      return self.registration.unregister();
    })
  );
});
