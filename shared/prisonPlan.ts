// The prison of 1855 (M7 prison and squares, docs/milestones/M7-prison-squares.md): its frame, its parts and its
// hours, read by the server (who is where, when the gate opens: server/src/town/prison.ts) and the client (the
// shell world/prison.ts, the hall world/prisonHall.ts). Pure numbers, no imports.
//
// The frame is tools/city/places.py's (shared/townplaces.json "prison"; server/test/prison.test.ts checks they
// agree): local x along the front (world -z), local z into the compound (world +x), the gate's middle at (0, 0).
// World = origin + (x cos yaw + z sin yaw, -x sin yaw + z cos yaw), as shared/hallPlan.ts.

import type { HallPlan, Mark, Rect as HRect } from "./hallPlan.js";

export const ORIGIN = { x: -354.996, z: 199.5 } as const;
export const YAW = 1.541087;

/** The compound (local), the outer wall's thickness and height. */
export const COMPOUND = { x0: -32.5, x1: 30.5, z0: 0, z1: 30 } as const;
export const WALL = { t: 0.6, h: 6.4 } as const;

/** The parts (local rectangles; heights over the street), as the Blender shell's (build_prison.py). */
export const PARTS = {
  front: { x0: -12, x1: 12, z0: 0, z1: 9, h: 8.6 },
  tower: { x0: -4.2, x1: 4.2, z0: -0.6, z1: 9, h: 13.6 },
  gate: { hw: 1.7, spring: 3.2, h: 4.9 },
  governor: { x0: -32.5, x1: -22, z0: 0, z1: 10.5, h: 11.2 },
  link: { x0: -2.8, x1: 2.8, z0: 9, z1: 15, h: 7.6 },
  pavilion: { x: 0, z: 19, r: 6.4, h: 18.4 },
  wingA: { x0: 2, x1: 28.4, z0: 14.6, z1: 24.4, h: 11.8 },
  wingB: { x0: -28.4, x1: -2, z0: 14.6, z1: 24.4, h: 11.8 },
  chapel: { x0: -21, x1: -13.4, z0: 1.6, z1: 12.8, h: 8.8 },
  ring: { x: 21.6, z: 7.4, r_in: 3.6, r_out: 5 },
  yard_door: { x: 13, hw: 0.8, h: 2.5 },
} as const;

export function toWorld(x: number, z: number): [number, number] {
  const c = Math.cos(YAW);
  const s = Math.sin(YAW);
  return [ORIGIN.x + x * c + z * s, ORIGIN.z - x * s + z * c];
}
export function toLocal(wx: number, wz: number): [number, number] {
  const c = Math.cos(YAW);
  const s = Math.sin(YAW);
  const dx = wx - ORIGIN.x;
  const dz = wz - ORIGIN.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** Where people stand at the gate on the street (local): the step before it, and the warder's place beside it. */
export const GATE_STEP = { x: 0, z: -2.2 } as const;
export const GATE_WARDER = { x: 2.6, z: -1.5 } as const;

// ------------------------------------------------------------------ hours

/** Day of the week, 1 Monday .. 7 Sunday (day 1 of the game is a Monday). */
const weekday = (day: number) => ((day - 1) % 7) + 1;

/**
 * Visiting hours (the gate stands open to visitors): weekdays and Saturday 9 to 12 and 2 to 5, Sunday 2 to 4.
 * Outside them the gate is shut and a visitor inside is shown out.
 */
export function prisonVisiting(day: number, hour: number): boolean {
  if (weekday(day) === 7) return hour >= 14 && hour < 16;
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 17);
}

/** The exercise: the men walk the ring in the yard, a warder on his stand. Every day, twice (Sunday once, after mass). */
export function prisonExercise(day: number, hour: number): boolean {
  if (weekday(day) === 7) return hour >= 10.5 && hour < 11.5;
  return (hour >= 10 && hour < 11.5) || (hour >= 15 && hour < 16.5);
}

/** The warders' shifts: the day warders from six to six, the night watch from six to six. */
export function prisonDayShift(hour: number): boolean {
  return hour >= 6 && hour < 18;
}

// ================================================================ the inside (walked in the world)
//
// The halls' way (shared/hallPlan.ts, world/hallInWorld.ts): the rooms stand inside the Blender shell at its place,
// in the prison's frame; the floor is 0.1 over the street (FLOOR_Y: a stone threshold, and never in one plane with
// the ground drawn through the gate). In by the gate: the gate passage under the tower, the guard room off it on
// the one side, the visitors' room on the other (the visitors' side, the double grille with the warder's gangway,
// the prisoners' side), the inner grille, the link to the watch pavilion, the pavilion, and wing A's ground-floor
// corridor with its cells on three storeys (galleries over the corridor), two cells open; wing B shows through its
// shut grille. From wing A a door gives onto the exercise yard (the street's scene: a walk area of its own,
// world/prisonHall.ts).

