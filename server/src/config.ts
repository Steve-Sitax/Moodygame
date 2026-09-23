import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..", "..");
/** The save. SCHELDEMIST_DB points a second server at a test save (M3e checks), never at the real one by accident. */
export const DB_FILE = process.env.SCHELDEMIST_DB ? path.resolve(process.env.SCHELDEMIST_DB) : path.join(ROOT, "data", "game.sqlite");
/** Empty folder the Claude subprocess runs in. Nothing of ours is in it. */
export const AI_CWD = path.join(ROOT, "data", "ai-cwd");

export const HOST = "127.0.0.1"; // localhost only, never the LAN
export const PORT = Number(process.env.SCHELDEMIST_PORT) || 8787;
export const DEV = process.env.NODE_ENV !== "production";

// Fixed Claude call settings, docs/02-tech-stack.md
export const CLAUDE = {
  model: "claude-opus-5-5",
  effort: "medium",
  timeoutMs: 20_000, // CLAUDE.md: every model call bounded, then a fallback
} as const;

/** Stop runaway loops: at most this many model calls per in-game day. */
export const CALLS_PER_DAY = 80;

/** Talk with the townspeople (M3e): at most this many model calls a day for them... */
export const RESIDENT_CALLS_PER_DAY = 30;
/** ...and never when fewer than this many calls are left for the board, outcomes and the named people. */
export const CALLS_RESERVE = 15;
/** Model calls in one meeting with a townsperson; after that, engine lines. */
export const RESIDENT_CALLS_PER_MEETING = 3;
