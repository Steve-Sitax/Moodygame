import * as THREE from "three";
import * as P from "../../../shared/cathedralPlan";
import { UPPER_OPENINGS, UPPER_SHELL } from "../../../shared/cathedralShell";
import { inFrame, type ShellFace } from "../../../shared/shellOpening";
import { cathedralMats, type CathedralMats } from "./cathedralHall";
import { Kit, type MatDef } from "./landmarkKit";
import { frameRoom } from "./rooms";
import { lining, windowOpenings } from "./realOpenings";
import { planarUV } from "./carolusHall";
import type { InWorldRoom } from "./inworld";

// Issue #28 (interiors are real, docs/building-with-interior.md): the parts of the cathedral that stand over no hall
// have their openings cut through the shell (tools/blender/build_landmarks.py: the towers' stages over the roofs, the
// north tower's octagon, the south tower's small lantern, the crossing tower's three lead tiers, the great roof's
// dormers), and here are the spaces behind them, at the shell's own size, from the numbers the build writes
// (shared/cathedralShell.ts UPPER_SHELL):
//  - the towers: a chamber for each stage over the roofs (timber floors on the stone, the stair's turret in a corner),
//    the north tower's treadwheel for hoisting the bells, the ringers' chamber with its ropes, and the belfries (the
//    north tower's third stage, the south tower's second) with their oak frames and bells behind the louvres;
//  - the north tower's octagon: the carillon round the stone core of the stair, the clockwork under the four dials;
//  - the south tower's small lantern with its bell;
//  - the crossing tower's lead tiers: their timber frame round the spire's mast;
//  - the roof space over the nave's and the choir's vaults: the trusses, the purlins, the boarding under the slates,
//    the dormers opening into it, closed at the crossing and at the ends by brick gables.
// Nobody walks up there (the church has no way up for Jef: the north tower's door stays shut); it is seen through its
// openings from the street. A room of its own in the world (world/inworld.ts), so its pass draws only these few parts
// (one Kit each: a part out of view is not drawn), with the hall's own materials and the hall's light setting (no new
// material, no new shader kind), no lamps: dim wood and stone in the daylight through the openings.

/** The openings over this room, in its frame (x = the shell's v, z = its u; y world). */
export const UPPER_WINDOWS = inFrame(UPPER_OPENINGS, P.ORIGIN, 0);

type Tower = (typeof UPPER_SHELL.towers)[number];

/** The towers' stage walls: the reveal's back (the shell's depth) and the room's inner face. */
const TOWER = { from: 1.0, to: 1.25 };
const OCT = { from: 0.6, to: 0.85 };
const TIER = { from: 0.25, to: 0.4 };
const LANTERN = { from: 0.2, to: 0.3 };
const DORMER = { from: 0.12, to: 0.17 };
/** The roof space's boarding under the slates, this far in (m, level). */
const BOARD = 0.1;

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** A square beam from a to b (its section w x h). */
function beam(k: Kit, def: MatDef, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, tint?: number): void {
  const len = a.distanceTo(b);
  if (len < 1e-3) return;
  const g = new THREE.BoxGeometry(w, h, len);
  planarUV(g, 1.2);
  const dir = b.clone().sub(a).normalize();
  // (its height stays upright where it can: turned about its own length after lining up with it)
  const q = new THREE.Quaternion().setFromUnitVectors(V(0, 0, 1), dir);
  const up = V(0, 1, 0).applyQuaternion(q);
  const want = V(0, 1, 0).sub(dir.clone().multiplyScalar(dir.y));
  if (want.lengthSq() > 1e-6) {
    want.normalize();
    const ang = Math.atan2(up.clone().cross(want).dot(dir), up.dot(want));
    q.premultiply(new THREE.Quaternion().setFromAxisAngle(dir, ang));
  }
  g.applyQuaternion(q);
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  k.add(g, def, 0, 0, 0, { tint, flat: true });
}

/** A box from its corners (the frame's x, y, z). */
function slab(k: Kit, def: MatDef, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, tint?: number, tile = 2.4): void {
  k.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, def, { tile, tint, flat: true });
}

/** A flat polygon (x, z) at y, `thick` thick downward (a floor, a ceiling): its top and underside and edges. */
function plate(k: Kit, def: MatDef, ring: Array<[number, number]>, y: number, thick: number, tint?: number): void {
  const sh = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false, curveSegments: 1 });
  // (the shape's x, y are the frame's x, -z; turned flat, extruded downward from y)
  g.rotateX(-Math.PI / 2);
  g.translate(0, y - thick, 0);
  g.computeVertexNormals();
  planarUV(g, 1.6);
  k.add(g, def, 0, 0, 0, { tint, flat: true });
}

