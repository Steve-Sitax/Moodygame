import { modelCollider, modelShape } from "./modelCollision";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { trafficLanes } from "./traffic";
import { addPropObject, dropProps } from "./propSpots";
import type { GroundProbe, WallProbe } from "./wallprobe";

// Street and quay props from Blender (tools/blender/build_props.py ->
// /models/props.glb): carts, a dray and its horse, barrows, crates, casks,
// sacks, rope, bollards, a gas lamp, a hand crane; the port goods of the naties
// (cotton bales, coffee and grain sacks, hides, casks of wine and petroleum,
// crates, bluestone, timber, tarpaulin heaps, the weighing beam) and the parts
// of the traffic (traffic.ts). Our own models, made by script. Each prop stands
// on the ground at its origin; its front (shafts, handles, jib) looks along
// local +z. This module loads them once, gives them PS1 materials, places
// copies, and dresses the city: goods along the busy quays and the storehouse
// walls, carts and casks elsewhere. The goods share one atlas material
// ("goods", 4 x 4 cells), so a quay of them is one draw call per chunk.

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
  // port goods (one atlas material)
  "casks_row",
  "casks_pyramid",
  "casks_standing",
  "petrol_row",
  "petrol_pyramid",
  "bales_block",
  "bales_row",
  "coffee_stack",
  "grain_pile",
  "hides_pile",
  "crates_stack",
  "stones_stack",
  "stone_blocks",
  "timber_stack",
  "planks_pile",
  "tarp_heap",
  "beam_scale",
  "weigh_scale",
  "sack_truck_sacks",
  "ladder_lean",
  "planks_lean",
  "crate_open",
  "crate_broken",
  "crate_seat",
  "crate_big",
] as const;

/** Parts the traffic moves (traffic.ts): the dray, its wheels, loads, the horse and its legs (each split at the knee
 * or hock: horseGait.ts), the handcart. */
