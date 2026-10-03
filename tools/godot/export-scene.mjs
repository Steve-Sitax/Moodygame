// The Godot port's first proof (docs/godot-port.md): the town as the running game builds it, written out as one
// glb, so Godot can draw the very same scene and its frame time can be set against the browser's.
//
//   node tools/godot/export-scene.mjs --root D:/Code/MoodyGame --out godot/spike/town
//
// --root: a checkout with its packages installed (the test stack and vite run from there). It starts a test stack of
// its own (godot, 8947/5347), opens the game in headless Chrome (the recipe of tools/perfcheck.mjs), goes to each
// place, measures it there (frameProf, the browser's numbers for the comparison), then exports the scene with
// three's GLTFExporter. Written: <out>.glb, <out>.json (the copies of every InstancedMesh, the places' cameras, the
// fog, the lights, the browser's frame times), <out>_tex/ (the pictures the psx options name, the dirt map, the sky
// map), <out>_lights.json (the lamps, the lit windows and their light on the street). The stack is stopped and its save deleted at the end.

import { spawn, execFileSync } from "node:child_process";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const out = path.resolve(here, opt("out", "godot/baked/town"));
const PLACES = String(opt("places", "vismarkt,grote markt,cathedral,handschoenmarkt,rijnkaai")).split(",");
// --hour 21 --weather rain: the clock and the weather of the pictures and the facts (the bake itself: 13, clear).
// With --ref-only nothing is exported: the browser's picture at each place (<out>_ref_<place>[_<hour>_<weather>].png),
// the light's numbers at that hour (<out>_ref[_<hour>_<weather>].json) and the shared pictures (<out>_tex/dirt.png).
const HOUR = Number(opt("hour", 13));
const WEATHER = String(opt("weather", "clear"));
const TAG = HOUR === 13 && WEATHER === "clear" ? "" : `_${HOUR}_${WEATHER}`;
const REF_ONLY = args.includes("--ref-only");
// (--ports 8947,5347,5399: the test stack's server and vite, and the receiver; another set lets two bakes run at once)
const [SERVER, VITE, RECV] = String(opt("ports", "8947,5347,5399")).split(",").map(Number);
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
const stack = (cmd) => execFileSync(process.execPath, [path.join(root, "tools/teststack.mjs"), cmd, `godot${SERVER}`, "--server", String(SERVER), "--vite", String(VITE)], { stdio: "inherit", timeout: 180_000 });

