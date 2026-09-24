import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { talkExtras } from "../town/talk.ts";
import { LANDMARK_IDS, type LandmarkId } from "../../../shared/landmarks.ts";
import { absolve, beginConfession, confess } from "./confession.ts";
import { lightCandle, payChair } from "./deeds.ts";
import { landmarkDoors, landmarkNow, landmarkTalkContext, setJefIn } from "./life.ts";

// The HTTP side of the landmark interiors (M6), mounted by index.ts. What moves money answers
// with the game payload. The confession's words go in and the priest's answer comes out; the
// server keeps neither.

export interface LandmarkDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

export function mountLandmarks(app: Hono, deps: LandmarkDeps): void {
  const { db, payload, broadcast } = deps;
  const lm = (v: unknown): LandmarkId => {
    if (typeof v !== "string" || !LANDMARK_IDS.includes(v as LandmarkId)) throw new GameError("no such landmark", 404);
    return v as LandmarkId;
  };
  const moved = () => broadcast({ type: "jobs", ...payload() });
  // talk inside a landmark: the person knows where they stand and what they do (no edit of talk.ts)
  talkExtras.context.push((d, r) => landmarkTalkContext(d, r));

  app.get("/api/landmarks", (c) => c.json({ doors: landmarkDoors(db) }));

  app.get("/api/landmark/:id", (c) => c.json(landmarkNow(db, lm(c.req.param("id")))));

  // the client says when Jef goes in and comes out (for the talk context only)
  app.post("/api/landmark/here", async (c) => {
    const b = await body(c);
    setJefIn(b.id === null || b.id === undefined ? null : lm(b.id));
    return c.json({ ok: true });
  });

  app.post("/api/landmark/candle", (c) => {
    const r = lightCandle(db);
    moved();
    return c.json({ ...r, ...payload() });
  });

  app.post("/api/landmark/chair", (c) => {
    const r = payChair(db);
    if (r.paid_c) moved();
    return c.json({ ...r, ...payload() });
  });

  app.post("/api/landmark/confess/begin", (c) => c.json(beginConfession(db)));

  app.post("/api/landmark/confess", async (c) => {
    const b = await body(c);
    return c.json(await confess(db, typeof b.text === "string" ? b.text : ""));
  });

  app.post("/api/landmark/confess/end", (c) => c.json(absolve()));
}
