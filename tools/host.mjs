// M8a multiplayer: `npm run host` (docs/milestones/M8a.md). Builds the game, writes the manifest, and starts the
// game server as the host: in production mode (no dev routes), serving the built game on its own port, and
// open to the house (it listens on this PC's home-network addresses too). Stop it with Ctrl+C.
//
//   npm run host                 build, then serve on 8787, open to the house
//   npm run host -- --no-build   serve the last build
//   npm run host -- --alone      serve the build on this PC only (not open to the house)
// Environment as for the server: SCHELDEMIST_PORT, SCHELDEMIST_DB.

import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
if (!args.includes("--no-build")) {
  const b = spawnSync(npm, ["--prefix", "client", "run", "build"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const m = spawnSync(process.execPath, [path.join(root, "tools", "manifest.mjs")], { cwd: root, stdio: "inherit" });
if (m.status !== 0) process.exit(m.status ?? 1);
const env = { ...process.env, NODE_ENV: "production" };
if (args.includes("--alone")) env.SCHELDEMIST_MP = "1";
else env.SCHELDEMIST_LAN = "1";
const s = spawn(process.execPath, ["src/index.ts"], { cwd: path.join(root, "server"), env, stdio: "inherit" });
const port = Number(process.env.SCHELDEMIST_PORT) || 8787;
console.log(`[host] the game on this PC: http://127.0.0.1:${port}/  (the address and the join code for the others are in the menu, Together)`);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => s.kill(sig));
s.on("exit", (c) => process.exit(c ?? 0));
