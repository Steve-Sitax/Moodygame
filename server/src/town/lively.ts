import type { DB } from "../db.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import INWORLD from "../../../shared/inworld_houses.json" with { type: "json" };
import { shownTrade, STATS, TAVERNS, TRADES, type Stat, type TradeId } from "./places.ts";
import { rngFrom, tidy, type Home, type Pt, type Resident, type Stats, type Town, type TownPlace } from "./population.ts";
import type { Seg } from "./schedule.ts";
import { walkPath } from "./lamplighters.ts";
import { offLanes } from "./possessions.ts";
import { dropTownCache, town } from "./store.ts";

// The back streets and the cathedral quarter (M6 lively, Steve 2026-09-24: "10 ideas are a
// go"). New townspeople, made by the ENGINE from the town's seed like the garrison (their own
// random stream, so the rest of the town stays as it was), each with a home, a trade and a day:
//
// - Dog carts: two milk women, and a boy from each bakery with the bread cart. Belgium's
//   "poor man's horse": a two-wheeled cart, copper cans, one or two dogs between the shafts.
//   A morning round of doors (and the milk women an evening one), a stop at each door.
// - Street sellers who walk the back streets, each with a cry: a knife grinder with his wheel
//   barrow, a rag-and-bone man and a coal man with their handcarts, a chimney sweep and his
//   boy, a mussel seller (her evening round with a lantern), a broom seller from the Kempen.
// - The stalls against the cathedral: in 1873 the houses on the Handschoenmarkt were being
//   pulled down (1865-75), while those on the Groenplaats side and along the Blauwmoezelstraat
//   still stood. So the stalls stand there: on the Groenplaats side (the lane west of the
//   church in this map) and one on the Blauwmoezelstraat side (east), with their keepers.
// - Two Black Sisters on their round of the sick, two beguines at mass and about the town,
//   two more beggars at the church doors, and three English travellers come to see the Rubens
//   paintings (shown for a franc, noon to four).
//
// A round is a list of stops in the back streets (work.route), each beside a house door,
// never on it (work.faces: the way to the door). Every stop is on ground you can walk to, and
// every leg between two stops is a real path on the walk map (with room for a cart for those
// who push one). The client (game/lively.ts) walks them, stops, calls, sells; unseen they keep
// the town's pace like everyone else.
//
// Save migration (ensureLively): an older save gets the same people a new game would, added
// in place after the last resident; every other resident, memory and relationship stays. Runs
// once (a town that has any of them is left alone).

const LIVELY_SALT = 0x11fe1873;

export const LIVELY_TRADES: readonly TradeId[] = ["milk_woman", "baker_boy", "grinder", "ragman", "coalman", "sweep", "mussel_seller", "broom_seller", "devotion_seller", "nun", "beguine", "tourist"];
export const isLively = (t: string): boolean => (LIVELY_TRADES as readonly string[]).includes(t);
/** One of the lively streets' people (their own ids: "lv001"...; the beggars they add are of the "beggar" trade). */
export const isLivelyId = (id: string): boolean => /^lv\d+$/.test(id);
/** Who pushes a handcart on the round (the crowd needs room for it). */
export const CART_TRADES = new Set<string>(["ragman", "coalman", "mussel_seller"]);
/** Who leads a dog cart. */
export const DOGCART_TRADES = new Set<string>(["milk_woman", "baker_boy"]);
/** The street sellers who cry their wares. */
export const CRIER_TRADES = new Set<string>(["milk_woman", "baker_boy", "grinder", "ragman", "coalman", "sweep", "mussel_seller", "broom_seller"]);

// ------------------------------------------------------------------ where

/**
 * The stalls against the cathedral. The church stands on its own ground (the map's apron): the
 * keeper stands at its edge, the counter before her on the lane, the lean-to roof over her back
 * to the church. (x, z) is where the keeper stands; yaw the way she faces (toward the lane).
 */
export const CHURCH_STALLS: Array<{ id: string; x: number; z: number; yaw: number; goods: "rosaries" | "candles" | "prints"; side: "groenplaats" | "blauwmoezel" }> = [
  { id: "stall_gp1", x: -302.2, z: 181.5, yaw: -Math.PI / 2, goods: "candles", side: "groenplaats" },
  { id: "stall_gp2", x: -302.2, z: 188.0, yaw: -Math.PI / 2, goods: "rosaries", side: "groenplaats" },
  { id: "stall_gp3", x: -302.2, z: 194.5, yaw: -Math.PI / 2, goods: "prints", side: "groenplaats" },
  { id: "stall_bm1", x: -222.3, z: 172.0, yaw: Math.PI / 2, goods: "candles", side: "blauwmoezel" },
];

/** Beggars at the church doors: either side of the west door, and by the south transept on the Groenplaats side. */
export const CHURCH_BEGGARS: Array<[number, number, number]> = [
  [-259.0, 144.2, Math.PI],
  [-265.0, 144.2, Math.PI],
  [-302.3, 219.0, -Math.PI / 2],
];

