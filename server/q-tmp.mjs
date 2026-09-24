import Database from "better-sqlite3";
const db = new Database("../data/test-families.sqlite", { readonly: true });
console.log(db.prepare("SELECT id, npc_id, source, gist, tone, weight FROM npc_memory WHERE npc_id IN ('r056','r055') ORDER BY id DESC LIMIT 5").all());
console.log(db.prepare("SELECT * FROM family_news ORDER BY id DESC LIMIT 5").all());
console.log(db.prepare("SELECT hook, ok, ms, error FROM ai_call ORDER BY id DESC LIMIT 6").all());
