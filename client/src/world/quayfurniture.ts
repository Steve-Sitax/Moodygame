import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { trackKeepOut, type TrackData } from "./tracks";
import { trafficLanes } from "./traffic";
import { loadProps } from "./props3d";
import { wallBox, type WallBox } from "./wallprobe";

// Quay furniture (tools/blender/build_quayfurniture.py -> /models/quayfurniture.glb): the
// iron, rope and timber along the water, after the 1870s photos of the Antwerp quays.
// Mooring rings on staples in the wall face (a rust run under each), rings in the edge
// stones, rope and timber fenders, the iron strip on the coping, drain gratings, worn
// stones at the steps; cast-iron bollards of three kinds and oak posts on the edge,
// capstans; chains and hawsers lying out, anchors, cable reels; the harbour master's hut,
// customs booths, the ferry toll shed, notice boards and signs; nets and a sail drying,
// oars, eel pots, fish baskets by the Vismarkt, coal heaps, grain on pallets, timber
// baulks, tar barrels with a fire, boats upturned on trestles; lanterns at the steps;
// painted quay names and berth numbers on the walls, a weigh house door and notices on
// the storehouse walls.
//
// Placed from data (the quay lines and water of shared/city.json, the walk map, the
// flights and ladders of quaysteps.ts, the storehouse fronts of props.glb) with a seeded
// random, so the quays look the same every load. Copies are merged per 64 m chunk and
// material (at most five draw calls per chunk in view); chunks beyond the fog are hidden.
// Only solid things (bollards, posts, capstans, huts, heaps) block walking; rings,
// fenders, chains, ropes and paint do not.

type Flags = (x: number, z: number) => number | undefined;

export interface QuayFurnitureOptions {
  /** Seed for the layout. */
  seed?: number;
  /** Colliders already on the ground (props, street life, cranes, lamps): nothing goes on them. */
  avoid?: Rect[];
  /** The stone steps and ladders (world.quayInfo); waits for the ladders if they are not in yet. */
  quayInfo?: () => { flights: Array<{ top: [number, number]; end: [number, number] }>; ladders: Array<{ x: number; z: number; top: number }> };
  /**
   * Bollards the caller already has colliders for (rijnkaai.ts by the start): drawn here with
   * the new models, no colliders added.
   */
  bollards?: Array<[number, number]>;
  /** Extra circles to keep clear. */
  keepClear?: Array<{ x: number; z: number; r: number }>;
  /** Dev: list every copy in `sites`, not only the bigger things. */
  allSites?: boolean;
  /**
   * Fixes 2026-09-25 (a notice painted across an Entrepot window): the house walls' painted windows,
   * doors and signs (world/streetlife.ts clearOnWall, addWallItem). The notices and quay names on the
   * storehouse walls keep off them, and go on the list the sign check reads.
   */
  houseWalls?: { clear(b: WallBox): string | null; add(b: WallBox): void };
}

export interface QuayFurniture {
  group: THREE.Group;
  /** Walk colliders for the solid things; add them to the world. */
  colliders: Rect[];
  /**
   * Once a frame. `lit` 0..1: how far the lanterns are lit (the gas lamps' level). `cam`: hide
   * the chunks beyond the fog for this camera now.
   */
  update(t: number, dt: number, lit?: number, cam?: THREE.Camera): void;
  stats: { counts: Record<string, number>; meshes: number; triangles: number };
  /** Where the bigger things stand (huts, booths, boards, lanterns, heaps), for maps and checks. */
  sites: Array<{ kind: string; x: number; z: number; yaw: number }>;
  /** The notices and quay names painted on the storehouse walls, as boxes (dev/signcheck.ts). */
  wallItems: WallBox[];
  /** Those moved off a painted window, a door or a sign (where the old rule put them, and why), or left out. */
  moved: Array<{ model: string; from: [number, number, number]; to: [number, number, number] | null; why: string }>;
}

interface Meta {
  wallNames: Array<{ name: string; model: string; len: number }>;
  wallNotices: Array<{ model: string; len: number }>;
  berths: number[];
  stores: number[][];
  solid: { size: [number, number]; cells: Record<string, [number, number, number, number]> };
  decal: { size: [number, number]; cells: Record<string, [number, number, number, number]> };
}

interface CityData {
  doors: Record<string, { x: number; z: number; out: [number, number]; width: number }>;
  bridges: Record<string, number[]>;
  quays: number[][];
  water: Array<{ outer: number[][] }>;
  decor?: TrackData & { rails?: number[][]; lamps?: Array<[number, number]>; trees?: Array<[number, number]> };
}

const OPEN = 0;
const CHUNK = 64;

/** Material slots: one merged mesh per chunk and slot. */
const SOLID = 0;
/** Decals that lie still (the ground, the quay wall: neither is vertex-snapped). */
const FLAT_DECAL = 1;
/** Decals on snapped things (storehouse walls, nets on their poles). */
const SNAP_DECAL = 2;
const GLOW = 3;
const FIRE = 4;
const SLOT_NAMES = ["quay_solid", "quay_flatdecal", "quay_snapdecal", "quay_glow", "quay_fire"];

interface Part {
  slot: number;
  pos: Float32Array;
  nor: Float32Array;
  uv: Float32Array;
  col: Float32Array;
}
interface Proto {
  parts: Part[];
  /** Footprint under 1.5 m in its own frame, and height. */
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  /** Bounds of every vertex [x0, y0, z0, x1, y1, z1] in its own frame (for wall things' boxes). */
  box: number[];
}

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

// ------------------------------------------------------------------ loading

async function loadModels(): Promise<{ protos: Map<string, Proto>; meta: Meta; solidMap: THREE.Texture; decalMap: THREE.Texture }> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/quayfurniture.glb");
  draco.dispose();
  let meta: Meta | null = null;
  const maps: { solid?: THREE.Texture; decal?: THREE.Texture } = {};
  const slotOf: Record<string, number> = { qf_solid: SOLID, qf_decal: FLAT_DECAL, qf_glow: GLOW, qf_fire: FIRE };
  const protos = new Map<string, Proto>();
  const v = new THREE.Vector3();
  const nrm = new THREE.Matrix3();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    if (node.name === "quayfurniture_meta") {
      meta = JSON.parse(node.userData.meta as string) as Meta;
      continue;
    }
    const proto: Proto = { parts: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0, box: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      if (mat.map) {
        if (mat.name === "qf_decal") maps.decal ??= mat.map;
        else maps.solid ??= mat.map;
      }
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const M = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
      nrm.getNormalMatrix(M);
      const P = g.getAttribute("position");
      const N = g.getAttribute("normal");
      const U = g.getAttribute("uv");
      const C = g.getAttribute("color");
      const n = P.count;
      const slot = slotOf[mat.name] ?? SOLID;
      const part: Part = { slot, pos: new Float32Array(n * 3), nor: new Float32Array(n * 3), uv: new Float32Array(n * 2), col: new Float32Array(n * 3) };
      for (let i = 0; i < n; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(M);
        part.pos.set([v.x, v.y, v.z], i * 3);
        const bb = proto.box;
        bb[0] = Math.min(bb[0], v.x);
        bb[1] = Math.min(bb[1], v.y);
        bb[2] = Math.min(bb[2], v.z);
        bb[3] = Math.max(bb[3], v.x);
        bb[4] = Math.max(bb[4], v.y);
        bb[5] = Math.max(bb[5], v.z);
        if (slot === SOLID || slot === FIRE) {
          proto.height = Math.max(proto.height, v.y);
          if (v.y < 1.5 && v.y > -0.05) {
            proto.minX = Math.min(proto.minX, v.x);
            proto.maxX = Math.max(proto.maxX, v.x);
            proto.minZ = Math.min(proto.minZ, v.z);
            proto.maxZ = Math.max(proto.maxZ, v.z);
          }
        }
        if (N) {
          v.fromBufferAttribute(N, i).applyMatrix3(nrm).normalize();
          part.nor.set([v.x, v.y, v.z], i * 3);
        } else part.nor.set([0, 1, 0], i * 3);
        if (U) part.uv.set([U.getX(i), U.getY(i)], i * 2);
        if (C) part.col.set([C.getX(i), C.getY(i), C.getZ(i)], i * 3);
        else part.col.set([1, 1, 1], i * 3);
      }
      proto.parts.push(part);
    });
    if (!Number.isFinite(proto.minX)) proto.minX = proto.maxX = proto.minZ = proto.maxZ = 0;
    if (proto.parts.length) protos.set(node.name, proto);
  }
  const solidMap = maps.solid;
  const decalMap = maps.decal;
  if (!meta || !solidMap || !decalMap) throw new Error("quayfurniture.glb: meta or textures missing");
  for (const t of [solidMap, decalMap]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
  }
  return { protos, meta, solidMap, decalMap };
}

