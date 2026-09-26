#!/usr/bin/env node
// Run a command while holding a named machine-wide lock (2026-09-26: several helpers share one working tree; two
// Blender builds of city.glb at once, or two walk-map writes, would spoil each other's files).
//
//   node tools/withLock.mjs <name> [--wait 3600] -- <command> [args...]
//
// Names in use: city-glb (build_city.py and anything that writes client/public/models/city.glb), walk-map
// (plan.py --ground, walk_only.py, anything that writes walk.png or shared/city.json), codex (tools/codexImage.mjs
// takes it itself). A lock older than 90 minutes is taken as dead. Exits with the command's own code.

import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const sep = argv.indexOf("--");
if (sep < 1 || sep === argv.length - 1) {
  console.error("usage: node tools/withLock.mjs <name> [--wait s] -- <command> [args...]");
  process.exit(2);
}
const name = argv[0].replace(/[^a-z0-9-]/gi, "");
const wi = argv.indexOf("--wait");
const waitS = wi > 0 && wi < sep ? Number(argv[wi + 1]) : 3600;
const cmd = argv.slice(sep + 1);
const LOCK = join(tmpdir(), `scheldemist-${name}.lock`);
const STALE_MS = 90 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const t0 = Date.now();
for (;;) {
  try {
    mkdirSync(LOCK);
    writeFileSync(join(LOCK, "owner"), `${process.pid} ${new Date().toISOString()} ${cmd.join(" ").slice(0, 200)}`);
    break;
  } catch {
    try {
      if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
    } catch {
      continue;
    }
    if ((Date.now() - t0) / 1000 > waitS) {
      let who = "";
      try {
        who = readFileSync(join(LOCK, "owner"), "utf8");
      } catch {
        /* */
      }
      console.error(`waited ${waitS} s for the lock "${name}" (held by: ${who})`);
      process.exit(3);
    }
    await sleep(3000);
  }
}
const release = () => {
  try {
    if (readFileSync(join(LOCK, "owner"), "utf8").startsWith(`${process.pid} `)) rmSync(LOCK, { recursive: true, force: true });
  } catch {
    /* gone */
  }
};
// one command line with each argument quoted where needed (a Windows shell finds .cmd shims, but joins arguments
// as they are)
const q = (a) => (/[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
const child = spawn(cmd.map(q).join(" "), { stdio: "inherit", shell: true });
child.on("close", (code) => {
  release();
  process.exit(code ?? 1);
});
process.on("SIGINT", () => {
  child.kill();
  release();
  process.exit(130);
});
