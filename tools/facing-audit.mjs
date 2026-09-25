// Lists every E/F/G key action in the client written without a target (`at`) and without `self`
// (game/facing.ts: E only for what Jef looks at). Run from the repo root: node tools/facing-audit.mjs
// Exit code 1 when any is left. It reads object literals `{ key: "KeyE", ... }` in client/src.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..", "client", "src");
const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) files.push(p);
  }
})(root);

let missing = 0;
let total = 0;
const self = [];
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const re = /key:\s*"Key[EFG]"/g;
  let m;
  while ((m = re.exec(src))) {
    // the literal's own braces: back to its "{", forward to the matching "}"
    let i = m.index;
    let depth = 0;
    for (; i >= 0; i--) {
      const c = src[i];
      if (c === "}") depth++;
      else if (c === "{") {
        if (depth === 0) break;
        depth--;
      }
    }
    let j = m.index;
    depth = 0;
    for (; j < src.length; j++) {
      const c = src[j];
      if (c === "{") depth++;
      else if (c === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    const lit = src.slice(i, j + 1);
    if (/interface\s+\w+\s*$/.test(src.slice(Math.max(0, i - 60), i))) continue; // the Action type itself
    total++;
    const line = src.slice(0, m.index).split("\n").length;
    const text = (/text[,\s]/.test(lit.slice(0, 40)) && !/text:/.test(lit) ? ["", "", "(text)"] : lit.match(/text:\s*([`"'])((?:\\.|(?!\1).)*)\1/) ?? lit.match(/text:\s*([^,}]+)/))?.[2] ?? lit.match(/text:\s*([^,}]+)/)?.[1] ?? "?";
    const where = `${relative(join(root, ".."), f).replace(/\\/g, "/")}:${line}`;
    if (/[,{]\s*at\s*[:,}]/.test(lit)) continue; // at: ... or the shorthand ", at }"
    if (/\bself:\s*true/.test(lit)) {
      self.push(`${where}  ${text}`);
      continue;
    }
    missing++;
    console.log(`NO TARGET  ${where}  ${text}`);
  }
}
console.log(`\n${total} key actions; ${total - missing - self.length} with a target, ${self.length} self (no looking needed), ${missing} without either.`);
if (process.argv.includes("--self")) for (const s of self) console.log(`self  ${s}`);
process.exit(missing ? 1 : 0);
