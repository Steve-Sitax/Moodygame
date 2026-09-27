import type { DB } from "../db.ts";
import { GameError, job as jobRow, log, player, takeHooks } from "../game.ts";
import { ALL_EMPLOYERS, employerName, type JobRow } from "../hooks/jobBoard.ts";
import { CART_LEFT_FEE_C, CART_LOST_C, CART_RETURN_MIN, OWN_CART_NEAR_M } from "../hooks/loads.ts";
import { remember } from "../npcs.ts";
import { asPlayer, pid } from "../player/current.ts";
import { playerIds, pstate, setPstate } from "../player/multi.ts";
import { ITEM_BUY, ITEM_REF, ITEMS } from "../trade.ts";
import { dropTownCache, town } from "./store.ts";
import { walkMap } from "./walkmap.ts";
import { TRADES } from "./places.ts";
import { rngFrom, type Resident } from "./population.ts";
import { cartHooks, dropStealables, type DeedRow } from "./deeds.ts";
import { busyAt, freeDoors } from "./bikeshop.ts";
import { clockNow, offLanes, onDoorway, vehicleNow, vehicleOf } from "./possessions.ts";
import { lease } from "../homes/homes.ts";
import {
  canLoad,
  CART_FETCH_FEE_C,
  CART_HIRE_HOURS,
  CART_LIMIT,
  CART_PRICE,
  CART_THEFT_PER_HOUR,
  CART_WATCHED_M,
  LOAD,
  loadOf,
  UNLOAD_NEAR_M,
  unloadAllAllowed,
} from "../../../shared/handcart.ts";
import SPOTS from "../../../shared/spots.json" with { type: "json" };
import CITY from "../../../shared/city.json" with { type: "json" };

// Jef's handcart (M6 transport, Steve 2026-09-24): "I should be able to push a handcart and put
// multiple items on it, so I can deliver all crates at once, or other items."
//
// The wheelwright (a NEW resident, trade `wheelwright`, the place `cart_shop`) builds, sells and
// hires out handcarts at his door. Research (quick): every Flemish town and village of the 19th
// century had its wagenmaker, who made and mended carts, wheels and axles; in the growing towns a
// narrow two-wheeled handcart (a "handkar", pushed from its shafts: a "stootkar") brought goods to
// market quicker than a horse and wagon. We found no named Antwerp wagenmaker of 1873 and no
// price list: the address and the prices are the game's (shared/handcart.ts CART_PRICE, a third
// of the velocipede maker's or less). Sources: nl.wikipedia.org/wiki/Handkar ;
// nl.wikipedia.org/wiki/Wagenmaker ; collectiebulskampveld.be (wagenmakerij in Vlaanderen).
//
// The ENGINE keeps every cart of Jef's (his own 'jef_carts', M8c pstate): where it stands, whether he has
// hold of it, and what is on it, checked by size and weight (shared/handcart.ts). Bought or hired
// at the wheelwright's, or taken from a household (a deed of M3h: deeds.ts, `cart:<household>`,
// the police and the owner's memory as for a velocipede). His own cart left alone in a busy place
// may be wheeled off, load and all. No damage.

export const WHEELWRIGHT_ID = "wheelwright";
type Pt = [number, number];
/** Behind the Rijnkaai, among the carters' streets (the free house door nearest this is his). */
const ANCHOR: Pt = [-20, 62];

export interface CartShop {
  id: string;
  label: string;
  step: Pt;
  wall: Pt;
  out: Pt;
  /** Where he stands at his door. */
  at: [number, number, number];
  /** Where the cart for sale and the one for hire stand (axle x, z, and the way the cart points). */
  show: Array<[number, number, number]>;
}

export interface CartItem {
  kind: string;
  /** A job's goods (the job's id), or null. */
  job: number | null;
  /** Whose goods these are (an NPC id), if anyone's. */
  owner: string | null;
  broken?: boolean;
  heavy?: boolean;
  /** A piece of furniture of Jef's (home_item id): on the cart it is out of his arms (state 'gone'). */
  piece?: number;
}

export interface JefCart {
  id: string;
  /** M7 short jobs: "lent": an employer's handcart lent for a cart job (lendForJob), back where it stood after. */
  kind: "new" | "used" | "hire" | "taken" | "lent";
  since: number;
  until?: number;
  paid_c: number;
  /** Taken from a household: whose it is, and the deed. */
  owner?: string;
  deed?: number | null;
  label: string;
  /** M7 short jobs, a lent cart: the job, whose it is (an employer id), and where it goes back to. */
  job?: number;
  lender?: string;
  home?: Pt;
  /** The client has checked (and maybe moved) where the lent cart stands, against its own things on the quay (placeLent). */
  placed?: boolean;
  /** The axle on the ground, and the way the cart points (a yaw: (sin, cos)). */
  x: number;
  z: number;
  yaw: number;
  /** Jef has hold of the shafts. */
  held: boolean;
  load: CartItem[];
}

interface CartsState {
  n: number;
  list: JefCart[];
  notice: { n: number; text: string } | null;
  rolled: number;
  /** Loads left on the ground (a hired cart fetched, a taken cart gone back): the client puts them down as goods. */
  dropped: Array<{ id: number; x: number; z: number; items: CartItem[] }>;
  dn: number;
}

// ------------------------------------------------------------------ state

