// Every stall, shop table, awning and goods pile the game sets out in the streets, as a list the dev
// stall check reads (dev/stallcheck.ts, __scheldemist.stallcheck()). The places that build them
// (game/stalls.ts, game/market.ts, game/lively.ts) add each thing here with where it stands and a way
// to get its model's points; nothing is computed until the check runs.

/** A model's points in its own frame (x along, y up, z toward the customers). */
export type Pts = ArrayLike<number>;

export interface StallThing {
  /** "shop table", "town stall", "market stall", "cathedral stall", "shop goods" ... */
  kind: string;
  label: string;
  x: number;
  z: number;
  /** three.js yaw: the thing's +z looks along (sin yaw, cos yaw). */
  yaw: number;
  /** Its back stands against a house wall (a shop table and its awning): the wall must be there behind it all along. */
  wall?: boolean;
  /** Stands against a landmark (the cathedral's lean-to stalls): its back may touch the landmark's ground. */
  leanTo?: boolean;
  /** How much street it must leave free before it (m); default 1.5. */
  front?: number;
  /** The parts: points in the thing's frame, and each part's own place in that frame (u along, y up, v out, yaw, scale). */
  parts: Array<{ pts: Pts; u: number; y: number; v: number; yaw?: number; s?: [number, number, number] }>;
}

export const stallThings: StallThing[] = [];

export function addStallThing(t: StallThing): void {
  stallThings.push(t);
}

/** Forget what a builder put in before (a rebuild). */
export function dropStallThings(kind: (k: string) => boolean): void {
  for (let i = stallThings.length - 1; i >= 0; i--) if (kind(stallThings[i].kind)) stallThings.splice(i, 1);
}

/** All points of a thing in its own frame: [u (along), y (up), v (out), ...]. */
export function thingLocal(t: StallThing): number[] {
  const out: number[] = [];
  for (const p of t.parts) {
    const pc = Math.cos(p.yaw ?? 0);
    const ps = Math.sin(p.yaw ?? 0);
    const [sx, sy, sz] = p.s ?? [1, 1, 1];
    for (let i = 0; i + 2 < p.pts.length; i += 3) {
      const lx = p.pts[i] * sx;
      const lz = p.pts[i + 2] * sz;
      out.push(p.u + lx * pc + lz * ps, p.y + p.pts[i + 1] * sy, p.v - lx * ps + lz * pc);
    }
  }
  return out;
}

/** All points of a thing in the world: [x, y, z, ...]. */
export function thingPoints(t: StallThing): number[] {
  const out: number[] = [];
  const c = Math.cos(t.yaw);
  const s = Math.sin(t.yaw);
  for (const p of t.parts) {
    const pc = Math.cos(p.yaw ?? 0);
    const ps = Math.sin(p.yaw ?? 0);
    const [sx, sy, sz] = p.s ?? [1, 1, 1];
    for (let i = 0; i + 2 < p.pts.length; i += 3) {
      const lx = p.pts[i] * sx;
      const ly = p.pts[i + 1] * sy;
      const lz = p.pts[i + 2] * sz;
      // the part's own turn, then its place in the thing's frame
      const u = p.u + lx * pc + lz * ps;
      const v = p.v - lx * ps + lz * pc;
      out.push(t.x + u * c + v * s, p.y + ly, t.z - u * s + v * c);
    }
  }
  return out;
}
