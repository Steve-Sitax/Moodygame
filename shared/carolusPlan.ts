// Sint-Carolus Borromeus on the Conscienceplein (M7, docs/milestones/M7-carolus.md): the numbers of its
// front that the game walks, the same as the Blender shell's (tools/blender/build_churches.py, CF and
// carolus_terrace). Pure numbers, no three.js: the client walks them (client/src/world/rijnkaai.ts), the
// placers keep off them (client/src/world/doorKeep.ts).
//
// The frame is the shell's (build_churches.py frame_front_open): a from the landmark rectangle's front
// edge inward (world +z), s along the front (world +x), the Conscienceplein at a < 0. It is not turned:
// world x = ORIGIN.x + s, z = ORIGIN.z + a. The rectangle (shared/city.json landmarks.carolus) is solid
// in the walk map from a 0; the terrace and its flights stand on the square before it.

import type { HallPlan, Mark, Rect as HRect } from "./hallPlan.js";

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

// ================================================================ the interior (walked in the world)
//
// The hall stands inside the shell as the cathedral's and the halls' do (docs/milestones/M7-carolus.md,
// shared/hallPlan.ts). Its frame: the main door's plane (the front's face, a 0.9) at local z 0, local x = s
// (world +x), z into the church (world +z), not turned; local y 0 the nave's floor, level with the terrace
// (world 0.6). A basilica of eight bays: Doric columns carrying round arches, galleries over the aisles on
// Ionic columns, the barrel vault of 1718 with broad transverse arches, the organ loft over the first bay,
// the raised choir behind the communion rail and the high altar in the round apse; the Lady Chapel opens
// off the south aisle (the shell's chapel range, cut open there: build_churches.py CF CHAPEL).

const R = (minX: number, maxX: number, minZ: number, maxZ: number): HRect => ({ minX, maxX, minZ, maxZ });

/** The hall's frame in the world: the door's plane, and the floor (the terrace's height). */
export const HALL_ORIGIN = { x: ORIGIN.x, z: ORIGIN.z + FRONT.face } as const;
export const FLOOR_Y = TERRACE.Y0;

/** The hall's lines (local metres). */
export const IN = {
  /** The west wall's inner face (the wall stands 0.9..1.5, behind the shell's front slab at 1.0). */
  west: 1.5,
  /** The aisles' outer walls' inner face (the shell's aisle walls at 12.8), their east end. */
  aisle: 12.3,
  east: 26.1,
  /** The arcades' line, their half thickness. */
  arcade: 6.2,
  arcadeHalf: 0.35,
  /** The choir's side walls (inner face), the apse's centre (the shell's AC 28.45), its walls' circumradius. */
  choir: 5.85,
  apse: 27.55,
  apseR: 5.7,
} as const;
/** The bays: the west wall, the columns, the east end. */
export const BAYS = [1.5, 4.6, 7.67, 10.74, 13.81, 16.89, 19.96, 23.03, 26.1];
/** Heights: the ground arcade (capital top), the gallery floor, the upper arcade, the vault. */
export const HT = { cap: 4.3, gallery: 6.4, galleryTop: 6.7, upperCap: 11.2, entab: 13.6, spring: 14.2, galleryCeil: 14.4, vaultR: 6.2 } as const;
/** The main door: the shell's round-arched opening 3.4 wide, springing 5.5 over the sill. */
export const DOOR = { hw: 1.7, spring: 5.5, h: 7.2 } as const;
/**
 * The Lady Chapel: its room (the shell's chapel range, cut open: build_churches.py CF CHAPEL, a 12.4..26.2), the arch
 * from the south aisle, its ceiling. Issue #10: its outer wall lined behind the shell's (at SHELL.chapel), its three
 * windows the shell's (the third, at its east end, half over the altar's wall before: the room now runs past it).
 */
export const CHAPEL = { x0: 12.55, x1: 20.6, z0: 11.5, z1: 25.3, door: [13.8, 17.2] as const, doorSpring: 4.6, ceil: 9.6 } as const;
/**
 * Issue #10 (interiors are real): the shell's faces the hall's walls line (local; build_churches.py CF): the front at
 * FA (z 0), the aisles' outer walls at AW, the apse's corners at NV round its middle (IN.apse), the Lady Chapel's outer
 * wall (the chapel range's, from a M). The windows are cut through the shell (shared/churchesShell.ts).
 */
