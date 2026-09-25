// The Vleeshuis's interior in the world (M7 halls, docs/milestones/M7-halls-inworld.md), fitted inside the
// Blender shell of tools/blender/build_landmarks.py vleeshuis2(): Peyrot's wine warehouse in the old meat
// hall of 1504 (three aisles of brick vaults on stone columns, casks in racks, the cellar master's desk by
// the south door, the hoist by the north door), and over the vaults the theatre hall of the society Liefde
// en Eendragt (the stage at the east end) and a painter's studio at the west end, up a long stair along
// the north wall. Pure numbers (shared/hallPlan.ts).
//
// The frame: the south door's plane (the back of its reveal, world (-121.95, 92.4)) at z 0, x along the
// building (+x is world +x: west, toward the Scheldt), z into it (world +z: north). Not turned. The floor
// is 0.16 over the street (the doorstep's top).

import type { HallPlan, Level, Mark, Rect, Stair } from "./hallPlan.js";

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

/** The shell (build_landmarks.py vleeshuis2, frame c (-116, 99): u -22.2..22.2, v -7.5..9.0), in the hall's frame. */
export const SHELL = {
  /** The long sides' faces (v0, v1) and the gables' (u0 the east front, u1 the west gable). */
  south: -0.9,
  north: 15.6,
  east: -16.25,
  west: 28.15,
  /** The eaves, the drip course between the two storeys (world). */
  eaves: 16.8,
  dripCourse: 9.6,
  /** The long sides' doors: basket arches 1.8 wide, 3.36 high (springing at 0.76 of it), 0.9 deep. */
  door: { hw: 0.9, h: 3.36, spring: 0.76 * 3.36, depth: 0.9 },
  north_door_x: 6.3,
  /** The east front's two doors (shut; Blender's), and the bays' middles along the long sides (local x). */
  eastDoors: [3.9, 11.0],
  bays: [-11.9, -6.25, 0, 6.3, 12.55, 18.7, 24.05],
};

export const FLOOR_Y = 0.16;
/** The upper floor (the drip course at 9.6 over the street, a little over it inside). */
export const UP = 10.0 - FLOOR_Y;
/** The walls' inner faces: south (the doorway runs through it), north, east, west. */
export const IN = { south: 0.6, north: 14.1, east: -15.4, west: 27.4 };
/** The vaults over the ground floor: spring, the apex under the upper floor's slab. */
export const VAULT = { spring: 5.0, rise: 3.6 };
export const CEIL1 = 15.6;

/** The columns under the vaults: two rows, the aisles 4.5 m wide. */
export const COL_Z = [5.1, 9.6];
export const COL_X = [-12.8, -7.6, -2.4, 2.8, 8.0, 13.2, 18.4, 23.6];

/** The long stair along the north wall, rising east from the west end to the landing. */
export const STAIR: Stair = { rect: R(11, 26, 12.3, 14.1), along: "x", foot: 26, head: 11, lo: 0, hi: 1, y0: 0, y1: UP, rise: UP / 50 };

// ---- the ground floor: racks of casks along the walls and the column lines, the desk, the tasting table
/** Stillages of casks: [x0, x1, z] (z the rack's middle), each 1.1 deep. */
export const RACKS: Array<[number, number, number]> = [
  [-14.9, -5.2, 1.2], // along the south wall, east of the door
  [1.8, 4.2, 1.2],
  [9.2, 26.9, 1.2], // west of the door and the desk
  [-14.9, 4.4, 13.5], // along the north wall, east of the north door
  [8.2, 10.4, 13.5],
  // along the column lines, a bay's gap every other bay to cross the hall
  [-12.2, -8.2, 5.1], [-1.8, 2.2, 5.1], [8.6, 12.6, 5.1], [19.0, 23.0, 5.1],
  [-7.0, -3.0, 9.6], [3.4, 7.4, 9.6], [13.8, 17.8, 9.6],
];
export const DESK = { x: 5.8, z: 1.4 };
export const TASTING = { x: -9.0, z: 3.3 };
export const BOTTLES: Rect[] = [R(-15.4, -14.9, 5.2, 9.6)];
export const HOIST = { x: 8.6, z: 12.4 };

