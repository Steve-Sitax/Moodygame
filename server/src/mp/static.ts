import fs from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import { allowedHost, ROOT } from "../config.ts";
import { AutoBuild, buildingPage } from "./autobuild.ts";

// M8a (docs/multiplayer-plan.md 3.2): the built game (client/dist) served by the game server itself, on one
// port, for the guests of "Open to the house" (and the host with npm run host). Only the files the manifest
// lists (tools/manifest.mjs writes client/dist/manifest.json after vite build): no folder lists, nothing
// from data/. /manifest.json is never cached; /a/<sha256> is the same bytes forever ("immutable"); the
// loader (client/src/boot/netboot.ts) keeps every file in IndexedDB under its hash and downloads only the
// hashes it does not have. A .gz copy made at build time is sent to a browser that takes gzip.

export interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}
export interface Manifest {
  version: string;
  protocol: number;
  built: string;
  files: ManifestFile[];
  total: number;
}

export const DIST = process.env.SCHELDEMIST_DIST ? path.resolve(process.env.SCHELDEMIST_DIST) : path.join(ROOT, "client", "dist");

/**
 * The server builds the game for the house itself when the build is missing or older than the code
 * (autobuild.ts): not for a dist that is not this checkout's own, not under the tests unless they ask.
 */
export const autoBuild = new AutoBuild(ROOT, DIST, !process.env.SCHELDEMIST_DIST && (!process.env.VITEST || process.env.SCHELDEMIST_AUTOBUILD === "1"));

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};
const typeOf = (p: string) => TYPES[path.extname(p).toLowerCase()] ?? "application/octet-stream";

let manifest: Manifest | null = null;
let byPath = new Map<string, ManifestFile>();
let bySha = new Map<string, ManifestFile>();
let seenMtime = 0;

/** Read the manifest again if the file changed (a new build). Returns true when it changed. */
export function reloadManifest(): boolean {
  const f = path.join(DIST, "manifest.json");
  let st: fs.Stats;
  try {
    st = fs.statSync(f);
  } catch {
    const had = manifest !== null;
    manifest = null;
    byPath = new Map();
    bySha = new Map();
    seenMtime = 0;
    return had;
  }
  if (st.mtimeMs === seenMtime) return false;
  try {
    const m = JSON.parse(fs.readFileSync(f, "utf8")) as Manifest;
    if (!Array.isArray(m.files)) throw new Error("no files");
    manifest = m;
    byPath = new Map(m.files.map((x) => [x.path, x]));
    bySha = new Map(m.files.map((x) => [x.sha256, x]));
    seenMtime = st.mtimeMs;
    return true;
  } catch (e) {
    console.warn("[mp] client/dist/manifest.json could not be read", e);
    return false;
  }
}

export const currentManifest = (): Manifest | null => manifest;

function send(file: ManifestFile, accept: string, cache: string): Response {
  const full = path.join(DIST, ...file.path.split("/"));
  const gz = `${full}.gz`;
  const headers: Record<string, string> = { "content-type": typeOf(file.path), "cache-control": cache, "x-content-type-options": "nosniff", vary: "accept-encoding" };
  let body: Buffer;
  if (/\bgzip\b/.test(accept) && fs.existsSync(gz)) {
    body = fs.readFileSync(gz);
    headers["content-encoding"] = "gzip";
  } else body = fs.readFileSync(full);
  headers["content-length"] = String(body.length);
  return new Response(new Uint8Array(body), { status: 200, headers });
}

/**
 * The routes. `enabled`: only while the game is played together over the house (or NODE_ENV=production):
 * the dev server (vite) serves the game otherwise, and nothing changes for single player.
 */
export function mountStatic(app: Hono, enabled: () => boolean): void {
  reloadManifest();
  app.get("*", async (c, next) => {
    const p = c.req.path;
    if (p.startsWith("/api/") || p === "/ws" || p === "/mp" || !enabled()) return next();
    if (!allowedHost(c.req.header("host"))) return c.text("forbidden", 403);
    // the build older than the code: a new one in the background (the guests keep the old one until it is
    // ready, then they are told: the version push); none at all: the guest waits on a page that reloads itself
    if (autoBuild.enabled && (p === "/" || p === "/index.html" || p === "/manifest.json") && autoBuild.stale()) void autoBuild.ensure();
    if (p === "/manifest.json") {
      reloadManifest();
      if (!manifest) return c.json({ error: autoBuild.enabled ? "The game is being built on the host's PC: a moment." : "no build: run npm run host", building: autoBuild.building }, autoBuild.enabled ? 503 : 404);
      return c.json(manifest, 200, { "cache-control": "no-cache" });
    }
    if (!manifest) reloadManifest();
    if (!manifest) {
      if (!autoBuild.enabled) return c.text("The game is not built on this PC: run npm run host.", 404);
      void autoBuild.ensure();
      return p === "/" || p === "/index.html" ? c.html(buildingPage(autoBuild.status), 503, { "cache-control": "no-store" }) : c.text("The game is being built on the host's PC: a moment.", 503);
    }
    const accept = c.req.header("accept-encoding") ?? "";
    const m = /^\/a\/([0-9a-f]{64})$/.exec(p);
    if (m) {
      const f = bySha.get(m[1]);
      return f ? send(f, accept, "public, max-age=31536000, immutable") : c.text("not found", 404);
    }
    const rel = p === "/" ? "index.html" : decodeURIComponent(p.slice(1));
    const f = byPath.get(rel);
    if (!f) return next();
    // Vite's own bundle names carry a hash already; everything else may change under its name
    const cache = rel.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    return send(f, accept, cache);
  });
}
