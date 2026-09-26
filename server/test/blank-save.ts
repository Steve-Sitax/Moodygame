import Database from "better-sqlite3";
import { openDb, type DB } from "../src/db.ts";

let blank: Buffer | undefined;

/**
 * A new game's save, copied byte for byte from one built once per test file. Building a town
 * takes about 1 s (more on a busy machine); a test that loops over 30 hostile lines with a clean
 * save each took 25 s and timed out under load. Each copy is its own untouched save (its own
 * in-memory database, its own town cache): nothing one copy does reaches the next. The town is
 * the same in every copy; tests that want a new random town use openDb(":memory:").
 */
export function blankSave(): DB {
  if (!blank) {
    const built = openDb(":memory:");
    blank = built.serialize();
    built.close();
  }
  const db = new Database(blank);
  db.pragma("foreign_keys = ON");
  return db;
}
