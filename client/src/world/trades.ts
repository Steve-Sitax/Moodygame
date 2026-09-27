import { modelCollider, modelShape } from "./modelCollision";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { lampFog } from "./lampFog";
import type { Rect } from "./geom";
import { makeHuman, whenHumans, type Human, type HumanKind, type Motion } from "../game/humans";
import { addPropObject } from "./propSpots";

// Working trades (M3i; Steve: "boat repair shops (small boats), horse shoe fitter, rope
// maker, ..."). Small scenes from tools/blender/build_trades.py -> /models/trades.glb, each
// with its sign and someone at work in it by day (Monday to Saturday, 7:00 to 18:30):
//
//   the boat repair yard   the east quay of the Canal des Brasseurs, on the water side: a
//                          rowing boat on chocks being caulked, a punt on trestles, sawhorses
//   the farrier            the Eilandje, in the bend of the quay railway past the lock: an
//                          open forge shed, the anvil, a horse tied up with a hind hoof lifted
//   the rope walk          the river quay north of the lock: the wheel a boy turns, the yarns
//                          over the trestles, the rope maker walking backwards spinning hemp
//   the cooper             the west quay of the canal: casks, a cask fired over its shavings
//   the sailmaker          the south quay of the Petit Bassin: canvas spread on the stones
//   the net menders        the west bank of the Sint-Pietersvliet: nets hung on poles
//
// Each scene is merged into one mesh per material (solid atlas, decals, glow), hidden
// beyond the fog. The workers are people.glb bodies with their own mixers, made when Jef
// comes near and dropped when he leaves. Their colliders are known from this file before
// the models load, and every scene is a keep-out for the props, the street life and the
// quay furniture (rijnkaai.ts), so nothing else is put in the workshops.
//
// Also the loader and a merge helper for game/market.ts (the market goods are in the same
// file): loadTradeModels(), partsOf(), Batch.

// ------------------------------------------------------------------ models and merging

/** Geometry of one material, in its model's frame (non-indexed; colour rgb). */
export interface Part {
  mat: THREE.Material;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
}

export interface TradeModels {
  parts: Map<string, Part[]>;
  mats: { solid: THREE.Material; decal: THREE.Material; glow: THREE.MeshBasicMaterial };
}

let loading: Promise<TradeModels | null> | null = null;

/** Every mesh under `root`, in root's frame, as parts; `matFor` swaps the glTF material. */
export function partsOf(root: THREE.Object3D, matFor: (m: THREE.Material) => THREE.Material = (m) => m): Part[] {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const out: Part[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
    const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    nm.getNormalMatrix(M);
    const P = g.getAttribute("position");
    const N = g.getAttribute("normal");
    const U = g.getAttribute("uv");
    const C = g.getAttribute("color");
    const n = P.count;
    const part: Part = { mat: matFor(m.material as THREE.Material), pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3) };
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(M);
      part.pos.set([v.x, v.y, v.z], i * 3);
      if (N) {
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
        part.nor.set([v.x, v.y, v.z], i * 3);
      } else part.nor.set([0, 1, 0], i * 3);
      if (U) part.uv.set([U.getX(i), U.getY(i)], i * 2);
      if (C) part.col.set([C.getX(i), C.getY(i), C.getZ(i)], i * 3);
      else part.col.set([1, 1, 1], i * 3);
    }
    out.push(part);
  });
  return out;
}

