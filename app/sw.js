// Service worker: caches the app shell only. API requests go to another origin and are
// never intercepted or cached, so task data is always fetched live.
const CACHE = "open-brain-tasks-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "js/api.js",
  "js/app.js",
  "js/config.js",
  "js/dialog.js",
  "js/logic.js",
  "js/tabs.js",
  "js/views.js",
  "icons/icon-192.png",
  "icons/icon-512.png"
];
const SHELL_URLS = new Set(SHELL.map((p) => new URL(p, self.location.href).href));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Network first, so a new publish shows up on the next load; the cached shell is the fallback.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || !SHELL_URLS.has(request.url)) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./"))),
  );
});
