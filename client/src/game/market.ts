import * as THREE from "three";
import CITY from "../../../shared/city.json";
import SPOT_TABLE from "../../../shared/spots.json";
import { marketOn, marketShare } from "../../../server/src/town/market";
import type { Rect } from "../world/geom";
import { loadProps } from "../world/props3d";
import { omnibusKeepOut } from "../world/omnibus";
import { trackKeepOut, type TrackData } from "../world/tracks";
import { Batch, loadTradeModels, partsOf, type Part, type TradeModels } from "../world/trades";
import type { Crowd, Puppet } from "./crowd";
import type { HumanKind } from "./humans";
import { stallProtos, type Stalls } from "./stalls";
import { addStallThing, dropStallThings } from "./stallSpots";
import type { Town } from "./town";
import { nearestPlayer, runsHere, share as shared } from "./share";
import { tempest } from "../world/tempest";

// Market days (M3i). Steve: "vismarkt can be way fuller when markt is going on. stalls are
// too ordered. People browsing stalls and buy goods. no stalls on tracks."
//
// On a market morning (hours: server/src/town/market.ts, the engine's) the Vismarkt fills
// with stalls round its six fish banks: rows that bend, stalls a little askew and of
// different lengths, fish benches, trestle tables, baskets on the stones, barrows and
// carts, crates stacked behind, stools, awnings of four cloths and many shades. The Grote
// Markt has its market on Wednesdays and Saturdays: vegetables, cheese, baskets and
// second-hand goods. Layout after the period sources (layout only): the old fish market
// by the Steen, fish sold from benches, trestles and baskets on the stones round the fish
// banks (E. Farasyn, "The old fish market", 1882).
//
// The stalls go up one by one from dawn and come down after noon (a draw range over one
// merged mesh per material: the whole market is about a dozen draw calls). They keep off
// the quay railway, the crane runways, the omnibus lanes, the cart ruts, doors, job spots,
// the lamps, the haulers' ways and the steps; the aisles stay walkable (the path check).
//
// People: a seller behind each stall near Jef (a few sit on stools), and shoppers who walk
// along the stalls, stop, look, haggle (the talk clip; the seller turns and talks back),
// and buy: fish wrapped in paper, a parcel or a small sack appears in the hand. The town's
// residents out on their market errands (town.ts "market") browse the same way, at the
// market stalls and the town's own stalls. The player buys from the town's stall keepers as
// before (server trade.ts).

type P = [number, number];
type Goods = "fish" | "veg" | "bread" | "wares" | "cloth" | "cheese" | "baskets" | "junk" | "pots" | "hot";
// (stall: posts and an awning; table: a trestle table; the detailed kinds of 2026-09-26 from stalls.glb's mk2_*:
// fishtable, vegstall with its crates in steps, pottery on sacking, a hot food brazier, clothstall with its rail)
type Kind = "stall" | "table" | "bench" | "barrow" | "cart" | "baskets" | "fishtable" | "vegstall" | "pottery" | "brazier" | "clothstall";

/** A thing's extent in its own frame: u along, v out toward the buyers. */
interface Box4 {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
}

interface Row {
  pts: P[];
  /** Which way the customers are from the row (roughly). */
  face: P;
}

interface FieldDef {
  place: string;
  /** Where things may stand. */
  bounds: Rect[];
  rows: Row[];
  mix: Array<[number, Kind, Goods]>;
  /** Kept free: [x0, x1, z0, z1] (haulers' ways, the ruts, a square's middle). */
  keep: Array<[number, number, number, number]>;
  /** Where shoppers come in and go. */
  entries: P[];
  centre: P;
  /** Litter on the stones all the time: [model, x, z, yaw]. */
  litter: Array<[string, number, number, number]>;
  /** How many odd ones to set down between the rows. */
  scatter: number;
  /** Rough (by the quays: patched canvas, wet tables, mud) or neat (the main square: cloths on the tables). */
  rough: boolean;
  seed: number;
}

const FIELDS: FieldDef[] = [
  {
    place: "vismarkt",
    bounds: [
      { minX: -137.6, maxX: -99.8, minZ: 12.7, maxZ: 45.3 },
      { minX: -93.3, maxX: -87.7, minZ: 23.5, maxZ: 38.5 }, // inside the omnibus loop by the canal
    ],
    rows: [
      { pts: [[-136.4, 14.0], [-136.7, 24], [-136.3, 33], [-136.6, 41.5]], face: [-1, 0] }, // along the vliet walk
      { pts: [[-131.9, 14.2], [-131.3, 21], [-132.3, 28], [-131.6, 35], [-132.1, 41.2]], face: [1, 0] },
      { pts: [[-126.2, 14.0], [-126.8, 22], [-125.9, 30], [-126.9, 38], [-126.3, 42.0]], face: [-1, 0] },
      { pts: [[-106.7, 13.8], [-106.1, 22], [-107.0, 30], [-106.2, 38], [-106.9, 42.0]], face: [1, 0] },
      { pts: [[-101.9, 14.0], [-102.3, 22], [-101.8, 30], [-102.4, 38], [-102.0, 42.2]], face: [-1, 0] },
      { pts: [[-136.0, 43.1], [-131.5, 43.4], [-127.0, 43.0]], face: [0, -1] }, // before the houses
      { pts: [[-108.5, 43.3], [-104.5, 43.0], [-100.5, 43.3]], face: [0, -1] },
      { pts: [[-90.6, 24.5], [-91.1, 31], [-90.5, 37.8]], face: [-1, 0] },
    ],
    mix: [
      [0.26, "fishtable", "fish"], [0.16, "stall", "fish"], [0.1, "bench", "fish"], [0.05, "table", "fish"], [0.1, "baskets", "fish"], [0.06, "barrow", "fish"],
      [0.06, "vegstall", "veg"], [0.03, "stall", "veg"], [0.03, "table", "bread"], [0.05, "baskets", "veg"], [0.03, "cart", "veg"],
      [0.04, "brazier", "hot"], [0.03, "pottery", "pots"],
    ],
    keep: [
      [-140.5, -112, 20.9, 23.5], // the haulers from the vliet to the fish banks
      [-140.5, -112, 32.7, 35.3],
      [-110.5, -99, 25.6, 28.4], // an older save's haul end by the east row
      [-118.8, -114.4, 12, 46], // the middle aisle, the fish merchant and the job spots
    ],
    entries: [[-117, 12.5], [-116, 46.5], [-138.8, 28], [-98.8, 18], [-98.8, 42]],
    centre: [-117, 29],
    litter: [
      ["mk_scraps", -118.5, 21.5, 0.3], ["mk_scraps", -114.2, 33.8, 1.2], ["mk_scraps", -129.4, 26.2, 2.1], ["mk_scraps", -103.6, 35.0, 0.8],
      ["mk_leaves", -117.8, 39.5, 0.5], ["mk_leaves", -128.6, 43.0, 1.9], ["mk_fishbox", -138.9, 17.2, 0.4], ["mk_fishbox", -138.6, 30.4, 1.4],
      ["mk_crates", -138.9, 39.2, 1.57], ["mk_barrow_fish", -134.0, 45.6, 0.2], ["mk_spilled", -112.2, 44.9, 2.6], ["mk_basket_tall", -99.4, 46.2, 0],
    ],
    scatter: 16,
    seed: 71,
    rough: true,
  },
  {
    place: "grote_markt",
    bounds: [{ minX: -277.2, maxX: -240.8, minZ: 73.2, maxZ: 123.4 }],
    rows: [
      { pts: [[-276.5, 76.8], [-270, 78.4], [-262, 77.0], [-255, 78.6], [-248, 77.2], [-242.3, 78.2]], face: [0, -1] },
      { pts: [[-275.5, 90.4], [-270, 92.2], [-264, 90.8], [-257.8, 92.0]], face: [0, -1] },
      { pts: [[-249.8, 92.2], [-246, 90.6], [-242.3, 91.8]], face: [0, -1] },
      { pts: [[-276.6, 98.2], [-271, 96.6], [-265, 98.4], [-258.2, 96.8]], face: [0, 1] },
      { pts: [[-249.6, 96.6], [-245.5, 98.3], [-242.2, 97.0]], face: [0, 1] },
      { pts: [[-276.2, 112.2], [-270.5, 114.0], [-264.8, 112.6]], face: [0, 1] },
      { pts: [[-251.5, 113.8], [-247, 112.2], [-242.2, 113.6]], face: [0, 1] },
      { pts: [[-276.4, 121.6], [-270.5, 120.2], [-265, 121.8]], face: [0, -1] },
      { pts: [[-251.5, 120.4], [-246.5, 121.8], [-242.2, 120.6]], face: [0, -1] },
    ],
    mix: [
      [0.14, "vegstall", "veg"], [0.09, "stall", "veg"], [0.09, "stall", "cheese"], [0.08, "table", "cheese"], [0.06, "stall", "junk"], [0.06, "table", "junk"],
      [0.05, "stall", "baskets"], [0.08, "clothstall", "cloth"], [0.04, "stall", "cloth"], [0.06, "pottery", "pots"], [0.05, "table", "veg"],
      [0.07, "baskets", "veg"], [0.05, "barrow", "veg"], [0.04, "cart", "veg"], [0.04, "table", "bread"], [0.03, "stall", "bread"], [0.04, "brazier", "hot"],
    ],
    keep: [
      [-256.8, -250.2, 92, 112], // the cart ruts across the square (world/ruts.ts)
      [-264, -252, 108, 124],
    ],
    entries: [[-259, 72.4], [-239.8, 100], [-278.2, 100], [-270, 124.8]],
    centre: [-259, 98],
    litter: [
      ["mk_leaves", -262.5, 88.0, 0.4], ["mk_leaves", -246.0, 101.5, 1.3], ["mk_leaves", -270.5, 117.0, 2.2], ["mk_spilled", -272.8, 102.0, 0.7],
      ["mk_basket_tall", -241.6, 74.2, 0], ["mk_barrow_veg", -276.2, 108.5, 1.57],
    ],
    scatter: 10,
    seed: 94,
    rough: false,
  },
];

