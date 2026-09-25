// The town hall's interior in the world (M7 halls, docs/milestones/M7-halls-inworld.md), fitted inside
// the Blender shell of tools/blender/build_landmarks.py stadhuis(): the vestibule with the porter's
// lodge behind the main door, the old courtyard under its glass roof with the great stair up to the
// landing in the stair block at the back, the clerks' office and the civil registry's counter on the
// right; upstairs, galleries round the court, the wedding hall over the office (its windows on the
// Grote Markt), the aldermen's room behind it, the Leys hall on the left. Pure numbers (shared/hallPlan.ts).
//
// The frame: the main door's plane (the back of Floris's portal, world z 60.69) at z 0, x across
// (+x is world -x: the frame is turned half round, yaw pi, looking into the building from the square),
// z into the building (world -z). The ground floor is 0.3 m over the square (the portal's two steps).

import type { HallPlan, Level, Mark, Rect, Stair } from "./hallPlan.js";

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

/** The shell (build_landmarks.py stadhuis, frame c (-257, 48), L 67.76, W 27.78), in the hall's frame. */
export const SHELL = {
  /** The wings' front face (v = W/2 - 1.3) and the frontispiece's face (v = W/2). */
  face: 0.1,
  frontispiece: -1.2,
  /** Half the body's length (u), the back face (v = -W/2 + 2), the stair block behind it. */
  halfL: 33.88,
  back: 24.58,
  stairBlock: { hw: 8.1, back: 26.58 },
  /** The body's top (lead) over the square, and the ground floor's string course. */
  top: 20.8,
  groundStorey: 7.0,
  /** The main portal: its mouth at the face, the door at its back, the lintel (the fanlight above). */
  portal: { hw0: 1.7, hw: 1.4, lintel: 3.58 },
  /** The side doors of the frontispiece (shut; Blender's leaves). */
  sideDoors: [-3.6, 3.6],
};

export const FLOOR_Y = 0.3;
/** The first floor over the ground floor (the string course at 7.0 over the square). */
export const UP = SHELL.groundStorey - FLOOR_Y;
/** The front wall (its outer face 0.2 behind the shell's), the doorway through it. */
export const FRONT = { z0: 0.3, z1: 1.1 };
export const DOOR = { hw: SHELL.portal.hw, h: SHELL.portal.lintel - FLOOR_Y };

// ---- the rooms (local)
export const VEST = R(-5, 5, FRONT.z1, 8.4);
export const COURT = R(-7.8, 7.8, 8.8, 22.4);
export const OFFICE = R(8.3, 20.2, FRONT.z1, 16.6);
export const LANDING = R(-7.5, 7.5, 22.4, 26.0);
export const WEDDING = R(8.5, 24.2, FRONT.z1, 16.2);
export const ALDERMEN = R(8.5, 20.2, 17.0, 24.2);
export const LEYS = R(-20.2, -8.5, FRONT.z1, 16.2);
/** The court's glass roof and the storeys' ceilings (local y). */
export const GLASS_Y = 19.2;
export const CEIL0 = UP - 0.3;
export const CEIL1 = 13.3;

/** The great stair: up the court's middle to the landing in the stair block. */
export const STAIR: Stair = { rect: R(-2, 2, 11, 22.6), along: "z", foot: 11, head: 22.6, lo: 0, hi: 1, y0: 0, y1: UP, rise: UP / 34 };
/** The arcade's shafts round the court (they carry the galleries). */
export const SHAFTS: Array<[number, number]> = [];
for (const x of [-7.25, 7.25]) for (const z of [10.2, 13.4, 16.6, 19.8]) SHAFTS.push([x, z]);

// ---- the office: the registry's counter, the clerks' desks, the registers, the callers' bench
export const COUNTER = { x0: 12.4, x1: 13.0, z0: 1.6, z1: 13.8 };
export const DESKS: Array<[number, number]> = [[15.5, 4], [15.5, 7.5], [15.5, 11], [18.2, 4], [18.2, 7.5]];
export const BENCH = { x0: 8.8, x1: 12.0, z: 16.2 };
export const LODGE = R(-5, -2.35, FRONT.z1, 5.2);
/** The lodge's glazed side and back (its door at the back, to the vestibule), the porter's desk inside. */
export const LODGE_DOOR = { x0: -3.3, x1: -2.5 };
const LODGE_WALLS: Rect[] = [R(-2.5, -2.3, FRONT.z1, LODGE.maxZ + 0.05), R(LODGE.minX, LODGE_DOOR.x0, LODGE.maxZ - 0.1, LODGE.maxZ + 0.05), R(-4.7, -3.9, 2.5, 3.5)];
export const BOARD = { x: 4.95, z: 4.6 };