function getState<T>(db: DB, key: string): T | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}
function putState(db: DB, key: string, v: unknown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

export function cartShop(db: DB): CartShop | null {
  return getState<CartShop>(db, "cartshop");
}
/** The player's carts (M8c: each player's own, pstate 'jef_carts'). */
export function jefCarts(db: DB): CartsState {
  const s = pstate<Partial<CartsState>>(db, "jef_carts");
  return {
    n: s?.n ?? 0,
    list: Array.isArray(s?.list) ? s!.list : [],
    notice: s?.notice ?? null,
    rolled: s?.rolled ?? -1,
    dropped: Array.isArray(s?.dropped) ? s!.dropped : [],
    dn: s?.dn ?? 0,
  };
}
function save(db: DB, s: CartsState): void {
  setPstate(db, "jef_carts", s);
}

/** M8c: a cart's id that is his alone (the carts stand in one world): the host's as before, a guest's with his id. */
const cartId = (kind: "jef" | "lent", n: number) => (pid() === 1 ? `cart:${kind}${n}` : `cart:${kind}${pid()}x${n}`);

/** M8c: the player who has a household's cart now (taken, not yet back), or null. */
export function cartHolder(db: DB, ref: string): number | null {
  for (const who of playerIds(db)) if (asPlayer(who, () => jefCarts(db)).list.some((c) => c.id === ref && c.kind === "taken")) return who;
  return null;
}
function notice(s: CartsState, text: string): void {
  s.notice = { n: (s.notice?.n ?? 0) + 1, text };
}

const minuteNow = (db: DB) => {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return (p.day - 1) * 1440 + p.hour * 60 + p.minute;
};
const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** How far the client may say Jef stands from his cart when he loads it, takes it or tips a load off (m). */
const REACH_M = 4.5;

// ------------------------------------------------------------------ the wheelwright in the town

/**
 * The wheelwright and his door, once (a new game, or an older save on its next start): a NEW
 * resident in a free house, the place 'cart_shop', world_state 'cartshop'. Nobody else changes.
 */
export function ensureCartwright(db: DB): boolean {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (!has || cartShop(db)) return false;
  if (db.prepare("SELECT 1 FROM npc WHERE id = ?").get(WHEELWRIGHT_ID)) return false;
  const t = town(db).town;
  const wm = walkMap();
  const velo = getState<{ step: Pt }>(db, "veloshop");
  // a door with room in front: a cart for sale and one for hire stand on the street beside it
  const doors = freeDoors(db)
    .filter((d) => d.storeys >= 2 && (!velo || Math.hypot(velo.step[0] - d.sx, velo.step[1] - d.sz) > 12))
    .map((d) => {
      const along: Pt = [-d.out[1], d.out[0]];
      const pts: Array<[number, number, number]> = [];
      for (const s of [-2.6, 2.6, -3.4, 3.4]) {
        // the cart along the wall, its shafts toward the door; the axle 1.9 m out from the wall
        const x = d.x + d.out[0] * 1.9 + along[0] * s;
        const z = d.z + d.out[1] * 1.9 + along[1] * s;
        const dir: Pt = s < 0 ? [-along[0], -along[1]] : along;
        const gx = x - dir[0] * 1.8;
        const gz = z - dir[1] * 1.8;
        if (wm.open(x, z, 1.0) && wm.open(gx, gz, 0.6) && wm.reachable(x, z) && !pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 3)) {
          pts.push([r1(x), r1(z), r3(Math.atan2(dir[0], dir[1]))]);
        }
      }
      return { d, pts, k: Math.hypot(d.sx - ANCHOR[0], d.sz - ANCHOR[1]) };
    })
    .filter((o) => o.pts.length >= 2 && wm.open(o.d.sx + o.d.out[0] * 0.9, o.d.sz + o.d.out[1] * 0.9, 0.4))
    .sort((a, b) => a.k - b.k);
  const pick = doors[0];
  if (!pick) return false;
  const d = pick.d;
  const rng = rngFrom((t.seed ^ 0x3a7_1c0) >>> 0);
  const first = ["Staf", "Jan", "Pieter", "Lode", "Frans"][Math.floor(rng() * 5)];
  const used = new Set(t.residents.map((r) => r.surname));
  const sn = ["Wagemans", "Van Dyck", "Wielemans", "De Wit", "Verbruggen"].find((s) => !used.has(s)) ?? "Wagemans";
  const at: [number, number, number] = [r1(d.sx + d.out[0] * 0.9), r1(d.sz + d.out[1] * 0.9), r3(Math.atan2(d.out[0], d.out[1]))];
  const hh = Math.max(0, ...t.residents.map((r) => r.household)) + 1;
  const r: Resident = {
    id: WHEELWRIGHT_ID,
    first,
    surname: sn,
    name: `${first} ${sn}`,
    age: 38 + Math.floor(rng() * 16),
    sex: "m",
    household: hh,
    family_role: "single",
    trade: "wheelwright" as Resident["trade"],
    faction: TRADES.wheelwright.faction,
    kind: "shopkeeper",
    home: { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz },
    work: { place: "cart_shop", kind: "post", at },
    sched: { day: [[7.5, 12, "work"], [13, 18.5, "work"]], sunday: [[8.75, 11, "church", "church"]] },
    stats: { honesty: 6, temper: 5, piety: 5, warmth: 5, greed: 4, courage: 6, gossip: 4, wealth: 4 },
    dog: null,
  };
  const shop: CartShop = { id: WHEELWRIGHT_ID, label: `${r.name}'s wheelwright's shop`, step: [d.sx, d.sz], wall: [d.x, d.z], out: d.out, at, show: pick.pts.slice(0, 2) };
  db.transaction(() => {
    db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)").run(r.id, r.name, TRADES.wheelwright.label, "town", r.faction);
    db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(r.id);
    db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)").run(r.id, r.household, r.trade, JSON.stringify(r));
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
    if (row) {
      const rest = JSON.parse(row.value_json) as { places: Record<string, unknown> };
      rest.places.cart_shop = { label: shop.label, x: d.sx, z: d.sz, r: 3, district: "town", door: [d.sx, d.sz], out: d.out };
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
    }
    putState(db, "cartshop", shop);
  })();
  dropTownCache(db);
  dropStealables(db);
  return true;
}

