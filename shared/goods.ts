// M8f "shared goods" (docs/milestones/M8f.md): the liftable goods of the quays (crates, barrels, sacks ...) are
// the SERVER's. It keeps one list of every item (where it lies, what it rests on, who carries it) and tells every
// PC each change; a PC only draws that list and asks the server to lift, put down or hand over. Played alone the
// same path runs: the server is the authority, the own PC shows a lift at once and undoes it if the server says no.
//
// No imports: both the server (node, .ts) and the client (vite) read this file. The town's data (the doors of
// shared/city.json, the spots of shared/spots.json) is passed in by each side.

import { HAUL_PILE_N, HAUL_ROUTES, haulPileSpot } from "./hauls.ts";
import { FISH_BOX_H } from "./trade.ts";

export const GOODS_KINDS = ["crates", "sacks", "barrels", "hides", "rope", "parcel", "chests"] as const;
export type GoodsKind = (typeof GOODS_KINDS)[number];
export const isGoodsKind = (k: unknown): k is GoodsKind => typeof k === "string" && (GOODS_KINDS as readonly string[]).includes(k);

/** Height of one item when stacked (client game/props.ts GOODS reads these). */
export const GOODS_H: Record<GoodsKind, number> = { crates: 0.7, sacks: 0.3, barrels: 0.9, hides: 0.28, rope: 0.3, parcel: 0.3, chests: 0.47 };
/**
 * A filled sack lying flat (client game/sackModel.ts draws it; Steve 2026-09-28: "in reality sacks stack differently"):
 * its length, height and width (m), and how far an upper sack sinks into the dip between the two it lies on.
 */
export const SACK_LIE = { l: 0.88, h: 0.3, w: 0.5, nest: 0.07 };
/** Turn of a lying sack whose length runs along (dx, dz) (the model's length is its x). */
export const sackRot = (dx: number, dz: number): number => Math.atan2(-dz, dx);
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
  /**
   * Its model, when not a job's plain goods: "cask" (props.glb barrel, the piles), "p:<model>" (a props.glb model,
   * scaled by `sc`: the Rijnkaai's big crates and sacks), "q:<model>" (a quay heap's cask, crate or sack of
   * quaygoods.glb: M8f goods pass 2).
   */
  look?: string;
  /** Its height when stacked (m), when not its kind's (a model of the quay: shared/quaycargo.json). */
  h?: number;
  /** The scale of a "p:" model. */
  sc?: number;
  /** Too big to lift by hand: only a cart moves it (the Rijnkaai's big packing crates). */
  cartOnly?: boolean;
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

export function heightOf(it: Pick<GoodsItem, "kind" | "look" | "h">): number {
  return it.h ?? (it.look === "cask" ? CASK_H : GOODS_H[it.kind]);
}
export const topOf = (it: Pick<GoodsItem, "kind" | "look" | "y" | "h">): number => it.y + heightOf(it);

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
  // (only what lies near counts: what rests on a thing lies near it too; the town has hundreds of items now)
  const lying = list.filter((o) => !o.by && o.id !== skip && Math.abs(o.x - x) < 3 && Math.abs(o.z - z) < 3);
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
  /** The pyramid's place (two below, one on top): by the lighter berth, beside the dray's way (goods pass 2: was 22.4, 14.2). */
  to: [24.5, 13.0] as [number, number],
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

// ------------------------------------------------------------------ M8f goods pass 2: the rest of the quay's cargo

/**
 * The big packing crates standing on the Rijnkaai (were static props of client world/rijnkaai.ts crateStack): x, z,
 * how many on the ground (two to a row, 1.4 m apart); two or more have one more crate across the first two. The
 * props.glb crates at 1.1 times: 1.3 m across, too big to lift by hand (cart only).
 */
export const CRATE_STACKS: Array<[number, number, number]> = [
  [-20, 14, 3],
  [-14.6, 15.2, 2],
  [12, 12.8, 2],
  [36, 18, 3],
  [41, 16.5, 1],
  [-52, 12, 2],
];
/** A pyramid of six lying sacks: [across (sack widths from the middle), level, the ones it rests on]. */
export const SACK_PYRAMID: Array<[number, number, number[]]> = [
  [-1, 0, []],
  [0, 0, []],
  [1, 0, []],
  [-0.5, 1, [0, 1]],
  [0.5, 1, [1, 2]],
  [0, 2, [3, 4]],
];
/** A quay sack pile's middle, from its SACK_PILES point (where the old row of three began). */
export const SACK_PILE_MID = 1.04;
/** The jute sacks lying on the Rijnkaai (were rijnkaai.ts sacks): six in a pyramid (SACK_PYRAMID). */
export const SACK_PILES: Array<[number, number]> = [
  [14, 19.5],
  [-34, 17],
];
/** props.glb models at the scale they stand at: height when stacked (m). */
export const PROP_H: Record<string, number> = { crate_big: 1.1, crate_open: 0.83, crate_broken: 0.88, sack: 0.25 };
export const CRATE_S = 1.1;

