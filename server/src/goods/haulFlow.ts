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
  installBook();
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
    if (r.dawnOnly) continue;
    const last = supplied.get(r.id);
    if (last !== undefined && t - last < SUPPLY_EVERY_MIN && t >= last) continue;
    supplied.set(r.id, t);
    if (players.some((p) => Math.hypot(p.x - r.pile.x, p.z - r.pile.z) < SUPPLY_UNSEEN_M)) continue;
    if (goods.haulSupply(r.id)) n++;
  }
  return n;
}

// ------------------------------------------------------------------ the foreman's book (D1 docks, part 2)

/** The foreman who keeps the book: Sooi of the Hessenatie (the quays' natie), at his post by its door. */
export const BOOK_FOREMAN = "sooi";

const bookKey = (p: number) => `dockbook:${p}`;

/** Is player p written in the foreman's book this week (it is kept for the week; a new week starts a new book)? */
export function hasBook(db: DB, p: number): boolean {
  return !!db.prepare("SELECT 1 FROM world_state WHERE key = ?").get(bookKey(p));
}

/**
 * Player p asks the foreman to write him in: yes on a working day, in working hours, unless the foreman has no trust in
 * him (below 0). The foreman's line, and whether he is in the book now.
 */
export function askBook(db: DB, p: number, day: number, hour: number): { ok: boolean; line: string } {
  if (hasBook(db, p)) return { ok: true, line: "Sooi taps the book. \"You are in it already. Take from the piles, set it in at the end, and I pay by the piece.\"" };
  if (day % 7 === 0) return { ok: false, line: "\"Sunday. No book on a Sunday. Come back tomorrow.\"" };
  if (hour < 6 || hour >= 19) return { ok: false, line: "\"The book is shut. Come at six, when the quays open.\"" };
  const t = (db.prepare("SELECT trust FROM npc_relationship WHERE npc_id = ? AND player_id = ?").get(BOOK_FOREMAN, p) as { trust: number } | undefined)?.trust ?? 0;
  if (t < 0) return { ok: false, line: "Sooi looks at you a long time. \"Not you. Not after what I heard.\"" };
  db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(bookKey(p), JSON.stringify({ day }));
  return { ok: true, line: "Sooi licks his pencil and writes your name under the others. \"Day man, by the piece. Take from the natie's piles, set it in where the others do: a few cents a load, paid on the spot.\"" };
}

/** Pay by the piece: into his purse at once. */
export function payPiece(db: DB, p: number, c: number): void {
  db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = ?").run(c, p);
}

/** Wire the book into the store (installHaulFlow calls it). */
export function installBook(): void {
  goodsHooks.hasBook = (db, p) => hasBook(db, p);
  goodsHooks.payPiece = (db, p, c) => payPiece(db, p, c);
}
