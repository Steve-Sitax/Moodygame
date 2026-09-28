import type { DB } from "../db.ts";
import { clock } from "../day.ts";
import { resident, town } from "../town/store.ts";
import { MILLS, type StockEvent } from "../../../shared/mills.ts";
import { DISPATCH_EVERY_MIN, FISH_PER_BOX, KILL_AT, LAST_LINE, LOAVES_PER_SACK, POSTS, POST_BY_ID, RUN_MAX, WARE_GOOD, demandFactor, killPortions, postOpen, runAt, stockPrice, type Post, type TradeRun } from "../../../shared/trade.ts";
import { wayBetween } from "../town/ways.ts";
import { wayLength } from "../town/wayfind.ts";
import { activityAt } from "../town/schedule.ts";

// T3, the town's trade (docs/milestones/T3-trade.md): the ledger of the posts that keep food. Stepped with the clock in
// five-minute steps (as the mills' stepStocks; at most three days of a gap), saved in world_state "trade". The town
// takes from each open post through the day, down to its floor; the bake, the butcher's kill and the fish boxes set
// in at the stalls fill them; a player's buying takes one, below the floor too (food never runs out for a player).

const KEY = "trade";
const STEP = 5;

export interface Ledger {
  /** Game minute counted to. */
  at: number;
  /** Units on each post's shelf (fractions: the town's buying is spread over the hour). */
  stock: Record<string, number>;
  /** Units sold to the town and to players today (for the map and the talk). */
  sold: Record<string, { town: number; players: number; day: number }>;
  /** T3 part 2: the dispatcher's runs out now, and the game minute it last looked. */
  runs?: TradeRun[];
  looked?: number;
}

const absMin = (day: number, hour: number, minute: number) => (day - 1) * 1440 + hour * 60 + minute;
const nowMin = (db: DB) => {
  const c = clock(db);
  return absMin(c.day, c.hour, c.minute);
};

function fresh(at: number): Ledger {
  return { at, stock: Object.fromEntries(POSTS.map((p) => [p.id, p.start])), sold: {} };
}

function read(db: DB): Ledger | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(KEY) as { value_json: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value_json) as Ledger;
  } catch {
    return null;
  }
}
/** Save the ledger (the dev menu). */
export function writeLedger(db: DB, l: Ledger): void {
  write(db, l);
}
function write(db: DB, l: Ledger): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(KEY, JSON.stringify(l));
}

const soldOf = (l: Ledger, post: string, day: number) => {
  let s = l.sold[post];
  if (!s || s.day !== day) l.sold[post] = s = { town: 0, players: 0, day };
  return s;
};

/** Step the ledger to game minute `to`: the town's buying, the butcher's kill. Pure on the ledger. */
export function stepLedger(l: Ledger, to: number): void {
  if (to <= l.at) return;
  let t = Math.max(l.at, to - 3 * 1440);
  t = Math.floor(t / STEP) * STEP;
  while (t + STEP <= to) {
    const day = Math.floor(t / 1440) + 1;
    const ha = (t % 1440) / 60;
    const hb = ha + STEP / 60;
    for (const p of POSTS) {
      let s = l.stock[p.id] ?? p.start;
      // the butcher's morning kill in his yard (weekdays)
      if (p.good === "meat" && ha < KILL_AT && hb >= KILL_AT && day % 7 !== 0) s = Math.min(p.room, s + killPortions(day));
      // the town's buying, down to the floor
      if (postOpen(p, day, ha) && s > p.floor) {
        const want = (p.perHour * demandFactor(p.good, ha) * STEP) / 60;
        const took = Math.min(want, s - p.floor);
        s -= took;
        soldOf(l, p.id, day).town += took;
      }
      l.stock[p.id] = s;
    }
    t += STEP;
  }
  l.at = Math.max(l.at, t);
}

