import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { forEachOnline } from "../player/current.ts";
import type { Ending } from "../day.ts";
import { GameError } from "../game.ts";
import { plainEnglish } from "../text.ts";
import { clearDeeds, deedRow, deedRumours, deedWorld, leaveVelo, returnThing, takeThing } from "./deeds.ts";
import { deedSettled, isPoliceTalk, policeEvents, policeAnswer, policeArrived, policeFled, policeOpen, policeTick, policeView, policeRespond, resetPolice, takeCellNight, cellNightView } from "./police.ts";
import { isResident } from "./store.ts";

// The HTTP side of theft and the police (M3h). Mounted by index.ts before the
// talk route, so a police agent who has come for Jef answers through the same
// /api/npc/:id/talk the talk window already uses (the same gate and budget).

export interface DeedDeps {
  db: DB;
  /** The payload every call returns (money, pockets, clock). */
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
  /** A night has passed (the cell): a new board, or the epilogue. */
  afterNight: (ended?: Ending) => void;
}

export function mountDeeds(app: Hono, deps: DeedDeps): void {
  const { db, payload, broadcast, afterNight } = deps;
  const push = () => broadcast({ type: "jobs", ...payload() });

  // a new game: no deeds, no police record
  app.use("/api/new-game", async (_c, next) => {
    clearDeeds(db);
    resetPolice(db);
    await next();
  });
  // each tick: unseen deeds that start to be talked about, the police on their way
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      deedRumours(db);
      // (M8c: the police come for each player in the game who is wanted)
      forEachOnline(() => policeTick(db));
    } catch (e) {
      console.error("[deeds] tick", e);
    }
  });

  app.get("/api/deeds/world", (c) => c.json(deedWorld(db)));

  app.post("/api/deed", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const r = takeThing(db, body);
    if (r.police && r.deed !== null) policeRespond(db, r.deed);
    push();
    return c.json({ ...r, ...payload() });
  });

  app.post("/api/deed/:id/return", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { how?: string };
    const id = Number(c.req.param("id"));
    const d = deedRow(db, id);
    const r = returnThing(db, id, body.how === "caught" ? "caught" : "gave");
    if (d) deedSettled(db, id, d.thing);
    push();
    return c.json({ ...r, ...payload() });
  });

  app.post("/api/velo/:id/leave", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { x?: number; z?: number; yaw?: number; down?: boolean };
    const s = leaveVelo(db, `velo:${c.req.param("id")}`, Number(b.x), Number(b.z), Number(b.yaw), b.down === true);
    return c.json(s);
  });

  app.get("/api/police", (c) => c.json(policeView(db)));
  /** The deeds and police steps from the log, after an id (for other layers, M4). */
  app.get("/api/police/events", (c) => c.json(policeEvents(db, Number(c.req.query("since")) || 0)));

  app.post("/api/police/arrived", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { agent?: string };
    policeArrived(db, String(b.agent));
    return c.json(policeView(db));
  });

  app.post("/api/police/fled", (c) => {
    const r = policeFled(db);
    return c.json({ ...r, ...policeView(db) });
  });

  app.post("/api/police/cell/done", (c) => {
    takeCellNight(db);
    return c.json({ ok: true });
  });
  /** The night in the cell, for the sheet (again after a reload, until "done"). */
  app.post("/api/police/cell", (c) => {
    const n = cellNightView(db);
    if (!n) throw new GameError("no night to show", 409);
    return c.json({ night: n, ...payload() });
  });

  // the agent who came for Jef talks through the ordinary talk route
  app.post("/api/npc/:id/talk", async (c, next) => {
    const id = c.req.param("id");
    if (!isResident(db, id) || !isPoliceTalk(db, id)) return next();
    const body = (await c.req.json().catch(() => ({}))) as { kind?: string; text?: unknown };
    if ((body.kind === "choice" || body.kind === "free") && typeof body.text === "string") {
      const r = await policeAnswer(db, id, body.kind, body.text);
      if (r.verdict) {
        // M7 night: held till dawn; a new board if the date turned (or the week ended) in the cell
        if (r.night && (r.night.turned || r.night.ended)) afterNight(r.night.ended);
        push();
      }
      if (!r.npc_line) return c.json({ gated: r.gated });
      // M6: note: how his story went down, in words (story.ts); never a number
      return c.json({ npc_line: plainEnglish(r.npc_line), mood: r.mood, choices: r.choices, end: r.end, gated: r.gated, police: r.verdict ?? null, ...(r.note ? { note: r.note } : {}) });
    }
    const l = policeOpen(db, id);
    return c.json(l);
  });
}
