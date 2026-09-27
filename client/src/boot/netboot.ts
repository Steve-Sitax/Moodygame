// M8a multiplayer (docs/multiplayer-plan.md 2.2 and 3.3; docs/milestones/M8a.md): the page's first code,
// before the game's own (index.html loads this; it loads main.ts when it is done).
//
// 1. Who this tab is: the host on the host PC (no token), or a guest with a player token. A guest types the
//    join code from the host's screen once; the token is kept in localStorage (per ?seat=N) and sent with
//    every call to the server. In a dev build on this PC, ?seat=2 joins by itself (the tests).
// 2. The files (a built game served by the host, npm run host): every file of the game is kept in the
//    browser (IndexedDB, one entry per SHA-256 of the manifest). Only the files whose hash is not there yet
//    are downloaded, four at a time, each checked; a new version downloads only what changed. The game's
//    own paths stay as they are: one hook (three.js's URL modifier, fetch, and an image's src) sends each
//    to its stored copy. (A Service Worker would be the usual way, but it needs https or this computer.)
// In a dev build (vite) step 2 is skipped: single player starts as it always did.

import * as THREE from "three";
import { identity, TOKEN_HEADER, tokenKey } from "../net/mp/identity";
import { secureOffer, type HouseInfo } from "../net/mp/househelp";
import { retryAfterMs } from "../net/mp/link";
import { plan, planProgress, planWords, readAll, RETRY_WAITS_MS, STALL_MS, TRIES, WHOLE_KEY } from "./files";
import { DEMO, installDemo } from "../demo/demo";

// the web demo (demo/demo.ts): its own answers to /api and the site's base path, before the fetch hook below
installDemo();

const params = new URLSearchParams(location.search);
identity.seat = Math.max(1, Math.min(8, Math.floor(Number(params.get("seat") ?? 1)) || 1));
identity.local = ["127.0.0.1", "localhost", "[::1]"].includes(location.hostname);

// M8e review 4: a guest moved here from another address of the host (the http page's secure link): #move=<code>.
// Out of the address bar and the history at once (a code works once, but it is nobody's business); redeemed below.
let moveCode: string | null = null;
if (location.hash.startsWith("#move=")) {
  const m = /^#move=([0-9a-f]{32})$/.exec(location.hash);
  moveCode = m ? m[1] : "";
  history.replaceState(history.state, "", location.pathname + location.search);
}

// ------------------------------------------------------------------ the boot card

const $ = <T extends Element>(sel: string) => document.querySelector<T>(`#boot ${sel}`);
function show(step: string, count: string, progress: number | null, now?: string): void {
  const what = $<HTMLElement>(".step .what");
  const c = $<HTMLElement>(".step .count");
  const pct = $<HTMLElement>(".step .pct");
  if (what) what.textContent = step;
  if (c) c.textContent = count;
  if (progress !== null) {
    const fill = $<HTMLElement>(".fill");
    if (fill) fill.style.transform = `scaleX(${Math.max(0.02, Math.min(1, progress)).toFixed(4)})`;
    if (pct) pct.textContent = `${Math.round(progress * 100)}%`;
  }
  if (now !== undefined) {
    const n = $<HTMLElement>(".now");
    if (n) n.textContent = now;
  }
}
const hold = (on: boolean) => ((window as unknown as { __bootHold?: boolean }).__bootHold = on);

// ------------------------------------------------------------------ the token on every call

/** Asset paths (the manifest's, no leading slash) and their stored copies. */
let assetMap: Map<string, string> | null = null;

function keyOf(url: string): string | null {
  try {
    const u = new URL(url, location.href);
    if (u.origin !== location.origin) return null;
    return decodeURIComponent(u.pathname.slice(1));
  } catch {
    return null;
  }
}
const mapped = (url: string): string => {
  if (!assetMap || url.startsWith("blob:") || url.startsWith("data:")) return url;
  const k = keyOf(url);
  return (k !== null && assetMap.get(k)) || url;
};
const isApi = (url: string) => {
  const k = keyOf(url);
  return k !== null && k.startsWith("api/");
};

