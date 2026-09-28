import type { DB } from "../db.ts";
import { HAUL_ROUTES, haulRouteOf, type HaulRoute } from "../../../shared/hauls.ts";
import { playersAt } from "../director/actions.ts";
import { resident } from "../town/store.ts";
import { goods, goodsHooks } from "./store.ts";

// The dockers' piles for real (D1 docks, Steve 2026-09-28: "if cranes are unloading grain or other stuff it also goes to
// stacks"): a docker lifts the top load of his route's own pile (npc_lift), carries it and sets it down at the other end
// (haul_in: in at the door, onto the drop pile); a crane refills the piles it reaches from the ships (crane_put); at dawn
// every pile is whole again (the night's lighters). docs/milestones/D1-docks.md.

/** The route of a haul worker of the town (by his work's ends), or null. */
export function haulRouteFor(db: DB, npc: string): HaulRoute | null {
  const w = resident(db, npc)?.work;
  if (!w || w.kind !== "haul" || !w.a || !w.b) return null;
  return haulRouteOf(w.a, w.b);
}

/** Wire the hooks: a docker may lift his own route's pile; the store asks whose route a townsperson works. */
export function installHaulFlow(): void {
  const prevMay = goodsHooks.npcMay;
  goodsHooks.npcMay = (db, npc, it) => {
    const r = haulRouteFor(db, npc);
    if (r && it.id.startsWith(`haul:${r.id}a:`)) return true;
    return prevMay(db, npc, it);
  };
  goodsHooks.haulRoute = (db, npc) => haulRouteFor(db, npc)?.id ?? null;
}

let lastDawn = -1;
/** Each tick: the day's first tick after 5 o'clock lays the piles whole again. */
export function haulDawnTick(day: number, hour: number): number {
  if (hour < 5 || day === lastDawn) return 0;
  lastDawn = day;
  return goods.haulDawn();
}

/** Game minutes between two loads the boats' men bring to a pile, and how far every player must be (m). */
export const SUPPLY_EVERY_MIN = 4;
export const SUPPLY_UNSEEN_M = 45;
const supplied = new Map<string, number>();

/**
 * Each tick, working hours on a weekday: a pile that lacks loads gets one more every SUPPLY_EVERY_MIN minutes from the
 * boats along the quay, but only while no player is within SUPPLY_UNSEEN_M of it (nobody sees sacks come from nowhere;
 * in sight the crane or nobody fills it, and its dockers go for a drink). `players`: where they are (the tests give it).
 */
export function haulSupplyTick(day: number, minuteOfDay: number, players: Array<{ x: number; z: number }> = playersAt()): number {
  if (day % 7 === 0 || minuteOfDay < 6 * 60 || minuteOfDay > 18 * 60 + 30) return 0;
  const t = day * 1440 + minuteOfDay;
  let n = 0;
  for (const r of HAUL_ROUTES) {
    const last = supplied.get(r.id);
    if (last !== undefined && t - last < SUPPLY_EVERY_MIN && t >= last) continue;
    supplied.set(r.id, t);
    if (players.some((p) => Math.hypot(p.x - r.pile.x, p.z - r.pile.z) < SUPPLY_UNSEEN_M)) continue;
    if (goods.haulSupply(r.id)) n++;
  }
  return n;
}
