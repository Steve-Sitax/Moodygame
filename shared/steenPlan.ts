// The Steen's interior in the world (M7 halls, docs/milestones/M7-halls-inworld.md), fitted inside the lane
// range of the Blender shell of tools/blender/build_landmarks.py steen5(): the Museum of Antiquities (opened
// 1864 in the old castle and prison). The door from the raised courtyard (2.2 m over the street) leads into
// Charles V's gatehouse, where the arms and armour stand; through a wide arch the hall of antiquities fills
// the old prison range beside it (glass cases, cabinets, carved stones); a stair at its end goes down to the
// old prison cell under it, the last stop of the visit. Pure numbers (shared/hallPlan.ts).
//
// The frame: the museum door's plane (the gatehouse's lane face, world (-183.5, -23.25)) at z 0, x across
// (+x is world -x: the frame is turned half round, yaw pi), z into the building (world -z). The floor is the
// courtyard's, 2.2 over the street.

import type { HallPlan, Level, Mark, Rect, Stair } from "./hallPlan.js";

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

/** The shell (build_landmarks.py steen5, frame c (-177, -31.25): the gatehouse u -9.4..-3.6, the prison range -3.6..8, v -0.2..8), in the hall's frame. */
export const SHELL = {
  /** The lane face, the back (v -0.2), the gatehouse's west face, the prison range's east end. */
  face: 0,
  back: 8.2,
  west: 2.9,
  east: -14.5,
  /** Where the gatehouse and the prison range meet (their faces there are cut: the hall's arch). */
  seam: -2.9,
  /** The prison range's eaves over the street, the courtyard's height. */
  eaves: 12.6,
  courtyard: 2.2,
  /** The door: a basket arch 2.5 wide, 3.6 high (springing at 0.76 of it), in the flat face. */
  door: { hw: 1.25, h: 3.6, spring: 0.76 * 3.6 },
  /** The prison range's barred windows on the lane (local x), sill and head over the courtyard; the gatehouse's two small ones. */
  windows: [-4.6, -7.8, -11.0],
  winY: [1.2, 3.9] as [number, number],
  smallWindows: [2.1, -2.1],
  smallY: [1.4, 2.6] as [number, number],
};

export const FLOOR_Y = SHELL.courtyard;
/** The cell under the hall of antiquities (the prison range's ground floor, under the courtyard's level). */
export const DOWN = -2.4;
export const CEIL = 5.2;
export const CELL_CEIL = -0.35;
export const IN = { front: 1.0, back: 7.4, west: 2.2, east: -13.8 };
/** The wall between the gatehouse and the hall of antiquities, its arch. */
export const SEAM = { x0: -3.3, x1: -2.5, open: [2.6, 5.4] as [number, number], archTop: 4.0 };
export const GATEHOUSE = R(SEAM.x1, IN.west, IN.front, IN.back);
export const HALL = R(IN.east, SEAM.x0, IN.front, IN.back);
export const CELL = R(IN.east, -8.0, IN.front, IN.back);

/** The stair down to the cell along the back wall, from the hall (its head) to the cell (its foot). */
export const STAIR: Stair = { rect: R(-12.4, -9.0, 5.9, IN.back), along: "x", foot: -12.4, head: -9.0, lo: 1, hi: 0, y0: DOWN, y1: 0, rise: -DOWN / 12 };
/**
 * The flight for walking: as STAIR, reaching 0.5 m onto the hall's floor past its head (its height held there,
 * as the homes' flights do). Without it the steep flight (0.2 on 0.28) had the hall's floor ahead count as a wall
 * for the body's ring from the second-last step, and Jef could not climb out of the cell (walkthrough west,
 * 2026-09-25). STAIR itself is what is drawn.
 */
/** Where the iron rail along the stairwell ends at the hall's side: 0.6 short of the head, so the way onto the flight between it and the back case is 0.56 m wide for Jef's body (walkthrough west, 2026-09-25). */
export const RAIL_END = STAIR.head - 0.6;
export const WALK_STAIR: Stair = { ...STAIR, rect: R(STAIR.rect.minX, STAIR.head + 0.5, STAIR.rect.minZ, STAIR.rect.maxZ) };

// ---- the hall of antiquities: glass cases, cabinets, carved stones
/** Cases on tables: [x, z, along x] (2.2 by 0.9). */
export const CASES: Array<[number, number, boolean]> = [
  [-4.6, 1.55, true], [-7.8, 1.55, true], [-11.0, 1.55, true],
  // the back case at x -7.3, not -7.6 (walkthrough west, 2026-09-25): at -7.6 its end and the stairwell's
  // rail left no way onto the stair head for Jef's body (0.32 m), so the cell could not be walked to
  [-5.0, 6.85, true], [-7.3, 6.85, true],
  [-13.25, 3.6, false],
];
export const CABINETS: Array<[number, number]> = [[-6.3, 4.3], [-10.0, 4.3]];
// (issue #10, the interior check: the first stone stood at (-13.3, 5.4) and shut the nook past the stairwell's end off
// from the hall, 6 free places no one reached; it stands in that nook now, the way to it open along the east wall)
export const STONES: Array<[number, number, number]> = [[-13.3, 6.9, 0], [-3.8, 1.5, 1], [-3.8, 7.0, 2], [-12.9, 1.5, 3]];
// ---- the gatehouse: arms and armour
export const ARMOUR: Array<[number, number]> = [[1.6, 2.6], [1.6, 4.6]];
export const RACK = { x: 1.95, z0: 5.3, z1: 7.2 };
export const GUN = { x: -1.3, z: 6.4 };
export const SWORDS = { x: 0.3, z: 6.75 };