/**
 * Where the English travellers stop and what they look at: the spire from the Handschoenmarkt,
 * the west door, the Matsys well, the town hall, the Vleeshuis, the Steen, the church from the
 * Groenplaats side. [stand x, z, look at x, z]
 */
export const SIGHTS: Array<[number, number, number, number]> = [
  [-253, 124.5, -250, 160],
  [-262.5, 135, -262, 152],
  [-244, 134.6, -248, 137.5],
  [-264, 100, -285, 94],
  [-118, 80, -116, 99],
  [-182, 16, -177, -31],
  [-305.5, 204, -290, 210],
];

/**
 * The rounds of the dog carts and the street sellers: where each goes (a middle and a reach),
 * how many doors, and the stops' first door near the start. In the back streets: lanes, not
 * the quays or the big squares (see backStreet).
 */
interface RoundSpec {
  key: string;
  label: string;
  trade: TradeId;
  kind: string;
  sex: "m" | "f";
  age: [number, number];
  /** The middle of the round and how far it reaches. */
  at: Pt;
  reach: number;
  stops: number;
  district: string;
}
const ROUNDS: RoundSpec[] = [
  { key: "milk_east", label: "the back streets behind the Rijnkaai", trade: "milk_woman", kind: "milk_woman", sex: "f", age: [28, 52], at: [-10, 80], reach: 75, stops: 12, district: "rijnkaai" },
  { key: "milk_west", label: "the lanes round the cathedral", trade: "milk_woman", kind: "milk_woman", sex: "f", age: [30, 58], at: [-230, 190], reach: 90, stops: 12, district: "grote-markt" },
  // (the angled streets, 2026-09-25: the milk woman has the lanes behind the Rijnkaai; the boy the lanes by the Keizerspoort)
  { key: "bread_rijn", label: "the lanes toward the Keizerspoort", trade: "baker_boy", kind: "baker_boy", sex: "m", age: [12, 15], at: [20, 215], reach: 70, stops: 10, district: "canal" },
  { key: "bread_steen", label: "the lanes behind the Steenplein", trade: "baker_boy", kind: "baker_boy", sex: "m", age: [12, 15], at: [-190, 90], reach: 75, stops: 10, district: "steenplein" },
  { key: "grind", label: "the lanes round the cathedral", trade: "grinder", kind: "grinder", sex: "m", age: [40, 66], at: [-240, 180], reach: 100, stops: 10, district: "grote-markt" },
  { key: "rags", label: "the back streets by the Vleeshuis", trade: "ragman", kind: "ragman", sex: "m", age: [45, 70], at: [-110, 120], reach: 100, stops: 11, district: "vismarkt" },
  { key: "coal", label: "the back streets by the canal", trade: "coalman", kind: "coalman", sex: "m", age: [26, 50], at: [-40, 110], reach: 95, stops: 9, district: "canal" },
  { key: "sweep", label: "the lanes of the old town", trade: "sweep", kind: "sweep", sex: "m", age: [30, 50], at: [-170, 150], reach: 100, stops: 9, district: "vismarkt" },
  { key: "mussels", label: "the back streets by the Vismarkt", trade: "mussel_seller", kind: "fishwife_a", sex: "f", age: [34, 60], at: [-150, 80], reach: 95, stops: 11, district: "vismarkt" },
  { key: "brooms", label: "the lanes of the old town", trade: "broom_seller", kind: "docker_b", sex: "m", age: [36, 64], at: [-90, 150], reach: 110, stops: 10, district: "canal" },
  { key: "sick", label: "the sick of the parish", trade: "nun", kind: "nun", sex: "f", age: [30, 62], at: [-180, 150], reach: 120, stops: 7, district: "grote-markt" },
];

/** The Black Sisters' convent, the beguines' lodging (the beguinage lies beyond the map), the travellers' hotel, the dairy. */
const CONVENT_AT: Pt = [-150, 210];
const BEGUINES_AT: Pt = [60, 180];
/** The Hotel St-Antoine stood on the Place Verte (the Groenplaats), by the church. */
const HOTEL_AT: Pt = [-308, 250];

// ------------------------------------------------------------------ who

