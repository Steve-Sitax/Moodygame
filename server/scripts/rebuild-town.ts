// Give a save a new town (M3e): new residents, homes and schedules; the
// player, jobs, the named people and their memories stay as they are.
// Backs the save up next to itself first.
//
//   node scripts/rebuild-town.ts ../data/game.sqlite [seed]
//
// A running game server keeps the old town in memory: restart it after.

import { openDb } from "../src/db.ts";
import { dropTownCache, ensureTown } from "../src/town/store.ts";

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/rebuild-town.ts <save.sqlite> [seed]");
  process.exit(1);
}
const seed = process.argv[3] ? Number(process.argv[3]) : undefined;
const db = openDb(file);
const backup = file.replace(/\.sqlite$/, "") + `-before-town-${Date.now()}.sqlite`;
await db.backup(backup);
const ids = (db.prepare("SELECT id FROM resident").all() as Array<{ id: string }>).map((r) => r.id);
db.transaction(() => {
  const inList = `(${ids.map(() => "?").join(",") || "''"})`;
  db.prepare(`DELETE FROM npc_memory WHERE npc_id IN ${inList} OR heard_from IN ${inList}`).run(...ids, ...ids);
  db.prepare(`DELETE FROM npc_relationship WHERE npc_id IN ${inList}`).run(...ids);
  db.prepare("DELETE FROM resident").run();
  db.prepare(`DELETE FROM npc WHERE id IN ${inList}`).run(...ids);
  db.prepare("DELETE FROM world_state WHERE key = 'town'").run();
})();
dropTownCache(db);
const r = ensureTown(db, seed);
console.log(`backup: ${backup}\nold residents removed: ${ids.length}\nnew residents: ${r.residents}`);
db.close();
