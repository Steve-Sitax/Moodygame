// Sint-Pauluskerk and Sint-Jacobskerk inside (M7, docs/milestones/M7-paul-james.md): the plans of their halls,
// fitted inside the Blender shells of tools/blender/build_churches.py (stpaul(), stjacob(); their numbers PF and
// JF), walked the halls' way (shared/hallPlan.ts). Pure numbers, no three.js: the client builds and walks the
// halls from them (client/src/world/gothicHall.ts), the tests check them (server/test/gothic-inworld.test.ts).
//
// The frame of each: the west door's plane at local z 0, local z into the church (the shell's a, less the door's
// a), local x across = the shell's -s (x < 0 north, world -z; x > 0 south, world +z). The shell's a runs to world
// -x, so the frame is turned by yaw -pi/2: world x = origin.x - z, world z = origin.z + x. Local y 0 is the floor,
// a step (0.15) over the street; the porch before the door is the street.

import type { HallPlan, Mark, Rect } from "./hallPlan.js";

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX, maxX, minZ, maxZ });

export interface GothicHall {
  id: "stpaul" | "stjacob";
  label: string;
  plan: HallPlan;
  /**
   * Issue #10 (interiors are real): the shell's outer faces the hall's walls line (local, from the axis; the west
   * front is at z 0): the nave's clerestory, the aisles', the chapels', the transept's ends, the choir's, the apse's
   * corners (round L.apse.z), St James's choir aisles and ambulatory. The windows are cut through the shell (their
   * rows: shared/churchesShell.ts), their reveals `reveal` deep; the hall's linings stand behind them, their inner
   * face `lining` in from the shell's face (world/realOpenings.ts lining).
   */
  S: { nave: number; aisle: number; chapel: number; arm: number; choir: number; apse: number; amb?: number; reveal: number; lining: number };
  /** The shell's lines inside (local): the linings' inner faces, the arcades' lines. */
  L: {
    west: number;
    nave: number;
    aisle: number;
    chapels: Array<{ side: -1 | 1; x: number; z0: number; z1: number; ceil: number }>;
    bays: number[];
    tx: [number, number];
    arm: number;
    choir: number;
    apse: { z: number; r: number };
    amb?: number;
    tower?: { z1: number; half: number };
  };
  /**
   * Heights (local). St James: the tower hall's vault (its springing and rise: over the tower's great west window), the
   * ambulatory's flat ceiling (over its windows), the apse's shallow half dome (over its clerestory's heads).
   */
  H: {
    cap: number;
    arcRise: number;
    aisleSpring: number;
    aisleRise: number;
    naveSpring: number;
    naveRise: number;
    chapelCeil: number;
    ambSpring?: number;
    ambRise?: number;
    towerSpring?: number;
    towerRise?: number;
    ambCeil?: number;
    apseSpring?: number;
    apseRise?: number;
  };
  door: { hw: number; spring: number; h: number; round: boolean; inner: number };
  /** The oak draught porch inside the west door. */
  porch: Porch;
  /** Where the furniture stands (local). */
  F: {
    chairs: Rect[];
    pulpit: { x: number; z: number };
    confessionals: Array<{ x: number; z: number; side: -1 | 1 }>;
    altars: Array<{ x: number; z: number; w: number; h: number; face: number; pic: "altar" | "side" | "chapel" | "lady" }>;
    rail: { z: number; x0: number; x1: number; gate: number };
    stalls: Array<{ x: number; z0: number; z1: number; side: -1 | 1 }>;
    font: { x: number; z: number };
    organ: { z0: number; z1: number; y: number; x0: number; x1: number; screen: boolean };
    paintings: Array<{ x: number; z: number; y: number; w: number; h: number; face: number }>;
  };
  /** The places paths() checks inside (local). */
  points: Array<{ label: string; x: number; z: number; reach: number }>;
}

/** The pointed arch's height over its springing at d from its middle, for a span w and a rise (the Kit's pointedProfile). */
export function pointedAt(d: number, half: number, rise: number): number {
  const u = Math.abs(d);
  if (u >= half) return 0;
  if (rise < half) {
    // lower than a half circle: a segmental arch (one arc, its centre under the springing)
    const r = (half * half + rise * rise) / (2 * rise);
    return Math.sqrt(Math.max(0, r * r - u * u)) - (r - rise);
  }
  // two arcs, each centred on the springing line on the far side of the middle
  const r = (half * half + rise * rise) / (2 * half);
  const c = half - r;
  return Math.sqrt(Math.max(0, r * r - (u - c) ** 2));
}

