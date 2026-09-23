import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";

// Street and quay props from Blender (tools/blender/build_props.py ->
// /models/props.glb): carts, a dray and its horse, barrows, crates, casks,
// sacks, rope, bollards, a gas lamp, a hand crane. Our own models, made by
// script. Each prop stands on the ground at its origin; its front (shafts,
// handles, jib) looks along local +z. This module loads them once, gives them
// PS1 materials, places copies, and dresses the city with a few of them.

/** Single models in props.glb. */
export const PROP_NAMES = [
  "handcart",
  "handcart_loaded",
  "dray",
  "dray_hitched",
  "horse",
  "wheelbarrow",
  "sack_truck",
  "crate",
  "crate_small",
  "barrel",
  "barrel_lying",
  "sack",
  "sack_standing",
  "sack_pile",
  "rope_coil",
  "bollard",
  "gas_lamp",
  "crane",
] as const;

/** Groups of models placed as one: [model, x, y, z, yaw] in the group's frame. */
const SETS: Record<string, Array<[string, number, number, number, number]>> = {
  // the horse stands between the raised shafts (build_props.py DRAY_HORSE_Y)
  dray_horse: [
    ["dray_hitched", 0, 0, 0, 0],
    ["horse", 0, 0, 3.2, 0],
  ],
  dray_barrels: [
    ["dray", 0, 0, 0, 0],
    ["barrel_lying", 0, 1.05, -1.45, 0],
    ["barrel_lying", 0.03, 1.05, -0.75, 0.04],
    ["barrel_lying", -0.02, 1.05, -0.05, -0.03],
    ["barrel_lying", 0.02, 1.05, 0.65, 0.02],
  ],
  barrels_3: [
    ["barrel", 0, 0, 0, 0],
    ["barrel", 0.68, 0, 0.04, 1.1],
    ["barrel", 0.33, 0, 0.62, 2.3],
  ],
  barrels_row: [
    ["barrel_lying", 0, 0, 0, 0],
    ["barrel_lying", 0.02, 0, 0.72, 0.05],
    ["barrel_lying", -0.02, 0, 1.44, -0.04],
  ],
  crates_3: [
    ["crate", 0, 0, 0, 0.03],
    ["crate", 1.05, 0, 0.04, -0.05],
    ["crate_small", 0.5, 1.0, 0.02, 0.25],
  ],
  crates_sacks: [
    ["crate", 0, 0, 0, 0],
    ["sack_standing", 0.85, 0, 0.1, 0.4],
    ["sack_standing", 1.35, 0, -0.05, 2.0],
    ["crate_small", 0.02, 1.0, 0.0, -0.15],
  ],
  handcart_barrel: [
    ["handcart", 0, 0, 0, 0],
    ["barrel", 0, 0.8, -0.1, 0.5],
  ],
};

export type PropName = (typeof PROP_NAMES)[number] | keyof typeof SETS;

/** Footprint in the prop's own frame (x across, z along its front), and height. */
export interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface Props {
  /** Every name `place` knows: single models and groups. */
  names: string[];
  /**
   * A copy of a prop standing on the ground at (x, z), turned by `yaw` about +y
   * (0 = its front looks along +z). Added to `parent` if given. Geometry and
   * materials are shared; a gas lamp gets its own glass material to light.
   */
  place(name: string, x: number, z: number, yaw: number, parent?: THREE.Object3D): THREE.Object3D;
  /** Footprint of a prop (parts under 1.5 m, so a crane's jib does not count). */
  footprint(name: string): Footprint;
  /** Walk colliders for a prop placed at (x, z, yaw): a few boxes along its length. */
  colliders(name: string, x: number, z: number, yaw: number): Rect[];
  /** The PS1 materials by name: wood, wood_dark, iron, rope, sackcloth, crate, barrel, stone, glass, horse, horsehair, leather. */
  materials: Record<string, THREE.Material>;
  /** Front doors of the city's houses as x, z pairs (from the city build, carried in props.glb). */
  houseDoors: number[];
}

let loading: Promise<Props> | null = null;

/** Load props.glb once; later calls get the same promise. */
export function loadProps(): Promise<Props> {
  if (!loading) loading = load();
  return loading;
}

