import type { DB } from "./db.ts";
import { GameError, log, player } from "./game.ts";
import { remember } from "./npcs.ts";
import { pid } from "./player/current.ts";
import { activityAt } from "./town/schedule.ts";
import { resident, town } from "./town/store.ts";
import { closedByEvent, state, tempestPhase } from "./director/state.ts";
import { newsFactors } from "./ideas/prices.ts";
import { FURNITURE, FURNITURE_KINDS } from "../../shared/homes.ts";
import { VELO_PRICE } from "./town/transport.ts";
import { CART_PRICE } from "../../shared/handcart.ts";
import { LIVELY_ITEMS, LIVELY_USE_TEXT, LIVELY_WARES } from "./town/livelyWares.ts";
// M7 shops: the new shops' wares, and more for the old ones (shops/wares.ts)
import { SHOP_ITEMS, SHOP_SERVICE_LINE, SHOP_USE_TEXT, SHOP_WARES, SHOP_WARES_MORE } from "./shops/wares.ts";
import { shopTrade } from "../../shared/shops.ts";

// Buying, pockets and eating (M3b). Prices and effects are engine numbers
// (docs/03: shop prices are engine code). Pockets hold small things only;
// crates and sacks are carried in the hands, in the 3D game.

export const POCKET_SLOTS = 6;

export interface ItemDef {
  name: string;
  /** Changes to needs when used (0-10 scale). */
  food?: number;
  warmth?: number;
  health?: number;
  /** Verb for using it; none = cannot be used (a job parcel). M7 shops: wear (put it on), smoke. */
  use?: "eat" | "drink" | "read" | "wear" | "smoke";
  note?: string;
  /** M6 interiors: eaten at the counter like a drink, never pocketed (a bowl of soup). */
  atCounter?: boolean;
  /** M6 homes: a big piece of furniture, carried home in both arms (no pocket slot; homes/homes.ts). */
  carry?: "arms";
}

export const ITEMS: Record<string, ItemDef> = {
  herring: { name: "a salt herring", food: 2, use: "eat" },
  eel: { name: "a smoked eel", food: 4, use: "eat" },
  biscuit: { name: "ship's biscuit", food: 2, use: "eat" },
  jenever: { name: "a nip of jenever", warmth: 2, health: -1, use: "drink", note: "Warms you now. The pastoor will smell it." },
  // M3e: the town's shops and stalls
  bread: { name: "a loaf of rye bread", food: 3, use: "eat" },
  apple: { name: "an apple", food: 1, use: "eat" },
  beer: { name: "a pot of brown beer", food: 1, warmth: 1, use: "drink" },
  parcel: { name: "a parcel", note: "Tied with tarred string. Don't open it." },
  // M3h: a light to carry (L holds it up or puts it away; the client shows it)
  lantern: { name: "a hand lantern", note: "Tin and horn, a tallow candle inside. L to hold it up." },
  // M6 interiors: hot food at the tavern counter
  soup: { name: "a bowl of pea soup", food: 3, warmth: 2, use: "eat", atCounter: true },
  // M6 (paper/): the morning paper, letters, a pawn ticket, and something of Jef's own to pawn
  newspaper: { name: "the morning Handelsblad", use: "read", note: "Four pages of small print, still smelling of ink." },
  letter: { name: "a letter", use: "read", note: "Folded and sealed with a blob of wax." },
  letters: { name: "a bundle of letters", note: "Tied with string. Each goes to its own door." },
  pawn_ticket: { name: "a pawn ticket", use: "read", note: "Printed card from the Berg van Barmhartigheid. Keep it safe." },
  // M9 theft: what comes out of a picked pocket (town/pickpocket.ts)
  pocket_watch: { name: "a silver pocket watch", note: "Not yours. Somebody's initials on the lid." },
  handkerchief: { name: "a linen handkerchief", note: "Good linen, a stranger's initials stitched in the corner." },
  medal: { name: "your mother's silver medal", note: "Our Lady, on a worn blue ribbon. She pressed it into your hand the day you left." },
  // M6 transport: the velocipede maker's machines (town/bikeshop.ts); they stand at his door, never in a pocket
  velocipede_new: { name: "a new velocipede", note: "Iron backbone, oak wheels with iron tyres, a leather saddle. Yours." },
  velocipede_used: { name: "a second-hand velocipede", note: "Scratched paint, a patched saddle, and it goes as well as any. Yours." },
  velocipede_hire: { name: "a velocipede for the day", note: "Back at his door before the day is out, or his boy fetches it." },
  // M6 lively: the street sellers' wares, the stalls against the cathedral (town/livelyWares.ts)
  ...LIVELY_ITEMS,
  // M7 shops: the butcher, the colonial goods, the apothecary, the barber, the hatter ... (shops/wares.ts)
  ...SHOP_ITEMS,
};

