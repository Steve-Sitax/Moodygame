import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import { LANDMARK_DOORS } from "../../../shared/landmarks";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { loadProps } from "./props3d";
import { TOWN_CLEAR } from "./quayfurniture";
import { trackKeepOut, type TrackData } from "./tracks";
import { trafficLanes } from "./traffic";

// Goods on the working quays (Steve 2026-09-25: "make the kaaien with better graphics and more
// detail, more props. High quality is needed").
//
// The quays get composed heaps ("vignettes") instead of single props: a landing of coffee on
// pallets with the scale and a sack truck, a crate yard with a tied stack and an open crate
// spilling straw, a pyramid of casks with a standing group, petroleum in blue casks, cotton bales,
// goods under tarred tarpaulins roped to stones, a rope store with a cable drum and coils, a rope
// walk on its trestles, planks drying and squared baulks, handcarts left by the goods; straw, grain,
// oil and trodden dirt on the setts round each heap. Things stand a little askew, as used.
//
// Rules (the quays must still work): a heap stands on open quay ground, off the rails, the traffic
// and omnibus lanes, the crane runways (and 1.5 m round them), the stone flights and ladders, the
// bridge heads, doors and loading gates, the job places and the notice board, the markets and the
// emigrants' camp; 2 m back from the water; and with 3 m of free ground all round it (the passage),
// except where its back stands against a wall. So nothing here can close a way (paths() stays []).
//
// Models: tools/blender/build_quaygoods.py -> /models/quaygoods.glb (one atlas). Copies are merged
// per 64 m chunk: two draw calls (solid, decal) per chunk in view; chunks beyond the fog are hidden.

type Flags = (x: number, z: number) => number | undefined;

export interface QuayGoodsOptions {
  seed?: number;
  /** Colliders already down (props, quay furniture, litter, clutter, cranes, lamps): kept clear. */
  avoid?: Rect[];
  /** Boxes to keep the goods off (rails, lanes, runways, workplaces, flights): passages may cross them. */
  keepOut?: Rect[];
  /** The stone steps and ladders (world.quayInfo). */
  quayInfo?: () => { flights: Array<{ top: [number, number]; end: [number, number] }>; ladders: Array<{ x: number; z: number; top: number }> };
  /** More circles to keep clear (the corner Madonnas' stands of world/streetlife.ts ...). */
  keepClear?: Array<{ x: number; z: number; r: number }>;
  /**
   * The shop fronts of street life: lively.ts sets goods out beside their doors (1.5 m either side,
   * without looking at colliders), so the goods here keep off that stretch of wall.
   */
  shops?: Array<{ ax: number; az: number; tx: number; tz: number; ox: number; oz: number; len: number; door: number }>;
}

export interface QuayGoods {
  group: THREE.Group;
  colliders: Rect[];
  stats: {
    /** Heaps placed per quay, and per kind. */
    byQuay: Record<string, number>;
    byKind: Record<string, number>;
    /** Models placed (singles), by name. */
    models: Record<string, number>;
    meshes: number;
    triangles: number;
    /** Why a heap was not put where it was tried. */
    rej: Record<string, number>;
    /** Pass 3: the things dropped round the heaps and along the quays, and the stains on the setts. */
    debris: { objects: number; decals: number };
  };
  placed: Array<{ kind: string; quay: string; x: number; z: number; yaw: number; w: number; d: number; wall: boolean }>;
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
  tris: number;
}
interface Put {
  name: string;
  m: THREE.Matrix4;
  shade: number;
}

const SOLID = 0;
const DECAL = 1;
const OPEN = 0;
const WALLF = 1;
const WATER = 2;
const CHUNK = 64;
/** Free ground round a heap (m). */
const PASSAGE = 3.0;
/** Free ground between the heaps out on the open quay (m): pass 2, denser fields (the lead, 2026-09-25). */
const OPEN_PASSAGE = 2.0;
/**
 * Two heaps out on the open quay may stand this close (m): a way between them for one man, as between
 * the heaps of the period photos. Their 2 m round them keeps them off walls, rows and everything else.
 */
const OPEN_NEAR = 1.2;
/** The same in front of a row along the water (m): the quay's walk runs behind the rows. */
const EDGE_PASSAGE = 1.5;
/** Back from the water edge (m). */
const WATER_GAP = 2.0;
/** Places of the town's life by the quays (server/src/town/places.ts; keep in step): x, z, radius kept clear. */
const TOWN_PLACES: Array<[number, number, number]> = [
  [11.2, 43.5, 8], // the Hessenatie: the naties hire at its gate
  [-52, 46, 4.5], // In de Ankere
  [-236, 14, 4.5], // Het Schipke
  [100, 124, 4.5], // Het Bassin
  [-290, 14, 3.5], // the ship's chandler on the Werf
  [-250, 28, 3.5], // the grocer on the Werf
];
/** A row along the water stands this far back from the edge line (m): the mooring strip stays free. */
const EDGE_GAP = 1.0;
/** The walk map marks the 0.5 m cell the edge line runs through as water: a row's check allows for it. */
const EDGE_CELL = 0.55;
/** A wall-backed heap stands this far off the wall (m): just clear of the 0.7 m kerb along the fronts. */
const WALL_GAP = 0.8;

// ------------------------------------------------------------------ the heaps

/**
 * [model, x, z, yaw, optional (chance it is left out), y (lifted onto something)] in the heap's frame:
 * x along it, z out (its front).
 */
type Item = [string, number, number, number, number?, number?];
interface Vignette {
  items: Item[];
  /** Ground decals: [decal, x, z, yaw]. */
  ground: Array<[string, number, number, number]>;
  /** May stand with its back (-z) against a wall. */
  wall?: boolean;
  /** May stand out on the open quay. */
  open?: boolean;
  /** A row along the water edge, its back (-z) to the water. */
  edge?: boolean;
}

