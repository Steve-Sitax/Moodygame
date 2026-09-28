// M7 mills (Steve 2026-09-26: "millers and transport from mill to bakery or docks or from docks, and
// potential jobs"). The two tower mills on the town wall grind for the town's two bakeries: a miller and
// his man at each, the flour to the bakery by cart in the early morning, the grain from a dock to the mill
// in the afternoon, and a flour stock at each bakery the ENGINE keeps. Pure data and pure functions, no
// imports: the server (town/mills.ts) and the client (game/mills.ts) read this one file.
//
// Period (1873): the rampart mills of Antwerp (the Schorsmolen on the walls by the Zandpoort ground grain and
// bark into the 1880s); grain came in by barge and was landed by the naties; the miller turned the cap into
// the wind by the tail pole and its capstan wheel, stopped the sails in a gale, and on Sunday let them stand.
// Flour went to the bakers in sacks of about 50 kg, by the mill's cart in the early morning.

export type MillId = "mill_mid" | "mill_ne";

export interface MillDef {
  id: MillId;
  /** In a sentence ("the Kipdorp mill"), and on the map. */
  label: string;
  /** The tower's middle and radius (wall.glb dressing). */
  tower: [number, number];
  r: number;
  /** The step before the mill's door, on the walk on top of the wall (reachable by the stairs). */
  door: [number, number];
  /** Where the miller turns the cap into the wind: the tail pole's capstan wheel (null: a stage mill, from its gallery). */
  capstan: [number, number] | null;
  /** The sack store at the foot of the wall stair (shared/spots.json): the sacks for the town lie here. */
  yard: string;
  /** Where the mill's cart stands when not out (the man at its head or at its grips: x, z, facing yaw). */
  park: [number, number, number];
  /** What the mill sends its flour and fetches its grain with. */
  cart: "dray" | "handcart";
  /** The bakery it grinds for (a shop id) and its door (a spot), and where its grain comes ashore (a spot). */
  bakery: string;
  bakeryDoor: string;
  grain: string;
  /**
   * The wall stair between the mill and its store (tools/city/rampart.py STAIRS): a step off its foot in the street,
   * the foot, the head, and a step onto the walk at the top. The crowd's paths do not climb a flight this narrow:
   * the mill's people are walked up and down it (client game/mills.ts).
   */
  stair: { out: [number, number]; foot: [number, number]; head: [number, number]; top: [number, number] };
  /** Where the man stops the cart at the bakery (past the door: its bed beside the door) and at the dock (open ground with room for it). */
  stops: { bakery: [number, number]; dock: [number, number] };
  /**
   * The cart's ways from its stand to those stops through streets wide enough for it (made on the walk map with
   * room to spare, points 3 to 18 m apart: no corner of no length); the way back is the same reversed. Over a
   * drawbridge along the middle of its deck: the gallows posts stand at its corners (Steve 2026-09-28 saw the Kipdorp
   * dray go through one; server test/runs.test.ts checks every route against them).
   */
  routes: { bakery: Array<[number, number]>; dock: Array<[number, number]> };
  /** The way on foot (metres, the walk map): yard to the bakery's door, yard to the grain spot, mill door to the yard. */
  way: { bakery: number; grain: number; stair: number };
}