/** A bell of mouth radius R, its lip at y: the waist, the shoulder, the crown; a hollow under it with the clapper. */
function bell(k: Kit, m: CathedralMats, x: number, y: number, z: number, R: number): void {
  const t = 0.08 * R;
  const outer: Array<[number, number]> = [[R, 0], [0.97 * R, 0.1 * R], [0.82 * R, 0.3 * R], [0.67 * R, 0.55 * R], [0.61 * R, 0.85 * R], [0.57 * R, 1.04 * R], [0.42 * R, 1.16 * R], [0.001, 1.2 * R]];
  const inner: Array<[number, number]> = [[0.001, 1.2 * R - t], [0.4 * R, 1.1 * R], [0.55 * R - t, 1.0 * R], [0.61 * R - t, 0.85 * R], [0.67 * R - t, 0.55 * R], [0.82 * R - t, 0.3 * R], [0.95 * R - t, 0.1 * R], [R - t, 0.02 * R]];
  // (down the inside, round the lip, up the outside: faces out on the outside, into the hollow on the inside)
  const g = new THREE.LatheGeometry([...inner, ...outer].map(([r, h]) => new THREE.Vector2(r, h)), 14);
  planarUV(g, 0.8);
  k.add(g, m.brass, x, y, z, { tint: 0x6a5a40, flat: true });
  k.cyl(0.08 * R, 0.1 * R, 0.25 * R, x, y + 1.2 * R, z, m.iron, { seg: 6, flat: true });
  k.cyl(0.035 * R + 0.01, 0.035 * R + 0.01, 0.8 * R, x, y + 0.25 * R, z, m.iron, { seg: 5, flat: true });
  const ball = new THREE.SphereGeometry(0.12 * R, 6, 4);
  k.add(ball, m.iron, x, y + 0.25 * R, z, { flat: true });
}

/** A bell hung in an oak frame: two posts each side, the headstock across them, braces; `along`: the frame's beams run along x (true) or z. */
function bellPit(k: Kit, m: CathedralMats, x: number, floor: number, z: number, R: number, along: boolean, tint = 0.8): void {
  const H = 2.5 * R + 1.0;
  const half = R + 0.45;
  const lip = floor + H - 0.35 - 1.45 * R;
  bell(k, m, x, lip, z, R);
  const at = (a: number, b: number, y: number) => (along ? V(x + a, y, z + b) : V(x + b, y, z + a));
  for (const s of [-1, 1]) {
    // the posts each side, leaning in a little, their sill on the floor, the brace from the sill to the head
    for (const q of [-1, 1]) {
      beam(k, m.carved, at(s * (half + 0.35), q * (R * 0.5 + 0.2), floor), at(s * half, q * (R * 0.5 + 0.2), floor + H), 0.26, 0.26, tint);
      beam(k, m.carved, at(s * (half + 0.65), q * (R * 0.5 + 0.2), floor + 0.13), at(s * half, q * (R * 0.5 + 0.2), floor + H * 0.6), 0.2, 0.2, tint);
    }
    beam(k, m.carved, at(s * (half + 0.7), -(R * 0.5 + 0.5), floor + 0.13), at(s * (half + 0.7), R * 0.5 + 0.5, floor + 0.13), 0.28, 0.26, tint);
    beam(k, m.carved, at(s * half, -(R * 0.5 + 0.35), floor + H), at(s * half, R * 0.5 + 0.35, floor + H), 0.3, 0.3, tint);
  }
  // the headstock the bell hangs from, its gudgeons on the frame's heads, a wheel on one side for the rope
  beam(k, m.carved, at(-half - 0.1, 0, floor + H - 0.1), at(half + 0.1, 0, floor + H - 0.1), 0.34, 0.4, tint);
  const wr = R + 0.35;
  for (let i = 0; i < 10; i++) {
    const a0 = (i / 10) * Math.PI * 2;
    const a1 = ((i + 1) / 10) * Math.PI * 2;
    const p = (a: number) => at(Math.cos(a) * wr, R * 0.5 + 0.1, floor + H - 0.1 + Math.sin(a) * wr);
    if (Math.sin((a0 + a1) / 2) > -0.2) beam(k, m.carved, p(a0), p(a1), 0.08, 0.12, tint);
  }
}

/** The four faces of a square stage of side 2h round (u, v), in the frame (x = v, z = u), in the shell's order. */
function squareFaces(u: number, v: number, h: number): ShellFace[] {
  return [
    { a: [v - h, u - h], c: [v - h, u + h], n: [-1, 0] },
    { a: [v - h, u + h], c: [v + h, u + h], n: [0, 1] },
    { a: [v + h, u + h], c: [v + h, u - h], n: [1, 0] },
    { a: [v + h, u - h], c: [v - h, u - h], n: [0, -1] },
  ];
}

/** A ring of (u, v) points as faces in the frame, each facing away from its middle. */
function ringFaces(ring: Array<[number, number]>): ShellFace[] {
  const cu = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cv = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map((p, i) => {
    const q = ring[(i + 1) % ring.length];
    const mu = (p[0] + q[0]) / 2 - cu;
    const mv = (p[1] + q[1]) / 2 - cv;
    const l = Math.hypot(mu, mv) || 1;
    return { a: [p[1], p[0]], c: [q[1], q[0]], n: [mv / l, mu / l] } as ShellFace;
  });
}

