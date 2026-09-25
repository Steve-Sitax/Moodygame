import type { DB } from "../db.ts";
import { log } from "../game.ts";
import { remember } from "../npcs.ts";
import { dropTownCache, town, TOWN_EMPLOYER_IDS } from "./store.ts";
import { houseDoors, walkMap } from "./walkmap.ts";
import type { Resident, TownPlace } from "./population.ts";
import { cartHooks, deedRow, dropStealables, stealables, veloHooks, type Velo, type VeloState } from "./deeds.ts";
import { berthOf, rowBoats } from "../rowing.ts";
import { activityAt } from "./schedule.ts";
import { dayKeys, placeKey, scheduleLoad, vehicleAt, WALK_MAX_M, type Act, type Load, type Pt } from "./transport.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import { doorKeepOut, type Rect } from "../../../shared/hallPlan.ts";
import { doorKeepOut as cathedralKeep } from "../../../shared/cathedralPlan.ts";
import { PLAN as TOWNHALL } from "../../../shared/townhallPlan.ts";
import { PLAN as VLEESHUIS } from "../../../shared/vleeshuisPlan.ts";
import { PLAN as OOSTERSHUIS } from "../../../shared/oostershuisPlan.ts";
import { PLAN as STEEN } from "../../../shared/steenPlan.ts";

// Who owns what (M6 transport, Steve 2026-09-24). The ENGINE gives the households their
// velocipedes, handcarts, drays and rowing boats, by trade and wealth, once, from the town's
// seed: a save made before this gets them in place on its next start (world_state
// 'transport'); nothing else in the save changes.
//
// - Velocipedes: rare and dear in 1873. The six of M3h (the merchants, the brewer, a
//   draper or the pawnbroker, the publican of Den Engel, a clerk at the Entrepot: town/
//   deeds.ts) and a few more for well-off young men and a few clerks who go far in their day.
// - Handcarts: the carters, the market women and fishwives, the grocers, the second-hand
//   dealer: one per household, by the door.
// - Drays with a horse: the three drays of the quay traffic (world/traffic.ts) belong to two
//   carters and a merchant; they stand in the yard when the owner's day is done.
// - Rowing boats: the three boats tied up at quay steps (rowing.ts), owned by boatmen and quay
//   households; they row goods to another flight once a day.
//
// Each velocipede and handcart has its spot at home and a spot at each place of its owner's
// day it may be taken to ("parks"), on open ground with room round it, off the omnibus lanes,
// the drays' rounds, the quay railway and the crane runways. Where an owner's velocipede
// stands now follows his day (transport.ts vehicleAt): the server says it for theft
// (deeds.ts veloHooks), the client parks it there.

/** 4: nothing parks before a landmark's doorway or on its steps, and further from a tavern door (M7 doors, 2026-09-25). */
export const TRANSPORT_V = 4;

export type Spot = [number, number, number];

export interface Vehicle {
  id: string;
  kind: "velocipede" | "handcart" | "dray" | "boat";
  owner: string;
  household: number;
  /** Where it stands at home: x, z, yaw (a velocipede along the wall; a cart's shafts to the street). */
  home: Spot;
  /** Where it stands at each place of the owner's day it is taken to (place keys: transport.ts placeKey). */
  parks: Record<string, Spot>;
  /** A dray: its round of the quay traffic (world/traffic.ts). A boat: its kind and berth. */
  route?: string;
  boat?: { kind: "rowboat" | "punt"; landing: Pt; flight: Pt };
  /** "the Van Gorp family's handcart" */
  label: string;
}

export interface TransportRecord {
  v: number;
  seed: number;
  /** Velocipedes added to the six of M3h (the young men and the clerks), as M3h velos. */
  extraVelos: Velo[];
  vehicles: Vehicle[];
}

// ------------------------------------------------------------------ the record

function readRecord(db: DB): TransportRecord | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'transport'").get() as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as TransportRecord;
  } catch {
    return null;
  }
}
function saveRecord(db: DB, r: TransportRecord): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('transport', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(r));
}

