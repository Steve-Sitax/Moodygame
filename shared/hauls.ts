// The dockers' carrying on the quays (Steve 2026-09-27: "workers getting items from a crane but no items were on the
// ground, and they drop it off in the middle of the street and the goods disappear from their hands"). Each route
// has a real start and a real end, checked in the game (client dev `__scheldemist.carrycheck()`):
//
// - `a`: where he takes a load up: beside the route's own pile of shared goods (`pile`, laid out by townGoods in
//   shared/goods.ts, the server's like every liftable thing). Not a heap of the quay's (client world/quaygoods.ts):
//   those are pruned at run time to clear room for jobs and emigrants. The quays' edges themselves are the cranes'
//   runways, the rails and the water: no pile stands there.
// - `b`: where he sets it down: at a door (`door`: the load goes in; the house's door as server town/walkmap.ts
//   houseDoors gives it, warehouses included), on a pile (`drop`), or at the back of a fish bank (`stall`).
// - `carry`: what he has on his shoulder between them, the kind of the pile he takes from.
//
// Server town/hauls.ts moves the dockers of an older save onto these routes (by `was`, and `also` for a route given
// up), and town/places.ts HAULS gives them to the dockers of a new town. Pure data, no imports: both sides read it.

export type Pt = [number, number];

export interface HaulRoute {
  id: string;
  /** The town place of the work (server town/places.ts). */
  place: string;
  /** The route as it was before (quay edge to street), and routes given up whose dockers come here. */
  was: [Pt, Pt];
  also?: Array<[Pt, Pt]>;
  /** Where he takes the load up, and which way he faces there (yaw = atan2(dx, dz), toward the pile). */
  a: Pt;
  aYaw: number;
  carry: "sack" | "crate";
  /** The route's own pile at `a` (shared goods). */
  pile: { kind: "sacks" | "crates"; x: number; z: number };
  into: "door" | "pile" | "stall";
  /** Where he sets it down: the door's step, a spot beside the drop pile, or the back of the fish bank. */
  b: Pt;
  /** The door itself (into "door"). */
  door?: Pt;
  /** The drop pile (into "pile"): shared goods of its own. */
  drop?: { kind: "sacks" | "crates"; x: number; z: number };
}

