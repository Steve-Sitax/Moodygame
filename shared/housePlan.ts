// The taverns, the Poesje and the homes in the world (M7, docs/milestones/M7-taverns-homes-inworld.md):
// each stands inside its own city house (shared/city_build.json, tools/blender/build_city.py), the way the
// halls stand in their shells (shared/hallPlan.ts). This is the part the client, the Blender build and the
// tests share. Pure numbers, no three.js, no value imports (both node and vite read it).
//
// Which houses: shared/inworld_houses.json (the door of each tavern, the Poesje's cellar and each home as the
// town picks it; a new town prefers these doors, server/src/homes/town.ts). For each, this file works out:
//  - the frame: the house door's middle on the front face at the origin, local +z into the house, x across
//    (hallPlan's frame: world = origin + (x cos + z sin, -x sin + z cos) for yaw);
//  - the door (build_city.py hangs no leaf in it: the client hangs one) and the holes the build cuts for the
//    windows (the painted glass of the facade atlas, so the house looks the same by day from the street);
//  - the plan to walk (hallPlan's HallPlan: storeys by the feet, flights of stairs, the door);
//  - where the room stands (a home's room frame on its grid, shared/homes.ts), the landings and flights.
//
// Local coordinates, metres. Every wall of a room stands REVEAL (0.2 m) inside the house's faces.

import type { HallDoor, HallPlan, Level, Rect, Stair } from "./hallPlan.js";

/** M7 shops: "shop", a shop's ground floor, planned as a taproom is (docs/milestones/M7-shops.md). */
export type HouseKind = "tavern" | "cellar" | "home" | "shop";

/** One house of shared/inworld_houses.json. */
export interface InworldEntry {
  /** "tavern:ankere", "poesje", "home:garret". */
  id: string;
  kind: HouseKind;
  /** A home's class (shared/homes.ts). */
  cls?: string;
  /** Index of the house in shared/city_build.json, and its door (world, on the front face) to check it. */
  house: number;
  door: [number, number];
}

/** A house of shared/city_build.json (the fields used here). */
export interface CityHouse {
  rect: boolean;
  fp: number[][];
  o: number[];
  u: number[];
  n: number[];
  s: number[];
  t: number[];
  h: number;
  st: number;
  street: number[];
  style?: string;
  roof?: string;
  pitch?: number;
  /** Pulled down (the churches freed, 2026-09-26): not built, no inside; the entry stays so indexes hold. */
  gone?: boolean;
}

/** What a home's room is (shared/homes.ts ClassDef, the part the plan needs). */
export interface RoomDef {
  W: number;
  D: number;
  H: number;
  door: [number, number];
  doorWall?: 0 | 2;
  windows: Array<[number, number]>;
}

export const REVEAL = 0.2;
/** The door's stone sill: the ground floor inside stands on it. */
export const SILL = 0.18;
/** Grid cell of a home (shared/homes.ts CELL). */
const CELL = 0.5;
/** The painted glass in the facade atlas (client/src/world/cityTextures.ts windowAt), as parts of a bay and a storey. */
const GLASS_GROUND = { u0: 14 / 64, u1: 50 / 64, v0: 1 - 50 / 64, v1: 1 - 16 / 64 };
const GLASS_UPPER = { u0: 23 / 64, u1: 41 / 64, v0: 1 - 50 / 64, v1: 1 - 14 / 64 };
/** A flight's length (all flights of a house alike, so the landings line up) and a lane's width. */
export const FLIGHT = 4.0;
export const LANE = 1.1;
export const LANDING = 1.2;
/** A home's own door in its back wall, onto the landing (wide enough for a body with the walk's 0.45 m round it). */
export const ROOM_DOOR = 1.1;
/**
 * A shop in a deep house (more than SHOP_DEEP m inside) is its front SHOP_FRONT m: its back room stays behind a
 * partition with a shut door (world/shopRooms.ts), and is no floor to walk (issue #10: the interior check found the
 * back rooms' floors reached by no one).
 */
export const SHOP_DEEP = 8.2;
export const SHOP_FRONT = 6.6;
/**
 * The stone kerb along a street wall (tools/blender/build_city.py KERB_D, KERB_H): the pavement before the houses is
 * its top, this deep out of the wall and this high over the street's cobbles.
 */
export const KERB_D = 0.7;
export const KERB_H = 0.12;
/** Issue #28, the cellar home: its light well, this far out of the front (in the kerb, whose front stays) and under its window's sill. */
export const WELL_OUT = 0.55;
export const WELL_UNDER = 0.22;
/** How far the light well reaches past its window on either side. */
export const WELL_SIDE = 0.1;

