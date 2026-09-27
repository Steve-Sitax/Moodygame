import { modelCollider, modelShape } from "./modelCollision";
import { TOWN } from "./townBox";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import TOWN_PLACES from "../../../shared/townplaces.json"; // package 1: the trees of the squares and greens
import { MARKET_DAYS, marketShare } from "../../../server/src/town/market";
import { marketKeepOut } from "../game/market";
import { psx, psxUniforms, waveAt } from "../retro/psx";
import { levelAt } from "./tide";
import { cartRoads, dirtStamp } from "./dirt";
import type { Rect } from "./geom";
import { omnibusKeepOut, STOPS as OMNIBUS_STOPS } from "./omnibus";
import { trackKeepOut, type TrackData } from "./tracks";
import { SITES as TRADE_SITES, tradeKeepOut } from "./trades";
import { TRAFFIC_ROUTES, trafficLanes } from "./traffic";
import { addProp, dropProps } from "./propSpots";
import { kerbFront, type GroundProbe, type WallProbe } from "./wallprobe";

// Litter (M3j, Steve: "research trash and dirt at that time, I feel we need that more").
// The waste of a port town in 1873, after the research in docs/milestones/M3j-filth.md:
// horse dung thick on the cart roads (world/ruts.ts) and where horses stand (the omnibus
// stops, the drays' stops, the farrier), straw, the gutters' dark water running to the
// drains, urine at the corners, ash put out by the doors and slops thrown from them, fish
// heads, guts, scales and shells on the Vismarkt (more after the market than during it),
// cabbage leaves and rotten vegetables on the Grote Markt, coal dust and lumps by the coal
// heaps, tar by the fires, broken crates, sacking, rope ends, bottles, crocks, paper, now and
// then a dead rat; a refuse heap in a back corner or two and a stable's manure heap with the
// dung collector's barrow; rubbish floating in the vliet and the canal, whose water is
// fouler by the walls (psx water uFoul). Less on the squares the sweepers kept (the Grote
// Markt, the Handschoenmarkt before the cathedral); nothing on doors, job spots, stairs,
// rails, bridges or workplaces, and nothing solid on the omnibus lanes but dung where the
// horses stand.
//
// Models: tools/blender/build_litter.py -> /models/litter.glb. Drawing: three BatchedMeshes
// (solid bits, flat marks, floating things and rats): three draw calls for the whole city.
// Copies are grouped in 32 m chunks and hidden beyond the fog.

type Flags = (x: number, z: number) => number | undefined;
type P = [number, number];

export interface LitterOptions {
  seed?: number;
  /** Colliders already on the ground (props, pumps, quay furniture, cranes): no solid litter on them. */
  avoid?: Rect[];
  /** Where the quay furniture put its bigger things (coal heaps, tar fires): coal dust and tar there. */
  quaySites?: Array<{ kind: string; x: number; z: number }>;
  /** The stone steps and ladders (world.quayInfo): kept clear. */
  quayInfo?: () => { flights: Array<{ top: [number, number]; end: [number, number] }>; ladders: Array<{ x: number; z: number; top: number }> };
  /** Open water clear of hulls, piles and steps (world.swimFree): where rubbish may float. */
  swimFree?: (x: number, z: number, r: number) => boolean;
  /** The still water level (rijnkaai WATER_Y). */
  waterY?: number;
  /** The houses as built (world/wallprobe.ts): the kerbs where they really are, heaps a hand off the real wall. */
  probe?: WallProbe;
  /** The ground as built: a heap stands flat on the street, not half on a kerb. */
  ground?: GroundProbe;
}

export interface Litter {
  group: THREE.Group;
  /** Walk colliders of the heaps; add them to the world. */
  colliders: Rect[];
  /** Once a frame (floating rubbish bobs, rats run at night, chunks beyond the fog hide). */
  update(t: number, dt: number, cam?: THREE.Camera): void;
  stats: { counts: Record<string, number>; solid: number; flat: number; floating: number; triangles: number; gutterMetres: number };
  /** The heaps and stands, for maps and checks. */
  sites: Array<{ kind: string; x: number; z: number }>;
}

let clockDay = 2;
let clockHour = 15;
/** The game clock (main.ts, once a frame): the market's waste comes and goes with it, rats come out at night. */
export function setLitterClock(day: number, hour: number): void {
  clockDay = day;
  clockHour = hour;
}

interface Proto {
  geo: THREE.BufferGeometry;
  tris: number;
  r: number;
  /** How far it reaches from its origin on the ground plan (m), its height, and its lowest point (under 0: it goes into the ground). */
  rxz: number;
  h: number;
  y0: number;
}
interface Meta {
  decals: Record<string, { cell: [number, number, number, number]; w: number; d: number }>;
  decalSize: [number, number];
}
interface CityData {
  places: Record<string, { x: number; z: number; kind: string }>;
  doors: Record<string, { x: number; z: number; out: [number, number]; width: number }>;
  bridges: Record<string, number[]>;
  quays: number[][];
  decor?: TrackData & { crane_rails?: number[][] };
}
interface SLMeta {
  walls: number[][];
  corners: number[][];
}

const OPEN = 0;
const WATER = 2;
const CH = 32;
const X0 = TOWN.x0;
const Z0 = TOWN.z0;
const MW = Math.round(TOWN.w);
const MH = Math.round(TOWN.h);
const KERB = 0.7;
const KERB_Y = 0.12;

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

/** A triangle of the gutter (x, z, u, v, alpha per corner), wound to face up whatever order it came in. */
function upTri(buf: number[], a: number[], b: number[], c: number[]): void {
  const cross = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  if (cross >= 0) buf.push(...a, ...b, ...c);
  else buf.push(...a, ...c, ...b);
}

// ------------------------------------------------------------------ loading

/** Non-indexed position / normal / uv / colour arrays of a glb node, one set per material. */
async function loadModels(): Promise<{ solid: Map<string, Proto>; meta: Meta; solidMap: THREE.Texture; decalMap: THREE.Texture }> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/litter.glb");
  draco.dispose();
  let meta: Meta | null = null;
  let solidMap: THREE.Texture | null = null;
  let decalMap: THREE.Texture | null = null;
  const solid = new Map<string, Proto>();
  const v = new THREE.Vector3();
  const nrm = new THREE.Matrix3();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    if (node.name === "litter_meta") {
      meta = JSON.parse(node.userData.meta as string) as Meta;
      continue;
    }
    const pos: number[] = [];
    const nor: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.map) {
        if (mat.name === "lt_decal") decalMap ??= mat.map;
        else solidMap ??= mat.map;
      }
      if (mat.name === "lt_decal") return;
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      nrm.getNormalMatrix(M);
      const Pa = g.getAttribute("position");
      const Na = g.getAttribute("normal");
      const Ua = g.getAttribute("uv");
      const Ca = g.getAttribute("color");
      for (let i = 0; i < Pa.count; i++) {
        v.fromBufferAttribute(Pa, i).applyMatrix4(M);
        pos.push(v.x, v.y, v.z);
        if (Na) {
          v.fromBufferAttribute(Na, i).applyMatrix3(nrm).normalize();
          nor.push(v.x, v.y, v.z);
        } else nor.push(0, 1, 0);
        uv.push(Ua ? Ua.getX(i) : 0, Ua ? Ua.getY(i) : 0);
        col.push(Ca ? Ca.getX(i) : 1, Ca ? Ca.getY(i) : 1, Ca ? Ca.getZ(i) : 1);
      }
    });
    if (!pos.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    let rxz = 0;
    let h = 0;
    let y0 = Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      rxz = Math.max(rxz, Math.hypot(pos[i], pos[i + 2]));
      h = Math.max(h, pos[i + 1]);
      y0 = Math.min(y0, pos[i + 1]);
    }
    solid.set(node.name, { geo, tris: pos.length / 9, r: geo.boundingSphere?.radius ?? 0.3, rxz, h, y0 });
  }
  if (!meta || !solidMap || !decalMap) throw new Error("litter.glb: meta or textures missing");
  for (const t of [solidMap as THREE.Texture, decalMap as THREE.Texture]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
  }
  return { solid, meta, solidMap, decalMap };
}

/** The house walls and corners carried in streetlife.glb: read from its JSON chunk only (no meshes decoded). */
async function loadWalls(): Promise<SLMeta> {
  const buf = await (await fetch("/models/streetlife.glb")).arrayBuffer();
  const dv = new DataView(buf);
  const len = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len))) as { nodes: Array<{ name?: string; extras?: { meta?: string } }> };
  const node = json.nodes.find((n) => n.name === "streetlife_meta");
  if (!node?.extras?.meta) throw new Error("streetlife.glb: no meta");
  const m = JSON.parse(node.extras.meta) as SLMeta;
  return { walls: m.walls, corners: m.corners };
}

// ------------------------------------------------------------------ placing

type Layer = "solid" | "flat" | "float";
interface Put {
  layer: Layer;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  sx: number;
  sz: number;
  shade: number;
  /** Market waste: which market, and the level (0..1) at which it shows. */
  market?: string;
  u?: number;
  /** One heap and what belongs to it (the dung barrow against the manure heap): the prop check lets them touch. */
  set?: string;
}

/**
 * The litter layer. Call after the city (the walk map) and the quay furniture are in.
 * Resolves when everything is placed and in the scene.
 */