export const MILLS: MillDef[] = [
  {
    id: "mill_mid",
    label: "the Kipdorp mill",
    tower: [-59.98, 380],
    r: 3.35,
    door: [-60, 375.6],
    capstan: [-60, 371.8],
    yard: "mill_yard",
    park: [-144.2, 334.5, Math.PI],
    cart: "dray",
    bakery: "bakery_steen",
    bakeryDoor: "bakery_steen_door",
    grain: "canal_quay",
    stair: { out: [-136, 347.5], foot: [-134.6, 348.9], head: [-122.9, 349.4], top: [-121.5, 351.5] },
    stops: { bakery: [-207, 36.3], dock: [-63, 98.5] },
    routes: {
      bakery: [[-144.2, 334.5], [-144.5, 317.5], [-144.5, 299.5], [-144.5, 281.5], [-144.5, 263.5], [-144.5, 245.5], [-144.5, 227.5], [-144.5, 209.5], [-155.5, 196.5], [-164.5, 181.5], [-172.5, 165.5], [-176.5, 148.5], [-181.5, 132.5], [-187.5, 129.5], [-201.5, 125.5], [-202.5, 108.5], [-202.5, 90.5], [-202.5, 72.5], [-202.5, 54.5], [-205.1, 41.8], [-207, 36.3]],
      dock: [[-144.2, 334.5], [-144.5, 317.5], [-144.5, 299.5], [-144.5, 281.5], [-144.5, 263.5], [-144.5, 245.5], [-144.5, 227.5], [-141.5, 211.5], [-134.5, 209.5], [-117.5, 208.5], [-99.5, 208.5], [-91.5, 203.5], [-91.5, 185.5], [-89.5, 168.5], [-86.5, 153.5], [-80, 153.5], [-72, 153.5], [-65.2, 153.5], [-65.5, 146.5], [-67.5, 132.5], [-67.5, 114.5], [-63, 98.5]],
    },
    way: { bakery: 337, grain: 311, stair: 95 },
  },
  {
    id: "mill_ne",
    label: "the north mill",
    tower: [239.83, 332.69],
    r: 2.96,
    door: [236.6, 330.0],
    capstan: null,
    yard: "mill_ne_yard",
    park: [222.0, 232.0, Math.PI],
    cart: "handcart",
    bakery: "bakery_rijn",
    bakeryDoor: "bakery_rijn_door",
    grain: "bassin_south",
    stair: { out: [222.8, 241.5], foot: [223.24, 243.7], head: [221.8, 255.3], top: [222.5, 257.3] },
    stops: { bakery: [-4.5, 72.2], dock: [123.5, 118.8] },
    routes: {
      bakery: [[222, 232], [222.5, 214.5], [223.5, 197.5], [223.5, 179.5], [223.5, 161.5], [218.5, 153.5], [206.5, 149.5], [205.5, 132.5], [200.5, 124.5], [183.5, 123.5], [165.5, 123.5], [148.5, 121.5], [130.5, 121.5], [112.5, 121.5], [94.5, 121.5], [76.5, 121.5], [60.5, 114.5], [43.5, 111.5], [26.5, 109.5], [9.5, 107.5], [0.5, 102.5], [-3.5, 85.5], [-5.3, 77.7], [-4.5, 72.2]],
      dock: [[222, 232], [222.5, 214.5], [223.5, 197.5], [223.5, 179.5], [223.5, 161.5], [218.5, 153.5], [206.5, 149.5], [205.5, 132.5], [200.5, 124.5], [183.5, 123.5], [165.5, 123.5], [148.5, 121.5], [130.5, 121.5], [123.5, 118.8]],
    },
    way: { bakery: 361, grain: 208, stair: 100 },
  },
];

export const millById = (id: string): MillDef | undefined => MILLS.find((m) => m.id === id);
/** The mill that grinds for this bakery (a shop id). */
export const millOfBakery = (shop: string): MillDef | undefined => MILLS.find((m) => m.bakery === shop);

// ------------------------------------------------------------------ the wind

/** How the sails go by the day's weather (server day.ts): fog lies still, a gale stops the mill (the miller brakes and furls). */
export const WIND: Record<string, number> = { fog: 0, mist: 0.5, clear: 1, rain: 1.15, storm: 0 };
/** The miller's working day (game hours), Monday to Saturday. On Sunday the sails stand in the cross. */
export const MILL_DAY: [number, number] = [6, 18.5];
export const SUNDAY = 7;

/** How fast the sails turn now (0 still, 1 an ordinary breeze): the wind, by day, on a working day. */
export function millTurning(weather: string, day: number, hour: number): number {
  if (day % 7 === 0) return 0;
  const h = ((hour % 24) + 24) % 24;
  if (h < MILL_DAY[0] || h >= MILL_DAY[1]) return 0;
  return WIND[weather] ?? 0;
}

// ------------------------------------------------------------------ the carts (the engine's timetable)

/** The man at the horse's head (or at the handcart's grips), m/s. */
export const CART_PACE = 1.15;
/** Game hours to load or unload the cart (three sacks, one on the shoulder at a time). */
export const LOAD_H = 1 / 3;
/** The flour goes out at dawn: the man at the yard loading from this hour. The grain run leaves after dinner. */
export const FLOUR_OUT = 4.5;
export const GRAIN_OUT = 13.5;
/** Sacks on one run. */
export const CART_SACKS = 3;
export const GRAIN_SACKS = 3;
/** Real seconds in a game hour (shared/clock.ts: two real minutes). */
const REAL_S_PER_HOUR = 120;

/** Game hours for a way on foot at the cart's pace. */
export const legH = (way: number): number => way / CART_PACE / REAL_S_PER_HOUR;

export type RunKind = "flour" | "grain";
export type RunPhase = "load" | "go" | "unload" | "back" | "store";

