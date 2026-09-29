import type { DB } from "../db.ts";
import { wayBetween } from "../town/ways.ts";
import { wayLength } from "../town/wayfind.ts";
import { postDoor } from "./ledger.ts";
import { DROVE_GATE, DROVE_LEAVE_MIN, DROVE_TO, drovePigs, type Drove } from "../../../shared/drove.ts";

// T3 chain 3 in the open (shared/drove.ts): the day's drove of pigs, the Kipdorp gate to the butcher's door, on the
// server's walk map. Sent with GET /api/trade (the game draws it near a player) and to the town map's runs list.

let wayKept: { way: Array<[number, number]>; len: number } | null | undefined;

/** The way from the gate to the butcher's door (found once; null when the walk map has none). */
function droveWay(db: DB): { way: Array<[number, number]>; len: number } | null {
  if (wayKept !== undefined) return wayKept;
  const door = postDoor(db, DROVE_TO);
  const w = door ? wayBetween(DROVE_GATE[0], DROVE_GATE[1], door[0], door[1]) : null;
  wayKept = w && w.length > 1 ? { way: w.map(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10] as [number, number]), len: Math.round(wayLength(w)) } : null;
  return wayKept;
}

/** The drove of this day, or null (Sunday, or no way on foot). */
export function droveOf(db: DB, day: number): Drove | null {
  const pigs = drovePigs(day);
  if (!pigs.length) return null;
  const w = droveWay(db);
  if (!w) return null;
  return { id: `drove:${day}`, day, t0: (day - 1) * 1440 + DROVE_LEAVE_MIN, way: w.way, len: w.len, pigs };
}

/** Tests: find the way again (a new town). */
export function resetDroveWay(): void {
  wayKept = undefined;
}