const R = (minX: number, maxX: number, minZ: number, maxZ: number): HRect => ({ minX, maxX, minZ, maxZ });

/** The hall's floor over the street (world y). */
export const FLOOR_Y = 0.1;
/** The hall's lines (local metres). */
export const IN = {
  /** The tower's front wall (the gate's reveal), the passage's half width and its end (the tower's back). */
  gateFace: -0.6,
  gateInner: 0.4,
  passHW: 1.7,
  passWall: 2.3,
  passEnd: 9.0,
  /** The front building's rooms (inner faces). */
  front: { x0: -11.4, x1: 11.4, z0: 0.6, z1: 8.4 },
  /** The visitors' side ends at the grille; the gangway between the two grilles; the prisoners' side behind. */
  grille1: 3.5,
  grille2: 4.5,
  /** The link corridor's half width and its end in the pavilion. */
  linkHW: 2.2,
  linkEnd: 13.64,
  /** The pavilion's inner apothem round (0, 19). */
  pavR: 5.36,
  pavZ: 19,
  /** Wing A inside: its outer faces' inner sides, the corridor, the far end. */
  wing: { z0: 15.2, z1: 23.8, corrS: 17.8, corrN: 21.2, x1: 27.8 },
  /** The galleries over the corridor (their floors' heights, their width off each side). */
  galleries: [3.6, 7.2],
  galleryW: 0.9,
  vaultSpring: 10.2,
} as const;
/** The cells' middles along the wing (local x), 2.8 m apart; a cell is 2.5 wide inside. */
export const CELLS = [7.4, 10.2, 13.0, 15.8, 18.6, 21.4, 24.2, 27.0];
export const CELL_HW = 1.25;
/** The two open cells (x, north or south row), and the yard door (the south row's third place). */
export const OPEN_CELLS: Array<{ x: number; row: "N" | "S" }> = [
  { x: 10.2, row: "N" },
  { x: 18.6, row: "S" },
];
export const YARD_DOOR = { x: 13.0, hw: 0.8, spring: 1.7, z: 14.6 } as const;

const marks: Record<string, Mark> = {
  door: { x: 0, z: -2.0, yaw: Math.PI },
  inside: { x: 0, z: 1.6, yaw: 0 },
  passage: { x: 0, z: 6.5, yaw: 0 },
  guardTable: { x: -7.2, z: 4.9, yaw: Math.PI },
  guardStove: { x: -9.6, z: 7.0, yaw: -Math.PI / 2 },
  visitor: { x: 6.8, z: 3.0, yaw: 0 },
  prisoner: { x: 6.8, z: 5.3, yaw: Math.PI },
  gangway: { x: 3.4, z: 4.0, yaw: Math.PI / 2 },
  chief: { x: 0, z: 20.5, yaw: Math.PI },
  corridor: { x: 16.5, z: 19.5, yaw: -Math.PI / 2 },
  yardStep: { x: 13.0, z: 13.6, yaw: Math.PI },
};

const floors: HRect[] = [
  R(-IN.passHW, IN.passHW, -2.4, IN.gateFace), // the street before the gate (at the street's height: steps)
  R(-IN.passHW, IN.passHW, IN.gateFace, IN.passEnd), // the gate's reveal and the passage
  R(-IN.passWall, -IN.passHW, 4.8, 6.4), // the guard room's door (1.6 m: the walkers' check keeps 0.45 m off a wall)
  R(IN.front.x0, -IN.passWall, IN.front.z0, IN.front.z1), // the guard room
  R(IN.passHW, IN.passWall, 0.8, 2.4), // the visitors' room's door
  R(IN.passWall, IN.front.x1, IN.front.z0, IN.grille1), // the visitors' side
  R(-IN.linkHW, IN.linkHW, IN.passEnd, IN.linkEnd), // the link
  // the pavilion (an octagon in three rectangles)
  R(-2.2, 2.2, IN.pavZ - IN.pavR, IN.pavZ + IN.pavR),
  R(-IN.pavR, IN.pavR, IN.pavZ - 2.2, IN.pavZ + 2.2),
  R(-3.75, 3.75, IN.pavZ - 3.75, IN.pavZ + 3.75),
  R(IN.pavR, IN.wing.x1, IN.wing.corrS, IN.wing.corrN), // wing A's corridor
  // (the two open cells are looked into from their doors, not walked into: a cell door is 0.8 m)
  // the passage to the yard door through the south row, and the yard before it (at the street's height: steps)
  R(YARD_DOOR.x - YARD_DOOR.hw, YARD_DOOR.x + YARD_DOOR.hw, YARD_DOOR.z, IN.wing.corrS),
  R(YARD_DOOR.x - YARD_DOOR.hw, YARD_DOOR.x + YARD_DOOR.hw, 13.3, YARD_DOOR.z),
];
const solids: HRect[] = [
  // the guard room: the table, the stove, the bunk, the cupboard, the rifle rack
  R(-8.3, -6.1, 3.2, 4.3),
  R(-11.4, -10.5, 6.7, 7.7),
  R(-11.4, -9.5, 0.6, 1.5),
  R(-4.1, -2.5, 0.6, 1.1),
  R(-11.4, -11.0, 3.0, 5.2),
  // the visitors' benches along the front wall
  R(3.6, 5.8, 0.6, 1.0),
  R(8.0, 10.2, 0.6, 1.0),
  // the chief warder's desk on its platform in the pavilion
  R(-1.3, 1.3, 18.0, 20.0),
  // the iron stair up to the galleries at the wing's far end
  R(24.2, IN.wing.x1, IN.wing.corrN - 1.0, IN.wing.corrN),
];