/**
 * M6: things bought that are not pocket items (a velocipede stands in the street). The module
 * does what buying one means, in the same transaction as the money (town/bikeshop.ts).
 */
export const ITEM_BUY: Record<string, (db: DB) => void> = {};

/**
 * M6: items made by other modules carry a ref in the pocket row (the paper's day, a letter,
 * a pawn). A module sets the ref for what can be bought, or throws a GameError to refuse.
 */
export const ITEM_REF: Record<string, (db: DB) => number | null> = {};

/** Who sells what, for how much (centimes). */
export const WARES: Record<string, Array<{ kind: string; price_c: number }>> = {
  fientje: [
    { kind: "herring", price_c: 5 },
    { kind: "eel", price_c: 12 },
  ],
  peeters: [
    { kind: "biscuit", price_c: 4 },
    { kind: "lantern", price_c: 40 },
  ],
  tuur: [{ kind: "jenever", price_c: 10 }],
};

/** What the town's sellers sell (M3e), by stall goods or by trade. Engine prices. */
const STALL_WARES: Record<string, Array<{ kind: string; price_c: number }>> = {
  fish: [
    { kind: "herring", price_c: 5 },
    { kind: "eel", price_c: 12 },
  ],
  bread: [{ kind: "bread", price_c: 6 }],
  veg: [{ kind: "apple", price_c: 2 }],
};
const TRADE_WARES: Record<string, Array<{ kind: string; price_c: number }>> = {
  // M7 shops: more on the old shops' lists (a new array: the stalls keep theirs)
  baker: [...STALL_WARES.bread, ...SHOP_WARES_MORE.baker],
  grocer: [...STALL_WARES.veg, ...SHOP_WARES_MORE.grocer],
  chandler: [
    { kind: "biscuit", price_c: 4 },
    { kind: "lantern", price_c: 40 },
    ...SHOP_WARES_MORE.chandler,
  ],
  publican: [
    { kind: "beer", price_c: 5 },
    { kind: "jenever", price_c: 10 },
    { kind: "soup", price_c: 8 }, // M6: eaten at the counter
  ],
  fish_merchant: STALL_WARES.fish,
  // M6: the morning paper, from the newsboys at their corners (Het Handelsblad, 5 centimes)
  newsboy: [{ kind: "newspaper", price_c: 5 }],
  // M6 homes: the second-hand dealer's furniture (prices in shared/homes.ts FURNITURE; homes/homes.ts adds the items)
  dealer: FURNITURE_KINDS.map((kind) => ({ kind, price_c: FURNITURE[kind].price_c })),
  // M6 transport: the velocipede maker sells new and second-hand machines and hires one out by the day
  velo_maker: [
    { kind: "velocipede_used", price_c: VELO_PRICE.used_c },
    { kind: "velocipede_new", price_c: VELO_PRICE.new_c },
    { kind: "velocipede_hire", price_c: VELO_PRICE.hire_c },
  ],
  // M6 handcart: the wheelwright sells new and second-hand handcarts and hires one out by the day (town/handcart.ts)
  wheelwright: [
    { kind: "handcart_used", price_c: CART_PRICE.used_c },
    { kind: "handcart_new", price_c: CART_PRICE.new_c },
    { kind: "handcart_hire", price_c: CART_PRICE.hire_c },
  ],
  // M6 lively: the dog carts, the street sellers, the stalls against the cathedral (town/livelyWares.ts)
  ...LIVELY_WARES,
  // M7 shops: the tobacconist, the draper, the cobbler (none sold before) and the new trades (shops/wares.ts)
  ...SHOP_WARES,
};