const faceLen = (f: ShellFace) => Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);

/** A ring pulled in toward its middle by d (m, square to each face; for a regular ring). */
function shrink(ring: Array<[number, number]>, d: number): Array<[number, number]> {
  const cu = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cv = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const ap = Math.hypot((ring[0][0] + ring[1][0]) / 2 - cu, (ring[0][1] + ring[1][1]) / 2 - cv);
  const k = (ap - d) / ap;
  return ring.map(([u, v]) => [cu + (u - cu) * k, cv + (v - cv) * k]);
}

/** (u, v) -> the frame's (x, z). */
const xz = (ring: Array<[number, number]>): Array<[number, number]> => ring.map(([u, v]) => [v, u]);

/** The north tower's octagon (the shell's cham(a, c)) round (u, v). */
function chamRing(u: number, v: number, a: number, c: number): Array<[number, number]> {
  const e = a - c;
  return [[a, -e], [a, e], [e, a], [-e, a], [-a, e], [-a, -e], [-e, -a], [e, -a]].map(([du, dv]) => [u + du, v + dv] as [number, number]);
}

/** A regular n-gon of circumradius r round (u, v), its first corner at angle rot from +u toward +v (the shell's ngon). */
function ngon(u: number, v: number, r: number, n: number, rot: number): Array<[number, number]> {
  return Array.from({ length: n }, (_, i) => [u + r * Math.cos(rot + (2 * Math.PI * i) / n), v + r * Math.sin(rot + (2 * Math.PI * i) / n)] as [number, number]);
}

export interface CathedralUpper {
  room: InWorldRoom;
  /** The day and the weather (as the hall's). */
  setDaylight(day: number, sky: number): void;
  /** Dev: its parts and their pieces. */
  info(): { parts: number; openings: number; meshes: number };
}

