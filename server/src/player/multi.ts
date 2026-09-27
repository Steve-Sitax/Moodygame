import type { DB } from "../db.ts";
import { FACTIONS } from "../factions.ts";
import { pid } from "./current.ts";

// M8c multiplayer: every player's own part of the save (docs/multiplayer-plan.md 7, 9; docs/milestones/M8c.md).
//
// - The player table takes more than one row (player 1 is the host; a guest's row has his mp_player id).
// - The tables of a player's own things get a player_id (1 for everything an older save holds): his pockets
//   (item), the log's lines about him, his room and its furniture, his deeds, letters, pawn tickets, diaries and
//   meetings. The job in hand says who took it (job.taken_by).
// - Trust per faction and what each townsperson thinks of him are per player (faction_trust, npc_relationship
//   keyed by the player too). A memory may say whom it is about (npc_memory.about_player; empty: the host).
// - Keys of world_state that were the one player's (his ride, his police record, his haggling, his carts ...)
//   move to player_state as they are next written; the host's old key is read until then.

/** Tables of a player's own things: each gets player_id (1 for an older save's rows). */
export const PLAYER_TABLES = ["item", "log", "home_lease", "home_item", "deed", "letter", "jef_letter", "pawn", "diary", "meeting"];

export const PLAYER_STATE_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS player_state (
  player_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  PRIMARY KEY (player_id, key)
);
`;

const cols = (db: DB, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
const hasTable = (db: DB, table: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);

/** Give a table of a player's own things its player_id (a table made later, like deed, calls this itself). */
export function addPlayerColumn(db: DB, table: string): void {
  if (!hasTable(db, table) || cols(db, table).includes("player_id")) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN player_id INTEGER NOT NULL DEFAULT 1`);
}

/** Once per open: the player table for several rows, the player columns and keys (db.ts migrate, at its end). */
export function multiMigrate(db: DB, worldClockSql: string): void {
  db.exec(PLAYER_STATE_SQL);
  // (a table made again under its old name: the triggers that name it, like the event log's, are not checked
  // while the old one is gone for a moment; SQLite's own way, legacy_alter_table, for the rebuilds below)
  db.pragma("legacy_alter_table = ON");
  try {
    rebuild(db, worldClockSql);
  } finally {
    db.pragma("legacy_alter_table = OFF");
  }
}

function rebuild(db: DB, worldClockSql: string): void {
  // the player table: no more CHECK (id = 1). SQLite cannot drop a CHECK, so the table is made again, the rows
  // copied; the clock's triggers go with the old table and are made again
  const pt = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'player'").get() as { sql: string } | undefined;
  if (pt && /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(pt.sql)) {
    db.transaction(() => {
      const c = cols(db, "player");
      db.exec(`CREATE TABLE player_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        money_c INTEGER NOT NULL,
        food INTEGER NOT NULL, warmth INTEGER NOT NULL, health INTEGER NOT NULL, sleep INTEGER NOT NULL,
        day INTEGER NOT NULL, hour INTEGER NOT NULL,
        district TEXT NOT NULL,
        rent_paid_until INTEGER NOT NULL,
        minute INTEGER NOT NULL DEFAULT 0
      )`);
      const keep = ["id", "name", "money_c", "food", "warmth", "health", "sleep", "day", "hour", "district", "rent_paid_until", "minute"].filter((k) => c.includes(k));
      db.exec(`INSERT INTO player_new (${keep.join(", ")}) SELECT ${keep.join(", ")} FROM player`);
      db.exec("DROP TABLE player");
      db.exec("ALTER TABLE player_new RENAME TO player");
    })();
    db.exec(worldClockSql);
  }
  for (const t of PLAYER_TABLES) addPlayerColumn(db, t);
  if (!cols(db, "job").includes("taken_by")) {
    db.exec("ALTER TABLE job ADD COLUMN taken_by INTEGER");
    db.exec("UPDATE job SET taken_by = 1 WHERE status = 'taken'");
  }
  if (!cols(db, "npc_memory").includes("about_player")) db.exec("ALTER TABLE npc_memory ADD COLUMN about_player INTEGER");
  // trust per faction and per player
  if (!cols(db, "faction_trust").includes("player_id")) {
    db.transaction(() => {
      db.exec(`CREATE TABLE faction_trust_new (
        player_id INTEGER NOT NULL DEFAULT 1,
        faction TEXT NOT NULL,
        trust INTEGER NOT NULL CHECK (trust BETWEEN -5 AND 10),
        PRIMARY KEY (player_id, faction)
      )`);
      db.exec("INSERT INTO faction_trust_new (player_id, faction, trust) SELECT 1, faction, trust FROM faction_trust");
      db.exec("DROP TABLE faction_trust");
      db.exec("ALTER TABLE faction_trust_new RENAME TO faction_trust");
    })();
  }
  // what each townsperson thinks of each player
  if (!cols(db, "npc_relationship").includes("player_id")) {
    db.transaction(() => {
      db.exec(`CREATE TABLE npc_relationship_new (
        npc_id TEXT NOT NULL REFERENCES npc(id),
        player_id INTEGER NOT NULL DEFAULT 1,
        trust INTEGER NOT NULL DEFAULT 0, affection INTEGER NOT NULL DEFAULT 0,
        respect INTEGER NOT NULL DEFAULT 0, fear INTEGER NOT NULL DEFAULT 0,
        times_met INTEGER NOT NULL DEFAULT 0,
        last_seen_day INTEGER, last_place TEXT,
        favours_json TEXT NOT NULL DEFAULT '[]', grudges_json TEXT NOT NULL DEFAULT '[]',
        view_of_player TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (npc_id, player_id)
      )`);
      const keep = ["npc_id", "trust", "affection", "respect", "fear", "times_met", "last_seen_day", "last_place", "favours_json", "grudges_json", "view_of_player"].filter((k) => cols(db, "npc_relationship").includes(k));
      db.exec(`INSERT INTO npc_relationship_new (${keep.join(", ")}, player_id) SELECT ${keep.join(", ")}, 1 FROM npc_relationship`);
      db.exec("DROP TABLE npc_relationship");
      db.exec("ALTER TABLE npc_relationship_new RENAME TO npc_relationship");
    })();
  }
}

