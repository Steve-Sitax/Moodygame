import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { GameError } from "../game.ts";
import { isResident, resident } from "../town/store.ts";
import { actionsTick, clearActions, installTalkHooks, listActions, reportAction, syncFromClient } from "./actions.ts";
import { bus } from "./bus.ts";
import { recentConvos } from "./convo.ts";
import { clearDirector, directorTick, think } from "./director.ts";
import { writeEvent } from "./eventlog.ts";
import { clearEvents, eventsTick, listEvents, planEvent } from "./scheduler.ts";
import { closedPlaces } from "./state.ts";
import { planFromTemplate, templateById, TEMPLATES } from "./templates.ts";

// The HTTP side of M4 (mounted by index.ts, before the deeds so the talk
// middleware runs first): the actions the client walks and reports, the events
// it plays, the conversations it shows; the ticks in /api/tick; a new game
// clears it all; the dev route for the director.

export interface DirectorDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

export function mountDirector(app: Hono, deps: DirectorDeps): void {
  const { db, payload, broadcast } = deps;
  bus.broadcast = (m) => {
    broadcast(m);
    // money or the board may have moved (restitution, an event's job, the weather)
    const t = (m as { type?: string; jobs?: boolean }).type;
    if (t === "convo" || (m as { jobs?: boolean }).jobs) broadcast({ type: "jobs", ...payload() });
  };
  installTalkHooks();

  app.use("/api/new-game", async (_c, next) => {
    clearActions(db);
    clearEvents(db);
    clearDirector(db);
    await next();
  });

  // each tick: actions run out, events move on, the director thinks (async)
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      actionsTick(db);
      eventsTick(db);
      directorTick(db);
    } catch (e) {
      console.error("[director] tick", e);
    }
  });

  // "Jef talked with X": once per meeting, the words never
  const talked = new Map<string, number>();
  app.use("/api/npc/:id/talk", async (c, next) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string };
    if (!body.kind || body.kind === "open") {
      const last = talked.get(id) ?? 0;
      if (Date.now() - last > 90_000 && isResident(db, id)) {
        const r = resident(db, id)!;
        writeEvent(db, { kind: "talk", verb: "talked", actor: "player", target: id, text: `Jef stopped ${r.name} for a talk.`, weight: 2, who: [id] });
      }
      talked.set(id, Date.now());
    }
    await next();
  });

  app.get("/api/actions", (c) => c.json({ actions: listActions(db), convos: recentConvos(), events: listEvents(db), closed: closedPlaces(db) }));

  app.post("/api/actions/sync", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    return c.json(syncFromClient(body));
  });

  app.post("/api/actions/:id/report", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { phase?: unknown; x?: unknown; z?: unknown; found?: unknown; why?: unknown };
    const phase = body.phase;
    if (phase !== "arrived" && phase !== "lost" && phase !== "blocked" && phase !== "done") throw new GameError("bad phase", 400);
    const row = await reportAction(db, id, {
      phase,
      x: typeof body.x === "number" ? body.x : undefined,
      z: typeof body.z === "number" ? body.z : undefined,
      found: body.found === true,
      why: typeof body.why === "string" ? body.why.slice(0, 20) : undefined,
    });
    if (!row) throw new GameError("no such action", 404);
    return c.json({ action: row, ...payload() });
  });

  app.get("/api/events", (c) => c.json({ events: listEvents(db), closed: closedPlaces(db) }));

  if (DEV) {
    app.post("/api/dev/director", async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { think?: boolean; template?: string };
      if (body.think) {
        const r = await think(db, undefined, true);
        return c.json({ ...r, planned: r.planned && r.planned.ok ? { ok: true, id: r.planned.event.id, title: r.planned.event.title } : r.planned });
      }
      if (body.template) {
        const t = templateById(body.template);
        if (!t) throw new GameError(`no template ${body.template}; have ${TEMPLATES.map((x) => x.id).join(", ")}`, 404);
        const planned = planEvent(db, planFromTemplate(t, "engine", { start_in_min: 1, why: "dev button" }), { dev: true });
        if (!planned.ok) return c.json(planned);
        const first = (JSON.parse(planned.event.stages_json) as Array<{ label?: string }>)[0];
        return c.json({ ok: true, id: planned.event.id, title: planned.event.title, where: first?.label ?? planned.event.place });
      }
      return c.json({ templates: TEMPLATES.map((t) => t.id) });
    });
  }
}
