// M8f "shared goods" (docs/milestones/M8f.md): the liftable goods of the quays (crates, barrels, sacks ...) are
// the SERVER's. It keeps one list of every item (where it lies, what it rests on, who carries it) and tells every
// PC each change; a PC only draws that list and asks the server to lift, put down or hand over. Played alone the
// same path runs: the server is the authority, the own PC shows a lift at once and undoes it if the server says no.
//
// No imports: both the server (node, .ts) and the client (vite) read this file. The town's data (the doors of
// shared/city.json, the spots of shared/spots.json) is passed in by each side.

import { HAUL_PILE_N, HAUL_ROUTES, haulPileSpot } from "./hauls.ts";

export const GOODS_KINDS = ["crates", "sacks", "barrels", "hides", "rope", "parcel", "chests"] as const;
export type GoodsKind = (typeof GOODS_KINDS)[number];
export const isGoodsKind = (k: unknown): k is GoodsKind => typeof k === "string" && (GOODS_KINDS as readonly string[]).includes(k);

/** Height of one item when stacked (client game/props.ts GOODS reads these). */
export const GOODS_H: Record<GoodsKind, number> = { crates: 0.7, sacks: 0.4, barrels: 0.9, hides: 0.28, rope: 0.3, parcel: 0.3, chests: 0.47 };
/** The quay's own casks (props.glb "barrel", the piles of the Rijnkaai): a little taller than a job's barrel. */
export const CASK_H = 0.95;

/** Stacks: three high at most (a pyramid's rows count as levels). */
export const MAX_STACK = 3;
/** Half the footprint of a job's item (its collider). */
export const FOOT = 0.33;
/** An item within this of a point is "there" (to stack on, to find a free slot). */
export const TOUCH = 0.55;

/** Who has an item now: a player, a townsperson, a cart (Jef's handcart, a dray). Null: it lies on the ground or a stack. */
export type Holder = { p: number } | { npc: string } | { cart: string };

export interface GoodsItem {
  /** Stable: own:<owner>:<n>, pile:<pile>:<n>, job:<job>:<n> (made in a fixed order), spawn:<n> for the rest. */
  id: string;
  kind: GoodsKind;
  /** "cask": drawn with the quay's own barrel model (the piles). */
  look?: "cask";
  owner: string | null;
  job: number | null;
  x: number;
  z: number;
  /** Height of its base. */
  y: number;
  rot: number;
  /** What it rests on: nothing (the ground), one item (a straight stack), or two (a pyramid of barrels). */
  on: string[];
  by: Holder | null;
  broken?: boolean;
  heavy?: boolean;
  /** Times it was put down (its turn then is rotFor(id, n)). */
  n: number;
  /** Bumped by every change: a PC takes only what is newer than what it has. */
  rev: number;
  /** Where it belongs (owned goods, the piles): x, z, turn. */
  home?: [number, number, number];
  /** A watch job's pile: the employer's again when the job ends (not taken away with it). */
  keep?: boolean;
}

/** The push to every PC: what changed (whole items) and what is gone. `v` counts pushes: a gap means one was missed. */
export interface GoodsPush {
  type: "goods";
  v: number;
  items: GoodsItem[];
  gone: string[];
  /** Why, for the PCs' sounds and words: lift, put, sunk, handed, sold, taken, cart, spawn, reset ... */
  why: string;
  /** Who did it (a player id, a townsperson's id, a cart), when anyone did. */
  who?: Holder | { world: true };
  /** A full list follows (a new week, a load): drop everything not in it. */
  full?: boolean;
  /** Sunk: where it went into the water (the others see it go down). */
  at?: [number, number];
}

// ------------------------------------------------------------------ turns from the id (never Math.random)

/** FNV-1a, 32 bits. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The turn an item gets when it is made (n 0) or put down for the n-th time: 0 to 0.4 rad, as the old random one. */
export function rotFor(id: string, n: number): number {
  return Math.round((hash32(`${id}#${n}`) / 4294967296) * 0.4 * 1000) / 1000;
}

