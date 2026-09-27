import type { Hono } from "hono";
import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { applyTrust, remember } from "../npcs.ts";
import { pid } from "../player/current.ts";
import { pstate, setPstate } from "../player/multi.ts";
import { atMooring, boardHired, hireBoat, leaveBoat, loseHired, missedBy, notice, rowBoatStates, rowBoats, rowEffort, rowHooks, rowMinute, rowState, rowTick, rowWorld, saveRow, setMissed, setRowBoat } from "../rowing.ts";
import { BOAT_GRACE_MIN, deedRow, deedTables, gameMinute, npcName } from "./deeds.ts";
import { deedSettled, policeRespond, policeState } from "./police.ts";
import { HULLS } from "../../../shared/smallBoats.ts";

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
  // M7 boats: an old boat nobody owns goes to the bottom, and nobody asks after her (a new one lies there by morning)
  if (b && st && !b.owner) {
    setRowBoat(db, id, { ...st, ridden: false, lostDay: player(db).day });
    const s = rowState(db);
    if (s.on === id) s.on = null;
    saveRow(db, s);
    log(db, "wrecked_boat", id, `The old boat nobody owned, ${b.where}, went to the bottom under Jef.`);
    return { text: "The old boat is gone to the bottom. Nobody will ask after her." };
  }
  if (!b || !b.owner || !st || st.deed === null) throw new GameError("that boat is not yours to lose", 409);
  const bo = b.owner;
  const d = deedRow(db, st.deed);
  const day = player(db).day;
  const owner = npcName(db, bo);
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
    remember(db, bo, `Jef stole my boat and wrecked it. It is at the bottom of the river.`, 9, "seen", null, { gist: `Jef stole ${owner}'s boat and wrecked it`, tone: -2 });
    applyTrust(db, bo, -2, 0);
  } else remember(db, bo, "My boat was taken from the steps and wrecked on the river.", 6);
  return { text: "The boat is gone. Whose it was, you know; soon they will know about you." };
}

// ------------------------------------------------------------------ M7 boats: brought back, missed, the police

// (M8c: the owners who asked for a boat back, and the day's trust given back, are each player's own: pstate)
function asked(db: DB): Record<string, number> {
  try {
    return pstate<Record<string, number>>(db, "boat_asked") ?? {};
  } catch {
    return {};
  }
}
function setAsked(db: DB, v: Record<string, number>): void {
  setPstate(db, "boat_asked", v);
}

/** A day's trust given back for a boat brought home, at most once a game day per owner (no trust farm). */
function trustBack(db: DB, owner: string): boolean {
  const day = Math.floor(gameMinute(db) / 1440) + 1;
  const ledger = pstate<Record<string, number>>(db, "boat_home_trust") ?? {};
  if (ledger[owner] === day) return false;
  ledger[owner] = day;
  setPstate(db, "boat_home_trust", ledger);
  return true;
}

/**
 * Jef tied a boat he took up again at her own mooring (rowing.ts leaveBoat). That calms things: the
 * deed is settled (the police let a boat that is back be, if they have not come yet), an owner who saw
 * her go remembers she came back and gives a little trust back (once a day), one who found her gone
 * finds her back. Returns the words for the player.
 */