export const SHELL = { aisle: 12.8, apse: 6.5, chapel: 21.16, chapelFrom: -0.75 } as const;
/** The apse's shallow half dome over its windows' heads (17.9), up to the barrel vault's crown. */
export const APSE_DOME = { spring: 18.0, rise: 2.4 } as const;
/** The communion rail, the gate in it; the sanctuary's floor (three steps up). */
export const RAIL = { z0: 25.5, z1: 25.8, gate: 0.7 } as const;
export const SANCTUARY = 0.45;
/** Rows of chairs: the blocks either side of the middle way. */
export const CHAIRS = { x0: 0.85, x1: 4.95, z0: 7.8, z1: 21.9, row: 0.94 } as const;
export const PULPIT = { x: -5.3, z: BAYS[4] } as const;
/** No chairs on the pulpit's side round it (its stair comes down toward the door). */
export const CHAIR_GAP = [11.0, 16.0] as const;
export const CONFESSIONALS: Array<{ x: number; z: number }> = [
  ...[6.1, 11.4, 16.7, 22.0].map((z) => ({ x: -1, z })),
  ...[6.1, 10.4, 20.9].map((z) => ({ x: 1, z })),
];
export const FONT = { x: -9.3, z: 3.3 } as const;

const marks: Record<string, Mark> = {
  door: { x: 0, z: -2.0, yaw: Math.PI },
  inside: { x: 0, z: 3.2, yaw: 0 },
  nave: { x: 0, z: 12, yaw: 0 },
  rail: { x: 0, z: 25.0, yaw: 0 },
  pulpit: { x: -3.9, z: PULPIT.z, yaw: -Math.PI / 2 },
  chapel: { x: 16.8, z: 16.0, yaw: 0 },
  chapelRail: { x: 16.8, z: 20.9, yaw: 0 },
};

const floors: HRect[] = [
  R(-2.2, 2.2, -1.7, 0), // the terrace before the door (the walk map is wall from the rectangle's edge, 0.9 before the door)
  R(-DOOR.hw, DOOR.hw, 0, IN.west), // the doorway through the front and the west wall
  R(-IN.aisle, IN.aisle, IN.west, IN.east), // the nave and the aisles
  R(-IN.choir, IN.choir, IN.east, IN.apse), // the choir
  R(-4.5, 4.5, IN.apse, 30.8), // the apse
  R(-1.7, 1.7, 30.8, 32.8),
  // the Lady Chapel (from 0.2 m in from the aisle wall's chapel side: a place hard by that wall on the aisle's side is
  // not free because the chapel's floor is behind it, dev/interiorcheck.ts walks)
  R(CHAPEL.x0 + 0.2, CHAPEL.x1, CHAPEL.z0, CHAPEL.z1),
  R(IN.aisle, CHAPEL.x0 + 0.2, CHAPEL.door[0], CHAPEL.door[1]), // its arch through the aisle wall
];
const col = (x: number, z: number, h: number) => R(x - h, x + h, z - h, z + h);
const solids: HRect[] = [
  // the arcades' columns and their responds at both ends
  ...BAYS.slice(1, -1).flatMap((z) => [col(-IN.arcade, z, 0.45), col(IN.arcade, z, 0.45)]),
  ...[-1, 1].flatMap((sg) => [
    R(sg * IN.arcade - 0.35, sg * IN.arcade + 0.35, IN.west, IN.west + 0.4),
    R(sg * IN.arcade - 0.35, sg * IN.arcade + 0.35, IN.east - 0.4, IN.east),
  ]),
  // the organ loft's two columns
  col(-2.6, BAYS[1], 0.28),
  col(2.6, BAYS[1], 0.28),
  // the chairs
  R(CHAIRS.x0, CHAIRS.x1, CHAIRS.z0, CHAIRS.z1),
  R(-CHAIRS.x1, -CHAIRS.x0, CHAIRS.z0, CHAIR_GAP[0]),
  R(-CHAIRS.x1, -CHAIRS.x0, CHAIR_GAP[1], CHAIRS.z1),
  // the pulpit on its column, the font, the confessionals, the side altars at the aisles' ends
  R(PULPIT.x - 0.8, PULPIT.x + 0.8, PULPIT.z - 2.5, PULPIT.z + 0.8),
  R(FONT.x - 0.5, FONT.x + 0.5, FONT.z - 0.5, FONT.z + 0.5),
  ...CONFESSIONALS.map((c) => (c.x < 0 ? R(-IN.aisle, -IN.aisle + 1.3, c.z - 1.5, c.z + 1.5) : R(IN.aisle - 1.3, IN.aisle, c.z - 1.5, c.z + 1.5))),
  R(-11.3, -7.1, 25.0, IN.east),
  R(7.1, 11.3, 25.0, IN.east),
  // the communion rail (its gate is Jef's barrier only), the high altar
  R(-IN.arcade, -RAIL.gate, RAIL.z0, RAIL.z1),
  R(RAIL.gate, IN.arcade, RAIL.z0, RAIL.z1),
  R(-1.6, 1.6, 29.4, 31.0),
  // the Lady Chapel: its altar, its marble rail, two benches, the candle stand
  R(14.6, 19.0, 23.2, CHAPEL.z1),
  R(CHAPEL.x0, 16.1, 21.4, 21.7),
  R(17.5, CHAPEL.x1, 21.4, 21.7),
  R(14.4, 19.2, 17.8, 18.3),
  R(14.4, 19.2, 19.0, 19.5),
  R(13.1, 13.7, 20.4, 21.0),
];

