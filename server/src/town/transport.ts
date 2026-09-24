// How townspeople get about (M6 transport). Pure code with no imports: the server
// uses it (where an owner's velocipede stands now, the tests) and the client imports
// the same file to move the town (game/journeys.ts). The ENGINE owns every number
// here; no model ever picks a mode.
//
// Steve, 2026-09-24: "Make sure NPCs can use transportation to where they want to go if
// applicable. If they need to go far and have a bike, use bike. But if they need to carry
// a big load, use a cart. Other family members can help load carts if multiple items.
// NPCs can also take the omnibus, no ride fee for them. Or they can take a boat also, for
// loads if they own one or multiple people move."
//
// The rules, in order (chooseMode):
//   1. a load: the household's boat when both ends lie by the water of one basin, else the
//      dray for a big load (3 things or more), else the handcart, else the dray; with none
//      of them, they carry what they can on foot;
//   2. several of one family going the same way along the water, with a boat: they row;
//   3. a short trip (up to WALK_MAX_M): walk;
//   4. a long trip with the velocipede where the trip starts: ride it;
//   5. a long trip with an omnibus stop near both ends, when the ride is quicker: the
//      omnibus (walk to the stop, wait, ride, walk on; no fare for residents);
//   6. else walk.

export type Pt = [number, number];
export type Mode = "walk" | "velocipede" | "omnibus" | "handcart" | "dray" | "boat";
export type VehicleKind = "velocipede" | "handcart" | "dray" | "boat";

/** Longer than this (metres, as the crow flies) is a long trip. */
export const WALK_MAX_M = 300;
/** Pace of each way of going (m/s, as the street sees it). */
export const SPEED: Record<Mode, number> = { walk: 1.3, velocipede: 4.2, omnibus: 3.2, handcart: 0.95, dray: 1.2, boat: 1.3 };
/** The streets are not straight: a walk is about this much longer than the straight line. */
export const DETOUR = 1.35;
/** An omnibus stop this near the start and the goal (metres). */
export const STOP_NEAR_M = 170;
/** Waiting for the omnibus (seconds, on average: two buses on the town ring, one on the quays). */
export const BUS_WAIT_S = 90;
/** They take the omnibus when it is no more than this much slower than walking. */
export const BUS_PATIENCE = 1.25;
/** A flight of quay steps this near both ends for a trip by boat (metres). */
export const LANDING_NEAR_M = 130;
/** A family trip by boat only when it is at least this far. */
export const BOAT_MIN_M = 120;
/** A big load wants the dray (things). */
export const DRAY_ITEMS = 3;
/** Most helpers who come out to load a cart. */
export const HELPERS_MAX = 3;
/** A carry from the door to the cart and back (seconds), and putting it on. */
export const CARRY_S = 9;
/** Residents ride the omnibus free (the server's fare is for Jef alone: ride.ts RIDE_FARE_C). */
export const RESIDENT_FARE_C = 0;

export interface Load {
  what: "goods" | "fish" | "furniture" | "chests" | "sacks";
  /** How many things to carry (a basket, a crate, a chair, a chest). */
  items: number;
}

export interface Stop {
  id: string;
  line: string;
  x: number;
  z: number;
}

export interface TripAsk {
  from: Pt;
  to: Pt;
  load?: Load | null;
  /** People going together (a family), 1 = alone. */
  group?: number;
  /** The household's vehicles standing where the trip starts (and not taken by anyone). */
  has: { velocipede?: boolean; handcart?: boolean; dray?: boolean; boat?: boolean };
  /** For a boat: the flights of steps nearest the start and the goal, on one water, or null. */
  water?: { from: Pt; to: Pt } | null;
  /** Omnibus stops (all lines). */
  stops?: Stop[];
  /** Seconds until the next omnibus of the stop's line stands there (omitted: BUS_WAIT_S). */
  busWait?: (s: Stop) => number;
  /** Children and the very old do not ride a velocipede. */
  age?: number;
}

export interface TripPlan {
  mode: Mode;
  /** Why, in a few words (dev). */
  why: string;
  /** Straight-line metres. */
  dist: number;
  /** Seconds on the way, as the street sees it (walks, waits, the ride). */
  secs: number;
  bus?: { board: Stop; alight: Stop };
  /** What a resident pays: nothing, ever (only Jef pays a fare). */
  fare_c: number;
}

const d2 = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Seconds for a walk of this straight-line distance. */
export function walkSecs(dist: number): number {
  return (dist * DETOUR) / SPEED.walk;
}

/**
 * The omnibus between two points: board at the stop nearest the start, get off at the stop
 * of the same line nearest the goal. Null when no line serves both ends, or when walking
 * is much quicker (BUS_PATIENCE).
 */