export function heightOf(it: Pick<GoodsItem, "kind" | "look">): number {
  return it.look === "cask" ? CASK_H : GOODS_H[it.kind];
}
export const topOf = (it: Pick<GoodsItem, "kind" | "look" | "y">): number => it.y + heightOf(it);

// ------------------------------------------------------------------ stacks and pyramids

/** The items lying (not held by anyone). */
export function lyingOf(list: readonly GoodsItem[]): GoodsItem[] {
  return list.filter((it) => !it.by);
}

/** Does anything rest on this item? */
export function hasAbove(list: readonly GoodsItem[], id: string): boolean {
  return list.some((o) => !o.by && o.on.includes(id));
}

/** Its level: 1 on the ground, one more than the highest it rests on. */
export function levelOf(list: readonly GoodsItem[], it: GoodsItem, guard = 0): number {
  if (!it.on.length || guard > 8) return 1;
  let m = 0;
  for (const id of it.on) {
    const b = list.find((o) => o.id === id);
    if (b) m = Math.max(m, levelOf(list, b, guard + 1));
  }
  return m + 1;
}

export interface Placement {
  x: number;
  z: number;
  y: number;
  on: string[];
}

/**
 * Where an item set down at (x, z) comes to rest among the lying goods (`skip`: itself): on the top-most item there
 * (a straight stack, at that item's place), on two barrels side by side (a pyramid, between them: barrels only), or
 * on the ground. Null: the stack there is full. The server and the PCs run the same rule, so a put down looks the
 * same everywhere before the server's answer is in.
 */
export function placeAt(list: readonly GoodsItem[], kind: GoodsKind, x: number, z: number, skip?: string): Placement | null {
  const lying = list.filter((o) => !o.by && o.id !== skip);
  const tops = lying.filter((o) => !lying.some((a) => a.on.includes(o.id)));
  let under: GoodsItem | null = null;
  let underD = Infinity;
  for (const o of tops) {
    const d = Math.hypot(o.x - x, o.z - z);
    if (d > TOUCH) continue;
    // the highest there (as the old topAt), the nearer of two at one height
    if (!under || o.y > under.y + 1e-6 || (Math.abs(o.y - under.y) <= 1e-6 && d < underD)) {
      under = o;
      underD = d;
    }
  }
  if (kind === "barrels") {
    // a pyramid: between two barrels of one row, when the point is nearer their middle than any one of them
    let best: { a: GoodsItem; b: GoodsItem; d: number; mx: number; mz: number } | null = null;
    const casks = tops.filter((o) => o.kind === "barrels");
    for (let i = 0; i < casks.length; i++)
      for (let j = i + 1; j < casks.length; j++) {
        const a = casks[i];
        const b = casks[j];
        if (Math.abs(a.y - b.y) > 0.05) continue;
        const ab = Math.hypot(a.x - b.x, a.z - b.z);
        if (ab < 0.45 || ab > 1.0) continue;
        const mx = (a.x + b.x) / 2;
        const mz = (a.z + b.z) / 2;
        const d = Math.hypot(mx - x, mz - z);
        if (d < 0.3 && (!best || d < best.d)) best = { a, b, d, mx, mz };
      }
    if (best && best.d < underD) {
      const lv = Math.max(levelOf(lying, best.a), levelOf(lying, best.b));
      if (lv >= MAX_STACK) return null;
      return { x: r3(best.mx), z: r3(best.mz), y: r3(Math.max(topOf(best.a), topOf(best.b))), on: [best.a.id, best.b.id] };
    }
  }
  if (under) {
    if (levelOf(lying, under) >= MAX_STACK) return null;
    return { x: under.x, z: under.z, y: r3(topOf(under)), on: [under.id] };
  }
  return { x: r3(x), z: r3(z), y: 0, on: [] };
}

/** No goods lying within TOUCH of (x, z)? */
export function freeAt(list: readonly GoodsItem[], x: number, z: number): boolean {
  return !list.some((it) => !it.by && Math.hypot(it.x - x, it.z - z) < TOUCH);
}

export const r3 = (v: number): number => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ the town's own goods

export interface Door {
  x: number;
  z: number;
  out: [number, number];
}
export interface Spot {
  x: number;
  z: number;
  dir: [number, number];
  label?: string;
}

