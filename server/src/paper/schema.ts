// M6 tables (the paper, the post, the pawn office), in a file with no imports so
// db.ts can create them without an import cycle. Additive only (CREATE IF NOT
// EXISTS; one ALTER in db.ts for item.ref): old saves keep working.

export const PRESS_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS newspaper (
  day INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  price_c INTEGER NOT NULL,
  facts_json TEXT NOT NULL,
  paper_json TEXT NOT NULL,
  source TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS letter (
  id INTEGER PRIMARY KEY,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  sender TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  why TEXT NOT NULL,
  kind TEXT NOT NULL,
  facts_json TEXT NOT NULL DEFAULT '[]',
  offer_json TEXT NOT NULL DEFAULT '{}',
  text_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'engine',
  status TEXT NOT NULL CHECK (status IN ('writing', 'waiting', 'given', 'read')),
  job_id INTEGER
);
CREATE TABLE IF NOT EXISTS pawn (
  id INTEGER PRIMARY KEY,
  item_kind TEXT NOT NULL,
  item_name TEXT NOT NULL,
  worth_c INTEGER NOT NULL,
  loan_c INTEGER NOT NULL,
  rate_c INTEGER NOT NULL,
  day INTEGER NOT NULL, hour INTEGER NOT NULL,
  due_day INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('held', 'redeemed', 'forfeit')),
  paid_c INTEGER,
  closed_day INTEGER
);
`;

/** The M6 tables, for resetDb (a new week wipes them). */
export const PRESS_TABLES = ["newspaper", "letter", "pawn"] as const;
