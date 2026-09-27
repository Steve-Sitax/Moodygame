// The web demo (docs/web-demo.md): the game built for GitHub Pages, with no server. It builds the client in
// demo mode (client/src/demo/demo.ts) under the site's base path, then starts a throwaway game server on a
// new save with a fixed town (SCHELDEMIST_TOWN_SEED, no AI: walk-around mode), reads the routes the walk
// needs (client/src/demo/routes.json) and saves each as demo/<route>.json next to the game. Then it records
// the director's event templates one by one (Steve 2026-09-27: "make it all available"): each is started with the
// dev route, the clock is ticked on, and every tick's GET /api/actions (and the cathedral's room for a wedding or a
// funeral) is kept as a frame in demo/events/<template>.json; the demo plays the frames back (demo/demo.ts). The
// server runs in dev mode for the dev routes. The server and its save are deleted afterwards.
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
/** The director's templates the demo can start, each on a day and at an hour it fits (emigrant ships sail on days 2, 4, 6). */
const EVENTS = [
  { id: "musicians", day: 1, hour: 15 },
  { id: "fish_auction", day: 1, hour: 7 },
  { id: "quarrel", day: 1, hour: 11 },
  { id: "scuffle", day: 1, hour: 17 },
  { id: "house_fire", day: 1, hour: 13 },
  { id: "hiring", day: 1, hour: 6 },
  { id: "wedding", day: 1, hour: 10, weather: "clear" },
  { id: "funeral", day: 3, hour: 10 },
  { id: "emigrant_ship", day: 2, hour: 9 },
  { id: "street_robbery", day: 1, hour: 21 },
  { id: "tavern_brawl", day: 1, hour: 21 },
  { id: "night_watch", day: 1, hour: 22 },
  { id: "burglary", day: 1, hour: 23 },
  { id: "smuggling", day: 1, hour: 23 },
];
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
  NODE_ENV: "development", // the dev routes (set the clock, start a template) for the recording
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
  // the town's own plans at start (the engine's first event) never start in the demo: the baked actions hold none;
  // a recorded event brings its own (below)
  const actFile = path.join(out, "demo", "actions.json");
  if (fs.existsSync(actFile)) {
    const a = JSON.parse(fs.readFileSync(actFile, "utf8"));
    fs.writeFileSync(actFile, JSON.stringify({ actions: [], convos: [], events: [], closed: a.closed ?? [] }));
  }

  // 4. the events, recorded frame by frame
  const post = (route, body = {}) =>
    fetch(api + route, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }).then((r) => r.json());
  const get = (route) => fetch(api + route, { signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r.json() : null));
  fs.mkdirSync(path.join(out, "demo", "events"), { recursive: true });
  const recorded = [];
  for (const ev of EVENTS) {
    // refused (another event is there then): two and four hours later
    let plan = { ok: false, why: "" };
    for (const h of [ev.hour, ev.hour + 2, ev.hour + 4].filter((h) => h < 24)) {
      await post("dev/set", { day: ev.day, hour: h, minute: 0, weather: ev.weather ?? "mist" });
      plan = await post("dev/director", { template: ev.id });
      if (plan.ok) {
        ev.hour = h;
        break;
      }
    }
    if (!plan.ok) {
      console.warn(`[demo] event ${ev.id}: refused (${plan.why ?? "?"}), left out`);
      continue;
    }
    const frames = [];
    let at = null;
    for (let i = 0; i < 80; i++) {
      await post("dev/set", {}); // lets the next tick through at once (the server's 9-second guard)
      await post("tick", {});
      const a = await get("actions");
      const events = (a?.events ?? []).filter((e) => e.id === plan.id);
      const actions = (a?.actions ?? []).filter((x) => x.event_id === plan.id);
      const convos = (a?.convos ?? []).filter((x) => x.event_id === plan.id);
      if (!events.length && !actions.length && i > 1) break;
      if (!at && events[0]) at = { x: events[0].x ?? events[0].stages?.[0]?.x, z: events[0].z ?? events[0].stages?.[0]?.z };
      const frame = { events, actions, convos };
      if (ev.id === "wedding" || ev.id === "funeral") frame.landmark = await get("landmark/cathedral");
      frames.push(frame);
    }
    // the event has ended: nothing of it may linger into the next recording
    const file = { template: ev.id, title: plan.title, where: plan.where, start: { day: ev.day, hour: ev.hour, minute: 0 }, weather: ev.weather ?? "mist", at, frames };
    const body = JSON.stringify(file);
    fs.writeFileSync(path.join(out, "demo", "events", `${ev.id}.json`), body);
    recorded.push(`${ev.id} ${frames.length}`);
    bytes += body.length;
  }
  fs.writeFileSync(path.join(out, "demo", "events", "index.json"), JSON.stringify(recorded.map((r) => r.split(" ")[0])));
  console.log(`[demo] events recorded (frames): ${recorded.join(", ")}`);

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
