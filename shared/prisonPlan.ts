// The prison of 1855 (M7 prison and squares, docs/milestones/M7-prison-squares.md): its frame, its parts and its
// hours, read by the server (who is where, when the gate opens: server/src/town/prison.ts) and the client (the
// shell world/prison.ts, the hall world/prisonHall.ts). Pure numbers (and the shell's generated opening list).
//
// The frame is tools/city/places.py's (shared/townplaces.json "prison"; server/test/prison.test.ts checks they
// agree): local x along the front (world -z), local z into the compound (world +x), the gate's middle at (0, 0).
// World = origin + (x cos yaw + z sin yaw, -x sin yaw + z cos yaw), as shared/hallPlan.ts.

import type { HallPlan, Mark, Rect as HRect } from "./hallPlan.js";
import type { ShellOpening } from "./shellOpening.js";

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
// M7 prison real (2026-09-26, docs/milestones/M7-prison-real.md; Steve: "Never do instanced, always go real"): every
// part the shell shows has its inside, at the shell's true size, in the prison's frame, the halls' way
// (shared/hallPlan.ts, world/hallInWorld.ts). The shell's real openings are tools/blender/build_prison.py's
// (shared/prisonShell.ts): the rooms' walls are cut where they are, and each is an opening of its room.
//
// Three rooms in the world:
//  - the prison: the gate passage, the guard room, the visitors' room, the offices over them (the director's and the
//    clerk's rooms west, the registry and the doctor's room east) and the records room in the gate tower over the
//    passage (its clock room over it, locked), the link with its stair and the landing over it, the watch pavilion
//    with its two galleries, and both cell wings: the corridor open to the roof lights, three storeys of cells either
//    side (every cell built, two open in each wing, the rest seen through their windows and their door's judas),
//    iron galleries and bridges, a scissor stair in each wing, a door to the yard (wing A: the exercise yard, wing B:
//    the west court and the chapel);
//  - the chapel in the west court (its door, the prisoners' stalls, the altar in the apse);
//  - the governor's house on the street (his own: its doors stay shut; its rooms show through every window).
// The floor is FLOOR_Y over the street (a stone threshold, and never in one plane with the ground through the gate).
//
// Heights: the plans' y is over their floor (the prison's 0.1, the chapel's 0.2, the governor's 0.62); zones (the
// parts of the building, for the check and for which openings can be seen from where) are in world metres.

const R = (minX: number, maxX: number, minZ: number, maxZ: number): HRect => ({ minX, maxX, minZ, maxZ });
const mx = (r: HRect): HRect => R(-r.maxX, -r.minX, r.minZ, r.maxZ);

/** The hall's floor over the street (world y). */
export const FLOOR_Y = 0.1;
/** The storeys over the prison's floor: the ground, the first and second gallery (the cells' floors), the offices, the records room. */
export const LV = { ground: 0, g1: 3.6, g2: 7.2, office: 4.2, tower: 5.0 } as const;
/** The hall's lines (local metres). */
export const IN = {
  /** The tower's front wall (the gate's reveal), the passage's half width and its end (the tower's back). */
  gateFace: -0.6,
  gateInner: 0.4,
  passHW: 1.7,
  passWall: 2.3,
  passEnd: 9.0,
  /** The front building's rooms (inner faces); the partitions between the offices over them. */
  front: { x0: -11.4, x1: 11.4, z0: 0.65, z1: 8.4 },
  officeWall: 8.35,
  /** The records room in the gate tower (over the passage's vault), the clock room over it. */
  tower: { x: 3.9, z0: 0.1, z1: 8.7, clockX: 3.6, clockZ0: -0.3, clockZ1: 8.4, clockFloor: 9.9, top: 13.2 },
  /** The visitors' side ends at the grille; the gangway between the two grilles; the prisoners' side behind. */
  grille1: 3.5,
  grille2: 4.5,
  /** The link: its half width (the shell's 2.8 less its 0.6 wall), the pavilion's outer face, its inner face. */
  linkHW: 2.2,
  linkZ1: 13.09,
  linkEnd: 13.64,
  /** The pavilion's inner apothem round (0, 19); its galleries' width; its ceiling. */
  pavR: 5.36,
  pavZ: 19,
  pavGalleryW: 1.4,
  pavTop: 17.5,
  /** A wing inside (wing A; wing B is its mirror): the cells' inner faces, the corridor, the far end, the pavilion's wall. */
  wing: { z0: 15.2, z1: 23.8, corrS: 17.8, corrN: 21.2, x1: 27.8, xa: 5.51 },
  /** The galleries over the corridor (their floors' heights, their width off each side). */
  galleries: [3.6, 7.2],
  galleryW: 1.0,
  /** The cells: 3.3 high, the slab over each 0.3. */
  cellH: 3.3,
  /** The scissor stair in the corridor's middle: its strip, its foot and its head (wing A). */
  stair: { z0: 19.0, z1: 20.0, x0: 20.0, x1: 23.6 },
  /** The link's stair up to the landing over it (along its east wall), and the steps up into the records room. */
  linkStair: { x0: 1.3, x1: 2.2, z0: 9.6, z1: 13.0 },
  towerSteps: { x0: -0.6, x1: 0.6, z0: 9.02, z1: 10.8 },
  /** Kept for the old readers (the barrel vault of the old wing): the top cells' ceiling. */
  vaultSpring: 10.5,
} as const;
/** The cells' middles along the wing (local x), 2.8 m apart; a cell is 2.5 wide inside (the last is cut by the end wall). */
export const CELLS = [7.4, 10.2, 13.0, 15.8, 18.6, 21.4, 24.2, 27.0];
export const CELL_HW = 1.25;
/** The open cells (wing, x as wing A's, north or south row, on the ground floor). */
export const OPEN_CELLS: Array<{ wing: "A" | "B"; x: number; row: "N" | "S" }> = [
  { wing: "A", x: 10.2, row: "N" },
  { wing: "A", x: 18.6, row: "S" },
  { wing: "B", x: 15.8, row: "N" },
  { wing: "B", x: 21.4, row: "S" },
];
/** The yard doors: wing A's to the exercise yard, wing B's (at -x) to the west court. */
export const YARD_DOOR = { x: 13.0, hw: 0.8, spring: 1.7, z: 14.6 } as const;