/** Sellers, by what the stall sells (a man on a stool: old_man). */
const SELLERS: Record<Goods, HumanKind[]> = {
  fish: ["fishwife_a", "fishwife_b", "old_woman", "fishwife_a", "wife_b"],
  veg: ["wife_a", "wife_b", "old_woman", "old_man"],
  bread: ["baker", "shopwife"],
  wares: ["shopkeeper", "old_man"],
  cloth: ["shopwife", "wife_a"],
  cheese: ["wife_a", "shopkeeper", "shopwife"],
  baskets: ["old_man", "old_woman"],
  junk: ["old_man", "shopkeeper", "beggar"],
  pots: ["old_woman", "wife_b", "old_man"],
  hot: ["old_man", "wife_a", "old_woman"],
};
const SHOPPERS: HumanKind[] = ["maid", "wife_a", "wife_b", "old_woman", "maid", "fishwife_b", "gentleman", "docker_b", "sailor_b", "clerk", "wife_a", "girl_b"];
/** What a buyer walks off with. */
const BOUGHT: Record<Goods, "fish" | "parcel" | "sack" | "basket"> = {
  fish: "fish", veg: "sack", bread: "parcel", wares: "parcel", cloth: "parcel", cheese: "parcel", baskets: "basket", junk: "parcel",
  pots: "parcel", hot: "parcel",
};

const MAX_SELLERS = 8;
const MAX_SHOPPERS = 8;
const SELLER_R = 32;
const SHOPPER_R = 55;

const rng = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const pickOf = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];
const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** A market item: a stall, a table, a bench, a barrow, a cart, or baskets on the stones. */
interface Item {
  kind: Kind;
  goods: Goods;
  x: number;
  z: number;
  /** three.js yaw: local +z (the customer side) looks along (sin yaw, cos yaw). */
  yaw: number;
  /** Half length along the row, half depth, in its frame. */
  hl: number;
  hd: number;
  /** Colliders in the world while it stands. */
  rects: Rect[];
  /** Where the seller stands (behind) and where a customer stands (before), in the world. */
  seller: { x: number; z: number; yaw: number };
  front: { x: number; z: number; yaw: number };
  sellerKind: HumanKind;
  sits: boolean;
  /** The great storm (world/tempest.ts): the seller huddles under the stall's awning (no calls, no haggling). */
  fled?: boolean;
  /** What was put down for it, in its own frame: drawn into the market's batch, and read by the stall check (dev/stallcheck.ts). */
  puts: Put[];
  /** Where the seller stands (or sits) and where a buyer stands, in its own frame (u along, v out). */
  sellerAt: P;
  frontAt: P;
  /** Its place in the order stalls go up. */
  rank: number;
  /** The seller's body when Jef is near. */
  p: Puppet | null;
  talkT: number;
}

/** One model put down for an item, in the item's frame. */
interface Put {
  parts: Part[];
  u: number;
  y: number;
  v: number;
  dyaw: number;
  sc: [number, number, number];
  tint?: [number, number, number];
  swap?: (m: THREE.Material) => THREE.Material;
  /** Stands in the way (not: a stool someone sits on, mud on the stones). */
  solid: boolean;
}

/** The extent of an item's solid things below `below` m, in its own frame (the mud and the stool left out). */
function extentOf(puts: Put[], below: number, uMin = -Infinity, uMax = Infinity): Box4 {
  const b: Box4 = { u0: Infinity, u1: -Infinity, v0: Infinity, v1: -Infinity };
  for (const q of puts) {
    if (!q.solid) continue;
    const pts = partPts(q.parts);
    const c = Math.cos(q.dyaw);
    const s = Math.sin(q.dyaw);
    for (let i = 0; i + 2 < pts.length; i += 3) {
      if (q.y + pts[i + 1] * q.sc[1] > below) continue;
      const lx = pts[i] * q.sc[0];
      const lz = pts[i + 2] * q.sc[2];
      const u = q.u + lx * c + lz * s;
      const v = q.v - lx * s + lz * c;
      if (u < uMin || u > uMax) continue;
      b.u0 = Math.min(b.u0, u);
      b.u1 = Math.max(b.u1, u);
      b.v0 = Math.min(b.v0, v);
      b.v1 = Math.max(b.v1, v);
    }
  }
  if (!Number.isFinite(b.u0)) return { u0: -0.5, u1: 0.5, v0: -0.4, v1: 0.4 };
  return b;
}

