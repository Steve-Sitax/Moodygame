import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { DEV } from "../config.ts";
import { clock } from "../day.ts";
import { GameError } from "../game.ts";
import { pid } from "../player/current.ts";
import { hourNow } from "../interiors/state.ts";
import { TAVERN_GUESTS } from "../interiors/tavern.ts";
import { isSunday } from "../../../shared/landmarks.ts";
import { resolvePlace } from "../director/scheduler.ts";
import { balladSinger, balladTick, balladToday, balladWriting, buySheet, CORNERS, planBallad, SHEET_C, sheetView, singingNow, tavernSinger, writeBallad } from "./ballad.ts";
import { hearSermon, logSermon, sermonOf, sermonView, sermonWriting, writeSermon } from "./sermon.ts";

// The HTTP side of the ballad singer and the Sunday sermon (M6), mounted by index.ts. The tick
// plans the singer's corners, writes the day's ballad from seven in the morning and the
// sermon from six on Sunday, both in the background, and logs the sermon after high mass.

export interface BalladDeps {
  db: DB;
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

export function mountBallads(app: Hono, deps: BalladDeps): void {
  const { db, payload, broadcast } = deps;
  const moved = () => broadcast({ type: "jobs", ...payload() });
  // the singer in the evening's tavern, standing to sing (interiors/tavern.ts asks)
  TAVERN_GUESTS.push((d, place) => {
    const s = tavernSinger(d, place);
    return s ? [{ r: s, stand: true, role: "ballad_singer" }] : [];
  });

  app.use("/api/tick", async (_c, next) => {
    await next();
    try {
      const h = hourNow(db);
      const day = clock(db).day;
      if (h >= 7 && !balladToday(db) && !balladWriting()) void writeBallad(db).then((b) => console.log(`[ballad] ${b.source}: ${b.text.title}`)).catch((e) => console.warn("[ballad]", e));
      balladTick(db);
      if (isSunday(day) && h >= 6 && h < 11 && !sermonOf(db, day) && !sermonWriting()) void writeSermon(db).then((s) => s && console.log(`[sermon] ${s.source}: ${s.lines.length} lines`)).catch((e) => console.warn("[sermon]", e));
      logSermon(db);
    } catch (e) {
      console.error("[ballads] tick", e);
    }
  });

  const now = () => {
    const b = balladToday(db);
    const s = balladSinger(db);
    const day = clock(db).day;
    return {
      day,
      price_c: SHEET_C,
      ballad: b ? { title: b.text.title, verses: b.text.verses, chorus: b.text.chorus, source: b.source } : null,
      writing: balladWriting(),
      singer: s ? { id: s.id, name: s.name, first: s.first, sex: s.sex, age: s.age, kind: s.kind } : null,
      singing: singingNow(db),
      have_sheet: !!db.prepare("SELECT 1 FROM item WHERE kind = 'ballad' AND ref = ? AND player_id = ?").get(day, pid()),
      // where he may stand (for the path check)
      corners: CORNERS.map((id) => resolvePlace(db, id)).filter((p) => !!p).map((p) => ({ id: p!.id, label: p!.label, x: p!.x, z: p!.z })),
    };
  };

  app.get("/api/ballad", (c) => c.json(now()));

  // not written yet (the server came up late): write it now; the model has its 20 s, then the engine's
  app.post("/api/ballad/today", async (c) => {
    await writeBallad(db);
    return c.json(now());
  });

  app.post("/api/ballad/buy", (c) => {
    const r = buySheet(db);
    moved();
    return c.json({ ...r, ...payload() });
  });

  app.get("/api/ballad/sheet/:day", (c) => c.json(sheetView(db, Number(c.req.param("day")))));

  // the sermon: on Sunday only; waits for the words (the model's 20 s at most, then the engine's)
  app.get("/api/sermon", async (c) => {
    const s = await writeSermon(db);
    if (!s) throw new GameError("no sermon today", 404);
    return c.json(sermonView(db, s));
  });

  app.post("/api/sermon/heard", (c) => {
    const r = hearSermon(db);
    if (r.delta) moved();
    return c.json({ ...r, ...payload() });
  });

  if (DEV) {
    // dev: the singer at a corner now (the next free one), without waiting for his hour
    app.post("/api/dev/ballad", async (c) => {
      const b = ((await c.req.json().catch(() => ({}))) ?? {}) as { corner?: string };
      await writeBallad(db);
      const r = planBallad(db, b.corner, 1, true);
      return c.json(r.ok ? { ok: true, event: r.event.id, place: r.event.place } : { ok: false, why: r.why });
    });
  }
}
