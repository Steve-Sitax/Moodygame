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
// Issue #10 (the shell's windows are real, shared/stadhuisShell.ts): the rooms' side walls stand on the piers between
// the shell's bays, never across a window. The wings' first bays either side of the frontispiece (x 7.7) belong to the
// middle part (MID: the wall on the pier at 9.24), so the office, the wedding hall and the Leys hall start there in
// front of the court (their back parts reach the court's wall at 8.5 as before).
export const MID = { x0: 9.04, x1: 9.44 };
export const VEST = R(-5, 5, FRONT.z1, 8.4);
export const COURT = R(-7.8, 7.8, 8.8, 22.4);
export const OFFICE = R(8.5, 21.36, FRONT.z1, 16.6);
export const LANDING = R(-7.5, 7.5, 22.4, 26.0);
export const WEDDING = R(8.5, 24.2, FRONT.z1, 16.2);
export const ALDERMEN = R(8.5, 21.36, 17.0, 24.2);
export const LEYS = R(-21.36, -8.5, FRONT.z1, 16.2);
/** The rooms' floors: in front of the court from the middle part's wall, behind it from the court's wall. */
const inFront = (r: Rect, s: 1 | -1): Rect[] =>
  s > 0 ? [R(MID.x1, r.maxX, r.minZ, 8.8), R(r.minX, r.maxX, 8.8, r.maxZ)] : [R(r.minX, -MID.x1, r.minZ, 8.8), R(r.minX, r.maxX, 8.8, r.maxZ)];
export const OFFICE_FLOORS = inFront(OFFICE, 1);
export const WEDDING_FLOORS = inFront(WEDDING, 1);
export const LEYS_FLOORS = inFront(LEYS, -1);
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

// ---- issue #10: every part behind the shell's windows, storey by storey (local; y of each storey's floor and ceiling)
/** The storeys' floors and ceilings (local y): the ground floor, the Doric storey, the Ionic storey, the room under the frontispiece's cornice. */
export const LEVEL_Y = [0, UP, 13.6, 20.5];
export const CEIL = [UP - 0.3, 13.3, 20.1, 23.8];
/** The inner faces of the outer walls (the linings behind the shell's faces): the wings' front, the sides (|x|), the back, the stair block's back; the frontispiece's rooms. */
export const INNER = { front: 0.8, side: 33.18, back: 24.2, block: 26.0, fronti: -0.3, frontiX: 5.85, frontiBack: 1.6 };
/** The locked offices' walls: the partitions every two bays (|x|), the front and back strips' inner walls (z), the sides' strip (|x|) and its partition (z). */
export const LINES = { x: [15.4, 21.56, 27.72], front: 6.22, back: 18.46, side: 27.72, sideSplit: 12.34 };

/** A part of the town hall behind its windows: a room of the hall (walked) or a locked office (seen, not walked). */
export interface Part {
  id: string;
  label: string;
  /** Its storey (LEVEL_Y). */
  level: number;
  rects: Rect[];
  locked: boolean;
  /** Which face of the building it lies on (one kit each: world/landmarkHalls.ts). */
  side: "front" | "back" | "left" | "right" | "middle";
}

const LEVEL_NAME = ["the ground floor", "the first floor", "the second floor", "under the frontispiece's cornice"];
/** The rooms of a strip from `from` to `to` (|x|), split at the partition lines past it (0.2 m walls). */
const cellsX = (from: number, lines: number[], to: number): Array<[number, number]> => {
  const out: Array<[number, number]> = [];
  let a = from;
  for (const l of lines) {
    if (l <= a + 1) continue;
    out.push([a, l - 0.1]);
    a = l + 0.1;
  }
  out.push([a, to]);
  return out;
};

