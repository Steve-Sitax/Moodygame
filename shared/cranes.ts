// Portal cranes that do not run into each other (M6 cranes; Steve 2026-09-24: "cranes moving and
// having their booms go into each other. They should not be able to turn or move further if they
// collide.").
//
// Pure geometry: a crane is a handful of capsules (a 3D segment with a radius): the jib, the hoist
// fall with its hook and load, the turning deck and cabin, the portal's top and its four legs.
// Before a crane slews, hoists or travels, world/railway.ts puts the crane where the step would
// leave it and asks for the clearance to every other crane (and to the masts of the moored ships
// and the goods train). The step is taken only if it keeps the margin, or at least does not make
// things worse (so a crane that starts too close can always back away).
//
// Numbers from tools/blender/build_boats.py (portal_crane, portal_jib): PORTAL_TOP 5.8, the jib
// heel 0.7 above it and 1.65 m out, 12.5 m long at 40 degrees, the hook 11.51 m from the axis.
// Frames as in world/railway.ts: a crane at (x, z) with yaw `yaw` (its jib at rest along local
// +z); jib angle `a` in the crane's frame (0 = rest). A point at radius r along the jib lies at
// (x + sin(yaw + a) r, z + cos(yaw + a) r).
//
// No imports: the client (vite) and the server's tests (node) read this file.

/** Margin between any part of one crane that moves (jib, fall, cabin) and anything else. */
export const JIB_GAP = 1.0;
/** Margin between two portals (their legs and bogies on the rails), in plan. */
export const PORTAL_GAP = 2.0;

export const PORTAL_TOP = 5.8;
const JIB_HEEL_R = 1.65;
const JIB_HEEL_Y = PORTAL_TOP + 0.7;
const JIB_SLOPE = Math.tan((40 * Math.PI) / 180);
/** The jib runs out to the head sheave, just past the hook. */
const JIB_END_R = 11.6;
/** Half the lattice's depth and width, with the chords. */
const JIB_R = 0.55;
/** The hook's distance from the slewing axis, and where the rope leaves the jib head (height). */
export const HOOK_R = 11.51;
export const TIP_Y = PORTAL_TOP + 8.62;
/** The deck and cabin (and the A-frame on its roof): a fat upright capsule on the axis. */
const BODY_Y0 = 6.6;
const BODY_Y1 = 9.4;
const BODY_R = 2.2;
/** The deck with its railed gallery: a ball on the axis at deck height. */
const DECK_Y = 6.4;
const DECK_R = 3.0;
/** The portal in its own frame: the four legs [x, z] at the foot and the head, the top girders. */
const LEGS: Array<[number, number, number, number]> = [
  [2.2, 2.6, 1.15, 2.35],
  [-2.2, 2.6, -1.15, 2.35],
  [2.2, -2.6, 1.15, -2.35],
  [-2.2, -2.6, -1.15, -2.35],
];
const LEG_R = 0.75;
const PORTAL_TOP_R = 1.6;
/** The portal's footprint (legs and bogies), half along the frame's x and z. */
export const PORTAL_HALF_X = 2.95;
export const PORTAL_HALF_Z = 2.9;

export type PartKind = "jib" | "fall" | "body" | "deck" | "portal" | "leg" | "mast" | "car";

/** A capsule: the segment a -> b, fattened by r. */
export interface Capsule {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
  kind: PartKind;
}

/** Where a crane stands and how it is set. */
export interface CranePose {
  x: number;
  z: number;
  yaw: number;
  /** Jib angle in the crane's frame (0 = rest). */
  a: number;
  /** The hook's height (its throat). */
  hy: number;
  /** How far the load hangs below the hook (sling and goods), 0 with none. */
  load: number;
}

/** Height of the jib's centre line at radius r from the axis. */
export function jibY(r: number): number {
  return JIB_HEEL_Y + (Math.max(r, JIB_HEEL_R) - JIB_HEEL_R) * JIB_SLOPE;
}

const cap = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, kind: PartKind): Capsule => ({ ax, ay, az, bx, by, bz, r, kind });

/** The crane's parts in the world: jib, fall, body, deck (they turn), portal top and legs (they do not). */
export function craneParts(p: CranePose): Capsule[] {
  const h = p.yaw + p.a;
  const s = Math.sin(h);
  const c = Math.cos(h);
  const co = Math.cos(p.yaw);
  const si = Math.sin(p.yaw);
  const wx = (lx: number, lz: number) => p.x + lx * co + lz * si;
  const wz = (lx: number, lz: number) => p.z - lx * si + lz * co;
  const out: Capsule[] = [
    cap(p.x + s * JIB_HEEL_R, JIB_HEEL_Y, p.z + c * JIB_HEEL_R, p.x + s * JIB_END_R, jibY(JIB_END_R), p.z + c * JIB_END_R, JIB_R, "jib"),
    cap(p.x + s * HOOK_R, p.hy - p.load, p.z + c * HOOK_R, p.x + s * HOOK_R, TIP_Y, p.z + c * HOOK_R, p.load > 0 ? 0.75 : 0.35, "fall"),
    cap(p.x, BODY_Y0, p.z, p.x, BODY_Y1, p.z, BODY_R, "body"),
    cap(p.x, DECK_Y, p.z, p.x, DECK_Y, p.z, DECK_R, "deck"),
    cap(wx(0, -2.5), PORTAL_TOP - 0.5, wz(0, -2.5), wx(0, 2.5), PORTAL_TOP - 0.5, wz(0, 2.5), PORTAL_TOP_R, "portal"),
  ];
  for (const [x0, z0, x1, z1] of LEGS) out.push(cap(wx(x0, z0), 0.55, wz(x0, z0), wx(x1, z1), PORTAL_TOP - 0.7, wz(x1, z1), LEG_R, "leg"));
  return out;
}

