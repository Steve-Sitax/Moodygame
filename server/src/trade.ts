import type { DB } from "./db.ts";
import { GameError, log, player } from "./game.ts";
import { remember } from "./npcs.ts";

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
  parcel: { name: "a parcel", note: "Tied with tarred string. Don't open it." },
};

/** Who sells what, for how much (centimes). */
export const WARES: Record<string, Array<{ kind: string; price_c: number }>> = {
  fientje: [
    { kind: "herring", price_c: 5 },
    { kind: "eel", price_c: 12 },
  ],
  peeters: [{ kind: "biscuit", price_c: 4 }],
  tuur: [{ kind: "jenever", price_c: 10 }],
};

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
  const ware = WARES[npc]?.find((w) => w.kind === kind);
  if (!ware) throw new GameError("they do not sell that", 404);
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
  return { line: HAND_OVER[npc] ?? "Coins change hands.", bought: kind, price_c: ware.price_c };
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
