import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError } from "../game.ts";
import { clock } from "../day.ts";
import { resident, town } from "../town/store.ts";
import { admit, audience, doorOpen, POESJE, poesjeDoor, showToday, showWriting, writeShow } from "./poesje.ts";
import { hourNow, tavernPlace } from "./state.ts";
import { DICE, diceLeft, overhear, sitToDice, tavernChat, tavernNow, throwDice, tipsy, warmByFire } from "./tavern.ts";

// The HTTP side of the interiors (M6), mounted by index.ts. Everything that moves money
// or needs returns the game payload, like the other routes. The tick writes tonight's
// Poesje play in the background from five in the evening, so it is ready at seven.

export interface InteriorDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

async function body(c: { req: { json(): Promise<unknown> } }): Promise<Record<string, unknown>> {
  return ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

export function mountInteriors(app: Hono, deps: InteriorDeps): void {
  const { db, payload, broadcast } = deps;
  const place = (v: unknown): string => {
    const p = typeof v === "string" ? tavernPlace(db, v) : null;
    if (!p) throw new GameError("no such tavern", 404);
    return p;
  };
  const id = (v: unknown): string => {
    if (typeof v !== "string" || !resident(db, v)) throw new GameError("nobody by that name here", 404);
    return v;
  };
  const moneyMoved = () => broadcast({ type: "jobs", ...payload() });

  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      if (hourNow(db) >= 17 && !showToday(db) && !showWriting()) void writeShow(db).then((s) => console.log(`[poesje_show] ${s.source}: ${s.play.title}`));
    } catch (e) {
      console.error("[interiors] tick", e);
    }
  });

  // where the doors are, and what is open
  app.get("/api/interiors", (c) => {
    const t = town(db).town;
    const taverns = Object.entries(t.places)
      .filter(([k, p]) => k.startsWith("tavern:") && p.door)
      .map(([k, p]) => {
        const now = tavernNow(db, k);
        return { place: k, label: p.label, door: p.door, out: p.out ?? [0, -1], open: now.open, keeper: now.keeper };
      });
    const d = poesjeDoor(db);
    return c.json({
      taverns,
      poesje: d
        ? { label: POESJE.label, door: [d.sx, d.sz], wall: [d.x, d.z], out: d.out, open: doorOpen(db), door_opens: POESJE.doorOpens, show_from: POESJE.showFrom, show_to: POESJE.showTo, price_c: POESJE.price_c }
        : null,
      tipsy: tipsy(db),
    });
  });

  app.get("/api/interior/:place", (c) => {
    const p = place(c.req.param("place"));
    return c.json({ ...tavernNow(db, p), tipsy: tipsy(db), dice: { stakes: DICE.stakes, left: diceLeft(db) } });
  });

  app.get("/api/tipsy", (c) => c.json({ tipsy: tipsy(db), clock: clock(db) }));

  app.post("/api/interior/fire", async (c) => {
    const b = await body(c);
    const r = warmByFire(db, place(b.place));
    if (r.warmed) moneyMoved();
    return c.json({ ...r, ...payload() });
  });

  app.post("/api/interior/dice/sit", async (c) => {
    const b = await body(c);
    return c.json(sitToDice(db, place(b.place), id(b.patron)));
  });

  app.post("/api/interior/dice/throw", async (c) => {
    const b = await body(c);
    const r = throwDice(db, place(b.place), id(b.patron), Number(b.stake));
    moneyMoved();
    return c.json({ ...r, ...payload() });
  });

  app.post("/api/interior/gossip", async (c) => {
    const b = await body(c);
    return c.json(await overhear(db, place(b.place), id(b.a), id(b.b)));
  });

  app.post("/api/interior/chat", async (c) => {
    const b = await body(c);
    return c.json(await tavernChat(db, place(b.place), id(b.a), id(b.b)));
  });

  // the Poesje
  app.get("/api/poesje", (c) => {
    const s = showToday(db);
    const people = audience(db).map((rid) => {
      const r = resident(db, rid)!;
      return { id: r.id, name: r.name, first: r.first, kind: r.kind, sex: r.sex, age: r.age };
    });
    return c.json({
      open: doorOpen(db),
      price_c: POESJE.price_c,
      play: s ? { state: "ready", title: s.play.title, third: s.play.third, lines: s.play.lines, source: s.source } : { state: showWriting() ? "writing" : "none" },
      audience: people,
    });
  });

  app.post("/api/poesje/enter", async (c) => {
    const r = admit(db);
    // not written yet (the server came up late in the evening): write it now; the client waits at most 20 s
    if (!showToday(db) && !showWriting()) void writeShow(db);
    if (r.paid_c) moneyMoved();
    return c.json({ ...r, ...payload() });
  });

  app.post("/api/poesje/play", async (c) => {
    if (!doorOpen(db) && !showToday(db)) throw new GameError("no play now", 409);
    const s = await writeShow(db);
    return c.json({ state: "ready", title: s.play.title, third: s.play.third, lines: s.play.lines, source: s.source });
  });
}
