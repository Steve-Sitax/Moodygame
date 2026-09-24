// M6 AI ideas: tables for the wall posters, Jef's own letters, jobs that go wrong,
// the news from abroad and the lost diaries. No imports, so db.ts can create them
// without an import cycle. Additive only (CREATE IF NOT EXISTS): old saves keep working.

export const IDEAS_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS poster (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  spot TEXT NOT NULL,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  down_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('up', 'down')),
  why_down TEXT,
  ref TEXT NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '[]',
  text_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'engine',
  names_jef INTEGER NOT NULL DEFAULT 0,
  reward_c INTEGER NOT NULL DEFAULT 0,
  owner TEXT,
  thing_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS jef_letter (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  to_id TEXT NOT NULL,
  to_name TEXT NOT NULL,
  text TEXT NOT NULL,
  gated TEXT,
  stamp_c INTEGER NOT NULL,
  reply_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'answered')),
  effect_json TEXT NOT NULL DEFAULT '{}',
  reply_letter INTEGER
);
CREATE TABLE IF NOT EXISTS job_trouble (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL UNIQUE,
  day INTEGER NOT NULL,
  kind TEXT NOT NULL,
  after_s INTEGER NOT NULL,
  cast_json TEXT NOT NULL DEFAULT '[]',
  options_json TEXT NOT NULL DEFAULT '[]',
  words_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'engine',
  status TEXT NOT NULL CHECK (status IN ('ready', 'chosen', 'settled')),
  choice INTEGER,
  step_done INTEGER NOT NULL DEFAULT 0,
  result_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS news_abroad (
  day INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  text TEXT NOT NULL,
  talk TEXT NOT NULL,
  prices_json TEXT NOT NULL,
  until_day INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS diary (
  id INTEGER PRIMARY KEY,
  owner TEXT NOT NULL,
  day INTEGER NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '[]',
  entries_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'engine',
  status TEXT NOT NULL CHECK (status IN ('writing', 'lying', 'held', 'returned', 'sold', 'squeezed', 'gone')),
  read INTEGER NOT NULL DEFAULT 0,
  closed_day INTEGER,
  started_min INTEGER,
  tries INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meeting (
  id INTEGER PRIMARY KEY,
  who TEXT NOT NULL,
  day INTEGER NOT NULL,
  from_h REAL NOT NULL, to_h REAL NOT NULL,
  x REAL NOT NULL, z REAL NOT NULL,
  label TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'met', 'missed')),
  letter INTEGER
);
`;

/** For resetDb (a new week wipes them). */
export const IDEAS_TABLES = ["poster", "jef_letter", "job_trouble", "news_abroad", "diary", "meeting"] as const;
