// The cathedral's interior in the world (M7, docs/milestones/M7-cathedral-inworld.md): the plan of
// the nave, aisles, transept, choir and ambulatory, fitted inside the Blender shell of
// tools/blender/build_landmarks.py (cathedral()). Pure numbers, no three.js: the client draws the
// hall from it (client/src/world/landmarkRooms.ts buildCathedral), walks Jef and the townspeople
// in it (client/src/world/cathedralInWorld.ts), and the tests check it (server/test/cathedral-inworld.test.ts).
//
// The frame: local x = the shell's v (across, + to the north: world +x), local z = the shell's u
// (from the west front, + to the east: world +z), local y 0 = the nave's floor, which is 0.3 m
// above the square (the portal's second step). World = ORIGIN + local; the frame is not turned.
// Every wall of the plan stands at least 0.2 m inside the shell's faces (the test checks the
// corners against the footprint in shared/city.json).

export type PlanRect = { minX: number; maxX: number; minZ: number; maxZ: number; top?: number };
export type PlanMark = { x: number; z: number; yaw: number; y?: number };

/** The shell's u = 0 (its west front) and v = 0 (its axis), in world metres. */
export const ORIGIN = { x: -262, z: 145.53 } as const;
/** The nave's floor over the square (the portal's two steps, 0.15 and 0.3). */
export const FLOOR_Y = 0.3;

// ---- the shell (build_landmarks.py): the faces the interior must stay inside
export const SHELL = {
  halfNave: 6.6, // the clerestory walls
  aisleWall: 26, // the outer aisle walls
  towerFace: 3.2, // the towers' west faces
  towerSide: 18.2, // the towers' outer sides
  outerGable: 9.0, // the outer aisles' west gables
  transept: [67.3, 81.9] as const,
  transeptEnd: 36,
  apseCentre: 107,
  apseR: 6.6,
  ambulatoryR: 13,
  naveEaves: 30,
  aisleEaves: 16.5,
  /** The central west portal: the door plane (u), half its opening, the leaves' top, the trumeau. */
  door: { z: 4.0, hw: 2.55, top: 6.38, trumeau: 0.28, lintel: 7.0 },
  /** The portal's face and its splay (from hw 4.9 at the face to 2.55 at the doors). */
  portal: { face: 1.2, hw0: 4.9, steps: [0.3, 1.2] as const },
  /** The side portals in the towers' bases, and the transept portals (closed). */
  sidePortals: { v: 12.2, doorU: 4.7, hw: 1.25, top: 3.48 },
  transeptPortals: { u: 74.6, doorV: 33.4, hw: 1.75, top: 4.78 },
  /** Issue #10: the choir's buttresses (u), one bay of the clerestory's windows between each two. */
  choirBays: [81.9, 90.27, 98.63, 107] as const,
  /** Issue #10: the crossing tower's octagon over the roofs (its corners' radius, u of its middle), its lantern's windows. */
  lantern: { r: 6.2, u: 74.6, y0: 44, y1: 50.5 },
  /** Issue #10: the west front between the towers (its half width, the eaves of its roof). */
  westBay: { half: 6.2, top: 40 },
};

// ---- the interior's lines (local metres)
export const NAVE = 6; // the nave arcades (half width)
export const A2 = 12; // between the inner and middle aisles
export const A3 = 18; // between the middle and outer aisles (in the towers: a wall)
export const OUT = 25; // the outer aisle walls' inner face (0.5 thick: 25.5, inside the shell's 26 and the footprint's 25.6)
export const W0 = 5.65; // the west wall's inner face (4.85..5.65, behind the side portals' doors at 4.7)
export const WO = 10.1; // the outer aisles' west wall (behind their gables at 9.0)
/** The towers' east faces (15.2): the wall on the A3 line runs to here, the tower's outer face behind it. */
export const TOWER_E = 15.3;
export const TR = 33; // the transept ends (behind the portals' doors at 33.4)
export const CROSS0 = 68.2;
export const CROSS1 = 81.0;
export const CHOIR_E = 106.3; // the choir aisles' east wall
export const AC = 107; // the apse's centre
export const APSE_IN = 5.3; // the apse wall's inner and outer apothem (the shell's is 6.28)
export const APSE_OUT = 5.9;
export const AMB_IN = 12; // the ambulatory's outer wall (the shell's is 12.84)
export const AMB_OUT = 12.5;
export const H = 28.5; // the nave's old vault line (the eaves are at 30)
/**
 * Issue #10 (interiors are real): the high vaults of the nave, the choir and the transept spring higher and rise over the
 * shell's clerestory windows (22.3 .. 29.1 over the floor), so every real window shows whole from inside.
 */