const MEN = ["Jan", "Pieter", "Frans", "Karel", "Hendrik", "Louis", "Constant", "Victor", "Emiel", "Theofiel", "Alfons", "Cornelis", "Willem", "Remi", "Achiel", "Petrus", "Jozef", "Rik", "Staf", "Lowie", "Toon", "Fons", "Lode", "Ward", "Dries", "Ferdinand"];
const WOMEN = ["Maria", "Anna", "Rosalie", "Josephine", "Joanna", "Catharina", "Theresia", "Paulina", "Coleta", "Barbara", "Mathilde", "Sidonie", "Leonie", "Trien", "Mie", "Stans", "Betje", "Nette", "Rosa", "Julie", "Irma"];
const SURNAMES = ["Van Dessel", "Peeraer", "Verbist", "Schoofs", "Van Asch", "Moorkens", "Dockx", "Goris", "Van Ham", "Bastiaens", "Van Nuffel", "Stoffels", "Hofkens", "Van Looy", "Meeus", "Bruyninckx", "Van Rompaey", "Verheyen", "Leysen", "Wauters", "Keysers", "Proost"];
/** Religious names of the Black Sisters. */
const SISTERS = ["Aldegonde", "Scholastica", "Gertrudis", "Walburga", "Monica", "Godelieve"];
const BEGUINES = [["Coleta", "Verbiest"], ["Isabella", "Van den Eynde"], ["Theresia", "Goossens"]];
const TOURISTS: Array<{ first: string; surname: string; sex: "m" | "f"; age: number; kind: string }> = [
  { first: "Arthur", surname: "Pemberton", sex: "m", age: 46, kind: "tourist" },
  { first: "Edith", surname: "Pemberton", sex: "f", age: 41, kind: "tourist_lady" },
  { first: "Charles", surname: "Whitcombe", sex: "m", age: 29, kind: "tourist" },
];
/** Names the game already uses for its own people. */
const TAKEN = new Set(["Jef", "Sooi", "Tuur", "Fientje", "Peeters", "Cools", "Verhulst", "Leentje", "Van Dyck"]);

export interface Lively {
  residents: Resident[];
  places: Record<string, TownPlace>;
}

// ------------------------------------------------------------------ rounds

/** How far you can see across the street from this door (the width of the lane in front of it). */
function across(d: HouseDoor): number {
  const wm = walkMap();
  for (let s = 1; s <= 24; s += 0.5) if (wm.flags(d.x + d.out[0] * s, d.z + d.out[1] * s) !== 0) return s;
  return 24;
}

/** A door in a back street: a lane or street under 14 m across, off the quays (z > 14) and off the lanes that must stay clear. */
export function backStreet(d: HouseDoor): boolean {
  return d.sz > 14 && across(d) < 14;
}

/**
 * Where a seller stops by a door: beside it along the wall (never on the step itself), out in
 * the lane a little, on open, reachable ground; `room` clear round it (a cart needs more).
 * The way to face: toward the door.
 */
export function stopBy(d: HouseDoor, side: 1 | -1, room: number): { at: Pt; yaw: number } | null {
  const wm = walkMap();
  const tx = -d.out[1] * side;
  const tz = d.out[0] * side;
  for (const along of [1.3, 1.7, 2.1])
    for (const out of [1.1, 1.5, 1.9]) {
      const x = Math.round((d.x + d.out[0] * out + tx * along) * 10) / 10;
      const z = Math.round((d.z + d.out[1] * out + tz * along) * 10) / 10;
      if (!wm.reachable(x, z) || !wm.open(x, z, room) || !offLanes(x, z, 0.3)) continue;
      return { at: [x, z], yaw: Math.round(Math.atan2(d.x - x, d.z - z) * 1000) / 1000 };
    }
  return null;
}

const plen = (p: Pt[]) => p.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0);

/**
 * A round of `n` doors near `at` (within `reach`), from the seller's own door: back-street
 * doors only, never two stops within 9 m, never a door someone else's round already uses
 * (`used`) nor a stop within 2.5 m of another round's (`usedStops`: two neighbours' doors can be
 * that close), in walking order (nearest first, then 2-opt), each leg a real path on the walk
 * map (`room` metres of clearance for a cart). Returns the stops, the way to face at each,
 * the houses and the walked length of the loop.
 */
