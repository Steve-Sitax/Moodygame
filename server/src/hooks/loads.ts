import type { DB } from "../db.ts";
import { canLoad, CART_LIMIT, pushSpeed, LOAD, type CartThing } from "../../../shared/handcart.ts";
import { gameMin } from "../../../shared/clock.ts";
import SPOT_TABLE from "../../../shared/spots.json" with { type: "json" };
import { walkMap } from "../town/walkmap.ts";

// M7 short jobs (Steve 2026-09-25): "Shorter jobs if it is fetching stuff. Fetching is boring, so no
// more than 2 items. Maybe sometimes a job with more, further in the game, if we own a cart or if we
// can use the owner's cart for it."
//
// The ENGINE's numbers for how much goods work moves and what it pays. Whatever the model proposes
// (items, a cart, pay) is clamped here: by hand at most two things, and the work must fit in about an
// hour at a walk; a bigger load (three to eight) only as cart work, one cart load, about one to two
// game hours, and only once cart work is open (the gate below). docs/milestones/M7-short-jobs.md.

/** By hand: at most this many things. */
export const HAND_MAX = 2;
/** Cart work: at least this many, at most this many (and never more than one cart load). */
export const CART_MIN = 3;
export const CART_MAX = 8;
/** The work at a walk, in game minutes: by hand at most, cart work at most. */
export const HAND_MAX_MIN = 60;
export const CART_MAX_MIN = 120;
/**
 * The gate: cart work is on the board once Jef has finished this many jobs (the employer lends his
 * handcart), or at once when Jef has a handcart of his own (bought).
 */
export const CART_AFTER_DONE = 3;
/** At most this many cart jobs on one board. */
export const CART_JOBS_PER_BOARD = 1;
/**
 * Carts do not go on the pier or up to a ship's gangway (M6 handcart: flat ground only), nor in among
 * the market stalls (the browser check: a loaded cart wedged between the fish stalls of the Vismarkt).
 */
export const NO_CART_SPOTS: readonly string[] = ["pier_head", "ship_gangway", "vismarkt_stalls", "markt_stalls"];
/**
 * Nor does cart work start where there is no room for the lent cart off the quay railway (the narrow
 * Entrepot quay and the Katoennatie's door by the lock: town/handcart.ts lentSpot; a test keeps this in step).
 */
export const NO_CART_FROM: readonly string[] = [...NO_CART_SPOTS, "katoen_door", "entrepot_quay"];

/** The lent cart: bring it back to where it stood within this many game minutes of the job's end. */
export const CART_RETURN_MIN = 60;
/** Left somewhere else: the employer's man fetches it, and this comes off Jef's purse; trust -1. */
export const CART_LEFT_FEE_C = 20;
/** Lost (wheeled off by a thief): this much for the cart, and trust -2. */
export const CART_LOST_C = 100;
/** Jef's own cart this near the goods when he takes the job: no cart is lent, he uses his. */
export const OWN_CART_NEAR_M = 40;

/**
 * The pay band of goods work inside the tier's band [lo, hi]: by hand the lower 40 % (one thing the
 * lower 20 %), cart work the upper half. Tier 0 (50-150): by hand 50-90 (one thing 50-70), a cart 100-150.
 */
export function carryBand([lo, hi]: [number, number], cart: boolean, one = false): [number, number] {
  const r5 = (n: number) => Math.round(n / 5) * 5;
  if (cart) return [r5(lo + (hi - lo) * 0.5), hi];
  return [lo, r5(lo + (hi - lo) * (one ? 0.2 : 0.4))];
}

// ---------------------------------------------------------------- how long the work takes

/** Jef's walk (client player/firstPerson.ts WALK) and his pace with one of the goods in his arms (client game/props.ts GOODS speed). */
export const WALK_MS = 1.55;
export const CARRY_PACE: Record<string, number> = { crates: 0.62, sacks: 0.6, barrels: 0.55, hides: 0.66, rope: 0.75, chests: 0.6, parcel: 0.95 };
/** Where the walk map finds no way: the straight line, a little longer. */
export const PATH_X = 1.1;
/** Real seconds to lift a thing and set it down (by hand), to put one on the cart from its pile, to tip the load off. */
const LIFT_S = 3;
const LOAD_S = 10; // browser check: 4-6 real s a crate with the lent cart 3-5 m from the pile (off the rails); a little slack
const TIP_S = 5;

/** A heavy one (the heavy_load twist) slows him to this (client game/handcart.ts, goods.ts). */
export const HEAVY_PACE = 0.4;

/** Game minutes of the work by hand at a walk over `way` metres on foot (walkDist): every thing there (a heavy one first), the walks back between. */
export function handMinutes(goods: string, count: number, way: number, heavy = false): number {
  let s = Math.max(0, count - 1) * (way / WALK_MS);
  for (let i = 0; i < count; i++) s += way / (WALK_MS * (heavy && i === 0 ? HEAVY_PACE : (CARRY_PACE[goods] ?? 0.6))) + LIFT_S;
  return Math.ceil(gameMin(s));
}