/** A cell's inside (local): wing, row, storey 0..2, index 0..7 along the wing. */
export function cellBox(wing: "A" | "B", row: "N" | "S", storey: number, k: number): { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number } {
  const s = wing === "A" ? 1 : -1;
  const a = 6.15 + 2.8 * k;
  const b = Math.min(8.65 + 2.8 * k, IN.wing.x1);
  const [x0, x1] = s > 0 ? [a, b] : [-b, -a];
  const [z0, z1] = row === "S" ? [IN.wing.z0, IN.wing.corrS - 0.3] : [IN.wing.corrN + 0.3, IN.wing.z1];
  const y0 = storey * 3.6;
  return { x0, x1, z0, z1, y0, y1: y0 + IN.cellH };
}
/** Is this cell the passage to a yard door (wing, row S, ground floor, the door's place)? */
export const isYardPassage = (row: "N" | "S", storey: number, k: number) => row === "S" && storey === 0 && Math.abs(CELLS[k] - YARD_DOOR.x) < 0.2;

/** The furniture's actual positions, shared by the model and the inmates' small pacing area. */
export function cellFurniture(c: ReturnType<typeof cellBox>, row: "N" | "S", seed: number) {
  const x0 = c.x0 + .02, x1 = c.x1 - .02;
  const [zDoor, zBack] = row === "S" ? [c.z1, c.z0] : [c.z0, c.z1];
  const into = Math.sign(zBack - zDoor), xm = (x0 + x1) / 2;
  const bx = x0 + .42, bz0 = zDoor + into * .55, bz1 = zBack - into * .05;
  const bl = Math.abs(bz1 - bz0), bzc = (bz0 + bz1) / 2;
  return { x0, x1, zDoor, zBack, into, xm, bx, bz0, bz1, bl, bzc, folded: seed % 3 === 0, tx: x1 - .35, tz: zBack - into * .35 };
}

/** NPC-only floor: a prisoner cannot pace through furniture or the cell's walls. */
export function cellPacing(wing: "A" | "B", row: "N" | "S", k: number): (x: number, z: number) => boolean {
  const c = cellBox(wing, row, 0, k);
  const f = cellFurniture(c, row, k * 7 + (row === "N" ? 11 : 0) + (wing === "B" ? 5 : 0));
  const occupied = (k + (row === "N" ? 1 : 0)) % 5 !== 2;
  const blocks = [
    f.folded ? [f.x0, f.x0 + .17, f.bzc - .35, f.bzc + .35] : [f.bx - .36, f.bx + .36, Math.min(f.bz0, f.bz1), Math.max(f.bz0, f.bz1)],
    [f.tx - .275, f.tx + .275, f.tz - .3, f.tz + .3],
    [f.tx - .46, f.tx - .14, f.tz - f.into * .6 - .16, f.tz - f.into * .6 + .16],
    [f.x1 - .41, f.x1 - .09, f.zDoor + f.into * .35 - .16, f.zDoor + f.into * .35 + .16],
    ...(occupied ? [[f.xm - .1, f.xm + .4, f.bzc - .2, f.bzc + .2], [f.xm + .3, f.xm + .7, f.bzc + f.into * .4 - .2, f.bzc + f.into * .4 + .2]] : []),
  ];
  return (x, z) => x > c.x0 + .25 && x < c.x1 - .25 && z > c.z0 + .25 && z < c.z1 - .25
    && !blocks.some(([x0, x1, z0, z1]) => x > x0 - .25 && x < x1 + .25 && z > z0 - .25 && z < z1 + .25);
}

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
  corridorB: { x: -14.5, z: 18.3, yaw: Math.PI / 2 },
  galleryB: { x: -9.5, z: 18.3, yaw: Math.PI / 2, y: LV.g1 },
  clerk: { x: 6.3, z: 4.6, yaw: 0, y: LV.office },
  director: { x: -6.2, z: 5.8, yaw: Math.PI, y: LV.office },
  yardStep: { x: 13.0, z: 13.6, yaw: Math.PI },
  yardStepB: { x: -13.0, z: 13.6, yaw: Math.PI },
};