/** A point by a door of the city (client world/city.ts doorSpot). */
export function doorPoint(doors: Record<string, Door>, name: string, d: number, side: number): [number, number] {
  const door = doors[name];
  if (!door) return [0, 0];
  const [ox, oz] = door.out;
  return [door.x + ox * d - oz * side, door.z + oz * d + ox * side];
}

/** Grid slot i around a spot, two columns, stacking along the spot's dir (client game/runs.ts slot). */
export function slotAt(spots: Record<string, Spot>, spot: string, i: number, gap = 0.95): [number, number] {
  const s = spots[spot];
  if (!s) return [0, 0];
  const [dx, dz] = s.dir;
  const side = (i % 2 ? 1 : -1) * 0.5;
  const along = Math.floor(i / 2) * gap;
  return [s.x + dx * along - dz * side, s.z + dz * along + dx * side];
}

/** Goods that belong to people, lying about the quay from the start (was client game/jobs.ts OWNED). */
export const OWNED_GOODS: Array<{ kind: GoodsKind; owner: string; at: Array<[number, number] | { door: string; d: number; side: number }> }> = [
  {
    kind: "crates",
    owner: "sooi",
    at: [
      { door: "hessenatie", d: 3.5, side: -5 },
      { door: "hessenatie", d: 3.5, side: -6 },
      { door: "hessenatie", d: 3.5, side: -5 },
      { door: "hessenatie", d: 4.4, side: -5.5 },
    ],
  },
  {
    kind: "barrels",
    owner: "peeters",
    at: [
      { door: "peeters", d: 3.2, side: 3.5 },
      { door: "peeters", d: 3.2, side: 4.3 },
      { door: "peeters", d: 4.0, side: 3.9 },
    ],
  },
  { kind: "barrels", owner: "tuur", at: [[7.7, -5.2], [6.9, -5.2]] },
  { kind: "sacks", owner: "fientje", at: [[44.3, 12.4], [44.3, 13.1]] },
];

/**
 * The casks standing on the Rijnkaai (were static props of client world/rijnkaai.ts `barrels`: three rows of three,
 * the model of props.glb): each its own item now, at the same place and turn as before.
 */
export const PILES: Array<{ id: string; x: number; z: number; n: number; label: string }> = [
  { id: "w", x: -44, z: 18, n: 5, label: "the casks by the west crane" },
  { id: "e", x: 30, z: 13, n: 3, label: "the casks by the Hessenatie" },
  { id: "c", x: -6, z: 12.8, n: 2, label: "the casks on the middle quay" },
];
export const pileSpot = (p: { x: number; z: number }, i: number): [number, number] => [p.x + (i % 3) * 0.75, p.z + Math.floor(i / 3) * 0.75];
export const pileRot = (i: number): number => r3(i * 1.7);

/**
 * M8f, the town's own work with the goods (the server does it on the world's clock): on a weekday a dray of the
 * Hessenatie takes the pile "e" off the quay at 8:00 and sets it down as a pyramid by the Werf at 9:00; at 16:00 it
 * takes it back and sets it down at home, as it stood, at 17:00. Only a whole pile lying untouched goes.
 */
export const DRAY_RUN = {
  pile: "e",
  cart: "dray:hessenatie",
  /** The pyramid's place (two below, one on top). */
  to: [22.4, 14.2] as [number, number],
  out: 8 * 60,
  down: 9 * 60,
  back: 16 * 60,
  home: 17 * 60,
};

/** The pyramid: two side by side (0.75 apart), the third on them. */
export function pyramidSpots(x: number, z: number, n: number): Array<{ x: number; z: number; row: number }> {
  const out: Array<{ x: number; z: number; row: number }> = [];
  const bottom = n >= 6 ? 3 : n >= 3 ? 2 : n;
  for (let i = 0; i < Math.min(n, bottom); i++) out.push({ x: x + (i - (bottom - 1) / 2) * 0.75, z, row: 0 });
  for (let i = 0; i < bottom - 1 && out.length < n; i++) out.push({ x: x + (i - (bottom - 2) / 2) * 0.75, z, row: 1 });
  return out;
}