// ------------------------------------------------------------------ buying and hiring

ITEMS.handcart_new = { name: "a new handcart", note: "Ash shafts, elm wheels with iron tyres, a plank bed with rails. Yours." };
ITEMS.handcart_used = { name: "a second-hand handcart", note: "The paint is gone and one rail is new wood, but the wheels run true. Yours." };
ITEMS.handcart_hire = { name: "a handcart for the day", note: "Back at his door before the day is out, or his boy fetches it." };

function refuse(db: DB, kind: "new" | "used" | "hire"): void {
  if (!cartShop(db)) throw new GameError("there is no wheelwright in this town", 409);
  const s = jefCarts(db);
  if (kind === "hire" && s.list.some((c) => c.kind === "hire")) throw new GameError("you have his hire cart already", 409);
  if (kind !== "hire" && s.list.some((c) => c.kind === "new" || c.kind === "used")) throw new GameError("you have a handcart of your own already", 409);
}

/** A cart for Jef, standing at the wheelwright's door (inside the buy's transaction). */
function give(db: DB, kind: "new" | "used" | "hire"): void {
  const s = jefCarts(db);
  const shop = cartShop(db)!;
  const now = minuteNow(db);
  const spot = shop.show[kind === "hire" ? 1 : 0] ?? shop.show[0];
  const id = cartId("jef", ++s.n);
  s.list.push({
    id,
    kind,
    since: now,
    until: kind === "hire" ? now + CART_HIRE_HOURS * 60 : undefined,
    paid_c: kind === "new" ? CART_PRICE.new_c : kind === "used" ? CART_PRICE.used_c : CART_PRICE.hire_c,
    label: kind === "hire" ? "the wheelwright's hire cart" : "your handcart",
    x: spot[0],
    z: spot[1],
    yaw: spot[2],
    held: false,
    load: [],
  });
  save(db, s);
  log(db, kind === "hire" ? "hired_cart" : "bought_cart", id, kind === "hire" ? "Jef hired a handcart for the day from the wheelwright." : `Jef bought a ${kind === "new" ? "new" : "second-hand"} handcart from the wheelwright.`);
}

for (const [item, kind] of [["handcart_new", "new"], ["handcart_used", "used"], ["handcart_hire", "hire"]] as const) {
  ITEM_REF[item] = (db) => {
    refuse(db, kind);
    return null;
  };
  ITEM_BUY[item] = (db) => give(db, kind);
}

// ------------------------------------------------------------------ what the client sees

/** Job goods on a cart whose job is over (done, failed, dropped by the night): gone with the job. */
function cleanJobs(db: DB, s: CartsState): boolean {
  let changed = false;
  const live = new Map<number, boolean>();
  const isLive = (id: number) => {
    if (!live.has(id)) {
      let ok = false;
      try {
        ok = jobRow(db, id).status === "taken";
      } catch {
        ok = false;
      }
      live.set(id, ok);
    }
    return live.get(id)!;
  };
  for (const c of s.list) {
    const keep = c.load.filter((it) => it.job === null || isLive(it.job));
    if (keep.length !== c.load.length) {
      c.load = keep;
      changed = true;
    }
  }
  for (const d of s.dropped) {
    const keep = d.items.filter((it) => it.job === null || isLive(it.job));
    if (keep.length !== d.items.length) {
      d.items = keep;
      changed = true;
    }
  }
  return changed;
}

export function cartView(db: DB) {
  const s = jefCarts(db);
  if (cleanJobs(db, s)) save(db, s);
  const now = minuteNow(db);
  return {
    list: s.list.map((c) => ({ ...c, minutes_left: c.until !== undefined ? Math.max(0, c.until - now) : null, ...loadOf(c.load) })),
    notice: s.notice,
    dropped: s.dropped.filter((d) => d.items.length),
    shop: cartShop(db),
    prices: CART_PRICE,
    limit: CART_LIMIT,
  };
}

function cartOf(s: CartsState, id: string): JefCart {
  const c = s.list.find((q) => q.id === id);
  if (!c) throw new GameError("that is not your cart", 404);
  return c;
}
const finite = (...n: number[]) => n.every((v) => Number.isFinite(v));
function near(c: JefCart, x: number, z: number, m = REACH_M): void {
  if (!finite(x, z)) throw new GameError("bad place", 400);
  if (Math.hypot(c.x - x, c.z - z) > m) throw new GameError("too far from the cart", 409);
}

// ------------------------------------------------------------------ taking hold, letting go

/** Jef takes hold of one of his carts (bought, hired or taken before). One at a time. */
export function holdCart(db: DB, id: string, x: number, z: number): JefCart {
  const s = jefCarts(db);
  const c = cartOf(s, id);
  near(c, x, z);
  if (s.list.some((q) => q.held && q.id !== id)) throw new GameError("you have hold of another cart", 409);
  c.held = true;
  save(db, s);
  return c;
}

/** Where the cart is while he pushes it (every few seconds), or where he lets go of it (held false). */
export function cartAt(db: DB, id: string, x: number, z: number, yaw: number, held: boolean): JefCart {
  const s = jefCarts(db);
  const c = cartOf(s, id);
  if (!finite(x, z, yaw)) throw new GameError("bad place", 400);
  if (!c.held) throw new GameError("you have not got hold of it", 409);
  // a push never moves it further than a man walks between two reports; anything else is refused
  if (Math.hypot(c.x - x, c.z - z) > 60) throw new GameError("the cart is not there", 409);
  const wm = walkMap();
  let q: { x: number; z: number } | null = { x, z };
  if (!held) {
    // parked on open ground (the client keeps the whole cart clear; here: the axle on open ground)
    if (!wm.open(x, z, 0.3)) q = wm.nearestOpen(x, z, 4);
    if (!q) throw new GameError("you cannot leave it there", 409);
  }
  c.x = r1(q.x);
  c.z = r1(q.z);
  c.yaw = r3(yaw);
  c.held = held;
  // M7 short jobs: a lent cart let go where it stood, its job over: the employer's man takes it in
  if (!held && c.kind === "lent") lentBack(db, s, c);
  save(db, s);
  return c;
}