// ---- the walking plan, storey by storey
const pavOct = (apo: number): HRect[] => {
  const h = apo * Math.tan(Math.PI / 8);
  const c = (apo + h) / 2;
  const z = IN.pavZ;
  return [R(-h, h, z - apo, z + apo), R(-apo, apo, z - h, z + h), R(-c, c, z - c, z + c)];
};
/** Rects inside an octagon of apothem `apo` round the pavilion's middle, their corners on its diagonal faces (n steps). */
function octSteps(apo: number, n: number): HRect[] {
  const z = IN.pavZ;
  const h = apo * Math.tan(Math.PI / 8);
  const d = apo * Math.SQRT2;
  const out: HRect[] = [];
  for (let i = 0; i <= n; i++) {
    const hx = h + ((apo - h) * i) / n;
    const hz = Math.min(apo, d - hx);
    out.push(R(-hx, hx, z - hz, z + hz));
  }
  return out;
}
/** A gallery ring's void (over the ground floor) and the wall's corners (the square's corners outside the octagon): solids on a gallery storey. */
function pavRingSolids(): HRect[] {
  const z = IN.pavZ;
  const out: HRect[] = [];
  // the void: rects with their corners on its diagonal faces (x + |z'| = its apothem x sqrt 2), fine steps so the
  // gallery's free band is never pinched
  const ai = IN.pavR - IN.pavGalleryW;
  const di = ai * Math.SQRT2;
  const h = ai * Math.tan(Math.PI / 8);
  for (let i = 0; i <= 12; i++) {
    const hx = h + ((ai - h) * i) / 12;
    const hz = Math.min(ai, di - hx);
    out.push(R(-hx, hx, z - hz, z + hz));
  }
  // the square's corners beyond the inner wall's diagonal faces (x + |z'| over its apothem x sqrt 2)
  const dw = IN.pavR * Math.SQRT2;
  const hw = IN.pavR * Math.tan(Math.PI / 8);
  for (let i = 1; i < 12; i++) {
    const cx = hw + ((IN.pavR - hw) * i) / 12;
    const cz = dw - cx;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]])
      out.push(R(sx > 0 ? cx : -IN.pavR, sx > 0 ? IN.pavR : -cx, sz > 0 ? z + cz : z - IN.pavR, sz > 0 ? z + IN.pavR : z - cz));
  }
  return out;
}
const bothWings = (rs: HRect[]): HRect[] => [...rs, ...rs.map(mx)];

const W = IN.wing;
const G = IN.galleryW;
const floors0: HRect[] = [
  R(-IN.passHW, IN.passHW, -2.4, IN.gateFace), // the street before the gate (at the street's height: steps)
  R(-IN.passHW, IN.passHW, IN.gateFace, IN.passEnd), // the gate's reveal and the passage
  R(-IN.passWall, -IN.passHW, 4.8, 6.4), // the guard room's door (1.6 m: the walkers' check keeps 0.45 m off a wall)
  R(IN.front.x0, -IN.passWall, IN.front.z0, IN.front.z1), // the guard room
  R(IN.passHW, IN.passWall, 0.8, 2.4), // the visitors' room's door
  R(IN.passWall, IN.front.x1, IN.front.z0, IN.grille1), // the visitors' side
  R(-IN.linkHW, IN.linkHW, IN.passEnd, IN.linkEnd), // the link
  ...pavOct(IN.pavR), // the pavilion
  // the corridors, the passages to the yard doors and the landings before them (at the street's height: steps)
  ...bothWings([
    R(IN.pavR, W.x1, W.corrS, W.corrN),
    R(YARD_DOOR.x - YARD_DOOR.hw, YARD_DOOR.x + YARD_DOOR.hw, YARD_DOOR.z, W.corrS),
    R(YARD_DOOR.x - YARD_DOOR.hw, YARD_DOOR.x + YARD_DOOR.hw, 13.3, YARD_DOOR.z),
  ]),
];
const solids0: HRect[] = [
  // the guard room: the table, the stove, the bunk, the cupboard, the rifle rack
  R(-8.3, -6.1, 3.2, 4.3),
  R(-11.4, -10.5, 6.7, 7.7),
  R(-11.4, -9.5, 0.65, 1.5),
  R(-4.1, -2.5, 0.65, 1.1),
  R(-11.4, -11.0, 3.0, 5.2),
  // the visitors' benches along the front wall
  R(3.6, 5.8, 0.65, 1.0),
  R(8.0, 10.2, 0.65, 1.0),
  // the chief warder's desk on its platform in the pavilion
  R(-1.3, 1.3, 18.0, 20.0),
  // under the stairs: the link's (its high part) and the wings' scissor stairs
  R(IN.linkStair.x0, IN.linkStair.x1, IN.linkStair.z0, IN.linkStair.z1 - 1.0),
  ...bothWings([R(IN.stair.x0 + 0.6, IN.stair.x1, IN.stair.z0, IN.stair.z1)]),
];
// the galleries: the pavilion's ring (a square with the void and the wall's corners solid) and the wings' galleries
const ring: HRect[] = [R(-IN.pavR, IN.pavR, IN.pavZ - IN.pavR, IN.pavZ + IN.pavR)];
const galleries = (landing: number): HRect[] =>
  bothWings([
    R(IN.pavR, W.x1, W.corrS, W.corrS + G),
    R(IN.pavR, W.x1, W.corrN - G, W.corrN),
    R(12.36 - 0.6, 12.36 + 0.6, W.corrS + G, W.corrN - G),
    R(landing - 0.6, landing + 0.6, W.corrS + G, W.corrN - G),
  ]);