const memo = new WeakMap<DB, TransportRecord | null>();
export function transportRecord(db: DB): TransportRecord | null {
  if (memo.has(db)) return memo.get(db)!;
  const r = readRecord(db);
  memo.set(db, r);
  return r;
}
export function dropTransport(db: DB): void {
  memo.delete(db);
}

// ------------------------------------------------------------------ where things may stand

type Seg2 = [number, number, number, number];
/** Lanes to keep clear (x0, z0, x1, z1 segments with a half width): the omnibus rounds (world/omnibus.ts), the drays' rounds (world/traffic.ts), the quay railway and the crane runways (city.json). */
const LANES: Array<{ s: Seg2; half: number }> = (() => {
  const out: Array<{ s: Seg2; half: number }> = [];
  const poly = (pts: Pt[], half: number, loop: boolean) => {
    for (let i = 0; i < pts.length - (loop ? 0 : 1); i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      out.push({ s: [a[0], a[1], b[0], b[1]], half });
    }
  };
  // the omnibus rounds (copied from world/omnibus.ts QUAY_ROUTE and TOWN_ROUTE; keep in step)
  poly([[-305, 29.5], [-305, 8.3], [-158, 8.3], [-152, 7.6], [-140, 7.6], [-134, 8.3], [-90, 8.3], [-84, 7.8], [-68, 7.8], [-62, 8.3], [66, 8.3], [76, 15], [76, 37], [-54, 37], [-58, 33], [-58, 12], [-62, 8.3], [-204, 8.3], [-204, 29.5]], 2.4, true);
  poly([[-84.5, 20], [-96, 20], [-96, 38], [-89.5, 45], [-89.5, 114], [-149, 114], [-149, 126.2], [-238, 126.2], [-238, 70], [-280, 70], [-280, 129.8], [-145, 129.8], [-145, 208.5], [-84.5, 208.5]], 2.4, true);
  // the drays' and handcarts' rounds (world/traffic.ts TRAFFIC_ROUTES)
  poly([[33, 69.5], [33, 108.5], [-4.75, 108.5], [-4.75, 69.5]], 2.2, true);
  poly([[120, 11], [158.6, 11], [158.6, 43], [120, 43]], 2.2, true); // (M6 handcart: moved off the farrier's forge)
  poly([[-305, 8.3], [-216, 8.3], [-216, 30], [-305, 30]], 2.2, true);
  poly([[74, 119.5], [168, 119.5], [176, 122], [196, 122]], 1.8, false);
  const decor = (CITY as unknown as { decor?: { tracks?: Array<{ pts: Pt[] }>; crane_rails?: Seg2[] } }).decor ?? {};
  for (const t of decor.tracks ?? []) poly(t.pts, 1.8, false);
  for (const c of decor.crane_rails ?? []) out.push({ s: c, half: 3.2 });
  return out;
})();

function segDist(x: number, z: number, [ax, az, bx, bz]: Seg2): number {
  const dx = bx - ax;
  const dz = bz - az;
  const L = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L));
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t));
}
/** Off every lane that must stay clear (plus a margin for the thing itself). */
export function offLanes(x: number, z: number, margin = 0.9): boolean {
  for (const l of LANES) if (segDist(x, z, l.s) < l.half + margin) return false;
  return true;
}

/** Stalls, shop tables and doors: nothing parks on them (set while a record is made). */
let keepOff: Array<[number, number, number]> = [];
/**
 * The landmarks' doorways, their porch steps and the street before them (shared/hallPlan.ts doorKeepOut,
 * as the client's world/doorKeep.ts): nothing parks there, `m` metres for the thing's own size.
 */
const DOOR_KEEP: Rect[] = [...[TOWNHALL, VLEESHUIS, OOSTERSHUIS, STEEN].flatMap((p) => doorKeepOut(p)), ...cathedralKeep()];
export const onDoorway = (x: number, z: number, m = 0.6) => DOOR_KEEP.some((r) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m);