export function buildCathedralUpper(): CathedralUpper {
  const m = cathedralMats();
  const { scene, group } = frameRoom(P.ORIGIN, 0, 0x2a2620);
  scene.background = null;
  const kits: Kit[] = [];
  /** The spaces as boxes (the frame's x, y, z) and the roof's wedges: an eye in one is inside (a picture from there). */
  const spaces: Array<(x: number, y: number, z: number) => boolean> = [];
  const kit = () => {
    const k = new Kit(group);
    kits.push(k);
    return k;
  };
  const line = (k: Kit, def: MatDef, f: ShellFace, from: number, to: number, u0: number, u1: number, y0: number, y1: number, tint?: number, top?: Array<[number, number]>) =>
    lining(k, def, { face: f, from, to, u0, u1, y0, y1, top }, UPPER_WINDOWS, 0, 2.4, tint);

  // ================= the west towers: the chambers of their stages over the roofs, the belfries
  for (const T of UPPER_SHELL.towers as readonly Tower[]) {
    const k = kit();
    const [cx, cz] = [T.v, T.u];
    const st: ReadonlyArray<{ y0: number; y1: number; h: number }> = T.stages;
    st.forEach((s, i) => {
      const IN = s.h - TOWER.to;
      const yTop = i + 1 < st.length ? st[i + 1].y0 : T.top;
      spaces.push((x, y, z) => Math.abs(x - cx) < IN && Math.abs(z - cz) < IN && y > s.y0 && y < yTop);
      const floorY = s.y0 + 0.04;
      const next = i + 1 < st.length ? st[i + 1].y0 : T.top;
      // the walls: each face of the stage lined from its lancets' reveals in (up under the next stage's floor)
      for (const f of squareFaces(T.u, T.v, s.h)) line(k, m.stoneDark, f, TOWER.from, TOWER.to, 0.3, 2 * s.h - 0.3, s.y0 - 0.45, next - 0.4, 0.8);
      // the floor on its beams (over the hall's vaults in the first stage)
      slab(k, m.carved, cx - IN - 0.2, cx + IN + 0.2, s.y0 - 0.45, floorY, cz - IN - 0.2, cz + IN + 0.2, 0.55, 1.6);
      for (let q = -2; q <= 2; q++) slab(k, m.carved, cx - IN - 0.2, cx + IN + 0.2, s.y0 - 0.75, s.y0 - 0.45, cz + q * (IN / 2.5) - 0.15, cz + q * (IN / 2.5) + 0.15, 0.5, 1.2);
      // the stair in its turret in the inner west corner (the way up: only seen, the tower's door stays shut)
      const sx = cx + Math.sign(-T.v) * (IN - 1.05);
      const sz = cz - (IN - 1.05);
      k.cyl(1.05, 1.05, next - 0.4 - floorY, sx, floorY, sz, m.stoneDark, { seg: 10, tile: 2.4, tint: 0.75 });
      // (its low door toward the room, shut)
      slab(k, m.carved, sx - 0.4, sx + 0.4, floorY, floorY + 1.9, sz + 1.0, sz + 1.1, 0.35, 1.2);
      const belfry = i === st.length - 1;
      if (T.name === "north" && i === 0) {
        // the great wheel that hoisted the bells, its rope going up through the floors
        const wy = floorY + 2.7;
        for (const s2 of [-0.6, 0.6]) {
          for (let j = 0; j < 16; j++) {
            const a0 = (j / 16) * Math.PI * 2;
            const a1 = ((j + 1) / 16) * Math.PI * 2;
            beam(k, m.carved, V(cx + s2, wy + Math.sin(a0) * 2.4, cz + Math.cos(a0) * 2.4), V(cx + s2, wy + Math.sin(a1) * 2.4, cz + Math.cos(a1) * 2.4), 0.14, 0.2, 0.75);
          }
          for (let j = 0; j < 4; j++) {
            const a = (j / 4) * Math.PI;
            beam(k, m.carved, V(cx + s2, wy - Math.sin(a) * 2.35, cz - Math.cos(a) * 2.35), V(cx + s2, wy + Math.sin(a) * 2.35, cz + Math.cos(a) * 2.35), 0.14, 0.14, 0.7);
          }
        }
        for (let j = 0; j < 24; j++) {
          const a = (j / 24) * Math.PI * 2;
          beam(k, m.carved, V(cx - 0.62, wy + Math.sin(a) * 2.36, cz + Math.cos(a) * 2.36), V(cx + 0.62, wy + Math.sin(a) * 2.36, cz + Math.cos(a) * 2.36), 0.08, 0.1, 0.8);
        }
        beam(k, m.iron, V(cx - 1.1, wy, cz), V(cx + 1.1, wy, cz), 0.16, 0.16);
        for (const s2 of [-1, 1]) beam(k, m.carved, V(cx + s2 * 1.0, floorY, cz - 0.9), V(cx + s2 * 1.0, wy + 0.1, cz), 0.24, 0.24, 0.6);
        beam(k, m.linen, V(cx, wy + 2.4, cz), V(cx, next - 0.45, cz + 0.2), 0.05, 0.05, 0.7);
      } else if (T.name === "north" && i === 1) {
        // the ringers' chamber: the ropes of the bells overhead, their sallies, a bench along the east wall
        const ropes: Array<[number, number]> = [[-2.4, -1.2], [-0.8, -1.8], [0.8, -1.8], [2.4, -1.2], [-1.6, 1.6], [1.6, 1.6]];
        for (const [dx, dz] of ropes) {
          beam(k, m.linen, V(cx + dx, floorY + 1.1, cz + dz), V(cx + dx, next - 0.45, cz + dz), 0.035, 0.035, 0.75);
          beam(k, m.red, V(cx + dx, floorY + 1.5, cz + dz), V(cx + dx, floorY + 2.2, cz + dz), 0.09, 0.09, 0.8);
        }
        slab(k, m.carved, cx - IN + 0.4, cx + IN - 0.4, floorY, floorY + 0.45, cz + IN - 0.45, cz + IN, 0.6, 1.2);
      } else if (belfry) {
        // the belfry: the bells' floor on great beams at the height of the louvres' tops, the frame and the bells on it
        // (seen through the open heads of the lancets; the louvres throw their sound down into the streets)
        const bf = s.y0 + 3.9;
        slab(k, m.carved, cx - IN - 0.2, cx + IN + 0.2, bf - 0.25, bf, cz - IN - 0.2, cz + IN + 0.2, 0.5, 1.6);
        for (const q of [-1, 1]) slab(k, m.carved, cx - IN - 0.2, cx + IN + 0.2, bf - 0.7, bf - 0.25, cz + q * 1.6 - 0.25, cz + q * 1.6 + 0.25, 0.45, 1.2);
        if (T.name === "north") {
          // the great bell (the Karolus, cast in 1507) in the middle, three more round it (the stair's turret in the
          // fourth corner)
          bellPit(k, m, cx, bf, cz - 0.2, 1.1, true);
          bellPit(k, m, cx + 2.6, bf, cz + 2.6, 0.5, false);
          bellPit(k, m, cx - 2.6, bf, cz + 2.6, 0.46, false);
          bellPit(k, m, cx + 2.6, bf, cz - 2.6, 0.42, false);
        } else {
          bellPit(k, m, cx, bf, cz - 1.9, 0.8, true);
          bellPit(k, m, cx - 1.9, bf, cz + 2.0, 0.55, false);
          bellPit(k, m, cx + 1.9, bf, cz + 2.0, 0.48, false);
        }
      } else {
        // an empty chamber: old timber and a spare bell's headstock laid by the wall
        for (let j = 0; j < 4; j++) slab(k, m.carved, cx + IN - 0.9, cx + IN - 0.1, floorY + j * 0.22, floorY + j * 0.22 + 0.2, cz - 3 + j * 0.3, cz + 2.4 - j * 0.3, 0.55, 1.2);
      }
      if (i === st.length - 1) {
        // the ceiling under the stone of the top (the shell's lead at the top: 5 cm over it)
        slab(k, m.carved, cx - IN - 0.2, cx + IN + 0.2, T.top - 0.55, T.top - 0.05, cz - IN - 0.2, cz + IN + 0.2, 0.45, 1.2);
      }
    });

    if ("oct" in T && T.oct) {
      // ---- the north tower's octagon: the carillon round the stair's stone core, the clockwork under the dials
      const O = T.oct;
      const ko = kit();
      spaces.push((x, y, z) => y > O.y0 && y < O.y1 - 0.4 && Math.abs(x - cx) < O.a - OCT.to && Math.abs(z - cz) < O.a - OCT.to && Math.abs(x - cx) + Math.abs(z - cz) < (2 * O.a - O.c) - OCT.to * Math.SQRT2);
      const ring = chamRing(T.u, T.v, O.a, O.c);
      for (const f of ringFaces(ring)) line(ko, m.stoneDark, f, OCT.from, OCT.to, 0, faceLen(f), O.y0 - 0.02, O.y1 - 0.35, 0.8);
      const inner = xz(shrink(ring, OCT.to - 0.2));
      plate(ko, m.carved, inner, O.y0 + 0.06, 0.04, 0.55);
      plate(ko, m.carved, inner, O.y1 - 0.4, 0.3, 0.45);
      const core = ngon(T.u, T.v, O.core, 8, Math.PI / 8);
      // the core: its eight faces up through the room (the shell's continues it over the octagon)
      ringFaces(core).forEach((f) => {
        const L = faceLen(f);
        const g = new THREE.PlaneGeometry(L, O.y1 - 0.4 - O.y0);
        planarUV(g, 2.4);
        const mx = (f.a[0] + f.c[0]) / 2;
        const mz = (f.a[1] + f.c[1]) / 2;
        ko.add(g, m.stoneDark, mx, (O.y0 + O.y1 - 0.4) / 2, mz, { ry: Math.atan2(f.n[0], f.n[1]), tint: 0.7, flat: true });
      });
      // the frame of the carillon: eight arms from the core at two heights, the bells hung from them in rings
      const levels: Array<[number, number, number]> = [
        [O.yc + 1.4, 2.6, 0.34],
        [O.yc + 4.6, 3.3, 0.22],
      ];
      for (const [y, r, R0] of levels) {
        for (let j = 0; j < 8; j++) {
          const a = Math.PI / 8 + (j * Math.PI) / 4;
          beam(ko, m.carved, V(cx + Math.sin(a) * O.core, y + 0.4, cz + Math.cos(a) * O.core), V(cx + Math.sin(a) * (O.a - OCT.to - 0.1), y + 0.4, cz + Math.cos(a) * (O.a - OCT.to - 0.1)), 0.2, 0.26, 0.7);
        }
        const n = r > 3 ? 16 : 12;
        for (let j = 0; j < n; j++) {
          const a = (j / n) * Math.PI * 2;
          const R = R0 * (1 - 0.45 * (j / n));
          bell(ko, m, cx + Math.sin(a) * r, y - 1.25 * R, cz + Math.cos(a) * r, R);
          beam(ko, m.iron, V(cx + Math.sin(a) * r, y + 0.27, cz + Math.cos(a) * r), V(cx + Math.sin(a) * r, y - 0.05, cz + Math.cos(a) * r), 0.04, 0.04);
        }
        // the iron ring the bells hang from
        for (let j = 0; j < n; j++) {
          const a0 = (j / n) * Math.PI * 2;
          const a1 = ((j + 1) / n) * Math.PI * 2;
          beam(ko, m.iron, V(cx + Math.sin(a0) * r, y + 0.3, cz + Math.cos(a0) * r), V(cx + Math.sin(a1) * r, y + 0.3, cz + Math.cos(a1) * r), 0.06, 0.06);
        }
      }
      // the clockwork on the floor by the core, its four rods out to the dials of the four great faces
      const cwx = cx - 2.3;
      slab(ko, m.iron, cwx - 0.6, cwx + 0.6, O.y0 + 0.06, O.y0 + 1.5, cz - 0.5, cz + 0.5);
      slab(ko, m.brass, cwx - 0.45, cwx + 0.45, O.y0 + 0.5, O.y0 + 1.2, cz - 0.52, cz + 0.52, 0.8);
      const dialY = 78.85;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
        const end = V(cx + dx * (O.a - OCT.to - 0.05), dialY, cz + dz * (O.a - OCT.to - 0.05));
        const mid = V(cwx, O.y0 + 1.5, cz);
        const up = V(cwx, dialY, cz);
        beam(ko, m.iron, mid, up, 0.05, 0.05);
        beam(ko, m.iron, up, end, 0.05, 0.05);
      }
    }

    if ("lantern" in T && T.lantern) {
      // ---- the south tower's small lantern over its slate roof: an open room with a bell for the hours
      const Lt = T.lantern;
      const kl = kit();
      spaces.push((x, y, z) => y > Lt.y0 && y < Lt.y1 && Math.abs(x - cx) < Lt.h - LANTERN.to && Math.abs(z - cz) < Lt.h - LANTERN.to);
      for (const f of squareFaces(T.u, T.v, Lt.h)) line(kl, m.stoneDark, f, LANTERN.from, LANTERN.to, 0.05, 2 * Lt.h - 0.05, Lt.y0 - 0.02, Lt.y1 - 0.02, 0.75);
      const IN = Lt.h - LANTERN.to;
      slab(kl, m.carved, cx - IN - 0.05, cx + IN + 0.05, Lt.y0 + 0.01, Lt.y0 + 0.06, cz - IN - 0.05, cz + IN + 0.05, 0.55, 1.2);
      slab(kl, m.carved, cx - IN - 0.05, cx + IN + 0.05, Lt.y1 - 0.12, Lt.y1 - 0.04, cz - IN - 0.05, cz + IN + 0.05, 0.45, 1.2);
      beam(kl, m.carved, V(cx - IN, Lt.y1 - 0.5, cz), V(cx + IN, Lt.y1 - 0.5, cz), 0.2, 0.22, 0.6);
      bell(kl, m, cx, Lt.y1 - 0.62 - 0.5, cz, 0.36);
    }
  }

  // ================= the crossing tower's lead tiers: their timber frame round the spire's mast
  {
    const C = UPPER_SHELL.crossing;
    const k = kit();
    const tiers: ReadonlyArray<readonly number[]> = C.tiers;
    tiers.forEach(([y0, y1, r], i) => {
      const ring = ngon(C.u, 0, r, 8, Math.PI / 8);
      const ap = r * Math.cos(Math.PI / 8) - TIER.to;
      spaces.push((x, y, z) => y > y0 && y < y1 && Math.abs(x) < ap && Math.abs(z - C.u) < ap && Math.abs(x) + Math.abs(z - C.u) < ap * 1.3);
      for (const f of ringFaces(ring)) line(k, m.carved, f, TIER.from, TIER.to, 0, faceLen(f), y0 - 0.02, y1 - 0.02, 0.55);
      const inner = shrink(ring, TIER.to - 0.05);
      plate(k, m.carved, xz(inner), y0 + 0.06, 0.05, 0.5);
      plate(k, m.carved, xz(inner), y1 - 0.06, 0.05, 0.4);
      // a post in each corner, a tie round the top, braces to the mast
      const posts = xz(shrink(ring, TIER.to + 0.1));
      posts.forEach(([x, z], j) => {
        beam(k, m.carved, V(x, y0 + 0.06, z), V(x, y1 - 0.11, z), 0.2, 0.2, 0.55);
        const [x2, z2] = posts[(j + 1) % posts.length];
        beam(k, m.carved, V(x, y1 - 0.3, z), V(x2, y1 - 0.3, z2), 0.16, 0.2, 0.5);
        if (j % 2 === 0) beam(k, m.carved, V(x, y0 + 0.4, z), V(0, y1 - 0.5, C.u), 0.14, 0.14, 0.5);
      });
      beam(k, m.carved, V(0, y0 + 0.06, C.u), V(0, y1 - 0.11, C.u), 0.36, 0.36, 0.5);
      // the ladder up to the next tier's hatch
      if (i + 1 < tiers.length) {
        const [lx, lz] = posts[5];
        const tx = lx * 0.55;
        const tz = C.u + (lz - C.u) * 0.55;
        for (const s of [-0.22, 0.22]) beam(k, m.carved, V(lx * 0.85 + s, y0 + 0.06, C.u + (lz - C.u) * 0.85), V(tx + s, y1 - 0.12, tz), 0.06, 0.08, 0.55);
        for (let q = 1; q < 9; q++) {
          const t = q / 9;
          const y = y0 + 0.06 + t * (y1 - 0.18 - y0);
          const px = lx * 0.85 + (tx - lx * 0.85) * t;
          const pz = C.u + (lz - C.u) * 0.85 + (tz - C.u - (lz - C.u) * 0.85) * t;
          beam(k, m.carved, V(px - 0.22, y, pz), V(px + 0.22, y, pz), 0.04, 0.04, 0.55);
        }
      }
    });
  }

  // ================= the roof space over the nave's and the choir's vaults
  {
    const R = UPPER_SHELL.roof;
    const rise = R.nr - R.ne;
    /** The slates' underside (the shell's slope) at y, and the boarding under it: the distance out from the axis. */
    const vSlope = (y: number) => R.hn - ((y - R.ne) * R.hn) / rise;
    const vBoard = (y: number) => vSlope(y) - BOARD;
    const FLOOR = R.ne + 0.4;
    const apex = R.ne + rise * (1 - BOARD / R.hn);
    const dormers = UPPER_SHELL.dormers;
    const sections: Array<[number, number]> = [
      [R.u0 + 0.1, R.cross[0] - 0.1],
      [R.cross[1] + 0.1, R.u1 - 0.1],
    ];
    for (const [z0, z1] of sections) {
      const k = kit();
      spaces.push((x, y, z) => z > z0 && z < z1 && y > FLOOR && y < apex && Math.abs(x) < vBoard(y));
      const T = 0.5; // the roof space is dim: its wood and stone darker
      // the floor over the vaults: their backs levelled with rubble and lime, a plank way down the middle
      slab(k, m.wash, -vSlope(FLOOR) + 0.02, vSlope(FLOOR) - 0.02, FLOOR - 0.2, FLOOR, z0, z1, 0.42, 2.6);
      slab(k, m.carved, -0.5, 0.5, FLOOR, FLOOR + 0.05, z0, z1, 0.5, 1.6);
      // the boarding under each slope, open under the dormers
      for (const side of [-1, 1]) {
        const shape = new THREE.Shape([new THREE.Vector2(z0, FLOOR - 0.05), new THREE.Vector2(z1, FLOOR - 0.05), new THREE.Vector2(z1, apex), new THREE.Vector2(z0, apex)]);
        for (const d of dormers) {
          if (d.side !== side || d.u < z0 || d.u > z1) continue;
          const hw = d.w / 2;
          shape.holes.push(new THREE.Path([new THREE.Vector2(d.u - hw, d.yb), new THREE.Vector2(d.u + hw, d.yb), new THREE.Vector2(d.u + hw, d.yb + 0.62 * d.hf), new THREE.Vector2(d.u, d.yb + d.hf), new THREE.Vector2(d.u - hw, d.yb + 0.62 * d.hf)].reverse()));
        }
        const g = new THREE.ShapeGeometry(shape, 1);
        const pos = g.getAttribute("position") as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          const z = pos.getX(i);
          const y = pos.getY(i);
          pos.setXYZ(i, side * vBoard(y), y, z);
        }
        // (facing the room: down and in)
        const idx = g.getIndex()!;
        const a = V(pos.getX(idx.getX(0)), pos.getY(idx.getX(0)), pos.getZ(idx.getX(0)));
        const b = V(pos.getX(idx.getX(1)), pos.getY(idx.getX(1)), pos.getZ(idx.getX(1)));
        const c = V(pos.getX(idx.getX(2)), pos.getY(idx.getX(2)), pos.getZ(idx.getX(2)));
        const n = b.clone().sub(a).cross(c.clone().sub(a));
        if (n.x * side > 0) {
          const arr = idx.array as Uint16Array | Uint32Array;
          for (let t = 0; t + 2 < arr.length; t += 3) [arr[t + 1], arr[t + 2]] = [arr[t + 2], arr[t + 1]];
        }
        g.computeVertexNormals();
        const uv = g.getAttribute("uv") as THREE.BufferAttribute;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, pos.getZ(i) / 1.6, pos.getY(i) / 1.6);
        k.add(g, m.carved, 0, 0, 0, { tint: T * 0.9, flat: true });
      }
      // the gables at its ends: brick, from the floor up under the boarding
      for (const [z, dir] of [[z0, 1], [z1, -1]] as Array<[number, number]>) {
        const sh = new THREE.Shape([new THREE.Vector2(-vBoard(FLOOR - 0.2) - 0.05, FLOOR - 0.2), new THREE.Vector2(vBoard(FLOOR - 0.2) + 0.05, FLOOR - 0.2), new THREE.Vector2(0, apex + 0.05)]);
        const g = new THREE.ExtrudeGeometry(sh, { depth: 0.3, bevelEnabled: false, curveSegments: 1 });
        g.translate(0, 0, dir > 0 ? -0.3 : 0);
        g.computeVertexNormals();
        planarUV(g, 2.4);
        k.add(g, m.stoneDark, 0, 0, z, { tint: T * 0.9, flat: true });
      }
      // the trusses, four to a bay, clear of the dormers: tie beam, principal rafters, collar, king post, struts
      const bays = (z0 < R.cross[0] ? [R.u0, ...Array.from({ length: 6 }, (_, i) => R.u0 + ((i + 1) * (R.cross[0] - R.u0)) / 6)] : [R.cross[1], ...Array.from({ length: 3 }, (_, i) => R.cross[1] + ((i + 1) * (R.u1 - R.cross[1])) / 3)]);
      for (let b = 0; b + 1 < bays.length; b++)
        for (const f of [0.125, 0.375, 0.625, 0.875]) {
          const z = bays[b] + (bays[b + 1] - bays[b]) * f;
          if (z < z0 + 0.3 || z > z1 - 0.3) continue;
          const ty = FLOOR + 0.35;
          const rafter = (s: number) => [V(s * (vBoard(ty) - 0.18), ty, z), V(0, apex - 0.3, z)] as const;
          beam(k, m.carved, V(-vBoard(ty) + 0.05, ty, z), V(vBoard(ty) - 0.05, ty, z), 0.3, 0.3, T);
          for (const s of [-1, 1]) {
            const [ra, rb] = rafter(s);
            beam(k, m.carved, ra, rb, 0.26, 0.3, T);
            // a strut from the king post's foot to the rafter's middle
            beam(k, m.carved, V(0, ty + 1.0, z), V(s * vBoard(ty + (apex - ty) * 0.42) * 0.82, ty + (apex - ty) * 0.42, z), 0.16, 0.16, T);
          }
          beam(k, m.carved, V(-vBoard(ty + 8.0) + 0.3, ty + 8.0, z), V(vBoard(ty + 8.0) - 0.3, ty + 8.0, z), 0.2, 0.24, T);
          beam(k, m.carved, V(0, ty + 0.15, z), V(0, apex - 0.15, z), 0.26, 0.26, T);
        }
      // the purlins along the slopes and the ridge piece
      for (const side of [-1, 1])
        for (const y of [FLOOR + 5.2, FLOOR + 10.4]) beam(k, m.carved, V(side * (vBoard(y) - 0.3), y, z0), V(side * (vBoard(y) - 0.3), y, z1), 0.22, 0.26, T);
      beam(k, m.carved, V(0, apex - 0.35, z0), V(0, apex - 0.35, z1), 0.24, 0.3, T);
      // the dormers: their fronts lined round their windows, their cheeks and roofs boarded inside, down to the boarding
      for (const d of dormers) {
        if (d.u < z0 || d.u > z1) continue;
        const s = d.side;
        const hw = d.w / 2;
        const vf = vSlope(d.yb);
        const ym = d.yb + 0.62 * d.hf;
        const yt = d.yb + d.hf;
        line(k, m.carved, { a: [s * vf, d.u - hw], c: [s * vf, d.u + hw], n: [s, 0] }, DORMER.from, DORMER.to, 0.03, d.w - 0.03, d.yb - 0.02, ym, T, [
          [0.03, ym - 0.05],
          [hw, yt - 0.06],
          [d.w - 0.03, ym - 0.05],
        ]);
        const inx = (y: number) => s * (vBoard(y) - 0.02);
        const face = (pts: THREE.Vector3[], toward: THREE.Vector3) => {
          const pos: number[] = [];
          const nn = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0]));
          const flip = nn.dot(toward) < 0;
          for (let i = 1; i + 1 < pts.length; i++) {
            const tri = flip ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]];
            for (const p of tri) pos.push(p.x, p.y, p.z);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
          g.computeVertexNormals();
          planarUV(g, 1.2);
          k.add(g, m.carved, 0, 0, 0, { tint: T * 0.8, flat: true });
        };
        // (where the boarding comes out to the front's lining, low in the dormer: the cheek's foot)
        const yFoot = d.yb + ((DORMER.to - BOARD - 0.02) * rise) / R.hn;
        for (const q of [-1, 1]) {
          const zc = d.u + q * (hw - 0.03);
          // the cheek: from the front's lining back to the boarding
          face([V(s * (vf - DORMER.to), yFoot, zc), V(s * (vf - DORMER.to), ym - 0.03, zc), V(inx(ym - 0.03), ym - 0.03, zc)], V(0, 0, -q));
          // the roof: from the front's gable back over the cheek to the boarding
          face([V(s * (vf - DORMER.to), ym - 0.03, zc), V(s * (vf - DORMER.to), yt - 0.04, d.u), V(inx(yt - 0.04), yt - 0.04, d.u), V(inx(ym - 0.03), ym - 0.03, zc)], V(0, -1, 0));
        }
      }
    }
  }

  for (const k of kits) k.finish();

  // ================= light: the day through the openings (the hall's light setting: one hemisphere, one ambient)
  const hemi = new THREE.HemisphereLight(0xdcd8d0, 0x4a4036, 1.2);
  const amb = new THREE.AmbientLight(0x5a5048, 0.8);
  scene.add(hemi, amb);
  const HEMI_NIGHT = new THREE.Color(0x5a6a90);
  const HEMI_DAY = new THREE.Color(0xdcd8d0);
  let last = -1;
  const setDaylight = (day: number, sky: number) => {
    const key = Math.round(day * 200) * 1000 + Math.round(sky * 200);
    if (key === last) return;
    last = key;
    const d = day * (0.55 + 0.45 * sky);
    const night = 1 - THREE.MathUtils.smoothstep(day, 0, 0.35);
    hemi.intensity = 0.12 + 1.9 * d;
    hemi.color.copy(HEMI_DAY).lerp(HEMI_NIGHT, night);
    amb.intensity = 0.1 + 0.45 * d;
  };
  setDaylight(1, 1);

  const room: InWorldRoom = {
    id: "cathedral_upper",
    scene,
    openings: windowOpenings(UPPER_WINDOWS, (x, z) => P.toWorld(x, z)),
    // (nobody goes up; an eye put there for a picture is inside: the street through its openings; this room is added
    // before the hall, so over the hall's plan it wins)
    insideness: (eye) => (spaces.some((f) => f(eye.x - P.ORIGIN.x, eye.y, eye.z - P.ORIGIN.z)) ? 1 : 0),
    reach: 95,
    air(_k, street) {
      const fog = scene.fog as THREE.Fog;
      fog.color.copy(street.color);
      fog.near = street.near;
      fog.far = street.far;
    },
    lamps: () => [],
    scatter: 0.3,
  };
  let meshes = 0;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes++;
  });
  return { room, setDaylight, info: () => ({ parts: kits.length, openings: room.openings.length, meshes }) };
}
