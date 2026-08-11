/**
 * NaturalWrite service worker.
 *
 * Two jobs:
 *   1. Satisfy the Chromium/Edge installability requirement (a registered
 *      worker with a `fetch` handler) so `beforeinstallprompt` actually fires
 *      and the Install button in the header stops falling back to the
 *      manual-instructions popover.
 *   2. Provide a genuinely useful offline shell. The rewriter and the AI
 *      detector are pure client/server-side computation over text the user
 *      supplies, so the app is worth loading even on a flaky connection.
 *
 * Deliberately conservative caching rules:
 *   - /api/*            -> never touched. Always straight to the network.
 *     Caching these would serve stale samples, stale scan history, and could
 *     mask write failures. Correctness beats offline here.
 *   - navigations       -> network-first, falling back to the cached shell.
 *     Users always get fresh HTML when online; offline they still get the app.
 *   - static assets     -> stale-while-revalidate. Fast paint, self-healing.
 *   - non-GET requests  -> never intercepted.
 */

const VERSION = "naturalwrite-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

// Kept intentionally tiny. Next.js emits hashed asset filenames we cannot know
// ahead of time, so those are picked up lazily by the runtime handler below.
const SHELL_URLS = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // addAll() is atomic: one 404 would reject the whole install and leave
      // the app with no worker at all. Precaching is best-effort by design.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== SHELL_CACHE && key !== ASSET_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

/** Assets that are safe to serve from cache while refreshing in background. */
function isCacheableAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname === "/manifest.json" ||
    /\.(?:css|js|png|jpg|jpeg|svg|gif|webp|ico|woff2?)$/i.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never interfere with writes, or with anything that isn't a plain GET.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Only handle our own origin. Third-party requests pass straight through.
  if (url.origin !== self.location.origin) return;

  // API traffic is always live. Never cached, never served stale.
  if (url.pathname.startsWith("/api/")) return;

  // Page navigations: network-first so content is always fresh when online,
  // with the cached shell as an offline fallback.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(SHELL_CACHE);
          cache.put("/", fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached =
            (await caches.match(request)) || (await caches.match("/"));
          if (cached) return cached;
          return new Response(
            "<!doctype html><meta charset=utf-8><title>Offline</title>" +
              "<body style=\"font-family:system-ui;padding:2rem;color:#0f172a\">" +
              "<h1>You're offline</h1>" +
              "<p>NaturalWrite couldn't reach the network. Reconnect and reload.</p>",
            { status: 503, headers: { "Content-Type": "text/html" } },
          );
        }
      })(),
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  if (isCacheableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSET_CACHE);
        const cached = await cache.match(request);

        const network = fetch(request)
          .then((response) => {
            // Only cache complete, successful, same-origin responses.
            if (response.ok && response.status === 200) {
              cache.put(request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => undefined);

        if (cached) return cached;

        const fresh = await network;
        if (fresh) return fresh;

        return new Response("", { status: 504, statusText: "Offline" });
      })(),
    );
  }
});