// ================================================================ St Paul

/**
 * An oak draught porch (tochtportaal) inside a church's west door, as Antwerp's churches have them: 4.4 m wide (4.8 at
 * St James's broader door) from the west wall's inner face (z0) 2.4 m in, its front shut, a doorway in each side (1.6
 * wide, 2.6 high) into the church. From the street, through the open door, one sees its oak front (world/gothicHall.ts).
 */
export interface Porch {
  x: number;
  z0: number;
  z1: number;
  t: number;
  door: readonly [number, number];
  h: number;
  doorH: number;
  solids: Rect[];
}
function porch(x: number, z0: number): Porch {
  const z1 = z0 + 2.4;
  const t = 0.12;
  const door = [z0 + 0.3, z0 + 1.9] as const;
  const side = (s: number) => [Math.min(s * x, s * (x - t)), Math.max(s * x, s * (x - t))];
  const solids = [R(-x, x, z1 - t, z1), ...[-1, 1].flatMap((s) => [R(side(s)[0], side(s)[1], z0, door[0]), R(side(s)[0], side(s)[1], door[1], z1)])];
  return { x, z0, z1, t, door, h: 3.3, doorH: 2.6, solids };
}

function paul(): GothicHall {
  const BD = 0.7;
  const z = (a: number) => a - BD;
  const bays = [0.7, 8.56, 16.42, 24.28, 32.14, 40.0].map(z); // the shell's bays (a), less the door's a
  // issue #10: the shell's faces (build_churches.py PF: NV, AO, CO = TE = S - BD) and the linings behind them; the
  // hall's walls stand at the linings' inner faces (the old walls stood where the shell's reveals ended)
  const S = { nave: 5.5, aisle: 15.0, chapel: 18.86, arm: 18.86, choir: 5.5, apse: 5.5, reveal: 0.42, lining: 0.62 };
  const IN = (f: number) => f - S.lining;
  const L = {
    west: 0.9,
    nave: 5.5,
    aisle: IN(S.aisle),
    // (to the transept's west face: the arm's lining stands behind it, the chapel runs to its back)
    chapels: [{ side: -1 as const, x: -IN(S.chapel), z0: 0.9, z1: z(40.0) + S.reveal, ceil: 6.2 }],
    bays,
    tx: [z(40.0), z(51.5)] as [number, number],
    arm: IN(S.arm),
    choir: IN(S.choir),
    // (the apse's inner corners, round its middle: the lining's inner face)
    apse: { z: z(69.5), r: S.apse - S.lining / Math.cos(Math.PI / 10) },
  };
  const H = { cap: 5.9, arcRise: 3.0, aisleSpring: 8.4, aisleRise: 4.8, naveSpring: 14.4, naveRise: 5.9, chapelCeil: 6.2 };
  const door = { hw: 1.3, spring: 3.9, h: 5.2, round: true, inner: 0.9 };
  const P0 = porch(2.2, L.west);
  const mids = bays.slice(0, -1).map((b, i) => (b + bays[i + 1]) / 2);
  const marks: Record<string, Mark> = {
    door: { x: 0, z: -1.8, yaw: Math.PI },
    inside: { x: 0, z: 2.0, yaw: 0 },
    nave: { x: 0, z: 20, yaw: 0 },
    crossing: { x: 0, z: 44.5, yaw: 0 },
    rail: { x: 0, z: 50.0, yaw: 0 },
  };
  const F: GothicHall["F"] = {
    chairs: [R(0.9, 4.4, 9.0, 37.2), R(-4.4, -0.9, 9.0, 21.0), R(-4.4, -0.9, 26.4, 37.2)],
    pulpit: { x: -4.55, z: bays[3] },
    confessionals: [
      ...[mids[1], mids[2], mids[3], mids[4]].map((c) => ({ x: L.aisle - 0.65, z: c + 2.6, side: 1 as const })),
      ...[mids[1], mids[2], mids[3], mids[4]].map((c) => ({ x: L.aisle - 0.65, z: c - 2.6, side: 1 as const })),
    ],
    altars: [
      { x: 0, z: L.apse.z + 3.4, w: 4.6, h: 12.5, face: 0, pic: "altar" },
      { x: -L.arm + 0.3, z: z(45.75), w: 4.4, h: 7.0, face: -1, pic: "lady" },
      { x: L.arm - 0.3, z: z(45.75), w: 4.4, h: 7.0, face: 1, pic: "side" },
    ],
    rail: { z: L.tx[1] + 0.4, x0: -L.choir, x1: L.choir, gate: 0.7 },
    stalls: [
      { x: -L.choir + 0.6, z0: L.tx[1] + 2.0, z1: L.apse.z - 1.4, side: -1 },
      { x: L.choir - 0.6, z0: L.tx[1] + 2.0, z1: L.apse.z - 1.4, side: 1 },
    ],
    font: { x: -10.0, z: 3.4 },
    organ: { z0: L.west, z1: 6.6, y: 6.0, x0: -L.nave + 0.35, x1: L.nave - 0.35, screen: false },
    // the fifteen Mysteries of the Rosary in a row along the north aisle wall, over the chapels' arches
    paintings: Array.from({ length: 15 }, (_, i) => ({ x: -L.aisle + 0.06, z: bays[0] + 2.2 + i * ((bays[5] - bays[0] - 4.4) / 14), y: 7.35, w: 1.45, h: 1.9, face: 1 })),
  };
  const floors: Rect[] = [
    R(-2.0, 2.0, -1.9, 0), // the porch (the street)
    R(-door.hw, door.hw, 0, L.west),
    R(-L.aisle, L.aisle, L.west, L.tx[0]),
    R(L.chapels[0].x, -L.aisle, L.chapels[0].z0, L.chapels[0].z1), // the north chapels, open to the aisle
    // the arches from the aisles through the arms' west walls (lined behind the shell's faces), the arms and the
    // crossing, the crossing's east strip before the choir
    R(-L.aisle, L.aisle, L.tx[0], L.tx[0] + S.lining),
    R(-L.arm, L.arm, L.tx[0] + S.lining, L.tx[1] - S.lining),
    R(-S.nave, S.nave, L.tx[1] - S.lining, L.tx[1]),
    R(-L.choir, L.choir, L.tx[1], L.apse.z),
    R(-3.6, 3.6, L.apse.z, L.apse.z + 3.6),
  ];
  const col = (x: number, zz: number, r: number) => R(x - r, x + r, zz - r, zz + r);
  const solids: Rect[] = [
    ...bays.slice(1, -1).flatMap((b) => [col(-L.nave, b, 0.62), col(L.nave, b, 0.62)]),
    ...[L.tx[0], L.tx[1]].flatMap((b) => [col(-L.nave, b, 0.75), col(L.nave, b, 0.75)]),
    // the chapels' partitions (the shell's buttresses)
    ...bays.slice(1, -1).map((b) => R(L.chapels[0].x, -L.aisle, b - 0.3, b + 0.3)),
    // the organ gallery's columns
    col(-2.6, 6.6, 0.3),
    col(2.6, 6.6, 0.3),
    // the oak draught porch inside the west door (a tochtportaal): shut in front, its doorways at the sides
    ...P0.solids,
    ...F.chairs,
    R(F.pulpit.x - 0.7, F.pulpit.x + 0.7, F.pulpit.z - 2.4, F.pulpit.z + 0.7),
    R(F.font.x - 0.5, F.font.x + 0.5, F.font.z - 0.5, F.font.z + 0.5),
    ...F.confessionals.map((c) => R(c.x - 0.65, c.x + 0.65, c.z - 1.5, c.z + 1.5)),
    R(-L.arm, -L.arm + 1.4, z(45.75) - 2.4, z(45.75) + 2.4),
    R(L.arm - 1.4, L.arm, z(45.75) - 2.4, z(45.75) + 2.4),
    // the communion rail (its gate Jef's barrier only), the stalls, the high altar
    R(-L.choir, -0.7, F.rail.z - 0.15, F.rail.z + 0.15),
    R(0.7, L.choir, F.rail.z - 0.15, F.rail.z + 0.15),
    ...F.stalls.map((s) => R(Math.min(s.x - 0.6, s.x + 0.6), Math.max(s.x - 0.6, s.x + 0.6), s.z0, s.z1)),
    R(-3.0, 3.0, L.apse.z + 2.2, L.apse.z + 3.6),
  ];
  const plan: HallPlan = {
    id: "stpaul" as unknown as HallPlan["id"],
    origin: { x: 140.72 - BD, z: 266 },
    yaw: -Math.PI / 2,
    floorY: 0.15,
    levels: [{ y: 0, floors, solids }],
    stairs: [],
    doors: [
      {
        id: "stpaul_west",
        x: 0,
        z: 0,
        dir: 1,
        hw: door.hw,
        h: door.spring,
        inner: door.inner,
        y: 0,
        leaves: 2,
        open: (84 * Math.PI) / 180,
        step: marks.door,
        archTop: Array.from({ length: 13 }, (_, i) => [door.hw * Math.cos((Math.PI * i) / 12), door.spring + door.hw * Math.sin((Math.PI * i) / 12)] as [number, number]),
      },
    ],
    area: [R(-2.1, 2.1, -1.95, L.west), R(-18.5, 18.5, L.west - 0.05, L.tx[1] + 0.2), R(-L.choir - 0.1, L.choir + 0.1, L.tx[1], L.apse.z + 4.0)],
    steps: [{ rect: R(-2.0, 2.0, -1.9, 0), y: -0.15 }],
    jefOnly: [R(-0.7, 0.7, F.rail.z - 0.15, F.rail.z + 0.15)],
    nodes: [
      [0, -1.8], [0, 2.0], [-3.2, 2.0], [3.2, 2.0], [0, 8.2], [0, 24], [0, 38.5], [0, 44.5], [-9.8, 8.2], [-9.8, 24], [-9.8, 38.5], [9.8, 8.2], [9.8, 24], [9.8, 38.5],
      [-14, 44.5], [14, 44.5], [0, 49.6],
    ],
    marks,
    sets: {},
  };
  return {
    id: "stpaul",
    label: "St Paul's",
    plan,
    S,
    L,
    H,
    door,
    porch: P0,
    F,
    points: [
      { label: "St Paul's, inside the door", x: 0, z: 2.0, reach: 1.2 },
      { label: "St Paul's, the nave", x: 0, z: 24, reach: 1.2 },
      { label: "St Paul's, the north aisle under the Rosary paintings", x: -12.5, z: 20, reach: 1.2 },
      { label: "St Paul's, a north chapel", x: -16.6, z: 20, reach: 1.0 },
      { label: "St Paul's, a confessional", x: 12.6, z: mids[2] + 2.6, reach: 1.0 },
      { label: "St Paul's, the pulpit", x: -3.4, z: bays[3] - 1.2, reach: 1.0 },
      { label: "St Paul's, the crossing", x: 0, z: 44.5, reach: 1.2 },
      { label: "St Paul's, the Rosary altar", x: -L.arm + 2.4, z: z(45.75), reach: 1.0 },
      { label: "St Paul's, the Holy Cross altar", x: L.arm - 2.4, z: z(45.75), reach: 1.0 },
      { label: "St Paul's, the communion rail", x: 0, z: F.rail.z - 0.9, reach: 1.0 },
    ],
  };
}

