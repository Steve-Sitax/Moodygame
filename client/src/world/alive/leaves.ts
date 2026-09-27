import * as THREE from "three";
import { psx } from "../../retro/psx";
import CITY from "../../../../shared/city.json";
import { leaves as leafSound } from "../../audio/aliveSounds";
import { mulberry, openAt, type Ctx, type Frame, type Part } from "./common";
import { dice, hash32, seeded, sharedSeconds } from "../../game/share";

// M7 alive: autumn leaves and scraps of paper blown along the streets. Round Jef (within 26 m)
// lie some ninety leaves and a few torn bills and wrappers, more near the trees of the quays, the
// squares and the ramparts. In a gust (world/alive/wind.ts) they lift one after another as the
// front passes, tumble along the stones with the wind, and pile up against the walls; when it
// drops they settle flat. Wet (rain), they stick to the stones and go dark. A leaf that drifts off
// too far, or out of sight behind Jef, is laid down again ahead of him. Their scrape (made in
// code) is heard within 8 m. One instanced mesh, one draw call.

// (picture round 2026-09-26, package 1: more of them and bigger, plane leaves as big as a hand; was 96, 14-24 cm)
const N_LEAF = 150;
const N_PAPER = 8;
const N = N_LEAF + N_PAPER;
const R = 26;
const TREES = ((CITY as unknown as { decor: { trees?: number[][]; trees_wild?: number[][] } }).decor.trees ?? []).concat(
  (CITY as unknown as { decor: { trees_wild?: number[][] } }).decor.trees_wild ?? [],
);

interface Leaf {
  p: THREE.Vector3;
  v: THREE.Vector3;
  yaw: number;
  tilt: number;
  spin: number;
  paper: boolean;
  air: number;
  s: number;
}

/** A leaf card (0.14 m) with a stalk, or a scrap of paper (0.3 m); lying flat, facing up. */
function geometry(): THREE.BufferGeometry {
  const P: number[] = [];
  const UV: number[] = [];
  const quad = (w: number, l: number, u0: number) => {
    const a = [-w / 2, 0, -l / 2], b = [w / 2, 0, -l / 2], c = [w / 2, 0, l / 2], d = [-w / 2, 0, l / 2];
    P.push(...a, ...b, ...c, ...a, ...c, ...d);
    UV.push(u0, 0, u0 + 0.5, 0, u0 + 0.5, 1, u0, 0, u0 + 0.5, 1, u0, 1);
  };
  quad(1, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(UV, 2));
  g.computeVertexNormals();
  return g;
}