// ---- upstairs: the theatre (its stage at the east end), the landing, the studio
export const STAGE = { x0: IN.east, x1: -10.2, up: 0.8 };
export const THEATRE = R(-9.9, 7.9, IN.south, IN.north);
export const LANDING = R(8.3, 11.2, IN.south, IN.north);
/** The doorways off the landing: into the theatre, into the studio (z from, to). */
export const THEATRE_DOOR: [number, number] = [6.3, 8.3];
export const STUDIO_DOOR: [number, number] = [5.5, 7.5];
export const STUDIO = R(11.4, IN.west, IN.south, 11.9);
export const BENCH_X = Array.from({ length: 13 }, (_, i) => -8.8 + i * 1.25);
export const BENCH_Z: Array<[number, number]> = [[1.6, 6.8], [7.9, 13.1]];

const around = (x: number, z: number, hx: number, hz = hx): Rect => R(x - hx, x + hx, z - hz, z + hz);

const DOOR = SHELL.door;
/** The basket arch over the doors' leaves (build_landmarks.py DOOR4), from the right springing to the left. */
const ARCH: Array<[number, number]> = ([[1, 0.76], [0.9, 0.9], [0.7, 0.98], [0.5, 1], [0.3, 0.98], [0.1, 0.9], [0, 0.76]] as Array<[number, number]>).map(([f, t]) => [(f - 0.5) * 2 * DOOR.hw, t * DOOR.h - FLOOR_Y]);
const level0: Level = {
  y: 0,
  floors: [
    R(-1.5, 1.5, -4.6, -1.25), // the street before the south door
    R(-DOOR.hw - 0.05, DOOR.hw + 0.05, -1.25, IN.south + 0.05), // the doorstep in the reveal, the doorway
    R(IN.east, IN.west, IN.south, IN.north), // the wine hall
    R(SHELL.north_door_x - DOOR.hw - 0.05, SHELL.north_door_x + DOOR.hw + 0.05, IN.north - 0.05, 15.95), // the north doorway, its step
    R(SHELL.north_door_x - 1.5, SHELL.north_door_x + 1.5, 15.95, 18.2), // the street before the north door
  ],
  solids: [
    ...COL_Z.flatMap((z) => COL_X.map((x) => around(x, z, 0.45))),
    ...RACKS.map(([x0, x1, z]) => R(x0, x1, z - 0.55, z + 0.55)),
    around(DESK.x, DESK.z, 0.65, 0.35),
    R(TASTING.x - 2.0, TASTING.x + 0.9, TASTING.z - 0.45, TASTING.z + 0.45),
    ...BOTTLES,
    around(HOIST.x, HOIST.z, 0.2),
    // the stair over the floor (its foot is walked onto)
    R(STAIR.rect.minX, STAIR.head < STAIR.foot ? STAIR.foot - 0.5 : STAIR.rect.maxX, STAIR.rect.minZ - 0.15, STAIR.rect.maxZ),
    // the leaves of both doors standing open along their reveals
    R(-DOOR.hw - 0.05, -DOOR.hw + 0.14, 0, 0.95),
    R(DOOR.hw - 0.14, DOOR.hw + 0.05, 0, 0.95),
    R(SHELL.north_door_x - DOOR.hw - 0.05, SHELL.north_door_x - DOOR.hw + 0.14, 13.75, 14.7),
    R(SHELL.north_door_x + DOOR.hw - 0.14, SHELL.north_door_x + DOOR.hw + 0.05, 13.75, 14.7),
  ],
};

const level1: Level = {
  y: UP,
  floors: [
    THEATRE,
    R(7.8, 8.4, ...THEATRE_DOOR), // theatre - landing
    LANDING,
    R(11.1, 11.5, ...STUDIO_DOOR), // landing - studio
    STUDIO,
  ],
  solids: [
    ...BENCH_X.flatMap((x) => BENCH_Z.map(([z0, z1]) => R(x - 0.18, x + 0.18, z0, z1))),
    R(24.6, 27.4, 1.6, 3.8), // the model's dais
    R(16.6, 18.2, 1.2, 2.2), // the table of pots
    R(26.6, 27.4, 8.0, 9.6), // the stove
  ],
};

