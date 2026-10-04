// Godot milestone checks. Fresh test towns only, one visible window at a time, bounded child processes.
// node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`--${name} needs a value`); return args[i + 1]; };
const all = ["devtest", "paths", "stuck", "shaders", "perfcheck", "clocks", "interiors"];
const extras = ["pixelcheck", "windows", "peopletest", "jobtest", "placestest", "eventtest", "ridetest", "playtest", "deedstest", "soundtest"];
const selected = opt("only", all.join(",")).split(",");
if (selected.some(name => ![...all, ...extras].includes(name))) throw new Error("--only: " + [...all, ...extras].join(","));
const town = path.resolve(opt("town", "godot/baked/town.glb"));
const perfLock = path.resolve(opt("perf-lock", path.join(path.dirname(town), path.basename(path.dirname(town)) === "next" ? "../PERF-LOCK" : "PERF-LOCK")));
const models = path.resolve(opt("models", path.join(path.dirname(town), "models")));
const out = path.resolve(opt("out", "godot/baked/checks"));
const godot = opt("godot", process.env.SCHELDEMIST_GODOT ?? path.join(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Packages/GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe"));
const timeout = Number(opt("timeout", "240")) * 1000;
const seed = Number(opt("seed", "1873"));
const extraArgs = JSON.parse(opt("args", "[]"));
if (!Array.isArray(extraArgs) || extraArgs.some(a => typeof a !== "string")) throw new Error("--args must be a JSON array of Godot user arguments");
if (args.includes("--profile-parts")) extraArgs.push("--profile-parts");
if (!Number.isInteger(seed) || seed <= 0 || seed > 2147483647) throw new Error("--seed must be 1..2147483647");
let port = Number(opt("port", "8980"));
if (!Number.isInteger(port) || port < 8900 || port > 64000) throw new Error("--port must be 8900..64000");
const firstPort = port, lastPort = Number(opt("port-end", "64000"));
if (!Number.isInteger(lastPort) || lastPort < port + 1 || lastPort > 64000) throw new Error("--port-end must leave room for the port pair");
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) throw new Error("--timeout must be 1..600 seconds");
for (const file of [town, path.join(models, "people.glb"), path.join(root, "server/node_modules"), godot]) if (!existsSync(file)) throw new Error("missing " + file);
mkdirSync(out, { recursive: true });
const children = new Set();
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise(resolve => child.once("close", resolve));
  if (process.platform === "win32") await new Promise(resolve => {
    const kill = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    kill.on("close", resolve); kill.on("error", resolve);
  });
  else child.kill("SIGKILL");
  // taskkill's exit does not mean the child's SQLite handles and output pipes have closed yet.
  await Promise.race([closed, new Promise(resolve => setTimeout(resolve, 5000))]);
}
async function cleanup() { await Promise.all([...children].map(stop)); }
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await cleanup(); process.exit(130); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(exe, argv, limit, logFile, environment = {}) {
  if (exe === godot) while (existsSync(perfLock)) {
    console.log("PERF-LOCK present; no Godot run started; checking again in 60 seconds");
    await pause(60000);
  }
  const child = spawn(exe, argv, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...environment } });
  children.add(child);
  let text = "", timedOut = false;
  child.stdout.on("data", b => { text += b; }); child.stderr.on("data", b => { text += b; });
  const timer = setTimeout(() => { timedOut = true; void stop(child); }, limit);
  try {
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve(code ?? 2)); });
    if (logFile) writeFileSync(logFile, text);
    else process.stdout.write(text);
    if (timedOut) throw new Error(`timed out after ${limit / 1000} s`);
    return code;
  } finally { clearTimeout(timer); await stop(child); children.delete(child); }
}
const free = port => new Promise(resolve => {
  const listener = net.createServer();
  listener.once("error", () => resolve(false));
  listener.listen(port, "127.0.0.1", () => listener.close(() => resolve(true)));
});
async function nextPort() {
  for (let n = 0; n < Math.floor((lastPort - firstPort + 1) / 2); n++) {
    if (port + 1 > lastPort) port = firstPort;
    const result = port; port += 2;
    if (await free(result) && await free(result + 1)) return result;
  }
  throw new Error("no free check port");
}
function numbers(name, report) {
  switch (name) {
    case "soundtest": return `${report.rows} sound rows, ${report.problems?.length ?? "?"} problems`;
    case "jobtest": return `${report.steps?.length ?? "?"} steps, Vismarkt frame ${report.frame_ms?.mean ?? "?"} ms`;
    case "placestest": case "playtest": return `${report.steps?.length ?? "?"} steps; ${report.error ?? ""}`;
    case "deedstest": return `${report.checks?.length ?? "?"} checks; ${report.error ?? ""}`;
    case "eventtest": return `${report.stages?.length ?? "?"} stages, ${report.failures?.length ?? "?"} failures`;
    case "ridetest": return `${report.checks?.length ?? "?"} checks; ${report.error ?? ""}`;
    case "devtest": return `${report.steps?.filter(s => s.ok).length ?? 0}/${report.steps?.length ?? 0} steps`;
    case "paths": return `${report.unreachable?.length ?? "?"} unreachable / ${report.checkedCount ?? "?"} targets`;
    case "stuck": return `${report.stuck?.length ?? "?"} stuck, ${report.overlaps?.length ?? "?"} overlaps, ${report.insideSolids?.length ?? "?"} solid findings; ${report.gameHours ?? "?"} h`;
    case "shaders": return `${report.newKinds ? Object.keys(report.newKinds).length : "?"} new kinds, ${report.problems?.length ?? "?"} problems`;
    case "perfcheck": return report.rows?.map(r => `${r.place} ${r.liveMean}/${r.liveP95} ms`).join("; ") ?? "no rows";
    case "clocks": return `${report.running ?? "?"}/${report.total ?? "?"} running`;
    case "interiors": return `${report.openings ?? "?"} openings, ${report.blocked ?? "?"} blocked, ${report.empty ?? "?"} empty; ${report.registeredRooms ?? "?"} live rooms registered`;
    case "pixelcheck": return `${report.comparisons?.length ?? "?"} comparisons, ${report.differentPixels ?? "?"} changed pixels; positive control ${report.controlPixels ?? "?"}`;
    case "windows": return `${report.pictures?.length ?? "?"} close pictures through windows`;
    case "peopletest": return `${report.whereCheck?.same ?? "?"}/${report.whereCheck?.answers ?? "?"} whereabouts; ${report.places?.map(r => `${r.place}: ${r.peopleAndAnimalsCostMs} ms, ${r.allPeopleBytesPerFrame?.mean ?? "?"} B/frame`).join("; ")}`;
  }
}
const table = [];
try {
  if (!args.includes("--no-build")) {
    if (await run("dotnet", ["build", path.join(root, "godot")], 120000)) throw new Error("dotnet build failed");
    if (await run(godot, ["--headless", "--audio-driver", "Dummy", "--path", path.join(root, "godot"), "--import"], 120000, path.join(out, "import.log"))) throw new Error("Godot import failed");
  }
  for (const name of selected) {
    console.log(`Running ${name} (one Godot window, timeout ${timeout / 1000} s)`);
    const dir = path.join(out, name); mkdirSync(dir, { recursive: true });
    const scratch = mkdtempSync(path.join(out, "test-town-"));
    // These fixtures require their own database beside their report. Never reuse an existing database.
    const fixtureDatabase = ["placestest", "ridetest", "playtest", "deedstest"].includes(name);
    const database = path.join(fixtureDatabase ? dir : scratch, "test.sqlite");
    let ownsDatabase = false;
    let server;
    let serverText = "";
    try {
      if (existsSync(database)) throw new Error("test database already exists: " + database);
      ownsDatabase = true;
      const ownPort = await nextPort();
      const config = path.join(scratch, "walk.json");
      writeFileSync(config, JSON.stringify({ version: 1, mode: "walk", typedLines: "same", callsPerDay: 120, default: { provider: "recommended" }, kinds: {}, connections: { anthropic_api: {}, openai_compat: { baseUrl: "https://api.openai.com/v1" }, ollama: { baseUrl: "http://127.0.0.1:11434" } } }));
      server = spawn(process.execPath, ["src/index.ts"], { cwd: path.join(root, "server"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SCHELDEMIST_DATA: scratch, SCHELDEMIST_TOWN_SEED: String(seed), SCHELDEMIST_DB: database, SCHELDEMIST_AI_CONFIG: config, SCHELDEMIST_PORT: String(ownPort), SCHELDEMIST_CLIENT_PORT: String(ownPort), SCHELDEMIST_MAP_PORT: "0" } });
      children.add(server);
      server.stdout.on("data", b => { serverText += b; }); server.stderr.on("data", b => { serverText += b; });
      server.on("error", e => { serverText += e.message; });
      const url = `http://127.0.0.1:${ownPort}`;
      let ready = false;
      const until = Date.now() + 90000;
      while (Date.now() < until && server.exitCode === null) {
        if (serverText.includes(`[server] ${url}`)) try { if ((await fetch(url + "/api/state", { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { }
        await pause(250);
      }
      if (!ready) throw new Error("fresh test server did not start");
      if (serverText.includes("AI settings file not valid")) throw new Error("server rejected the no-AI test settings");
      const ai = await (await fetch(url + "/api/ai/config", { signal: AbortSignal.timeout(5000) })).json();
      if (ai.mode !== "walk") throw new Error("test server is not in no-AI walk-around mode");
      serverText += "\n[checks] verified no-AI walk-around mode\n";
      // Never accept an old report if this run fails before writing one.
      rmSync(path.join(dir, name + ".json"), { force: true });
      if (name === "peopletest" && await run(process.execPath, [path.join(root, "tools/godot/wherecheck.mjs"), "--server", url, "--out", path.join(dir, "where_expected.json")], 120000, path.join(dir, "reference.log"))) throw new Error("whereabouts reference failed");
      const code = await run(godot, ["--audio-driver", "Dummy", "--path", path.join(root, "godot"), "--", "--town", town, "--models", models, "--server", url, "--port", String(ownPort), "--db", database, "--no-ai", "--dev", "--hour", "13", "--weather", "clear", "--no-mainmenu", "--prefs", path.join(scratch, "prefs.json"), `--${name}`, dir, ...extraArgs], timeout, path.join(dir, "run.log"), { SCHELDEMIST_USER_DATA: path.join(scratch, "user"), SCHELDEMIST_MAP_PORT: "0" });
      const report = JSON.parse(readFileSync(path.join(dir, name + ".json"), "utf8"));
      table.push({ check: name, result: code === 0 && (name === "soundtest" ? report.problems?.length === 0 : report.ok === true) ? "PASS" : "FAIL", finds: numbers(name, report), report: path.join(dir, name + ".json") });
    } catch (e) { table.push({ check: name, result: "ERROR", finds: e.message }); }
    finally {
      await stop(server); children.delete(server);
      writeFileSync(path.join(dir, "server.log"), serverText);
      // Only the exact temporary directory created by this run, inside its output folder.
      if (path.dirname(scratch) !== out || !path.basename(scratch).startsWith("test-town-")) throw new Error("unsafe scratch path");
      // Windows can hold SQLite handles briefly after taskkill returns. Retry before recording a cleanup error.
      try {
        for (let attempt = 0; ; attempt++) {
          try {
            if (fixtureDatabase && ownsDatabase) for (const suffix of ["", "-wal", "-shm", "-journal"])
              rmSync(database + suffix, { force: true });
            rmSync(scratch, { recursive: true, force: true }); break;
          }
          catch (e) { if (attempt === 19 || !["EPERM", "EBUSY", "ENOTEMPTY"].includes(e.code)) throw e; await pause(500); }
        }
      }
      catch (e) { table.push({ check: name + " cleanup", result: "ERROR", finds: e.message }); }
    }
    console.log(`${table.at(-1).check}: ${table.at(-1).result} — ${table.at(-1).finds}`);
  }
} finally { await cleanup(); }
console.table(table.map(({ check, result, finds }) => ({ check, result, finds })));
writeFileSync(path.join(out, "summary.json"), JSON.stringify({ at: new Date().toISOString(), town, seed, rows: table, ok: table.every(r => r.result === "PASS") }, null, 2));
process.exitCode = table.length === selected.length && table.every(r => r.result === "PASS") ? 0 : 1;