export const VAULT = { spring: 23, crown: 29.5 } as const;
/**
 * Issue #10: the tall west bay under the west front's roof, over the great west window (23.5 .. 39.1): over the west wall's
 * top (wall) it reaches out to z0 over the portal, the west window's wall 1 m thick there.
 */
export const WEST_BAY = { z0: 2.2, z1: 13.2, spring: 33.5, riseX: 6.0, riseZ: 5.5, top: 39.7, wall: 22.2 } as const;
/**
 * Issue #10: the transept's ends. Over the portals (the transept portals' vestibule, TR) a ledge; beside and over them
 * the hall reaches out to TE, under the shell's great windows of the transept's fronts and corners.
 */
export const TE = 35.15;
/** Issue #10: the transverse arch across each outer aisle at the first pier line, its west bay (beside the tower) apart. */
export const OUTER_ARCH = { hw: 2.5, spring: 7.0, apex: 10.0 } as const;
export const PORTAL_ZONE = { z0: 71.1, z1: 78.1, top: 12.95 } as const;
export const SPRING = 21;
export const AH = 15.5; // the aisles' vaults (their eaves are at 16.5)
export const ASPRING = 12.4; // over the nave arcades' arches (apex 12.2)
/** The piers of the nave and aisles, one bay per buttress of the shell (u 13.8 .. 67.3, six bays). */
export const BAYS = [0, 1, 2, 3, 4, 5].map((k) => +(13.8 + (k * (67.3 - 13.8)) / 6).toFixed(2));
/** The choir's piers (issue #10: on the shell's buttresses, its clerestory's windows between them). */
export const CHOIR_BAYS = [90.27, 98.63];
export const RAILZ = CROSS1 + 0.9;
/** The high altar before the apse, and the retable against its east face. */
export const AZ = AC - 0.8;
export const RETABLE_Z = AC + 2.4;
/** The choir screen's gate (people only), on the north side. */
export const GATE = { x: NAVE, z0: 91.3, z1: 93.9 };
/** North is +x (the tall tower, the Elevation of the Cross, the Lady altar). */
export const NORTH = 1;

/** The west door's two leaves: hinged at the jambs, each reaching the trumeau; open, they stand this far into the nave (rad). */
export const LEAF = { w: SHELL.door.hw - SHELL.door.trumeau, open: (85 * Math.PI) / 180 };

/** The west door's opening (local): the doorway between the jambs and under the lintel. */
export const DOORWAY = { z0: SHELL.door.z, z1: W0, hw: SHELL.door.hw, h: SHELL.door.top - FLOOR_Y };

