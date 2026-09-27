import type { DB } from "../db.ts";
import { actionOf, peopleNear, playersAt, posOf } from "../director/actions.ts";
import { activeRoutines, endRoutine, routineOwner, startRoutine, stepHooks, type Routine } from "../director/steps.ts";
import { asPlayer } from "../player/current.ts";
import { gameMinute } from "../town/deeds.ts";
import { resident, town } from "../town/store.ts";
import { atWork } from "../trade.ts";
import { walkMap } from "../town/walkmap.ts";
import { goods, goodsHooks } from "./store.ts";

// M8f: the townspeople's own work with the goods, proven by one use: goods that belong to someone (a natie's crates,
// the widow's barrels, Tuur's casks, Fientje's baskets) left lying off their place for a while are carried back by a
// working man of the quay. The server starts a routine (the M6 step executor): pick the item up, carry it home. The
// PC that walks him (the routine's player: the one nearest the goods, pinned to his PC as a hired hand is) walks it
// and reports the lift and the put down (routes.ts npc_lift, npc_put); every PC draws the crate in his arms. If
// nobody walks him in time, the server puts it back itself when the routine's time is up.

/** Off its place this long (game minutes) before someone comes for it. */
export const BACK_AFTER_MIN = 20;
/** The routine's time (game minutes). */
const BACK_MIN = 45;
/** The trades that carry goods on the quays. */
const HANDS = new Set(["docker", "natie", "porter", "carter"]);
/** A hand is looked for within this of the goods (m): the client's view of the street, else the schedule. */
const LOOK_M = 120;

const gidOf = (r: Routine): string | null => (typeof r.state.gid === "string" ? r.state.gid : null);

export function installCarryBack(): void {
  // the errand's own checks: the goods still lie there, not in someone's hands; then he has them
  stepHooks.check.goods_back = (_db, r, s) => {
    const gid = gidOf(r);
    const it = gid ? goods.get(gid) : null;
    if (!it) return "none_left";
    if (s.kind === "pick_up") return it.by ? (JSON.stringify(it.by) === JSON.stringify({ npc: (r.state.npc as string) ?? "" }) ? null : "none_left") : null;
    if (s.kind === "carry") return it.by && "npc" in it.by ? null : "empty_hands";
    return undefined;
  };
  stepHooks.after.goods_back = (db, row, _r, res) => {
    if (!res.ok) {
      endRoutine(db, row.id, "failed", res.why, "");
      return "end";
    }
  };
  stepHooks.ended.goods_back = (db, row, r, status) => {
    // not done: what he holds goes where it belongs (the server's own move); what still lies stays
    const gid = gidOf(r);
    const it = gid ? goods.get(gid) : null;
    if (status !== "done" && it?.by && "npc" in it.by && it.by.npc === row.npc_id && it.home) goods.moveGoods({ npc: row.npc_id }, it.id, it.home[0], it.home[1], db);
    return "";
  };
  stepHooks.timeUp.goods_back = (db, row, r) => {
    // nobody walked him there in time: the server carries it back itself (out of everyone's sight)
    const gid = gidOf(r);
    const it = gid ? goods.get(gid) : null;
    if (it?.home && (!it.by || ("npc" in it.by && it.by.npc === row.npc_id))) goods.moveGoods({ npc: row.npc_id }, it.id, it.home[0], it.home[1], db);
    endRoutine(db, row.id, "done", "time", "");
    return true;
  };
  // the store asks: whose errand is he on, may he lift this, which item is he carrying back
  const prevOwner = goodsHooks.errandOwner;
  goodsHooks.errandOwner = (db, npc) => {
    const x = activeRoutines(db).find((q) => q.row.npc_id === npc);
    return x ? routineOwner(x.row, x.r) : prevOwner(db, npc);
  };
  const prevMay = goodsHooks.npcMay;
  goodsHooks.npcMay = (db, npc, it) => {
    const x = activeRoutines(db).find((q) => q.row.npc_id === npc);
    if (!x) return prevMay(db, npc, it);
    if (x.r.purpose === "goods_back") return gidOf(x.r) === it.id;
    // a hired hand: his hirer's job's goods only
    if (it.job === null) return false;
    const holder = goodsHolder(db, it.job);
    return holder !== null && holder === routineOwner(x.row, x.r);
  };
  goodsHooks.goodsBack = (db, npc) => {
    const x = activeRoutines(db, "goods_back").find((q) => q.row.npc_id === npc);
    return x ? gidOf(x.r) : null;
  };
}

