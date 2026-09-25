import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { gateMode, gateState, isPaused, onGateChange, setPaused, waitOpen, type GateState } from "./gate.ts";
import { isSlot, listSaves, loadGame, readClientState, saveGame } from "./saves.ts";

// M7 save and pause: the routes (docs/milestones/M7-save-pause.md). Mounted first in index.ts, so
// its middleware sees every request before the other parts' tick wrappers:
// - paused: a tick does nothing (the other parts' after-tick work never runs either);
// - saving or loading: a request that changes the game waits for the gate to open again (a tick
//   included), so nothing is written between the last model answer and the copy.

interface Deps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (m: unknown) => void;
  /** After a load: the board's state, a board for a day without one, the epilogue. */
  afterLoad: () => void;
}

/** Requests the gate never holds: the save and pause routes themselves, and a dev picture. */
const FREE = new Set(["/api/save", "/api/load", "/api/saves", "/api/pause", "/api/client-state", "/api/dev/shot"]);

export function mountSaves(app: Hono, d: Deps): void {
  const { db } = d;

  app.use("/api/*", async (c, next) => {
    if (c.req.method === "GET" || c.req.method === "HEAD" || FREE.has(c.req.path)) return next();
    if (c.req.path === "/api/tick" && isPaused()) return c.json({ advanced: false, paused: true, ...d.payload() });
    if (gateMode() !== "open") await waitOpen();
    if (c.req.path === "/api/tick" && isPaused()) return c.json({ advanced: false, paused: true, ...d.payload() });
    return next();
  });

  // the browser hears when the game pauses, saves or loads (a second tab, and later other players)
  let last = "";
  onGateChange((s: GateState) => {
    const key = `${s.paused}:${s.mode}:${s.mode === "open" ? 0 : s.in_flight}`;
    if (key === last) return;
    last = key;
    d.broadcast({ type: "gate", paused: s.paused, mode: s.mode, in_flight: s.in_flight });
  });

  app.get("/api/saves", (c) => {
    const saves = listSaves();
    return c.json({ saves, newest: saves[0]?.slot ?? null, gate: gateState() });
  });

  app.get("/api/client-state", (c) => c.json({ client: readClientState(db) }));

  app.get("/api/pause", (c) => c.json(gateState()));
  app.post("/api/pause", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { on?: unknown; client?: unknown };
    if (typeof b.on !== "boolean") throw new GameError("on must be true or false", 400);
    setPaused(typeof b.client === "string" ? b.client : "anon", b.on);
    return c.json(gateState());
  });

  app.post("/api/save", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { slot?: unknown; label?: unknown; client?: unknown; quiet?: unknown };
    const slot = b.slot === "auto" ? "auto" : isSlot(b.slot) ? b.slot : null;
    if (!slot) throw new GameError("no such slot", 400);
    const r = await saveGame(db, { slot, label: typeof b.label === "string" ? b.label : undefined, client: b.client, quiet: b.quiet === true });
    if (!r.ok) return c.json(r, r.deferred ? 202 : 500);
    console.log(`[save] ${r.info.slot} ${r.info.weekday} ${r.info.hour}:${String(r.info.minute).padStart(2, "0")} in ${r.ms} ms${r.drained ? "" : " (a model call ran past the wait)"}`);
    d.broadcast({ type: "jobs", ...d.payload() });
    return c.json({ ...r, saves: listSaves() });
  });

  app.post("/api/load", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { slot?: unknown };
    if (!isSlot(b.slot)) throw new GameError("no such slot", 400);
    const r = await loadGame(db, b.slot);
    if (!r.ok) return c.json({ error: r.error }, r.error === "no such save" ? 404 : 500);
    console.log(`[load] ${r.info.slot} ${r.info.weekday} ${r.info.hour}:${String(r.info.minute).padStart(2, "0")} in ${r.ms} ms`);
    d.afterLoad();
    // every tab on this server starts again from the save
    d.broadcast({ type: "loaded", slot: r.info.slot });
    return c.json({ ...r, ...d.payload() });
  });
}