const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * A spot near (x, z) for a thing to stand: open ground with `room` metres clear round it (so
 * it never closes a lane or a door), reachable, off the lanes, not on `taken` spots.
 */
function spotNear(x: number, z: number, room: number, taken: Spot[], maxR = 9, yaw?: number, minR = 0): Spot | null {
  const wm = walkMap();
  for (let r = minR; r <= maxR; r += 0.5) {
    const n = r === 0 ? 1 : Math.max(8, Math.round(r * 5));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + r;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (!wm.open(px, pz, room) || !wm.reachable(px, pz) || !offLanes(px, pz)) continue;
      if (taken.some((t) => Math.hypot(t[0] - px, t[1] - pz) < 2.4)) continue;
      if (keepOff.some(([kx, kz, kr]) => Math.hypot(kx - px, kz - pz) < kr) || onDoorway(px, pz)) continue;
      return [r1(px), r1(pz), r3(yaw ?? 0)];
    }
  }
  return null;
}

/**
 * By a house door, along the wall: a velocipede leans there (side +1), a handcart stands on
 * the other side with its shafts to the street. Room enough round it to pass.
 */
function besideDoor(r: Resident, side: 1 | -1, room: number, taken: Spot[], cart = false): Spot | null {
  const d = houseDoors().find((h) => h.house === r.home.house);
  const out: Pt = d ? d.out : norm([r.home.sx - r.home.x, r.home.sz - r.home.z]);
  const x0 = d ? d.x : r.home.x;
  const z0 = d ? d.z : r.home.z;
  const along: Pt = [-out[1] * side, out[0] * side];
  const wm = walkMap();
  for (const o of cart ? [1.4, 1.8, 2.2] : [1.0, 1.25]) {
    for (const s of [2.0, 2.8, 3.6, 4.4]) {
      const x = x0 + out[0] * o + along[0] * s;
      const z = z0 + out[1] * o + along[1] * s;
      if (!wm.open(x, z, room) || !wm.reachable(x, z) || !offLanes(x, z)) continue;
      if (taken.some((t) => Math.hypot(t[0] - x, t[1] - z) < 2.4)) continue;
      if ((cart && keepOff.some(([kx, kz, kr]) => Math.hypot(kx - x, kz - z) < kr)) || onDoorway(x, z)) continue;
      // a velocipede along the wall; a cart's shafts out to the street (it points into the house)
      const yaw = cart ? Math.atan2(-out[0], -out[1]) : Math.atan2(along[0], along[1]);
      return [r1(x), r1(z), r3(yaw)];
    }
  }
  return spotNear(r.home.sx + out[0] * 1.5, r.home.sz + out[1] * 1.5, room, taken, 8, cart ? Math.atan2(-out[0], -out[1]) : Math.atan2(along[0], along[1]));
}
const norm = (v: Pt): Pt => {
  const L = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / L, v[1] / L];
};

/** A point of the day: where a resident goes for this place key (as town.ts goalFor, roughly). */
export function keyPoint(r: Resident, key: string, places: Record<string, TownPlace>): Pt | null {
  if (key === "home") return [r.home.sx, r.home.sz];
  const [act, ...rest] = key.split(":");
  const place = rest.join(":");
  if (act === "work") {
    const w = r.work;
    if (w.at) return [w.at[0], w.at[1]];
    if (w.door) return w.door;
    if (w.a) return w.a;
    if (w.route?.length) return w.route[0];
    const p = places[w.place];
    return p ? [p.x, p.z] : null;
  }
  const p = places[act === "church" ? "church" : place];
  return p ? [p.x, p.z] : null;
}

/** Every place key of a resident's week. */
function weekKeys(r: Resident): string[] {
  const keys = new Set<string>();
  for (const day of [1, 7]) for (const k of dayKeys(r, day)) if (k.key !== "home") keys.add(k.key);
  return [...keys];
}

