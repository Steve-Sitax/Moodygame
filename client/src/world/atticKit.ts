import * as THREE from "three";
import type { Kit, MatDef } from "./landmarkKit";
import { lining } from "./realOpenings";
import { onFace, type ShellFace, type ShellOpening } from "../../../shared/shellOpening";
import { grow, type ShellBay, type ShellRoof, type ShellRoofFace, type ShellTower } from "../../../shared/shellAttic";

// Issue #28 (interiors are real: attics and towers). The room's side of a shell's roof and towers, built in a hall's
// frame (a kit whose group stands at the hall's floor, `floorY` world metres up) at the shell's true size, from the
// numbers its Blender script writes (shared/shellAttic.ts):
//  - slopeLining(): the boards under a slope of the roof (a hair under the slate), the dormers' bays and the towers cut
//    out of it;
//  - bay(): a dormer's inside: the lining behind its front (its window cut exactly where the shell's is), its cheeks
//    and its ceiling, open to the attic under the roof;
//  - towerRoom(): a turret's or a stair tower's stair shaft (the linings behind its slits, plain walls toward the
//    building, a newel stair) and its top room under the spire (linings behind its windows, a floor, a ceiling), and
//    toward the attic the covers of the tower's walls that stand in it.
// Shared materials only (the hall's), few meshes (the kit merges them).

type P2 = [number, number];

/** The plan's (s, in) of a roof face for a point (x, z): along its eave, and in from its wall's outer face. */
export function roofST(f: ShellRoofFace, x: number, z: number): P2 {
  return [(x - f.a[0]) * f.t[0] + (z - f.a[1]) * f.t[1], (f.a[0] - x) * f.n[0] + (f.a[1] - z) * f.n[1]];
}