// ---- the chairs, the pulpit, the confessionals, the altars
export const CHAIR_X = [1.45, 2.2, 2.95, 3.7, 4.45];
export const ROW0 = 17.5;
export const ROWS = 24;
export const ROWD = 1.45;
export const PULPIT = { x: -NAVE + 1.1, z: BAYS[3] };
/** Chairs left out beside the pulpit (its stair and tub). */
export const chairSkipped = (side: number, cx: number, z: number) => side < 0 && cx > 3.0 && Math.abs(z - PULPIT.z) < 2.6;
export const CONFESSIONALS: Array<{ x: number; z: number }> = [
  ...[BAYS[1], BAYS[3], BAYS[5]].map((z) => ({ x: OUT - 0.75, z })),
  ...[BAYS[2], BAYS[4]].map((z) => ({ x: -(OUT - 0.75), z })),
];
/** The curate's confessional: the middle one on the north wall. */
export const CONF = { x: OUT - 0.75, z: BAYS[3] };
export const LADY = { x: NORTH * (A3 + OUT) / 2, z: CROSS0 - 1.2 };
export const STAND = { x: LADY.x, z: LADY.z - 2.2 };
export const SACRAMENT = { x: -NORTH * (A3 + OUT) / 2, z: CROSS0 - 1.2 };
/** Rubens's triptychs on the transept arms' east walls, their altars below. */
export const TRIPTYCH_X = 22.3;
export const FONT = { x: -9.5, z: W0 + 2.6 };
export const ORGAN = { z0: W0, z1: W0 + 4.6, y: 7 };
/** The side altars against the outer aisles' walls, between the confessionals (their fronts toward the aisle). */
export const SIDE_ALTARS: Array<{ x: number; z: number }> = [
  ...[BAYS[2], BAYS[4]].map((z) => ({ x: NORTH * (OUT - 0.6), z })),
  ...[BAYS[1], BAYS[3], BAYS[5]].map((z) => ({ x: -NORTH * (OUT - 0.6), z })),
];
/** The iron stands of votive candles beside the two triptychs' altars. */
export const TRI_STANDS: Array<{ x: number; z: number }> = [1, -1].map((s) => ({ x: s * (TRIPTYCH_X + 3.6), z: CROSS1 - 1.0 }));
// ---- issue #26: the five chapels round the ambulatory, as the shell's (build_landmarks.py cathedral(): "five
// radiating chapels, each closed by five sides"), and the choir's third aisle on each side (A3 .. OUT, as the nave's)
/** The chapels' axes: from the apse's middle, turned from the east (+z) toward the north (+x), as the shell's. */
export const CHAPEL_ANGLES = [-72, -36, 0, 36, 72].map((d) => (d * Math.PI) / 180);
/** A chapel's walls, the shell's outer faces: (r out along its axis from the apse's middle, s across it toward the north at a 0). */
export const CHAPEL_RING: Array<[number, number]> = [[12.6, -3.1], [15, -3.1], [16.9, -2.2], [17.6, 0], [16.9, 2.2], [15, 3.1], [12.6, 3.1]];
/** The chapels' walls' thickness (the shell's face to the hall's), their tops (the hall's frame), its ceiling's crown. */
export const CHAPEL = { wall: 0.6, top: 11.2, spring: 10.9, crown: 11.5 } as const;
/** A point of the hall's frame in a chapel's (r, s), and back. */
export const chapelRS = (a: number, x: number, z: number): [number, number] => [x * Math.sin(a) + (z - AC) * Math.cos(a), x * Math.cos(a) - (z - AC) * Math.sin(a)];
export const chapelXZ = (a: number, r: number, s: number): [number, number] => [Math.sin(a) * r + Math.cos(a) * s, AC + Math.cos(a) * r - Math.sin(a) * s];
/**
 * A chapel's floor, (r, s): the shell's faces moved in by the walls' thickness, from its mouth at the ambulatory's wall
 * (AMB_IN) round to the mouth again.
 */
export const CHAPEL_FLOOR: Array<[number, number]> = (() => {
  const R = CHAPEL_RING;
  const c: [number, number] = [R.reduce((a, p) => a + p[0], 0) / R.length, R.reduce((a, p) => a + p[1], 0) / R.length];
  // each face's line moved in: a point on it and its way
  const lines = R.slice(0, -1).map((p, i) => {
    const q = R[i + 1];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    const d: [number, number] = [(q[0] - p[0]) / L, (q[1] - p[1]) / L];
    let n: [number, number] = [-d[1], d[0]];
    if (n[0] * (c[0] - p[0]) + n[1] * (c[1] - p[1]) < 0) n = [-n[0], -n[1]];
    return { p: [p[0] + n[0] * CHAPEL.wall, p[1] + n[1] * CHAPEL.wall] as [number, number], d };
  });
  const meet = (a: (typeof lines)[number], b: (typeof lines)[number]): [number, number] => {
    const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
    const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / den;
    return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
  };
  const out: Array<[number, number]> = [[AMB_IN, lines[0].p[1]]];
  for (let i = 0; i + 1 < lines.length; i++) out.push(meet(lines[i], lines[i + 1]));
  out.push([AMB_IN, lines[lines.length - 1].p[1]]);
  return out;
})();
/** Which chapel (its index) is (x, z) in, `grow` metres out of its floor (-1: none). */
export function chapelAt(x: number, z: number, grow = 0): number {
  for (let i = 0; i < CHAPEL_ANGLES.length; i++) {
    const [r, s] = chapelRS(CHAPEL_ANGLES[i], x, z);
    if (r < AMB_IN - 0.6 || r > 18) continue;
    // a convex floor: inside every edge (the mouth's edge at the ambulatory's wall too)
    const F = CHAPEL_FLOOR;
    let inside = true;
    for (let k = 0; k < F.length && inside; k++) {
      const p = F[k];
      const q = F[(k + 1) % F.length];
      const cross = (q[0] - p[0]) * (s - p[1]) - (q[1] - p[1]) * (r - p[0]);
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      // (the floor runs counter-clockwise in (r, s): inside is to the left of each edge)
      if (cross / L < -grow) inside = false;
    }
    if (inside) return i;
  }
  return -1;
}
/** The chapels' altars on their axes, their fronts toward the ambulatory; the second (south-east) holds the Resurrection. */
export const CHAPEL_ALTARS: Array<{ x: number; z: number; a: number }> = CHAPEL_ANGLES.map((a) => {
  const [x, z] = chapelXZ(a, 15.65, 0);
  return { x, z, a };
});
/** The Resurrection triptych and its altar: in the south-east chapel, against its back (issue #26: the ambulatory's
 * wall where it hung opens into the chapels now). */