export function buildRound(at: Pt, reach: number, n: number, start: Pt, rng: () => number, used: Set<number>, room: number, usedStops: Pt[] = []): { route: Pt[]; faces: number[]; houses: number[]; len: number } {
  const cands = houseDoors()
    // (a round with a cart keeps out of the back alleys: their lanes are too narrow, and asking the
    // walk map for a cart's way in searches the whole town before it says no)
    .filter((d) => !used.has(d.house) && Math.hypot(d.sx - at[0], d.sz - at[1]) < reach && !(room > 0.6 && d.alley) && backStreet(d))
    .map((d) => ({ d, k: rng() }))
    .sort((a, b) => a.k - b.k)
    .map((o) => o.d);
  const picked: Array<{ house: number; at: Pt; yaw: number }> = [];
  for (const d of cands) {
    if (picked.length >= n) break;
    const s = stopBy(d, rng() < 0.5 ? 1 : -1, room) ?? stopBy(d, 1, room) ?? stopBy(d, -1, room);
    if (!s || picked.some((p) => Math.hypot(p.at[0] - s.at[0], p.at[1] - s.at[1]) < 9)) continue;
    // a cart's way is found cell by cell (lamplighters.ts walkPath): the stop's own cell must have the room too,
    // or every leg from it fails (2026-09-25: the baker's boy's round of one stop on the angled streets)
    if (room > 0.6) {
      const wm = walkMap();
      const { x0, z0, res } = wm.info;
      const cx = x0 + (Math.floor((s.at[0] - x0) / res) + 0.5) * res;
      const cz = z0 + (Math.floor((s.at[1] - z0) / res) + 0.5) * res;
      if (!wm.open(cx, cz, room)) continue;
    }
    if (usedStops.some(([ux, uz]) => Math.hypot(ux - s.at[0], uz - s.at[1]) < 2.5)) continue;
    // not in front of another house's door (a stop never closes a door)
    if (houseDoors().some((o) => o.house !== d.house && Math.hypot(o.sx - s.at[0], o.sz - s.at[1]) < 1.1)) continue;
    picked.push({ house: d.house, ...s });
  }
  // walking order: nearest first from the start, then 2-opt on the loop
  const tour: typeof picked = [];
  let cur: Pt = start;
  const left = [...picked];
  while (left.length) {
    let bi = 0;
    for (let i = 1; i < left.length; i++) if (Math.hypot(left[i].at[0] - cur[0], left[i].at[1] - cur[1]) < Math.hypot(left[bi].at[0] - cur[0], left[bi].at[1] - cur[1])) bi = i;
    const [p] = left.splice(bi, 1);
    tour.push(p);
    cur = p.at;
  }
  const D = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  for (let pass = 0; pass < 8; pass++) {
    let better = false;
    for (let i = 1; i < tour.length - 1; i++)
      for (let j = i + 1; j < tour.length; j++) {
        const a = tour[i - 1].at;
        const b = tour[i].at;
        const c = tour[j].at;
        const e = tour[(j + 1) % tour.length].at;
        if (D(a, c) + D(b, e) < D(a, b) + D(c, e) - 0.01) {
          tour.splice(i, j - i + 1, ...tour.slice(i, j + 1).reverse());
          better = true;
        }
      }
    if (!better) break;
  }
  // keep only stops the last kept stop can walk to (with room for the cart); the loop closes back to the first
  const kept: typeof tour = [];
  let walked: Pt[] = [];
  for (const p of tour) {
    const from = kept.length ? kept[kept.length - 1].at : null;
    if (from) {
      const leg = walkPath(from[0], from[1], p.at[0], p.at[1], 400_000, room > 0.6 ? room : 0);
      if (!leg) continue;
      walked = walked.concat(leg.slice(1));
    } else walked = [p.at];
    kept.push(p);
  }
  if (kept.length > 1) {
    const back = walkPath(kept[kept.length - 1].at[0], kept[kept.length - 1].at[1], kept[0].at[0], kept[0].at[1], 400_000, room > 0.6 ? room : 0);
    if (back) walked = walked.concat(back.slice(1));
  }
  return { route: kept.map((p) => p.at), faces: kept.map((p) => p.yaw), houses: kept.map((p) => p.house), len: Math.round(plen(walked)) };
}

// ------------------------------------------------------------------ the generator

/**
 * The lively streets' people for a town: the same town seed and residents always give the
 * same people. `residents` is the town as it is (their ids are their own, "lv001"..., names
 * stay unique, homes are free house doors).
 */
export function generateLively(seed: number, places: Record<string, TownPlace>, residents: Resident[], kept: number[] = []): Lively {
  // the rounds' paths take half a second to find: the same town gives the same people, so keep them
  const key = `${seed}:${residents.length}:${residents.map((r) => r.id).join(",")}:${kept.join(",")}`;
  const had = memo.get(key);
  if (had) return structuredClone(had);
  const made = makeLively(seed, places, residents, kept);
  memo.set(key, made);
  return structuredClone(made);
}
const memo = new Map<string, Lively>();
const INWORLD_SET = new Set((INWORLD as { houses: Array<{ house: number }> }).houses.map((e) => e.house));

