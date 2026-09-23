import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { WATER_Y } from "./rijnkaai";
import type { Rect } from "./geom";

// Boats, ships and quay cranes from Blender (tools/blender/build_boats.py ->
// /models/boats.glb). Our own models, made by script. A vessel's origin is the
// middle of its waterline and its bow looks along local +z; a crane stands on
// the quay at its origin with its jib toward local +z at rest. This module loads
// them once, gives them PS1 materials, floats the boats on the water (a gentle
// heave and roll, each on its own beat), swings the cranes now and then, lays
// pontoon walkways and lines quay edges with moored boats.
//
// WATER_Y is only read inside functions: rijnkaai.ts may import this module.

/** Every model in boats.glb. */
export const BOAT_NAMES = [
  "barque",
  "steamer",
  "rhine_barge",
  "hengst",
  "lighter",
  "lighter_loaded",
  "tug",
  "paddle_tug",
  "sloop",
  "rowboat",
  "punt",
  "pontoon_section",
  "portal_crane",
  "hand_crane",
] as const;
export type BoatName = (typeof BOAT_NAMES)[number];
export type CraneKind = "portal_crane" | "hand_crane";

/** Vessels that float (everything but the cranes). */
export const VESSELS: BoatName[] = BOAT_NAMES.filter((n) => n !== "portal_crane" && n !== "hand_crane");

/** A floor you can walk on: a box on the ground plan at height y. */
export interface WalkRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

/** Size of a model in its own frame: length along z (bow to stern, bowsprit included), beam along x. */
export interface Dims {
  length: number;
  beam: number;
  height: number;
}

export interface MooreOptions {
  /** Metres between the quay line and the first row of hulls (fenders). Default 0.4. */
  gap?: number;
  /** Free water between boats in a row, min and max metres. Default [0.8, 4]. */
  spacing?: [number, number];
  /** Leave this much of the line free at each end. Default 2. */
  margin?: number;
  /** Boats moored side by side, rows out from the quay. Default 1. */
  rows?: number;
  /** Skip kinds wider than this (an 8 m canal wants narrow boats). Default no limit. */
  maxBeam?: number;
  /** Same seed, same boats. Default 1873. */
  seed?: number;
  /** Heave and roll on the water. Default true. */
  bob?: boolean;
}

export interface Moored {
  group: THREE.Group;
  placed: Array<{ name: BoatName; x: number; z: number; yaw: number }>;
}

export interface PontoonOptions {
  /** Moor boats along both sides of the walkway. Default true. */
  barges?: boolean;
  /** Kinds to moor alongside. Default rhine_barge, lighter_loaded, hengst, lighter. */
  kinds?: BoatName[];
  /** Leave this much free water next to the quay wall before the first barge. Default 3. */
  start?: number;
  seed?: number;
}

export interface Boats {
  names: BoatName[];
  dims(name: BoatName): Dims;
  /**
   * A copy of a model at (x, z), turned by `yaw` about +y (0 = bow along +z). Vessels float
   * at WATER_Y and bob; cranes stand at y = 0 and keep still (use crane() for one that swings).
   */
  place(name: BoatName, x: number, z: number, yaw: number, parent?: THREE.Object3D): THREE.Object3D;
  /** A crane on the quay at (x, z) whose jib (and cabin) slowly swings now and then. Rest yaw: jib along +z. */
  crane(x: number, z: number, yaw: number, parent?: THREE.Object3D, kind?: CraneKind): THREE.Object3D;
  /** Walk colliders for a crane's legs (portal) or stone base (hand crane) placed at (x, z, yaw). */
  colliders(name: CraneKind, x: number, z: number, yaw: number): Rect[];
  /**
   * A floating walkway from the quay edge at z0 straight out to z1 at x, made of 10 m
   * pontoon sections (deck level with the quay), with barges moored along both sides.
   * Returns the walkable deck between the railings.
   */
  pontoon(scene: THREE.Object3D, x: number, z0: number, z1: number, opts?: PontoonOptions): WalkRect[];
  /**
   * Line a quay edge with moored boats: along the line (x0, z0) -> (x1, z1), boats lie on
   * side +1 = toward (-dz, dx) (for a line along +x that is the +z side), -1 = the other
   * side; or give a point in the water. Kinds are picked at random (repeat a name to make it
   * likelier). One InstancedMesh per model part and material: a whole quay costs a few
   * draw calls per kind.
   */
  mooreAlong(
    scene: THREE.Object3D,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    side: 1 | -1 | { x: number; z: number },
    kinds: BoatName[],
    opts?: MooreOptions,
  ): Moored;
  /** Bob the boats, swing the cranes. Call every frame with the game time. */
  update(t: number, dt: number): void;
  /** The PS1 materials by name. */
  materials: Record<string, THREE.Material>;
}