// ------------------------------------------------------------------ loading and unloading

/**
 * Something onto a parked cart: the goods in Jef's hands (a job's or anyone's), or the piece of
 * furniture in his arms. The engine checks the size and the weight, and that a job's goods are
 * the job's.
 */
export function loadCart(db: DB, id: string, raw: Partial<CartItem>, x: number, z: number): { cart: JefCart; item: CartItem } {
  const s = jefCarts(db);
  const c = cartOf(s, id);
  near(c, x, z);
  if (c.held) throw new GameError("let go of the shafts first", 409);
  const kind = String(raw.kind ?? "");
  const item: CartItem = { kind, job: null, owner: typeof raw.owner === "string" ? raw.owner.slice(0, 24) : null };
  if (raw.broken === true) item.broken = true;
  if (raw.heavy === true) item.heavy = true;
  if (raw.piece !== undefined && raw.piece !== null) {
    // furniture from his arms
    const it = db.prepare("SELECT id, kind, state FROM home_item WHERE id = ? AND player_id = ?").get(Number(raw.piece), pid()) as { id: number; kind: string; state: string } | undefined;
    if (!it || it.state !== "arms") throw new GameError("you are not carrying that", 409);
    item.kind = it.kind;
    item.piece = it.id;
    item.owner = null;
  } else {
    if (!LOAD[kind] || kind === "chair" || kind === "table" || kind === "stove" || kind === "rug" || kind === "plant" || kind === "birdcage") throw new GameError("that does not go on a handcart", 400);
    if (raw.job !== undefined && raw.job !== null) {
      const jid = Number(raw.job);
      let j;
      try {
        j = jobRow(db, jid);
      } catch {
        throw new GameError("no such job", 404);
      }
      if (j.status !== "taken" || (j.taken_by ?? 1) !== pid() || !j.task || (j.task.kind !== "carry" && j.task.kind !== "deliver")) throw new GameError("that job is not in hand", 409);
      if (j.task.goods !== kind) throw new GameError("those are not the job's goods", 409);
      const count = j.task.kind === "carry" ? j.task.count : 1;
      const p = j.task.progress ?? { delivered: 0, lost: 0, sold: 0 };
      const onCarts = s.list.reduce((n, q) => n + q.load.filter((it) => it.job === jid).length, 0);
      if (onCarts + p.delivered + p.lost + p.sold + 1 > count) throw new GameError("more goods than the job has", 409);
      item.job = jid;
    }
  }
  const why = canLoad(c.load, item);
  if (why) throw new GameError(why, 409);
  db.transaction(() => {
    if (item.piece !== undefined) db.prepare("UPDATE home_item SET state = 'gone' WHERE id = ? AND player_id = ?").run(item.piece, pid());
    c.load.push(item);
    save(db, s);
  })();
  return { cart: c, item };
}

/** One thing off a parked cart into Jef's hands (the top one unless `index` says). */
export function unloadOne(db: DB, id: string, x: number, z: number, index?: number): { cart: JefCart; item: CartItem } {
  const s = jefCarts(db);
  const c = cartOf(s, id);
  near(c, x, z);
  if (c.held) throw new GameError("let go of the shafts first", 409);
  if (!c.load.length) throw new GameError("the cart is empty", 409);
  const i = index === undefined || !Number.isInteger(index) ? c.load.length - 1 : index;
  const item = c.load[i];
  if (!item) throw new GameError("nothing like that on the cart", 404);
  if (item.piece !== undefined && db.prepare("SELECT 1 FROM home_item WHERE state = 'arms' AND player_id = ?").get(pid())) throw new GameError("your arms are full", 409);
  db.transaction(() => {
    if (item.piece !== undefined) db.prepare("UPDATE home_item SET state = 'arms' WHERE id = ? AND player_id = ?").run(item.piece, pid());
    c.load.splice(i, 1);
    save(db, s);
  })();
  return { cart: c, item };
}

/**
 * The whole of a job's goods off at its goal, with one key, where the job allows it
 * (shared/handcart.ts unloadAllAllowed). Jef and the cart must be by the goal. The client sets
 * them down there and the job counts each (the pay is the job board's: per thing, not per trip).
 */
export function unloadJob(db: DB, id: string, jobId: number, x: number, z: number): { cart: JefCart; items: CartItem[] } {
  const s = jefCarts(db);
  const c = cartOf(s, id);
  let j;
  try {
    j = jobRow(db, jobId);
  } catch {
    throw new GameError("no such job", 404);
  }
  if (j.status !== "taken" || (j.taken_by ?? 1) !== pid() || !j.task || j.task.kind === "letters") throw new GameError("that job is not in hand", 409);
  if (!unloadAllAllowed(j.task)) throw new GameError("this job wants them one by one", 409);
  const to = (SPOTS as unknown as Record<string, { x: number; z: number }>)[(j.task as { to: string }).to];
  if (!to || !finite(x, z)) throw new GameError("bad place", 400);
  if (Math.hypot(to.x - x, to.z - z) > UNLOAD_NEAR_M) throw new GameError("this is not where the goods go", 409);
  if (Math.hypot(c.x - to.x, c.z - to.z) > UNLOAD_NEAR_M + 3) throw new GameError("bring the cart to the place first", 409);
  const items = c.load.filter((it) => it.job === jobId);
  if (!items.length) throw new GameError("none of the job's goods are on the cart", 409);
  c.load = c.load.filter((it) => it.job !== jobId);
  save(db, s);
  log(db, "unloaded_cart", String(jobId), `Jef tipped ${items.length} ${j.task.goods} off his handcart at ${(SPOTS as unknown as Record<string, { label: string }>)[(j.task as { to: string }).to]?.label ?? "the place"}.`);
  return { cart: c, items };
}

