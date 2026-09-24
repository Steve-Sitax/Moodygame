// The test stack (docs/testing.md): a copy of Steve's save with its own server and vite, so a
// browser check never touches data/game.sqlite or the game on 5173/8787.
//
//   node tools/teststack.mjs start [name]   copy the save, start server 8941 + vite 5341, print the URL
//   node tools/teststack.mjs stop [name]    stop both (by port) and delete the copy, its logs and config
//   node tools/teststack.mjs status         what listens on the test ports
//
// Options: --server 8941 --vite 5341 (another pair lets two stacks run at once). The name only
// names the files (data/test-<name>.sqlite ...); default "check".

import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, openSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const data = path.join(root, "data");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const cmd = args[0] ?? "status";
const name = (args[1] && !args[1].startsWith("--") ? args[1] : "check").replace(/[^a-z0-9_-]/gi, "");
const SERVER = opt("server", 8941);
const VITE = opt("vite", 5341);
if ([8787, 5173].includes(SERVER) || [8787, 5173].includes(VITE)) throw new Error("8787 and 5173 are Steve's own game: pick other ports");

const db = path.join(data, `test-${name}.sqlite`);
const cfg = path.join(data, `vite-test-${name}.config.mjs`);
const logS = path.join(data, `test-${name}-server.log`);
const logV = path.join(data, `test-${name}-vite.log`);

/** PIDs listening on a port (Windows netstat, else lsof). */
function listeners(port) {
  try {
    if (process.platform === "win32") {
      const out = execSync(`netstat -ano -p tcp`, { encoding: "utf8", timeout: 10_000 });
      return [...new Set(out.split(/\r?\n/).filter((l) => /LISTENING/.test(l) && new RegExp(`:${port}\\s`).test(l)).map((l) => l.trim().split(/\s+/).pop()))];
    }
    return execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8", timeout: 10_000 }).split(/\s+/).filter(Boolean);
  } catch {
    return [];
  }
}

function kill(pid) {
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${pid} /F /T`, { stdio: "ignore", timeout: 10_000 });
    else process.kill(Number(pid), "SIGTERM");
  } catch {
    /* gone already */
  }
}

async function up(url, secs) {
  for (let i = 0; i < secs * 2; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.ok || r.status < 500) return true;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function start() {
  for (const p of [SERVER, VITE]) if (listeners(p).length) throw new Error(`port ${p} is in use: node tools/teststack.mjs stop first`);
  // the copy: better-sqlite3's online backup, safe while Steve's server writes
  const require = createRequire(path.join(root, "server", "package.json"));
  const Database = require("better-sqlite3");
  const live = new Database(path.join(data, "game.sqlite"), { readonly: true });
  for (const f of [db, `${db}-shm`, `${db}-wal`]) rmSync(f, { force: true });
  await live.backup(db);
  live.close();
  writeFileSync(
    cfg,
    `// made by tools/teststack.mjs for the test stack "${name}" (deleted by stop)
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
export default {
  root: path.join(here, "..", "client"),
  server: {
    port: ${VITE},
    host: "127.0.0.1",
    strictPort: true,
    open: false,
    hmr: false,
    fs: { allow: [path.join(here, "..")] },
    proxy: { "/api": "http://127.0.0.1:${SERVER}", "/ws": { target: "ws://127.0.0.1:${SERVER}", ws: true } },
  },
};
`,
  );
  const server = spawn(process.execPath, ["src/index.ts"], {
    cwd: path.join(root, "server"),
    env: { ...process.env, SCHELDEMIST_DB: db, SCHELDEMIST_PORT: String(SERVER) },
    detached: true,
    windowsHide: true,
    stdio: ["ignore", openSync(logS, "w"), openSync(logS, "a")],
  });
  server.unref();
  const vite = spawn(process.execPath, [path.join(root, "client", "node_modules", "vite", "bin", "vite.js"), "--config", cfg], {
    cwd: path.join(root, "client"),
    detached: true,
    windowsHide: true,
    stdio: ["ignore", openSync(logV, "w"), openSync(logV, "a")],
  });
  vite.unref();
  const okS = await up(`http://127.0.0.1:${SERVER}/api/ballad`, 40);
  const okV = await up(`http://127.0.0.1:${VITE}/`, 40);
  if (!okS || !okV) {
    console.log(`not up: server ${okS ? "ok" : "no"} (log ${logS}), vite ${okV ? "ok" : "no"} (log ${logV})`);
    process.exitCode = 1;
    return;
  }
  console.log(`test stack "${name}" up: http://127.0.0.1:${VITE}/  (server ${SERVER}, save ${path.relative(root, db)})`);
  console.log(`in the tab: __scheldemist.free(true); __scheldemist.t.help()`);
}

function stop() {
  for (const p of [SERVER, VITE]) for (const pid of listeners(p)) kill(pid);
  const left = [SERVER, VITE].filter((p) => listeners(p).length);
  for (const f of [db, `${db}-shm`, `${db}-wal`, logS, logV, cfg]) rmSync(f, { force: true });
  console.log(left.length ? `still listening: ${left.join(", ")}` : `test stack "${name}" stopped; copy, logs and config deleted`);
}

if (cmd === "start") await start();
else if (cmd === "stop") stop();
else console.log(`server ${SERVER}: ${listeners(SERVER).join(", ") || "free"}; vite ${VITE}: ${listeners(VITE).join(", ") || "free"}; copy ${existsSync(db) ? "present" : "none"}`);