/** The Carolus's interior plan (shared/hallPlan.ts). Its id is not one of the server's landmarks: the church has no life of its own yet. */
export const PLAN: HallPlan = {
  id: "carolus" as unknown as HallPlan["id"],
  origin: { x: HALL_ORIGIN.x, z: HALL_ORIGIN.z },
  yaw: 0,
  floorY: FLOOR_Y,
  levels: [{ y: 0, floors, solids }],
  stairs: [],
  doors: [
    {
      id: "carolus_main",
      x: 0,
      z: 0,
      dir: 1,
      hw: DOOR.hw,
      h: DOOR.spring,
      inner: IN.west,
      y: 0,
      leaves: 2,
      open: (84 * Math.PI) / 180,
      step: marks.door,
      archTop: Array.from({ length: 13 }, (_, i) => {
        const a = (Math.PI * i) / 12;
        return [DOOR.hw * Math.cos(a), DOOR.spring + DOOR.hw * Math.sin(a)] as [number, number];
      }),
    },
  ],
  area: [R(-12.6, 12.6, -1.7, IN.apse), R(-5.9, 5.9, IN.apse, 33.2), R(12.2, 21.0, 11.3, CHAPEL.z1 + 0.2)],
  // the sanctuary's three steps up from the choir, and its floor
  steps: [
    { rect: R(-IN.choir, IN.choir, IN.east, IN.east + 0.3), y: 0.15 },
    { rect: R(-IN.choir, IN.choir, IN.east + 0.3, IN.east + 0.6), y: 0.3 },
    { rect: R(-IN.choir, IN.choir, IN.east + 0.6, IN.apse), y: SANCTUARY },
    { rect: R(-4.5, 4.5, IN.apse, 30.8), y: SANCTUARY },
    { rect: R(-1.7, 1.7, 30.8, 32.8), y: SANCTUARY },
  ],
  jefOnly: [R(-RAIL.gate, RAIL.gate, RAIL.z0, RAIL.z1), R(16.1, 17.5, 21.4, 21.7)],
  nodes: [
    [0, -1.6], [0, 2.4], [0, 6.5], [0, 14], [0, 23.5], [-8.8, 6.5], [-8.8, 14], [-8.8, 23.5], [8.8, 6.5], [8.8, 12.4], [8.8, 23.5],
    [11.3, 15.5], [16.8, 15.5], [16.8, 20.8],
  ],
  marks,
  sets: {},
};

/** The hall's walls as boxes (local), for the check that they stand inside the shell and the footprint. */
export function wallRects(): HRect[] {
  return [
    R(-12.55, 12.55, 0.9, IN.west), // the west wall
    R(-12.55, -IN.aisle, IN.west, IN.east + 0.25), // the aisles' outer walls
    R(IN.aisle, 12.55, IN.west, IN.east + 0.25),
    R(-12.55, -IN.choir, IN.east, IN.east + 0.25), // the aisles' east ends
    R(IN.choir, 12.55, IN.east, IN.east + 0.25),
    R(CHAPEL.x1, CHAPEL.x1 + 0.25, CHAPEL.z0 - 0.25, CHAPEL.z1 + 0.25), // the Lady Chapel's walls
    R(12.55, CHAPEL.x1, CHAPEL.z0 - 0.25, CHAPEL.z0),
    R(12.55, CHAPEL.x1, CHAPEL.z1, CHAPEL.z1 + 0.25),
  ];
}