async function load(): Promise<Props> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/props.glb");
  draco.dispose();

  const materials: Record<string, THREE.Material> = {};
  const swap = (src: THREE.Material): THREE.Material => {
    const name = src.name || "wood";
    if (materials[name]) return materials[name];
    const map = (src as THREE.MeshStandardMaterial).map ?? null;
    if (map) {
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.generateMipmaps = false;
      map.colorSpace = THREE.SRGBColorSpace;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
    }
    const mat =
      name === "glass"
        ? new THREE.MeshBasicMaterial({ map, color: 0xffc070, fog: false })
        : psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }), { affine: 0.6 });
    mat.name = name;
    materials[name] = mat;
    return mat;
  };

  const protos = new Map<string, THREE.Object3D>();
  let houseDoors: number[] = [];
  for (const node of [...gltf.scene.children]) {
    if (node.name === "house_doors") {
      houseDoors = JSON.parse((node.userData.doors as string | undefined) ?? "[]");
      node.removeFromParent();
      continue;
    }
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      m.geometry.computeBoundingSphere();
    });
    node.removeFromParent();
    node.position.set(0, 0, 0);
    node.rotation.set(0, 0, 0);
    node.updateMatrixWorld(true);
    protos.set(node.name, node);
  }
  for (const [name, parts] of Object.entries(SETS)) {
    const g = new THREE.Group();
    g.name = name;
    for (const [part, x, y, z, yaw] of parts) {
      const p = protos.get(part);
      if (!p) continue;
      const c = p.clone();
      c.position.set(x, y, z);
      c.rotation.y = yaw;
      g.add(c);
    }
    g.updateMatrixWorld(true);
    protos.set(name, g);
  }

  const feet = new Map<string, Footprint>();
  const v = new THREE.Vector3();
  function footprint(name: string): Footprint {
    let f = feet.get(name);
    if (f) return f;
    const src = protos.get(name);
    if (!src) throw new Error(`no prop ${name}`);
    f = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0 };
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        f!.height = Math.max(f!.height, v.y);
        if (v.y > 1.5) continue;
        f!.minX = Math.min(f!.minX, v.x);
        f!.maxX = Math.max(f!.maxX, v.x);
        f!.minZ = Math.min(f!.minZ, v.z);
        f!.maxZ = Math.max(f!.maxZ, v.z);
      }
    });
    feet.set(name, f);
    return f;
  }

  function place(name: string, x: number, z: number, yaw: number, parent?: THREE.Object3D): THREE.Object3D {
    const src = protos.get(name);
    if (!src) throw new Error(`no prop ${name}`);
    const o = src.clone();
    o.name = name;
    o.position.set(x, 0, z);
    o.rotation.y = yaw;
    if (name === "gas_lamp") {
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && (m.material as THREE.Material).name === "glass") m.material = (m.material as THREE.Material).clone();
      });
    }
    parent?.add(o);
    return o;
  }

  function colliders(name: string, x: number, z: number, yaw: number): Rect[] {
    const f = footprint(name);
    const w = f.maxX - f.minX;
    const d = f.maxZ - f.minZ;
    const along = d >= w; // split along the long side into near-square boxes
    const long = along ? d : w;
    const short = along ? w : d;
    const n = Math.max(1, Math.round(long / Math.max(short, 0.6)));
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const top = f.height;
    const out: Rect[] = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const lx = along ? (f.minX + f.maxX) / 2 : f.minX + w * t;
      const lz = along ? f.minZ + d * t : (f.minZ + f.maxZ) / 2;
      const hx = along ? w / 2 : w / n / 2;
      const hz = along ? d / n / 2 : d / 2;
      // local -> world: rotation about +y by yaw
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ex = hx * Math.abs(c) + hz * Math.abs(s);
      const ez = hx * Math.abs(s) + hz * Math.abs(c);
      out.push({ minX: wx - ex, maxX: wx + ex, minZ: wz - ez, maxZ: wz + ez, top });
    }
    return out;
  }

  return { names: [...protos.keys()], place, footprint, colliders, materials, houseDoors };
}

// ------------------------------------------------------------------ dressing the city