const V: Record<string, Vignette> = {
  // coffee landed: two pallets of sacks, the scale, a loose heap, the sack truck
  coffee: {
    items: [
      ["sacks_pallet", 0, 0, 0.03],
      ["sacks_pallet", 1.32, 0.05, -0.05],
      ["weigh_scale", -1.35, 0.35, 0.25],
      ["sacks_heap", 2.95, 0.25, -0.35, 0.3],
      ["sack_truck", -1.05, 1.45, 2.7, 0.4],
      ["sack", 0.7, 1.15, 1.3, 0.5],
    ],
    ground: [["d_coffee", 1.3, 1.0, 0.4], ["d_straw_b", -0.3, 1.2, 1.1], ["d_dirt", 0.8, 0.6, 0.1]],
    wall: true,
    open: true,
  },
  grain: {
    items: [
      ["sacks_pallet_grain", 0, 0, -0.04],
      ["sacks_pallet_grain", 1.35, -0.05, 0.06, 0.3],
      ["sack_standing", -0.95, 0.35, 0.4],
      ["sack_standing", -1.0, 0.95, 2.2, 0.4],
      ["sacks_heap", 1.2, 1.35, 1.52, 0.5],
    ],
    ground: [["d_grain", 0.4, 1.0, 0.0], ["d_grain", -0.9, 1.5, 1.2], ["d_dirt", 0.5, 0.4, 0.3]],
    wall: true,
    open: true,
  },
  crates: {
    items: [
      ["crates_tied", 0, 0, 0.04],
      ["crate_column", 1.75, -0.1, -0.12],
      ["crate_open", 0.25, 1.45, -0.28],
      ["crate_roped", 1.6, 1.3, 0.55, 0.3],
      ["rope_coil", -1.45, 0.9, 0.3, 0.3],
      ["crate_c", -1.35, -0.1, 1.57 + 0.06, 0.4],
    ],
    ground: [["d_straw_a", 0.7, 1.7, 0.2], ["d_straw_b", -0.6, 1.1, 2.1], ["d_dirt", 0.8, 0.5, 0.0]],
    wall: true,
    open: true,
  },
  casks: {
    items: [
      ["casks_pyramid", 0, 0, 1.57],
      ["casks_group", 2.05, 0.1, 0.4],
      ["cask_lying", -0.1, 1.55, 0.18, 0.3],
      ["cask_big", -1.8, 0.2, 1.0, 0.4],
      ["keg", -1.45, 1.05, 0.2, 0.5],
    ],
    ground: [["d_oil", 1.0, 1.2, 0.0], ["d_dirt", -0.4, 0.8, 1.6]],
    wall: true,
    open: true,
  },
  // wine from Bordeaux: hogsheads standing, a pyramid of casks, the tally chalked on them
  wine: {
    items: [
      ["cask_big", 0, 0, 0.2],
      ["cask_big", 0.92, 0.1, 1.4],
      ["cask_big", 0.4, 0.85, 2.6, 0.3],
      ["casks_pyramid", 2.55, 0.15, 1.57 + 0.04],
      ["keg", -0.85, 0.7, 0.9, 0.4],
      ["crate_s", -0.9, -0.1, 0.25, 0.5],
    ],
    ground: [["d_oil", 1.3, 1.3, 0.0], ["d_straw_b", -0.3, 1.3, 0.6]],
    wall: true,
    open: true,
  },
  petroleum: {
    items: [
      ["casks_pyramid_blue", 0, 0, 1.57],
      ["casks_pyramid_blue", 0, 2.35, 1.57 + 0.05, 0.4],
      ["cask_blue", 1.45, -0.35, 0.3],
      ["cask_blue", 1.55, 0.35, 1.9],
      ["cask_blue", 1.3, 1.0, 0.8, 0.5],
    ],
    ground: [["d_oil", 0.9, 1.1, 0.0], ["d_oil", -0.8, 2.9, 1.0]],
    open: true,
  },
  cotton: {
    items: [
      ["bales_stack", 0, 0, 1.57],
      ["bale", 1.55, 0.15, 1.57 + 0.3],
      ["bale", 1.85, 1.6, 0.25, 0.4],
      ["hamper", -1.3, 0.9, 0.35, 0.4],
      ["sack_truck", 0.6, 1.8, 3.4, 0.5],
    ],
    ground: [["d_straw_a", 0.9, 1.3, 0.8], ["d_dirt", 0.3, 0.6, 0.0]],
    wall: true,
    open: true,
  },
  tarp_goods: {
    items: [
      ["tarp_crates", 0, 0, 0.05],
      ["crate_b", 2.1, 0.25, 0.45, 0.3],
      ["crate_s", 2.0, 1.1, -0.3, 0.5],
      ["rope_loose", 0.4, 1.5, 0.15, 0.4],
    ],
    ground: [["d_dirt", 0.3, 1.0, 0.2], ["d_straw_b", 1.4, 1.3, 0.7]],
    wall: true,
    open: true,
  },
  tarp_casks: {
    items: [
      ["tarp_casks", 0, 0, 0.0],
      ["cask", 2.0, 0.25, 0.6],
      ["cask_dark", 2.05, -0.5, 2.0, 0.3],
      ["cask_lying", 0.2, 1.95, 0.1, 0.4],
    ],
    ground: [["d_oil", 0.6, 1.3, 0.0]],
    wall: true,
    open: true,
  },
  rope_store: {
    items: [
      ["cable_drum", 0, 0, 0.1],
      ["rope_coil", 1.25, 0.35, 0.4],
      ["rope_coil_tar", 1.35, -0.75, 1.9],
      ["baskets", -1.35, 0.1, 0.3, 0.3],
      ["rope_loose", 0.6, 1.35, -0.25],
    ],
    ground: [["d_straw_b", -0.2, 1.1, 0.4], ["d_dirt", 0.5, 0.2, 0.0]],
    wall: true,
    open: true,
  },
  ropewalk: {
    items: [
      ["ropewalk", -4.5, 0, 0],
      ["rope_coil", 5.6, 0.9, 0.3, 0.3],
      ["baskets", -6.1, 1.0, 0.2, 0.4],
      ["cable_drum", -6.0, -0.6, 1.57, 0.5],
    ],
    ground: [["d_straw_b", -4.0, 0.9, 0.2], ["d_straw_b", 2.2, 0.7, 2.8], ["d_dirt", -4.7, 0.4, 0.0]],
    open: true,
  },
  timber: {
    items: [
      ["planks_stack", 0, 0, 0.03],
      ["baulks", 0.2, 1.8, -0.04],
      ["handcart", 2.6, 1.0, 1.4, 0.4],
    ],
    ground: [["d_dirt", 0.0, 0.9, 0.0]],
    wall: true,
    open: true,
  },
  cart_goods: {
    items: [
      ["handcart_loaded", 0, 0.2, 0.2],
      ["crate_b", 1.35, -0.2, -0.3],
      ["crate_s", 1.35, -0.18, 0.2, 0.6, 0.56],
      ["sacks_heap", -1.6, 0.0, 1.62, 0.3],
      ["basket", 1.3, 0.75, 0.0, 0.4],
    ],
    ground: [["d_straw_b", 0.4, 1.4, 0.0], ["d_grain", -1.4, 1.1, 0.6]],
    wall: true,
    open: true,
  },
  // rows along the water edge (the period photos: goods set down where the ship's tackle landed them),
  // backs (-z) to the water
  edge_casks: {
    items: [
      ["cask_lying", -1.55, 0, 1.57 + 0.04],
      ["cask_lying", -0.8, 0.02, 1.57 - 0.03],
      ["cask_lying", -0.05, -0.01, 1.57 + 0.02],
      ["cask_lying", 0.7, 0.03, 1.57 - 0.05, 0.3],
      ["cask", 1.55, 0.05, 0.4, 0.4],
    ],
    ground: [["d_oil", 0.0, 0.9, 0.0]],
    edge: true,
  },
  edge_petrol: {
    items: [
      ["casks_pyramid_blue", 0, 0, 1.57 + 0.03],
      ["cask_blue", 1.62, -0.2, 0.5],
      ["cask_blue", 1.68, 0.52, 2.1, 0.4],
    ],
    ground: [["d_oil", 0.6, 0.9, 0.0]],
    edge: true,
  },
  edge_wine: {
    items: [
      ["casks_pyramid", 0, 0, 1.57 - 0.02],
      ["cask_big", 1.55, 0.05, 0.9, 0.3],
      ["keg", -1.35, 0.1, 0.2, 0.4],
    ],
    ground: [["d_oil", 0.4, 0.9, 0.3]],
    edge: true,
  },
  edge_crates: {
    items: [
      ["crate_c", -1.0, 0, 0.03],
      ["crates_tied", 0.9, 0.05, 1.57 - 0.04],
      ["crate_s", -1.1, 0.02, 0.3, 0.5, 0.5],
    ],
    ground: [["d_straw_b", 0, 0.9, 0.2]],
    edge: true,
  },
  edge_sacks: {
    items: [
      ["sacks_pallet", -0.68, 0, 0.02],
      ["sacks_pallet_grain", 0.68, 0.03, -0.04, 0.3],
      ["sack", 1.8, 0.1, 1.5, 0.5],
    ],
    ground: [["d_grain", 0.2, 0.9, 0.0]],
    edge: true,
  },
  edge_bales: {
    items: [
      ["bale", -0.7, 0, 0.02],
      ["bale", 0.7, 0.04, -0.05],
      ["bale", 2.05, 0.02, 0.1, 0.4],
    ],
    ground: [["d_straw_b", 0.6, 0.8, 0.4]],
    edge: true,
  },
  edge_rope: {
    items: [
      ["rope_coil", 0, 0, 0.3],
      ["cable_drum", 1.25, 0.05, 1.57 + 0.1, 0.3],
      ["rope_coil_tar", -1.1, 0.1, 1.2, 0.4],
    ],
    ground: [],
    edge: true,
  },
  // the naties' stock against the storehouse walls: big blocks of one kind, as they were stored
  wall_bales: {
    items: [
      ["bales_stack", 0, 0, 1.57 + 0.02],
      ["bale", 1.65, 0.1, 1.57 - 0.1],
      ["sack_truck", 1.55, 1.05, 2.9, 0.5],
    ],
    ground: [["d_straw_a", 1.1, 1.3, 0.1], ["d_dirt", 2.0, 0.9, 0.0]],
    wall: true,
  },
  wall_sacks: {
    items: [
      ["sacks_pallet", 0, 0, 0.02],
      ["sacks_pallet", 1.3, 0.04, -0.03],
      ["sacks_pallet_grain", 2.6, 0.0, 0.04, 0.5],
      ["weigh_scale", 0.7, 1.3, 0.1, 0.4],
    ],
    ground: [["d_coffee", 1.3, 1.1, 0.3], ["d_grain", 2.7, 1.0, 1.2]],
    wall: true,
  },
  wall_crates: {
    items: [
      ["crate_column", 0, 0, 0.05],
      ["crates_tied", 1.45, 0.05, 1.57 - 0.03],
      ["crate_column", 2.95, 0.02, -0.12, 0.5],
      ["crate_open", 1.4, 1.5, 0.3, 0.5],
    ],
    ground: [["d_straw_a", 1.8, 1.4, 0.3], ["d_straw_b", 3.6, 1.0, 1.0]],
    wall: true,
  },
  wall_casks: {
    items: [
      ["casks_pyramid", 0, 0, 1.57],
      ["cask_big", 1.45, 0.05, 0.5],
      ["cask_big", 1.45, 0.95, 2.1, 0.4],
      ["cask_lying", -0.1, 1.3, 0.1, 0.4],
    ],
    ground: [["d_oil", 1.2, 1.2, 0.0]],
    wall: true,
  },
  // short rows for the gaps between bollards and berths
  edge_short_casks: {
    items: [
      ["cask_lying", -0.4, 0, 1.57 + 0.05],
      ["cask_lying", 0.35, 0.02, 1.57 - 0.04],
      ["keg", 0.0, 0.75, 0.3, 0.5],
    ],
    ground: [["d_oil", 0.0, 0.8, 0.0]],
    edge: true,
  },
  edge_short_sacks: {
    items: [
      ["sacks_pallet", 0, 0, 0.03],
      ["sack", 0.1, 0.85, 1.5, 0.5],
    ],
    ground: [["d_grain", 0.2, 0.9, 0.0]],
    edge: true,
  },
  edge_short_crates: {
    items: [
      ["crate_a", -0.55, 0, 0.04],
      ["crate_roped", 0.5, 0.02, -0.06],
      ["crate_s", -0.5, 0.0, 0.2, 0.4, 0.62],
    ],
    ground: [["d_straw_b", 0.0, 0.8, 0.3]],
    edge: true,
  },
  edge_short_rope: {
    items: [
      ["rope_coil", 0, 0, 0.3],
      ["cask_blue", 0.85, 0.05, 0.4, 0.4],
    ],
    ground: [],
    edge: true,
  },
  // small fillers: a few things set down together, for the gaps between the big heaps
  few_casks: {
    items: [
      ["cask", 0, 0, 0.3],
      ["cask_dark", 0.72, 0.08, 1.9],
      ["keg", 0.3, 0.68, 0.6, 0.3],
      ["cask_lying", -0.15, 1.35, 0.25, 0.5],
    ],
    ground: [["d_oil", 0.3, 0.9, 0.0]],
    wall: true,
    open: true,
  },
  sacks_few: {
    items: [
      ["sacks_heap", 0, 0, 0.1],
      ["sack_standing", 1.2, 0.3, 0.8],
      ["sack", 0.5, 1.2, 1.9, 0.4],
    ],
    ground: [["d_grain", 0.5, 0.8, 0.0]],
    wall: true,
    open: true,
  },
  crate_pair: {
    items: [
      ["crate_roped", 0, 0, 0.12],
      ["crate_a", 1.15, 0.05, -0.08],
      ["rope_coil_tar", 0.4, 1.05, 0.7, 0.4],
    ],
    ground: [["d_straw_b", 0.5, 0.9, 0.3]],
    wall: true,
    open: true,
  },
  bales_few: {
    items: [
      ["bale", 0, 0, 0.04],
      ["bale", 0.05, 0.72, 0.05, 0.5],
      ["hamper", 1.25, 0.1, 0.3, 0.4],
      ["sack_truck", -0.9, 0.8, 2.6, 0.5],
    ],
    ground: [["d_straw_b", 0.3, 0.8, 0.2]],
    wall: true,
    open: true,
  },
  rope_few: {
    items: [
      ["rope_coil", 0, 0, 0.2],
      ["crate_s", 1.0, -0.05, 0.4],
      ["basket", 0.95, 0.75, 0.0, 0.4],
      ["rope_loose", 0.2, 0.95, -0.3, 0.5],
    ],
    ground: [["d_dirt", 0.4, 0.5, 0.0]],
    wall: true,
    open: true,
  },
  // small ones for the Rijnkaai by the start: against the storehouses, between the job places
  corner: {
    items: [
      ["crate_a", 0, 0, 0.05],
      ["crate_s", 0.05, 0.02, 0.3, 0.5, 0.62],
      ["cask", 1.05, 0.05, 0.6],
      ["sack_standing", 1.0, 0.75, 1.1, 0.4],
      ["basket", -0.95, 0.45, 0.0, 0.4],
    ],
    ground: [["d_straw_b", 0.2, 0.8, 0.2]],
    wall: true,
  },
  baskets: {
    items: [
      ["baskets", 0, 0, 0.1],
      ["hamper", 1.25, 0.05, -0.1],
      ["crate_s", -1.1, 0.0, 0.3, 0.4],
      ["rope_coil", 0.7, 0.95, 0.5, 0.5],
    ],
    ground: [["d_straw_b", 0.3, 0.9, 0.0]],
    wall: true,
  },

  // ---- pass 2 (the lead, 2026-09-25: quays crowded with big heaps): big field heaps with things set
  // down round them, and blocks of stock against the storehouse walls
  field_casks: {
    items: [
      ["casks_pyramid4", 0, 0, 1.57],
      ["casks_pyramid", 0.1, 1.15, 1.57 + 0.05, 0.3],
      ["cask_big", 2.0, -0.2, 0.4],
      ["cask_big", 2.1, 0.75, 1.9, 0.3],
      ["cask_lying", -2.05, 0.95, 0.3, 0.3],
      ["keg", -1.95, -0.35, 0.1, 0.4],
      ["rope_coil", 2.45, 1.95, 0.2, 0.5],
    ],
    ground: [["d_oil", 0.5, 1.9, 0.0], ["d_straw_b", -1.5, 1.7, 0.4], ["d_dirt", 0.3, 0.6, 0.0]],
    open: true,
  },
  field_petrol: {
    items: [
      ["casks_pyramid4_blue", 0, 0, 1.57],
      ["casks_pyramid_blue", 0.15, 1.15, 1.57 - 0.04, 0.3],
      ["cask_blue", 2.0, -0.25, 0.3],
      ["cask_blue", 2.05, 0.5, 1.7],
      ["cask_blue", 1.85, 1.3, 2.9, 0.4],
      ["keg", -1.9, 0.6, 0.5, 0.4],
    ],
    ground: [["d_oil", 0.6, 1.9, 0.0], ["d_oil", -1.3, 1.2, 1.1], ["d_dirt", 0.3, 0.5, 0.0]],
    open: true,
  },
  field_bales: {
    items: [
      ["bales_block", 0, 0, 1.57],
      ["bale", 1.95, 0.35, 0.1],
      ["bale", -1.95, 1.15, 1.45, 0.4],
      ["hamper", 1.95, 1.3, 0.3, 0.5],
      ["sack_truck", -1.8, -0.2, 2.8, 0.5],
    ],
    ground: [["d_straw_a", 0.4, 2.2, 0.3], ["d_straw_b", -1.6, 2.0, 1.2], ["d_dirt", 0.2, 1.0, 0.0]],
    open: true,
  },
  field_sacks: {
    items: [
      ["sacks_mountain", 0, 0, 0.05],
      ["sacks_pallet", 2.95, 0.2, 0.08, 0.3],
      ["weigh_scale", -2.6, 0.6, 0.3, 0.4],
      ["sack_truck", -2.45, -0.7, 2.6, 0.5],
      ["sack", 1.2, 1.75, 1.4, 0.4],
      ["sack_standing", -1.95, 1.65, 0.5, 0.4],
    ],
    ground: [["d_coffee", 0.3, 1.6, 0.0], ["d_grain", -1.3, 1.5, 0.8], ["d_straw_b", 1.8, 1.3, 0.2]],
    open: true,
  },
  field_grain: {
    items: [
      ["sacks_mountain_grain", 0, 0, -0.04],
      ["sacks_pallet_grain", 2.95, 0.15, 0.05, 0.3],
      ["sack_standing", -2.1, 0.4, 0.8, 0.3],
      ["sack_standing", -2.2, -0.35, 2.3, 0.5],
      ["sacks_heap", 0.4, 1.95, 1.62, 0.4],
    ],
    ground: [["d_grain", 0.2, 1.6, 0.0], ["d_grain", -1.6, 1.3, 1.0], ["d_dirt", 0.4, 0.6, 0.0]],
    open: true,
  },
  field_crates: {
    items: [
      ["crates_block", 0, 0, 0.03],
      ["crates_tied", 2.65, 0.1, 1.57],
      ["crate_open", 0.3, 1.5, -0.3, 0.3],
      ["crate_roped", -2.25, 0.3, 0.2, 0.3],
      ["rope_coil", -2.1, 1.45, 0.3, 0.5],
      ["crate_s", 1.65, 1.35, 0.5, 0.5],
    ],
    ground: [["d_straw_a", 0.6, 1.8, 0.2], ["d_straw_b", -1.4, 1.3, 2.1], ["d_dirt", 0.8, 0.9, 0.0]],
    open: true,
  },
  field_tarp: {
    items: [
      ["tarp_big", 0, 0, 0.02],
      ["cask", 2.75, 0.3, 0.4, 0.3],
      ["cask_dark", 2.85, -0.5, 1.2, 0.5],
      ["crate_b", -2.85, 0.2, 0.2, 0.4],
      ["rope_loose", 0.3, 2.2, 0.1, 0.5],
    ],
    ground: [["d_dirt", 0.3, 1.9, 0.2], ["d_straw_b", -1.8, 1.9, 0.7]],
    open: true,
  },
  field_timber: {
    items: [
      ["planks_stack", 0, 0, 0.03],
      ["baulks", 0.2, 1.95, -0.04],
      ["planks_stack", 0.15, -1.6, -0.02, 0.4],
      ["handcart", 4.2, 0.6, 1.4, 0.4],
    ],
    ground: [["d_dirt", 0.0, 1.0, 0.0], ["d_straw_b", 3.2, 1.6, 0.3]],
    open: true,
  },
  block_bales: {
    items: [
      ["bales_wall", 0, 0, 1.57],
      ["bales_stack", 2.2, 0.05, 1.57],
      ["bale", 1.1, 1.1, 0.15, 0.5],
    ],
    ground: [["d_straw_a", 1.1, 1.6, 0.2]],
    wall: true,
  },
  block_crates: {
    items: [
      ["crates_block", 0, 0, 0.02],
      ["crate_column", 2.3, 0.0, -0.1, 0.4],
      ["crate_open", 0.4, 1.25, 0.3, 0.5],
    ],
    ground: [["d_straw_b", 0.8, 1.4, 0.3]],
    wall: true,
  },
  block_sacks: {
    items: [
      ["sacks_mountain", 0, 0, 0.02],
      ["sack", 1.0, 1.6, 1.4, 0.5],
    ],
    ground: [["d_coffee", 0.4, 1.6, 0.0]],
    wall: true,
  },
  block_grain: {
    items: [
      ["sacks_mountain_grain", 0, 0, -0.02],
      ["sack_standing", 1.9, 1.2, 0.6, 0.5],
    ],
    ground: [["d_grain", 0.4, 1.6, 0.0]],
    wall: true,
  },
  block_casks: {
    items: [
      ["casks_pyramid4", 0, 0, 1.57],
      ["cask_big", 1.95, 0.0, 0.5, 0.3],
      ["cask_lying", -0.3, 0.95, 0.1, 0.5],
    ],
    ground: [["d_oil", 0.4, 1.2, 0.0]],
    wall: true,
  },
  block_petrol: {
    items: [
      ["casks_pyramid4_blue", 0, 0, 1.57],
      ["cask_blue", 1.9, 0.05, 0.5, 0.3],
    ],
    ground: [["d_oil", 0.2, 1.1, 0.0]],
    wall: true,
  },
  block_tarp: {
    items: [
      ["tarp_big_brown", 0, 0, 0.0],
      ["crate_b", 2.55, 0.1, 0.2, 0.5],
    ],
    ground: [["d_dirt", 0.3, 1.8, 0.0]],
    wall: true,
  },
  block_long: {
    items: [
      ["crates_block", 0, 0, 0.02],
      ["bales_wall", 2.95, 0.0, 1.57],
      ["sacks_pallet", 4.75, 0.1, 0.02],
      ["sack_truck", 2.9, 1.2, 2.8, 0.5],
    ],
    ground: [["d_straw_a", 2.0, 1.4, 0.2]],
    wall: true,
  },
};