/** Something a browser can walk up to. */
interface Target {
  x: number;
  z: number;
  /** Which way the buyer faces there. */
  yaw: number;
  goods: Goods;
  item: Item | null;
  keeper: string | null;
}

interface Browse {
  place: string;
  phase: "pick" | "go" | "look" | "haggle" | "leave" | "gone";
  t: number;
  target: Target | null;
  visits: number;
  want: number;
  tries: number;
  /** A nameless shopper of the market (not a townsperson). */
  own: boolean;
}

interface Built {
  def: FieldDef;
  items: Item[];
  batch: Batch;
  litter: Batch;
  group: THREE.Group;
  lo: number;
  hi: number;
  colliders: Set<Rect>;
  shoppers: Puppet[];
  on: boolean;
}

export interface MarketWorld {
  scene: THREE.Scene;
  addCollider(r: Rect): void;
  removeCollider(r: Rect): void;
  isFree(x: number, z: number, r: number): boolean;
  solids(): Rect[];
  city: { flags(x: number, z: number): number | undefined };
}

/** The points of a model's parts, in one array (extents, the stall check), once per model. */
const partPtsCache = new WeakMap<Part[], Float32Array>();
function partPts(parts: Part[]): Float32Array {
  let p = partPtsCache.get(parts);
  if (p) return p;
  // (not the mud on the stones: a flat decal stands in nobody's way)
  const solid = parts.filter((q) => q.mat.name !== "market_mud");
  let n = 0;
  for (const q of solid) n += q.pos.length;
  p = new Float32Array(n);
  let o = 0;
  for (const q of solid) {
    p.set(q.pos, o);
    o += q.pos.length;
  }
  partPtsCache.set(parts, p);
  return p;
}

// ------------------------------------------------------------------ keep-outs

interface CityDecor {
  decor?: TrackData & { lamps?: P[]; trees?: P[] };
}

/** The market squares, for the props, the street life and the quay furniture to keep off (rijnkaai.ts). */
export function marketKeepOut(): Rect[] {
  return FIELDS.flatMap((f) => f.bounds.map((b) => ({ minX: b.minX - 0.5, maxX: b.maxX + 0.5, minZ: b.minZ - 0.5, maxZ: b.maxZ + 0.5 })));
}

// ------------------------------------------------------------------ the market

export class Market {
  private built: Built[] = [];
  private ready = false;
  private player = { x: 0, z: 0 };
  private thinkT = 0;
  private colT = 0;
  private browsing = new Map<Puppet, Browse>();
  private openKeepers = new Set<string>();
  /** M8f sync pass 3: each shopper's id among the players' PCs (net/mp/extras.ts), and whether the hook is set. */
  private netIds = new Map<Puppet, string>();
  private adoptWired = false;
  /** Dev: how the last layout went. */
  layoutInfo: Record<string, { items: number; tried: number; byKind: Record<string, number>; why: Record<string, number> }> = {};

  constructor(
    private readonly world: MarketWorld,
    private readonly crowd: Crowd,
    private readonly town: Town,
    private readonly stalls: Stalls,
  ) {}

  /** Lay out both markets and build their meshes (after the town and its stalls are in). */
  async build(): Promise<void> {
    const [protos, trades, props] = await Promise.all([stallProtos(), loadTradeModels(), loadProps().catch(() => null)]);
    if (!protos || !trades) return;
    for (let i = 0; i < 600 && this.world.city.flags(-117, 29) === undefined; i++) await new Promise((r) => setTimeout(r, 100));
    const doors: P[] = [];
    const hd = props?.houseDoors ?? [];
    for (let i = 0; i + 1 < hd.length; i += 2) doors.push([hd[i], hd[i + 1]]);
    const stallParts = new Map<string, Part[]>();
    // (not the little name board of the town's stalls: one material less for the whole market)
    for (const [name, o] of protos) stallParts.set(name, partsOf(o).filter((p) => p.mat.name !== "stall_sign"));
    const mats = new Map<string, THREE.Material>();
    for (const parts of stallParts.values()) for (const p of parts) mats.set(p.mat.name, p.mat);
    for (const def of FIELDS) this.built.push(this.layout(def, doors, stallParts, mats, trades));
    this.ready = true;
  }

  // ---------------------------------------------------------------- layout

  private layout(def: FieldDef, doors: P[], stallParts: Map<string, Part[]>, mats: Map<string, THREE.Material>, trades: TradeModels): Built {
    const R = rng(def.seed);
    const J = (a: number) => (R() * 2 - 1) * a;
    const decor = (CITY as unknown as CityDecor).decor ?? {};
    const lanes = omnibusKeepOut();
    const tracks = trackKeepOut(decor);
    const spots = Object.entries(SPOT_TABLE as unknown as Record<string, { x?: number; z?: number }>)
      .filter(([k, s]) => !k.startsWith("_") && s.x !== undefined)
      .map(([, s]) => [s.x!, s.z!] as P);
    const circles: Array<[number, number, number]> = [];
    for (const [x, z] of decor.lamps ?? []) circles.push([x, z, 0.9]);
    for (const [x, z] of decor.trees ?? []) circles.push([x, z, 0.9]);
    for (const [x, z] of doors) circles.push([x, z, 2.6]);
    for (const [x, z] of spots) circles.push([x, z, 2.4]);
    // the town's stalls (their table, seller and customers) and every haul end, post and place point
    const td = this.town.data;
    for (const s of td?.stalls ?? []) {
      if (s.place !== def.place) continue;
      circles.push([s.x, s.z, 2.0], [s.x + s.face[0] * 1.4, s.z + s.face[1] * 1.4, 1.2], [s.x - s.face[0] * 1.2, s.z - s.face[1] * 1.2, 1.0]);
    }
    for (const r of td?.residents ?? []) {
      for (const q of [r.work.a, r.work.b]) if (q) circles.push([q[0], q[1], 1.7]);
      if (r.work.at && r.work.kind !== "stall") circles.push([r.work.at[0], r.work.at[1], 1.5]);
    }
    for (const p of Object.values(td?.places ?? {})) circles.push([p.x, p.z, 1.6]);
    const solids = this.world.solids();
    const keep: Rect[] = def.keep.map(([a, b, c, d]) => ({ minX: a, maxX: b, minZ: c, maxZ: d }));
    const inRect = (r: Rect, x: number, z: number, pad = 0) => x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
    const placed: Array<{ x: number; z: number; c: number; s: number } & Box4> = [];

    /** Is a box (centre, yaw, half extents, with a margin behind and before) free? */
    const why: Record<string, number> = {};
    const no = (k: string) => {
      why[k] = (why[k] ?? 0) + 1;
      return false;
    };
    /** Is a thing (its extent b in its own frame) free here, with room behind it (the seller) and before it (the buyers)? */
    const fits = (x: number, z: number, yaw: number, b: Box4, back: number, front: number): boolean => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const du = Math.max(0.2, (b.u1 - b.u0) / 10);
      for (let u = b.u0; u <= b.u1 + 1e-6; u += du) {
        for (let v = b.v0 - back; v <= b.v1 + front + 1e-6; v += 0.3) {
          const px = x + u * c + v * s;
          const pz = z - u * s + v * c;
          // the body and the seller's room must be on the square; the customers may stand on its edge
          const body = v < b.v1 + 0.2;
          if (body && !def.bounds.some((b) => inRect(b, px, pz))) return no("bounds");
          if (this.world.city.flags(px, pz) !== 0) return no("walk map");
          for (const r of lanes) if (inRect(r, px, pz, 0.2)) return no("omnibus");
          for (const r of tracks) if (inRect(r, px, pz, 0.2)) return no("railway");
          if (body) for (const r of keep) if (inRect(r, px, pz)) return no("kept free");
          for (const r of solids) if (inRect(r, px, pz, 0.25)) return no("solid");
          for (const [cx, cz, cr] of circles) if ((px - cx) ** 2 + (pz - cz) ** 2 < cr * cr) return no(`circle ${cx.toFixed(0)},${cz.toFixed(0)} r${cr}`);
          for (const q of placed) {
            // inside another item's box (with its seller and customer room)?
            const dx = px - q.x;
            const dz = pz - q.z;
            const lu = dx * q.c - dz * q.s;
            const lv = dx * q.s + dz * q.c;
            if (lu > q.u0 - 0.15 && lu < q.u1 + 0.15 && lv > q.v0 - 0.15 && lv < q.v1 + 0.15) return no("another stall");
          }
        }
      }
      return true;
    };