/** trades.glb, once. Null if it does not load (the scenes and the market goods stay away). */
export function loadTradeModels(): Promise<TradeModels | null> {
  if (loading) return loading;
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  loading = new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/trades.glb")
    .then((gltf) => {
      draco.dispose();
      let solidMap: THREE.Texture | null = null;
      let decalMap: THREE.Texture | null = null;
      gltf.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!m?.map) return;
        if (m.name === "tr_decal") decalMap ??= m.map;
        else solidMap ??= m.map;
      });
      for (const t of [solidMap, decalMap] as Array<THREE.Texture | null>) {
        if (!t) continue;
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
      }
      const DS = THREE.DoubleSide;
      const solid = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true, side: DS }), { affine: 0 });
      solid.name = "trades_solid";
      const decal = psx(
        new THREE.MeshLambertMaterial({ map: decalMap, vertexColors: true, transparent: true, alphaTest: 0.3, depthWrite: false, side: DS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
        { affine: 0 },
      );
      decal.name = "trades_decal";
      const glow = new THREE.MeshBasicMaterial({ map: solidMap, color: 0xffffff, side: DS });
      lampFog(glow, 1.3); // M7 fog lamps: a forge's glow fogs with its shop, a little further
      glow.name = "trades_glow";
      const byName: Record<string, THREE.Material> = { tr_solid: solid, tr_decal: decal, tr_glow: glow };
      const parts = new Map<string, Part[]>();
      for (const node of [...gltf.scene.children]) {
        node.position.set(0, 0, 0);
        node.rotation.set(0, 0, 0);
        parts.set(node.name, partsOf(node, (m) => byName[m.name] ?? solid));
      }
      return { parts, mats: { solid, decal, glow } };
    })
    .catch((e: unknown) => {
      console.warn("trades.glb did not load; no trades and no market goods", e);
      draco.dispose();
      return null;
    });
  return loading;
}

/**
 * Parts merged into one geometry per material. Items are added in order; `window(lo, hi)`
 * then draws items lo..hi-1 only (a draw range per material), so a market can put its
 * stalls up and take them down one by one without a draw call each.
 */
export class Batch {
  private readonly items: Array<Array<{ mat: THREE.Material; pos: number[]; nor: number[]; uv: number[]; col: number[] }>> = [[]];
  private starts = new Map<THREE.Material, number[]>();
  readonly meshes: THREE.Mesh[] = [];
  private readonly M = new THREE.Matrix4();
  private readonly nm = new THREE.Matrix3();

  /** Add parts to the current item: moved by `m`; colours times `tint`; materials through `swap`. */
  add(parts: Part[] | undefined, m: THREE.Matrix4, tint?: [number, number, number], swap?: (mat: THREE.Material) => THREE.Material): void {
    if (!parts) return;
    const item = this.items[this.items.length - 1];
    const e = m.elements;
    this.nm.getNormalMatrix(m);
    const n = this.nm.elements;
    for (const p of parts) {
      const mat = swap ? swap(p.mat) : p.mat;
      let b = item.find((q) => q.mat === mat);
      if (!b) item.push((b = { mat, pos: [], nor: [], uv: [], col: [] }));
      const t = tint ?? null;
      for (let i = 0; i < p.pos.length; i += 3) {
        const px = p.pos[i], py = p.pos[i + 1], pz = p.pos[i + 2];
        b.pos.push(e[0] * px + e[4] * py + e[8] * pz + e[12], e[1] * px + e[5] * py + e[9] * pz + e[13], e[2] * px + e[6] * py + e[10] * pz + e[14]);
        const nx = p.nor[i], ny = p.nor[i + 1], nz = p.nor[i + 2];
        const ox = n[0] * nx + n[3] * ny + n[6] * nz;
        const oy = n[1] * nx + n[4] * ny + n[7] * nz;
        const oz = n[2] * nx + n[5] * ny + n[8] * nz;
        const l = Math.hypot(ox, oy, oz) || 1;
        b.nor.push(ox / l, oy / l, oz / l);
        if (t) b.col.push(p.col[i] * t[0], p.col[i + 1] * t[1], p.col[i + 2] * t[2]);
        else b.col.push(p.col[i], p.col[i + 1], p.col[i + 2]);
      }
      for (let i = 0; i < p.uv.length; i++) b.uv.push(p.uv[i]);
    }
  }

