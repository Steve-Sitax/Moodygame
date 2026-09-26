// The landmark halls in the world (M7 halls, docs/milestones/M7-halls-inworld.md): the town hall,
// the Vleeshuis, the Oostershuis and the Steen, each standing inside its Blender shell at the shell's
// own place, as the cathedral does (shared/cathedralPlan.ts). This is the part they share: the
// types of a plan and walking by it. Pure numbers, no three.js: the client draws and walks the halls
// from it (client/src/world/hallInWorld.ts, landmarkHalls.ts), the tests check it
// (server/test/halls-inworld.test.ts).
//
// A hall's frame: local x across, local z into the building, the main door's plane at z 0, local y 0
// the ground floor (FLOOR world metres above the street). World = origin + the frame turned by yaw
// (three.js rotation.y: local (x, z) -> (x cos + z sin, -x sin + z cos)).
//
// Storeys: a plan has levels (a floor height, its floors and its solids) joined by straight flights
// of stairs. Walking picks the level by the feet: of the floors under a point, the one nearest the
// feet and no more than a step (STEP) above or below them. So Jef climbs a flight step by step, walks
// on the floor he reached, and never falls through a stairwell or walks under a flight.

import type { LandmarkId } from "./landmarks.js";

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Mark = { x: number; z: number; yaw: number; y?: number };

/** A storey: its height over the ground floor, where there is floor, and the solid things on it. */
export interface Level {
  y: number;
  floors: Rect[];
  solids: Rect[];
}

/** A straight flight from its foot to its head along x or z, from level lo (y0) up to level hi (y1). */
export interface Stair {
  rect: Rect;
  along: "x" | "z";
  foot: number;
  head: number;
  lo: number;
  hi: number;
  y0: number;
  y1: number;
  rise: number;
}

/** A door to the street: its leaves hung in code (the Blender shell has the opening). */
export interface HallDoor {
  /** The door's id in shared/landmarks.ts (LANDMARK_DOORS). */
  id: string;
  /** Its middle across (local x) and its plane (local z); which way is in (+1: +z, -1: -z). */
  x: number;
  z: number;
  dir: 1 | -1;
  /** Half the opening's width, and its height over the floor at the door (local y, from the floor). */
  hw: number;
  h: number;
  /** The inner face of the wall (local z): the doorway runs from z to here. */
  inner: number;
  /** The floor at the door plane (local y). */
  y: number;
  /** The leaves: two of hw each (or one of 2 hw), opening into the hall this far (rad). */
  leaves: 1 | 2;
  open: number;
  /** Where people step in from the street and go out again (local), and where Jef is put out. */
  step: Mark;
  /**
   * An arched head over the leaves, filled with a fixed oak board (the Vleeshuis's basket arches): its
   * edge from the right springing over the crown to the left (x from the door's middle, local y).
   */
  archTop?: Array<[number, number]>;
}

export interface HallPlan {
  id: LandmarkId;
  /** The frame's origin in the world (the main door's plane, its middle), its turn, the ground floor's height. */
  origin: { x: number; z: number };
  yaw: number;
  floorY: number;
  levels: Level[];
  stairs: Stair[];
  doors: HallDoor[];
  /** Where the building answers for walking (local): the porches, the doorways, the halls with their walls. */
  area: Rect[];
  /** Porch and doorway floors below the ground floor (local y < 0): the portal's steps and the street. */
  steps: Array<{ rect: Rect; y: number }>;
  /** Jef may not go here (the people may): behind a counter, onto a stage. */
  jefOnly?: Rect[];
  /** The people's walking graph on the ground floor (local points). */
  nodes: Array<[number, number]>;
  marks: Record<string, Mark>;
  sets: Record<string, Mark[]>;
}

/** The highest step one takes without climbing (rijnkaai.ts STEP). */
export const STEP = 0.36;
/** A floor this far below the feet is no wall (a flight's lower steps, a step down); deeper is a drop, kept off like a wall. */
export const DROP = 0.8;

const inR = (r: Rect, x: number, z: number, m = 0) => x > r.minX - m && x < r.maxX + m && z > r.minZ - m && z < r.maxZ + m;
const inAny = (rs: Rect[], x: number, z: number, m = 0) => rs.some((r) => inR(r, x, z, m));
/** On a floor: its edges count (two floors meeting at an edge leave no gap). */
const onFloor = (rs: Rect[], x: number, z: number) => rs.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);