/** The Rijnkaai's crate stacks and sack piles as the server's items: the same places, turns and models as the props were. */
export function rijnkaaiGoods(): GoodsItem[] {
  const out: GoodsItem[] = [];
  const add = (id: string, kind: GoodsKind, look: string, x: number, z: number, y: number, rot: number, on: string[], extra: Partial<GoodsItem> = {}) =>
    out.push({ id, kind, look: look || undefined, owner: null, job: null, x: r3(x), z: r3(z), y: r3(y), rot: r3(rot), on, by: null, n: 0, rev: 1, home: [r3(x), r3(z), r3(rot)], ...extra });
  CRATE_STACKS.forEach(([x, z, n], k) => {
    const g = CRATE_S * 1.18 + 0.1;
    for (let i = 0; i < n; i++) {
      const name = n === 1 ? "crate_open" : n === 3 && i === 2 ? "crate_broken" : "crate_big";
      add(`crate:${k}:${i}`, "crates", `p:${name}`, x + (i % 2) * g, z + Math.floor(i / 2) * g, 0, Math.sin(x * 3 + i) * 0.08, [], { sc: CRATE_S, h: PROP_H[name], cartOnly: true });
    }
    // one across the first two
    if (n >= 2) add(`crate:${k}:${n}`, "crates", "p:crate_big", x + g / 2, z, CRATE_S, 0.2, [`crate:${k}:0`, `crate:${k}:1`], { sc: CRATE_S, h: PROP_H.crate_big, cartOnly: true });
  });
  // six sacks as dockers pile them: three side by side, two in the dips between them, one on top (2026-09-28)
  SACK_PILES.forEach(([x, z], k) => {
    const cx = x + SACK_PILE_MID;
    SACK_PYRAMID.forEach(([u, level, on], i) =>
      add(`sack:${k}:${i}`, "sacks", "", cx + u * SACK_LIE.w, z, level * (SACK_LIE.h - SACK_LIE.nest), sackRot(0, 1) + Math.sin(i * 4.1) * 0.04, on.map((j) => `sack:${k}:${j}`)),
    );
  });
  return out;
}

/**
 * The cargo of the quays' heaps (client world/quaygoods.ts, baked into shared/quaycargo.json by
 * tools/bake-quaycargo.mjs): [id, model, kind, x, y, z, turn, height, rests on, heavy].
 */
export type CargoRow = [string, string, string, number, number, number, number, number, string[], number];

export function cargoGoods(rows: readonly CargoRow[]): GoodsItem[] {
  const out: GoodsItem[] = [];
  for (const [id, node, kind, x, y, z, rot, h, on, heavy] of rows) {
    if (!isGoodsKind(kind)) continue;
    out.push({ id, kind, look: `q:${node}`, owner: null, job: null, x, z, y, rot, h, on: [...on], by: null, n: 0, rev: 1, home: [x, z, rot], ...(heavy ? { heavy: true } : {}) });
  }
  return out;
}

/** Everything the town has lying about at the start of a week: owned goods, the quay's casks, crates and sacks, the heaps' cargo. */
export function townGoods(doors: Record<string, Door>, cargo: readonly CargoRow[] = []): GoodsItem[] {
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
    for (const tag of ["a", "b"] as const) for (let i = 0; i < HAUL_PILE_N; i++) {
      const it = haulPileItem(r, tag, i, out);
      if (it) out.push(it);
    }
  // (laid as they stood: a crate across two, a pyramid's cask on two below; not by the stacking rule)
  out.push(...rijnkaaiGoods(), ...cargoGoods(cargo));
  return out;
}

/**
 * Item i of a docker route's pile (`a` his own at the quay end, `b` the drop pile at the other), as it lies when the pile
 * is whole; `present` are the items lying about (crates stack on what is there by the stacking rule). Null: the route
 * has no such pile. The server lays the piles with it at the start and at dawn, and when a crane sets a load on one
 * (docs/milestones/D1-docks.md).
 */
