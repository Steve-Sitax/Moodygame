// The browser's paper map as a picture, to set the Godot map beside it (godot/src/Game/TownMap.cs; the recipe of
// tools/godot/export-scene.mjs --ref-only).
//
//   node tools/godot/map-ref.mjs --out data/mapref --ports 8955,5355
//
// It starts a test stack of its own (a copy of this checkout's save), opens the game in headless Chrome at
// 1600 x 900, presses M, and saves: <out>/browser-map.png (the map as it opens), <out>/browser-map-hover.png (the
// mouse on the hiring board), <out>/browser-map-pumps.png (the pumps turned on in the key), and
// <out>/browser-map.json (where Jef stands and looks, what the map lists, the marks per kind). The Godot map's own
// test takes the place from there: `-- --maptest <dir> --mapat x,z,yawDeg`. The stack is stopped and its save
// deleted at the end. Never ports 8787 or 5173 (Steve's own game).

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = path.resolve(here, opt("out", "data/mapref"));
const [SERVER, VITE] = String(opt("ports", "8955,5355")).split(",").map(Number);
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stack = (cmd) => execFileSync(process.execPath, [path.join(here, "tools/teststack.mjs"), cmd, `mapref${SERVER}`, "--server", String(SERVER), "--vite", String(VITE)], { stdio: "inherit", timeout: 180_000 });

// ---- a Chrome of its own, driven over its debug port
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `scheldemist-mapref-${PORT}`);
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
  await sleep(700);
  const png = await send("Page.captureScreenshot", { format: "png" });
  if (!png.result?.data) throw new Error(`no picture: ${name}`);
  writeFileSync(path.join(out, name), Buffer.from(png.result.data, "base64"));
  console.log("written", path.join(out, name));
}

async function openGame() {
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
  // the window's inside at exactly 1600 x 900, as the Godot window
  await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${VITE}/` });
  for (let i = 0; i < 240; i++) {
    const ok = await ev(`!!(window.__scheldemist && __scheldemist.t) && !document.querySelector("#boot:not(.gone)")`, 10_000).catch(() => false);
    if (ok === true) return;
    await sleep(1000);
  }
  throw new Error("the game did not load");
}

const key = (code, k) => `window.dispatchEvent(new KeyboardEvent("keydown", { code: ${JSON.stringify(code)}, key: ${JSON.stringify(k)}, bubbles: true }))`;
// what the map holds (its private fields, read for the comparison only)
const MAP = `(() => {
  const s = __scheldemist, m = s.jobs.map, p = s.player;
  const r = m.cv.getBoundingClientRect();
  const per = {};
  for (const h of m.hits) { const c = h.m.icon || h.m.kind; per[c] = (per[c] || 0) + 1; }
  return { open: m.open, player: { x: p.x, z: p.z, yaw: p.yaw, yawDeg: p.yaw * 180 / Math.PI }, canvas: { left: r.left, top: r.top, w: m.cv.width, h: m.cv.height },
    info: m.info(), drawn: m.hits.length, perIcon: per, hits: m.hits.map((h) => ({ u: Math.round(h.u), v: Math.round(h.v), label: h.m.label, kind: h.m.kind, icon: h.m.icon || null })) };
})()`;

let code = 0;
let started = false;
try {
  stack("start");
  started = true;
  await openGame();
  await ev(`(__scheldemist.free(true), 1)`);
  await ev(`__scheldemist.t.light(13, "clear").then(() => 1)`);
  await ev(`new Promise((r) => __scheldemist.real.setTimeout(r, 8000))`, 30_000);
  await ev(key("KeyM", "m"));
  await sleep(1500);
  const state = await ev(MAP);
  if (!state.open) throw new Error("M did not open the browser's map");
  await shot("browser-map.png");
  // the mouse on the hiring board
  const board = state.hits.find((h) => h.label === "hiring board");
  if (board) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: state.canvas.left + board.u, y: state.canvas.top + board.v });
    await shot("browser-map-hover.png");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 4, y: 4 });
  }
  // the pumps on, in the key
  await ev(`(document.querySelector('.citymap-key button[data-cat="pump"]').click(), 1)`);
  await shot("browser-map-pumps.png");
  const pumps = await ev(MAP);
  await ev(`(document.querySelector('.citymap-key button[data-cat="pump"]').click(), 1)`);
  writeFileSync(path.join(out, "browser-map.json"), JSON.stringify({ made: new Date().toISOString(), ...state, drawnWithPumps: pumps.drawn }, null, 1));
  console.log(`Jef at ${state.player.x.toFixed(2)},${state.player.z.toFixed(2)} yaw ${state.player.yawDeg.toFixed(1)} deg; ${state.drawn} marks drawn`);
  console.log(`for the Godot test: --mapat ${state.player.x.toFixed(2)},${state.player.z.toFixed(2)},${state.player.yawDeg.toFixed(1)}`);
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
}
process.exit(code);