/** The small heaps: tried only where no big one fits. */
const FILLERS = new Set(["few_casks", "sacks_few", "crate_pair", "bales_few", "rope_few", "corner", "baskets"]);

/** Which heaps go where, and how many at most (each quay its trade, after the period photos). */
interface Area {
  id: string;
  rect: Rect;
  /** Heaps out on the quay and against house walls, at most. */
  max: number;
  /** Heaps along the storehouse fronts, at most. */
  wallMax: number;
  mix: Array<[string, number]>;
  /**
   * Out on the open quay only inside this box, with this mix (the Rijnkaai by the start: most of its
   * open ground is the game's: the jobs, the emigrants, the brig; a rope walk and a few heaps
   * between the old crate stacks, away from them).
   */
  openRect?: Rect;
  openMix?: Array<[string, number]>;
  /** Heaps out on the open quay, at most (default: max). */
  openMax?: number;
  /** Rows along the water edge, and how many at most. */
  edgeMix?: Array<[string, number]>;
  edgeMax?: number;
}
/** The storehouse blocks by trade. */
const WALLS: Record<string, Array<[string, number]>> = {
  crates: [["block_crates", 3], ["block_tarp", 1.5], ["block_long", 1.5]],
  sacks: [["block_sacks", 2.5], ["block_grain", 1.5]],
  casks: [["block_casks", 2.5], ["block_petrol", 1]],
  bales: [["block_bales", 3]],
};
const AREAS: Area[] = [
  {
    id: "rijnkaai",
    rect: { minX: -62, maxX: 66, minZ: 0, maxZ: 46 },
    max: 80,
    wallMax: 80,
    // (pass 2: the open quay between the rails, the lanes and the job places gets field heaps too)
    openRect: { minX: -52, maxX: 60, minZ: 5, maxZ: 36 },
    openMax: 18,
    openMix: [["ropewalk", 3], ["field_crates", 2], ["field_casks", 2], ["field_sacks", 1.5], ["field_tarp", 1.5], ["field_timber", 1], ["crates", 1], ["few_casks", 1], ["crate_pair", 1]],
    mix: [...WALLS.crates, ...WALLS.sacks, ["corner", 1], ["baskets", 1], ["crates", 1], ["coffee", 1]],
  },
  {
    id: "rijnkaai_north",
    rect: { minX: 66, maxX: 106, minZ: 0, maxZ: 48 },
    max: 80,
    wallMax: 80,
    mix: [
      ["field_petrol", 3], ["field_casks", 2], ["field_crates", 2], ["field_tarp", 1.5], ["ropewalk", 1.5], ["petroleum", 1], ["casks", 1], ["tarp_casks", 1],
      ...WALLS.casks, ...WALLS.crates, ["few_casks", 1.5], ["crate_pair", 1], ["rope_few", 1],
    ],
    edgeMix: [["edge_petrol", 3], ["edge_casks", 2], ["edge_crates", 1], ["edge_rope", 1], ["edge_short_casks", 1.5], ["edge_short_rope", 1]],
    edgeMax: 80,
  },
  {
    id: "werf",
    rect: { minX: -352, maxX: -204, minZ: -4, maxZ: 24 },
    max: 80,
    wallMax: 80,
    edgeMix: [["edge_wine", 3], ["edge_casks", 2], ["edge_rope", 1], ["edge_short_casks", 1.5], ["edge_short_crates", 1]],
    edgeMax: 80,
    mix: [
      ["field_casks", 3], ["field_timber", 2], ["field_tarp", 1.5], ["wine", 2], ["casks", 1.5], ["tarp_casks", 1], ["timber", 1], ["ropewalk", 2],
      ...WALLS.casks, ...WALLS.crates, ["few_casks", 1.5], ["crate_pair", 1], ["rope_few", 1],
    ],
  },
  {
    id: "lock_east",
    rect: { minX: 118, maxX: 199.5, minZ: -3, maxZ: 48 }, // (east of the big storehouse: the lane along the town wall, not a quay)
    max: 80,
    wallMax: 80,
    edgeMix: [["edge_petrol", 3], ["edge_sacks", 1.5], ["edge_crates", 1.5], ["edge_casks", 1], ["edge_rope", 1], ["edge_short_sacks", 1.5], ["edge_short_crates", 1], ["edge_short_rope", 1]],
    edgeMax: 80,
    mix: [
      ["field_petrol", 3], ["field_grain", 2], ["field_crates", 2], ["field_tarp", 1.5], ["field_timber", 1], ["petroleum", 1], ["grain", 1], ["crates", 1],
      ...WALLS.sacks, ...WALLS.crates, ...WALLS.casks, ["few_casks", 1], ["sacks_few", 1], ["crate_pair", 1], ["rope_few", 1], ["corner", 0.8],
    ],
  },
  {
    id: "bassin",
    rect: { minX: 55, maxX: 186, minZ: 40, maxZ: 132 },
    max: 80,
    wallMax: 80,
    edgeMix: [["edge_bales", 3], ["edge_sacks", 2.5], ["edge_crates", 1.5], ["edge_rope", 1], ["edge_short_sacks", 2], ["edge_short_crates", 1]],
    edgeMax: 80,
    mix: [
      ["field_bales", 3], ["field_sacks", 3], ["field_crates", 1.5], ["field_tarp", 1], ["cotton", 1.5], ["coffee", 1.5], ["crates", 1],
      ...WALLS.bales, ...WALLS.sacks, ...WALLS.crates, ["sacks_few", 1.5], ["crate_pair", 1], ["bales_few", 1.5], ["baskets", 0.8],
    ],
  },
];

