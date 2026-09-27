// Puts the commit check (tools/commit-check.mjs) in place as git's pre-commit hook on this PC, for this checkout
// and all its worktrees. Run once per PC: `node tools/install-hooks.mjs`. A pre-commit hook of our own that is
// already there is replaced; any other one is kept and the check runs after it.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const common = path.resolve(root, execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" }).trim());
const hook = path.join(common, "hooks", "pre-commit");
const MARK = "# scheldemist commit-check";
const ours = `${MARK}
top="$(git rev-parse --show-toplevel)"
if [ -f "$top/tools/commit-check.mjs" ]; then node "$top/tools/commit-check.mjs" || exit 1; fi
`;
let text = "#!/bin/sh\n" + ours;
if (fs.existsSync(hook)) {
  const old = fs.readFileSync(hook, "utf8");
  if (!old.includes(MARK)) text = old.replace(/\s*$/, "\n") + ours;
}
fs.mkdirSync(path.dirname(hook), { recursive: true });
fs.writeFileSync(hook, text.replace(/\r\n/g, "\n"));
fs.chmodSync(hook, 0o755);
console.log(`[hooks] ${hook}: the commit check runs before every commit`);
