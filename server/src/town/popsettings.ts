import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { EVENT_PEOPLE_MAX, EVENT_SIZE_DEFAULT, EVENT_SIZES, TOWN_SIZE_DEFAULT, TOWN_SIZES, type TownSize } from "../config.ts";

// M6 population settings (Settings, "Population"): the largest gathering an event may call,
// and the town's size for the next new game. The player's choices, not the week's: they sit
// in their own table, which a new week (db.ts resetDb) does not wipe. How many people are
// drawn in the street is the browser's own setting (client game/settings.ts).

export const SETTING_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS game_setting (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;

const ready = new WeakSet<DB>();
function table(db: DB): void {
  if (ready.has(db)) return;
  db.exec(SETTING_SCHEMA);
  ready.add(db);
}

function read<T>(db: DB, key: string): T | undefined {
  table(db);
  const row = db.prepare("SELECT value_json FROM game_setting WHERE key = ?").get(key) as { value_json: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return undefined;
  }
}

function write(db: DB, key: string, value: unknown): void {
  table(db);
  db.prepare("INSERT INTO game_setting (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(key, JSON.stringify(value));
}

export const isEventSize = (n: unknown): n is (typeof EVENT_SIZES)[number] => typeof n === "number" && (EVENT_SIZES as readonly number[]).includes(n);
export const isTownSize = (s: unknown): s is TownSize => typeof s === "string" && Object.hasOwn(TOWN_SIZES, s);

/** The largest gathering an event may call now (20, 50 or 100). */
export function eventSize(db: DB): number {
  const n = read<number>(db, "event_size");
  return isEventSize(n) ? n : EVENT_SIZE_DEFAULT;
}

export function setEventSize(db: DB, n: number): void {
  if (!isEventSize(n)) throw new RangeError(`event size is one of ${EVENT_SIZES.join(", ")}`);
  write(db, "event_size", n);
}

/**
 * The most townspeople one event may take, leads included: the player's event size, never over
 * the hard limit EVENT_PEOPLE_MAX. The scheduler clamps every gathering to this.
 */
export function eventPeopleMax(db: DB): number {
  return Math.min(EVENT_PEOPLE_MAX, eventSize(db));
}

/** A gathering's count as the engine allows it: at most the event size, and never below 0. */
export function clampEventCount(db: DB, count: number): number {
  const n = Number.isFinite(count) ? Math.round(count) : 0;
  return Math.max(0, Math.min(eventPeopleMax(db), n));
}

/** The town size the NEXT new game is made with. */
export function townSize(db: DB): TownSize {
  const s = read<string>(db, "town_size");
  return isTownSize(s) ? s : TOWN_SIZE_DEFAULT;
}

export function setTownSize(db: DB, s: string): void {
  if (!isTownSize(s)) throw new RangeError(`town size is one of ${Object.keys(TOWN_SIZES).join(", ")}`);
  write(db, "town_size", s);
}

export interface PopulationView {
  eventSize: number;
  eventSizes: number[];
  townSize: TownSize;
  townSizes: Array<{ id: TownSize; label: string; about: number }>;
  /** This week's town: the size it was made with and how many live in it. */
  current: { size: TownSize; residents: number };
}

export function populationView(db: DB): PopulationView {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  let size: TownSize = TOWN_SIZE_DEFAULT;
  try {
    const s = row ? (JSON.parse(row.value_json) as { size?: unknown }).size : undefined;
    if (isTownSize(s)) size = s;
  } catch {
    // an unreadable town row: call it normal
  }
  const residents = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  return {
    eventSize: eventSize(db),
    eventSizes: [...EVENT_SIZES],
    townSize: townSize(db),
    townSizes: (Object.keys(TOWN_SIZES) as TownSize[]).map((id) => ({ id, label: TOWN_SIZES[id].label, about: TOWN_SIZES[id].about })),
    current: { size, residents },
  };
}

/** GET and POST /api/settings/population (the Settings panel). */
export function mountPopulation(app: Hono, db: DB): void {
  app.get("/api/settings/population", (c) => c.json(populationView(db)));
  app.post("/api/settings/population", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { eventSize?: unknown; townSize?: unknown };
    if (b.eventSize !== undefined && !isEventSize(b.eventSize)) return c.json({ error: `event size is one of ${EVENT_SIZES.join(", ")}` }, 400);
    if (b.townSize !== undefined && !isTownSize(b.townSize)) return c.json({ error: `town size is one of ${Object.keys(TOWN_SIZES).join(", ")}` }, 400);
    if (isEventSize(b.eventSize)) setEventSize(db, b.eventSize);
    if (isTownSize(b.townSize)) setTownSize(db, b.townSize);
    return c.json(populationView(db));
  });
}