export const RESURRECTION = CHAPEL_ALTARS[1];
/** The choir stalls (1840s, carved oak) along the choir's screens; a gap on the north side at the clergy's gate. */
export const STALLS = { x0: 4.3, x1: 5.8, z0: 83.6, z1: 100.6 };

// ---- walking

const inRect = (r: PlanRect, x: number, z: number, m = 0) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
const around = (x: number, z: number, hx: number, hz = hx, top?: number): PlanRect => ({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, ...(top !== undefined ? { top } : {}) });

/** Half the width of the way in at z (the square before the portal, its splay, the doorway). */
export function porchHalf(z: number): number {
  const { face, hw0 } = SHELL.portal;
  if (z < face) return 5.6;
  if (z < SHELL.door.z) return hw0 + ((SHELL.door.hw - hw0) * (z - face)) / (SHELL.door.z - face);
  return SHELL.door.hw;
}

/** Where the interior's own walking applies (the rest is the walk map's): the porch, the doorway, the hall. */
export const PORCH_Z0 = -0.9;
export function inArea(x: number, z: number): boolean {
  const ax = Math.abs(x);
  if (z < PORCH_Z0) return false;
  if (z < 4.8) return ax < 5.6;
  // the hall with its walls (all inside the shell, whose footprint the walk map marks as wall)
  if (z < WO - 0.8) return ax < A3;
  if (z < CROSS0 - 0.6) return ax < OUT + 0.5;
  if (z < CROSS1 + 0.6) return ax < TE + 0.35;
  // (issue #26: the choir's third aisles; the chapels round the ambulatory)
  if (z < CHOIR_E + 0.6) return ax < OUT + 0.5;
  if (z < AC) return ax < AMB_OUT;
  return inHalfPolygon(x, z, AMB_OUT, 10) || chapelAt(x, z, 0.6) >= 0;
}

/** Inside the apse polygon of apothem a (the five faces round AC, as the shell's)? */
function inHalfPolygon(x: number, z: number, a: number, sides: number): boolean {
  const dz = z - AC;
  if (dz < 0) return Math.abs(x) < a / Math.cos(Math.PI / (2 * sides));
  const step = Math.PI / sides;
  for (let i = 0; i < sides; i++) {
    const ang = -Math.PI / 2 + step * (i + 0.5); // facet normal, from +z (east) toward +x
    if (x * Math.sin(ang) + dz * Math.cos(ang) > a) return false;
  }
  return true;
}

/**
 * Is there floor at (x, z)? The hall's floors minus its walls (the piers, chairs and altars are
 * solids, below). `doorOpen` false: the doorway is shut (the night).
 */
export function hasFloor(x: number, z: number, doorOpen = true): boolean {
  const ax = Math.abs(x);
  if (z < PORCH_Z0) return false;
  if (z < W0) {
    if (z >= SHELL.door.z - 0.7 && !doorOpen) return false;
    return ax < porchHalf(z);
  }
  if (z < WO) return ax < A3 - 0.4;
  if (z < CROSS0) return ax < OUT;
  // (the transept's ends: out to TE beside the portals' vestibule)
  if (z < CROSS1) return ax < TR || (ax < TE && (z < PORTAL_ZONE.z0 || z > PORTAL_ZONE.z1));
  // (issue #26: the choir's third aisle on each side, behind the transept's east wall)
  if (z < CHOIR_E) return ax < A3 || (ax < OUT && z > CROSS1 + 0.6);
  if (z < AC) return ax < AMB_IN;
  // the sanctuary inside the apse, or the ambulatory round it, or a chapel off it
  return inHalfPolygon(x, z, APSE_IN, 5) || (!inHalfPolygon(x, z, APSE_OUT, 5) && inHalfPolygon(x, z, AMB_IN, 10)) || chapelAt(x, z) >= 0;
}

/** The floor's height at (x, z), local (the porch's steps are below 0; the choir and the altar's steps above). */
export function floorAt(x: number, z: number): number {
  if (z < SHELL.portal.steps[0]) return -FLOOR_Y;
  if (z < SHELL.portal.steps[1]) return -FLOOR_Y / 2;
  return sanctuaryFloor(x, z);
}

