#!/usr/bin/env node
// One Codex picture at a time, for every helper (2026-09-26: parallel Codex starts spoiled the login with
// "refresh token already used"). Takes a machine-wide lock (a folder, made atomically), runs Codex in the
// project's locked-down way (read-only sandbox, no user config, stdin closed), copies the picture it made to
// --out, and lets the lock go. Waits for the lock up to --wait seconds.
//
//   node tools/codexImage.mjs --out <file.png> --prompt "<what to draw>" [--example <picture>] [--model gpt-6-sol] [--wait 1800]
//
// Prints the saved path on success; exits 1 with the reason on failure. Never put names, paths or code in a prompt.

import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync, statSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const out = opt("out");
const prompt = opt("prompt");
const example = opt("example");
const model = opt("model", "gpt-6-sol");
const waitS = Number(opt("wait", "1800"));
if (!out || !prompt) {
  console.error("usage: node tools/codexImage.mjs --out <file.png> --prompt \"...\" [--example <picture>]");
  process.exit(1);
}

const LOCK = join(tmpdir(), "scheldemist-codex.lock");
// the npm shim on Windows (a shell started from Git Bash may not have npm's folder on its PATH)
const npmShim = process.env.APPDATA ? join(process.env.APPDATA, "npm", "codex.cmd") : "";
const CODEX = process.env.CODEX_BIN || (process.platform === "win32" && npmShim && existsSync(npmShim) ? npmShim : "codex");
const STALE_MS = 15 * 60 * 1000; // a lock older than this belongs to a run that died

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lock() {
  const t0 = Date.now();
  for (;;) {
    try {
      mkdirSync(LOCK);
      writeFileSync(join(LOCK, "owner"), `${process.pid} ${new Date().toISOString()}`);
      return;
    } catch {
      try {
        if (Date.now() - statSync(LOCK).mtimeMs > STALE_MS) {
          rmSync(LOCK, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if ((Date.now() - t0) / 1000 > waitS) throw new Error(`waited ${waitS} s for the Codex lock (${LOCK})`);
      await sleep(3000);
    }
  }
}

function unlock() {
  try {
    const owner = readFileSync(join(LOCK, "owner"), "utf8");
    if (owner.startsWith(`${process.pid} `)) rmSync(LOCK, { recursive: true, force: true });
  } catch {
    /* gone already */
  }
}

function runCodex() {
  const full = `Use your image generation tool to make one image. ${prompt} After making it, print the absolute file path of the saved image.`;
  // the prompt goes in on stdin ("-"), so no shell ever splits or reads it; stdin is closed right after it
  const q = (a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const cmd = ["exec", "-m", model, "-s", "read-only", "--ignore-user-config", "--skip-git-repo-check"];
  if (example) cmd.push("-i", example);
  cmd.push("-");
  return new Promise((resolve) => {
    const p = spawn([q(CODEX), ...cmd.map(q)].join(" "), { stdio: ["pipe", "pipe", "pipe"], shell: true });
    p.stdin.end(full);
    let text = "";
    p.stdout.on("data", (d) => (text += d));
    p.stderr.on("data", (d) => (text += d));
    const kill = setTimeout(() => p.kill(), 10 * 60 * 1000);
    p.on("close", (code) => {
      clearTimeout(kill);
      resolve({ code, text });
    });
  });
}

let code = 1;
try {
  await lock();
  const { text } = await runCodex();
  const paths = [...text.matchAll(/[A-Za-z]:[\\/][^\s"'`)]*?generated_images[\\/][^\s"'`)]+?\.png/g)].map((m) => m[0]);
  const made = paths.reverse().find((f) => existsSync(f));
  if (!made) {
    // never print the whole output: an auth error can carry a masked key
    const why = /401|unauthorized|incorrect api key/i.test(text) ? "Codex login failed (401)" : /refresh token/i.test(text) ? "Codex login: refresh token problem" : "no picture in Codex's answer";
    console.error(why);
    if (args.includes("--debug")) console.error(text.replace(/sk-[A-Za-z0-9_*.-]+/g, "sk-***").split(/\r?\n/).slice(-12).join("\n"));
  } else {
    mkdirSync(dirname(out), { recursive: true });
    copyFileSync(made, out);
    console.log(out);
    code = 0;
  }
} catch (e) {
  console.error(String(e instanceof Error ? e.message : e));
} finally {
  unlock();
}
process.exit(code);
