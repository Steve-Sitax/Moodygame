import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

// SQLite schema from docs/04-data-model.md. Only the server writes.
// Delete data/game.sqlite to start over.

const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS player (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  money_c INTEGER NOT NULL,
  food INTEGER NOT NULL, warmth INTEGER NOT NULL, health INTEGER NOT NULL, sleep INTEGER NOT NULL,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  district TEXT NOT NULL,
  rent_paid_until INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS faction_trust (
  faction TEXT PRIMARY KEY,
  trust INTEGER NOT NULL CHECK (trust BETWEEN 0 AND 10)
);
CREATE TABLE IF NOT EXISTS npc (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, role TEXT NOT NULL, district TEXT NOT NULL, faction TEXT,
  persona_json TEXT NOT NULL DEFAULT '{}',
  spot_id TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS npc_relationship (
  npc_id TEXT PRIMARY KEY REFERENCES npc(id),
  trust INTEGER NOT NULL DEFAULT 0, affection INTEGER NOT NULL DEFAULT 0,
  respect INTEGER NOT NULL DEFAULT 0, fear INTEGER NOT NULL DEFAULT 0,
  times_met INTEGER NOT NULL DEFAULT 0,
  last_seen_day INTEGER, last_place TEXT,
  favours_json TEXT NOT NULL DEFAULT '[]', grudges_json TEXT NOT NULL DEFAULT '[]',
  view_of_player TEXT NOT NULL DEFAULT ''
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
CREATE TABLE IF NOT EXISTS ai_call (
  id INTEGER PRIMARY KEY,
  day INTEGER, hour INTEGER,
  hook TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  ms INTEGER NOT NULL,
  in_tokens INTEGER, out_tokens INTEGER, cache_read INTEGER,
  ok INTEGER NOT NULL,
  error TEXT
);
`;

export const FACTIONS = ["naties", "kerk", "politie", "smokkelaars", "burgerij"] as const;
export type Faction = (typeof FACTIONS)[number];

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
  return db;
}

/** Small in-place upgrades for save files made by an older build. */
function migrate(db: DB): void {
  const cols = (db.prepare("PRAGMA table_info(npc_memory)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("spread")) db.exec("ALTER TABLE npc_memory ADD COLUMN spread INTEGER NOT NULL DEFAULT 0");
}

function seed(db: DB): void {
  const has = db.prepare("SELECT 1 FROM player WHERE id = 1").get();
  if (has) return;
  const tx = db.transaction(() => {
    // docs/01: 50 centimes, a thin coat, a bed in Sint-Andries. Day 1, dawn.
    db.prepare(
      `INSERT INTO player (id, name, money_c, food, warmth, health, sleep, day, hour, district, rent_paid_until)
       VALUES (1, 'Jef', 50, 6, 5, 8, 7, 1, 6, 'rijnkaai', 0)`,
    ).run();
    const ft = db.prepare("INSERT INTO faction_trust (faction, trust) VALUES (?, 0)");
    for (const f of FACTIONS) ft.run(f);
    const np = db.prepare("INSERT INTO npc (id, name, role, district, faction) VALUES (?, ?, ?, ?, ?)");
    const rel = db.prepare("INSERT INTO npc_relationship (npc_id) VALUES (?)");
    for (const n of NPCS) {
      np.run(...n);
      rel.run(n[0]);
    }
    db.prepare("INSERT INTO world_state (key, value_json) VALUES ('weather', '\"fog\"')").run();
    db.prepare(
      `INSERT INTO log (day, hour, place, actor, verb, object, text)
       VALUES (1, 6, 'rijnkaai', 'player', 'arrived', NULL, 'Jef came to the Rijnkaai at dawn with 50 centimes and no name.')`,
    ).run();
  });
  tx();
}