/** The ledger now: moved on with the clock (a new week, or a clock set back: afresh); the runs settled and sent. */
export function tradeLedger(db: DB): Ledger {
  const now = nowMin(db);
  let l = read(db);
  if (!l || now < l.at - STEP || !POSTS.every((p) => l!.stock[p.id] !== undefined)) l = fresh(now);
  stepLedger(l, now);
  settleRuns(l, now);
  if (l.looked === undefined || Math.floor(now / DISPATCH_EVERY_MIN) !== Math.floor(l.looked / DISPATCH_EVERY_MIN)) {
    l.looked = now;
    dispatch(db, l, now);
  }
  write(db, l);
  return l;
}

// ------------------------------------------------------------------ the dispatcher (T3 part 2)

/** Where a post's goods go in and out: the step before its shop door. */
function postDoor(db: DB, id: string): [number, number] | null {
  const s = town(db).town.shops.find((q) => q.id === id);
  if (!s) return null;
  return [s.door[0] + s.out[0] * 1.4, s.door[1] + s.out[1] * 1.4];
}

/** A run's goods reach the target's shelf at the end of the unloading; a run that is over goes. */
export function settleRuns(l: Ledger, now: number): void {
  if (!l.runs?.length) return;
  for (const r of l.runs) {
    const at = runAt(r, now);
    if (!r.done && (at.phase === "back" || at.phase === "over")) {
      const p = POST_BY_ID[r.to];
      if (p) l.stock[r.to] = Math.min(p.room, (l.stock[r.to] ?? 0) + r.n);
      r.done = true;
    }
  }
  l.runs = l.runs.filter((r) => runAt(r, now).phase !== "over");
}

/** The source post's man for a run: one of its people at work now, not its master (he bakes), not out already. */
function carrierFor(db: DB, from: string, day: number, hour: number, busy: Set<string>): string | null {
  const people = town(db).town.residents.filter((r) => r.work.shop === from && !busy.has(r.id) && r.age >= 12 && activityAt(r.sched, day, hour).act === "work");
  const pick = people.find((r) => r.trade !== "baker") ?? people[0];
  return pick?.id ?? null;
}

/**
 * Every quarter hour: a post under its order level in its open hours, with nothing on the way to it, gets a run from
 * another post of the same good that has plenty (its shelf well over its own order level): one of that post's people
 * takes it over on foot. The goods leave the source's shelf now. (Fish and meat have one post each: their shortage is
 * work for players, the dockers' boxes and the morning's kill.)
 */
export function dispatch(db: DB, l: Ledger, now: number): TradeRun[] {
  const made: TradeRun[] = [];
  const day = Math.floor(now / 1440) + 1;
  const hour = (now % 1440) / 60;
  l.runs ??= [];
  const busy = new Set(l.runs.map((r) => r.man));
  for (const p of POSTS) {
    if (!postOpen(p, day, hour) || hour > p.open[1] - 1.5) continue;
    const coming = l.runs.filter((r) => r.to === p.id && !r.done).reduce((a, r) => a + r.n, 0);
    const have = l.stock[p.id] ?? p.start;
    if (have + coming >= p.order || coming > 0) continue;
    const src = POSTS.filter((q) => q.id !== p.id && q.good === p.good && (l.stock[q.id] ?? q.start) > q.order + 10).sort((a, b) => (l.stock[b.id] ?? 0) - (l.stock[a.id] ?? 0))[0];
    if (!src) continue;
    const n = Math.floor(Math.min(RUN_MAX[p.good], (l.stock[src.id] ?? 0) - src.order - 5, p.room - have));
    if (n < 6) continue;
    const man = carrierFor(db, src.id, day, hour, busy);
    const a = postDoor(db, src.id);
    const b = postDoor(db, p.id);
    if (!man || !a || !b) continue;
    const way = wayBetween(a[0], a[1], b[0], b[1]);
    if (!way || way.length < 2) continue;
    const run: TradeRun = { id: `trade:${src.id}>${p.id}:${now}`, good: p.good, from: src.id, to: p.id, n, man, t0: now, way: way.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10]), len: Math.round(wayLength(way)), done: false };
    l.stock[src.id] = (l.stock[src.id] ?? 0) - n;
    l.runs.push(run);
    busy.add(man);
    made.push(run);
  }
  return made;
}