{
  const orig = window.fetch.bind(window);
  const wait = window.setTimeout.bind(window); // (the untouched timer: game/pause.ts patches the global one later)
  /**
   * M8e review 4: a call the host answered 429 (too many from this PC at once) is tried again after its
   * Retry-After (at most RETRY_429 times, waits up to 5 s: net/mp/link.ts retryAfterMs); then the answer, with the
   * host's plain English error, goes to the caller. Only a call whose body can be sent again.
   */
  const with429 = async (send: () => Promise<Response>, again: boolean): Promise<Response> => {
    let r = await send();
    for (let tries = 0; again && r.status === 429; tries++) {
      const ms = retryAfterMs(r.headers.get("retry-after"), tries);
      if (ms === null) break;
      await new Promise((ok) => wait(ok, ms));
      r = await send();
    }
    return r;
  };
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (assetMap && method === "GET") {
      const m = mapped(url);
      if (m !== url) return orig(m, init);
    }
    if (!isApi(url)) return orig(input, init);
    const again = !(input instanceof Request) && !(init?.body instanceof ReadableStream);
    if (identity.token) {
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set(TOKEN_HEADER, identity.token);
      return with429(() => orig(input, { ...init, headers }), again);
    }
    return with429(() => orig(input, init), again);
  };
  // a guest saves nothing of the host's: the autosave's beacon on leaving the tab is not sent
  const beacon = navigator.sendBeacon?.bind(navigator);
  if (beacon)
    navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
      if (identity.token && isApi(String(url))) return true;
      return beacon(url, data);
    };
}

// ------------------------------------------------------------------ joining

interface Info {
  multiplayer: boolean;
  protocol: number;
  version: string;
  you: { id: number; host: boolean; guest: boolean; name: string } | null;
  /** M8e: the house's secure address and certificate (null: no https). */
  house?: HouseInfo | null;
}

async function info(token: string | null): Promise<{ status: number; body: Info | null }> {
  try {
    const r = await fetch("/api/mp/info", { headers: token ? { [TOKEN_HEADER]: token } : {}, signal: AbortSignal.timeout(8000) });
    return { status: r.status, body: r.ok ? ((await r.json()) as Info) : null };
  } catch {
    return { status: 0, body: null };
  }
}

async function join(code: string, name: string): Promise<{ token?: string; error?: string }> {
  try {
    const r = await fetch("/api/mp/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, name }), signal: AbortSignal.timeout(8000) });
    const d = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
    return r.ok && d.token ? { token: d.token } : { error: d.error ?? `The host did not answer (${r.status}).` };
  } catch {
    return { error: "The host's PC does not answer. Is the game running there?" };
  }
}

/** M8e review 4: a move code for a token of the same player (his old token ends: server mp/index.ts /api/mp/move). */
async function move(code: string): Promise<{ token?: string; error?: string }> {
  try {
    const r = await fetch("/api/mp/move", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }), signal: AbortSignal.timeout(8000) });
    const d = (await r.json().catch(() => ({}))) as { token?: string; error?: string };
    return r.ok && d.token ? { token: d.token } : { error: d.error ?? `The host did not answer (${r.status}).` };
  } catch {
    return { error: "The host's PC does not answer. Is the game running there?" };
  }
}

/** The join card over the loading screen: the code, a first name. Resolves with the token. */
function joinCard(why: string, house?: HouseInfo | null): Promise<string> {
  return new Promise((resolve) => {
    hold(false); // the boot screen holds keys and clicks; the card needs them
    const card = document.createElement("form");
    card.className = "card mp-join";
    card.style.cssText = "bottom:auto;top:34vh;z-index:3;cursor:auto";
    card.innerHTML = `
      <p class="step"><span class="what">Join the town</span></p>
      <p class="now">${why}</p>
      <p class="save" style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <label style="flex:1">Code <input name="code" autocomplete="off" spellcheck="false" maxlength="9" placeholder="KADE-47" style="width:7.5em;font:inherit;text-transform:uppercase;letter-spacing:0.08em"></label>
        <label style="flex:1">Your first name <input name="name" autocomplete="given-name" maxlength="20" placeholder="Anna" style="width:8em;font:inherit"></label>
      </p>
      <p class="save" style="margin-top:10px"><button type="submit" style="font:inherit;padding:2px 14px">Join</button> <span class="mp-join-out" style="font-style:italic"></span></p>${secureOffer(house)}`;
    document.getElementById("boot")?.appendChild(card);
    const code = card.querySelector<HTMLInputElement>("input[name=code]")!;
    const name = card.querySelector<HTMLInputElement>("input[name=name]")!;
    const out = card.querySelector<HTMLElement>(".mp-join-out")!;
    try {
      name.value = localStorage.getItem("scheldemist.mp.name") ?? "";
    } catch {
      /* no storage */
    }
    code.focus();
    card.addEventListener("submit", async (e) => {
      e.preventDefault();
      out.textContent = "Asking the host...";
      const r = await join(code.value, name.value);
      if (!r.token) {
        out.textContent = r.error ?? "No.";
        return;
      }
      try {
        localStorage.setItem("scheldemist.mp.name", name.value);
      } catch {
        /* no storage */
      }
      card.remove();
      hold(true);
      resolve(r.token);
    });
  });
}

