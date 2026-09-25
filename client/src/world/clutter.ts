import { TOWN } from "./townBox";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import { LANDMARK_DOORS } from "../../../shared/landmarks";
import { marketKeepOut } from "../game/market";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { omnibusKeepOut } from "./omnibus";
import { TOWN_CLEAR } from "./quayfurniture";
import { steenKeepOut } from "./steenramp";
import { trackKeepOut, type TrackData } from "./tracks";
import { tradeKeepOut } from "./trades";
import { trafficLanes } from "./traffic";

// Clutter (Steve 2026-09-24: "the city feels empty and some street ends look unfinished").
//
// (a) The narrow alleys between the houses: found on the walk map (open ground less than 4.6 m
//     across), each gets its own seeded mix against the walls: barrels, crates, a rain butt under a
//     downpipe, a broom, a handcart, sacks, baskets, rubbish, a sleeping cat, a washing line across,
//     moss and damp low on the walls, leaves and sweepings. A through alley keeps a clear line down
//     the middle; a dead end is closed with a plank fence and gate or a brick back wall with a door.
// (b) The streets and squares: a density rule by street width (wide: something every 6-10 m of
//     wall, ordinary: every 12-20 m), always within 1.6 m of the wall: benches by the doors, barrels,
//     crates and sacks, baskets, parked handcarts on the wide ones, bills on blank walls, market
//     leftovers round the markets, guard stones and bollards at corners, pumps with a trough on
//     squares that have none. Nothing on doors, job spots, lanes, markets, rails, bridges, steps.
// (c) Street ends at the water: every place where a street runs into a quay (streetEnds()) gets a
//     proper end: a stone edge kerb with iron posts and a hanging chain, a kerb alone on a working
//     quay under the cranes, or a timber barrier by the dock; a street that runs off the map gets a
//     stretch of city wall with a closed gate. `streetEndCheck()` lists the ends still open.
//
// Models: tools/blender/build_clutter.py -> /models/clutter.glb (one atlas). Copies are merged per
// 96 m chunk: two draw calls (solid, decal) per chunk in view; chunks beyond the fog are hidden.

type Flags = (x: number, z: number) => number | undefined;
type P = [number, number];

export interface ClutterOptions {
  seed?: number;
  /** Colliders already down (props, pumps, quay furniture, litter heaps): kept clear. */
  avoid?: Rect[];
  /** More boxes to keep clear (the omnibus lane, workplaces, crane runways). */
  keepOut?: Rect[];
  /** Stone steps and ladders (world.quayInfo): kept clear; the chains stop at them. */
  quayInfo?: () => { flights: Array<{ top: [number, number]; end: [number, number] }>; ladders: Array<{ x: number; z: number; top: number }> };
  /** What street life put where (pumps, troughs, the well, washing lines): no second pump near one, no line over a line. */
  sites?: Array<{ kind: string; x: number; z: number }>;
  /** Shop fronts (street life): the goods by the door are lively.ts's; ours only further along. */
  shops?: Array<{ ax: number; az: number; tx: number; tz: number; ox: number; oz: number; len: number; door: number }>;
}

export interface StreetEnd {
  kind: "water" | "map edge";
  x: number;
  z: number;
  width: number;
  /** How it is closed ("chain", "kerb", "barrier", "wall", "rail") or "open". */
  end: string;
  near: string;
}

export interface Clutter {
  group: THREE.Group;
  colliders: Rect[];
  stats: {
    /** What was placed, by model (and "closure ...", "end ...", "washing line"). */
    counts: Record<string, number>;
    alleys: number;
    deadEnds: number;
    closures: number;
    alleyProps: number;
    streetProps: number;
    /** Street ends given a proper end (at the water and at the map edge). */
    ends: number;
    meshes: number;
    triangles: number;
    /** Why a thing was not put where it was tried (dev: to tune the density). */
    rej: Record<string, number>;
    /** Per street end at the water: its style, how many metres got an edge, and what cut the rest. */
    endWhy: Array<{ x: number; z: number; style: string; done: number; why: Record<string, number> }>;
  };
  alleys: Array<{ x: number; z: number; length: number; width: number; through: boolean; props: number; closure: string; end?: { x: number; z: number; dx: number; dz: number; width: number } }>;
}

interface Part {
  slot: number;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
}
interface Proto {
  parts: Part[];
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}
interface Put {
  name: string;
  m: THREE.Matrix4;
  shade: number;
}
interface CityData {
  places: Record<string, { x: number; z: number; kind: string }>;
  doors: Record<string, { x: number; z: number; out: [number, number]; width: number }>;
  bridges: Record<string, number[]>;
  quays: number[][];
  decor?: TrackData & { crane_rails?: number[][]; rails?: number[][] };
  landmarks: Record<string, { fp: number[][] }>;
}
interface Wall {
  ax: number;
  az: number;
  tx: number;
  tz: number;
  ox: number;
  oz: number;
  L: number;
  H: number;
  kind: number;
  door: number;
  seed: number;
  store: number;
  yaw: number;
}

const SOLID = 0;
const DECAL = 1;
const OPEN = 0;
const WALLF = 1;
const WATER = 2;
const OUTSIDE = 4;
const CHUNK = 96;
const KERB = 0.7;
const KERB_Y = 0.12;
// a grid of 0.5 m cells over the town inside its wall (world/townBox.ts)
const X0 = TOWN.x0;
const Z0 = TOWN.z0;
const RES = 0.5;
const NX = Math.round(TOWN.w / RES);
const NZ = Math.round(TOWN.h / RES);
/** An alley: open ground at most this wide (m). */
const ALLEY_MAX = 4.6;
const ALLEY_MIN = 0.9;
/** The lock and its bridge (world/lock.ts): nothing near. */
const LOCK: Rect = { minX: 100, maxX: 120, minZ: -2, maxZ: 48 };
/** The game's own quay by the start (props3d keepOut). */
const START: Rect = { minX: -72, maxX: 66, minZ: -30, maxZ: 27 };

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inR = (r: Rect, x: number, z: number, pad = 0) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
const segD = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  return Math.hypot(x - ax - dx * t, z - az - dz * t);
};

// ------------------------------------------------------------------ loading

async function loadModels(): Promise<{ protos: Map<string, Proto>; solidMap: THREE.Texture; decalMap: THREE.Texture }> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/clutter.glb");
  draco.dispose();
  let solidMap: THREE.Texture | null = null;
  let decalMap: THREE.Texture | null = null;
  const protos = new Map<string, Proto>();
  const v = new THREE.Vector3();
  const nrm = new THREE.Matrix3();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    if (node.name === "clutter_meta") continue;
    const proto: Proto = { parts: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0 };
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const slot = mat.name === "cl_decal" ? DECAL : SOLID;
      if (mat.map) {
        if (slot === SOLID) solidMap ??= mat.map;
        else decalMap ??= mat.map;
      }
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      nrm.getNormalMatrix(M);
      const Pa = g.getAttribute("position");
      const Na = g.getAttribute("normal");
      const Ua = g.getAttribute("uv");
      const Ca = g.getAttribute("color");
      const n = Pa.count;
      const part: Part = { slot, pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3) };
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(Pa, i).applyMatrix4(M);
        part.pos.set([v.x, v.y, v.z], i * 3);
        proto.height = Math.max(proto.height, v.y);
        if (v.y < 1.6) {
          proto.minX = Math.min(proto.minX, v.x);
          proto.maxX = Math.max(proto.maxX, v.x);
          proto.minZ = Math.min(proto.minZ, v.z);
          proto.maxZ = Math.max(proto.maxZ, v.z);
        }
        if (Na) {
          v.fromBufferAttribute(Na, i).applyMatrix3(nrm).normalize();
          part.nor.set([v.x, v.y, v.z], i * 3);
        } else part.nor.set([0, 1, 0], i * 3);
        part.uv.set([Ua ? Ua.getX(i) : 0, Ua ? Ua.getY(i) : 0], i * 2);
        part.col.set(Ca ? [Ca.getX(i), Ca.getY(i), Ca.getZ(i)] : [1, 1, 1], i * 3);
      }
      proto.parts.push(part);
    });
    if (proto.parts.length) protos.set(node.name, proto);
  }
  if (!solidMap || !decalMap) throw new Error("clutter.glb: textures missing");
  for (const t of [solidMap as THREE.Texture, decalMap as THREE.Texture]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
  }
  return { protos, solidMap, decalMap };
}

/** The house walls and corners carried in streetlife.glb (its JSON chunk only). */
async function loadWalls(): Promise<{ walls: number[][]; corners: number[][] }> {
  const buf = await (await fetch("/models/streetlife.glb")).arrayBuffer();
  const dv = new DataView(buf);
  const len = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))) as { nodes: Array<{ name?: string; extras?: { meta?: string } }> };
  const node = json.nodes.find((n) => n.name === "streetlife_meta");
  if (!node?.extras?.meta) throw new Error("streetlife.glb: no meta");
  const m = JSON.parse(node.extras.meta) as { walls: number[][]; corners: number[][] };
  return { walls: m.walls, corners: m.corners };
}

// ------------------------------------------------------------------ the street ends (the check reads these)

let checkState: {
  flags: Flags;
  treated: Array<{ ax: number; az: number; bx: number; bz: number; end: string }>;
  gaps: () => Array<{ x: number; z: number; r: number }>;
} | null = null;

const CITYD = CITY as unknown as CityData;
const bridgeRects = (pad: number): Rect[] =>
  Object.values(CITYD.bridges).map((b) => ({ minX: Math.min(b[0], b[2]) - pad, maxX: Math.max(b[0], b[2]) + pad, minZ: Math.min(b[1], b[3]) - pad, maxZ: Math.max(b[1], b[3]) + pad }));

interface EndSpan {
  kind: "water" | "map edge";
  /** The edge line of the end (on the quay line, or just inside the map edge). */
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Unit inland (into the street). */
  nx: number;
  nz: number;
}

/**
 * Every street end at the water: a stretch of quay line where a street (open ground walled on both
 * sides, less than 20 m across) runs straight into it from within 14 m of the edge. Bridges are
 * crossings, not ends. And every street that runs off the edge of the map.
 */