/** The client has put these dropped loads down as goods. */
export function ackDropped(db: DB, ids: number[]): void {
  const s = jefCarts(db);
  s.dropped = s.dropped.filter((d) => !ids.includes(d.id));
  save(db, s);
}

/** A load left on the ground where the cart stood: goods for the client; furniture to Jef's room (or gone). */
function dropLoad(db: DB, s: CartsState, c: JefCart, piecesTo: "home" | "gone"): void {
  const goods = c.load.filter((it) => it.piece === undefined);
  const pieces = c.load.filter((it) => it.piece !== undefined);
  const l = piecesTo === "home" ? lease(db) : null;
  for (const p of pieces) {
    if (l) db.prepare("UPDATE home_item SET state = 'stored', home = ?, gx = NULL, gz = NULL WHERE id = ? AND player_id = ?").run(l.home, p.piece, pid());
    // else it stays 'gone' (it went with the cart)
  }
  if (goods.length) s.dropped.push({ id: ++s.dn, x: c.x, z: c.z, items: goods });
  c.load = [];
}

// ------------------------------------------------------------------ each game hour: hires that run out, thieves

const lastJef = new WeakMap<DB, Map<number, { x: number; z: number; at: number }>>();
/** Where Jef was last seen by the client (every few seconds while he has a cart). Per player (M8c). */
export function cartSeen(db: DB, x: number, z: number, at = Date.now()): void {
  if (!finite(x, z)) return;
  const m = lastJef.get(db) ?? new Map<number, { x: number; z: number; at: number }>();
  m.set(pid(), { x, z, at });
  lastJef.set(db, m);
}

/** M6 hired hands (town/hire.ts): a hand Jef pays to watch his things keeps thieves off a cart near him. */
export const cartGuards: Array<(db: DB, x: number, z: number) => boolean> = [];

/**
 * M6 hired hands: Jef lends an empty cart of his (not in his hands) to a hand, who pushes it for
 * him: it is out of Jef's list while lent (the client takes it off the street; the hand's own cart
 * is drawn instead). Null when it cannot be lent.
 */
export function lendCart(db: DB, id: string): JefCart | null {
  const s = jefCarts(db);
  const c = s.list.find((q) => q.id === id);
  if (!c || c.held || c.load.length) return null;
  s.list = s.list.filter((q) => q !== c);
  save(db, s);
  return c;
}

/** The lent cart back in Jef's list, empty, where the hand left it (on open ground). */
export function returnCart(db: DB, c: JefCart, x: number, z: number, yaw: number): void {
  const s = jefCarts(db);
  if (s.list.some((q) => q.id === c.id)) return;
  const q = walkMap().nearestOpen(x, z, 4) ?? { x: c.x, z: c.z };
  s.list.push({ ...c, x: r1(q.x), z: r1(q.z), yaw: r3(yaw), held: false, load: [] });
  save(db, s);
}

/** Safe: at the wheelwright's door, or at Jef's rented home's door (M6 homes). */
function safeAt(db: DB, x: number, z: number): boolean {
  const shop = cartShop(db);
  if (shop && Math.hypot(shop.step[0] - x, shop.step[1] - z) < 9) return true;
  const l = lease(db);
  if (!l) return false;
  const home = getState<{ homes: Array<{ id: string; step: Pt }> }>(db, "homes")?.homes.find((h) => h.id === l.home);
  return !!home && Math.hypot(home.step[0] - x, home.step[1] - z) < 8;
}

/**
 * The hour's work (from the tick; M8c: for each player, his own carts): a hire that ran out is fetched
 * (a fee; the load is left where it stood), an unwatched cart of his own in a busy place may be wheeled off, load and all.
 * `rng` and `now` are test seams. Returns what happened.
 */
export function cartHour(db: DB, rng: () => number = Math.random, now = Date.now()): string[] {
  // one transaction: a fee taken and the cart gone, or neither
  return db.transaction(() => cartHourNow(db, rng, now))();
}

function cartHourNow(db: DB, rng: () => number, now: number): string[] {
  const s = jefCarts(db);
  if (!s.list.length) return [];
  const minute = minuteNow(db);
  // M7 short jobs: a lent cart after its job (every tick, not once an hour)
  const lent = lentTick(db, s, minute);
  const hourNo = Math.floor(minute / 60);
  if (hourNo === s.rolled) {
    if (lent.length) save(db, s);
    return lent;
  }
  s.rolled = hourNo;
  const out: string[] = [];
  const p = player(db);
  const maker = town(db).byId.get(WHEELWRIGHT_ID);
  for (const c of [...s.list]) {
    if (c.held) continue;
    if (c.kind === "hire" && c.until !== undefined && minute >= c.until) {
      const shop = cartShop(db);
      const back = !!shop && Math.hypot(shop.step[0] - c.x, shop.step[1] - c.z) < 10;
      const fee = back ? 0 : Math.min(p.money_c, CART_FETCH_FEE_C);
      if (fee) db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(fee, pid());
      const had = c.load.length;
      dropLoad(db, s, c, "home");
      s.list = s.list.filter((q) => q.id !== c.id);
      const text = back
        ? "The day's hire is over; the handcart is back at the wheelwright's."
        : `The day's hire is over. The wheelwright's boy fetched the handcart from where you left it${had ? " and left what was on it on the stones" : ""}${fee ? `, and ${maker?.first ?? "the wheelwright"} took ${fee} centimes for his trouble` : ""}.`;
      notice(s, text);
      log(db, "cart_fetched", c.id, text);
      out.push("fetched");
      continue;
    }
    // a cart of his own (bought or hired) left alone in a busy place, Jef not by it
    if (c.kind === "taken" || safeAt(db, c.x, c.z) || !busyAt(db, c.x, c.z) || cartGuards.some((g) => g(db, c.x, c.z))) continue;
    const seen = lastJef.get(db)?.get(pid());
    if (seen && now - seen.at < 30_000 && Math.hypot(seen.x - c.x, seen.z - c.z) < CART_WATCHED_M) continue;
    const night = p.hour >= 20 || p.hour < 6;
    if (rng() >= (night ? CART_THEFT_PER_HOUR.night : CART_THEFT_PER_HOUR.day)) continue;
    stealFromJef(db, s, c, rng);
    out.push("stolen");
  }
  save(db, s);
  return [...lent, ...out];
}