// ---- the receiver: the page posts the glb here
let received = 0;
const recv = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "*");
  if (req.method !== "POST") return res.end();
  // "/glb": the scene; "/tex/<uuid>": a texture the psx options name (height maps, stone ids, slabs)
  const tex = /^\/tex\/([a-zA-Z0-9_-]+)$/.exec(req.url ?? "");
  if (tex) mkdirSync(`${out}_tex`, { recursive: true });
  // "/walk": the walk dump (townspeople: godot/src/Town/WalkMap.cs)
  const f = createWriteStream(tex ? path.join(`${out}_tex`, `${tex[1]}.png`) : req.url === "/walk" ? `${out}_walk.bin` : `${out}.glb`);
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
  scene.traverse((o) => { if (o.isLight) lights.push({ type: o.type, color: o.color.getHex(), ground: o.groundColor ? o.groundColor.getHex() : null, name: o.name, intensity: o.intensity, distance: o.distance ?? null, decay: o.decay ?? null, pos: o.getWorldPosition(o.position.clone()).toArray(), visible: o.visible }); });
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
    const s = __scheldemist, scene = s.world.scene;
    scene.updateMatrixWorld(true);
    // The rooms (world/inworld.ts): in the browser each inside is a scene of its own, drawn over the street through
    // its openings. In Godot they stand in the same world, inside their shells: each room's scene goes into the export
    // as a group "ROOM_<id>", with what its scene had of its own in the extras (its lights, its air, its openings).
    const Object3D = Object.getPrototypeOf(scene.constructor);
    const rooms = (s.retro && s.retro.inWorld && s.retro.inWorld.all) || [];
    window.__roomLights = (root) => {
      const out = [];
      root.traverse((o) => { if (o.isLight) out.push({ type: o.type, color: o.color.getHex(), ground: o.groundColor ? o.groundColor.getHex() : null, intensity: o.intensity, distance: o.distance ?? null, decay: o.decay ?? null, pos: o.getWorldPosition(o.position.clone()).toArray().map((v) => Math.round(v * 1000) / 1000) }); });
      return out;
    };
    for (const r of rooms) {
      const g = new Object3D();
      g.name = "ROOM_" + r.id;
      const f = r.scene.fog;
      g.userData.room = {
        id: r.id, reach: r.reach, budgeted: !!r.budgeted,
        fog: f ? { color: f.color.getHex(), near: f.near, far: f.far } : null,
        lights: window.__roomLights(r.scene),
        openings: r.openings.map((o) => ({ kind: o.kind, label: o.label, open: !!o.open(), centre: o.centre.toArray(), out: o.out.toArray(), box: [...o.box.min.toArray(), ...o.box.max.toArray()] })),
      };
      r.scene.updateMatrixWorld(true);
      while (r.scene.children.length) g.add(r.scene.children[0]);
      scene.add(g);
    }
    scene.updateMatrixWorld(true);
    // every InstancedMesh: one mesh in the glb, its copies in the json (Godot makes a MultiMesh of them).
    // What three knows and glTF does not goes into userData (glTF extras): hidden nodes, the material's kind and
    // switches, the psx options (retro/psx.ts bake). The houses' atlas cell rides as the second uv.
    const inst = {};
    const mats = new Set();
    let n = 0, meshes = 0, skinned = 0;
    scene.traverse((o) => {
      if (!o.visible) o.userData.hidden = true;
      if (o.renderOrder) o.userData.ro = o.renderOrder;
      if (o.isMesh || o.isLine || o.isPoints) {
        if (o.isMesh) meshes++;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) mats.add(m);
        const g = o.geometry;
        if (g && g.attributes.cell && !g.attributes.uv1) g.setAttribute("uv1", g.attributes.cell);
      }
      if (o.isSkinnedMesh) skinned++;
      if (o.isInstancedMesh) {
        o.name = "INST" + n++ + "_" + (o.name || "x").replace(/[^a-zA-Z0-9]/g, "");
        inst[o.name] = { count: o.count, m: Array.from(o.instanceMatrix.array.subarray(0, o.count * 16), (v) => Math.round(v * 1e4) / 1e4) };
        if (o.instanceColor) inst[o.name].c = Array.from(o.instanceColor.array.subarray(0, o.count * 3), (v) => Math.round(v * 1e3) / 1e3);
      }
    });
    for (const m of mats)
      m.userData.three = {
        type: m.type, name: m.name || "", depthWrite: m.depthWrite, depthTest: m.depthTest, opacity: m.opacity, transparent: m.transparent,
        alphaTest: m.alphaTest, side: m.side, blending: m.blending, fog: m.fog !== false, vertexColors: !!m.vertexColors,
        offset: m.polygonOffset ? [m.polygonOffsetFactor, m.polygonOffsetUnits] : null, colorWrite: m.colorWrite !== false,
        emissive: m.emissive ? m.emissive.getHex() : 0, emissiveIntensity: m.emissiveIntensity ?? 0,
        specular: m.specular ? m.specular.getHex() : 0, shininess: m.shininess ?? 0, flat: !!m.flatShading,
      };
    window.__exp.inst = inst;
    window.__exp.counts = { meshes, skinned, instanced: n, materials: mats.size };
    // the textures the psx options name
    let k = 0;
    for (const [uuid, t] of s.psxBakeTextures) {
      const im = t.image;
      if (!im) continue;
      const w = im.width, h = im.height;
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const x = c.getContext("2d");
      if (im.data) {
        const d = new ImageData(w, h);
        const step = im.data.length / (w * h);
        for (let i = 0; i < w * h; i++) {
          const a = step === 1 ? [im.data[i], im.data[i], im.data[i], 255] : [im.data[i * step], im.data[i * step + 1], im.data[i * step + 2], step > 3 ? im.data[i * step + 3] : 255];
          d.data.set(a, i * 4);
        }
        x.putImageData(d, 0, 0);
      } else x.drawImage(im, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      await fetch("http://127.0.0.1:${RECV}/tex/" + uuid, { method: "POST", body: blob });
      window.__exp.note = "textures " + ++k;
    }
    window.__exp.counts.psxTextures = k;
    const glb = await new GLTFExporter().parseAsync(scene, { binary: true, onlyVisible: false, maxTextureSize: 2048 });
    window.__exp.note = "posting " + glb.byteLength;
    await fetch("http://127.0.0.1:${RECV}/glb", { method: "POST", body: new Blob([glb]) });
    window.__exp.bytes = glb.byteLength;
    window.__exp.state = "done";
  })().catch((e) => { window.__exp.state = "failed"; window.__exp.note = String(e && e.stack || e); });
  return 1;
})()`;

// ---- in the page: where a townsperson can walk and how high the ground is (the Godot townspeople keep the game's
// walk grid: docs/godot-port.md). Three layers over the walk map's area, x by z, row by row along z:
//   open: 1 m cells, as game/crowd.ts NavGrid.build opens them (bit 1: by the walk map, half a metre off walls and
//         water; bit 2: not within a body's width of a solid standing there at bake time)
//   free: 0.25 m cells, World.isFree for a walker's body (0.25 m; 0.15 m on the wall's narrow stairs)
//   base: 0.5 m cells, World.baseAt in centimetres (int16)
// Posted as one file (<out>_walk.bin); its sizes and the sellers' spots (game/stalls.ts) go to <out>_walk.json.
const WALK = `(() => {
  window.__walk = { state: "running", note: "" };
  (async () => {
    const s = __scheldemist, w = s.world, g = s.crowd.ground;
    const W = { x0: -480, z0: -80, w: 820, d: 560 };
    for (let i = 0; i < 200 && g.flags(0, 0) === undefined; i++) await new Promise((r) => s.real.setTimeout(r, 250));
    const pause = () => new Promise((r) => s.real.setTimeout(r, 0));
    const open = new Uint8Array(W.w * W.d);
    const R = 0.5, D = R * Math.SQRT1_2;
    for (let iz = 0; iz < W.d; iz++) {
      const z = W.z0 + iz + 0.5;
      for (let ix = 0; ix < W.w; ix++) {
        const x = W.x0 + ix + 0.5;
        const [r, d] = g.narrow && g.narrow(x, z) ? [0.3, 0.3 * Math.SQRT1_2] : [R, D];
        const f = g.flags;
        if (f(x, z) === 0 && f(x + r, z) === 0 && f(x - r, z) === 0 && f(x, z + r) === 0 && f(x, z - r) === 0 && f(x + d, z + d) === 0 && f(x - d, z + d) === 0 && f(x + d, z - d) === 0 && f(x - d, z - d) === 0) open[iz * W.w + ix] = 3;
      }
    }
    const B = 0.45, STEP = 0.36;
    const solids = g.solids ? g.solids() : [];
    for (const c of solids) {
      const i0 = Math.max(0, Math.floor(c.minX - B - W.x0)), i1 = Math.min(W.w - 1, Math.floor(c.maxX + B - W.x0));
      const j0 = Math.max(0, Math.floor(c.minZ - B - W.z0)), j1 = Math.min(W.d - 1, Math.floor(c.maxZ + B - W.z0));
      for (let iz = j0; iz <= j1; iz++) {
        const z = W.z0 + iz + 0.5;
        if (z < c.minZ - B || z > c.maxZ + B) continue;
        for (let ix = i0; ix <= i1; ix++) {
          const x = W.x0 + ix + 0.5;
          if (x < c.minX - B || x > c.maxX + B) continue;
          if (c.surface && !c.surface.blocks(x, z, B, g.baseAt ? g.baseAt(x, z) : 0, STEP)) continue;
          open[iz * W.w + ix] &= 1;
        }
      }
    }
    await pause();
    const fw = W.w * 4, fd = W.d * 4;
    const free = new Uint8Array(fw * fd);
    for (let iz = 0; iz < fd; iz++) {
      const z = W.z0 + (iz + 0.5) * 0.25;
      for (let ix = 0; ix < fw; ix++) {
        const x = W.x0 + (ix + 0.5) * 0.25;
        if (g.isFree(x, z, g.narrow && g.narrow(x, z) ? 0.15 : 0.25)) free[iz * fw + ix] = 1;
      }
      if (iz % 64 === 0) { window.__walk.note = "free " + iz + "/" + fd; await pause(); }
    }
    const bw = W.w * 2, bd = W.d * 2;
    const base = new Int16Array(bw * bd);
    for (let iz = 0; iz < bd; iz++) {
      const z = W.z0 + (iz + 0.5) * 0.5;
      for (let ix = 0; ix < bw; ix++) base[iz * bw + ix] = Math.max(-32000, Math.min(32000, Math.round(w.baseAt(W.x0 + (ix + 0.5) * 0.5, z) * 100)));
      if (iz % 64 === 0) { window.__walk.note = "base " + iz + "/" + bd; await pause(); }
    }
    const sellers = {};
    if (s.stalls && s.stalls.sellerSpots) for (const [id, v] of s.stalls.sellerSpots) sellers[id] = [Math.round(v.x * 100) / 100, Math.round(v.z * 100) / 100, Math.round(v.yaw * 1000) / 1000];
    window.__walk.facts = { ...W, openRes: 1, freeRes: 0.25, baseRes: 0.5, open: open.length, free: free.length, base: base.length, solids: solids.length, sellers };
    await fetch("http://127.0.0.1:${RECV}/walk", { method: "POST", body: new Blob([open, free, base]) });
    window.__walk.state = "done";
  })().catch((e) => { window.__walk.state = "failed"; window.__walk.note = String(e && e.stack || e); });
  return 1;
})()`;
async function walkDump() {
  await ev(WALK);
  let wk = null;
  for (let i = 0; i < 600; i++) {
    await sleep(1000);
    wk = await ev(`(() => { const e = window.__walk; return { state: e.state, note: e.note, facts: e.facts }; })()`, 600_000).catch(() => null);
    if (wk && wk.state !== "running") break;
    if (i % 15 === 14) log("walk dump...", wk?.note ?? "(page busy)");
  }
  if (wk?.state !== "done") throw new Error(`walk dump failed: ${wk?.note}`);
  writeFileSync(`${out}_walk.json`, JSON.stringify({ made: new Date().toISOString(), ...wk.facts }));
  log("written", `${out}_walk.bin`, JSON.stringify({ ...wk.facts, sellers: Object.keys(wk.facts.sellers).length }));
}
// the pictures every psx material shares, made by the game as it starts (world/dirt.ts): posted as <out>_tex/<name>.png,
// with where they lie in <out>_tex/<name>.json. The sky map is a file of the client: copied.
const SHARED_TEX = `(async () => {
  const u = __scheldemist.psxUniforms, out = {};
  // (the dirt on the paving; the distance from the water to the nearest quay wall, world/quaysteps.ts; the foul water, world/litter.ts)
  for (const [name, tex, box] of [["dirt", u.uDirt.value, u.uDirtBox.value], ["shore", u.uShore.value, u.uShoreBox.value], ["foul", u.uFoul.value, u.uFoulBox.value]]) {
    const im = tex && tex.image;
    if (!im || !im.data) continue;
    const c = document.createElement("canvas");
    c.width = im.width; c.height = im.height;
    if (im.width < 2) continue; // (the stand-in until its own picture is in)
    const d = new ImageData(im.width, im.height);
    const step = im.data.length / (im.width * im.height);
    if (step === 4) d.data.set(im.data);
    else for (let i = 0; i < im.width * im.height; i++) d.data.set([im.data[i * step], im.data[i * step], im.data[i * step], 255], i * 4);
    c.getContext("2d").putImageData(d, 0, 0);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    await fetch("http://127.0.0.1:${RECV}/tex/" + name, { method: "POST", body: blob });
    out[name] = { x0: box.x, z0: box.y, w: box.z, h: box.w };
  }
  return out;
})()`;
async function sharedTextures() {
  const boxes = await ev(SHARED_TEX);
  mkdirSync(`${out}_tex`, { recursive: true });
  for (const [name, box] of Object.entries(boxes)) writeFileSync(path.join(`${out}_tex`, `${name}.json`), JSON.stringify(box));
  for (const f of ["skyshade.png", "skyshade.json"]) copyFileSync(path.join(root, "client/public/textures", f), path.join(`${out}_tex`, f));
  return Object.keys(boxes);
}
// The lights of the night as plain data (godot/src/World/Lights.cs): every still spill source (world/spill.ts: the gas
// lamps, the painted windows with their hours, the rooms' windows and doors, the lanterns and glows), and the painted
// windows' panes (world/ambient.ts: three corners, the hours it is lit, its tone and kind). Take it at night
// (--hour 18.33: dark, and the shops and taverns still open), so a room's lamp and a glow carry their lit level.
const LIGHTS = `(async () => {
  const spill = (await import("/src/world/spill.ts")).spillBake();
  const panes = [];
  const r = (v) => Math.round(v * 1000) / 1000;
  __scheldemist.world.scene.traverse((o) => {
    if (o.name !== "ambient_windows") return;
    const p = o.geometry.attributes.position.array, l = o.geometry.attributes.aLit.array, t = o.geometry.attributes.aTone.array;
    // (a pane is two triangles 0 1 2, 0 2 3: its corners 0, 1 and 3 are vertices 0, 1 and 5)
    for (let i = 0; i < p.length / 18; i++) {
      const v = (k) => [r(p[i * 18 + k * 3]), r(p[i * 18 + k * 3 + 1]), r(p[i * 18 + k * 3 + 2])];
      panes.push([...v(0), ...v(1), ...v(5), r(l[i * 24]), r(l[i * 24 + 1]), r(l[i * 24 + 2]), r(l[i * 24 + 3]), r(t[i * 12]), t[i * 12 + 1]]);
    }
  });
  // the rooms' own lights now (at night: the lamps lit), for the rooms the export put in the world as ROOM_<id>
  // (after the export the rooms stand in the world as ROOM_<id>; in a run without export they are still scenes of their own)
  const rooms = [];
  const roomLights = (root) => {
    const out = [];
    root.traverse((o) => { if (o.isLight) out.push({ type: o.type, color: o.color.getHex(), ground: o.groundColor ? o.groundColor.getHex() : null, intensity: o.intensity, distance: o.distance ?? null, decay: o.decay ?? null, pos: o.getWorldPosition(o.position.clone()).toArray().map((v) => Math.round(v * 1000) / 1000) }); });
    return out;
  };
  for (const o of __scheldemist.world.scene.children) if (o.name.startsWith("ROOM_")) rooms.push({ id: o.name.slice(5), lights: roomLights(o) });
  if (!rooms.length) for (const r of (__scheldemist.retro && __scheldemist.retro.inWorld && __scheldemist.retro.inWorld.all) || []) rooms.push({ id: r.id, lights: roomLights(r.scene) });
  return JSON.stringify({ spill, panes, rooms });
})()`;
const UNIFORMS = `(() => { const o = {}; for (const [k, u] of Object.entries(__scheldemist.psxUniforms)) { const v = u.value; if (typeof v === "number" || typeof v === "boolean") o[k] = v; else if (v && v.isColor) o[k] = v.getHex(); else if (Array.isArray(v) && v.length <= 8 && v[0] && v[0].toArray) o[k] = v.map((x) => x.toArray()); else if (v && v.toArray && !v.isTexture && !v.isMatrix4) o[k] = v.toArray(); } return o; })()`;

const t0 = Date.now();
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s]`, ...a);
let code = 0;
let started = false;
try {
  stack("start");
  started = true;
  await openGame();
  await ev(`(__scheldemist.free(true), 1)`);
  await ev(`__scheldemist.t.light(${HOUR}, ${JSON.stringify(WEATHER)}).then(() => 1)`);
  // (the light eases to the hour; the wet ground and the puddles take longer)
  await ev(`new Promise((r) => __scheldemist.real.setTimeout(r, ${TAG ? 45000 : 20000}))`, 90_000);
  await walkDump();
  const places = [];
  for (const place of args.includes("--walk-only") ? [] : PLACES) {
    await ev(`Promise.resolve(__scheldemist.t.go(${JSON.stringify(place)})).then(() => 1)`);
    await ev(`__scheldemist.frameProf({ n: 30 }).then(() => 1)`);
    const turn = REF_ONLY ? { frame: { mean: 0, p95: 0 }, parts: [] } : await ev(`__scheldemist.frameProf({ n: 90, top: 80, turn: 2 })`);
    const cam = await ev(CAMERA);
    // the browser's own picture there, to set Godot's beside it
    await ev(`__scheldemist.frameProf({ n: 3 }).then(() => 1)`);
    const png = await send("Page.captureScreenshot", { format: "png" });
    if (png.result?.data) writeFileSync(`${out}_ref_${place.replace(/ /g, "_")}${TAG}.png`, Buffer.from(png.result.data, "base64"));
    const part = (n) => turn.parts.find((p) => p.part === n)?.mean ?? 0;
    places.push({ place, ...cam, browser: { frameMean: turn.frame.mean, frameP95: turn.frame.p95, render: part("render"), mirrors: part("render.mirrors"), calls: part("render calls") } });
    log(place, "browser turning frame", turn.frame.mean, "ms, render", part("render"), "ms, calls", part("render calls"));
  }
  if (REF_ONLY) {
    const shared = await sharedTextures();
    if (args.includes("--lights")) {
      const lights = JSON.parse(await ev(LIGHTS));
      writeFileSync(`${out}_lights.json`, JSON.stringify({ made: new Date().toISOString(), hour: HOUR, weather: WEATHER, ...lights }));
      log("the lights:", lights.spill.length, "spill sources,", lights.panes.length, "panes ->", `${out}_lights.json`);
    }
    writeFileSync(`${out}_ref${TAG}.json`, JSON.stringify({ made: new Date().toISOString(), hour: HOUR, weather: WEATHER, places, facts: await ev(FACTS), uniforms: await ev(UNIFORMS) }));
    log("ref only: pictures, the light's numbers", `${out}_ref${TAG}.json`, "and the shared pictures", shared.join(", "));
    throw new Error("ref only: no export");
  }
  if (args.includes("--walk-only")) throw "walk only";
  // the export, from the first place, everything the game would draw without the culler
  await ev(`Promise.resolve(__scheldemist.t.go(${JSON.stringify(PLACES[0])})).then(() => 1)`);
  const cull = await ev(`(() => { try { const c = __scheldemist.cull; if (!c) return "no culling switch"; c.enabled = false; return "culler off"; } catch (e) { return String(e); } })()`);
  log(cull);
  await ev(`__scheldemist.frameProf({ n: 6 }).then(() => 1)`);
  const facts = await ev(FACTS);
  // the shared psx values at this moment (13:00, clear): the numbers the Godot shader starts from
  const uniforms = await ev(UNIFORMS);
  await sharedTextures();
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
  writeFileSync(`${out}.json`, JSON.stringify({ made: new Date().toISOString(), places, facts, counts: exp.counts, uniforms, instances: JSON.parse(inst) }));
  stripInstancing(`${out}.glb`);
  // the lights of the night, taken at night (a room's lamp and a glow carry their night's level)
  // (18:20: dark, the lamps lit, and the shops and taverns still open with theirs)
  await ev(`__scheldemist.t.light(18.33, "mist").then(() => 1)`);
  await ev(`new Promise((r) => __scheldemist.real.setTimeout(r, 25000))`, 60_000);
  const lights = JSON.parse(await ev(LIGHTS));
  writeFileSync(`${out}_lights.json`, JSON.stringify({ made: new Date().toISOString(), hour: 18.33, weather: "mist", ...lights }));
  log("the lights:", lights.spill.length, "spill sources,", lights.panes.length, "panes");
  log("written", `${out}.glb`, (received / 1e6).toFixed(1), "MB", JSON.stringify(exp.counts));
} catch (e) {
  if (e !== "walk only") {
    console.error(e);
    code = 1;
  }
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
