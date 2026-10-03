// The Godot port's first proof (docs/godot-port.md): the town as the running game builds it, written out as one
// glb, so Godot can draw the very same scene and its frame time can be set against the browser's.
//
//   node tools/godot/export-scene.mjs --root D:/Code/MoodyGame --out godot/spike/town
//
// --root: a checkout with its packages installed (the test stack and vite run from there). It starts a test stack of
// its own (godot, 8947/5347), opens the game in headless Chrome (the recipe of tools/perfcheck.mjs), goes to each
// place, measures it there (frameProf, the browser's numbers for the comparison), then exports the scene with
// three's GLTFExporter. Written: <out>.glb, <out>.json (the copies of every InstancedMesh, the places' cameras, the
// fog, the lights, the browser's frame times). The stack is stopped and its save deleted at the end.

import { spawn, execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : d;
};
const root = path.resolve(opt("root", here));
const out = path.resolve(here, opt("out", "godot/spike/town"));
const PLACES = String(opt("places", "vismarkt,grote markt,cathedral,handschoenmarkt,rijnkaai")).split(",");
const VITE = 5347;
const SERVER = 8947;
const RECV = 5399;
const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].find((p) => existsSync(p));
if (!CHROME) throw new Error("no Chrome found");
mkdirSync(path.dirname(out), { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * three writes an InstancedMesh as EXT_mesh_gpu_instancing, which Godot 4.7 does not read. The copies are in the
 * json already: take the extension out of the glb's nodes and lists (the binary part stays as it is).
 */
function stripInstancing(file) {
  const glb = readFileSync(file);
  const n = glb.readUInt32LE(12);
  const j = JSON.parse(glb.subarray(20, 20 + n).toString("utf8"));
  for (const node of j.nodes ?? []) {
    if (!node.extensions?.EXT_mesh_gpu_instancing) continue;
    delete node.extensions.EXT_mesh_gpu_instancing;
    if (!Object.keys(node.extensions).length) delete node.extensions;
  }
  for (const k of ["extensionsUsed", "extensionsRequired"]) {
    if (!j[k]) continue;
    j[k] = j[k].filter((e) => e !== "EXT_mesh_gpu_instancing");
    if (!j[k].length) delete j[k];
  }
  let text = Buffer.from(JSON.stringify(j), "utf8");
  if (text.length % 4) text = Buffer.concat([text, Buffer.alloc(4 - (text.length % 4), 0x20)]);
  const rest = glb.subarray(20 + n);
  const head = Buffer.alloc(20);
  glb.copy(head, 0, 0, 12);
  head.writeUInt32LE(20 + text.length + rest.length, 8);
  head.writeUInt32LE(text.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  writeFileSync(file, Buffer.concat([head, text, rest]));
}
if (args.includes("--strip-only")) {
  stripInstancing(`${out}.glb`);
  process.exit(0);
}
const stack = (cmd) => execFileSync(process.execPath, [path.join(root, "tools/teststack.mjs"), cmd, "godot", "--server", String(SERVER), "--vite", String(VITE)], { stdio: "inherit", timeout: 180_000 });

// ---- the receiver: the page posts the glb here
let received = 0;
const recv = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  if (req.method !== "POST") return res.end();
  const f = createWriteStream(`${out}.glb`);
  req.on("data", (c) => (received += c.length));
  req.pipe(f);
  f.on("finish", () => res.end("ok"));
});
recv.listen(RECV, "127.0.0.1");

// ---- a Chrome of its own, driven over its debug port (tools/perfcheck.mjs)
const PORT = 9400 + Math.floor(Math.random() * 400);
const profile = path.join(os.tmpdir(), `scheldemist-godot-${PORT}`);
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

// ---- in the page: the scene's facts, then the export (started, not awaited: it is polled)
const FACTS = `(() => {
  const s = __scheldemist, scene = s.world.scene, cam = s.player.camera;
  const lights = [];
  scene.traverse((o) => { if (o.isLight) lights.push({ type: o.type, color: o.color.getHex(), intensity: o.intensity, pos: o.getWorldPosition(o.position.clone()).toArray(), visible: o.visible }); });
  const f = scene.fog;
  return { fog: f ? { color: f.color.getHex(), near: f.near, far: f.far, density: f.density } : null,
    background: scene.background && scene.background.isColor ? scene.background.getHex() : null,
    lights: lights.filter((l) => l.intensity > 0).slice(0, 400), camera: { fov: cam.fov, near: cam.near, far: cam.far } };
})()`;
const CAMERA = `(() => { const c = __scheldemist.player.camera; c.updateMatrixWorld(true); return { pos: c.getWorldPosition(c.position.clone()).toArray(), quat: c.getWorldQuaternion(c.quaternion.clone()).toArray() }; })()`;
const EXPORT = `(() => {
  window.__exp = { state: "running", note: "" };
  (async () => {
    const { GLTFExporter } = await import("/node_modules/three/examples/jsm/exporters/GLTFExporter.js");
    const scene = __scheldemist.world.scene;
    scene.updateMatrixWorld(true);
    // every InstancedMesh: one mesh in the glb, its copies in the json (Godot makes a MultiMesh of them)
    const inst = {};
    let n = 0, meshes = 0, skinned = 0;
    scene.traverse((o) => {
      if (o.isMesh) meshes++;
      if (o.isSkinnedMesh) skinned++;
      if (o.isInstancedMesh) {
        o.name = "INST" + n++ + "_" + (o.name || "x").replace(/[^a-zA-Z0-9]/g, "");
        inst[o.name] = { count: o.count, m: Array.from(o.instanceMatrix.array.subarray(0, o.count * 16), (v) => Math.round(v * 1e4) / 1e4) };
      }
    });
    window.__exp.inst = inst;
    window.__exp.counts = { meshes, skinned, instanced: n };
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: ${opt("all", null) ? "false" : "true"}, maxTextureSize: 1024 });
    window.__exp.note = "posting " + glb.byteLength;
    await fetch("http://127.0.0.1:${RECV}/", { method: "POST", body: new Blob([glb]) });
    window.__exp.bytes = glb.byteLength;
    window.__exp.state = "done";
  })().catch((e) => { window.__exp.state = "failed"; window.__exp.note = String(e && e.stack || e); });
  return 1;
})()`;

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
let code = 0;
let started = false;
try {
  stack("start");
  started = true;
  await openGame();
  await ev(`(__scheldemist.free(true), 1)`);
  await ev(`__scheldemist.t.light(13, "clear").then(() => 1)`);
  await ev(`new Promise((r) => __scheldemist.real.setTimeout(r, 20000))`, 60_000);
  const places = [];
  for (const place of PLACES) {
    await ev(`Promise.resolve(__scheldemist.t.go(${JSON.stringify(place)})).then(() => 1)`);
    await ev(`__scheldemist.frameProf({ n: 30 }).then(() => 1)`);
    const turn = await ev(`__scheldemist.frameProf({ n: 90, top: 80, turn: 2 })`);
    const cam = await ev(CAMERA);
    const part = (n) => turn.parts.find((p) => p.part === n)?.mean ?? 0;
    places.push({ place, ...cam, browser: { frameMean: turn.frame.mean, frameP95: turn.frame.p95, render: part("render"), mirrors: part("render.mirrors"), calls: part("render calls") } });
    log(place, "browser turning frame", turn.frame.mean, "ms, render", part("render"), "ms, calls", part("render calls"));
  }
  // the export, from the first place, everything the game would draw without the culler
  await ev(`Promise.resolve(__scheldemist.t.go(${JSON.stringify(PLACES[0])})).then(() => 1)`);
  const cull = await ev(`(() => { try { const c = __scheldemist.cull; if (!c) return "no culling switch"; c.enabled = false; return "culler off"; } catch (e) { return String(e); } })()`);
  log(cull);
  await ev(`__scheldemist.frameProf({ n: 6 }).then(() => 1)`);
  const facts = await ev(FACTS);
  await ev(EXPORT);
  let exp = null;
  for (let i = 0; i < 900; i++) {
    await sleep(2000);
    exp = await ev(`(() => { const e = window.__exp; return { state: e.state, note: e.note, counts: e.counts, bytes: e.bytes }; })()`, 600_000).catch(() => null);
    if (exp && exp.state !== "running") break;
    if (i % 15 === 14) log("exporting...", exp?.note ?? "(page busy)");
  }
  if (exp?.state !== "done") throw new Error(`export failed: ${exp?.note}`);
  const inst = await ev(`JSON.stringify(window.__exp.inst)`);
  writeFileSync(`${out}.json`, JSON.stringify({ made: new Date().toISOString(), places, facts, counts: exp.counts, instances: JSON.parse(inst) }));
  stripInstancing(`${out}.glb`);
  log("written", `${out}.glb`, (received / 1e6).toFixed(1), "MB", JSON.stringify(exp.counts));
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
  recv.close();
  if (started) stack("stop");
}
process.exit(code);
