import type { DB } from "./db.ts";
import { GameError, log, player } from "./game.ts";
import { remember } from "./npcs.ts";
import { activityAt } from "./town/schedule.ts";
import { resident, town } from "./town/store.ts";
import { closedByEvent, priceFactor } from "./director/state.ts";

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
  /** Verb for using it; none = cannot be used (a job parcel). */
  use?: "eat" | "drink";
  note?: string;
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
};

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
  baker: STALL_WARES.bread,
  grocer: STALL_WARES.veg,
  chandler: [
    { kind: "biscuit", price_c: 4 },
    { kind: "lantern", price_c: 40 },
  ],
  publican: [
    { kind: "beer", price_c: 5 },
    { kind: "jenever", price_c: 10 },
  ],
  fish_merchant: STALL_WARES.fish,
};

/** What a person sells: the named sellers, or a townsperson by stall or shop. */
export function waresOf(db: DB, id: string): Array<{ kind: string; price_c: number }> {
  // M4: an event may move a price (0.5x to 3x) until it ends; rounded to the centime, never below 1
  return baseWaresOf(db, id).map((w) => {
    const f = priceFactor(db, w.kind);
    return f === 1 ? w : { kind: w.kind, price_c: Math.max(1, Math.round(w.price_c * f)) };
  });
}

function baseWaresOf(db: DB, id: string): Array<{ kind: string; price_c: number }> {
  if (WARES[id]) return WARES[id];
  const r = resident(db, id);
  if (!r) return [];
  if (r.work.stall !== undefined) return STALL_WARES[town(db).town.stalls[r.work.stall]?.goods ?? ""] ?? [];
  if (r.work.shop) {
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
  const rows = db.prepare("SELECT id, kind, job_id FROM item ORDER BY id").all() as Array<{ id: number; kind: string; job_id: number | null }>;
  return rows.map((r) => ({
    ...r,
    name: ITEMS[r.kind]?.name ?? r.kind,
    use: ITEMS[r.kind]?.use ?? null,
    note: ITEMS[r.kind]?.note ?? null,
  }));
}

export function needs(db: DB): Needs {
  return db.prepare("SELECT food, warmth, health, sleep FROM player WHERE id = 1").get() as Needs;
}

function freeSlots(db: DB): number {
  return POCKET_SLOTS - (db.prepare("SELECT COUNT(*) AS n FROM item").get() as { n: number }).n;
}

export function buy(db: DB, npc: string, kind: string): { line: string; bought: string; price_c: number } {
  const ware = waresOf(db, npc).find((w) => w.kind === kind);
  if (!ware) throw new GameError("they do not sell that", 404);
  if (!atWork(db, npc)) throw new GameError("the shop is shut; come back in working hours", 409);
  const p = player(db);
  if (p.money_c < ware.price_c) throw new GameError(`not enough money: ${ware.price_c} c needed`, 409);
  const drinkNow = ITEMS[kind].use === "drink";
  if (!drinkNow && freeSlots(db) < 1) throw new GameError("your pockets are full", 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(ware.price_c);
    // a drink is taken on the spot; food goes into your pocket
    if (drinkNow) applyNeeds(db, ITEMS[kind]);
    else db.prepare("INSERT INTO item (kind, job_id) VALUES (?, NULL)").run(kind);
    log(db, "bought", kind, `Jef bought ${ITEMS[kind].name} for ${ware.price_c} centimes.`);
  })();
  remember(db, npc, `Jef bought ${ITEMS[kind].name} from me for ${ware.price_c} centimes.`, drinkNow ? 3 : 2);
  const r = resident(db, npc);
  const line = HAND_OVER[npc] ?? (r ? `${r.first} takes your coins and hands it over${r.stats.warmth >= 7 ? " with a nod" : r.stats.greed >= 7 ? ", counting twice" : ""}.` : "Coins change hands.");
  return { line, bought: kind, price_c: ware.price_c };
}

function applyNeeds(db: DB, d: ItemDef): void {
  db.prepare(
    `UPDATE player SET
       food = MAX(0, MIN(10, food + ?)),
       warmth = MAX(0, MIN(10, warmth + ?)),
       health = MAX(0, MIN(10, health + ?))
     WHERE id = 1`,
  ).run(d.food ?? 0, d.warmth ?? 0, d.health ?? 0);
}

/** Eat or drink something from your pockets. */
export function useItem(db: DB, id: number): { text: string } {
  const row = db.prepare("SELECT id, kind FROM item WHERE id = ?").get(id) as { id: number; kind: string } | undefined;
  if (!row) throw new GameError("not in your pockets", 404);
  const def = ITEMS[row.kind];
  if (!def?.use) throw new GameError("that is not yours to use", 409);
  db.transaction(() => {
    db.prepare("DELETE FROM item WHERE id = ?").run(id);
    applyNeeds(db, def);
    log(db, def.use === "eat" ? "ate" : "drank", row.kind, `Jef ${def.use === "eat" ? "ate" : "drank"} ${def.name}.`);
  })();
  const text: Record<string, string> = {
    herring: "Salt and oil. It sits in your belly like a stone, a good stone.",
    eel: "Smoked eel, rich and warm. You feel it down to your boots.",
    biscuit: "Hard as a plank. You soften it in your mouth and it fills you, a little.",
    jenever: "It burns going down, then warms you from the inside.",
    bread: "Dark rye, still a little warm. It fills you properly.",
    apple: "Sour and crisp. Not much, but something.",
    beer: "Thin brown beer. It warms you a little and fills a corner of your belly.",
  };
  return { text: text[row.kind] ?? "Done." };
}

/** Deliver jobs: the employer hands over the parcel; it goes in your pocket. */
export function handOverParcel(db: DB, jobId: number): void {
  const has = db.prepare("SELECT 1 FROM item WHERE job_id = ?").get(jobId);
  if (has) return;
  if (freeSlots(db) < 1) throw new GameError("your pockets are full; eat something or leave it", 409);
  db.prepare("INSERT INTO item (kind, job_id) VALUES ('parcel', ?)").run(jobId);
}

/** A job is over: its parcel leaves your pocket (delivered, sold, or given back). */
export function clearJobItems(db: DB, jobId: number): void {
  db.prepare("DELETE FROM item WHERE job_id = ?").run(jobId);
}