function lockedParts(): Part[] {
  const out: Part[] = [];
  const add = (id: string, label: string, level: number, rects: Rect[], side: Part["side"]) => out.push({ id, label, level, rects, locked: true, side });
  const sr = (s: 1 | -1, a: number, b: number, z0: number, z1: number) => (s > 0 ? R(a, b, z0, z1) : R(-b, -a, z0, z1));
  for (const s of [1, -1] as const) {
    const sideName = s > 0 ? "left" : "right";
    for (let L = 0; L <= 2; L++) {
      // the front strip: from the last room of the hall (or the middle part's wall) to the corner
      const frontFrom = L === 0 ? (s > 0 ? OFFICE.maxX + 0.4 : MID.x1) : L === 1 ? (s > 0 ? WEDDING.maxX + 0.4 : -LEYS.minX + 0.4) : MID.x1;
      cellsX(frontFrom, LINES.x, INNER.side).forEach(([a, b], i, all) =>
        add(`front_${sideName}_${L}_${i}`, `an office on ${LEVEL_NAME[L]}, the Grote Markt front's ${sideName} wing${i === all.length - 1 ? ", the corner" : ""}`, L, [sr(s, a, b, INNER.front, LINES.front - 0.1)], "front"));
      // the side's strip between the front's and the back's
      add(`side_${sideName}_${L}_0`, `an office on ${LEVEL_NAME[L]}, the ${sideName} side`, L, [sr(s, LINES.side + 0.1, INNER.side, LINES.front + 0.1, LINES.sideSplit - 0.1)], s > 0 ? "left" : "right");
      add(`side_${sideName}_${L}_1`, `an office on ${LEVEL_NAME[L]}, the ${sideName} side`, L, [sr(s, LINES.side + 0.1, INNER.side, LINES.sideSplit + 0.1, LINES.back - 0.1)], s > 0 ? "left" : "right");
      // the back strip: from the aldermen's room (the first floor, left) or the middle part's wall to the corner
      const backFrom = L === 1 && s > 0 ? ALDERMEN.maxX + 0.4 : MID.x1;
      cellsX(backFrom, LINES.x, INNER.side).forEach(([a, b], i, all) =>
        add(`back_${sideName}_${L}_${i}`, `an office on ${LEVEL_NAME[L]}, the back's ${sideName} half${i === all.length - 1 ? ", the corner" : ""}`, L, [sr(s, a, b, LINES.back + 0.1, INNER.back)], "back"));
    }
    // the ground floor's small rooms beside the vestibule, behind the wings' first arches
    add(`beside_${sideName}`, `a small office beside the vestibule (${sideName})`, 0, [sr(s, 5.4, MID.x0, INNER.front, VEST.maxZ)], "middle");
  }
  // over the vestibule: the burgomaster's cabinet behind the balcony, the room over it; the room under the frontispiece's
  // cornice; the room over the landing in the stair block
  const fr = R(-INNER.frontiX, INNER.frontiX, INNER.fronti, INNER.front);
  add("cabinet", "the burgomaster's cabinet, behind the balcony", 1, [R(-MID.x0, MID.x0, INNER.front, VEST.maxZ), fr], "middle");
  add("cabinet_above", "the archive over the burgomaster's cabinet", 2, [R(-MID.x0, MID.x0, INNER.front, VEST.maxZ), fr], "middle");
  add("fronti_top", "the small room under the frontispiece's cornice", 3, [R(-INNER.frontiX, INNER.frontiX, INNER.fronti, INNER.frontiBack)], "middle");
  add("block_above", "the room over the landing, in the stair block", 2, [R(-7.5, 7.5, 22.8, INNER.block)], "back");
  return out;
}

/** Every part behind the shell's windows: the hall's rooms (walked) and the locked offices. */
export const PARTS: Part[] = [
  { id: "vestibule", label: "the vestibule and the porter's lodge", level: 0, rects: [VEST], locked: false, side: "middle" },
  { id: "office", label: "the clerks' office", level: 0, rects: OFFICE_FLOORS, locked: false, side: "middle" },
  { id: "wedding", label: "the wedding hall", level: 1, rects: WEDDING_FLOORS, locked: false, side: "middle" },
  { id: "aldermen", label: "the aldermen's room", level: 1, rects: [ALDERMEN], locked: false, side: "middle" },
  { id: "leys", label: "the Leys hall", level: 1, rects: LEYS_FLOORS, locked: false, side: "middle" },
  { id: "landing", label: "the landing in the stair block", level: 1, rects: [LANDING], locked: false, side: "middle" },
  ...lockedParts(),
];

/** The part a point (local x, z; local y) lies in, if any. */
export function partAt(x: number, z: number, y: number): Part | undefined {
  let level = 0;
  for (let i = 0; i < LEVEL_Y.length; i++) if (y >= LEVEL_Y[i] - 0.05) level = i;
  return PARTS.find((p) => p.level === level && p.rects.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ));
}

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
    R(7.7, 8.6, 10.5, 13.5), // into the office
    ...OFFICE_FLOORS,
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
    R(OFFICE.maxX - 0.6, OFFICE.maxX, 1.6, 15.8),
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
    ...WEDDING_FLOORS,
    R(7.4, 8.6, 19.2, 21.2), // into the aldermen's room
    ALDERMEN,
    R(-8.6, -7.4, 12.2, 14.2), // into the Leys hall
    ...LEYS_FLOORS,
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

/** The hall's walls as boxes (local, for the check that they stand inside the shell; the linings behind the shell's faces are the shell's own). */
export function wallRects(): Rect[] {
  return [
    R(WEDDING.maxX, WEDDING.maxX + 0.4, FRONT.z0, 16.6), // the wedding hall's far wall
    R(OFFICE.maxX, OFFICE.maxX + 0.4, FRONT.z0, 24.38), // the office's and the aldermen's room's far walls
    R(LEYS.minX - 0.4, LEYS.minX, FRONT.z0, 16.6),
    R(MID.x0, MID.x1, FRONT.z0, 8.8), // the middle part's walls
    R(-MID.x1, -MID.x0, FRONT.z0, 8.8),
    R(-7.9, -7.5, 22.4, 26.38), // the landing's side walls in the stair block
    R(7.5, 7.9, 22.4, 26.38),
  ];
}
