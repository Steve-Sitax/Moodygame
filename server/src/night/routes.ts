import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { GameError } from "../game.ts";
import type { Ending } from "../day.ts";
import { NIGHT_GIVERS } from "../town/places.ts";
import { clearGangs, gangChancePerHour, gangNow, resolveGang, rollGang, type GangFacts, type GangHow } from "./gangs.ts";
import { clampNight, FALLBACK_NIGHT, insertNightJobs, nightBoardDue, nightIdle, nightWorkTick, writeNightBoard } from "./nightwork.ts";
import { giverPost } from "./givers.ts";
import "./talk.ts";
import { maxTier } from "../hooks/jobBoard.ts";

// The HTTP side of M7 night (mounted by index.ts): the night's work on every tick (the board when
// the givers come out, the end of it at 5:00), the gang's roll and Jef's answer, and dev buttons for
// the browser check (docs/testing.md: t.gang(), t.nightWork()).

export interface NightDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
  /** A new board when the date turned in his sleep, or the epilogue (index.ts). */
  afterNight: (ended?: Ending) => void;
}

const HOWS = new Set<GangHow>(["run", "fight", "shout", "pay", "stand"]);

function facts(b: unknown): GangFacts {
  const o = (b ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
  return { x: num(o.x), z: num(o.z), lit: o.lit === true, quay: o.quay === true, indoors: o.indoors === true, carrying: o.carrying === true, people: Array.isArray(o.people) ? o.people : undefined };
}

export function mountNight(app: Hono, deps: NightDeps): void {
  const { db, payload, broadcast } = deps;
  const pushJobs = () => broadcast({ type: "jobs", ...payload() });

  app.use("/api/new-game", async (_c, next) => {
    clearGangs(db);
    await next();
  });

  // each tick: the night's work (the board at 21:00, gone at 5:00)
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      const due = nightBoardDue(db);
      const r = nightWorkTick(db);
      if (r.expired) pushJobs();
      // the board is written in the background; tell the client when it is up
      if (due) void nightIdle().then(pushJobs);
    } catch (e) {
      console.error("[night] tick", e);
    }
  });

  /**
   * M7 sleep (Steve 2026-09-26): no more lying down on the bare street. A bed or a bench (rest.ts, POST
   * /api/sleep); only a man dead on his feet still drops where he stands (day.ts tick).
   */
  app.post("/api/night/sleep-rough", () => {
    throw new GameError("no lying down on the stones: find a bench or a bed", 409);
  });

  /** What the client needs at a load: a gang in the street now, and where the givers stand. */
  app.get("/api/night/state", (c) => c.json({ gang: gangNow(db), givers: NIGHT_GIVERS.map((g) => ({ id: g.id, at: giverPost(db, g.id) })) }));

  /** Once a tick at night: where Jef is and what he sees; the engine rolls. */
  app.post("/api/night/roll", async (c) => {
    const b = await c.req.json().catch(() => ({}));
    const gang = rollGang(db, facts(b));
    if (gang) broadcast({ type: "gang", gang });
    return c.json({ gang });
  });

  /** Jef's answer to the gang: run, fight, shout, pay (or stand: he did nothing in time). */
  app.post("/api/night/gang/:id", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { how?: unknown };
    if (typeof b.how !== "string" || !HOWS.has(b.how as GangHow)) throw new GameError("how must be run, fight, shout, pay or stand", 400);
    const result = resolveGang(db, Number(c.req.param("id")), b.how as GangHow, facts(b));
    pushJobs();
    return c.json({ result, ...payload() });
  });

  if (DEV) {
    /** Dev: a gang now, wherever Jef is (the kit's t.gang()). */
    app.post("/api/dev/gang", async (c) => {
      const b = await c.req.json().catch(() => ({}));
      const gang = rollGang(db, facts(b), Date.now(), true);
      if (gang) broadcast({ type: "gang", gang });
      return c.json({ gang });
    });
    /** Dev: the chance per game hour now, from what the client says. */
    app.post("/api/dev/gang-chance", async (c) => {
      const f = facts(await c.req.json().catch(() => ({})));
      return c.json({ perHour: gangChancePerHour(db, { lit: !!f.lit, quay: !!f.quay, carrying: !!f.carrying }) });
    });
    /** Dev: the night's work now (the model's, or `fallback`: the hand-written jobs). */
    app.post("/api/dev/night-work", async (c) => {
      const b = (await c.req.json().catch(() => ({}))) as { fallback?: boolean };
      if (b.fallback) {
        const ids = insertNightJobs(db, clampNight(FALLBACK_NIGHT, maxTier(db)), maxTier(db), "fallback");
        pushJobs();
        return c.json({ source: "fallback", ids });
      }
      const r = await writeNightBoard(db, undefined, { force: true });
      pushJobs();
      return c.json(r);
    });
  }
}
