// The player's start program in the release download (tools/package.mjs copies it to the top of the zip as
// launch.mjs; the "Start Scheldemist" file runs it with the Node inside the zip). It starts the game server in
// production mode on this PC only (play together stays off until the player turns it on in the menu), waits
// until the game answers, and opens the browser. The save and settings go to data/ next to this file.
//
//   SCHELDEMIST_PORT        the game's port (default 8787; the next free one if another program has it)
//   SCHELDEMIST_NO_BROWSER  1 = do not open the browser (tests)

import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const first = Number(process.env.SCHELDEMIST_PORT) || 8787;

/** True when Scheldemist's page answers on this port. */
async function isGame(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
    return (await r.text()).includes("<title>Scheldemist</title>");
  } catch {
    return false;
  }
}

/** What is on this port: "game" (Scheldemist already runs), "other" (another program), "free". */
async function who(port) {
  if (await isGame(port)) return "game";
  return new Promise((done) => {
    const s = net.createServer();
    s.once("error", () => done("other"));
    s.once("listening", () => s.close(() => done("free")));
    s.listen(port, "127.0.0.1");
  });
}

function openBrowser(url) {
  if (process.env.SCHELDEMIST_NO_BROWSER === "1") return;
  const [cmd, args] =
    process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true }).unref();
  } catch {
    // no browser to open: the address is printed below
  }
}

let port = first;
for (; port < first + 20; port++) {
  const w = await who(port);
  if (w === "game") {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`Scheldemist is already running: ${url}`);
    openBrowser(url);
    process.exit(0);
  }
  if (w === "free") break;
}
if (port >= first + 20) {
  console.error(`No free port between ${first} and ${first + 19}. Close some programs and try again.`);
  process.exit(1);
}

const url = `http://127.0.0.1:${port}/`;
const env = {
  ...process.env,
  NODE_ENV: "production",
  SCHELDEMIST_PORT: String(port),
  // the game comes built in the download: the server never tries to build it (mp/autobuild.ts)
  SCHELDEMIST_DIST: path.join(root, "client", "dist"),
};
console.log("Starting Scheldemist...");
const server = spawn(process.execPath, ["src/index.ts"], { cwd: path.join(root, "server"), env, stdio: "inherit" });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => server.kill(sig));
server.on("exit", (code) => process.exit(code ?? 0));

const until = Date.now() + 90_000;
while (Date.now() < until && server.exitCode === null) {
  if (await isGame(port)) {
    console.log("");
    console.log(`  Scheldemist runs at ${url}`);
    console.log("  Keep this window open while you play. Close it to stop the game.");
    console.log(`  Your save is in ${path.join(root, "data")}`);
    console.log("");
    openBrowser(url);
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