/** Everything the town has lying about at the start of a week: owned goods and the quay's casks. */
export function townGoods(doors: Record<string, Door>): GoodsItem[] {
  const out: GoodsItem[] = [];
  const put = (it: Omit<GoodsItem, "y" | "on" | "n" | "rev" | "by"> & { rot: number }) => {
    const p = placeAt(out, it.kind, it.x, it.z) ?? { x: it.x, z: it.z, y: 0, on: [] };
    out.push({ ...it, x: p.x, z: p.z, y: p.y, on: p.on, by: null, n: 0, rev: 1, home: [p.x, p.z, it.rot] });
  };
  for (const o of OWNED_GOODS)
    o.at.forEach((a, i) => {
      const [x, z] = Array.isArray(a) ? a : doorPoint(doors, a.door, a.d, a.side);
      const id = `own:${o.owner}:${i}`;
      put({ id, kind: o.kind, owner: o.owner, job: null, x: r3(x), z: r3(z), rot: rotFor(id, 0) });
    });
  for (const p of PILES)
    for (let i = 0; i < p.n; i++) {
      const [x, z] = pileSpot(p, i);
      put({ id: `pile:${p.id}:${i}`, kind: "barrels", look: "cask", owner: null, job: null, x: r3(x), z: r3(z), rot: pileRot(i) });
    }
  // the dockers' own piles of sacks and crates at their routes' ends (shared/hauls.ts, Steve 2026-09-27)
  for (const r of HAUL_ROUTES)
    for (const [tag, p] of [["a", r.pile], ["b", r.drop]] as const) {
      if (!p) continue;
      for (let i = 0; i < HAUL_PILE_N; i++) {
        const [x, z] = haulPileSpot(p, i, tag === "a" ? r.a : r.b);
        const id = `haul:${r.id}${tag}:${i}`;
        put({ id, kind: p.kind, owner: null, job: null, x: r3(x), z: r3(z), rot: rotFor(id, 0) });
      }
    }
  return out;
}

// ------------------------------------------------------------------ the requests (HTTP POST /api/goods)

/** What a PC may ask. The server checks each (who, where, whose) and answers with the items as they are now. */
export type GoodsAsk =
  | { op: "lift"; id: string }
  | { op: "put"; id: string; x: number; z: number }
  /** The carried item leaves the world: into the Schelde, into a hand, sold, snatched, taken by a gang. */
  | { op: "drop"; id: string; why: "sunk" | "handed" | "sold" | "snatched" | "taken"; at?: [number, number] }
  /** A lying item of his own job taken off (a thief at the watch, a briber's man). */
  | { op: "take"; id: string }
  /** His job's goods, laid out by the server (lay: the goods wait at the job's place, not in someone's hands). */
  | { op: "job"; job: number; lay: boolean }
  /** A carry from the ship: the i-th swung down onto the quay. */
  | { op: "lower"; job: number; i: number; broken?: boolean; heavy?: boolean }
  /** A deliver: the employer hands the goods over (into his hands). */
  | { op: "handover"; job: number }
  /** The run is over on his PC: its goods go (a watch's pile stays the employer's). */
  | { op: "end"; job: number }
  /** After loading a save: his job's goods as they lay, and what he held. */
  | { op: "restore"; job: number | null; lying: Array<{ kind: string; x: number; z: number; rot: number; broken?: boolean; heavy?: boolean }>; carried: { kind: string; job: number | null; owner: string | null; broken?: boolean; heavy?: boolean } | null }
  // a townsperson's goods, reported by the PC that walks him (his hired hand, the man who carries a crate back)
  | { op: "npc_lift"; npc: string; ids: string[] }
  | { op: "npc_put"; npc: string; id: string; x: number; z: number }
  | { op: "npc_drop"; npc: string; id: string };

export const GOODS_OPS = ["lift", "put", "drop", "take", "job", "lower", "handover", "end", "restore", "npc_lift", "npc_put", "npc_drop"] as const;
/** A request's body at most this long (bytes). */
export const GOODS_BODY_MAX = 8 * 1024;