/**
 * The working quays this module dresses (the Rijnkaai by the start left out: it has its own keep-out
 * in dressCity). dressCity keeps its parked carts off them, so the rows along the water are not broken
 * by them (rijnkaai.ts).
 */
export function quayGoodsAreas(): Rect[] {
  return AREAS.filter((a) => a.id !== "rijnkaai").map((a) => ({ ...a.rect }));
}

// ------------------------------------------------------------------ helpers

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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const inR = (r: Rect, x: number, z: number, pad = 0) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;

/** Rects in 8 m buckets for point queries. */
class RectIndex {
  private b = new Map<number, Rect[]>();
  constructor(rects: Rect[]) {
    for (const r of rects) {
      if (!(r.maxX > r.minX) || !(r.maxZ > r.minZ)) continue;
      const i0 = Math.floor(r.minX / 8);
      const i1 = Math.floor(r.maxX / 8);
      const j0 = Math.floor(r.minZ / 8);
      const j1 = Math.floor(r.maxZ / 8);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4000) continue; // (a box over the whole map: not a thing on the quay)
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const k = (i + 512) * 1024 + (j + 512);
          let l = this.b.get(k);
          if (!l) this.b.set(k, (l = []));
          l.push(r);
        }
    }
  }
  /** The first rect with (x, z) inside it (grown by pad), bigger than `minArea` m2. */
  at(x: number, z: number, pad = 0, minArea = 0): Rect | null {
    const k = (Math.floor(x / 8) + 512) * 1024 + (Math.floor(z / 8) + 512);
    for (const r of this.b.get(k) ?? []) {
      if (minArea > 0 && (r.maxX - r.minX) * (r.maxZ - r.minZ) < minArea) continue;
      if (inR(r, x, z, pad)) return r;
    }
    return null;
  }
}

// ------------------------------------------------------------------ loading

let loading: Promise<{ protos: Map<string, Proto>; solidMap: THREE.Texture; decalMap: THREE.Texture }> | null = null;
function loadModels() {
  if (!loading) loading = load();
  return loading;
}

async function load(): Promise<{ protos: Map<string, Proto>; solidMap: THREE.Texture; decalMap: THREE.Texture }> {
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  const gltf = await new GLTFLoader().setDRACOLoader(draco).loadAsync("/models/quaygoods.glb");
  draco.dispose();
  let solidMap: THREE.Texture | null = null;
  let decalMap: THREE.Texture | null = null;
  const protos = new Map<string, Proto>();
  const v = new THREE.Vector3();
  const nrm = new THREE.Matrix3();
  gltf.scene.updateMatrixWorld(true);
  for (const node of gltf.scene.children) {
    const proto: Proto = { parts: [], minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity, height: 0, tris: 0 };
    const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
    node.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = m.material as THREE.MeshStandardMaterial;
      const slot = mat.name === "qg_decal" ? DECAL : SOLID;
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
        part.pos[i * 3] = v.x;
        part.pos[i * 3 + 1] = v.y;
        part.pos[i * 3 + 2] = v.z;
        if (slot === SOLID) {
          proto.height = Math.max(proto.height, v.y);
          if (v.y < 1.6) {
            proto.minX = Math.min(proto.minX, v.x);
            proto.maxX = Math.max(proto.maxX, v.x);
            proto.minZ = Math.min(proto.minZ, v.z);
            proto.maxZ = Math.max(proto.maxZ, v.z);
          }
        }
        if (Na) {
          v.fromBufferAttribute(Na, i).applyMatrix3(nrm).normalize();
          part.nor[i * 3] = v.x;
          part.nor[i * 3 + 1] = v.y;
          part.nor[i * 3 + 2] = v.z;
        } else part.nor[i * 3 + 1] = 1;
        part.uv[i * 2] = Ua ? Ua.getX(i) : 0;
        part.uv[i * 2 + 1] = Ua ? Ua.getY(i) : 0;
        // glTF colours are linear; the atlas is sRGB and the shade was painted as a plain factor
        part.col[i * 3] = Ca ? Ca.getX(i) : 1;
        part.col[i * 3 + 1] = Ca ? Ca.getY(i) : 1;
        part.col[i * 3 + 2] = Ca ? Ca.getZ(i) : 1;
      }
      proto.parts.push(part);
      proto.tris += n / 3;
    });
    if (!proto.parts.length) continue;
    if (!Number.isFinite(proto.minX)) {
      // a decal: its footprint is its own extent
      for (const p of proto.parts)
        for (let i = 0; i < p.pos.length; i += 3) {
          proto.minX = Math.min(proto.minX, p.pos[i]);
          proto.maxX = Math.max(proto.maxX, p.pos[i]);
          proto.minZ = Math.min(proto.minZ, p.pos[i + 2]);
          proto.maxZ = Math.max(proto.maxZ, p.pos[i + 2]);
        }
    }
    protos.set(node.name, proto);
  }
  if (!solidMap || !decalMap) throw new Error("quaygoods.glb: textures missing");
  for (const t of [solidMap as THREE.Texture, decalMap as THREE.Texture]) {
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
  }
  return { protos, solidMap, decalMap };
}

let materials: { solid: THREE.Material; decal: THREE.Material } | null = null;
function mats(solidMap: THREE.Texture, decalMap: THREE.Texture): { solid: THREE.Material; decal: THREE.Material } {
  if (materials) return materials;
  const solid = psx(new THREE.MeshLambertMaterial({ map: solidMap, vertexColors: true }), { affine: 0 });
  const decal = psx(
    new THREE.MeshLambertMaterial({ map: decalMap, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }),
    { affine: 0, noSnap: true },
  );
  solid.name = "quaygoods_solid";
  decal.name = "quaygoods_decal";
  materials = { solid, decal };
  return materials;
}

/** Merge copies into one mesh per chunk and slot. */
function mergePuts(puts: Put[], protos: Map<string, Proto>, m: { solid: THREE.Material; decal: THREE.Material }, group: THREE.Group, chunk: number): { meshes: THREE.Mesh[]; triangles: number } {
  const buckets = new Map<string, { slot: number; n: number; items: Array<{ part: Part; m: THREE.Matrix4; shade: number }> }>();
  const p = new THREE.Vector3();
  for (const put of puts) {
    const proto = protos.get(put.name);
    if (!proto) continue;
    p.setFromMatrixPosition(put.m);
    const ck = `${Math.floor(p.x / chunk)},${Math.floor(p.z / chunk)}`;
    for (const part of proto.parts) {
      const k = `${ck}|${part.slot}`;
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { slot: part.slot, n: 0, items: [] }));
      b.items.push({ part, m: put.m, shade: put.shade });
      b.n += part.pos.length / 3;
    }
  }
  const meshes: THREE.Mesh[] = [];
  let triangles = 0;
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix3();
  for (const b of buckets.values()) {
    const pos = new Float32Array(b.n * 3);
    const nor = new Float32Array(b.n * 3);
    const uv = new Float32Array(b.n * 2);
    const col = new Float32Array(b.n * 3);
    let o = 0;
    for (const { part, m: M, shade } of b.items) {
      nm.getNormalMatrix(M);
      const k = part.pos.length / 3;
      for (let i = 0; i < k; i++) {
        v.set(part.pos[i * 3], part.pos[i * 3 + 1], part.pos[i * 3 + 2]).applyMatrix4(M);
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
    const mesh = new THREE.Mesh(g, b.slot === DECAL ? m.decal : m.solid);
    mesh.name = b.slot === DECAL ? "quaygoods_decals" : "quaygoods";
    if (b.slot === DECAL) mesh.renderOrder = 2;
    group.add(mesh);
    meshes.push(mesh);
    triangles += b.n / 3;
  }
  return { meshes, triangles };
}

/** Before each render: hide the chunks beyond the fog (chained onto the scene's own hook). */
function hideBeyondFog(scene: THREE.Scene, chunks: THREE.Mesh[]): void {
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
}

// ------------------------------------------------------------------ the quay zone

interface CityData {
  doors: Record<string, { x: number; z: number; out: [number, number]; width: number }>;
  bridges: Record<string, number[]>;
  quays: number[][];
  landmarks: Record<string, { fp?: number[][] }>;
  ground?: { quay?: number[][] };
  decor?: TrackData & { crane_rails?: number[][]; lamps?: Array<[number, number]>; rails?: number[][] };
}
const CITYD = CITY as unknown as CityData;

/** Is (x, z) on the quay ground (city.json ground.quay triangles)? Triangles in 16 m buckets. */
function quayZone(): (x: number, z: number) => boolean {
  const tris = CITYD.ground?.quay ?? [];
  const b = new Map<number, number[][]>();
  for (const t of tris) {
    const xs = [t[0], t[2], t[4]];
    const zs = [t[1], t[3], t[5]];
    for (let i = Math.floor(Math.min(...xs) / 16); i <= Math.floor(Math.max(...xs) / 16); i++)
      for (let j = Math.floor(Math.min(...zs) / 16); j <= Math.floor(Math.max(...zs) / 16); j++) {
        const k = (i + 256) * 512 + (j + 256);
        let l = b.get(k);
        if (!l) b.set(k, (l = []));
        l.push(t);
      }
  }
  return (x, z) => {
    for (const t of b.get((Math.floor(x / 16) + 256) * 512 + (Math.floor(z / 16) + 256)) ?? []) {
      const [ax, az, bx, bz, cx, cz] = t;
      const d1 = (x - bx) * (az - bz) - (ax - bx) * (z - bz);
      const d2 = (x - cx) * (bz - cz) - (bx - cx) * (z - cz);
      const d3 = (x - ax) * (cz - az) - (cx - ax) * (z - az);
      const neg = d1 < 0 || d2 < 0 || d3 < 0;
      const pos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(neg && pos)) return true;
    }
    return false;
  };
}