type Flags = (x: number, z: number) => number | undefined;

export interface DressOptions {
  /** Seed for the layout; the same seed gives the same city every load. */
  seed?: number;
  /** Extra circles to keep clear (job places, people). Doors, spots.json and the board are always kept clear. */
  keepClear?: Array<{ x: number; z: number; r: number }>;
  /** Boxes to leave alone. Default: the Rijnkaai by the start (the game's own quay things) and the lock bridge. */
  keepOut?: Rect[];
  /** Most things along the quays and on the squares. */
  maxQuay?: number;
  maxSquare?: number;
}

export interface Dressing {
  group: THREE.Group;
  /** Walk colliders for everything placed; add them to the world. */
  colliders: Rect[];
  placed: Array<{ name: string; x: number; z: number; yaw: number }>;
}

interface CityData {
  quays: number[][];
  doors: Record<string, { x: number; z: number; out: [number, number]; width: number }>;
  landmarks: Record<string, { frame?: { c: [number, number]; n: [number, number]; W: number; open: number } }>;
  bridges: Record<string, number[]>;
}

const OPEN = 0;
const WALL = 1;
const WATER = 2;
/** Free ground to leave in front of anything we put down (metres). */
const PASSAGE = 3.0;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, table: Array<[T, number]>): T {
  let sum = 0;
  for (const [, w] of table) sum += w;
  let x = r() * sum;
  for (const [v, w] of table) if ((x -= w) <= 0) return v;
  return table[table.length - 1][0];
}

const QUAY_GOODS: Array<[string, number]> = [
  ["handcart", 3],
  ["handcart_loaded", 3],
  ["sack_pile", 3],
  ["barrels_3", 2],
  ["barrels_row", 2],
  ["crates_3", 2],
  ["crates_sacks", 2],
  ["dray", 1],
  ["dray_barrels", 1.5],
  ["dray_horse", 1],
  ["rope_coil", 1],
  ["wheelbarrow", 1],
  ["handcart_barrel", 1],
];
const SQUARE_GOODS: Array<[string, number]> = [
  ["handcart", 3],
  ["handcart_loaded", 2],
  ["wheelbarrow", 2],
  ["sack_truck", 1.5],
  ["barrels_3", 1.5],
  ["crates_sacks", 1.5],
  ["dray_horse", 1.5],
  ["sack_pile", 1],
];

/**
 * Put carts, casks, crates and sacks along the quays and on the squares round
 * the landmarks. Needs the walk map (await city.ready first). Things stand
 * with their back to a house wall or the water, never in either, and leave at
 * least 3 m of open ground in front (6 m on the squares), clear of doors and
 * job places. Placed once, merged per 50 m and material; parts beyond the fog
 * are hidden. Add the returned colliders to the world so you cannot walk
 * through them.
 */
