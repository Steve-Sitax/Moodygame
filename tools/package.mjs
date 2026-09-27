// The player's download (docs/release.md): one folder per system with the built game, the server, its
// packages for this system and the Node that runs it, so a player needs to install nothing. The GitHub
// Action (.github/workflows/release.yml) runs this on Windows, macOS and Linux; it also works by hand.
//
//   node tools/package.mjs              build the game, then pack it for this system into release/
//   node tools/package.mjs --no-build   pack the last build (client/dist with its manifest)
// SCHELDEMIST_VERSION names the download (default: git describe).
//
// Left out on purpose: the Claude Agent SDK's own Claude Code copy (about 230 MB); the game uses the player's
// installed Claude Code instead (claudeExe in server/src/ai/claude.ts).

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const win = process.platform === "win32";
const run = (cmd, argv, cwd = root) => {
  // npm is a .cmd on Windows, which only runs through the shell; no path here has a space
  const sh = win && cmd.endsWith(".cmd");
  const r = sh ? spawnSync([cmd, ...argv].join(" "), { cwd, stdio: "inherit", shell: true }) : spawnSync(cmd, argv, { cwd, stdio: "inherit" });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(" ")} failed (${r.status})`);
};

const version =
  process.env.SCHELDEMIST_VERSION ||
  (() => {
    try {
      return execFileSync("git", ["describe", "--tags", "--always", "--dirty"], { cwd: root, encoding: "utf8" }).trim();
    } catch {
      return "dev";
    }
  })();
const os = { win32: "windows", darwin: "mac", linux: "linux" }[process.platform];
if (!os) throw new Error(`no download for ${process.platform}`);
const name = `Scheldemist-${version}-${os}-${process.arch}`;
const outRoot = path.join(root, "release");
const out = path.join(outRoot, name);

if (!args.includes("--no-build")) {
  run(win ? "npm.cmd" : "npm", ["--prefix", "client", "run", "build"]);
  run(process.execPath, [path.join("tools", "manifest.mjs")]);
}
const dist = path.join(root, "client", "dist");
if (!fs.existsSync(path.join(dist, "manifest.json"))) throw new Error("client/dist has no manifest.json: build first (drop --no-build)");

console.log(`[package] ${name}`);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to = from) => fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true });
copy("client/dist");
copy("shared");
copy("server/src");
copy("server/package.json");
copy("server/package-lock.json");
copy("LICENSE");
copy("README.md");
copy("assets/ATTRIBUTION.md", "ATTRIBUTION.md");
copy("tools/release/launch.mjs", "launch.mjs");

/** A text file with the line ends its system wants, mode 755 for scripts. */
const text = (from, to, crlf, exec = false) => {
  const s = fs.readFileSync(path.join(root, from), "utf8").replace(/\r\n/g, "\n");
  fs.writeFileSync(path.join(out, to), crlf ? s.replace(/\n/g, "\r\n") : s);
  if (exec) fs.chmodSync(path.join(out, to), 0o755);
};
text("tools/release/PLAY.txt", "PLAY.txt", win);
if (os === "windows") text("tools/release/start-windows.bat", "Start Scheldemist.bat", true);
if (os === "mac") text("tools/release/start-mac.command", "Start Scheldemist.command", false, true);
if (os === "linux") text("tools/release/start-linux.sh", "start-scheldemist.sh", false, true);

// the server's packages for this system (better-sqlite3 brings its prebuilt engine), without dev tools
run(win ? "npm.cmd" : "npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], path.join(out, "server"));
const ai = path.join(out, "server", "node_modules", "@anthropic-ai");
for (const d of fs.existsSync(ai) ? fs.readdirSync(ai) : []) {
  if (d.startsWith("claude-agent-sdk-")) fs.rmSync(path.join(ai, d), { recursive: true, force: true });
}

// the Node that runs this script runs the game
fs.mkdirSync(path.join(out, "runtime"));
const node = path.join(out, "runtime", win ? "node.exe" : "node");
fs.copyFileSync(process.execPath, node);
if (!win) fs.chmodSync(node, 0o755);
fs.writeFileSync(path.join(out, "runtime", "VERSION.txt"), `Node.js ${process.version} (https://nodejs.org, MIT licence)\n`);

// the archive
let archive;
if (os === "windows") {
  archive = `${out}.zip`;
  fs.rmSync(archive, { force: true });
  run(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), ["-a", "-c", "-f", archive, "-C", outRoot, name], outRoot);
} else if (os === "mac") {
  archive = `${out}.zip`;
  fs.rmSync(archive, { force: true });
  run("ditto", ["-c", "-k", "--keepParent", out, archive], outRoot);
} else {
  archive = `${out}.tar.gz`;
  fs.rmSync(archive, { force: true });
  run("tar", ["-czf", archive, "-C", outRoot, name], outRoot);
}
console.log(`[package] ${archive} (${(fs.statSync(archive).size / 1e6).toFixed(0)} MB)`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `archive=${archive}\n`);