/** Is the move from key a to key b a long one (the straight line over WALK_MAX_M)? */
export function farFor(r: Resident, places: Record<string, TownPlace>) {
  return (a: string, b: string): boolean => {
    const p = keyPoint(r, a, places);
    const q = keyPoint(r, b, places);
    return !!p && !!q && Math.hypot(p[0] - q[0], p[1] - q[1]) > WALK_MAX_M;
  };
}

// ------------------------------------------------------------------ who owns what

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The richest member of each household (its wealth). */
function householdWealth(rs: Resident[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const r of rs) m.set(r.household, Math.max(m.get(r.household) ?? 0, r.stats.wealth));
  return m;
}

/** Does this resident's week hold a long trip (so a velocipede would be ridden)? */
function goesFar(r: Resident, places: Record<string, TownPlace>): boolean {
  const far = farFor(r, places);
  for (const day of [1, 7]) {
    let prev = "home";
    for (const k of dayKeys(r, day)) {
      if (k.key !== prev && far(prev, k.key)) return true;
      prev = k.key;
    }
  }
  return false;
}

/** Trades whose households keep a handcart (with its user). */
const CART_TRADES = ["carter", "market_woman", "fishwife", "grocer", "dealer", "chandler"];
/** A few trades that ride to work, and the clerks. */
const VELO_TRADES = ["clerk", "post_clerk", "registrar", "customs", "cellar_master", "painter"];

/**
 * Make the record for this town, from its seed (the same town always gets the same things).
 * Pure but for reading the town and the walk map.
 */