/** The choir two steps up behind the rail, the altar's three more. */
export function sanctuaryFloor(x: number, z: number): number {
  if (!(Math.abs(x) < NAVE && z > CROSS1 + 0.3)) return 0;
  if (z >= AC && !inHalfPolygon(x, z, APSE_IN, 5)) return 0;
  if (Math.abs(x) < 3.5 && z > AZ - 2.3) return 0.36 + Math.min(3, Math.floor((z - (AZ - 2.3)) / 0.55) + 1) * 0.18;
  return 0.36;
}

/** The solid things on the floor, for everyone (local rects; no top: they are not climbed). */
export function solids(): PlanRect[] {
  const out: PlanRect[] = [];
  for (const s of [-1, 1]) {
    for (const z of BAYS) {
      out.push(around(s * NAVE, z, 0.92, 0.75));
      out.push(around(s * A2, z, 0.72, 0.55));
      if (z > TOWER_E) out.push(around(s * A3, z, 0.72, 0.55));
    }
    // the wall along the tower's outer side (the tower's own face stands inside it)
    out.push({ minX: s > 0 ? A3 - 0.4 : -A3 - 0.3, maxX: s > 0 ? A3 + 0.3 : -A3 + 0.4, minZ: WO - 0.8, maxZ: TOWER_E });
    // the outer aisle's transverse arch at the first pier line: its two jambs
    {
      const mid = (A3 + 0.35 + OUT) / 2;
      for (const [a, b] of [[A3 + 0.3, mid - OUTER_ARCH.hw], [mid + OUTER_ARCH.hw, OUT]]) out.push({ minX: s > 0 ? a : -b, maxX: s > 0 ? b : -a, minZ: BAYS[0] - 0.3, maxZ: BAYS[0] + 0.3 });
    }
    for (const z of CHOIR_BAYS) {
      out.push(around(s * NAVE, z, 0.92, 0.75));
      out.push(around(s * A2, z, 0.72, 0.55));
      out.push(around(s * A3, z, 0.72, 0.55));
    }
    // (issue #26) the arcade into the choir's third aisle: its ends at the transept's wall and at the east wall
    for (const [z0, z1] of [[CROSS1 + 0.3, CROSS1 + 1.25], [CHOIR_E - 0.65, CHOIR_E]]) out.push({ minX: s * A3 - 0.35, maxX: s * A3 + 0.35, minZ: z0, maxZ: z1 });
    // the crossing's great piers, and the arches' feet from the aisles into the transept
    for (const z of [CROSS0, CROSS1]) {
      out.push(around(s * NAVE, z, 1.3));
      out.push(around(s * A2, z, 0.8, 0.45));
      if (z === CROSS0) out.push(around(s * A3, z, 0.8, 0.45));
    }
    // the outer aisles end in a wall at the transept (the Lady altar, the Sacrament altar)
    out.push({ minX: s > 0 ? A3 : -OUT, maxX: s > 0 ? OUT : -A3, minZ: CROSS0 - 0.6, maxZ: CROSS0 });
    // the choir screens (a gate on the north side for the clergy, closed to Jef below)
    for (const [z0, z1] of s * NORTH > 0 ? [[CROSS1, GATE.z0], [GATE.z1, AC]] : [[CROSS1, AC]]) out.push({ minX: s * NAVE - 0.2, maxX: s * NAVE + 0.2, minZ: z0, maxZ: z1 });
    // the organ gallery's two columns
    out.push(around(s * 4.4, ORGAN.z0 + 4.2, 0.35));
    // the triptychs' altars on the transept's east walls
    out.push(around(s * TRIPTYCH_X, CROSS1 - 0.55, 1.8, 0.35));
  }
  // the communion rail across the choir's mouth
  out.push({ minX: -NAVE, maxX: NAVE, minZ: RAILZ - 0.2, maxZ: RAILZ + 0.2 });
  // the trumeau between the two doors, and the two leaves standing open into the nave (LEAF_OPEN)
  out.push({ minX: -SHELL.door.trumeau, maxX: SHELL.door.trumeau, minZ: SHELL.door.z - 0.55, maxZ: SHELL.door.z + 0.05 });
  for (const s of [-1, 1]) out.push({ minX: s > 0 ? 2.28 : -2.62, maxX: s > 0 ? 2.62 : -2.28, minZ: SHELL.door.z, maxZ: SHELL.door.z + 2.3 });
  // the chairs: one block per half row
  for (let r = 0; r < ROWS; r++) {
    const z = ROW0 + r * ROWD;
    for (const s of [-1, 1]) {
      const xs = CHAIR_X.filter((cx) => !chairSkipped(s, cx, z));
      if (!xs.length) continue;
      const a = Math.min(...xs) - 0.25;
      const b = Math.max(...xs) + 0.25;
      out.push({ minX: s > 0 ? a : -b, maxX: s > 0 ? b : -a, minZ: z - 0.25, maxZ: z + 0.21 });
    }
  }
  // the pulpit's trunk and stair
  out.push({ minX: PULPIT.x - 0.6, maxX: PULPIT.x + 1.25, minZ: PULPIT.z - 2.3, maxZ: PULPIT.z + 1.0 });
  // the side altars, the stands by the triptychs, the Resurrection's altar in the ambulatory
  for (const a of SIDE_ALTARS) out.push(around(a.x, a.z, 0.65, 1.7));
  for (const t of TRI_STANDS) out.push(around(t.x, t.z, 0.4, 0.3));
  // (issue #26: the chapels' altars; the Resurrection's in the south-east chapel)
  for (const c of CHAPEL_ALTARS) out.push(around(c.x, c.z, c === RESURRECTION ? 1.1 : 0.9));
  // the choir stalls (people only walk the choir: its screens and the rail keep Jef out)
  for (const s of [-1, 1]) {
    const runs: Array<[number, number]> = s * NORTH > 0 ? [[STALLS.z0, GATE.z0 - 0.3], [GATE.z1 + 0.3, STALLS.z1]] : [[STALLS.z0, STALLS.z1]];
    for (const [z0, z1] of runs) out.push({ minX: s > 0 ? STALLS.x0 : -STALLS.x1, maxX: s > 0 ? STALLS.x1 : -STALLS.x0, minZ: z0, maxZ: z1 });
  }
  for (const c of CONFESSIONALS) out.push(around(c.x, c.z, 0.7, 1.8));
  // the Lady altar and its stand of candles; the Sacrament altar; the font
  out.push(around(LADY.x, LADY.z, 1.5, 0.5));
  out.push(around(STAND.x, STAND.z, 0.9, 0.25));
  out.push(around(SACRAMENT.x, SACRAMENT.z, 1.3, 0.45));
  out.push(around(FONT.x, FONT.z, 0.55));
  // the high altar and its steps (the celebrant stands on them: marks, not walking)
  out.push({ minX: -1.7, maxX: 1.7, minZ: AZ + 0.05, maxZ: AZ + 1.15 });
  return out;
}