const floors1: HRect[] = [
  ...ring,
  ...galleries(IN.stair.x1 + 0.6),
  // the landing over the link, its door onto the pavilion's first gallery
  R(-IN.linkHW, IN.linkStair.x0, IN.passEnd + 0.02, IN.linkZ1),
  R(IN.linkStair.x0, IN.linkHW, IN.passEnd + 0.02, IN.linkStair.z0),
  R(-1.0, 1.0, IN.linkZ1, IN.linkEnd),
];
const floors2: HRect[] = [...ring, ...galleries(IN.stair.x0 - 0.6)];
const T = IN.tower;
const floorsOffice: HRect[] = [
  R(-IN.officeWall + 0.1, -4.2, IN.front.z0, IN.front.z1), // the director's room
  R(IN.front.x0, -IN.officeWall - 0.1, IN.front.z0, IN.front.z1), // the clerk's room
  R(-IN.officeWall - 0.1, -IN.officeWall + 0.1, 6.7, 7.9), // the door between them
  R(4.2, IN.officeWall - 0.1, IN.front.z0, IN.front.z1), // the registry
  R(IN.officeWall + 0.1, IN.front.x1, IN.front.z0, IN.front.z1), // the doctor's room
  R(IN.officeWall - 0.1, IN.officeWall + 0.1, 6.7, 7.9),
];
const solidsOffice: HRect[] = [
  R(-7.4, -5.2, 4.9, 6.1), // the director's desk
  R(-11.4, -10.9, 1.2, 5.0), // the clerk's presses
  R(-10.2, -9.4, 3.2, 4.2), // the clerk's desk
  R(5.2, 7.0, 3.8, 4.6), // the registry's long desk
  R(4.2, 4.7, 1.0, 5.6), // its presses
  R(9.6, 11.4, 6.2, 7.2), // the doctor's couch
  R(10.9, 11.4, 1.2, 3.2), // his cupboard
];
const floorsTower: HRect[] = [
  R(-T.x, T.x, T.z0, T.z1), // the records room
  R(-4.2, -T.x, 6.5, 7.7), // its doors to the offices (steps down)
  R(T.x, 4.2, 6.5, 7.7),
  R(IN.towerSteps.x0, IN.towerSteps.x1, T.z1, IN.passEnd + 0.02), // its door to the landing over the link
];
const solidsTower: HRect[] = [
  R(-T.x, -T.x + 0.5, 0.6, 5.8), // the shelves of registers
  R(T.x - 0.5, T.x, 0.6, 5.8),
  R(-1.2, 1.2, 3.4, 4.6), // the table
  R(2.6, 3.4, 7.6, 8.5), // the ladder to the clock room
];

/** The prison's hall plan (shared/hallPlan.ts). Its id is not one of the server's landmarks: the prison's life is its own (server/src/town/prison.ts). */
export const PLAN: HallPlan = {
  id: "prison" as unknown as HallPlan["id"],
  origin: { x: ORIGIN.x, z: ORIGIN.z },
  yaw: YAW,
  floorY: FLOOR_Y,
  levels: [
    { y: LV.ground, floors: floors0, solids: solids0 },
    { y: LV.g1, floors: floors1, solids: pavRingSolids() },
    { y: LV.g2, floors: floors2, solids: pavRingSolids() },
    { y: LV.office, floors: floorsOffice, solids: solidsOffice },
    { y: LV.tower, floors: floorsTower, solids: solidsTower },
  ],
  stairs: [
    // the link's iron stair up to the landing over it
    { rect: R(IN.linkStair.x0, IN.linkStair.x1, IN.linkStair.z0, IN.linkStair.z1), along: "z", foot: IN.linkStair.z1, head: IN.linkStair.z0, lo: 0, hi: 1, y0: LV.ground, y1: LV.g1, rise: 0.18 },
    // from the landing up into the records room
    { rect: R(IN.towerSteps.x0, IN.towerSteps.x1, IN.towerSteps.z0, IN.towerSteps.z1), along: "z", foot: IN.towerSteps.z1, head: IN.towerSteps.z0, lo: 1, hi: 4, y0: LV.g1, y1: LV.tower, rise: 0.2 },
    // from the records room down into the offices either side
    { rect: R(-5.2, -4.2, 6.5, 7.7), along: "x", foot: -5.2, head: -4.2, lo: 3, hi: 4, y0: LV.office, y1: LV.tower, rise: 0.2 },
    { rect: R(4.2, 5.2, 6.5, 7.7), along: "x", foot: 5.2, head: 4.2, lo: 3, hi: 4, y0: LV.office, y1: LV.tower, rise: 0.2 },
    // each wing's scissor stair: up to the first gallery's landing bridge, and back over it to the second's
    ...([1, -1] as const).flatMap((s) => {
      const r = s > 0 ? R(IN.stair.x0, IN.stair.x1, IN.stair.z0, IN.stair.z1) : mx(R(IN.stair.x0, IN.stair.x1, IN.stair.z0, IN.stair.z1));
      return [
        { rect: r, along: "x" as const, foot: s * IN.stair.x0, head: s * IN.stair.x1, lo: 0, hi: 1, y0: LV.ground, y1: LV.g1, rise: 0.18 },
        { rect: r, along: "x" as const, foot: s * IN.stair.x1, head: s * IN.stair.x0, lo: 1, hi: 2, y0: LV.g1, y1: LV.g2, rise: 0.18 },
      ];
    }),
  ],
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
    ...([1, -1] as const).map((s) => ({
      id: s > 0 ? "prison_yard" : "prison_yard_west",
      x: s * YARD_DOOR.x,
      z: YARD_DOOR.z + 0.1,
      dir: 1 as const,
      hw: YARD_DOOR.hw,
      h: YARD_DOOR.spring,
      inner: W.z0,
      y: 0,
      leaves: 1 as const,
      open: (85 * Math.PI) / 180,
      step: s > 0 ? marks.yardStep : marks.yardStepB,
      archTop: Array.from({ length: 9 }, (_, i) => {
        const a = (Math.PI * i) / 8;
        return [YARD_DOOR.hw * Math.cos(a), YARD_DOOR.spring + YARD_DOOR.hw * Math.sin(a)] as [number, number];
      }),
    })),
  ],
  area: [
    // (overlapping a little: the area test is strict at its edges)
    R(-1.9, 1.9, -2.4, IN.gateInner + 0.1),
    R(IN.front.x0 - 0.2, IN.front.x1 + 0.2, IN.gateInner, IN.passEnd + 0.05),
    R(-2.4, 2.4, IN.passEnd - 0.1, IN.linkEnd),
    // (the pavilion's octagon, not its square: the courts come up to its diagonal faces; fine steps inside its outer faces)
    ...octSteps(PARTS.pavilion.r * Math.cos(Math.PI / 8) - 0.02, 12),
    ...bothWings([R(IN.pavR - 0.2, W.x1 + 0.2, W.corrS - 0.2, W.corrN + 0.2), R(YARD_DOOR.x - 1.0, YARD_DOOR.x + 1.0, 13.3, W.corrS)]),
    // (M7 prison real: the cells too, so an eye in one is inside; they have no floor, so the walk map still answers there)
    ...bothWings([R(IN.pavR, W.x1 + 0.3, PARTS.wingA.z0 + 0.2, PARTS.wingA.z1 - 0.2)]),
  ],
  // the street before the gate and the yards before their doors lie at the street's height
  steps: [
    { rect: R(-IN.passHW, IN.passHW, -2.4, IN.gateFace), y: -FLOOR_Y },
    ...bothWings([R(YARD_DOOR.x - YARD_DOOR.hw, YARD_DOOR.x + YARD_DOOR.hw, 13.3, YARD_DOOR.z)]).map((rect) => ({ rect, y: -FLOOR_Y })),
  ],
  nodes: [
    [0, -1.9], [0, 1.6], [0, 5.6], [-3.4, 5.6], [-6.0, 5.8], [-9.6, 5.8], [3.4, 1.6], [6.8, 2.6], [10.2, 2.6],
    [0, 11.3], [0, 15.2], [-3.2, 19], [3.2, 19], [0, 22.8],
    [8.5, 19.5], [13.0, 19.5], [18.0, 19.5], [22.0, 18.3], [25.5, 19.5], [13.0, 16.2], [13.0, 14.2],
    [-8.5, 19.5], [-13.0, 19.5], [-18.0, 19.5], [-22.0, 18.3], [-25.5, 19.5], [-13.0, 16.2], [-13.0, 14.2],
  ],
  marks,
  sets: {},
};