function findEnds(flags: Flags): EndSpan[] {
  const f = (x: number, z: number) => flags(x, z) ?? OUTSIDE;
  const out: EndSpan[] = [];
  const bridges = bridgeRects(1.5);
  for (const [ax, az, bx, bz] of CITYD.quays) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
    let nx = -tz;
    let nz = tx;
    // inland: the side with open ground along most of the line
    let a = 0;
    let b = 0;
    for (let s = 0.5; s < L; s += 2) {
      if (f(ax + tx * s + nx * 1.2, az + tz * s + nz * 1.2) === OPEN) a++;
      if (f(ax + tx * s - nx * 1.2, az + tz * s - nz * 1.2) === OPEN) b++;
    }
    if (b > a) {
      nx = -nx;
      nz = -nz;
    }
    let run: [number, number] | null = null;
    const flush = () => {
      if (run && run[1] - run[0] >= 1.0) {
        const s0 = Math.max(0, run[0] - 0.5);
        const s1 = Math.min(L, run[1] + 0.5);
        out.push({ kind: "water", ax: ax + tx * s0, az: az + tz * s0, bx: ax + tx * s1, bz: az + tz * s1, nx, nz });
      }
      run = null;
    };
    for (let s = 0.25; s < L; s += 0.5) {
      const px = ax + tx * s;
      const pz = az + tz * s;
      let hit = false;
      if (f(px + nx * 0.8, pz + nz * 0.8) === OPEN && !bridges.some((r) => inR(r, px, pz))) {
        for (let d = 2; d <= 14 && !hit; d += 1) {
          const qx = px + nx * d;
          const qz = pz + nz * d;
          if (f(qx, qz) !== OPEN) break;
          const lat = (sg: number) => {
            for (let e = 0.5; e <= 12; e += 0.5) {
              const g = f(qx + tx * e * sg, qz + tz * e * sg);
              if (g !== OPEN) return g & WALLF && !(g & WATER) ? e : 99;
            }
            return 99;
          };
          if (lat(-1) + lat(1) <= 20) {
            let ok = true;
            for (let k = 1; k <= 10 && ok; k++) if (f(qx + nx * k, qz + nz * k) !== OPEN) ok = false;
            if (ok) hit = true;
          }
        }
      }
      if (hit) {
        if (!run) run = [s, s];
        run[1] = s;
      } else flush();
    }
    flush();
  }
  // (the map's edge: none since the town wall, 2026-09-25. The grid ends at the wall's inner faces,
  // where the only open runs are the gate passages and the stairs, and those stay open)
  return out;
}

function nearName(x: number, z: number): string {
  let best = "";
  let bd = Infinity;
  for (const [k, p] of Object.entries(CITYD.places)) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return `${best} (${Math.round(bd)} m)`;
}

/**
 * The check (dev: __scheldemist.streetEnds()): every street end at the water or the map edge, and
 * how it is closed. A street end counts as closed when 80% of it (bridges, stairs and ladders left
 * out) has a railing, a chain, a kerb, a barrier or a wall along it. Returns the open ones; with
 * `all`, every end.
 */
export function streetEndCheck(all = false): StreetEnd[] {
  if (!checkState) return [{ kind: "water", x: 0, z: 0, width: 0, end: "not built yet", near: "" }];
  const { flags, treated, gaps } = checkState;
  const rails = (CITYD.decor?.rails ?? []).map(([ax, az, bx, bz]) => ({ ax, az, bx, bz, end: "rail" }));
  const lines = [...treated, ...rails];
  const skip = gaps();
  const bridges = bridgeRects(1.0);
  const res: StreetEnd[] = [];
  for (const e of findEnds(flags)) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az);
    let n = 0;
    let got = 0;
    const by: Record<string, number> = {};
    for (let s = 0.25; s < L; s += 0.5) {
      const x = e.ax + ((e.bx - e.ax) * s) / L;
      const z = e.az + ((e.bz - e.az) * s) / L;
      if (bridges.some((r) => inR(r, x, z)) || skip.some((g) => Math.hypot(g.x - x, g.z - z) < g.r)) continue;
      n++;
      const hit = lines.find((q) => segD(x, z, q.ax, q.az, q.bx, q.bz) < 1.2);
      if (hit) {
        got++;
        by[hit.end] = (by[hit.end] ?? 0) + 1;
      }
    }
    const ok = n === 0 || got >= 0.8 * n;
    const end = ok ? Object.entries(by).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "gaps only" : "open";
    const x = +((e.ax + e.bx) / 2).toFixed(1);
    const z = +((e.az + e.bz) / 2).toFixed(1);
    if (all || !ok) res.push({ kind: e.kind, x, z, width: +L.toFixed(1), end, near: nearName(x, z) });
  }
  return res;
}

// ------------------------------------------------------------------ the back walls (built to size)

interface Buf {
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[];
}
function newBuf(): Buf {
  return { pos: [], nor: [], uv: [], col: [] };
}
type V3 = [number, number, number];
/** A quad (a b c d round its edge) facing `n`, uvs per corner, a shade per corner. */
function quadB(b: Buf, p: V3[], uv: Array<[number, number]>, n: V3, sh: number[]): void {
  // wind it so that it faces n (the materials are double sided, but the normals must be right)
  const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
  const e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
  const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const flip = cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] < 0;
  const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
  for (const i of order) {
    b.pos.push(...p[i]);
    b.nor.push(...n);
    b.uv.push(...uv[i]);
    b.col.push(sh[i], sh[i], sh[i]);
  }
}
/** Brick texture scale: the houses' facade cell is 64 px for a 3 m bay and about one storey. */
const BRICK_U = 3.0;
const BRICK_V = 3.4;
/**
 * A brick back wall across an alley: its front face from (x0, z0) along a for W metres, 0.3 m
 * thick toward d, H high, with openings (a door, a gate, a window) that have brick reveals 0.1 m
 * deep. It reaches 0.1 m into the house walls either side (their faces cut through it: no gap, no
 * faces in the same plane). The foot is shaded darker, like the houses' damp foot.
 */
function brickWall(
  b: Buf,
  x0: number,
  z0: number,
  ax: number,
  az: number,
  dx: number,
  dz: number,
  W: number,
  H: number,
  opens: Array<{ s0: number; s1: number; y0: number; y1: number }>,
  shade: number,
  uoff: number,
): void {
  const P = (s: number, y: number, d: number): V3 => [x0 + ax * s + dx * d, y, z0 + az * s + dz * d];
  const sh = (y: number) => shade * (0.72 + 0.28 * Math.min(1, y / 2.2));
  const UV = (s: number, y: number): [number, number] => [(s + uoff) / BRICK_U, y / BRICK_V];
  const front: V3 = [-dx, 0, -dz];
  const T = 0.3;
  const R = 0.1;
  const face = (sa: number, sb: number, ya: number, yb: number) => {
    if (sb - sa < 1e-3 || yb - ya < 1e-3) return;
    quadB(b, [P(sa, ya, 0), P(sb, ya, 0), P(sb, yb, 0), P(sa, yb, 0)], [UV(sa, ya), UV(sb, ya), UV(sb, yb), UV(sa, yb)], front, [sh(ya), sh(ya), sh(yb), sh(yb)]);
  };
  // the front, in columns between the openings' edges
  const cuts = [-0.1, W + 0.1];
  for (const o of opens) cuts.push(o.s0, o.s1);
  cuts.sort((p, q) => p - q);
  for (let i = 0; i < cuts.length - 1; i++) {
    const sa = cuts[i];
    const sb = cuts[i + 1];
    const o = opens.find((q) => q.s0 <= sa + 1e-4 && q.s1 >= sb - 1e-4);
    if (o) {
      face(sa, sb, 0, o.y0);
      face(sa, sb, o.y1, H);
    } else face(sa, sb, 0, H);
  }
  // the reveals of each opening
  for (const o of opens) {
    const k = 0.8;
    const side = (s: number, nx: number) =>
      quadB(b, [P(s, o.y0, 0), P(s, o.y0, R), P(s, o.y1, R), P(s, o.y1, 0)], [UV(s, o.y0), UV(s + R, o.y0), UV(s + R, o.y1), UV(s, o.y1)], [ax * nx, 0, az * nx], [
        sh(o.y0) * k,
        sh(o.y0) * k,
        sh(o.y1) * k,
        sh(o.y1) * k,
      ]);
    side(o.s0, 1);
    side(o.s1, -1);
    const dk = 0.55 * shade;
    quadB(b, [P(o.s0, o.y1, 0), P(o.s1, o.y1, 0), P(o.s1, o.y1, R), P(o.s0, o.y1, R)], [UV(o.s0, 0), UV(o.s1, 0), UV(o.s1, R), UV(o.s0, R)], [0, -1, 0], [dk, dk, dk, dk]);
    if (o.y0 > 0.01) {
      const s0 = sh(o.y0);
      quadB(b, [P(o.s0, o.y0, 0), P(o.s1, o.y0, 0), P(o.s1, o.y0, R), P(o.s0, o.y0, R)], [UV(o.s0, 0), UV(o.s1, 0), UV(o.s1, R), UV(o.s0, R)], [0, 1, 0], [s0, s0, s0, s0]);
    }
  }
  // the top (under the coping or the roof) and the back (seen only from above)
  quadB(b, [P(-0.1, H, 0), P(W + 0.1, H, 0), P(W + 0.1, H, T), P(-0.1, H, T)], [UV(-0.1, 0), UV(W + 0.1, 0), UV(W + 0.1, T), UV(-0.1, T)], [0, 1, 0], [shade, shade, shade, shade]);
  const bk = 0.8;
  quadB(b, [P(-0.1, 0, T), P(W + 0.1, 0, T), P(W + 0.1, H, T), P(-0.1, H, T)], [UV(-0.1, 0), UV(W + 0.1, 0), UV(W + 0.1, H), UV(-0.1, H)], [dx, 0, dz], [
    sh(0) * bk,
    sh(0) * bk,
    sh(H) * bk,
    sh(H) * bk,
  ]);
}
/** A lean-to roof of pantiles over the outbuilding: eaves 0.3 m over the alley at H, rising back to H + rise at `back` m. */
function pentRoof(b: Buf, x0: number, z0: number, ax: number, az: number, dx: number, dz: number, W: number, H: number, rise: number, back: number, shade: number): void {
  const P = (s: number, y: number, d: number): V3 => [x0 + ax * s + dx * d, y, z0 + az * s + dz * d];
  const run = back + 0.3;
  const slope = Math.hypot(run, rise);
  const n: V3 = [(-dx * rise) / slope, run / slope, (-dz * rise) / slope];
  const s0 = -0.12;
  const s1 = W + 0.12;
  const th = 0.09;
  const t0 = shade * 0.9;
  // the tiles on top, the boards under, the fascia board at the eaves
  quadB(b, [P(s0, H + th, -0.3), P(s1, H + th, -0.3), P(s1, H + rise + th, back), P(s0, H + rise + th, back)], [[s0 / 1.2, 0], [s1 / 1.2, 0], [s1 / 1.2, slope / 1.2], [s0 / 1.2, slope / 1.2]], n, [t0, t0, shade, shade]);
  quadB(b, [P(s0, H, -0.3), P(s1, H, -0.3), P(s1, H + rise, back), P(s0, H + rise, back)], [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]], [-n[0], -n[1], -n[2]], [0.25, 0.25, 0.25, 0.25]);
  quadB(b, [P(s0, H, -0.3), P(s1, H, -0.3), P(s1, H + th, -0.3), P(s0, H + th, -0.3)], [[0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01]], [-dx, 0, -dz], [0.3, 0.3, 0.3, 0.3]);
}
function repeatTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
/** The houses' brick (world/cityTextures.ts wallFill): 64 px for 3 m, courses of 2 px, bricks of 5 px. */
function brickTexture(base: string, mortar: string, seed: number): THREE.CanvasTexture {
  const C = 64;
  const c = document.createElement("canvas");
  c.width = C;
  c.height = C;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  g.fillStyle = base;
  g.fillRect(0, 0, C, C);
  g.fillStyle = mortar;
  g.globalAlpha = 0.55;
  for (let row = 0; row < C; row += 2) {
    g.fillRect(0, row, C, 1);
    const off = (row / 2) % 2 ? 0 : 2;
    for (let col = off; col < C; col += 5) g.fillRect(col, row, 1, 2);
  }
  g.globalAlpha = 1;
  for (let i = 0; i < C * C * 0.22; i++) {
    const v = (r() - 0.5) * 0.22;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
    g.fillRect(Math.floor(r() * C), Math.floor(r() * C), 1 + Math.floor(r() * 2), 1);
  }
  return repeatTexture(c);
}
/** Red pantiles in rows, for the lean-to roofs: 32 px for 1.2 m. */
function tileTexture(seed: number): THREE.CanvasTexture {
  const C = 32;
  const c = document.createElement("canvas");
  c.width = C;
  c.height = C;
  const g = c.getContext("2d")!;
  const r = rng(seed);
  g.fillStyle = "#6a3526";
  g.fillRect(0, 0, C, C);
  for (let y = 0; y < C; y += 8)
    for (let x = (y / 8) % 2 ? -3 : 0; x < C; x += 6) {
      const k = 0.8 + r() * 0.35;
      g.fillStyle = `rgb(${Math.round(120 * k)},${Math.round(62 * k)},${Math.round(44 * k)})`;
      g.fillRect(x, y, 4, 7);
      g.fillStyle = "rgba(0,0,0,0.35)";
      g.fillRect(x + 4, y, 2, 7);
      g.fillRect(x, y + 7, 6, 1);
    }
  return repeatTexture(c);
}

