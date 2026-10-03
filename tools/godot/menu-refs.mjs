// The Godot port's menus (godot/src/Menu): a picture of every menu screen of the browser game, to lay beside the
// Godot one (the self-test `-- --menutest <dir>` takes those).
//
//   node tools/godot/menu-refs.mjs --out godot/baked/menu-ref [--ports 8953,5353]
//
// The recipe of tools/godot/export-scene.mjs: a test stack of its own (never 8787/5173), the game in headless
// Chrome over its debug port, 1600 x 900. The stack's server runs in walk-around mode (no model calls). The stack
// is stopped and its save deleted at the end. A checkout without a save gets one first (the server run once).

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = path.resolve(root, opt("out", "godot/baked/menu-ref"));
const [SERVER, VITE] = String(opt("ports", "8953,5353")).split(",").map(Number);
for (const p of [SERVER, VITE]) if ([8787, 5173, 8080, 8088, 8090].includes(p)) throw new Error(`port ${p} is not for tests`);
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found");
mkdirSync(out, { recursive: true });
const data = path.join(root, "data");
mkdirSync(data, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log("[menu-refs]", ...a);

// no model calls: the server's settings file says "walk around" (docs/ai-setup.md)
const aiCfg = path.join(data, "menuref.ai-config.json");
writeFileSync(aiCfg, JSON.stringify({ version: 1, mode: "walk", typedLines: "same", callsPerDay: 120, default: { provider: "recommended" }, kinds: {}, connections: { anthropic_api: {}, openai_compat: { baseUrl: "https://api.openai.com/v1" }, ollama: { baseUrl: "http://127.0.0.1:11434" } } }));
const env = { ...process.env, SCHELDEMIST_AI_CONFIG: aiCfg };
const NAME = `menuref${SERVER}`;
const stack = (cmd) => execFileSync(process.execPath, [path.join(root, "tools/teststack.mjs"), cmd, NAME, "--server", String(SERVER), "--vite", String(VITE)], { stdio: "inherit", timeout: 180_000, env });

async function up(url, secs) {
  for (let i = 0; i < secs * 2; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (r.status < 500) return true;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  return false;
}

/** A checkout that never ran: the server makes its save, then stops. */
async function firstSave() {
  if (existsSync(path.join(data, "game.sqlite"))) return;
  log("no save yet: the server runs once to make one");
  const s = spawn(process.execPath, ["src/index.ts"], { cwd: path.join(root, "server"), env: { ...env, SCHELDEMIST_PORT: String(SERVER), SCHELDEMIST_MAP_PORT: "0" }, stdio: "ignore", windowsHide: true });
  const ok = await up(`http://127.0.0.1:${SERVER}/api/jobs`, 60);
  s.kill();
  await sleep(1500);
  if (!ok) throw new Error("the server did not come up to make a save");
}

// ---- a Chrome of its own, driven over its debug port
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `scheldemist-menuref-${PORT}`);
let chrome = null;
let ws = null;
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
async function ev(expr, timeoutMs = 60_000) {
  const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), sleep(timeoutMs).then(() => null)]);
  if (!r) throw new Error(`timed out: ${expr.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
async function shot(name) {
  await sleep(500);
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(r.result.data, "base64"));
  log("picture", name);
}
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return "no " + ${JSON.stringify(sel)}; e.click(); return "ok"; })()`);
const closeSheets = () => ev(`document.querySelectorAll(".settings").forEach((p) => (p.style.display = "none"))`);

let code = 0;
let started = false;
try {
  await firstSave();
  stack("start");
  started = true;
  chrome = spawn(CHROME, ["--headless=new", "--enable-gpu", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1600,900", "--mute-audio", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 60 && !ws; i++) {
    try {
      const pg = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((p) => p.type === "page");
      if (pg) {
        ws = new WebSocket(pg.webSocketDebuggerUrl);
        await new Promise((r) => ws.addEventListener("open", r));
      }
    } catch {
      /* not up yet */
    }
    if (!ws) await sleep(300);
  }
  if (!ws) throw new Error("Chrome did not start");
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) {
      pending.get(d.id)(d);
      pending.delete(d.id);
    }
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${VITE}/` });

  // the loading screen: once its card names a step of the load
  for (let i = 0; i < 60; i++) {
    const step = await ev(`document.querySelector("#boot .step .what")?.textContent ?? ""`, 10_000).catch(() => "");
    if (/Loading|Building|Unpacking|Preparing/.test(step)) break;
    await sleep(500);
  }
  await sleep(2500);
  await shot("01-loading");
  for (let i = 0; i < 300; i++) {
    const ok = await ev(`!!(window.__scheldemist && __scheldemist.t) && !document.querySelector("#boot")`, 10_000).catch(() => false);
    if (ok === true) break;
    await sleep(1000);
  }
  await shot("02-title");

  for (const [n, tab] of [["03", "graphics"], ["04", "sound"], ["05", "controls"], ["06", "game"], ["07", "access"]]) {
    await click('.menu-item[data-go="settings"]');
    await click(`[data-tab="${tab}"]`);
    await sleep(tab === "game" ? 1200 : 200);
    await shot(`${n}-settings-${tab}`);
    await closeSheets();
  }
  for (const [n, go, wait] of [["08", "ai", 1500], ["09", "help", 200], ["10", "credits", 200], ["11", "new", 200]]) {
    await click(`.menu-item[data-go="${go}"]`);
    await sleep(wait);
    await shot(`${n}-${go}`);
    if (go !== "new") await closeSheets();
  }
  // the character maker, from "Start a new week" (Back leaves it: no new week is started)
  await click('[data-act="newgame"]');
  await sleep(3000);
  await ev(`import("/src/menu/character.ts").then((m) => m.devPreviewTurn(0.5))`).catch(() => {});
  await shot("12-character");
  await closeSheets();

  // into the game, a save, the pause card, the menu in play, the save and load lists
  await ev(`__scheldemist.free(true)`);
  await sleep(1500);
  await ev(`__scheldemist.t.light ? __scheldemist.t.light() : 0`).catch(() => {});
  log(await ev(`__scheldemist.t.save("slot1", "Menu test")`, 90_000));
  await ev(`__scheldemist.t.pause(true)`);
  await shot("13-paused");
  await ev(`__scheldemist.t.pause(false)`);
  await ev(`__scheldemist.free(false)`);
  await sleep(600);
  await shot("14-menu-in-game");
  await ev(`[...document.querySelectorAll(".save-row button")].find((b) => /Save/.test(b.textContent))?.click()`);
  await sleep(900);
  await shot("15-save");
  await closeSheets();
  await ev(`[...document.querySelectorAll(".save-row button")].find((b) => /Load/.test(b.textContent))?.click()`);
  await sleep(900);
  await shot("16-load");
  await closeSheets();
  await click('.menu-item[data-go="quit"]');
  await shot("17-quit");
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  try {
    ws?.close();
    chrome?.kill();
    await sleep(800);
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* a locked profile file: the temp folder is cleaned by the system */
  }
  if (started) stack("stop");
  rmSync(aiCfg, { force: true });
}
process.exit(code);