/** The exercise yard (local): its own walk area in the street's scene, beyond wing A's door. */
export const YARD: HRect[] = [R(12.35, 29.9, 0.6, 14.6), R(2.8, 12.35, 9.0, 14.6)];
/** What stands in the yard (local): the warder's stand, the water butt, the benches, the pavilion's corner. */
export const YARD_SOLIDS: HRect[] = [
  R(PARTS.ring.x - 1.15, PARTS.ring.x + 1.15, PARTS.ring.z - 1.15, PARTS.ring.z + 1.15),
  R(YARD_DOOR.x + 1.85, YARD_DOOR.x + 2.75, 13.65, 14.6),
  R(15.0, 17.0, 0.6, 1.15),
  R(21.0, 23.0, 0.6, 1.15),
  R(2.8, 4.0, 13.2, 14.6),
];
/**
 * The west court (local, M7 prison real): round the chapel, from wing B's door. A strip before the chapel's door along
 * the street wall, the strips either side of it, and the court behind the front building.
 */
export const COURT_W: HRect[] = [
  R(-22.0, -12.35, 0.6, 1.6),
  R(-22.0, -21.0, 1.6, 14.6),
  R(-21.0, -12.35, 10.4, 14.6),
  R(-13.4, -12.35, 1.6, 10.4),
  R(-12.35, -2.8, 9.0, 14.6),
];
/** What stands in the west court: the chapel and its apse (a little generous), the pavilion's corner. */
export const COURT_W_SOLIDS: HRect[] = [
  // (the chapel, open where its side door is)
  R(-21.0, -13.4, 1.6, 8.85),
  R(-21.0, -13.4, 10.25, 11.5),
  R(-21.0, -13.75, 8.85, 10.25),
  // the chapel's buttresses (the east side's back one gave way to the side door)
  ...[1.75, 4.53, 7.47].map((z) => R(-13.4, -13.0, z - 0.3, z + 0.3)),
  ...[1.75, 4.53, 7.47, 10.25].map((z) => R(-21.4, -21.0, z - 0.3, z + 0.3)),
  R(-20.6, -13.8, 11.5, 12.6),
  R(-20.1, -14.3, 12.6, 13.1),
  R(-19.9, -14.5, 13.1, 14.25),
  R(-4.0, -2.8, 13.2, 14.6),
];

// ---------------------------------------------------------------- the chapel (its own room in the world)

/** The chapel's floor over the street (its doors' thresholds). */
export const CHAPEL_FLOOR_Y = 0.2;
/**
 * The chapel's lines (the prison's frame; heights over its floor): the nave's inner faces, the apse's middle and inner
 * circumradius; the gable's door (shut: it opens on a strip a metre wide along the street wall) and the side door the
 * prisoners come in by from the court behind the front building (its middle along z, half width, springing).
 */
export const CHAPEL = {
  x0: -20.4,
  x1: -14.0,
  z0: 2.2,
  z1: 10.4,
  xm: -17.2,
  apseR: 3.2,
  door: { hw: 0.65, spring: 2.25 },
  faceZ: 1.6,
  reveal: 1.9,
  side: { z: 9.55, hw: 0.7, spring: 2.0, face: -13.4, reveal: -13.7 },
} as const;
/**
 * The chapel's walking plan is in a frame of its own, turned a quarter from the prison's, because a hall's doors lie
 * across its z (shared/hallPlan.ts) and the chapel's open door is in its east side: local x = the prison's z, local
 * z = minus the prison's x. c2 turns a prison rect into it, p2 a point.
 */