/** World <-> local. */
export function toWorld(p: HallPlan, x: number, z: number): [number, number] {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return [p.origin.x + x * c + z * s, p.origin.z - x * s + z * c];
}
export function toLocal(p: HallPlan, wx: number, wz: number): [number, number] {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const dx = wx - p.origin.x;
  const dz = wz - p.origin.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

/** A world box round the whole plan (for a quick "not here"). */
export function worldBox(p: HallPlan, m = 0.5): Rect {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const r of p.area)
    for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]] as Array<[number, number]>) {
      const [wx, wz] = toWorld(p, x, z);
      minX = Math.min(minX, wx);
      maxX = Math.max(maxX, wx);
      minZ = Math.min(minZ, wz);
      maxZ = Math.max(maxZ, wz);
    }
  return { minX: minX - m, maxX: maxX + m, minZ: minZ - m, maxZ: maxZ + m };
}

export const inArea = (p: HallPlan, x: number, z: number) => inAny(p.area, x, z);

/**
 * Is (x, z) the building's to answer in the world (World.addWalkArea)? Only where it has floor (on any storey
 * or a flight): its walls are answered by the walk map, which marks the shell's footprint as wall, and the
 * street round its porch stays the street's.
 */
export function answers(p: HallPlan, x: number, z: number): boolean {
  if (!inAny(p.area, x, z)) return false;
  for (const L of p.levels) if (onFloor(L.floors, x, z)) return true;
  for (const s of p.stairs) if (onFloor([s.rect], x, z)) return true;
  return false;
}

/** A door's doorway (local): from a little before its plane to its inner face, the opening's width. */
export function doorway(d: HallDoor, before = 0.15): Rect {
  const a = d.z - d.dir * before;
  const b = d.inner + d.dir * 0.05;
  return { minX: d.x - d.hw, maxX: d.x + d.hw, minZ: Math.min(a, b), maxZ: Math.max(a, b) };
}

/** Shut doors: their doorway from 0.7 before the leaves to 0.3 past the inner face has no floor. */
function shutAt(p: HallPlan, x: number, z: number, open: (id: string) => boolean): boolean {
  for (const d of p.doors) {
    if (open(d.id)) continue;
    const a = d.z - d.dir * 0.7;
    const b = d.inner + d.dir * 0.3;
    if (x > d.x - d.hw - 0.4 && x < d.x + d.hw + 0.4 && z > Math.min(a, b) && z < Math.max(a, b)) return true;
  }
  return false;
}

/** The step height along a flight at (x, z), whole steps. */
function stairY(s: Stair, x: number, z: number): number {
  const a = s.along === "x" ? x : z;
  const t = Math.max(0, Math.min(1, (a - s.foot) / (s.head - s.foot)));
  const y = s.y0 + (s.y1 - s.y0) * t;
  return Math.round((y - s.y0) / s.rise) * s.rise + s.y0;
}

/** The ground floor's height at (x, z) (the porch's steps below it). */
function groundY(p: HallPlan, x: number, z: number): number {
  for (const s of p.steps) if (onFloor([s.rect], x, z)) return s.y;
  return p.levels[0].y;
}

/** What one could stand on at (x, z): each level with floor there, each flight over it. `level` -1 is a flight. */
export function floorsAt(p: HallPlan, x: number, z: number): Array<{ y: number; level: number; stair: number }> {
  const out: Array<{ y: number; level: number; stair: number }> = [];
  p.levels.forEach((L, i) => {
    if (onFloor(L.floors, x, z)) out.push({ y: i === 0 ? groundY(p, x, z) : L.y, level: i, stair: -1 });
  });
  p.stairs.forEach((s, i) => {
    if (inR(s.rect, x, z)) out.push({ y: stairY(s, x, z), level: -1, stair: i });
  });
  return out;
}

/** The floor under the feet at (x, z) for feet at `feet` (local): the nearest within a step, else null. */
export function footing(p: HallPlan, x: number, z: number, feet: number): { y: number; level: number; stair: number } | null {
  let best: { y: number; level: number; stair: number } | null = null;
  for (const f of floorsAt(p, x, z)) {
    if (Math.abs(f.y - feet) > STEP + 1e-6) continue;
    // on a flight or a floor alike: the highest one within the step (a flight's foot over its floor)
    if (!best || f.y > best.y) best = f;
  }
  return best;
}

