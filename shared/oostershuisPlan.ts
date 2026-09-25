// The Oostershuis's interior in the world (M7 halls, docs/milestones/M7-halls-inworld.md), fitted inside the
// front wing of the Blender shell of tools/blender/build_landmarks.py hanzehuis(): the State's warehouse in the
// old house of the Hanse. Through the gate in the dock front a vaulted passage runs through the wing to the
// court (its gate barred); on either side a long timber hall on posts under the first floor's joists, stacked
// with sacks, bales, crates and casks: the west hall with the hoist through a hatch in the ceiling, the east
// hall with the decimal scale and the storekeeper's desk by the passage. Pure numbers (shared/hallPlan.ts).
//
// The frame: the gate's plane (the back of its portal, world (120, 123.9)) at z 0, x along the wing (+x is
// world +x: east), z into it (world +z: north, to the court). Not turned. The floor is 0.3 over the quay
// (the portal's two steps).

import type { HallPlan, Level, Mark, Rect } from "./hallPlan.js";

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

/** The shell (build_landmarks.py hanzehuis, frame c (120, 143), L 64, W 38; the wings 10 deep), in the hall's frame. */
export const SHELL = {
  /** The front wing's dock face (v0), its court face (v0 + 10), its ends (u0, u1). */
  front: 0.1,
  court: 10.1,
  halfL: 32,
  /** The eaves, the string course over the ground floor (world). */
  eaves: 16.5,
  groundStorey: 4.4,
  /** The gate: its portal's face (1.2 before the wing), its door 1.1 in; the opening's half width, the lintel. */
  portalFace: -1.1,
  gate: { hw0: 1.6, hw: 1.3, lintel: 3.9, band: 0.62 },
  /** The ground floor's bays (4 m, the arched warehouse doors), not the gate's. */
  bays: Array.from({ length: 16 }, (_, k) => -32 + (k + 0.5) * 4).filter((u) => Math.abs(u) > 3.5),
};

export const FLOOR_Y = 0.3;
/** The ceiling (the first floor's joists under the string course). */
export const CEIL = SHELL.groundStorey - FLOOR_Y - 0.1;
export const IN = { front: 0.9, back: 9.7, west: -31.6, east: 31.6 };
/** The gate passage through the wing, its walls to the halls with a wide opening each side. */
export const PASS = { hw: 2.2, wall: 3.1, open: [3.2, 6.8] as [number, number] };
export const DOOR = { hw: SHELL.gate.hw, h: SHELL.gate.lintel - SHELL.gate.band - FLOOR_Y };

/** The timber posts down the middle of each hall, carrying the beams. */
export const POST_Z = 5.3;
export const POSTS_X = [-28, -23, -18, -13, -8, 8, 13, 18, 23, 28];
/** The hatch in the west hall's ceiling, the hoist under it. */
export const HATCH = { x: -17.5, z: POST_Z };

/** The stacks: [kind, x0, x1, z0, z1]. */
export const STACKS: Array<["sacks" | "bales" | "crates" | "casks", number, number, number, number]> = [
  ["sacks", -30.9, -25.5, 1.3, 3.2],
  ["bales", -30.9, -26.9, 7.2, 9.3],
  ["sacks", -23.4, -19.4, 1.3, 3.2],
  ["bales", -21.6, -15.4, 7.2, 9.3],
  ["sacks", -13.4, -9.4, 7.4, 9.3],
  ["crates", -12.2, -7.6, 1.3, 2.3],
  ["casks", 10.4, 18.4, 8.6, 9.4],
  ["crates", 22.4, 26.0, 1.3, 3.2],
  ["bales", 13.4, 19.6, 1.3, 3.3],
  ["sacks", 24.6, 30.9, 7.4, 9.3],
];
export const SCALE = { x: 5.6, z: 7.8 };
export const DESK = { x: 6.6, z: 2.3 };

const around = (x: number, z: number, hx: number, hz = hx): Rect => R(x - hx, x + hx, z - hz, z + hz);

