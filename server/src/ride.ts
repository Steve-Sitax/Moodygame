import type { DB } from "./db.ts";
import { GameError, log, player } from "./game.ts";

// The horse omnibus along the quays (M3g, client/src/world/omnibus.ts). The engine owns the
// fare and what riding does to your needs: the client only says "I got on at this stop" and
// "I got off". A fare buys one ride of at most RIDE_MAX_HOURS game hours; after that the
// server no longer counts you as riding (a reload in the middle of a ride keeps nobody warm
// for ever). Needs while riding: see applyHour in day.ts (the chill comes at half the rate:
// inside, out of the wind). Food is not touched: a ride costs no extra food, and the time
// it saves is time you are not hungry in.

/** The fare, in centimes (a herring, a beer). */
export const RIDE_FARE_C = 5;
/** A ticket is good for this many game hours: once round the whole line (about 20 at the game's clock). */
export const RIDE_MAX_HOURS = 20;
/** The stops of the line, west to east (client/src/world/omnibus.ts STOPS). */
export const RIDE_STOPS = ["werf", "steenplein", "vismarkt", "rijnkaai", "rijnkaai_back", "bassin"] as const;
export type RideStop = (typeof RIDE_STOPS)[number];

const STOP_NAMES: Record<RideStop, string> = {
  werf: "the Werf",
  steenplein: "the Steenplein",
  vismarkt: "the Vismarkt",
  rijnkaai: "the Rijnkaai",
  rijnkaai_back: "the Rijnkaai",
  bassin: "the Petit Bassin",
};

interface RideRow {
  /** Game minutes since day 1, 0:00, when you got on. */
  since: number;
  from: RideStop;
}

export interface RideInfo {
  from: RideStop;
  /** Game minutes on board so far. */
  minutes: number;
  /** Game minutes left on the ticket. */
  left: number;
}

function gameMinutes(db: DB): number {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return ((p.day - 1) * 24 + p.hour) * 60 + p.minute;
}

function read(db: DB): RideRow | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'ride'").get() as { value_json: string } | undefined;
  if (!row) return null;
  try {
    const r = JSON.parse(row.value_json) as RideRow;
    return typeof r.since === "number" && (RIDE_STOPS as readonly string[]).includes(r.from) ? r : null;
  } catch {
    return null;
  }
}

function clear(db: DB): void {
  db.prepare("DELETE FROM world_state WHERE key = 'ride'").run();
}

/** The ride you are on now, or null (none, or the ticket ran out). */
export function ride(db: DB): RideInfo | null {
  const r = read(db);
  if (!r) return null;
  const minutes = gameMinutes(db) - r.since;
  if (minutes < 0 || minutes > RIDE_MAX_HOURS * 60) return null;
  return { from: r.from, minutes, left: RIDE_MAX_HOURS * 60 - minutes };
}

/** Is Jef on the omnibus now (for the hourly needs)? */
export function riding(db: DB): boolean {
  return ride(db) !== null;
}

export function isStop(s: unknown): s is RideStop {
  return typeof s === "string" && (RIDE_STOPS as readonly string[]).includes(s);
}

/** Get on at a stop: the conductor takes the fare. */
export function board(db: DB, stop: RideStop): { fare_c: number; text: string } {
  if (riding(db)) throw new GameError("you are on the omnibus already", 409);
  const p = player(db);
  if (p.money_c < RIDE_FARE_C) throw new GameError(`not enough money: the fare is ${RIDE_FARE_C} c`, 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(RIDE_FARE_C);
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('ride', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
      JSON.stringify({ since: gameMinutes(db), from: stop } satisfies RideRow),
    );
    log(db, "rode_omnibus", stop, `Jef took the omnibus at ${STOP_NAMES[stop]} for ${RIDE_FARE_C} centimes.`);
  })();
  return { fare_c: RIDE_FARE_C, text: `You pay the conductor ${RIDE_FARE_C} c and step up onto the back platform.` };
}

/** Get off (at a stop, or put off). Always allowed; nothing to pay back. */
export function alight(db: DB): { text: string } {
  const was = read(db) !== null;
  clear(db);
  return { text: was ? "You step down onto the cobbles." : "" };
}

/** The night ends every ride (day.ts sleep). */
export function endRide(db: DB): void {
  clear(db);
}