export const TRAFFIC_PARTS = [
  "tr_dray_bed",
  "tr_dray_fore",
  "tr_wheels_rear",
  "tr_wheels_front",
  "tr_load_casks",
  "tr_load_sacks",
  "tr_load_bales",
  "tr_load_tarp",
  "tr_horse_body",
  "tr_leg_front",
  "tr_leg_front_lo",
  "tr_leg_hind",
  "tr_leg_hind_lo",
  "tr_handcart",
  "tr_handcart_wheels",
  "tr_handcart_load",
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
  colliders(name: string, x: number, z: number, yaw: number, y?: number, scale?: number): Rect[];
  /** The PS1 materials by name: wood, wood_dark, iron, rope, sackcloth, crate, barrel, stone, glass, leather, goods (the atlas), goods_team (the horses' atlas). */
  materials: Record<string, THREE.Material>;
  /** Front doors of the city's houses as x, z pairs (from the city build, carried in props.glb). */
  houseDoors: number[];
  /**
   * Street walls of the storehouses (from the city build): [ax, az, bx, bz, outx, outz, gate...],
   * the wall from a to b, its outward normal, and the loading gates as metres from a (2.6 m wide).
   */
  storeFronts: number[][];
  /**
   * The meshes of a model as geometry in the model's own frame and its material (shared; do not
   * dispose). For moving parts (traffic.ts) and merged copies.
   */
  parts(name: string): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>;
  /**
   * Put a copy down for good, merged with every other copy batched in the same moment into one
   * mesh per material under `parent` (cheap static dressing: a dozen crates are one draw call).
   * y lifts it (a crate on a crate), scale sizes it.
   */
  batch(parent: THREE.Object3D, name: string, x: number, z: number, yaw?: number, y?: number, scale?: number): void;
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
        ? // M7 fog lamps: glass fogs like the rest of the prop (a gas lamp's own: world/gaslamps.ts, lampFog.ts)
          new THREE.MeshBasicMaterial({ map, color: 0xffc070 })
        : name === "goods" || name === "goods_team"
          ? // the goods atlas and the team atlas (the horses and their harness): the same settings, one shader
            psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }), { affine: 0.6, atlas: 4 })
          : psx(new THREE.MeshLambertMaterial({ map, vertexColors: true }), { affine: 0.6 });
    mat.name = name;
    materials[name] = mat;
    return mat;
  };

  const protos = new Map<string, THREE.Object3D>();
  let houseDoors: number[] = [];
  let storeFronts: number[][] = [];
  for (const node of [...gltf.scene.children]) {
    if (node.name === "house_doors") {
      houseDoors = JSON.parse((node.userData.doors as string | undefined) ?? "[]");
      node.removeFromParent();
      continue;
    }
    if (node.name === "store_fronts") {
      storeFronts = JSON.parse((node.userData.fronts as string | undefined) ?? "[]");
      node.removeFromParent();
      continue;
    }
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.material = Array.isArray(m.material) ? m.material.map(swap) : swap(m.material);
      // atlas meshes: the second uv set is the cell (column, row); glTF turned v over, so turn it back
      const cell = m.geometry.getAttribute("uv1") as THREE.BufferAttribute | undefined;
      if (cell) {
        const c = new Float32Array(cell.count * 2);
        for (let i = 0; i < cell.count; i++) {
          c[i * 2] = Math.round(cell.getX(i));
          c[i * 2 + 1] = Math.round(1 - cell.getY(i));
        }
        m.geometry.setAttribute("cell", new THREE.BufferAttribute(c, 2));
        m.geometry.deleteAttribute("uv1");
      }
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

  function colliders(name: string, x: number, z: number, yaw: number, y = 0, scale = 1): Rect[] {
    const proto = protos.get(name);
    if (!proto) throw new Error(`no prop ${name}`);
    const shape = modelShape(proto, () => parts(name).map(({ geometry }) => {
      const g = geometry.index ? geometry.toNonIndexed() : geometry;
      return g.getAttribute("position").array;
    }));
    return [modelCollider(shape, x, z, yaw, y, scale, scale, scale)];
  }

  const partCache = new Map<string, Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }>>();
  function parts(name: string): Array<{ geometry: THREE.BufferGeometry; material: THREE.Material }> {
    let out = partCache.get(name);
    if (out) return out;
    const src = protos.get(name);
    if (!src) throw new Error(`no prop ${name}`);
    out = [];
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.matrixWorld.equals(IDENTITY) ? m.geometry : m.geometry.clone().applyMatrix4(m.matrixWorld);
      out!.push({ geometry: g, material: m.material as THREE.Material });
    });
    partCache.set(name, out);
    return out;
  }

  const queued: Array<{ parent: THREE.Object3D; o: THREE.Object3D }> = [];
  function batch(parent: THREE.Object3D, name: string, x: number, z: number, yaw = 0, y = 0, scale = 1): void {
    const o = place(name, x, z, yaw);
    o.position.y = y;
    o.scale.setScalar(scale);
    addPropObject("props (batch)", o);
    if (!queued.length) queueMicrotask(flush);
    queued.push({ parent, o });
  }
  function flush(): void {
    const buckets = new Map<string, { parent: THREE.Object3D; mat: THREE.Material; geos: THREE.BufferGeometry[] }>();
    for (const { parent, o } of queued.splice(0)) {
      o.updateMatrixWorld(true);
      o.traverse((c) => {
        const m = c as THREE.Mesh;
        if (!m.isMesh) return;
        const mat = m.material as THREE.Material;
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        for (const a of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color", "cell"].includes(a)) g.deleteAttribute(a);
        const k = `${parent.uuid}|${mat.uuid}`;
        let b = buckets.get(k);
        if (!b) buckets.set(k, (b = { parent, mat, geos: [] }));
        b.geos.push(g);
      });
    }
    for (const { parent, mat, geos } of buckets.values()) {
      const merged = mergeGeometries(geos, false);
      for (const g of geos) if (g !== merged) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = "props_batch";
      parent.add(mesh);
    }
  }

  return { names: [...protos.keys()], place, footprint, colliders, materials, houseDoors, storeFronts, parts, batch };
}

const IDENTITY = new THREE.Matrix4();

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
  /** The port goods along the busy quays and the storehouse walls. Default true. */
  goods?: boolean;
  /** Quay cranes (x, z): nothing within 3.8 m. Default: the cranes rijnkaai.ts puts up. */
  cranes?: Array<[number, number]>;
  /** The buildings as built (world/wallprobe.ts): no wall, pier or plinth runs through a thing. */
  probe?: WallProbe;
  /** The ground as built: a thing stands on the street, not half on a kerb or a step. */
  ground?: GroundProbe;
}