// ================================================================ St James

function james(): GothicHall {
  const BD = 0.8;
  const z = (a: number) => a - BD;
  const bayA = [0.8, 13.0, 19.4, 25.8, 32.2, 38.6, 45.0];
  const bays = bayA.map(z);
  // issue #10: the shell's faces (build_churches.py JF: NV, AO, CO, TE = S - BD, AMB, the apse's corners at CR round
  // CHE) and the linings behind them
  const S = { nave: 6.0, aisle: 14.0, chapel: 20.5, arm: 27.22, choir: 6.0, apse: 6.0, amb: 13.2, reveal: 0.42, lining: 0.62 };
  const IN = (f: number) => f - S.lining;
  const L = {
    west: 1.4,
    nave: 6.0,
    aisle: IN(S.aisle),
    // (the chapels run to the back of the transept's west lining; the north ones from the west front's lining)
    chapels: [
      { side: -1 as const, x: -IN(S.chapel), z0: S.lining, z1: z(45.0) + S.reveal, ceil: 7.6 },
      { side: 1 as const, x: IN(S.chapel), z0: z(13.6) + 0.25, z1: z(45.0) + S.reveal, ceil: 7.6 },
    ],
    bays,
    tx: [z(45.0), z(57.0)] as [number, number],
    arm: IN(S.arm),
    choir: 5.6,
    apse: { z: z(64.0), r: 5.6 },
    amb: IN(S.amb),
    tower: { z1: z(13.0), half: 5.4 },
  };
  // (the tower hall's vault over the great west window's head, 26.9; the ambulatory's ceiling over its windows'
  // heads, 10.4; the apse's shallow half dome over its clerestory's, 25.4, under the choir's vault's crown and the roof)
  const H = {
    cap: 7.0,
    arcRise: 2.3,
    aisleSpring: 9.4,
    aisleRise: 5.3,
    naveSpring: 19.8,
    naveRise: 6.4,
    chapelCeil: 7.6,
    ambSpring: 7.4,
    ambRise: 3.4,
    towerSpring: 21.8,
    towerRise: 5.4,
    ambCeil: 11.2,
    apseSpring: 25.35,
    apseRise: 1.2,
  };
  const door = { hw: 1.8, spring: 6.2 - 0.742 * 3.6, h: 6.2, round: false, inner: 1.4 };
  const P0 = porch(2.4, L.west);
  const mids = bays.slice(0, -1).map((b, i) => (b + bays[i + 1]) / 2);
  const marks: Record<string, Mark> = {
    door: { x: 0, z: -2.0, yaw: Math.PI },
    inside: { x: 0, z: 2.6, yaw: 0 },
    nave: { x: 0, z: 28, yaw: 0 },
    crossing: { x: 0, z: 50.2, yaw: 0 },
    screen: { x: 0, z: L.tx[1] - 1.2, yaw: 0 },
  };
  const scrZ = L.tx[1];
  const F: GothicHall["F"] = {
    chairs: [R(1.0, 4.9, 16.0, 40.6), R(-4.9, -1.0, 16.0, 22.0), R(-4.9, -1.0, 27.4, 40.6)],
    pulpit: { x: -5.0, z: bays[3] },
    confessionals: [
      // four in the ambulatory (its straight parts)
      { x: -L.amb! + 0.65, z: z(58.5), side: -1 },
      { x: L.amb! - 0.65, z: z(58.5), side: 1 },
      { x: -L.amb! + 0.65, z: z(62.5), side: -1 },
      { x: L.amb! - 0.65, z: z(62.5), side: 1 },
    ],
    altars: [
      { x: 0, z: L.apse.z + 3.2, w: 6.0, h: 13.5, face: 0, pic: "altar" },
      // Rubens's burial chapel, behind the high altar: the radiating chapel in the ambulatory's axis (issue #10: the
      // shell's bay, its back 1.5 m out of the ambulatory's middle side; its altar against the back's lining)
      { x: 0, z: L.apse.z + (S.amb * Math.cos(Math.PI / 10) + 1.5 - S.lining) - 0.55, w: 3.6, h: 7.0, face: 0, pic: "chapel" },
      { x: -L.arm + 0.3, z: z(51.0), w: 4.6, h: 7.5, face: -1, pic: "lady" },
      { x: L.arm - 0.3, z: z(51.0), w: 4.6, h: 7.5, face: 1, pic: "side" },
      // the two altars of the choir screen, facing the crossing
      { x: -3.4, z: scrZ - 1.1, w: 2.2, h: 4.0, face: 2, pic: "side" },
      { x: 3.4, z: scrZ - 1.1, w: 2.2, h: 4.0, face: 2, pic: "lady" },
    ],
    rail: { z: scrZ, x0: -L.choir, x1: L.choir, gate: 1.0 },
    stalls: [
      { x: -L.choir + 0.6, z0: scrZ + 1.4, z1: L.apse.z - 0.8, side: -1 },
      { x: L.choir - 0.6, z0: scrZ + 1.4, z1: L.apse.z - 0.8, side: 1 },
    ],
    font: { x: 2.4, z: 7.2 },
    organ: { z0: scrZ - 0.6, z1: scrZ + 0.6, y: 5.6, x0: -L.choir, x1: L.choir, screen: true },
    paintings: [],
  };
  const floors: Rect[] = [
    R(-2.4, 2.4, -2.2, 0),
    R(-door.hw, door.hw, 0, L.west),
    R(-L.aisle, L.aisle, L.west, L.tx[0]),
    // the aisles' west ends beside the tower (outside its side walls; the west front lined 0.62 deep)
    R(-L.aisle, -(L.tower.half + 0.62), S.lining, L.west),
    R(L.tower.half + 0.62, L.aisle, S.lining, L.west),
    R(L.chapels[0].x, -L.aisle, L.chapels[0].z0, L.chapels[0].z1),
    R(L.aisle, L.chapels[1].x, L.chapels[1].z0, L.chapels[1].z1),
    // the arches from the aisles, and into the choir's aisles, through the arms' lined faces; the arms
    R(-L.aisle, L.aisle, L.tx[0], L.tx[0] + S.lining),
    R(-L.arm, L.arm, L.tx[0] + S.lining, L.tx[1] - S.lining),
    R(-L.amb!, L.amb!, L.tx[1] - S.lining, L.tx[1]),
    R(-L.amb!, L.amb!, L.tx[1], L.apse.z),
    // the ambulatory round the apse, stepped inside its five outer walls
    R(-11.35, 11.35, L.apse.z, L.apse.z + 3.5),
    R(-10.2, 10.2, L.apse.z + 3.5, L.apse.z + 7.0),
    R(-7.3, 7.3, L.apse.z + 7.0, L.apse.z + 9.5),
    R(-4.1, 4.1, L.apse.z + 9.5, L.apse.z + 11.8),
  ];
  const col = (x: number, zz: number, r: number) => R(x - r, x + r, zz - r, zz + r);
  const apsePts = [0, 1, 2, 3, 4, 5].map((i) => {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    return [Math.sin(a) * -1, Math.cos(a)] as [number, number];
  });
  const solids: Rect[] = [
    // the tower hall's side walls with their arches to the aisles (arches 3.6 wide at z 4.4..8.0)
    ...[-1, 1].flatMap((sg) => [R(sg * 5.7 - 0.32, sg * 5.7 + 0.32, 0.5, 4.4), R(sg * 5.7 - 0.32, sg * 5.7 + 0.32, 8.0, L.tower.z1 + 0.6)]),
    ...bays.slice(2, -1).flatMap((b) => [col(-L.nave, b, 0.62), col(L.nave, b, 0.62)]),
    ...[L.tx[0], L.tx[1]].flatMap((b) => [col(-L.nave, b, 0.8), col(L.nave, b, 0.8)]),
    ...L.chapels.flatMap((c) => bays.slice(1, -1).filter((b) => b > c.z0 + 0.5).map((b) => (c.side < 0 ? R(c.x, -L.aisle, b - 0.3, b + 0.3) : R(L.aisle, c.x, b - 0.3, b + 0.3)))),
    // the baptistery's wall (the south's first bay is closed), the choir's columns and its marble screens
    R(L.aisle, L.chapels[1].x, L.chapels[1].z0 - 0.5, L.chapels[1].z0),
    ...[-1, 1].flatMap((sg) => [col(sg * L.nave, z(60.5), 0.55), R(sg * L.nave - 0.2, sg * L.nave + 0.2, L.tx[1], L.apse.z)]),
    ...apsePts.map(([x, zz]) => col(x * L.apse.r, L.apse.z + zz * L.apse.r, 0.5)),
    ...apsePts.slice(0, -1).map(([x0, z0], i) => {
      const [x1, z1] = apsePts[i + 1];
      return R(Math.min(x0, x1) * L.apse.r - 0.2, Math.max(x0, x1) * L.apse.r + 0.2, L.apse.z + Math.min(z0, z1) * L.apse.r - 0.2, L.apse.z + Math.max(z0, z1) * L.apse.r + 0.2);
    }),
    ...F.chairs,
    R(F.pulpit.x - 0.7, F.pulpit.x + 0.7, F.pulpit.z - 2.4, F.pulpit.z + 0.7),
    R(F.font.x - 0.5, F.font.x + 0.5, F.font.z - 0.5, F.font.z + 0.5),
    // the oak draught porch inside the tower door (a tochtportaal): shut in front, its doorways at the sides
    ...P0.solids,
    ...F.confessionals.map((c) => R(c.x - 0.65, c.x + 0.65, c.z - 1.5, c.z + 1.5)),
    R(-L.arm, -L.arm + 1.4, z(51.0) - 2.5, z(51.0) + 2.5),
    R(L.arm - 1.4, L.arm, z(51.0) - 2.5, z(51.0) + 2.5),
    // the choir screen (its gate Jef's barrier), the altars on it (Rubens's stands in its chapel, railed off)
    R(-L.choir, -1.0, scrZ - 0.6, scrZ + 0.6),
    R(1.0, L.choir, scrZ - 0.6, scrZ + 0.6),
  ];
  const plan: HallPlan = {
    id: "stjacob" as unknown as HallPlan["id"],
    origin: { x: -55.47 - BD, z: 305 },
    yaw: -Math.PI / 2,
    floorY: 0.15,
    levels: [{ y: 0, floors, solids }],
    stairs: [],
    doors: [
      {
        id: "stjacob_west",
        x: 0,
        z: 0,
        dir: 1,
        hw: door.hw,
        h: door.spring,
        inner: door.inner,
        y: 0,
        leaves: 2,
        open: (84 * Math.PI) / 180,
        step: marks.door,
        archTop: pointedTop(door.hw, 0.742 * 2 * door.hw, door.spring),
      },
    ],
    area: [R(-2.5, 2.5, -2.25, L.west), R(-L.arm - 0.1, L.arm + 0.1, 0.55, L.tx[1] + 0.2), R(-L.amb! - 0.1, L.amb! + 0.1, L.tx[1], L.apse.z + 12.0)],
    steps: [{ rect: R(-2.4, 2.4, -2.2, 0), y: -0.15 }],
    jefOnly: [R(-1.0, 1.0, scrZ - 0.6, scrZ + 0.6)],
    nodes: [
      [0, -2.0], [0, 2.6], [-3.4, 2.5], [3.4, 2.5], [0, 14.5], [0, 28.5], [0, 43.5], [0, 50.2], [-9.8, 14.5], [-9.8, 28.5], [-9.8, 43.5], [9.8, 14.5], [9.8, 28.5], [9.8, 43.5],
      [-20, 50.2], [20, 50.2], [-9.4, 58], [9.4, 58], [-8.5, 66], [8.5, 66], [0, 72.5],
    ],
    marks,
    sets: {},
  };
  return {
    id: "stjacob",
    label: "St James's",
    plan,
    S,
    L,
    H,
    door,
    porch: P0,
    F,
    points: [
      { label: "St James's, the tower hall", x: 0, z: 5.4, reach: 1.2 },
      { label: "St James's, the nave", x: 0, z: 28.5, reach: 1.2 },
      { label: "St James's, a north chapel", x: -17.0, z: mids[3], reach: 1.0 },
      { label: "St James's, a south chapel", x: 17.0, z: mids[3], reach: 1.0 },
      { label: "St James's, the pulpit", x: -3.3, z: bays[3] - 1.2, reach: 1.0 },
      { label: "St James's, the crossing before the choir screen", x: 0, z: scrZ - 1.4, reach: 1.2 },
      { label: "St James's, the north transept's altar", x: -L.arm + 2.4, z: z(51.0), reach: 1.0 },
      { label: "St James's, the ambulatory", x: -9.4, z: z(60.5), reach: 1.2 },
      { label: "St James's, Rubens's chapel", x: 0, z: L.apse.z + 9.3, reach: 1.2 },
      { label: "St James's, a confessional in the ambulatory", x: L.amb! - 2.0, z: z(62.5), reach: 1.0 },
    ],
  };
}

/** A pointed head over a door from the right springing over the apex to the left (x from the middle, y). */
function pointedTop(hw: number, rise: number, spring: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= 12; i++) {
    const x = hw - (2 * hw * i) / 12;
    out.push([x, spring + pointedAt(x, hw, rise)]);
  }
  return out;
}

export const PAUL = paul();
export const JAMES = james();
export const GOTHIC: GothicHall[] = [PAUL, JAMES];

/** Where nothing may stand before the west doors: the porch and 2.5 m of street before it (world boxes). */
export function gothicKeepOut(street = 2.5): Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> {
  return GOTHIC.map((g) => {
    const d = g.plan.doors[0];
    const x0 = g.plan.origin.x + 0.0;
    // the frame is turned by -pi/2: world x = origin.x - z, world z = origin.z + x
    const zStreet = -2.2 - street;
    return { minX: x0, maxX: x0 - zStreet, minZ: g.plan.origin.z - d.hw - 1.0, maxZ: g.plan.origin.z + d.hw + 1.0 };
  });
}