const c2 = (r: HRect): HRect => R(r.minZ, r.maxZ, -r.maxX, -r.minX);
const p2 = (x: number, z: number, yaw = 0): Mark => ({ x: z, z: -x, yaw: yaw + Math.PI / 2 });
const CS = CHAPEL.side;
const chapelMarks: Record<string, Mark> = {
  door: p2(-12.7, CS.z, -Math.PI / 2),
  inside: p2(-14.8, CS.z, Math.PI / 2),
  altar: p2(CHAPEL.xm, 12.1, Math.PI),
  pulpit: p2(-19.8, 8.6, Math.PI / 2),
};
export const CHAPEL_PLAN: HallPlan = {
  id: "prison_chapel" as unknown as HallPlan["id"],
  origin: { x: ORIGIN.x, z: ORIGIN.z },
  yaw: YAW - Math.PI / 2,
  floorY: CHAPEL_FLOOR_Y,
  levels: [
    {
      y: 0,
      floors: [
        R(CS.z - CS.hw, CS.z + CS.hw, -CS.face - 0.8, -CS.reveal - 0.05), // the court before the side door (a step down)
        R(CS.z - CS.hw, CS.z + CS.hw, -CS.reveal - 0.05, -CHAPEL.x1), // the side door's doorway
        c2(R(CHAPEL.x0, CHAPEL.x1, CHAPEL.z0, CHAPEL.z1)), // the nave
        c2(R(-19.9, -14.5, CHAPEL.z1, 11.6)), // the apse (three rects inside its half octagon)
        c2(R(-19.46, -14.94, 11.6, 12.66)),
        c2(R(-18.4, -16.0, 12.66, 13.1)),
      ],
      solids: [
        c2(R(CHAPEL.x0, -18.0, 3.3, 7.9)), // the prisoners' stalls either side of the aisle
        c2(R(-16.4, CHAPEL.x1, 3.3, 7.9)),
        c2(R(-20.2, -19.4, 8.2, 9.0)), // the pulpit
        c2(R(-20.4, -19.4, 9.4, 10.0)), // the harmonium
        c2(R(-18.2, -16.2, 11.8, 12.6)), // the altar
      ],
    },
  ],
  stairs: [],
  doors: [
    {
      id: "prison_chapel_door",
      x: CS.z,
      z: -CS.reveal + 0.05,
      dir: 1,
      hw: CS.hw,
      h: CS.spring,
      inner: -CHAPEL.x1,
      y: 0,
      leaves: 2,
      open: (80 * Math.PI) / 180,
      step: chapelMarks.door,
      archTop: Array.from({ length: 9 }, (_, i) => {
        const a = (Math.PI * i) / 8;
        return [CS.hw * Math.cos(a), CS.spring + CS.hw * Math.sin(a)] as [number, number];
      }),
    },
  ],
  area: [
    R(CS.z - 0.9, CS.z + 0.9, -CS.face - 0.8, -CHAPEL.x1 + 0.1),
    c2(R(CHAPEL.x0 - 0.1, CHAPEL.x1 + 0.1, CHAPEL.z0 - 0.05, CHAPEL.z1 + 0.05)),
    c2(R(-20.0, -14.4, CHAPEL.z1, 13.2)),
  ],
  // the court before the side door lies at the street's height
  steps: [{ rect: R(CS.z - CS.hw, CS.z + CS.hw, -CS.face - 0.8, -CS.reveal - 0.05), y: -CHAPEL_FLOOR_Y }],
  // Jef stays out of the sanctuary (the rail across the apse)
  jefOnly: [c2(R(-19.9, -14.5, 10.75, 13.1))],
  nodes: [[CS.z, 12.6], [CS.z, 14.8], [9.5, 17.2], [6.0, 17.2], [2.8, 17.2], [11.2, 17.2]],
  marks: chapelMarks,
  sets: {},
};

// ---------------------------------------------------------------- the governor's house (its own room, shut)

/** The governor's ground floor over the street (his front door's threshold, up three steps). */
export const GOV_FLOOR_Y = 0.62;
/** The house inside (local; heights over its ground floor): its inner faces, the partitions, the storeys. */
export const GOV = { x0: -32.0, x1: -22.5, z0: 0.5, z1: 10.0, part: [-28.6, -25.9], storeys: [0, 3.63, 7.23], ceil: 10.18, door: { x: -27.25, hw: 0.65, h: 2.78 }, back: { x: -27.3, hw: 0.5, h: 2.28 } } as const;
export const GOV_PLAN: HallPlan = {
  id: "prison_governor" as unknown as HallPlan["id"],
  origin: { x: ORIGIN.x, z: ORIGIN.z },
  yaw: YAW,
  floorY: GOV_FLOOR_Y,
  levels: [{ y: 0, floors: [R(GOV.x0, GOV.x1, GOV.z0, GOV.z1), R(GOV.door.x - GOV.door.hw, GOV.door.x + GOV.door.hw, 0.0, GOV.z0), R(GOV.back.x - GOV.back.hw, GOV.back.x + GOV.back.hw, GOV.z1, 10.5)], solids: [] }],
  stairs: [],
  doors: [
    { id: "prison_governor_door", x: GOV.door.x, z: 0.27, dir: 1, hw: GOV.door.hw, h: GOV.door.h, inner: GOV.z0, y: 0, leaves: 1, open: 1.3, step: { x: GOV.door.x, z: -1.2, yaw: Math.PI } },
    { id: "prison_governor_garden", x: GOV.back.x, z: 10.23, dir: -1, hw: GOV.back.hw, h: GOV.back.h, inner: GOV.z1, y: 0, leaves: 1, open: 1.3, step: { x: GOV.back.x, z: 11.4, yaw: 0 } },
  ],
  area: [R(GOV.door.x - 0.8, GOV.door.x + 0.8, -0.1, GOV.z0 + 0.1), R(GOV.x0 - 0.05, GOV.x1 + 0.05, GOV.z0 - 0.05, GOV.z1 + 0.05)],
  steps: [],
  nodes: [],
  marks: { door: { x: GOV.door.x, z: -1.2, yaw: Math.PI }, desk: { x: -24.2, z: 6.2, yaw: Math.PI / 2 } },
  sets: {},
};