export interface Dressing {
  group: THREE.Group;
  /** Walk colliders for everything placed; add them to the world. */
  colliders: Rect[];
  placed: Array<{ name: string; x: number; z: number; yaw: number }>;
  /** How many of `placed` are port goods (the rest: carts, casks, crates by the old rules). */
  goods: number;
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

/** The portal cranes of rijnkaai.ts (keep in step): goods keep 3.8 m from them. */
const CRANES: Array<[number, number]> = [
  [-24, 3.2], [-12, 3.2], [72, 3.2], [66, 62], [66, 92], [173, 66], [173, 100], [-280, 3.2], [-240, 3.2], [-300, 3.2],
];

/**
 * Where the port goods go, after the period photos of the Vlaamse Kaai, the Werf and the
 * Quai Godefroid: rows along the water on the busy quays, each quay with its own trade.
 */
type Table = Array<[string, number]>;
const WINE_AND_STONE: Table = [
  ["casks_row", 3], ["casks_pyramid", 2.5], ["casks_standing", 1], ["stones_stack", 1.5], ["stone_blocks", 1.2],
  ["timber_stack", 1], ["tarp_heap", 1], ["crates_stack", 1], ["planks_pile", 0.6],
];
const PETROLEUM: Table = [
  ["petrol_row", 3], ["petrol_pyramid", 2.5], ["casks_row", 1.5], ["crates_stack", 1.5], ["grain_pile", 1], ["tarp_heap", 1], ["coffee_stack", 1],
];
const COTTON_AND_COFFEE: Table = [
  ["bales_block", 3], ["bales_row", 2.5], ["coffee_stack", 2], ["hides_pile", 1.5], ["grain_pile", 1.5], ["casks_row", 1],
  ["crates_stack", 1], ["tarp_heap", 0.8],
];
const WATER_ROWS: Array<{ rect: Rect; table: Table }> = [
  { rect: { minX: -320, maxX: -213, minZ: -3, maxZ: 3 }, table: WINE_AND_STONE }, // the Werf
  { rect: { minX: 60, maxX: 105, minZ: -3, maxZ: 3 }, table: PETROLEUM }, // the Rijnkaai, north end
  { rect: { minX: 115, maxX: 201, minZ: -3, maxZ: 3 }, table: PETROLEUM }, // beyond the lock
  { rect: { minX: 67, maxX: 73, minZ: 44, maxZ: 112 }, table: COTTON_AND_COFFEE }, // the Petit Bassin, west quay
  { rect: { minX: 68, maxX: 172, minZ: 107, maxZ: 113 }, table: COTTON_AND_COFFEE }, // south quay
  { rect: { minX: 114, maxX: 172, minZ: 43, maxZ: 49 }, table: COTTON_AND_COFFEE }, // north quay
];
/** Against the storehouse walls, between the loading gates. */
const WALL_GOODS: Table = [
  ["bales_block", 2.5], ["bales_row", 2], ["coffee_stack", 2], ["grain_pile", 1.5], ["hides_pile", 1.2], ["crates_stack", 1.5],
  ["casks_standing", 1], ["crate_open", 0.5], ["crate_broken", 0.3], ["tarp_heap", 0.7], ["ladder_lean", 0.8], ["planks_lean", 0.6],
  ["sack_truck_sacks", 0.8], ["weigh_scale", 0.5],
];
/** Things that have a back and a front: their back to the wall. Leaning things: how far their foot stands out. */
const FACING = new Set(["ladder_lean", "planks_lean", "sack_truck_sacks", "weigh_scale"]);
const LEAN: Record<string, number> = { ladder_lean: 0.5, planks_lean: 0.42 };
/** Heaps out on the open quay, with a 3 m passage on both sides (or one: `n`). */
const FIELDS: Array<{ rect: Rect; step: [number, number]; t: [number, number]; n?: [number, number]; table: Table }> = [
  {
    rect: { minX: 72, maxX: 100, minZ: 9, maxZ: 33 },
    step: [8, 7],
    t: [1, 0],
    table: [["casks_pyramid", 2], ["petrol_pyramid", 2], ["bales_block", 1.5], ["tarp_heap", 1.5], ["timber_stack", 1], ["stones_stack", 1], ["coffee_stack", 1]],
  },
  {
    // in front of the Hanseatic House, the naties' storehouse: cotton being weighed
    rect: { minX: 80, maxX: 150, minZ: 119.5, maxZ: 123.5 },
    step: [7.5, 10],
    t: [1, 0],
    n: [0, -1],
    table: [["beam_scale", 2], ["bales_block", 2], ["bales_row", 1.5], ["tarp_heap", 1], ["hides_pile", 1]],
  },
  {
    // a second row beyond the lock, between the row at the water and the cart road
    rect: { minX: 122, maxX: 176, minZ: 6.2, maxZ: 7.2 },
    step: [5.5, 10],
    t: [1, 0],
    n: [0, -1],
    table: PETROLEUM,
  },
  {
    // the Werf: its water edge is the railway and the crane runways; the goods stand on the town
    // side, between the trees
    rect: { minX: -309, maxX: -220, minZ: 10.3, maxZ: 11.5 },
    step: [12, 10],
    t: [1, 0],
    n: [0, -1],
    table: WINE_AND_STONE,
  },
];

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
    if (d.width > 12) continue; // a whole storehouse front: its gates and spot are kept clear on their own
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

