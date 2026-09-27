// M8e part B (docs/milestones/M8e.md): the Service Worker of the built game (plain JS: public/ is copied to
// dist as it is). Registered by src/boot/sw.ts, only on https or this computer, never under vite dev.
//
// What it keeps, and why (it must not fight the file store in boot/netboot.ts):
// - The game's files (models, textures, sounds: about 66 MB) are kept by the loader in IndexedDB under their
//   SHA-256 (it works on plain http too, where no Service Worker can). A copy here as well would hold them
//   twice, so /a/<sha256> and the other files the loader keeps are passed to the network untouched.
// - Here only the app shell: the page (index.html), Vite's built code and styles (assets/*, names with their
//   hash: the same name is always the same bytes, so from the cache first), the loading screen's picture
//   (boot/*) and the manifest. With them a reload on a shaky VPN still gets the page and the code, and the
//   loader its manifest, when the line is down for a moment.
// - The page, the manifest and boot/*: the network first (a new build must reach the player), the cache only
//   when the network fails or hangs (not on an error answer: the host's "being built" page goes through).
// - Never /api/*, /ws, /mp or /house-ca.crt (the game's calls, its sockets and the house certificate).
//
// One cache per build version (the ?v= of this worker's address, the manifest's version). A new build is a new
// worker: it takes over at once (skipWaiting, clients.claim) and deletes all caches but its own and the one
// before (a tab still running the old code may yet ask for one of its code chunks). It never reloads a page:
// the game's version push says when.

const VERSION = new URL(self.location.href).searchParams.get("v") || "none";
const PREFIX = "scheldemist-shell-";
const CACHE = PREFIX + VERSION;
const NETWORK_WAIT_MS = 6000;

const never = (p) => p.startsWith("/api/") || p === "/ws" || p === "/mp" || p === "/house-ca.crt" || p === "/sw.js";
const hashed = (p) => p.startsWith("/assets/");
const shell = (p) => p === "/" || p === "/index.html" || p === "/manifest.json" || p.startsWith("/boot/") || hashed(p);

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    (async () => {
      // the shell of this version: its page, its manifest, and what the manifest lists under assets/ and boot/
      const cache = await caches.open(CACHE);
      let man = null;
      try {
        const r = await fetch("/manifest.json", { cache: "no-cache" });
        if (r.ok) {
          man = await r.clone().json();
          await cache.put("/manifest.json", r);
        }
      } catch {
        /* the network is away: the worker fills its cache as the page asks */
      }
      if (!man || man.version !== VERSION || !Array.isArray(man.files)) return;
      const list = ["/index.html", ...man.files.map((f) => "/" + f.path).filter((p) => p !== "/index.html" && p !== "/manifest.json" && shell(p))];
      await Promise.all(
        list.map(async (p) => {
          try {
            // (the code is in the browser's cache already by now: registered after the page loaded)
            const r = await fetch(p, { cache: p === "/index.html" ? "no-cache" : "default" });
            if (r.ok) await cache.put(p, r);
          } catch {
            /* one that does not come is fetched when the page asks */
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX));
      // (keys come in the order the caches were made: keep this one and the one made before it)
      const others = names.filter((n) => n !== CACHE);
      const keep = new Set([CACHE, others[others.length - 1]]);
      await Promise.all(names.filter((n) => !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

/** The network, but not longer than NETWORK_WAIT_MS; then the cache (any version's for hashed code). */
async function networkFirst(request, key) {
  const cache = await caches.open(CACHE);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NETWORK_WAIT_MS);
    const r = await fetch(request, { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok && r.type === "basic") await cache.put(key, r.clone());
    return r;
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw e;
  }
}

async function cacheFirst(request, key) {
  // (a hashed name is the same bytes in every version: any of the kept caches will do)
  const hit = await caches.match(key);
  if (hit) return hit;
  const r = await fetch(request);
  if (r.ok && r.type === "basic") {
    const cache = await caches.open(CACHE);
    await cache.put(key, r.clone());
  }
  return r;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const p = url.pathname;
  if (never(p)) return;
  if (req.mode === "navigate" && (p === "/" || p === "/index.html")) {
    // the page, whatever its query (?seat=2): one copy
    event.respondWith(networkFirst(req, "/index.html"));
    return;
  }
  // (M8e review 4: any other address opened in the tab, /manifest.json or /boot/x.jpg, is never kept as the page:
  // it is the shell file it names, or the network's)
  if (!shell(p)) return; // (the loader's files: IndexedDB keeps them)
  if (hashed(p)) event.respondWith(cacheFirst(req, p));
  else event.respondWith(networkFirst(req, p === "/" ? "/index.html" : p));
});