  /** The same, placed at (x, y, z), turned by yaw, scaled (sx, sy, sz). */
  put(parts: Part[] | undefined, x: number, y: number, z: number, yaw: number, s: [number, number, number] = [1, 1, 1], tint?: [number, number, number], swap?: (mat: THREE.Material) => THREE.Material): void {
    this.M.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(...s));
    this.add(parts, this.M, tint, swap);
  }

  /** Close the current item and begin the next. */
  next(): void {
    this.items.push([]);
  }

  get count(): number {
    const last = this.items[this.items.length - 1];
    return last.length ? this.items.length : this.items.length - 1;
  }

  /** Build the meshes (one per material) under `parent`. */
  build(parent: THREE.Object3D, name: string): THREE.Mesh[] {
    const items = this.items.filter((it, i) => it.length || i < this.items.length - 1);
    const mats: THREE.Material[] = [];
    for (const it of items) for (const b of it) if (!mats.includes(b.mat)) mats.push(b.mat);
    for (const mat of mats) {
      const pos: number[] = [];
      const nor: number[] = [];
      const uv: number[] = [];
      const col: number[] = [];
      const starts: number[] = [];
      for (const it of items) {
        starts.push(pos.length / 3);
        const b = it.find((q) => q.mat === mat);
        if (!b) continue;
        for (const v of b.pos) pos.push(v);
        for (const v of b.nor) nor.push(v);
        for (const v of b.uv) uv.push(v);
        for (const v of b.col) col.push(v);
      }
      starts.push(pos.length / 3);
      if (!pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mat);
      mesh.name = `${name}_${mat.name || "mat"}`;
      parent.add(mesh);
      this.meshes.push(mesh);
      this.starts.set(mat, starts);
    }
    return this.meshes;
  }

  /** Draw items lo..hi-1 only. */
  window(lo: number, hi: number): void {
    for (const m of this.meshes) {
      const s = this.starts.get(m.material as THREE.Material)!;
      const a = s[Math.max(0, Math.min(lo, s.length - 1))];
      const b = s[Math.max(0, Math.min(hi, s.length - 1))];
      m.geometry.setDrawRange(a, Math.max(0, b - a));
      m.visible = b > a;
    }
  }
}

// ------------------------------------------------------------------ the sites

type P = [number, number];
/** A box in a scene's own frame (game axes: +z is its front), with a top height. */
type Box = [number, number, number, number, number];

interface Worker {
  kind: HumanKind;
  /** Where they work, in the scene's frame, and which way they face (yaw in that frame). */
  at: P;
  yaw: number;
  motion: Motion;
  /** Seated on something this high. */
  seat?: number;
  /** A second place they go to now and then: [x, z, yaw, motion, seconds]. */
  alt?: [number, number, number, Motion, number];
}

interface Site {
  id: string;
  label: string;
  model: string;
  x: number;
  z: number;
  yaw: number;
  /** Extra models: [name, local x, local z, yaw in the scene frame]. */
  extra?: Array<[string, number, number, number]>;
  /** Solid boxes (local). */
  boxes: Box[];
  /** Keep-out for other things, local [minX, maxX, minZ, maxZ] (the scene and its elbow room). */
  area: [number, number, number, number];
  workers: Worker[];
  /** Smoke from here (local x, y, z). */
  smoke?: Array<[number, number, number]>;
  /** A point a path must reach (local), for the path check. */
  reach: P;
}

const HALF_PI = Math.PI / 2;

/** Rope walk: the wheel at (123.5, 5), the yarns running east along z = 5 over the trestles to x 167. */
const ROPE = { x0: 123.5, z: 5.0, hook: 1.06, first: 127, step: 5, posts: 9, walkFrom: 125.8, walkTo: 166.5 };
const YARNS = [-0.24, -0.08, 0.08, 0.24];