/** The line where a convex polygon crosses a vertical line s = const: its lowest and highest `in`, or null. */
function crossing(poly: readonly P2[], s: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [s0, i0] = poly[i];
    const [s1, i1] = poly[(i + 1) % n];
    if ((s0 - s) * (s1 - s) > 0) continue;
    if (Math.abs(s1 - s0) < 1e-9) {
      lo = Math.min(lo, i0, i1);
      hi = Math.max(hi, i0, i1);
    } else {
      const v = i0 + ((i1 - i0) * (s - s0)) / (s1 - s0);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return lo <= hi ? [lo, hi] : null;
}

/**
 * The boards under one slope of the roof, `drop` metres under the slate (world y), from `in0` in from the eave to the
 * ridge, between s0 and s1 along it (a hipped slope narrows as it rises), with holes (convex polygons in the face's
 * (s, in)): the dormers' bays open into it, the towers stand through it. Faces down, into the attic.
 */
export function slopeLining(k: Kit, def: MatDef, roof: ShellRoof, f: ShellRoofFace, o: { s0: number; s1: number; in0: number; drop: number; holes: P2[][]; floorY: number; tile?: number; tint?: number }): void {
  const ridgeIn = (roof.ridge - roof.eaves) / roof.slope;
  const top = (s: number) => (f.hip ? Math.min(ridgeIn, s, f.len - s) : ridgeIn);
  const cuts = new Set<number>([o.s0, o.s1]);
  if (f.hip) for (const v of [ridgeIn, f.len - ridgeIn, f.len / 2]) if (v > o.s0 && v < o.s1) cuts.add(v);
  for (const h of o.holes) for (const [s] of h) if (s > o.s0 && s < o.s1) cuts.add(s);
  const ss = [...cuts].sort((a, b) => a - b);
  const pos: number[] = [];
  const uv: number[] = [];
  const tile = o.tile ?? 1.2;
  const k3 = Math.hypot(1, roof.slope);
  const P = (s: number, i: number): THREE.Vector3 =>
    new THREE.Vector3(f.a[0] + f.t[0] * s - f.n[0] * i, roof.eaves + i * roof.slope - o.drop - o.floorY, f.a[1] + f.t[1] * s - f.n[1] * i);
  const quad = (sa: number, a0: number, a1: number, sb: number, b0: number, b1: number) => {
    if (a1 - a0 < 1e-4 && b1 - b0 < 1e-4) return;
    const q = [P(sa, a0), P(sb, b0), P(sb, b1), P(sa, a1)];
    const st = [[sa, a0], [sb, b0], [sb, b1], [sa, a1]];
    for (const [i, j, l] of [[0, 1, 2], [0, 2, 3]]) {
      const n = new THREE.Vector3().subVectors(q[j], q[i]).cross(new THREE.Vector3().subVectors(q[l], q[i]));
      if (n.lengthSq() < 1e-10) continue;
      // facing down, into the attic
      const tri = n.y < 0 ? [i, j, l] : [i, l, j];
      for (const t of tri) {
        pos.push(q[t].x, q[t].y, q[t].z);
        uv.push(st[t][0] / tile, (st[t][1] * k3) / tile);
      }
    }
  };
  for (let c = 0; c + 1 < ss.length; c++) {
    const sa = ss[c];
    const sb = ss[c + 1];
    if (sb - sa < 1e-5) continue;
    const sm = (sa + sb) / 2;
    const spans: Array<{ m: number; a: [number, number]; b: [number, number] }> = [];
    for (const h of o.holes) {
      const mm = crossing(h, sm);
      if (!mm) continue;
      const a = crossing(h, sa + 1e-7) ?? mm;
      const b = crossing(h, sb - 1e-7) ?? mm;
      spans.push({ m: mm[0], a, b });
    }
    spans.sort((p, q) => p.m - q.m);
    const ta = top(sa);
    const tb = top(sb);
    let ya = o.in0;
    let yb = o.in0;
    const clampA = (v: number) => Math.min(Math.max(v, o.in0), ta);
    const clampB = (v: number) => Math.min(Math.max(v, o.in0), tb);
    for (const sp of spans) {
      quad(sa, ya, clampA(sp.a[0]), sb, yb, clampB(sp.b[0]));
      ya = Math.max(ya, clampA(sp.a[1]));
      yb = Math.max(yb, clampB(sp.b[1]));
    }
    quad(sa, ya, ta, sb, yb, tb);
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  k.add(g, def, 0, 0, 0, { flat: true, tint: o.tint });
}

/** A few faces (local points, each a convex polygon facing `toward` a point or along a normal) as one geometry. */
function faces(k: Kit, def: MatDef, polys: THREE.Vector3[][], facing: (p: THREE.Vector3[]) => THREE.Vector3, tile = 1.2, tint?: number): void {
  const pos: number[] = [];
  const uv: number[] = [];
  for (const p of polys) {
    if (p.length < 3) continue;
    const want = facing(p);
    const n = new THREE.Vector3().subVectors(p[1], p[0]).cross(new THREE.Vector3().subVectors(p[2], p[0]));
    const flip = n.dot(want) < 0;
    // uv: on the face's own plane (its longest horizontal way and up, or x and z for a floor)
    const up = Math.abs(n.clone().normalize().y) > 0.7;
    const h = new THREE.Vector3(want.x, 0, want.z);
    const along = h.lengthSq() > 1e-8 ? new THREE.Vector3(-h.z, 0, h.x).normalize() : new THREE.Vector3(1, 0, 0);
    const U = (v: THREE.Vector3): [number, number] => (up ? [v.x / tile, v.z / tile] : [v.dot(along) / tile, v.y / tile]);
    for (let i = 1; i + 1 < p.length; i++) {
      const tri = flip ? [p[0], p[i + 1], p[i]] : [p[0], p[i], p[i + 1]];
      for (const v of tri) {
        pos.push(v.x, v.y, v.z);
        uv.push(...U(v));
      }
    }
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  k.add(g, def, 0, 0, 0, { flat: true, tint });
}

/** The face of a shell (its outer face's line) round a point, `half` either way along t. */
function faceAt(x: number, z: number, t: P2, n: P2, half: number): ShellFace {
  return { a: [x - t[0] * half, z - t[1] * half], c: [x + t[0] * half, z + t[1] * half], n };
}

/**
 * A dormer's inside (issue #28): the lining behind its front from the reveal's back to the front's back, its window cut
 * where the shell's is; the cheeks and the flat ceiling, from the front back to where the roof's boards reach the
 * ceiling. Returns the hole it leaves in the roof's boards (the face's (s, in)), or null when it has no room above them.
 */
export function bay(k: Kit, walls: MatDef, b: ShellBay, roof: ShellRoof, f: ShellRoofFace, drop: number, openings: readonly ShellOpening[], floorY: number, tint?: number): P2[] | null {
  const t: P2 = [b.tx, b.tz];
  const n: P2 = [b.nx, b.nz];
  const face = faceAt(b.x, b.z, t, n, b.hw + 0.06);
  lining(k, walls, { face, from: b.depth, to: b.back, u0: 0, u1: 2 * (b.hw + 0.06), y0: b.y0, y1: b.yc }, openings, floorY, 1.2, tint);
  const [sc, inF] = roofST(f, b.x, b.z);
  // the boards under the roof, d metres in from the front's outer face: the height (world)
  const yL = (d: number) => roof.eaves + (inF + d) * roof.slope - drop;
  const dC = (b.yc - roof.eaves + drop) / roof.slope - inF;
  if (dC <= b.back + 0.02) return null;
  const V = (u: number, d: number, y: number) => new THREE.Vector3(b.x + t[0] * u - n[0] * d, y - floorY, b.z + t[1] * u - n[1] * d);
  const mid = V(0, (b.back + dC) / 2, (yL(b.back) + b.yc) / 2);
  const cheeks: THREE.Vector3[][] = [];
  for (const s of [-1, 1]) {
    const u = s * b.hw;
    const y0 = Math.min(yL(b.back), b.yc);
    cheeks.push([V(u, b.back, y0 - 0.02), V(u, b.back, b.yc), V(u, dC + 0.02, b.yc)]);
  }
  faces(k, walls, cheeks, (p) => new THREE.Vector3().subVectors(mid, p[0]), 1.2, tint);
  faces(k, walls, [[V(-b.hw - 0.01, b.back - 0.01, b.yc), V(b.hw + 0.01, b.back - 0.01, b.yc), V(b.hw + 0.01, dC + 0.02, b.yc), V(-b.hw - 0.01, dC + 0.02, b.yc)]], () => new THREE.Vector3(0, -1, 0), 1.2, tint);
  return [
    [sc - b.hw, inF + b.back - 0.01],
    [sc + b.hw, inF + b.back - 0.01],
    [sc + b.hw, inF + dC + 0.01],
    [sc - b.hw, inF + dC + 0.01],
  ];
}

/** The apothem of a regular polygon (its middle to its edges). */
function apothem(poly: readonly P2[]): number {
  const n = poly.length;
  const cx = poly.reduce((a, p) => a + p[0], 0) / n;
  const cz = poly.reduce((a, p) => a + p[1], 0) / n;
  const [ax, az] = poly[0];
  const [bx, bz] = poly[1];
  return Math.hypot((ax + bx) / 2 - cx, (az + bz) / 2 - cz);
}

function middle(poly: readonly P2[]): P2 {
  const n = poly.length;
  return [poly.reduce((a, p) => a + p[0], 0) / n, poly.reduce((a, p) => a + p[1], 0) / n];
}

/** A face of a tower's ring (its outer face's line, the way out). */
function ringFace(ring: readonly P2[], i: number): ShellFace {
  const a = ring[i];
  const c = ring[(i + 1) % ring.length];
  const [mx, mz] = middle(ring);
  const ex = c[0] - a[0];
  const ez = c[1] - a[1];
  const L = Math.hypot(ex, ez);
  let nx = ez / L;
  let nz = -ex / L;
  if ((a[0] + c[0]) / 2 * nx + (a[1] + c[1]) / 2 * nz - (mx * nx + mz * nz) < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { a: [a[0], a[1]], c: [c[0], c[1]], n: [nx, nz] };
}

/** Where an inner polygon's edge i lies along the ring's face i (u from the face's start), a little wider. */
function edgeSpan(f: ShellFace, inner: readonly P2[], i: number, more = 0.02): [number, number] {
  const L = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  const tx = (f.c[0] - f.a[0]) / L;
  const tz = (f.c[1] - f.a[1]) / L;
  const u = (p: P2) => (p[0] - f.a[0]) * tx + (p[1] - f.a[1]) * tz;
  const a = u(inner[i]);
  const b = u(inner[(i + 1) % inner.length]);
  return [Math.min(a, b) - more, Math.max(a, b) + more];
}

export interface TowerMats {
  /** the shaft's and the rooms' walls, their floors and ceilings, the stair's steps and its newel */
  walls: MatDef;
  floor: MatDef;
  steps: MatDef;
  post: MatDef;
}

/** The attic a tower stands in: its floor (world y) and the boards under the roof over a plan point (world y). */
export interface AtticSpace {
  floor: number;
  ceil: (x: number, z: number) => number;
}

/**
 * A cover of a tower's wall where it stands in the attic: a lining of the room from 2 cm before the shell's face, from
 * the attic's floor up to the boards under the roof (never out through the slate), where those are over the floor.
 */
function cover(k: Kit, def: MatDef, f: ShellFace, u0: number, u1: number, to: number, attic: AtticSpace, yMax: number, floorY: number, tint?: number): void {
  const L = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  const tx = (f.c[0] - f.a[0]) / L;
  const tz = (f.c[1] - f.a[1]) / L;
  const y0 = attic.floor - 0.05;
  // (never lower than a low wall at the eaves; a little past the face's ends, so neighbouring covers meet at a corner)
  const at = (u: number) => Math.max(y0 + 0.15, Math.min(yMax, attic.ceil(f.a[0] + tx * u, f.a[1] + tz * u) + 0.08));
  const n = 12;
  const top: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const u = u0 - 0.04 + ((u1 - u0 + 0.08) * i) / n;
    top.push([u, at(u)]);
  }
  if (Math.max(...top.map((q) => q[1])) < y0 + 0.2) return;
  lining(k, def, { face: f, from: -0.02, to, u0: top[0][0], u1: top[top.length - 1][0], y0, y1: Math.max(...top.map((q) => q[1])), top }, [], floorY, 1.2, tint);
}

/**
 * A tower's rooms (issue #28): its stair shaft from the ground to the top room (the linings behind the slits, plain walls
 * toward the building, a newel stair winding up), the top room under the spire (the linings behind its windows, a
 * floor over the shaft, a ceiling), and covers of the tower's walls where they stand in the attic (a corner turret's
 * top room on the attic's floor, a stair tower's shaft rising through it).
 */
export function towerRoom(k: Kit, m: TowerMats, tw: ShellTower, openings: readonly ShellOpening[], floorY: number, attic: AtticSpace | null, tint = 0.85): void {
  const on = (f: ShellFace) => openings.filter((o) => onFace(o, f));
  const deepest = (f: ShellFace, dflt: number) => on(f).reduce((d, o) => Math.max(d, o.depth), dflt);
  const aRing = apothem(tw.ring);
  const aShaft = apothem(tw.shaft);
  const aTop = apothem(tw.top);
  const aRoom = apothem(tw.room);
  const [cx, cz] = middle(tw.shaft);
  const centre = new THREE.Vector3(cx, 0, cz);
  const L = (x: number, z: number, y: number) => new THREE.Vector3(x, y - floorY, z);
  // (a corner turret's top room stands on the attic's floor; a stair tower's shaft rises through the attic)
  const roomInAttic = attic !== null && tw.ys < attic.floor + 1;
  const shaftInAttic = attic !== null && tw.ys > attic.floor + 1;
  const inward: THREE.Vector3[][] = [];
  // ---- the shaft: behind the slits (and the stair's door) the linings, toward the building plain walls
  tw.ring.forEach((_, i) => {
    const f = ringFace(tw.ring, i);
    if (tw.ext[i]) {
      const [u0, u1] = edgeSpan(f, tw.shaft, i);
      const doors: Array<{ u0: number; u1: number; top: number; round?: boolean }> = [];
      if (i === tw.door) {
        const len = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
        doors.push({ u0: len / 2 - 0.38, u1: len / 2 + 0.38, top: 2.12, round: true });
      }
      lining(k, m.walls, { face: f, from: deepest(f, 0.3), to: aRing - aShaft, u0, u1, y0: tw.y0 - 0.02, y1: tw.ys, doors }, openings, floorY, 1.2, tint);
    } else {
      const a = tw.shaft[i];
      const b = tw.shaft[(i + 1) % tw.shaft.length];
      inward.push([L(a[0], a[1], tw.y0 - 0.02), L(b[0], b[1], tw.y0 - 0.02), L(b[0], b[1], tw.ys), L(a[0], a[1], tw.ys)]);
      // (a stair tower's shaft rising through the attic: its walls there covered from the attic's side)
      if (shaftInAttic) cover(k, m.walls, f, 0, Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]), Math.min(0.25, aRing - aShaft - 0.05), attic!, tw.ys, floorY, tint);
    }
  });
  faces(k, m.walls, inward, (p) => new THREE.Vector3().subVectors(centre, p[0]).setY(0), 1.2, tint);
  // its floor at the foot, the top room's floor over it (a slab: it hides what stands round the shaft's top)
  const poly = (pts: readonly P2[], y: number) => pts.map(([x, z]) => L(x, z, y));
  faces(k, m.floor, [poly(tw.shaft, tw.y0)], () => new THREE.Vector3(0, 1, 0), 1.2, tint);
  const slab0 = tw.ys - 0.7;
  const slab1 = tw.ys + 0.1;
  faces(k, m.floor, [poly(tw.room, slab1)], () => new THREE.Vector3(0, 1, 0), 1.2, tint);
  faces(k, m.walls, [poly(tw.room, slab0)], () => new THREE.Vector3(0, -1, 0), 1.2, tint);
  // ---- the newel stair: a post in the middle, the steps winding up round it
  const rOut = aShaft - 0.04;
  const rIn = 0.12;
  const rise = 0.19;
  const perTurn = 14;
  const nSteps = Math.floor((slab0 - 0.1 - tw.y0) / rise);
  k.cyl(rIn, rIn, slab0 - tw.y0, cx, tw.y0 - floorY, cz, m.post, { seg: 6 });
  for (let i = 0; i < nSteps; i++) {
    const a = (2 * Math.PI * i) / perTurn;
    const rm = (rOut + rIn) / 2;
    const w = ((2 * Math.PI * rOut) / perTurn) * 1.15;
    k.box(rOut - rIn, 0.07, w, cx + Math.cos(a) * rm, tw.y0 + (i + 1) * rise - 0.035 - floorY, cz + Math.sin(a) * rm, m.steps, { ry: -a, tint, flat: true });
  }
  // ---- the top room: the linings behind its windows (and its other walls), its ceiling under the spire
  tw.top.forEach((_, i) => {
    const f = ringFace(tw.top, i);
    const [u0, u1] = edgeSpan(f, tw.room, i);
    lining(k, m.walls, { face: f, from: deepest(f, 0.3), to: aTop - aRoom, u0, u1, y0: tw.ys, y1: tw.yc + 0.05 }, openings, floorY, 1.2, tint);
    // (its walls standing in the attic, over the building's inside: covered from the attic's side up to the roof's boards)
    if (roomInAttic && tw.topIn[i] && !on(f).length) cover(k, m.walls, f, 0, Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]), deepest(f, 0.3), attic!, tw.yc, floorY, tint);
  });
  faces(k, m.walls, [poly(tw.room, tw.yc)], () => new THREE.Vector3(0, -1, 0), 1.2, tint);
}

