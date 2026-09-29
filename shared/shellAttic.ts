// Issue #28 (interiors are real: the attics, the turrets, the towers). What a shell's Blender script writes, besides its
// openings (shared/shellOpening.ts), so the room behind its roof windows and tower windows is built at the shell's true
// size: the roof's slopes, the dormers' insides (bays) and the towers' rooms. Generated into shared/<name>Shell.ts in
// the WORLD's frame; moved into a hall's frame here (as shellOpening.ts inFrame does). Pure numbers, no imports.

type P2 = [number, number];

/** A slope of the roof: its eave on a wall's outer face, from `a` along `t` for `len`, `n` out of the wall. */
export interface ShellRoofFace {
  a: P2;
  t: P2;
  n: P2;
  len: number;
  /** A hipped slope: it narrows by as much as it rises in (in metres in from the eave) at both ends. */
  hip: boolean;
}

/** The roof: the slate stands `eaves` high over each face's line and rises `slope` a metre in, up to `ridge`. */
export interface ShellRoof {
  eaves: number;
  slope: number;
  ridge: number;
  faces: ShellRoofFace[];
}

/** A dormer's inside: its front's middle on its outer face, along it `t`, out of it `n`. */
export interface ShellBay {
  kind: string;
  label: string;
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  /** Half the width between the room's cheeks. */
  hw: number;
  /** The shell's reveal ends this far in (the room's lining starts there) and the room's lining ends here. */
  depth: number;
  back: number;
  /** The front's foot (world y: the room's lining from here) and the bay's ceiling. */
  y0: number;
  yc: number;
}

/**
 * A tower standing out of the building (a corner turret, a stair tower): its shell's ring below the corbels (`ring`,
 * `ext`: which faces stand outside the building) and its top stage's (`top`, `topIn`: which stand over the building's
 * inside), the stair's shaft (from y0 to ys) and the top room (from ys to its ceiling yc), each a convex polygon the
 * shell was cut away inside. `door`: the face with the stair's own door at its foot (-1: none).
 */
export interface ShellTower {
  id: string;
  label: string;
  sides: number;
  ring: P2[];
  ext: boolean[];
  top: P2[];
  topIn: boolean[];
  shaft: P2[];
  room: P2[];
  y0: number;
  ys: number;
  yc: number;
  door: number;
}

function turn(origin: { x: number; z: number }, yaw: number) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const dir = (x: number, z: number): P2 => [x * c - z * s, x * s + z * c];
  const pt = (p: P2): P2 => dir(p[0] - origin.x, p[1] - origin.z);
  return { dir, pt };
}

/** The roof in a plan's frame (hallPlan.ts). */
export function roofInFrame(r: ShellRoof, origin: { x: number; z: number }, yaw: number): ShellRoof {
  const { dir, pt } = turn(origin, yaw);
  return { ...r, faces: r.faces.map((f) => ({ ...f, a: pt(f.a), t: dir(...f.t), n: dir(...f.n) })) };
}

/** The bays in a plan's frame. */
export function baysInFrame(rows: readonly ShellBay[], origin: { x: number; z: number }, yaw: number): ShellBay[] {
  const { dir, pt } = turn(origin, yaw);
  return rows.map((b) => {
    const [x, z] = pt([b.x, b.z]);
    const [tx, tz] = dir(b.tx, b.tz);
    const [nx, nz] = dir(b.nx, b.nz);
    return { ...b, x, z, tx, tz, nx, nz };
  });
}

/** The towers in a plan's frame. */
export function towersInFrame(rows: readonly ShellTower[], origin: { x: number; z: number }, yaw: number): ShellTower[] {
  const { pt } = turn(origin, yaw);
  return rows.map((t) => ({ ...t, ring: t.ring.map(pt), top: t.top.map(pt), shaft: t.shaft.map(pt), room: t.room.map(pt) }));
}

/** Is (x, z) inside a convex polygon (either winding)? */
export function inConvex(poly: readonly P2[], x: number, z: number, margin = 0): boolean {
  let sign = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % n];
    const ex = bx - ax;
    const ez = bz - az;
    const L = Math.hypot(ex, ez) || 1;
    const c = (ex * (z - az) - ez * (x - ax)) / L;
    if (Math.abs(c) < margin) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/** A convex polygon grown by `d` (each edge moved out; the polygon wound either way). */
export function grow(poly: readonly P2[], d: number): P2[] {
  const n = poly.length;
  const cx = poly.reduce((a, p) => a + p[0], 0) / n;
  const cz = poly.reduce((a, p) => a + p[1], 0) / n;
  return poly.map(([x, z]) => {
    // (a regular polygon: each corner out along its ray from the middle by d over the half angle's cosine)
    const r = Math.hypot(x - cx, z - cz) || 1;
    const k = (r + d / Math.cos(Math.PI / n)) / r;
    return [cx + (x - cx) * k, cz + (z - cz) * k] as P2;
  });
}