// ------------------------------------------------------------------ building

let last: { result: QuayGoods; debug: Debug } | null = null;
interface Debug {
  flags: Flags;
  keep: Rect[];
  avoid: Rect[];
  clear: Array<{ x: number; z: number; r: number }>;
  heaps: Heap[];
  onQuay: (x: number, z: number) => boolean;
  /** Dev: why heap `kind` would not stand there (null: it would). */
  why: (kind: string, x: number, z: number, yaw: number, mode: "open" | "wall" | "edge") => string | null;
}
/** A heap as placed: its frame, and its copies and colliders (ranges in the lists), for pruning. */
interface Heap {
  x: number;
  z: number;
  yaw: number;
  hl: number;
  hs: number;
  ox: number;
  oz: number;
  p0: number;
  p1: number;
  c0: number;
  c1: number;
  gone: boolean;
}
/** What pruning needs to rebuild the merged meshes. */
interface Live {
  scene: THREE.Scene;
  protos: Map<string, Proto>;
  mats: { solid: THREE.Material; decal: THREE.Material };
  group: THREE.Group;
  chunks: THREE.Mesh[];
  puts: Put[];
  /** Where the debris starts in `puts` (it is kept when a heap is taken away). */
  debrisStart: number;
}
let live: Live | null = null;

/**
 * The goods on the working quays. Call after the city (the walk map), the props, the quay furniture,
 * the litter and the clutter are in (their colliders in `avoid`). Resolves when it is in the scene.
 */