/**
 * Floor at (x, z) for feet at `feet` (local), not a wall: a floor no more than a step above them and no
 * deeper than DROP below (the world asks this round the body too: a flight's lower steps behind one are
 * no wall, a gallery's edge is). `open`: which doors stand open.
 */
export function walkable(p: HallPlan, x: number, z: number, feet = 0, open: (id: string) => boolean = () => true): boolean {
  if (!inArea(p, x, z)) return false;
  if (shutAt(p, x, z, open)) return false;
  // on a flight the steps a little ahead climb more than one step: no wall either
  return floorsAt(p, x, z).some((f) => f.y <= feet + (f.stair >= 0 ? DROP : STEP) + 1e-6 && f.y >= feet - DROP);
}

/** The floor's height (local) for feet at `feet`: the footing, or the nearest floor at all (a fall, a place). */
export function floorAt(p: HallPlan, x: number, z: number, feet = 0): number {
  const f = footing(p, x, z, feet);
  if (f) return f.y;
  let y = p.levels[0].y;
  let d = Infinity;
  for (const c of floorsAt(p, x, z)) if (Math.abs(c.y - feet) < d) [y, d] = [c.y, Math.abs(c.y - feet)];
  return y;
}

/** Which level the feet are on at (x, z) (-1 on a flight). */
export function levelAt(p: HallPlan, x: number, z: number, feet: number): number {
  const f = footing(p, x, z, feet);
  if (!f) {
    let best = 0;
    let d = Infinity;
    p.levels.forEach((L, i) => {
      if (Math.abs(L.y - feet) < d) [best, d] = [i, Math.abs(L.y - feet)];
    });
    return best;
  }
  return f.level;
}

/** A body of radius r at (x, z), feet at `feet`, touches a solid of the level it stands on? On a flight, its sides (the balustrades). */
export function hits(p: HallPlan, x: number, z: number, r: number, feet = 0, jef = true): boolean {
  const f = footing(p, x, z, feet);
  if (f && f.stair >= 0) {
    const s = p.stairs[f.stair];
    const a = s.along === "x" ? z : x;
    const [a0, a1] = s.along === "x" ? [s.rect.minZ, s.rect.maxZ] : [s.rect.minX, s.rect.maxX];
    return a - r < a0 || a + r > a1;
  }
  const L = f ? f.level : levelAt(p, x, z, feet);
  if (L < 0) return false;
  if (inAny(p.levels[L].solids, x, z, r)) return true;
  if (jef && L === 0 && p.jefOnly && inAny(p.jefOnly, x, z, r)) return true;
  return false;
}

/** Free for a body of radius r on the ground floor (the people, the path check): floor all round, no solid. */
export function freeAt(p: HallPlan, x: number, z: number, r = 0.3, jef = true, open: (id: string) => boolean = () => true, feet = 0): boolean {
  if (!walkable(p, x, z, feet, open)) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    if (!walkable(p, x + Math.cos(a) * r, z + Math.sin(a) * r, feet, open)) return false;
  }
  return !hits(p, x, z, r, feet, jef);
}

/**
 * 0 on the street .. 1 in the hall: how far in, for the fog and the light at the threshold. Along each
 * door's way in it rises from 1 m before the door to past the doorway, a half in the doorway's inner
 * part (so everywhere in the hall itself it is over a half). The least of the doors (near one door
 * the others are far behind).
 */
export function insideness(p: HallPlan, x: number, z: number): number {
  if (!inArea(p, x, z)) return 0;
  let k = 1;
  for (const d of p.doors) {
    if (Math.abs(x - d.x) > d.hw + 6) continue;
    const e = (z - d.z) * d.dir; // how far in past the door's plane
    // (M7 prison real: a door more than 6 m behind the point, on its street side, is another part's door: a
    // building with doors on several sides, the point inside by another door; no porch reaches 6 m out)
    if (e < -6) continue;
    const depth = Math.abs(d.inner - d.z);
    const e0 = -1.2;
    const e1 = 2 * (depth * 0.6) - e0;
    const t = Math.max(0, Math.min(1, (e - e0) / (e1 - e0)));
    k = Math.min(k, t * t * (3 - 2 * t));
  }
  return k;
}

