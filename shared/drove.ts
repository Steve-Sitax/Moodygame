// T3 chain 3 in the open (docs/milestones/T3-trade.md): the pigs for the butcher's morning kill come in at dawn. On a
// weekday a farmer drives two to four pigs in through the Kipdorp gate and along the streets to the butcher by the
// Vleeshuis, where they go in at the door (his yard is behind it, the kill at 7 off screen: KILL_AT in trade.ts); then
// he walks back out through the gate. The server's clock places it (every PC and the town map the same); the way is
// the server's walk map (trade/drove.ts), the game draws the farmer and the pigs only near a player (game/droveWalk.ts).

/** Just inside the Kipdorp gate (shared/city.json places Kipdorppoort at -145, 354). */
export const DROVE_GATE: [number, number] = [-145, 344];
/** The post whose door the pigs go in at (shared/trade.ts POSTS). */
export const DROVE_TO = "butcher_vlees";
/** He leaves the gate at 3:45 (in the dark, a lantern in his hand), so the pigs are in before the kill at 7 (the way is about 320 m at a pig's pace). */
export const DROVE_LEAVE_MIN = 3 * 60 + 45;
/** A drove's pace (m/s of real time: pigs are driven slowly; a game minute is two real seconds). */
export const DROVE_PACE = 0.9;
const REAL_S_PER_MIN = 2;
/** Game minutes at the door: the pigs go in one after another. */
export const DROVE_IN_MIN = 5;
/** The pigs in line before the farmer: metres between them, and from the last to him. */
export const DROVE_GAP = 1.8;
export const DROVE_BEHIND = 1.6;

export type PigKind = "pig_pink" | "pig_spotted";

export interface Drove {
  /** "drove:<day>". */
  id: string;
  day: number;
  /** Game minute (from day 1, 0:00) he leaves the gate. */
  t0: number;
  /** The way on foot, gate to door (points x, z), and its length (m). */
  way: Array<[number, number]>;
  len: number;
  /** The pigs, the first in line first. */
  pigs: PigKind[];
}

/** A number the same on every PC for this day and salt. */
function dice(day: number, salt: number): number {
  const x = Math.sin(day * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Today's pigs (none on Sunday, day 7, 14 ...): two to four, now and then a spotted one among them. */
export function drovePigs(day: number): PigKind[] {
  if (day % 7 === 0) return [];
  const n = 2 + Math.floor(dice(day, 1) * 3);
  return Array.from({ length: n }, (_, i) => (dice(day, 10 + i) < 0.3 ? "pig_spotted" : "pig_pink"));
}

/** The drove's parts: to the door (go), at it (in), back out to the gate (back), done. */
export function droveAt(d: Drove, t: number): { phase: "before" | "go" | "in" | "back" | "over"; f: number; minIn: number } {
  const walk = d.len / (DROVE_PACE * REAL_S_PER_MIN);
  const dt = t - d.t0;
  if (dt < 0) return { phase: "before", f: 0, minIn: 0 };
  if (dt < walk) return { phase: "go", f: dt / walk, minIn: 0 };
  if (dt < walk + DROVE_IN_MIN) return { phase: "in", f: 1, minIn: dt - walk };
  // (back at his own walking pace, empty-handed)
  const back = d.len / (1.2 * REAL_S_PER_MIN);
  if (dt < walk + DROVE_IN_MIN + back) return { phase: "back", f: 1 - (dt - walk - DROVE_IN_MIN) / back, minIn: DROVE_IN_MIN };
  return { phase: "over", f: 0, minIn: 0 };
}

/**
 * Where each one is along the way (metres from the gate) while they go: the first pig ahead, the others behind it,
 * the farmer last. At the start the line stands just inside the gate; the first pig reaches the door at the end.
 */
export function droveLine(d: Drove, f: number): { pigs: number[]; man: number } {
  const n = d.pigs.length;
  const L0 = Math.min(d.len * 0.5, (n - 1) * DROVE_GAP + DROVE_BEHIND);
  const head = L0 + f * (d.len - L0);
  const pigs = d.pigs.map((_, i) => Math.max(0, head - i * DROVE_GAP));
  return { pigs, man: Math.max(0, head - (n - 1) * DROVE_GAP - DROVE_BEHIND) };
}
