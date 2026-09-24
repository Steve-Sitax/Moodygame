import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { GameError } from "../game.ts";
import { town } from "../town/store.ts";
import { notify } from "./bus.ts";
import { setState, state } from "./state.ts";
import { errandsInfo, errandTick, installRoutines } from "./routines.ts";

// M6 AI-composed routines (director/routines.ts): the install, the tick, and what the Dev panel
// and the checks may read. Mounted by index.ts after the gifts and hired hands (whose step
// executor and "stop" hook it rides on).

export interface RoutineDeps {
  db: DB;
  payload: () => Record<string, unknown>;
}

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

/** The dev "shut" mark: an M4 closure with no event (-1), so trade.atWork says the place is shut. */
export function devShut(db: DB, place: string, on: boolean): string[] {
  const t = town(db).town;
  if (!t.places[place] && !t.shops.some((s) => s.id === place)) throw new GameError("no such place", 404);
  const closed = state<Record<string, number>>(db, "m4_closed", {});
  if (on) closed[place] = -1;
  else if (closed[place] === -1) delete closed[place];
  setState(db, "m4_closed", closed);
  notify("events");
  return Object.keys(closed);
}

export function mountRoutines(app: Hono, deps: RoutineDeps): void {
  const { db } = deps;
  installRoutines();

  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      errandTick(db);
    } catch (e) {
      console.error("[routines] tick", e);
    }
  });

  // the errands now: their plan, how far they are, what was steered (the Dev panel, the checks)
  app.get("/api/errands", (c) => c.json(errandsInfo(db)));

  if (DEV) {
    // the checks: shut a shop or a stall's place for a while, as an event would (never on a real save by itself)
    app.post("/api/dev/errand/shut", async (c) => {
      const b = await body(c);
      if (typeof b.place !== "string") throw new GameError("which place?", 400);
      return c.json({ closed: devShut(db, b.place, b.on !== false) });
    });
  }
}