export const HAUL_ROUTES: HaulRoute[] = [
  { id: "rk-w", place: "rijnkaai", was: [[-40, 5], [-44, 40]], a: [-39.06, 17.11], aYaw: 3.03, carry: "crate", pile: { kind: "crates", x: -38.95, z: 16.12 }, into: "door", b: [-42.1, 45.1], door: [-42.1, 46] },
  { id: "rk-m", place: "rijnkaai", was: [[-12, 4], [-10, 40]], a: [-9.44, 15.03], aYaw: 3.12, carry: "sack", pile: { kind: "sacks", x: -9.41, z: 13.66 }, into: "door", b: [-10.2, 45.1], door: [-10.2, 46] },
  { id: "rk-e1", place: "rijnkaai", was: [[26, 5], [40, 42]], a: [26.68, 13.46], aYaw: -2.7, carry: "sack", pile: { kind: "sacks", x: 26, z: 12 }, into: "door", b: [21.5, 45.1], door: [21.5, 46] },
  { id: "rk-e2", place: "rijnkaai", was: [[45, 5], [56, 40]], a: [54.63, 15.94], aYaw: -3.08, carry: "sack", pile: { kind: "sacks", x: 54.55, z: 14.55 }, into: "pile", b: [51.03, 39.78], drop: { kind: "sacks", x: 50.88, z: 40.77 } },
  { id: "hn-1", place: "hessenatie", was: [[12, 5], [11.2, 43.5]], a: [18.37, 13.19], aYaw: 2.91, carry: "sack", pile: { kind: "sacks", x: 18.72, z: 11.72 }, into: "door", b: [12, 45.1], door: [12, 46] },
  { id: "hn-2", place: "hessenatie", was: [[2, 5], [11.2, 43.5]], a: [2.46, 15.48], aYaw: -2.84, carry: "sack", pile: { kind: "sacks", x: 2, z: 14 }, into: "door", b: [12, 45.1], door: [12, 46] },
  { id: "en-1", place: "entrepot", was: [[173, 55], [173, 83]], a: [168.6, 45.3], aYaw: 3.14, carry: "sack", pile: { kind: "sacks", x: 168.6, z: 44.38 }, into: "door", b: [175.1, 83], door: [176, 83] },
  { id: "en-2", place: "entrepot", was: [[173, 108], [173, 88]], a: [174.31, 112.5], aYaw: 0.76, carry: "sack", pile: { kind: "sacks", x: 175, z: 113.23 }, into: "door", b: [175.1, 83], door: [176, 83] },
  { id: "en-3", place: "entrepot", was: [[160, 40], [173, 78]], a: [153.34, 35.14], aYaw: -1.93, carry: "sack", pile: { kind: "sacks", x: 152.4, z: 34.79 }, into: "door", b: [175.1, 83], door: [176, 83] },
  {
    id: "ba-1", place: "bassin", was: [[90, 44], [96, 8]], also: [[[130, 44], [150, 10]], [[66, 60], [70, 20]]],
    a: [89.02, 32.65], aYaw: -1.83, carry: "crate", pile: { kind: "crates", x: 88.05, z: 32.4 }, into: "pile", b: [94.91, 10.18], drop: { kind: "crates", x: 95.29, z: 8.71 },
  },
  { id: "bs-1", place: "bassin_south", was: [[140, 113], [150, 122]], also: [[[90, 113], [100, 122]]], a: [143.97, 113.22], aYaw: -1.91, carry: "sack", pile: { kind: "sacks", x: 143.02, z: 112.89 }, into: "door", b: [178, 125.1], door: [178, 126] },
  { id: "wf-1", place: "werf", was: [[-300, 3], [-306, 12]], a: [-301.41, 12.38], aYaw: 1.49, carry: "sack", pile: { kind: "sacks", x: -300, z: 12.5 }, into: "door", b: [-311.9, 13.1], door: [-311.9, 14] },
  { id: "wf-2", place: "werf", was: [[-262, 3], [-270, 12]], a: [-269.27, 11.91], aYaw: 1.69, carry: "sack", pile: { kind: "sacks", x: -267.83, z: 11.73 }, into: "door", b: [-261.1, 13.1], door: [-261.1, 14] },
  { id: "wf-3", place: "werf", was: [[-230, 3], [-226, 26]], a: [-226.33, 13.15], aYaw: -3.12, carry: "sack", pile: { kind: "sacks", x: -226.36, z: 11.78 }, into: "door", b: [-238.2, 13.1], door: [-238.2, 14] },
  { id: "vm-1", place: "vismarkt", was: [[-139, 22], [-123.2, 22.4]], a: [-138.15, 21.27], aYaw: -1.65, carry: "sack", pile: { kind: "sacks", x: -139.56, z: 21.17 }, into: "stall", b: [-123.2, 22.4] },
  { id: "vm-2", place: "vismarkt", was: [[-139, 34], [-123.6, 33.2]], a: [-138.2, 33.17], aYaw: -1.57, carry: "sack", pile: { kind: "sacks", x: -139.56, z: 33.17 }, into: "stall", b: [-123.6, 33.2] },
  { id: "ca-1", place: "canal", was: [[-65, 90], [-65, 108]], a: [-65, 85.85], aYaw: 3.14, carry: "sack", pile: { kind: "sacks", x: -65, z: 84.5 }, into: "door", b: [-60.9, 105.5], door: [-60, 105.5] },
  { id: "ca-2", place: "canal", was: [[-87, 120], [-87, 84]], a: [-87.68, 117.93], aYaw: -0.02, carry: "sack", pile: { kind: "sacks", x: -87.71, z: 119.29 }, into: "door", b: [-90.8, 78.7], door: [-92, 78.7] },
];

/** Sacks or crates in a route's own pile. */
export const HAUL_PILE_N = 5;

/**
 * Where item i of a route's own pile lies: a low heap, three in a row across the way to `from` (the docker's stand),
 * two on top of the first two (goods stack straight up: shared/goods.ts placeAt).
 */
export function haulPileSpot(p: { x: number; z: number; kind: "sacks" | "crates" }, i: number, from: Pt): Pt {
  const gap = p.kind === "crates" ? 0.74 : 0.52;
  const dx = from[0] - p.x;
  const dz = from[1] - p.z;
  const L = Math.hypot(dx, dz) || 1;
  // across: the right hand of the way to him
  const ax = -dz / L;
  const az = dx / L;
  const k = [-1, 0, 1, -1, 0][i % 5];
  return [p.x + ax * k * gap, p.z + az * k * gap];
}

/** The route a haul worker of the town walks (by his ends, as they are now or as they were). */
export function haulRouteOf(a: Pt | undefined, b: Pt | undefined, near = 3): HaulRoute | null {
  if (!a || !b) return null;
  const same = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]) < near;
  for (const r of HAUL_ROUTES) {
    if (same(a, r.a) && same(b, r.b)) return r;
    if (same(a, r.was[0]) && same(b, r.was[1])) return r;
    for (const [oa, ob] of r.also ?? []) if (same(a, oa) && same(b, ob)) return r;
  }
  return null;
}