/** 32 x 16 texture: a leaf on the left half (alpha), a scrap of printed paper on the right. */
function texture(): THREE.Texture {
  const W = 32, H = 16;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  // leaf: a pointed oval with a midrib
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < 16; x++) {
      const u = (x + 0.5) / 16 - 0.5;
      const v = (y + 0.5) / H;
      // (package 1: a plane leaf, five-lobed, not an oval: its points read at a few metres)
      const lu = u * 2;
      const lv = (v - 0.55) * 2;
      const r = Math.hypot(lu, lv);
      const t = Math.atan2(lv, lu);
      const edge = (0.62 + 0.3 * Math.abs(Math.cos(t * 2.5 + 1.57))) * (v > 0.9 ? 0.5 : 1);
      if (r > edge) continue;
      const rib = Math.abs(u) < 0.05;
      const shade = 0.85 + 0.15 * Math.sin(y * 1.7 + x);
      g.fillStyle = rib ? "rgba(90,60,30,1)" : `rgba(${Math.round(200 * shade)},${Math.round(150 * shade)},${Math.round(70 * shade)},1)`;
      g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = "rgba(70,45,25,1)";
  g.fillRect(7, 14, 2, 2);
  // paper: off-white, torn edges, lines of print
  for (let y = 1; y < H - 1; y++) {
    for (let x = 17; x < 31; x++) {
      if ((x === 17 || x === 30 || y === 1 || y === H - 2) && ((x * 7 + y * 13) % 3 === 0)) continue;
      const print = y > 2 && y < H - 3 && x > 18 && x < 29 && y % 3 !== 0 && ((x * 31 + y * 17) % 5 !== 0);
      g.fillStyle = print ? "rgba(70,65,60,1)" : "rgba(208,200,178,1)";
      g.fillRect(x, y, 1, 1);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createLeaves(ctx: Ctx): Part {
  // (a layer on the stones: drawn over them, as the street decals are, so the PS1 wobble never lets them fight)
  const mat = psx(new THREE.MeshLambertMaterial({ map: texture(), alphaTest: 0.5, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { affine: 0 });
  const mesh = new THREE.InstancedMesh(geometry(), mat, N);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.name = "alive_leaves";
  // per-instance tint: autumn browns and yellows, dark when wet (set each frame for the wet ones)
  const tints: THREE.Color[] = [];
  const r = mulberry(1873_10);
  for (let i = 0; i < N; i++) {
    const paper = i >= N_LEAF;
    // (package 1: ochre, rust and brown, a little brighter than the drifts: the loose ones lie on top, dry)
    const c = paper ? new THREE.Color(0.8, 0.78, 0.72) : new THREE.Color().setHSL(0.05 + r() * 0.07, 0.6 + r() * 0.3, 0.34 + r() * 0.2);
    tints.push(c);
    mesh.setColorAt(i, c);
  }
  // the uv offset per instance: leaves the left half, paper the right (in the shader)
  const kind = new THREE.InstancedBufferAttribute(new Float32Array(N), 1);
  for (let i = 0; i < N; i++) kind.setX(i, i >= N_LEAF ? 0.5 : 0);
  mesh.geometry.setAttribute("aKind", kind);
  const base = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float aKind;").replace("#include <uv_vertex>", "#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv.x += aKind;\n#endif");
  };
  mat.customProgramCacheKey = () => "alive-leaves";
  ctx.scene.add(mesh);

  // M8f sync pass 3: the leaves and scraps are the town's, not laid round Jef by this PC's dice: each cell of the
  // ground (6 m) has its own, where its dice put them (more near the trees), made when a player comes within reach
  // of it; the same wind (alive/wind.ts: the shared clock) blows them the same way on every PC. The nearest are drawn.
  const CELL = 6;
  interface Lying extends Leaf {
    key: string;
    tint: THREE.Color;
    seed: number;
  }
  const cells = new Map<string, Lying[]>();
  let list: Lying[] = [];
  let on = true;
  let placed = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const sc = new THREE.Vector3();
  const w2 = new THREE.Vector2();
  const col = new THREE.Color();
  let soundWait = 0;
  let moving = 0;
  const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

  /** More leaves near the trees: the chance a spot keeps a leaf. */
  const treeNear = (x: number, z: number) => {
    let d = 1e9;
    for (const t of TREES) {
      const dd = (t[0] - x) ** 2 + (t[1] - z) ** 2;
      if (dd < d) d = dd;
    }
    return 0.3 + 0.7 * Math.exp(-Math.sqrt(d) / 22);
  };

  /** The leaves of a cell, where its dice lay them. */
  function cellLeaves(ci: number, cj: number): Lying[] {
    const key = `${ci},${cj}`;
    const r = seeded(hash32("leaves", ci, cj));
    const out: Lying[] = [];
    const T = treeNear((ci + 0.5) * CELL, (cj + 0.5) * CELL);
    for (let k = 0; k < 17; k++) {
      const paper = k === 16;
      const x = (ci + r()) * CELL;
      const z = (cj + r()) * CELL;
      const keep = r();
      const yaw = r() * Math.PI * 2;
      const s = r();
      const h = r(), sat = r(), lit = r();
      if (keep > (paper ? T * 0.15 : T * 0.8)) continue;
      if (!openAt(ctx.flags, x, z, 0.3)) continue;
      const y = ctx.world.baseAt(x, z);
      if (!Number.isFinite(y)) continue;
      // (package 1: ochre, rust and brown, a little brighter than the drifts: the loose ones lie on top, dry)
      const tint = paper ? new THREE.Color(0.8, 0.78, 0.72) : new THREE.Color().setHSL(0.05 + h * 0.07, 0.6 + sat * 0.3, 0.34 + lit * 0.2);
      out.push({ key, p: new THREE.Vector3(x, y + 0.025, z), v: new THREE.Vector3(), yaw, tilt: 0, spin: 0, paper, air: 0, s: paper ? 0.28 + s * 0.12 : 0.17 + s * 0.13, tint, seed: hash32(key, k) });
    }
    return out;
  }

  const lastEye = new THREE.Vector3();
  function update(f: Frame): void {
    if (!on) return;
    lastEye.copy(f.eye);
    const dt = f.dt;
    if (ctx.flags(f.eye.x, f.eye.z) === undefined) return;
    placed = true;
    // the cells within reach of this eye (dropped a little further out: no leaves coming and going at one distance)
    const i0 = Math.floor((f.eye.x - R) / CELL), i1 = Math.floor((f.eye.x + R) / CELL);
    const j0 = Math.floor((f.eye.z - R) / CELL), j1 = Math.floor((f.eye.z + R) / CELL);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const key = `${i},${j}`;
        if (cells.has(key)) continue;
        if (Math.hypot((i + 0.5) * CELL - f.eye.x, (j + 0.5) * CELL - f.eye.z) > R + CELL) continue;
        cells.set(key, cellLeaves(i, j));
      }
    for (const [key, l] of cells) {
      const [ci, cj] = key.split(",").map(Number);
      if (Math.hypot((ci + 0.5) * CELL - f.eye.x, (cj + 0.5) * CELL - f.eye.z) > R * 1.25 + CELL) cells.delete(key);
      void l;
    }
    list = [...cells.values()].flat();
    // wet leaves stick: it takes a gale to move them
    const stick = 0.9 + f.wet * 5;
    const S = sharedSeconds();
    moving = 0;
    let mx = 0, mz = 0;
    for (let i = 0; i < list.length; i++) {
      const l = list[i];
      const dd = Math.hypot(l.p.x - f.eye.x, l.p.z - f.eye.z);
      if (dd > R * 1.25) continue;
      ctx.wind.at(l.p.x, l.p.z, w2);
      const ws = w2.length();
      const push = Math.max(0, ws - stick) * (l.paper ? 1.4 : 1);
      const ground = ctx.world.baseAt(l.p.x, l.p.z);
      const gy = Number.isFinite(ground) ? ground + 0.025 : l.p.y; // (over the flat street decals: straw, dung, puddles)
      if (push > 0.05) {
        // the wind takes it: towards the wind speed, a hop now and then, spinning (the leaf's own dice by the clock)
        const target = 0.8 * ws * (l.paper ? 1.1 : 0.9);
        const n = Math.floor(S * 8);
        l.v.x += (w2.x / ws * target - l.v.x) * Math.min(1, dt * 2.5 * push);
        l.v.z += (w2.y / ws * target - l.v.z) * Math.min(1, dt * 2.5 * push);
        if (l.air <= 0 && dice("leafhop", l.seed, n) < 0.125 * push * (l.paper ? 1.2 : 0.8)) l.v.y = 0.6 + dice("leafhopv", l.seed, n) * push * 0.9;
        l.spin += (dice("leafspin", l.seed, n) - 0.5) * dt * 20 * push;
      } else {
        // friction on the stones
        const k = Math.max(0, 1 - dt * 3);
        l.v.x *= k;
        l.v.z *= k;
      }
      l.v.y -= 3.2 * dt; // leaves fall slowly (the air)
      l.v.y = Math.max(l.v.y, l.paper ? -0.6 : -0.9);
      const nx = l.p.x + l.v.x * dt;
      const nz = l.p.z + l.v.z * dt;
      if (ctx.flags(nx, nz) !== 0) {
        // a wall (or the water's edge): it stops against it, a little bounce back
        l.v.x *= -0.15;
        l.v.z *= -0.15;
      } else {
        l.p.x = nx;
        l.p.z = nz;
      }
      l.p.y += l.v.y * dt;
      if (l.p.y <= gy) {
        l.p.y = gy;
        l.v.y = 0;
        l.air = 0;
      } else l.air = l.p.y - gy;
      const speed = Math.hypot(l.v.x, l.v.z);
      l.yaw += l.spin * dt;
      l.spin *= Math.max(0, 1 - dt * 2);
      // flat on the ground; tumbling in the air; a paper's corner lifts as it slides
      l.tilt = l.air > 0.02 ? Math.sin(f.t * 9 + i) * 1.2 : speed > 0.2 ? Math.sin(f.t * 14 + i) * 0.25 * Math.min(1, speed) : 0;
      if (speed > 0.25 && dd < 8) {
        moving++;
        mx += l.p.x;
        mz += l.p.z;
      }
    }
    // the nearest on this eye's level into the instances (leaves first, the scraps in their own)
    const near = list.filter((l) => Math.hypot(l.p.x - f.eye.x, l.p.z - f.eye.z) <= R * 1.25 && Math.abs(l.p.y - (f.eye.y - 1.6)) <= 4);
    // (the nearest first only when there are more than the instances hold; else in a fixed order: the same instances
    // for two players in one place)
    if (near.length > N_LEAF) near.sort((a, b) => Math.hypot(a.p.x - f.eye.x, a.p.z - f.eye.z) - Math.hypot(b.p.x - f.eye.x, b.p.z - f.eye.z));
    else near.sort((a, b) => a.seed - b.seed);
    let nl = 0;
    let np = N_LEAF;
    for (const l of near) {
      const slot = l.paper ? (np < N ? np++ : -1) : nl < N_LEAF ? nl++ : -1;
      if (slot < 0) continue;
      e.set(l.tilt, l.yaw, l.tilt * 0.6);
      q.setFromEuler(e);
      m4.compose(l.p, q, sc.set(l.s, l.s, l.s * (l.paper ? 0.75 : 1.2)));
      mesh.setMatrixAt(slot, m4);
      col.copy(l.tint).multiplyScalar(1 - 0.45 * f.wet);
      mesh.setColorAt(slot, col);
    }
    for (let i = nl; i < N_LEAF; i++) mesh.setMatrixAt(i, HIDE);
    for (let i = np; i < N; i++) mesh.setMatrixAt(i, HIDE);
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.visible = true;
    // the scrape, where they move near Jef
    soundWait -= dt;
    if (moving >= 3 && soundWait <= 0) {
      soundWait = 1.4;
      ctx.sound()?.placed({ x: mx / moving, y: 0.1, z: mz / moving }, { ref: 1.5, reach: 6, max: 8, rolloff: 1.4, wet: 0.1, gain: 0.5 }, leafSound(Math.min(1, moving / 14), 1.5));
    }
  }

  return {
    name: "leaves",
    update,
    info: () => {
      const e = lastEye;
      const near = list
        .filter((l) => l.p.x < 1e4)
        .map((l) => ({ at: [+l.p.x.toFixed(2), +l.p.y.toFixed(2), +l.p.z.toFixed(2)], d: Math.hypot(l.p.x - e.x, l.p.z - e.z), paper: l.paper }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 4);
      return { n: N, moving, placed, near };
    },
    setOn: (v) => {
      on = v;
      mesh.visible = v;
    },
  };
}