/**
 * For the tests: every place (level, x, z) reached on foot from a door's step, flooding a grid of
 * `cell` metres through the floors, the doorways and the flights (a body of radius r, as Jef).
 */
export function flood(p: HallPlan, from: [number, number], cell = 0.25, r = 0.3, open: (id: string) => boolean = () => true, jef = true): (x: number, z: number, level: number, reach?: number) => boolean {
  const key = (i: number, j: number, f: number) => `${i},${j},${f.toFixed(2)}`;
  const seen = new Map<string, { x: number; z: number; y: number; level: number }>();
  const ok = (x: number, z: number, feet: number): { y: number; level: number } | null => {
    if (!walkable(p, x, z, feet, open)) return null;
    const f = footing(p, x, z, feet);
    if (!f) return null;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      if (!walkable(p, x + Math.cos(a) * (r + 0.15), z + Math.sin(a) * (r + 0.15), f.y, open)) return null;
    }
    if (hits(p, x, z, r, f.y, jef)) return null;
    return { y: f.y, level: f.level };
  };
  const q: Array<[number, number, number]> = [];
  const [fx, fz] = from;
  const i0 = Math.round(fx / cell);
  const j0 = Math.round(fz / cell);
  const s0 = ok(i0 * cell, j0 * cell, groundY(p, i0 * cell, j0 * cell));
  if (s0) {
    seen.set(key(i0, j0, s0.y), { x: i0 * cell, z: j0 * cell, y: s0.y, level: s0.level });
    q.push([i0, j0, s0.y]);
  }
  while (q.length) {
    const [i, j, y] = q.shift()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = (i + di) * cell;
      const z = (j + dj) * cell;
      const n = ok(x, z, y);
      if (!n) continue;
      const k = key(i + di, j + dj, n.y);
      if (seen.has(k)) continue;
      seen.set(k, { x, z, y: n.y, level: n.level });
      q.push([i + di, j + dj, n.y]);
    }
  }
  const pts = [...seen.values()];
  return (x, z, level, reach = 0.8) => pts.some((s) => s.level === level && Math.hypot(s.x - x, s.z - z) <= reach);
}

/**
 * Where nothing may be parked or set down before a hall's street doors (M7 doors, 2026-09-25): per
 * door, the doorway's width and `side` metres more each way, from the door's plane out over the porch's
 * steps and the step people stand on, and `street` metres of street beyond them; and each porch step
 * with `side` round it. World boxes (the halls are turned by 0 or pi, so a box is exact). Handcarts,
 * velocipedes, stalls, carts, crates and street furniture all keep off these.
 */
export function doorKeepOut(p: HallPlan, street = 2.5, side = 1.0): Rect[] {
  const box = (r: Rect): Rect => {
    const a = toWorld(p, r.minX, r.minZ);
    const b = toWorld(p, r.maxX, r.maxZ);
    return { minX: Math.min(a[0], b[0]), maxX: Math.max(a[0], b[0]), minZ: Math.min(a[1], b[1]), maxZ: Math.max(a[1], b[1]) };
  };
  const out: Rect[] = [];
  for (const d of p.doors) {
    const s = -d.dir; // the street's way (local z)
    const before = p.steps.filter((q) => q.rect.maxX > d.x - d.hw && q.rect.minX < d.x + d.hw).map((q) => q.rect);
    let far = d.step.z;
    let hw = d.hw;
    for (const r of before) {
      far = s < 0 ? Math.min(far, r.minZ) : Math.max(far, r.maxZ);
      hw = Math.max(hw, Math.abs(r.minX - d.x), Math.abs(r.maxX - d.x));
    }
    far += s * street;
    out.push(box({ minX: d.x - hw - side, maxX: d.x + hw + side, minZ: Math.min(d.z, far), maxZ: Math.max(d.z, far) }));
  }
  for (const q of p.steps) out.push(box({ minX: q.rect.minX - side, maxX: q.rect.maxX + side, minZ: q.rect.minZ - side, maxZ: q.rect.maxZ + side }));
  return out;
}
