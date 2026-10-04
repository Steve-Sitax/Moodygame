// A deterministic telegram for --playtest, in its own fresh test database only.
// No server rule is replaced: pickup, fee and settlement still use the normal routes.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [folder, file, url] = process.argv.slice(2);
const output = path.resolve(folder ?? ".");
const database = path.resolve(file ?? ".");
if (!output.startsWith(path.join(root, "godot", "baked") + path.sep) || database !== path.join(output, "test.sqlite"))
  throw new Error("play fixture requires <this worktree>/godot/baked/<output>/test.sqlite");
if (!fs.existsSync(database) || !/^http:\/\/127\.0\.0\.1:(?:893|896)[0-9]$/.test(url ?? "")) throw new Error("missing test database or wrong test port");
const response = await fetch(`${url}/api/press`, { signal: AbortSignal.timeout(6000) });
if (!response.ok) throw new Error(`press: ${response.status}`);
const { post } = await response.json();
if (!post?.at || !post.clerk) throw new Error("no post counter");
const require = createRequire(path.join(root, "server", "package.json"));
const Database = require("better-sqlite3");
const db = new Database(database);
try {
  const { day } = db.prepare("SELECT day FROM player WHERE id = 1").get();
  const task = { kind: "letters", goods: "letters", from: { ...post.at, label: "the post office" }, stops: [{ id: "playtest-wire", name: "the telegraph counter", ...post.at, what: "telegraph" }], fee_c: 50, words: "ARRIVE TOMORROW STOP", city: "Brussels", twist: "none", limit_s: null };
  const row = db.prepare("INSERT INTO job (day,title,employer_npc,district,task_type,pay_c,risk,tier,required_faction,pitch,task_json,source,status) VALUES (?, ?, ?, 'town', 'letters', 90, 'low', 0, NULL, ?, ?, 'dev', 'offered')")
    .run(day, "Test: a telegram", post.clerk, "Fetch the words and send them at the post office.", JSON.stringify(task));
  console.log(JSON.stringify({ id: Number(row.lastInsertRowid), task }));
} finally { db.close(); }