/** Jef only: into the choir through the clergy's gate (the choir is theirs). */
export function jefOnly(): PlanRect[] {
  return [{ minX: GATE.x - 0.3, maxX: GATE.x + 0.3, minZ: GATE.z0, maxZ: GATE.z1 }];
}

const SOLIDS = solids();
const JEF_ONLY = jefOnly();

/** Free for a body of radius r (local): on the floor and off every solid. `jef`: the choir's gate is shut to him. */
export function freeAt(x: number, z: number, r = 0.3, jef = true, doorOpen = true): boolean {
  if (!hasFloor(x, z, doorOpen)) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    if (!hasFloor(x + Math.cos(a) * r, z + Math.sin(a) * r, doorOpen)) return false;
  }
  for (const s of SOLIDS) if (inRect(s, x, z, r)) return false;
  if (jef) for (const s of JEF_ONLY) if (inRect(s, x, z, r)) return false;
  return true;
}

/** Hits a solid (for the world's collider test). */
export function hitsSolid(x: number, z: number, r: number, jef = true): boolean {
  for (const s of SOLIDS) if (inRect(s, x, z, r)) return true;
  if (jef) for (const s of JEF_ONLY) if (inRect(s, x, z, r)) return true;
  return false;
}

// ---- the places people go (local; y is the floor there if not the hall's)