/** Heave (m), roll and pitch (rad), period (s): small boats move more and faster. */
const MOTION: Record<string, [number, number, number, number]> = {
  barque: [0.03, 0.006, 0.002, 8.5],
  steamer: [0.03, 0.005, 0.002, 8.0],
  rhine_barge: [0.025, 0.006, 0.002, 7.0],
  hengst: [0.03, 0.01, 0.004, 6.0],
  lighter: [0.03, 0.012, 0.005, 5.5],
  lighter_loaded: [0.025, 0.009, 0.004, 6.0],
  tug: [0.035, 0.015, 0.006, 4.5],
  paddle_tug: [0.035, 0.014, 0.006, 4.6],
  sloop: [0.04, 0.02, 0.008, 4.0],
  rowboat: [0.05, 0.035, 0.015, 3.0],
  punt: [0.045, 0.03, 0.012, 3.2],
  pontoon_section: [0.008, 0.002, 0.001, 7.0],
};

const DOUBLE = new Set(["shrouds", "lattice", "flag", "canvas", "canvas_tan", "tarp"]);
const CUTOUT = new Set(["shrouds", "lattice"]);
const JIB_NODES = ["jib", "hand_crane_jib"];

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

interface Float {
  inner: THREE.Object3D;
  m: [number, number, number, number];
  p: [number, number, number];
}

interface Swing {
  jib: THREE.Object3D;
  cur: number;
  target: number;
  wait: number;
  range: number;
  speed: number;
  r: () => number;
}

interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrix: THREE.Matrix4;
}

interface Fleet {
  meshes: THREE.InstancedMesh[];
  parts: Part[];
  boats: Array<{ x: number; z: number; yaw: number; m: [number, number, number, number]; p: [number, number, number] }>;
}

let loading: Promise<Boats> | null = null;

/** Load boats.glb once; later calls get the same promise. */
export function loadBoats(): Promise<Boats> {
  if (!loading) loading = load();
  return loading;
}

