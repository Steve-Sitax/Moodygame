import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..", "..");
export const DB_FILE = path.join(ROOT, "data", "game.sqlite");
/** Empty folder the Claude subprocess runs in. Nothing of ours is in it. */
export const AI_CWD = path.join(ROOT, "data", "ai-cwd");

export const HOST = "127.0.0.1"; // localhost only, never the LAN
export const PORT = 8787;
export const DEV = process.env.NODE_ENV !== "production";

// Fixed Claude call settings, docs/02-tech-stack.md
export const CLAUDE = {
  model: "claude-opus-5-5",
  effort: "medium",
  timeoutMs: 20_000, // CLAUDE.md: every model call bounded, then a fallback
} as const;

/** Stop runaway loops: at most this many model calls per in-game day. */
export const CALLS_PER_DAY = 80;
