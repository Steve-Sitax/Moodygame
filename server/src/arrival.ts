import type { Hono } from "hono";
import type { DB } from "./db.ts";
import { GameError, log } from "./game.ts";
import { ending, worldWeekOver } from "./day.ts";
import { mpOn } from "./mp/settings.ts";
import { pid } from "./player/current.ts";
import { pstate, resetPlayer, setPstate } from "./player/multi.ts";
import { nameOf } from "./player/names.ts";

// M7 ferry arrival (Steve, 2026-09-24: "The start of the game is: we step off a ferry and so enter
// the city. The ferry takes off when we are off."). A new game begins with Jef on the deck of the
// ferry from the left bank, moored at the end of the Werf pontoon (client game/ferryArrival.ts).
// The engine keeps one fact: is he still on board? A new week (db.ts seed) writes "ferry"; the
// client says "ashore" once he is off the gangway. A save without the key (made before this) is
// ashore: loading a game in progress is unchanged. Reloading before he stepped off plays the
// opening again.
// M8c: each player's own (player_state; the host's older world_state key, as the seed writes it, until written).
// M8d: a guest's first time in the game, and a new man after his end, come by the ferry too (player/multi.ts
// ensurePlayerRow, resetPlayer): `creator`: his man is made in the character sheet before the ferry comes in;
// `log`: his "came off the ferry" line is written when he steps ashore (under the name he chose by then).

export const ARRIVAL_KEY = "arrival";
export type ArrivalStage = "ferry" | "ashore";

/** The first log line of a new week (db.ts seed). */
export const ARRIVAL_TEXT = "Jef came off the ferry at the Werf at dawn, with 50 centimes and no name.";
/** M8d: a guest's, or a new man's, first log line (any hour). */
export const ARRIVAL_TEXT_LATER = "Jef came off the ferry at the Werf, with 50 centimes and no name.";

interface ArrivalState {
  stage?: unknown;
  creator?: unknown;
  log?: unknown;
}

function state(db: DB): ArrivalState | null {
  try {
    return pstate<ArrivalState>(db, ARRIVAL_KEY);
  } catch {
    return null;
  }
}

export function arrivalStage(db: DB): ArrivalStage {
  return state(db)?.stage === "ferry" ? "ferry" : "ashore";
}

/** M8d: on the ferry, and his man not yet made in the character sheet. */
export function arrivalCreator(db: DB): boolean {
  const s = state(db);
  return s?.stage === "ferry" && s.creator === true;
}

export function setArrivalStage(db: DB, stage: ArrivalStage): void {
  setPstate(db, ARRIVAL_KEY, { stage });
}

/**
 * M8d: a new man for this player (after his own end, played together): his old man retires, the new one comes
 * by the ferry. Never a new week: that stays the host's (/api/new-game), and played alone the old way stays.
 */
export function newMan(db: DB): { stage: ArrivalStage; retired: number } {
  if (!mpOn()) throw new GameError("Played alone, a new week begins with the new man.", 409);
  const e = ending(db);
  if (!e) throw new GameError("your man is still in the town", 409);
  if (worldWeekOver(db)) throw new GameError("The week is over for everyone. The host starts the next one.", 409);
  const man = resetPlayer(db, pid(), nameOf(db));
  return { stage: arrivalStage(db), retired: man.id };
}

/**
 * GET /api/arrival: where the opening stands. POST /api/arrival/ashore: Jef stepped off (once; again is harmless).
 * M8d: POST /api/arrival/made: the man is made (the character sheet was shown); POST /api/player/new-man.
 */
export function mountArrival(app: Hono, deps: { db: DB }): void {
  const { db } = deps;
  app.get("/api/arrival", (c) => c.json({ stage: arrivalStage(db), creator: arrivalCreator(db) }));
  app.post("/api/arrival/ashore", (c) => {
    const s = state(db);
    if (arrivalStage(db) === "ferry") {
      setArrivalStage(db, "ashore");
      if (s?.log === true) log(db, "arrived", null, ARRIVAL_TEXT_LATER);
    }
    return c.json({ stage: arrivalStage(db) });
  });
  app.post("/api/arrival/made", (c) => {
    const s = state(db);
    if (s?.stage === "ferry" && s.creator === true) setPstate(db, ARRIVAL_KEY, { ...s, creator: false });
    return c.json({ stage: arrivalStage(db), creator: arrivalCreator(db) });
  });
  app.post("/api/player/new-man", (c) => c.json(newMan(db)));
}
