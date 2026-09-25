// Sint-Carolus Borromeus on the Conscienceplein (M7, docs/milestones/M7-carolus.md): the numbers of its
// front that the game walks, the same as the Blender shell's (tools/blender/build_churches.py, CF and
// carolus_terrace). Pure numbers, no three.js: the client walks them (client/src/world/rijnkaai.ts), the
// placers keep off them (client/src/world/doorKeep.ts).
//
// The frame is the shell's (build_churches.py frame_front_open): a from the landmark rectangle's front
// edge inward (world +z), s along the front (world +x), the Conscienceplein at a < 0. It is not turned:
// world x = ORIGIN.x + s, z = ORIGIN.z + a. The rectangle (shared/city.json landmarks.carolus) is solid
// in the walk map from a 0; the terrace and its flights stand on the square before it.

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number; top?: number };

/** The rectangle's front edge on the church's axis (city.json frame c + open * n * W / 2), in world metres. */
export const ORIGIN = { x: -116, z: 168.35 } as const;

/** The front's face and back (a), the stair towers' face, the main door (width, height from the sill). */
export const FRONT = { face: 0.9, back: 1.9, towerFace: 1.4, towerSide: 15.3, aisle: 12.8, door: { w: 3.4, h: 7.2 }, sideDoor: 9.35 } as const;

/**
 * The terrace before the front: bluestone slabs at Y0 over the square, from a TA to the front, across
 * |s| <= TS; three flights of steps (RISE high, TREAD deep) down from its edge before the three doors;
 * the iron railing on its edge between the flights and along its ends (END in from them).
 */
export const TERRACE = {
  Y0: 0.6,
  TA: -2.2,
  TS: 10.9,
  RISE: 0.15,
  TREAD: 0.3,
  END: 0.15,
  FLIGHTS: [
    [-10.9, -8.4],
    [-2.6, 2.6],
    [8.4, 10.9],
  ] as ReadonlyArray<readonly [number, number]>,
} as const;

const RISERS = Math.round(TERRACE.Y0 / TERRACE.RISE);
/** The flights' first riser (a). */
export const FLIGHT_FOOT = TERRACE.TA - (RISERS - 1) * TERRACE.TREAD;

export const toWorld = (s: number, a: number): [number, number] => [ORIGIN.x + s, ORIGIN.z + a];
export const toLocal = (x: number, z: number): [number, number] => [x - ORIGIN.x, z - ORIGIN.z];

/** The height of the terrace or a step at world (x, z), or null off them (the square's own 0 there). */
export function frontFloor(x: number, z: number): number | null {
  const [s, a] = toLocal(x, z);
  const T = TERRACE;
  if (Math.abs(s) > T.TS || a > FRONT.face || a < FLIGHT_FOOT) return null;
  if (a >= T.TA) return T.Y0;
  for (const [s0, s1] of T.FLIGHTS) {
    if (s >= s0 && s <= s1) return Math.min(RISERS - 1, Math.floor((a - FLIGHT_FOOT) / T.TREAD) + 1) * T.RISE;
  }
  return null;
}

const rect = (s0: number, s1: number, a0: number, a1: number, top: number): Rect => {
  const [x0, z0] = toWorld(Math.min(s0, s1), Math.min(a0, a1));
  const [x1, z1] = toWorld(Math.max(s0, s1), Math.max(a0, a1));
  return { minX: x0, maxX: x1, minZ: z0, maxZ: z1, top };
};

/**
 * The solid parts on the square, as world boxes: the railing with its kerb and piers on the terrace's
 * edge between the flights, and along its two ends to the front (so the terrace is reached only by the
 * steps). `top` is the railing's top over the square.
 */
export function frontSolids(): Rect[] {
  const T = TERRACE;
  const ar = T.TA + 0.15; // the railing's line (build_churches.py carolus_terrace)
  const top = T.Y0 + 1.5;
  const e = T.TS - T.END;
  return [
    rect(-8.4 - 0.27, -2.6 + 0.27, ar - 0.27, ar + 0.27, top),
    rect(2.6 - 0.27, 8.4 + 0.27, ar - 0.27, ar + 0.27, top),
    rect(-e - 0.27, -e + 0.27, ar - 0.27, FRONT.face, top),
    rect(e - 0.27, e + 0.27, ar - 0.27, FRONT.face, top),
  ];
}

/** Where nothing the town sets down may stand: the terrace, the flights and 2.5 m of the square before them. */
export function frontKeepOut(street = 2.5): Rect[] {
  return [rect(-TERRACE.TS - 0.5, TERRACE.TS + 0.5, FLIGHT_FOOT - street, FRONT.face, 0)].map(({ top: _t, ...r }) => r);
}
