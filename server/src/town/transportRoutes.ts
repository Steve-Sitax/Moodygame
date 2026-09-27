import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { veloStates } from "./deeds.ts";
import { ownerMissed, transportView } from "./possessions.ts";
import { bikeHour, jefSeen, jefVeloView } from "./bikeshop.ts";
import { forEachOnline } from "../player/current.ts";

// The HTTP side of M6 transport: what the households own and where it stands, the day's
// errands with a load, Jef's own velocipede (bought or hired at the maker's), and the hour's
// work (a hire run out, a machine ridden off).

export interface TransportDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

export function mountTransport(app: Hono, deps: TransportDeps): void {
  const { db, payload, broadcast } = deps;
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      // (M8c: each player's velocipedes in the game)
      let any = false;
      forEachOnline(() => {
        if (bikeHour(db).length) any = true;
      });
      if (any) broadcast({ type: "jobs", ...payload() });
    } catch (e) {
      console.error("[transport] tick", e);
    }
  });

  app.get("/api/transport", (c) => c.json({ ...transportView(db, veloStates(db)), jef: jefVeloView(db) }));

  /** Where Jef is (every few seconds while he owns a machine): a machine he stands by is watched. */
  app.post("/api/transport/seen", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { x?: unknown; z?: unknown };
    jefSeen(db, Number(b.x), Number(b.z));
    return c.json({ ok: true });
  });

  /** An owner went for his velocipede and Jef has it: he walks, and remembers (once per theft). */
  app.post("/api/transport/missed", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { velo?: unknown };
    if (typeof b.velo !== "string" || !b.velo.startsWith("velo:")) throw new GameError("bad velocipede", 400);
    return c.json({ missed: ownerMissed(db, b.velo, veloStates(db)) });
  });
}