const around = (x: number, z: number, hx: number, hz = hx): Rect => R(x - hx, x + hx, z - hz, z + hz);

const DOOR = SHELL.door;
/** The basket arch over the leaves (build_landmarks.py DOOR4), from the right springing to the left. */
const ARCH: Array<[number, number]> = ([[1, 0.76], [0.9, 0.9], [0.7, 0.98], [0.5, 1], [0.3, 0.98], [0.1, 0.9], [0, 0.76]] as Array<[number, number]>).map(([f, t]) => [(f - 0.5) * 2 * DOOR.hw, t * DOOR.h]);

const level0: Level = {
  y: 0,
  floors: [
    R(-1.9, 1.9, -2.3, 0.05), // the courtyard before the door
    R(-DOOR.hw, DOOR.hw, 0, IN.front + 0.05), // the doorway
    GATEHOUSE,
    R(SEAM.x0 - 0.05, SEAM.x1 + 0.05, ...SEAM.open), // the arch
    R(IN.east, SEAM.x0, IN.front, STAIR.rect.minZ - 0.15), // the hall of antiquities, but the stairwell
    R(IN.east, STAIR.rect.minX, STAIR.rect.minZ - 0.15, IN.back),
    R(STAIR.head - 0.2, SEAM.x0, STAIR.rect.minZ - 0.15, IN.back),
  ],
  solids: [
    ...CASES.map(([x, z, along]) => (along ? around(x, z, 1.1, 0.45) : around(x, z, 0.45, 1.1))),
    ...CABINETS.map(([x, z]) => around(x, z, 0.65, 0.45)),
    ...STONES.map(([x, z]) => around(x, z, 0.45)),
    ...ARMOUR.map(([x, z]) => around(x, z, 0.3)),
    R(RACK.x - 0.3, IN.west, RACK.z0, RACK.z1),
    R(GUN.x - 0.5, GUN.x + 0.5, GUN.z - 0.9, GUN.z + 0.9),
    R(SWORDS.x - 1.2, SWORDS.x + 1.2, SWORDS.z - 0.45, SWORDS.z + 0.45),
    // the rail round the stairwell
    R(STAIR.rect.minX - 0.1, RAIL_END, STAIR.rect.minZ - 0.2, STAIR.rect.minZ - 0.05),
    // the door's leaves standing open along the doorway
    R(-DOOR.hw - 0.05, -DOOR.hw + 0.14, 0, 1.3),
    R(DOOR.hw - 0.14, DOOR.hw + 0.05, 0, 1.3),
  ],
};

const level1: Level = {
  y: DOWN,
  floors: [CELL],
  solids: [
    // under the stair (its foot is walked onto), the bench against the far wall
    R(STAIR.foot + 0.5, STAIR.rect.maxX, STAIR.rect.minZ - 0.15, IN.back),
    R(IN.east, IN.east + 0.5, 2.0, 4.6),
  ],
};

const marks: Record<string, Mark> = {
  /** The step on the courtyard before the door: people come in and go out here. */
  door: { x: 0.4, z: -1.6, yaw: 0 },
};
const sets: Record<string, Mark[]> = {
  cases: [
    { x: -4.6, z: 2.55, yaw: Math.PI },
    { x: -7.8, z: 2.55, yaw: Math.PI },
    { x: -11.0, z: 2.55, yaw: Math.PI },
    { x: -5.0, z: 5.85, yaw: 0 },
    { x: -7.3, z: 5.85, yaw: 0 },
    { x: -12.2, z: 3.6, yaw: -Math.PI / 2 },
    { x: -6.3, z: 3.35, yaw: 0 },
    { x: -10.0, z: 5.25, yaw: Math.PI },
    { x: 0.7, z: 3.6, yaw: -Math.PI / 2 },
    { x: -0.3, z: 5.4, yaw: 0 },
  ],
  custodianRound: [
    { x: 0, z: 2.2, yaw: 0 },
    { x: -8.2, z: 3.1, yaw: -Math.PI / 2 },
    { x: -12.3, z: 5.0, yaw: -Math.PI / 2 },
    { x: -0.6, z: 4.2, yaw: Math.PI / 2 },
  ],
};

export const PLAN: HallPlan = {
  id: "steen",
  origin: { x: -183.5, z: -23.25 },
  yaw: Math.PI,
  floorY: FLOOR_Y,
  levels: [level0, level1],
  stairs: [WALK_STAIR],
  doors: [{ id: "steen_museum", x: 0, z: 0, dir: 1, hw: DOOR.hw, h: DOOR.spring, inner: IN.front, y: 0, leaves: 2, open: (80 * Math.PI) / 180, step: marks.door, archTop: ARCH }],
  area: [R(-2.0, 2.0, -2.4, 0.2), R(-14.4, 2.8, 0, 8.1)],
  steps: [],
  nodes: [
    [0.4, -1.6], [-0.4, -1.6], [0, 0.5], [0, 2.2], [-1.4, 4.0], [0.6, 4.2], [-4.2, 4.0], [-4.3, 2.8], [-8.2, 3.0], [-8.2, 5.4],
    [-12.3, 5.0], [-12.2, 2.6], [-5.0, 5.7], [-10.0, 3.3],
  ],
  marks,
  sets,
};

/** The hall's walls as boxes (local, for the check that they stand inside the shell). */
export function wallRects(): Rect[] {
  return [
    R(-14.3, 2.7, 0.2, IN.front), // the lane wall, the doorway through it
    R(-14.3, 2.7, IN.back, 8.0), // the back wall
    R(IN.west, 2.7, 0.2, 8.0), // the gatehouse's west wall
    R(-14.3, IN.east, 0.2, 8.0), // the hall's east end
  ];
}
