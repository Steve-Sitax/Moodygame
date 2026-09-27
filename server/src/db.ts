import { FACTIONS, type Faction } from "./factions.ts";
import { rerouteHauls } from "./town/hauls.ts";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { RESIDENT_SCHEMA, dropTownCache, ensureGarrison, ensureTown, rehomeLost, repairTown } from "./town/store.ts";
import { ensureTransport, dropTransport } from "./town/possessions.ts";
import { ensureBikeShop } from "./town/bikeshop.ts";
import { ensureCartwright } from "./town/handcart.ts";
import { ACTION_SCHEMA, EVENT_SCHEMA, EVENTLOG_SCHEMA, FAMILY_TABLES, directorMigrate, familyMigrate } from "./director/schema.ts";
import { PRESS_SCHEMA, PRESS_TABLES } from "./paper/schema.ts";
import { IDEAS_SCHEMA, IDEAS_TABLES } from "./ideas/schema.ts";
import { ensurePressTown } from "./paper/town.ts";
import { ensureNightTown } from "./night/givers.ts";
// M7 shops: the new shops and their keepers, the old shops into their own houses (shops/town.ts)
import { ensureShopsTown } from "./shops/town.ts";
import { ensureLamplighters } from "./town/lamplighters.ts";
import { ensureHomesTown, HOMES_SCHEMA, HOMES_TABLES } from "./homes/town.ts";
import { ensureVisitors } from "./town/visitors.ts";
import { ensureEmigrants } from "./town/emigrants.ts";
import { ensureLandmarksTown } from "./landmarks/town.ts";
import { ensureLively } from "./town/lively.ts";
// M7 back of town: the households, groups and gangs of the back streets (town/backtown.ts)
import { ensureBackTown } from "./town/backtown.ts";
import { ensureStanding } from "./town/standing.ts";
import { ensureWallFolk } from "./town/wallfolk.ts";
import { ensureMills } from "./town/mills.ts";
import { ARRIVAL_KEY, ARRIVAL_TEXT } from "./arrival.ts";
import { shortenOffered } from "./hooks/jobBoard.ts";
import { CLIENT_STATE_SQL } from "./save/schema.ts";
// M7 character: the player's profile by player id; a new week's player row takes its name (player/profile.ts)
import { WORLD_CLOCK_SQL } from "./mp/worldClock.ts"; // M8a
import { MP_PLAYER_SQL } from "./mp/players.ts"; // M8a
import { PROFILE_SQL, seedName } from "./player/profile.ts";
import { multiMigrate } from "./player/multi.ts"; // M8c