/** The prison's hall plan (shared/hallPlan.ts). Its id is not one of the server's landmarks: the prison's life is its own (server/src/town/prison.ts). */
export const PLAN: HallPlan = {
  id: "prison" as unknown as HallPlan["id"],
  origin: { x: ORIGIN.x, z: ORIGIN.z },
  yaw: YAW,
  floorY: FLOOR_Y,
  levels: [{ y: 0, floors, solids }],
  stairs: [],
  doors: [
    {
      id: "prison_gate",
      x: 0,
      z: IN.gateFace + 0.5,
      dir: 1,
      hw: IN.passHW,
      h: PARTS.gate.spring,
      inner: IN.gateInner,
      y: 0,
      leaves: 2,
      open: (80 * Math.PI) / 180,
      step: marks.door,
      archTop: Array.from({ length: 13 }, (_, i) => {
        const a = (Math.PI * i) / 12;
        return [IN.passHW * Math.cos(a), PARTS.gate.spring + IN.passHW * Math.sin(a)] as [number, number];
      }),
    },
    {
      id: "prison_yard",
      x: YARD_DOOR.x,
      z: YARD_DOOR.z + 0.1,
      dir: 1,
      hw: YARD_DOOR.hw,
      h: YARD_DOOR.spring,
      inner: IN.wing.z0,
      y: 0,
      leaves: 1,
      open: (85 * Math.PI) / 180,
      step: marks.yardStep,
      archTop: Array.from({ length: 9 }, (_, i) => {
        const a = (Math.PI * i) / 8;
        return [YARD_DOOR.hw * Math.cos(a), YARD_DOOR.spring + YARD_DOOR.hw * Math.sin(a)] as [number, number];
      }),
    },
  ],
  area: [
    // (overlapping a little: the area test is strict at its edges)
    R(-1.9, 1.9, -2.4, IN.gateInner + 0.1),
    R(IN.front.x0 - 0.2, IN.front.x1 + 0.2, IN.gateInner, IN.passEnd),
    R(-2.4, 2.4, IN.passEnd - 0.1, IN.linkEnd),
    R(-5.6, 5.6, IN.linkEnd - 0.2, IN.pavZ + IN.pavR + 0.2),
    R(IN.pavR - 0.2, IN.wing.x1 + 0.2, IN.wing.z0 - 0.2, IN.wing.z1 + 0.2),
    R(YARD_DOOR.x - 1.0, YARD_DOOR.x + 1.0, 13.3, IN.wing.z0),
  ],
  // the street before the gate and the yard before its door lie at the street's height
  steps: [
    { rect: R(-IN.passHW, IN.passHW, -2.4, IN.gateFace), y: -FLOOR_Y },
    { rect: R(YARD_DOOR.x - YARD_DOOR.hw, YARD_DOOR.x + YARD_DOOR.hw, 13.3, YARD_DOOR.z), y: -FLOOR_Y },
  ],
  nodes: [
    [0, -1.9], [0, 1.6], [0, 5.6], [-3.4, 5.6], [-6.0, 5.8], [-9.6, 5.8], [3.4, 1.6], [6.8, 2.6], [10.2, 2.6],
    [0, 11.3], [0, 15.2], [-3.2, 19], [3.2, 19], [0, 22.8], [8.5, 19.5], [13.0, 19.5], [18.6, 19.5], [23.5, 19.2],
    [13.0, 16.2], [13.0, 14.2],
  ],
  marks,
  sets: {},
};

/** The exercise yard (local): its own walk area in the street's scene, beyond the yard door. */
export const YARD: HRect[] = [R(12.35, 29.9, 0.6, 14.6), R(2.8, 12.35, 9.0, 14.6)];
/** What stands in the yard (local): the warder's stand, the water butt, the benches, the pavilion's corner. */
export const YARD_SOLIDS: HRect[] = [
  R(PARTS.ring.x - 1.15, PARTS.ring.x + 1.15, PARTS.ring.z - 1.15, PARTS.ring.z + 1.15),
  R(YARD_DOOR.x + 1.85, YARD_DOOR.x + 2.75, 13.65, 14.6),
  R(15.0, 17.0, 0.6, 1.15),
  R(21.0, 23.0, 0.6, 1.15),
  R(2.8, 4.0, 13.2, 14.6),
];