// ---- upstairs: the wedding hall's table and rows, the chimneypiece; the Leys hall; the aldermen's desk
export const TABLE = { x: 22.4, z: 8.6 };
export const ROWS_X = [18.4, 17.1, 15.8];
export const ROW_Z = [5.8, 6.6, 7.4, 9.8, 10.6, 11.4];
export const CHIMNEY = { x: 14.5, z: WEDDING.maxZ };
export const CROWN = { x: 17.2, z: 8.6 };
export const LEYS_TABLE = { x: -14.3, z: 8.6 };
export const ALD_DESK = { x: 14.5, z: 21.4 };
/** The facade's bays over the wings (build_landmarks: 22 over the front, the middle four behind the frontispiece). */
export const BAYS_X = Array.from({ length: 22 }, (_, k) => -(-SHELL.halfL + ((k + 0.5) * 2 * SHELL.halfL) / 22)).filter((x) => Math.abs(x) > 6.6);
export const OFFICE_WINDOWS = BAYS_X.filter((x) => x > OFFICE.minX + 1.2 && x < OFFICE.maxX - 1.0);
export const WEDDING_WINDOWS = BAYS_X.filter((x) => x > WEDDING.minX + 1.2 && x < WEDDING.maxX - 1.0);
export const LEYS_WINDOWS = BAYS_X.filter((x) => x < LEYS.maxX - 1.2 && x > LEYS.minX + 1.0);

const around = (x: number, z: number, hx: number, hz = hx): Rect => R(x - hx, x + hx, z - hz, z + hz);

const level0: Level = {
  y: 0,
  floors: [
    R(-2.2, 2.2, -3.0, -2.1), // the square before the portal
    R(-2.1, 2.1, -2.1, -1.2), // the portal's lower step
    R(-1.5, 1.5, -1.2, 0.05), // the portal's floor to the door
    R(-DOOR.hw, DOOR.hw, 0, FRONT.z1 + 0.05), // the doorway
    VEST,
    R(-2.4, 2.4, VEST.maxZ - 0.1, COURT.minZ + 0.1), // the arch into the court
    COURT,
    R(7.7, 8.4, 10.5, 13.5), // into the office
    OFFICE,
  ],
  solids: [
    // the stair over the court's floor (its foot is walked onto), the lodge, the board
    R(STAIR.rect.minX - 0.15, STAIR.rect.maxX + 0.15, STAIR.foot + 0.5, COURT.maxZ + 0.2),
    ...LODGE_WALLS,
    R(4.8, 5.0, 3.2, 6.0),
    ...SHAFTS.map(([x, z]) => around(x, z, 0.22)),
    // the office: the counter, the desks, the registers, the bench
    R(COUNTER.x0, COUNTER.x1, COUNTER.z0, COUNTER.z1),
    ...DESKS.map(([x, z]) => R(x - 0.65, x + 0.65, z - 0.35, z + 0.35)),
    R(19.6, OFFICE.maxX, 1.6, 15.8),
    R(BENCH.x0, BENCH.x1, BENCH.z - 0.3, OFFICE.maxZ),
    // the main door's leaves standing open along the reveal
    R(-1.45, -1.27, 0, 1.45),
    R(1.27, 1.45, 0, 1.45),
  ],
};

const level1: Level = {
  y: UP,
  floors: [
    LANDING,
    R(5.9, 7.5, 9.0, 22.6), // the galleries round the court
    R(-7.5, -5.9, 9.0, 22.6),
    R(-7.5, 7.5, 9.0, 10.4),
    R(7.4, 8.6, 12.2, 14.2), // into the wedding hall
    WEDDING,
    R(7.4, 8.6, 19.2, 21.2), // into the aldermen's room
    ALDERMEN,
    R(-8.6, -7.4, 12.2, 14.2), // into the Leys hall
    LEYS,
  ],
  solids: [
    R(TABLE.x - 0.7, TABLE.x + 0.7, TABLE.z - 2.2, TABLE.z + 2.2),
    R(CHIMNEY.x - 1.4, CHIMNEY.x + 1.4, CHIMNEY.z - 0.6, CHIMNEY.z),
    ...ROWS_X.flatMap((x) => [R(x - 0.25, x + 0.25, ROW_Z[0] - 0.25, ROW_Z[2] + 0.25), R(x - 0.25, x + 0.25, ROW_Z[3] - 0.25, ROW_Z[5] + 0.25)]),
    R(LEYS_TABLE.x - 0.6, LEYS_TABLE.x + 0.6, LEYS_TABLE.z - 2.5, LEYS_TABLE.z + 2.5),
    R(ALD_DESK.x - 0.9, ALD_DESK.x + 0.9, ALD_DESK.z - 0.4, ALD_DESK.z + 0.4),
    R(ALDERMEN.minX + 0.5, ALDERMEN.maxX, ALDERMEN.maxZ - 0.45, ALDERMEN.maxZ), // shelves on the back wall
  ],
};