function makeLively(seed: number, places: Record<string, TownPlace>, residents: Resident[], kept: number[]): Lively {
  const rng = rngFrom((seed ^ LIVELY_SALT) >>> 0);
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const wm = walkMap();
  const snap = (x: number, z: number, max = 8): Pt => {
    const q = wm.nearestOpen(x, z, max);
    return q ? [q.x, q.z] : [x, z];
  };
  const j = (h: number, s = 0.25) => Math.round((h + (rng() * 2 - 1) * s) * 4) / 4;

  const outPlaces: Record<string, TownPlace> = {};
  const all = (id: string) => outPlaces[id] ?? places[id];
  const out: Resident[] = [];
  const usedNames = new Set(residents.map((r) => r.name));
  const usedHouses = new Set(residents.map((r) => r.home.house).filter((h) => h >= 0));
  // the houses whose insides stand in the world (taverns, the rooms to rent) are not for the street sellers
  // (2026-09-25: on the angled streets a seller moved into the empty alley home)
  for (const e of (INWORLD as { houses: Array<{ house: number }> }).houses) usedHouses.add(e.house);
  // and the houses kept empty for other uses: the homes to let (2026-09-26 audit: a milk woman moved into the merchant's floor)
  for (const h of kept) usedHouses.add(h);
  // doors people already step out of or work at: nobody new moves in on top of them
  const takenPts: Pt[] = [];
  for (const r of residents) {
    takenPts.push([r.home.sx, r.home.sz]);
    if (r.work.door) takenPts.push(r.work.door);
  }
  for (const p of Object.values(places)) if (p.door) takenPts.push(p.door);
  // ids of their own ("lv001"...), so the ids other parts give in place ("r..." after the last) stay as they were
  let nextId = residents.reduce((m, r) => Math.max(m, /^lv\d+$/.test(r.id) ? Number(r.id.slice(2)) : 0), 0) + 1;
  let household = residents.reduce((m, r) => Math.max(m, r.household), 0);
  const doors = houseDoors();

  /** A free house door near a point (nobody lives there, no door of work next to it); else the nearest free one anywhere. */
  const freeDoorNear = (x: number, z: number): HouseDoor => {
    const byD = doors
      .filter((d) => !usedHouses.has(d.house) && !takenPts.some(([tx, tz]) => Math.hypot(tx - d.sx, tz - d.sz) < 4))
      .map((d) => ({ d, k: Math.hypot(d.sx - x, d.sz - z) }))
      .sort((a, b) => a.k - b.k);
    // none free: share the nearest house, never one kept for its own use (an in-world house, a home to let)
    const near = (qs: HouseDoor[]) => qs.map((q) => ({ q, k: Math.hypot(q.sx - x, q.sz - z) })).sort((a, b) => a.k - b.k)[0]?.q;
    const d = byD[0]?.d ?? near(doors.filter((q) => !kept.includes(q.house) && !INWORLD_SET.has(q.house))) ?? near(doors)!;
    usedHouses.add(d.house);
    takenPts.push([d.sx, d.sz]);
    return d;
  };
  const homeAt = (d: HouseDoor): Home => ({ house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz });

  const statsFor = (trade: TradeId, age: number): Stats => {
    const def = TRADES[trade];
    const s = {} as Stats;
    for (const k of STATS) {
      let v = 5 + (rng() + rng() + rng() - 1.5) * 4 + (def.bias?.[k as Stat] ?? 0);
      if (age >= 55 && (k === "piety" || k === "gossip")) v += 1;
      if (age < 25 && k === "courage") v += 1;
      if (age < 15 && k === "gossip") v -= 2;
      s[k as Stat] = Math.max(0, Math.min(10, Math.round(v)));
    }
    s.wealth = int(def.wealth[0], def.wealth[1]);
    return s;
  };
  const nameFor = (sex: "m" | "f", surname?: string): { first: string; surname: string } => {
    for (let i = 0; i < 80; i++) {
      const first = pick(sex === "m" ? MEN : WOMEN);
      const sur = surname ?? pick(SURNAMES);
      if (TAKEN.has(first) || TAKEN.has(sur)) continue;
      if (!usedNames.has(`${first} ${sur}`)) {
        usedNames.add(`${first} ${sur}`);
        return { first, surname: sur };
      }
    }
    const sur = `${pick(SURNAMES)} ${nextId}`;
    return { first: pick(sex === "m" ? MEN : WOMEN), surname: sur };
  };
  const add = (p: { trade: TradeId; kind: string; sex: "m" | "f"; age: number; home: Home; hh: number; role?: string; work: Resident["work"]; name?: { first: string; surname: string; full?: string } }): Resident => {
    const nm = p.name ?? nameFor(p.sex);
    const full = p.name?.full ?? `${nm.first} ${nm.surname}`;
    usedNames.add(full);
    const r: Resident = {
      id: `lv${String(nextId++).padStart(3, "0")}`,
      first: nm.first,
      surname: nm.surname,
      name: full,
      age: p.age,
      sex: p.sex,
      household: p.hh,
      family_role: p.role ?? "single",
      trade: p.trade,
      faction: TRADES[p.trade].faction,
      kind: p.kind,
      home: p.home,
      work: p.work,
      sched: { day: [], sunday: [] },
      stats: statsFor(p.trade, p.age),
      dog: null,
    };
    out.push(r);
    return r;
  };
  const taverns = TAVERNS.map((t) => `tavern:${t.id}`).filter((k) => all(k));
  const nearestOf = (keys: string[], p: Pt) => keys.filter((k) => all(k)).reduce((b, k) => (Math.hypot(all(k).x - p[0], all(k).z - p[1]) < Math.hypot(all(b).x - p[0], all(b).z - p[1]) ? k : b), keys.filter((k) => all(k))[0]);
  const plays = Object.keys({ ...places, ...outPlaces }).filter((k) => k.startsWith("play:"));
  const markets = Object.keys({ ...places, ...outPlaces }).filter((k) => k.startsWith("market:"));
  const churchSeg = (r: Resident, from: number, to: number): Seg[] => (r.stats.piety >= 4 ? [[j(from), j(to), "church", "church"]] : []);

  // --- the rounds: dog carts, street sellers, the Black Sisters
  const roundHouses = new Set<number>();
  const roundStops: Pt[] = [];
  const bakeries = ["bakery_rijn", "bakery_steen"];
  const bakerHome = (shop: string): Resident | undefined => residents.find((r) => r.work.shop === shop && r.trade === "baker") ?? residents.find((r) => r.work.shop === shop);
  let sweepMaster: Resident | null = null;
  for (const spec of ROUNDS) {
    const cart = CART_TRADES.has(spec.trade) || DOGCART_TRADES.has(spec.trade);
    let home: Home;
    let hh: number;
    let role = "head";
    if (spec.trade === "baker_boy") {
      // the baker's boy lives with the baker's family, over the bakery
      const shop = bakeries[spec.key === "bread_rijn" ? 0 : 1];
      const baker = bakerHome(shop);
      if (!baker) continue;
      home = { ...baker.home };
      hh = baker.household;
      role = "apprentice";
    } else if (spec.trade === "nun") {
      home = homeAt(freeDoorNear(...CONVENT_AT));
      hh = ++household;
      role = "sister";
    } else {
      home = homeAt(freeDoorNear(spec.at[0], spec.at[1]));
      hh = ++household;
      role = spec.sex === "f" ? pick(["head", "widow"]) : "head";
    }
    const placeId = `round:${spec.key}`;
    const round = buildRound(spec.at, spec.reach, spec.stops, [home.sx, home.sz], rng, roundHouses, cart ? 1.1 : 0.5, roundStops);
    for (const h of round.houses) roundHouses.add(h);
    roundStops.push(...round.route);
    const [px, pz] = round.route[0] ?? [home.sx, home.sz];
    outPlaces[placeId] = { label: spec.label, x: px, z: pz, r: spec.reach, district: spec.district };
    const work: Resident["work"] = { place: placeId, kind: "round", route: round.route, faces: round.faces };
    const count = spec.trade === "nun" ? 2 : 1;
    const pair: Resident[] = [];
    const sister0 = Math.floor(rng() * SISTERS.length);
    for (let k = 0; k < count; k++) {
      const age = int(spec.age[0], spec.age[1]);
      const name =
        spec.trade === "nun"
          ? (() => {
              const sister = SISTERS[(sister0 + k) % SISTERS.length];
              const fam = nameFor("f");
              return { first: sister, surname: fam.surname, full: `Sister ${sister}` };
            })()
          : undefined;
      const r = add({ trade: spec.trade, kind: spec.kind, sex: spec.sex, age, home, hh, role, work: { ...work, route: work.route!.map((q) => [...q] as Pt), faces: [...work.faces!] }, name });
      pair.push(r);
      const tavern = taverns.length ? nearestOf(taverns, [home.sx, home.sz]) : null;
      const play = nearestOf(plays, [home.sx, home.sz]);
      const market = nearestOf(markets, [home.sx, home.sz]);
      let day: Seg[] = [];
      let sunday: Seg[] = [];
      switch (spec.trade) {
        case "milk_woman":
          // milk every morning, Sundays too, and a second round before supper on weekdays
          day = [[j(5.75), j(9.5), "work"], [j(10), j(11), "market", market], [j(15.75), j(17.5), "work"]];
          sunday = [[j(6), j(8.5), "work"], ...churchSeg(r, 9, 11)];
          break;
        case "baker_boy":
          // the morning bread, and the afternoon rolls; then he plays with the others till supper
          day = [[j(6.25), j(9.25), "work"], [j(14.5), j(16), "work"], [j(16.5), j(18), "play", play]];
          sunday = [[j(7), j(8.75), "work"], [j(9), j(11), "church", "church"], [j(14), j(17), "play", play]];
          break;
        case "grinder":
          day = [[j(8.75), 12, "work"], [j(13.25), j(17), "work"], ...(tavern ? [[j(19), j(21.5), "tavern", tavern] as Seg] : [])];
          sunday = [...churchSeg(r, 9, 11), ...(tavern ? [[j(16), j(20), "tavern", tavern] as Seg] : [])];
          break;
        case "ragman":
          day = [[j(8), 12, "work"], [j(13), j(16.5), "work"], ...(tavern ? [[j(18.5), j(21), "tavern", tavern] as Seg] : [])];
          sunday = [[j(14), j(17), "loiter", play]];
          break;
        case "coalman":
          day = [[j(7), 12, "work"], [j(13), j(16), "work"], ...(tavern ? [[j(18.5), j(21), "tavern", tavern] as Seg] : [])];
          sunday = [...churchSeg(r, 9, 11), [j(15), j(17), "stroll", play]];
          break;
        case "sweep":
          day = [[j(7), 12, "work"], [j(13), j(16.5), "work"]];
          sunday = [...churchSeg(r, 9, 11), [j(14.5), j(17), "stroll", play]];
          break;
        case "mussel_seller":
          // mussels for dinner, and again at dusk with a lantern over the basket
          day = [[j(10), j(12.75), "work"], [j(16.5), j(20), "work"]];
          sunday = [...churchSeg(r, 9, 11)];
          break;
        case "broom_seller":
          day = [[j(9), 12, "work"], [j(13), j(16.5), "work"]];
          sunday = [[j(8.75), j(11), "church", "church"]];
          break;
        case "nun":
          // mass in the convent chapel at dawn; then the sick, two by two
          day = [[j(9, 0), 12, "work"], [j(14, 0), j(17, 0), "work"]];
          sunday = [[8.75, 11, "church", "church"], [14.5, 16.5, "work"]];
          break;
      }
      r.sched = { day: tidy(day), sunday: tidy(sunday) };
      if (spec.trade === "sweep") sweepMaster = r;
    }
    // two Black Sisters go together (a pair keeps one day)
    if (pair.length === 2) {
      pair[1].sched = { day: pair[0].sched.day.map((s) => [...s] as Seg), sunday: pair[0].sched.sunday.map((s) => [...s] as Seg) };
      pair[0].mate = pair[1].id;
      pair[1].mate = pair[0].id;
    }
  }
  // the sweep's boy climbs the flues: he walks at his master's side (a pair keeps one day)
  if (sweepMaster) {
    const m = sweepMaster as Resident;
    const boy = add({ trade: "sweep", kind: "sweep_boy", sex: "m", age: int(9, 12), home: m.home, hh: m.household, role: "apprentice", work: { ...m.work, route: m.work.route!.map((q) => [...q] as Pt), faces: [...m.work.faces!] } });
    boy.sched = { day: m.sched.day.map((s) => [...s] as Seg), sunday: m.sched.sunday.map((s) => [...s] as Seg) };
    boy.mate = m.id;
    m.mate = boy.id;
  }

  // --- the stalls against the cathedral, and their keepers
  for (const st of CHURCH_STALLS) {
    const d = freeDoorNear(st.x, st.z);
    const home = homeAt(d);
    const hh = ++household;
    const [x, z] = snap(st.x, st.z, 2);
    const placeId = `stall:${st.id}`;
    outPlaces[placeId] = { label: st.side === "groenplaats" ? "the stalls against the cathedral on the Groenplaats side" : "the stall against the cathedral in the Blauwmoezelstraat", x, z, r: 3, district: "grote-markt" };
    const old = rng() < 0.5;
    const r = add({ trade: "devotion_seller", kind: old ? "old_woman" : pick(["shopwife", "wife_b"]), sex: "f", age: old ? int(58, 74) : int(34, 56), home, hh, role: old ? "widow" : "head", work: { place: placeId, kind: "post", at: [x, z, st.yaw] } });
    r.sched = {
      day: tidy([[j(8), 12.5, "work"], [13.5, j(18), "work"]]),
      // Sunday: the masses bring the most buyers
      sunday: tidy([[j(6.75), 12.75, "work"], [13.5, j(17), "work"]]),
    };
  }

  // --- two more beggars at the church doors (the town's own beggar keeps his place)
  {
    const hasWest = residents.filter((r) => r.trade === "beggar" && r.work.place === "cathedral").length;
    CHURCH_BEGGARS.slice(hasWest ? 1 : 0, (hasWest ? 1 : 0) + 2).forEach(([bx, bz, yaw], i) => {
      const d = freeDoorNear(-230 + i * 40, 250);
      const home = homeAt(d);
      const female = i === 0;
      const [x, z] = snap(bx, bz, 1.5);
      const r = add({ trade: "beggar", kind: female ? "old_woman" : "beggar", sex: female ? "f" : "m", age: int(48, 76), home, hh: ++household, role: female ? "widow" : "single", work: { place: "cathedral", kind: "beg", at: [x, z, yaw] } });
      r.sched = { day: tidy([[j(7.5), 12, "work"], [13, j(19), "work"]]), sunday: tidy([[6.5, 13, "work"], [14, j(19), "work"]]) };
    });
  }

  // --- two beguines: mass at the cathedral, errands, a walk round the church
  {
    const d = freeDoorNear(...BEGUINES_AT);
    const home = homeAt(d);
    const hh = ++household;
    for (const [first, surname] of BEGUINES.slice(0, 2)) {
      const r = add({ trade: "beguine", kind: "beguine", sex: "f", age: int(38, 70), home, hh, role: "single", name: { first, surname }, work: { place: "home", kind: "inside", door: [home.sx, home.sz] } });
      r.stats.piety = Math.max(r.stats.piety, 8);
      r.sched = {
        day: tidy([[j(8.25, 0), j(9.75, 0), "church", "church"], [10, j(11.25), "market", nearestOf(markets, [-254, 94])], [j(15, 0), j(16.5, 0), "stroll", "play:handschoenmarkt"]]),
        sunday: tidy([[8.25, 11, "church", "church"], [15, 17, "stroll", "play:handschoenmarkt"]]),
      };
    }
  }

  // --- the English travellers: a husband and wife, and a young man alone, at the Hotel St-Antoine
  {
    const d = freeDoorNear(...HOTEL_AT);
    const home = homeAt(d);
    const route = SIGHTS.map(([x, z]) => snap(x, z, 3));
    const faces = SIGHTS.map(([, , lx, lz], i) => Math.round(Math.atan2(lx - route[i][0], lz - route[i][1]) * 1000) / 1000);
    outPlaces["round:sights"] = { label: "the sights of Antwerp", x: route[0][0], z: route[0][1], r: 60, district: "grote-markt" };
    const hhCouple = ++household;
    const hhSingle = ++household;
    const party: Resident[] = [];
    for (const t of TOURISTS) {
      const couple = t.surname === "Pemberton";
      const r = add({ trade: "tourist", kind: t.kind, sex: t.sex, age: t.age, home, hh: couple ? hhCouple : hhSingle, role: couple ? (t.sex === "m" ? "husband" : "wife") : "single", name: { first: t.first, surname: t.surname }, work: { place: "round:sights", kind: "round", route: route.map((q) => [...q] as Pt), faces: [...faces] } });
      r.origin = couple ? "London" : "Manchester";
      party.push(r);
      // the paintings are shown from noon to four, for a franc: they go in after the morning's sights
      r.sched = {
        day: tidy([[j(9.5), 12, "work"], [12, j(13.25), "church", "church"], [j(14.25), j(17), "work"]]),
        sunday: tidy([[j(11.5), 13, "work"], [j(14.5), j(16.5), "work"]]),
      };
    }
    // the wife walks at her husband's side; the young man keeps his own day
    party[1].sched = { day: party[0].sched.day.map((s) => [...s] as Seg), sunday: party[0].sched.sunday.map((s) => [...s] as Seg) };
    party[0].mate = party[1].id;
    party[1].mate = party[0].id;
  }
  return { residents: out, places: outPlaces };
}