export function makeTransport(db: DB): TransportRecord {
  const t = town(db).town;
  const R = t.residents;
  const places = t.places;
  const wealth = householdWealth(R);
  const order = (a: Resident, b: Resident) => hashStr(a.id + t.seed) - hashStr(b.id + t.seed);
  const taken: Spot[] = [];
  // the stalls, the shop tables and the sellers behind them, the doors of the town's places
  keepOff = [
    ...t.stalls.map((q) => [q.x, q.z, 3.2] as [number, number, number]),
    ...t.shops.map((q) => [q.wall[0], q.wall[1], 3.2] as [number, number, number]),
    ...Object.values(places).filter((p) => p.door).map((p) => [p.door![0], p.door![1], 1.8] as [number, number, number]),
    // a tavern's door and its step (M7 doors: walked into): more room than a house door
    ...Object.entries(places).filter(([k, p]) => k.startsWith("tavern:") && p.door).map(([, p]) => [p.door![0], p.door![1], 3.0] as [number, number, number]),
    // the gas lamps' posts
    ...(((CITY as unknown as { decor?: { lamps?: Pt[] } }).decor?.lamps ?? []) as Pt[]).map(([x, z]) => [x, z, 1.2] as [number, number, number]),
    // every house door of the town and its workplaces: nothing stands in front of a door
    ...R.map((r) => [r.home.sx, r.home.sz, 1.7] as [number, number, number]),
    ...R.filter((r) => r.work.door).map((r) => [r.work.door![0], r.work.door![1], 1.7] as [number, number, number]),
  ];

  // --- velocipedes beyond the six of M3h: a few well-off young men and a few trades, who go far
  const m3h = new Set<string>();
  {
    // the M3h list without extras (the hook is off while we choose)
    const keep = veloHooks.extra;
    veloHooks.extra = () => [];
    dropStealables(db);
    for (const v of stealables(db).velos) {
      m3h.add(v.owner);
      taken.push([v.x, v.z, v.yaw]);
    }
    veloHooks.extra = keep;
    dropStealables(db);
  }
  const extraVelos: Velo[] = [];
  const addExtra = (r: Resident, where: string) => {
    // the board's employers stand at their posts (people.ts): they never walk the town
    if (m3h.has(r.id) || TOWN_EMPLOYER_IDS.includes(r.id) || extraVelos.some((v) => v.owner === r.id)) return;
    const s = besideDoor(r, 1, 0.45, taken);
    if (!s) return;
    taken.push(s);
    extraVelos.push({ id: `velo:x${extraVelos.length + 1}`, owner: r.id, x: s[0], z: s[1], yaw: s[2], where });
  };
  // the town is small: few go further than WALK_MAX_M in their day. Of those, the men of some
  // means (a natie man is a shareholder of his nation, not a day docker), the youngest first
  const NOT = new Set(["thief", "soldier", "sentry", "corporal", "police", "priest", "beggar", "emigrant", "runner", "child", "street_child", "errand_boy"]);
  const young = R.filter((r) => r.sex === "m" && r.age >= 17 && r.age <= 52 && (wealth.get(r.household) ?? 0) >= 3 && !NOT.has(r.trade) && goesFar(r, places)).sort((a, b) => a.age - b.age || order(a, b));
  for (const r of young) if (extraVelos.length < 3) addExtra(r, "from outside his house");
  const trades = R.filter((r) => r.sex === "m" && r.age >= 18 && r.age < 55 && VELO_TRADES.includes(r.trade) && goesFar(r, places)).sort(order);
  for (const r of trades) if (extraVelos.length < 5) addExtra(r, "from outside his house");
  // (the velocipede maker's own machines are the ones on show at his door: bikeshop.ts)

  const vehicles: Vehicle[] = [];
  const byId = new Map(R.map((r) => [r.id, r]));
  const surname = (r: Resident) => r.surname;

  // all velocipedes (M3h and the new): home is where M3h put it (or by the door), and a spot at each place he rides to
  {
    const keep = veloHooks.extra;
    veloHooks.extra = () => extraVelos;
    dropStealables(db);
    for (const v of stealables(db).velos) {
      const r = byId.get(v.owner);
      if (!r) continue;
      const parks: Record<string, Spot> = { home: [v.x, v.z, v.yaw] };
      // a spot at every place of his week: once out, the machine goes where he goes (a long way
      // from home takes it out; none: it never leaves the house, and needs no other spot)
      const rides = goesFar(r, places);
      for (const key of rides ? weekKeys(r) : []) {
        const p = keyPoint(r, key, places);
        if (!p) continue;
        const s = spotNear(p[0], p[1], 0.45, taken, 16);
        if (!s) continue;
        taken.push(s);
        parks[key] = s;
      }
      vehicles.push({ id: v.id, kind: "velocipede", owner: r.id, household: r.household, home: [v.x, v.z, v.yaw], parks, label: `${r.name}'s velocipede` });
    }
    veloHooks.extra = keep;
    dropStealables(db);
  }

  // handcarts: one per household that works with one, by trade and wealth (the poorest carry by hand)
  const carts = new Map<number, Resident>();
  for (const r of R.slice().sort(order)) {
    if (!CART_TRADES.includes(r.trade) || r.age < 16) continue;
    if (carts.has(r.household)) continue;
    if ((wealth.get(r.household) ?? 0) < 1 && r.trade !== "carter") continue;
    carts.set(r.household, r);
  }
  for (const [hh, r] of carts) {
    const home = besideDoor(r, -1, 1.25, taken, true);
    if (!home) continue;
    taken.push(home);
    const parks: Record<string, Spot> = { home };
    for (const key of weekKeys(r)) {
      if (!key.startsWith("work")) continue;
      const p = keyPoint(r, key, places);
      if (!p) continue;
      // beside the stall or the door, never on it
      const s = spotNear(p[0], p[1], 1.25, taken, 12, r.work.at ? r.work.at[2] + Math.PI / 2 : 0, 2.5);
      if (!s) continue;
      taken.push(s);
      parks[key] = s;
    }
    vehicles.push({ id: `cart:${hh}`, kind: "handcart", owner: r.id, household: hh, home, parks, label: `the ${surname(r)} family's handcart` });
  }

  // drays: the three of the quay traffic, to two carters and a merchant (their yards are on the rounds)
  {
    const carters = R.filter((r) => r.trade === "carter" && r.age >= 20).sort(order);
    const merchants = R.filter((r) => r.trade === "merchant").sort(order);
    const owners: Array<[string, Resident | undefined, Spot]> = [
      ["rijnkaai_back", carters[0], [14, 108.5, Math.PI / 2]],
      ["eilandje", merchants[0] ?? carters[2], [137.5, 43, Math.PI / 2]],
      ["werf", carters[1] ?? merchants[1], [-249, 8.3, Math.PI / 2]],
    ];
    for (const [route, r, yard] of owners) {
      if (!r) continue;
      vehicles.push({ id: `dray:${route}`, kind: "dray", owner: r.id, household: r.household, home: yard, parks: { home: yard }, route, label: `${r.name}'s dray` });
    }
  }

  // rowing boats: the boats tied up at quay steps (rowing.ts), their owners' households
  for (const b of rowBoats(db)) {
    const r = byId.get(b.owner);
    if (!r) continue;
    vehicles.push({
      id: b.id,
      kind: "boat",
      owner: r.id,
      household: r.household,
      home: [b.x, b.z, b.yaw],
      parks: { home: [b.x, b.z, b.yaw] },
      boat: { kind: b.kind, landing: b.landing, flight: FLIGHT_OF[b.id] ?? b.landing },
      label: `${r.name}'s ${b.kind === "punt" ? "punt" : "rowing boat"}`,
    });
  }
  return { v: TRANSPORT_V, seed: t.seed, extraVelos, vehicles };
}