export const SITES: Site[] = [
  {
    id: "boatyard",
    label: "the boat repair yard",
    model: "tr_boatyard",
    x: -66.5,
    z: 169,
    yaw: HALF_PI,
    boxes: [
      [-2.4, 2.4, -0.8, 0.8, 1.0], // the boat on its chocks
      [-2.3, 2.3, -3.15, -1.65, 1.0], // the punt on trestles
      [2.3, 5.1, -0.8, 0.2, 0.7], // sawhorses and the plank
      [2.5, 4.6, -2.65, -1.55, 0.7], // oakum and the tool bench
      [-2.95, -2.25, 0.45, 1.15, 0.9], // the caulking pot
      [-5.2, -2.0, -2.55, -1.85, 0.3], // the plank stack (low)
    ],
    area: [-5.4, 5.3, -3.4, 2.6],
    workers: [
      { kind: "docker_b", at: [0.4, 1.15], yaw: Math.PI, motion: "talk", alt: [-2.2, 1.5, Math.PI + 0.6, "idle", 8] },
      { kind: "old_man", at: [3.7, 0.75], yaw: Math.PI, motion: "talk" },
    ],
    smoke: [[-2.6, 0.9, 0.8]],
    reach: [0.4, 1.9],
  },
  {
    id: "farrier",
    label: "the farrier",
    model: "tr_farrier",
    x: 162.5,
    z: 23.2,
    yaw: 0,
    extra: [["tr_horse", 5.15, 0.3, 0]],
    boxes: [
      [-2.6, 2.6, -2.75, -1.55, 2.5], // the back, the forge, the bellows, the tools
      [-2.6, -2.4, -2.7, 0.1, 2.5], // the side wall
      [-0.07, 0.07, -0.07, 0.07, 2.4], // the middle front post
      [2.43, 2.57, -0.07, 0.07, 2.4],
      [0.05, 0.55, -0.85, -0.35, 0.8], // the anvil
      [0.95, 1.65, -1.55, -0.85, 0.5], // the quench tub
      [3.0, 3.2, -0.4, -0.2, 1.2], // the hitching post
      [3.55, 6.5, -0.05, 0.65, 1.9], // the horse
    ],
    area: [-3.0, 7.0, -3.1, 1.6],
    workers: [{ kind: "docker_c", at: [6.3, 1.05], yaw: Math.PI + 0.4, motion: "carry", alt: [0.3, 0.05, Math.PI, "talk", 9] }],
    smoke: [[-1.4, 3.2, -2.5]],
    reach: [1.0, 1.4],
  },
  {
    id: "ropewalk",
    label: "the rope walk",
    model: "tr_rope_wheel",
    x: ROPE.x0,
    z: ROPE.z,
    yaw: 0,
    boxes: [
      [-0.5, 1.15, -0.5, 0.5, 1.8], // the wheel frame and the hook board
      [-1.45, -0.55, -0.35, 0.8, 0.8], // hemp bales
    ],
    area: [-2.5, 45, -1.6, 1.8],
    workers: [
      { kind: "boy", at: [0.45, 0.62], yaw: Math.PI, motion: "carry" },
      { kind: "sailor", at: [ROPE.walkFrom - ROPE.x0, 0], yaw: -HALF_PI, motion: "walk" },
    ],
    reach: [-1.0, 1.3],
  },
  {
    id: "cooper",
    label: "the cooper",
    model: "tr_cooper",
    x: -89.8,
    z: 126,
    yaw: HALF_PI,
    boxes: [
      [-2.6, -0.7, -1.7, 0.05, 1.6], // casks
      [-2.75, -1.65, -0.65, 0.25, 0.7], // the cask lying down
      [0.1, 1.1, -0.7, 0.3, 1.0], // the cask being fired
      [1.25, 2.3, -2.1, -1.5, 0.8], // hoops against the wall
      [1.5, 3.1, -0.95, -0.05, 0.9], // the shaving horse
    ],
    area: [-3.0, 3.3, -2.3, 1.6],
    workers: [{ kind: "baker", at: [0.6, 0.85], yaw: Math.PI, motion: "talk", alt: [1.9, 0.3, Math.PI, "idle", 6] }],
    smoke: [[0.6, 1.1, -0.2]],
    reach: [0.6, 1.5],
  },
  {
    id: "sailmaker",
    label: "the sailmaker",
    model: "tr_sailmaker",
    x: 151,
    z: 112.5, // (0.3 m in: a corner of the sail lay over the quay's edge, the prop check)
    yaw: 0,
    boxes: [
      [-3.55, -3.05, -0.95, 0.95, 0.5], // the bench
      [-3.95, -3.25, 0.95, 1.65, 0.75], // the sail bag
    ],
    area: [-4.4, 2.8, -1.7, 1.8],
    workers: [{ kind: "old_man", at: [-3.3, 0.25], yaw: HALF_PI, motion: "sit", seat: 0.45 }],
    reach: [0, 0],
  },
  {
    id: "nets",
    label: "the net menders",
    model: "tr_nets",
    x: -150.9,
    z: 67.3,
    yaw: -HALF_PI,
    boxes: [
      [-2.7, -2.5, -0.1, 0.1, 2.3],
      [-1.0, -0.8, -0.1, 0.1, 2.3],
      [0.7, 0.9, -0.1, 0.1, 2.3],
      [2.4, 2.6, -0.1, 0.1, 2.3],
      [-2.6, 2.5, -0.2, 0.3, 2.0], // the nets hanging
      [1.6, 2.2, 0.8, 1.4, 0.4], // the basket
    ],
    area: [-3.0, 3.6, -0.5, 1.9],
    workers: [
      { kind: "old_woman", at: [-1.7, 0.8], yaw: Math.PI, motion: "talk" },
      { kind: "fishwife_b", at: [1.5, 0.75], yaw: Math.PI, motion: "idle" },
    ],
    reach: [0, 1.4],
  },
];

