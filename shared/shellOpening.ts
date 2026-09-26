// A real opening in a building's shell (docs/building-with-interior.md; M7 prison real, 2026-09-26: "interiors are
// real, never instanced"). The Blender script that builds the shell cuts every window and door through and writes
// each one twice: an empty "opening_<id>" in the glb (the check reads them: client/src/dev/interiorcheck.ts) and a row
// in a generated shared/<name>Shell.ts (the plan and the room read them, so the room's walls are cut exactly where the
// shell's holes are). Pure numbers, no imports.
//
// Frame: the building's own (x along, z in; its plan's frame). y is world metres.

export interface ShellOpening {
  id: string;
  /** window (seen through both ways), door (walked through; its leaves hang in the game), slit, roof (a roof light). */
  kind: "window" | "door" | "slit" | "roof";
  /** The shell's part (the glb object) it is cut in. */
  part: string;
  /** Human words: "wing A, south face, storey 2, cell 3". */
  label: string;
  /** What stands in it in the shell: iron bars, a sash's wooden bars, lead cames, or nothing. The glass is the room's. */
  glaze: "" | "bars" | "sash" | "lead";
  shape: "rect" | "round" | "quad";
  /** Its middle on the wall's outer face; along the face (tx, tz); out of it (nx, nz). */
  x: number;
  z: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
  /** A roof light's normal has a vertical part. */
  ny?: number;
  /** Half its width; its bottom and top (an arch's crown). */
  hw: number;
  yb: number;
  yt: number;
  /** A round head: a half circle of radius hw over yt - hw. */
  arch: boolean;
  /** How deep the shell's reveal goes into the wall: the room's lining starts there. */
  depth: number;
  /** A round window: its radius round (x, cy, z). */
  r?: number;
  cy?: number;
  /** A roof light: its four corners (x, y, z) on the slope's underside. */
  pts?: Array<[number, number, number]>;
}

/** The opening's outline in its wall's plane: (u along from its middle, world y), counter-clockwise seen from outside. */
export function outline(o: ShellOpening, n = 8): Array<[number, number]> {
  if (o.shape === "round") {
    const r = o.r ?? o.hw;
    const cy = o.cy ?? (o.yb + o.yt) / 2;
    return Array.from({ length: 2 * n }, (_, i) => {
      const a = (Math.PI * i) / n;
      return [r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
    });
  }
  if (!o.arch) return [[-o.hw, o.yb], [o.hw, o.yb], [o.hw, o.yt], [-o.hw, o.yt]];
  const spring = o.yt - o.hw;
  const out: Array<[number, number]> = [[-o.hw, o.yb], [o.hw, o.yb]];
  for (let i = 0; i <= n; i++) {
    const a = (Math.PI * i) / n;
    out.push([o.hw * Math.cos(a), spring + o.hw * Math.sin(a)]);
  }
  return out;
}

/** A wall face of the shell (its outer face's line in the frame, the way out of it). */
export interface ShellFace {
  a: [number, number];
  c: [number, number];
  n: [number, number];
}

/** Does the opening lie in this face's plane (within `tol` m), facing its way, between its ends? */
export function onFace(o: ShellOpening, f: ShellFace, tol = 0.04): boolean {
  if (o.shape === "quad") return false;
  if (o.nx * f.n[0] + o.nz * f.n[1] < 0.99) return false;
  const off = (o.x - f.a[0]) * f.n[0] + (o.z - f.a[1]) * f.n[1];
  if (Math.abs(off) > tol) return false;
  const L = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  const u = ((o.x - f.a[0]) * (f.c[0] - f.a[0]) + (o.z - f.a[1]) * (f.c[1] - f.a[1])) / L;
  return u > -1e-6 && u < L + 1e-6;
}

/** Its middle along a face (metres from the face's start). */
export function alongFace(o: ShellOpening, f: ShellFace): number {
  const L = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  return ((o.x - f.a[0]) * (f.c[0] - f.a[0]) + (o.z - f.a[1]) * (f.c[1] - f.a[1])) / L;
}
