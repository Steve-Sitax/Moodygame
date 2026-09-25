import type { Hono } from "hono";
import type { DB } from "../db.ts";
import type { Ending } from "../day.ts";
import { abandonArms, homesInfo, liftItem, payRent, placeItem, sleepHome, takeKey, warmAtStove } from "./homes.ts";
import { remarkOnRoom } from "./remark.ts";

// The HTTP side of the homes (M6 homes), mounted by index.ts. Everything that moves money,
// needs or furniture answers with the game payload and the homes' state, like the other
// routes; the night goes through afterNight (a new board, or the epilogue).

export interface HomeDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
  afterNight: (ended?: Ending) => void;
}

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

export function mountHomes(app: Hono, deps: HomeDeps): void {
  const { db, payload, broadcast, afterNight } = deps;
  const both = () => ({ ...payload(), homes: homesInfo(db) });
  const moved = () => broadcast({ type: "jobs", ...payload() });

  app.get("/api/homes", (c) => c.json(homesInfo(db)));

  app.post("/api/homes/take", async (c) => {
    const b = await body(c);
    const r = takeKey(db, b.home, b.plan);
    moved();
    return c.json({ ...r, ...both() });
  });

  app.post("/api/homes/rent", async (c) => {
    const b = await body(c);
    const r = payRent(db, b.plan);
    moved();
    return c.json({ ...r, ...both() });
  });

  app.post("/api/homes/sleep", (c) => {
    const night = sleepHome(db);
    // M7 night: a new board only if the date turned in his sleep (or the week ended)
    if (night.turned || night.ended) afterNight(night.ended);
    moved();
    return c.json({ night, ...both() });
  });

  app.post("/api/homes/stove", (c) => {
    const r = warmAtStove(db);
    if (r.warmed) moved();
    return c.json({ ...r, ...both() });
  });

  app.post("/api/homes/place", async (c) => {
    const b = await body(c);
    const r = placeItem(db, b.id, b.gx, b.gz, b.rot);
    moved();
    return c.json({ ...r, ...both() });
  });

  app.post("/api/homes/lift", async (c) => {
    const b = await body(c);
    const r = liftItem(db, b.id);
    return c.json({ item: r, ...both() });
  });

  app.post("/api/homes/abandon", (c) => {
    const r = abandonArms(db);
    return c.json({ ...r, ...both() });
  });

  // someone looks in: a model call may be behind it (20 s, then the engine's line)
  app.post("/api/homes/remark", async (c) => c.json({ remark: await remarkOnRoom(db) }));
}