export const MARKS: Record<string, PlanMark> = {
  altar: { x: 0, z: AZ - 0.1, yaw: 0, y: 0.9 },
  server: { x: 1.7, z: AZ - 0.8, yaw: -Math.PI / 2, y: 0.72 },
  sacristy: { x: 15, z: 94.4 + 4.1, yaw: 0 },
  gate: { x: 4.5, z: (GATE.z0 + GATE.z1) / 2, yaw: -Math.PI / 2, y: 0.36 },
  choirFront: { x: 0, z: RAILZ + 1.4, yaw: Math.PI, y: 0.36 },
  railN: { x: -0.45, z: RAILZ - 0.6, yaw: 0 },
  railS: { x: 0.45, z: RAILZ - 0.6, yaw: 0 },
  beadleMass: { x: -1.0, z: CROSS0 - 3.2, yaw: Math.PI },
  chairsPost: { x: -5.2, z: ROW0 - 1.6, yaw: Math.PI / 2 },
  organist: { x: 0, z: ORGAN.z0 + 3.6, yaw: Math.PI, y: ORGAN.y + 0.25 },
  confessor: { x: CONF.x, z: CONF.z, yaw: -Math.PI / 2 },
  penitent: { x: CONF.x - 1.0, z: CONF.z - 1.25, yaw: Math.PI / 2 },
  stand: { x: STAND.x, z: STAND.z, yaw: 0 },
  pulpit: { x: PULPIT.x, z: PULPIT.z, yaw: Math.PI / 2, y: 2.4 },
  // M6 sermon: the preacher waits at the foot of the pulpit's stair during high mass, then climbs
  preacherWait: { x: PULPIT.x - 0.3, z: PULPIT.z - 2.6, yaw: Math.PI / 2 },
  pulpitFoot: { x: PULPIT.x - 0.45, z: PULPIT.z - 1.35, yaw: 0 },
  /** The step on the square before the west door: people come in and go out here. */
  door: { x: 1.4, z: -0.5, yaw: 0 },
};

/** Where people come in from the square and go out to it (two doors either side of the trumeau). */
export const STEP_IN: PlanMark[] = [
  { x: 1.4, z: -0.5, yaw: 0 },
  { x: -1.4, z: -0.5, yaw: 0 },
];

export function chairs(): PlanMark[] {
  const out: PlanMark[] = [];
  for (let r = 0; r < ROWS; r++) {
    const z = ROW0 + r * ROWD;
    for (const s of [-1, 1]) for (const cx of CHAIR_X) if (!chairSkipped(s, cx, z)) out.push({ x: s * cx, z: z + 0.02, yaw: 0, y: 0 });
  }
  return out;
}

export const SETS: Record<string, PlanMark[]> = {
  chairs: chairs(),
  standAt: [
    { x: STAND.x - 0.6, z: STAND.z - 0.75, yaw: 0 },
    { x: STAND.x + 0.6, z: STAND.z - 0.75, yaw: 0 },
    { x: STAND.x, z: STAND.z - 0.9, yaw: 0 },
  ],
  chapels: [
    { x: SACRAMENT.x, z: SACRAMENT.z - 1.4, yaw: 0 },
    { x: TRIPTYCH_X, z: CROSS1 - 2.2, yaw: 0 },
    { x: -TRIPTYCH_X, z: CROSS1 - 2.2, yaw: 0 },
    { x: TR - 3.2, z: (CROSS0 + CROSS1) / 2 - 1.5, yaw: Math.PI / 2 },
    { x: -(TR - 3.2), z: (CROSS0 + CROSS1) / 2 + 1.5, yaw: -Math.PI / 2 },
    // (issue #26) before the altars of the five chapels round the ambulatory
    ...CHAPEL_ANGLES.map((a) => {
      const [x, z] = chapelXZ(a, 13.3, 0);
      return { x, z, yaw: a };
    }),
  ],
  beadleRound: [
    { x: -9, z: ROW0 - 1, yaw: 0 },
    { x: -9, z: CROSS0 - 3, yaw: 0 },
    { x: 9, z: CROSS0 - 3, yaw: 0 },
    { x: 9, z: ROW0 - 1, yaw: 0 },
  ],
  chairsWalk: [
    { x: -0.75, z: ROW0, yaw: 0 },
    { x: -0.75, z: ROW0 + (ROWS - 1) * ROWD, yaw: 0 },
    { x: 0.75, z: ROW0 + (ROWS - 1) * ROWD, yaw: Math.PI },
    { x: 0.75, z: ROW0, yaw: Math.PI },
  ],
  curateWalk: [
    { x: 15, z: 98.5, yaw: 0 },
    { x: 15, z: 85, yaw: 0 },
    { x: 9, z: 104, yaw: 0 },
    { x: 0, z: AC + 9, yaw: 0 },
    { x: -9, z: 104, yaw: 0 },
    { x: -15, z: 85, yaw: 0 },
  ],
};