/** Someone wheels off Jef's cart and what is on it: gone, a robbery on the record, the town talks. */
function stealFromJef(db: DB, s: CartsState, c: JefCart, rng: () => number): void {
  const t = town(db).town;
  const thieves = t.residents.filter((r) => r.trade === "thief");
  const thief = thieves.length ? thieves[Math.floor(rng() * thieves.length)] : null;
  const where = nearestPlaceLabel(db, c.x, c.z);
  const jobGoods = c.load.filter((it) => it.job !== null).length;
  // the furniture on it goes with the cart
  c.load = [];
  s.list = s.list.filter((q) => q.id !== c.id);
  const text =
    (c.kind === "hire"
      ? "The handcart you hired is gone from where you left it. The wheelwright will want it paid for."
      : c.kind === "lent"
        ? `${capital(c.label)} is gone from where you left it. Somebody wheeled it off, and you will pay for it.`
        : "Your handcart is gone from where you left it. Somebody wheeled it off.") + (jobGoods ? " What was on it went with it." : "");
  notice(s, text);
  // M7 short jobs: the lender's cart lost: Jef pays for it, and the employer does not forget
  if (c.kind === "lent") lentLost(db, c);
  if (thief) log(db, "robbed", thief.id, `Someone wheeled off Jef's handcart ${where}, worth ${c.paid_c} centimes.`, "world");
  const nearBy = t.residents
    .filter((r) => r.work.at && r.trade !== "thief")
    .map((r) => ({ r, d: Math.hypot(r.work.at![0] - c.x, r.work.at![1] - c.z) }))
    .sort((a, b) => a.d - b.d)[0];
  if (nearBy && nearBy.d < 60) {
    remember(db, nearBy.r.id, `I saw a man wheel off the new man's handcart ${where}. It was not Jef pushing it.`, 5, "seen", null, { gist: `Jef's handcart was stolen ${where}`, tone: 0 });
  }
  if (c.kind === "hire") remember(db, WHEELWRIGHT_ID, "The handcart I hired to Jef was wheeled off from under his nose.", 4);
}

function nearestPlaceLabel(db: DB, x: number, z: number): string {
  let best = "in the street";
  let bd = 60;
  for (const p of Object.values(town(db).town.places)) {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < bd && p.label) [bd, best] = [d, `by ${p.label}`];
  }
  return best;
}

// ------------------------------------------------------------------ M7 short jobs: the employer's handcart, lent for a cart job

/**
 * Where the lent cart stands by the goods: near the pile (the goods stack along the spot's `dir`,
 * half a metre to each side) but clear of it, pointing along it, on open reachable ground, off the
 * quay railway, the crane runways and the omnibus and dray lanes (possessions.ts offLanes: the train
 * would wait for it), and off the landmarks' doorways. Null if there is no room within 12 m.
 */
export function lentSpot(spotId: string): [number, number, number] | null {
  const sp = (SPOTS as unknown as Record<string, { x: number; z: number; dir?: [number, number] }>)[spotId];
  if (!sp) return null;
  const [dx, dz] = sp.dir ?? [1, 0];
  const wm = walkMap();
  const yaw = r3(Math.atan2(dx, dz));
  // the pile: up to eight things, two by two along dir from the spot
  const pile = (x: number, z: number) => {
    const along = (x - sp.x) * dx + (z - sp.z) * dz;
    const across = Math.abs(-(x - sp.x) * dz + (z - sp.z) * dx);
    return along > -1.6 && along < 4.6 && across < 1.9;
  };
  // first off every lane; where the goods themselves lie in a street's lane (a narrow quay), off the rails
  // at least: the drays and the omnibus go round a cart (M6 handcart), the goods train cannot
  for (const lanes of [true, false]) {
    const clear = (x: number, z: number, r: number) => wm.open(x, z, r) && (lanes ? offLanes(x, z, 0.9) : offRails(x, z, 0.9)) && !onDoorway(x, z, 0.9) && !pile(x, z);
    for (let r = 2.6; r <= 12; r += 0.6) {
      const n = Math.max(12, Math.round(r * 5));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = sp.x + Math.cos(a) * r;
        const z = sp.z + Math.sin(a) * r;
        // the axle, the grips 1.8 m behind it, the front of the bed 1 m ahead
        if (clear(x, z, 1.0) && clear(x - dx * 1.8, z - dz * 1.8, 0.6) && clear(x + dx, z + dz, 0.6) && wm.reachable(x, z)) return [r1(x), r1(z), yaw];
      }
    }
  }
  return null;
}