/** Local (x, z) in a site's frame to world. */
function toWorld(s: { x: number; z: number; yaw: number }, lx: number, lz: number): P {
  const c = Math.cos(s.yaw);
  const n = Math.sin(s.yaw);
  // three.js turns by yaw about +y: x' = x cos + z sin, z' = -x sin + z cos
  return [s.x + lx * c + lz * n, s.z - lx * n + lz * c];
}

function worldBox(s: Site, b: [number, number, number, number], top?: number): Rect {
  const xs: number[] = [];
  const zs: number[] = [];
  for (const [lx, lz] of [[b[0], b[2]], [b[1], b[2]], [b[0], b[3]], [b[1], b[3]]]) {
    const [x, z] = toWorld(s, lx, lz);
    xs.push(x);
    zs.push(z);
  }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top };
}

/** Where the trades stand, for the props, the street life and the quay furniture to keep off (rijnkaai.ts). */
export function tradeKeepOut(): Rect[] {
  return SITES.map((s) => worldBox(s, s.area));
}

/** The solid things of every scene (known before the models load). */
function siteColliders(): Rect[] {
  const out: Rect[] = [];
  for (const s of SITES) for (const b of s.boxes) out.push(worldBox(s, [b[0], b[1], b[2], b[3]], b[4]));
  // the rope walk: every trestle, and the yarns (a low fence you cannot walk through)
  for (let i = 0; i < ROPE.posts; i++) {
    const x = ROPE.first + i * ROPE.step;
    out.push({ minX: x - 0.08, maxX: x + 0.08, minZ: ROPE.z - 0.38, maxZ: ROPE.z + 0.38, top: 1.15 });
  }
  out.push({ minX: ROPE.x0 + 1.1, maxX: ROPE.first + (ROPE.posts - 1) * ROPE.step, minZ: ROPE.z - 0.3, maxZ: ROPE.z + 0.3, top: 1.1 });
  return out;
}

// ------------------------------------------------------------------ the trades in the world

export interface TradesOptions {
  /** Game day (1-7, 7 Sunday) and hour with fraction: who is at work. */
  clock?: () => { day: number; hour: number };
}

