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
import type { Town } from "./town";

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
type Goods = "fish" | "veg" | "bread" | "wares" | "cloth" | "cheese" | "baskets" | "junk";
type Kind = "stall" | "table" | "bench" | "barrow" | "cart" | "baskets";

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
      [0.34, "stall", "fish"], [0.15, "bench", "fish"], [0.1, "table", "fish"], [0.14, "baskets", "fish"], [0.07, "barrow", "fish"],
      [0.06, "stall", "veg"], [0.03, "table", "bread"], [0.05, "baskets", "veg"], [0.04, "cart", "veg"],
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
      [0.2, "stall", "veg"], [0.12, "stall", "cheese"], [0.1, "stall", "junk"], [0.08, "stall", "baskets"], [0.07, "stall", "cloth"], [0.08, "table", "veg"],
      [0.06, "table", "cheese"], [0.06, "table", "junk"], [0.08, "baskets", "veg"], [0.06, "barrow", "veg"], [0.05, "cart", "veg"], [0.04, "stall", "bread"],
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
};
const SHOPPERS: HumanKind[] = ["maid", "wife_a", "wife_b", "old_woman", "maid", "fishwife_b", "gentleman", "docker_b", "sailor_b", "clerk", "wife_a", "girl_b"];
/** What a buyer walks off with. */
const BOUGHT: Record<Goods, "fish" | "parcel" | "sack" | "basket"> = {
  fish: "fish", veg: "sack", bread: "parcel", wares: "parcel", cloth: "parcel", cheese: "parcel", baskets: "basket", junk: "parcel",
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
  /** Its place in the order stalls go up. */
  rank: number;
  /** The seller's body when Jef is near. */
  p: Puppet | null;
  talkT: number;
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
    const placed: Array<{ x: number; z: number; c: number; s: number; hl: number; hd: number }> = [];

    /** Is a box (centre, yaw, half extents, with a margin behind and before) free? */
    const why: Record<string, number> = {};
    const no = (k: string) => {
      why[k] = (why[k] ?? 0) + 1;
      return false;
    };
    const fits = (x: number, z: number, yaw: number, hl: number, back: number, front: number): boolean => {
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      for (let u = -hl; u <= hl + 1e-6; u += Math.max(0.3, hl / 4)) {
        for (let v = -back; v <= front + 1e-6; v += 0.35) {
          const px = x + u * c + v * s;
          const pz = z - u * s + v * c;
          // the body and the seller's room must be on the square; the customers may stand on its edge
          const body = v < front - 1.0;
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
            if (Math.abs(lu) < q.hl + 0.15 && lv > -q.hd - 0.15 && lv < q.hd + 0.15) return no("another stall");
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
    const LEN: Record<Kind, [number, number]> = { stall: [2.2, 3.1], table: [1.6, 1.6], bench: [2.2, 2.2], barrow: [2.1, 2.1], cart: [2.8, 2.8], baskets: [1.5, 2.1] };
    const DEPTH: Record<Kind, number> = { stall: 0.72, table: 0.4, bench: 0.42, barrow: 0.42, cart: 0.7, baskets: 0.45 };
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
        if (s + len > total + 0.3) break;
        const c = at(s + len / 2);
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
        const hd = DEPTH[kind];
        tried++;
        if (!fits(x, z, yaw, len / 2, hd + 1.3, hd + 1.35)) {
          s += 0.7;
          continue;
        }
        const it = this.makeItem(kind, goods, x, z, yaw, len / 2, hd, R);
        items.push(it);
        placed.push({ x, z, c: Math.cos(yaw), s: Math.sin(yaw), hl: len / 2, hd: hd + 1.25 });
        byKind[`${kind} ${goods}`] = (byKind[`${kind} ${goods}`] ?? 0) + 1;
        // now and then a passage between stalls, else a narrow gap
        s += len + (R() < 0.1 ? 1.8 + R() * 0.8 : 0.2 + R() * 0.45);
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
      const hd = DEPTH[kind];
      tried++;
      if (!fits(x, z, yaw, len / 2, hd + 1.0, hd + 1.2)) continue;
      items.push(this.makeItem(kind, goods, x, z, yaw, len / 2, hd, R));
      placed.push({ x, z, c: Math.cos(yaw), s: Math.sin(yaw), hl: len / 2, hd: hd + 1.0 });
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
    // striped red, striped blue, or plain canvas (sackcloth), each in many shades
    const awnings = ["awning_red", "awning_blue", "awning_red", "awning_blue", "sackcloth"].map((n) => mats.get(n)).filter((m): m is THREE.Material => !!m);
    for (const it of items) {
      this.dress(batch, it, stallParts, trades, awnings, R);
      batch.next();
    }
    batch.build(group, def.place);
    const litter = new Batch();
    for (const [name, x, z, yaw] of def.litter) litter.put(trades.parts.get(name), x, 0, z, yaw);
    litter.build(group, `${def.place}_litter`);
    batch.window(0, 0);
    this.layoutInfo[def.place] = { items: items.length, tried, byKind, why };
    return { def, items, batch, litter, group, lo: 0, hi: 0, colliders: new Set(), shoppers: [], on: false };
  }

  private makeItem(kind: Kind, goods: Goods, x: number, z: number, yaw: number, hl: number, hd: number, R: () => number): Item {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const w = (u: number, v: number): P => [x + u * c + v * s, z - u * s + v * c];
    const box = (u0: number, u1: number, v0: number, v1: number, top: number): Rect => {
      const ps = [w(u0, v0), w(u1, v0), w(u0, v1), w(u1, v1)];
      return { minX: Math.min(...ps.map((p) => p[0])), maxX: Math.max(...ps.map((p) => p[0])), minZ: Math.min(...ps.map((p) => p[1])), maxZ: Math.max(...ps.map((p) => p[1])), top };
    };
    const kinds = SELLERS[goods];
    const sellerKind = kinds[Math.floor(R() * kinds.length)];
    const sits = sellerKind === "old_man";
    const back = hd + 0.5;
    const [sx, sz] = w(R() * 0.6 - 0.3, -back);
    const [fx, fz] = w(R() * 0.8 - 0.4, hd + 0.75);
    const rects: Rect[] = [];
    // a stall table's frame, split in two along its length (an AABB of a turned box is fat)
    const top = kind === "baskets" ? 0.5 : kind === "barrow" ? 0.7 : 1.1;
    rects.push(box(-hl, 0, -hd, hd, top), box(0, hl, -hd, hd, top));
    return {
      kind, goods, x, z, yaw, hl, hd, rects, sellerKind, sits, rank: 0, p: null, talkT: R() * 5,
      seller: { x: sx, z: sz, yaw },
      front: { x: fx, z: fz, yaw: yaw + Math.PI },
    };
  }

  /** Put an item's models into the batch: the stall, its goods, crates, a stool, a gull. */
  private dress(b: Batch, it: Item, sp: Map<string, Part[]>, tr: TradeModels, awnings: THREE.Material[], R: () => number): void {
    const c = Math.cos(it.yaw);
    const s = Math.sin(it.yaw);
    const at = (u: number, v: number): P => [it.x + u * c + v * s, it.z - u * s + v * c];
    const put = (parts: Part[] | undefined, u: number, y: number, v: number, dyaw = 0, sc: [number, number, number] = [1, 1, 1], tint?: [number, number, number], swap?: (m: THREE.Material) => THREE.Material) => {
      const [x, z] = at(u, v);
      b.put(parts, x, y, z, it.yaw + dyaw, sc, tint, swap);
    };
    const T = tr.parts;
    const shade = 0.82 + R() * 0.3;
    const tint: [number, number, number] = [shade * (0.92 + R() * 0.16), shade * (0.92 + R() * 0.16), shade * (0.92 + R() * 0.16)];
    const goodsOn = (y: number, v: number, sx: number) => {
      if (it.goods === "cheese" || it.goods === "baskets" || it.goods === "junk") put(T.get(`mk_goods_${it.goods}`), 0, y, v, 0, [Math.min(1.2, sx), 1, 1]);
    };
    switch (it.kind) {
      case "stall": {
        const sx = (it.hl * 2) / 2.8;
        const sy = 0.93 + R() * 0.14;
        put(sp.get("stall_frame"), 0, 0, 0, 0, [sx, sy, 1]);
        const aw = awnings[Math.floor(R() * awnings.length)];
        const tw: [number, number, number] = [0.75 + R() * 0.4, 0.75 + R() * 0.35, 0.75 + R() * 0.4];
        put(sp.get("stall_awning"), 0, 0, 0, 0, [sx, sy, 1], tw, (m) => (m.name === "awning_red" && aw ? aw : m));
        const g = it.goods === "cheese" || it.goods === "baskets" || it.goods === "junk" ? null : sp.get(`stall_goods_${it.goods}`);
        if (g) put(g, 0, 0, 0, 0, [sx, sy, 1]);
        else goodsOn(0.85 * sy, 0, sx);
        break;
      }
      case "table": {
        put(sp.get("shop_table"), 0, 0, -0.6, 0, [1, 0.95 + R() * 0.1, 1], tint);
        const g = it.goods === "cheese" || it.goods === "baskets" || it.goods === "junk" || it.goods === "cloth" ? null : sp.get(`shop_goods_${it.goods}`);
        if (g) put(g, 0, 0, -0.6);
        else goodsOn(0.8, 0, 1);
        break;
      }
      case "bench":
        put(T.get("mk_bench"), 0, 0, 0);
        break;
      case "barrow":
        put(T.get(it.goods === "fish" ? "mk_barrow_fish" : "mk_barrow_veg"), 0, 0, 0, Math.PI / 2 + (R() - 0.5) * 0.3);
        break;
      case "cart":
        put(T.get("mk_cart"), -0.4, 0, 0, Math.PI / 2 + (R() - 0.5) * 0.2);
        break;
      case "baskets": {
        const n = it.hl > 0.9 ? 2 : 1;
        for (let i = 0; i < n; i++) put(T.get(it.goods === "fish" ? "mk_basket_fish" : "mk_basket_veg"), (i - (n - 1) / 2) * 0.95 - 0.2, 0, 0.05, R() * 6);
        break;
      }
    }
    // behind: crates stacked (fish boxes on the fish market), the seller's stool; now and then a gull
    if (it.kind !== "barrow" && R() < 0.75) put(T.get(it.goods === "fish" ? "mk_crates" : R() < 0.5 ? "mk_crates" : "mk_basket_tall"), (R() < 0.5 ? -1 : 1) * (it.hl - 0.35), 0, -it.hd - 0.7, (R() - 0.5) * 0.6);
    if (it.sits) put(T.get("mk_stool"), 0, 0, -it.hd - 0.5);
    if (it.goods === "fish" && it.kind !== "baskets" && R() < 0.2) put(T.get("mk_gull"), (R() - 0.5) * it.hl, it.kind === "stall" ? 0.86 : it.kind === "bench" ? 0.8 : 0.62, 0.1, R() * 6);
    if (it.goods === "fish" && R() < 0.35) put(T.get("mk_fishbox"), (R() < 0.5 ? -1 : 1) * (it.hl + 0.1), 0, it.hd + 0.2, (R() - 0.5) * 0.8);
    if (it.goods === "veg" && R() < 0.3) put(T.get("mk_leaves"), 0, 0, it.hd + 0.8, R() * 6);
  }

  // ---------------------------------------------------------------- every frame

  update(dt: number, player: { x: number; z: number }, day: number, hour: number): void {
    if (!this.ready) return;
    this.player = { x: player.x, z: player.z };
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
      m.on = marketOn(m.def.place, day, hour);
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
      const p = this.crowd.addPuppet(it.sellerKind, it.seller.x, it.seller.z, it.seller.yaw, 1);
      if (!p) return;
      it.p = p;
      if (it.sits) this.crowd.puppetSit(p, it.seller.yaw);
      else this.crowd.puppetStand(p, "idle", it.seller.yaw);
    }
  }

  /** A seller calls out now and then, and turns to a buyer who haggles. */
  private sellerStep(it: Item, dt: number): void {
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
    m.shoppers = m.shoppers.filter((p) => this.crowd.alive(p));
    const want = m.on && d < SHOPPER_R ? MAX_SHOPPERS : 0;
    if (m.shoppers.length < want) {
      const entries = m.def.entries.filter(([x, z]) => this.crowd.isHidden(x, z) && this.crowd.onGrid(x, z));
      const e = entries.length ? pickOf(entries) : null;
      if (e) {
        const at = this.crowd.canStand(e[0], e[1]) ? { x: e[0], z: e[1] } : this.crowd.openNear(e[0], e[1]);
        const p = at && this.crowd.addPuppet(pickOf(SHOPPERS), at.x, at.z, 0, rnd(0.95, 1.2));
        if (p) {
          m.shoppers.push(p);
          this.browsing.set(p, { place: m.def.place, phase: "pick", t: rnd(0, 1), target: null, visits: 0, want: 2 + Math.floor(Math.random() * 3), tries: 0, own: true });
        }
      }
    }
    for (const p of m.shoppers) {
      const b = this.browsing.get(p);
      if (!b) continue;
      if (!m.on && b.phase !== "leave" && b.phase !== "gone") this.leave(p, b, m);
      if ((b.phase === "gone" || b.phase === "leave") && (this.crowd.isHidden(p.x, p.z) || b.t < -40)) {
        this.browsing.delete(p);
        this.crowd.removePuppet(p);
      }
    }
    if (d > SHOPPER_R + 20) {
      for (const p of m.shoppers) {
        this.browsing.delete(p);
        this.crowd.removePuppet(p);
      }
      m.shoppers = [];
    }
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
