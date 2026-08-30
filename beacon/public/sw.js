// Beacon service worker. It exists so browsers offer to install the panel (a registered worker with
// a fetch listener is the requirement); it caches nothing on purpose — the panel shows live server
// state, and Next's hashed assets are already immutable in the HTTP cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("fetch", () => {});
