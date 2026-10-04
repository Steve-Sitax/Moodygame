// Before every commit (Steve 2026-09-27, the repo is public: "when committing make sure to check for no personal
// data, secrets, anything not needed in git"). Runs as the git pre-commit hook on this PC (tools/install-hooks.mjs)
// and by hand: `node tools/commit-check.mjs`. It looks at what is staged, only:
// - files that never belong in git (saves, keys, env files, logs, build output, editor leftovers, .claude/);
// - files over 25 MB;
// - added lines with a key or token pattern;
// - added lines with a private word from .claude/private-words.txt (one per line; that file stays out of git, so
//   the words themselves are never published).
// A find stops the commit. Fix it (unstage, move the secret to the password manager, reword); never skip the hook. A line that
// only looks like a secret (a made-up test value) passes when it says FAKE, example or placeholder.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

const NEVER = [
  [/^data\//, "the game's data folder (saves, settings, keys)"],
  [/\.(sqlite|sqlite3|db)(-wal|-shm|-journal)?$/i, "a database or save"],
  [/(^|\/)\.env(\.|$)/, "an env file"],
  [/ai-config[^/]*\.json$/, "AI settings (may hold API keys)"],
  [/(^|\/)\.claude\//, "Claude session files"],
  [/\.(k[d]bx|pem|key|p12|pfx|crt|cer)$/i, "a key, certificate or password vault"],
  [/\.(orig|rej|bak|swp|log|tmp)$/i, "a leftover (merge, editor or log file)"],
  [/(^|\/)(node_modules|dist|dist-demo)\/|^release\//, "installed packages or build output"],
  [/(^|\/)(Thumbs\.db|\.DS_Store|desktop\.ini)$/i, "an OS file"],
];
const SECRET = [
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /sk-(proj-)?[A-Za-z0-9]{32,}/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=]/,
  /\b(password|passwd|secret|api[_-]?key|token)\b\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  /\/\/[^/\s:@]+:[^/\s@]{6,}@/, // user:password@host
];
const MADE_UP = /FAKE|example|placeholder|dummy|<[^>]+>/i;
const MAX_BYTES = 25 * 1024 * 1024;

const words = (() => {
  // Public-only checkouts must not open private session files. All other checks still run.
  if (process.env.SCHELDEMIST_PUBLIC_CHECK === "1") return [];
  try {
    return fs
      .readFileSync(path.join(root, ".claude", "private-words.txt"), "utf8")
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter((w) => w && !w.startsWith("#"));
  } catch {
    return [];
  }
})();
const wordRe = words.length ? new RegExp(`(^|[^A-Za-z0-9])(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9])`, "i") : null;

const finds = [];
const staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
for (const f of staged) {
  const bad = NEVER.find(([re]) => re.test(f));
  if (bad) finds.push(`${f}: ${bad[1]}; it does not belong in git`);
  try {
    const size = Number(git("cat-file", "-s", `:${f}`).trim());
    if (size > MAX_BYTES) finds.push(`${f}: ${(size / 1e6).toFixed(0)} MB; over 25 MB, too big for the repo`);
  } catch {
    // a submodule or a gone file: nothing to size
  }
}

// the added lines, with their file and line number
let file = "";
let line = 0;
for (const l of git("diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--diff-filter=ACMR").split("\n")) {
  if (l.startsWith("+++ ")) {
    file = l.slice(4).replace(/^b\//, "");
    continue;
  }
  const h = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(l);
  if (h) {
    line = Number(h[1]);
    continue;
  }
  if (!l.startsWith("+")) continue;
  const text = l.slice(1);
  if (file !== "tools/commit-check.mjs" && SECRET.some((re) => re.test(text)) && !MADE_UP.test(text)) finds.push(`${file}:${line}: looks like a key, token or password`);
  const w = wordRe?.exec(text);
  if (w) finds.push(`${file}:${line}: a private word ("${w[2]}", from .claude/private-words.txt)`);
  line++;
}

if (finds.length) {
  console.error("\n[commit-check] not committed: this would put private or unneeded things in the public repo\n");
  for (const f of [...new Set(finds)]) console.error(`  ${f}`);
  console.error("\nFix it and stage again. Do not skip this check.\n");
  process.exit(1);
}
console.log(`[commit-check] ${staged.length} staged file(s): no secrets or unneeded files; ${process.env.SCHELDEMIST_PUBLIC_CHECK === "1" ? "public-only mode, private word file not read" : "no private words"}`);