/** The top of each boat's flight of steps (rowing.ts LOOSE). */
const FLIGHT_OF: Record<string, Pt> = { "boat:canal": [-70, 38], "boat:cartstand": [50, 0], "boat:north": [186, 0] };

/**
 * The flights of quay steps a family boat can land at (world/rijnkaai.ts FLIGHTS: top, the
 * way down, and the water side), by water: the river, the canal, the Petit Bassin. The Werf's
 * own flight cannot be walked to.
 */
export const FLIGHTS: Array<{ id: string; label: string; top: Pt; t: Pt; n: Pt; water: "river" | "canal" | "bassin" }> = [
  { id: "vismarkt", label: "the Vismarkt steps", top: [-110, 0], t: [-1, 0], n: [0, -1], water: "river" },
  { id: "rijnkaai", label: "the Rijnkaai steps", top: [-4, 0], t: [-1, 0], n: [0, -1], water: "river" },
  { id: "cartstand", label: "the steps by the cart stand", top: [50, 0], t: [1, 0], n: [0, -1], water: "river" },
  { id: "north", label: "the steps north of the lock", top: [186, 0], t: [1, 0], n: [0, -1], water: "river" },
  { id: "canal", label: "the canal steps", top: [-70, 38], t: [0, 1], n: [-1, 0], water: "canal" },
  { id: "bassin", label: "the Petit Bassin steps", top: [90, 46], t: [1, 0], n: [0, 1], water: "bassin" },
  { id: "bassin_north", label: "the north steps of the Petit Bassin", top: [116, 110], t: [1, 0], n: [0, -1], water: "bassin" },
];

/** A berth beside a flight's landing (as rowing.ts berthOf), for a family boat. */
export function flightBerth(id: string): { x: number; z: number; yaw: number; landing: Pt; top: Pt } | null {
  const f = FLIGHTS.find((q) => q.id === id);
  if (!f) return null;
  const b = berthOf({ top: f.top, t: f.t, n: f.n });
  return { ...b, top: f.top };
}

// ------------------------------------------------------------------ the migration

/**
 * Give this town its vehicles, once (a new game, or a save from before M6 transport). Adds
 * the record 'transport' to world_state only; residents, memories, Jef and the M3h velocipede
 * states stay as they were. Returns what it made.
 */
