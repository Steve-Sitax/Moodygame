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

/**
 * Who may talk to the server (index.ts): the game's own pages only. Through vite, /api (string
 * shorthand: changeOrigin) arrives with Host 127.0.0.1:PORT, /ws (no changeOrigin) with the page's
 * Host (localhost:5173); the Origin is the page's either way. The ports: this server, npm run dev (5173), npm run dev:alt (5183,
 * tools/dev-alt.mjs), the test stack (5341, tools/teststack.mjs), and SCHELDEMIST_CLIENT_PORT.
 * Another page in the browser (another site, another local port) gets a 403.
 */
export const CLIENT_PORTS: ReadonlySet<number> = new Set(
  [PORT, 5173, 5183, 5341, Number(process.env.SCHELDEMIST_CLIENT_PORT)].filter((p) => Number.isInteger(p) && p > 0),
);
const LOCAL_NAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** A Host header naming this machine on one of the game's ports (no DNS rebinding). */
export function allowedHost(host: string | undefined, ports: ReadonlySet<number> = CLIENT_PORTS): boolean {
  if (!host) return false;
  try {
    const u = new URL(`http://${host}`);
    return LOCAL_NAMES.has(u.hostname) && ports.has(Number(u.port));
  } catch {
    return false;
  }
}

/** An Origin header of one of the game's own pages (http, this machine, a game port). */
export function allowedOrigin(origin: string, ports: ReadonlySet<number> = CLIENT_PORTS): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && u.origin === origin && LOCAL_NAMES.has(u.hostname) && ports.has(Number(u.port));
  } catch {
    return false;
  }
}
export const DEV = process.env.NODE_ENV !== "production";

// Fixed Claude call settings, docs/02-tech-stack.md
export const CLAUDE = {
  model: "claude-opus-5-5",
  effort: "medium",
  timeoutMs: 20_000, // CLAUDE.md: every model call bounded, then a fallback
} as const;

// ------------------------------------------------------------------ the model router (M6, docs/milestones/M6-models.md)

export type Provider = "claude" | "codex";
export interface ModelChoice {
  provider: Provider;
  model: string;
  /** Left out for Haiku 4.5, which takes no effort setting. */
  effort?: "low" | "medium" | "high";
}
/** The models the router may pick. Claude ones go through the Agent SDK, GPT Sol through the Codex CLI (ai/codex.ts). */
export const MODELS = {
  opus: { provider: "claude", model: CLAUDE.model, effort: CLAUDE.effort },
  sonnet: { provider: "claude", model: "claude-sonnet-5", effort: "medium" },
  haiku: { provider: "claude", model: "claude-haiku-4-5-20251001" },
  sol: { provider: "codex", model: "gpt-6-sol", effort: "medium" },
  luna: { provider: "codex", model: "gpt-6-luna", effort: "medium" },
} as const satisfies Record<string, ModelChoice>;
export type ModelKey = keyof typeof MODELS;

/** A hook not in MODEL_ROUTE goes here. */
export const ROUTE_DEFAULT: ModelKey = "opus";
/**
 * Hook -> model. Measured 2026-09-24 on 43 real prompts of 11 hooks (docs/milestones/M6-models.md).
 * Opus 5.5 was the best writer and as fast as any (median 7.4 s). A cheaper model takes a hook only
 * where it was good enough: judged within 0.6 of Opus, no more rule breaks, done in 20 s at least
 * 95% of the time, at most twice Opus's time, not much less varied, and no player text in the
 * prompt. Steve then chose GPT Luna for every cheap hook (no Sonnet, no Haiku). Every other hook,
 * and every hook not listed, stays on Opus 5.5. Change the table, not the game.
 */
export const MODEL_ROUTE: Record<string, ModelKey> = {
  newspaper: "luna",
  poster: "luna",
  // Steve, 2026-09-24: "do not use sonnet or haiku, use luna instead", "and fallback opus indeed"
  rumour_twist: "luna",
  dream: "luna",
  npc_convo: "luna",
  family_share: "luna",
};

/** The switch "all Claude": every GPT Sol route goes to ROUTE_DEFAULT instead. SCHELDEMIST_ALL_CLAUDE=1 sets it. */
export const ALL_CLAUDE = process.env.SCHELDEMIST_ALL_CLAUDE === "1";

/**
 * Hooks whose prompt can hold the player's own typed words (a line, a letter, a confession).
 * These go only to Claude, whatever MODEL_ROUTE says, unless CODEX_PLAYER_TEXT is on (docs/03, wall 1).
 */
export const PLAYER_TEXT_HOOKS: ReadonlySet<string> = new Set([
  // a named person's reply to a picked line still replays Jef's typed lines of the meeting (fenced)
  "dialogue",
  "free_reply",
  "resident_talk",
  "resident_talkdown",
  "resident_haggle",
  "resident_police",
  "letter_reply",
  "confession",
  // M6 routines (director/routines.ts): the check-in sees the errand the model planned from Jef's words
  "routine_checkin",
]);
/**
 * GPT Sol held all 35 hostile lines, 2026-09-24 (M6-models-injection.md), but wrote the townspeople
 * a grade flatter than Opus, so there is no reason to send it the player's words. Off.
 */
