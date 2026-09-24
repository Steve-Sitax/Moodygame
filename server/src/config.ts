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
/**
 * M4 shares of the day's 80 calls: the director (once a game hour at most) and the
 * conversations between townspeople. Neither takes the reserve. The talk's actions ride
 * in the talk's own reply, so they cost no extra call. What is left (28) is for the board,
 * the outcomes, the named people and the epilogue.
 */
export const DIRECTOR_CALLS_PER_DAY = 9;
export const CONVO_CALLS_PER_DAY = 7;
/**
 * M6 families and surprises (director/families.ts, surprises.ts), taken from the two shares above
 * (the director 12 -> 9, the conversations 10 -> 7), so the day's total and the reserve do not move.
 * FAMILY: a household member passing on what Jef did, and what they will do about it (one call,
 * the lines and the proposal together). SURPRISE: a stranger's name and story, a rumour's drift
 * at its telling, Jef's dream at night. Neither takes the reserve; when a share is gone the
 * engine words it. The fortune teller's words and a talk-down ride in the townspeople's share.
 */
export const FAMILY_CALLS_PER_DAY = 3;
export const SURPRISE_CALLS_PER_DAY = 3;
/**
 * M6 interiors, also out of the 28 that were left, never the reserve: the tavern (a patron's
 * remarks at dice, gossip overheard at a table) and the Poesje's evening play (one a day; two
 * rows if the first try fails its schema). The chatter at the tables rides on CONVO_CALLS_PER_DAY.
 */
export const TAVERN_CALLS_PER_DAY = 6;
export const POESJE_CALLS_PER_DAY = 2;
/**
 * M6 paper, post and pawn (paper/), also out of the 28 that were left, never the reserve:
 * the morning paper (one a day, a second row if the first try fails its schema), a letter
 * for Jef (at most one a day), and the clerks' remarks at the post and the Berg's counter.
 * When the share is gone the engine writes the paper, the letter and the remarks itself.
 */
export const PAPER_CALLS_PER_DAY = 6;
/**
 * M6 homes (homes/remark.ts): the landlady or a neighbour looks in at Jef's room and says one
 * line about it, at most once a game day per home. Out of what was left, never the reserve;
 * when the share is gone the engine says it. 12 were left for the board, the outcomes, the
 * named people and the epilogue.
 */
export const HOME_CALLS_PER_DAY = 2;
/**
 * M6 AI ideas (ideas/): the day's wall posters (one call for the morning's batch), the reply to a
 * letter Jef posted, the words of a job that goes wrong, a lost diary's pages. Out of what was
 * left, never the reserve; when the share is gone the engine words them. 8 are left for the board,
 * the outcomes, the named people and the epilogue. The news from abroad rides in the paper's call.
 */
export const IDEAS_CALLS_PER_DAY = 4;
/**
 * M4b (Steve, 2026-09-24: "events should gather up to 100 people"): the most townspeople one
 * event may take, leads included, and the most one gathering stage may call. The director may
 * ask for up to this; the engine clamps it. The town has about 218 residents.
 * M6 population: the hard upper limit; the player's "event size" (below) may set it lower.
 */
export const EVENT_PEOPLE_MAX = 100;
export const EVENT_GATHER_MAX = 100;

/**
 * M6 population (Steve, 2026-09-24: "More people in game, and for big events not 20 but up to
 * 100 people. Make it adjustable how many people we have in a game."). Kept on the server in the
 * table `game_setting` (town/popsettings.ts), which a new week does not wipe.
 * EVENT_SIZES: the largest gathering an event may call, chosen in Settings; the engine clamps the
 * director's counts to it, and never above EVENT_PEOPLE_MAX.
 */
export const EVENT_SIZES = [20, 50, 100] as const;
export const EVENT_SIZE_DEFAULT = 100;
/**
 * The town's size for a NEW game (Restart). `target` is how many townspeople the generator makes
 * (population.ts, without the garrison and the people other parts add in place: the press, the
 * homes, the lamplighters, the visitors, the emigrants, about 50 more). Normal is the town as it was.
 */
export type TownSize = "small" | "normal" | "large" | "very_large";
export const TOWN_SIZES: Record<TownSize, { label: string; target: number; about: number }> = {
  small: { label: "Small", target: 100, about: 150 },
  normal: { label: "Normal", target: 190, about: 240 },
  large: { label: "Large", target: 300, about: 350 },
  very_large: { label: "Very large", target: 450, about: 500 },
};
export const TOWN_SIZE_DEFAULT: TownSize = "normal";
