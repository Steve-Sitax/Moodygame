// The M4 tables and triggers, in a file with no imports so db.ts can create them
// without pulling the director in (an import cycle would leave FACTIONS undefined).
// Additive only: CREATE IF NOT EXISTS, so old saves keep working.

export const EVENTLOG_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS world_event (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL, minute INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  verb TEXT NOT NULL,
  actor TEXT, target TEXT, place TEXT,
  x REAL, z REAL,
  text TEXT NOT NULL,
  outcome TEXT,
  ref_type TEXT, ref_id INTEGER,
  weight INTEGER NOT NULL DEFAULT 2,
  data_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS world_event_day ON world_event(day, hour);
CREATE TABLE IF NOT EXISTS world_event_who (
  event_id INTEGER NOT NULL REFERENCES world_event(id),
  who TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS world_event_who_who ON world_event_who(who);

-- every log row (game.ts log() and the raw inserts of the hooks) becomes an event
CREATE TRIGGER IF NOT EXISTS world_event_from_log AFTER INSERT ON log BEGIN
  INSERT INTO world_event (day, hour, minute, kind, verb, actor, target, place, text, ref_type, ref_id, weight)
  VALUES (
    NEW.day, NEW.hour, COALESCE((SELECT minute FROM player WHERE id = 1), 0),
    CASE
      WHEN NEW.verb IN ('robbed', 'caught_thief', 'stole', 'gave_back', 'wrecked_boat') THEN 'theft'
      WHEN NEW.verb IN ('took_job', 'finished_job', 'failed_job', 'job_outcome', 'abandoned_job', 'job_board') THEN 'job'
      WHEN NEW.verb IN ('police_called', 'police_sent', 'fled_police', 'police_warning', 'police_fine', 'arrested', 'cell', 'restitution') THEN 'police'
      WHEN NEW.verb IN ('said_strange', 'talked') THEN 'talk'
      WHEN NEW.verb IN ('took_goods') THEN 'deed'
      ELSE 'log'
    END,
    NEW.verb, NEW.actor, NEW.object, NEW.place, NEW.text, 'log', NEW.id,
    CASE
      WHEN NEW.verb IN ('arrested', 'collapsed', 'week_over') THEN 9
      WHEN NEW.verb IN ('cell', 'wrecked_boat') THEN 8
      WHEN NEW.verb IN ('robbed', 'fled_police', 'police_fine', 'caught_thief') THEN 7
      WHEN NEW.verb IN ('stole', 'police_warning', 'took_goods', 'restitution', 'caught_thief') THEN 6
      WHEN NEW.verb IN ('finished_job', 'failed_job', 'abandoned_job', 'police_called') THEN 5
      WHEN NEW.verb IN ('job_outcome', 'police_sent', 'gave_back') THEN 4
      WHEN NEW.verb IN ('took_job', 'said_strange', 'slept_rough', 'job_board') THEN 3
      ELSE 2
    END
  );
  INSERT INTO world_event_who (event_id, who)
    SELECT (SELECT MAX(id) FROM world_event), NEW.actor WHERE NEW.actor IN (SELECT id FROM npc);
  INSERT INTO world_event_who (event_id, who)
    SELECT (SELECT MAX(id) FROM world_event), NEW.object WHERE NEW.object IN (SELECT id FROM npc) AND NEW.object IS NOT NEW.actor;
END;

-- a rumour someone saw start (a memory with a gist, source seen) is an event too
CREATE TRIGGER IF NOT EXISTS world_event_from_rumour AFTER INSERT ON npc_memory
WHEN NEW.gist IS NOT NULL AND NEW.gist <> '' AND NEW.source = 'seen' BEGIN
  INSERT INTO world_event (day, hour, minute, kind, verb, actor, text, ref_type, ref_id, weight)
  VALUES (
    NEW.day, COALESCE((SELECT hour FROM player WHERE id = 1), 0), COALESCE((SELECT minute FROM player WHERE id = 1), 0),
    'rumour', 'rumour', NEW.npc_id, NEW.gist, 'memory', NEW.id, MAX(1, MIN(10, NEW.weight))
  );
  INSERT INTO world_event_who (event_id, who) VALUES ((SELECT MAX(id) FROM world_event), NEW.npc_id);
END;
`;

export const ACTION_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS npc_action (
  id INTEGER PRIMARY KEY,
  npc_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  target_x REAL, target_z REAL,
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('talk', 'director', 'event', 'engine')),
  event_id INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'done', 'failed', 'stopped', 'refused')),
  started INTEGER NOT NULL,
  until INTEGER NOT NULL,
  max_m INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'going',
  x REAL, z REAL,
  outcome TEXT,
  data_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS npc_action_status ON npc_action(status, npc_id);
`;

/**
 * M8d "shared work" (docs/multiplayer-plan.md 8): whom a townsperson's action is about (npc_action.for_player: the
 * player who asked, the one sought or followed; empty: the host, as every older row) and whom an event is a lead
 * for (town_event.for_player; empty: nobody's, the town's); ai_call.player_id, whose share a call came out of.
 * Idempotent, safe on an old save (db.ts migrate calls it after the tables are made).
 */
export function directorMigrate(db: import("../db.ts").DB): void {
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name);
  const has = (t: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  if (has("npc_action") && !cols("npc_action").includes("for_player")) db.exec("ALTER TABLE npc_action ADD COLUMN for_player INTEGER");
  if (has("town_event") && !cols("town_event").includes("for_player")) db.exec("ALTER TABLE town_event ADD COLUMN for_player INTEGER");
  if (has("ai_call") && !cols("ai_call").includes("player_id")) db.exec("ALTER TABLE ai_call ADD COLUMN player_id INTEGER NOT NULL DEFAULT 1");
}

export const EVENT_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS town_event (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  title TEXT NOT NULL,
  template TEXT NOT NULL,
  place TEXT NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL, r REAL NOT NULL,
  start_m INTEGER NOT NULL, end_m INTEGER NOT NULL,
  stage INTEGER NOT NULL DEFAULT -1,
  stages_json TEXT NOT NULL,
  people_json TEXT NOT NULL DEFAULT '[]',
  leads_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'done', 'cancelled')),
  source TEXT NOT NULL,
  notice TEXT NOT NULL DEFAULT '',
  rumour TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT ''
);
`;


// M6 families and surprises (director/families.ts, surprises.ts; town/rumours.ts). Additive only.
export const FAMILY_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS family_news (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  minute INTEGER NOT NULL,
  teller TEXT NOT NULL,
  listener TEXT NOT NULL,
  memory_id INTEGER NOT NULL,
  origin INTEGER NOT NULL,
  gist TEXT NOT NULL,
  tone INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('waiting', 'heard', 'pending', 'acting', 'done', 'lapsed')),
  reaction TEXT,
  amount_c INTEGER NOT NULL DEFAULT 0,
  opening TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  outcome TEXT,
  action_id INTEGER,
  not_before INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS family_news_status ON family_news(status);
CREATE TABLE IF NOT EXISTS town_scheme (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  hour REAL NOT NULL,
  text TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'running', 'done', 'failed')),
  outcome TEXT,
  jef_helped INTEGER NOT NULL DEFAULT 0,
  tries INTEGER NOT NULL DEFAULT 0,
  data_json TEXT NOT NULL DEFAULT '{}'
);
`;

/** Tables of this file that a new game empties (db.ts resetDb). */
export const FAMILY_TABLES = ["family_news", "town_scheme"];

/** db.ts migrate(): the tables, and the told wording of a rumour next to its fact (npc_memory.told_as). */
export function familyMigrate(db: import("../db.ts").DB): void {
  db.exec(FAMILY_SCHEMA);
  const cols = (db.prepare("PRAGMA table_info(npc_memory)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!cols.includes("told_as")) db.exec("ALTER TABLE npc_memory ADD COLUMN told_as TEXT");
  // M8d: whose news it is (the player the first memory was about; 1, the host, for an older save's rows)
  const fcols = (db.prepare("PRAGMA table_info(family_news)").all() as Array<{ name: string }>).map((c) => c.name);
  if (!fcols.includes("player_id")) db.exec("ALTER TABLE family_news ADD COLUMN player_id INTEGER NOT NULL DEFAULT 1");
}