export interface HouseFrame {
  origin: { x: number; z: number };
  yaw: number;
  /** Local x of a point s metres along the front (from the front wall's start), and back. */
  su: number;
  sd: number;
  /** Length of the front wall, the house's depth behind it. */
  L: number;
  depth: number;
  /** Local x of the two side faces (at s = 0 and s = L), and the interior (REVEAL inside the faces). */
  x0: number;
  x1: number;
  inner: Rect;
}

/** The door the build cuts (the leaf is the client's): along the front wall from its start, width, the sill, the leaf's top, the transom's top. */
export interface DoorSpec {
  s: number;
  w: number;
  J: number;
  hs: number;
  yd: number;
  yt: number;
}

/** A hole the build cuts in a wall (index of the house's ring: 0 the front), s along the wall from its start, heights. */
export interface Hole {
  wall: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

/** A window in local terms: its two ends on the house face, heights, the way out of the face (local unit). */
export interface HouseWindow {
  a: [number, number];
  b: [number, number];
  y0: number;
  y1: number;
  out: [number, number];
  /** "hole": cut through (seen through both ways); "glow": a painted window lit from inside at night. */
  kind: "hole" | "glow";
  /**
   * Issue #10: a window whose face stands back from the house's wall line (a dormer's front in the roof): how far.
   * Its ends `a`, `b` lie on that face. Unset: on the wall line.
   */
  inset?: number;
  /** How deep its reveal goes from its face (a dormer's is shallow). Unset: REVEAL. */
  depth?: number;
}

/**
 * Issue #10: a dormer in the front slope of a house's side roof, as tools/blender/build_city.py dormer_new builds it
 * (shared/inworld_dormers.json): its middle `s` along the front from the front's first corner, its front `inset` back
 * from the wall line, its width, its foot, eaves and ridge (world y), pitched or flat, and its window: width, heights,
 * the reveal's depth from the dormer's front.
 */
export interface DormerSpec {
  s: number;
  inset: number;
  w: number;
  yb: number;
  ye: number;
  yr: number;
  kind: "pitched" | "flat";
  win: { w: number; y0: number; y1: number; R: number };
}
/** The front slope of a side roof: its height at the wall line (world y) and its rise a metre in. */
export interface HouseRoof {
  eave: number;
  k: number;
}
/** One house of shared/inworld_dormers.json. */
export interface HouseDormers {
  roof: HouseRoof;
  dormers: DormerSpec[];
}

/** A flight as drawn: its rect, along z, the low end and the high end, heights, steps. */
export interface Flight {
  rect: Rect;
  foot: number;
  head: number;
  y0: number;
  y1: number;
  steps: number;
}

/** Where a home's room stands: its frame's origin (local), mirrored or not across, its floor (local y). */
export interface RoomFrame {
  x: number;
  z: number;
  mirror: 1 | -1;
  y: number;
  /** A room reached by the house's stair has its door in the back wall (shared/homes.ts doorWall 0). */
  doorWall: 0 | 2;
}

export interface HousePlan extends HallPlan {
  entry: InworldEntry;
  kind: HouseKind;
  frame: HouseFrame;
  door: DoorSpec;
  holes: Hole[];
  windows: HouseWindow[];
  /** A tavern's taproom, the Poesje's cellar hall, a home's room: the room's rect (local) and its floor. */
  room: { rect: Rect; y: number };
  /** A home's room frame. */
  roomFrame?: RoomFrame;
  flights: Flight[];
  /** Floors drawn besides the room (landings, the corridor), with their heights. */
  landings: Array<{ rect: Rect; y: number }>;
  /** The stairwell's box (local; the whole hall behind the door for the drawing), when there is one. */
  well?: { rect: Rect; y0: number; y1: number };
  /**
   * Issue #10, the garret: the front slope of the house's roof over the room, and the dormer in it whose window is the
   * room's (x: its middle, local), when the house has one the room can stand behind. The build leaves that dormer's
   * pane out (inworld_build.json "dormer": its s).
   */
  roof?: HouseRoof;
  dormer?: DormerSpec & { x: number };
  /**
   * Issue #28, the cellar home: its window is under the pavement, onto a light well before the front: the well's sides
   * (local x), how far out it reaches (z, negative: out of the front), its floor and its mouth (the pavement's top),
   * with an iron grating over the mouth. The pavement and the cobbles are cut open over it (world/pavementCut.ts).
   */
  lightWell?: { x0: number; x1: number; z0: number; y0: number; y1: number };
}

/**
 * Issue #10: a garret's ceiling stands this far under the house's roof (a single face in the city's mesh); the house's
 * dark lining (world/houseInWorld.ts) lies between the two, LINING_UNDER_ROOF under the roof, so that from inside it
 * never comes between the eye and the dormer's window.
 */
export const UNDER_ROOF = 0.06;
export const LINING_UNDER_ROOF = 0.02;
/** Issue #10: a garret's floor is walked where its sloping ceiling is at least this high (the eaves are not). */
export const GARRET_HEAD = 1.8;

// ------------------------------------------------------------------ the frame

const hyp = Math.hypot;
const rnd = (n: number, k = 1000) => Math.round(n * k) / k;

function inPoly(fp: number[][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) {
    const [xi, zi] = fp[i];
    const [xj, zj] = fp[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** The house's front wall: its start and end (world), and which edge of the ring it is. */
function frontOf(h: CityHouse): { a: [number, number]; b: [number, number]; edge: number } {
  if (h.rect) {
    const [ox, oz] = h.o;
    const [ux, uz] = h.u;
    const [nx, nz] = h.n;
    const [s0, s1] = h.s;
    const t0 = h.t[0];
    return { a: [ox + ux * s0 + nx * t0, oz + uz * s0 + nz * t0], b: [ox + ux * s1 + nx * t0, oz + uz * s1 + nz * t0], edge: 0 };
  }
  const fp = h.fp;
  const n = fp.length;
  let best = 0;
  let bestL = -1;
  for (let k = 0; k < n; k++) {
    const L = hyp(fp[(k + 1) % n][0] - fp[k][0], fp[(k + 1) % n][1] - fp[k][1]) * (h.street[k] ?? 0);
    if (L > bestL) [bestL, best] = [L, k];
  }
  return { a: fp[best] as [number, number], b: fp[(best + 1) % n] as [number, number], edge: best };
}

/** The frame of a house by its front door (build_city.py and server walkmap.ts houseDoors: the middle bay). */
export function houseFrame(h: CityHouse): HouseFrame {
  const { a, b } = frontOf(h);
  const L = hyp(b[0] - a[0], b[1] - a[1]);
  const bays = Math.max(1, Math.round(L / 3));
  const sd = ((Math.floor(bays / 2) + 0.5) / bays) * L;
  const ex = (b[0] - a[0]) / L;
  const ez = (b[1] - a[1]) / L;
  const dx = a[0] + ex * sd;
  const dz = a[1] + ez * sd;
  // into the house: the side of the front with the footprint
  let n: [number, number] = h.rect ? [h.n[0], h.n[1]] : [-ez, ex];
  if (!h.rect && !inPoly(h.fp, dx + n[0] * 0.5, dz + n[1] * 0.5)) n = [ez, -ex];
  const yaw = Math.atan2(n[0], n[1]);
  // local +x in the world: (cos yaw, -sin yaw) = (n.z, -n.x)
  const su = Math.sign(ex * n[1] - ez * n[0]) || 1;
  let depth: number;
  if (h.rect) depth = h.t[1] - h.t[0];
  else {
    depth = 0.5;
    while (depth < 40 && inPoly(h.fp, dx + n[0] * (depth + 0.25), dz + n[1] * (depth + 0.25))) depth += 0.25;
  }
  const xa = su * (0 - sd);
  const xb = su * (L - sd);
  const x0 = Math.min(xa, xb);
  const x1 = Math.max(xa, xb);
  return {
    origin: { x: dx, z: dz },
    yaw,
    su,
    sd,
    L,
    depth,
    x0,
    x1,
    inner: { minX: x0 + REVEAL, maxX: x1 - REVEAL, minZ: REVEAL, maxZ: depth - REVEAL },
  };
}

/** Local <-> world (hallPlan's rule). */
export function toWorld(f: { origin: { x: number; z: number }; yaw: number }, x: number, z: number): [number, number] {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  return [f.origin.x + x * c + z * s, f.origin.z - x * s + z * c];
}
export function toLocal(f: { origin: { x: number; z: number }; yaw: number }, wx: number, wz: number): [number, number] {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const dx = wx - f.origin.x;
  const dz = wz - f.origin.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** The ring of walls of a rect house: which local line each is (the front 0, the side at s1 1, the back 2, the side at s0 3). */
function wallLine(f: HouseFrame, wall: number): { a: [number, number]; b: [number, number]; out: [number, number] } {
  const sA = f.su * (0 - f.sd);
  const sB = f.su * (f.L - f.sd);
  switch (wall) {
    case 0:
      return { a: [sA, 0], b: [sB, 0], out: [0, -1] };
    case 1:
      return { a: [sB, 0], b: [sB, f.depth], out: [Math.sign(sB - sA), 0] };
    case 2:
      return { a: [sB, f.depth], b: [sA, f.depth], out: [0, 1] };
    default:
      return { a: [sA, f.depth], b: [sA, 0], out: [Math.sign(sA - sB), 0] };
  }
}

/** A point s metres along a wall (from its start) in local terms. */
function alongWall(f: HouseFrame, wall: number, s: number): [number, number] {
  const w = wallLine(f, wall);
  const L = hyp(w.b[0] - w.a[0], w.b[1] - w.a[1]);
  return [w.a[0] + ((w.b[0] - w.a[0]) * s) / L, w.a[1] + ((w.b[1] - w.a[1]) * s) / L];
}
/** Local x on the front -> s along the front wall. */
const sOfX = (f: HouseFrame, x: number) => f.sd + x / f.su;

function wallLen(f: HouseFrame, wall: number): number {
  return wall % 2 === 0 ? f.L : f.depth;
}

/** The painted glass of each bay on a wall's ground storey (or of storey k over it), s along the wall. */
export function paintedGlass(f: HouseFrame, wall: number, gh: number, sh: number, storey = 0): Array<{ s0: number; s1: number; y0: number; y1: number; bay: number }> {
  const L = wallLen(f, wall);
  const bays = Math.max(1, Math.round(L / 3));
  const bw = L / bays;
  const g = storey === 0 ? GLASS_GROUND : GLASS_UPPER;
  const yb = storey === 0 ? 0 : gh + (storey - 1) * sh;
  const vh = storey === 0 ? gh : sh;
  const out: Array<{ s0: number; s1: number; y0: number; y1: number; bay: number }> = [];
  for (let k = 0; k < bays; k++) out.push({ s0: k * bw + g.u0 * bw, s1: k * bw + g.u1 * bw, y0: yb + g.v0 * vh, y1: yb + g.v1 * vh, bay: k });
  return out;
}

// ------------------------------------------------------------------ the plan

const R = (minX: number, maxX: number, minZ: number, maxZ: number): Rect => ({ minX: Math.min(minX, maxX), maxX: Math.max(minX, maxX), minZ: Math.min(minZ, maxZ), maxZ: Math.max(minZ, maxZ) });
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * A flight's rect for walking, reaching a little onto the landings at both ends (its height held there): a body
 * of the walk's 0.45 m round looks that far ahead, and a landing's floor is a step too high for it seen from
 * the second-last step of a steep flight (hallPlan.walkable: a flight counts up to DROP, a floor only a STEP).
 */
const onto = (r: Rect, m: number): Rect => ({ ...r, minZ: r.minZ - m, maxZ: r.maxZ + m });

/** Steps for a rise (never steeper than 0.19 m a step). */
const stepsFor = (dy: number) => Math.max(2, Math.ceil(Math.abs(dy) / 0.19));

/**
 * Steps for a flight of `run` m (issue #10, the interior check): as stepsFor, and never more than a step's reach
 * (hallPlan STEP, 0.36) climbed in 0.25 m along it, so a walk on the 0.25 m grid (the people's, the interior check's
 * flood) goes up a step or two at a time (docs/building-with-interior.md: a 45 degree stair, 0.18 a step at most).
 * The homes' 4 m flights of 3 to 3.6 m had 0.181 to 0.188 m steps 0.2 m apart: 0.25 m climbed two of them, 0.362.
 */
const flightSteps = (dy: number, run: number) => {
  let n = stepsFor(dy);
  while (Math.ceil(0.25 / (run / n) - 1e-9) * (Math.abs(dy) / n) > 0.36 - 0.005) n++;
  return n;
};

/**
 * The whole plan of one house. `gh`, `sh`: the city's ground storey and storey heights (city_build.json).
 * `room`: a home's class (shared/homes.ts), for kind "home". `dormers`: the house's front slope and dormers as the
 * Blender build made them (shared/inworld_dormers.json), for the garret's window (issue #10).
 */
export function housePlan(entry: InworldEntry, h: CityHouse, gh: number, sh: number, room?: RoomDef, dormers?: HouseDormers): HousePlan {
  const f = houseFrame(h);
  const inner = f.inner;
  const tavern = entry.kind === "tavern";
  // M7 shops: a shop is its house's ground floor behind the street door, like a taproom
  const ground = tavern || entry.kind === "shop";
  const door: DoorSpec = { s: f.sd, w: tavern ? 1.2 : 1.1, J: 0.2, hs: SILL, yd: 2.35, yt: 2.85 };
  const hw = door.w / 2;
  const holes: Hole[] = [];
  const windows: HouseWindow[] = [];
  const addHole = (wall: number, s0: number, s1: number, y0: number, y1: number) => {
    holes.push({ wall, s0: rnd(s0), s1: rnd(s1), y0: rnd(y0), y1: rnd(y1) });
    const w = wallLine(f, wall);
    windows.push({ a: alongWall(f, wall, s0), b: alongWall(f, wall, s1), y0, y1, out: w.out, kind: "hole" });
  };
  const levels: Level[] = [];
  const stairs: Stair[] = [];
  const flights: Flight[] = [];
  const landings: Array<{ rect: Rect; y: number }> = [];
  let well: HousePlan["well"];
  let roomRect: Rect;
  let roomY = SILL;
  let roomFrame: RoomFrame | undefined;
  let dormer: HousePlan["dormer"];
  let lightWell: HousePlan["lightWell"];

  if (ground) {
    // the taproom (a shop alike): the whole ground floor. Windows: every bay of the front but the door's, and the side
    // walls on a street (the back is left painted: the fireplace and the barrels stand there)
    roomRect = { ...inner };
    const doorBay = Math.floor(Math.max(1, Math.round(f.L / 3)) / 2);
    for (const g of paintedGlass(f, 0, gh, sh)) if (g.bay !== doorBay) addHole(0, g.s0, g.s1, g.y0, g.y1);
    if (h.rect)
      for (const wall of [1, 3])
        if (h.street[wall]) {
          // keep clear of the front corner (the counter's end) and the back 1.5 m (the barrels)
          for (const g of paintedGlass(f, wall, gh, sh)) {
            const [, za] = alongWall(f, wall, g.s0);
            const [, zb] = alongWall(f, wall, g.s1);
            if (Math.min(za, zb) > 0.6 && Math.max(za, zb) < f.depth - 1.8) addHole(wall, g.s0, g.s1, g.y0, g.y1);
          }
        }
    const shopFront = entry.kind === "shop" && roomRect.maxZ - roomRect.minZ > SHOP_DEEP ? { ...roomRect, maxZ: roomRect.minZ + SHOP_FRONT } : { ...roomRect };
    levels.push({ y: SILL, floors: [R(-hw, hw, -0.12, REVEAL), shopFront], solids: [] });
  } else if (entry.kind === "cellar") {
    // the Poesje: a landing inside the door, a flight down along the door's line, the cellar hall below
    const lane = R(clamp(-0.5, inner.minX, inner.maxX - 1.0), clamp(0.5, inner.minX + 1.0, inner.maxX), 0, 0);
    const FY = -2.2;
    const n = stepsFor(SILL - FY);
    const run = n * 0.26;
    const z0 = 1.2;
    const z1 = z0 + run;
    roomRect = { ...inner };
    roomY = FY;
    const landing = R(lane.minX, lane.maxX, -0.12, z0);
    levels.push({ y: SILL, floors: [landing], solids: [] });
    landings.push({ rect: R(landing.minX, landing.maxX, REVEAL, z0), y: SILL });
    // the cellar floor: not under the flight, nor in the slot between it and the near wall
    const nearPlus = inner.maxX - lane.maxX < lane.minX - inner.minX;
    const cellar: Rect[] = nearPlus
      ? [R(inner.minX, lane.minX, REVEAL, inner.maxZ), R(lane.minX, inner.maxX, z1, inner.maxZ)]
      : [R(lane.maxX, inner.maxX, REVEAL, inner.maxZ), R(inner.minX, lane.maxX, z1, inner.maxZ)];
    levels.push({ y: FY, floors: cellar, solids: [] });
    const rect = R(lane.minX, lane.maxX, z0, z1);
    stairs.push({ rect: onto(rect, 0.4), along: "z", foot: z1, head: z0, lo: 1, hi: 0, y0: FY, y1: SILL, rise: (SILL - FY) / n });
    flights.push({ rect, foot: z1, head: z0, y0: FY, y1: SILL, steps: n });
  } else {
    if (!room) throw new Error(`housePlan: ${entry.id} needs its room`);
    const doorWall = room.doorWall ?? 2;
    const W = room.W;
    const D = room.D;
    // the windows of the room's grid (room x, from its middle)
    const win = room.windows.map(([a, b]) => [-W / 2 + a * CELL + 0.05, -W / 2 + (b + 1) * CELL - 0.05] as [number, number]);
    if (doorWall === 2) {
      // on the ground floor behind the street door (the widow's front room, the alley house): the room's
      // door is the house's; mirrored when its window would fall outside the house's front
      const fits = (m: 1 | -1) => win.every(([a, b]) => Math.min(m * a, m * b) > inner.minX + 0.1 && Math.max(m * a, m * b) < inner.maxX - 0.1);
      const mirror: 1 | -1 = fits(1) ? 1 : fits(-1) ? -1 : 1;
      roomFrame = { x: 0, z: REVEAL, mirror, y: SILL, doorWall: 2 };
      roomRect = R(-W / 2, W / 2, REVEAL, REVEAL + D);
      const wy = homeWindowY(entry.cls ?? "", room.H);
      for (const [a, b] of win) addHole(0, sOfX(f, mirror * a), sOfX(f, mirror * b), SILL + wy[0], SILL + wy[1]);
      // holes are cut from s0 up: order them
      for (const hl of holes) if (hl.s0 > hl.s1) [hl.s0, hl.s1] = [hl.s1, hl.s0];
      levels.push({ y: SILL, floors: [R(-hw, hw, -0.12, REVEAL), { ...roomRect }], solids: [] });
    } else {
      // up (or down) the house's stair: the street door, a corridor under the room, the flights up the
      // two lanes (switchback), the landing at the room's door in its back wall. The room at the front, on
      // the street, its windows over the house's painted ones (lit at night; the merchant's cut through)
      const up = entry.cls === "cellar" ? [-2.2] : entry.cls === "garret" ? storeysTo(h.st, gh, sh, true) : [gh];
      const target = up[up.length - 1];
      roomY = target;
      const zr = REVEAL;
      const zL0 = zr + D + 0.2;
      const zL1 = zL0 + LANDING;
      const zB0 = zL1 + FLIGHT;
      const zB1 = zB0 + LANDING;
      // where the room stands across: the merchant's over two painted windows of its storey, else by the door
      let rx = clamp(0, inner.minX + W / 2, inner.maxX - W / 2);
      if (entry.cls === "merchant") {
        const glass = paintedGlass(f, 0, gh, sh, 1).map((g) => {
          const xa = f.su * (g.s0 - f.sd);
          const xb = f.su * (g.s1 - f.sd);
          return [Math.min(xa, xb), Math.max(xa, xb)] as [number, number];
        });
        let best = -1;
        for (let c = inner.minX + W / 2; c <= inner.maxX - W / 2 + 1e-6; c += 0.05) {
          const inside = glass.filter(([a, b]) => a > c - W / 2 + 0.3 && b < c + W / 2 - 0.3).length;
          const score = inside * 100 - Math.abs(c);
          if (score > best) [best, rx] = [score, c];
        }
      }
      // issue #10, the garret: behind a dormer of the house's front slope, the room's window cell under the dormer's
      // window (the room turned across when that is where it fits), the one nearest where it would stand without
      let mirror: 1 | -1 = 1;
      if (entry.cls === "cellar" && win[0]) {
        // issue #28: the cellar's window opens onto a light well before the front: turned across when that keeps it
        // (and its well) farther from the street door and its step
        const gap = (m: 1 | -1) => Math.min(...win.map(([a, b]) => (Math.min(rx + m * a, rx + m * b) > 0 ? Math.min(rx + m * a, rx + m * b) : Math.max(rx + m * a, rx + m * b) < 0 ? -Math.max(rx + m * a, rx + m * b) : 0)));
        mirror = gap(-1) > gap(1) ? -1 : 1;
      }
      if (entry.cls === "garret" && dormers && win[0]) {
        const wc = (win[0][0] + win[0][1]) / 2;
        const rx0 = rx;
        let best = Infinity;
        for (const dm of dormers.dormers) {
          const dx = f.su * (dm.s - f.sd);
          for (const m of [1, -1] as const) {
            const c = dx - m * wc;
            if (c < inner.minX + W / 2 - 1e-6 || c > inner.maxX - W / 2 + 1e-6) continue;
            if (Math.abs(dx - c) + dm.w / 2 > W / 2 - 0.05) continue;
            const score = Math.abs(c - rx0) + (m < 0 ? 1e-3 : 0);
            if (score < best) {
              best = score;
              rx = c;
              mirror = m;
              dormer = { ...dm, win: { ...dm.win }, x: dx };
            }
          }
        }
      }
      roomFrame = { x: rx, z: zr, mirror, y: target, doorWall: 0 };
      roomRect = R(rx - W / 2, rx + W / 2, zr, zr + D);
      // the lanes: by the door, and reaching the room's door
      const cx = clamp((0 + rx) / 2, inner.minX + LANE, inner.maxX - LANE);
      const laneA = R(cx - LANE, cx, 0, 0);
      const laneB = R(cx, cx + LANE, 0, 0);
      const lx0 = Math.max(inner.minX, Math.min(laneA.minX, rx - ROOM_DOOR / 2 - 0.1, -hw - 0.1));
      const lx1 = Math.min(inner.maxX, Math.max(laneB.maxX, rx + ROOM_DOOR / 2 + 0.1, hw + 0.1));
      const frontLanding = (_y: number) => R(Math.min(lx0, lx1), Math.max(lx0, lx1), zL0, zL1);
      const backLanding = () => R(laneA.minX, laneB.maxX, zB0, zB1);
      const ys = [SILL, ...up];
      // the ground floor: the doorway, the corridor to the front landing
      const corridor = R(Math.max(inner.minX, -hw - 0.1), Math.min(inner.maxX, hw + 0.1), -0.12, zL0);
      levels.push({ y: SILL, floors: [corridor, frontLanding(SILL)], solids: [] });
      landings.push({ rect: R(corridor.minX, corridor.maxX, REVEAL, zL0), y: SILL }, { rect: frontLanding(SILL), y: SILL });
      for (let i = 1; i < ys.length; i++) {
        const y0 = ys[i - 1];
        const y1 = ys[i];
        const n = flightSteps(y1 - y0, FLIGHT);
        const odd = i % 2 === 1;
        const lane = odd ? laneA : laneB;
        const rect = R(lane.minX, lane.maxX, zL1, zB0);
        // the low end is the foot: going up an odd flight climbs +z, an even one -z; going down the other way
        const upward = y1 > y0;
        const lowAtFront = odd === upward;
        const foot = lowAtFront ? zL1 : zB0;
        const head = lowAtFront ? zB0 : zL1;
        const lo = upward ? i - 1 : i;
        const hi = upward ? i : i - 1;
        stairs.push({ rect: onto(rect, 0.5), along: "z", foot, head, lo, hi, y0: Math.min(y0, y1), y1: Math.max(y0, y1), rise: Math.abs(y1 - y0) / n });
        flights.push({ rect, foot, head, y0: Math.min(y0, y1), y1: Math.max(y0, y1), steps: n });
        // where this flight comes out: odd at the back landing, even at the front one
        const floors: Rect[] = [];
        const last = i === ys.length - 1;
        if (odd) {
          floors.push(backLanding());
          landings.push({ rect: backLanding(), y: y1 });
          if (last) {
            // along the other lane back to the front landing and the room's door
            const corr = R(laneB.minX, laneB.maxX, zL1, zB0);
            floors.push(corr, frontLanding(y1));
            landings.push({ rect: corr, y: y1 }, { rect: frontLanding(y1), y: y1 });
          }
        } else {
          floors.push(frontLanding(y1));
          landings.push({ rect: frontLanding(y1), y: y1 });
        }
        // the room, and the doorway through its back wall onto the front landing
        // (issue #10: a garret under the front slope is walked only where the slope leaves a man's head room)
        const walked = dormer && dormers ? { ...roomRect, minZ: Math.max(roomRect.minZ, (target + GARRET_HEAD + UNDER_ROOF - dormers.roof.eave) / dormers.roof.k) } : { ...roomRect };
        if (last) floors.push(walked, R(rx - ROOM_DOOR / 2, rx + ROOM_DOOR / 2, zr + D - 0.05, zL0 + 0.05));
        levels.push({ y: y1, floors, solids: [] });
      }
      const top = Math.max(...ys);
      const bottom = Math.min(...ys);
      well = { rect: R(Math.min(lx0, laneA.minX), Math.max(lx1, laneB.maxX), zL0, zB1), y0: bottom, y1: top + 2.6 };
      // the windows to the street: the merchant's cut through the painted ones over the room; the others glow
      if (entry.cls === "merchant") {
        for (const g of paintedGlass(f, 0, gh, sh, 1)) {
          const xa = f.su * (g.s0 - f.sd);
          const xb = f.su * (g.s1 - f.sd);
          if (Math.min(xa, xb) > roomRect.minX + 0.3 && Math.max(xa, xb) < roomRect.maxX - 0.3) addHole(0, g.s0, g.s1, g.y0, g.y1);
        }
      } else if (entry.cls === "cellar") {
        // issue #28: the cellar's window, under the pavement (the house's front below the street is its own foundation
        // wall, not the city's: no hole to cut there), onto a light well in the kerb before it, a grating over its mouth
        const wy = homeWindowY("cellar", room.H);
        for (const [a, b] of win) {
          const xa = Math.min(rx + mirror * a, rx + mirror * b);
          const xb = Math.max(rx + mirror * a, rx + mirror * b);
          windows.push({ a: alongWall(f, 0, sOfX(f, f.su > 0 ? xa : xb)), b: alongWall(f, 0, sOfX(f, f.su > 0 ? xb : xa)), y0: target + wy[0], y1: target + wy[1], out: [0, -1], kind: "hole" });
          lightWell = { x0: xa - WELL_SIDE, x1: xb + WELL_SIDE, z0: -WELL_OUT, y0: target + wy[0] - WELL_UNDER, y1: KERB_H };
        }
      } else if (entry.cls === "garret" && dormer) {
        // issue #10: the dormer's window, cut through its front (build_city.py dormer_new leaves its pane out: the room's
        // glass is there), its face `inset` back from the wall line, its reveal the dormer's
        const [ax] = alongWall(f, 0, dormer.s - dormer.win.w / 2);
        const [bx] = alongWall(f, 0, dormer.s + dormer.win.w / 2);
        windows.push({ a: [ax, dormer.inset], b: [bx, dormer.inset], y0: dormer.win.y0, y1: dormer.win.y1, out: [0, -1], kind: "hole", inset: dormer.inset, depth: dormer.win.R });
      } else if (entry.cls === "garret") {
        // no dormer the room can stand behind (the city built none there): the gable's painted window nearest the
        // room's (build_city.py paints the gable as an upper storey), glowing at night
        const k = Math.round((target - gh) / sh) + 1;
        const glass = paintedGlass(f, 0, gh, sh, k);
        const want = rx + (win[0] ? (win[0][0] + win[0][1]) / 2 : 0);
        const g = glass.sort((p, q) => Math.abs(f.su * ((p.s0 + p.s1) / 2 - f.sd) - want) - Math.abs(f.su * ((q.s0 + q.s1) / 2 - f.sd) - want))[0];
        if (g) windows.push({ a: alongWall(f, 0, g.s0), b: alongWall(f, 0, g.s1), y0: g.y0, y1: g.y1, out: [0, -1], kind: "glow" });
      }
    }
  }

  // the porch and the doorway: the street's step at 0, the sill at SILL
  const porch = R(-hw - 0.4, hw + 0.4, -1.25, -0.12);
  const steps = [{ rect: porch, y: 0 }];
  levels[0].floors.unshift(porch);
  const hallDoor: HallDoor = { id: entry.id, x: 0, z: 0, dir: 1, hw, h: door.yd - door.hs, inner: REVEAL, y: SILL, leaves: 1, open: 1.45, step: { x: 0, z: -1.2, yaw: Math.PI } };
  // the building's area: its floors and flights, a hair wider so that two meeting at an edge leave no line out of it
  const grow = (r: Rect): Rect => ({ minX: r.minX - 0.02, maxX: r.maxX + 0.02, minZ: r.minZ - 0.02, maxZ: r.maxZ + 0.02 });
  const area: Rect[] = [];
  for (const L of levels) area.push(...L.floors.map(grow));
  for (const s of stairs) area.push(grow(s.rect));
  return {
    id: entry.id as never,
    entry,
    kind: entry.kind,
    frame: f,
    origin: f.origin,
    yaw: f.yaw,
    floorY: 0,
    levels,
    stairs,
    doors: [hallDoor],
    area,
    steps,
    nodes: [],
    marks: {},
    sets: {},
    door,
    holes,
    windows,
    room: { rect: roomRect, y: roomY },
    roomFrame,
    flights,
    landings,
    well,
    ...(dormer && dormers ? { roof: { ...dormers.roof }, dormer } : {}),
    ...(lightWell ? { lightWell } : {}),
  };
}

/** The storeys' floors from the first up to the garret under the roof (over the top storey). */
function storeysTo(st: number, gh: number, sh: number, garret: boolean): number[] {
  const out: number[] = [];
  for (let k = 1; k < st; k++) out.push(gh + (k - 1) * sh);
  if (garret) out.push(gh + (st - 1) * sh);
  return out;
}

/** A home's window over its floor (world/homeRooms.ts draws the same). */
export function homeWindowY(cls: string, H: number): [number, number] {
  if (cls === "cellar") return [1.35, 1.85];
  if (cls === "garret") return [0.95, 1.4];
  if (cls === "merchant") return [0.7, 2.6];
  return [0.95, Math.min(2.05, H - 0.4)];
}

/** A home's room point (room frame: x across from its middle, z in from its front wall) -> local, and back. */
export function roomToLocal(rf: RoomFrame, x: number, z: number): [number, number] {
  return [rf.x + rf.mirror * x, rf.z + z];
}
export function localToRoom(rf: RoomFrame, x: number, z: number): [number, number] {
  return [(x - rf.x) * rf.mirror, z - rf.z];
}