/** The market's factor per item (an event's price and the news from abroad), each read once. */
export type Market = (kind: string) => number;
export function marketOf(db: DB): Market {
  const events = state<Record<string, { factor: number }>>(db, "m4_prices", {});
  const news = newsFactors(db);
  return (kind) => {
    const f = events[kind]?.factor;
    return Math.max(0.5, Math.min(3, (f && f > 0 ? f : 1) * news(kind)));
  };
}

/**
 * What a person sells: the named sellers, or a townsperson by stall or shop. `market`: the
 * factors read once (marketOf) when a loop asks many sellers; else they are read for this call.
 */
export function waresOf(db: DB, id: string, market?: Market): Array<{ kind: string; price_c: number }> {
  const base = baseWaresOf(db, id);
  if (!base.length) return base;
  const m = market ?? marketOf(db);
  // M4: an event may move a price (0.5x to 3x) until it ends; rounded to the centime, never below 1
  const out = base.map((w) => {
    // M6 ideas: news from abroad moves a price 10 to 30 in the hundred for 1 to 3 days (ideas/abroad.ts)
    const f = m(w.kind);
    return f === 1 ? w : { kind: w.kind, price_c: Math.max(1, Math.round(w.price_c * f)) };
  });
  // M7 mills: a seller's own reason (a bakery short of flour: town/mills.ts), a few centimes on, clamped there
  if (!sellerPrice.length) return out;
  return out.map((w) => {
    let p = w.price_c;
    for (const f of sellerPrice) p = f(db, id, w.kind, p);
    return p === w.price_c ? w : { kind: w.kind, price_c: Math.max(1, Math.round(p)) };
  });
}

/** M7 mills: per seller and ware, a price moved by the engine's own stock (town/mills.ts: the bakeries' flour). */
export const sellerPrice: Array<(db: DB, seller: string, kind: string, price_c: number) => number> = [];

function baseWaresOf(db: DB, id: string): Array<{ kind: string; price_c: number }> {
  if (WARES[id]) return WARES[id];
  const r = resident(db, id);
  if (!r) return [];
  if (r.work.stall !== undefined) return STALL_WARES[town(db).town.stalls[r.work.stall]?.goods ?? ""] ?? [];
  if (r.work.shop) {
    // M7 shops: by the shop's own trade (a draper's shop kept by a widow sells cloth, not a "shopwife"'s nothing)
    const own = shopTrade(r.work.shop);
    if (own && TRADE_WARES[own]) return TRADE_WARES[own];
    const keeper = town(db).town.shops.find((s) => s.id === r.work.shop);
    const head = keeper ? resident(db, keeper.keeper) : r;
    return TRADE_WARES[head?.trade ?? r.trade] ?? [];
  }
  return TRADE_WARES[r.trade] ?? [];
}

/** Is a townsperson minding their stall, shop or bar right now (engine clock)? */
export function atWork(db: DB, id: string): boolean {
  const r = resident(db, id);
  if (!r) return true;
  // M4: an event may shut a shop, a stall's place or a tavern until it ends
  if (closedByEvent(db, r.work.place) || (r.work.shop && closedByEvent(db, r.work.shop))) return false;
  // the great storm: the taverns open up whatever the hour, the town comes in out of it (shared/tempest.ts)
  if (r.work.kind === "tavern" && r.work.place.startsWith("tavern:") && r.age >= 14 && tempestPhase(db)) return true;
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return activityAt(r.sched, p.day, p.hour + p.minute / 60).act === "work";
}