export interface MillRun {
  mill: MillId;
  kind: RunKind;
  /** Game hours of the day: the phases in order. flour: load at the yard, go, unload at the bakery, back. grain: go, load at the dock, back, store (into the sack store). */
  phases: Array<{ phase: RunPhase; from: number; to: number }>;
  from: number;
  to: number;
}

/** The mill's runs of this day (none on Sunday): the flour to the bakery at dawn, the grain from the dock after dinner. */
export function runsOf(m: MillDef, day: number): MillRun[] {
  if (day % 7 === 0) return [];
  const out: MillRun[] = [];
  {
    const b = legH(m.way.bakery);
    const t0 = FLOUR_OUT;
    const t1 = t0 + LOAD_H;
    const t2 = t1 + b;
    const t3 = t2 + LOAD_H;
    const t4 = t3 + b;
    out.push({
      mill: m.id,
      kind: "flour",
      from: t0,
      to: t4,
      phases: [
        { phase: "load", from: t0, to: t1 },
        { phase: "go", from: t1, to: t2 },
        { phase: "unload", from: t2, to: t3 },
        { phase: "back", from: t3, to: t4 },
      ],
    });
  }
  {
    const g = legH(m.way.grain);
    const t0 = GRAIN_OUT;
    const t1 = t0 + g;
    const t2 = t1 + LOAD_H;
    const t3 = t2 + g;
    const t4 = t3 + LOAD_H;
    out.push({
      mill: m.id,
      kind: "grain",
      from: t0,
      to: t4,
      phases: [
        { phase: "go", from: t0, to: t1 },
        { phase: "load", from: t1, to: t2 },
        { phase: "back", from: t2, to: t3 },
        { phase: "store", from: t3, to: t4 },
      ],
    });
  }
  return out;
}

/** The run of this mill under way at this hour, and its phase, or null. */
export function runNow(m: MillDef, day: number, hour: number): { run: MillRun; phase: RunPhase; since: number; left: number } | null {
  for (const run of runsOf(m, day)) {
    for (const p of run.phases) if (hour >= p.from && hour < p.to) return { run, phase: p.phase, since: hour - p.from, left: p.to - hour };
  }
  return null;
}

/** The schedule the mill's man keeps (server town/mills.ts gives it to him): the runs as work with their place ("flour", "grain"). */
export function manRuns(m: MillDef): Array<[number, number, RunKind]> {
  return runsOf(m, 1).map((r) => [Math.floor(r.from * 4) / 4, Math.ceil(r.to * 4) / 4, r.kind]);
}

// ------------------------------------------------------------------ the stocks (engine numbers)

/** A bakery bakes at this hour and uses this many sacks (Sunday fewer). */
export const BAKE_AT = 3;
export const BAKE_USE = 3;
export const BAKE_USE_SUNDAY = 1;
/** The most sacks a bakery's loft holds, and a mill's store of grain and of flour. */
export const BAKERY_CAP = 8;
export const MILL_GRAIN_CAP = 12;
export const MILL_FLOUR_CAP = 10;
/** Sacks the mill grinds in an hour of an ordinary breeze (the wind factor scales it). */
export const GRIND_PER_H = 0.5;
/** At the start of a week. */
export const START = { grain: 6, flour: 6, bakery: 5 };
/** Below this the baker wants flour fetched, the miller grain. */
export const FLOUR_LOW = 3;
export const GRAIN_LOW = 3;

export interface Stocks {
  /** The absolute game minute the stocks are counted to. */
  at: number;
  mills: Record<string, { grain: number; flour: number; ground: number }>;
  bakeries: Record<string, { flour: number }>;
  /** Sacks on each mill's cart now (flour on the way to the bakery, grain on the way to the store). */
  carts: Record<string, number>;
}

export const absMin = (day: number, hour: number, minute = 0): number => (day - 1) * 1440 + hour * 60 + minute;

export function freshStocks(at: number): Stocks {
  const s: Stocks = { at, mills: {}, bakeries: {}, carts: {} };
  for (const m of MILLS) {
    s.mills[m.id] = { grain: START.grain, flour: START.flour, ground: 0 };
    s.bakeries[m.bakery] = { flour: START.bakery };
    s.carts[m.id] = 0;
  }
  return s;
}

/** A plain line for the log of what happened (the engine's own words). */
export interface StockEvent {
  at: number;
  mill: MillId;
  what: "bake" | "short" | "loaded" | "delivered" | "grain_in" | "ground";
  n: number;
}

