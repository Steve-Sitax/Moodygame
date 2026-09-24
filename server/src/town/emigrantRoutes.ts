import type { Hono, MiddlewareHandler } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { clock } from "../day.ts";
import { ITEMS, waresOf } from "../trade.ts";
import { TRADES } from "./places.ts";
import { town } from "./store.ts";
import type { Resident } from "./population.ts";
import { boardByLighter, devEarly, emigrantsTick, emigrantsView, emigrantTown, abs, RUNNER_ID, KEEPER_ID, SCAM_HOURS } from "./emigrants.ts";

// The emigrants' routes (M6, town/emigrants.ts). The engine moves families in and out with the
// game clock (after every tick, a night's sleep, a dev clock jump and a new game); the client
// gets the families, their people and their things, and reports a family gone down into a lighter.

/** A resident as the client's town knows them (index.ts /api/town gives the same shape). */
function publicResident(db: DB, r: Resident) {
  return {
    id: r.id,
    name: r.name,
    first: r.first,
    age: r.age,
    sex: r.sex,
    kind: r.kind,
    trade: r.trade,
    label: TRADES[r.trade].label,
    household: r.household,
    role: r.family_role,
    home: r.home,
    work: r.work,
    sched: r.sched,
    dog: r.dog,
    mate: r.mate ?? null,
    wares: waresOf(db, r.id).map((w) => ({ ...w, name: ITEMS[w.kind].name })),
  };
}

export function mountEmigrants(app: Hono, ctx: { db: DB; payload: () => unknown; broadcast: (m: unknown) => void }): void {
  const { db } = ctx;
  const view = () => {
    const v = emigrantsView(db);
    if (!v) return { families: [], residents: [] };
    const t = town(db).town;
    const ids = new Set([KEEPER_ID, RUNNER_ID, ...v.families.flatMap((f) => f.members)]);
    // each family's errand, for the chests on the quay (carried off by Jef: not on the quay any more)
    const jobs = db.prepare("SELECT id, status, title, employer_npc FROM job WHERE source = 'emigrant' AND day = ?").all(clock(db).day) as Array<{ id: number; status: string; title: string; employer_npc: string }>;
    const e = emigrantTown(db)!;
    return {
      ...v,
      families: v.families.map((f) => {
        const luggage = e.errands.filter((x) => x.family === f.n && x.kind === "luggage").map((x) => jobs.find((j) => j.id === x.job)?.status ?? "expired");
        return { ...f, luggage: luggage.includes("done") || luggage.includes("failed") ? "done" : luggage.includes("taken") ? "taken" : luggage.includes("offered") ? "offered" : null };
      }),
      residents: t.residents.filter((r) => ids.has(r.id)).map((r) => publicResident(db, r)),
    };
  };
  const tickAfter: MiddlewareHandler = async (_c, next) => {
    await next();
    try {
      const r = emigrantsTick(db);
      if (r.changed) {
        ctx.broadcast({ type: "emigrants", arrived: r.arrived.length, boarded: r.boarded.length });
        ctx.broadcast({ type: "jobs", ...(ctx.payload() as object) });
      }
    } catch (err) {
      console.error("[emigrants] tick", err);
    }
  };
  for (const p of ["/api/tick", "/api/sleep", "/api/new-game", "/api/dev/set"]) app.use(p, tickAfter);

  app.get("/api/emigrants", (c) => c.json(view()));

  app.post("/api/emigrants/board", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { household?: unknown };
    const r = boardByLighter(db, Number(body.household));
    if (r.ok) {
      ctx.broadcast({ type: "emigrants", boarded: 1 });
      ctx.broadcast({ type: "jobs", ...(ctx.payload() as object) });
    }
    return c.json({ ...r, view: view() }, r.ok ? 200 : 409);
  });

  if (DEV) {
    // dev only: bring the next family now, make today the waiting families' ship's day, send the
    // runner to a family now; for browser checks on a test save
    app.post("/api/dev/emigrants", async (c) => {
      const b = (await c.req.json().catch(() => ({}))) as { arrive?: boolean; ship_today?: boolean; runner?: boolean; board?: number };
      const e = emigrantTown(db);
      if (!e) return c.json({ ok: false, why: "no emigrants" });
      const cl = clock(db);
      const now = abs(cl.day, cl.hour + cl.minute / 60);
      const notes: string[] = [];
      if (b.ship_today) {
        for (const f of e.families) if (f.status === "here") f.board_day = cl.day;
        notes.push("the waiting families go out today");
      }
      if (b.runner) {
        const f = e.families.filter((x) => x.status === "here" && x.board_day !== cl.day).sort((a, z) => z.arrive - a.arrive)[0];
        if (f) {
          e.scam = { day: cl.day, family: f.n, start: now, until: now + SCAM_HOURS, state: "working" };
          e.runner_jailed = false;
          notes.push(`the runner works the ${f.surname} family`);
        }
      }
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'emigrants'").run(JSON.stringify(e));
      if (b.arrive) {
        // the next family's train comes in now: the timetable moves, nothing else
        const next = e.families.length;
        notes.push(`family ${next} arrives`);
        devEarly.add(next);
      }
      if (typeof b.board === "number") notes.push(JSON.stringify(boardByLighter(db, b.board, true)));
      emigrantsTick(db);
      ctx.broadcast({ type: "emigrants" });
      ctx.broadcast({ type: "jobs", ...(ctx.payload() as object) });
      return c.json({ ok: true, notes, view: view() });
    });
  }
}