export function boatHome(db: DB, id: string): string {
  const b = rowBoats(db).find((q) => q.id === id);
  const st = rowBoatStates(db)[id];
  if (!b) return "";
  const noun = HULLS[b.kind].noun;
  setMissed(db, id, null);
  if (!b.owner || !st || st.deed === null) return `You tie the ${noun === "rowing boat" ? "boat" : noun} up again where she lay.`;
  const d = deedRow(db, st.deed);
  const owner = b.owner;
  const name = npcName(db, owner);
  const first = name.replace(/^(Widow|Agent|Pastoor|Meneer) /, "").split(" ")[0];
  if (!d || d.status !== "open") return `You tie the ${noun} up again where she lay.`;
  db.transaction(() => {
    db.prepare("UPDATE deed SET status = 'returned', rumour_at = NULL WHERE id = ?").run(d.id);
    const a = asked(db);
    delete a[String(d.id)];
    setAsked(db, a);
    log(db, "gave_back", id, `Jef brought ${name}'s ${noun} back to where she lay, ${b.where}.`);
    if (d.seen) {
      remember(db, owner, `Jef brought my ${noun} back and tied her up where she belongs. Still, he took her.`, 4, "seen", null, {
        gist: `Jef took ${name}'s ${noun} and brought her back`,
        tone: -1,
      });
      if (trustBack(db, owner)) applyTrust(db, owner, 1, 0);
    } else if (missedBy(db, id)) {
      remember(db, owner, `My ${noun} is back at her mooring. Somebody had borrowed her.`, 3);
    }
  })();
  // a boat that is back is no matter for the police, if they are not at Jef already
  if (policeState(db).visit?.deeds.includes(d.id)) deedSettled(db, d.id, "food"); // settled like a small thing: off the visit
  return d.seen ? `You tie ${first}'s ${noun} up again where she lay. That will calm ${first} down, a little.` : `You tie the ${noun} up again where she lay. Nobody need ever know.`;
}
rowHooks.home = boatHome;

/** How long before an owner who did not see it finds his boat gone (game minutes). */
export const BOAT_MISS_MIN = 45;

/**
 * Every tick, for each player (M7 boats; M8c: his boats and deeds): an owner finds his boat gone from her mooring once it has been away a while
 * (he grumbles: a memory, no name to it; the client shows him at the quay looking for her), and an
 * owner who asked for his boat back and did not get her goes to the police.
 */
export function boatTick(db: DB): boolean {
  let changed = false;
  const now = gameMinute(db);
  const states = rowBoatStates(db);
  for (const b of rowBoats(db)) {
    const st = states[b.id];
    if (!b.owner || !st || st.deed === null || st.lostDay !== undefined || missedBy(db, b.id)) continue;
    if (!st.ridden && atMooring(b, st.x, st.z)) continue;
    const d = deedRow(db, st.deed);
    if (!d || d.status !== "open" || d.seen) continue;
    const at = (d.day - 1) * 1440 + d.hour * 60 + d.minute;
    if (now - at < BOAT_MISS_MIN) continue;
    const noun = HULLS[b.kind].noun;
    setMissed(db, b.id, now);
    remember(db, b.owner, `My ${noun} was gone from her mooring ${b.where}. Somebody took her, and I had to do without.`, 4);
    log(db, "missed_boat", b.id, `${npcName(db, b.owner)} found the ${noun} gone ${b.where}.`);
    changed = true;
  }
  const a = asked(db);
  const had = Object.keys(a).length;
  for (const [k, since] of Object.entries(a)) {
    if (now - since < BOAT_GRACE_MIN) continue;
    delete a[k];
    const d = deedRow(db, Number(k));
    if (!d || d.status !== "open" || (d.player_id ?? 1) !== pid()) continue;
    const b = rowBoats(db).find((q) => q.id === d.ref);
    remember(db, d.owner, `Jef took my ${b ? HULLS[b.kind].noun : "boat"} and did not bring her back when I asked. I went to the police.`, 6, "seen", null, { gist: "Jef took a boat and would not bring it back", tone: -2 });
    log(db, "police_called_boat", d.ref, `${npcName(db, d.owner)} went to the police about the boat Jef took.`);
    policeRespond(db, d.id);
    changed = true;
  }
  // (nothing asked: nothing written, so the host's older key is read as it was)
  if (had) setAsked(db, a);
  return changed;
}

/**
 * A debt for a lost boat still owed after a night (each player's own; the tick runs it per player): the waterman goes to the police. The debt
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
        `INSERT INTO deed (day, hour, minute, thing, item, ref, owner, x, z, seen, owner_saw, witnesses, item_id, status, rumour_at, player_id)
         VALUES (?, ?, ?, 'boat_debt', 'boat', ?, ?, 0, 0, 1, 1, '[]', NULL, 'open', NULL, ?)`,
      )
      .run(p.day, p.hour, p.minute, `debt:${who}`, who, pid());
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
        const boats = boatTick(db);
        if (fetched || police || boats) push();
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
