// The speed check (docs/rendering.md "Frame time", docs/testing.md): a test stack of its own, the game in headless
// Chrome on the real graphics card, the same places every time, and a budget. A batch that makes a place slower
// than the budget fails here before it goes live.
//
//   node tools/perfcheck.mjs                        start a stack (perf, 8946/5346), measure, stop it
//   node tools/perfcheck.mjs --vite 5341 --keep     measure a stack that already runs (5341), leave it running
//   options: --budget 20 (ms, the mean of real frames while walking, per place), --places "grote markt,cathedral"
//            --chrome <path to chrome.exe>
//
// Per place: 90 whole frames standing and 90 turning (every part and the draw, the GPU finished after each), then
// 6 s of real frames walking. The numbers go to the console and to data/perf/<time>.json (for comparing later).
// Exit code 1 when a place is over the budget. Numbers depend on the machine and on what else runs on it.

import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const has = (k) => args.includes(`--${k}`);
const BUDGET = Number(opt("budget", 20));
const PLACES = String(opt("places", "grote markt,cathedral,handschoenmarkt,vismarkt,rijnkaai")).split(",");
const OWN = !opt("vite", null);
const VITE = Number(opt("vite", 5346));
const SERVER = 8946;
// A collaborative browser can collect the identical frameProf samples without launching another browser.
// node tools/perfcheck.mjs --report data/perf/preview.json --budget 16.7
if (opt("report", null)) {
  const report = JSON.parse(readFileSync(path.resolve(root, opt("report", "")), "utf8"));
  if (!Array.isArray(report.rows) || !report.rows.length) throw new Error("performance report has no rows");
  for (const row of report.rows) {
    if (typeof row.place !== "string" || !Number.isFinite(row.liveMean) || row.liveMean <= 0 || !Number.isFinite(row.turnMean)) throw new Error("invalid performance row");
    console.log(`${row.place}: walking ${row.liveMean} ms, turning ${row.turnMean} ms — ${row.liveMean <= BUDGET ? "ok" : `OVER ${BUDGET} ms`}`);
  }
  process.exit(report.rows.some(row => row.liveMean > BUDGET) ? 1 : 0);
}
const CHROME =
  opt("chrome", null) ??
  process.env.CHROME ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found: pass --chrome <path>");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stack = (cmd) => execFileSync(process.execPath, [path.join(root, "tools/teststack.mjs"), cmd, "perf", "--server", String(SERVER), "--vite", String(VITE)], { stdio: "inherit", timeout: 180_000 });

// ---- a Chrome of its own, driven over its debug port
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `scheldemist-perf-${PORT}`);
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
  chrome = spawn(CHROME, ["--headless=new", "--enable-gpu", "--ignore-gpu-blocklist", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1600,900", "--mute-audio", "--enable-precise-memory-info", "about:blank"], { stdio: "ignore" });
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

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
let code = 0;
// (issue #21: only the stack this run started is stopped at the end; a busy port is another session's stack)
let started = false;
try {
  if (OWN) {
    stack("start");
    started = true;
  }
  await openGame();
  const gpu = await ev(`(() => { const g = document.createElement("canvas").getContext("webgl2"); const e = g.getExtension("WEBGL_debug_renderer_info"); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : "?" })()`);
  log("graphics:", gpu);
  await ev(`(__scheldemist.free(true), 1)`);
  await ev(`__scheldemist.t.light(13, "clear").then(() => 1)`);
  // the first minute after the start is busier (the town's ways come in): wait it out
  await ev(`new Promise((r) => __scheldemist.real.setTimeout(r, 20000))`, 60_000);
  const rows = [];
  for (const place of PLACES) {
    await ev(`Promise.resolve(__scheldemist.t.go(${JSON.stringify(place)})).then(() => 1)`);
    await ev(`__scheldemist.frameProf({ n: 30 }).then(() => 1)`);
    const still = await ev(`__scheldemist.frameProf({ n: 90, top: 80 })`);
    const turn = await ev(`__scheldemist.frameProf({ n: 90, top: 80, turn: 2 })`);
    await ev(`(__scheldemist.key("KeyW", true), 1)`);
    const live = await ev(`__scheldemist.frameProf({ live: 6, top: 10 })`, 60_000);
    await ev(`(__scheldemist.key("KeyW", false), 1)`);
    const part = (r, n) => r.parts.find((p) => p.part === n)?.mean ?? 0;
    const row = {
      place,
      liveMean: live.frame.mean,
      liveP95: live.frame.p95,
      fps: Math.round(1000 / live.frame.mean),
      over33: live.over33,
      stillMean: still.frame.mean,
      turnMean: turn.frame.mean,
      turnP95: turn.frame.p95,
      render: +part(turn, "render").toFixed(2),
      mirrors: +part(turn, "render.mirrors").toFixed(2),
      view: +part(turn, "render.rooms").toFixed(2),
      cull: +part(turn, "render.cull").toFixed(2),
      calls: Math.round(part(turn, "render.rooms calls") + part(turn, "render.mirrors calls")),
      top: turn.parts.filter((p) => !/calls|ktris|^render/.test(p.part)).slice(0, 4).map((p) => `${p.part} ${p.mean.toFixed(2)}`),
      ok: live.frame.mean <= BUDGET,
    };
    rows.push(row);
    log(
      `${place.padEnd(16)} walking ${String(row.liveMean).padStart(5)} ms (${String(row.fps).padStart(3)} fps, p95 ${row.liveP95}, ${row.over33} over 33 ms) | still ${row.stillMean} turning ${row.turnMean} (p95 ${row.turnP95}) | draw ${row.render} (mirrors ${row.mirrors}, view ${row.view}, cull ${row.cull}, ${row.calls} calls) ${row.ok ? "ok" : `OVER ${BUDGET} ms`}`,
    );
  }
  const bad = rows.filter((r) => !r.ok);
  const mean = rows.reduce((s, r) => s + r.liveMean, 0) / rows.length;
  log(`mean walking ${mean.toFixed(1)} ms (${Math.round(1000 / mean)} fps); budget ${BUDGET} ms a place: ${bad.length ? `OVER at ${bad.map((r) => r.place).join(", ")}` : "all within"}`);
  mkdirSync(path.join(root, "data/perf"), { recursive: true });
  const file = path.join(root, "data/perf", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), gpu, budget: BUDGET, rows }, null, 2));
  log("saved", path.relative(root, file));
  if (bad.length) code = 1;
} catch (e) {
  console.error(e);
  code = 2;
} finally {
  try {
    if (ws) await ev(`__scheldemist.t.done()`, 10_000).catch(() => {});
  } catch {
    /* closing anyway */
  }
  chrome?.kill();
  await sleep(800);
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {
    /* Chrome still letting go: left in the temp folder */
  }
  if (OWN && started && !has("keep")) {
    try {
      stack("stop");
    } catch {
      /* already down */
    }
  }
  process.exit(code);
}