function goodsHolder(db: DB, job: number): number | null {
  const j = db.prepare("SELECT status, taken_by FROM job WHERE id = ?").get(job) as { status: string; taken_by: number | null } | undefined;
  return j && j.status === "taken" ? (j.taken_by ?? 1) : null;
}

/**
 * Each tick: an owned item off its place for BACK_AFTER_MIN game minutes, with nothing on it, and no one already on
 * the way for it, gets a working man of the quay (at work, free, nearest) to carry it back. One at a time.
 */
export function carryBackTick(db: DB, now = Date.now()): string | null {
  const minute = gameMinute(db);
  const off = goods.offHome(minute);
  // an errand whose goods are home again (put back by a player, a new week) or in a player's hands: over
  for (const { row, r } of activeRoutines(db, "goods_back")) {
    const it = gidOf(r) ? goods.get(gidOf(r)!) : null;
    const his = !!it?.by && "npc" in it.by && it.by.npc === row.npc_id;
    const home = !!it?.home && !it.by && Math.hypot(it.x - it.home[0], it.z - it.home[1]) < 0.5;
    if (!it || home || (it.by && !his)) endRoutine(db, row.id, home ? "done" : "failed", home ? "home already" : "taken", "");
  }
  if (activeRoutines(db, "goods_back").length) return null;
  const due = off.filter((o) => minute - o.since >= BACK_AFTER_MIN && !goods.list().some((q) => !q.by && q.on.includes(o.it.id)));
  if (!due.length) return null;
  const { it } = due[0];
  const npc = pickHand(db, it.x, it.z, now);
  if (!npc || !it.home) return null;
  return startBack(db, npc, it.id);
}

/** Start the errand: `npc` carries item `gid` back. Its player: the nearest in the game to the goods (alone: 1). */
export function startBack(db: DB, npc: string, gid: string): string | null {
  const it = goods.get(gid);
  if (!it?.home || it.by) return null;
  const home = walkMap().nearestOpen(it.home[0], it.home[1], 3) ?? { x: it.home[0], z: it.home[1] };
  const near = playersAt()
    .map((p) => ({ id: p.id, d: Math.hypot(p.x - it.x, p.z - it.z) }))
    .sort((a, b) => a.d - b.d)[0];
  const player = near?.id ?? 1;
  const r = resident(db, npc);
  const what = it.kind === "barrels" ? "barrel" : it.kind === "sacks" ? "sack" : it.kind === "crates" ? "crate" : "load";
  asPlayer(player, () =>
    startRoutine(db, {
      npc,
      purpose: "goods_back",
      steps: [
        { kind: "pick_up", x: it.x, z: it.z, why: `the ${what} left lying`, gid } as never,
        { kind: "carry", x: home.x, z: home.z, label: "where it belongs", gid } as never,
      ],
      minutes: BACK_MIN,
      reason: `carries a ${what} back where it belongs`,
      state: { gid, npc, player, strong: true },
      target: "goods_back",
    }),
  );
  console.log(`[goods] ${r?.name ?? npc} carries ${gid} back (for player ${player})`);
  return npc;
}

/** A working man of the quay near (x, z): at work, free, nearest by the street's word (else his schedule). */
export function pickHand(db: DB, x: number, z: number, now = Date.now()): string | null {
  const seen = new Map(peopleNear(x, z, LOOK_M, now).map((p) => [p.id, p.d]));
  let best: { id: string; d: number } | null = null;
  for (const r of town(db).town.residents) {
    if (!HANDS.has(r.trade) || r.age < 16 || r.age > 60) continue;
    if (actionOf(db, r.id) || !atWork(db, r.id)) continue;
    const at = posOf(db, r.id, now);
    const d = seen.get(r.id) ?? (at && !at.indoors ? Math.hypot(at.x - x, at.z - z) : Infinity);
    if (d > LOOK_M) continue;
    if (!best || d < best.d) best = { id: r.id, d };
  }
  return best?.id ?? null;
}