/** The parts that move with the slew and the hoist (the rest is the portal, checked in plan). */
const turns = (k: PartKind) => k === "jib" || k === "fall" || k === "body" || k === "deck";

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The shortest distance between two segments in 3D (a point is a segment of length 0). */
export function segDist(p: Capsule, q: Capsule): number {
  const d1x = p.bx - p.ax, d1y = p.by - p.ay, d1z = p.bz - p.az;
  const d2x = q.bx - q.ax, d2y = q.by - q.ay, d2z = q.bz - q.az;
  const rx = p.ax - q.ax, ry = p.ay - q.ay, rz = p.az - q.az;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s: number;
  let t: number;
  if (a < 1e-9 && e < 1e-9) {
    s = t = 0;
  } else if (a < 1e-9) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e < 1e-9) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const den = a * e - b * b;
      s = den > 1e-9 ? clamp01((b * f - c * e) / den) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  const dx = rx + d1x * s - d2x * t;
  const dy = ry + d1y * s - d2y * t;
  const dz = rz + d1z * s - d2z * t;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Free room between two capsules (negative: they overlap). */
export function capGap(p: Capsule, q: Capsule): number {
  return segDist(p, q) - p.r - q.r;
}

/** Cranes further apart than this can never touch (two jibs and a margin). */
export const REACH = 2 * (JIB_END_R + 1) + JIB_GAP;

/**
 * The free room between two cranes: every pair of parts where at least one turns with the slew
 * (jib, fall, body, deck); portal against portal is `portalGap`. Also the pair of parts that is
 * closest (which of `a`'s parts, which of `b`'s).
 */
export function craneGap(a: Capsule[], b: Capsule[]): { gap: number; mine: PartKind; theirs: PartKind } {
  let gap = Infinity;
  let mine: PartKind = "jib";
  let theirs: PartKind = "jib";
  for (const p of a) {
    for (const q of b) {
      if (!turns(p.kind) && !turns(q.kind)) continue;
      const g = capGap(p, q);
      if (g < gap) {
        gap = g;
        mine = p.kind;
        theirs = q.kind;
      }
    }
  }
  return { gap, mine, theirs };
}

/** The free room between a crane's jib and fall and some other things (masts, the train's cars). */
export function thingsGap(a: Capsule[], things: Capsule[], parts: PartKind[] = ["jib", "fall"]): number {
  let gap = Infinity;
  for (const p of a) {
    if (!parts.includes(p.kind)) continue;
    for (const q of things) {
      const g = capGap(p, q);
      if (g < gap) gap = g;
    }
  }
  return gap;
}

/** The free room between two portals in plan: their footprints (yaws are quarter turns). */
export function portalGap(a: CranePose, b: CranePose): number {
  const ext = (p: CranePose): [number, number] => {
    const c = Math.abs(Math.cos(p.yaw));
    const s = Math.abs(Math.sin(p.yaw));
    return [PORTAL_HALF_X * c + PORTAL_HALF_Z * s, PORTAL_HALF_X * s + PORTAL_HALF_Z * c];
  };
  const [ax, az] = ext(a);
  const [bx, bz] = ext(b);
  const gx = Math.abs(a.x - b.x) - ax - bx;
  const gz = Math.abs(a.z - b.z) - az - bz;
  if (gx > 0 && gz > 0) return Math.hypot(gx, gz);
  return Math.max(gx, gz);
}

/**
 * May a crane take a step that changes the free room from `before` to `after` (metres), with
 * `need` the margin? Yes if the step keeps the margin, or does not make things worse.
 */
export function stepOk(before: number, after: number, need: number): boolean {
  return after >= need || after >= before - 1e-6;
}

/** An upright mast (or any tall thing on a moored ship): foot and top height, radius. */
export function mast(x: number, z: number, y0: number, y1: number, r: number): Capsule {
  return cap(x, y0, z, x, y1, z, r, "mast");
}

/** A goods wagon (or a horse) as a capsule along its length at (x, z) facing yaw. */
export function car(x: number, z: number, yaw: number, half: number, y: number, r: number): Capsule {
  const s = Math.sin(yaw) * half;
  const c = Math.cos(yaw) * half;
  return cap(x - s, y, z - c, x + s, y, z + c, r, "car");
}

/**
 * Who goes first when two cranes are in each other's way: the higher rank; on a tie the lower
 * index. Ranks (world/railway.ts): 4 the player is at its ladder or on it, 3 working the train,
 * 2 travelling to another boat, 1 idle at its berth.
 */
export function outranks(a: { rank: number; index: number }, b: { rank: number; index: number }): boolean {
  return a.rank > b.rank || (a.rank === b.rank && a.index < b.index);
}

/** Jib angle (crane frame) that points straight away from (fx, fz). */
export function awayAngle(p: { x: number; z: number; yaw: number }, fx: number, fz: number): number {
  const h = Math.atan2(p.x - fx, p.z - fz);
  return angDiff(h, p.yaw);
}

/** a - b, wrapped to -pi..pi. */
export function angDiff(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
