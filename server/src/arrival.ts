import type { Hono } from "hono";
import type { DB } from "./db.ts";
import { pstate, setPstate } from "./player/multi.ts";

// M7 ferry arrival (Steve, 2026-09-24: "The start of the game is: we step off a ferry and so enter
// the city. The ferry takes off when we are off."). A new game begins with Jef on the deck of the
// ferry from the left bank, moored at the end of the Werf pontoon (client game/ferryArrival.ts).
// The engine keeps one fact: is he still on board? A new week (db.ts seed) writes "ferry"; the
// client says "ashore" once he is off the gangway. A save without the key (made before this) is
// ashore: loading a game in progress is unchanged. Reloading before he stepped off plays the
// opening again.
// M8c: each player's own (player_state; the host's older world_state key, as the seed writes it, until written).
// A guest has none: he is ashore.

export const ARRIVAL_KEY = "arrival";
export type ArrivalStage = "ferry" | "ashore";

/** The first log line of a new week (db.ts seed). */
export const ARRIVAL_TEXT = "Jef came off the ferry at the Werf at dawn, with 50 centimes and no name.";

export function arrivalStage(db: DB): ArrivalStage {
  try {
    const v = pstate<{ stage?: unknown }>(db, ARRIVAL_KEY);
    return v?.stage === "ferry" ? "ferry" : "ashore";
  } catch {
    return "ashore";
  }
}

export function setArrivalStage(db: DB, stage: ArrivalStage): void {
  setPstate(db, ARRIVAL_KEY, { stage });
}

/** GET /api/arrival: where the opening stands. POST /api/arrival/ashore: Jef stepped off (once; again is harmless). */
export function mountArrival(app: Hono, deps: { db: DB }): void {
  const { db } = deps;
  app.get("/api/arrival", (c) => c.json({ stage: arrivalStage(db) }));
  app.post("/api/arrival/ashore", (c) => {
    if (arrivalStage(db) === "ferry") setArrivalStage(db, "ashore");
    return c.json({ stage: arrivalStage(db) });
  });
}
