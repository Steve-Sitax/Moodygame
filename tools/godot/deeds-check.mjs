// Bounded real-window player check; owns only this worktree's output and child processes.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (key, fallback) => { const i = args.indexOf(`--${key}`); return i < 0 ? fallback : args[i + 1]; };
const dir = path.resolve(root, "godot/baked", opt("out", "deeds-proof"));
if (!dir.startsWith(path.join(root, "godot/baked") + path.sep)) throw new Error("output must stay inside this worktree's baked folder");
const port = Number(opt("port", "8980"));
if (!Number.isInteger(port) || port < 8980 || port > 8983) throw new Error("port must be 8980..8983 (map uses the next port)");
const engine = opt("godot", "C:/Users/steve/AppData/Local/Microsoft/WinGet/Packages/GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe");
const town = opt("town", "D:/Code/MoodyGame-godot/godot/baked/next/town.glb");
const models = opt("models", "D:/Code/MoodyGame-godot/godot/baked/models");
const mode = opt("mode", "deedstest");
if (!["deedstest", "perfcheck", "talktest"].includes(mode)) throw new Error("mode must be deedstest, perfcheck or talktest");
const lock = "D:/Code/MoodyGame-godot/godot/baked/PERF-LOCK";
mkdirSync(dir, { recursive: true });
async function waitLock() {
  while (existsSync(lock)) { console.log("PERF-LOCK held; checking again in 60 seconds"); await new Promise(resolve => setTimeout(resolve, 60000)); }
}
async function run(argv, timeout, log) {
  await waitLock();
  const child = spawn(engine, argv, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, SCHELDEMIST_USER_DATA: path.join(dir, "user"), SCHELDEMIST_TOWN_SEED: "1873", SCHELDEMIST_MAP_PORT: String(port + 1) } });
  let text = "", timedOut = false;
  child.stdout.on("data", b => { text += b; }); child.stderr.on("data", b => { text += b; });
  const stop = () => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const kill = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    kill.on("close", resolve); kill.on("error", resolve);
  });
  const timer = setTimeout(() => { timedOut = true; void stop(); }, timeout);
  try {
    const code = await new Promise((resolve, reject) => { child.on("error", reject); child.on("close", resolve); });
    writeFileSync(path.join(dir, log), text);
    const lines = text.split(/\r?\n/).filter(l => /deedstest:|ERROR|Exception|warning/i.test(l));
    console.log(lines.slice(0, 90).join("\n"));
    if (lines.length > 90) console.log(`... ${lines.length - 90} further diagnostic lines in ${path.join(dir, log)}`);
    if (timedOut) throw new Error("Godot run timed out");
    if (code) throw new Error(`Godot exited ${code}`);
  } finally { clearTimeout(timer); await stop(); }
}
try {
  if (!args.includes("--no-import")) await run(["--headless", "--path", "godot", "--import"], 180000, "import.log");
  await run(["--path", "godot", "--log-file", path.join(dir, "engine.log"), "--", "--town", town, "--models", models, "--no-ai", "--port", String(port), "--db", path.join(dir, "test.sqlite"), "--prefs", path.join(dir, "settings.json"), "--dev", "--hour", "13.75", "--weather", "clear", ...(args.includes("--baseline") ? ["--no-pressworld"] : []), "--" + mode, dir, ...(args.includes("--only") ? ["--deedstest-only", opt("only", "hands")] : [])], 240000, "run.log");
} finally {
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(path.join(dir, "test.sqlite" + suffix), { force: true });
}