/** The quay railway and the crane runways (city.json decor, as the client's world/tracks.ts trackKeepOut): a cart never stands there. */
const RAILS: Array<{ s: [number, number, number, number]; half: number }> = (() => {
  const decor = (CITY as unknown as { decor?: { tracks?: Array<{ pts: Pt[] }>; crane_rails?: Array<[number, number, number, number]> } }).decor ?? {};
  const out: Array<{ s: [number, number, number, number]; half: number }> = [];
  for (const t of decor.tracks ?? []) for (let i = 0; i < t.pts.length - 1; i++) out.push({ s: [t.pts[i][0], t.pts[i][1], t.pts[i + 1][0], t.pts[i + 1][1]], half: 1.5 });
  for (const c of decor.crane_rails ?? []) out.push({ s: c, half: 0.6 });
  return out;
})();
export function offRails(x: number, z: number, margin = 0.9): boolean {
  for (const { s: [ax, az, bx, bz], half } of RAILS) {
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    if (Math.hypot(x - (ax + dx * t), z - (az + dz * t)) < half + margin) return false;
  }
  return true;
}

/**
 * The client knows the quay's own things (stacked crates, barrels, the railway's standing wagon) that
 * the walk map does not: once, before anyone has touched it, it may move the lent cart a few metres to
 * where the whole cart fits with room to swing. Where it then stands is where it goes back to.
 */
export function placeLent(db: DB, id: string, x: number, z: number, yaw: number): JefCart {
  const s = jefCarts(db);
  const c = cartOf(s, id);
  if (!finite(x, z, yaw)) throw new GameError("bad place", 400);
  if (c.kind !== "lent" || c.placed || c.held || c.load.length) throw new GameError("that cart stays where it is", 409);
  if (Math.hypot(c.x - x, c.z - z) > 12) throw new GameError("too far from where it stood", 409);
  const wm = walkMap();
  if (!wm.open(x, z, 0.3) || !offRails(x, z, 0.3)) throw new GameError("it cannot stand there", 409);
  c.x = r1(x);
  c.z = r1(z);
  c.yaw = r3(yaw);
  c.home = [c.x, c.z];
  c.placed = true;
  save(db, s);
  return c;
}

/** Where a lent cart goes back: within this many metres of where it stood. */
export const LENT_HOME_M = 8;

/**
 * A cart job taken (game.ts takeHooks): the employer's handcart stands by the goods, lent to Jef. Not
 * when a cart of his own (bought or hired) stands within OWN_CART_NEAR_M of the goods: he uses his.
 */
export function lendForJob(db: DB, j: JobRow): JefCart | null {
  const t = j.task;
  if (!t || t.kind !== "carry" || !t.cart) return null;
  const s = jefCarts(db);
  if (s.list.some((c) => c.kind === "lent" && c.job === j.id)) return null;
  const from = (SPOTS as unknown as Record<string, { x: number; z: number; label: string }>)[t.from];
  const own = s.list.find((c) => (c.kind === "new" || c.kind === "used" || c.kind === "hire") && !!from && Math.hypot(c.x - from.x, c.z - from.z) <= OWN_CART_NEAR_M);
  if (own) {
    log(db, "own_cart", String(j.id), `Jef took "${j.title}" with his own handcart standing by the goods.`);
    return null;
  }
  const at = lentSpot(t.from);
  if (!at) return null;
  const name = employerName(db, j.employer_npc);
  const c: JefCart = {
    id: cartId("lent", ++s.n),
    kind: "lent",
    since: minuteNow(db),
    paid_c: 0,
    label: `${name}'s handcart`,
    job: j.id,
    lender: j.employer_npc,
    home: [at[0], at[1]],
    x: at[0],
    z: at[1],
    yaw: at[2],
    held: false,
    load: [],
  };
  s.list.push(c);
  notice(s, `${name}'s handcart stands by the goods at ${from?.label ?? "the place"}. Load it, push it, and bring it back there when the work is done.`);
  save(db, s);
  log(db, "lent_cart", String(j.id), `${name} lent Jef a handcart for "${j.title}".`);
  return c;
}
takeHooks.push((db, j) => void lendForJob(db, j));

const jobOver = (db: DB, id: number | undefined): boolean => {
  if (id === undefined) return true;
  const r = db.prepare("SELECT status FROM job WHERE id = ?").get(id) as { status: string } | undefined;
  return !r || r.status !== "taken";
};
const atHome = (c: JefCart) => !!c.home && Math.hypot(c.home[0] - c.x, c.home[1] - c.z) <= LENT_HOME_M;
const capital = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Its job over and let go where it stood: the employer's man takes it in. True when it went. */
function lentBack(db: DB, s: CartsState, c: JefCart): boolean {
  if (c.kind !== "lent" || c.held || !atHome(c) || !jobOver(db, c.job)) return false;
  if (c.load.length) dropLoad(db, s, c, "home");
  s.list = s.list.filter((q) => q.id !== c.id);
  notice(s, `You leave ${c.label} where it stood. ${employerName(db, c.lender ?? "")}'s man wheels it in.`);
  log(db, "returned_cart", c.id, `Jef brought ${c.label} back where it stood.`);
  return true;
}

/**
 * Every tick: a lent cart whose job is over. Back where it stood: taken in. Else the hour to bring it
 * back starts (a notice); past it, the employer's man fetches it: CART_LEFT_FEE_C and trust -1.
 */