// ---------------------------------------------------------------- zones: the parts of the building (world y)

export interface Zone {
  id: string;
  label: string;
  room: "prison" | "prison_chapel" | "prison_governor";
  /** Local x, z; world y. */
  box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  /** Walked (people go there) or only seen (a locked room, a shut cell). */
  walk: boolean;
  /** The zones seen from here (besides itself): whose windows can show the street to an eye here. */
  sees: string[];
}
const Z = (id: string, label: string, room: Zone["room"], b: [number, number, number, number, number, number], walk: boolean, sees: string[] = []): Zone => ({
  id,
  label,
  room,
  box: { x0: b[0], x1: b[1], y0: b[2], y1: b[3], z0: b[4], z1: b[5] },
  walk,
  sees,
});
const fy = (y: number) => y + FLOOR_Y;
const openCell = (w: "A" | "B", row: "N" | "S", k: number) => OPEN_CELLS.some((o) => o.wing === w && o.row === row && Math.abs(o.x - CELLS[k]) < 0.2);
const cellId = (w: "A" | "B", row: "N" | "S", s: number, k: number) => `cell_${w}_${row}${s + 1}_${k + 1}`;
function buildZones(): Zone[] {
  const out: Zone[] = [
    Z("passage", "the gate passage", "prison", [-IN.passHW, IN.passHW, fy(0), fy(4.9), -0.7, IN.passEnd], true, ["guard", "visit", "link"]),
    Z("guard", "the guard room", "prison", [IN.front.x0, -IN.passWall, fy(0), fy(4.0), -0.1, IN.front.z1], true, ["passage"]),
    Z("visit", "the visitors' room", "prison", [IN.passWall, IN.front.x1, fy(0), fy(4.0), -0.1, IN.front.z1], true, ["passage"]),
    Z("officeW", "the director's room", "prison", [-IN.officeWall, -4.2, fy(4.0), fy(8.2), -0.1, IN.front.z1], true, ["officeW2", "tower1"]),
    Z("officeW2", "the clerk's room", "prison", [IN.front.x0 - 0.1, -IN.officeWall, fy(4.0), fy(8.2), -0.1, IN.front.z1], true, ["officeW"]),
    Z("officeE", "the registry", "prison", [4.2, IN.officeWall, fy(4.0), fy(8.2), -0.1, IN.front.z1], true, ["officeE2", "tower1"]),
    Z("officeE2", "the doctor's room", "prison", [IN.officeWall, IN.front.x1 + 0.1, fy(4.0), fy(8.2), -0.1, IN.front.z1], true, ["officeE"]),
    Z("tower1", "the records room in the gate tower", "prison", [-T.x, T.x, fy(4.9), fy(9.8), -0.7, T.z1], true, ["officeW", "officeE", "linkUp", "tower2"]),
    Z("tower2", "the clock room in the gate tower (locked)", "prison", [-T.x, T.x, fy(9.8), fy(13.5), -0.7, T.z1], false, ["bartW", "bartE"]),
    Z("bartW", "the west bartizan (off the clock room)", "prison", [-4.95, -3.9, fy(9.4), fy(13.5), -1.4, 0.2], false, ["tower2"]),
    Z("bartE", "the east bartizan (off the clock room)", "prison", [3.9, 4.95, fy(9.4), fy(13.5), -1.4, 0.2], false, ["tower2"]),
    Z("link", "the link", "prison", [-IN.linkHW, IN.linkHW, fy(0), fy(3.5), IN.passEnd, IN.linkZ1], true, ["passage", "linkUp", "pavilion"]),
    Z("linkUp", "the landing over the link", "prison", [-IN.linkHW, IN.linkHW, fy(3.5), fy(7.3), IN.passEnd, IN.linkZ1], true, ["link", "pavilion", "tower1"]),
    Z("pavilion", "the watch pavilion", "prison", [-IN.pavR, IN.pavR, fy(0), fy(IN.pavTop), IN.linkZ1, IN.pavZ + IN.pavR], true, ["link", "linkUp", "corrA", "corrB"]),
  ];
  for (const w of ["A", "B"] as const) {
    const s = w === "A" ? 1 : -1;
    const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): [number, number, number, number, number, number] => (s > 0 ? [x0, x1, y0, y1, z0, z1] : [-x1, -x0, y0, y1, z0, z1]);
    const open: string[] = [];
    for (const row of ["S", "N"] as const) for (let k = 0; k < CELLS.length; k++) if (openCell(w, row, k)) open.push(cellId(w, row, 0, k));
    out.push(Z(`corr${w}`, `wing ${w}, the corridor and its galleries`, "prison", box(IN.pavR, W.x1 + 0.7, fy(0), fy(15.5), W.corrS - 0.3, W.corrN + 0.3), true, ["pavilion", `yard${w}`, ...open]));
    out.push(Z(`yard${w}`, `wing ${w}, the passage to the ${w === "A" ? "exercise yard" : "west court"}`, "prison", box(YARD_DOOR.x - YARD_DOOR.hw, YARD_DOOR.x + YARD_DOOR.hw, fy(0), fy(3.2), YARD_DOOR.z - 0.2, W.corrS - 0.3), true, [`corr${w}`]));
    for (const row of ["S", "N"] as const)
      for (let st = 0; st < 3; st++)
        for (let k = 0; k < CELLS.length; k++) {
          if (isYardPassage(row, st, k)) continue;
          const c = cellBox(w, row, st, k);
          const deep: [number, number] = row === "S" ? [PARTS.wingA.z0 - 0.1, c.z1] : [c.z0, PARTS.wingA.z1 + 0.1];
          const open_ = st === 0 && openCell(w, row, k);
          out.push({
            id: cellId(w, row, st, k),
            label: `wing ${w}, ${row === "S" ? "south" : "north"} row, storey ${st + 1}, cell ${k + 1}${open_ ? " (open)" : ""}`,
            room: "prison",
            box: { x0: c.x0, x1: c.x1, y0: fy(c.y0), y1: fy(c.y1), z0: deep[0], z1: deep[1] },
            walk: false,
            sees: open_ ? [`corr${w}`] : [],
          });
        }
  }
  // the chapel
  const cy = (y: number) => y + CHAPEL_FLOOR_Y;
  out.push(Z("chapel", "the chapel", "prison_chapel", [CHAPEL.x0 - 0.7, CHAPEL.x1 + 0.7, cy(0), cy(12.2), CHAPEL.faceZ - 0.1, CHAPEL.z1], true, ["apse"]));
  out.push(Z("apse", "the chapel's apse", "prison_chapel", [CHAPEL.x0 - 0.7, CHAPEL.x1 + 0.7, cy(0), cy(7.6), CHAPEL.z1, 14.3], true, ["chapel"]));
  // the governor's house: three storeys (seen, shut) and the two dormer garrets
  const gy = (y: number) => y + GOV_FLOOR_Y;
  const gz: [number, number] = [-0.1, 10.6];
  out.push(Z("gov0", "the governor's house, ground floor", "prison_governor", [-32.6, -21.9, gy(0), gy(3.5), ...gz], false, []));
  out.push(Z("gov1", "the governor's house, first floor", "prison_governor", [-32.6, -21.9, gy(3.5), gy(7.1), ...gz], false, []));
  out.push(Z("gov2", "the governor's house, second floor", "prison_governor", [-32.6, -21.9, gy(7.1), gy(10.3), ...gz], false, []));
  out.push(Z("govAttic", "the governor's garret (the dormers)", "prison_governor", [-32.6, -21.9, gy(10.3), gy(13.0), -0.1, 2.0], false, []));
  return out;
}
export const ZONES: Zone[] = buildZones();
const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));
export const zoneById = (id: string): Zone | undefined => ZONE_BY_ID.get(id);

