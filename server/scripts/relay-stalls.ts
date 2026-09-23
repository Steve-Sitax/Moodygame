// Move a save's market stalls to the current layout (M3i, server/src/town/places.ts STALLS):
// the same stalls, goods and keepers, only where they stand; the Vismarkt haulers get the
// new ends of their hauls. Memories and everything else stay. Backs the save up first.
//
//   node scripts/relay-stalls.ts ../data/game.sqlite
//
// A running game server keeps the old town in memory: restart it after.

import { openDb } from "../src/db.ts";
import { relayStalls } from "../src/town/store.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/relay-stalls.ts <save.sqlite>");
  process.exit(1);
}
const db = openDb(file);
const backup = file.replace(/\.sqlite$/, "") + `-before-stalls-${Date.now()}.sqlite`;
await db.backup(backup);
const memories = (db.prepare("SELECT COUNT(*) AS n FROM npc_memory").get() as { n: number }).n;
const r = relayStalls(db);
const after = (db.prepare("SELECT COUNT(*) AS n FROM npc_memory").get() as { n: number }).n;
console.log(`backup: ${backup}\nstalls moved: ${r.stalls}\nkeepers moved: ${r.keepers}\nhaulers given new ends: ${r.haulers}\nmemories: ${memories} before, ${after} after`);
db.close();