  /**
   * Does `name` at (x, z, yaw) stand clear of the buildings as built (no face through its footprint, from
   * over the kerb to its top) and flat on the street (not half on a kerb, a step or a plinth)? (the prop check)
   */
  const standsClear = (name: string, x: number, z: number, yaw: number): boolean => {
    const f = props.footprint(name);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const W = (u: number, v: number): [number, number] => [x + u * c + v * s, z - u * s + v * c];
    if (opts.probe) {
      for (let y = 0.15; y < Math.min(f.height, 1.5); y += 0.3) {
        for (const v of [f.minZ + 0.03, (f.minZ + f.maxZ) / 2, f.maxZ - 0.03]) {
          const [ax, az] = W(f.minX + 0.03, v);
          if (opts.probe(ax, y, az, c, -s, f.maxX - f.minX - 0.06) !== null) return false;
        }
        for (const u of [f.minX + 0.03, (f.minX + f.maxX) / 2, f.maxX - 0.03]) {
          const [ax, az] = W(u, f.minZ + 0.03);
          if (opts.probe(ax, y, az, s, c, f.maxZ - f.minZ - 0.06) !== null) return false;
        }
      }
    }
    if (opts.ground) {
      for (const [u, v] of [[f.minX, f.minZ], [f.maxX, f.minZ], [f.maxX, f.maxZ], [f.minX, f.maxZ], [(f.minX + f.maxX) / 2, (f.minZ + f.maxZ) / 2]]) {
        const [gx, gz] = W(u * 0.85 + ((f.minX + f.maxX) / 2) * 0.15, v * 0.85 + ((f.minZ + f.maxZ) / 2) * 0.15);
        const g = opts.ground(gx, gz, 0.4);
        if (g !== null && Math.abs(g) > 0.05) return false;
      }
    }
    return true;
  };

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
    if (!standsClear(name, x, z, yaw)) return false;
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

  // reserved ground: the traffic lanes stay open (2); lamps and trees are in the way (1); crane feet.
  // (M7 quays: marked whether or not the port goods are placed here, so the carts keep off the lanes too)
  {
    const decor = (CITY as unknown as { decor?: { lamps?: Array<[number, number]>; trees?: Array<[number, number]> } }).decor ?? {};
    const mark = (cx: number, cz: number, rad: number, v: 1 | 2) =>
      cells(cx, cz, 1, 0, rad, rad, (x, z, i, j) => {
        if (Math.hypot(x - cx, z - cz) > rad) return;
        if (v === 1 || !occ.has(key(i, j))) occ.set(key(i, j), v);
      });
    for (const [x, z] of decor.lamps ?? []) mark(x, z, 0.6, 1);
    for (const [x, z] of decor.trees ?? []) mark(x, z, 0.8, 1);
    for (const [x, z] of opts.cranes ?? CRANES) mark(x, z, 3.8, 2);
    for (const lane of trafficLanes()) for (let i = 0; i < lane.x.length; i += 2) mark(lane.x[i], lane.z[i], lane.half, 2);
  }

