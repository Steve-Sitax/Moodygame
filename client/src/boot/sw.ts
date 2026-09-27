// M8e part B (docs/milestones/M8e.md): register the Service Worker (public/sw.js) for the built game.
// - Only a production build (never under vite dev: it would keep old modules), only in a secure context (https,
//   or this computer), only with a manifest (its version names the worker's cache).
// - The worker's address carries the version (/sw.js?v=<version>): a new build is a new worker, which takes over
//   at once (skipWaiting, clients.claim) and deletes the older caches. It never reloads the page: the game's own
//   version push says when (net/mp/together.ts).
// - Registered after the page has loaded and gone quiet, so its first copies come from the browser's cache and
//   do not compete with the first download over a VPN.

export function registerSw(version: string): void {
  if (import.meta.env.DEV || !version || typeof navigator === "undefined" || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  const go = () => {
    navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`, { scope: "/", updateViaCache: "none" }).then(
      (r) => console.info(`[sw] ${version}: ${r.active ? "active" : "installing"}`),
      (e) => console.warn("[sw] not registered", e),
    );
  };
  const later = () => setTimeout(() => ("requestIdleCallback" in window ? requestIdleCallback(go, { timeout: 30_000 }) : go()), 15_000);
  if (document.readyState === "complete") later();
  else window.addEventListener("load", later, { once: true });
}