// SQLite schema from docs/04-data-model.md. Only the server writes.
// Delete data/game.sqlite to start over.

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS player (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  money_c INTEGER NOT NULL,
  food INTEGER NOT NULL, warmth INTEGER NOT NULL, health INTEGER NOT NULL, sleep INTEGER NOT NULL,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  district TEXT NOT NULL,
  rent_paid_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS faction_trust (
  player_id INTEGER NOT NULL DEFAULT 1,
  faction TEXT NOT NULL,
  trust INTEGER NOT NULL CHECK (trust BETWEEN -5 AND 10),
  PRIMARY KEY (player_id, faction)
);
CREATE TABLE IF NOT EXISTS npc (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, role TEXT NOT NULL, district TEXT NOT NULL, faction TEXT,
  persona_json TEXT NOT NULL DEFAULT '{}',
  spot_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS npc_relationship (
  npc_id TEXT NOT NULL REFERENCES npc(id),
  player_id INTEGER NOT NULL DEFAULT 1,
  trust INTEGER NOT NULL DEFAULT 0, affection INTEGER NOT NULL DEFAULT 0,
  respect INTEGER NOT NULL DEFAULT 0, fear INTEGER NOT NULL DEFAULT 0,
  times_met INTEGER NOT NULL DEFAULT 0,
  last_seen_day INTEGER, last_place TEXT,
  favours_json TEXT NOT NULL DEFAULT '[]', grudges_json TEXT NOT NULL DEFAULT '[]',
  view_of_player TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (npc_id, player_id)
);
CREATE TABLE IF NOT EXISTS npc_memory (
  id INTEGER PRIMARY KEY,
  npc_id TEXT NOT NULL REFERENCES npc(id),
  text TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('seen','heard')),
  heard_from TEXT,
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
  day INTEGER NOT NULL,
  spread INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS world_fact (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL,
  weight INTEGER NOT NULL CHECK (weight BETWEEN 1 AND 10),
  day INTEGER NOT NULL,
  tags TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  place TEXT NOT NULL, actor TEXT NOT NULL, verb TEXT NOT NULL, object TEXT,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  title TEXT NOT NULL, employer_npc TEXT NOT NULL, district TEXT NOT NULL, task_type TEXT NOT NULL,
  pay_c INTEGER NOT NULL,
  risk TEXT NOT NULL,
  tier INTEGER NOT NULL, required_faction TEXT,
  pitch TEXT NOT NULL,
  task_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'claude',
  status TEXT NOT NULL CHECK (status IN ('offered','taken','done','failed','expired')),
  outcome_text TEXT
);
CREATE TABLE IF NOT EXISTS event (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, slot TEXT NOT NULL,
  text TEXT NOT NULL, ops_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('pending','fired'))
);
CREATE TABLE IF NOT EXISTS world_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS item (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  job_id INTEGER
);
CREATE TABLE IF NOT EXISTS ai_call (
  id INTEGER PRIMARY KEY,
  day INTEGER, hour INTEGER,
  hook TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  ms INTEGER NOT NULL,
  in_tokens INTEGER, out_tokens INTEGER, cache_read INTEGER,
  ok INTEGER NOT NULL,
  error TEXT
);
-- every model call counts the day's calls first, per hook
CREATE INDEX IF NOT EXISTS ai_call_day_hook ON ai_call (day, hook);
`;

export { FACTIONS, type Faction } from "./factions.ts";

// The 8 town NPCs from docs/01. Personas come in M3.
const NPCS: Array<[string, string, string, string, Faction | null]> = [
  ["sooi", "Sooi", "Foreman, Hessenatie", "rijnkaai", "naties"],
  ["peeters", "Widow Peeters", "Ship chandler", "rijnkaai", "burgerij"],
  ["fientje", "Fientje", "Fishwife", "vismarkt", null],
  ["cools", "Pastoor Cools", "Priest", "sint-andries", "kerk"],
  ["verhulst", "Agent Verhulst", "Policeman", "vismarkt", "politie"],
  ["tuur", "Tuur", "Ferryman and night lighter", "vismarkt", "smokkelaars"],
  ["leentje", "Leentje", "Soup kitchen helper", "sint-andries", "kerk"],
  ["vandyck", "Meneer Van Dyck", "Merchant", "grote-markt", "burgerij"],
];

export type DB = Database.Database;

export function openDb(file: string): DB {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  seed(db);
  // the town's residents (M3e): made once per game, also for a save from before M3e
  ensureTown(db);
  repairTown(db);
  // the garrison and the customs (town/garrison.ts): an older save gets them once, added in place
  ensureGarrison(db);
  // M6: newsboys, the post office and its clerk, the Berg's counter; added in place to an older save
  ensurePressTown(db);
  // M6 homes: rooms to let, the widow who lets one, the second-hand dealer; added in place to an older save
  ensureHomesTown(db);
  // M6 town life: two lamplighters and their rounds of the gas lamps; in place, once
  ensureLamplighters(db);
  // M6 surprises: the fortune teller and the strangers' places (town/visitors.ts); in place, once
  ensureVisitors(db);
  // M6 emigrants: the Logement, its keeper, the runner and the families waiting for the liner (town/emigrants.ts); in place, once
  ensureEmigrants(db);
  // M6 landmark interiors: the curate, the organist, clerks, cellarmen, the museum's attendant ... (landmarks/town.ts); in place, once
  ensureLandmarksTown(db);
  // M6 transport: the velocipede maker, then what each household owns (town/bikeshop.ts, possessions.ts); in place, once
  ensureBikeShop(db);
  // M6 handcart: the wheelwright (town/handcart.ts); in place, once
  ensureCartwright(db);
  ensureTransport(db);
  // M6 lively: dog carts, street sellers, the stalls against the cathedral, nuns, beguines, travellers (town/lively.ts); in place, once
  ensureLively(db);
  // M7 night: the four givers of night work (night/givers.ts); in place, once
  ensureNightTown(db);
  // M7 shops: the butcher, the colonial goods, the apothecary, the barber ... and their keepers (shops/town.ts); in place, once
  ensureShopsTown(db);
  // M7 back of town: the poor quarter round the court pumps and corners, the better streets, the watch (town/backtown.ts); in place, once
  ensureBackTown(db);
  // M7 walk-up: the standing roles (customs at the Entrepot, the lock and by night; a police patrol per beat day and night; thieves on the quays) (town/standing.ts); in place, once
  ensureStanding(db);
  // the look pass: the wall's garrison round and sentries, the town's gang pulling it down, a man and his dog, two lovers, children with a kite (town/wallfolk.ts); in place, once
  ensureWallFolk(db);
  // M7 mills: a miller and his man at each mill on the wall (town/mills.ts); in place, once
  ensureMills(db);
  // M7 short jobs: open goods work of an older save to the new sizes (at most two by hand); in place, once
  shortenOffered(db);
  // Steve 2026-09-27: the dockers onto the carrying routes of shared/hauls.ts (from a pile to a door); in place
  const hauled = rerouteHauls(db);
  if (hauled) console.log(`[town] ${hauled} docker(s) moved onto the carrying routes`);
  // a save from an older city map: homes whose door step lies off every path now get a house of this map
  const lost = rehomeLost(db);
  if (lost) console.log(`[town] ${lost} resident(s) of an older city map moved to houses of this one`);
  return db;
}

/** Small in-place upgrades for save files made by an older build. */
function migrate(db: DB): void {
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
  // Steve 2026-09-24: trust may go below 0 (-5 to 10). An older save's faction_trust carries the old
  // CHECK (0 to 10): the table is rebuilt with the new range, every row copied as it is.
  const ft = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'faction_trust'").get() as { sql: string } | undefined;
  if (ft && /BETWEEN\s+0\s+AND\s+10/i.test(ft.sql)) {
    db.transaction(() => {
      db.exec("CREATE TABLE faction_trust_new (faction TEXT PRIMARY KEY, trust INTEGER NOT NULL CHECK (trust BETWEEN -5 AND 10))");
      db.exec("INSERT INTO faction_trust_new (faction, trust) SELECT faction, trust FROM faction_trust");
      db.exec("DROP TABLE faction_trust");
      db.exec("ALTER TABLE faction_trust_new RENAME TO faction_trust");
    })();
  }
  if (!cols("npc_memory").includes("spread")) db.exec("ALTER TABLE npc_memory ADD COLUMN spread INTEGER NOT NULL DEFAULT 0");
  if (!cols("player").includes("minute")) db.exec("ALTER TABLE player ADD COLUMN minute INTEGER NOT NULL DEFAULT 0");
  // M3e: rumours in the town. gist = one line others may repeat about Jef, tone -2..+2,
  // origin = the memory it came from (so nobody hears the same thing twice), town_spread = told on.
  const mem = cols("npc_memory");
  if (!mem.includes("gist")) db.exec("ALTER TABLE npc_memory ADD COLUMN gist TEXT");
  if (!mem.includes("tone")) db.exec("ALTER TABLE npc_memory ADD COLUMN tone INTEGER NOT NULL DEFAULT 0");
  if (!mem.includes("origin")) db.exec("ALTER TABLE npc_memory ADD COLUMN origin INTEGER");
  if (!mem.includes("town_spread")) db.exec("ALTER TABLE npc_memory ADD COLUMN town_spread INTEGER NOT NULL DEFAULT 0");
  db.exec(RESIDENT_SCHEMA);
  // M4: the event log for AI context (with its triggers), the actions and the town's events. Additive only.
  db.exec(EVENTLOG_SCHEMA);
  db.exec(ACTION_SCHEMA);
  db.exec(EVENT_SCHEMA);
  // M6: the paper, letters, the pawn office; a pocket row may point at one of them (item.ref)
  db.exec(PRESS_SCHEMA);
  // M6 homes: the key and the rent, the furniture Jef owns (homes/)
  db.exec(HOMES_SCHEMA);
  // M6 families and surprises: family news, the day's schemes, a rumour's told wording
  familyMigrate(db);
  // M6 AI ideas: posters, Jef's own letters, jobs that go wrong, news from abroad, lost diaries (ideas/)
  db.exec(IDEAS_SCHEMA);
  // a notebook stuck in "writing" is found by its start and its tries (ideas/diaries.ts)
  if (!cols("diary").includes("started_min")) db.exec("ALTER TABLE diary ADD COLUMN started_min INTEGER");
  if (!cols("diary").includes("tries")) db.exec("ALTER TABLE diary ADD COLUMN tries INTEGER NOT NULL DEFAULT 0");
  if (!cols("item").includes("ref")) db.exec("ALTER TABLE item ADD COLUMN ref INTEGER");
  // M4b: the leads of an event (bride, groom, musicians ...), picked by the engine at its start
  if (!cols("town_event").includes("leads_json")) db.exec("ALTER TABLE town_event ADD COLUMN leads_json TEXT NOT NULL DEFAULT '[]'");
  // M7 save and pause: the browser's side of a save, per player (save/schema.ts)
  db.exec(CLIENT_STATE_SQL);
  // M7 character: the player's profile (none in an older save: today's Jef)
  db.exec(PROFILE_SQL);
  // M8a multiplayer: the world's clock in world_state (mp/worldClock.ts), the players who joined (mp/players.ts)
  db.exec(WORLD_CLOCK_SQL);
  db.exec(MP_PLAYER_SQL);
  // M8c multiplayer: every player's own part (player/multi.ts): more than one player row, player_id on his things
  multiMigrate(db, WORLD_CLOCK_SQL);
  // M8d: whom an action or an event is for, whose share a model call came out of (director/schema.ts)
  directorMigrate(db);
}

/**
 * A new game bumps this. A model call begun before it drops its write when it comes back
 * (take it before the await, compare after): the old week's words never land in the new one.
 */
let generation = 0;
export function gameGeneration(): number {
  return generation;
}
/** M7 save and pause: a save loaded is a new game for the calls begun before it (save/saves.ts). */
export function bumpGeneration(): void {
  generation++;
}

/** Start a new week: wipe the save and seed it again (the "new game" button). */
export function resetDb(db: DB): void {
  generation++;
  db.transaction(() => {
    for (const t of ["player_state", "client_state", ...FAMILY_TABLES, ...IDEAS_TABLES, ...HOMES_TABLES, ...PRESS_TABLES, "world_event_who", "world_event", "npc_action", "town_event", "ai_call", "item", "event", "world_state", "job", "log", "world_fact", "npc_memory", "npc_relationship", "resident", "npc", "faction_trust", "player"]) {
      db.prepare(`DELETE FROM ${t}`).run();
    }
  })();
  seed(db);
  // a new week, a new town
  dropTownCache(db);
  ensureTown(db);
  ensurePressTown(db);
  ensureHomesTown(db);
  ensureLamplighters(db);
  ensureVisitors(db);
  ensureEmigrants(db);
  ensureLandmarksTown(db);
  dropTransport(db);
  ensureBikeShop(db);
  // M6 handcart: the wheelwright (town/handcart.ts); in place, once
  ensureCartwright(db);
  ensureTransport(db);
  ensureLively(db);
  ensureNightTown(db);
  ensureShopsTown(db);
  ensureBackTown(db);
  ensureStanding(db);
  ensureWallFolk(db);
  ensureMills(db);
}

function seed(db: DB): void {
  const has = db.prepare("SELECT 1 FROM player WHERE id = 1").get();
  if (has) return;
  const tx = db.transaction(() => {
    // docs/01: 50 centimes, a thin coat, a bed in Sint-Andries. Day 1, dawn.
    db.prepare(
      `INSERT INTO player (id, name, money_c, food, warmth, health, sleep, day, hour, district, rent_paid_until)
       VALUES (1, ?, 50, 7, 7, 8, 7, 1, 6, 'rijnkaai', 0)`,
    ).run(seedName(db));
    const ft = db.prepare("INSERT INTO faction_trust (faction, trust) VALUES (?, 0)");
    for (const f of FACTIONS) ft.run(f);
    const np = db.prepare("INSERT INTO npc (id, name, role, district, faction) VALUES (?, ?, ?, ?, ?)");
    const rel = db.prepare("INSERT INTO npc_relationship (npc_id) VALUES (?)");
    for (const n of NPCS) {
      np.run(...n);
      rel.run(n[0]);
    }
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('weather', '\"fog\"')").run();
    // M7 ferry arrival (arrival.ts): the week opens with Jef on the ferry's deck at the Werf pontoon
    db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?)").run(ARRIVAL_KEY, JSON.stringify({ stage: "ferry" }));
    db.prepare(
      `INSERT INTO log (day, hour, place, actor, verb, object, text)
       VALUES (1, 6, 'rijnkaai', 'player', 'arrived', NULL, ?)`,
    ).run(ARRIVAL_TEXT);
  });
  tx();
}
