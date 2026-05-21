const CACHE_NAME = "fitness-app-v1-v222";
const INDEX_URL = new URL("index.html", self.registration.scope).href;
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css?v=222",
  "app.js?v=222",
  "manifest.json",
  "icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html") || url.pathname.endsWith("/app-info.json")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .catch(() => caches.match(INDEX_URL))
    );
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(INDEX_URL)))
  );
});