class Bucket {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
}

// ------------------------------------------------------------------ the quays

/** A stretch of quay wall: from a, along t, water on the side n. */
interface Seg {
  ax: number;
  az: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  L: number;
}

type District = "werf" | "steen" | "vismarkt" | "canal" | "rijnkaai" | "north" | "bassin";

/** Which quay a point is on (null: the lock, leave it alone). */
function districtAt(x: number, z: number): District | null {
  if (x > 99 && x < 121 && z > -3 && z < 50) return null; // the lock and its channel
  if (x > -84 && x < -68 && z > 2) return "canal";
  if (x < -214) return "werf";
  if (x < -149) return "steen";
  if (x < -82) return "vismarkt";
  if (z > 44 && x > 60 && x < 180) return "bassin";
  if (x > 116) return "north";
  return "rijnkaai";
}

/** The game's own quay by the start (rijnkaai.ts: pier, ship, crane, crates, its bollards). */
const START: Rect = { minX: -72, maxX: 66, minZ: -30, maxZ: 27 };
const inRectP = (r: Rect, x: number, z: number, pad = 0) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
const overlap = (a: Rect, b: Rect, pad = 0) => a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad;

function distSeg(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

/** What stands where, by quay (the wishes; each is tried until it fits or the quay is full). */
const CLUTTER: Record<District, Array<[string, number]>> = {
  werf: [["boat_trestles", 1], ["timber_baulks", 1], ["tar_fire", 1], ["anchor", 1], ["cable_reel", 1], ["oars_rack", 1], ["sail_drying", 1], ["hawser_coil", 1]],
  steen: [["hawser_coil", 1]],
  vismarkt: [["fish_baskets", 3], ["eel_pots", 3], ["nets_drying", 2], ["sail_drying", 1], ["oars_rack", 1], ["boat_trestles", 1], ["anchor", 1], ["tar_fire", 1], ["hawser_coil", 1]],
  canal: [["eel_pots", 1], ["nets_drying", 1], ["oars_rack", 1]],
  rijnkaai: [["coal_heap", 1], ["grain_pallet", 2], ["cable_reel", 1], ["anchor", 1]],
  north: [["coal_heap", 2], ["grain_pallet", 1], ["cable_reel", 1], ["anchor", 1], ["tar_fire", 1], ["timber_baulks", 1], ["hawser_coil", 1]],
  bassin: [["grain_pallet", 2], ["timber_baulks", 2], ["cable_reel", 1], ["anchor", 1], ["coal_heap", 1], ["hawser_coil", 2], ["boat_trestles", 1], ["sail_drying", 1], ["tar_fire", 1]],
};
/** Things with a place of their own: model, anchor, search radius, facing (toward the water or inland). */
const ANCHORED: Array<[string, number, number, number, "water" | "inland"]> = [
  ["harbour_hut", 97, 36, 16, "water"],
  ["harbour_hut", 124, 28, 14, "water"],
  ["customs_booth", 160, 114, 16, "water"],
  ["customs_booth", -196, 4, 14, "water"],
  ["toll_shed", -249, 12, 14, "water"],
  ["notice_board", -114, 2, 10, "inland"],
  ["notice_board", 180, 2, 12, "inland"],
  ["notice_board", 96, 49, 12, "inland"],
  ["notice_board", -236, 2, 16, "inland"],
  ["sign_name_werf", -266, 1, 14, "inland"],
  ["sign_name_steenplein", -156.5, -34.5, 10, "inland"], // M3i: off the Steen, on the promontory's south-east corner
  ["sign_name_vismarkt", -124, 1, 10, "inland"],
  ["sign_name_rijnkaai", 86, 1, 14, "inland"],
  ["sign_name_bassin", 128, 108, 16, "inland"],
  ["sign_name_bassin", 140, 48, 16, "inland"],
  ["sign_nosmoke", 150, 1, 14, "inland"],
  ["sign_nosmoke", 100, 108, 14, "inland"],
  ["sign_nosmoke", -228, 1, 12, "inland"],
  ["sign_nofire", -300, 1, 14, "inland"],
  ["sign_nofire", 72, 80, 14, "inland"],
  ["sign_nofire", 196, 1, 8, "inland"],
];
/** Edge things by quay: the kinds in turn, and the spacing (m). */
const EDGE: Record<District, { kinds: string[]; step: number }> = {
  werf: { kinds: ["bollard_cannon", "bollard_cannon", "bitt_double", "bollard_cannon"], step: 12 },
  steen: { kinds: ["bollard_cannon"], step: 16 },
  vismarkt: { kinds: ["post_timber", "bollard_cannon", "post_timber"], step: 10 },
  canal: { kinds: ["post_timber"], step: 15 },
  rijnkaai: { kinds: ["bollard_mushroom", "bollard_mushroom", "bitt_double"], step: 13 },
  north: { kinds: ["bollard_mushroom", "bitt_double", "bollard_mushroom"], step: 13 },
  bassin: { kinds: ["post_timber", "bollard_mushroom", "post_timber", "bitt_double"], step: 11 },
};
/** Quay names painted on the wall face: [name index in meta.wallNames, x, z]. */
const WALL_NAME_AT: Array<[string, number, number]> = [
  ["WERF", -290, 0],
  ["WERF", -232, 0],
  ["STEENPLEIN", -182, -42],
  ["VISMARKT", -124, 0],
  ["RIJNKAAI", 26, 0],
  ["RIJNKAAI", 80, 0],
  ["PETIT BASSIN", 120, 110],
  ["PETIT BASSIN", 140, 46],
  ["PETIT BASSIN", 70, 70],
];
/**
 * Where boats lie along the walls (rijnkaai.ts: its moor() calls; keep in step): [x0, z0, x1, z1].
 * Bollards here get a line down to the water.
 */
const MOORED: number[][] = [
  [-316, 0, -258, 0], [-240, 0, -216, 0], [-140, 0, -119, 0], [-107, 0, -90, 0], [60, 0, 100, 0], [120, 0, 176, 0],
  [-82, 12, -82, 202], [-70, 12, -70, 202], [-150, 11, -150, 38], [-142, 49, -142, 70],
  [70, 50, 70, 106], [170, 50, 170, 106], [76, 110, 164, 110], [120, 46, 164, 46],
];
const moored = (x: number, z: number) => MOORED.some(([x0, z0, x1, z1]) => distSeg(x, z, x0, z0, x1, z1) < 1.5);

/** Where the town's people haul and sell (server town/places.ts HAULS quay ends and STALLS): keep open. */
export const TOWN_CLEAR: Array<[number, number, number]> = [
  [-12, 4, 2], [26, 5, 2], [-40, 5, 2], [45, 5, 2], [12, 5, 2], [2, 5, 2], [173, 55, 2.5], [173, 108, 2.5], [160, 40, 2.5],
  [90, 44, 2.5], [130, 44, 2.5], [66, 60, 2.5], [90, 113, 2.5], [140, 113, 2.5], [-300, 3, 2], [-262, 3, 2], [-230, 3, 2],
  [-139, 22, 2.5], [-139, 34, 2.5], [-65, 90, 2.5], [-87, 120, 2.5],
  [-128, 18, 3.5], [-128, 24, 3.5], [-128, 30, 3.5], [-104, 18, 3.5], [-104, 24, 3.5], [-104, 30, 3.5],
];

/**
 * Quay furniture for the city. Call after the city, the props and the street life are
 * placed (the walk map must be in; it waits for it, and for the ladders, if not).
 */
export async function createQuayFurniture(scene: THREE.Scene, flags: Flags, opts: QuayFurnitureOptions = {}): Promise<QuayFurniture> {
  const { protos, meta, solidMap, decalMap } = await loadModels();
  for (let i = 0; i < 600 && flags(0, 0) === undefined; i++) await sleep(100);
  // the ladders go up once the boats lie where they lie (rijnkaai.ts placeLadders): wait for them
  let info = opts.quayInfo?.() ?? { flights: [], ladders: [] };
  for (let i = 0; i < 300 && opts.quayInfo && info.ladders.length <= info.flights.length; i++) {
    await sleep(100);
    info = opts.quayInfo();
  }
  const props = await loadProps().catch(() => null);
  const city = CITY as unknown as CityData;
  const R = rng(opts.seed ?? 1873);
  const at = (x: number, z: number) => flags(x, z) ?? -1;

  // --- materials: one atlas for solid things, one for flat things
  const DS = THREE.DoubleSide;
  const decalOpts = { map: decalMap, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: DS };
  const mats: THREE.Material[] = [];
  // a pixel's depth toward the eye: fenders, ladders and plates lie a centimetre or two off the quay
  // walls, and with the PS1 wobble that near they flickered through (z-fight check)
  mats[SOLID] = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true, side: DS, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { affine: 0 });
  mats[FLAT_DECAL] = psx(new THREE.MeshLambertMaterial({ ...decalOpts }), { affine: 0, noSnap: true });
  mats[SNAP_DECAL] = psx(new THREE.MeshLambertMaterial({ ...decalOpts, alphaTest: 0.3 }), { affine: 0 });
  const glowMat = new THREE.MeshBasicMaterial({ map: solidMap, color: 0xffc070, fog: false });
  mats[GLOW] = glowMat;
  const fireMat = new THREE.MeshBasicMaterial({ map: solidMap, color: 0xffffff, fog: false, side: DS });
  mats[FIRE] = fireMat;
  mats.forEach((m, i) => (m.name = SLOT_NAMES[i]));

  const buckets = new Map<string, Bucket>();
  const counts: Record<string, number> = {};
  const count = (k: string, n = 1) => (counts[k] = (counts[k] ?? 0) + n);
  const sites: QuayFurniture["sites"] = [];
  const SITE = /^(harbour_hut|customs_booth|toll_shed|notice_board|lantern_post|capstan|coal_heap|tar_fire|boat_trestles|sign_|weigh_door)/;
  const M = new THREE.Matrix4();
  const Q = new THREE.Quaternion();
  const S = new THREE.Vector3(1, 1, 1);
  const Pv = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  const up = new THREE.Vector3(0, 1, 0);

  function bucket(x: number, z: number, slot: number): Bucket {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)},${slot}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = new Bucket()));
    return b;
  }

  /** A copy of a model at (x, y, z), turned by yaw (0: its front looks along +z). `snap`: its decals go with snapped walls. */
  function put(name: string, x: number, y: number, z: number, yaw: number, snap = false): void {
    const p = protos.get(name);
    if (!p) return;
    M.compose(Pv.set(x, y, z), Q.setFromAxisAngle(up, yaw), S);
    nm.getNormalMatrix(M);
    const e = M.elements;
    const n = nm.elements;
    for (const part of p.parts) {
      const slot = part.slot === FLAT_DECAL && snap ? SNAP_DECAL : part.slot;
      const b = bucket(x, z, slot);
      const { pos, nor, uv, col } = part;
      for (let i = 0; i < pos.length; i += 3) {
        const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
        b.pos.push(e[0] * px + e[4] * py + e[8] * pz + e[12], e[1] * px + e[5] * py + e[9] * pz + e[13], e[2] * px + e[6] * py + e[10] * pz + e[14]);
        const nx = nor[i], ny = nor[i + 1], nz = nor[i + 2];
        const ox = n[0] * nx + n[3] * ny + n[6] * nz;
        const oy = n[1] * nx + n[4] * ny + n[7] * nz;
        const oz = n[2] * nx + n[5] * ny + n[8] * nz;
        const l = Math.hypot(ox, oy, oz) || 1;
        b.nor.push(ox / l, oy / l, oz / l);
        b.col.push(col[i], col[i + 1], col[i + 2]);
      }
      for (let i = 0; i < uv.length; i++) b.uv.push(uv[i]);
    }
    count(name.replace(/_\d+$/, ""));
    if (opts.allSites || SITE.test(name)) sites.push({ kind: name, x: +x.toFixed(1), z: +z.toFixed(1), yaw: +yaw.toFixed(2) });
  }

  /** UV of a point in a solid-atlas cell (u, v in 0..1, v up), as the glb does it. */
  function cellUv(cell: string, u: number, v: number): [number, number] {
    const [x, y, w, h] = meta.solid.cells[cell];
    const [W, H] = meta.solid.size;
    return [(x + 0.5 + Math.min(1, Math.max(0, u)) * (w - 1)) / W, (y + 0.5 + (1 - Math.min(1, Math.max(0, v))) * (h - 1)) / H];
  }
  /** A quad of our own in the solid atlas: corners counter-clockwise seen from the front. */
  function quad(cell: string, pts: number[][], shade = 1): void {
    const cx = (pts[0][0] + pts[2][0]) / 2;
    const cz = (pts[0][2] + pts[2][2]) / 2;
    const b = bucket(cx, cz, SOLID);
    const ax = pts[1][0] - pts[0][0], ay = pts[1][1] - pts[0][1], az = pts[1][2] - pts[0][2];
    const bx = pts[3][0] - pts[0][0], by = pts[3][1] - pts[0][1], bz = pts[3][2] - pts[0][2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const i of [0, 1, 2, 0, 2, 3]) {
      b.pos.push(pts[i][0], pts[i][1], pts[i][2]);
      b.nor.push(nx, ny, nz);
      b.uv.push(...cellUv(cell, uvs[i][0], uvs[i][1]));
      b.col.push(shade, shade, shade);
    }
  }

  // ================================================================ what must stay clear
  const clear: Array<{ x: number; z: number; r: number }> = [...(opts.keepClear ?? [])];
  for (const d of Object.values(city.doors)) {
    if (d.width > 12) continue; // a whole storehouse front: its spot is kept clear below
    clear.push({ x: d.x + d.out[0] * 1.5, z: d.z + d.out[1] * 1.5, r: d.width / 2 + 2.5 });
  }
  for (const [k, s] of Object.entries(SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>)) {
    if (!k.startsWith("_") && s.x !== undefined && s.z !== undefined) clear.push({ x: s.x, z: s.z, r: 3.5 });
  }
  {
    const h = city.doors.hessenatie; // the hiring board (rijnkaai.ts BOARD_POS)
    if (h) clear.push({ x: h.x + h.out[0] * 3.2 - h.out[1] * 5, z: h.z + h.out[1] * 3.2 + h.out[0] * 5, r: 3.5 });
  }
  for (const [x, z, r] of TOWN_CLEAR) clear.push({ x, z, r });
  // the house doors of the city (props.glb), in 10 m buckets: nothing stands in a doorway
  const doorGrid = new Map<string, Array<[number, number]>>();
  const hd = props?.houseDoors ?? [];
  for (let i = 0; i + 1 < hd.length; i += 2) {
    const k = `${Math.floor(hd[i] / 10)},${Math.floor(hd[i + 1] / 10)}`;
    let b = doorGrid.get(k);
    if (!b) doorGrid.set(k, (b = []));
    b.push([hd[i], hd[i + 1]]);
  }
  const nearDoor = (x: number, z: number, r: number) => {
    const gx = Math.floor(x / 10);
    const gz = Math.floor(z / 10);
    for (let i = gx - 1; i <= gx + 1; i++) for (let j = gz - 1; j <= gz + 1; j++) for (const [dx, dz] of doorGrid.get(`${i},${j}`) ?? []) if (Math.hypot(dx - x, dz - z) < r) return true;
    return false;
  };
  const isClear = (x: number, z: number, r: number) => clear.every((c) => Math.hypot(c.x - x, c.z - z) > c.r + r) && !nearDoor(x, z, r + 1.8);

  const flights = info.flights;
  const ladders = info.ladders;
  // the Anna Maria's gangway, the pier root and the ferry pontoon's gangway (rijnkaai.ts RAMP, PIER, PONTOON)
  const fixed: Rect[] = [
    { minX: -43.5, maxX: -40.5, minZ: -3.5, maxZ: 1.5 },
    { minX: 4.4, maxX: 9.6, minZ: -12, maxZ: 1.5 },
    { minX: -253, maxX: -245, minZ: -60, maxZ: 3 },
    { minX: 99, maxX: 121, minZ: -5, maxZ: 50 }, // the lock
  ];
  const bridgeRects = Object.values(city.bridges).map((b) => ({ minX: Math.min(b[0], b[2]), maxX: Math.max(b[0], b[2]), minZ: Math.min(b[1], b[3]), maxZ: Math.max(b[1], b[3]) }));
  const decor = city.decor ?? {};
  const trainRects = trackKeepOut({ tracks: decor.tracks ?? [] } as TrackData);
  const craneRects = trackKeepOut({ crane_rails: decor.crane_rails ?? [] } as TrackData);
  /** The crane rails themselves, a hand's breadth either side: bollards on the edge keep off them. */
  const craneTight: Rect[] = (decor.crane_rails ?? []).map(([x0, z0, x1, z1]) => ({ minX: Math.min(x0, x1) - 0.2, maxX: Math.max(x0, x1) + 0.2, minZ: Math.min(z0, z1) - 0.2, maxZ: Math.max(z0, z1) + 0.2 }));
  const railLines = decor.rails ?? [];
  const avoid = opts.avoid ?? [];
  // lamps and trees of the city decor (their colliders are in `avoid` too; these are for the ground things)
  const posts: Rect[] = [...(decor.lamps ?? []), ...(decor.trees ?? [])].map(([x, z]) => ({ minX: x - 0.6, maxX: x + 0.6, minZ: z - 0.6, maxZ: z + 0.6 }));
  // the traffic lanes, points in 4 m buckets
  const laneGrid = new Map<string, Array<[number, number, number]>>();
  for (const lane of trafficLanes()) {
    for (let i = 0; i < lane.x.length; i += 2) {
      const k = `${Math.floor(lane.x[i] / 4)},${Math.floor(lane.z[i] / 4)}`;
      let b = laneGrid.get(k);
      if (!b) laneGrid.set(k, (b = []));
      b.push([lane.x[i], lane.z[i], lane.half]);
    }
  }
  const inLane = (x: number, z: number, pad: number) => {
    const gx = Math.floor(x / 4);
    const gz = Math.floor(z / 4);
    for (let i = gx - 1; i <= gx + 1; i++)
      for (let j = gz - 1; j <= gz + 1; j++) for (const [lx, lz, h] of laneGrid.get(`${i},${j}`) ?? []) if (Math.hypot(lx - x, lz - z) < h + pad) return true;
    return false;
  };

  /** A point on the wall line busy with steps, ladders, gangways, bridges or the lock. */
  const wallBusy = (x: number, z: number, pad: number) => {
    for (const f of flights) if (distSeg(x, z, f.top[0], f.top[1], f.end[0], f.end[1]) < pad + 0.6) return true;
    for (const l of ladders) if (Math.hypot(l.x - x, l.z - z) < pad + 0.5) return true;
    for (const r of fixed) if (inRectP(r, x, z, pad)) return true;
    for (const r of bridgeRects) if (inRectP(r, x, z, pad + 1.5)) return true;
    return false;
  };

  // ================================================================ the quay lines
  const WATER_RING = city.water.map((w) => w.outer);
  const inWater = (x: number, z: number) => {
    let inside = false;
    for (const ring of WATER_RING)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, zi] = ring[i];
        const [xj, zj] = ring[j];
        if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
    return inside;
  };
  const segs: Seg[] = [];
  for (const [ax, az, bx, bz] of city.quays) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 2) continue;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
    const [nx, nz] = inWater((ax + bx) / 2 - tz, (az + bz) / 2 + tx) ? [-tz, tx] : [tz, -tx];
    segs.push({ ax, az, tx, tz, nx, nz, L });
  }
  const along = (g: Seg, s: number): [number, number] => [g.ax + g.tx * s, g.az + g.tz * s];
  /** How far in from the wall line the walk map's dry ground starts here (it is 0.5 m coarse). */
  const dryFrom = (g: Seg, s: number): number => {
    const [x, z] = along(g, s);
    for (let u = 0; u <= 1.2; u += 0.05) if (at(x - g.nx * u, z - g.nz * u) === OPEN) return u;
    return 1.2;
  };
  const faceYaw = (g: Seg) => Math.atan2(g.nx, g.nz); // local +z to the water

  // ================================================================ fitting things on the ground
  const colliders: Rect[] = [];
  /** Ground taken by what we put down (solid or not): nothing of ours overlaps. */
  const taken: Rect[] = [];
  /** The painted notices and quay names on the storehouse walls (and the weigh doors), for the sign check. */
  const wallItems: WallBox[] = [];
  const moved: QuayFurniture["moved"] = [];

  /** The footprint of a model at (x, z, yaw) as a box on the ground. */
  function box(p: Proto, x: number, z: number, yaw: number, pad = 0): Rect {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [lx, lz] of [[p.minX, p.minZ], [p.maxX, p.minZ], [p.maxX, p.maxZ], [p.minX, p.maxZ]]) {
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz);
      maxZ = Math.max(maxZ, wz);
    }
    return { minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad };
  }
  /** Local (lx, lz) of a model at (x, z, yaw) to the world. */
  const toWorld = (x: number, z: number, yaw: number, lx: number, lz: number): [number, number] => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [x + lx * c + lz * s, z - lx * s + lz * c];
  };

  interface FitRules {
    /** Metres kept from the other things of ours. */
    gap: number;
    /** Metres kept from the colliders already there. */
    avoidPad: number;
    /** May stand on the crane runways (flat things); "tight": only off the rails themselves (edge bollards). */
    crane?: boolean | "tight";
    /** May stand in the start area. */
    start?: boolean;
    /** May lie in a traffic lane (flat things drivers roll over). */
    lane?: boolean;
    /** Clearance kept from the job places and doors. */
    clearR: number;
  }
  function fits(r: Rect, rules: FitRules): boolean {
    const cx = (r.minX + r.maxX) / 2;
    const cz = (r.minZ + r.maxZ) / 2;
    const half = Math.max(r.maxX - r.minX, r.maxZ - r.minZ) / 2;
    if (!rules.start && overlap(r, START)) return false;
    for (const f of fixed) if (overlap(r, f, 1)) return false;
    for (const b of bridgeRects) if (overlap(r, b, 2.5)) return false;
    for (const t of trainRects) if (overlap(r, t)) return false;
    if (!rules.crane) for (const t of craneRects) if (overlap(r, t)) return false;
    if (rules.crane === "tight") for (const t of craneTight) if (overlap(r, t)) return false;
    for (const a of avoid) if (overlap(r, a, rules.avoidPad)) return false;
    for (const t of taken) if (overlap(r, t, rules.gap)) return false;
    for (const p of posts) if (overlap(r, p)) return false;
    for (const f of flights) if (distSeg(cx, cz, f.top[0], f.top[1], f.end[0], f.end[1]) < half + 2.2) return false;
    for (const l of ladders) if (Math.hypot(l.x - cx, l.z - cz) < half + 1.4) return false;
    for (const [x0, z0, x1, z1] of railLines) if (distSeg(cx, cz, x0, z0, x1, z1) < half + 0.5) return false;
    if (!isClear(cx, cz, Math.max(0, half * 0.7 + rules.clearR - 2.5))) return false;
    // stands on open ground, no wall, no water (the walk map is 0.5 m fine: sample a little inside)
    const ix = Math.min(0.15, (r.maxX - r.minX) / 2);
    const iz = Math.min(0.15, (r.maxZ - r.minZ) / 2);
    for (let x = r.minX + ix; x <= r.maxX - ix + 1e-6; x += Math.min(0.4, Math.max(0.05, r.maxX - r.minX - 2 * ix))) {
      for (let z = r.minZ + iz; z <= r.maxZ - iz + 1e-6; z += Math.min(0.4, Math.max(0.05, r.maxZ - r.minZ - 2 * iz))) {
        if (at(x, z) !== OPEN) return false;
        if (!rules.lane && inLane(x, z, 0.2)) return false;
      }
    }
    return true;
  }
  /** Open ground on one side of a model (side +1: beyond its local maxZ, -1: beyond minZ), `depth` metres. */
  function sideOpen(p: Proto, x: number, z: number, yaw: number, side: 1 | -1, depth: number): boolean {
    for (let lx = p.minX; lx <= p.maxX + 1e-6; lx += 0.5)
      for (let d = 0.3; d <= depth + 1e-6; d += 0.5) {
        const [wx, wz] = toWorld(x, z, yaw, lx, side > 0 ? p.maxZ + d : p.minZ - d);
        if (at(wx, wz) !== OPEN) return false;
        for (const a of avoid) if (inRectP(a, wx, wz)) return false;
        for (const t of taken) if (inRectP(t, wx, wz)) return false;
      }
    return true;
  }
  /** Mark the ground taken; solid things also block walking. */
  function take(name: string, x: number, z: number, yaw: number, solid: boolean): void {
    const p = protos.get(name)!;
    const r = box(p, x, z, yaw);
    taken.push(r);
    if (solid) colliders.push({ ...r, minX: r.minX - 0.04, maxX: r.maxX + 0.04, minZ: r.minZ - 0.04, maxZ: r.maxZ + 0.04, top: p.height });
  }

  /**
   * Stand `name` near the wall point (x, z) of stretch g, its water side `u` metres in from the
   * edge, its front to the water or inland. Returns the origin and yaw if it fits.
   */
  function standAt(name: string, g: Seg, s: number, u: number, facing: "water" | "inland", rules: FitRules, passage: number): { x: number; z: number; yaw: number } | null {
    const p = protos.get(name);
    if (!p) return null;
    const [wx, wz] = along(g, s);
    const yaw = facing === "water" ? faceYaw(g) : Math.atan2(-g.nx, -g.nz);
    // the depth of the footprint's water side from the origin
    const wet = facing === "water" ? p.maxZ : -p.minZ;
    const cxl = (p.minX + p.maxX) / 2; // centre the footprint on the point
    const [ox, oz] = toWorld(0, 0, yaw, -cxl, 0);
    const x = wx - g.nx * (u + wet) + ox;
    const z = wz - g.nz * (u + wet) + oz;
    if (!fits(box(p, x, z, yaw), rules)) return null;
    if (passage > 0 && !sideOpen(p, x, z, yaw, facing === "water" ? -1 : 1, passage)) return null;
    return { x, z, yaw };
  }

  const CLUTTER_RULES: FitRules = { gap: 1.4, avoidPad: 1.0, clearR: 3.5 };

  // ================================================================ 1. the wall face and the coping
  const berthNo: Partial<Record<District, number>> = {};
  const wallNameDone = new Set<number>();
  for (const g of segs) {
    let nextRing = 2 + R() * 4;
    let nextFender = 4 + R() * 6;
    let nextBerth = 8 + R() * 10;
    let nextDrain = 6 + R() * 12;
    let k = 0;
    for (let s = 1; s < g.L - 1; s += 0.5) {
      const [x, z] = along(g, s);
      const dist = districtAt(x, z);
      if (!dist) continue;
      const yaw = faceYaw(g);
      if (s >= nextRing) {
        if (!wallBusy(x, z, 0.4)) {
          // mostly rings on staples in the wall face; now and then one let into the edge stone
          if (k++ % 2 === 1 && at(x - g.nx * 0.6, z - g.nz * 0.6) === OPEN && !inRectP(START, x, z)) put("ring_top", x, 0, z, yaw);
          else put("ring_wall", x, -0.05 * (k % 2), z, yaw);
          nextRing = s + (dist === "canal" ? 5 : 6) + R() * 3;
        }
      }
      if (s >= nextFender && dist !== "steen") {
        if (!wallBusy(x, z, 1.0)) {
          put(R() < 0.6 ? "fender_timber" : "fender_rope", x, 0, z, yaw);
          nextFender = s + 10 + R() * 8;
        }
      }
      if (s >= nextBerth && (dist === "werf" || dist === "rijnkaai" || dist === "north" || dist === "bassin" || dist === "vismarkt")) {
        if (!wallBusy(x, z, 0.8)) {
          const n = (berthNo[dist] = (berthNo[dist] ?? 0) + 1);
          if (n <= meta.berths.length) put(`berth_${meta.berths[n - 1]}`, x, 0, z, yaw);
          nextBerth = s + 24 + R() * 10;
        }
      }
      if (s >= nextDrain) {
        const dx = x - g.nx * 1.3;
        const dz = z - g.nz * 1.3;
        if (at(dx, dz) === OPEN && at(dx + g.tx * 0.5, dz + g.tz * 0.5) === OPEN && !wallBusy(x, z, 1) && !avoid.some((a) => inRectP(a, dx, dz, 0.4))) {
          put("drain", dx, 0.012, dz, Math.atan2(-g.tz, g.tx));
          nextDrain = s + 18 + R() * 14;
        }
      }
    }
    // the quay's name painted big on the wall face
    WALL_NAME_AT.forEach(([name, x0, z0], i) => {
      if (wallNameDone.has(i)) return;
      const wn = meta.wallNames.find((w) => w.name === name);
      if (!wn) return;
      const s0 = (x0 - g.ax) * g.tx + (z0 - g.az) * g.tz;
      if (s0 < wn.len / 2 + 0.5 || s0 > g.L - wn.len / 2 - 0.5) return;
      if (distSeg(x0, z0, g.ax, g.az, g.ax + g.tx * g.L, g.az + g.tz * g.L) > 0.5) return;
      for (const ds of [0, 4, -4, 8, -8, 12, -12]) {
        const s = s0 + ds;
        if (s < wn.len / 2 + 0.5 || s > g.L - wn.len / 2 - 0.5) continue;
        let ok = true;
        for (let e = -wn.len / 2; e <= wn.len / 2 && ok; e += 0.5) {
          const [x, z] = along(g, s + e);
          if (wallBusy(x, z, 0.5)) ok = false;
        }
        if (!ok) continue;
        const [x, z] = along(g, s);
        put(wn.model, x, 0, z, faceYaw(g));
        wallNameDone.add(i);
        return;
      }
    });
  }

  // the iron strip on the edge of the coping (city.ts: edge stones 0.25 m either side of the wall line)
  for (const g of segs) {
    let run0 = -1;
    const flush = (s0: number, s1: number) => {
      for (let a = s0; a < s1 - 0.05; a += 16) {
        const b = Math.min(s1, a + 16);
        const [ax, az] = along(g, a);
        const [bx, bz] = along(g, b);
        const o = 0.25;
        const i = 0.19;
        // top: a thin band on the stone; face: the angle down over the edge
        quad("iron", [[ax + g.nx * i, 0.066, az + g.nz * i], [ax + g.nx * o, 0.066, az + g.nz * o], [bx + g.nx * o, 0.066, bz + g.nz * o], [bx + g.nx * i, 0.066, bz + g.nz * i]], 0.9);
        quad("iron_rust", [[ax + g.nx * o, -0.16, az + g.nz * o], [bx + g.nx * o, -0.16, bz + g.nz * o], [bx + g.nx * o, 0.066, bz + g.nz * o], [ax + g.nx * o, 0.066, az + g.nz * o]], 0.8);
        count("edge iron m", b - a);
      }
    };
    for (let s = 0; s <= g.L + 1e-6; s += 0.5) {
      const [x, z] = along(g, Math.min(s, g.L));
      const busy = !districtAt(x, z) || flights.some((f) => distSeg(x, z, f.top[0], f.top[1], f.end[0], f.end[1]) < 0.3) || bridgeRects.some((r) => inRectP(r, x, z, 0.2)) || inRectP(fixed[1], x, z);
      if (!busy && run0 < 0) run0 = s;
      if ((busy || s >= g.L - 1e-6) && run0 >= 0) {
        flush(run0, Math.min(s, g.L));
        run0 = -1;
      }
    }
  }

  // worn stones where people step down at the stairs and the ladders
  for (const f of flights) {
    const L = Math.hypot(f.end[0] - f.top[0], f.end[1] - f.top[1]) || 1;
    const tx = (f.end[0] - f.top[0]) / L;
    const tz = (f.end[1] - f.top[1]) / L;
    const g = segs.find((q) => distSeg(f.top[0], f.top[1], q.ax, q.az, q.ax + q.tx * q.L, q.az + q.tz * q.L) < 0.3);
    if (!g) continue;
    put("worn", f.top[0] + tx * 0.6 - g.nx * 0.45, 0.014, f.top[1] + tz * 0.6 - g.nz * 0.45, Math.atan2(-tz, tx));
  }
  for (const l of ladders) {
    const g = segs.find((q) => distSeg(l.x, l.z, q.ax, q.az, q.ax + q.tx * q.L, q.az + q.tz * q.L) < 0.3);
    if (!g || l.top < -0.5) continue; // the ladders off the landings stand low down
    if (at(l.x - g.nx * 0.6, l.z - g.nz * 0.6) === OPEN) put("worn", l.x - g.nx * 0.4, 0.014, l.z - g.nz * 0.4, Math.atan2(-g.tz, g.tx));
  }

  // ================================================================ 2. the edge: bollards, posts, capstans, lanterns
  // the caller's own bollards (by the start), in the new cast iron
  (opts.bollards ?? []).forEach(([x, z], i) => {
    put(i % 4 === 2 ? "bollard_mushroom" : "bollard_cannon", x, 0, z, 0);
    taken.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
  });
  const EDGE_RULES: FitRules = { gap: 0.5, avoidPad: 0.15, crane: "tight", lane: false, clearR: 1.6 };
  const LYING_RULES: FitRules = { gap: 0.3, avoidPad: 0.3, crane: true, lane: true, clearR: 1.6 };
  for (const g of segs) {
    let turn = Math.floor(R() * 4);
    let next = 3 + R() * 5;
    for (let s = 1.5; s < g.L - 1.5; s += 0.5) {
      if (s < next) continue;
      const [x, z] = along(g, s);
      const dist = districtAt(x, z);
      if (!dist || inRectP(START, x, z)) continue;
      const style = EDGE[dist];
      const name = style.kinds[turn % style.kinds.length];
      if (wallBusy(x, z, name === "bitt_double" ? 1.2 : 0.8)) continue;
      const u = dryFrom(g, s) + 0.03;
      const spot = standAt(name, g, s, u, "water", EDGE_RULES, 0);
      if (!spot) continue;
      put(name, spot.x, 0, spot.z, spot.yaw);
      take(name, spot.x, spot.z, spot.yaw, true);
      turn++;
      next = s + style.step * (0.8 + R() * 0.4);
      // a line from it down to a boat lying off the wall
      if (moored(x, z) && R() < 0.65) {
        put(R() < 0.5 ? "line_out" : "line_along", spot.x, 0, spot.z, spot.yaw);
      }
      // a hawser or a chain lying out on the stones beside it, now and then
      const lie = R();
      if (lie < 0.45) {
        const kind = lie < 0.15 ? "chain_run" : lie < 0.3 ? "hawser_flake" : "hawser_coil";
        const side = R() < 0.5 ? 1 : -1;
        const ls = s + side * 3.2;
        if (ls > 2 && ls < g.L - 2) {
          const [lx, lz] = along(g, ls);
          if (!wallBusy(lx, lz, 2)) {
            const ly = standAt(kind, g, ls, dryFrom(g, ls) + 0.1, "water", LYING_RULES, 0);
            if (ly) {
              put(kind, ly.x, 0.005, ly.z, ly.yaw);
              take(kind, ly.x, ly.z, ly.yaw, false);
            }
          }
        }
      }
    }
  }
  // capstans at the busy berths, a strip of free quay behind them
  {
    const CAP_RULES: FitRules = { gap: 1.2, avoidPad: 0.6, clearR: 2.5 };
    const want: Partial<Record<District, number>> = { werf: 1, vismarkt: 1, rijnkaai: 2, north: 2, bassin: 3 };
    const cands: Array<[Seg, number, number]> = [];
    for (const g of segs) for (let s = 3; s < g.L - 3; s += 2) cands.push([g, s, R()]);
    cands.sort((a, b) => a[2] - b[2]);
    for (const [g, s] of cands) {
      const [x, z] = along(g, s);
      const dist = districtAt(x, z);
      if (!dist || !want[dist] || inRectP(START, x, z) || wallBusy(x, z, 2)) continue;
      const spot = standAt("capstan", g, s, dryFrom(g, s) + 0.1, "water", CAP_RULES, 1.8);
      if (!spot) continue;
      put("capstan", spot.x, 0, spot.z, spot.yaw);
      take("capstan", spot.x, spot.z, spot.yaw, true);
      want[dist]!--;
    }
  }
  // a lantern on a post at the head of every flight of steps, on the quay side of the opening
  for (const f of flights) {
    const L = Math.hypot(f.end[0] - f.top[0], f.end[1] - f.top[1]) || 1;
    const tx = (f.end[0] - f.top[0]) / L;
    const tz = (f.end[1] - f.top[1]) / L;
    const g = segs.find((q) => distSeg(f.top[0], f.top[1], q.ax, q.az, q.ax + q.tx * q.L, q.az + q.tz * q.L) < 0.3);
    if (!g) continue;
    for (const [a, u] of [[-0.9, 0.55], [L + 0.9, 0.55], [-0.9, 1.1], [-1.8, 0.55]] as const) {
      const x = f.top[0] + tx * a - g.nx * u;
      const z = f.top[1] + tz * a - g.nz * u;
      const p = protos.get("lantern_post")!;
      const r = box(p, x, z, 0);
      if (at(x, z) !== OPEN || avoid.some((c) => overlap(r, c, 0.2)) || taken.some((c) => overlap(r, c, 0.2)) || trainRects.some((c) => overlap(r, c))) continue;
      put("lantern_post", x, 0, z, Math.atan2(-g.nx, -g.nz));
      take("lantern_post", x, z, 0, true);
      // and a board at the steps: no mooring in front of them
      const [sx, sz] = [f.top[0] + tx * (a < 0 ? a - 1.4 : a + 1.4) - g.nx * 0.5, f.top[1] + tz * (a < 0 ? a - 1.4 : a + 1.4) - g.nz * 0.5];
      const sp = protos.get("sign_nomoor")!;
      const yaw = Math.atan2(-g.nx, -g.nz);
      const sr = box(sp, sx, sz, yaw);
      if (!inRectP(START, sx, sz) && at(sx, sz) === OPEN && !avoid.some((c) => overlap(sr, c, 0.2)) && !taken.some((c) => overlap(sr, c, 0.3)) && !trainRects.some((c) => overlap(sr, c)) && !craneRects.some((c) => overlap(sr, c))) {
        put("sign_nomoor", sx, 0, sz, yaw);
        take("sign_nomoor", sx, sz, yaw, true);
      }
      break;
    }
  }

  // ================================================================ 3. harbour buildings, boards and signs
  for (const [name, ax, az, rad, facing] of ANCHORED) {
    const p = protos.get(name);
    if (!p) continue;
    const small = name.startsWith("sign_");
    const rules: FitRules = small ? { gap: 0.6, avoidPad: 0.3, clearR: 2.0 } : { gap: 1.5, avoidPad: 1.0, clearR: 3.5 };
    const cands: Array<[Seg, number, number, number]> = [];
    for (const g of segs) {
      const s0 = (ax - g.ax) * g.tx + (az - g.az) * g.tz;
      for (let s = Math.max(1, s0 - rad); s <= Math.min(g.L - 1, s0 + rad); s += 1) {
        const [x, z] = along(g, s);
        for (const u of small ? [0.5, 0.9, 1.6, 2.6] : [0.6, 1.4, 2.5, 4, 6, 8, 10, 11, 12, 13]) {
          const d = Math.hypot(x - g.nx * u - ax, z - g.nz * u - az);
          if (d < rad) cands.push([g, s, u, d]);
        }
      }
    }
    cands.sort((a, b) => a[3] - b[3]);
    for (const [g, s, u] of cands) {
      const [x, z] = along(g, s);
      if (!districtAt(x, z)) continue;
      const spot = standAt(name, g, s, u, facing, rules, small ? 1.2 : 0);
      if (!spot) continue;
      // a door or a counter needs room in front; a hut may stand with its back to a house wall
      if (!small && !sideOpen(p, spot.x, spot.z, spot.yaw, 1, 1.6)) continue;
      put(name, spot.x, 0, spot.z, spot.yaw);
      take(name, spot.x, spot.z, spot.yaw, true);
      break;
    }
  }

  // ================================================================ 4. work on the quays: nets, baskets, coal, grain, timber, boats
  for (const [dist, wishes] of Object.entries(CLUTTER) as Array<[District, Array<[string, number]>]>) {
    const cands: Array<[Seg, number, number, number]> = [];
    for (const g of segs)
      for (let s = 2; s < g.L - 2; s += 1.5) {
        const [x, z] = along(g, s);
        if (districtAt(x, z) !== dist) continue;
        for (const u of [0.7, 1.6, 3, 4.5, 6.5]) cands.push([g, s, u, R()]);
      }
    cands.sort((a, b) => a[3] - b[3]);
    const placed: Array<[string, number, number]> = [];
    for (const [name, n] of wishes) {
      let left = n;
      for (const [g, s, u] of cands) {
        if (left <= 0) break;
        const [x, z] = along(g, s);
        // the same kind of thing not twice within 14 m; nothing of ours within 3 m
        if (placed.some(([k, px, pz]) => (k === name && Math.hypot(px - x, pz - z) < 14) || Math.hypot(px - x, pz - z) < 3)) continue;
        const facing = R() < 0.5 ? "water" : "inland";
        const spot = standAt(name, g, s, u, facing, CLUTTER_RULES, 2.4);
        if (!spot) continue;
        put(name, spot.x, 0, spot.z, spot.yaw);
        take(name, spot.x, spot.z, spot.yaw, true);
        placed.push([name, x, z]);
        left--;
      }
    }
  }

  // ================================================================ 5. the storehouse walls: quay names, a weigh house door, notices
  {
    const fronts: Array<{ ax: number; az: number; tx: number; tz: number; ox: number; oz: number; L: number; gates: number[] }> = [];
    for (const fr of props?.storeFronts ?? []) {
      const [ax, az, bx, bz, ox, oz, ...gates] = fr;
      const L = Math.hypot(bx - ax, bz - az);
      if (L > 4) fronts.push({ ax, az, tx: (bx - ax) / L, tz: (bz - az) / L, ox, oz, L, gates });
    }
    // walls props.glb does not list (a blind end wall): from our own meta, no gates
    for (const [ax, az, bx, bz, ox, oz] of meta.stores) {
      const L = Math.hypot(bx - ax, bz - az);
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      if (fronts.some((f) => distSeg(mx, mz, f.ax, f.az, f.ax + f.tx * f.L, f.az + f.tz * f.L) < 0.5)) continue;
      fronts.push({ ax, az, tx: (bx - ax) / L, tz: (bz - az) / L, ox, oz, L, gates: [] });
    }
    const nearWater = (x: number, z: number) => segs.some((g) => distSeg(x, z, g.ax, g.az, g.ax + g.tx * g.L, g.az + g.tz * g.L) < 30);
    /**
     * Paint `model` on the storehouse wall f, `s` along it at height y, where the old rule put it; if a
     * painted window or door of the house wall, or a sign, is there (streetlife clearOnWall), the nearest
     * clear place: along the wall up to 3 m, up or down up to 1.5 m (`down`), least moved first. None: left out.
     */
    const onHouseWall = (kind: string, model: string, f: (typeof fronts)[number], s: number, y: number, yaw: number, gateNear: ((s: number, half: number) => boolean) | null, inset = 0, down = 1.5): boolean => {
      const p = protos.get(model);
      if (!p) return false;
      const hw = (p.box[3] - p.box[0]) / 2;
      // (the paint only: a decal's clear margin above and below its letters may lie over a window's frame)
      const pb = [p.box[0], p.box[1] + inset, p.box[2], p.box[3], p.box[4] - inset, p.box[5]];
      const at3 = (ss: number, yy: number): [number, number, number] => [+(f.ax + f.tx * ss).toFixed(2), +yy.toFixed(2), +(f.az + f.tz * ss).toFixed(2)];
      const tries: Array<[number, number]> = [[0, 0]];
      if (opts.houseWalls) {
        for (let dy = -Math.round(down * 10); dy <= 15; dy++) for (let ds = -12; ds <= 12; ds++) if (dy || ds) tries.push([ds * 0.25, dy * 0.1]);
        tries.sort((a, b) => Math.abs(a[0]) + Math.abs(a[1]) - (Math.abs(b[0]) + Math.abs(b[1])));
      }
      let why = "";
      for (const [ds, dy] of tries) {
        const ss = s + ds;
        const yy = y + dy;
        if (ss - hw < 0.5 || ss + hw > f.L - 0.5 || (gateNear && f.gates.length && gateNear(ss, hw)) || yy + p.box[1] < 1.8) continue;
        const x = f.ax + f.tx * ss + f.ox * 0.02;
        const z = f.az + f.tz * ss + f.oz * 0.02;
        const b = wallBox(kind, model, true, pb, x, yy, z, yaw);
        const bad = opts.houseWalls?.clear(b) ?? null;
        if (bad) {
          why ||= bad;
          continue;
        }
        put(model, x, yy, z, yaw, true);
        wallItems.push(b);
        opts.houseWalls?.add(b);
        if (ds || dy) moved.push({ model, from: at3(s, y), to: at3(ss, yy), why });
        return true;
      }
      moved.push({ model, from: at3(s, y), to: null, why: why || "no room" });
      return false;
    };
    let weigh = 0;
    let notice = Math.floor(R() * meta.wallNotices.length);
    const named = new Set<string>();
    for (const f of fronts) {
      const yaw = Math.atan2(f.ox, f.oz);
      const [mx, mz] = [f.ax + f.tx * f.L * 0.5, f.az + f.tz * f.L * 0.5];
      if (at(mx + f.ox * 1.2, mz + f.oz * 1.2) !== OPEN || !nearWater(mx, mz)) continue;
      const gateNear = (s: number, half: number) => f.gates.some((g) => Math.abs(g - s) < half + 2.2);
      const onWall = (s: number) => {
        const [x, z] = [f.ax + f.tx * s, f.az + f.tz * s];
        return [x + f.ox * 0.02, z + f.oz * 0.02] as [number, number];
      };
      // the quay's name, high on the wall
      const dist = districtAt(mx + f.ox * 4, mz + f.oz * 4);
      const quayName = dist === "werf" ? "WERF" : dist === "bassin" ? "PETIT BASSIN" : dist === "rijnkaai" ? "RIJNKAAI" : null;
      const wn = quayName ? meta.wallNames.find((w) => w.name === quayName) : null;
      const byDoor = Object.values(city.doors).some((d) => Math.hypot(d.x - mx, d.z - mz) < 8);
      if (wn && !byDoor && !named.has(`${quayName}${Math.round(mx / 40)}`) && f.L > wn.len + 2) {
        // (high over the gates: they do not count; the letters 0.7 m of the decal's 0.9)
        if (onHouseWall("quay name", wn.model, f, f.L / 2, 6.2, yaw, null, 0.1, 2.1)) named.add(`${quayName}${Math.round(mx / 40)}`);
      }
      // a public weigh house door, on the busy basin (one or two)
      if (weigh < 2 && (dist === "bassin" || dist === "north")) {
        for (const fr of [0.3, 0.7, 0.5, 0.2, 0.8]) {
          const s = f.L * fr;
          if (s < 2 || s > f.L - 2 || gateNear(s, 1.5)) continue;
          const [x, z] = onWall(s);
          const p = protos.get("weigh_door")!;
          const r = box(p, x, z, yaw);
          if (avoid.some((a) => overlap(r, a, 0.3)) || taken.some((a) => overlap(r, a, 0.3))) continue;
          if (!isClear(x + f.ox, z + f.oz, 0.5)) continue;
          put("weigh_door", x, 0, z, yaw, true);
          taken.push(r);
          // (a door, not flat paint: the notices keep off it)
          const wb = wallBox("weigh door", "weigh_door", false, p.box, x, 0, z, yaw);
          wallItems.push(wb);
          opts.houseWalls?.add(wb);
          weigh++;
          break;
        }
      }
      // notices painted between the gates
      for (let s = 3; s < f.L - 3; s += 9 + R() * 6) {
        const wn2 = meta.wallNotices[notice % meta.wallNotices.length];
        if (gateNear(s, wn2.len / 2)) continue;
        onHouseWall("quay notice", wn2.model, f, s, 3.1 + R() * 0.3, yaw, gateNear);
        notice++;
      }
    }
  }

  // ================================================================ merge and show
  const group = new THREE.Group();
  group.name = "quayfurniture";
  const chunks: THREE.Mesh[] = [];
  let triangles = 0;
  for (const [k, b] of buckets) {
    if (!b.pos.length) continue;
    const slot = Number(k.split(",")[2]);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(b.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(b.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(b.col, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, mats[slot]);
    mesh.name = `quayfurniture_${k}`;
    mesh.renderOrder = slot === FLAT_DECAL || slot === SNAP_DECAL ? 1 : 0;
    triangles += b.pos.length / 9;
    group.add(mesh);
    chunks.push(mesh);
  }
  buckets.clear();
  // an empty mesh that is always drawn: before each render it hides the chunks beyond the fog
  const sentinel = new THREE.Mesh(
    new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(9), 3)),
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
  );
  sentinel.frustumCulled = false;
  const cull = (cam: THREE.Camera) => {
    const far = ((scene.fog as THREE.Fog | null)?.far ?? 60) + 8;
    const p = cam.position;
    for (const m of chunks) {
      const s = m.geometry.boundingSphere!;
      m.visible = s.center.distanceTo(p) - s.radius < far;
    }
  };
  sentinel.onBeforeRender = (_r, _sc, cam) => cull(cam);
  group.add(sentinel);
  scene.add(group);

  const warm = new THREE.Color(1.0, 0.72, 0.38);
  const air = new THREE.Color();
  const flame = new THREE.Color();
  function update(t: number, _dt: number, lit = 1, cam?: THREE.Camera): void {
    if (cam) cull(cam);
    const fog = scene.fog as THREE.Fog | null;
    if (fog) air.copy(fog.color);
    // the lanterns at the steps: lit with the gas lamps, an oil flame's slow waver
    const k = Math.max(0, Math.min(1, lit)) * (0.9 + Math.sin(t * 2.7) * 0.05 + Math.sin(t * 8.1 + 0.7) * 0.04);
    glowMat.color.copy(air).multiplyScalar(0.8 * (1 - Math.min(1, k))).add(flame.copy(warm).multiplyScalar(k));
    // the tar fires burn day and night, and flicker
    const f = 0.8 + Math.sin(t * 11.3) * 0.08 + Math.sin(t * 17.9 + 1.1) * 0.07 + Math.sin(t * 5.3) * 0.05;
    fireMat.color.setRGB(f, f * 0.95, f * 0.9);
  }
  update(0, 0, 0);

  return { group, colliders, update, stats: { counts, meshes: chunks.length, triangles: Math.round(triangles) }, sites, wallItems, moved };
}