export async function createLitter(scene: THREE.Scene, flags: Flags, opts: LitterOptions = {}): Promise<Litter> {
  const [{ solid: protos, meta, solidMap, decalMap }, sl] = await Promise.all([loadModels(), loadWalls()]);
  for (let i = 0; i < 600 && flags(0, 0) === undefined; i++) await sleep(100);
  // the cart roads as the ruts found them (they come a road at a time after the city)
  const roads = await Promise.race([cartRoads(), sleep(30000).then(() => [] as P[][])]);
  const city = CITY as unknown as CityData;
  const seed = opts.seed ?? 1873;
  // each pass draws from its own stream: a change in one does not reshuffle the others
  let R = rng(seed);
  const waterY = opts.waterY ?? -2.8;
  const at = (x: number, z: number) => flags(x, z) ?? -1;
  const counts: Record<string, number> = {};
  const puts: Put[] = [];
  const stamps: Array<[number, number, number, number]> = [];
  const colliders: Rect[] = [];
  const sites: Litter["sites"] = [];

  // ---------------------------------------------------------------- keep-outs
  const inR = (r: Rect, x: number, z: number, pad = 0) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
  const decor = city.decor ?? {};
  const tracks = trackKeepOut(decor);
  // the omnibus lanes and the drays' and handcarts' lanes (world/traffic.ts), as boxes every 2 m
  const lanes = omnibusKeepOut();
  for (const l of trafficLanes()) for (let i = 0; i < l.x.length; i += 8) lanes.push({ minX: l.x[i] - l.half, maxX: l.x[i] + l.half, minZ: l.z[i] - l.half, maxZ: l.z[i] + l.half });
  const markets = marketKeepOut();
  const trades = tradeKeepOut();
  const runways: Rect[] = (decor.crane_rails ?? []).map(([x0, z0, x1, z1]) => ({ minX: Math.min(x0, x1) - 0.9, maxX: Math.max(x0, x1) + 0.9, minZ: Math.min(z0, z1) - 0.9, maxZ: Math.max(z0, z1) + 0.9 }));
  const bridges: Rect[] = Object.values(city.bridges).map((b) => ({ minX: Math.min(b[0], b[2]) - 1.5, maxX: Math.max(b[0], b[2]) + 1.5, minZ: Math.min(b[1], b[3]) - 1.5, maxZ: Math.max(b[1], b[3]) + 1.5 }));
  const avoid = opts.avoid ?? [];
  const clear: Array<{ x: number; z: number; r: number }> = [];
  for (const d of Object.values(city.doors)) clear.push({ x: d.x + d.out[0] * 1.5, z: d.z + d.out[1] * 1.5, r: Math.min(d.width / 2, 6) + 2 });
  for (const [k, s] of Object.entries(SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>)) {
    if (!k.startsWith("_") && s.x !== undefined && s.z !== undefined) clear.push({ x: s.x, z: s.z, r: 2.2 });
  }
  const START: Rect = { minX: -72, maxX: 66, minZ: -30, maxZ: 27 }; // the game's own quay (props3d keepOut)
  const quay = opts.quayInfo?.() ?? { flights: [], ladders: [] };
  const segD = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    return Math.hypot(x - ax - dx * t, z - az - dz * t);
  };
  const nearSteps = (x: number, z: number, r: number) =>
    quay.flights.some((f) => segD(x, z, f.top[0], f.top[1], f.end[0], f.end[1]) < r + 1.4) || quay.ladders.some((l) => Math.hypot(l.x - x, l.z - z) < r + 0.9);

  // the house walls: street fronts have a kerb 0.7 m deep (tools/blender/build_city.py)
  interface Wall { ax: number; az: number; tx: number; tz: number; ox: number; oz: number; L: number; kind: number; door: number; store: number; seed: number }
  const walls: Wall[] = sl.walls.map(([ax, az, bx, bz, ox, oz, , , kind, , door, seed, store]) => {
    const L = Math.hypot(bx - ax, bz - az) || 1;
    return { ax, az, tx: (bx - ax) / L, tz: (bz - az) / L, ox, oz, L, kind, door, store, seed };
  });
  const wallGrid = new Map<string, Wall[]>();
  for (const w of walls) {
    const n = Math.ceil(w.L / 4);
    const seen = new Set<string>();
    for (let k = 0; k <= n; k++) {
      const x = w.ax + w.tx * (w.L * k) / n;
      const z = w.az + w.tz * (w.L * k) / n;
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
  /** The street wall whose kerb is under (x, z), and how far out from it. */
  const kerbOf = (x: number, z: number): { w: Wall; d: number } | null => {
    let best: { w: Wall; d: number } | null = null;
    for (const w of wallGrid.get(`${Math.floor(x / 8)},${Math.floor(z / 8)}`) ?? []) {
      if (w.kind !== 0) continue;
      const s = (x - w.ax) * w.tx + (z - w.az) * w.tz;
      const d = (x - w.ax) * w.ox + (z - w.az) * w.oz;
      if (s < -0.05 || s > w.L + 0.05 || d < -0.05 || d > 1.3) continue;
      if (!best || d < best.d) best = { w, d };
    }
    return best;
  };
  /** Ground height at (x, z) for something of radius r: on the kerb, or pushed off its edge into the gutter. */
  const settle = (x: number, z: number, r: number): [number, number, number] => {
    const k = kerbOf(x, z);
    if (!k) return [x, 0, z];
    // the kerb as built (none on a yard's or a gang's wall, whatever the plan's street fronts say)
    const kd = opts.probe ? kerbFront(opts.probe, x - k.w.ox * k.d, z - k.w.oz * k.d, k.w.ox, k.w.oz) : KERB;
    if (kd === null) return [x, 0, z];
    // (a little overhang is not seen: the kerb is only 12 cm)
    if (k.d < kd - 0.05 && k.d + r * 0.6 < kd + 0.05) return [x, KERB_Y, z];
    if (k.d > kd + 0.05 && k.d - r * 0.6 > kd - 0.05) return [x, 0, z];
    const push = kd + 0.04 + r * 0.6 - k.d;
    return [x + k.w.ox * push, 0, z + k.w.oz * push];
  };
  // every house door: nothing solid in front of one
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
          if (Math.abs(a) < 0.95 + r && o > -0.3 && o < 2.2 + r) return true;
        }
    return false;
  };
  const gameDoorNear = (x: number, z: number, r: number) => Object.values(city.doors).some((d) => Math.hypot(d.x - x, d.z - z) < r + Math.min(d.width / 2, 6));

  /** Open ground round (x, z) out to r. */
  const open = (x: number, z: number, r: number) => {
    if (at(x, z) !== OPEN) return false;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      if (at(x + Math.cos(a) * r, z + Math.sin(a) * r) !== OPEN) return false;
    }
    return true;
  };
  /** May a flat mark lie here? (not on rails, bridges, steps or the workshops) */
  const flatOk = (x: number, z: number, r: number) =>
    at(x, z) === OPEN && !tracks.some((q) => inR(q, x, z, r * 0.6)) && !bridges.some((q) => inR(q, x, z, r)) && !trades.some((q) => inR(q, x, z, 0.2)) && !nearSteps(x, z, r * 0.6);
  interface SolidRules { lane?: boolean; market?: boolean; start?: boolean }
  /** May a solid bit stand here? */
  const solidOk = (x: number, z: number, r: number, rules: SolidRules = {}) => {
    if (!open(x, z, Math.max(0.25, r)) || !flatOk(x, z, r)) return false;
    if (!rules.lane && lanes.some((q) => inR(q, x, z, r))) return false;
    if (!rules.market && markets.some((q) => inR(q, x, z, r))) return false;
    if (!rules.start && inR(START, x, z)) return false;
    if (runways.some((q) => inR(q, x, z, r)) || avoid.some((q) => inR(q, x, z, r + 0.15))) return false;
    if (clear.some((c) => Math.hypot(c.x - x, c.z - z) < c.r + r)) return false;
    return !atDoor(x, z, r);
  };

  const count = (k: string) => (counts[k] = (counts[k] ?? 0) + 1);
  /** A solid bit (a model of litter.glb), settled on the kerb or the street. */
  const solidAt = (name: string, x: number, z: number, rules: SolidRules = {}, extra: Partial<Put> = {}): boolean => {
    const p = protos.get(name);
    if (!p) return false;
    const r = Math.min(p.r, 1.6) * 0.8;
    // (on the kerb only if all of it is: a heap's skirt over the kerb's edge hangs in the air)
    const reachAll = p.rxz * 1.15;
    let [sx, y, sz] = opts.probe ? settle(x, z, reachAll / 0.6) : settle(x, z, r);
    // a hand off the houses as built: level rays out of its middle, just over the kerb, as far as it
    // reaches (turned any way, at its largest); pushed off a wall face it would stand in, else not here
    if (opts.probe && p.h > 0.03) {
      const reach = p.rxz * 1.15 + 0.03;
      const yy = y + Math.min(0.13, Math.max(0.02, p.h * 0.6));
      const dirs = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [Math.cos((k * Math.PI) / 4), Math.sin((k * Math.PI) / 4)]);
      for (const [dx, dz] of dirs) {
        const d = opts.probe(sx, yy, sz, dx, dz, reach);
        if (d !== null) {
          sx -= dx * (reach - d);
          sz -= dz * (reach - d);
        }
      }
      for (const [dx, dz] of dirs) if (opts.probe(sx, yy, sz, dx, dz, reach - 0.02) !== null) return false;
      if (Math.hypot(sx - x, sz - z) > 0.02) [sx, y, sz] = settle(sx, sz, reachAll / 0.6);
    }
    if (!solidOk(sx, sz, r, rules)) return false;
    // not before a door with any of it (a heap reaches further than its middle)
    if (opts.probe && p.h > 0.12 && atDoor(sx, sz, reachAll)) return false;
    // a model that goes into the ground (the broken pot's shards): on it
    if (p.y0 < -0.005) y -= p.y0;
    const s = 0.85 + R() * 0.3;
    puts.push({ layer: "solid", name, x: sx, y, z: sz, yaw: R() * Math.PI * 2, sx: s, sz: s, shade: 0.8 + R() * 0.3, ...extra });
    count(name);
    return true;
  };
  /**
   * Picture round 2026-09-26 (package 1): a mark of w x dd turned by yaw lies whole on open ground at height y: every
   * corner and edge of it on the walk map's open ground (no wall, no water) and on the ground as built at y (not
   * half over a kerb or a step, so nothing floats and nothing sinks).
   */
  const levelOk = (fx: number, fz: number, y: number, w: number, dd: number, yaw: number): boolean => {
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, -0.5], [0, 0.5], [-0.5, 0], [0.5, 0]]) {
      // (local x along the mark's width, z along its depth, turned by yaw as the batch turns it)
      const px = fx + u * w * c + v * dd * sn;
      const pz = fz - u * w * sn + v * dd * c;
      if (at(px, pz) !== OPEN) return false;
      const g = opts.ground?.(px, pz, y + 0.3);
      if (g !== undefined && g !== null && Math.abs(g - y) > 0.035) return false;
    }
    return true;
  };
  /** The kinds of this package held to levelOk wherever they are put (the older marks keep their rule). */
  const LEVELLED = /^(straw|dungflat|leafmush|leaf)/;
  /** A flat mark (a cell of the decal atlas), scaled by s, turned by yaw (random if undefined). */
  const flatAt = (name: string, x: number, z: number, s = 1, yaw?: number, extra: Partial<Put> = {}): boolean => {
    const d = meta.decals[name];
    if (!d) return false;
    const r = Math.max(d.w, d.d) * s * 0.4;
    const [fx, y, fz] = settle(x, z, r);
    if (!flatOk(fx, fz, r)) return false;
    yaw ??= R() * Math.PI * 2;
    if (LEVELLED.test(name) && !levelOk(fx, fz, y, d.w * s, d.d * s, yaw)) return false;
    puts.push({ layer: "flat", name, x: fx, y: y + 0.006, z: fz, yaw, sx: d.w * s, sz: d.d * s, shade: 0.85 + R() * 0.25, ...extra });
    count(name);
    return true;
  };
  const pick = <T,>(xs: Array<[number, T]>): T => {
    let t = R() * xs.reduce((a, [w]) => a + w, 0);
    for (const [w, v] of xs) if ((t -= w) <= 0) return v;
    return xs[xs.length - 1][1];
  };
  const place = (name: string, x: number, z: number, rules: SolidRules = {}, extra: Partial<Put> = {}) =>
    protos.has(name) ? solidAt(name, x, z, rules, extra) : flatAt(name, x, z, 0.8 + R() * 0.4, undefined, extra);

  // the swept squares: the town hall's and the cathedral's (the city's sweepers kept them)
  // the grime pass (Steve, 2026-09-26: "rust, soot, clutter, dirt"): about 1.8 times the dung, straw, muck, ash and
  // rubbish of M3j everywhere; the swept squares a little more too
  const FILTH = 1.8;
  const swept = (x: number, z: number) => {
    const g = city.places["Grote Markt"];
    const h = city.places["Handschoenmarkt"];
    return (g && Math.hypot(x - g.x, z - g.z) < 30) || (h && Math.hypot(x - h.x, z - h.z) < 22) || (x > -300 && x < -225 && z > 138 && z < 185) ? 0.35 * FILTH : FILTH;
  };

  // ================================================================ 1. the cart roads: dung, straw, muck
  R = rng(seed + 1 * 7919);
  let roadMetres = 0;
  for (const line of roads) {
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, az] = line[i];
      const [bx, bz] = line[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      const tx = (bx - ax) / L;
      const tz = (bz - az) / L;
      for (let s = R(); s < L; s += 1) {
        roadMetres++;
        const x = ax + tx * s;
        const z = az + tz * s;
        const k = swept(x, z);
        const off = (w: number) => (R() * 2 - 1) * w;
        const side = (a: number): P => [x - tz * a, z + tx * a];
        if (R() < 0.15 * k) {
          const [px, pz] = side(off(0.35));
          solidAt(pick([[3, "dung_0"], [2, "dung_1"], [3, "dung_2"]]), px, pz, { lane: true, market: true, start: true });
        }
        if (R() < 0.3 * k) {
          const [px, pz] = side(off(0.9));
          flatAt(R() < 0.5 ? "dungflat_0" : "dungflat_1", px, pz, 0.8 + R() * 0.5);
        }
        if (R() < 0.08 * k) {
          const [px, pz] = side(off(1.0));
          flatAt(R() < 0.6 ? "muck_0" : "muck_2", px, pz, 0.7 + R() * 0.5, Math.atan2(tx, tz) + off(0.4));
        }
        if (R() < 0.06 * k) {
          const [px, pz] = side(off(1.2));
          flatAt(R() < 0.5 ? "straw_0" : "straw_1", px, pz, 0.7 + R() * 0.4);
        }
        if (R() < 0.025 * k) {
          const [px, pz] = side(off(0.8));
          solidAt("straw_wisp", px, pz, { lane: true, market: true });
        }
        if (R() < 0.02 * k) {
          const a = (R() < 0.5 ? -1 : 1) * (1.2 + R() * 0.9);
          const [px, pz] = side(a);
          solidAt(pick([[2, "slats_0"], [1, "sacking_1"], [2, "paper_ball"], [2, "cabbage_0"], [1, "rope_end_0"], [1, "rag_2"], [1, "crockery"]]), px, pz);
        }
      }
    }
  }

  // ================================================================ 2. where horses stand: omnibus stops, drays' stops, the farrier
  R = rng(seed + 2 * 7919);
  const stand = (x: number, z: number, tx: number, tz: number, reach: number, kind: string) => {
    for (let k = 0; k < 5; k++) {
      const a = (R() * 2 - 1) * reach;
      const b = (R() * 2 - 1) * 0.4;
      solidAt(pick([[2, "dung_0"], [2, "dung_1"], [2, "dung_2"]]), x + tx * a - tz * b, z + tz * a + tx * b, { lane: true, market: true, start: true });
    }
    for (let k = 0; k < 9; k++) {
      const a = (R() * 2 - 1) * reach;
      const b = (R() * 2 - 1) * 0.9;
      flatAt(R() < 0.5 ? "dungflat_0" : "dungflat_1", x + tx * a - tz * b, z + tz * a + tx * b, 0.8 + R() * 0.6);
    }
    for (let k = 0; k < 3; k++) {
      const a = (R() * 2 - 1) * reach * 0.8;
      flatAt(k === 0 ? "muck_1" : "straw_0", x + tx * a, z + tz * a, 0.8 + R() * 0.4, Math.atan2(tx, tz));
    }
    // horse urine: a wet dark patch where they stand longest
    flatAt("muck_2", x, z, 1.3, Math.atan2(tx, tz));
    for (let a = -reach; a <= reach; a += 2) stamps.push([x + tx * a, z + tz * a, 2.2, 0.85]);
    sites.push({ kind, x: +x.toFixed(1), z: +z.toFixed(1) });
    count(kind);
  };
  for (const st of OMNIBUS_STOPS) {
    const nx = st.post[0] - st.x;
    const nz = st.post[1] - st.z;
    const l = Math.hypot(nx, nz) || 1;
    stand(st.x, st.z, -nz / l, nx / l, 9, "omnibus stand");
  }
  for (const route of TRAFFIC_ROUTES) {
    for (const st of route.stops ?? []) {
      // the route's direction at the stop: the leg it lies on
      let tx = 1;
      let tz = 0;
      for (let i = 0; i < route.pts.length - 1; i++) {
        const [ax, az] = route.pts[i];
        const [bx, bz] = route.pts[i + 1];
        if (segD(st.at[0], st.at[1], ax, az, bx, bz) < 0.5) {
          const L = Math.hypot(bx - ax, bz - az) || 1;
          tx = (bx - ax) / L;
          tz = (bz - az) / L;
        }
      }
      stand(st.at[0], st.at[1], tx, tz, 6, "dray stand");
    }
  }
  const farrier = TRADE_SITES.find((s) => s.id === "farrier");
  if (farrier) {
    // beside the shoeing shed, outside its keep-out, where the next horse waits
    const c = Math.cos(farrier.yaw);
    const s = Math.sin(farrier.yaw);
    const lx = farrier.area[1] + 1.2;
    const x = farrier.x + lx * c;
    const z = farrier.z - lx * s;
    stand(x, z, -s, -c, 2.5, "farrier stand");
  }

  await sleep(0);
  // ================================================================ 3. the gutters: dark water along the kerbs, to the drains
  R = rng(seed + 3 * 7919);
  const gutterQuads = new Map<string, number[]>(); // chunk -> [x, z, u, alpha, ...] per vertex (6 per quad)
  let gutterMetres = 0;
  const gutterGap = (x: number, z: number) => tracks.some((q) => inR(q, x, z, 0.3)) || bridges.some((q) => inR(q, x, z, 0.5)) || trades.some((q) => inR(q, x, z)) || nearSteps(x, z, 0.3);
  for (const w of walls) {
    if (w.kind !== 0) continue;
    const r = rng(w.seed * 11 + 3);
    // a street in front: open 0.8-2.5 m out, and no water within 4 m (a quay house has no gutter to the river side)
    const midx = w.ax + w.tx * w.L * 0.5;
    const midz = w.az + w.tz * w.L * 0.5;
    if (at(midx + w.ox * 4, midz + w.oz * 4) & WATER) continue;
    let s = r() * 1.5;
    while (s < w.L - 0.8) {
      const len = 2 + r() * 7;
      const e = Math.min(w.L - 0.3, s + len);
      // walk the run and cut it where the gutter line is not open street
      const pts: number[] = [];
      for (let q = s; q <= e + 1e-6; q += 0.5) {
        const x = w.ax + w.tx * q + w.ox * 0.9;
        const z = w.az + w.tz * q + w.oz * 0.9;
        if (at(x, z) !== OPEN || at(x + w.ox * 0.8, z + w.oz * 0.8) !== OPEN || gutterGap(x, z)) break;
        pts.push(q);
      }
      if (pts.length >= 3) {
        const q0 = pts[0];
        const q1 = pts[pts.length - 1];
        const d0 = KERB + 0.01;
        const d1 = KERB + 0.5;
        const key = `${Math.floor((w.ax + w.tx * q0) / CH)},${Math.floor((w.az + w.tz * q0) / CH)}`;
        let buf = gutterQuads.get(key);
        if (!buf) gutterQuads.set(key, (buf = []));
        const a0 = 0.6 + r() * 0.4;
        // pieces that end at the texture's seams (one tile = 1.6 m), so no quad wraps the cell
        const cuts = [q0];
        for (let q = Math.ceil(q0 / 1.6) * 1.6; q < q1; q += 1.6) if (q > q0 + 0.02) cuts.push(q);
        cuts.push(q1);
        for (let k = 0; k < cuts.length - 1; k++) {
          const qa = cuts[k];
          const qb = cuts[k + 1];
          const tile = Math.floor((qa + qb) / 2 / 1.6);
          const fa = Math.min(1, (qa - q0) / 1.2, (q1 - qa) / 1.2) * a0;
          const fb = Math.min(1, (qb - q0) / 1.2, (q1 - qb) / 1.2) * a0;
          const P = (q: number, d: number): [number, number] => [w.ax + w.tx * q + w.ox * d, w.az + w.tz * q + w.oz * d];
          const [ax0, az0] = P(qa, d0);
          const [ax1, az1] = P(qa, d1);
          const [bx0, bz0] = P(qb, d0);
          const [bx1, bz1] = P(qb, d1);
          const ua = qa / 1.6 - tile;
          const ub = qb / 1.6 - tile;
          upTri(buf, [ax0, az0, ua, 0, fa], [bx1, bz1, ub, 1, fb], [bx0, bz0, ub, 0, fb]);
          upTri(buf, [ax0, az0, ua, 0, fa], [ax1, az1, ua, 1, fa], [bx1, bz1, ub, 1, fb]);
        }
        gutterMetres += q1 - q0;
        for (let q = q0; q <= q1; q += 1.2) stamps.push([w.ax + w.tx * q + w.ox * 0.9, w.az + w.tz * q + w.oz * 0.9, 0.55, 0.8]);
        // a drain at the lower end now and then, the muck gathered at it
        if (r() < 0.3) {
          const qd = r() < 0.5 ? q0 + 0.2 : q1 - 0.2;
          const x = w.ax + w.tx * qd + w.ox * (KERB + 0.22);
          const z = w.az + w.tz * qd + w.oz * (KERB + 0.22);
          if (flatAt("drain", x, z, 0.9, Math.atan2(w.ox, w.oz))) flatAt("muck_2", x + w.ox * 0.3, z + w.oz * 0.3, 0.55);
        }
        // and things carried along in it
        for (let q = q0 + 0.5; q < q1 - 0.5; q += 2.5) {
          if (r() > 0.18) continue;
          const x = w.ax + w.tx * q + w.ox * 0.95;
          const z = w.az + w.tz * q + w.oz * 0.95;
          const k = swept(x, z);
          if (r() > k) continue;
          place(pick([[3, "straw_0"], [2, "leafmush_0"], [2, "paper_0"], [2, "cabbage_0"], [1, "straw_wisp"], [1, "paper_ball"], [1, "dungflat_0"], [0.6, "fish_guts"], [0.3, "rat_dead"], [1, "guts_0"]]), x, z, { lane: true });
        }
      }
      s = (pts.length ? pts[pts.length - 1] : s) + 1 + r() * 4;
    }
  }

  // ================================================================ 4. corners: urine at the foot
  R = rng(seed + 4 * 7919);
  for (const [cx, cz, dx, dz, o1x, o1z, t1x, t1z, , , , , , , store] of sl.corners) {
    const r = rng(Math.round(cx * 13 + cz * 7));
    if (store || r() > 0.6) continue;
    const x = cx + dx * 0.55;
    const z = cz + dz * 0.55;
    if (at(x, z) !== OPEN || at(cx + dx * 1.4, cz + dz * 1.4) !== OPEN || gameDoorNear(cx, cz, 2)) continue;
    if (!flatAt("urine_0", x, z, 0.8 + r() * 0.3, Math.atan2(dx, dz))) continue;
    // the wet tongue up the wall, on the kerb by the corner
    const d = meta.decals.urine_wall;
    puts.push({ layer: "flat", name: "urine_wall", x: cx + t1x * 0.38 + o1x * 0.012, y: KERB_Y, z: cz + t1z * 0.38 + o1z * 0.012, yaw: Math.atan2(o1x, o1z), sx: d.w, sz: d.d, shade: 1 });
    count("urine_wall");
  }

  // ================================================================ 5. house doors: ash put out, slops thrown, a bucket
  R = rng(seed + 5 * 7919);
  for (const w of walls) {
    if (w.kind !== 0 || w.door < 0 || w.store) continue;
    const r = rng(w.seed * 5 + 17);
    const s0 = w.door * w.L;
    const dx = w.ax + w.tx * s0;
    const dz = w.az + w.tz * s0;
    if (gameDoorNear(dx, dz, 2) || at(dx + w.ox * 1.5, dz + w.oz * 1.5) !== OPEN) continue;
    const k = swept(dx, dz);
    if (r() < 0.16 * k) {
      const side = r() < 0.5 ? -1 : 1;
      const s = s0 + side * (1.15 + r() * 0.35);
      if (s > 0.4 && s < w.L - 0.4) {
        const x = w.ax + w.tx * s + w.ox * 0.36;
        const z = w.az + w.tz * s + w.oz * 0.36;
        if (solidAt("ash_heap", x, z, { lane: true })) {
          if (r() < 0.6) flatAt("ash_0", x + w.ox * 0.7, z + w.oz * 0.7, 0.8);
          sites.push({ kind: "ash heap", x: +x.toFixed(1), z: +z.toFixed(1) });
        }
      }
    }
    if (r() < 0.11 * k) {
      // the slops land beyond the kerb and run into the gutter
      const d = meta.decals.slop_0;
      if (flatAt("slop_0", dx + w.ox * (KERB + 0.1 + d.d / 2), dz + w.oz * (KERB + 0.1 + d.d / 2), 1, Math.atan2(-w.ox, -w.oz))) {
        if (r() < 0.35) {
          const side = r() < 0.5 ? -1 : 1;
          solidAt("bucket", dx + w.tx * side * 1.05 + w.ox * 0.35, dz + w.tz * side * 1.05 + w.oz * 0.35, { lane: true });
        }
        sites.push({ kind: "slops", x: +dx.toFixed(1), z: +dz.toFixed(1) });
      }
    }
    if (r() < 0.07 * k) {
      const side = r() < 0.5 ? -1 : 1;
      place(pick([[2, "crockery"], [2, "cabbage_1"], [1, "veg_rotten"], [1, "glass_broken"], [1, "bottle"], [1, "rag_0"]]), dx + w.tx * side * (1.3 + r()) + w.ox * 1.1, dz + w.tz * side * (1.3 + r()) + w.oz * 1.1, { lane: false });
    }
  }

  await sleep(0);
  // ================================================================ 6. the streets at large: along the house fronts,
  R = rng(seed + 6 * 7919);
  // and the horse line down the middle of every street (horses went down every one of them)
  for (const w of walls) {
    if (w.kind !== 0) continue;
    const r = rng(w.seed * 3 + 29);
    for (let s = r() * 2.5; s < w.L; s += 2.5) {
      const bx = w.ax + w.tx * s;
      const bz = w.az + w.tz * s;
      // how wide the street is here: to the house opposite (or 14 m: a square, a quay)
      let W = 14;
      for (let d = 1; d < 14; d += 0.5)
        if (at(bx + w.ox * d, bz + w.oz * d) !== OPEN) {
          W = d;
          break;
        }
      if (W < 2.2) continue;
      const k = swept(bx, bz);
      if (r() < 0.5 * k) {
        // by the houses: what was thrown out or dropped
        const out = 1.0 + r() * Math.min(2.4, W / 2 - 0.9);
        place(
          pick([
            [3, "dungflat_0"], [2.5, "straw_0"], [2, "paper_0"], [2, "cabbage_0"], [1, "cabbage_1"], [1, "veg_rotten"], [1.5, "paper_ball"], [1, "rag_1"], [1, "rag_2"],
            [1, "bottle"], [0.6, "bottle_brown"], [1, "glass_broken"], [1, "glass_0"], [1, "crockery"], [1.2, "straw_wisp"], [0.35, "rat_dead"], [2, "muck_0"], [0.6, "oil_0"],
            [0.8, "slats_0"], [0.5, "sacking_0"], [1.5, "leafmush_0"], [0.8, "dung_2"], [1, "ash_0"],
          ]),
          bx + w.ox * out,
          bz + w.oz * out,
        );
      }
      // the middle of the street (each side does its half: only walls facing +x or +z, so it is done once)
      if (W >= 4 && (w.ox > 0.5 || w.oz > 0.5) && r() < 0.55 * k) {
        const mid = W / 2 + (r() * 2 - 1) * Math.min(1, W / 2 - 1.5);
        const x = bx + w.ox * mid;
        const z = bz + w.oz * mid;
        const kind = pick([[4, "dungflat_0"], [3, "dungflat_1"], [2.5, "muck_0"], [1.5, "muck_2"], [2, "straw_0"], [1, "straw_1"], [1.2, "dung_0"], [1, "dung_2"], [0.6, "straw_wisp"]]);
        if (protos.has(kind)) solidAt(kind, x, z, { lane: true, market: true });
        else flatAt(kind, x, z, 0.9 + r() * 0.7, Math.atan2(w.tx, w.tz) + (r() - 0.5) * 0.6);
      }
    }
  }

  // ================================================================ 7. the quays: the waste of the work
  R = rng(seed + 7 * 7919);
  const qsites = opts.quaySites ?? [];
  for (const [ax, az, bx, bz] of city.quays) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 2) continue;
    const nx = -(bz - az) / L;
    const nz = (bx - ax) / L;
    for (let t = R() * 3; t < L; t += 3) {
      if (R() > 0.5) continue;
      const qx = ax + ((bx - ax) * t) / L;
      const qz = az + ((bz - az) * t) / L;
      const side = at(qx + nx * 2.5, qz + nz * 2.5) === OPEN ? 1 : at(qx - nx * 2.5, qz - nz * 2.5) === OPEN ? -1 : 0;
      if (!side) continue;
      const d = 1.5 + R() * 7;
      const x = qx + nx * side * d;
      const z = qz + nz * side * d;
      const fishQuay = x > -165 && x < -84 && z < 60; // the Vismarkt and the vliet: the fish quays
      const inStart = inR(START, x, z);
      const kind = fishQuay
        ? pick([[3, "fish_heads"], [2, "mussels"], [1.5, "oysters"], [2, "scales_0"], [1, "guts_0"], [1, "fish_small"], [1.5, "rope_end_0"], [1, "straw_0"], [1, "slats_1"], [1, "shells_0"], [0.8, "tar_1"]])
        : pick([
            [2, "slats_0"], [1.2, "slats_1"], [1.5, "sacking_0"], [1, "sacking_1"], [2, "rope_end_0"], [1, "rope_end_1"], [2, "straw_0"], [1, "straw_heap"], [1.5, "grain_0"],
            [1.5, "oil_0"], [1.5, "tar_1"], [1, "tar_0"], [1, "paper_0"], [1, "bottle"], [2, "dungflat_1"], [0.3, "rat_dead"], [1, "muck_0"], [0.8, "soot_0"],
          ]);
      if (inStart && protos.has(kind)) continue; // the game's own quay: only flat marks there
      place(kind, x, z);
    }
  }
  // coal: dust and lumps round every coal heap, a black trail to the water
  for (const q of qsites) {
    if (q.kind.startsWith("coal_heap")) {
      flatAt("coaldust_0", q.x, q.z, 1.3, R() * 6.28);
      for (let k = 0; k < 5; k++) {
        const a = R() * 6.28;
        const d = 1.8 + R() * 2.5;
        flatAt("coaldust_1", q.x + Math.cos(a) * d, q.z + Math.sin(a) * d, 0.8 + R() * 0.6);
      }
      for (let k = 0; k < 8; k++) {
        const a = R() * 6.28;
        const d = 1.9 + R() * 2.4;
        solidAt(k % 3 ? "coal_1" : "coal_0", q.x + Math.cos(a) * d, q.z + Math.sin(a) * d, { start: true });
      }
      // toward the nearest water: the carriers' way from the barge
      let best: P | null = null;
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        for (let d = 2; d < 14; d += 1)
          if (at(q.x + Math.cos(a) * d, q.z + Math.sin(a) * d) & WATER) {
            if (!best || d < Math.hypot(best[0], best[1])) best = [Math.cos(a) * d, Math.sin(a) * d];
            break;
          }
      }
      if (best) {
        const L = Math.hypot(best[0], best[1]);
        for (let d = 2.5; d < L - 0.8; d += 1.3) flatAt("coaldust_1", q.x + (best[0] * d) / L, q.z + (best[1] * d) / L, 0.7 + R() * 0.4);
      }
      stamps.push([q.x, q.z, 4.5, 0.95]);
      sites.push({ kind: "coal dust", x: q.x, z: q.z });
    } else if (q.kind.startsWith("tar_fire")) {
      for (let k = 0; k < 3; k++) {
        const a = R() * 6.28;
        const d = 1.3 + R() * 1.8;
        flatAt(k ? "tar_1" : "tar_0", q.x + Math.cos(a) * d, q.z + Math.sin(a) * d, 0.8 + R() * 0.5);
      }
      flatAt("soot_0", q.x, q.z, 1.2);
    } else if (q.kind.startsWith("boat_trestles")) {
      for (let k = 0; k < 2; k++) flatAt("tar_1", q.x + (R() - 0.5) * 4, q.z + (R() - 0.5) * 4, 0.9);
    }
  }
  // grain spilled and sacking at the storehouse doors (the Hessenatie, the Entrepot)
  for (const id of ["hessenatie", "entrepot", "peeters"]) {
    const d = city.doors[id];
    if (!d) continue;
    for (let k = 0; k < (id === "peeters" ? 1 : 4); k++) {
      const a = (R() - 0.5) * Math.min(d.width, 10);
      const o = 2.5 + R() * 4;
      flatAt("grain_0", d.x + d.out[1] * a + d.out[0] * o, d.z - d.out[0] * a + d.out[1] * o, 0.8 + R() * 0.5);
    }
    for (let k = 0; k < 2; k++) {
      const a = (R() - 0.5) * Math.min(d.width + 6, 14);
      const o = 5 + R() * 4;
      solidAt(k ? "sacking_1" : "straw_heap", d.x + d.out[1] * a + d.out[0] * o, d.z - d.out[0] * a + d.out[1] * o, { start: true });
    }
  }

  // ================================================================ 8. the squares (not the markets): a little of everything; the swept ones less
  R = rng(seed + 8 * 7919);
  for (const [name, n] of [["Steenplein", 34], ["Werf", 30], ["Rijnkaai", 14], ["Grote Markt", 8], ["Handschoenmarkt", 6]] as Array<[string, number]>) {
    const p = city.places[name];
    if (!p) continue;
    for (let k = 0, tries = 0; k < n && tries < n * 6; tries++) {
      const a = R() * Math.PI * 2;
      const rr = 3 + R() * 30;
      const x = p.x + Math.cos(a) * rr;
      const z = p.z + Math.sin(a) * rr;
      if (markets.some((q) => inR(q, x, z))) continue;
      const kind = pick([
        [3, "dungflat_0"], [2, "dungflat_1"], [2, "straw_0"], [1, "straw_1"], [1.5, "paper_0"], [1, "paper_ball"], [1, "cabbage_0"], [1, "muck_0"], [0.6, "muck_1"], [1, "dung_2"],
        [0.8, "slats_0"], [0.6, "bottle"], [0.5, "glass_0"], [0.5, "rope_end_1"], [0.4, "oil_0"],
      ]);
      if (place(kind, x, z, { start: false })) k++;
    }
  }

  // ================================================================ 9. the markets: their waste, more after the market than during it
  R = rng(seed + 9 * 7919);
  const marketOf = (r: Rect) => {
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    return Math.hypot(cx + 117, cz - 29) < 45 ? "vismarkt" : Math.hypot(cx + 259, cz - 98) < 45 ? "grote_markt" : null;
  };
  for (const rect of markets) {
    const place0 = marketOf(rect);
    if (!place0) continue;
    const area = (rect.maxX - rect.minX) * (rect.maxZ - rect.minZ);
    const n = Math.round(area * (place0 === "vismarkt" ? 0.2 : 0.075));
    const mix: Array<[number, string]> =
      place0 === "vismarkt"
        ? [
            [3.2, "fish_heads"], [1.6, "fish_guts"], [1.2, "fish_small"], [2, "mussels"], [1, "oysters"], [0.6, "shell_heap"], [2.4, "scales_0"], [1.6, "guts_0"], [1.2, "muck_0"],
            [1, "straw_0"], [0.6, "straw_wisp"], [1, "slats_0"], [0.6, "slats_1"], [0.6, "sacking_1"], [0.6, "paper_ball"], [0.6, "paper_0"], [0.6, "cabbage_0"], [0.8, "shells_0"], [0.3, "rat_dead"],
          ]
        : [
            [2, "cabbage_0"], [2, "cabbage_1"], [1.2, "veg_rotten"], [1.2, "leafmush_0"], [1.2, "straw_0"], [0.6, "straw_wisp"], [0.8, "paper_0"], [0.8, "paper_ball"], [0.8, "slats_0"],
            [0.5, "sacking_0"], [0.8, "dungflat_0"], [0.5, "muck_0"], [0.4, "rag_0"], [0.3, "crockery"],
          ];
    for (let k = 0, tries = 0; k < n && tries < n * 5; tries++) {
      const x = rect.minX + 0.5 + R() * (rect.maxX - rect.minX - 1);
      const z = rect.minZ + 0.5 + R() * (rect.maxZ - rect.minZ - 1);
      const u = R();
      if (place(pick(mix), x, z, { market: true, lane: false }, { market: place0, u })) k++;
    }
    for (let k = 0; k < Math.round(area / 90); k++) stamps.push([rect.minX + R() * (rect.maxX - rect.minX), rect.minZ + R() * (rect.maxZ - rect.minZ), 1.5 + R() * 2, 0.6]);
  }

  await sleep(0);
  // ================================================================ 10. heaps: refuse in back corners, a stable's manure heap
  R = rng(seed + 10 * 7919);
  {
    type Cand = { x: number; z: number; score: number; wx: number; wz: number; wd: number };
    const cands: Cand[] = [];
    const roadNear = (x: number, z: number, r: number) => roads.some((l) => l.some(([px, pz]) => Math.abs(px - x) < r && Math.abs(pz - z) < r && Math.hypot(px - x, pz - z) < r));
    for (let x = -330; x < 195; x += 2)
      for (let z = -20; z < 290; z += 2) {
        if (!open(x, z, 1.7) || !open(x, z, 1.0)) continue;
        let closed = 0;
        let far = 0;
        let wd = 99;
        let wx = 0;
        let wz = 0;
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          let d = 0.5;
          while (d < 12 && at(x + Math.cos(a) * d, z + Math.sin(a) * d) === OPEN) d += 0.5;
          if (d < 4.5) closed++;
          if (d >= 8) far++;
          if (d < wd) {
            wd = d;
            wx = Math.cos(a);
            wz = Math.sin(a);
          }
        }
        if (closed < 8 || far < 1 || wd > 2.5) continue;
        // a dead end (one way out) scores best: nobody has to pass the heap
        cands.push({ x, z, score: closed + (far <= 3 ? 6 : 0) + R() * 0.5, wx, wz, wd });
      }
    cands.sort((a, b) => b.score - a.score);
    counts["heap corners looked at"] = cands.length;
    const chosen: Array<Cand & { kind: string }> = [];
    const heapOk = (c: Cand, r: number) => {
      const x = c.x + c.wx * Math.max(0, c.wd - r - 0.1);
      const z = c.z + c.wz * Math.max(0, c.wd - r - 0.1);
      if (!open(x, z, r * 0.8)) return null;
      if ([...tracks, ...lanes, ...markets, ...trades, ...runways].some((q) => inR(q, x, z, 3)) || avoid.some((q) => inR(q, x, z, r + 0.5))) return null;
      if (inR(START, x, z, 10) || bridges.some((q) => inR(q, x, z, 4)) || nearSteps(x, z, 3)) return null;
      if (clear.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 6) || houseDoors.some((d) => Math.hypot(d.x - x, d.z - z) < 4.5)) return null;
      if (roadNear(x, z, 5) || chosen.some((q) => Math.hypot(q.x - x, q.z - z) < 50)) return null;
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (at(x + Math.cos(a) * 3.5, z + Math.sin(a) * 3.5) & WATER) return null;
      }
      // (no wall of the buildings as built within its reach, at its foot and its middle; flat on the street,
      // not half on a kerb: the prop check)
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        if (opts.probe) for (const y of [0.15, 0.6]) if (opts.probe(x, y, z, Math.cos(a), Math.sin(a), r) !== null) return null;
        const g = opts.ground?.(x + Math.cos(a) * r * 0.8, z + Math.sin(a) * r * 0.8, 0.4);
        if (g !== undefined && g !== null && Math.abs(g) > 0.04) return null;
      }
      return [x, z] as P;
    };
    // the stable yard: a corner near where the drays stand (their stables), else any
    const drayStops = TRAFFIC_ROUTES.flatMap((r) => (r.stops ?? []).map((s) => s.at));
    const deadEnds = cands.filter((c) => c.score >= 14);
    const byStable = [...(deadEnds.length > 20 ? deadEnds : cands)].sort((a, b) => Math.min(...drayStops.map(([x, z]) => Math.hypot(x - a.x, z - a.z))) - Math.min(...drayStops.map(([x, z]) => Math.hypot(x - b.x, z - b.z))));
    for (const c of byStable.slice(0, 400)) {
      const p = heapOk(c, 1.45);
      if (p) {
        chosen.push({ ...c, x: p[0], z: p[1], kind: "manure_heap" });
        break;
      }
    }
    for (const c of cands) {
      if (chosen.filter((q) => q.kind === "refuse_heap").length >= 3) break;
      const p = heapOk(c, 1.3);
      if (p) chosen.push({ ...c, x: p[0], z: p[1], kind: "refuse_heap" });
    }
    for (const c of chosen) {
      // its back (model -z) to the wall
      const yaw = Math.atan2(-c.wx, -c.wz);
      const set = `heap at ${c.x.toFixed(0)}, ${c.z.toFixed(0)}`;
      puts.push({ layer: "solid", name: c.kind, x: c.x, y: 0, z: c.z, yaw, sx: 1, sz: 1, shade: 1, set });
      count(c.kind);
      const proto = protos.get(c.kind)!;
      colliders.push(modelCollider(modelShape(proto, () => [proto.geo.getAttribute("position").array]), c.x, c.z, yaw));
      stamps.push([c.x, c.z, 3.4, 0.95]);
      sites.push({ kind: c.kind.replace("_", " "), x: +c.x.toFixed(1), z: +c.z.toFixed(1) });
      // round the foot: what fell off, the wet run from it, rats' work
      const around = c.kind === "manure_heap" ? ["dungflat_0", "dungflat_1", "straw_0", "muck_1", "dung_1", "straw_wisp"] : ["ash_0", "leafmush_0", "paper_0", "cabbage_1", "crockery", "rag_2", "muck_0", "glass_0", "bottle_brown"];
      for (let k = 0; k < 7; k++) {
        const a = R() * 6.28;
        const d = 1.7 + R() * 1.4;
        const x = c.x + Math.cos(a) * d;
        const z = c.z + Math.sin(a) * d;
        if (protos.has(around[k % around.length])) solidAt(around[k % around.length], x, z, { lane: false }, {});
        else flatAt(around[k % around.length], x, z, 0.9 + R() * 0.4);
      }
      if (c.kind === "manure_heap") {
        // the dung collector's barrow beside it, a broom on it
        const bx = c.x - c.wz * 2.3 - c.wx * 0.4;
        const bz = c.z + c.wx * 2.3 - c.wz * 0.4;
        if (open(bx, bz, 0.9) && !avoid.some((q) => inR(q, bx, bz, 1))) {
          puts.push({ layer: "solid", name: "dung_barrow", x: bx, y: 0, z: bz, yaw: yaw + 1.2, sx: 1, sz: 1, shade: 1, set });
          count("dung_barrow");
          const barrow = protos.get("dung_barrow")!;
          colliders.push(modelCollider(modelShape(barrow, () => [barrow.geo.getAttribute("position").array]), bx, bz, yaw + 1.2));
        }
      } else if (R() < 0.8) {
        solidAt("rat_dead", c.x + Math.cos(yaw) * 2, c.z - Math.sin(yaw) * 2, { lane: false });
      }
    }
  }

  await sleep(0);
  // ================================================================ 11. floating rubbish, and the foul water map
  R = rng(seed + 11 * 7919);
  const floatKinds: Array<[number, string]> = [
    [3, "slats_0"], [3, "cabbage_0"], [2, "cabbage_1"], [3, "straw_wisp"], [1.5, "bottle"], [1, "bottle_brown"], [2, "paper_ball"], [0.5, "rat_dead"], [1.5, "veg_rotten"],
    [1.5, "sacking_1"], [1.5, "rope_end_0"], [1, "fish_small"], [0.8, "fish_heads"],
  ];
  const floaters: Array<{ i: number; x: number; z: number; yaw: number; ph: number; name: string; chunk: string }> = [];
  const waterOk = (x: number, z: number) =>
    (at(x, z) & WATER) !== 0 && (at(x, z) & 1) === 0 && !bridges.some((q) => inR(q, x, z, 4)) && (opts.swimFree ? opts.swimFree(x, z, 0.6) : true);
  const floatIn = (n: number, box: [number, number, number, number], wallBand: number) => {
    for (let k = 0, tries = 0; k < n && tries < n * 30; tries++) {
      const x = box[0] + R() * (box[1] - box[0]);
      const z = box[2] + R() * (box[3] - box[2]);
      if (!waterOk(x, z)) continue;
      // near a wall (the rubbish collects there), within wallBand metres
      let nearWall = false;
      for (let a = 0; a < 8 && !nearWall; a++) {
        const c = Math.cos((a / 8) * Math.PI * 2) * wallBand;
        const s = Math.sin((a / 8) * Math.PI * 2) * wallBand;
        if (!(at(x + c, z + s) & WATER)) nearWall = true;
      }
      if (!nearWall) continue;
      const name = pick(floatKinds);
      puts.push({ layer: "float", name, x, y: waterY, z, yaw: R() * 6.28, sx: 1, sz: 1, shade: 0.7 + R() * 0.2 });
      count(`floating ${name}`);
      k++;
    }
  };
  floatIn(34, [-150, -142, 1, 71], 3); // the vliet
  floatIn(64, [-82, -70, 1, 204], 3.5); // the canal
  floatIn(30, [-214, -82, -6, 0], 3); // the river by the fish market and the Steen
  floatIn(14, [70, 170, 46, 110], 2.5); // the corners of the Petit Bassin
  // how foul the water is: the vliet and the canal, thickest by their walls; the river by the fish quays
  {
    const foul = new Uint8Array(MW * MH);
    const dist = new Float32Array(MW * MH).fill(99);
    const q: number[] = [];
    for (let j = 0; j < MH; j++)
      for (let i = 0; i < MW; i++) {
        const k = j * MW + i;
        if (!(at(X0 + i + 0.5, Z0 + j + 0.5) & WATER)) {
          dist[k] = 0;
          q.push(k);
        }
      }
    for (let h = 0; h < q.length; h++) {
      const c = q[h];
      if (dist[c] >= 8) continue;
      const i = c % MW;
      const j = (c / MW) | 0;
      const nd = dist[c] + 1;
      if (i > 0 && dist[c - 1] > nd) (dist[c - 1] = nd), q.push(c - 1);
      if (i < MW - 1 && dist[c + 1] > nd) (dist[c + 1] = nd), q.push(c + 1);
      if (j > 0 && dist[c - MW] > nd) (dist[c - MW] = nd), q.push(c - MW);
      if (j < MH - 1 && dist[c + MW] > nd) (dist[c + MW] = nd), q.push(c + MW);
    }
    const n = rng(97);
    for (let j = 0; j < MH; j++)
      for (let i = 0; i < MW; i++) {
        const k = j * MW + i;
        if (dist[k] === 0) continue;
        const x = X0 + i + 0.5;
        const z = Z0 + j + 0.5;
        const d = dist[k];
        let f = 0;
        if (x > -151 && x < -141 && z > -1) f = 0.75 + 0.25 * Math.max(0, 1 - d / 3); // the vliet: an open sewer
        else if (x > -83 && x < -69 && z > -1) f = 0.5 + 0.4 * Math.max(0, 1 - d / 3); // the canal of the brewers
        else if (z < 0 && z > -12 && x > -215 && x < -82) f = 0.55 * Math.max(0, 1 - d / 7); // the river by the fish quays
        else if (x > 70 && x < 170 && z > 46 && z < 110) f = 0.3 * Math.max(0, 1 - d / 4); // the Petit Bassin's corners
        else if (z < 0) f = 0.18 * Math.max(0, 1 - d / 3); // along every river wall a little
        f *= 0.85 + 0.3 * n();
        foul[k] = Math.round(Math.min(1, f) * 255);
      }
    const tex = new THREE.DataTexture(foul, MW, MH, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    psxUniforms.uFoul.value = tex;
    psxUniforms.uFoulBox.value.set(X0, Z0, MW, MH);
  }

  await sleep(0);
  // ================================================================ 12. autumn (picture round 2026-09-26, package 1)
  // Fallen plane and lime leaves blown into drifts: against the kerbs and the wall feet, into the inside corners, round
  // every tree pit and in a carpet under the trees of the squares (world/alive/leaves.ts has the loose ones that blow
  // about); more under the trees and in the back lanes and on the quays, a few on the swept squares. Horse dung where
  // the drays go and stand and at the gates; straw round the markets. Flat marks lie on the ground as built (every
  // corner of one on the same level: never half over a kerb, a step or the water), the low leaf piles are solid bits
  // with the other litter's rules (off doors, lanes and walls). The Stadspark has its own planting: left alone.
  R = rng(seed + 12 * 7919);
  {
    const decorT = city.decor as unknown as { trees?: number[][]; trees_wild?: number[][]; rampart?: { gates?: Array<{ passage: number[][]; frame: { t: number[]; n: number[] } }> } };
    // (the quays' and streets' trees, and those of the Sint-Jansplein and the greens: townplaces.json)
    const tp = TOWN_PLACES as unknown as { rond?: { trees?: number[][] }; greens?: Array<{ trees?: number[][] }> };
    // (the planted squares' plane trees and limes shed a carpet: marked with a third value 1)
    const planted = [...(tp.rond?.trees ?? []), ...(tp.greens ?? []).flatMap((g) => g.trees ?? [])].map((t) => [t[0], t[1], 1]);
    const trees = [...(decorT.trees ?? []), ...(decorT.trees_wild ?? []), ...planted];
    const treeGrid = new Map<string, number[][]>();
    for (const t of trees) {
      const key = `${Math.floor(t[0] / 16)},${Math.floor(t[1] / 16)}`;
      let l = treeGrid.get(key);
      if (!l) treeGrid.set(key, (l = []));
      l.push(t);
    }
    /** How near the trees (1 under one, about 0.3 at 25 m, a floor of 0.18 anywhere: leaves blow a long way). */
    const treeNear = (x: number, z: number) => {
      let d = 1e9;
      const gi = Math.floor(x / 16);
      const gj = Math.floor(z / 16);
      for (let di = -2; di <= 2; di++) for (let dj = -2; dj <= 2; dj++) for (const t of treeGrid.get(`${gi + di},${gj + dj}`) ?? []) d = Math.min(d, Math.hypot(t[0] - x, t[1] - z));
      return 0.18 + 0.82 * Math.exp(-d / 20);
    };
    const park = city.places["Stadspark"];
    const inPark = (x: number, z: number) => !!park && Math.hypot(x - park.x, z - park.z) < 52;
    const nearWater = (x: number, z: number, r: number) => {
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        if (at(x + Math.cos(a) * r, z + Math.sin(a) * r) & WATER) return true;
      }
      return false;
    };
    /** A leaf mark (or straw, dung: any flat mark of this pass): every corner and edge of it on open ground at the same level as its middle. */
    const leafAt = (name: string, x: number, z: number, s: number, yaw: number): boolean => {
      const d = meta.decals[name];
      if (!d || inPark(x, z)) return false;
      const w = d.w * s;
      const dd = d.d * s;
      const [fx, y, fz] = settle(x, z, Math.max(w, dd) * 0.4);
      if (!flatOk(fx, fz, Math.max(w, dd) * 0.4) || !levelOk(fx, fz, y, w, dd, yaw)) return false;
      // (leaves a good deal lighter than the grime under them: the flat marks' dirty tint would sink them into the setts)
      puts.push({ layer: "flat", name, x: fx, y: y + 0.007, z: fz, yaw, sx: w, sz: dd, shade: name.startsWith("leaf") ? 1.45 + R() * 0.35 : 0.85 + R() * 0.3 });
      count(name);
      return true;
    };
    const drift = () => (R() < 0.55 ? "leafdrift_0" : "leafdrift_1");
    const patch = () => (R() < 0.6 ? "leafpatch_0" : "leafpatch_1");
    const scatter = () => (R() < 0.5 ? "leafscatter_0" : "leafscatter_1");

    // (a) along the wall feet and the kerbs: the wind rolls them to the kerb's face and the foot of the houses
    for (const w of walls) {
      const r = rng(w.seed * 7 + 101);
      for (let s = 0.6 + r() * 1.5; s < w.L - 0.6; s += 1.9 + r() * 1.2) {
        const bx = w.ax + w.tx * s;
        const bz = w.az + w.tz * s;
        if (at(bx + w.ox * 1.2, bz + w.oz * 1.2) !== OPEN) continue;
        // a back lane (the house opposite within 6 m) or a quay: more; a swept square: fewer
        let W = 14;
        for (let dd = 1.5; dd < 14; dd += 0.75)
          if (at(bx + w.ox * dd, bz + w.oz * dd) !== OPEN) {
            W = dd;
            break;
          }
        const lane = W < 6.5 ? 1.5 : 1;
        const quay = nearWater(bx + w.ox * 4, bz + w.oz * 4, 9) ? 1.35 : 1;
        const k = (swept(bx, bz) / FILTH) * lane * quay;
        if (r() > 0.55 * k * (0.6 + treeNear(bx, bz))) continue;
        const name = r() < 0.8 ? drift() : patch();
        const dm = meta.decals[name];
        const sc = 0.75 + r() * 0.45;
        const half = (dm.d * sc) / 2;
        const kd = w.kind === 0 ? (opts.probe ? kerbFront(opts.probe, bx, bz, w.ox, w.oz) : KERB) : null;
        // against the kerb's face on the street (most), or on the kerb against the wall
        let out = kd !== null && r() < 0.72 ? kd + half + 0.04 : half + 0.08;
        const along = (r() - 0.5) * 0.4;
        const yaw = Math.atan2(-w.ox, -w.oz) + (r() - 0.5) * 0.15;
        counts["leaf wall tries"] = (counts["leaf wall tries"] ?? 0) + 1;
        // (where the walk map keeps a hand off the wall, a little further out)
        let ok = false;
        for (let k2 = 0; k2 < 3 && !ok; k2++, out += 0.22) ok = leafAt(name, bx + w.ox * out + w.tx * along, bz + w.oz * out + w.tz * along, sc, yaw);
        if (ok) counts["leaf wall drifts"] = (counts["leaf wall drifts"] ?? 0) + 1;
        // now and then a low pile of them in the lanes and on the quays (a solid bit: off the doors and lanes)
        if (ok && (lane > 1 || quay > 1) && r() < 0.07 * k) solidAt(r() < 0.5 ? "leafpile_0" : "leafpile_1", bx + w.ox * (out + 0.35), bz + w.oz * (out + 0.35), {}, { yaw: Math.atan2(-w.ox, -w.oz) });
      }
    }
    await sleep(0);

    // (b) the inside corners: walls on two sides at right angles, open behind: the wind leaves them there
    let corners = 0;
    for (let x = X0 + 1; x < X0 + MW - 1; x += 1)
      for (let z = Z0 + 1; z < Z0 + MH - 1; z += 1) {
        if (at(x, z) !== OPEN) continue;
        for (let q = 0; q < 4; q++) {
          const a = (q * Math.PI) / 2;
          const ax = Math.cos(a), az = Math.sin(a);
          const bx2 = -az, bz2 = ax;
          if (at(x + ax * 0.9, z + az * 0.9) === 1 && at(x + bx2 * 0.9, z + bz2 * 0.9) === 1 && at(x - ax * 2, z - az * 2) === OPEN && at(x - bx2 * 2, z - bz2 * 2) === OPEN && at(x - (ax + bx2) * 1.6, z - (az + bz2) * 1.6) === OPEN) {
            const k = swept(x, z) / FILTH;
            if (R() > 0.28 * k * (0.6 + treeNear(x, z))) continue;
            // into the corner: its dense side (+z of the mark) toward the corner's diagonal
            const dx = ax + bx2, dz = az + bz2;
            const yaw = Math.atan2(dx, dz);
            const cx = x + dx * 0.25;
            const cz = z + dz * 0.25;
            if (R() < 0.45 && solidAt(R() < 0.5 ? "leafpile_0" : "leafpile_1", cx, cz, {}, { yaw })) corners++;
            else if (leafAt(patch(), cx, cz, 0.7 + R() * 0.3, yaw)) corners++;
          }
        }
      }
    counts["leaf corners"] = corners;
    await sleep(0);

    // (c) the trees: a ring of leaves round each pit, a carpet out to 8 m under the crowns
    for (const t of trees) {
      const [tx, tz] = t;
      if (inPark(tx, tz) || tx < X0 || tx > X0 + MW || tz < Z0 || tz > Z0 + MH) continue;
      const k = Math.max(0.45, swept(tx, tz) / FILTH);
      const nRing = Math.round((2 + R() * 3) * k);
      for (let i = 0; i < nRing; i++) {
        const a = R() * Math.PI * 2;
        const d = 0.9 + R() * 1.6;
        leafAt(patch(), tx + Math.cos(a) * d, tz + Math.sin(a) * d, 0.8 + R() * 0.4, R() * 6.28);
      }
      const sq = t[2] === 1;
      const nCarpet = Math.round((sq ? 18 + R() * 10 : 8 + R() * 8) * k);
      for (let i = 0; i < nCarpet; i++) {
        const a = R() * Math.PI * 2;
        const d = 1.5 + Math.sqrt(R()) * (sq ? 12 : 9);
        leafAt(scatter(), tx + Math.cos(a) * d, tz + Math.sin(a) * d, 0.8 + R() * 0.5, R() * 6.28);
      }
    }
    await sleep(0);

    // (d) dung where the drays go round and stand: their lanes on the quays and round the blocks
    for (const route of TRAFFIC_ROUTES) {
      if (!route.vehicles.some((v) => v.kind === "dray")) continue;
      const pts = route.loop ? [...route.pts, route.pts[0]] : route.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i];
        const [bx, bz] = pts[i + 1];
        const L = Math.hypot(bx - ax, bz - az);
        if (L < 0.5) continue;
        const tx = (bx - ax) / L;
        const tz = (bz - az) / L;
        for (let s = R(); s < L; s += 1) {
          const off = (R() * 2 - 1) * 0.6;
          const x = ax + tx * s - tz * off;
          const z = az + tz * s + tx * off;
          if (R() < 0.05) solidAt(pick([[2, "dung_0"], [2, "dung_1"], [2, "dung_2"]]), x, z, { lane: true, market: true, start: true });
          if (R() < 0.1) leafAt(R() < 0.5 ? "dungflat_0" : "dungflat_1", x, z, 0.8 + R() * 0.5, R() * 6.28);
          if (R() < 0.035) leafAt(R() < 0.5 ? "straw_0" : "straw_1", x - tz * (R() - 0.5) * 2, z + tx * (R() - 0.5) * 2, 0.6 + R() * 0.4, R() * 6.28);
        }
      }
    }
    // the quays at large: the carts and their horses stood everywhere there
    for (const [ax, az, bx, bz] of city.quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 2) continue;
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      for (let t = R() * 4; t < L; t += 4) {
        const qx = ax + ((bx - ax) * t) / L;
        const qz = az + ((bz - az) * t) / L;
        const side = at(qx + nx * 3, qz + nz * 3) === OPEN ? 1 : at(qx - nx * 3, qz - nz * 3) === OPEN ? -1 : 0;
        if (!side) continue;
        const d = 3 + R() * 9;
        const x = qx + nx * side * d;
        const z = qz + nz * side * d;
        if (R() < 0.35) solidAt(pick([[2, "dung_0"], [2, "dung_1"], [3, "dung_2"]]), x, z, { lane: true });
        else if (R() < 0.5) leafAt(R() < 0.5 ? "dungflat_0" : "dungflat_1", x, z, 0.8 + R() * 0.5, R() * 6.28);
        if (R() < 0.3) leafAt(R() < 0.5 ? "straw_0" : "straw_1", x + (R() - 0.5) * 3, z + (R() - 0.5) * 3, 0.7 + R() * 0.4, R() * 6.28);
      }
    }
    // the gates: the carts waited there for the toll; dung and straw on the road just inside
    for (const g of decorT.rampart?.gates ?? []) {
      const p = g.passage;
      if (!p?.length) continue;
      const cx = p.reduce((a, q) => a + q[0], 0) / p.length;
      const cz = p.reduce((a, q) => a + q[1], 0) / p.length;
      // inside: the side of the passage nearer the town's middle
      const inx = -g.frame.n[0];
      const inz = -g.frame.n[1];
      const along = Math.hypot(p[0][0] - p[2][0], p[0][1] - p[2][1]) / 2 + 7;
      stand(cx + inx * along, cz + inz * along, inx, inz, 5, "gate stand");
    }
    // (e) straw round the markets' edges (the carts that brought the goods, the packing)
    for (const rect of markets) {
      const per = 2 * (rect.maxX - rect.minX + rect.maxZ - rect.minZ);
      for (let k = 0; k < per / 3; k++) {
        const f = R() * per;
        const w = rect.maxX - rect.minX;
        const h = rect.maxZ - rect.minZ;
        let x: number, z: number;
        if (f < w) (x = rect.minX + f), (z = rect.minZ - 0.8 - R() * 1.5);
        else if (f < w + h) (x = rect.maxX + 0.8 + R() * 1.5), (z = rect.minZ + f - w);
        else if (f < 2 * w + h) (x = rect.maxX - (f - w - h)), (z = rect.maxZ + 0.8 + R() * 1.5);
        else (x = rect.minX - 0.8 - R() * 1.5), (z = rect.maxZ - (f - 2 * w - h));
        const k2 = swept(x, z) / FILTH;
        if (R() > 0.45 * k2) continue;
        if (R() < 0.75) leafAt(R() < 0.5 ? "straw_0" : "straw_1", x, z, 0.6 + R() * 0.5, R() * 6.28);
        else solidAt("straw_wisp", x, z, { lane: true });
      }
    }
  }

  // the dirt map: the stands, the gutters, the heaps, the coal, the markets
  dirtStamp(stamps);

  // ================================================================ build: three BatchedMeshes
  const solidMat = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true, side: THREE.DoubleSide }), { affine: 0, noSnap: true });
  solidMat.name = "litter_solid";
  const flatMat = psx(
    // the grime pass (2026-09-26): the marks dimmed and dirtied a shade; bright straw stood out in the mist
    new THREE.MeshLambertMaterial({ map: decalMap, color: 0x9c9484, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -5 }),
    { affine: 0, noSnap: true, wet: true },
  );
  flatMat.name = "litter_flat";

  // the flat marks' own geometries: one quad per kind, and the gutters merged per chunk
  const [DW, DH] = meta.decalSize;
  // (glTF textures are not flipped: v runs down the image, as the rows of the atlas cells)
  const cellUv = (cell: [number, number, number, number], u: number, v: number): P => [(cell[0] + 0.5 + u * (cell[2] - 1)) / DW, (cell[1] + 0.5 + (1 - v) * (cell[3] - 1)) / DH];
  const flatGeo = (pos: number[], uv: number[], col: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
    g.computeBoundingSphere();
    return g;
  };
  const flatProtos = new Map<string, THREE.BufferGeometry>();
  for (const [name, d] of Object.entries(meta.decals)) {
    const c = d.cell;
    const wall = name === "urine_wall";
    // a unit quad: on the ground lying x by z, on a wall standing x by y (its front along +z)
    const P4: number[][] = wall ? [[-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 0], [-0.5, 1, 0]] : [[-0.5, 0, 0.5], [0.5, 0, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5]];
    const U4: P[] = [cellUv(c, 0, 0), cellUv(c, 1, 0), cellUv(c, 1, 1), cellUv(c, 0, 1)];
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(...P4[i]);
      uv.push(...U4[i]);
      col.push(1, 1, 1, 1);
    }
    const g = flatGeo(pos, uv, col);
    if (wall) g.setAttribute("normal", new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    flatProtos.set(name, g);
  }
  const gutterGeos: Array<{ key: string; g: THREE.BufferGeometry }> = [];
  const gc = meta.decals.gutter.cell;
  for (const [key, b] of gutterQuads) {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    for (let i = 0; i < b.length; i += 5) {
      const [x, z, u, v, a] = [b[i], b[i + 1], b[i + 2], b[i + 3], b[i + 4]];
      pos.push(x, 0.005, z);
      uv.push(...cellUv(gc, u, v));
      col.push(1, 1, 1, a);
    }
    gutterGeos.push({ key, g: flatGeo(pos, uv, col) });
  }

  // BatchedMesh per layer
  interface Inst { batch: THREE.BatchedMesh; id: number; chunk: string; market?: string; u?: number; night?: boolean }
  const insts: Inst[] = [];
  const chunkInsts = new Map<string, Inst[]>();
  const chunkKey = (x: number, z: number) => `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
  function makeBatch(layer: Layer, mat: THREE.Material, list: Put[], extra: Array<{ key: string; g: THREE.BufferGeometry }> = [], reserve: string[] = []): THREE.BatchedMesh {
    const geoOf = (name: string) => (layer === "flat" ? flatProtos.get(name) : protos.get(name)?.geo);
    const names = [...new Set([...list.map((p) => p.name), ...reserve])].filter((n) => geoOf(n));
    let verts = 0;
    for (const n of names) verts += geoOf(n)!.getAttribute("position").count;
    for (const e of extra) verts += e.g.getAttribute("position").count;
    const batch = new THREE.BatchedMesh(Math.max(1, list.length + extra.length), Math.max(3, verts), 0, mat);
    batch.name = `litter_${layer}`;
    batch.perObjectFrustumCulled = false;
    batch.sortObjects = false;
    batch.frustumCulled = false;
    const gid = new Map<string, number>();
    for (const n of names) gid.set(n, batch.addGeometry(geoOf(n)!));
    const M = new THREE.Matrix4();
    const Q = new THREE.Quaternion();
    const S = new THREE.Vector3();
    const T = new THREE.Vector3();
    const Y = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    for (const p of list) {
      const g = gid.get(p.name);
      if (g === undefined) continue;
      const id = batch.addInstance(g);
      if (layer === "flat") S.set(p.sx, 1, p.sz);
      else S.set(p.sx, p.sx, p.sz);
      if (p.name === "urine_wall") S.set(p.sx, p.sz, 1);
      M.compose(T.set(p.x, p.y, p.z), Q.setFromAxisAngle(Y, p.yaw), S);
      batch.setMatrixAt(id, M);
      batch.setColorAt(id, col.setScalar(p.shade));
      const inst: Inst = { batch, id, chunk: chunkKey(p.x, p.z), market: p.market, u: p.u };
      insts.push(inst);
      let l = chunkInsts.get(inst.chunk);
      if (!l) chunkInsts.set(inst.chunk, (l = []));
      l.push(inst);
    }
    for (const e of extra) {
      const g = batch.addGeometry(e.g);
      const id = batch.addInstance(g);
      batch.setColorAt(id, col.setScalar(1));
      const [ci, cj] = e.key.split(",").map(Number);
      const inst: Inst = { batch, id, chunk: `${ci},${cj}` };
      insts.push(inst);
      let l = chunkInsts.get(inst.chunk);
      if (!l) chunkInsts.set(inst.chunk, (l = []));
      l.push(inst);
    }
    return batch;
  }
  const solidPuts = puts.filter((p) => p.layer === "solid");
  // (the prop check: dev/propcheck.ts)
  dropProps("litter");
  for (const p of solidPuts) {
    const g = protos.get(p.name)?.geo.getAttribute("position");
    if (g) addProp({ src: "litter", name: p.name, x: p.x, y: p.y, z: p.z, yaw: p.yaw, s: [p.sx, p.sx, p.sz], pts: [g.array], set: p.set });
  }
  const flatPuts = puts.filter((p) => p.layer === "flat");
  const floatPuts = puts.filter((p) => p.layer === "float");
  const solidBatch = makeBatch("solid", solidMat, solidPuts);
  const flatBatch = makeBatch("flat", flatMat, flatPuts, gutterGeos);
  flatBatch.renderOrder = 1;
  // the floating things, and the rats of the night (they run: their matrices are set each frame)
  const RATS = 8;
  const ratGeo = protos.get("rat_dead");
  const floatBatch = new THREE.BatchedMesh(floatPuts.length + RATS, [...new Set([...floatPuts.map((p) => p.name), "rat_dead"])].reduce((a, n) => a + (protos.get(n)?.geo.getAttribute("position").count ?? 0), 0) + 3, 0, solidMat);
  floatBatch.name = "litter_float";
  floatBatch.perObjectFrustumCulled = false;
  floatBatch.sortObjects = false;
  floatBatch.frustumCulled = false;
  const fgid = new Map<string, number>();
  const fcol = new THREE.Color();
  for (const p of floatPuts) {
    if (!fgid.has(p.name)) fgid.set(p.name, floatBatch.addGeometry(protos.get(p.name)!.geo));
    const id = floatBatch.addInstance(fgid.get(p.name)!);
    floatBatch.setColorAt(id, fcol.setScalar(p.shade));
    const inst: Inst = { batch: floatBatch, id, chunk: chunkKey(p.x, p.z) };
    floaters.push({ i: id, x: p.x, z: p.z, yaw: p.yaw, ph: R() * 6.28, name: p.name, chunk: inst.chunk });
    insts.push(inst);
    let l = chunkInsts.get(inst.chunk);
    if (!l) chunkInsts.set(inst.chunk, (l = []));
    l.push(inst);
  }
  // live rats: a rat lies on its side when dead; alive it runs upright (the same model turned)
  interface Rat { id: number; x: number; z: number; tx: number; tz: number; ox: number; oz: number; s: number; L: number; y: number; speed: number; wait: number; on: boolean; flee: boolean; ax: number; az: number }
  const rats: Rat[] = [];
  if (ratGeo) {
    if (!fgid.has("rat_dead")) fgid.set("rat_dead", floatBatch.addGeometry(ratGeo.geo));
    for (let k = 0; k < RATS; k++) {
      const id = floatBatch.addInstance(fgid.get("rat_dead")!);
      floatBatch.setColorAt(id, fcol.setScalar(0.75));
      floatBatch.setVisibleAt(id, false);
      rats.push({ id, x: 0, z: 0, tx: 1, tz: 0, ox: 0, oz: 1, s: 0, L: 0, y: 0, speed: 0, wait: 0, on: false, flee: false, ax: 0, az: 0 });
    }
  }

  const group = new THREE.Group();
  group.name = "litter";
  group.add(solidBatch, flatBatch, floatBatch);
  scene.add(group);

  // ---------------------------------------------------------------- showing: chunks beyond the fog, market levels
  const chunkShown = new Map<string, boolean>();
  const levels: Record<string, number> = { vismarkt: -1, grote_markt: -1 };
  const shown = (i: Inst) => (chunkShown.get(i.chunk) ?? false) && (i.market ? (i.u ?? 0) < levels[i.market] : true);
  /** How much of a market's waste lies on the stones at this hour (0..1). */
  const levelOf = (place: string, day: number, hour: number): number => {
    const m = MARKET_DAYS.find((d) => d.place === place);
    if (!m) return 0.15;
    const dow = (d: number) => ((((d - 1) % 7) + 7) % 7) + 1;
    const today = m.days.includes(dow(day));
    const yesterday = m.days.includes(dow(day - 1));
    // the sweepers came at first light (about 5): until then yesterday's waste lies
    if (hour < 5) return yesterday ? 1 : 0.12;
    if (!today) return hour < m.setup ? 0.12 : 0.15;
    if (hour < m.open) return 0.12;
    if (hour < m.close) return 0.2 + 0.15 * ((hour - m.open) / (m.close - m.open));
    const share = marketShare(place, day, hour);
    if (hour < m.gone) return 0.35 + 0.65 * (1 - share);
    return 1;
  };
  let lastCam = new THREE.Vector2(1e9, 1e9);
  let lastFar = -1;
  function applyChunks(cam: THREE.Camera, force = false): void {
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 60) + 6;
    const p = cam.position;
    if (!force && Math.hypot(p.x - lastCam.x, p.z - lastCam.y) < 2 && Math.abs(far - lastFar) < 2) return;
    lastCam = new THREE.Vector2(p.x, p.z);
    lastFar = far;
    for (const [key, list] of chunkInsts) {
      const [i, j] = key.split(",").map(Number);
      const d = Math.hypot((i + 0.5) * CH - p.x, (j + 0.5) * CH - p.z) - CH * 0.71;
      const vis = d < far;
      if (chunkShown.get(key) === vis) continue;
      chunkShown.set(key, vis);
      for (const inst of list) inst.batch.setVisibleAt(inst.id, shown(inst));
    }
  }
  function applyLevels(): void {
    let changed = false;
    for (const place of Object.keys(levels)) {
      const l = Math.round(levelOf(place, clockDay, clockHour) * 20) / 20;
      if (l !== levels[place]) {
        levels[place] = l;
        changed = true;
      }
    }
    if (changed) for (const inst of insts) if (inst.market) inst.batch.setVisibleAt(inst.id, shown(inst));
  }
  // cull for whichever camera draws (the mirrors too), before the batch builds its draw list
  for (const b of [solidBatch, flatBatch, floatBatch]) {
    const base = b.onBeforeRender.bind(b);
    b.onBeforeRender = (r, s, cam, g, m, grp) => {
      applyChunks(cam);
      base(r, s, cam, g, m, grp);
    };
  }
  applyLevels();

  // ---------------------------------------------------------------- the rats: along the wall foot at night, away from you
  const ratWalls = walls.filter((w) => w.L > 3);
  const Mr = new THREE.Matrix4();
  const Qr = new THREE.Quaternion();
  const Er = new THREE.Euler();
  const Sr = new THREE.Vector3(1, 1, 1);
  const Tr = new THREE.Vector3();
  function spawnRat(rat: Rat, px: number, pz: number): void {
    for (let tries = 0; tries < 12; tries++) {
      const w = ratWalls[Math.floor(Math.random() * ratWalls.length)];
      const mx = w.ax + w.tx * w.L * 0.5;
      const mz = w.az + w.tz * w.L * 0.5;
      const d = Math.hypot(mx - px, mz - pz);
      if (d < 7 || d > 24) continue;
      const out = w.kind === 0 ? 0.25 : 0.2;
      if (at(mx + w.ox * 0.6, mz + w.oz * 0.6) !== OPEN) continue;
      rat.tx = w.tx;
      rat.tz = w.tz;
      rat.ox = w.ox;
      rat.oz = w.oz;
      rat.L = w.L;
      rat.ax = w.ax + w.ox * out;
      rat.az = w.az + w.oz * out;
      rat.s = Math.random() * w.L;
      rat.y = w.kind === 0 ? KERB_Y : 0;
      rat.speed = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 1.2);
      rat.wait = Math.random() * 2;
      rat.on = true;
      rat.flee = false;
      floatBatch.setVisibleAt(rat.id, true);
      return;
    }
  }
  let ratClock = 0;
  function updateRats(dt: number, cam?: THREE.Camera): void {
    const night = clockHour >= 20 || clockHour < 5.5;
    const p = cam?.position;
    for (const rat of rats) {
      if (!night || !p) {
        if (rat.on) {
          rat.on = false;
          floatBatch.setVisibleAt(rat.id, false);
        }
        continue;
      }
      if (!rat.on) {
        ratClock -= dt;
        if (ratClock <= 0) {
          ratClock = 0.8 + Math.random() * 3;
          spawnRat(rat, p.x, p.z);
        }
        continue;
      }
      const x = rat.ax + rat.tx * rat.s;
      const z = rat.az + rat.tz * rat.s;
      const dp = Math.hypot(x - p.x, z - p.z);
      // you come near: it bolts, away from you, and is gone at the end of the wall
      if (dp < 4.5 && !rat.flee) {
        rat.flee = true;
        const away = (x - p.x) * rat.tx + (z - p.z) * rat.tz;
        rat.speed = (away >= 0 ? 1 : -1) * 4.5;
        rat.wait = 0;
      }
      if (rat.wait > 0) rat.wait -= dt;
      else {
        rat.s += rat.speed * dt;
        if (!rat.flee && Math.random() < dt * 0.4) rat.wait = 0.3 + Math.random() * 1.5; // stops to sniff
      }
      if (rat.s < 0 || rat.s > rat.L || dp > 30) {
        rat.on = false;
        floatBatch.setVisibleAt(rat.id, false);
        continue;
      }
      const dir = rat.speed >= 0 ? 1 : -1;
      // the model's head is its +x: turn it along the way it runs
      Er.set(0, Math.atan2(-rat.tz * dir, rat.tx * dir), 0);
      Qr.setFromEuler(Er);
      const bob = rat.wait > 0 ? 0 : Math.abs(Math.sin(rat.s * 9)) * 0.015;
      Mr.compose(Tr.set(x, rat.y + bob, z), Qr, Sr);
      floatBatch.setMatrixAt(rat.id, Mr);
    }
  }

  // ---------------------------------------------------------------- per frame
  const Mf = new THREE.Matrix4();
  const Qf = new THREE.Quaternion();
  const Ef = new THREE.Euler();
  const Sf = new THREE.Vector3(1, 1, 1);
  const Tf = new THREE.Vector3();
  function update(t: number, dt: number, cam?: THREE.Camera): void {
    if (cam) applyChunks(cam);
    applyLevels();
    const wt = psxUniforms.uTime.value;
    for (const f of floaters) {
      if (!chunkShown.get(f.chunk)) continue;
      // bob on the waves (waveAt is the water shader's sum), turn slowly, drift a hand's breadth
      const dx = Math.sin(t * 0.07 + f.ph) * 0.25;
      const dz = Math.cos(t * 0.05 + f.ph) * 0.25;
      const y = levelAt(f.x + dx, f.z + dz) + waveAt(f.x + dx, f.z + dz, wt) - 0.025; // M6 tides
      Ef.set(Math.sin(t * 0.9 + f.ph) * 0.08, f.yaw + t * 0.02, Math.cos(t * 0.7 + f.ph) * 0.08);
      Mf.compose(Tf.set(f.x + dx, y, f.z + dz), Qf.setFromEuler(Ef), Sf);
      floatBatch.setMatrixAt(f.i, Mf);
    }
    updateRats(dt, cam);
  }
  update(0, 0);

  let triangles = 0;
  for (const p of puts) triangles += p.layer === "flat" ? 2 : (protos.get(p.name)?.tris ?? 0);
  for (const g of gutterGeos) triangles += g.g.getAttribute("position").count / 3;
  counts["road metres"] = roadMetres;
  // picture round 2026-09-26 (package 1): the flat marks' check, from the dev tools:
  // scene.getObjectByName("litter").userData.check({ only: "leaf" }) -> { marks, problems, list }. Every corner and edge
  // of a mark on open ground (not in a wall, not over the water) and on the ground as built at the mark's own height
  // (not floating over a street off a kerb, not under a step); the solid bits are propcheck()'s.
  group.userData.stats = () => ({ counts, solid: solidPuts.length, flat: flatPuts.length, triangles });
  group.userData.check = (o: { only?: string } = {}) => {
    const list: Array<{ name: string; at: [number, number]; why: string }> = [];
    let marks = 0;
    for (const p of flatPuts) {
      if (p.name === "urine_wall" || (o.only && !p.name.includes(o.only))) continue;
      marks++;
      const c = Math.cos(p.yaw);
      const sn = Math.sin(p.yaw);
      let why = "";
      for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0, 0]]) {
        const px = p.x + u * p.sx * c + v * p.sz * sn;
        const pz = p.z - u * p.sx * sn + v * p.sz * c;
        const f = at(px, pz);
        if (f & WATER) why ||= "over the water";
        else if (f !== OPEN) why ||= "in a wall";
        const g = opts.ground?.(px, pz, p.y + 0.3);
        if (g !== undefined && g !== null && Math.abs(g - (p.y - 0.007)) > 0.045) why ||= g < p.y ? `floating ${(p.y - g).toFixed(2)} m` : `under the ground ${(g - p.y).toFixed(2)} m`;
      }
      if (why) list.push({ name: p.name, at: [+p.x.toFixed(1), +p.z.toFixed(1)], why });
    }
    return { marks, problems: list.length, list: list.slice(0, 40) };
  };
  return {
    group,
    colliders,
    update,
    stats: { counts, solid: solidPuts.length, flat: flatPuts.length + gutterGeos.length, floating: floatPuts.length, triangles, gutterMetres: Math.round(gutterMetres) },
    sites,
  };
}