const level0: Level = {
  y: 0,
  floors: [
    R(-2.3, 2.3, -3.2, -2.0), // the quay before the gate
    R(-2.0, 2.0, -2.0, -1.1), // the portal's lower step
    R(-1.45, 1.45, -1.1, 0.05), // the portal's floor to the gate
    R(-DOOR.hw, DOOR.hw, 0, IN.front + 0.05), // the gateway through the front wall
    R(-PASS.hw, PASS.hw, IN.front, IN.back), // the passage
    R(-PASS.wall - 0.05, -PASS.hw + 0.05, ...PASS.open), // into the west hall
    R(PASS.hw - 0.05, PASS.wall + 0.05, ...PASS.open), // into the east hall
    R(IN.west, -PASS.wall, IN.front, IN.back),
    R(PASS.wall, IN.east, IN.front, IN.back),
  ],
  solids: [
    ...POSTS_X.map((x) => around(x, POST_Z, 0.22)),
    ...STACKS.map(([, x0, x1, z0, z1]) => R(x0, x1, z0, z1)),
    around(SCALE.x, SCALE.z, 0.65),
    R(DESK.x - 0.85, DESK.x + 0.85, DESK.z - 0.4, DESK.z + 0.4),
    around(HATCH.x, HATCH.z, 0.5), // the sack on the hoist, swinging
    // the gate's leaves standing open along the gateway
    R(-DOOR.hw - 0.05, -DOOR.hw + 0.14, 0, 1.35),
    R(DOOR.hw - 0.14, DOOR.hw + 0.05, 0, 1.35),
  ],
};

const marks: Record<string, Mark> = {
  storeDesk: { x: DESK.x, z: DESK.z - 0.8, yaw: 0 },
  /** The step on the quay before the gate: people come in and go out here. */
  door: { x: 0.6, z: -2.5, yaw: 0 },
};
const sets: Record<string, Mark[]> = {
  sackRun: [
    { x: -24.5, z: POST_Z, yaw: -Math.PI / 2 },
    { x: SCALE.x - 1.0, z: SCALE.z - 0.3, yaw: Math.PI / 2 },
    { x: 15.5, z: POST_Z, yaw: Math.PI / 2 },
    { x: -10.5, z: POST_Z, yaw: -Math.PI / 2 },
    { x: 25.5, z: POST_Z, yaw: Math.PI / 2 },
    { x: -15.5, z: POST_Z + 1.2, yaw: 0 },
  ],
};

export const PLAN: HallPlan = {
  id: "oostershuis",
  origin: { x: 120, z: 123.9 },
  yaw: 0,
  floorY: FLOOR_Y,
  levels: [level0],
  stairs: [],
  doors: [{ id: "oostershuis_gate", x: 0, z: 0, dir: 1, hw: DOOR.hw, h: DOOR.h, inner: IN.front, y: 0, leaves: 2, open: (82 * Math.PI) / 180, step: marks.door }],
  area: [R(-2.4, 2.4, -3.3, 0.2), R(-31.9, 31.9, 0, 10.0)],
  steps: [
    { rect: R(-2.3, 2.3, -3.2, -2.0), y: -FLOOR_Y },
    { rect: R(-2.0, 2.0, -2.0, -1.1), y: -FLOOR_Y / 2 },
  ],
  nodes: [
    [0.6, -2.5], [-0.6, -2.5], [0, -0.5], [0, 2.0], [0, 5.0], [0, 8.6],
    [-4.6, 5.0], [-10.5, 5.0], [-15.5, 6.5], [-15.5, 4.1], [-20.5, 5.0], [-24.5, 5.0], [-29, 5.0],
    [4.6, 5.0], [SCALE.x - 1.0, 7.5], [10.5, 5.0], [15.5, 5.0], [20.5, 5.0], [25.5, 5.0], [29, 5.0],
    [9.5, 1.5], [-10.5, 3.4], [-24.5, 6.4],
  ],
  marks,
  sets,
};

/** The hall's walls as boxes (local, for the check that they stand inside the shell). */
export function wallRects(): Rect[] {
  return [
    R(-31.8, 31.8, 0.3, IN.front), // the front wall, the gateway through it
    R(-31.8, 31.8, IN.back, 9.9), // the back wall to the court
    R(-31.8, IN.west, 0.3, 9.9),
    R(IN.east, 31.8, 0.3, 9.9),
  ];
}