/**
 * Where the attic's boards and gables stop at the towers (plan (x, z)): a corner turret's top stage (it stands on the
 * attic's floor), a stair tower's shaft (it rises through the attic), each grown to its covers' faces.
 */
export function towerNotches(towers: readonly ShellTower[], atticFloor: number): P2[][] {
  // (1 cm out: inside the covers, which stand 2 cm out of the tower's faces, so the boards and gables run into them)
  return towers.map((t) => grow(t.ys < atticFloor + 1 ? t.top : t.ring, 0.01));
}

/** A polygon cut by a half plane: the part where g(p) >= 0 (Sutherland-Hodgman). */
export function clipHalf(poly: readonly P2[], g: (p: P2) => number): P2[] {
  const out: P2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ga = g(a);
    const gb = g(b);
    if (ga >= 0) out.push(a);
    if ((ga >= 0) !== (gb >= 0)) {
      const t = ga / (ga - gb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/**
 * The part [u0, u1] of a face's lining band (from `from` to `to` in from its outer face) that keeps clear of these
 * polygons (plan (x, z)) standing at its ends: a turret's shaft in a corner, a turret's top room in the attic's corner.
 */
export function trimAtEnds(f: ShellFace, from: number, to: number, u0: number, u1: number, polys: readonly P2[][]): [number, number] {
  const L = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  const tx = (f.c[0] - f.a[0]) / L;
  const tz = (f.c[1] - f.a[1]) / L;
  for (const poly of polys) {
    let pts: P2[] = poly.map(([x, z]) => [(x - f.a[0]) * tx + (z - f.a[1]) * tz, (f.a[0] - x) * f.n[0] + (f.a[1] - z) * f.n[1]]);
    pts = clipHalf(pts, (p) => p[1] - from);
    pts = clipHalf(pts, (p) => to - p[1]);
    if (pts.length < 3) continue;
    const lo = Math.min(...pts.map((p) => p[0]));
    const hi = Math.max(...pts.map((p) => p[0]));
    if (hi <= u0 || lo >= u1) continue;
    if ((lo + hi) / 2 < L / 2) u0 = Math.max(u0, hi);
    else u1 = Math.min(u1, lo);
  }
  return [u0, u1];
}

/**
 * A floor's top (local y) over a rectangle, a convex polygon (a tower's shaft) left out of it: the rectangle cut into
 * convex pieces, each outside one of the polygon's edges and inside the ones before it.
 */
export function floorAround(k: Kit, def: MatDef, x0: number, x1: number, z0: number, z1: number, hole: readonly P2[], y: number, tile = 1.2, tint?: number): void {
  const n = hole.length;
  const [cx, cz] = middle(hole);
  // (each edge's outward side: away from the polygon's middle)
  const side = (i: number) => {
    const [ax, az] = hole[i];
    const [bx, bz] = hole[(i + 1) % n];
    const s = (bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0 ? -1 : 1;
    return (p: P2) => s * ((bx - ax) * (p[1] - az) - (bz - az) * (p[0] - ax));
  };
  const pieces: THREE.Vector3[][] = [];
  for (let i = 0; i < n; i++) {
    let poly: P2[] = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    poly = clipHalf(poly, side(i));
    for (let j = 0; j < i && poly.length >= 3; j++) {
      const g = side(j);
      poly = clipHalf(poly, (p) => -g(p));
    }
    if (poly.length >= 3) pieces.push(poly.map(([x, z]) => new THREE.Vector3(x, y, z)));
  }
  faces(k, def, pieces, () => new THREE.Vector3(0, 1, 0), tile, tint);
}

/** A plain wall face of the room in a shell face's plane `depth` in from its outer face, facing into the room (world y). */
export function wallQuad(k: Kit, def: MatDef, f: ShellFace, depth: number, u0: number, u1: number, y0: number, y1: number, floorY: number, tile = 1.2, tint?: number): void {
  const L = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  const tx = (f.c[0] - f.a[0]) / L;
  const tz = (f.c[1] - f.a[1]) / L;
  const V = (u: number, y: number) => new THREE.Vector3(f.a[0] + tx * u - f.n[0] * depth, y - floorY, f.a[1] + tz * u - f.n[1] * depth);
  faces(k, def, [[V(u0, y0), V(u1, y0), V(u1, y1), V(u0, y1)]], () => new THREE.Vector3(-f.n[0], 0, -f.n[1]), tile, tint);
}
