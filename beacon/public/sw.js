// Beacon service worker. It exists so browsers offer to install the panel (a registered worker with
// a fetch listener is the requirement); it caches nothing on purpose — the panel shows live server
// state, and Next's hashed assets are already immutable in the HTTP cache. Claiming open pages lets
// the install prompt fire on the first visit.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
