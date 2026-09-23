import type { DB } from "./db.ts";
import { GameError, log, player } from "./game.ts";

// The horse omnibuses (M3g, client/src/world/omnibus.ts): two lines that meet at the Vismarkt.
// The engine owns the fare and what riding does to your needs: the client only says "I got on
// this line at this stop" and "I got off". A fare buys a ticket good for RIDE_MAX_HOURS game
// hours from the moment you first got on, with one free change: get off, and get on a bus of the
// other line while the ticket runs, and you pay nothing more. Getting on the same line again,
// or a second change, costs a new fare. While you ride, the chill comes at half the rate
// (applyHour in day.ts: inside, out of the wind). Food is not touched: a ride costs no extra
// food, and the time it saves is time you are not hungry in.

/** The fare, in centimes (a herring, a beer). */
export const RIDE_FARE_C = 5;
/** A ticket is good for this many game hours: once round the longest line (about 20 at the game's clock). */
export const RIDE_MAX_HOURS = 20;
/** Free changes on one ticket. */
export const RIDE_CHANGES = 1;

/** The lines and their stops (client/src/world/omnibus.ts LINES and STOPS). */
export const RIDE_LINES = {
  kaaien: ["werf", "steenplein", "vismarkt", "rijnkaai", "rijnkaai_back", "bassin"],
  markt: ["vismarkt", "vleeshuis", "grote_markt", "cathedral", "meir", "brouwersvliet"],
} as const;
export type RideLine = keyof typeof RIDE_LINES;
export type RideStop = (typeof RIDE_LINES)[RideLine][number];
export const RIDE_STOPS = [...new Set(Object.values(RIDE_LINES).flat())] as RideStop[];

const STOP_NAMES: Record<RideStop, string> = {
  werf: "the Werf",
  steenplein: "the Steenplein",
  vismarkt: "the Vismarkt",
  rijnkaai: "the Rijnkaai",
  rijnkaai_back: "the Rijnkaai",
  bassin: "the Petit Bassin",
  vleeshuis: "the Vleeshuis",
  grote_markt: "the Grote Markt",
  cathedral: "the Cathedral",
  meir: "the road to the Meir",
  brouwersvliet: "the Brouwersvliet",
};
const LINE_NAMES: Record<RideLine, string> = { kaaien: "the quay line", markt: "the Grote Markt line" };

interface Ticket {
  /** Game minutes since day 1, 0:00, when the fare was paid. */
  since: number;
  /** The line you are on (or were on last). */
  line: RideLine;
  from: RideStop;
  /** On board now. */
  on: boolean;
  /** Free changes used. */
  changes: number;
  /** Up on the roof's knifeboard seat (out in the wind) rather than inside. */
  roof?: boolean;
}

export interface RideInfo {
  line: RideLine;
  from: RideStop;
  /** Game minutes since the fare was paid. */
  minutes: number;
  /** Game minutes left on the ticket. */
  left: number;
}

function gameMinutes(db: DB): number {
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  return ((p.day - 1) * 24 + p.hour) * 60 + p.minute;
}

export function isLine(s: unknown): s is RideLine {
  return typeof s === "string" && Object.hasOwn(RIDE_LINES, s);
}

export function isStop(s: unknown): s is RideStop {
  return typeof s === "string" && (RIDE_STOPS as string[]).includes(s);
}

/** Does this line call at this stop? */
export function calls(line: RideLine, stop: RideStop): boolean {
  return (RIDE_LINES[line] as readonly string[]).includes(stop);
}

function read(db: DB): Ticket | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'ride'").get() as { value_json: string } | undefined;
  if (!row) return null;
  try {
    const t = JSON.parse(row.value_json) as Ticket;
    if (typeof t.since !== "number" || !isLine(t.line) || !isStop(t.from)) return null;
    return { since: t.since, line: t.line, from: t.from, on: t.on !== false, changes: Number(t.changes) || 0, roof: t.roof === true };
  } catch {
    return null;
  }
}

function write(db: DB, t: Ticket): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('ride', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    JSON.stringify(t),
  );
}

/** The ticket, if it still runs. */
function ticket(db: DB): Ticket | null {
  const t = read(db);
  if (!t) return null;
  const minutes = gameMinutes(db) - t.since;
  return minutes < 0 || minutes > RIDE_MAX_HOURS * 60 ? null : t;
}

/** The ride you are on now, or null (none, or the ticket ran out). */
export function ride(db: DB): RideInfo | null {
  const t = ticket(db);
  if (!t || !t.on) return null;
  const minutes = gameMinutes(db) - t.since;
  return { line: t.line, from: t.from, minutes, left: RIDE_MAX_HOURS * 60 - minutes };
}

/** A free change you could make now: onto any line but this one. */
export function change(db: DB): { from_line: RideLine } | null {
  const t = ticket(db);
  return t && !t.on && t.changes < RIDE_CHANGES ? { from_line: t.line } : null;
}

/** Is Jef on an omnibus now (for the hourly needs)? */
export function riding(db: DB): boolean {
  return ride(db) !== null;
}

/** Where Jef rides now: inside (the saloon, the back platform), on the roof, or nowhere. */
export function ridePlace(db: DB): "inside" | "roof" | null {
  const t = ticket(db);
  return t && t.on ? (t.roof ? "roof" : "inside") : null;
}

/** Jef climbs onto the roof seat, or back down inside. */
export function seat(db: DB, place: "inside" | "roof"): { place: "inside" | "roof" } {
  const t = ticket(db);
  if (!t || !t.on) throw new GameError("you are not on an omnibus", 409);
  write(db, { ...t, roof: place === "roof" });
  return { place };
}

/** Get on a line at a stop: the conductor takes the fare, or punches the ticket for a change. */
export function board(db: DB, stop: RideStop, line: RideLine): { fare_c: number; change: boolean; text: string } {
  if (!calls(line, stop)) throw new GameError("that line does not call there", 400);
  if (riding(db)) throw new GameError("you are on the omnibus already", 409);
  const t = ticket(db);
  const now = gameMinutes(db);
  if (t && !t.on && t.line !== line && t.changes < RIDE_CHANGES) {
    write(db, { since: t.since, line, from: stop, on: true, changes: t.changes + 1 });
    log(db, "changed_omnibus", stop, `Jef changed onto ${LINE_NAMES[line]} at ${STOP_NAMES[stop]}.`);
    return { fare_c: 0, change: true, text: "The conductor punches your ticket: a change, nothing to pay." };
  }
  const p = player(db);
  if (p.money_c < RIDE_FARE_C) throw new GameError(`not enough money: the fare is ${RIDE_FARE_C} c`, 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = 1").run(RIDE_FARE_C);
    write(db, { since: now, line, from: stop, on: true, changes: 0 });
    log(db, "rode_omnibus", stop, `Jef took ${LINE_NAMES[line]} at ${STOP_NAMES[stop]} for ${RIDE_FARE_C} centimes.`);
  })();
  return { fare_c: RIDE_FARE_C, change: false, text: `You pay the conductor ${RIDE_FARE_C} c and step up onto the back platform.` };
}

/** Get off (at a stop, or put off). Always allowed; the ticket stays good for one change. */
export function alight(db: DB): { text: string } {
  const t = read(db);
  if (!t || !t.on) return { text: "" };
  write(db, { ...t, on: false, roof: false });
  return { text: "You step down onto the cobbles." };
}

/** The night ends every ride and every ticket (day.ts sleep). */
export function endRide(db: DB): void {
  db.prepare("DELETE FROM world_state WHERE key = 'ride'").run();
}