/** The marks and sets (the old room's, moved to their places here). */
const U = UP;
const marks: Record<string, Mark> = {
  lodge: { x: -3.7, z: 3.0, yaw: Math.PI / 2 },
  registrar: { x: 13.6, z: 8.0, yaw: -Math.PI / 2 },
  counter: { x: 11.9, z: 8.0, yaw: Math.PI / 2 },
  alderman: { x: ALD_DESK.x, z: ALD_DESK.z + 0.9, yaw: Math.PI, y: U },
  weddingTable: { x: TABLE.x + 1.0, z: TABLE.z, yaw: -Math.PI / 2, y: U },
  weddingClerk: { x: TABLE.x + 1.0, z: TABLE.z - 1.6, yaw: -Math.PI / 2, y: U },
  cGroom: { x: 20.4, z: TABLE.z - 0.55, yaw: Math.PI / 2, y: U },
  cBride: { x: 20.4, z: TABLE.z + 0.55, yaw: Math.PI / 2, y: U },
  board: { x: 4.2, z: BOARD.z, yaw: Math.PI / 2 },
  /** The step on the square before the main door: people come in and go out here. */
  door: { x: 0.7, z: -2.35, yaw: 0 },
};
const weddingChairs: Mark[] = [];
for (const x of ROWS_X) for (const z of ROW_Z) weddingChairs.push({ x: x + 0.02, z, yaw: Math.PI / 2, y: U });
const sets: Record<string, Mark[]> = {
  desks: DESKS.map(([x, z]) => ({ x, z: z - 0.75, yaw: 0 })),
  bench: [9.3, 10.4, 11.5].map((x) => ({ x, z: BENCH.z - 0.05, yaw: Math.PI })),
  witnesses: [
    { x: 20.4, z: TABLE.z - 1.9, yaw: Math.PI / 2, y: U },
    { x: 20.4, z: TABLE.z + 1.9, yaw: Math.PI / 2, y: U },
  ],
  weddingChairs,
};

export const PLAN: HallPlan = {
  id: "townhall",
  origin: { x: -257, z: 60.69 },
  yaw: Math.PI,
  floorY: FLOOR_Y,
  levels: [level0, level1],
  stairs: [STAIR],
  doors: [{ id: "townhall_main", x: 0, z: 0, dir: 1, hw: DOOR.hw, h: DOOR.h, inner: FRONT.z1, y: 0, leaves: 2, open: (85 * Math.PI) / 180, step: marks.door }],
  area: [R(-2.3, 2.3, -3.0, 0.2), R(-24.7, 24.7, 0, 24.4), R(-7.9, 7.9, 24.3, 26.4)],
  steps: [
    { rect: R(-2.2, 2.2, -3.0, -2.1), y: -FLOOR_Y },
    { rect: R(-2.1, 2.1, -2.1, -1.2), y: -FLOOR_Y / 2 },
  ],
  // behind the counter is the clerks' (they come round its end); Jef stays on the callers' side
  jefOnly: [R(COUNTER.x0, COUNTER.x1 + 0.4, COUNTER.z1, OFFICE.maxZ), R(LODGE_DOOR.x0, LODGE_DOOR.x1, LODGE.maxZ - 0.15, LODGE.maxZ + 0.1)],
  nodes: [
    [0.7, -2.35], [-0.7, -2.35], [0.5, -0.6], [-0.5, -0.6], [0.5, 2.4], [-0.5, 2.4], [0, 5.5], [0, 8.6], [-3.5, 7], [3.5, 7],
    [0, 10.2], [-4.5, 10.2], [4.5, 10.2], [-4.5, 16], [4.5, 16], [-4.5, 21.6], [4.5, 21.6], [6.3, 12], [9.2, 12], [10.6, 5],
    [10.6, 9], [10.6, 14.8], [13.8, 15.2], [13.8, 12.5], [13.8, 9.2], [13.8, 5.6], [13.8, 2.4], [16.85, 2.4], [16.85, 5.6], [16.85, 9.2], [16.85, 12.8],
  ],
  marks,
  sets,
};

/** The hall's walls as boxes (local, for the check that they stand inside the shell). */
export function wallRects(): Rect[] {
  return [
    R(-24.6, 24.6, FRONT.z0, FRONT.z1), // the front wall with the doorway and the windows
    R(24.2, 24.6, FRONT.z0, 16.6), // the wedding hall's far wall
    R(20.2, 20.6, 16.6, 24.38), // the aldermen's room's far wall and the office's
    R(-20.6, -20.2, FRONT.z0, 16.6),
    R(8.5, 20.6, 24.2, 24.38), // the aldermen's room's back wall
    R(-7.9, 7.9, 26.0, 26.38), // the landing's back wall in the stair block
    R(-7.9, -7.5, 22.4, 26.38),
    R(7.5, 7.9, 22.4, 26.38),
  ];
}