  // --- the port goods
  let goods = 0;
  if (opts.goods !== false) goods = dressGoods();
  else {
    // M7 quays (world/quaygoods.ts has the goods now): laid out as before and taken away again, so the
    // seeded layout of the carts and the squares after them stays as it was (checked with paths())
    const a0 = all.length;
    const c0 = colliders.length;
    const p0 = placed.length;
    dressGoods();
    all.length = a0;
    colliders.length = c0;
    placed.length = p0;
  }

  function dressGoods(): number {
    const n0 = placed.length;

    // rows along the water on the busy quays
    for (const [ax, az, bx, bz] of city.quays) {
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 3) continue;
      const tx = (bx - ax) / L;
      const tz = (bz - az) / L;
      const mx = (ax + bx) / 2;
      const mz = (az + bz) / 2;
      let nx = -tz;
      let nz = tx;
      const land = (sg: number) => {
        let k = 0;
        for (const f of [0.2, 0.5, 0.8]) if (at(ax + (bx - ax) * f + nx * sg * 2.5, az + (bz - az) * f + nz * sg * 2.5) === OPEN) k++;
        return k;
      };
      if (land(-1) > land(1)) {
        nx = -nx;
        nz = -nz;
      }
      if (!land(1) || !WATER_ROWS.some((w) => inside(w.rect, mx, mz, L / 2))) continue;
      let s = 1 + r() * 2;
      while (s < L - 1) {
        const px = ax + tx * s;
        const pz = az + tz * s;
        const zone = WATER_ROWS.find((w) => inside(w.rect, px, pz, 0));
        if (!zone) {
          s += 2;
          continue;
        }
        const name = pick(r, zone.table);
        const f = props.footprint(name);
        const hl = Math.max(f.maxX - f.minX, f.maxZ - f.minZ) / 2;
        const hs = Math.min(f.maxX - f.minX, f.maxZ - f.minZ) / 2;
        const run = 1 + Math.floor(r() * 3);
        for (let k = 0; k < run && s + 2 * hl < L - 0.5; k++) {
          const sc = s + hl;
          if (!inside(zone.rect, ax + tx * sc, az + tz * sc, 0)) break;
          const cx = ax + tx * sc + nx * (0.55 + hs);
          const cz = az + tz * sc + nz * (0.55 + hs);
          if (!putItem(name, cx, cz, tx, tz, nx, nz, PASSAGE)) {
            s += 1;
            break;
          }
          s += 2 * hl + 0.3;
        }
        s += 3 + r() * 3.5;
      }
    }

    // against the storehouse walls, between the loading gates
    for (const fr of props.storeFronts) {
      const [ax, az, bx, bz, ox, oz, ...gates] = fr;
      const L = Math.hypot(bx - ax, bz - az);
      const tx = (bx - ax) / L;
      const tz = (bz - az) / L;
      const gateNear = (s0: number, s1: number) => gates.some((g) => s1 > g - 2.4 && s0 < g + 2.4);
      let s = 0.7;
      let tools = 0;
      while (s < L - 0.7) {
        const name = pick(r, WALL_GOODS);
        const f = props.footprint(name);
        const facing = FACING.has(name);
        // ladders, sack trucks and scales: one to a wall, next to a gate
        if (facing && (tools > 0 || !gates.some((g) => Math.abs(s - g) < 5.5))) {
          s += 0.2;
          continue;
        }
        const w = f.maxX - f.minX;
        const d = f.maxZ - f.minZ;
        const hl = facing ? w / 2 : Math.max(w, d) / 2;
        const hs = facing ? d / 2 : Math.min(w, d) / 2;
        if (s + 2 * hl > L - 0.7) break;
        if (gateNear(s, s + 2 * hl)) {
          s += 0.5;
          continue;
        }
        const sc = s + hl;
        // leaning things: the foot stands out LEAN from the wall; the rest stand 0.12 off it
        const off = LEAN[name] !== undefined ? LEAN[name] + (f.minZ + f.maxZ) / 2 : 0.12 + hs;
        const cx = ax + tx * sc + ox * off;
        const cz = az + tz * sc + oz * off;
        if (putItem(name, cx, cz, tx, tz, ox, oz, PASSAGE, { facing })) {
          s += 2 * hl + 0.4 + r() * 1.2;
          if (facing) tools++;
        } else s += 0.8;
      }
    }

