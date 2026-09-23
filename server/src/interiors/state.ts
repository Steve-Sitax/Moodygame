import type { DB } from "../db.ts";
import { CALLS_PER_DAY, CALLS_RESERVE } from "../config.ts";
import { clock } from "../day.ts";
import { activityAt } from "../town/schedule.ts";
import { atWork } from "../trade.ts";
import { town } from "../town/store.ts";
import type { Resident } from "../town/population.ts";

// Small shared helpers of the interiors (M6): the game minute, a key in world_state,
// the call shares, and who is inside a tavern by the schedule. Engine only.

/** Minutes since the start of the week (day 1, 0:00): one clock for every cooldown. */
export function minuteNow(db: DB): number {
  const c = clock(db);
  return c.day * 1440 + c.hour * 60 + c.minute;
}

export function hourNow(db: DB): number {
  const c = clock(db);
  return c.hour + c.minute / 60;
}

export function getState<T>(db: DB, key: string, def: T): T {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return def;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return def;
  }
}

export function setState(db: DB, key: string, v: unknown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(v));
}

/** Calls left for a hook family today: its own share, and never the reserve. */
export function canCallShare(db: DB, hooks: string[], share: number): boolean {
  const day = clock(db).day;
  const total = (db.prepare("SELECT COUNT(*) AS n FROM ai_call WHERE day = ?").get(day) as { n: number }).n;
  const mine = (db.prepare(`SELECT COUNT(*) AS n FROM ai_call WHERE day = ? AND hook IN (${hooks.map(() => "?").join(", ")})`).get(day, ...hooks) as { n: number }).n;
  return mine < share && total < CALLS_PER_DAY - CALLS_RESERVE;
}

/** "ankere" or "tavern:ankere" -> "tavern:ankere", if the town has that tavern. */
export function tavernPlace(db: DB, id: string): string | null {
  const key = id.startsWith("tavern:") ? id : `tavern:${id}`;
  return town(db).town.places[key]?.door ? key : null;
}

export function tavernLabel(db: DB, place: string): string {
  return town(db).town.places[place]?.label ?? "the tavern";
}

/** The publican of a tavern (the head of the house who works there). */
export function keeperOf(db: DB, place: string): Resident | undefined {
  return town(db).town.residents.find((r) => r.trade === "publican" && r.work.place === place);
}

/** Is the keeper behind his counter now? (His working hours: the tavern is open.) */
export function keeperAtWork(db: DB, place: string): boolean {
  const k = keeperOf(db, place);
  // trade.atWork: his hours, and not shut by an event (M4)
  return !!k && atWork(db, k.id);
}

/**
 * Who drinks in this tavern now: everyone whose schedule says "tavern" here, by the
 * engine clock (the same schedule the client walks). Children never.
 */
export function patronsIn(db: DB, place: string): Resident[] {
  const c = clock(db);
  const h = hourNow(db);
  return town(db).town.residents.filter((r) => {
    if (r.age < 14) return false;
    const now = activityAt(r.sched, c.day, h);
    return now.act === "tavern" && now.place === place;
  });
}

/** Test seam: a shorter model timeout than the 20 s of config.ts (only tests set it). */
let testTimeoutMs: number | undefined;
export function setTestTimeout(ms: number | undefined): void {
  testTimeoutMs = ms;
}
export function callTimeout(): number | undefined {
  return testTimeoutMs;
}