async function whoAmI(): Promise<void> {
  const guestPage = !identity.local || identity.seat >= 2;
  if (!guestPage) {
    const r = await info(null);
    identity.together = !!r.body?.multiplayer;
    return;
  }
  let token: string | null = null;
  // M8e review 4: moved here with his man (#move=): the code's token wins over one kept for this address
  let moveNote = "";
  if (moveCode !== null) {
    const r = moveCode ? await move(moveCode) : { error: "That link to the secure address is not whole." };
    moveCode = null;
    if (r.token) token = r.token;
    else moveNote = `${(r.error ?? "The move did not work.").replace(/[&<>"']/g, " ")} `; // (the card's words are HTML)
  }
  if (!token)
    try {
      token = localStorage.getItem(tokenKey(identity.seat));
    } catch {
      /* no storage: a new join every time */
    }
  if (token) {
    const r = await info(token);
    if (r.status === 401 || (r.body && !r.body.you)) token = null; // the host removed him, or a new save: join again
    else if (r.body) identity.together = r.body.multiplayer;
  }
  if (!token && import.meta.env.DEV && identity.local) {
    // tests: a second seat in the same browser joins with the code the host's side can read
    try {
      const h = (await (await fetch("/api/mp/host")).json()) as { code?: string };
      const r = h.code ? await join(h.code, ["Anna", "Piet", "Mie", "Tist", "Lien", "Rik", "Wannes"][identity.seat - 2] ?? "Guest") : {};
      if ("token" in r && r.token) token = r.token;
    } catch {
      /* then the card */
    }
  }
  while (!token) {
    const r = await info(null);
    if (r.body && !r.body.multiplayer) {
      show("The host is playing alone", "", null, "The game on the host's PC is not open to the house. Ask the host to open it, then reload this page.");
      await new Promise((ok) => setTimeout(ok, 4000));
      continue;
    }
    token = await joinCard(moveNote + (r.status === 0 ? "The host's PC does not answer yet. Type the code when it does." : "Type the code on the host's screen, and your first name."), r.body?.house);
  }
  try {
    localStorage.setItem(tokenKey(identity.seat), token);
  } catch {
    /* no storage */
  }
  identity.token = token;
  const me = await info(token);
  identity.together = !!me.body?.multiplayer;
  if (me.body?.you?.name) show("Welcome", "", null, `You come into the town as ${me.body.you.name}.`);
}

// ------------------------------------------------------------------ the files

interface ManFile {
  path: string;
  size: number;
  sha256: string;
}
interface Manifest {
  version: string;
  protocol: number;
  files: ManFile[];
  total: number;
}

/** What the store did at this start (the kit and the tests read it: __scheldemistCache). */
export const cacheReport = { manifest: false, files: 0, stored: 0, downloaded: 0, bytes: 0, bad: 0, removed: 0, ms: 0, firstVisit: false, version: "", resumed: false, retries: 0 };
(window as unknown as { __scheldemistCache: typeof cacheReport }).__scheldemistCache = cacheReport;

/**
 * The page and the code bundle stay in the browser's normal cache (their names carry Vite's hash), and on https
 * in the Service Worker's (M8e, public/sw.js); so does the Service Worker itself.
 */
const cacheable = (p: string) => !(p === "index.html" || p === "manifest.json" || p === "sw.js" || p.startsWith("assets/") || p.startsWith("boot/"));

function idb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open("scheldemist-files", 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("files", { keyPath: "sha" });
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
      r.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((ok, bad) => ((r.onsuccess = () => ok(r.result)), (r.onerror = () => bad(r.error))));

let worker: Worker | null = null;
let jobId = 0;
const waiting = new Map<number, (sha: string) => void>();
function hashOf(buf: ArrayBuffer): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL("./sha.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; sha: string }>) => {
      waiting.get(e.data.id)?.(e.data.sha);
      waiting.delete(e.data.id);
    };
  }
  const id = ++jobId;
  return new Promise((ok) => {
    waiting.set(id, ok);
    worker!.postMessage({ id, buf }, [buf]);
  });
}