export function omnibusPlan(from: Pt, to: Pt, stops: Stop[], waitAt?: (s: Stop) => number): { board: Stop; alight: Stop; secs: number } | null {
  let best: { board: Stop; alight: Stop; secs: number } | null = null;
  for (const a of stops) {
    const wa = d2(from, [a.x, a.z]);
    if (wa > STOP_NEAR_M) continue;
    for (const b of stops) {
      if (b.line !== a.line || b.id === a.id) continue;
      const wb = d2(to, [b.x, b.z]);
      if (wb > STOP_NEAR_M) continue;
      // the ring is one way: a ride is about 1.5 times the straight line between the stops
      const ride = d2([a.x, a.z], [b.x, b.z]) * 1.5;
      // the wait: the next omnibus of the line at that stop (the client knows where they are), else the average
      const secs = walkSecs(wa) + (waitAt ? Math.max(walkSecs(wa), waitAt(a)) : BUS_WAIT_S) + ride / SPEED.omnibus + walkSecs(wb);
      if (!best || secs < best.secs) best = { board: a, alight: b, secs };
    }
  }
  if (!best) return null;
  // a seat is worth a little more time than the walk (the old, the tired, the rain)
  return best.secs < walkSecs(d2(from, to)) * BUS_PATIENCE ? best : null;
}

/** How a resident makes this trip: the engine's rules (see the top of this file). */
export function chooseMode(a: TripAsk): TripPlan {
  const dist = d2(a.from, a.to);
  const plan = (mode: Mode, why: string, secs: number, bus?: TripPlan["bus"]): TripPlan => ({ mode, why, dist, secs, bus, fare_c: RESIDENT_FARE_C });
  const road = (mode: Mode) => (dist * DETOUR) / SPEED[mode];
  const boatSecs = () => (a.water ? walkSecs(d2(a.from, a.water.from)) + (d2(a.water.from, a.water.to) * 1.2) / SPEED.boat + walkSecs(d2(a.water.to, a.to)) : Infinity);
  if (a.load && a.load.items > 0) {
    if (a.has.boat && a.water) return plan("boat", "a load, and the boat lies by the water at both ends", boatSecs());
    if (a.has.dray && a.load.items >= DRAY_ITEMS) return plan("dray", "a big load for the dray", road("dray"));
    if (a.has.handcart) return plan("handcart", "a load for the handcart", road("handcart"));
    if (a.has.dray) return plan("dray", "a load, and the dray is there", road("dray"));
    return plan("walk", "a load, but nothing to put it on: carried by hand", road("walk") * 1.2);
  }
  if ((a.group ?? 1) >= 2 && a.has.boat && a.water && dist >= BOAT_MIN_M) return plan("boat", "the family goes along the water in their boat", boatSecs());
  if (dist <= WALK_MAX_M) return plan("walk", "a short way", road("walk"));
  if (a.has.velocipede && (a.age ?? 30) >= 15 && (a.age ?? 30) < 60) return plan("velocipede", "a long way, and the velocipede is at hand", road("velocipede"));
  const bus = a.stops ? omnibusPlan(a.from, a.to, a.stops, a.busWait) : null;
  if (bus) return plan("omnibus", "a long way, with an omnibus stop at both ends", bus.secs, { board: bus.board, alight: bus.alight });
  return plan("walk", "a long way, on foot", road("walk"));
}

// ------------------------------------------------------------------ loading a cart

export interface Loading {
  /** Rounds of carrying: in each, every carrier takes one thing from the door to the cart. */
  rounds: Array<Array<{ who: string; item: number }>>;
  /** Seconds it takes. */
  secs: number;
  /** Who carries (the owner first, then the family who came out). */
  carriers: string[];
}

/**
 * Who carries what from the door to the cart: the one who goes (first) and up to three of the
 * household who are at home and old enough to carry. One thing each per round.
 */
export function planLoading(items: number, owner: string, family: Array<{ id: string; age: number; home: boolean }>): Loading {
  const n = Math.max(0, Math.min(12, Math.floor(items)));
  const helpers = family.filter((f) => f.id !== owner && f.home && f.age >= 10).slice(0, n > 1 ? HELPERS_MAX : 0).map((f) => f.id);
  const carriers = [owner, ...helpers];
  const rounds: Loading["rounds"] = [];
  for (let i = 0; i < n; ) {
    const round: Array<{ who: string; item: number }> = [];
    for (const who of carriers) {
      if (i >= n) break;
      round.push({ who, item: i++ });
    }
    rounds.push(round);
  }
  return { rounds, secs: rounds.length * CARRY_S, carriers };
}

// ------------------------------------------------------------------ loads in the day

/** Trades who take goods to their stall in the morning and bring the rest home at night. */
export const SELLERS = new Set(["market_woman", "fishwife", "grocer", "dealer"]);