/**
 * A guest's own row and his starting things, made the first time he is in the game (and again after a new game or a
 * load wiped them): the host's starting money and needs of a new week, the clock of the world, no trust either way,
 * the eight people of the quay knowing him as little as they knew Jef.
 */
export function ensurePlayerRow(db: DB, id: number, name: string): void {
  if (db.prepare("SELECT 1 FROM player WHERE id = ?").get(id)) return;
  const clock = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number } | undefined;
  db.transaction(() => {
    db.prepare(
      `INSERT INTO player (id, name, money_c, food, warmth, health, sleep, day, hour, minute, district, rent_paid_until)
       VALUES (?, ?, 50, 7, 7, 8, 7, ?, ?, ?, 'rijnkaai', 0)`,
    ).run(id, name, clock?.day ?? 1, clock?.hour ?? 6, clock?.minute ?? 0);
    const ft = db.prepare("INSERT OR IGNORE INTO faction_trust (player_id, faction, trust) VALUES (?, ?, 0)");
    for (const f of FACTIONS) ft.run(id, f);
    db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id, player_id) SELECT id, ? FROM npc WHERE id IN (SELECT npc_id FROM npc_relationship WHERE player_id = 1)").run(id);
  })();
}

// ------------------------------------------------------------------ a player's own keys (were world_state)

/** A key of the player's own (his ride, his police record ...): player_state; the host's older world_state key until written. */
export function pstate<T>(db: DB, key: string, who = pid()): T | null {
  const r = db.prepare("SELECT value_json FROM player_state WHERE player_id = ? AND key = ?").get(who, key) as { value_json: string } | undefined;
  if (r) return JSON.parse(r.value_json) as T;
  if (who !== 1) return null;
  const w = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
  return w ? (JSON.parse(w.value_json) as T) : null;
}

export function setPstate(db: DB, key: string, value: unknown, who = pid()): void {
  db.prepare("INSERT INTO player_state (player_id, key, value_json) VALUES (?, ?, ?) ON CONFLICT(player_id, key) DO UPDATE SET value_json = excluded.value_json").run(who, key, JSON.stringify(value));
  // (the host's older key goes: from now on player_state has it)
  if (who === 1) db.prepare("DELETE FROM world_state WHERE key = ?").run(key);
}

export function dropPstate(db: DB, key: string, who = pid()): void {
  db.prepare("DELETE FROM player_state WHERE player_id = ? AND key = ?").run(who, key);
  if (who === 1) db.prepare("DELETE FROM world_state WHERE key = ?").run(key);
}

/** Every player with a row (the host and the guests the save knows). */
export function playerIds(db: DB): number[] {
  return (db.prepare("SELECT id FROM player ORDER BY id").all() as Array<{ id: number }>).map((r) => r.id);
}
