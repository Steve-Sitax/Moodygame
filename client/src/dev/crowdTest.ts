import * as THREE from "three";
import { RetroPass } from "../retro/retroPass";
import { psx, psxUniforms } from "../retro/psx";
import { Crowd, placesFromCity, type BusyPlace, type CrowdGround } from "../game/crowd";
import type { World } from "../world/rijnkaai";

// Dev test page for the crowd (client/crowd-test.html, not in the game build).
// Loads the real world if it builds (no jobs, no server clock: the save is not
// touched), else a small made-up harbour with the same flags() rules. Drive it
// from the console or a test script through window.__crowdTest.

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const retro = new RetroPass(renderer);
const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 400);
const params = new URLSearchParams(location.search);

let world: World | null = null;
let scene: THREE.Scene;
let ground: CrowdGround;
let places: BusyPlace[] = [];
let mode = "real";

async function realWorld(): Promise<boolean> {
  try {
    const { buildRijnkaai } = await import("../world/rijnkaai");
    const city = (await import("../../../shared/city.json")).default as unknown as { places?: Record<string, { x: number; z: number; kind: string }> };
    const w = buildRijnkaai();
    const ok = await Promise.race([w.city.ready.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 15000))]).catch(() => false);
    if (!ok || w.city.flags(0, 10) === undefined) return false;
    world = w;
    scene = w.scene;
    ground = { flags: w.city.flags, isFree: w.isFree, addCollider: w.addCollider, removeCollider: w.removeCollider };
    places = city.places ? placesFromCity(city.places) : [];
    return true;
  } catch (err) {
    console.warn("real world did not build; using the test harbour", err);
    return false;
  }
}

/** A made-up harbour: river at z < 0, a 16 m quay, blocks with 7 m streets, one square. */
function testHarbour(): void {
  mode = "harbour";
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x5a6068, 3, 25);
  scene.background = new THREE.Color(0x5a6068);
  scene.add(new THREE.HemisphereLight(0xb0b4b8, 0x303028, 2.2));
  const inSquare = (x: number, z: number) => x > -25 && x < 25 && z > 40 && z < 75;
  const crates: Array<[number, number]> = [[-12, 6], [14, 9], [30, 4]];
  const flags = (x: number, z: number): number => {
    if (Math.abs(x) > 110 || z > 140) return 4;
    if (z < 0) return 2;
    if (z < 16 || inSquare(x, z)) return 0;
    const sx = (((x + 105) % 30) + 30) % 30 < 7;
    const sz = (((z - 16) % 25) + 25) % 25 < 6;
    return sx || sz ? 0 : 1;
  };
  const isFree = (x: number, z: number, r: number) => {
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) if (flags(x + dx * (r + 0.15), z + dz * (r + 0.15)) !== 0) return false;
    for (const [cx, cz] of crates) if (Math.abs(x - cx) < 0.6 + r && Math.abs(z - cz) < 0.6 + r) return false;
    return true;
  };
  ground = { flags, isFree };
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(240, 150).rotateX(-Math.PI / 2).translate(0, 0, 70), psx(new THREE.MeshLambertMaterial({ color: 0x5e5a52 })));
  scene.add(groundMesh);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(240, 60).rotateX(-Math.PI / 2).translate(0, -1.4, -30), psx(new THREE.MeshLambertMaterial({ color: 0x2e3a38 })));
  scene.add(water);
  const house = [0x5a4034, 0x4a3a30, 0x6a5040, 0x544a40].map((c) => psx(new THREE.MeshLambertMaterial({ color: c })));
  for (let x = -105; x < 105; x += 30) {
    for (let z = 16; z < 140; z += 25) {
      const x0 = x + 7;
      const z0 = z + 6;
      if (inSquare(x0 + 11, z0 + 9)) continue;
      const h = 9 + Math.random() * 6;
      const b = new THREE.Mesh(new THREE.BoxGeometry(23, h, 19), pickMat(house));
      b.position.set(x0 + 11.5, h / 2, z0 + 9.5);
      scene.add(b);
    }
  }
  const crate = psx(new THREE.MeshLambertMaterial({ color: 0x6a5234 }));
  for (const [cx, cz] of crates) {
    const c = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), crate);
    c.position.set(cx, 0.6, cz);
    scene.add(c);
  }
  places = [
    { x: 0, z: 8, kind: "quay", r: 18 },
    { x: 45, z: 8, kind: "quay", r: 18 },
    { x: -45, z: 8, kind: "quay", r: 18 },
    { x: 0, z: 57, kind: "square", r: 14 },
    { x: 3, z: 30, kind: "street" },
    { x: -27, z: 50, kind: "street" },
  ];
}
const pickMat = (m: THREE.Material[]) => m[Math.floor(Math.random() * m.length)];