/**
 * The load of a move between two places of a resident's day (the schedule says it by trade):
 * a seller takes her goods from home to the stall in the morning (2 to 4 baskets and crates),
 * and brings what is left home at night (one). Null: nothing to carry.
 */
export function scheduleLoad(trade: string, wealth: number, fromKey: string, toKey: string): Load | null {
  if (!SELLERS.has(trade)) return null;
  const what: Load["what"] = trade === "fishwife" ? "fish" : trade === "dealer" ? "furniture" : "goods";
  if (fromKey === "home" && toKey.startsWith("work")) return { what, items: 2 + Math.min(2, Math.floor(wealth / 2)) };
  if (fromKey.startsWith("work") && toKey === "home") return { what, items: 1 };
  return null;
}

// ------------------------------------------------------------------ where the day takes them

export type Act = "home" | "work" | "tavern" | "play" | "market" | "church" | "stroll" | "loiter";
export type Seg = [number, number, Act, string?];

export interface DayOf {
  sched: { day: Seg[]; sunday: Seg[] };
}

/** A place of the day as a key: "home", "work:work", "tavern:tavern:engel", "church:church"... */
export function placeKey(act: Act, place: string | undefined): string {
  if (act === "home") return "home";
  return `${act}:${place ?? (act === "work" ? "work" : act)}`;
}

/** The day's places in order, as keys with the hour each begins (home before the first). */
export function dayKeys(r: DayOf, day: number): Array<{ from: number; to: number; key: string }> {
  const segs = (day % 7 === 0 ? r.sched.sunday : r.sched.day).slice().sort((a, b) => a[0] - b[0]);
  const out: Array<{ from: number; to: number; key: string }> = [];
  let t = 0;
  for (const [a, b, act, place] of segs) {
    if (a > t) out.push({ from: t, to: a, key: "home" });
    out.push({ from: a, to: b, key: placeKey(act, place) });
    t = b;
  }
  if (t < 24) out.push({ from: t, to: 24, key: "home" });
  return out;
}

/**
 * Where a vehicle stands at this hour, by its owner's day. The owner takes it out of the
 * house only for a long trip (or a load, for a cart); once it is out, it goes where he goes,
 * so it comes home with him. `taken` a place key: it is there. Pure: the server says where
 * an owner's velocipede stands for theft; the client parks it there.
 * - `far(a, b)`: is the trip from place a to place b a long one?
 * - `load(a, b)`: does the move from a to b carry a load (a cart is wanted)?
 * - `parks`: the places it can stand at (a key missing: it is not taken there).
 * - `follows`: once out, it goes wherever the owner goes (a velocipede); else only with a load or home (a cart).
 */
export function vehicleAt(
  r: DayOf,
  day: number,
  hour: number,
  far: (a: string, b: string) => boolean,
  parks: Record<string, unknown>,
  load: (a: string, b: string) => boolean = () => false,
  follows = true,
): { at: string; moving: boolean } {
  // a night past midnight belongs to yesterday's list
  const h = ((hour % 24) + 24) % 24;
  const yday = day <= 1 ? 7 : day - 1;
  const late = dayKeys(r, yday).length && (yday % 7 === 0 ? r.sched.sunday : r.sched.day).some(([a, b]) => b > 24 && h + 24 >= a && h + 24 < b);
  const keys = late ? dayKeys(r, yday) : dayKeys(r, day);
  const now = late ? h + 24 : h;
  let at = "home";
  let prev = "home";
  let moving = false;
  for (const k of keys) {
    if (k.from > now) break;
    if (k.key !== prev) {
      const out = at !== "home";
      // out of the house, a velocipede goes where its owner goes; a cart only with a load, or home again
      const takes = at === prev && !!parks[k.key] && ((out && (follows || k.key === "home")) || far(prev, k.key) || load(prev, k.key));
      if (takes) at = k.key;
      moving = takes && now - k.from < 0.25;
      prev = k.key;
    }
  }
  return { at, moving };
}

// ------------------------------------------------------------------ on the water

/**
 * A way over open water from a to b, on a grid of `cell` metres: A* where `free(x, z)` says
 * a boat fits. The points are cell middles (the ends are the given points). Null: no way.
 */