export const CODEX_PLAYER_TEXT = false;

/** GPT Sol through the Codex CLI: same 20 s bound as Claude; an empty folder of its own to run in. */
export const CODEX = {
  model: MODELS.sol.model,
  effort: MODELS.sol.effort,
  cwd: path.join(ROOT, "data", "ai-cwd-codex"),
} as const;

/**
 * Stop runaway loops: at most this many model calls per in-game day. Steve, 2026-09-24: 80 -> 120
 * ("120 calls is ok"): the M6 features had taken nearly all of the 80, leaving the board, the
 * outcomes and the named people almost nothing. The extra 40: townspeople +10, director +3,
 * conversations +3, and the rest (now about 23) for the board, outcomes, named people, epilogue.
 * M7 clock (2026-09-24): still per GAME day, though a game day (6:00 to midnight) is now 36 real
 * minutes, not 6: the same calls are spread over six times the play, so the rate per real minute
 * falls to a sixth (about 3 a real minute at most).
 */
export const CALLS_PER_DAY = 120;

/** Talk with the townspeople (M3e): at most this many model calls a day for them... */
export const RESIDENT_CALLS_PER_DAY = 40;
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
export const DIRECTOR_CALLS_PER_DAY = 12;
export const CONVO_CALLS_PER_DAY = 10;
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
 * M6 landmark interiors (landmarks/confession.ts): the priest's answer in the confessional, in
 * the model's words (advice and humour only; the penance is the engine's). Out of what was left,
 * never the reserve; when the share is gone the engine answers. 6 are left for the board, the
 * outcomes, the named people and the epilogue.
 */
export const CONFESSION_CALLS_PER_DAY = 2;
/** M6 town life: the natie foreman's call at the dawn hiring (director/hiring.ts), one a working morning. */
export const HIRING_CALLS_PER_DAY = 1;
/**
 * M6 ballads and the sermon (ballads/): the street singer's ballad of the day (one call; a second
 * row if the first fails its schema) and the Sunday sermon (one call a Sunday). Out of what was
 * left of the 120, never the reserve; when a share is gone the engine writes them. The shares
 * now come to 88 of 120, leaving 32 for the board, the outcomes, the named people and the
 * epilogue (the last 15 of them the reserve).
 */
export const BALLAD_CALLS_PER_DAY = 2;
export const SERMON_CALLS_PER_DAY = 1;
/**
 * M6 hired hands (town/hire.ts): a hand's four lines (done, asking for more, quitting, grumbling on),
 * one call per hand, at most this many a day, out of what was left of the 120, never the reserve;
 * then the engine's lines. The gifts and the treat ride in the talk call (the townspeople's share).
 * The shares now come to 90 of 120, leaving 30 for the board, the outcomes, the named people and
 * the epilogue (the last 15 of them the reserve).
 */
export const HANDS_CALLS_PER_DAY = 2;
/**
 * M6 AI-composed routines (director/routines.ts): the model's check-ins while an errand runs (hook
 * routine_checkin), out of what was left of the 120, never the reserve. The plan itself rides in the
 * talk call (the townspeople's share). When the share is gone the engine steers by simple rules
 * (retry once, then come back and report). The shares now come to 96 of 120, leaving 24 for the
 * board, the outcomes, the named people and the epilogue (the last 15 of them the reserve).
 */
export const ROUTINE_CALLS_PER_DAY = 6;
/**
 * M7 night (night/nightwork.ts): the night's work, written once a night when the givers come out
 * (a second row only if the first fails its schema). Out of what was left of the 120, never the
 * reserve; when the share is gone the engine's hand-written night work goes up. The shares now come
 * to 98 of 120, leaving 22 for the board, the outcomes, the named people and the epilogue (the last
 * 15 of them the reserve). The day's other budgets hold through the night: a game day is its date,
 * midnight to midnight.
 */
export const NIGHT_BOARD_CALLS_PER_DAY = 2;
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
 * homes, the lamplighters, the visitors, the emigrants, about 50 more; M6 lively: the dog carts, the
 * street sellers, the stalls' keepers, nuns, beguines, beggars and travellers, 25 more; M7 back of town: the
 * households of the back streets, their groups and gangs, the watch, town/backtown.ts: BACK_ABOUT; M7 shops: the nine new shopkeepers, shops/town.ts). Normal is the town as it was.
 */
export type TownSize = "small" | "normal" | "large" | "very_large";
/** M7 back of town (town/backtown.ts): how many people the back of town adds to a new town of each size. */
export const BACK_ABOUT: Record<TownSize, number> = { small: 180, normal: 565, large: 590, very_large: 615 };
export const TOWN_SIZES: Record<TownSize, { label: string; target: number; about: number }> = {
  small: { label: "Small", target: 100, about: 175 + BACK_ABOUT.small + 9 },
  normal: { label: "Normal", target: 190, about: 265 + BACK_ABOUT.normal + 9 },
  large: { label: "Large", target: 300, about: 375 + BACK_ABOUT.large + 9 },
  very_large: { label: "Very large", target: 450, about: 525 + BACK_ABOUT.very_large + 9 },
};
export const TOWN_SIZE_DEFAULT: TownSize = "normal";