export async function createQuayGoods(scene: THREE.Scene, flags: Flags, opts: QuayGoodsOptions = {}): Promise<QuayGoods> {
  const [{ protos, solidMap, decalMap }, props] = await Promise.all([loadModels(), loadProps()]);
  for (let i = 0; i < 600 && flags(0, 0) === undefined; i++) await sleep(100);
  const r = rng(opts.seed ?? 1873);
  const at = (x: number, z: number) => flags(x, z) ?? 4;
  const onQuay = quayZone();

  // ---------------------------------------------------------------- keep-outs
  const decor = CITYD.decor ?? {};
  const keep: Rect[] = [...(opts.keepOut ?? []), ...trackKeepOut(decor)];
  for (const [x0, z0, x1, z1] of decor.crane_rails ?? []) {
    keep.push({ minX: Math.min(x0, x1) - 2.0, maxX: Math.max(x0, x1) + 2.0, minZ: Math.min(z0, z1) - 2.0, maxZ: Math.max(z0, z1) + 2.0 });
  }
  // the railings along the quay edge (city decor rails): 1 m clear of them
  for (const [x0, z0, x1, z1] of decor.rails ?? []) keep.push({ minX: Math.min(x0, x1) - 1, maxX: Math.max(x0, x1) + 1, minZ: Math.min(z0, z1) - 1, maxZ: Math.max(z0, z1) + 1 });
  for (const l of trafficLanes()) for (let i = 0; i < l.x.length; i += 4) keep.push({ minX: l.x[i] - l.half, maxX: l.x[i] + l.half, minZ: l.z[i] - l.half, maxZ: l.z[i] + l.half });
  for (const b of Object.values(CITYD.bridges)) {
    keep.push({ minX: Math.min(b[0], b[2]) - 5, maxX: Math.max(b[0], b[2]) + 5, minZ: Math.min(b[1], b[3]) - 5, maxZ: Math.max(b[1], b[3]) + 5 });
  }
  // the lock and its bridge (world/lock.ts); the emigrants' camp (server town/emigrants.ts CAMPS, z 21-34)
  // and the way the families come in; the brig's gangway (rijnkaai.ts RAMP) and the berth in front
  keep.push({ minX: 98, maxX: 122, minZ: -3, maxZ: 50 });
  keep.push({ minX: 12, maxX: 51, minZ: 18, maxZ: 38 });
  keep.push({ minX: -50, maxX: -34, minZ: -1, maxZ: 12 });
  const clear: Array<{ x: number; z: number; r: number }> = [...(opts.keepClear ?? [])];
  for (const d of Object.values(CITYD.doors)) clear.push({ x: d.x + d.out[0] * 2, z: d.z + d.out[1] * 2, r: Math.min(d.width / 2, 6) + 3 });
  for (const [k, s] of Object.entries(SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>)) {
    if (!k.startsWith("_") && s.x !== undefined && s.z !== undefined) clear.push({ x: s.x, z: s.z, r: 5.5 });
  }
  {
    // the hiring board by the Hessenatie door (rijnkaai.ts BOARD_POS)
    const h = CITYD.doors.hessenatie;
    if (h) clear.push({ x: h.x + h.out[0] * 3.2 - h.out[1] * 5, z: h.z + h.out[1] * 3.2 + h.out[0] * 5, r: 4 });
  }
  for (const d of LANDMARK_DOORS) clear.push({ x: d.step[0], z: d.step[1], r: 5 });
  // where the town gathers (server/src/town/places.ts): the Hessenatie's gate where the naties hire,
  // the taverns' doors, the shops on the quays
  for (const [x, z, rr] of TOWN_PLACES) clear.push({ x, z, r: rr });
  for (const [x, z, rr] of TOWN_CLEAR) clear.push({ x, z, r: rr + 1.5 });
  const quay = opts.quayInfo?.() ?? { flights: [], ladders: [] };
  for (const f of quay.flights) {
    clear.push({ x: f.top[0], z: f.top[1], r: 5 });
    clear.push({ x: (f.top[0] + f.end[0]) / 2, z: (f.top[1] + f.end[1]) / 2, r: 4 });
  }
  for (const l of quay.ladders) clear.push({ x: l.x, z: l.z, r: 2.5 });
  // the lamps, and the lamplighter's stand at each (M6 town life)
  for (const [x, z] of decor.lamps ?? []) clear.push({ x, z, r: 2.4 });
  // house doors (props.glb) and the storehouses' loading gates (2.6 m wide) with the ground before them
  for (let i = 0; i + 1 < props.houseDoors.length; i += 2) clear.push({ x: props.houseDoors[i], z: props.houseDoors[i + 1], r: 3.0 });
  // (a loading gate is 2.6 m wide, 3.4 m with its arch: the ground 2.4 m either side of its middle and 5 m out stays open)
  for (const fr of props.storeFronts) {
    const [ax, az, bx, bz, ox, oz, ...gates] = fr;
    const L = Math.hypot(bx - ax, bz - az) || 1;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
    for (const g of gates) {
      const x = ax + tx * g;
      const z = az + tz * g;
      const xs = [x - tx * 2.4, x + tx * 2.4, x - tx * 2.4 + ox * 5, x + tx * 2.4 + ox * 5];
      const zs = [z - tz * 2.4, z + tz * 2.4, z - tz * 2.4 + oz * 5, z + tz * 2.4 + oz * 5];
      keep.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
    }
  }
  // the landmarks' fronts (the Hanseatic House's arched gates, the Steen): nothing against them, 3.5 m
  for (const lm of Object.values(CITYD.landmarks)) {
    const fp = lm.fp ?? [];
    for (let i = 0; i < fp.length; i++) {
      const [ax, az] = fp[i];
      const [bx, bz] = fp[(i + 1) % fp.length];
      if (Math.hypot(bx - ax, bz - az) < 0.5) continue;
      keep.push({ minX: Math.min(ax, bx) - 3.5, maxX: Math.max(ax, bx) + 3.5, minZ: Math.min(az, bz) - 3.5, maxZ: Math.max(az, bz) + 3.5 });
    }
  }
  for (const f of opts.shops ?? []) {
    const xs: number[] = [];
    const zs: number[] = [];
    for (const a of [f.door - 4, f.door + 4])
      for (const o of [0, 2.4]) {
        xs.push(f.ax + f.tx * a + f.ox * o);
        zs.push(f.az + f.tz * a + f.oz * o);
      }
    keep.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  }
  const keepIdx = new RectIndex(keep);
  const avoid = opts.avoid ?? [];
  const avoidIdx = new RectIndex(avoid);
  // circles in 16 m buckets
  const clearB = new Map<number, Array<{ x: number; z: number; r: number }>>();
  for (const c of clear) {
    for (let i = Math.floor((c.x - c.r) / 16); i <= Math.floor((c.x + c.r) / 16); i++)
      for (let j = Math.floor((c.z - c.r) / 16); j <= Math.floor((c.z + c.r) / 16); j++) {
        const k = (i + 256) * 512 + (j + 256);
        let l = clearB.get(k);
        if (!l) clearB.set(k, (l = []));
        l.push(c);
      }
  }
  const inClear = (x: number, z: number) => {
    for (const c of clearB.get((Math.floor(x / 16) + 256) * 512 + (Math.floor(z / 16) + 256)) ?? []) if (Math.hypot(c.x - x, c.z - z) < c.r) return true;
    return false;
  };

  // ---------------------------------------------------------------- the heaps' frames
  interface Frame {
    /** Bounds in the heap's frame (items, not decals). */
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
  }
  const frames = new Map<string, Frame>();
  const corners = (p: Proto, x: number, z: number, yaw: number): Array<[number, number]> => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    return [
      [p.minX, p.minZ],
      [p.maxX, p.minZ],
      [p.maxX, p.maxZ],
      [p.minX, p.maxZ],
    ].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c]);
  };
  for (const [k, vg] of Object.entries(V)) {
    const f: Frame = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
    for (const [name, x, z, yaw] of vg.items) {
      const p = protos.get(name);
      if (!p) throw new Error(`quaygoods: no model ${name}`);
      for (const [cx, cz] of corners(p, x, z, yaw)) {
        f.minX = Math.min(f.minX, cx);
        f.maxX = Math.max(f.maxX, cx);
        f.minZ = Math.min(f.minZ, cz);
        f.maxZ = Math.max(f.maxZ, cz);
      }
    }
    frames.set(k, f);
  }
  /** Heaps that may be laid mirrored: no model in them stands off its own origin by more than 0.25 m. */
  const mirrorable = new Set(
    Object.entries(V)
      .filter(([, vg]) => vg.items.every(([name]) => {
        const p = protos.get(name)!;
        return Math.abs((p.minX + p.maxX) / 2) < 0.25 && Math.abs((p.minZ + p.maxZ) / 2) < 0.25;
      }))
      .map(([k]) => k),
  );

  // ---------------------------------------------------------------- occupancy (0.5 m cells): 1 a heap, 2 its passage
  const occ = new Map<number, number>();
  const key = (i: number, j: number) => (i + 8192) * 16384 + (j + 8192);

  /** The wall or water edge nearest to a point, as a fitted line (props3d edgeNear). */
  function edgeNear(px: number, pz: number, want: number, reach: number): { x: number; z: number; nx: number; nz: number; d: number } | null {
    const N = 48;
    const hits: Array<[number, number, number, number]> = [];
    let best = -1;
    for (let k = 0; k < N; k++) {
      const a = (k / N) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      for (let s = 0.25; s <= reach; s += 0.25) {
        const f = at(px + dx * s, pz + dz * s);
        if (f === OPEN) continue;
        if (f > 0 && f & want && !(want === WALLF && f & WATER)) {
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
      return da < 0.9 && s < d0 * 1.6 + 0.8;
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

  const rej: Record<string, number> = {};
  let phase = "";
  const no = (why: string) => {
    rej[phase + why] = (rej[phase + why] ?? 0) + 1;
    return false;
  };

  /**
   * Can heap `kind` stand with its frame centre at (cx, cz), turned `yaw` (its +z = (sin, cos))?
   * wall: its back stands against a wall (no passage checked behind it). edge: its back is to the
   * water, EDGE_GAP from it (the edge strip behind it stays free, no passage asked there). Marks the
   * ground if so.
   */
  function fits(kind: string, cx: number, cz: number, yaw: number, wall: boolean, commit: boolean, edge = false): boolean {
    const f = frames.get(kind)!;
    const hl = (f.maxX - f.minX) / 2;
    const hs = (f.maxZ - f.minZ) / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    // local axes in the world: x -> (c, -s), z -> (s, c)
    const P = edge ? EDGE_PASSAGE : wall ? PASSAGE : OPEN_PASSAGE;
    const R = hl + P;
    const Rz = hs + P;
    const ex = Math.abs(c) * R + Math.abs(s) * Rz;
    const ez = Math.abs(s) * R + Math.abs(c) * Rz;
    const i0 = Math.floor((cx - ex) / 0.5);
    const i1 = Math.ceil((cx + ex) / 0.5);
    const j0 = Math.floor((cz - ez) / 0.5);
    const j1 = Math.ceil((cz + ez) / 0.5);
    for (let pass = 0; pass < 2; pass++) {
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const x = i * 0.5 + 0.25;
          const z = j * 0.5 + 0.25;
          const dx = x - cx;
          const dz = z - cz;
          const a = dx * c - dz * s; // local x
          const b = dx * s + dz * c; // local z
          const da = Math.max(0, Math.abs(a) - hl);
          const db = Math.max(0, Math.abs(b) - hs);
          const d = Math.hypot(da, db);
          if (d > P) continue;
          const k = key(i, j);
          // beside or behind a wall-backed heap (not in front of it): another heap on the same
          // wall may stand here, its passage is the one in front of both
          const side = (wall || edge) && b < hs - 0.1;
          if (pass === 1) {
            // commit: the heap's cells (1), the walk in front of a row at a wall or the water (2), its
            // sides along the wall or the edge (3), the ground round a heap out on the quay (4)
            const o = occ.get(k);
            if (d <= 0.15) occ.set(k, 1);
            else if (side) {
              if (o === undefined || o === 4) occ.set(k, 3);
            } else if (wall || edge) {
              if (o === undefined || o === 3 || o === 4) occ.set(k, 2);
            } else if (o === undefined) occ.set(k, 4);
            continue;
          }
          const fl = at(x, z);
          if (d <= 0.15) {
            // under the heap
            if (fl !== OPEN) return no("ground");
            const o = occ.get(k);
            // (beside a row: another row; round an open heap: another open heap, kept OPEN_NEAR off below)
            if (o !== undefined && !(o === 3 && (wall || edge)) && !(o === 4 && !wall && !edge)) return no("taken");
            if (keepIdx.at(x, z)) return no("keep-out");
            if (avoidIdx.at(x, z, 0.1)) return no("collider");
            if (inClear(x, z)) return no("keep-clear");
            continue;
          }
          // the passage round it
          if (fl & 4 || fl === undefined) return no("off the map");
          if (fl & WATER) {
            if (d < (edge ? EDGE_GAP - EDGE_CELL : WATER_GAP)) return no("water");
            continue;
          }
          if (edge && b < -hs) {
            // the edge strip behind a row at the water: free ground, nothing asked of it
            if (fl & WALLF) return no("wall near");
            continue;
          }
          if (fl & WALLF) {
            if (side) continue;
            return no("wall near");
          }
          if (wall && b < -hs) continue;
          if (occ.get(k) === 1 && !(side && d >= 0.4) && !(!wall && !edge && d >= OPEN_NEAR)) return no("passage taken");
          if (!side && avoidIdx.at(x, z, 0, edge ? 3.0 : 1.0)) return no("passage blocked");
        }
      if (!commit) return true;
    }
    return true;
  }

  // ---------------------------------------------------------------- placing
  const puts: Put[] = [];
  const colliders: Rect[] = [];
  const placed: QuayGoods["placed"] = [];
  const byQuay: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const models: Record<string, number> = {};
  const heaps: Debug["heaps"] = [];
  const Q = new THREE.Quaternion();
  const Y = new THREE.Vector3(0, 1, 0);

  const put = (name: string, x: number, z: number, yaw: number, shade: number, y = 0) => {
    Q.setFromAxisAngle(Y, yaw);
    puts.push({ name, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), Q, new THREE.Vector3(1, 1, 1)), shade });
    models[name] = (models[name] ?? 0) + 1;
  };
  /** Walk colliders for a model at (x, z, yaw): boxes along its long side (props3d colliders). */
  const collide = (name: string, x: number, z: number, yaw: number, y = 0) => {
    const f = protos.get(name)!;
    const w = f.maxX - f.minX;
    const d = f.maxZ - f.minZ;
    if (w * d < 0.06 || f.height < 0.12) return;
    const along = d >= w;
    const long = along ? d : w;
    const short = along ? w : d;
    const n = Math.max(1, Math.round(long / Math.max(short, 0.6)));
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const lx = along ? (f.minX + f.maxX) / 2 : f.minX + w * t;
      const lz = along ? f.minZ + d * t : (f.minZ + f.maxZ) / 2;
      const hx = along ? w / 2 : w / n / 2;
      const hz = along ? d / n / 2 : d / 2;
      const wx = x + lx * c + lz * s;
      const wz = z - lx * s + lz * c;
      const ex = hx * Math.abs(c) + hz * Math.abs(s);
      const ez = hx * Math.abs(s) + hz * Math.abs(c);
      colliders.push({ minX: wx - ex, maxX: wx + ex, minZ: wz - ez, maxZ: wz + ez, top: f.height + y });
    }
  };

  /** Put heap `kind` down: frame centre (cx, cz), yaw; mirrored along its x if `flip`. */
  function lay(kind: string, area: string, cx: number, cz: number, yaw: number, flip: boolean, wall: boolean): void {
    const vg = V[kind];
    // mirroring moves the things, not the models: only where every model sits on its own middle
    if (!mirrorable.has(kind)) flip = false;
    const p0 = puts.length;
    const c0 = colliders.length;
    const f = frames.get(kind)!;
    const ox = (f.minX + f.maxX) / 2;
    const oz = (f.minZ + f.maxZ) / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const toWorld = (lx: number, lz: number): [number, number] => {
      const ax = (lx - ox) * (flip ? -1 : 1);
      const az = lz - oz;
      return [cx + ax * c + az * s, cz - ax * s + az * c];
    };
    for (const [name, lx, lz, lyaw, opt, ly] of vg.items) {
      if (opt !== undefined && r() < opt) continue;
      const [x, z] = toWorld(lx + (r() - 0.5) * 0.06, lz + (r() - 0.5) * 0.06);
      const wy = yaw + (flip ? -lyaw : lyaw) + (r() - 0.5) * 0.08;
      put(name, x, z, wy, 0.9 + r() * 0.16, ly ?? 0);
      collide(name, x, z, wy, ly ?? 0);
    }
    for (const [name, lx, lz, lyaw] of vg.ground) {
      if (r() < 0.2) continue;
      const [x, z] = toWorld(lx, lz);
      if (at(x, z) !== OPEN) continue;
      put(name, x, z, yaw + lyaw + (r() - 0.5) * 0.6, 0.85 + r() * 0.25, 0.012);
    }
    const hl = (f.maxX - f.minX) / 2;
    const hs = (f.maxZ - f.minZ) / 2;
    placed.push({ kind, quay: area, x: +cx.toFixed(2), z: +cz.toFixed(2), yaw: +yaw.toFixed(3), w: +(2 * hl).toFixed(1), d: +(2 * hs).toFixed(1), wall });
    heaps.push({ x: cx, z: cz, yaw, hl, hs, ox, oz, p0, p1: puts.length, c0, c1: colliders.length, gone: false });
    byQuay[area] = (byQuay[area] ?? 0) + 1;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  }

  // rows along the water edge of the busy quays (city.json quays): backs to the water, EDGE_GAP back
  // from it, 3 m or more between rows so the edge stays reachable for the boats' lines
  const edgeCount: Record<string, number> = {};
  phase = "edge: ";
  for (const [ax, az, bx, bz] of CITYD.quays) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 4) continue;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
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
    if (!land(1)) continue;
    let s = 0.8 + r() * 3;
    let run = 0;
    let runMax = 10 + r() * 6;
    while (s < L - 1) {
      const px = ax + tx * s;
      const pz = az + tz * s;
      const area = AREAS.find((a) => a.edgeMix && inR(a.rect, px + nx * 3, pz + nz * 3));
      if (!area || (edgeCount[area.id] ?? 0) >= (area.edgeMax ?? 0)) {
        s += 1;
        continue;
      }
      // a long row first; where it does not fit (a bollard, a cart, a berth), a short one
      const long = area.edgeMix!.filter(([k]) => !k.startsWith("edge_short"));
      const short = area.edgeMix!.filter(([k]) => k.startsWith("edge_short"));
      let done = false;
      for (const from of [long, short]) {
        if (done || !from.length) continue;
        const kind = pick(r, from);
        const f = frames.get(kind)!;
        const hl = (f.maxX - f.minX) / 2;
        const hs = (f.maxZ - f.minZ) / 2;
        if (s + 2 * hl > L - 0.5) continue;
        const cx = ax + tx * (s + hl) + nx * (EDGE_GAP + hs);
        const cz = az + tz * (s + hl) + nz * (EDGE_GAP + hs);
        const yaw = Math.atan2(nx, nz) + (r() - 0.5) * 0.08;
        if (!fits(kind, cx, cz, yaw, false, false, true)) continue;
        fits(kind, cx, cz, yaw, false, true, true);
        lay(kind, area.id, cx, cz, yaw, r() < 0.5, false);
        edgeCount[area.id] = (edgeCount[area.id] ?? 0) + 1;
        run += 2 * hl;
        if (run > runMax) {
          // a way through to the edge
          s += 2 * hl + 2.6 + r() * 1.5;
          run = 0;
          runMax = 10 + r() * 6;
        } else s += 2 * hl + 0.35 + r() * 0.5;
        done = true;
      }
      if (!done) {
        s += 0.5;
        run = 0;
      }
    }
  }

  phase = "wall: ";
  // along the storehouse fronts (props.glb): heaps with their backs to the wall between the loading
  // gates, side by side where there is room, the passage in front of them
  const wallCount: Record<string, number> = {};
  for (const fr of props.storeFronts) {
    const [ax, az, bx, bz, ox, oz] = fr;
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 3) continue;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
    let s = 0.6 + r() * 1.5;
    let prev = "";
    while (s < L - 0.6) {
      const area = AREAS.find((a) => inR(a.rect, ax + tx * s + ox * 2, az + tz * s + oz * 2));
      const kinds = area ? area.mix.filter(([k]) => V[k].wall) : [];
      if (!area || !kinds.length || (wallCount[area.id] ?? 0) >= area.wallMax) {
        s += 1;
        continue;
      }
      // not the same heap twice in a row along a front; a big one first, a small one if it does not fit
      const big = kinds.filter(([k]) => !FILLERS.has(k));
      const small = kinds.filter(([k]) => FILLERS.has(k));
      let done = false;
      for (const from of [big, small]) {
        if (!from.length || done) continue;
        let kind = pick(r, from);
        for (let k = 0; k < 3 && kind === prev && from.length > 1; k++) kind = pick(r, from);
        const f = frames.get(kind)!;
        const hl = (f.maxX - f.minX) / 2;
        const hs = (f.maxZ - f.minZ) / 2;
        if (s + 2 * hl > L - 0.6) continue;
        const cx = ax + tx * (s + hl) + ox * (WALL_GAP + hs);
        const cz = az + tz * (s + hl) + oz * (WALL_GAP + hs);
        const yaw = Math.atan2(ox, oz) + (r() - 0.5) * 0.04;
        if (!fits(kind, cx, cz, yaw, true, false)) continue;
        fits(kind, cx, cz, yaw, true, true);
        lay(kind, area.id, cx, cz, yaw, r() < 0.5, true);
        wallCount[area.id] = (wallCount[area.id] ?? 0) + 1;
        prev = kind;
        s += 2 * hl + 0.3 + r() * 0.5;
        done = true;
      }
      if (!done) s += 0.7;
    }
  }

  phase = "";
  for (const area of AREAS) {
    // candidates: open ground in the area, every 1.5 m, in a seeded order
    const cand: Array<[number, number, number]> = [];
    for (let x = area.rect.minX + 0.5; x < area.rect.maxX; x += 1.0)
      for (let z = area.rect.minZ + 0.5; z < area.rect.maxZ; z += 1.0) {
        if (at(x, z) !== OPEN || keepIdx.at(x, z) || inClear(x, z)) continue;
        cand.push([x, z, r()]);
      }
    cand.sort((a, b) => a[2] - b[2]);
    let n = 0;
    let nOpen = 0;
    // the rope walk at most once a quay: it wants a long open stretch, so it gets the first try
    let ropewalks = 0;
    const mixAll = [...area.mix, ...(area.openMix ?? [])];
    if (mixAll.some(([k]) => k === "ropewalk")) {
      for (const [px, pz] of cand) {
        if (area.openRect && !inR(area.openRect, px, pz)) continue;
        const wallE = edgeNear(px, pz, WALLF, 5);
        if (wallE && wallE.d < 4.5) continue;
        const waterE = edgeNear(px, pz, WATER, 16);
        const base = waterE ? Math.atan2(waterE.nx, waterE.nz) : 0;
        let done = false;
        for (const turn of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
          const yaw = base + turn + (r() - 0.5) * 0.1;
          if (!fits("ropewalk", px, pz, yaw, false, false)) continue;
          fits("ropewalk", px, pz, yaw, false, true);
          lay("ropewalk", area.id, px, pz, yaw, false, false);
          ropewalks++;
          n++;
          nOpen++;
          done = true;
          break;
        }
        if (done) break;
      }
    }
    for (const [px, pz] of cand) {
      if (n >= area.max) break;
      const wallE = edgeNear(px, pz, WALLF, 5);
      const nearWall = !!wallE && wallE.d < 4.5;
      if (!nearWall && area.openRect && !inR(area.openRect, px, pz)) continue;
      if (!nearWall && nOpen >= (area.openMax ?? area.max)) continue;
      const waterE = nearWall ? null : edgeNear(px, pz, WATER, 16);
      // three tries at a big heap that fits here, then one at a small filler
      const mix = !nearWall && area.openMix ? area.openMix : area.mix;
      const big = mix.filter(([k]) => !FILLERS.has(k));
      const small = mix.filter(([k]) => FILLERS.has(k));
      for (let tries = 0; tries < 4; tries++) {
        const from = tries < 3 || !small.length ? big : small;
        if (!from.length) continue;
        const kind = pick(r, from);
        const vg = V[kind];
        if (kind === "ropewalk" && ropewalks > 0) continue;
        const f = frames.get(kind)!;
        const hs = (f.maxZ - f.minZ) / 2;
        const flip = r() < 0.5;
        let cx = px;
        let cz = pz;
        let yaw: number;
        let wall = false;
        if (nearWall && vg.wall) {
          // back to the wall, its front out
          yaw = Math.atan2(wallE!.nx, wallE!.nz) + (r() - 0.5) * 0.04;
          // (a wall from the walk map: its plinth may stand proud of the map's line, so a little more room)
          cx = wallE!.x + wallE!.nx * (WALL_GAP + 0.25 + hs);
          cz = wallE!.z + wallE!.nz * (WALL_GAP + 0.25 + hs);
          wall = true;
        } else if (!nearWall && vg.open) {
          // out on the quay: its long side along the water, askew
          if (waterE) yaw = Math.atan2(waterE.nx, waterE.nz) + (r() < 0.5 ? Math.PI : 0) + (r() - 0.5) * 0.22;
          else yaw = (Math.floor(r() * 4) * Math.PI) / 2 + (r() - 0.5) * 0.22;
        } else continue;
        if (!fits(kind, cx, cz, yaw, wall, false)) continue;
        fits(kind, cx, cz, yaw, wall, true);
        lay(kind, area.id, cx, cz, yaw, flip, wall);
        if (kind === "ropewalk") ropewalks++;
        n++;
        if (!wall) nOpen++;
        break;
      }
    }
    byQuay[area.id] ??= 0;
  }

  // ---------------------------------------------------------------- debris (pass 3)
  // Steve 2026-09-26: "a misty, darker, grimy atmosphere, a bit dangerous at all times. So rust, soot,
  // clutter, dirt". Round every heap: torn slats, a rope end, rotten straw, spilt grain or coffee, oil
  // and tar, now and then a rusty bucket, a stove-in cask, a dead rat. Along the quays: muck, tar and
  // straw on the setts. By the fish market: fish crates. Things you could trip over keep off the lanes,
  // the rails and every place kept clear; only a bucket and a broken cask are solid, and those stand
  // close by a heap (never out in its passage).
  phase = "debris: ";
  const debrisStart = puts.length;
  const debris = { objects: 0, decals: 0 };
  const onGround = (x: number, z: number, solid: boolean, pad: number) => {
    if (at(x, z) !== OPEN) return false;
    if (keepIdx.at(x, z, pad) || inClear(x, z)) return false;
    if (avoidIdx.at(x, z, pad)) return false;
    const o = occ.get(key(Math.floor(x / 0.5), Math.floor(z / 0.5)));
    if (o === 1) return false;
    if (solid && o === 2) return false; // (not in the walk in front of a row)
    return true;
  };
  const drop = (name: string, x: number, z: number, yaw: number, solid: boolean) => {
    const isDecal = name.startsWith("d_");
    put(name, x, z, yaw, 0.8 + r() * 0.25, isDecal ? 0.012 : 0);
    if (solid) collide(name, x, z, yaw);
    if (isDecal) debris.decals++;
    else debris.objects++;
  };
  const NEAR: Array<[string, number]> = [
    ["d_straw_rot", 3], ["d_muck", 2], ["d_tar", 1], ["d_oil", 1.2], ["d_dirt", 1.5], ["slats_broken", 2], ["rope_end", 1.6],
    ["rat_dead", 0.35], ["bucket_rusty", 0.7], ["barrel_broken", 0.45],
  ];
  const SOLID_DEBRIS = new Set(["bucket_rusty", "barrel_broken"]);
  for (const h of heaps) {
    const n = 2 + Math.floor(r() * 3);
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    for (let k = 0; k < n; k++) {
      const name = pick(r, NEAR);
      const solid = SOLID_DEBRIS.has(name);
      // round the heap: mostly in front (+z of its frame), sometimes at its ends
      for (let t = 0; t < 4; t++) {
        const front = r() < 0.7;
        const out = (solid ? 0.35 : 0.3) + r() * (solid ? 0.45 : 1.3);
        const a = front ? (r() - 0.5) * 2 * h.hl : (r() < 0.5 ? -1 : 1) * (h.hl + out);
        const b = front ? h.hs + out : (r() - 0.5) * 2 * h.hs;
        const x = h.x + a * c + b * s;
        const z = h.z - a * s + b * c;
        const isDecal = name.startsWith("d_");
        if (isDecal ? at(x, z) !== OPEN || occ.get(key(Math.floor(x / 0.5), Math.floor(z / 0.5))) === 1 : !onGround(x, z, solid, solid ? 0.5 : 0.2)) continue;
        drop(name, x, z, r() * Math.PI * 2, solid);
        break;
      }
    }
  }
  // along the working quays: dirt on the setts, and bits dropped
  const ALONG_DECALS: Array<[string, number]> = [["d_muck", 2], ["d_tar", 1.2], ["d_oil", 1.5], ["d_straw_rot", 2], ["d_dirt", 2.5], ["d_grain", 0.5]];
  const ALONG_BITS: Array<[string, number]> = [["slats_broken", 2], ["rope_end", 2], ["rat_dead", 0.5]];
  for (const area of AREAS) {
    for (let x = area.rect.minX + 1; x < area.rect.maxX; x += 3.5)
      for (let z = area.rect.minZ + 1; z < area.rect.maxZ; z += 3.5) {
        const px = x + (r() - 0.5) * 3;
        const pz = z + (r() - 0.5) * 3;
        if (!onQuay(px, pz) || at(px, pz) !== OPEN) continue;
        const u = r();
        if (u < 0.22) {
          if (occ.get(key(Math.floor(px / 0.5), Math.floor(pz / 0.5))) === 1) continue;
          drop(pick(r, ALONG_DECALS), px, pz, r() * Math.PI * 2, false);
        } else if (u < 0.27 && onGround(px, pz, false, 0.3)) {
          drop(pick(r, ALONG_BITS), px, pz, r() * Math.PI * 2, false);
        }
      }
  }
  // fish crates by the fish market, along its quay, off the stalls and the steps
  {
    let n = 0;
    const spots: Array<[number, number]> = [];
    for (let x = -136; x < -96 && n < 6; x += 1.5) {
      const z = 2.2 + r() * 1.5;
      if (spots.some(([sx, sz]) => Math.hypot(sx - x, sz - z) < 5)) continue;
      let ok = true;
      for (const [dx, dz] of [[-0.6, -0.4], [0.6, -0.4], [-0.6, 0.9], [1.2, 0.4], [0, 0]]) if (!onGround(x + dx, z + dz, true, 0.4)) ok = false;
      if (!ok) continue;
      const yaw = (r() - 0.5) * 0.4;
      drop("fish_crates", x, z, yaw, true);
      drop("d_muck", x + 0.5, z + 0.9, r() * 6, false);
      spots.push([x, z]);
      n++;
    }
    byQuay.vismarkt = n;
  }
  phase = "";

  // ---------------------------------------------------------------- into the scene
  const group = new THREE.Group();
  group.name = "quaygoods";
  const m = mats(solidMap, decalMap);
  const { meshes, triangles } = mergePuts(puts, protos, m, group, CHUNK);
  const chunks = [...meshes];
  hideBeyondFog(scene, chunks);
  scene.add(group);
  live = { scene, protos, mats: m, group, chunks, puts, debrisStart };

  const result: QuayGoods = {
    group,
    colliders,
    stats: { byQuay, byKind, models, meshes: meshes.length, triangles: Math.round(triangles), rej, debris },
    placed,
  };
  const why = (kind: string, x: number, z: number, yaw: number, mode: "open" | "wall" | "edge") => {
    const before = { ...rej };
    phase = "";
    const ok = fits(kind, x, z, yaw, mode === "wall", false, mode === "edge");
    if (ok) return null;
    for (const [k, v] of Object.entries(rej)) if (v !== (before[k] ?? 0)) return k;
    return "?";
  };
  last = { result, debug: { flags, keep, avoid, clear, heaps, onQuay, why } };
  return result;
}