export function waterPath(free: (x: number, z: number) => boolean, a: Pt, b: Pt, cell = 2, pad = 60, maxCells = 250_000): Pt[] | null {
  const x0 = Math.min(a[0], b[0]) - pad;
  const z0 = Math.min(a[1], b[1]) - pad;
  const nx = Math.ceil((Math.max(a[0], b[0]) + pad - x0) / cell);
  const nz = Math.ceil((Math.max(a[1], b[1]) + pad - z0) / cell);
  if (nx * nz > maxCells) return null;
  const idx = (i: number, j: number) => j * nx + i;
  const cx = (i: number) => x0 + (i + 0.5) * cell;
  const cz = (j: number) => z0 + (j + 0.5) * cell;
  const ok = new Int8Array(nx * nz).fill(-1);
  const open = (i: number, j: number) => {
    if (i < 0 || j < 0 || i >= nx || j >= nz) return false;
    const k = idx(i, j);
    if (ok[k] < 0) ok[k] = free(cx(i), cz(j)) ? 1 : 0;
    return ok[k] === 1;
  };
  const cellOf = (p: Pt): [number, number] => [Math.floor((p[0] - x0) / cell), Math.floor((p[1] - z0) / cell)];
  // start and goal: the nearest open cell within a few cells (a berth lies against the wall)
  const near = (p: Pt): [number, number] | null => {
    const [i0, j0] = cellOf(p);
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let dj = -3; dj <= 3; dj++)
      for (let di = -3; di <= 3; di++) {
        if (!open(i0 + di, j0 + dj)) continue;
        const d = di * di + dj * dj;
        if (d < bd) [bd, best] = [d, [i0 + di, j0 + dj]];
      }
    return best;
  };
  const s = near(a);
  const t = near(b);
  if (!s || !t) return null;
  const N = nx * nz;
  const g = new Float32Array(N).fill(Infinity);
  const from = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const heap: Array<[number, number]> = [];
  const push = (k: number, f: number) => {
    heap.push([f, k]);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0][1];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const sk = idx(s[0], s[1]);
  const tk = idx(t[0], t[1]);
  const hDist = (i: number, j: number) => Math.hypot(i - t[0], j - t[1]);
  g[sk] = 0;
  push(sk, hDist(s[0], s[1]));
  let found = false;
  let guard = 0;
  while (heap.length && guard++ < N) {
    const k = pop();
    if (closed[k]) continue;
    closed[k] = 1;
    if (k === tk) {
      found = true;
      break;
    }
    const i = k % nx;
    const j = (k - i) / nx;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = i + di;
        const nj = j + dj;
        if (!open(ni, nj)) continue;
        // no corner cutting past a wall
        if (di && dj && (!open(i + di, j) || !open(i, j + dj))) continue;
        const nk = idx(ni, nj);
        if (closed[nk]) continue;
        const ng = g[k] + (di && dj ? Math.SQRT2 : 1);
        if (ng < g[nk]) {
          g[nk] = ng;
          from[nk] = k;
          push(nk, ng + hDist(ni, nj));
        }
      }
  }
  if (!found) return null;
  const cells: Pt[] = [];
  for (let k = tk; k >= 0; k = from[k]) {
    const i = k % nx;
    cells.push([cx(i), cz((k - i) / nx)]);
    if (k === sk) break;
  }
  cells.reverse();
  // straighten: drop points while the straight line between the kept ones stays on open water
  const line = (p: Pt, q: Pt) => {
    const n = Math.ceil(d2(p, q) / (cell * 0.5));
    for (let i = 1; i < n; i++) if (!free(p[0] + ((q[0] - p[0]) * i) / n, p[1] + ((q[1] - p[1]) * i) / n)) return false;
    return true;
  };
  const out: Pt[] = [cells[0]];
  let k = 0;
  while (k < cells.length - 1) {
    let m = cells.length - 1;
    while (m > k + 1 && !line(cells[k], cells[m])) m--;
    out.push(cells[m]);
    k = m;
  }
  return out;
}

/** Length of a polyline (metres). */
export function pathLength(p: Pt[]): number {
  let L = 0;
  for (let i = 1; i < p.length; i++) L += d2(p[i - 1], p[i]);
  return L;
}

// ------------------------------------------------------------------ the velocipede maker (M6, Steve 2026-09-24: "a bike shop")

/**
 * What the velocipede maker asks (centimes). In 1873 a new Michaux-pattern machine cost
 * hundreds of francs, far beyond a docker's pay; the game keeps the price in proportion to
 * its own pay (a job 50-150 c, two or three a day), so a second-hand one is a week's hard
 * saving and a new one more. Hire by the day, back at his door by the end of it.
 */
export const VELO_PRICE = { new_c: 1200, used_c: 600, hire_c: 30 };
/** A day's hire runs this many game hours; after that his boy fetches it, and this is the fee. */
export const VELO_HIRE_HOURS = 14;
export const VELO_FETCH_FEE_C = 15;
/**
 * Jef's own velocipede, left alone in a busy place (a market, a quay, a tavern door) with
 * nobody by it: the chance each game hour that someone rides off on it. At his rented home's
 * door and at the maker's, never.
 */
export const VELO_THEFT_PER_HOUR = { day: 0.04, night: 0.08 };
/** Busy: this near a market, a quay or a tavern door (metres). Watched: Jef this near (metres). */
export const BUSY_M = 30;
export const WATCHED_M = 25;