function lentTick(db: DB, s: CartsState, minute: number): string[] {
  const out: string[] = [];
  for (const c of [...s.list]) {
    if (c.kind !== "lent" || !jobOver(db, c.job)) continue;
    if (lentBack(db, s, c)) {
      out.push("returned");
      continue;
    }
    if (c.until === undefined) {
      c.until = minute + CART_RETURN_MIN;
      notice(s, `The work is done. ${capital(c.label)} goes back ${c.home ? nearestSpotLabel(c.home[0], c.home[1]) : "where it stood"} within the hour, or his man fetches it and it costs you.`);
      out.push("due");
      continue;
    }
    // still in his hands: on its way back (the hour runs on; he is fetched from where he lets go)
    if (minute < c.until || c.held) continue;
    const fee = Math.min(player(db).money_c, CART_LEFT_FEE_C);
    if (fee) db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(fee, pid());
    const faction = ALL_EMPLOYERS[c.lender ?? ""]?.faction;
    if (faction) db.prepare("UPDATE faction_trust SET trust = MAX(-5, MIN(10, trust - 1)) WHERE faction = ? AND player_id = ?").run(faction, pid());
    dropLoad(db, s, c, "home");
    s.list = s.list.filter((q) => q.id !== c.id);
    const name = employerName(db, c.lender ?? "");
    notice(s, `${name}'s man had to go and fetch his handcart from where you left it${fee ? `; ${fee} centimes come off your purse for his trouble` : ""}.`);
    log(db, "cart_left", c.id, `Jef left ${c.label} lying after the work; ${name}'s man fetched it${fee ? ` and ${fee} centimes were taken for it` : ""}.`);
    if (c.lender) remember(db, c.lender, "I lent Jef my handcart for a job and had to send my man to fetch it from where he left it.", 4, "seen", null, { gist: `Jef left ${name}'s handcart lying in the street`, tone: -1 });
    out.push("fetched");
  }
  return out;
}

/** The lent cart wheeled off by a thief: Jef pays for it (CART_LOST_C, or what he has), trust -2 with the lender. */
function lentLost(db: DB, c: JefCart): void {
  const cost = Math.min(player(db).money_c, CART_LOST_C);
  if (cost) db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(cost, pid());
  const faction = ALL_EMPLOYERS[c.lender ?? ""]?.faction;
  if (faction) db.prepare("UPDATE faction_trust SET trust = MAX(-5, MIN(10, trust - 2)) WHERE faction = ? AND player_id = ?").run(faction, pid());
  const name = employerName(db, c.lender ?? "");
  log(db, "lost_lent_cart", c.id, `${capital(c.label)} was stolen while Jef had it; he paid ${cost} centimes for it.`);
  if (c.lender) remember(db, c.lender, `I lent Jef my handcart and he let a thief wheel it off. He paid ${cost} centimes of what it was worth.`, 6, "seen", null, { gist: `Jef lost ${name}'s handcart to a thief`, tone: -2 });
}

function nearestSpotLabel(x: number, z: number): string {
  let best = "where it stood";
  let bd = LENT_HOME_M + 4;
  for (const [k, sp] of Object.entries(SPOTS as unknown as Record<string, { x: number; z: number; label?: string }>)) {
    if (k.startsWith("_") || !sp.label) continue;
    const d = Math.hypot(sp.x - x, sp.z - z);
    if (d < bd) [bd, best] = [d, `to ${sp.label}`];
  }
  return best;
}

// ------------------------------------------------------------------ a household's cart (a deed: deeds.ts)

/** Where a household's cart stands now (the owner's day), or where Jef left it if he has it. */
cartHooks.find = (db, ref) => {
  const v = vehicleOf(db, ref);
  if (!v || v.kind !== "handcart") return null;
  const mine = jefCarts(db).list.find((c) => c.id === ref && c.kind === "taken") ?? null;
  if (mine) return { owner: v.owner, x: mine.x, z: mine.z, where: "", mine: { deed: mine.deed ?? null, held: mine.held } };
  // (M8c: another player has it: not there to take)
  const other = cartHolder(db, ref);
  if (other !== null) {
    const c = asPlayer(other, () => jefCarts(db)).list.find((q) => q.id === ref)!;
    return { owner: v.owner, x: c.x, z: c.z, where: "", mine: null, by: other };
  }
  const { day, hour } = clockNow(db);
  const now = vehicleNow(db, v, day, hour);
  const where = now.key === "home" ? "from outside their house" : "from beside their stall";
  return { owner: v.owner, x: now.spot[0], z: now.spot[1], yaw: now.spot[2], where, mine: null };
};
/** Jef has it now: his to push (held), until it goes back. */
cartHooks.taken = (db, ref, deed, at) => {
  const s = jefCarts(db);
  const v = vehicleOf(db, ref);
  if (s.list.some((c) => c.held)) for (const c of s.list) c.held = false;
  s.list = s.list.filter((c) => c.id !== ref);
  s.list.push({ id: ref, kind: "taken", since: minuteNow(db), paid_c: 0, owner: v?.owner, deed, label: v?.label ?? "a handcart", x: at.x, z: at.z, yaw: at.yaw, held: true, load: [] });
  save(db, s);
};
cartHooks.again = (db, ref) => {
  const s = jefCarts(db);
  if (s.list.some((c) => c.held && c.id !== ref)) throw new GameError("you have hold of another cart", 409);
  const c = s.list.find((q) => q.id === ref);
  if (c) c.held = true;
  save(db, s);
};
/** Back to its household (given back, or the police): whatever is on it is left on the ground (M8c: by whoever has it). */
cartHooks.home = (db, ref) =>
  asPlayer(cartHolder(db, ref) ?? pid(), () => {
    const s = jefCarts(db);
    const c = s.list.find((q) => q.id === ref && q.kind === "taken");
    if (!c) return;
    dropLoad(db, s, c, "home");
    s.list = s.list.filter((q) => q.id !== ref);
    save(db, s);
  });
/** (M8c: the deed's own player still has it) */
cartHooks.held = (db, d: DeedRow) => asPlayer(d.player_id ?? 1, () => jefCarts(db).list.some((c) => c.id === d.ref && c.kind === "taken" && c.deed === d.id));
/** (M8c: away from its household with any player) */
cartHooks.gone = (db, id) => cartHolder(db, id) !== null;

/** A new game: no carts, for any player. */
export function clearJefCarts(db: DB): void {
  db.prepare("DELETE FROM world_state WHERE key = 'jef_carts'").run();
  db.prepare("DELETE FROM player_state WHERE key = 'jef_carts'").run();
}
