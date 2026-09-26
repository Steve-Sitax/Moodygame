import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { ageBand, appearanceCode, lookLine, wordsFor } from "../../../shared/character.ts";
import { checkProfile, PLAYER_ONE, profileOf, saveProfile, storedProfile } from "./profile.ts";

// M7 character: the profile over HTTP.
//   GET /api/player/profile        this player's profile (a missing one is today's Jef), its code, the look in words
//   PUT /api/player/profile        {profile} or the profile itself: checked, clamped, stored; the answer says what was put back
//   GET /api/player/:id/look       another player's look as a code and a name (multiplayer later: the client draws
//                                  other players only from this, never from its own idea of them)
// Today there is one player (id 1); the id a request speaks for will come from the session then.

function view(db: DB, id = PLAYER_ONE) {
  const p = profileOf(db, id);
  const w = wordsFor(p);
  return {
    id,
    profile: p,
    code: appearanceCode(p),
    band: ageBand(p.age),
    look: lookLine(p),
    words: { he: w.he, him: w.him, his: w.his, lad: w.lad, mister: w.mister },
    made: storedProfile(db, id) !== null,
  };
}

export function mountPlayer(app: Hono, deps: { db: DB }): void {
  const { db } = deps;
  app.get("/api/player/profile", (c) => c.json(view(db)));
  app.put("/api/player/profile", async (c) => {
    const body = (await c.req.json().catch(() => null)) as unknown;
    const raw = body && typeof body === "object" && "profile" in body ? (body as { profile: unknown }).profile : body;
    const checked = checkProfile(raw);
    if (!checked) return c.json({ error: "a profile is an object: name, sex, age, looks, clothes" }, 400);
    saveProfile(db, checked.profile);
    return c.json({ ...view(db), fixed: checked.fixed });
  });
  app.get("/api/player/:id/look", (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id !== PLAYER_ONE) return c.json({ error: "no such player" }, 404);
    const p = profileOf(db, id);
    return c.json({ id, code: appearanceCode(p), first: p.first, last: p.last });
  });
}
