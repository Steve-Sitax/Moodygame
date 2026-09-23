import type { DB } from "../db.ts";

// Small M4 state in world_state, in a file trade.ts can import without pulling
// the director in (an import cycle through talk.ts would break the schemas).

export function state<T>(db: DB, key: string, fallback: T): T {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as T) : fallback;
}

export function setState(db: DB, key: string, v: unknown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

/** trade.ts: the price factor an event put on an item (1 when none). */
export function priceFactor(db: DB, item: string): number {
  const f = state<Record<string, { factor: number; event: number }>>(db, "m4_prices", {})[item]?.factor;
  return f && f > 0 ? f : 1;
}

/** trade.ts and the client: a shop, a stall's place or a tavern shut by an event. */
export function closedByEvent(db: DB, placeId: string): boolean {
  return placeId in state<Record<string, number>>(db, "m4_closed", {});
}

export function closedPlaces(db: DB): string[] {
  return Object.keys(state<Record<string, number>>(db, "m4_closed", {}));
}