    // heaps out on the open quay
    for (const fz of FIELDS) {
      const [tx, tz] = fz.t;
      const [nx, nz] = fz.n ?? [-tz, tx];
      for (let x = fz.rect.minX + 3; x <= fz.rect.maxX - 2; x += fz.step[0])
        for (let z = fz.rect.minZ + Math.min(1.5, (fz.rect.maxZ - fz.rect.minZ) / 2); z <= fz.rect.maxZ; z += fz.step[1]) {
          const name = pick(r, fz.table);
          putItem(name, x + (r() - 0.5) * 0.8, z + (r() - 0.5) * 0.6, tx, tz, nx, nz, PASSAGE, { both: !fz.n });
        }
    }
    return placed.length - n0;
  }

  /**
   * Stand `name` with its footprint centre at (cx, cz), its long side along t (or, `facing`, its
   * front toward n), on open ground clear of doors, spots and other things, with `deep` metres of
   * free ground in front (toward n; `both`: behind it too).
   */
  function putItem(name: string, cx: number, cz: number, tx: number, tz: number, nx: number, nz: number, deep: number, o: { both?: boolean; facing?: boolean } = {}): boolean {
    const f = props.footprint(name);
    const w = f.maxX - f.minX;
    const d = f.maxZ - f.minZ;
    const along = d >= w;
    const hl = o.facing ? w / 2 : Math.max(w, d) / 2;
    const hs = o.facing ? d / 2 : Math.min(w, d) / 2;
    for (const c of clear) if (Math.hypot(c.x - cx, c.z - cz) < c.r + hl) return false;
    for (const k of keepOut) if (cx > k.minX - hl && cx < k.maxX + hl && cz > k.minZ - hl && cz < k.maxZ + hl) return false;
    if (nearDoor(cx, cz, tx, tz, hl, hs, 1.6)) return false;
    if (!cells(cx, cz, tx, tz, hl + 0.15, hs + 0.15, (x, z, i, j) => at(x, z) === OPEN && !occ.has(key(i, j)))) return false;
    const bands: Array<[number, number]> = o.both ? [[nx, nz], [-nx, -nz]] : [[nx, nz]];
    for (const [bx, bz] of bands) {
      const fx = cx + bx * (hs + deep / 2 + 0.05);
      const fz = cz + bz * (hs + deep / 2 + 0.05);
      if (!cells(fx, fz, tx, tz, hl + 0.6, deep / 2, (x, z, i, j) => at(x, z) === OPEN && occ.get(key(i, j)) !== 1)) return false;
    }
    let yaw: number;
    if (o.facing) yaw = Math.atan2(nx, nz);
    else {
      const flip = r() < 0.5 ? 1 : -1;
      yaw = along ? Math.atan2(tx * flip, tz * flip) : Math.atan2(tx * flip, tz * flip) - Math.PI / 2;
    }
    const ox = (f.minX + f.maxX) / 2;
    const oz = (f.minZ + f.maxZ) / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const x = cx - (ox * c + oz * s);
    const z = cz - (-ox * s + oz * c);
    if (!standsClear(name, x, z, yaw)) return false;
    cells(cx, cz, tx, tz, hl + 0.3, hs + 0.3, (_x, _z, i, j) => void occ.set(key(i, j), 1));
    for (const [bx, bz] of bands) {
      cells(cx + bx * (hs + deep / 2 + 0.05), cz + bz * (hs + deep / 2 + 0.05), tx, tz, hl + 0.3, deep / 2, (_x, _z, i, j) => {
        if (!occ.has(key(i, j))) occ.set(key(i, j), 2);
      });
    }
    all.push(props.place(name, x, z, yaw));
    colliders.push(...props.colliders(name, x, z, yaw));
    placed.push({ name, x, z, yaw });
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
  dropProps("props");
  for (const o of all) {
    addPropObject("props", o);
    o.updateMatrixWorld(true);
    const ck = `${Math.floor(o.position.x / 50)},${Math.floor(o.position.z / 50)}`;
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.Material;
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      for (const a of Object.keys(g.attributes)) if (!["position", "normal", "uv", "color", "cell"].includes(a)) g.deleteAttribute(a);
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
  // Before each render (before three.js sorts out what to draw, so a new camera place counts at
  // once): hide the chunks beyond the fog. Chained onto the scene's own hook.
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
  return { group, colliders, placed, goods };
}

/** Is (x, z) inside the box, grown by `m`? */
function inside(b: Rect, x: number, z: number, m: number): boolean {
  return x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;
}