// ------------------------------------------------------------------ keeping the town's places clear

/**
 * Take away every heap that comes within `margin` metres of one of `points` (the places a job, a
 * person or the player needs: the paths() check's list, main.ts), with its colliders, and merge the
 * rest again. Called once the town's places are in (they come from the server after the goods may
 * already stand). Returns how many heaps went.
 */
export function pruneQuayGoods(points: Array<{ x: number; z: number; reach?: number }>, margin = 2): number {
  if (!last || !live) return 0;
  const { heaps } = last.debug;
  let gone = 0;
  for (let h = 0; h < heaps.length; h++) {
    const hp = heaps[h];
    if (hp.gone) continue;
    const c = Math.cos(hp.yaw);
    const s = Math.sin(hp.yaw);
    const hit = points.some((q) => {
      const dx = q.x - hp.x;
      const dz = q.z - hp.z;
      if (Math.abs(dx) > hp.hl + hp.hs + margin + 1 || Math.abs(dz) > hp.hl + hp.hs + margin + 1) return false;
      const a = dx * c - dz * s;
      const b = dx * s + dz * c;
      return Math.hypot(Math.max(0, Math.abs(a) - hp.hl), Math.max(0, Math.abs(b) - hp.hs)) < margin;
    });
    if (!hit) continue;
    hp.gone = true;
    gone++;
    // its colliders out of the world (the world files them by reference: moved far off, they stop nothing)
    for (let i = hp.c0; i < hp.c1; i++) {
      const r = last.result.colliders[i];
      r.minX = r.maxX = 1e7;
      r.minZ = r.maxZ = 1e7;
    }
    const pl = last.result.placed[h];
    if (pl) {
      last.result.stats.byQuay[pl.quay]--;
      last.result.stats.byKind[pl.kind]--;
      pl.kind = `(gone) ${pl.kind}`;
    }
  }
  if (!gone) return 0;
  // merge the heaps that stay again
  const keep: Put[] = [];
  for (const hp of heaps) if (!hp.gone) for (let i = hp.p0; i < hp.p1; i++) keep.push(live.puts[i]);
  for (let i = live.debrisStart; i < live.puts.length; i++) keep.push(live.puts[i]);
  for (const m of live.chunks) {
    live.group.remove(m);
    m.geometry.dispose();
  }
  const { meshes, triangles } = mergePuts(keep, live.protos, live.mats, live.group, CHUNK);
  live.chunks.length = 0;
  live.chunks.push(...meshes);
  last.result.stats.meshes = meshes.length;
  last.result.stats.triangles = Math.round(triangles);
  return gone;
}