/** The zone at a point (local x, z; world y), if any. */
export function zoneAt(x: number, y: number, z: number): Zone | null {
  for (const q of ZONES) {
    const b = q.box;
    if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1) return q;
  }
  return null;
}

/** A point just behind a shell opening, inside the building (local x, z; world y): where its room is. */
export function behind(o: ShellOpening, into = 0.5): [number, number, number] {
  if (o.shape === "quad" && o.pts) {
    const c = o.pts.reduce((a, p) => [a[0] + p[0] / 4, a[1] + p[1] / 4, a[2] + p[2] / 4], [0, 0, 0]);
    return [c[0] - o.nx * into, c[1] - (o.ny ?? 0) * into, c[2] - o.nz * into];
  }
  const y = o.shape === "round" ? (o.cy ?? (o.yb + o.yt) / 2) : (o.yb + o.yt) / 2;
  return [o.x - o.nx * (o.depth + into), y, o.z - o.nz * (o.depth + into)];
}
/** The zone behind a shell opening (null: none, which the check reports). */
export function zoneOf(o: ShellOpening): Zone | null {
  return zoneAt(...behind(o));
}
/** Can an eye in zone `from` see the openings of zone `to` (itself, or one it sees)? */
export function sees(from: string, to: string): boolean {
  if (from === to) return true;
  return !!ZONE_BY_ID.get(from)?.sees.includes(to);
}

// ---------------------------------------------------------------- the lights by the prison's routine

/**
 * How lit each part is at this hour (0..1; the client multiplies by the dusk): the cells' gas from dusk to lights
 * out at eight, the corridors and the pavilion low all night, the guard room and the gate always, the offices till
 * seven, the governor's rooms in the evening till half past ten, the chapel for Sunday's evening prayers only.
 */
export function prisonLights(day: number, hour: number): { cells: number; corridors: number; guard: number; offices: number; governor: number; chapel: number } {
  const sunday = weekday(day) === 7;
  return {
    cells: hour >= 6 && hour < 20 ? 1 : 0,
    corridors: 1,
    guard: 1,
    offices: hour >= 7 && hour < 19 ? 1 : 0,
    governor: hour >= 16 && hour < 22.5 ? 1 : hour >= 6 && hour < 8 ? 0.6 : 0,
    chapel: sunday && hour >= 17 && hour < 19 ? 1 : 0,
  };
}