/** Game minutes of cart work at a walk over `way` metres on foot (walkDist): the load on, pushed there, tipped off, the cart back (a lent one). */
export function cartMinutes(goods: string, count: number, way: number, heavy = false, back = true): number {
  const kg = (LOAD[goods]?.kg ?? 45) * (count + (heavy ? 1 : 0));
  return Math.ceil(gameMin(count * LOAD_S + way / (WALK_MS * pushSpeed(Math.min(kg, CART_LIMIT.kg))) + TIP_S + (back ? way / (WALK_MS * pushSpeed(0)) : 0)));
}

/** How many of these goods one cart takes (a heavy one first, for the heavy_load twist), at most CART_MAX. */
export function cartCap(goods: string, heavy = false): number {
  const on: CartThing[] = [];
  while (on.length < CART_MAX && !canLoad(on, { kind: goods, heavy: heavy && on.length === 0 })) on.push({ kind: goods, heavy: heavy && on.length === 0 });
  return on.length;
}

// ---------------------------------------------------------------- the way on foot between two spots

/**
 * The length of the way on foot between two job spots (metres), over the walk map (server
 * town/walkmap.ts), 8-way on a 1 m grid, round the water and the houses. The browser check found the
 * straight line far short across a canal: the brewery door to the west canal quay is 32 m as the crow
 * flies and about 90 m over the bridge. One search a spot, cached; the straight line if no way is found.
 */
const CELL = 1;
const PAD = 60;
const ways = new Map<string, Map<string, number>>();
let grid: { x0: number; z0: number; w: number; h: number; open: Uint8Array } | null = null;
const spotAt = (id: string) => (SPOT_TABLE as unknown as Record<string, { x: number; z: number } | undefined>)[id];

function walkGrid() {
  if (grid) return grid;
  const pts = Object.entries(SPOT_TABLE as unknown as Record<string, { x: number; z: number }>)
    .filter(([k]) => !k.startsWith("_"))
    .map(([, v]) => v);
  const x0 = Math.min(...pts.map((p) => p.x)) - PAD;
  const z0 = Math.min(...pts.map((p) => p.z)) - PAD;
  const w = Math.ceil((Math.max(...pts.map((p) => p.x)) + PAD - x0) / CELL);
  const h = Math.ceil((Math.max(...pts.map((p) => p.z)) + PAD - z0) / CELL);
  const wm = walkMap();
  const open = new Uint8Array(w * h);
  for (let i = 0; i < w; i++) for (let k = 0; k < h; k++) open[i * h + k] = wm.open(x0 + (i + 0.5) * CELL, z0 + (k + 0.5) * CELL, 0.3) ? 1 : 0;
  grid = { x0, z0, w, h, open };
  return grid;
}

