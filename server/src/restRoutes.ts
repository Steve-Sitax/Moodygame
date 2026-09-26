import type { Hono } from "hono";
import type { DB } from "./db.ts";
import { clearRests, reportPos, restOf, startRest, wakeRest } from "./rest.ts";

// The HTTP side of M7 sleep (rest.ts), mounted by index.ts before the tick's own route: lie down in a bed
// or on a bench for as long as he chooses, wake with a key. The time passes on the client's ticks while he
// sleeps (the tick carries `asleep: true`); a new board when the date turns goes through index.ts's tick.

export interface RestDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

export function mountRest(app: Hono, deps: RestDeps): void {
  const { db, payload, broadcast } = deps;
  const push = () => broadcast({ type: "jobs", ...payload() });

  // each tick: where Jef stands (the plausibility check of a bench or the doss house step)
  app.use("/api/tick", async (c, next) => {
    const b = (await c.req.json().catch(() => null)) as { pos?: unknown } | null;
    if (b && typeof b === "object") reportPos(b.pos);
    await next();
  });
  // a new week or a loaded save: nobody is asleep
  app.use("/api/new-game", async (_c, next) => {
    clearRests();
    await next();
  });
  app.use("/api/load", async (_c, next) => {
    await next();
    clearRests();
  });

  /** Lie down: {place: "home" | "doss" | "bench", bench?: id, hours: 1..12 | "morning", pos: {x, z, y?}}. */
  app.post("/api/sleep", async (c) => {
    const rest = startRest(db, await c.req.json().catch(() => ({})));
    push();
    return c.json({ rest, ...payload() });
  });

  /** A key: he wakes now; only the time slept counts. */
  app.post("/api/sleep/wake", (c) => {
    const woke = wakeRest(db);
    push();
    return c.json({ woke, ...payload() });
  });

  app.get("/api/sleep", (c) => c.json({ rest: restOf(db) }));
}
