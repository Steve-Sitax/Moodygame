import type { Hono } from "hono";
import type { DB } from "./db.ts";

// M7 ferry arrival (Steve, 2026-09-24: "The start of the game is: we step off a ferry and so enter
// the city. The ferry takes off when we are off."). A new game begins with Jef on the deck of the
// ferry from the left bank, moored at the end of the Werf pontoon (client game/ferryArrival.ts).
// The engine keeps one fact: is he still on board? A new week (db.ts seed) writes "ferry"; the
// client says "ashore" once he is off the gangway. A save without the key (made before this) is
// ashore: loading a game in progress is unchanged. Reloading before he stepped off plays the
// opening again.

export const ARRIVAL_KEY = "arrival";
export type ArrivalStage = "ferry" | "ashore";

/** The first log line of a new week (db.ts seed). */
export const ARRIVAL_TEXT = "Jef came off the ferry at the Werf at dawn, with 50 centimes and no name.";

export function arrivalStage(db: DB): ArrivalStage {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(ARRIVAL_KEY) as { value_json: string } | undefined;
  if (!row) return "ashore";
  try {
    const v = JSON.parse(row.value_json) as { stage?: unknown };
    return v?.stage === "ferry" ? "ferry" : "ashore";
  } catch {
    return "ashore";
  }
}

export function setArrivalStage(db: DB, stage: ArrivalStage): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(
    ARRIVAL_KEY,
    JSON.stringify({ stage }),
  );
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
