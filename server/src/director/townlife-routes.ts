import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { clock, fogDay } from "../day.ts";
import { GameError } from "../game.ts";
import { lampRounds } from "../town/lamplighters.ts";
import { joinChain, leaveChain, sootList } from "./fire.ts";
import { standForHire } from "./hiring.ts";

// M6 town life on the wire (mounted by index.ts): the lamplighters' rounds and the soot of
// burned fronts for the client to draw; Jef stepping into a bucket chain or out of it, and
// standing with the day men at a natie gate. The engine decides what each of these means.

export interface TownLifeDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

const num = (v: unknown): number => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new GameError("bad position", 400);
  return v;
};

export function mountTownLife(app: Hono, deps: TownLifeDeps): void {
  const { db, payload } = deps;

  app.get("/api/townlife", (c) => c.json({ day: clock(db).day, rounds: lampRounds(db)?.rounds ?? [], fog: fogDay(db), soot: sootList(db) }));

  app.post("/api/fire/join", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { x?: unknown; z?: unknown };
    return c.json({ result: joinChain(db, num(b.x), num(b.z)), ...payload() });
  });

  app.post("/api/fire/leave", (c) => c.json({ result: leaveChain(db), ...payload() }));

  app.post("/api/hiring/stand", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { x?: unknown; z?: unknown };
    return c.json({ result: standForHire(db, num(b.x), num(b.z)), ...payload() });
  });
}
