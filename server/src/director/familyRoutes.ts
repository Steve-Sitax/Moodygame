import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { GameError, player } from "../game.ts";
import { remember } from "../npcs.ts";
import { resident, town } from "../town/store.ts";
import { STRANGER_KINDS, type StrangerKind } from "../town/visitors.ts";
import { activeActions, jefAt } from "./actions.ts";
import {
  clearFamilies,
  familyTickAsync,
  installFamilies,
  listNews,
  menaceNow,
  visitNow,
  resolveMenace,
  shareNews,
  startReaction,
  startSeek,
  talkDown,
  type MenaceHow,
  type VisitKind,
} from "./families.ts";
import { arriveStranger, clearSurprises, dreamOf, installSurprises, keepPromise, planSchemes, promiseOf, surprisesState, surprisesTickAsync, tellFortune, twistRumours } from "./surprises.ts";

// The HTTP side of M6 families and surprises (mounted by index.ts after the director, so the
// push channel is wired): the ticks, the menace's answers (ran, pay, stand, own words), the
// client's state (the fortune teller's table, the strangers, the last dream), the dream when a
// night has passed, and dev buttons for the browser checks.

export interface FamilyDeps {
  db: DB;
  payload: () => Record<string, unknown>;
}

export function mountFamilies(app: Hono, deps: FamilyDeps): void {
  const { db, payload } = deps;
  installFamilies();
  installSurprises();

  app.use("/api/new-game", async (_c, next) => {
    clearFamilies(db);
    clearSurprises(db);
    await next();
  });

  // each tick: news told at home, reactions set out, schemes, strangers, the promise
  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      familyTickAsync(db);
      surprisesTickAsync(db);
    } catch (e) {
      console.error("[families] tick", e);
    }
  });

  // a night passed (the doss house, a home, the cell, a tick past midnight): the dream, async
  app.use("/api/*", async (c, next) => {
    if (c.req.method !== "POST") return next();
    const before = player(db).day;
    await next();
    const after = player(db).day;
    if (after > before) void dreamOf(db).catch((e) => console.error("[dream]", e));
  });

  app.get("/api/families/state", (c) => c.json({ ...surprisesState(db), menace: menaceNow(db), visit: visitNow(db) }));

  app.post("/api/families/menace/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { how?: unknown };
    const how = body.how;
    if (how !== "ran" && how !== "pay" && how !== "stand") throw new GameError("how must be ran, pay or stand", 400);
    const r = resolveMenace(db, id, how as MenaceHow);
    return c.json({ result: r, ...payload() });
  });

  app.post("/api/families/menace/:id/talk", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { text?: unknown };
    if (typeof body.text !== "string") throw new GameError("text wanted", 400);
    const r = await talkDown(db, id, body.text);
    return c.json({ ...r, ...payload() });
  });

  if (DEV) {
    // Dev: make it happen now, for a browser check on a test save
    app.post("/api/dev/families", async (c) => {
      const b = (await c.req.json().catch(() => ({}))) as { do?: string; id?: string; reaction?: string; kind?: string; news?: number };
      const jef = jefAt();
      const nearest = (pred: (id: string) => boolean) => {
        const all = town(db).town.residents.filter((r) => pred(r.id));
        if (!jef) return all[0] ?? null;
        return all.sort((x, y) => Math.hypot(x.home.sx - jef.x, x.home.sz - jef.z) - Math.hypot(y.home.sx - jef.x, y.home.sz - jef.z))[0] ?? null;
      };
      switch (b.do) {
        case "visit": {
          // a household member comes at once with the reaction asked (the engine's checks on the news are skipped)
          const r = b.id ? resident(db, b.id) : nearest((id) => !activeActions(db).some((a) => a.npc_id === id) && (resident(db, id)?.age ?? 0) >= 18 && resident(db, id)?.sex === "m");
          if (!r) throw new GameError("nobody", 404);
          const row = startSeek(db, r.id, (b.reaction ?? "talk_angry") as VisitKind, { reason: "dev", news: typeof b.news === "number" ? b.news : undefined });
          return c.json({ ok: true, action: row.id, who: r.name });
        }
        case "share": {
          const n = listNews(db, "waiting")[0];
          if (!n) return c.json({ ok: false, why: "no news waiting" });
          const r = await shareNews(db, n.id, { show: true });
          return c.json({ ok: true, r });
        }
        case "react": {
          const out = listNews(db, "pending").map((n) => ({ id: n.id, started: startReaction(db, n.id) }));
          return c.json({ ok: true, out });
        }
        case "news":
          return c.json({ news: listNews(db) });
        case "stranger": {
          const s = await arriveStranger(db, { kind: STRANGER_KINDS.includes(b.kind as StrangerKind) ? (b.kind as StrangerKind) : undefined });
          return c.json({ ok: !!s, stranger: s ? { id: s.id, name: s.name, story: s.visitor?.story, goal: s.visitor?.goal } : null });
        }
        case "fortune":
          return c.json(await tellFortune(db));
        case "promise":
          return c.json({ promise: promiseOf(db), kept: await keepPromise(db, { force: true }) });
        case "schemes":
          return c.json({ schemes: planSchemes(db) });
        case "twist":
          return c.json({ twisted: await twistRumours(db, undefined, true) });
        case "dream":
          return c.json(await dreamOf(db));
        case "remember": {
          // a notable meeting for the check: `id` saw Jef be rude (or kind with kind=good)
          const r = b.id ? resident(db, b.id) : null;
          if (!r) throw new GameError("id wanted", 400);
          const good = b.kind === "good";
          remember(db, r.id, good ? "Jef helped me with my basket when I dropped it." : "Jef was rude to me, called me an old cow at my own door.", 7, "seen", null, {
            gist: good ? `Jef helped ${r.name} with a dropped basket` : `Jef was rude to ${r.name} at her own door`.replace(" her ", r.sex === "m" ? " his " : " her "),
            tone: good ? 2 : -2,
          });
          return c.json({ ok: true });
        }
        default:
          return c.json({ ok: false, why: "do: visit, share, react, news, stranger, fortune, promise, schemes, twist, dream, remember" });
      }
    });
  }
}