const typeOf = (p: string) =>
  ({ glb: "model/gltf-binary", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", ogg: "audio/ogg", wasm: "application/wasm", js: "text/javascript", svg: "image/svg+xml", webp: "image/webp" })[p.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

async function assetStore(): Promise<void> {
  if (import.meta.env.DEV) return;
  const t0 = performance.now();
  let man: Manifest;
  try {
    const r = await fetch("/manifest.json", { cache: "no-store", signal: AbortSignal.timeout(10_000) });
    if (!r.ok || !/json/.test(r.headers.get("content-type") ?? "")) return;
    man = (await r.json()) as Manifest;
  } catch {
    return;
  }
  cacheReport.manifest = true;
  cacheReport.version = identity.version = man.version;
  const files = man.files.filter((f) => cacheable(f.path));
  cacheReport.files = files.length;
  const db = await idb();
  if (!db) return; // no store (a private window): the files come over the network as usual
  const have = new Set((await req(db.transaction("files").objectStore("files").getAllKeys())) as string[]);
  // M8e (boot/files.ts): every file is stored as soon as it is whole and checked, so a reload (or a line that
  // dropped) goes on with the rest; the screen shows the bytes, and a file is given up only when it stalls
  let whole: string | null = null;
  try {
    whole = localStorage.getItem(WHOLE_KEY);
  } catch {
    /* no storage */
  }
  const pl = plan(files, have, man.version, whole);
  const { missing } = pl;
  const firstVisit = pl.kind === "first";
  cacheReport.firstVisit = firstVisit;
  cacheReport.resumed = pl.kind === "resume";
  const mb = (n: number) => (n / 1048576).toFixed(n < 10 * 1048576 ? 1 : 0);
  let done = 0;
  let filesDone = 0;
  const say = (now?: boolean) => {
    const w = planWords(pl, done, man.version);
    show(w.step, `${filesDone} of ${missing.length} files`, planProgress(pl, done), now ? w.now : undefined);
  };
  if (missing.length) {
    console.info(`[files] ${planWords(pl, 0, man.version).step} (${missing.length} files, ${pl.kind})`);
    say(true);
    let next = 0;
    const one = async (f: ManFile) => {
      for (let attempt = 0; attempt < TRIES; attempt++) {
        if (attempt) await new Promise((ok) => setTimeout(ok, RETRY_WAITS_MS[attempt - 1] ?? 4000));
        let got = 0;
        try {
          const ctl = new AbortController();
          const r = await fetch(`/a/${f.sha256}`, { signal: ctl.signal });
          if (!r.ok || !r.body) throw new Error(String(r.status));
          const buf = await readAll(
            r.body,
            (n) => {
              got += n;
              done += n;
              say();
            },
            STALL_MS,
            () => ctl.abort(),
          );
          const blob = new Blob([buf as BlobPart], { type: typeOf(f.path) });
          const sha = buf.length === f.size ? await hashOf(buf.buffer as ArrayBuffer) : "size";
          if (sha !== f.sha256) {
            cacheReport.bad++;
            done -= got;
            continue;
          }
          await req(db.transaction("files", "readwrite").objectStore("files").put({ sha: f.sha256, path: f.path, size: f.size, blob }));
          cacheReport.downloaded++;
          cacheReport.bytes += got;
          filesDone++;
          say();
          return;
        } catch {
          // (a stall or a dropped line: what came of this file does not count; tried again, then the network at play time)
          done -= got;
          cacheReport.retries++;
        }
      }
    };
    await Promise.all(
      [0, 1, 2, 3].map(async () => {
        while (next < missing.length) await one(missing[next++]);
      }),
    );
    // a whole, checked download: what no manifest names any more goes
    if (cacheReport.downloaded === missing.length) {
      const store = db.transaction("files", "readwrite").objectStore("files");
      for (const k of pl.stale) (store.delete(k), cacheReport.removed++);
    }
  }
  if (cacheReport.downloaded === missing.length)
    try {
      localStorage.setItem(WHOLE_KEY, man.version);
    } catch {
      /* no storage */
    }
  // every stored file as a blob: URL, by its path
  const rows = (await req(db.transaction("files").objectStore("files").getAll())) as Array<{ sha: string; path: string; blob: Blob }>;
  const bySha = new Map(rows.map((r) => [r.sha, r.blob]));
  const map = new Map<string, string>();
  for (const f of files) {
    const b = bySha.get(f.sha256);
    if (b) map.set(f.path, URL.createObjectURL(b));
  }
  cacheReport.stored = map.size;
  assetMap = map;
  identity.cached = map.size > 0;
  // the hook: three.js's loaders (models, textures, the Draco decoder), fetch (above), an image's src
  THREE.DefaultLoadingManager.setURLModifier(mapped);
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
  if (d?.set && d.get) {
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: d.enumerable,
      get() {
        return d.get!.call(this);
      },
      set(v: string) {
        d.set!.call(this, mapped(String(v)));
      },
    });
  }
  worker?.terminate();
  worker = null;
  cacheReport.ms = Math.round(performance.now() - t0);
  console.info(`[files] ${man.version}: ${map.size} of ${files.length} from the browser's store; ${cacheReport.downloaded} downloaded (${mb(cacheReport.bytes)} MB) in ${cacheReport.ms} ms`);
}

// ------------------------------------------------------------------ then the game

void (async () => {
  try {
    if (!DEMO) await whoAmI(); // the web demo has no host to join
  } catch (e) {
    console.warn("[mp] who am I", e);
  }
  try {
    await assetStore();
  } catch (e) {
    console.warn("[files] the store failed; the files come over the network", e);
  }
  void import("./sw").then((m) => m.registerSw(identity.version)); // M8e: the page and the code kept on https (boot/sw.ts)
  await import("../main");
})();
