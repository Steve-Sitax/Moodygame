import { walkMap } from "./walkmap.ts";
import { findWay, wayKey, type Pt, type WayGrid } from "./wayfind.ts";
import { planLegs, type WhereResident, type WhereTown } from "./whereabouts.ts";

// The server's ways (the trade plan, docs/trade-plan.md part A): found on the walk map (wayfind.ts), kept in
// memory under their key (both ends on a 1 m grid). A way takes a few milliseconds, so the whole town's plan
// is found at the first ask; the PCs fetch them (GET /api/town/ways) and walk the unseen along them.

let grid: WayGrid | null = null;
const kept = new Map<string, Pt[] | null>();

function theGrid(): WayGrid {
  if (!grid) {
    const w = walkMap();
    grid = { x0: w.info.x0, z0: w.info.z0, res: w.info.res, w: w.info.w, h: w.info.h, pass: w.pass };
  }
  return grid;
}

/** The way on foot between two points (null: one end is off the walkable town or they do not connect). */
export function wayBetween(ax: number, az: number, bx: number, bz: number): Pt[] | null {
  const k = wayKey(ax, az, bx, bz);
  if (kept.has(k)) return kept.get(k)!;
  const w = findWay(theGrid(), Math.round(ax), Math.round(az), Math.round(bx), Math.round(bz));
  // (asks by key come from the PCs: a bound on what is kept, the plan's own ways are found again at once)
  if (kept.size > 20000) kept.clear();
  kept.set(k, w);
  return w;
}

/** A WayOf for whereabouts.ts on the server. */
export const serverWay = (ax: number, az: number, bx: number, bz: number): Pt[] | null => wayBetween(ax, az, bx, bz);

/** Every way the town's day plans walk: key -> points (a way that could not be found is left out). */
export function planWays(town: WhereTown & { residents: ReadonlyArray<WhereResident> }): Record<string, Pt[]> {
  const out: Record<string, Pt[]> = {};
  for (const r of town.residents) {
    for (const [a, b] of planLegs(r, town)) {
      const w = wayBetween(a.x, a.z, b.x, b.z);
      if (w) out[wayKey(a.x, a.z, b.x, b.z)] = w;
    }
  }
  return out;
}

/** Finds every day plan's ways ahead, one resident per turn of the event loop, so no ask waits on them. */
export function warmWays(get: () => WhereTown & { residents: ReadonlyArray<WhereResident> }): void {
  let i = 0;
  const step = () => {
    try {
      const tw = get();
      if (i >= tw.residents.length) return;
      const r = tw.residents[i++];
      for (const [a, b] of planLegs(r, tw)) wayBetween(a.x, a.z, b.x, b.z);
      setImmediate(step);
    } catch {
      // (the town not made yet, or a save being loaded: the first ask finds them instead)
    }
  };
  setImmediate(step);
}

/** Ways asked for by key ("x,z>x,z"): at most `max` at a time. */
export function waysByKey(keys: ReadonlyArray<string>, max = 60): Record<string, Pt[] | null> {
  const out: Record<string, Pt[] | null> = {};
  for (const k of keys.slice(0, max)) {
    const m = /^(-?\d+),(-?\d+)>(-?\d+),(-?\d+)$/.exec(k);
    if (!m) continue;
    out[k] = wayBetween(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  }
  return out;
}