/** Add units to a post (the bake, the fish boxes), up to its room. */
export function supply(db: DB, post: string, n: number): number {
  const p = POST_BY_ID[post];
  if (!p || n <= 0) return 0;
  const l = tradeLedger(db);
  const before = l.stock[post] ?? 0;
  l.stock[post] = Math.min(p.room, before + n);
  write(db, l);
  return l.stock[post] - before;
}

/** The mills' stock events (town/mills.ts millStocks): the bake turns the loft's flour into bread at its bakery. */
export function onMillEvents(db: DB, events: readonly StockEvent[]): void {
  for (const e of events) {
    if ((e.what !== "bake" && e.what !== "short") || e.n <= 0) continue;
    const m = MILLS.find((q) => q.id === e.mill);
    if (m && POST_BY_ID[m.bakery]) supply(db, m.bakery, e.n * LOAVES_PER_SACK);
  }
}

/** A box of fish set in at the back of a fish bank (D1 docks routes vm-1, vm-2): fish on the Vismarkt's stalls. */
export function fishBoxIn(db: DB): number {
  return supply(db, "vismarkt", FISH_PER_BOX);
}

/** The post a seller sells from, by who he is (the shop, the stall, the round), or null (not a food post of the trade). */
export function postOfSeller(db: DB, npc: string): Post | null {
  if (npc === "fientje") return POST_BY_ID.vismarkt;
  const r = resident(db, npc);
  if (!r) return null;
  if (r.work.shop && POST_BY_ID[r.work.shop]) return POST_BY_ID[r.work.shop];
  if (r.work.stall !== undefined) {
    const st = town(db).town.stalls[r.work.stall];
    if (st?.goods === "fish") return POST_BY_ID.vismarkt;
    if (st?.goods === "bread") return POST_BY_ID.bakery_steen;
  }
  if (r.trade === "fish_merchant") return POST_BY_ID.vismarkt;
  if (r.trade === "baker_boy") return POST_BY_ID.bakery_steen;
  return null;
}

/** trade.ts sellerPrice: a food ware's price by its post's shelf now. */
export function tradePrice(db: DB, seller: string, kind: string, price: number): number {
  const good = WARE_GOOD[kind];
  if (!good) return price;
  const p = postOfSeller(db, seller);
  if (!p || p.good !== good) return price;
  const l = tradeLedger(db);
  const c = clock(db);
  return stockPrice(price, p, l.stock[p.id] ?? p.start, c.hour + c.minute / 60);
}

/** trade.ts buy: a player bought a food ware: one off the shelf (below the floor too). A line when it was the last. */
export function tradeBought(db: DB, seller: string, kind: string): string | null {
  const good = WARE_GOOD[kind];
  const p = good ? postOfSeller(db, seller) : null;
  if (!p || p.good !== good) return null;
  const l = tradeLedger(db);
  const s = l.stock[p.id] ?? p.start;
  l.stock[p.id] = Math.max(0, s - 1);
  soldOf(l, p.id, Math.floor(l.at / 1440) + 1).players++;
  write(db, l);
  return s <= p.floor ? LAST_LINE[p.good] : null;
}

/** For the map, the talk and the checks: each post's shelf in whole units. */
export function tradeView(db: DB): Array<{ id: string; label: string; good: string; stock: number; room: number; order: number; floor: number; short: boolean; soldTown: number; soldPlayers: number }> {
  const l = tradeLedger(db);
  const day = Math.floor(l.at / 1440) + 1;
  return POSTS.map((p) => {
    const s = l.stock[p.id] ?? p.start;
    const so = l.sold[p.id]?.day === day ? l.sold[p.id] : { town: 0, players: 0 };
    return { id: p.id, label: p.label, good: p.good, stock: Math.floor(s), room: p.room, order: p.order, floor: p.floor, short: s < p.order, soldTown: Math.round(so.town), soldPlayers: so.players };
  });
}