/** What the seller says as the coins change hands. */
const HAND_OVER: Record<string, string> = {
  fientje: "Fientje wraps it in yesterday's Handelsblad and takes your coins without counting.",
  peeters: "The widow counts your centimes twice and writes it in her book.",
  tuur: "Tuur pours from a flat bottle and looks up and down the kaai while you drink.",
};

export interface PocketItem {
  id: number;
  kind: string;
  name: string;
  job_id: number | null;
  /** M6: the paper's day, the letter, the pawn (see ITEM_REF). */
  ref: number | null;
  use: string | null;
  note: string | null;
}

export interface Needs {
  food: number;
  warmth: number;
  health: number;
  sleep: number;
}

export function pockets(db: DB): PocketItem[] {
  const rows = db.prepare("SELECT id, kind, job_id, ref FROM item WHERE player_id = ? ORDER BY id").all(pid()) as Array<{ id: number; kind: string; job_id: number | null; ref: number | null }>;
  return rows.map((r) => ({
    ...r,
    name: ITEMS[r.kind]?.name ?? r.kind,
    use: ITEMS[r.kind]?.use ?? null,
    note: ITEMS[r.kind]?.note ?? null,
  }));
}

export function needs(db: DB): Needs {
  return db.prepare("SELECT food, warmth, health, sleep FROM player WHERE id = ?").get(pid()) as Needs;
}

function freeSlots(db: DB): number {
  return POCKET_SLOTS - (db.prepare("SELECT COUNT(*) AS n FROM item WHERE player_id = ?").get(pid()) as { n: number }).n;
}

/**
 * M6 haggling (town/haggle.ts): a price talked down never goes below this share of the list price
 * (the seller's cost) and never above the list price. The engine's floor, whatever was said.
 */
export const HAGGLE_FLOOR = 0.6;
export function priceFloor(list: number): number {
  return Math.max(1, Math.ceil(list * HAGGLE_FLOOR - 1e-9));
}
/** M6: set by town/haggle.ts. A seller who will not sell to Jef for now; a price agreed in a haggle; a deal used. */
export const haggleHooks = {
  refuse: (_db: DB, _npc: string): string | null => null,
  price: (_db: DB, _npc: string, _kind: string, list: number): number => list,
  bought: (_db: DB, _npc: string, _kind: string): void => {},
};

export function buy(db: DB, npc: string, kind: string): { line: string; bought: string; price_c: number } {
  const listed = waresOf(db, npc).find((w) => w.kind === kind);
  if (!listed) throw new GameError("they do not sell that", 404);
  if (!atWork(db, npc)) throw new GameError("the shop is shut; come back in working hours", 409);
  const refusal = haggleHooks.refuse(db, npc);
  if (refusal) throw new GameError(refusal, 409);
  // a haggled price, kept between the floor and the list price by the engine
  const price_c = Math.min(listed.price_c, Math.max(priceFloor(listed.price_c), Math.round(haggleHooks.price(db, npc, kind, listed.price_c))));
  const ware = { kind, price_c };
  const p = player(db);
  if (p.money_c < ware.price_c) throw new GameError(`not enough money: ${ware.price_c} c needed`, 409);
  const drinkNow = ITEMS[kind].use === "drink" || !!ITEMS[kind].atCounter;
  const ref = ITEM_REF[kind]?.(db) ?? null;
  const inArms = ITEMS[kind].carry === "arms";
  const special = ITEM_BUY[kind];
  if (!drinkNow && !inArms && !special && freeSlots(db) < 1) throw new GameError("your pockets are full", 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(ware.price_c, pid());
    // a drink is taken on the spot; food goes into your pocket
    if (special) special(db);
    else if (drinkNow) applyNeeds(db, ITEMS[kind]);
    else if (!inArms) db.prepare("INSERT INTO item (kind, job_id, ref, player_id) VALUES (?, NULL, ?, ?)").run(kind, ref, pid());
    log(db, "bought", kind, `Jef bought ${ITEMS[kind].name} for ${ware.price_c} centimes.`);
    // food eaten at the counter (the tavern's pea soup) is a meal too (QA 2026-09-24: the night sheet said "You ate nothing")
    if (drinkNow && !special && ITEMS[kind].use === "eat") log(db, "ate", kind, `Jef ate ${ITEMS[kind].name} at the counter.`);
  })();
  remember(db, npc, `Jef bought ${ITEMS[kind].name} from me for ${ware.price_c} centimes.`, drinkNow ? 3 : 2);
  if (price_c < listed.price_c) haggleHooks.bought(db, npc, kind);
  const r = resident(db, npc);
  const line = HAND_OVER[npc] ?? SHOP_SERVICE_LINE[kind] ?? (r ? `${r.first} takes your coins and hands it over${r.stats.warmth >= 7 ? " with a nod" : r.stats.greed >= 7 ? ", counting twice" : ""}.` : "Coins change hands.");
  return { line, bought: kind, price_c: ware.price_c };
}

