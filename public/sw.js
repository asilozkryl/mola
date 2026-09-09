/* Public offline assets only. Authentication, API responses and chat pages are never cached. */
const CACHE = "mola-public-v1";
const PUBLIC_FILES = [
  "/offline.html",
  "/icons/mola-192.png",
  "/icons/mola-512.png",
  "/icons/mola-maskable-512.png",
  "/favicon.svg",
  "/manifest.webmanifest",
];
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PUBLIC_FILES))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("mola-public-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/socket.io/")
  )
    return;
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(
        async () => (await caches.match("/offline.html")) || Response.error(),
      ),
    );
  } else if (PUBLIC_FILES.includes(url.pathname) && !url.search) {
    event.respondWith(
      fetch(event.request).catch(
        async () => (await caches.match(url.pathname)) || Response.error(),
      ),
    );
  }
});
function notificationUrl(value) {
  try {
    const url = new URL(
      typeof value === "string" ? value : "/",
      self.location.origin,
    );
    if (url.origin !== self.location.origin || url.pathname !== "/")
      return self.location.origin + "/";
    const safe = new URL("/", self.location.origin);
    for (const key of ["workspace", "message"]) {
      const id = url.searchParams.get(key);
      if (
        id &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
          id,
        )
      )
        safe.searchParams.set(key, id);
    }
    return safe.href;
  } catch {
    return self.location.origin + "/";
  }
}
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    /* A generic visible notification remains safe for malformed payloads. */
  }
  const diagnostic = payload.test === true;
  event.waitUntil(
    self.registration.showNotification("Mola", {
      body: diagnostic
        ? "Test bildirimin bu cihaza ulaştı."
        : "Yeni bir bildirimin var.",
      icon: "/icons/mola-192.png",
      badge: "/icons/mola-192.png",
      tag:
        typeof payload.tag === "string"
          ? payload.tag.slice(0, 128)
          : "mola-notification",
      data: {
        url: diagnostic
          ? self.location.origin + "/"
          : notificationUrl(payload.url),
        test: diagnostic,
      },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = notificationUrl(event.notification.data?.url);
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        const appClients = clients.filter((client) => {
          try {
            const candidate = new URL(client.url);
            return (
              candidate.origin === self.location.origin &&
              candidate.pathname === "/"
            );
          } catch {
            return false;
          }
        });
        const existing =
          appClients.find((client) => client.focused) ||
          appClients.find((client) => client.visibilityState === "visible") ||
          appClients[0];
        if (existing) {
          try {
            // A diagnostic only focuses the app; keep its current conversation/call.
            if (event.notification.data?.test !== true)
              existing.postMessage({ type: "mola:notification-open", url });
            return await existing.focus();
          } catch {
            /* A tab may close between enumeration and focusing. */
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