function waysFrom(a: string): Map<string, number> {
  const have = ways.get(a);
  if (have) return have;
  const out = new Map<string, number>();
  ways.set(a, out);
  const g = walkGrid();
  const p = spotAt(a);
  if (!p) return out;
  const cellOf = (x: number, z: number) => {
    const i = Math.floor((x - g.x0) / CELL);
    const k = Math.floor((z - g.z0) / CELL);
    return i < 0 || k < 0 || i >= g.w || k >= g.h ? -1 : i * g.h + k;
  };
  // the nearest open cell to a spot (a spot may stand at a door or on a pier's edge)
  const near = (x: number, z: number): number => {
    for (let r = 0; r <= 4; r++)
      for (let di = -r; di <= r; di++)
        for (let dk = -r; dk <= r; dk++) {
          const c = cellOf(x + di * CELL, z + dk * CELL);
          if (c >= 0 && g.open[c]) return c;
        }
    return -1;
  };
  const s = near(p.x, p.z);
  if (s < 0) return out;
  const dist = new Float64Array(g.w * g.h).fill(Infinity);
  dist[s] = 0;
  // Dijkstra with a binary heap (cells, 8 ways)
  const heap: Array<[number, number]> = [[0, s]];
  const push = (d: number, c: number) => {
    heap.push([d, c]);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
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
  const steps: Array<[number, number, number]> = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (heap.length) {
    const [d, c] = pop();
    if (d > dist[c]) continue;
    const i = Math.floor(c / g.h);
    const k = c % g.h;
    for (const [di, dk, cost] of steps) {
      const ni = i + di;
      const nk = k + dk;
      if (ni < 0 || nk < 0 || ni >= g.w || nk >= g.h) continue;
      const n = ni * g.h + nk;
      // no corner cutting past a wall
      if (!g.open[n] || (di && dk && (!g.open[ni * g.h + k] || !g.open[i * g.h + nk]))) continue;
      const nd = d + cost * CELL;
      if (nd < dist[n]) {
        dist[n] = nd;
        push(nd, n);
      }
    }
  }
  for (const [id, q] of Object.entries(SPOT_TABLE as unknown as Record<string, { x: number; z: number }>)) {
    if (id.startsWith("_")) continue;
    const c = near(q.x, q.z);
    if (c >= 0 && Number.isFinite(dist[c])) out.set(id, Math.round(dist[c] * 10) / 10);
  }
  return out;
}

/** Metres on foot from spot a to spot b (the straight line x PATH_X when the map has no way). */
export function walkDist(a: string, b: string): number {
  if (a === b) return 0;
  const pa = spotAt(a);
  const pb = spotAt(b);
  const straight = pa && pb ? Math.hypot(pa.x - pb.x, pa.z - pb.z) : 0;
  const w = waysFrom(a).get(b);
  return w !== undefined && w >= straight ? w : straight * PATH_X;
}

// ---------------------------------------------------------------- the words agree with the count

const NUM_WORDS = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const NUM_OF: Record<string, number> = Object.fromEntries(NUM_WORDS.map((w, i) => [w, i]).filter(([w]) => w));
/** Plural nouns of goods the model writes in a pitch ("two sacks of coffee", "five big casks"). */
const GOODS_NOUNS = "crates|sacks|barrels|casks|kegs|bales|hides|bundles|coils|chests|boxes|bags|tubs|hogsheads|loads|pieces|parcels|cases|baskets|rolls";
const COUNTED = new RegExp(`\\b(${NUM_WORDS.slice(1).join("|")}|\\d+)(\\s+(?:[a-z'-]+\\s+){0,2}?)(${GOODS_NOUNS})\\b`, "gi");
const ONE_NOUNS = "crate|sack|barrel|cask|keg|bale|hide|bundle|coil|chest|box|bag|tub|hogshead|parcel|case|basket|roll";
/** One thing named: "a barrel", "one heavy crate" (for work of more than one). */
const SINGLE = new RegExp(`\\b(a|an|one)(\\s+(?:[a-z'-]+\\s+){0,2}?)(${ONE_NOUNS})\\b(?!-)`, "gi");

/**
 * M7 short jobs: the pitch and the title name the engine's count, not the model's (the model wrote "Two
 * sacks of coffee" for work the engine made one sack: pier head to the Hessenatie door is too far for
 * two in the hour). "Two sacks" becomes "a sack" (or "A sack" at the start), "five crates" "four crates".
 */
export function sayCount(text: string, count: number): string {
  // "a barrel" for work of three: "three barrels"
  if (count >= 2)
    text = text.replace(SINGLE, (all, num: string, mid: string, noun: string, at: number, whole: string) => {
      if (/^(of|and|or|the|to|from|for|with|by|at|in|on)\s/i.test(`${mid.trim()} `)) return all;
      const start = at === 0 || /[.!?]\s*$/.test(whole.slice(0, at));
      const w = NUM_WORDS[count] ?? String(count);
      const plural = /(x|s|sh|ch)$/i.test(noun) ? `${noun}es` : `${noun}s`;
      return `${start || /^[A-Z]/.test(num) ? w[0].toUpperCase() + w.slice(1) : w}${mid}${plural}`;
    });
  return text.replace(COUNTED, (all, num: string, mid: string, noun: string, at: number) => {
    const n = /^\d+$/.test(num) ? Number(num) : NUM_OF[num.toLowerCase()];
    if (!n || n === count) return all;
    const start = at === 0 || /[.!?]\s*$/.test(text.slice(0, at));
    const cap = (w: string) => (start || num[0] === num[0].toUpperCase() && /[a-z]/i.test(num[0]) ? w[0].toUpperCase() + w.slice(1) : w);
    if (count === 1) {
      const one = noun.toLowerCase() === "boxes" ? noun.slice(0, -2) : noun.toLowerCase() === "hides" ? "hide" : noun.slice(0, -1);
      const next = (mid.trim() || one).toLowerCase();
      return `${cap(/^[aeiou]/.test(next) ? "an" : "a")}${mid}${one}`;
    }
    return `${/^\d+$/.test(num) ? String(count) : cap(NUM_WORDS[count] ?? String(count))}${mid}${noun}`;
  });
}

// ---------------------------------------------------------------- the gate

/** Does Jef have a handcart of his own (bought: new or second-hand)? */
export function ownsCart(db: DB): boolean {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'jef_carts'").get() as { value_json: string } | undefined;
  if (!row) return false;
  try {
    const s = JSON.parse(row.value_json) as { list?: Array<{ kind: string }> };
    return (s.list ?? []).some((c) => c.kind === "new" || c.kind === "used");
  } catch {
    return false;
  }
}

/** Jobs Jef has finished (done), any employer, any source. */
export function jobsDone(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM job WHERE status = 'done'").get() as { n: number }).n;
}

/** Is cart work open (the board may carry it)? Jef owns a handcart, or he has finished CART_AFTER_DONE jobs. */
export function cartWorkOpen(db: DB): boolean {
  return ownsCart(db) || jobsDone(db) >= CART_AFTER_DONE;
}
