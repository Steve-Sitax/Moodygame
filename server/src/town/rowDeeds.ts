import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { applyTrust, remember } from "../npcs.ts";
import { boardHired, hireBoat, leaveBoat, loseHired, notice, rowBoatStates, rowBoats, rowEffort, rowMinute, rowState, rowTick, rowWorld, saveRow, setRowBoat } from "../rowing.ts";
import { deedRow, deedTables, npcName } from "./deeds.ts";
import { policeRespond } from "./police.ts";

// The HTTP side of the rowing boats (M3j, rowing.ts), and where a boat meets the M3h theft
// system: a stolen boat wrecked is a worse deed ("boat_lost"), and a hired boat lost and not
// paid for by the next morning goes to the police ("boat_debt"). Mounted by index.ts.

export interface RowDeps {
  db: DB;
  /** The payload every call returns (money, pockets, clock). */
  payload: () => Record<string, unknown>;
  broadcast: (msg: unknown) => void;
}

/** A stolen boat broke and sank: the deed becomes "boat_lost"; the boat is gone till morning. */
export function loseStolen(db: DB, id: string): { text: string } {
  const b = rowBoats(db).find((q) => q.id === id);
  const st = rowBoatStates(db)[id];
  if (!b || !st || st.deed === null) throw new GameError("that boat is not yours to lose", 409);
  const d = deedRow(db, st.deed);
  const day = player(db).day;
  const owner = npcName(db, b.owner);
  db.transaction(() => {
    setRowBoat(db, id, { ...st, ridden: false, lostDay: day });
    const s = rowState(db);
    if (s.on === id) s.on = null;
    saveRow(db, s);
    if (d && (d.status === "open" || d.status === "returned")) {
      // worse than taking it: the police count it as such; unseen, the wreck gets talked about all the same
      db.prepare("UPDATE deed SET thing = 'boat_lost', status = 'open', rumour_at = CASE WHEN seen = 0 AND rumour_at IS NULL THEN ? ELSE rumour_at END WHERE id = ?").run(rowMinute(db) + 60, d.id);
    }
    log(db, "wrecked_boat", id, `Jef wrecked ${owner}'s boat, taken ${b.where}.`);
  })();
  if (d?.seen) {
    remember(db, b.owner, `Jef stole my boat and wrecked it. It is at the bottom of the river.`, 9, "seen", null, { gist: `Jef stole ${owner}'s boat and wrecked it`, tone: -2 });
    applyTrust(db, b.owner, -2, 0);
  } else remember(db, b.owner, "My boat was taken from the steps and wrecked on the river.", 6);
  return { text: "The boat is gone. Whose it was, you know; soon they will know about you." };
}

/**
 * A debt for a lost boat still owed after a night: the waterman goes to the police. The debt
 * becomes a deed ("boat_debt", seen by the owner); the police take it from there (M3h).
 */
export function rowDebtToPolice(db: DB): number | null {
  const s = rowState(db);
  if (!s.debt_c || s.debt_day === null || s.debt_day >= player(db).day) return null;
  const who = s.debt_to;
  const owed = s.debt_c;
  s.debt_c = 0;
  s.debt_day = null;
  s.debt_to = null;
  if (!who) {
    saveRow(db, s);
    return null;
  }
  deedTables(db);
  const p = db.prepare("SELECT day, hour, minute FROM player WHERE id = 1").get() as { day: number; hour: number; minute: number };
  let id = 0;
  db.transaction(() => {
    const r = db
      .prepare(
        `INSERT INTO deed (day, hour, minute, thing, item, ref, owner, x, z, seen, owner_saw, witnesses, item_id, status, rumour_at)
         VALUES (?, ?, ?, 'boat_debt', 'boat', ?, ?, 0, 0, 1, 1, '[]', NULL, 'open', NULL)`,
      )
      .run(p.day, p.hour, p.minute, `debt:${who}`, who);
    id = Number(r.lastInsertRowid);
    notice(s, `${npcName(db, who).split(" ")[0]} the waterman has gone to the police about the ${owed} c you owe him for his boat.`);
    saveRow(db, s);
    log(db, "boat_debt_police", who, `${npcName(db, who)} went to the police: Jef lost his boat and never paid the ${owed} centimes.`);
    remember(db, who, `Jef lost my boat and never paid me the ${owed} centimes. I went to the police.`, 7, "seen", null, { gist: "Jef lost a hired boat and never paid for it", tone: -2 });
  })();
  policeRespond(db, id);
  return id;
}

export function mountRowing(app: Hono, deps: RowDeps): void {
  const { db, payload, broadcast } = deps;
  const push = () => broadcast({ type: "jobs", ...payload() });
  const body = async (c: { req: { json(): Promise<unknown> } }) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

  // each tick, and after a night: the boy fetches a boat left out; an old debt goes to the police
  for (const path of ["/api/tick", "/api/sleep"]) {
    app.use(path, async (_c, next) => {
      await next();
      try {
        const fetched = rowTick(db);
        const police = rowDebtToPolice(db);
        if (fetched || police) push();
      } catch (e) {
        console.error("[rowing] tick", e);
      }
    });
  }

  app.get("/api/row/world", (c) => c.json(rowWorld(db)));

  app.post("/api/row/hire", async (c) => {
    const b = await body(c);
    const r = hireBoat(db, b.landing, Number(b.x), Number(b.z));
    push();
    return c.json({ ...r, row: rowWorld(db), ...payload() });
  });

  app.post("/api/row/board", async (c) => {
    const b = await body(c);
    const r = boardHired(db, Number(b.x), Number(b.z));
    return c.json({ ...r, row: rowWorld(db) });
  });

  app.post("/api/row/leave", async (c) => {
    const b = await body(c);
    const r = leaveBoat(db, Number(b.x), Number(b.z), Number(b.yaw), b.ashore !== false);
    if (r.paid_c || r.owed_c) push();
    return c.json({ ...r, row: rowWorld(db), ...payload() });
  });

  app.post("/api/row/stroke", async (c) => {
    const b = await body(c);
    return c.json({ counted: rowEffort(db, b.hard) });
  });

  /** The boat broke (a ship ran it down, a bridge came down on it). The client says so; the engine prices it. */
  app.post("/api/row/lost", async (c) => {
    const b = await body(c);
    const s = rowState(db);
    if (b.cause !== "ship" && b.cause !== "bridge") throw new GameError("cause must be ship or bridge", 400);
    let text: string;
    if (s.on === "hire" || (s.hire && !s.on)) text = loseHired(db, b.cause).text;
    else if (s.on) text = loseStolen(db, s.on).text;
    else throw new GameError("you are not in a boat", 409);
    push();
    return c.json({ text, row: rowWorld(db), ...payload() });
  });
}