export function ensureTransport(db: DB): { made: boolean; vehicles: number } {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (!has) return { made: false, vehicles: 0 };
  const seed = town(db).town.seed;
  const had = readRecord(db);
  if (had && had.v === TRANSPORT_V && had.seed === seed) {
    memo.set(db, had);
    // leave the town unread, as the other ensure steps do (a later step may change a resident's row)
    dropTownCache(db);
    return { made: false, vehicles: had.vehicles.length };
  }
  memo.delete(db);
  const rec = makeTransport(db);
  saveRecord(db, rec);
  memo.set(db, rec);
  dropStealables(db);
  dropTownCache(db);
  return { made: true, vehicles: rec.vehicles.length };
}

// ------------------------------------------------------------------ now

export function vehicleOf(db: DB, id: string): Vehicle | undefined {
  return transportRecord(db)?.vehicles.find((v) => v.id === id);
}

export function vehiclesOf(db: DB, household: number): Vehicle[] {
  return transportRecord(db)?.vehicles.filter((v) => v.household === household) ?? [];
}

/** Is a move from key a to key b one with a load, for a cart (the schedule says so by trade)? */
export function loadFor(r: Resident): (a: string, b: string) => boolean {
  return (a, b) => !!scheduleLoad(r.trade, r.stats.wealth, a, b);
}

/**
 * Where a vehicle stands now by its owner's day: the key of the place and the spot. For a
 * handcart the load decides (it stays at the stall between loads); a velocipede goes with its
 * owner once it is out.
 */
export function vehicleNow(db: DB, v: Vehicle, day: number, hour: number): { key: string; spot: Spot; moving: boolean } {
  const r = town(db).byId.get(v.owner);
  if (!r || v.kind === "dray" || v.kind === "boat") return { key: "home", spot: v.home, moving: false };
  const places = town(db).town.places;
  const cart = v.kind === "handcart";
  // a cart only moves with a load or home again; a velocipede follows its owner once out
  const at = vehicleAt(r, day, hour, cart ? () => false : farFor(r, places), v.parks, cart ? loadFor(r) : () => false, !cart);
  return { key: at.at, spot: v.parks[at.at] ?? v.home, moving: at.moving };
}

/** The clock now (game day 1-7, hour with fraction). */
export function clockNow(db: DB): { day: number; hour: number } {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return { day: p.day, hour: p.hour + p.minute / 60 };
}

// the M3h velocipedes follow their owners (deeds.ts asks here)
veloHooks.extra = (db) => transportRecord(db)?.extraVelos ?? [];
veloHooks.at = (db, v) => {
  const rec = vehicleOf(db, v.id);
  if (!rec) return null;
  const { day, hour } = clockNow(db);
  const n = vehicleNow(db, rec, day, hour);
  return { x: n.spot[0], z: n.spot[1], yaw: n.spot[2] };
};

// ------------------------------------------------------------------ the owner finds it gone

/**
 * The owner went to take his velocipede and it was not there (Jef has it: an open deed).
 * He walks, and he is cross: once per deed, a memory (the theft's own rules made the rest).
 */
export function ownerMissed(db: DB, veloId: string, states: Record<string, VeloState>): boolean {
  const st = states[veloId];
  const v = vehicleOf(db, veloId);
  if (!st || !v || st.deed === null || st.own) return false;
  const d = deedRow(db, st.deed);
  if (!d || d.status !== "open") return false;
  const key = `missed:${veloId}:${st.deed}`;
  if (db.prepare("SELECT 1 FROM world_state WHERE key = ?").get(key)) return false;
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, 'true')").run(key);
  remember(db, v.owner, "I went to take my velocipede and it was gone. I had to walk, and I was late.", 4);
  log(db, "walked", v.owner, `${town(db).byId.get(v.owner)?.name ?? "Someone"} found the velocipede gone and had to walk.`);
  return true;
}

// ------------------------------------------------------------------ errands with a load

export interface Errand {
  id: string;
  kind: "boat" | "dray";
  vehicle: string;
  /** Who goes: the owner first, then the family who come along. */
  who: string[];
  /** Game hours: out, and back. */
  hour: number;
  back: number;
  /** Where to: a flight of steps (boat) or a door (dray). */
  to: Pt;
  toLabel: string;
  load: Load;
}