async function load(): Promise<Boats> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/boats.glb");
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
    const mat = psx(
      new THREE.MeshLambertMaterial({
        map,
        vertexColors: true,
        side: DOUBLE.has(name) ? THREE.DoubleSide : THREE.FrontSide,
        alphaTest: CUTOUT.has(name) ? 0.5 : 0,
      }),
      { affine: 0.6 },
    );
    mat.name = name;
    materials[name] = mat;
    src.dispose();
    return mat;
  };

  const protos = new Map<BoatName, THREE.Object3D>();
  const extras = new Map<BoatName, Record<string, unknown>>();
  for (const node of [...gltf.scene.children]) {
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
    protos.set(node.name as BoatName, node);
    extras.set(node.name as BoatName, node.userData ?? {});
  }
  const proto = (name: BoatName): THREE.Object3D => {
    const p = protos.get(name);
    if (!p) throw new Error(`no boat ${name}`);
    return p;
  };

  const dimCache = new Map<BoatName, Dims>();
  function dims(name: BoatName): Dims {
    let d = dimCache.get(name);
    if (!d) {
      // the hull's footprint: parts below 2.4 m (yards, bowsprits and booms up high do not count)
      const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
      const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
      let top = 0;
      const v = new THREE.Vector3();
      const root = proto(name);
      root.updateMatrixWorld(true);
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const pos = m.geometry.getAttribute("position");
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
          top = Math.max(top, v.y);
          if (v.y > 2.4) continue;
          lo.min(v);
          hi.max(v);
        }
      });
      d = { length: hi.z - lo.z, beam: hi.x - lo.x, height: top };
      dimCache.set(name, d);
    }
    return d;
  }

  // parts of a model for instancing: geometry, material and matrix relative to the model root
  const partCache = new Map<BoatName, Part[]>();
  function parts(name: BoatName): Part[] {
    let ps = partCache.get(name);
    if (ps) return ps;
    ps = [];
    const root = proto(name);
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      ps!.push({ geometry: m.geometry, material: m.material as THREE.Material, matrix: m.matrixWorld.clone() });
    });
    partCache.set(name, ps);
    return ps;
  }

  const floats: Float[] = [];
  const swings: Swing[] = [];
  const fleets: Fleet[] = [];
  const motionRand = rng(7);
  const phases = (): [number, number, number] => [
    motionRand() * Math.PI * 2,
    motionRand() * Math.PI * 2,
    motionRand() * Math.PI * 2,
  ];

  function isCrane(name: BoatName): name is CraneKind {
    return name === "portal_crane" || name === "hand_crane";
  }

  function place(name: BoatName, x: number, z: number, yaw: number, parent?: THREE.Object3D): THREE.Object3D {
    const inner = proto(name).clone();
    if (isCrane(name)) {
      inner.name = name;
      inner.position.set(x, 0, z);
      inner.rotation.y = yaw;
      parent?.add(inner);
      return inner;
    }
    const outer = new THREE.Group();
    outer.name = name;
    outer.position.set(x, WATER_Y, z);
    outer.rotation.y = yaw;
    outer.add(inner);
    floats.push({ inner, m: MOTION[name] ?? MOTION.lighter, p: phases() });
    parent?.add(outer);
    return outer;
  }

  function crane(x: number, z: number, yaw: number, parent?: THREE.Object3D, kind: CraneKind = "portal_crane"): THREE.Object3D {
    const o = place(kind, x, z, yaw, parent);
    let jib: THREE.Object3D | undefined;
    o.traverse((c) => {
      if (!jib && JIB_NODES.includes(c.name)) jib = c;
    });
    if (jib) {
      const r = rng(Math.floor((x * 73856093) ^ (z * 19349663)) >>> 0);
      swings.push({
        jib,
        cur: 0,
        target: 0,
        wait: 2 + r() * 8,
        range: kind === "portal_crane" ? 1.3 : 1.0,
        speed: kind === "portal_crane" ? 0.16 : 0.24,
        r,
      });
    }
    return o;
  }

  /** Local boxes [cx, cz, halfX, halfZ] that block walking, in the crane's own frame. */
  const CRANE_FEET: Record<CraneKind, Array<[number, number, number, number]>> = {
    portal_crane: [
      [2.2, 2.6, 0.75, 0.3],
      [-2.2, 2.6, 0.75, 0.3],
      [2.2, -2.6, 0.75, 0.3],
      [-2.2, -2.6, 0.75, 0.3],
    ],
    hand_crane: [[0, 0, 0.95, 0.95]],
  };

  function colliders(name: CraneKind, x: number, z: number, yaw: number): Rect[] {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return (CRANE_FEET[name] ?? []).map(([lx, lz, hx, hz]) => {
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ex = hx * Math.abs(c) + hz * Math.abs(s);
      const ez = hx * Math.abs(s) + hz * Math.abs(c);
      return { minX: wx - ex, maxX: wx + ex, minZ: wz - ez, maxZ: wz + ez };
    });
  }

  /** Pack boats along a line: centres, yaws. Line direction (tx, tz), water side (nx, nz). */
  function pack(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    nx: number,
    nz: number,
    kinds: BoatName[],
    o: Required<Omit<MooreOptions, "bob">>,
  ): Array<{ name: BoatName; x: number; z: number; yaw: number }> {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const out: Array<{ name: BoatName; x: number; z: number; yaw: number }> = [];
    if (L < 1) return out;
    const tx = (x1 - x0) / L;
    const tz = (z1 - z0) / L;
    const r = rng(o.seed);
    const pool = kinds.filter((k) => !isCrane(k) && k !== "pontoon_section" && dims(k).beam <= o.maxBeam);
    if (!pool.length) return out;
    let off = o.gap;
    for (let row = 0; row < o.rows; row++) {
      let s = o.margin + r() * o.spacing[1] * (row > 0 ? 2 : 0.5);
      let widest = 0;
      for (let tries = 0; tries < 400 && s < L - o.margin; tries++) {
        const name = pool[Math.floor(r() * pool.length)];
        const d = dims(name);
        if (s + d.length > L - o.margin) {
          // nothing long fits in what is left: try a shorter kind a few times, then stop
          if (pool.every((k) => s + dims(k).length > L - o.margin)) break;
          continue;
        }
        // outer rows are thinner: some gaps are left open
        if (row > 0 && r() < 0.35) {
          s += d.length * 0.6;
          continue;
        }
        const along = s + d.length / 2;
        const across = off + d.beam / 2;
        const flip = r() < 0.5 ? 0 : Math.PI;
        out.push({
          name,
          x: x0 + tx * along + nx * across,
          z: z0 + tz * along + nz * across,
          yaw: Math.atan2(tx, tz) + flip,
        });
        widest = Math.max(widest, d.beam);
        s += d.length + o.spacing[0] + r() * (o.spacing[1] - o.spacing[0]);
      }
      if (!widest) break;
      off += widest + 0.3;
    }
    return out;
  }

  function sideNormal(x0: number, z0: number, x1: number, z1: number, side: 1 | -1 | { x: number; z: number }): [number, number] {
    const L = Math.hypot(x1 - x0, z1 - z0) || 1;
    let nx = -(z1 - z0) / L;
    let nz = (x1 - x0) / L;
    const sgn = typeof side === "number" ? side : Math.sign((side.x - x0) * nx + (side.z - z0) * nz) || 1;
    nx *= sgn;
    nz *= sgn;
    return [nx, nz];
  }

  const tmpM = new THREE.Matrix4();
  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler(0, 0, 0, "YXZ");
  const tmpP = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const _m = new THREE.Matrix4();

  function writeFleet(f: Fleet, t: number): void {
    for (let i = 0; i < f.boats.length; i++) {
      const b = f.boats[i];
      const [h, roll, pitch, period] = b.m;
      const w = (Math.PI * 2) / period;
      tmpP.set(b.x, WATER_Y + h * Math.sin(w * t + b.p[0]) + h * 0.4 * Math.sin(2.3 * w * t + b.p[0] * 1.7), b.z);
      tmpE.set(pitch * Math.sin(1.13 * w * t + b.p[2]), b.yaw, roll * Math.sin(0.83 * w * t + b.p[1]));
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpP, tmpQ, one);
      for (let k = 0; k < f.meshes.length; k++) {
        f.meshes[k].setMatrixAt(i, _m.multiplyMatrices(tmpM, f.parts[k].matrix));
      }
    }
    for (const m of f.meshes) m.instanceMatrix.needsUpdate = true;
  }

  function mooreAlong(
    scene: THREE.Object3D,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    side: 1 | -1 | { x: number; z: number },
    kinds: BoatName[],
    opts: MooreOptions = {},
  ): Moored {
    const [nx, nz] = sideNormal(x0, z0, x1, z1, side);
    const o = {
      gap: opts.gap ?? 0.4,
      spacing: opts.spacing ?? ([0.8, 4] as [number, number]),
      margin: opts.margin ?? 2,
      rows: opts.rows ?? 1,
      maxBeam: opts.maxBeam ?? Infinity,
      seed: opts.seed ?? 1873,
    };
    const placed = pack(x0, z0, x1, z1, nx, nz, kinds, o);
    const group = new THREE.Group();
    group.name = "moored";
    const byKind = new Map<BoatName, typeof placed>();
    for (const p of placed) {
      let l = byKind.get(p.name);
      if (!l) byKind.set(p.name, (l = []));
      l.push(p);
    }
    const r = rng(o.seed ^ 0x5bd1e995);
    for (const [name, list] of byKind) {
      const ps = parts(name);
      const fleet: Fleet = {
        meshes: [],
        parts: ps,
        boats: list.map((b) => ({
          x: b.x,
          z: b.z,
          yaw: b.yaw,
          m: MOTION[name] ?? MOTION.lighter,
          p: [r() * 6.283, r() * 6.283, r() * 6.283] as [number, number, number],
        })),
      };
      for (const part of ps) {
        const im = new THREE.InstancedMesh(part.geometry, part.material, list.length);
        im.name = `${name}_moored`;
        fleet.meshes.push(im);
        group.add(im);
      }
      writeFleet(fleet, 0);
      for (const im of fleet.meshes) im.computeBoundingSphere();
      if (opts.bob ?? true) fleets.push(fleet);
    }
    scene.add(group);
    return { group, placed };
  }

  function pontoon(scene: THREE.Object3D, x: number, z0: number, z1: number, opts: PontoonOptions = {}): WalkRect[] {
    const ex = extras.get("pontoon_section") ?? {};
    const deckTop = typeof ex.deck_top === "number" ? ex.deck_top : 1.8;
    const half = typeof ex.half_width === "number" ? ex.half_width : 2.05;
    const len = typeof ex.length === "number" ? ex.length : 10;
    const dir = z1 >= z0 ? 1 : -1;
    const n = Math.max(1, Math.ceil(Math.abs(z1 - z0) / len - 0.05));
    for (let i = 0; i < n; i++) place("pontoon_section", x, z0 + dir * (i + 0.5) * len, 0, scene);
    const zEnd = z0 + dir * n * len;
    if (opts.barges ?? true) {
      const kinds = opts.kinds ?? ["rhine_barge", "lighter_loaded", "hengst", "lighter"];
      const start = opts.start ?? 3;
      const outer = 2.45;
      const seed = opts.seed ?? 1880;
      for (const sx of [1, -1]) {
        const list = pack(x + sx * outer, z0 + dir * start, x + sx * outer, zEnd, sx, 0, kinds, {
          gap: 0.3,
          spacing: [0.6, 2.5],
          margin: 0,
          rows: 1,
          maxBeam: Infinity,
          seed: seed + (sx > 0 ? 0 : 99),
        });
        for (const b of list) place(b.name, b.x, b.z, b.yaw, scene);
      }
    }
    return [{ minX: x - half, maxX: x + half, minZ: Math.min(z0, zEnd), maxZ: Math.max(z0, zEnd), y: WATER_Y + deckTop }];
  }

  function update(t: number, dt: number): void {
    for (const f of floats) {
      const [h, roll, pitch, period] = f.m;
      const w = (Math.PI * 2) / period;
      f.inner.position.y = h * Math.sin(w * t + f.p[0]) + h * 0.4 * Math.sin(2.3 * w * t + f.p[0] * 1.7);
      f.inner.rotation.z = roll * Math.sin(0.83 * w * t + f.p[1]);
      f.inner.rotation.x = pitch * Math.sin(1.13 * w * t + f.p[2]);
    }
    for (const f of fleets) writeFleet(f, t);
    for (const s of swings) {
      if (s.wait > 0) {
        s.wait -= dt;
        continue;
      }
      const d = s.target - s.cur;
      if (Math.abs(d) < 0.002) {
        s.cur = s.target;
        s.wait = 6 + s.r() * 16;
        s.target = (s.r() * 2 - 1) * s.range;
        continue;
      }
      // ease in and out: slow near the ends of the swing
      const ease = THREE.MathUtils.clamp(Math.abs(d) / 0.35, 0.2, 1);
      s.cur += Math.sign(d) * Math.min(Math.abs(d), s.speed * ease * dt);
      s.jib.rotation.y = s.cur;
    }
  }

  return {
    names: [...protos.keys()],
    dims,
    place,
    crane,
    colliders,
    pontoon,
    mooreAlong,
    update,
    materials,
  };
}