export function haulPileItem(r: (typeof HAUL_ROUTES)[number], tag: "a" | "b", i: number, present: readonly GoodsItem[] = []): GoodsItem | null {
  const p = tag === "a" ? r.pile : r.drop;
  if (!p) return null;
  const from = tag === "a" ? r.a : r.b;
  const [x, z] = haulPileSpot(p, i, from);
  const id = `haul:${r.id}${tag}:${i}`;
  if (p.kind === "sacks") {
    // (2026-09-28) lying sacks, their length toward the docker who pulls them off: three side by side, two
    // pressed into the dips between them (haulPileSpot); each rests on the two below
    const level = i < 3 ? 0 : 1;
    const on = level ? [`haul:${r.id}${tag}:${i - 3}`, `haul:${r.id}${tag}:${i - 2}`] : [];
    const rot = sackRot(from[0] - p.x, from[1] - p.z) + (rotFor(id, 0) - 0.2) * 0.2;
    return { id, kind: "sacks", owner: null, job: null, x: r3(x), z: r3(z), y: r3(level * (SACK_LIE.h - SACK_LIE.nest)), rot: r3(rot), on, by: null, n: 0, rev: 1, home: [r3(x), r3(z), r3(rot)] };
  }
  const rot = rotFor(id, 0);
  const q = placeAt(present, p.kind, r3(x), r3(z)) ?? { x: r3(x), z: r3(z), y: 0, on: [] };
  // (T3 trade: the Vismarkt's routes carry low boxes of fish, not crates: their own height for the stacking)
  const h = r.place === "vismarkt" ? { h: FISH_BOX_H } : {};
  return { id, kind: p.kind, owner: null, job: null, x: q.x, z: q.z, y: q.y, on: q.on, rot, by: null, n: 0, rev: 1, home: [q.x, q.z, rot], ...h };
}

// ------------------------------------------------------------------ the town's carts (M8f goods pass 2)

/**
 * A cart's round with a whole pile (the server moves the goods on the world's clock: store.ts runTick; the drawn
 * cart, client world/goodsDrays.ts, goes the same round on the same clock): on a weekday at `out` it takes the pile
 * (only whole and untouched), at `down` it sets it down at `to` in the same shape, at `back` it takes it again, at
 * `home` it sets it down where it belongs.
 */
export interface CartRun {
  id: string;
  cart: string;
  label: string;
  /** A horse dray led by its carter, or a handcart pushed by a man. */
  vehicle: "dray" | "handcart";
  /** The pile's items, lower first. */
  items: string[];
  /** Where it goes: casks as a pyramid there, anything else in the same shape (its first item there). */
  to: [number, number];
  out: number;
  down: number;
  back: number;
  home: number;
  /**
   * The way it goes, leg by leg (x, z): a dray's the carter's at the horse's head (the rig follows his trail), a
   * handcart's its axle (the man pushes it from behind). Each leg starts where the last ended; a stop's last few
   * metres come in straight. out: from the yard to the pile (there before `out`); deliver: on to `to`; back: to the
   * yard; fetch: from the yard to `to` (there before `back`); bring: on home; home: to the yard.
   */
  legs: Record<"out" | "deliver" | "back" | "fetch" | "bring" | "home", Array<[number, number]>>;
  /** On a dray's bed (its frame: x across, y up, z along from the rear axle; turn): each item, in `items` order. */
  bed?: Array<[number, number, number, number]>;
}

/** Points on a circle round (cx, cz) of radius r from angle a0 to a1 (degrees: 0 +z, 90 +x), every 30 degrees. */
function arc(cx: number, cz: number, r: number, a0: number, a1: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const n = Math.max(1, Math.round(Math.abs(a1 - a0) / 30));
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    out.push([r3(cx + r * Math.sin(a)), r3(cz + r * Math.cos(a))]);
  }
  return out;
}