function resize(): void {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  retro.resize(camera.aspect);
  psxUniforms.uSnapRes.value.set(retro.width * 0.5, retro.height * 0.5);
}

async function main(): Promise<void> {
  if (params.get("mode") === "harbour" || !(await realWorld())) testHarbour();
  const spawn = places.find((p) => p.kind === "quay") ?? { x: 0, z: 8 };
  camera.position.set(spawn.x, 1.6, spawn.z);
  camera.rotation.set(0, 0, 0, "YXZ");
  const crowd = new Crowd(scene, ground, places, { mats: world ? { sack: world.mats.sack, crate: world.mats.crate } : undefined });
  let hour = Number(params.get("hour") ?? 10);
  crowd.setHour(hour);
  world?.setTimeOfDay(hour);
  resize();
  window.addEventListener("resize", resize);

  let elapsed = 0;
  let last = performance.now();
  let paused = false;
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!paused) {
      elapsed += dt;
      world?.update(elapsed, dt, camera);
      crowd.update(dt, { x: camera.position.x, z: camera.position.z }, camera);
    }
    retro.render(scene, camera, elapsed);
    const s = crowd.stats;
    hud.textContent = `${mode}  ${hour.toFixed(1)}h  alive ${s.alive}/${s.target}  drawn ${s.drawn}  animated ${s.animated}  groups ${s.clusters}  at ${camera.position.x.toFixed(0)},${camera.position.z.toFixed(0)}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  const people = () => (crowd as unknown as { people: Array<{ kind: string; x: number; z: number; state: string; role: string; yaw: number }> }).people;
  (window as unknown as Record<string, unknown>).__crowdTest = {
    crowd,
    get mode() {
      return mode;
    },
    places,
    /** Stand at (x, z) looking toward yaw (degrees, 0 = +z), eye 1.6 m. */
    view(x: number, z: number, yawDeg = 0, pitchDeg = -3, y = 1.6) {
      camera.position.set(x, y, z);
      camera.rotation.set((pitchDeg * Math.PI) / 180, Math.PI + (yawDeg * Math.PI) / 180, 0, "YXZ");
    },
    hour(h: number) {
      hour = h;
      crowd.setHour(h);
      world?.setTimeOfDay(h);
    },
    weather(w: "fog" | "mist" | "clear") {
      world?.setWeather(w);
    },
    pause(on = true) {
      paused = on;
    },
    /** Run the crowd for some seconds at 30 Hz without drawing. */
    run(seconds: number) {
      for (let t = 0; t < seconds; t += 1 / 30) {
        elapsed += 1 / 30;
        world?.update(elapsed, 1 / 30, camera);
        crowd.update(1 / 30, { x: camera.position.x, z: camera.position.z }, camera);
      }
      return crowd.stats;
    },
    /** Milliseconds per crowd.update, averaged. */
    bench(n = 200) {
      const t0 = performance.now();
      for (let i = 0; i < n; i++) crowd.update(1 / 60, { x: camera.position.x, z: camera.position.z }, camera);
      return +((performance.now() - t0) / n).toFixed(3);
    },
    /** ms per frame (crowd update + draw, GPU finished), draw calls and triangles; crowd on or off. */
    perf(n = 60, crowdOn = true) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      const groups = scene.children.filter((o) => o.type === "Group" && o.children.some((c) => (c as THREE.Object3D).getObjectByName?.("hips")));
      if (!crowdOn) groups.forEach((g) => (g.visible = false));
      renderer.info.autoReset = false;
      const t0 = performance.now();
      let calls = 0;
      let tris = 0;
      for (let i = 0; i < n; i++) {
        renderer.info.reset();
        if (crowdOn) crowd.update(1 / 60, { x: camera.position.x, z: camera.position.z }, camera);
        retro.render(scene, camera, elapsed);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        calls = renderer.info.render.calls;
        tris = renderer.info.render.triangles;
      }
      renderer.info.autoReset = true;
      return { msPerFrame: +((performance.now() - t0) / n).toFixed(2), calls, tris, drawn: crowd.stats.drawn };
    },
    people() {
      return people().map((p) => ({ kind: p.kind, role: p.role, state: p.state, x: +p.x.toFixed(1), z: +p.z.toFixed(1), d: +Math.hypot(p.x - camera.position.x, p.z - camera.position.z).toFixed(1) }));
    },
    /** Save a picture to data/shots/<name>.jpg (dev server). */
    async shot(name = "crowd_test") {
      retro.render(scene, camera, elapsed);
      const url = canvas.toDataURL("image/jpeg", 0.88);
      const r = await fetch("/api/dev/shot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, url }) });
      return r.ok ? `data/shots/${name}.jpg` : `failed ${r.status}`;
    },
  };
}

void main();
