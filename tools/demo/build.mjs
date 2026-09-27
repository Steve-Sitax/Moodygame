// The web demo (docs/web-demo.md): the game built for GitHub Pages, with no server. It builds the client in
// demo mode (client/src/demo/demo.ts) under the site's base path, then starts a throwaway game server on a
// new save with a fixed town (SCHELDEMIST_TOWN_SEED, no AI: walk-around mode), reads the routes the walk
// needs (client/src/demo/routes.json) and saves each as demo/<route>.json next to the game. The server and
// its save are deleted afterwards.
//
//   node tools/demo/build.mjs                       base /Moodygame/, out client/dist-demo
//   node tools/demo/build.mjs --base / --out <dir>  another base (a local try at the site root)

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const arg = (name, d) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : d;
};
const base = arg("--base", "/Moodygame/");
const out = path.resolve(root, arg("--out", "client/dist-demo"));
const port = Number(arg("--port", "8799"));
const win = process.platform === "win32";
const routes = JSON.parse(fs.readFileSync(path.join(root, "client", "src", "demo", "routes.json"), "utf8"));

// 1. the client, in demo mode
const draco = spawnSync(process.execPath, [path.join("scripts", "copy-draco.mjs")], { cwd: path.join(root, "client"), stdio: "inherit" });
if (draco.status !== 0) process.exit(draco.status ?? 1);
const vite = path.join(root, "client", "node_modules", "vite", "bin", "vite.js");
const b = spawnSync(process.execPath, [vite, "build", "--mode", "demo", "--base", base, "--outDir", out, "--emptyOutDir"], { cwd: path.join(root, "client"), stdio: "inherit" });
if (b.status !== 0) process.exit(b.status ?? 1);

// 2. a throwaway server with a fixed town, and no AI
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-demo-"));
const aiFile = path.join(tmp, "ai-config.json");
fs.writeFileSync(
  aiFile,
  JSON.stringify({
    version: 1,
    mode: "walk",
    typedLines: "same",
    default: { provider: "none" },
    kinds: {},
    connections: { anthropic_api: {}, openai_compat: { baseUrl: "https://api.openai.com/v1" }, ollama: { baseUrl: "http://127.0.0.1:11434" } },
  }),
);
const env = {
  ...process.env,
  NODE_ENV: "production",
  SCHELDEMIST_PORT: String(port),
  SCHELDEMIST_DB: path.join(tmp, "demo.sqlite"),
  SCHELDEMIST_AI_CONFIG: aiFile,
  SCHELDEMIST_TOWN_SEED: "1873",
  SCHELDEMIST_MAP_PORT: "0",
  SCHELDEMIST_DIST: out,
};
const server = spawn(process.execPath, ["src/index.ts"], { cwd: path.join(root, "server"), env, stdio: ["ignore", "inherit", "inherit"] });
const stop = () => {
  if (server.exitCode !== null) return;
  if (win) spawnSync("taskkill", ["/pid", String(server.pid), "/t", "/f"], { stdio: "ignore" });
  else server.kill("SIGTERM");
};
process.on("exit", stop);

let failed = false;
try {
  const api = `http://127.0.0.1:${port}/api/`;
  const until = Date.now() + 180_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error("the server stopped before the town was made");
    if (Date.now() > until) throw new Error("the town was not made within 3 minutes");
    try {
      const r = await fetch(api + "town", { signal: AbortSignal.timeout(5000) });
      if (r.ok) break;
    } catch {
      // not up yet
    }
    await new Promise((ok) => setTimeout(ok, 1000));
  }
  // 3. the routes the walk needs, as files
  fs.mkdirSync(path.join(out, "demo"), { recursive: true });
  let bytes = 0;
  for (const route of routes) {
    const r = await fetch(api + route, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) {
      console.warn(`[demo] ${route}: ${r.status}, left out (the game takes its fallback)`);
      continue;
    }
    const body = await r.text();
    JSON.parse(body); // must be JSON
    fs.writeFileSync(path.join(out, "demo", `${route.replace(/\//g, "_")}.json`), body);
    bytes += body.length;
  }
  fs.writeFileSync(path.join(out, ".nojekyll"), ""); // GitHub Pages: serve the files as they are
  console.log(`[demo] ${out}: the game under ${base}, ${routes.length} routes baked (${(bytes / 1e6).toFixed(1)} MB)`);
} catch (e) {
  console.error(`[demo] ${e.message}`);
  failed = true;
} finally {
  stop();
  await new Promise((ok) => setTimeout(ok, 1000));
  fs.rmSync(tmp, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