export async function dressCity(scene: THREE.Scene, flags: Flags, opts: DressOptions = {}): Promise<Dressing> {
  const props = await loadProps();
  const city = CITY as unknown as CityData;
  const r = rng(opts.seed ?? 1873);

  const clear: Array<{ x: number; z: number; r: number }> = [...(opts.keepClear ?? [])];
  for (const d of Object.values(city.doors)) {
    clear.push({ x: d.x + d.out[0] * 2, z: d.z + d.out[1] * 2, r: d.width / 2 + 3.5 });
  }
  for (const [k, s] of Object.entries(SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>)) {
    if (!k.startsWith("_") && s.x !== undefined && s.z !== undefined) clear.push({ x: s.x, z: s.z, r: 4.5 });
  }
  {
    // the hiring board by the Hessenatie door (rijnkaai.ts BOARD_POS)
    const h = city.doors.hessenatie;
    if (h) clear.push({ x: h.x + h.out[0] * 3.2 - h.out[1] * 5, z: h.z + h.out[1] * 3.2 + h.out[0] * 5, r: 3.5 });
  }
  const keepOut: Rect[] = opts.keepOut ?? [{ minX: -72, maxX: 66, minZ: -30, maxZ: 27 }];
  if (!opts.keepOut) {
    for (const b of Object.values(city.bridges)) {
      keepOut.push({ minX: Math.min(b[0], b[2]) - 4, maxX: Math.max(b[0], b[2]) + 4, minZ: Math.min(b[1], b[3]) - 4, maxZ: Math.max(b[1], b[3]) + 4 });
    }
  }

  const at = (x: number, z: number) => flags(x, z) ?? -1;

  // house doors in 10 m buckets: nothing stands in a doorway
  const doorGrid = new Map<string, Array<[number, number]>>();
  for (let i = 0; i + 1 < props.houseDoors.length; i += 2) {
    const x = props.houseDoors[i];
    const z = props.houseDoors[i + 1];
    const k = `${Math.floor(x / 10)},${Math.floor(z / 10)}`;
    let b = doorGrid.get(k);
    if (!b) doorGrid.set(k, (b = []));
    b.push([x, z]);
  }
  /** Is a house door within `pad` metres of the box (centre, long axis t, half sizes)? */
  function nearDoor(cx: number, cz: number, tx: number, tz: number, hl: number, hs: number, pad: number): boolean {
    const gx = Math.floor(cx / 10);
    const gz = Math.floor(cz / 10);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gz - 1; j <= gz + 1; j++)
        for (const [x, z] of doorGrid.get(`${i},${j}`) ?? []) {
          const a = (x - cx) * tx + (z - cz) * tz;
          const b = -(x - cx) * tz + (z - cz) * tx;
          if (Math.hypot(Math.max(0, Math.abs(a) - hl), Math.max(0, Math.abs(b) - hs)) < pad) return true;
        }
    return false;
  }

  // occupancy on a 0.5 m grid: 1 = a thing stands here, 2 = keep open (passage)
  const occ = new Map<number, number>();
  const key = (i: number, j: number) => (i + 8192) * 16384 + (j + 8192);

  /** Cells of an oriented box: centre (cx, cz), unit axis t (long), n (short), half sizes. */
  function cells(cx: number, cz: number, tx: number, tz: number, hl: number, hs: number, fn: (x: number, z: number, i: number, j: number) => boolean | void): boolean {
    const ex = Math.abs(tx) * hl + Math.abs(tz) * hs;
    const ez = Math.abs(tz) * hl + Math.abs(tx) * hs;
    const i0 = Math.floor((cx - ex) / 0.5);
    const i1 = Math.ceil((cx + ex) / 0.5);
    const j0 = Math.floor((cz - ez) / 0.5);
    const j1 = Math.ceil((cz + ez) / 0.5);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const x = i * 0.5 + 0.25;
        const z = j * 0.5 + 0.25;
        const dx = x - cx;
        const dz = z - cz;
        const a = dx * tx + dz * tz;
        const b = -dx * tz + dz * tx;
        if (Math.abs(a) > hl || Math.abs(b) > hs) continue;
        if (fn(x, z, i, j) === false) return false;
      }
    return true;
  }

  /**
   * The wall (or water edge) nearest to a point, as a line: from the hits of
   * rays around the point, a least-squares line. Returns the foot point on the
   * line and the normal pointing back to open ground.
   */
  function edgeNear(px: number, pz: number, want: number): { x: number; z: number; nx: number; nz: number; d: number } | null {
    const N = 48;
    const hits: Array<[number, number, number, number]> = [];
    let best = -1;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (let s = 0.2; s <= 5; s += 0.2) {
        const f = at(px + dx * s, pz + dz * s);
        if (f === OPEN) continue;
        if (f > 0 && f & want && !(f & (want === WALL ? WATER : 0))) {
          hits.push([px + dx * s, pz + dz * s, s, a]);
          if (best < 0 || s < hits[best][2]) best = hits.length - 1;
        }
        break;
      }
    }
    if (best < 0) return null;
    const [, , d0, a0] = hits[best];
    const near = hits.filter(([, , s, a]) => {
      let da = Math.abs(a - a0);
      if (da > Math.PI) da = 2 * Math.PI - da;
      return da < 1.0 && s < d0 * 2 + 1;
    });
    if (near.length < 4) return null;
    let mx = 0;
    let mz = 0;
    for (const [x, z] of near) {
      mx += x;
      mz += z;
    }
    mx /= near.length;
    mz /= near.length;
    let sxx = 0;
    let sxz = 0;
    let szz = 0;
    for (const [x, z] of near) {
      sxx += (x - mx) * (x - mx);
      sxz += (x - mx) * (z - mz);
      szz += (z - mz) * (z - mz);
    }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
    const tx = Math.cos(ang);
    const tz = Math.sin(ang);
    let nx = -tz;
    let nz = tx;
    const dp = (px - mx) * nx + (pz - mz) * nz;
    if (dp < 0) {
      nx = -nx;
      nz = -nz;
    }
    const d = Math.abs(dp);
    return { x: px - nx * d, z: pz - nz * d, nx, nz, d };
  }

  const placed: Dressing["placed"] = [];
  const all: THREE.Object3D[] = [];
  const colliders: Rect[] = [];
  const spots: Array<[number, number]> = [];

  /** Try to stand `name` against the edge near (px, pz). */
  function tryPlace(name: string, px: number, pz: number, want: number, gap: number, deep: number, spacing: number): boolean {
    const e = edgeNear(px, pz, want);
    if (!e) return false;
    const f = props.footprint(name);
    const w = f.maxX - f.minX;
    const d = f.maxZ - f.minZ;
    const hl = Math.max(w, d) / 2;
    const hs = Math.min(w, d) / 2;
    const tx = -e.nz;
    const tz = e.nx;
    const cx = e.x + e.nx * (gap + hs);
    const cz = e.z + e.nz * (gap + hs);
    for (const [sx, sz] of spots) if (Math.hypot(sx - cx, sz - cz) < spacing) return false;
    for (const c of clear) if (Math.hypot(c.x - cx, c.z - cz) < c.r + hl) return false;
    for (const k of keepOut) if (cx > k.minX - hl && cx < k.maxX + hl && cz > k.minZ - hl && cz < k.maxZ + hl) return false;
    if (nearDoor(cx, cz, tx, tz, hl, hs + gap, 1.6)) return false;
    // stands on open ground, clear of other things and their passages
    if (!cells(cx, cz, tx, tz, hl + 0.15, hs + 0.15, (x, z, i, j) => at(x, z) === OPEN && !occ.has(key(i, j)))) return false;
    // the wall or water runs behind it along its whole length
    for (let a = -hl; a <= hl + 1e-6; a += Math.max(0.3, hl / 4)) {
      const bx = cx + tx * a - e.nx * (hs + gap + 0.45);
      const bz = cz + tz * a - e.nz * (hs + gap + 0.45);
      const fb = at(bx, bz);
      if (fb <= 0 || !(fb & want)) return false;
    }
    // open ground in front, `deep` metres, a bit wider than the thing
    const fx = cx + e.nx * (hs + deep / 2 + 0.05);
    const fz = cz + e.nz * (hs + deep / 2 + 0.05);
    if (!cells(fx, fz, tx, tz, hl + 0.6, deep / 2, (x, z, i, j) => at(x, z) === OPEN && occ.get(key(i, j)) !== 1)) return false;
    for (const k of keepOut) if (fx > k.minX && fx < k.maxX && fz > k.minZ && fz < k.maxZ) return false;
    // yaw: the long side along the edge; the front one way or the other
    const along = d >= w;
    const flip = r() < 0.5 ? 1 : -1;
    // local axis a (the long one) must map to t: yaw so that local +z (or +x) = +-t
    const yaw = along ? Math.atan2(tx * flip, tz * flip) : Math.atan2(tx * flip, tz * flip) - Math.PI / 2;
    // the origin sits off the footprint centre by the footprint's own offset
    const ox = (f.minX + f.maxX) / 2;
    const oz = (f.minZ + f.maxZ) / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const x = cx - (ox * c + oz * s);
    const z = cz - (-ox * s + oz * c);
    cells(cx, cz, tx, tz, hl + 0.3, hs + 0.3, (_x, _z, i, j) => void occ.set(key(i, j), 1));
    cells(fx, fz, tx, tz, hl + 0.3, deep / 2, (_x, _z, i, j) => {
      if (!occ.has(key(i, j))) occ.set(key(i, j), 2);
    });
    all.push(props.place(name, x, z, yaw));
    colliders.push(...props.colliders(name, x, z, yaw));
    placed.push({ name, x, z, yaw });
    spots.push([cx, cz]);
    return true;
  }

  // --- along the quays: points along every water edge, nearest the Rijnkaai first
  {
    const cand: Array<[number, number, number]> = [];
    for (const [ax, az, bx, bz] of city.quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1) continue;
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      for (let t = r() * 6; t < L; t += 6) {
        const x = ax + ((bx - ax) * t) / L;
        const z = az + ((bz - az) * t) / L;
        let side = 0;
        if (at(x + nx * 2.5, z + nz * 2.5) === OPEN) side = 1;
        else if (at(x - nx * 2.5, z - nz * 2.5) === OPEN) side = -1;
        if (!side) continue;
        const score = r() * (1 + Math.hypot(x + 250, z - 60) / 350);
        cand.push([x + nx * side * 2.5, z + nz * side * 2.5, score]);
      }
    }
    cand.sort((a, b) => a[2] - b[2]);
    const max = opts.maxQuay ?? 48;
    let n = 0;
    // long things need a long straight edge: try them first until a few stand
    const big: Record<string, number> = { dray_horse: 3, dray_barrels: 2 };
    for (const [x, z] of cand) {
      if (n >= max) break;
      const want = Object.keys(big).find((k) => big[k] > 0);
      if (want && tryPlace(want, x, z, WATER, 0.7, PASSAGE, 16)) {
        big[want]--;
        n++;
        continue;
      }
      const name = pick(r, QUAY_GOODS);
      if (tryPlace(name, x, z, WATER, 0.7, PASSAGE, 16) || tryPlace("handcart", x, z, WATER, 0.7, PASSAGE, 16)) n++;
    }
  }

  // --- on the squares round the landmarks: against the house fronts
  {
    const max = opts.maxSquare ?? 4;
    for (const lm of Object.values(city.landmarks)) {
      const fr = lm.frame;
      if (!fr) continue;
      const sx = fr.c[0] + fr.n[0] * fr.open * (fr.W / 2 + 22);
      const sz = fr.c[1] + fr.n[1] * fr.open * (fr.W / 2 + 22);
      let n = 0;
      for (let k = 0; k < 160 && n < max; k++) {
        const a = r() * Math.PI * 2;
        const rad = 6 + r() * 40;
        const x = sx + Math.cos(a) * rad;
        const z = sz + Math.sin(a) * rad;
        if (at(x, z) !== OPEN) continue;
        const e = edgeNear(x, z, WALL);
        if (!e || e.d > 4) continue;
        if (tryPlace(pick(r, SQUARE_GOODS), x, z, WALL, 0.12, 6, 9)) n++;
      }
    }
  }

  // --- merge per 50 m chunk and material: few draw calls, hidden beyond the fog
  const group = new THREE.Group();
  group.name = "props_dressing";
  const buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
  for (const o of all) {
    o.updateMatrixWorld(true);
    const ck = `${Math.floor(o.position.x / 50)},${Math.floor(o.position.z / 50)}`;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const a of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color"].includes(a)) g.deleteAttribute(a);
      const k = `${ck}|${mat.uuid}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { mat, geos: [] }));
      b.geos.push(g);
    });
  }
  const chunks: THREE.Mesh[] = [];
  for (const { mat, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (merged) {
      for (const g of geos) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      group.add(mesh);
      chunks.push(mesh);
    } else {
      for (const g of geos) {
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, mat);
        group.add(mesh);
        chunks.push(mesh);
      }
    }
  }
  // An empty mesh that is always drawn: before each render it hides the chunks beyond the fog.
  const sentinel = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  sentinel.frustumCulled = false;
  sentinel.onBeforeRender = (_r, sc, cam) => {
    const far = ((sc.fog as THREE.Fog | null)?.far ?? 60) + 10;
    const p = cam.position;
    for (const m of chunks) {
      const s = m.geometry.boundingSphere!;
      m.visible = s.center.distanceTo(p) - s.radius < far;
    }
  };
  group.add(sentinel);
  scene.add(group);
  return { group, colliders, placed };
}