export interface Trades {
  group: THREE.Group;
  /** Walk colliders; add them to the world (they are known at once). */
  colliders: Rect[];
  /** Once a frame. */
  update(t: number, dt: number, cam?: THREE.Camera, fogFar?: number): void;
  /** Resolves when the models are in (or failed). */
  ready: Promise<void>;
  /** Points a path must reach (main.ts paths()). */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }>;
  /** Dev: where each is, who is at work. */
  info(): Array<{ id: string; x: number; z: number; workers: number; shown: boolean }>;
}

interface Placed {
  site: Site;
  group: THREE.Group;
  people: Array<{ w: Worker; h: Human | null; root: THREE.Group; t: number; atAlt: boolean }>;
}

const working = (day: number, hour: number) => day % 7 !== 0 && hour >= 7 && hour < 18.5;

export function createTrades(scene: THREE.Scene, _flags: (x: number, z: number) => number | undefined, opts: TradesOptions = {}): Trades {
  const group = new THREE.Group();
  group.name = "trades";
  scene.add(group);
  const colliders = siteColliders();
  const placed: Placed[] = [];
  let models: TradeModels | null = null;
  let spin: THREE.Object3D | null = null;
  let yarns: THREE.InstancedMesh | null = null;
  let smoke: THREE.Points | null = null;
  const smokeSrc: THREE.Vector3[] = [];
  let humansReady = false;
  whenHumans(() => (humansReady = true));
  const clock = opts.clock ?? (() => ({ day: 1, hour: 10 }));

  const ready = loadTradeModels().then((m) => {
    models = m;
    if (!m) return;
    for (const s of SITES) {
      const g = new THREE.Group();
      g.name = `trade_${s.id}`;
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.yaw;
      const b = new Batch();
      b.put(m.parts.get(s.model), 0, 0, 0, 0);
      for (const [name, x, z, yaw] of s.extra ?? []) b.put(m.parts.get(name), x, 0, z, yaw);
      if (s.id === "ropewalk") {
        for (let i = 0; i < ROPE.posts; i++) b.put(m.parts.get("tr_rope_post"), ROPE.first + i * ROPE.step - ROPE.x0, 0, 0, 0);
      }
      b.build(g, s.id);
      group.add(g);
      // (the prop check, dev/propcheck.ts: the whole workplace as one thing)
      addPropObject("trades", g, undefined, g.name);
      const solidParts = partsOf(g).filter(p => p.mat === m.mats.solid);
      const exact = modelCollider(modelShape(g, () => solidParts.map(p => p.pos)), s.x, s.z, s.yaw);
      // Keep the original rectangles as stable references already registered by the world.
      const siteBounds = s.boxes.map(b => worldBox(s, [b[0], b[1], b[2], b[3]], b[4]));
      for (const rect of colliders) if (siteBounds.some(b => b.minX === rect.minX && b.maxX === rect.maxX && b.minZ === rect.minZ && b.maxZ === rect.maxZ)) {
        rect.surface = exact.surface;
      }

      for (const [x, y, z] of s.smoke ?? []) {
        const [wx, wz] = toWorld(s, x, z);
        smokeSrc.push(new THREE.Vector3(wx, y, wz));
      }
      placed.push({ site: s, group: g, people: s.workers.map((w) => ({ w, h: null, root: new THREE.Group(), t: Math.random() * 10, atAlt: false })) });
      if (s.id === "ropewalk") {
        // the wheel turns on its axle (along the scene's z), 1.2 m up
        const sp = new Batch();
        sp.put(m.parts.get("tr_rope_spin"), 0, 0, 0, 0);
        const holder = new THREE.Group();
        holder.position.set(0, 1.2, 0);
        sp.build(holder, "rope_spin");
        g.add(holder);
        spin = holder;
        // the yarns: thin boxes from the hooks over each trestle to the rope maker's hands
        const geo = new THREE.BoxGeometry(1, 0.06, 0.06).translate(0.5, 0, 0);
        const mat = psx(new THREE.MeshLambertMaterial({ color: 0xc8b484 }));
        yarns = new THREE.InstancedMesh(geo, mat, YARNS.length * (ROPE.posts + 1));
        yarns.count = 0;
        yarns.frustumCulled = false;
        g.add(yarns);
      }
    }
    // smoke from the forge chimney, the caulking pot and the cooper's fire: one point set
    if (smokeSrc.length) {
      const n = smokeSrc.length * 8;
      const pos = new Float32Array(n * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      smoke = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x8a8a88, map: puffTexture(), size: 0.7, transparent: true, opacity: 0.3, depthWrite: false }));
      smoke.frustumCulled = false;
      smoke.userData.age = Array.from({ length: n }, () => Math.random());
      scene.add(smoke);
    }
  });

  let ropeX = ROPE.walkFrom;
  let ropeBack = false;
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pv = new THREE.Vector3();

  function setYarns(to: number): void {
    if (!yarns) return;
    // local frame of the rope walk: x along the walk from the wheel
    const hookX = 1.06;
    const end = to - ROPE.x0;
    let k = 0;
    for (const yz of YARNS) {
      let px = hookX;
      let py = ROPE.hook;
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < ROPE.posts; i++) {
        const x = ROPE.first + i * ROPE.step - ROPE.x0;
        if (x >= end) break;
        pts.push([x, 1.13]);
      }
      pts.push([end, 1.0]);
      for (const [x, y] of pts) {
        const L = Math.hypot(x - px, y - py);
        if (L > 0.05) {
          q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.atan2(y - py, x - px));
          m4.compose(pv.set(px, py, yz * (1 - (px - hookX) / Math.max(1, end - hookX)) * 0.6 + yz * 0.4), q, sc.set(L, 1, 1));
          yarns.setMatrixAt(k++, m4);
        }
        px = x;
        py = y;
      }
    }
    yarns.count = k;
    yarns.instanceMatrix.needsUpdate = true;
  }

  function update(t: number, dt: number, cam?: THREE.Camera, fogFar = 60): void {
    if (!models || !cam) return;
    const { day, hour } = clock();
    const work = working(day, hour);
    const cx = cam.position.x;
    const cz = cam.position.z;
    // the forge and the fires: bright by day, banked at night
    models.mats.glow.color.setScalar(work ? 0.95 + 0.05 * Math.sin(t * 9) * Math.sin(t * 3.3) : 0.35);
    for (const p of placed) {
      const d = Math.hypot(p.site.x - cx, p.site.z - cz);
      const near = d < fogFar + 25 || (p.site.id === "ropewalk" && Math.abs(cz - ROPE.z) < fogFar + 20 && cx > ROPE.x0 - fogFar - 20 && cx < ROPE.x0 + 50 + fogFar);
      p.group.visible = near;
      // the workers are made within 70 m and let go beyond 85 (not made and dropped over and over at one distance)
      const staff = near && work && d < (p.people.some((w) => w.h) ? 85 : 70);
      for (const w of p.people) {
        if (staff && !w.h && humansReady) {
          w.h = makeHuman(w.w.kind);
          if (w.h) {
            w.root.add(w.h.root);
            p.group.add(w.root);
            place(w, w.w.at[0], w.w.at[1], w.w.yaw);
            w.h.play(w.w.motion, 0);
          }
        } else if (!staff && w.h) {
          w.h.dispose();
          w.h = null;
          w.root.removeFromParent();
        }
        if (!w.h) continue;
        w.t -= dt;
        if (p.site.id === "ropewalk" && w.w.kind === "sailor") continue; // the spinner: below
        if (w.w.alt && w.t <= 0) {
          // now and then to the other place (the farrier to the anvil, the caulker to his pot)
          w.atAlt = !w.atAlt;
          const [ax, az, ayaw, am, secs] = w.w.alt;
          if (w.atAlt) {
            place(w, ax, az, ayaw);
            w.h.play(am, 0.3);
            w.t = secs;
          } else {
            place(w, w.w.at[0], w.w.at[1], w.w.yaw);
            w.h.play(w.w.motion, 0.3);
            w.t = 14 + Math.random() * 12;
          }
        }
        if (d < 30 || Math.floor(t * 15) !== Math.floor((t - dt) * 15)) w.h.update(d < 30 ? dt : 1 / 15);
      }
      if (p.site.id === "ropewalk") rope(p, dt, staff);
    }
    if (smoke && work) {
      const pos = smoke.geometry.getAttribute("position") as THREE.BufferAttribute;
      const age = smoke.userData.age as number[];
      for (let i = 0; i < age.length; i++) {
        age[i] += dt * 0.25;
        if (age[i] > 1) age[i] -= 1;
        const s = smokeSrc[Math.floor(i / 8)];
        const a = age[i];
        pos.setXYZ(i, s.x + Math.sin(i * 7.1 + t * 0.3) * 0.3 * a + a * 0.8, s.y + a * 2.6, s.z + Math.cos(i * 3.7) * 0.3 * a);
      }
      pos.needsUpdate = true;
      smoke.visible = true;
    } else if (smoke) smoke.visible = false;
  }

  function place(w: Placed["people"][number], x: number, z: number, yaw: number): void {
    w.root.position.set(x, w.w.seat && w.h ? w.h.sitDrop(w.w.seat) : 0, z);
    w.root.rotation.y = yaw;
  }

  /** The rope maker walks backwards from the wheel paying out hemp; the boy turns the wheel; then he walks back. */
  function rope(p: Placed, dt: number, staff: boolean): void {
    const spinner = p.people.find((w) => w.w.kind === "sailor");
    const boy = p.people.find((w) => w.w.kind === "boy");
    if (!staff || !spinner?.h) {
      setYarns(ropeX);
      return;
    }
    if (!ropeBack) {
      ropeX += dt * 0.45;
      if (ropeX >= ROPE.walkTo) ropeBack = true;
      // facing the wheel, stepping backwards: the walk clip run backwards
      spinner.h.play("walk", 0.3);
      spinner.h.clipSpeed("walk", -0.4);
      place(spinner, ropeX - ROPE.x0, -0.35, -HALF_PI);
      if (spin) spin.rotation.z -= dt * 2.4;
      boy?.h?.play("carry", 0.3);
      setYarns(ropeX);
    } else {
      // the yarn is laid up: back to the wheel for the next
      ropeX -= dt * 1.2;
      spinner.h.play("walk", 0.3);
      spinner.h.clipSpeed("walk", 1.0);
      place(spinner, ropeX - ROPE.x0, -0.9, -HALF_PI);
      boy?.h?.play("idle", 0.3);
      if (ropeX <= ROPE.walkFrom) {
        ropeBack = false;
        ropeX = ROPE.walkFrom;
      }
      setYarns(ROPE.walkTo);
    }
  }

  return {
    group,
    colliders,
    update,
    ready: ready.then(() => {}),
    pathPoints: () => SITES.map((s) => {
      const [x, z] = toWorld(s, s.reach[0], s.reach[1]);
      return { label: s.label, x, z, reach: 2.2 };
    }),
    info: () => placed.map((p) => ({ id: p.site.id, x: p.site.x, z: p.site.z, workers: p.people.filter((w) => w.h).length, shown: p.group.visible })),
  };
}

/** A soft round puff for the smoke (a square point would show as a grey box). */
function puffTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.35)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Sound emitters for the soundscape (audio/emitters.ts): the forge rings, the cooper's and the caulker's mallets. */
export const TRADE_SOUNDS: Array<{ kind: "smithy" | "cooper"; x: number; z: number; gain: number; name: string }> = [
  { kind: "smithy", x: 162.8, z: 22.4, gain: 1, name: "farrier, Eilandje" },
  { kind: "cooper", x: -89.8, z: 126, gain: 1, name: "cooper, Canal des Brasseurs" },
  { kind: "cooper", x: -66.5, z: 169, gain: 0.55, name: "boat repair yard, the canal" },
];
