import type { DB } from "../db.ts";
import { generateTown, tidy, type Resident, type Town } from "./population.ts";
import { walkMap } from "./walkmap.ts";
import { TRADES, TOWN_EMPLOYERS } from "./places.ts";

// The town in SQLite (M3e). Each resident is also a row in `npc` (id r001...,
// or the fixed ids of the board's employers), so relationships, memories and
// gossip reuse the M3 tables. The resident's own record (family, home, work,
// schedule, stats, look) is one JSON row in `resident`; the town's places,
// stalls and shop fronts sit in world_state 'town'.

export const RESIDENT_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS resident (
  id TEXT PRIMARY KEY REFERENCES npc(id),
  household INTEGER NOT NULL,
  trade TEXT NOT NULL,
  data_json TEXT NOT NULL,
  persona TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS resident_household ON resident(household);
`;

/** A new town's seed: random for a real game, fixed under test. */
function newSeed(): number {
  if (process.env.VITEST) return 1873;
  return Math.floor(Math.random() * 2 ** 31);
}

const memo = new Map<number, Town>();
function townFor(seed: number): Town {
  let t = memo.get(seed);
  if (!t) memo.set(seed, (t = generateTown(seed)));
  return t;
}

/**
 * Make the town if this save has none (a new game, or a save from before M3e).
 * Adds rows only; never touches the player, jobs or the named people.
 */
export function ensureTown(db: DB, seed?: number): { made: boolean; residents: number } {
  const has = db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number };
  if (has.n > 0) return { made: false, residents: has.n };
  const town = townFor(seed ?? newSeed());
  const insNpc = db.prepare("INSERT OR REPLACE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    for (const r of town.residents) {
      const district = town.places[r.work.place]?.district ?? "town";
      insNpc.run(r.id, r.name, TRADES[r.trade].label, district, r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
    }
    const { residents: _r, ...rest } = town;
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('town', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(rest));
  })();
  cache.delete(db);
  return { made: true, residents: town.residents.length };
}

/**
 * Mend a town made by an older generator, in place (M3e): schedules in order
 * without overlaps, and every point of a round on ground you can walk to.
 * Only the residents' own records change; memories and relationships stay.
 */
export function repairTown(db: DB): number {
  const wm = walkMap();
  const rows = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
  const upd = db.prepare("UPDATE resident SET data_json = ? WHERE id = ?");
  let fixed = 0;
  db.transaction(() => {
    for (const row of rows) {
      const r = JSON.parse(row.data_json) as Resident;
      const before = row.data_json;
      r.sched = { day: tidy(r.sched.day), sunday: tidy(r.sched.sunday) };
      if (r.work.route) {
        const pts = r.work.route.map(([x, z]) => wm.nearestOpen(x, z, 12)).filter((q): q is { x: number; z: number } => !!q).map((q) => [q.x, q.z] as [number, number]);
        r.work.route = pts.length ? pts : [[r.home.sx, r.home.sz]];
      }
      const after = JSON.stringify(r);
      if (after !== before) {
        upd.run(after, row.id);
        fixed++;
      }
    }
  })();
  if (fixed) cache.delete(db);
  return fixed;
}

// ------------------------------------------------------------------ reading

interface Loaded {
  town: Town;
  byId: Map<string, Resident>;
}
const cache = new WeakMap<DB, Loaded>();

/** The whole town, read once per database and kept (residents do not change after the start). */
export function town(db: DB): Loaded {
  let l = cache.get(db);
  if (l) return l;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  const rest = row ? (JSON.parse(row.value_json) as Omit<Town, "residents">) : { seed: 0, places: {}, stalls: [], shops: [] };
  const residents = (db.prepare("SELECT data_json FROM resident ORDER BY id").all() as Array<{ data_json: string }>).map(
    (r) => JSON.parse(r.data_json) as Resident,
  );
  l = { town: { ...rest, residents }, byId: new Map(residents.map((r) => [r.id, r])) };
  cache.set(db, l);
  return l;
}

/** Forget the cached town (after a new game). */
export function dropTownCache(db: DB): void {
  cache.delete(db);
}

export function resident(db: DB, id: string): Resident | undefined {
  return town(db).byId.get(id);
}

export function isResident(db: DB, id: string): boolean {
  return town(db).byId.has(id);
}

export function personaLine(db: DB, id: string): string {
  return (db.prepare("SELECT persona FROM resident WHERE id = ?").get(id) as { persona: string } | undefined)?.persona ?? "";
}

export function setPersonaLine(db: DB, id: string, line: string): void {
  db.prepare("UPDATE resident SET persona = ? WHERE id = ? AND persona = ''").run(line.trim().slice(0, 160), id);
}

/** The people of one household, the head first. */
export function family(db: DB, r: Resident): Resident[] {
  return town(db).town.residents.filter((o) => o.household === r.household && o.id !== r.id);
}

/** Employer residents of the job board (fixed ids). */
export const TOWN_EMPLOYER_IDS = TOWN_EMPLOYERS.map((e) => e.id);
