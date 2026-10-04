// Godot milestone checks. Fresh test towns only, one visible window at a time, bounded child processes.
// node tools/godot/checks.mjs --town D:/Code/MoodyGame-godot/godot/baked/town.glb --models D:/Code/MoodyGame-godot/godot/baked/models
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error(`--${name} needs a value`); return args[i + 1]; };
const all = ["devtest", "paths", "stuck", "shaders", "perfcheck", "clocks", "interiors"];
const selected = opt("only", all.join(",")).split(",");
if (selected.some(name => !all.includes(name))) throw new Error("--only: " + all.join(","));
const town = path.resolve(opt("town", "godot/baked/town.glb"));
const models = path.resolve(opt("models", path.join(path.dirname(town), "models")));
const out = path.resolve(opt("out", "godot/baked/checks"));
const godot = opt("godot", process.env.SCHELDEMIST_GODOT ?? path.join(process.env.LOCALAPPDATA ?? "", "Microsoft/WinGet/Packages/GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe"));
const timeout = Number(opt("timeout", "240")) * 1000;
const seed = Number(opt("seed", "1873"));
if (!Number.isInteger(seed) || seed <= 0 || seed > 2147483647) throw new Error("--seed must be 1..2147483647");
let port = Number(opt("port", "8980"));
if (!Number.isInteger(port) || port < 8900 || port > 64000) throw new Error("--port must be 8900..64000");
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) throw new Error("--timeout must be 1..600 seconds");
for (const file of [town, path.join(models, "people.glb"), path.join(root, "server/node_modules"), godot]) if (!existsSync(file)) throw new Error("missing " + file);
mkdirSync(out, { recursive: true });
const children = new Set();
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") await new Promise(resolve => {
    const kill = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    kill.on("close", resolve); kill.on("error", resolve);
  });
  else child.kill("SIGKILL");
}
async function cleanup() { await Promise.all([...children].map(stop)); }
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, async () => { await cleanup(); process.exit(130); });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function run(exe, argv, limit, logFile) {
  const child = spawn(exe, argv, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
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
  for (; port < 64000; port += 2) if (await free(port) && await free(port + 1)) { const result = port; port += 2; return result; }
  throw new Error("no free check port");
}
function numbers(name, report) {
  switch (name) {
    case "devtest": return `${report.steps?.filter(s => s.ok).length ?? 0}/${report.steps?.length ?? 0} steps`;
    case "paths": return `${report.unreachable?.length ?? "?"} unreachable / ${report.checkedCount ?? "?"} targets`;
    case "stuck": return `${report.stuck?.length ?? "?"} stuck, ${report.overlaps?.length ?? "?"} overlaps, ${report.insideSolids?.length ?? "?"} solid findings; ${report.gameHours ?? "?"} h`;
    case "shaders": return `${report.newKinds ? Object.keys(report.newKinds).length : "?"} new kinds, ${report.problems?.length ?? "?"} problems`;
    case "perfcheck": return report.rows?.map(r => `${r.place} ${r.liveMean}/${r.liveP95} ms`).join("; ") ?? "no rows";
    case "clocks": return `${report.running ?? "?"}/${report.total ?? "?"} running`;
    case "interiors": return `${report.openings ?? "?"} openings, ${report.blocked ?? "?"} blocked, ${report.empty ?? "?"} empty; ${report.registeredRooms ?? "?"} live rooms registered`;
  }
}
const table = [];
try {
  if (!args.includes("--no-build")) {
    if (await run("dotnet", ["build", path.join(root, "godot")], 120000)) throw new Error("dotnet build failed");
    if (await run(godot, ["--headless", "--path", path.join(root, "godot"), "--import"], 120000, path.join(out, "import.log"))) throw new Error("Godot import failed");
  }
  for (const name of selected) {
    console.log(`Running ${name} (one Godot window, timeout ${timeout / 1000} s)`);
    const dir = path.join(out, name); mkdirSync(dir, { recursive: true });
    const scratch = mkdtempSync(path.join(out, "test-town-"));
    let server;
    let serverText = "";
    try {
      const ownPort = await nextPort();
      const config = path.join(scratch, "walk.json");
      writeFileSync(config, JSON.stringify({ version: 1, mode: "walk", typedLines: "same", callsPerDay: 120, default: { provider: "recommended" }, kinds: {}, connections: {} }));
      server = spawn(process.execPath, ["src/index.ts"], { cwd: path.join(root, "server"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SCHELDEMIST_TOWN_SEED: String(seed), SCHELDEMIST_DB: path.join(scratch, "test.sqlite"), SCHELDEMIST_AI_CONFIG: config, SCHELDEMIST_PORT: String(ownPort), SCHELDEMIST_CLIENT_PORT: String(ownPort), SCHELDEMIST_MAP_PORT: "0" } });
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
      // Never accept an old report if this run fails before writing one.
      rmSync(path.join(dir, name + ".json"), { force: true });
      const code = await run(godot, ["--path", path.join(root, "godot"), "--", "--town", town, "--models", models, "--server", url, "--no-ai", "--hour", "13", "--weather", "clear", "--no-mainmenu", "--prefs", path.join(scratch, "prefs.json"), `--${name}`, dir], timeout, path.join(dir, "run.log"));
      const report = JSON.parse(readFileSync(path.join(dir, name + ".json"), "utf8"));
      table.push({ check: name, result: code === 0 && report.ok === true ? "PASS" : "FAIL", finds: numbers(name, report), report: path.join(dir, name + ".json") });
    } catch (e) { table.push({ check: name, result: "ERROR", finds: e.message }); }
    finally {
      await stop(server); children.delete(server);
      writeFileSync(path.join(dir, "server.log"), serverText);
      // Only the exact temporary directory created by this run, inside its output folder.
      if (path.dirname(scratch) !== out || !path.basename(scratch).startsWith("test-town-")) throw new Error("unsafe scratch path");
      rmSync(scratch, { recursive: true, force: true });
    }
    console.log(`${table.at(-1).check}: ${table.at(-1).result} — ${table.at(-1).finds}`);
  }
} finally { await cleanup(); }
console.table(table.map(({ check, result, finds }) => ({ check, result, finds })));
writeFileSync(path.join(out, "summary.json"), JSON.stringify({ at: new Date().toISOString(), town, seed, rows: table, ok: table.every(r => r.result === "PASS") }, null, 2));
process.exitCode = table.length === selected.length && table.every(r => r.result === "PASS") ? 0 : 1;
