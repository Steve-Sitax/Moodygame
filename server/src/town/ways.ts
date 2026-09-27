import CITY from "../../../shared/city.json" with { type: "json" };
import { START, walkMap } from "./walkmap.ts";
import { findWay, wayKey, type Pt, type WayGrid } from "./wayfind.ts";
import { planLegs, type WhereResident, type WhereTown } from "./whereabouts.ts";

// The server's ways (the trade plan, docs/trade-plan.md part A): found on the walk map (wayfind.ts), kept in
// memory under their key (both ends on a 1 m grid). A way takes a few milliseconds, so the whole town's plan
// is found at the first ask; the PCs fetch them (GET /api/town/ways) and walk the unseen along them.

let grid: WayGrid | null = null;
const kept = new Map<string, Pt[] | null>();

/**
 * The ways' own copy of the walk map's reachable ground, with the opening bridges over the canals, the vliet and
 * the lock as the game walks them (client world/rijnkaai.ts `onOpening`): walk.png has water under them, and the
 * walk map's own flood never crossed to the far banks (177 places of the day plans unreachable, 2026-09-27).
 */
function theGrid(): WayGrid {
  if (!grid) {
    const w = walkMap();
    const { x0, z0, res, w: W, h: H } = w.info;
    const bridges = Object.entries((CITY as unknown as { bridges: Record<string, number[]>; bridgeKinds: Record<string, string> }).bridges)
      .filter(([k]) => ["draw", "pontoon"].includes((CITY as unknown as { bridgeKinds: Record<string, string> }).bridgeKinds[k] ?? ""))
      .map(([, r]) => r);
    const onBridge = (x: number, z: number) => bridges.some((r) => x > r[0] && x < r[2] && z > r[1] && z < r[3]);
    const centre = (i: number) => [x0 + (Math.floor(i / W) + 0.5) * res, z0 + ((i % W) + 0.5) * res];
    const n = W * H;
    const open = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const [x, z] = centre(i);
      open[i] = w.open(x, z) || onBridge(x, z) ? 1 : 0;
    }
    // flood from the start over that ground (as walkmap.ts does over its own)
    const pass = new Uint8Array(n);
    const s0 = Math.floor((START.x - x0) / res) * W + Math.floor((START.z - z0) / res);
    const stack = [s0];
    pass[s0] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      const r = Math.floor(i / W);
      const c = i % W;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= H || cc >= W) continue;
        const j = rr * W + cc;
        if (!pass[j] && open[j]) {
          pass[j] = 1;
          stack.push(j);
        }
      }
    }
    grid = { x0, z0, res, w: W, h: H, pass };
  }
  return grid;
}

/** Can a body walk to this point from the start, bridges included (the ways' ground)? */
export function wayReachable(x: number, z: number): boolean {
  const g = theGrid();
  const c = Math.floor((z - g.z0) / g.res);
  const r = Math.floor((x - g.x0) / g.res);
  return c >= 0 && r >= 0 && c < g.w && r < g.h && g.pass[r * g.w + c] === 1;
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