function applyNeeds(db: DB, d: ItemDef): void {
  db.prepare(
    `UPDATE player SET
       food = MAX(0, MIN(10, food + ?)),
       warmth = MAX(0, MIN(10, warmth + ?)),
       health = MAX(0, MIN(10, health + ?))
     WHERE id = ?`,
  ).run(d.food ?? 0, d.warmth ?? 0, d.health ?? 0, pid());
}

/** Eat or drink something from your pockets. */
export function useItem(db: DB, id: number): { text: string } {
  const row = db.prepare("SELECT id, kind FROM item WHERE id = ? AND player_id = ?").get(id, pid()) as { id: number; kind: string } | undefined;
  if (!row) throw new GameError("not in your pockets", 404);
  const def = ITEMS[row.kind];
  if (!def?.use) throw new GameError("that is not yours to use", 409);
  if (def.use === "read") throw new GameError("open your pockets to read it", 409);
  db.transaction(() => {
    db.prepare("DELETE FROM item WHERE id = ? AND player_id = ?").run(id, pid());
    applyNeeds(db, def);
    // M7 shops: worn (put on) and smoked too
    const verb = def.use === "eat" ? "ate" : def.use === "wear" ? "put on" : def.use === "smoke" ? "smoked" : "drank";
    log(db, def.use === "eat" ? "ate" : def.use === "wear" ? "wore" : def.use === "smoke" ? "smoked" : "drank", row.kind, `Jef ${verb} ${def.name}.`);
  })();
  const text: Record<string, string> = {
    herring: "Salt and oil. It sits in your belly like a stone, a good stone.",
    eel: "Smoked eel, rich and warm. You feel it down to your boots.",
    biscuit: "Hard as a plank. You soften it in your mouth and it fills you, a little.",
    jenever: "It burns going down, then warms you from the inside.",
    bread: "Dark rye, still a little warm. It fills you properly.",
    apple: "Sour and crisp. Not much, but something.",
    beer: "Thin brown beer. It warms you a little and fills a corner of your belly.",
    ...LIVELY_USE_TEXT,
    ...SHOP_USE_TEXT,
  };
  return { text: text[row.kind] ?? "Done." };
}

/** Deliver jobs: the employer hands over the parcel; it goes in your pocket. */
export function handOverParcel(db: DB, jobId: number): void {
  const has = db.prepare("SELECT 1 FROM item WHERE job_id = ? AND player_id = ?").get(jobId, pid());
  if (has) return;
  if (freeSlots(db) < 1) throw new GameError("your pockets are full; eat something or leave it", 409);
  db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES ('parcel', ?, ?)").run(jobId, pid());
}

/** A job is over: its parcel leaves your pocket (delivered, sold, or given back). */
export function clearJobItems(db: DB, jobId: number): void {
  db.prepare("DELETE FROM item WHERE job_id = ?").run(jobId);
}
