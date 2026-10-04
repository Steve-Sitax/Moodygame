// The browser's pictures from chosen views, to set beside Godot's (src/Dev/Snap.cs takes the same views):
//
//   node tools/godot/look-refs.mjs --root <checkout> --out <dir> --views "name:x,y,z,yaw,pitch,hour,weather[,storm];..." [--ports 8917,5317]
//
// A view: the free camera at x, y, z, turned yaw and pitch (degrees; yaw 0 looks to -z, 180 to +z; pitch up), at the
// hour and the weather given (storm: the great storm held at that level, 0..1). Writes <dir>/<name>_ref.png. It
// starts a test stack of its own (tools/teststack.mjs, a copy of the save, deleted at the end) and headless Chrome;
// everything is stopped when it ends. Views with the same hour and weather share one wait for the light to settle.

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
// --root: a checkout with its packages installed and a save (the test stack and vite run from there)
const root = path.resolve(opt("root", here));
const out = path.resolve(opt("out", "godot/baked/look/ref"));
const VIEWS = String(opt("views", ""))
  .split(";")
  .filter(Boolean)
  .map((v) => {
    const c = v.indexOf(":");
    const [x, y, z, yaw, pitch, hour, weather, storm] = v.slice(c + 1).split(",");
    return { name: v.slice(0, c), x: +x, y: +y, z: +z, yaw: +yaw, pitch: +pitch, hour: hour === undefined || hour === "" ? 13 : +hour, weather: weather || "clear", storm: storm === undefined || storm === "" ? null : +storm };
  });
if (!VIEWS.length) throw new Error("--views name:x,y,z,yaw,pitch,hour,weather[,storm];...");
const [SERVER, VITE] = String(opt("ports", "8917,5317")).split(",").map(Number);
const SETTLE = Number(opt("settle", 30));
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found");
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stack = (cmd) => execFileSync(process.execPath, [path.join(root, "tools/teststack.mjs"), cmd, `look${SERVER}`, "--server", String(SERVER), "--vite", String(VITE)], { stdio: "inherit", timeout: 180_000 });
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `scheldemist-look-${PORT}`);
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
async function ev(expr, timeoutMs = 120_000) {
  const r = await Promise.race([send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }), sleep(timeoutMs).then(() => null)]);
  if (!r) throw new Error(`timed out: ${expr.slice(0, 80)}`);
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
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
  await send("Page.navigate", { url: `http://127.0.0.1:${VITE}/` });
  for (let i = 0; i < 240; i++) {
    const ok = await ev(`!!(window.__scheldemist && __scheldemist.frameProf) && !document.querySelector("#boot:not(.gone)")`, 10_000).catch(() => false);
    if (ok === true) return;
    await sleep(1000);
  }
  throw new Error("the game did not load");
}

const wait = (s) => ev(`new Promise((r) => __scheldemist.real.setTimeout(r, ${Math.round(s * 1000)}))`, s * 1000 + 30_000);
const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
let code = 0;
let started = false;
try {
  stack("start");
  started = true;
  await openGame();
  await ev(`(__scheldemist.free(true), 1)`);
  // (the browser's points are capped by the graphics card: the largest point and the picture's height they are drawn into)
  log("points:", await ev(`(() => { const c = document.createElement("canvas").getContext("webgl2"); const r = __scheldemist.world?.renderer ?? null; return JSON.stringify({ pointRange: c ? Array.from(c.getParameter(c.ALIASED_POINT_SIZE_RANGE)) : null, canvas: [document.querySelector("canvas")?.width, document.querySelector("canvas")?.height] }); })()`).catch((e) => String(e)));
  let light = "";
  for (const v of VIEWS) {
    const key = `${v.hour}|${v.weather}`;
    if (key !== light) {
      await ev(`__scheldemist.t.light(${v.hour}, ${JSON.stringify(v.weather)}).then(() => 1)`);
      light = key;
      await wait(SETTLE);
    }
    // the great storm held at a level (the look only: world/tempest.ts hold), or let go
    await ev(`Promise.resolve(__scheldemist.t.tempest({ hold: ${v.storm === null ? "null" : v.storm} })).then(() => 1)`).catch((e) => log("tempest:", String(e).slice(0, 120)));
    await ev(`(() => { const p = __scheldemist.player; p.fly = true; p.x = ${v.x}; p.z = ${v.z}; p.flyY = ${v.y}; p.yaw = ${(v.yaw * Math.PI) / 180}; p.pitch = ${(v.pitch * Math.PI) / 180}; return 1; })()`);
    await wait(v.storm ? 6 : 3);
    const png = await send("Page.captureScreenshot", { format: "png" });
    if (png.result?.data) writeFileSync(path.join(out, `${v.name}_ref.png`), Buffer.from(png.result.data, "base64"));
    // (the alive parts' counts, and the fog and the works' stacks, to set beside Godot's)
    const alive = await ev(`JSON.stringify({ ...(__scheldemist.alive ? __scheldemist.alive.info() : {}), fog: (() => { const f = __scheldemist.world?.scene?.fog; return f ? { near: f.near, far: f.far, color: f.color?.getHexString?.() } : null; })(), works: __scheldemist.world?.scene?.getObjectByName?.("works")?.userData?.info?.() ?? null })`).catch(() => "null");
    writeFileSync(path.join(out, `${v.name}_ref.json`), alive ?? "null");
    log(v.name, "->", path.join(out, `${v.name}_ref.png`));
  }
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