// ------------------------------------------------------------------ building

/**
 * The clutter layer. Call after the city (the walk map), the props, the street life, the quay
 * furniture and the litter are in (their colliders in `avoid`). Resolves when it is in the scene.
 */
export async function createClutter(scene: THREE.Scene, flags: Flags, opts: ClutterOptions = {}): Promise<Clutter> {
  const [{ protos, solidMap, decalMap }, sl] = await Promise.all([loadModels(), loadWalls()]);
  for (let i = 0; i < 600 && flags(0, 0) === undefined; i++) await sleep(100);
  const seed = opts.seed ?? 1873;
  const city = CITYD;
  const at = (x: number, z: number) => flags(x, z) ?? OUTSIDE;
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const puts: Put[] = [];
  const colliders: Rect[] = [];
  const taken: Array<[number, number, number]> = [];
  const treated: Array<{ ax: number; az: number; bx: number; bz: number; end: string }> = [];

  // ---------------------------------------------------------------- keep-outs
  const decor = city.decor ?? {};
  const tracks = trackKeepOut(decor);
  const lanes = omnibusKeepOut();
  for (const l of trafficLanes()) for (let i = 0; i < l.x.length; i += 8) lanes.push({ minX: l.x[i] - l.half, maxX: l.x[i] + l.half, minZ: l.z[i] - l.half, maxZ: l.z[i] + l.half });
  const markets = marketKeepOut();
  const works = [...tradeKeepOut(), ...steenKeepOut()];
  const runways: Rect[] = (decor.crane_rails ?? []).map(([x0, z0, x1, z1]) => ({ minX: Math.min(x0, x1) - 0.9, maxX: Math.max(x0, x1) + 0.9, minZ: Math.min(z0, z1) - 0.9, maxZ: Math.max(z0, z1) + 0.9 }));
  const bridges = bridgeRects(1.5);
  const avoid = [...(opts.avoid ?? []), ...(opts.keepOut ?? [])];
  const clear: Array<{ x: number; z: number; r: number }> = [];
  for (const d of Object.values(city.doors)) clear.push({ x: d.x + d.out[0] * 1.5, z: d.z + d.out[1] * 1.5, r: Math.min(d.width / 2, 6) + 2 });
  for (const [k, s] of Object.entries(SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>)) {
    if (!k.startsWith("_") && s.x !== undefined && s.z !== undefined) clear.push({ x: s.x, z: s.z, r: 2.4 });
  }
  for (const d of LANDMARK_DOORS) clear.push({ x: d.step[0], z: d.step[1], r: 4 });
  // where the town's people haul and sell (the quay ends of the hauls; the stalls are in the markets' keep-out)
  for (const [x, z, r] of TOWN_CLEAR) clear.push({ x, z, r: r + 0.5 });
  const quay = opts.quayInfo?.() ?? { flights: [], ladders: [] };
  const nearSteps = (x: number, z: number, r: number) =>
    quay.flights.some((f) => segD(x, z, f.top[0], f.top[1], f.end[0], f.end[1]) < r + 1.6) || quay.ladders.some((l) => Math.hypot(l.x - x, l.z - z) < r + 1.0);
  const sites = opts.sites ?? [];
  const shops = opts.shops ?? [];
  /**
   * Right by a shop's door. (lively.ts sets its goods out 1.5 m beside the door, on whichever side is
   * clear: the side of ours if it comes first, the other if we come first.)
   */
  const onShop = (x: number, z: number, r: number) =>
    shops.some((s) => {
      const a = (x - s.ax) * s.tx + (z - s.az) * s.tz;
      const o = (x - s.ax) * s.ox + (z - s.az) * s.oz;
      return Math.abs(a - s.door) < 1.5 + r && o > -0.3 && o < 1.8 + r;
    });
  /** Along a shop's front (not at its door): its stock stands out here. */
  const shopFront = (x: number, z: number) =>
    shops.some((s) => {
      const a = (x - s.ax) * s.tx + (z - s.az) * s.tz;
      const o = (x - s.ax) * s.ox + (z - s.az) * s.oz;
      return a > -0.5 && a < s.len + 0.5 && o > -0.3 && o < 1.5;
    });

  // the house walls
  const walls: Wall[] = sl.walls.map(([ax, az, bx, bz, ox, oz, H, , kind, , door, wseed, store]) => {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    return { ax, az, tx: (bx - ax) / L, tz: (bz - az) / L, ox, oz, L, H, kind, door, seed: wseed, store, yaw: Math.atan2(ox, oz) };
  });
  // the landmarks' sides (the town hall, the Vleeshuis, the Oostershuis): blind walls for the street rule
  // (not the cathedral, whose stalls and doors are the cathedral quarter's; not the Steen on its promontory)
  const landmarkWalls: Wall[] = [];
  for (const [id, lm] of Object.entries(city.landmarks)) {
    if (id === "cathedral" || id === "steen" || !lm.fp) continue;
    const fp = lm.fp;
    for (let i = 0; i < fp.length; i++) {
      const [ax, az] = fp[i];
      const [bx, bz] = fp[(i + 1) % fp.length];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 3) continue;
      const tx = (bx - ax) / L;
      const tz = (bz - az) / L;
      let ox = -tz;
      let oz = tx;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      const openOut = () => [1.2, 2, 2.6, 3.2].some((d) => at(mx + ox * d, mz + oz * d) === OPEN);
      if (!openOut()) {
        ox = -ox;
        oz = -oz;
        if (!openOut()) continue;
      }
      // an arcade or a plinth the walk map keeps off: the wall line for our things is where open ground starts
      const ds: number[] = [];
      for (let q = 0.5; q < L - 0.5; q += 1) {
        let d = 0.05;
        while (d < 3 && at(ax + tx * q + ox * d, az + tz * q + oz * d) !== OPEN) d += 0.1;
        if (d < 3) ds.push(d);
      }
      ds.sort((p, q) => p - q);
      const m = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
      const sh = m > 0.6 ? m - 0.5 : 0;
      landmarkWalls.push({ ax: ax + ox * sh, az: az + oz * sh, tx, tz, ox, oz, L, H: 9, kind: 2, door: -1, seed: Math.round(ax * 31 + az * 17), store: 1, yaw: Math.atan2(ox, oz) });
    }
  }
  const wallGrid = new Map<string, Wall[]>();
  for (const w of walls) {
    const n = Math.ceil(w.L / 4);
    const seen = new Set<string>();
    for (let k = 0; k <= n; k++) {
      const x = w.ax + (w.tx * (w.L * k)) / n;
      const z = w.az + (w.tz * (w.L * k)) / n;
      for (let di = -1; di <= 1; di++)
        for (let dj = -1; dj <= 1; dj++) {
          const key = `${Math.floor(x / 8) + di},${Math.floor(z / 8) + dj}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let l = wallGrid.get(key);
          if (!l) wallGrid.set(key, (l = []));
          l.push(w);
        }
    }
  }
  /** On the kerb of a street wall? (kerbs are 0.7 m deep, 0.12 m high, street fronts only) */
  const onKerb = (x: number, z: number): boolean => {
    for (const w of wallGrid.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) ?? []) {
      if (w.kind !== 0) continue;
      const s = (x - w.ax) * w.tx + (z - w.az) * w.tz;
      const d = (x - w.ax) * w.ox + (z - w.az) * w.oz;
      if (s > -0.05 && s < w.L + 0.05 && d > -0.05 && d < KERB) return true;
    }
    return false;
  };
  const houseDoors: Array<{ x: number; z: number; tx: number; tz: number; ox: number; oz: number }> = [];
  for (const w of walls) if (w.door >= 0) houseDoors.push({ x: w.ax + w.tx * w.door * w.L, z: w.az + w.tz * w.door * w.L, tx: w.tx, tz: w.tz, ox: w.ox, oz: w.oz });
  const doorGrid = new Map<string, typeof houseDoors>();
  for (const d of houseDoors) {
    const key = `${Math.floor(d.x / 8)},${Math.floor(d.z / 8)}`;
    let l = doorGrid.get(key);
    if (!l) doorGrid.set(key, (l = []));
    l.push(d);
  }
  const atDoor = (x: number, z: number, r: number) => {
    const gi = Math.floor(x / 8);
    const gj = Math.floor(z / 8);
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const d of doorGrid.get(`${gi + di},${gj + dj}`) ?? []) {
          const a = (x - d.x) * d.tx + (z - d.z) * d.tz;
          const o = (x - d.x) * d.ox + (z - d.z) * d.oz;
          if (Math.abs(a) < 1.0 + r && o > -0.3 && o < 2.4 + r) return true;
        }
    return false;
  };
  const doorNear = (x: number, z: number, lo: number, hi: number) => {
    for (const d of doorGrid.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) ?? []) {
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd > lo && dd < hi) return true;
    }
    return false;
  };

  /** Open ground under a circle of radius r (the centre and six points round it). */
  const open = (x: number, z: number, r: number) => {
    if (at(x, z) !== OPEN) return false;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const g = at(x + Math.cos(a) * r, z + Math.sin(a) * r);
      if (g & (WATER | OUTSIDE)) return false;
    }
    return true;
  };
  /** From a wall foot at (x, z) straight out along (ox, oz): how far to the next thing that is not open ground (the walk map leaves a margin of up to half a metre along walls). */
  const across = (x: number, z: number, ox: number, oz: number, max = 30) => {
    let d = 0.05;
    while (d < 0.8 && at(x + ox * d, z + oz * d) !== OPEN) d += 0.1;
    if (d >= 0.8) return 0;
    while (d < max && at(x + ox * (d + 0.1), z + oz * (d + 0.1)) === OPEN) d += 0.1;
    return d;
  };
  interface Rules {
    /** It stands against a wall: the ring test may touch the wall. */
    wall?: boolean;
    /** Allowed on a market's edge (leftovers). */
    market?: boolean;
    /** Skip the ground test (the caller made its own). */
    loose?: boolean;
    /** Keep a walking line of about 0.9 m clear in front of it (an alley). */
    line?: boolean;
  }
  const rej: Record<string, number> = {};
  let rejTag = "";
  const no = (k: string) => {
    rej[rejTag + k] = (rej[rejTag + k] ?? 0) + 1;
    return false;
  };
  const freeAt = (x: number, z: number, r: number, rules: Rules = {}) => {
    if (!rules.loose && (rules.wall ? at(x, z) !== OPEN : !open(x, z, r))) return no("ground");
    if (tracks.some((q) => inR(q, x, z, r * 0.7)) || bridges.some((q) => inR(q, x, z, r)) || runways.some((q) => inR(q, x, z, r))) return no("rails");
    if (works.some((q) => inR(q, x, z, r + 0.3)) || inR(LOCK, x, z, r) || inR(START, x, z, r)) return no("works");
    if (lanes.some((q) => inR(q, x, z, r))) return no("lane");
    if (!rules.market && markets.some((q) => inR(q, x, z, r + 1))) return no("market");
    if (avoid.some((q) => inR(q, x, z, r + 0.2))) return no("solid");
    if (clear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r)) return no("clear");
    if (nearSteps(x, z, r)) return no("steps");
    if (atDoor(x, z, r)) return no("door");
    return !taken.some(([tx, tz, tr]) => Math.hypot(tx - x, tz - z) < tr + r) || no("taken");
  };

  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const UP = new THREE.Vector3(0, 1, 0);
  const put = (name: string, x: number, y: number, z: number, yaw: number, sx = 1, sy = 1, sz = 1, shade = 1) => {
    if (!protos.has(name)) return;
    Q.setFromAxisAngle(UP, yaw);
    puts.push({ name, m: M.clone().compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(sx, sy, sz)), shade });
    count(name);
  };
  /** A box collider from a model's footprint at (x, z, yaw), scaled. */
  const collide = (name: string, x: number, z: number, yaw: number, pad = 0.03, sx = 1, sz = 1, top?: number) => {
    const p = protos.get(name);
    if (!p || !isFinite(p.minX)) return;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [lx, lz] of [[p.minX * sx, p.minZ * sz], [p.maxX * sx, p.minZ * sz], [p.maxX * sx, p.maxZ * sz], [p.minX * sx, p.maxZ * sz]]) {
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz);
      maxZ = Math.max(maxZ, wz);
    }
    colliders.push({ minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad, top: top ?? p.height });
  };

  /**
   * Things against a wall: the model's back on the wall (local -z), its front out. Depth `dep` (m
   * out from the wall), radius `r` for the keep-outs round its middle. On a kerb it sits on the kerb
   * if it fits there, else it steps down beyond it.
   */
  const DEPTH: Record<string, [number, number, boolean]> = {
    // name: depth out from the wall, radius, solid
    barrel: [0.62, 0.3, true],
    keg: [0.45, 0.22, true],
    crate: [0.55, 0.36, true],
    crates: [0.55, 0.62, true],
    crate_broken: [0.95, 0.5, true],
    rain_butt: [0.78, 0.38, true],
    broom: [0.5, 0.15, false],
    shovel: [0.45, 0.14, false],
    handcart: [1.12, 1.2, true],
    sacks: [0.88, 0.5, true],
    baskets: [0.55, 0.45, true],
    rubbish: [1.15, 0.75, false],
    cat_grey: [0.52, 0.32, false],
    cat_black: [0.52, 0.32, false],
    cat_ginger: [0.52, 0.32, false],
    bench: [0.4, 0.78, true],
    leftovers: [0.9, 0.7, false],
  };
  /** Along wall w at s, out by off: place the model; false if it does not fit. `maxDep`: how far out it may reach. */
  const againstWall = (name: string, w: Wall, s: number, maxDep: number, rules: Rules = {}, yawJitter = 0.06): boolean => {
    const spec = DEPTH[name];
    if (!spec) return false;
    const [dep, r, solid] = spec;
    let off = 0.02;
    const bx = w.ax + w.tx * s;
    const bz = w.az + w.tz * s;
    let y = 0;
    if (w.kind === 0 && onKerb(bx + w.ox * 0.3, bz + w.oz * 0.3)) {
      if (dep <= KERB + 0.1) y = KERB_Y;
      else off = KERB + 0.04; // off the kerb, in the gutter
    }
    if (off + dep > maxDep) return no("deep");
    // the middle of it, for the keep-outs; the ends of its footprint must be on open ground too
    const cx = bx + w.ox * (off + dep / 2);
    const cz = bz + w.oz * (off + dep / 2);
    const half = Math.max(0.1, r - dep / 2);
    // (the ground test looks at its front: the walk map's margin along the wall is not open)
    const fd = Math.max(0.6, off + dep * 0.85);
    const fx = bx + w.ox * fd;
    const fz = bz + w.oz * fd;
    if (at(fx, fz) !== OPEN) return no("ground");
    if (!freeAt(fx, fz, 0.05, { ...rules, wall: true }) || !freeAt(cx, cz, Math.min(r, dep / 2 + 0.05), { ...rules, wall: true, loose: true })) return false;
    for (const e of [-half, half]) {
      const ex = fx + w.tx * e;
      const ez = fz + w.tz * e;
      if (at(ex, ez) !== OPEN) return no("ends");
      if (atDoor(ex, ez, 0.1)) return no("door");
      if (onShop(ex, ez, 0.2)) return no("shop");
    }
    if (onShop(cx, cz, r)) return no("shop");
    if (rules.line) {
      // the line in front of it: clear of everything already along the other wall
      const lx = bx + w.ox * (off + dep + 0.5);
      const lz = bz + w.oz * (off + dep + 0.5);
      if (at(lx, lz) !== OPEN && at(lx + w.ox * 0.1, lz + w.oz * 0.1) !== OPEN) return no("line");
      for (const e of [-half, 0, half]) {
        const qx = lx + w.tx * e;
        const qz = lz + w.tz * e;
        if (taken.some(([tx, tz, tr]) => Math.hypot(tx - qx, tz - qz) < tr + 0.42)) return no("line");
      }
    }
    const R = rng(Math.round(bx * 97 + bz * 31));
    const yaw = w.yaw + (R() - 0.5) * 2 * yawJitter;
    put(name, bx + w.ox * off, y, bz + w.oz * off, yaw, 1, 1, 1, 0.85 + R() * 0.25);
    taken.push([cx, cz, r]);
    // its front edge too, so a thing on the other side keeps the line open
    for (const e of [-half, 0, half]) taken.push([bx + w.ox * (off + dep - 0.12) + w.tx * e, bz + w.oz * (off + dep - 0.12) + w.tz * e, 0.12]);
    if (solid) collide(name, bx + w.ox * off, bz + w.oz * off, yaw);
    return true;
  };

  await sleep(0);
  // ================================================================ the walk grid: widths, alleys
  const N = NX * NZ;
  const openG = new Uint8Array(N);
  const waterG = new Uint8Array(N);
  for (let i = 0; i < NX; i++) {
    const x = X0 + (i + 0.5) * RES;
    for (let j = 0; j < NZ; j++) {
      const g = at(x, Z0 + (j + 0.5) * RES);
      openG[i * NZ + j] = g === OPEN ? 1 : 0;
      waterG[i * NZ + j] = g & WATER ? 1 : 0;
    }
  }
  const runX = new Uint16Array(N);
  const runZ = new Uint16Array(N);
  for (let j = 0; j < NZ; j++) {
    let i = 0;
    while (i < NX) {
      if (!openG[i * NZ + j]) {
        i++;
        continue;
      }
      let k = i;
      while (k < NX && openG[k * NZ + j]) k++;
      for (let q = i; q < k; q++) runX[q * NZ + j] = k - i;
      i = k;
    }
  }
  for (let i = 0; i < NX; i++) {
    let j = 0;
    while (j < NZ) {
      if (!openG[i * NZ + j]) {
        j++;
        continue;
      }
      let k = j;
      while (k < NZ && openG[i * NZ + k]) k++;
      for (let q = j; q < k; q++) runZ[i * NZ + q] = k - j;
      j = k;
    }
  }
  const widthAt = (c: number) => Math.min(runX[c], runZ[c]) * RES;
  const narrow = (c: number) => {
    if (!openG[c]) return false;
    const w = widthAt(c);
    return w >= ALLEY_MIN && w <= ALLEY_MAX;
  };
  const label = new Int32Array(N).fill(-1);
  const cellOf = (x: number, z: number) => {
    const i = Math.floor((x - X0) / RES);
    const j = Math.floor((z - Z0) / RES);
    return i < 0 || j < 0 || i >= NX || j >= NZ ? -1 : i * NZ + j;
  };
  const cx = (c: number) => X0 + (Math.floor(c / NZ) + 0.5) * RES;
  const cz = (c: number) => Z0 + ((c % NZ) + 0.5) * RES;
  interface Alley {
    id: number;
    cells: number[];
    through: boolean;
    keep: boolean;
    length: number;
    width: number;
    x: number;
    z: number;
    end?: { x: number; z: number; dx: number; dz: number; span: number; ax: number; az: number; px: number; pz: number; l: number; r: number };
    props: number;
    closure: string;
  }
  const alleys: Alley[] = [];
  const queue = new Int32Array(N);
  const nb = [NZ, -NZ, 1, -1];
  for (let c0 = 0; c0 < N; c0++) {
    if (label[c0] >= 0 || !narrow(c0)) continue;
    const id = alleys.length;
    let qh = 0;
    let qt = 0;
    queue[qt++] = c0;
    label[c0] = id;
    const cells: number[] = [];
    let wet = false;
    while (qh < qt) {
      const c = queue[qh++];
      cells.push(c);
      for (const d of nb) {
        const n = c + d;
        if (n < 0 || n >= N || Math.abs((n % NZ) - (c % NZ)) > 1) continue;
        if (waterG[n]) wet = true;
        if (label[n] >= 0 || !narrow(n)) continue;
        label[n] = id;
        queue[qt++] = n;
      }
    }
    let sx = 0;
    let sz = 0;
    let ws = 0;
    for (const c of cells) {
      sx += cx(c);
      sz += cz(c);
      ws += widthAt(c);
    }
    const x = sx / cells.length;
    const z = sz / cells.length;
    const area = cells.length * RES * RES;
    // a strip by the water is a quay's edge, not an alley; the game's own quay and the markets are theirs
    const keep = !wet && area >= 4 && !inR(START, x, z, 2) && !markets.some((q) => inR(q, x, z, 2)) && !inR(LOCK, x, z, 2);
    alleys.push({ id, cells, through: false, keep, length: 0, width: ws / cells.length, x, z, props: 0, closure: "" });
  }
  // mouths: the wide open ground each alley opens onto; one mouth is a dead end
  for (const a of alleys) {
    if (!a.keep) continue;
    const mouth = new Set<number>();
    for (const c of a.cells)
      for (const d of nb) {
        const n = c + d;
        if (n < 0 || n >= N || Math.abs((n % NZ) - (c % NZ)) > 1) continue;
        if (openG[n] && label[n] !== a.id && widthAt(n) > ALLEY_MAX) mouth.add(n);
      }
    // group the mouth cells (8-neighbours)
    const seen = new Set<number>();
    const groups: number[][] = [];
    for (const m of mouth) {
      if (seen.has(m)) continue;
      const g: number[] = [];
      const st = [m];
      seen.add(m);
      while (st.length) {
        const c = st.pop()!;
        g.push(c);
        for (const di of [-1, 0, 1])
          for (const dj of [-1, 0, 1]) {
            const n = c + di * NZ + dj;
            if (mouth.has(n) && !seen.has(n)) {
              seen.add(n);
              st.push(n);
            }
          }
      }
      if (g.length >= 2) groups.push(g);
    }
    a.through = groups.length >= 2;
    if (!groups.length) {
      a.keep = false;
      continue;
    }
    // distance from the mouth(s) through the alley: its length, and the far end of a dead end
    const dist = new Map<number, number>();
    const parent = new Map<number, number>();
    const inA = (c: number) => label[c] === a.id;
    let qh = 0;
    let qt = 0;
    for (const g of groups)
      for (const m of g)
        for (const d of nb) {
          const n = m + d;
          if (n >= 0 && n < N && inA(n) && !dist.has(n)) {
            dist.set(n, 0);
            queue[qt++] = n;
          }
        }
    let far = queue[0];
    while (qh < qt) {
      const c = queue[qh++];
      const dc = dist.get(c)!;
      if (dc > dist.get(far)!) far = c;
      for (const d of nb) {
        const n = c + d;
        if (n < 0 || n >= N || !inA(n) || dist.has(n) || Math.abs((n % NZ) - (c % NZ)) > 1) continue;
        dist.set(n, dc + 1);
        parent.set(n, c);
        queue[qt++] = n;
      }
    }
    a.length = (dist.get(far)! + 1) * RES;
    if (a.through || a.length < 2.5) continue;
    // the dead end: which way the alley runs there (a wall close ahead, the alley open behind), and
    // the wall that closes it
    const fx0 = cx(far);
    const fz0 = cz(far);
    const reach = (ddx: number, ddz: number, max: number) => {
      let d = 0;
      while (d < max && at(fx0 + ddx * (d + 0.1), fz0 + ddz * (d + 0.1)) === OPEN) d += 0.1;
      return d;
    };
    let dx = 0;
    let dz = 0;
    // (the alley runs back the longest way; ahead it may go on as a slit too thin to walk)
    let bestBehind = 0;
    for (const [ddx, ddz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ahead = reach(ddx, ddz, 8);
      const behind = reach(-ddx, -ddz, 6);
      if (ahead < 8 && behind >= 1.5 && behind > bestBehind) {
        bestBehind = behind;
        dx = ddx;
        dz = ddz;
      }
    }
    if (!dx && !dz) {
      a.closure = "(no end wall)";
      continue;
    }
    let ex = fx0;
    let ez = fz0;
    let steps = 0;
    while (at(ex + dx * 0.25, ez + dz * 0.25) === OPEN && steps < 34) {
      ex += dx * 0.25;
      ez += dz * 0.25;
      steps++;
    }
    const endFlag = at(ex + dx * 0.3, ez + dz * 0.3);
    if (!(endFlag & WALLF) || endFlag & (WATER | OUTSIDE)) {
      a.closure = endFlag & OUTSIDE ? "(map edge)" : "(water)";
      continue;
    }
    // across: from wall to wall, 0.35 m before the end
    const px = ex - dx * 0.35;
    const pz = ez - dz * 0.35;
    const ax = -dz;
    const az = dx;
    let l = 0;
    let r = 0;
    while (l < 6 && at(px + ax * (l + 0.1), pz + az * (l + 0.1)) === OPEN) l += 0.1;
    while (r < 6 && at(px - ax * (r + 0.1), pz - az * (r + 0.1)) === OPEN) r += 0.1;
    // the walk map keeps up to half a metre off each wall: the closure reaches into the walls
    const span = l + r + 0.9;
    if (l + r < 0.4 || l + r > ALLEY_MAX + 0.5) {
      a.closure = `(span ${span.toFixed(1)})`;
      continue;
    }
    a.end = { x: px + ax * ((l - r) / 2), z: pz + az * ((l - r) / 2), dx, dz, span, ax, az, px, pz, l, r };
  }
  const kept = alleys.filter((a) => a.keep);

  // ================================================================ (a) the alleys
  await sleep(0);
  const lineSites = sites.filter((s) => s.kind === "washing line");
  let closures = 0;
  let alleyProps = 0;
  // the closures first (the dead ends), so nothing else stands where they go. Steve 2026-09-24: a
  // real back wall, wall to wall and tall, with the houses' brick, a modest door; built in code to
  // size (the timber and stone parts are models of clutter.glb)
  const closureGeo = [newBuf(), newBuf(), newBuf()]; // red brick, dark brick, roof tiles
  /** The real wall face beside the alley end on side `sg` (+1 along a, -1 against): from the house walls; else the walk map's reach plus its margin. */
  const sideFace = (e: NonNullable<Alley["end"]>, sg: number, reach: number): number => {
    let best = Infinity;
    for (const w of [...(wallGrid.get(`${Math.floor(e.px / 8)},${Math.floor(e.pz / 8)}`) ?? []), ...landmarkWalls]) {
      if (Math.abs(w.tx * e.dx + w.tz * e.dz) < 0.9) continue; // along the alley
      if ((w.ox * e.ax + w.oz * e.az) * sg > -0.9) continue; // facing back into it
      const off = ((w.ax - e.px) * e.ax + (w.az - e.pz) * e.az) * sg;
      if (off < reach - 0.05 || off > reach + 1.2) continue;
      const along = (e.px - w.ax) * w.tx + (e.pz - w.az) * w.tz;
      if (along < -0.4 || along > w.L + 0.4) continue;
      best = Math.min(best, off);
    }
    return isFinite(best) ? best : reach + 0.45;
  };
  /** The house face that ends the alley, ahead of the probe point (m), or null. */
  const endFace = (e: NonNullable<Alley["end"]>): number | null => {
    let best: number | null = null;
    for (const w of wallGrid.get(`${Math.floor(e.px / 8)},${Math.floor(e.pz / 8)}`) ?? []) {
      if (w.ox * e.dx + w.oz * e.dz > -0.9) continue;
      const f = (w.ax - e.px) * e.dx + (w.az - e.pz) * e.dz;
      if (f < 0 || f > 2) continue;
      const along = (e.px - w.ax) * w.tx + (e.pz - w.az) * w.tz;
      if (along < -0.4 || along > w.L + 0.4) continue;
      if (best === null || f < best) best = f;
    }
    return best;
  };
  for (const a of kept) {
    const e = a.end;
    if (!e) continue;
    const R = rng(seed * 7 + a.id * 131);
    // the wall faces either side, and where the back wall's front goes
    const fl = sideFace(e, 1, e.l);
    const fr = sideFace(e, -1, e.r);
    const W = fl + fr; // wall face to wall face
    const ef = endFace(e);
    const fwd = ef !== null ? Math.max(-0.2, Math.min(0.9, ef - 0.34)) : 0;
    const ox0 = e.px - e.ax * fr + e.dx * fwd; // the left end of the front face (at the right-hand house... "left" = -a)
    const oz0 = e.pz - e.az * fr + e.dz * fwd;
    e.x = ox0 + e.ax * (W / 2);
    e.z = oz0 + e.az * (W / 2);
    e.span = W;
    // a house door in the end wall is a proper end already
    let blocked: string | false = false;
    for (let t = 0.15; t <= W - 0.15 && !blocked; t += 0.3) {
      const x = ox0 + e.ax * t - e.dx * 0.2;
      const z = oz0 + e.az * t - e.dz * 0.2;
      if (atDoor(x, z, 0.2)) blocked = "door";
      else if (clear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r)) blocked = "spot";
      else if (avoid.some((q) => inR(q, x, z, 0.1))) blocked = "solid";
    }
    if (blocked) {
      a.closure = `(${blocked} in the end)`;
      continue;
    }
    const yaw = Math.atan2(-e.dx, -e.dz); // local +z toward the mouth, local +x along a
    const dark = R() < 0.4 ? 1 : 0;
    const shade = 0.85 + R() * 0.15;
    const r0 = R();
    const style = W < 1.6 ? "door" : r0 < 0.4 ? "door" : r0 < 0.7 && W >= 2.0 ? "gate" : "shed";
    // the openings (s from the left face, y up) and the parts set into them
    const opens: Array<{ s0: number; s1: number; y0: number; y1: number }> = [];
    const part = (name: string, sMid: number, y: number, sx = 1) => put(name, ox0 + e.ax * sMid, y, oz0 + e.az * sMid, yaw, sx, 1, 1, shade);
    const H = style === "shed" ? 3.0 + R() * 0.4 : 3.6 + R() * 0.8;
    if (style === "gate") {
      const gw = Math.min(2.0, W - 0.4);
      const mid = W / 2 + (R() - 0.5) * Math.max(0, W - gw - 0.6);
      opens.push({ s0: mid - gw / 2, s1: mid + gw / 2, y0: 0, y1: 2.3 });
      part("gate_double", mid, 0, gw / 2.0);
    } else {
      // (in a slit of an alley the door takes nearly all of it)
      const dw = W < 1.3 ? Math.max(0.6, W - 0.2) : Math.min(0.9, W - 0.36);
      const edge = Math.min(0.25, (W - dw) / 2);
      const room = Math.max(0, W - dw - 2 * edge);
      const mid = edge + dw / 2 + R() * room;
      opens.push({ s0: mid - dw / 2, s1: mid + dw / 2, y0: 0, y1: 1.95 });
      part(R() < 0.5 ? "door_ledged" : "door_green", mid, 0, dw / 0.9);
      // a small barred window in the back of an outbuilding, clear of the door
      if (style === "shed" && W >= 2.0) {
        const left = mid - dw / 2 > W - (mid + dw / 2);
        const ws = left ? (mid - dw / 2) / 2 : (mid + dw / 2 + W) / 2;
        if (Math.abs(ws - mid) > dw / 2 + 0.55) {
          opens.push({ s0: ws - 0.3, s1: ws + 0.3, y0: 1.45, y1: 2.15 });
          part("window_small", ws, 1.45);
        }
      }
    }
    opens.sort((p, q) => p.s0 - q.s0);
    brickWall(closureGeo[dark], ox0, oz0, e.ax, e.az, e.dx, e.dz, W, H, opens, shade, R() * 3);
    if (style === "shed") {
      // a lean-to roof over the outbuilding, its eaves over the alley, rising back to the house behind
      pentRoof(closureGeo[2], ox0, oz0, e.ax, e.az, e.dx, e.dz, W, H, 1.2 + R() * 0.5, 2.4, shade);
    } else {
      const n = Math.max(1, Math.ceil(W + 0.2));
      const u = (W + 0.2) / n;
      for (let k = 0; k < n; k++) part("coping_unit", -0.1 + u * k + 0, H, u);
    }
    // damp and moss low on the wall, beside the openings
    let s0 = 0.05;
    for (const o of [...opens.filter((q) => q.y0 < 0.1), { s0: W - 0.05, s1: W, y0: 0, y1: 0 }]) {
      const len = o.s0 - s0 - 0.08;
      if (len > 0.35) put(R() < 0.5 ? "moss_low" : "moss_low_b", ox0 + e.ax * (s0 + len / 2) - e.dx * 0.012, 0, oz0 + e.az * (s0 + len / 2) - e.dz * 0.012, yaw, len / 2, 0.6 + R() * 0.5, 1);
      s0 = o.s1 + 0.08;
    }
    // the collider: the wall body, into the houses either side (a wall is never climbed)
    const xs: number[] = [];
    const zs: number[] = [];
    for (const [t, d] of [[-0.1, 0], [W + 0.1, 0], [-0.1, 0.3], [W + 0.1, 0.3]]) {
      xs.push(ox0 + e.ax * t + e.dx * d);
      zs.push(oz0 + e.az * t + e.dz * d);
    }
    colliders.push({ minX: Math.min(...xs) - 0.03, maxX: Math.max(...xs) + 0.03, minZ: Math.min(...zs) - 0.03, maxZ: Math.max(...zs) + 0.03 });
    taken.push([e.x - e.dx * 0.5, e.z - e.dz * 0.5, 0.6]);
    a.closure = `${style} (${W.toFixed(1)} m, ${H.toFixed(1)} m)`;
    closures++;
    count(`closure ${style}`);
  }

  // the walls along each alley: where things can stand
  interface Slot {
    w: Wall;
    s: number;
    W: number;
  }
  const slotsBy = new Map<number, Slot[]>();
  for (const w of [...walls, ...landmarkWalls]) {
    for (let s = 0.4; s < w.L - 0.4; s += 0.5) {
      const px = w.ax + w.tx * s + w.ox * 0.75;
      const pz = w.az + w.tz * s + w.oz * 0.75;
      const c = cellOf(px, pz);
      if (c < 0) continue;
      const id = label[c];
      if (id < 0 || !alleys[id].keep) continue;
      const W = across(w.ax + w.tx * s, w.az + w.tz * s, w.ox, w.oz, 8);
      if (W < 0.5) continue;
      let l = slotsBy.get(id);
      if (!l) slotsBy.set(id, (l = []));
      l.push({ w, s, W });
    }
  }
  const ALLEY_KIT: Array<[string, number]> = [
    ["barrel", 3], ["keg", 2], ["crate", 2], ["crates", 2], ["crate_broken", 1], ["broom", 1.5], ["shovel", 0.8], ["sacks", 1.2], ["baskets", 1.2], ["handcart", 0.8],
  ];
  const pickW = <T,>(R: () => number, xs: Array<[T, number]>): T => {
    let t = R() * xs.reduce((a, [, w]) => a + w, 0);
    for (const [v, w] of xs) if ((t -= w) <= 0) return v;
    return xs[xs.length - 1][0];
  };
  for (const a of kept) {
    const slots = slotsBy.get(a.id) ?? [];
    if (!slots.length) continue;
    const R = rng(seed * 13 + a.id * 977);
    // how far out things may reach: a clear line of 1.1 m down the middle (both sides may be filled)
    // (the walk map's margin by the far wall counts as part of the line)
    const maxDep = (sl: Slot) => sl.W - 0.95;
    const nearEnd = (sl: Slot) => {
      if (!a.end) return false;
      const x = sl.w.ax + sl.w.tx * sl.s;
      const z = sl.w.az + sl.w.tz * sl.s;
      return Math.hypot(x - a.end.x, z - a.end.z) < a.end.span / 2 + 2.5;
    };
    const pickSlot = (want: (sl: Slot) => boolean) => {
      for (let k = 0; k < 14; k++) {
        const sl = slots[Math.floor(R() * slots.length)];
        if (want(sl)) return sl;
      }
      return null;
    };
    const tryPut = (name: string, want: (sl: Slot) => boolean = () => true) => {
      for (let k = 0; k < 6; k++) {
        const sl = pickSlot(want);
        if (!sl) return false;
        if (againstWall(name, sl.w, sl.s, maxDep(sl), { line: true })) {
          a.props++;
          return sl;
        }
      }
      return false;
    };
    const budget = Math.max(2, Math.min(12, Math.round(a.length / 2.2)));
    // a rain butt under a downpipe, the pipe up to the eaves
    if (R() < 0.7) {
      const sl = tryPut("rain_butt", (q) => q.w.H > 3.5);
      if (sl) {
        const w = sl.w;
        const x = w.ax + w.tx * sl.s;
        const z = w.az + w.tz * sl.s;
        const top = w.H - 0.35;
        put("downpipe", x, 2.0, z, w.yaw, 1, top - 2.0, 1);
        put("rain_head", x, top, z, w.yaw);
        put("wet", x + w.ox * 0.95, 0.01, z + w.oz * 0.95, w.yaw);
        put("streak", x + w.tx * 0.25 + w.ox * 0.004, top - 2.2, z + w.tz * 0.25 + w.oz * 0.004, w.yaw, 1, 1.2, 1);
      }
    }
    // rubbish where it gathers: at the dead end, else anywhere
    if (R() < 0.6 && !tryPut("rubbish", (q) => !a.through && nearEnd(q)) && R() < 0.5) tryPut("rubbish");
    // a cat asleep somewhere out of the way
    if (R() < 0.3) tryPut(R() < 0.4 ? "cat_grey" : R() < 0.5 ? "cat_black" : "cat_ginger");
    for (let k = a.props; k < budget; k++) tryPut(pickW(R, ALLEY_KIT));
    // moss and damp low on the walls, a water streak here and there; leaves and sweepings in the corners
    const byWall = new Map<Wall, number[]>();
    for (const sl of slots) {
      let l = byWall.get(sl.w);
      if (!l) byWall.set(sl.w, (l = []));
      l.push(sl.s);
    }
    for (const [w, ss] of byWall) {
      ss.sort((p, q) => p - q);
      const s0 = ss[0] - 0.3;
      const s1 = ss[ss.length - 1] + 0.3;
      const len = s1 - s0;
      const n = Math.max(1, Math.round(len / 2));
      const u = len / n;
      const kerb = w.kind === 0 && onKerb(w.ax + w.tx * (s0 + len / 2) + w.ox * 0.3, w.az + w.tz * (s0 + len / 2) + w.oz * 0.3) ? KERB_Y : 0;
      for (let k = 0; k < n; k++) {
        if (R() < 0.25) continue;
        const s = s0 + u * (k + 0.5);
        put(R() < 0.5 ? "moss_low" : "moss_low_b", w.ax + w.tx * s + w.ox * 0.012, kerb, w.az + w.tz * s + w.oz * 0.012, w.yaw, u / 2, 0.7 + R() * 0.6, 1);
      }
      if (R() < 0.5) {
        const s = s0 + R() * len;
        put("streak", w.ax + w.tx * s + w.ox * 0.013, 0.8 + R() * 1.4, w.az + w.tz * s + w.oz * 0.013, w.yaw, 1, 1 + R(), 1);
      }
      for (let k = 0; k < Math.round(len / 4); k++) {
        const s = s0 + R() * len;
        const x = w.ax + w.tx * s + w.ox * (kerb ? KERB + 0.35 : 0.4);
        const z = w.az + w.tz * s + w.oz * (kerb ? KERB + 0.35 : 0.4);
        if (at(x, z) === OPEN) put(R() < 0.6 ? "leaves" : "sweepings", x, 0.008 + k * 0.001, z, w.yaw + (R() - 0.5) * 0.5, 0.8 + R() * 0.4, 1, 0.8 + R() * 0.4);
      }
    }
    // a washing line across, from wall to wall, below the eaves
    if (R() < 0.75 && !lineSites.some((s) => Math.hypot(s.x - a.x, s.z - a.z) < 8)) {
      const sl = pickSlot((q) => q.W > 1.4 && q.W < 6 && q.w.H > 4.5);
      if (sl) {
        const w = sl.w;
        const x0 = w.ax + w.tx * sl.s;
        const z0 = w.az + w.tz * sl.s;
        const D = sl.W;
        const y = Math.min(w.H - 0.8, 3.0 + R() * 1.4);
        const sag = 0.12 + D * 0.04;
        // two lengths of rope, down to the middle and up again
        const half = D / 2;
        const tilt = Math.atan2(sag, half);
        const len = Math.hypot(half, sag);
        const yaw = Math.atan2(w.ox, w.oz) - Math.PI / 2; // local +x along the outward normal
        for (const [px, py, pz, pitch] of [
          [x0, y, z0, -tilt],
          [x0 + w.ox * half, y - sag, z0 + w.oz * half, tilt],
        ] as Array<[number, number, number, number]>) {
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, pitch, "YXZ"));
          puts.push({ name: "rope_unit", m: new THREE.Matrix4().compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(len, 1, 1)), shade: 1 });
        }
        count("washing line");
        const kinds = ["cloth_shirt_0", "cloth_shirt_1", "cloth_sheet_0", "cloth_sheet_1", "cloth_trousers_0", "cloth_trousers_1", "cloth_stockings_0", "cloth_towel_0", "cloth_apron_0", "cloth_shift_0"];
        let t = 0.35 + R() * 0.3;
        while (t < D - 0.4) {
          const kind = kinds[Math.floor(R() * kinds.length)];
          const wide = kind.includes("sheet") ? 1.3 : kind.includes("stockings") ? 0.45 : 0.6;
          if (t + wide / 2 > D - 0.3) break;
          const tt = t + wide / 2;
          const yy = y - sag * (1 - Math.pow((tt - half) / half, 2));
          // the garment's plane across the line (its x along the line)
          put(kind, x0 + w.ox * tt, yy, z0 + w.oz * tt, Math.atan2(w.ox, w.oz) - Math.PI / 2, 1, 1, 1, 0.9 + R() * 0.15);
          t += wide + 0.08 + R() * 0.35;
        }
      }
    }
    alleyProps += a.props;
  }

  // ================================================================ (b) the streets and squares
  await sleep(0);
  let streetProps = 0;
  const nearMarket = (x: number, z: number) => markets.some((q) => inR(q, x, z, 12));
  const pumpsAt: P[] = sites.filter((s) => /^(pump|well|trough)/.test(s.kind)).map((s) => [s.x, s.z]);
  const myPumps: P[] = [];
  for (const w of [...walls, ...landmarkWalls]) {
    rejTag = w.kind === 2 ? "landmark " : "";
    const R = rng(seed * 3 + w.seed * 17 + Math.round(w.ax * 7 + w.az * 3));
    let s = 0.8 + R() * 4;
    // bills and pumps: once in a gap's length at most
    let extraAt = s;
    while (s < w.L - 0.8) {
      const bx = w.ax + w.tx * s;
      const bz = w.az + w.tz * s;
      // how wide the street is here: to the house opposite
      const W = across(bx, bz, w.ox, w.oz, 30);
      const c = cellOf(bx + w.ox * 0.75, bz + w.oz * 0.75);
      if (c < 0 || W < 0.8 || (label[c] >= 0 && alleys[label[c]].keep) || W <= ALLEY_MAX + 0.4) {
        no(W < 0.8 ? "skip: no ground" : "skip: alley");
        s += 2;
        continue;
      }
      const wide = W >= 9;
      const market = nearMarket(bx, bz);
      const gap = market ? 3.5 + R() * 3 : wide ? 4 + R() * 3.5 : 9 + R() * 6;
      // how far out: never into the walking line
      const maxDep = W >= 12 ? Math.min(2.3, 0.6 + W * 0.12) : Math.min(1.9, 0.6 + W * 0.09);
      const cart = W >= 12 ? 2 : wide ? 1 : 0;
      const door = doorNear(bx, bz, 1.2, 2.6);
      let kit: Array<[string, number]>;
      if (market) kit = [["leftovers", 3], ["baskets", 2], ["crates", 2], ["crate_broken", 1.2], ["sacks", 1], ["barrel", 0.8]];
      else if (shopFront(bx + w.ox * 0.4, bz + w.oz * 0.4)) kit = [["crates", 2], ["sacks", 2], ["barrel", 1.5], ["baskets", 1.5], ["crate", 1], ["keg", 0.8]];
      else if (door) kit = [["bench", 3], ["barrel", 1], ["keg", 0.8], ["baskets", 0.6], ["cat_grey", 0.25], ["cat_ginger", 0.2], ["broom", 0.6]];
      else if (w.kind === 2) kit = [["crates", 2], ["barrel", 2], ["sacks", 1.5], ["keg", 1], ["handcart", cart], ["bench", 1], ["crate_broken", 0.5], ["baskets", 0.6]];
      else if (w.kind === 1) kit = [["crates", 1.5], ["barrel", 1.5], ["bench", 1], ["sacks", 1], ["handcart", cart], ["broom", 0.5], ["shovel", 0.3], ["rain_butt", 0.7], ["crate_broken", 0.6]];
      else kit = [["barrel", 2], ["keg", 1], ["crates", 1.5], ["crate", 1], ["sacks", 1.5], ["baskets", 1], ["bench", 1], ["handcart", cart], ["rain_butt", 0.4], ["crate_broken", 0.5], ["broom", 0.3]];
      let done = false;
      // (a door, a shop or a lane in the way: try again a metre on)
      const tries = [0, 0.4];
      for (let k = 0; k < tries.length && !done; k++) {
        const name = pickW(R, kit);
        const s2 = s + tries[k];
        if (s2 < 0.6 || s2 > w.L - 0.6) continue;
        done = againstWall(name, w, s2, maxDep, { market });
        if (done) {
          s = s2;
          streetProps++;
          if (name === "rain_butt" && w.H > 3.5) {
            const px = w.ax + w.tx * s;
            const pz = w.az + w.tz * s;
            put("downpipe", px, 2.0, pz, w.yaw, 1, w.H - 2.35, 1);
            put("rain_head", px, w.H - 0.35, pz, w.yaw);
          }
          // more beside the first now and then (barrels in twos, a crate by the sacks)
          let sn = s;
          for (let m = 0; m < 2 && R() < (wide ? 0.55 : 0.3); m++) {
            sn += 0.95 + R() * 0.3;
            if (sn < w.L - 0.6 && againstWall(pickW(R, [["barrel", 2], ["keg", 1.5], ["crate", 1], ["crates", 0.8], ["sacks", 0.8], ["broom", 0.5]]), w, sn, maxDep, { market })) {
              streetProps++;
              s = sn;
            } else break;
          }
        }
      }
      const extra = s >= extraAt;
      if (extra) extraAt = s + gap;
      // a bill on a blank wall
      if (extra && w.kind === 1 && W > 3 && R() < 0.4 && at(bx + w.ox * 0.8, bz + w.oz * 0.8) === OPEN && !atDoor(bx, bz, 0.5)) {
        const key = ["poster_auction", "poster_theatre", "poster_reward"][Math.floor(R() * 3)];
        const ps = s + 1.4;
        if (ps < w.L - 0.6) put(key, w.ax + w.tx * ps + w.ox * 0.016, (R() - 0.3) * 0.25, w.az + w.tz * ps + w.oz * 0.016, w.yaw);
      }
      // a pump and a trough on a square that has none
      if (extra && W >= 14 && !market && myPumps.length < 6 && ![...pumpsAt, ...myPumps].some(([x, z]) => Math.hypot(x - bx, z - bz) < 45) && s > 2.5 && s < w.L - 2.5) {
        const px = bx + w.ox * 0.45;
        const pz = bz + w.oz * 0.45;
        const tx = bx + w.tx * 1.75 + w.ox * 0.5;
        const tz = bz + w.tz * 1.75 + w.oz * 0.5;
        const y = w.kind === 0 && onKerb(bx + w.ox * 0.3, bz + w.oz * 0.3) ? KERB_Y : 0;
        if (freeAt(px + w.ox * 0.5, pz + w.oz * 0.5, 0.7, { wall: true }) && freeAt(tx + w.ox * 0.5, tz + w.oz * 0.5, 1.1, { wall: true }) && at(tx + w.tx * 1.1 + w.ox * 0.5, tz + w.tz * 1.1 + w.oz * 0.5) === OPEN && !atDoor(tx + w.tx, tz + w.tz, 0.3)) {
          put("pump", px, y, pz, w.yaw);
          collide("pump", px, pz, w.yaw, 0.05);
          put("trough", tx, y, tz, w.yaw);
          collide("trough", tx, tz, w.yaw, 0.03);
          taken.push([px, pz, 1.0], [tx, tz, 1.2]);
          put("wet", tx + w.ox * 1.0, 0.01, tz + w.oz * 1.0, w.yaw, 1.3, 1, 1);
          myPumps.push([bx, bz]);
          streetProps += 2;
        }
      }
      s += done ? gap : 1.0;
    }
  }
  rejTag = "";
  // corners: a guard stone or a bollard at the foot of a house corner on the wider streets
  for (const [x, z, dx, dz, , , , , , , , , , , store] of sl.corners) {
    const R = rng(Math.round(x * 13 + z * 7) + 5);
    if (R() > 0.35) continue;
    if (across(x, z, dx, dz, 8) < 4) continue;
    const px = x + dx * 0.42;
    const pz = z + dz * 0.42;
    if (at(x + dx * 0.9, z + dz * 0.9) !== OPEN || !freeAt(px, pz, 0.25, { wall: true, loose: true })) continue;
    const name = store || R() < 0.7 ? "guard_stone" : "street_bollard";
    put(name, px, 0, pz, R() * 6.28);
    colliders.push({ minX: px - 0.18, maxX: px + 0.18, minZ: pz - 0.18, maxZ: pz + 0.18, top: 0.8 });
    taken.push([px, pz, 0.3]);
    streetProps++;
  }

  // ================================================================ (c) the street ends
  await sleep(0);
  const ends = findEnds(flags);
  const hauls: P[] = TOWN_CLEAR.map(([x, z]) => [x, z]);
  const gapPts = () => [
    ...quay.flights.map((f) => ({ x: f.top[0], z: f.top[1], r: 2.2 })),
    ...quay.ladders.map((l) => ({ x: l.x, z: l.z, r: 1.1 })),
    ...hauls.map(([x, z]) => ({ x, z, r: 2.2 })),
  ];
  const gaps = gapPts();
  const lateLanes = [...lanes, ...tracks];
  let endsFixed = 0;
  /** Dev: per street end, what stopped the edge where it stops. */
  const endWhy: Array<{ x: number; z: number; style: string; done: number; why: Record<string, number> }> = [];
  for (const e of ends) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az);
    const tx = (e.bx - e.ax) / L;
    const tz = (e.bz - e.az) / L;
    const yaw = Math.atan2(e.nx, e.nz); // local +z inland
    const lx = Math.cos(yaw);
    const lz = -Math.sin(yaw);
    const flip = lx * tx + lz * tz < 0; // local +x runs from a to b?
    const mx = (e.ax + e.bx) / 2;
    const mz = (e.az + e.bz) / 2;
    if (e.kind === "map edge") {
      // a stretch of the city wall, with a closed gate if the street is wide enough
      if (lateLanes.some((q) => segD((q.minX + q.maxX) / 2, (q.minZ + q.maxZ) / 2, e.ax, e.az, e.bx, e.bz) < 1.5)) continue;
      const gate = L >= 6.5;
      const gw = 4.8;
      const pieces: Array<[number, number]> = gate ? [[0, (L - gw) / 2], [(L + gw) / 2, L]] : [[0, L]];
      for (const [s0, s1] of pieces) {
        const len = s1 - s0;
        if (len < 0.05) continue;
        const n = Math.max(1, Math.round(len));
        const u = len / n;
        for (let k = 0; k < n; k++) {
          const s = flip ? s0 + u * (k + 1) : s0 + u * k;
          put("citywall_unit", e.ax + tx * s, 0, e.az + tz * s, yaw, u, 1.45, 1, 0.85 + ((k * 7) % 5) * 0.04);
        }
      }
      if (gate) put("citygate", mx, 0, mz, yaw, 1, 1.15, 1);
      const back = 1.0;
      colliders.push({ minX: Math.min(e.ax, e.bx, e.ax - e.nx * back, e.bx - e.nx * back) - 0.05, maxX: Math.max(e.ax, e.bx, e.ax - e.nx * back, e.bx - e.nx * back) + 0.05, minZ: Math.min(e.az, e.bz, e.az - e.nz * back, e.bz - e.nz * back) - 0.05, maxZ: Math.max(e.az, e.bz, e.az - e.nz * back, e.bz - e.nz * back) + 0.05 });
      treated.push({ ax: e.ax, az: e.az, bx: e.bx, bz: e.bz, end: "wall" });
      count("end wall");
      endsFixed++;
      continue;
    }
    // at the water: which kind of end fits
    const working = runways.some((q) => inR(q, mx + e.nx * 1.0, mz + e.nz * 1.0, 1.2));
    const dock = mx > 60 && mz > 40; // the Petit Bassin: the dock's barriers
    const style = working ? "kerb" : dock || L < 5 ? "barrier" : "chain";
    // cut the line at the steps, ladders and haul points, and where something else already stands
    const why = (s: number): string | null => {
      const x = e.ax + tx * s;
      const z = e.az + tz * s;
      if (gaps.some((g) => Math.hypot(g.x - x, g.z - z) < g.r)) return "steps";
      if (bridges.some((q) => inR(q, x, z))) return "bridge";
      // (the walk map keeps the first half metre of a quay off limits: look just inside that)
      const ix = x + e.nx * 0.9;
      const iz = z + e.nz * 0.9;
      if (at(ix, iz) !== OPEN) return "ground";
      // where the kerb, the posts or the barrier stand
      const px = x + e.nx * (style === "barrier" ? 0.45 : 0.2);
      const pz = z + e.nz * (style === "barrier" ? 0.45 : 0.2);
      if (avoid.some((q) => inR(q, px, pz, 0.1))) return "solid";
      if (style === "kerb") return null; // a low kerb at the very edge: rails, lanes and cranes pass inland of it
      if (lanes.some((q) => inR(q, px, pz, 0.2))) return "lane";
      if (tracks.some((q) => inR(q, px, pz, 0.2))) return "rails";
      return runways.some((q) => inR(q, px, pz, 0.2)) ? "runway" : null;
    };
    const whyN: Record<string, number> = {};
    const free = (s: number) => {
      const w = why(s);
      if (w) whyN[w] = (whyN[w] ?? 0) + 1;
      return !w;
    };
    const runs: Array<[number, number]> = [];
    let cur: [number, number] | null = null;
    for (let s = 0; s <= L + 1e-6; s += 0.25) {
      if (free(s)) {
        if (!cur) cur = [s, s];
        cur[1] = s;
      } else if (cur) {
        runs.push(cur);
        cur = null;
      }
    }
    if (cur) runs.push(cur);
    let done = 0;
    for (const [s0, s1] of runs) {
      const len = s1 - s0;
      if (len < 0.6) continue;
      done += len;
      // the edge kerb, its water face on the quay line
      const n = Math.max(1, Math.round(len));
      const u = len / n;
      if (style !== "barrier") {
        for (let k = 0; k < n; k++) {
          const s = flip ? s0 + u * (k + 1) : s0 + u * k;
          put("kerb_quay", e.ax + tx * s, 0, e.az + tz * s, yaw, u, 1, 1, 0.9 + ((k * 3) % 4) * 0.05);
        }
        const k0x = e.ax + tx * s0;
        const k0z = e.az + tz * s0;
        const k1x = e.ax + tx * s1;
        const k1z = e.az + tz * s1;
        colliders.push({ minX: Math.min(k0x, k1x, k0x + e.nx * 0.37, k1x + e.nx * 0.37), maxX: Math.max(k0x, k1x, k0x + e.nx * 0.37, k1x + e.nx * 0.37), minZ: Math.min(k0z, k1z, k0z + e.nz * 0.37, k1z + e.nz * 0.37), maxZ: Math.max(k0z, k1z, k0z + e.nz * 0.37, k1z + e.nz * 0.37), top: 0.26 });
      }
      if (style === "chain" || style === "barrier") {
        // posts every 2 m or so; the chain (or the rails) between them
        const inset = style === "chain" ? 0.2 : 0.45;
        const y = style === "chain" ? 0.26 : 0;
        const np = Math.max(1, Math.round(len / 2));
        const step = len / np;
        for (let k = 0; k <= np; k++) {
          const s = s0 + step * k;
          const x = e.ax + tx * s + e.nx * inset;
          const z = e.az + tz * s + e.nz * inset;
          if (style === "chain") put("chain_post", x, y, z, yaw);
          else put("barrier_post", x, y, z, yaw);
          colliders.push({ minX: x - 0.12, maxX: x + 0.12, minZ: z - 0.12, maxZ: z + 0.12, top: 1.1 });
          if (k < np) {
            const sa = flip ? s + step : s;
            const px = e.ax + tx * sa + e.nx * inset;
            const pz = e.az + tz * sa + e.nz * inset;
            if (style === "chain") put("chain_span", px, y, pz, yaw, step, 1, 1);
            else put("barrier_unit", px, y, pz, yaw, step, 1, 1);
            // the chain or rails stop a walker (like the railings)
            for (let q = 0.25; q < step; q += 0.5) {
              const cx2 = x + tx * q;
              const cz2 = z + tz * q;
              colliders.push({ minX: cx2 - 0.28, maxX: cx2 + 0.28, minZ: cz2 - 0.28, maxZ: cz2 + 0.28, top: 1.0 });
            }
          }
        }
      }
      treated.push({ ax: e.ax + tx * s0, az: e.az + tz * s0, bx: e.ax + tx * s1, bz: e.az + tz * s1, end: style });
    }
    endWhy.push({ x: +mx.toFixed(1), z: +mz.toFixed(1), style, done: +done.toFixed(1), why: whyN });
    if (done > 0) {
      endsFixed++;
      count(`end ${style}`);
    }
  }
  checkState = { flags, treated, gaps: gapPts };

  // ================================================================ build: merged per chunk and slot
  const solidMat = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true, side: THREE.DoubleSide }), { affine: 0 });
  const decalMat = psx(
    new THREE.MeshLambertMaterial({ map: decalMap, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
    { affine: 0, noSnap: true },
  );
  solidMat.name = "clutter_solid";
  decalMat.name = "clutter_decal";
  const buckets = new Map<string, { slot: number; n: number; items: Array<{ part: Part; m: THREE.Matrix4; shade: number }> }>();
  for (const p of puts) {
    const proto = protos.get(p.name)!;
    const e = p.m.elements;
    const key0 = `${Math.floor(e[12] / CHUNK)},${Math.floor(e[14] / CHUNK)}`;
    for (const part of proto.parts) {
      const key = `${key0},${part.slot}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { slot: part.slot, n: 0, items: [] }));
      b.items.push({ part, m: p.m, shade: p.shade });
      b.n += part.pos.length / 3;
    }
  }
  const group = new THREE.Group();
  group.name = "clutter";
  const chunks: THREE.Mesh[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  let triangles = 0;
  for (const b of buckets.values()) {
    const pos = new Float32Array(b.n * 3);
    const nor = new Float32Array(b.n * 3);
    const uv = new Float32Array(b.n * 2);
    const col = new Float32Array(b.n * 3);
    let o = 0;
    for (const { part, m, shade } of b.items) {
      nm.getNormalMatrix(m);
      const k = part.pos.length / 3;
      for (let i = 0; i < k; i++) {
        v.set(part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]).applyMatrix4(m);
        pos[(o + i) * 3] = v.x;
        pos[(o + i) * 3 + 1] = v.y;
        pos[(o + i) * 3 + 2] = v.z;
        v.set(part.nor[i * 3], part.nor[i * 3 + 1], part.nor[i * 3 + 2]).applyMatrix3(nm).normalize();
        nor[(o + i) * 3] = v.x;
        nor[(o + i) * 3 + 1] = v.y;
        nor[(o + i) * 3 + 2] = v.z;
        uv[(o + i) * 2] = part.uv[i * 2];
        uv[(o + i) * 2 + 1] = part.uv[i * 2 + 1];
        col[(o + i) * 3] = part.col[i * 3] * shade;
        col[(o + i) * 3 + 1] = part.col[i * 3 + 1] * shade;
        col[(o + i) * 3 + 2] = part.col[i * 3 + 2] * shade;
      }
      o += k;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, b.slot === DECAL ? decalMat : solidMat);
    mesh.name = b.slot === DECAL ? "clutter_decals" : "clutter_solid";
    if (b.slot === DECAL) mesh.renderOrder = 2;
    group.add(mesh);
    chunks.push(mesh);
    triangles += b.n / 3;
  }
  // the back walls and their roofs: three meshes for the whole town (a few hundred triangles)
  const closureMats = [
    psx(new THREE.MeshLambertMaterial({ map: brickTexture("#7c4130", "#9a7a66", 41), vertexColors: true, side: THREE.DoubleSide }), { affine: 0, wet: true }),
    psx(new THREE.MeshLambertMaterial({ map: brickTexture("#51302a", "#6e5448", 42), vertexColors: true, side: THREE.DoubleSide }), { affine: 0, wet: true }),
    psx(new THREE.MeshLambertMaterial({ map: tileTexture(43), vertexColors: true, side: THREE.DoubleSide }), { affine: 0 }),
  ];
  closureGeo.forEach((cb, i) => {
    if (!cb.pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(cb.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(cb.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(cb.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cb.col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, closureMats[i]);
    mesh.name = ["clutter_backwalls", "clutter_backwalls_dark", "clutter_leanto_roofs"][i];
    group.add(mesh);
    triangles += cb.pos.length / 9;
  });
  // before each render: hide the chunks beyond the fog (chained onto the scene's own hook)
  const hideFar = (cam: THREE.Camera) => {
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 60) + 10;
    const p = cam.position;
    for (const m of chunks) {
      const s = m.geometry.boundingSphere!;
      m.visible = s.center.distanceTo(p) - s.radius < far;
    }
  };
  type SceneHook = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null) => void;
  const hooked = scene as unknown as { onBeforeRender: SceneHook };
  const before = hooked.onBeforeRender;
  hooked.onBeforeRender = function (this: THREE.Scene, renderer, sc, cam, target) {
    before?.call(this, renderer, sc, cam, target);
    hideFar(cam);
  };
  scene.add(group);

  const stats: Clutter["stats"] = {
    counts,
    endWhy,
    rej,
    alleys: kept.length,
    deadEnds: kept.filter((a) => !a.through && a.end).length,
    closures,
    alleyProps,
    streetProps,
    ends: endsFixed,
    meshes: chunks.length,
    triangles: Math.round(triangles),
  };
  const result: Clutter = {
    group,
    colliders,
    stats,
    alleys: kept.map((a) => ({ x: +a.x.toFixed(1), z: +a.z.toFixed(1), length: +a.length.toFixed(1), width: +a.width.toFixed(1), through: a.through, props: a.props, closure: a.closure, end: a.end && a.closure && !a.closure.startsWith("(") ? { x: +a.end.x.toFixed(2), z: +a.end.z.toFixed(2), dx: a.end.dx, dz: a.end.dz, width: +a.end.span.toFixed(2) } : undefined })),
  };
  last = result;
  return result;
}

let last: Clutter | null = null;
/** Dev: what the clutter layer placed (counts, the alleys it found), or null before it is built. */
export function clutterInfo(): Pick<Clutter, "stats" | "alleys"> | null {
  return last ? { stats: last.stats, alleys: last.alleys } : null;
}
