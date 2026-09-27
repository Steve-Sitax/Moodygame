// Run the game on other ports, for a second working copy (a git worktree, e.g. M4):
// game http://localhost:5183, server 127.0.0.1:8797. Each copy has its own data/ save.
// Change the ports with SCHELDEMIST_CLIENT_PORT / SCHELDEMIST_PORT if these are taken.
import { spawn } from "node:child_process";

const env = {
  ...process.env,
  SCHELDEMIST_PORT: process.env.SCHELDEMIST_PORT || "8797",
  SCHELDEMIST_CLIENT_PORT: process.env.SCHELDEMIST_CLIENT_PORT || "5183",
  // the town map of the second game (docs/mapview.md): not the main game's 8790
  SCHELDEMIST_MAP_PORT: process.env.SCHELDEMIST_MAP_PORT || "8791",
};
console.log(`[dev:alt] game http://localhost:${env.SCHELDEMIST_CLIENT_PORT}  server 127.0.0.1:${env.SCHELDEMIST_PORT}`);
const child = spawn("npm run dev", { env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
