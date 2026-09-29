// The release notes' top (docs/release.md): the part of CHANGELOG.md for one version, from its "## [x.y.z]"
// heading to the next one, without the heading (the Release has its own title).
//
//   node tools/release/changelog.mjs v0.2.0     prints that version's part; fails if it has none

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const version = (process.argv[2] ?? "").replace(/^v/, "");
const lines = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8").split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
if (!version || start < 0) {
  console.error(`CHANGELOG.md has no part for ${version || "(no version given)"}: add "## [${version}] - <date>" first`);
  process.exit(1);
}
let end = lines.findIndex((l, i) => i > start && (l.startsWith("## [") || /^\[[^\]]+\]: /.test(l)));
if (end < 0) end = lines.length;
console.log(lines.slice(start + 1, end).join("\n").trim());