// ------------------------------------------------------------------ dev

/** Dev: the keep-out boxes over (x, z). */
export function quayGoodsKeepAt(x: number, z: number): Rect[] {
  return last ? last.debug.keep.filter((k) => inR(k, x, z)) : [];
}

/** Dev: why heap `kind` would not stand at (x, z) turned `yaw` (null: it would). */
export function quayGoodsWhy(kind: string, x: number, z: number, yaw: number, mode: "open" | "wall" | "edge" = "open"): string | null {
  return last ? last.debug.why(kind, x, z, yaw, mode) : "not built";
}

/** Dev: what was placed where (heaps per quay and kind, models, draw calls, triangles, rejections). */
export function quayGoodsInfo(): (Pick<QuayGoods, "stats" | "placed"> & { colliders: number }) | null {
  return last ? { stats: last.result.stats, placed: last.result.placed, colliders: last.result.colliders.length } : null;
}

/**
 * Dev: every model in a row on the ground from (x, z) along +x, for close pictures. Returns where
 * each stands. `remove()` takes the row away again.
 */
export async function quayGoodsShowroom(scene: THREE.Scene, x0: number, z0: number, names?: string[]): Promise<{ at: Array<[string, number, number]>; remove(): void }> {
  const { protos, solidMap, decalMap } = await loadModels();
  const list = names ?? [...protos.keys()];
  const puts: Put[] = [];
  const at: Array<[string, number, number]> = [];
  let x = x0;
  for (const n of list) {
    const p = protos.get(n);
    if (!p) continue;
    const px = x - p.minX;
    puts.push({ name: n, m: new THREE.Matrix4().makeTranslation(px, n.startsWith("d_") ? 0.012 : 0, z0), shade: 1 });
    at.push([n, +(px + (p.minX + p.maxX) / 2).toFixed(2), +(z0 + (p.minZ + p.maxZ) / 2).toFixed(2)]);
    x = px + p.maxX + 0.6;
  }
  const group = new THREE.Group();
  group.name = "quaygoods_showroom";
  mergePuts(puts, protos, mats(solidMap, decalMap), group, 1e6);
  scene.add(group);
  return {
    at,
    remove() {
      scene.remove(group);
      group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    },
  };
}

/**
 * Dev: a map of the goods and what they keep off, from (x0, z0) to (x1, z1) at `px` pixels a metre,
 * as a JPEG data URL: ground grey, walls dark, water blue, keep-outs orange, colliders red, keep-clear
 * circles yellow, the heaps green with their passage pale.
 */
export function quayGoodsMap(x0: number, z0: number, x1: number, z1: number, px = 4): string | null {
  if (!last) return null;
  const { flags, keep, avoid, clear, heaps, onQuay } = last.debug;
  const W = Math.ceil((x1 - x0) * px);
  const H = Math.ceil((z1 - z0) * px);
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const g = cv.getContext("2d")!;
  const img = g.createImageData(W, H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const x = x0 + (i + 0.5) / px;
      const z = z0 + (j + 0.5) / px;
      const f = flags(x, z) ?? 4;
      let c = [200, 200, 195];
      if (f & 4) c = [60, 60, 60];
      else if (f & WATER) c = [70, 110, 160];
      else if (f & WALLF) c = [90, 80, 75];
      else if (onQuay(x, z)) c = [215, 215, 225];
      else c = [185, 180, 165];
      const o = (j * W + i) * 4;
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const R = (r: Rect) => [(r.minX - x0) * px, (r.minZ - z0) * px, (r.maxX - r.minX) * px, (r.maxZ - r.minZ) * px] as const;
  g.fillStyle = "rgba(255,150,0,0.18)";
  for (const k of keep) g.fillRect(...R(k));
  g.fillStyle = "rgba(220,30,30,0.6)";
  for (const a of avoid) if (inR({ minX: x0, maxX: x1, minZ: z0, maxZ: z1 }, (a.minX + a.maxX) / 2, (a.minZ + a.maxZ) / 2, 5)) g.fillRect(...R(a));
  g.strokeStyle = "rgba(230,200,0,0.9)";
  for (const c of clear) {
    g.beginPath();
    g.arc((c.x - x0) * px, (c.z - z0) * px, c.r * px, 0, Math.PI * 2);
    g.stroke();
  }
  for (const h of heaps) {
    const c = Math.cos(h.yaw);
    const s = Math.sin(h.yaw);
    const poly = (hl: number, hs: number) => {
      g.beginPath();
      for (const [a, b] of [[-hl, -hs], [hl, -hs], [hl, hs], [-hl, hs]]) {
        const x = h.x + a * c + b * s;
        const z = h.z - a * s + b * c;
        g.lineTo((x - x0) * px, (z - z0) * px);
      }
      g.closePath();
    };
    g.fillStyle = "rgba(60,200,60,0.25)";
    poly(h.hl + PASSAGE, h.hs + PASSAGE);
    g.fill();
    g.fillStyle = "rgba(0,120,0,0.9)";
    poly(h.hl, h.hs);
    g.fill();
  }
  return cv.toDataURL("image/jpeg", 0.9);
}