/**
 * The day's errands with a load (engine-made from the seed and the day, the same on both
 * sides): each family boat rows two sacks to another flight on its own water and back in the
 * morning; each dray goes out from its yard to a shop door with a load once a day. None on Sunday.
 */
export function errandsFor(db: DB, day: number): Errand[] {
  const rec = transportRecord(db);
  if (!rec || day % 7 === 0) return [];
  const t = town(db).town;
  const out: Errand[] = [];
  const home = (r: Resident, h: number) => activityAt(r.sched, day, h).act === "home";
  for (const v of rec.vehicles) {
    const r = t.residents.find((q) => q.id === v.owner);
    if (!r) continue;
    const h0 = 7.5 + (hashStr(`${v.id}:${day}:${t.seed}`) % 7) * 0.5;
    if (v.kind === "boat") {
      const mine = FLIGHTS.find((f) => Math.hypot(f.top[0] - (v.boat?.flight[0] ?? 1e9), f.top[1] - (v.boat?.flight[1] ?? 1e9)) < 1);
      if (!mine) continue;
      const others = FLIGHTS.filter((f) => f.water === mine.water && f.id !== mine.id && Math.hypot(f.top[0] - mine.top[0], f.top[1] - mine.top[1]) > 40);
      if (!others.length) continue;
      const to = others[hashStr(`${v.id}:to:${day}`) % others.length];
      // part of the owner's day (the errand takes him from home or from his work); the family who are home come along
      const crew = t.residents.filter((q) => q.household === r.household && q.id !== r.id && q.age >= 12 && home(q, h0) && home(q, h0 + 1.5)).slice(0, 2);
      out.push({ id: `errand:${v.id}:${day}`, kind: "boat", vehicle: v.id, who: [r.id, ...crew.map((q) => q.id)], hour: h0, back: h0 + 2.5, to: mine.water === "river" ? to.top : to.top, toLabel: to.label, load: { what: "sacks", items: 2 } });
    } else if (v.kind === "dray") {
      // a shop or a stall place near its round: the nearest shop door to the yard
      const shops = t.shops.slice().sort((a, b) => Math.hypot(a.door[0] - v.home[0], a.door[1] - v.home[1]) - Math.hypot(b.door[0] - v.home[0], b.door[1] - v.home[1]));
      const shop = shops[hashStr(`${v.id}:${day}`) % Math.min(3, shops.length || 1)];
      if (!shop) continue;
      out.push({ id: `errand:${v.id}:${day}`, kind: "dray", vehicle: v.id, who: [r.id], hour: h0 + 2, back: h0 + 3.5, to: shop.door, toLabel: shop.label, load: { what: "sacks", items: 3 } });
    }
  }
  return out;
}

/** For the client: the vehicles, where each stands now and whether it is there to be used. */
export function transportView(db: DB, states: Record<string, VeloState>) {
  const rec = transportRecord(db);
  const { day, hour } = clockNow(db);
  if (!rec) return { vehicles: [], errands: [], day };
  return {
    day,
    vehicles: rec.vehicles.map((v) => {
      const st = v.kind === "velocipede" ? states[v.id] : undefined;
      // Jef has it (taken and not given back): the owner walks
      const gone = (!!st && (st.deed !== null || st.ridden)) || (v.kind === "handcart" && cartHooks.gone(db, v.id));
      const now = vehicleNow(db, v, day, hour);
      return { ...v, gone, at: now.key };
    }),
    errands: errandsFor(db, day),
  };
}

/** Test helper: the keys of a day as the engine sees them. */
export function keysOf(r: Resident, day: number): Array<{ from: number; to: number; key: string; act: Act }> {
  return dayKeys(r, day).map((k) => ({ ...k, act: (k.key === "home" ? "home" : k.key.split(":")[0]) as Act }));
}
export { placeKey };