// The Hessenatie's dray goes a loop on the open quay between the omnibus stop and the emigrants' camp: west along
// z 15.3 (the bed on the water side of the carter, past pile "e" and the pyramid's place), round and back east along
// z 22 (the bed on the camp side, 0.4 m short of where a family sets its chests down), round again. It waits in its
// yard on the east-going line. (Checked: the rig's sweep against the walk map, the colliders and the keep-outs.)
const DRAY_A = 15.3;
const DRAY_B = 22.0;
const DRAY_R = (DRAY_B - DRAY_A) / 2;
const DRAY_E = 31.45;
const DRAY_W = 20.22;
const eastArc = () => arc(DRAY_E, DRAY_A + DRAY_R, DRAY_R, 0, 180);
const westArc = () => arc(DRAY_W, DRAY_A + DRAY_R, DRAY_R, 180, 360);
const DRAY_YARD: [number, number] = [27.5, DRAY_B];
/** The carter where the bed stands beside pile "e" (its middle 4.28 m behind him) and beside the pyramid's place. */
const DRAY_HOME: [number, number] = [26.47, DRAY_A];
const DRAY_TO: [number, number] = [20.22, DRAY_A];

// The sacks of the Rijnkaai (SACK_PILES[0]) go on a handcart to the lighter berth and back: out along z 20.6 with the
// sacks on the right, round a tight turn, back along z 18.3 with them on the left; the handcart waits by its pile.
const CART_E = 20.6;
const CART_W = 18.3;
const CART_R = (CART_E - CART_W) / 2;
const cartEast = () => arc(27.6, CART_W + CART_R, CART_R, 0, 180);
const cartWest = () => arc(11.5, CART_W + CART_R, CART_R, 180, 360);
const CART_YARD: [number, number] = [12.4, CART_E];

/** The Hessenatie's dray with pile "e" (DRAY_RUN), and the sacks of the Rijnkaai on a handcart. */
export const CART_RUNS: CartRun[] = [
  {
    id: "casks",
    cart: DRAY_RUN.cart,
    label: "the Hessenatie's dray with the casks",
    vehicle: "dray",
    items: [0, 1, 2].map((i) => `pile:${DRAY_RUN.pile}:${i}`),
    to: DRAY_RUN.to,
    out: DRAY_RUN.out,
    down: DRAY_RUN.down,
    back: DRAY_RUN.back,
    home: DRAY_RUN.home,
    legs: {
      out: [DRAY_YARD, ...eastArc(), DRAY_HOME],
      deliver: [DRAY_HOME, DRAY_TO],
      back: [DRAY_TO, ...westArc(), DRAY_YARD],
      fetch: [DRAY_YARD, ...eastArc(), DRAY_TO],
      bring: [DRAY_TO, ...westArc(), ...eastArc(), DRAY_HOME],
      home: [DRAY_HOME, ...westArc(), DRAY_YARD],
    },
    bed: [
      [0, 1.06, 0.3, 0],
      [0, 1.06, 1.2, 1.7],
      [0, 1.06, 2.1, 3.4],
    ],
  },
  {
    id: "sacks",
    cart: "cart:sacks",
    label: "the sacks of the Rijnkaai on a handcart to the lighter berth and back",
    vehicle: "handcart",
    items: [0, 1, 2, 3, 4, 5].map((i) => `sack:0:${i}`),
    to: [24.0, 19.5],
    out: 10 * 60,
    down: 11 * 60,
    back: 14 * 60,
    home: 15 * 60,
    legs: {
      out: [CART_YARD, [15.06, CART_E]],
      deliver: [[15.06, CART_E], [25.04, CART_E]],
      back: [[25.04, CART_E], ...cartEast(), ...cartWest(), CART_YARD],
      fetch: [CART_YARD, [25.04, CART_E]],
      bring: [[25.04, CART_E], ...cartEast(), [15.06, CART_W]],
      home: [[15.06, CART_W], ...cartWest(), CART_YARD],
    },
  },
];

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
  | { op: "npc_drop"; npc: string; id: string }
  /** A docker sets the load of his route's pile down at its other end: in at the door, onto the drop pile, at the bank. */
  | { op: "haul_in"; npc: string; id: string }
  /** The player, written in the foreman's book, sets a load of a route's pile in at its end: paid by the piece. */
  | { op: "haul_deliver"; id: string }
  /** A crane sets a load from the ship on a docker route's pile (the PC that runs the cranes reports it). */
  | { op: "crane_put"; route: string; n?: number };

export const GOODS_OPS = ["lift", "put", "drop", "take", "job", "lower", "handover", "end", "restore", "npc_lift", "npc_put", "npc_drop", "haul_in", "haul_deliver", "crane_put"] as const;
/** A request's body at most this long (bytes). */
export const GOODS_BODY_MAX = 8 * 1024;