/** The people's walking graph: points on the floor, joined where they see each other (client walkGraph). */
export function nodes(): Array<[number, number]> {
  const n: Array<[number, number]> = [];
  // in from the square: either side of the trumeau, through the doorway
  for (const s of [-1, 1]) n.push([s * 1.4, -0.5], [s * 1.4, 2.9], [s * 1.4, 7.2]);
  n.push([0, 12], [0, ROW0 - 1.2], [0, ROW0 + ROWS * ROWD], [0, CROSS0 - 2], [0, (CROSS0 + CROSS1) / 2], [0, CROSS1 - 0.9]);
  for (const s of [-1, 1]) {
    for (const x of [9, 15]) for (const z of [6.7, 18.3, 36.1, 53.9, 64.5]) n.push([s * x, z]);
    for (const z of [12, 27.2, 45, 62.9]) n.push([s * 21.5, z]);
    for (const x of [9, 15, 21.5, 28.5]) n.push([s * x, (CROSS0 + CROSS1) / 2]);
    for (const z of [85, 90.3, 98.5, 104]) for (const x of [9, 15]) n.push([s * x, z]);
    // the ambulatory
    for (const a of [30, 60]) n.push([s * 9 * Math.sin((a * Math.PI) / 180), AC + 9 * Math.cos((a * Math.PI) / 180)]);
    n.push([s * 5.25, ROW0 - 1.2], [s * 5.25, CROSS0 - 2]);
    // (issue #26) the choir's third aisle
    for (const z of [85, 94.4, 102.8]) n.push([s * 21.5, z]);
  }
  // (issue #26) the chapels: in the ambulatory before each, and in it
  for (const a of CHAPEL_ANGLES) n.push(chapelXZ(a, 9.5, 0), chapelXZ(a, 13.3, 0));
  n.push([0, AC + 9]);
  // through the gate into the choir
  n.push([7.6, (GATE.z0 + GATE.z1) / 2], [4.2, (GATE.z0 + GATE.z1) / 2], [2.2, AZ - 3], [0, RAILZ + 1.4]);
  return n;
}

// ---- the world

export const toWorld = (x: number, z: number): [number, number] => [ORIGIN.x + x, ORIGIN.z + z];
export const toLocal = (x: number, z: number): [number, number] => [x - ORIGIN.x, z - ORIGIN.z];

/** The whole plan's box in the world (for a quick "not here" test). */
export const WORLD_BOX: PlanRect = { minX: ORIGIN.x - TR - 1, maxX: ORIGIN.x + TR + 1, minZ: ORIGIN.z + PORCH_Z0 - 0.5, maxZ: ORIGIN.z + AC + AMB_OUT + 1 };

/**
 * 0 on the square .. 1 in the nave: how far in, for the fog and light at the threshold. Rises
 * over the last metres of the porch and the first of the nave (the doorway is at 4.0 .. 5.65).
 */
export function insideness(x: number, z: number): number {
  if (!inArea(x, z)) return 0;
  const t = (z - 1.5) / 7;
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
}

/** The walls of the plan as boxes (local, with y), for the check that the hall fits in the shell. */
export function wallCorners(): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (const s of [-1, 1]) {
    pts.push([s * (OUT + 0.5), WO - 0.8], [s * (OUT + 0.5), CROSS0 - 0.6]); // outer aisle walls
    pts.push([s * (A3 - 0.4), W0 - 0.8], [s * A3, WO - 0.8]); // the tower's inner side, the outer aisle's west wall
    pts.push([s * (TR + 0.35), CROSS0 - 0.6], [s * (TR + 0.35), CROSS1 + 0.6]); // the transept's ends
    pts.push([s * (A3 + 0.6), CROSS1 + 0.6], [s * (A3 + 0.6), CHOIR_E + 0.6]); // the choir aisles
    pts.push([s * NAVE * 1.075, CHOIR_E]); // the clerestory's outer face
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 10;
      const r = AMB_OUT / Math.cos(Math.PI / 20);
      pts.push([Math.sin(a) * r, AC + Math.cos(a) * r]);
    }
  }
  return pts;
}

/**
 * Where nothing may be parked or set down before the west door (M7 doors, 2026-09-25): the portal's
 * mouth and `side` metres more each way, from the door's plane out over the porch's steps and `street`
 * metres of the square beyond (more than a hall's: the town streams in here for mass). A world box (as
 * hallPlan.ts doorKeepOut for the halls).
 */
export function doorKeepOut(street = 4.0, side = 1.0): PlanRect[] {
  const hw = SHELL.portal.hw0 + side;
  return [{ minX: ORIGIN.x - hw, maxX: ORIGIN.x + hw, minZ: ORIGIN.z + PORCH_Z0 - street, maxZ: ORIGIN.z + SHELL.door.z }];
}