const U = UP;
const marks: Record<string, Mark> = {
  cellarDesk: { x: DESK.x, z: DESK.z + 0.75, yaw: Math.PI },
  easel: { x: 22.6, z: 6.5, yaw: Math.PI / 2, y: U },
  prompter: { x: -9.4, z: 7.35, yaw: -Math.PI / 2, y: U },
  /** The step before the south door: people come in and go out here. */
  door: { x: 0.5, z: -2.2, yaw: 0 },
};
const theatreSeats: Mark[] = [];
for (const x of BENCH_X) for (const [z0, z1] of BENCH_Z) for (let z = z0 + 0.35; z < z1 - 0.2; z += 0.62) theatreSeats.push({ x, z, yaw: -Math.PI / 2, y: U });
theatreSeats.sort((a, b) => b.x - a.x);
const sets: Record<string, Mark[]> = {
  barrelRun: [
    { x: -12, z: 3.0, yaw: -Math.PI / 2 },
    { x: 24, z: 3.0, yaw: Math.PI / 2 },
    { x: 20, z: 7.35, yaw: Math.PI / 2 },
    { x: -10, z: 7.35, yaw: -Math.PI / 2 },
    { x: -12, z: 11.6, yaw: -Math.PI / 2 },
    { x: 8.0, z: 11.4, yaw: 0 },
  ],
  stage: [
    { x: -11.6, z: 5.6, yaw: Math.PI / 2, y: U + STAGE.up },
    { x: -12.0, z: 7.35, yaw: Math.PI / 2, y: U + STAGE.up },
    { x: -11.6, z: 9.1, yaw: Math.PI / 2, y: U + STAGE.up },
    { x: -13.4, z: 6.4, yaw: Math.PI / 2, y: U + STAGE.up },
    { x: -13.4, z: 8.3, yaw: Math.PI / 2, y: U + STAGE.up },
    { x: -10.8, z: 7.35, yaw: Math.PI / 2, y: U + STAGE.up },
  ],
  theatreSeats,
};

export const PLAN: HallPlan = {
  id: "vleeshuis",
  origin: { x: -121.95, z: 92.4 },
  yaw: 0,
  floorY: FLOOR_Y,
  levels: [level0, level1],
  stairs: [STAIR],
  doors: [
    { id: "vleeshuis_main", x: 0, z: 0, dir: 1, hw: DOOR.hw, h: DOOR.spring - FLOOR_Y, inner: IN.south, y: 0, leaves: 2, open: (80 * Math.PI) / 180, step: marks.door, archTop: ARCH },
    { id: "vleeshuis_north", x: SHELL.north_door_x, z: 14.7, dir: -1, hw: DOOR.hw, h: DOOR.spring - FLOOR_Y, inner: IN.north, y: 0, leaves: 2, open: (80 * Math.PI) / 180, step: { x: SHELL.north_door_x - 0.5, z: 16.9, yaw: Math.PI }, archTop: ARCH },
  ],
  area: [R(-1.6, 1.6, -4.7, 0.1), R(-16.1, 28.0, -0.8, 15.5), R(SHELL.north_door_x - 1.6, SHELL.north_door_x + 1.6, 15.4, 18.3)],
  steps: [
    { rect: R(-1.5, 1.5, -4.6, -1.25), y: -FLOOR_Y },
    { rect: R(SHELL.north_door_x - 1.5, SHELL.north_door_x + 1.5, 15.95, 18.2), y: -FLOOR_Y },
  ],
  nodes: [
    [0.5, -2.2], [-0.5, -2.2], [0, -0.6], [0, 1.6], [0, 3.0], [-4, 3.0], [-12, 3.0], [8, 3.0], [16, 3.0], [24, 3.0],
    [0, 7.35], [-10, 7.35], [-5.2, 7.35], [5.4, 7.35], [10.6, 7.35], [16, 7.35], [20, 7.35], [25.6, 7.35],
    [-12, 11.6], [-4, 11.6], [0.6, 11.6], [6.3, 11.6], [8.0, 11.4], [10.8, 11.0], [16, 11.2], [25.8, 11.4],
    [6.3, 13.3], [6.3, 15.4], [5.8, 16.9], [6.8, 16.9],
    // across the rows where they are broken
    [-5.2, 5.1], [-0.2, 9.6], [5.4, 5.1], [10.6, 9.6], [15.8, 5.1], [20.9, 9.6],
  ],
  marks,
  sets,
};

/** The hall's walls as boxes (local, for the check that they stand inside the shell). */
export function wallRects(): Rect[] {
  return [
    R(-16.05, 27.95, 0, IN.south), // the south wall (the doorway through it), from the door's plane in
    R(-16.05, 27.95, IN.north, 14.7), // the north wall
    R(-16.05, IN.east, -0.7, 15.4), // the east front
    R(IN.west, 27.95, -0.7, 15.4), // the west gable
  ];
}
