// The save audit (server/src/town/audit.ts): every stored spot of a save held against the
// current city map. Never writes to the save: it reads a copy.
//
//   node scripts/audit-save.ts ../data/saves/game/slot1.sqlite          the file as it is
//   node scripts/audit-save.ts ../data/saves/game/slot1.sqlite --load   as the server loads it (openDb's repairs run on the copy)
//   node scripts/audit-save.ts --new 5 [--size large]                     five brand-new games (random seeds)
//   add --list for every finding, not only the counts
//
// Exit code 1 when anything is listed.

import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDb, resetDb } from "../src/db.ts";
import { setTownSize } from "../src/town/popsettings.ts";
import { auditCounts, auditSave } from "../src/town/audit.ts";

const args = process.argv.slice(2);
// --new N: N brand-new games (each with its own random seed), made in a temp folder and audited
const nNew = args.includes("--new") ? Math.max(1, Number(args[args.indexOf("--new") + 1]) || 1) : 0;
const size = args.includes("--size") ? args[args.indexOf("--size") + 1] : "";
if (nNew) {
  let bad = 0;
  for (let i = 0; i < nNew; i++) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-audit-"));
    const db = openDb(path.join(dir, "new.sqlite"));
    if (size) {
      setTownSize(db, size);
      resetDb(db);
    }
    const seed = (JSON.parse((db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string }).value_json) as { seed: number }).seed;
    const people = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
    const found = auditSave(db);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`new game${size ? ` (${size})` : ""}, seed ${seed}, ${people} residents: ${found.length} finding(s)`);
    for (const [kind, n] of auditCounts(found)) console.log(`  ${String(n).padStart(4)}  ${kind}`);
    if (args.includes("--list")) for (const f of found) console.log(`${f.kind} | ${f.label} | ${f.why} | (${f.x}, ${f.z})`);
    if (found.length) bad++;
  }
  process.exit(bad ? 1 : 0);
}
const file = args.find((a) => !a.startsWith("--") && !/^\d+$/.test(a));
if (!file || !fs.existsSync(file)) {
  console.error("usage: node scripts/audit-save.ts <save.sqlite> [--load] [--list]");
  process.exit(2);
}
// the copy: an online backup through a read-only handle (the save may be open in a game)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scheldemist-audit-"));
const copy = path.join(dir, "save.sqlite");
const src = new Database(file, { readonly: true, fileMustExist: true });
await src.backup(copy);
src.close();
const load = args.includes("--load");
const db = load ? openDb(copy) : new Database(copy);
const found = auditSave(db);
db.close();
fs.rmSync(dir, { recursive: true, force: true });

console.log(`${path.basename(file)}${load ? " (loaded)" : ""}: ${found.length} finding(s)`);
for (const [kind, n] of auditCounts(found)) console.log(`  ${String(n).padStart(4)}  ${kind}`);
if (args.includes("--list")) for (const f of found) console.log(`${f.kind} | ${f.label} | ${f.why} | (${f.x}, ${f.z})`);
process.exit(found.length ? 1 : 0);