    const items: Item[] = [];
    let tried = 0;
    const byKind: Record<string, number> = {};
    const pickMix = (): [Kind, Goods] => {
      const total = def.mix.reduce((a, m) => a + m[0], 0);
      let r = R() * total;
      for (const [w, k, g] of def.mix) if ((r -= w) <= 0) return [k, g];
      return [def.mix[0][1], def.mix[0][2]];
    };
    const LEN: Record<Kind, [number, number]> = {
      stall: [2.2, 3.1], table: [1.6, 1.6], bench: [2.2, 2.2], barrow: [2.1, 2.1], cart: [2.8, 2.8], baskets: [1.5, 2.1],
      fishtable: [2.2, 2.2], vegstall: [2.4, 2.4], pottery: [1.9, 1.9], brazier: [1.6, 1.6], clothstall: [2.2, 2.2],
    };
    const DEPTH: Record<Kind, number> = {
      stall: 0.72, table: 0.4, bench: 0.42, barrow: 0.42, cart: 0.7, baskets: 0.45, fishtable: 0.5, vegstall: 0.5, pottery: 0.6, brazier: 0.45, clothstall: 0.42,
    };
    // striped red, striped blue, patched canvas or sackcloth, each in many shades (more canvas by the quay)
    const awnings = (def.rough ? ["awning_red", "awning_blue", "canvas_patched", "canvas_patched", "sackcloth"] : ["awning_red", "awning_blue", "awning_red", "awning_blue", "canvas_patched"])
      .map((n) => mats.get(n))
      .filter((m): m is THREE.Material => !!m);
    /** Make and dress an item (in its own frame); its extent: all that stands, and the low part (the colliders). */
    const make = (kind: Kind, goods: Goods, len: number) => {
      const it = this.makeItem(kind, goods, len / 2, DEPTH[kind], R);
      this.dress(it, stallParts, trades, awnings, R, def.rough);
      return { it, all: extentOf(it.puts, 99), low: extentOf(it.puts, 1.3) };
    };
    for (const row of def.rows) {
      // the row as a smooth line (Catmull-Rom through its points), by arc length
      const line: P[] = [];
      const pts = row.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[Math.max(0, i - 1)];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let k = 0; k < 8; k++) {
          const t = k / 8;
          const t2 = t * t;
          const t3 = t2 * t;
          const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
          line.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
        }
      }
      line.push(pts[pts.length - 1]);
      const acc: number[] = [0];
      for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + dist(line[i][0], line[i][1], line[i - 1][0], line[i - 1][1]));
      const total = acc[acc.length - 1];
      const at = (s: number): { x: number; z: number; tx: number; tz: number } => {
        let i = 1;
        while (i < acc.length - 1 && acc[i] < s) i++;
        const k = (s - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
        const [ax, az] = line[i - 1];
        const [bx, bz] = line[i];
        const L = Math.hypot(bx - ax, bz - az) || 1;
        return { x: ax + (bx - ax) * k, z: az + (bz - az) * k, tx: (bx - ax) / L, tz: (bz - az) / L };
      };
      let s = R() * 0.8;
      while (s < total - 1) {
        const [kind, goods] = pickMix();
        const [l0, l1] = LEN[kind];
        const len = l0 + R() * (l1 - l0);
        const made = make(kind, goods, len);
        // its real length along the row (the goods, the crates at its ends), from the middle out
        const half = Math.max(-made.all.u0, made.all.u1);
        if (s + 2 * half > total + 0.3) break;
        const c = at(s + half);
        // the customers' side: the row's normal that points along `face`
        let nx = -c.tz;
        let nz = c.tx;
        if (nx * row.face[0] + nz * row.face[1] < 0) {
          nx = -nx;
          nz = -nz;
        }
        const x = c.x + nx * J(0.45) + c.tx * J(0.2);
        const z = c.z + nz * J(0.45) + c.tz * J(0.2);
        const yaw = Math.atan2(nx, nz) + J(0.22);
        tried++;
        if (!fits(x, z, yaw, made.all, 0.9, 1.25)) {
          s += 0.7;
          continue;
        }
        const it = made.it;
        this.placeItem(it, x, z, yaw, made.low);
        items.push(it);
        placed.push({ x, z, c: Math.cos(yaw), s: Math.sin(yaw), u0: made.all.u0, u1: made.all.u1, v0: made.all.v0 - 0.85, v1: made.all.v1 + 1.1 });
        byKind[`${kind} ${goods}`] = (byKind[`${kind} ${goods}`] ?? 0) + 1;
        // now and then a passage between stalls, else a narrow gap
        s += 2 * half + (R() < 0.1 ? 1.8 + R() * 0.8 : 0.2 + R() * 0.45);
      }
    }
    // then the odd ones in between: a woman with her baskets on the stones, a barrow, set down
    // wherever there is room, at any angle (Steve: "more random stuff around")
    for (let k = 0; k < def.scatter * 8 && items.length < 999; k++) {
      const b = def.bounds[Math.floor(R() * def.bounds.length)];
      const x = b.minX + R() * (b.maxX - b.minX);
      const z = b.minZ + R() * (b.maxZ - b.minZ);
      const yaw = R() * Math.PI * 2;
      const kind: Kind = R() < 0.7 ? "baskets" : "barrow";
      const goods: Goods = def.place === "vismarkt" ? (R() < 0.75 ? "fish" : "veg") : "veg";
      const len = kind === "baskets" ? 1.5 : 2.1;
      const made = make(kind, goods, len);
      tried++;
      if (!fits(x, z, yaw, made.all, 0.8, 1.2)) continue;
      this.placeItem(made.it, x, z, yaw, made.low);
      items.push(made.it);
      placed.push({ x, z, c: Math.cos(yaw), s: Math.sin(yaw), u0: made.all.u0, u1: made.all.u1, v0: made.all.v0 - 0.8, v1: made.all.v1 + 1.0 });
      byKind[`${kind} ${goods} (scattered)`] = (byKind[`${kind} ${goods} (scattered)`] ?? 0) + 1;
      if (Object.entries(byKind).filter(([k2]) => k2.endsWith("(scattered)")).reduce((a, [, n]) => a + n, 0) >= def.scatter) break;
    }
    // the order they go up: fish first on the fish market, the rest after; a shuffle within
    const order = items.map((it) => ({ it, k: (it.goods === "fish" ? 0 : 0.4) + R() })).sort((a, b) => a.k - b.k);
    order.forEach((o, i) => (o.it.rank = i));
    items.sort((a, b) => a.rank - b.rank);

    // --- meshes: one per material for the whole market, drawn up to the stalls that stand
    const group = new THREE.Group();
    group.name = `market_${def.place}`;
    this.world.scene.add(group);
    const batch = new Batch();
    for (const it of items) {
      const c = Math.cos(it.yaw);
      const sn = Math.sin(it.yaw);
      for (const q of it.puts) batch.put(q.parts, it.x + q.u * c + q.v * sn, q.y, it.z - q.u * sn + q.v * c, it.yaw + q.dyaw, q.sc, q.tint, q.swap);
      batch.next();
    }
    batch.build(group, def.place);
    dropStallThings((k) => k === `market ${def.place}`);
    items.forEach((it, k) =>
      addStallThing({
        kind: `market ${def.place}`, label: `${def.place} ${it.kind} ${k} (${it.goods})`, x: it.x, z: it.z, yaw: it.yaw, front: 1.2,
        parts: it.puts.filter((q) => q.solid).map((q) => ({ pts: partPts(q.parts), u: q.u, y: q.y, v: q.v, yaw: q.dyaw, s: q.sc })),
      }),
    );
    const litter = new Batch();
    for (const [name, x, z, yaw] of def.litter) litter.put(trades.parts.get(name), x, 0, z, yaw);
    litter.build(group, `${def.place}_litter`);
    batch.window(0, 0);
    this.layoutInfo[def.place] = { items: items.length, tried, byKind, why };
    return { def, items, batch, litter, group, lo: 0, hi: 0, colliders: new Set(), shoppers: [], on: false };
  }

  private makeItem(kind: Kind, goods: Goods, hl: number, hd: number, R: () => number): Item {
    const kinds = SELLERS[goods];
    const sellerKind = kinds[Math.floor(R() * kinds.length)];
    // an old man sits on his stool; so does the potter by her spread on the stones
    const sits = sellerKind === "old_man" || kind === "pottery";
    const su = R() * 0.6 - 0.3;
    const fu = R() * 0.8 - 0.4;
    return {
      kind, goods, x: 0, z: 0, yaw: 0, hl, hd, rects: [], sellerKind, sits, rank: 0, p: null, talkT: R() * 5, puts: [],
      sellerAt: [su, -(hd + 0.5)],
      frontAt: [fu, hd + 0.75],
      seller: { x: 0, z: 0, yaw: 0 },
      front: { x: 0, z: 0, yaw: 0 },
    };
  }

  /** Set an item down: where it stands, its seller's and buyer's places, its colliders (each half of it by its own depth). */
  private placeItem(it: Item, x: number, z: number, yaw: number, low: Box4): void {
    it.x = x;
    it.z = z;
    it.yaw = yaw;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const w = (u: number, v: number): P => [x + u * c + v * s, z - u * s + v * c];
    const box = (b: Box4, top: number): Rect => {
      const ps = [w(b.u0, b.v0), w(b.u1, b.v0), w(b.u0, b.v1), w(b.u1, b.v1)];
      return { minX: Math.min(...ps.map((p) => p[0])), maxX: Math.max(...ps.map((p) => p[0])), minZ: Math.min(...ps.map((p) => p[1])), maxZ: Math.max(...ps.map((p) => p[1])), top };
    };
    const top = it.kind === "baskets" || it.kind === "pottery" ? 0.5 : it.kind === "barrow" ? 0.7 : 1.1;
    const mid = (low.u0 + low.u1) / 2;
    // (an AABB of a turned box is fat: two halves, each only as deep as what stands in it)
    it.rects = [extentOf(it.puts, 1.3, low.u0, mid), extentOf(it.puts, 1.3, mid, low.u1)].map((b) => box(b, top));
    // the buyer stands before the goods, the seller behind the table (or where the dressing put her)
    it.frontAt = [it.frontAt[0], low.v1 + 0.6];
    const [sx, sz] = w(it.sellerAt[0], it.sellerAt[1]);
    const [fx, fz] = w(it.frontAt[0], it.frontAt[1]);
    it.seller = { x: sx, z: sz, yaw };
    it.front = { x: fx, z: fz, yaw: yaw + Math.PI };
  }

  /**
   * Dress an item in its own frame (recorded in it.puts): the stall or table, its goods with volume,
   * what lies under and behind it, a stool, a gull; mud on the stones in the rough markets.
   */
  private dress(it: Item, sp: Map<string, Part[]>, tr: TradeModels, awnings: THREE.Material[], R: () => number, rough: boolean): void {
    const put = (parts: Part[] | undefined, u: number, y: number, v: number, dyaw = 0, sc: [number, number, number] = [1, 1, 1], tint?: [number, number, number], swap?: (m: THREE.Material) => THREE.Material, solid = true) => {
      if (parts) it.puts.push({ parts, u, y, v, dyaw, sc, tint, swap, solid });
    };
    const T = tr.parts;
    const S = (n: string) => sp.get(n);
    const shade = 0.82 + R() * 0.3;
    const tint: [number, number, number] = [shade * (0.92 + R() * 0.16), shade * (0.92 + R() * 0.16), shade * (0.92 + R() * 0.16)];
    const mudUnder = (big: boolean, chance: number) => {
      if (rough && R() < chance) put(S(big ? "mk2_mud" : "mk2_mud_small"), (R() - 0.5) * 0.4, 0, (R() - 0.5) * 0.3, (R() - 0.5) * 0.6, [1, 1, 1], undefined, undefined, false);
    };
    let ownBack = false; // the kind brings its own crates and baskets behind
    const hl = it.hl;
    const hd = it.hd;
    switch (it.kind) {
      case "stall": {
        const sx = (hl * 2) / 2.8;
        const sy = 0.93 + R() * 0.14;
        put(S("stall_frame"), 0, 0, 0, 0, [sx, sy, 1]);
        const aw = awnings[Math.floor(R() * awnings.length)];
        const tw: [number, number, number] = [0.75 + R() * 0.4, 0.75 + R() * 0.35, 0.75 + R() * 0.4];
        put(S("stall_awning"), 0, 0, 0, 0, [sx, sy, 1], tw, (m) => (m.name === "awning_red" && aw ? aw : m));
        const top = 0.85 * sy;
        // a linen cloth over the table on the neat square (not under fish)
        if (!rough && it.goods !== "fish") put(S("stall_cloth"), 0, 0, 0, 0, [sx, sy, 1]);
        switch (it.goods) {
          case "cheese":
          case "junk":
            put(S(`mk2_goods_${it.goods}`), 0, top - 0.785, 0, 0, [Math.min(1.25, sx), 1, 1]);
            break;
          case "baskets":
            put(T.get("mk_goods_baskets"), 0, top, 0, 0, [Math.min(1.2, sx), 1, 1]);
            break;
          default:
            put(S(`stall_goods_${it.goods}`), 0, 0, 0, 0, [sx, sy, 1]);
            put(S(`stall_more_${it.goods}`), 0, 0, 0, 0, [sx, sy, 1]);
        }
        if (it.goods !== "fish") put(S("mk2_under"), (R() - 0.5) * 0.4, 0, 0.05, (R() - 0.5) * 0.3);
        mudUnder(true, 0.55);
        break;
      }
      case "table": {
        const neat = !rough || it.goods === "bread";
        if (neat && it.goods !== "fish") {
          put(S("mk2_trestle_cloth"), 0, 0, 0, 0, [1, 1, 1], tint);
          if (it.goods === "cheese" || it.goods === "bread" || it.goods === "junk") put(S(`mk2_goods_${it.goods}`), 0, 0, 0);
          else if (it.goods === "veg") {
            put(S("shop_goods_veg"), 0, -0.02, -0.6);
            put(S("shop_more_veg"), 0, -0.02, -0.6);
          } else put(T.get(`mk_goods_${it.goods}`), 0, 0.78, 0);
        } else {
          put(S("shop_table"), 0, 0, -0.6, 0, [1, 0.95 + R() * 0.1, 1], tint);
          const g = it.goods === "cloth" ? "wares" : it.goods;
          if (S(`shop_goods_${g}`)) {
            put(S(`shop_goods_${g}`), 0, 0, -0.6);
            put(S(`shop_more_${g}`), 0, 0, -0.6);
          } else put(T.get(`mk_goods_${it.goods}`), 0, 0.8, 0);
        }
        mudUnder(false, 0.6);
        break;
      }
      case "fishtable":
        put(S("mk2_fish_table"), 0, 0, 0, 0, [1, 1, 1], tint);
        put(S("mk2_fish_crates"), 0.3, 0, -0.98, (R() - 0.5) * 0.2);
        it.sellerAt = [-0.45 + (R() - 0.5) * 0.3, -0.95];
        ownBack = true;
        break;
      case "vegstall":
        put(S("mk2_veg_stall"), 0, 0, 0, 0, [1, 1, 1], tint);
        it.sellerAt = [(R() - 0.5) * 0.6, -0.95];
        ownBack = true;
        break;
      case "pottery":
        put(S("mk2_pottery"), 0, 0, 0, (R() - 0.5) * 0.1);
        it.sellerAt = [-0.45, -1.05];
        ownBack = true;
        mudUnder(false, 0.4);
        break;
      case "brazier":
        put(S("mk2_brazier"), 0, 0, 0);
        it.sellerAt = [0.05, -0.68];
        ownBack = true;
        break;
      case "clothstall":
        put(S("mk2_trestle_cloth"), 0, 0, 0, 0, [1, 1, 1], tint);
        put(S("mk2_cloth_stall"), 0, 0, 0);
        it.sellerAt = [(R() - 0.5) * 0.5, -0.95];
        break;
      case "bench":
        put(T.get("mk_bench"), 0, 0, 0);
        mudUnder(false, 0.7);
        break;
      case "barrow":
        put(T.get(it.goods === "fish" ? "mk_barrow_fish" : "mk_barrow_veg"), 0, 0, 0, Math.PI / 2 + (R() - 0.5) * 0.3);
        mudUnder(false, 0.5);
        break;
      case "cart":
        put(T.get("mk_cart"), -0.4, 0, 0, Math.PI / 2 + (R() - 0.5) * 0.2);
        mudUnder(true, 0.5);
        break;
      case "baskets": {
        if (it.goods === "veg" && R() < 0.5) {
          put(S("mk2_ground_baskets"), 0, 0, 0, (R() - 0.5) * 0.3);
          ownBack = true;
        } else {
          const n = hl > 0.9 ? 2 : 1;
          for (let i = 0; i < n; i++) put(T.get(it.goods === "fish" ? "mk_basket_fish" : "mk_basket_veg"), (i - (n - 1) / 2) * 0.95 - 0.2, 0, 0.05, R() * 6);
        }
        mudUnder(false, 0.5);
        break;
      }
    }
    // behind: crates stacked (fish boxes on the fish market), within the item's own length
    if (!ownBack && it.kind !== "barrow" && R() < 0.75) put(T.get(it.goods === "fish" ? "mk_crates" : R() < 0.5 ? "mk_crates" : "mk_basket_tall"), (R() < 0.5 ? -1 : 1) * (hl - 0.4), 0, -hd - 0.7, (R() - 0.5) * 0.6);
    // the seller's stool, clear of what stands behind the table
    if (it.sits) {
      const e = extentOf(it.puts, 1.3, it.sellerAt[0] - 0.3, it.sellerAt[0] + 0.3);
      it.sellerAt = [it.sellerAt[0], Math.min(it.sellerAt[1], e.v0 - 0.3)];
      put(S("mk2_stool") ?? T.get("mk_stool"), it.sellerAt[0], 0, it.sellerAt[1], R() * 6, [1, 1, 1], undefined, undefined, false);
    }
    if (it.goods === "fish" && (it.kind === "stall" || it.kind === "bench" || it.kind === "fishtable") && R() < 0.2) {
      put(T.get("mk_gull"), (R() - 0.5) * hl, it.kind === "bench" ? 0.8 : 0.86, 0.1, R() * 6, [1, 1, 1], undefined, undefined, false);
    }
    if (it.goods === "fish" && it.kind !== "fishtable" && R() < 0.35) put(T.get("mk_fishbox"), (R() < 0.5 ? -1 : 1) * (hl - 0.3), 0, hd + 0.2, (R() - 0.5) * 0.8);
    if (it.goods === "veg" && it.kind !== "vegstall" && R() < 0.3) put(T.get("mk_leaves"), 0, 0, hd + 0.8, R() * 6, [1, 1, 1], undefined, undefined, false);
  }

  // ---------------------------------------------------------------- every frame

  update(dt: number, player: { x: number; z: number }, day: number, hour: number): void {
    if (!this.ready) return;
    this.player = { x: player.x, z: player.z };
    if (shared.net && !this.adoptWired) {
      this.adoptWired = true;
      // M8f sync pass 3: a shopper another PC ran and let go near this player: this PC walks her on
      shared.net.onAdopt("x:ms:", (id, o) => {
        const p = o as Puppet;
        const m = [...this.built].sort((a, b) => dist(p.x, p.z, a.def.centre[0], a.def.centre[1]) - dist(p.x, p.z, b.def.centre[0], b.def.centre[1]))[0];
        if (!m) return false;
        m.shoppers.push(p);
        this.netIds.set(p, id);
        this.browsing.set(p, { place: m.def.place, phase: m.on ? "pick" : "gone", t: 1, target: null, visits: 0, want: 1 + Math.floor(Math.random() * 2), tries: 0, own: true });
        if (!m.on) this.leave(p, this.browsing.get(p)!, m);
        return true;
      });
    }
    this.colT -= dt;
    this.thinkT -= dt;
    const think = this.thinkT <= 0;
    if (think) {
      this.thinkT = 0.5;
      this.openKeepers.clear();
      for (const s of this.stalls.states) if (s.keeper && s.open) this.openKeepers.add(s.keeper);
    }
    for (const m of this.built) {
      const share = marketShare(m.def.place, day, hour);
      const n = m.items.length;
      // up in rank order; down again first-up first-down
      const rising = hour < 12;
      const hi = rising ? Math.floor(share * n + 1e-6) : n;
      const lo = rising ? 0 : n - Math.floor(share * n + 1e-6);
      const want = share > 0 ? [lo, Math.max(lo, hi)] : [0, 0];
      if (want[0] !== m.lo || want[1] !== m.hi) {
        m.lo = want[0];
        m.hi = want[1];
        m.batch.window(m.lo, m.hi);
      }
      const d = dist(player.x, player.z, m.def.centre[0], m.def.centre[1]);
      m.group.visible = d < 140;
      if (this.colT <= 0) this.syncColliders(m);
      // (the great storm, world/tempest.ts: the shoppers run for it)
      m.on = marketOn(m.def.place, day, hour) && !tempest.phase;
      if (think) {
        this.sellers(m, d);
        this.shoppers(m, d);
      }
      for (const it of m.items) if (it.p) this.sellerStep(it, dt);
    }
    if (this.colT <= 0) this.colT = 3;
    for (const [p, b] of this.browsing) {
      if (!this.crowd.alive(p)) {
        this.browsing.delete(p);
        continue;
      }
      if (b.own) this.step(p, b, dt);
    }
  }

  /** Walk colliders for the stalls that stand now (a few times a minute: the crowd's grid is rebuilt on change). */
  private syncColliders(m: Built): void {
    const want = new Set<Rect>();
    for (let k = m.lo; k < m.hi; k++) for (const r of m.items[k].rects) want.add(r);
    for (const r of m.colliders) if (!want.has(r)) this.world.removeCollider(r);
    for (const r of want) if (!m.colliders.has(r)) this.world.addCollider(r);
    m.colliders = want;
  }

  // ---------------------------------------------------------------- sellers

  private sellers(m: Built, d: number): void {
    // the great storm: the sellers stay by their goods, huddled under the stall's awning, arms folded against the cold
    if (tempest.phase) {
      for (const it of m.items) {
        if (!it.p || it.fled) continue;
        it.fled = true;
        if (it.sits) this.crowd.puppetSit(it.p, it.seller.yaw);
        else this.crowd.puppetStand(it.p, "fold", it.seller.yaw);
      }
      return;
    }
    for (const it of m.items) if (it.p && it.fled) {
      it.fled = false;
      it.talkT = 0;
    }
    const up = (k: number) => k >= m.lo && k < m.hi;
    const near = m.items
      .filter((it, k) => up(k) && d < SELLER_R + 60 && dist(it.x, it.z, this.player.x, this.player.z) < SELLER_R)
      .sort((a, b) => dist(a.x, a.z, this.player.x, this.player.z) - dist(b.x, b.z, this.player.x, this.player.z))
      .slice(0, MAX_SELLERS);
    for (const it of m.items) {
      if (it.p && !near.includes(it)) {
        // gone out of sight: the seller is still there, just not drawn
        if (this.crowd.isHidden(it.seller.x, it.seller.z) || !m.items.slice(m.lo, m.hi).includes(it)) {
          this.crowd.removePuppet(it.p);
          it.p = null;
        }
      }
    }
    let alive = m.items.filter((it) => it.p).length;
    for (const it of near) {
      if (it.p) continue;
      if (alive >= MAX_SELLERS) break;
      alive++;
      // (his size from his place, 0.95 to 1.05: the same seller on every PC; sync pass 2)
      const h = Math.sin(it.seller.x * 12.9898 + it.seller.z * 78.233) * 43758.5453;
      const p = this.crowd.addPuppet(it.sellerKind, it.seller.x, it.seller.z, it.seller.yaw, 1, 0.95 + (h - Math.floor(h)) * 0.1);
      if (!p) return;
      it.p = p;
      it.fled = false;
      if (it.sits) this.crowd.puppetSit(p, it.seller.yaw);
      else this.crowd.puppetStand(p, "idle", it.seller.yaw);
    }
  }

  /** A seller calls out now and then, and turns to a buyer who haggles. */
  private sellerStep(it: Item, dt: number): void {
    if (it.fled) return; // (huddled under the awning in the great storm)
    if ((it.talkT -= dt) > 0) return;
    const p = it.p!;
    const calling = Math.random() < 0.3;
    if (it.sits) this.crowd.puppetSit(p, it.seller.yaw);
    else this.crowd.puppetStand(p, calling ? "talk" : Math.random() < 0.3 ? "fold" : "idle", it.seller.yaw);
    it.talkT = calling ? rnd(2, 4) : rnd(4, 9);
  }

  /** The seller at this target turns to the buyer and talks (a market seller or a town keeper). */
  private gesture(t: Target, bx: number, bz: number, secs: number): void {
    if (t.item?.p) {
      const p = t.item.p;
      const yaw = Math.atan2(bx - p.x, bz - p.z);
      if (t.item.sits) this.crowd.puppetSit(p, yaw);
      else this.crowd.puppetStand(p, "talk", yaw);
      t.item.talkT = secs;
    } else if (t.keeper) this.town.gesture(t.keeper, bx, bz, secs);
  }

  // ---------------------------------------------------------------- shoppers

  private shoppers(m: Built, d: number): void {
    // nameless shoppers while the market is on and Jef is about; they leave when it packs up
    // (M8f sync pass 3: played together, the PC of the player nearest the market runs its shoppers for all: it
    // brings new ones in, where no player sees; each is sent to the others as the townspeople are)
    for (const p of m.shoppers) if (!this.crowd.alive(p)) this.dropShopper(p, true);
    m.shoppers = m.shoppers.filter((p) => this.crowd.alive(p));
    const lead = runsHere(`g:mk:${m.def.place}`, m.def.centre[0], m.def.centre[1], SHOPPER_R);
    const want = m.on && d < SHOPPER_R && lead ? MAX_SHOPPERS : 0;
    if (m.shoppers.length < want) {
      const entries = m.def.entries.filter(([x, z]) => this.crowd.isHidden(x, z) && !shared.seenByOthers(x, z) && this.crowd.onGrid(x, z));
      const e = entries.length ? pickOf(entries) : null;
      if (e) {
        const at = this.crowd.canStand(e[0], e[1]) ? { x: e[0], z: e[1] } : this.crowd.openNear(e[0], e[1]);
        const kind = pickOf(SHOPPERS);
        const p = at && this.crowd.addPuppet(kind, at.x, at.z, 0, rnd(0.95, 1.2));
        if (p) {
          m.shoppers.push(p);
          this.browsing.set(p, { place: m.def.place, phase: "pick", t: rnd(0, 1), target: null, visits: 0, want: 2 + Math.floor(Math.random() * 3), tries: 0, own: true });
          if (shared.on && shared.net) this.netIds.set(p, shared.net.newId("ms", kind));
        }
      }
    }
    for (const p of m.shoppers) {
      const id = this.netIds.get(p);
      if (id && shared.net) shared.net.person(id, p);
      const b = this.browsing.get(p);
      if (!b) continue;
      if (!m.on && b.phase !== "leave" && b.phase !== "gone") this.leave(p, b, m);
      if ((b.phase === "gone" || b.phase === "leave") && ((this.crowd.isHidden(p.x, p.z) && !shared.seenByOthers(p.x, p.z)) || b.t < -40)) {
        this.dropShopper(p, true);
      }
    }
    if (d > SHOPPER_R + 20) {
      // (walked off: one still near another player is his PC's to walk on)
      for (const p of m.shoppers) this.dropShopper(p, !(shared.on && nearestPlayer(p.x, p.z) < SHOPPER_R));
      m.shoppers = [];
    }
    m.shoppers = m.shoppers.filter((p) => this.crowd.alive(p));
  }

  /** A shopper of this PC goes: gone for good, or (`gone` false) let go for the PC of the player near her. */
  private dropShopper(p: Puppet, gone: boolean): void {
    const id = this.netIds.get(p);
    if (id && shared.net) {
      if (gone) shared.net.personGone(id);
      else shared.net.release(id);
    }
    this.netIds.delete(p);
    this.browsing.delete(p);
    if (this.crowd.alive(p)) this.crowd.removePuppet(p);
  }

  private leave(p: Puppet, b: Browse, m: Built): void {
    b.phase = "leave";
    b.t = 0;
    const far = [...m.def.entries].sort((a, c) => dist(c[0], c[1], this.player.x, this.player.z) - dist(a[0], a[1], this.player.x, this.player.z))[0];
    const q = this.crowd.openNear(far[0], far[1]) ?? { x: far[0], z: far[1] };
    this.crowd.puppetGo(p, q.x, q.z);
  }

  /** What stands to be browsed at a market place now: the market stalls up, and the town's open stalls. */
  private targets(place: string): Target[] {
    const out: Target[] = [];
    const m = this.built.find((q) => q.def.place === place);
    if (m) for (let k = m.lo; k < m.hi; k++) {
      const it = m.items[k];
      out.push({ x: it.front.x, z: it.front.z, yaw: it.front.yaw, goods: it.goods, item: it, keeper: null });
    }
    for (const s of this.town.data?.stalls ?? []) {
      if (s.place !== place || !s.keeper || !this.openKeepers.has(s.keeper)) continue;
      out.push({ x: s.x + s.face[0] * 1.45, z: s.z + s.face[1] * 1.45, yaw: Math.atan2(-s.face[0], -s.face[1]), goods: s.goods as Goods, item: null, keeper: s.keeper });
    }
    return out;
  }

  /**
   * A townsperson on a market errand (town.ts): browse the stalls of `place`. False when
   * there is nothing to browse there (the town then does its own wander).
   */
  browse(p: Puppet, place: string, dt: number): boolean {
    const key = place.replace(/^market:/, "");
    let b = this.browsing.get(p);
    if (!b || b.place !== key) {
      if (!this.targets(key).length) return false;
      b = { place: key, phase: "pick", t: 0, target: null, visits: 0, want: 99, tries: 0, own: false };
      this.browsing.set(p, b);
    }
    this.step(p, b, dt);
    return true;
  }

  /** Let go of a townsperson (their day moved on). */
  forget(p: Puppet): void {
    const b = this.browsing.get(p);
    if (b && !b.own) this.browsing.delete(p);
  }

  /** One browser: pick a stall, walk up, look, haggle, maybe buy; then the next, or away. */
  private step(p: Puppet, b: Browse, dt: number): void {
    b.t -= dt;
    switch (b.phase) {
      case "pick": {
        if (b.t > 0) return;
        if (b.visits >= b.want) {
          const m = this.built.find((q) => q.def.place === b.place);
          if (m && b.own) this.leave(p, b, m);
          else b.visits = 0;
          return;
        }
        const ts = this.targets(b.place);
        // along the stalls: one near, now and then one further on
        const near = ts.filter((t) => dist(t.x, t.z, p.x, p.z) < (Math.random() < 0.7 ? 12 : 30) && dist(t.x, t.z, p.x, p.z) > 1);
        const t = near.length ? pickOf(near) : ts.length ? pickOf(ts) : null;
        if (!t) {
          b.t = 2;
          return;
        }
        const q = this.crowd.openNear(t.x + rnd(-0.3, 0.3), t.z + rnd(-0.3, 0.3));
        if (!q) {
          b.t = 1;
          return;
        }
        b.target = t;
        b.phase = "go";
        b.t = 30;
        b.tries = 0;
        this.crowd.puppetGo(p, q.x, q.z, rnd(0.8, 1.05));
        return;
      }
      case "go": {
        if (this.crowd.puppetBusy(p) && b.t > 0) return;
        const t = b.target!;
        if (dist(p.x, p.z, t.x, t.z) > 2.2) {
          // did not get there: another stall
          b.phase = "pick";
          b.t = rnd(0.5, 2);
          return;
        }
        // stop and look over the goods
        this.crowd.puppetStand(p, "idle", t.yaw);
        b.phase = "look";
        b.t = rnd(1.5, 3.5);
        return;
      }
      case "look":
        if (b.t > 0) return;
        if (Math.random() < 0.3) {
          // not what they want: walk on
          b.phase = "pick";
          b.visits++;
          b.t = rnd(0.3, 1.2);
          return;
        }
        // point and ask, haggle: the seller turns and answers
        this.crowd.puppetStand(p, "talk", b.target!.yaw);
        this.gesture(b.target!, p.x, p.z, 4);
        b.phase = "haggle";
        b.t = rnd(2.5, 4.5);
        return;
      case "haggle":
        if (b.t > 0) return;
        if (Math.random() < 0.6) {
          // bought: wrapped and handed over
          this.crowd.puppetCarry(p, BOUGHT[b.target!.goods] ?? "parcel");
          this.gesture(b.target!, p.x, p.z, 1.5);
        }
        this.crowd.puppetStand(p, "idle", b.target!.yaw);
        b.visits++;
        b.phase = "pick";
        b.t = rnd(0.8, 2);
        return;
      case "leave":
      case "gone":
        if (!this.crowd.puppetBusy(p)) b.phase = "gone";
        return;
    }
  }

  // ---------------------------------------------------------------- checks

  /** Points a path must reach while the market stands (main.ts paths(), through town.pathPoints()). */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const m of this.built) {
      for (let k = m.lo; k < m.hi; k++) {
        const it = m.items[k];
        out.push({ label: `market ${m.def.place} ${it.kind} ${k} (${it.goods})`, x: it.front.x, z: it.front.z, reach: 1.8 });
      }
    }
    return out;
  }

  /** Dev: the state of both markets. */
  info() {
    return this.built.map((m) => ({
      place: m.def.place,
      items: m.items.length,
      up: m.hi - m.lo,
      on: m.on,
      sellers: m.items.filter((it) => it.p).length,
      shoppers: m.shoppers.length,
      browsing: [...this.browsing.values()].filter((b) => b.place === m.def.place).map((b) => b.phase),
      colliders: m.colliders.size,
      meshes: m.batch.meshes.length + m.litter.meshes.length,
      layout: this.layoutInfo[m.def.place],
    }));
  }

  /** Dev: the layout, for a map. */
  items(place: string) {
    return this.built.find((m) => m.def.place === place)?.items.map((it) => ({ kind: it.kind, goods: it.goods, x: +it.x.toFixed(2), z: +it.z.toFixed(2), yaw: +it.yaw.toFixed(2), hl: it.hl, hd: it.hd, rank: it.rank })) ?? [];
  }

  /** Stray dogs like the fish scraps (animals.ts). */
  scrapSpots(): Array<{ x: number; z: number }> {
    return FIELDS.flatMap((f) => f.litter.filter(([n]) => n === "mk_scraps" || n === "mk_fishbox").map(([, x, z]) => ({ x, z })));
  }
}