const STEP = 5;

/**
 * The stocks moved on to `to` (an absolute game minute), five minutes at a time: the bakers bake at three,
 * the carts take and bring at the ends of their phases, the mills grind in the wind by day. `weatherOf(day)`
 * gives a day's weather. At most three days are worked through (a longer gap: only the last three).
 */
export function stepStocks(s: Stocks, to: number, weatherOf: (day: number) => string): StockEvent[] {
  const ev: StockEvent[] = [];
  if (to <= s.at) return ev;
  let t = Math.max(s.at, to - 3 * 1440);
  t = Math.floor(t / STEP) * STEP;
  while (t + STEP <= to) {
    const a = t;
    const b = t + STEP;
    const day = Math.floor(a / 1440) + 1;
    const ha = (a % 1440) / 60;
    const hb = ha + STEP / 60;
    const crossed = (h: number) => ha < h && hb >= h;
    for (const m of MILLS) {
      const mill = s.mills[m.id];
      const bak = s.bakeries[m.bakery];
      // the bake
      if (crossed(BAKE_AT)) {
        const use = day % 7 === 0 ? BAKE_USE_SUNDAY : BAKE_USE;
        const used = Math.min(use, bak.flour);
        bak.flour -= used;
        ev.push({ at: b, mill: m.id, what: used < use ? "short" : "bake", n: used });
      }
      // the carts, at the ends of their phases
      for (const run of runsOf(m, day)) {
        const load = run.phases.find((p) => p.phase === "load")!;
        if (crossed(load.to)) {
          const n = run.kind === "flour" ? Math.max(0, Math.min(CART_SACKS, mill.flour, BAKERY_CAP - bak.flour)) : GRAIN_SACKS;
          if (run.kind === "flour") mill.flour -= n;
          s.carts[m.id] = n;
          ev.push({ at: b, mill: m.id, what: "loaded", n });
        }
        const drop = run.phases.find((p) => p.phase === (run.kind === "flour" ? "unload" : "store"))!;
        if (crossed(drop.to)) {
          const n = s.carts[m.id] ?? 0;
          if (run.kind === "flour") bak.flour = Math.min(BAKERY_CAP, bak.flour + n);
          else mill.grain = Math.min(MILL_GRAIN_CAP, mill.grain + n);
          s.carts[m.id] = 0;
          ev.push({ at: b, mill: m.id, what: run.kind === "flour" ? "delivered" : "grain_in", n });
        }
      }
      // the wind turns the stones
      const w = millTurning(weatherOf(day), day, ha);
      if (w > 0) {
        mill.ground = Math.min(1, mill.ground + (w * GRIND_PER_H * STEP) / 60);
        if (mill.ground >= 1 && mill.grain > 0 && mill.flour < MILL_FLOUR_CAP) {
          mill.ground -= 1;
          mill.grain -= 1;
          mill.flour += 1;
          ev.push({ at: b, mill: m.id, what: "ground", n: 1 });
        }
      }
    }
    t = b;
  }
  s.at = Math.max(s.at, t);
  return ev;
}

/** What short flour does to the bakery's bread (centimes added to the loaf): one sack or less left, one; none, two. */
export function breadExtra(flour: number): number {
  return flour <= 0 ? 2 : flour <= 1 ? 1 : 0;
}

/** The bakery's own goods made of flour (their price follows the stock). */
export const FLOUR_WARES = new Set(["bread", "peperkoek"]);

// ------------------------------------------------------------------ Jef's work at the mills

/** A sack of flour or grain (shared/handcart.ts LOAD.sacks). */
export const SACK_KG = 50;

/**
 * The pay for carrying sacks (the engine's): by distance and weight, in the tier's band. By hand a sack on the
 * back; with the miller's barrow a load of three. `band` is the tier's pay band [lo, hi].
 */
export function millPay(sacks: number, way: number, cart: boolean, band: [number, number]): number {
  const r5 = (n: number) => Math.round(n / 5) * 5;
  const raw = cart ? 40 + (sacks * SACK_KG * way) / 300 : 25 + (sacks * SACK_KG * way) / 180;
  const lo = cart ? r5(band[0] + (band[1] - band[0]) * 0.5) : band[0];
  return Math.max(lo, Math.min(band[1], r5(raw)));
}

/** An hour at the mill (the cap turned into the wind, the sacks hoisted): its length and the turns the miller asks for. */
export const HELP_MIN = 60;
export const HELP_TURNS = 2;
export const HELP_PAY = 60;