// ------------------------------------------------------------------ the save

/**
 * Give a save the lively streets' people (once): the same people a new game with this town's
 * seed would have, added after the last resident. Adds rows only (npc, npc_relationship,
 * resident) and their places to the town's world_state; every existing resident, memory,
 * relationship and Jef stay as they were. Returns how many were added.
 */
export function ensureLively(db: DB): number {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return 0;
  const q = `SELECT COUNT(*) AS n FROM resident WHERE trade IN (${LIVELY_TRADES.map(() => "?").join(", ")})`;
  if ((db.prepare(q).get(...LIVELY_TRADES) as { n: number }).n > 0) return 0;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  if (!row) return 0;
  const rest = JSON.parse(row.value_json) as Omit<Town, "residents">;
  const residents = town(db).town.residents;
  const homes = db.prepare("SELECT value_json FROM world_state WHERE key = 'homes'").get() as { value_json: string } | undefined;
  const kept = homes ? (JSON.parse(homes.value_json) as { homes?: Array<{ house: number }> }).homes?.map((h) => h.house) ?? [] : [];
  const g = generateLively(rest.seed, rest.places, residents, kept);
  const insNpc = db.prepare("INSERT OR IGNORE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let added = 0;
  db.transaction(() => {
    const places = { ...rest.places, ...g.places };
    for (const r of g.residents) {
      if (hasNpc.get(r.id)) continue; // an id taken by something else: never overwrite
      const district = places[r.work.place]?.district ?? "town";
      insNpc.run(r.id, r.name, shownTrade(r), district, r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
      added++;
    }
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places }));
  })();
  dropTownCache(db);
  return added;
}

/** What a lively townsperson is doing at work, in words (town/talk.ts). */
export function roundDoing(r: Resident, placeLabel: string): string {
  switch (r.trade) {
    case "milk_woman":
      return `on your milk round of ${placeLabel}, your dogs in the cart's harness, the cans full`;
    case "baker_boy":
      return `taking the bread round ${placeLabel} with the dog cart`;
    case "grinder":
      return `pushing your grinding barrow round ${placeLabel}, sharpening knives and scissors at the doors`;
    case "ragman":
      return `on your round of ${placeLabel} with the handcart, buying rags, bones and old iron`;
    case "coalman":
      return `carrying coal to the doors of ${placeLabel}`;
    case "sweep":
      return `sweeping chimneys in ${placeLabel}, black from head to foot`;
    case "mussel_seller":
      return `crying fresh mussels through ${placeLabel}`;
    case "broom_seller":
      return `selling brooms from door to door in ${placeLabel}`;
    case "nun":
      return `visiting ${placeLabel}, nursing them in their homes`;
    case "tourist":
      return "seeing the sights of Antwerp with a red guidebook in hand";
    default:
      return `on your round of ${placeLabel}`;
  }
}
