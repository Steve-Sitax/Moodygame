import type { DB } from "../db.ts";
import { generateTown, tidy, type Resident, type Town } from "./population.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import { HAULS, NIGHT_GIVERS, shownTrade, STALLS, TOWN_EMPLOYERS } from "./places.ts";
import { GARRISON_TRADES, generateGarrison } from "./garrison.ts";
import { townSize } from "./popsettings.ts";
import type { TownSize } from "../config.ts";

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

const memo = new Map<string, Town>();
function townFor(seed: number, size: TownSize): Town {
  const key = `${seed}:${size}`;
  let t = memo.get(key);
  if (!t) memo.set(key, (t = generateTown(seed, size)));
  return t;
}

/**
 * Make the town if this save has none (a new game, or a save from before M3e).
 * Adds rows only; never touches the player, jobs or the named people.
 * M6 population: at the size chosen in Settings (popsettings.ts), unless one is given. A town
 * that exists keeps its size until a new game.
 */
export function ensureTown(db: DB, seed?: number, size?: TownSize): { made: boolean; residents: number } {
  const has = db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number };
  if (has.n > 0) return { made: false, residents: has.n };
  const town = townFor(seed ?? newSeed(), size ?? townSize(db));
  const insNpc = db.prepare("INSERT OR REPLACE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  db.transaction(() => {
    for (const r of town.residents) {
      const district = town.places[r.work.place]?.district ?? "town";
      insNpc.run(r.id, r.name, shownTrade(r), district, r.faction);
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
 * Give an older save its garrison and customs (garrison.ts), in place: the same men a new
 * game with this town's seed would have, added after the last resident. Adds rows only
 * (npc, npc_relationship, resident) and the new places (barracks, guard room, post) to the
 * town's world_state; every existing resident, memory, relationship and Jef stay as they
 * were. Runs once: a town that has any of them is left alone. Returns how many were added.
 */
export function ensureGarrison(db: DB): number {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return 0; // no town yet: ensureTown makes one with its garrison
  const q = `SELECT COUNT(*) AS n FROM resident WHERE trade IN (${GARRISON_TRADES.map(() => "?").join(", ")})`;
  if ((db.prepare(q).get(...GARRISON_TRADES) as { n: number }).n > 0) return 0;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  if (!row) return 0;
  const rest = JSON.parse(row.value_json) as Omit<Town, "residents">;
  const residents = (db.prepare("SELECT data_json FROM resident").all() as Array<{ data_json: string }>).map((r) => JSON.parse(r.data_json) as Resident);
  const g = generateGarrison(rest.seed, rest.places, residents);
  const insNpc = db.prepare("INSERT OR IGNORE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let added = 0;
  db.transaction(() => {
    const places = { ...rest.places, ...g.places };
    for (const r of g.residents) {
      if (hasNpc.get(r.id)) continue; // an id taken by something else: never overwrite
      const district = places[r.work.place]?.district ?? "town";
      insNpc.run(r.id, r.name, shownTrade(r), district, r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
      added++;
    }
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places }));
  })();
  cache.delete(db);
  return added;
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

/**
 * A save made on an older city map (commit 169942f re-cut the streets) keeps each home's house
 * number and door step of that map. Most old steps still fall in a street; some now lie inside a
 * block, and nobody can walk to them. Run on load, after the in-place additions (db.ts; the
 * emigrants' Logement has its own repair, emigrants.ts rehouseEmigrants): a home whose house has
 * no door at its step any more and whose step cannot be walked to gets the nearest free house
 * door of the current city. Everyone who lived at that old step moves together, and a door they
 * worked at at home moves with them. Every other record stays as it was. Returns how many moved.
 */
export function rehomeLost(db: DB): number {
  const wm = walkMap();
  const doors = houseDoors();
  const byHouse = new Map(doors.map((d) => [d.house, d]));
  const rows = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
  const all = rows.map((row) => ({ id: row.id, before: row.data_json, r: JSON.parse(row.data_json) as Resident }));
  const stands = (r: Resident) => {
    const d = byHouse.get(r.home.house);
    return !!d && Math.hypot(d.sx - r.home.sx, d.sz - r.home.sz) < 1;
  };
  // lost: a real house number (not -1, the police post or a place) with no door there now, and no path to the step
  const lost = all.filter(({ r }) => r.home.house >= 0 && !stands(r) && !wm.nearestOpen(r.home.sx, r.home.sz, 1.5));
  if (!lost.length) return 0;
  const lostIds = new Set(lost.map((x) => x.id));
  const houses = new Set(all.filter((x) => !lostIds.has(x.id) && stands(x.r)).map((x) => x.r.home.house));
  const taken: Array<[number, number]> = [];
  for (const { id, r } of all) {
    if (!lostIds.has(id)) taken.push([r.home.sx, r.home.sz]);
    if (r.work.door) taken.push(r.work.door);
  }
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  if (row) {
    const rest = JSON.parse(row.value_json) as Omit<Town, "residents">;
    for (const p of Object.values(rest.places)) if (p.door) taken.push(p.door);
    for (const s of rest.shops) taken.push(s.door);
  }
  const free = doors.filter((d) => !houses.has(d.house) && !taken.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 4));
  const moved = new Map<string, HouseDoor>(); // old step -> the new door
  const upd = db.prepare("UPDATE resident SET data_json = ? WHERE id = ?");
  db.transaction(() => {
    for (const { id, r, before } of lost) {
      const key = `${r.home.sx},${r.home.sz}`;
      let d = moved.get(key);
      if (!d) {
        const [ox, oz] = [r.home.sx, r.home.sz];
        const i = free.reduce((b, q, k) => (b < 0 || Math.hypot(q.sx - ox, q.sz - oz) < Math.hypot(free[b].sx - ox, free[b].sz - oz) ? k : b), -1);
        if (i < 0) continue;
        d = free.splice(i, 1)[0];
        moved.set(key, d);
      }
      const old = [r.home.sx, r.home.sz];
      if (r.work.door && Math.hypot(r.work.door[0] - old[0], r.work.door[1] - old[1]) < 0.5) r.work.door = [d.sx, d.sz];
      r.home = { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz };
      const after = JSON.stringify(r);
      if (after !== before) upd.run(after, id);
    }
  })();
  cache.delete(db);
  return lost.length;
}

/**
 * Move a town's market stalls to the current STALLS layout (M3i: the fish banks of the
 * Vismarkt and the Grote Markt stalls re-laid, off the cart ruts, a little askew), in place:
 * the same stalls, goods and keepers; only where each stands, which way it faces, and where
 * its keeper stands behind it (work.at). The Vismarkt haulers get the new ends of their
 * hauls. Memories, relationships, schedules and everything else stay. Not run on start:
 * scripts/relay-stalls.ts runs it on a save (with a backup). Returns how many stalls moved.
 */
export function relayStalls(db: DB): { stalls: number; keepers: number; haulers: number } {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  if (!row) return { stalls: 0, keepers: 0, haulers: 0 };
  const rest = JSON.parse(row.value_json) as Omit<Town, "residents">;
  const wm = walkMap();
  const snap = (x: number, z: number): [number, number] => {
    const q = wm.nearestOpen(x, z, 8) ?? { x, z };
    return [q.x, q.z];
  };
  let stalls = 0;
  rest.stalls.forEach((s, i) => {
    const d = STALLS[i];
    if (!d || d.place !== s.place || d.goods !== s.goods) return; // not the same stall: leave it
    const [x, z] = snap(d.x, d.z);
    if (x === s.x && z === s.z && d.face[0] === s.face[0] && d.face[1] === s.face[1]) return;
    s.x = x;
    s.z = z;
    s.face = d.face;
    stalls++;
  });
  const rows = db.prepare("SELECT id, data_json FROM resident").all() as Array<{ id: string; data_json: string }>;
  const upd = db.prepare("UPDATE resident SET data_json = ? WHERE id = ?");
  let keepers = 0;
  let haulers = 0;
  const newHauls = HAULS.vismarkt ?? [];
  db.transaction(() => {
    for (const r0 of rows) {
      const r = JSON.parse(r0.data_json) as Resident;
      let changed = false;
      if (r.work.kind === "stall" && r.work.stall !== undefined) {
        const s = rest.stalls[r.work.stall];
        if (s && s.keeper === r.id) {
          const at = snap(s.x - s.face[0] * 1.0, s.z - s.face[1] * 1.0);
          r.work.at = [at[0], at[1], Math.atan2(s.face[0], s.face[1])];
          changed = true;
          keepers++;
        }
      }
      if (r.work.place === "vismarkt" && r.work.a && r.work.b && newHauls.length) {
        // the haul with the same quay end, else the nearest one
        const best = newHauls.reduce((b, h) => (Math.hypot(h.a[0] - r.work.a![0], h.a[1] - r.work.a![1]) < Math.hypot(b.a[0] - r.work.a![0], b.a[1] - r.work.a![1]) ? h : b), newHauls[0]);
        const b = snap(best.b[0], best.b[1]);
        if (b[0] !== r.work.b[0] || b[1] !== r.work.b[1]) {
          r.work.b = b;
          changed = true;
          haulers++;
        }
      }
      if (changed) upd.run(JSON.stringify(r), r0.id);
    }
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
  })();
  cache.delete(db);
  return { stalls, keepers, haulers };
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

/** Employer residents of the job board (fixed ids); M7 night: and the givers of night work (they keep to their post too). */
export const TOWN_EMPLOYER_IDS = [...TOWN_EMPLOYERS, ...NIGHT_GIVERS].map((e) => e.id);
