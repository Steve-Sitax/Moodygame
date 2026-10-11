import * as THREE from "three";
import { grimeDecalMaterial } from "./houseGrime";
import { grimeDecals } from "./cityTextures";

// D1 (docs/plans/next-update.md): the sewer outfalls in the walls of the canal and the vliet. The vlieten and the
// canal were the town's open sewers (world/litter.ts); each street drain ends in an arched mouth in the quay wall,
// built out from the face in dressed bluestone (a sill, two jambs, a ring of voussoirs with a keystone), dark inside,
// with a rusted grating, and a black wet run down the wall to a stain on the mud (world/tidemud.ts draws the stain
// and starts the low-water trickle at the head outfalls). Still: three meshes for all of them (the stones in the
// coping's material, the dark parts in the mud's debris material, the runs in the houses' grime decal material).

export interface Outfall {
  /** The foot of the wall face under the mouth's middle (world x, z). */
  x: number;
  z: number;
  /** Out of the wall, into the water (unit, along x or z). */
  nx: number;
  nz: number;
  /** The sill's top (m, quay top 0). */
  sill: number;
}

/**
 * The outfalls: on stretches of wall clear of the ladders, the steps, the bridges and the boats' rings (checked
 * against quayInfo() and shared/smallBoats.ts MOORINGS, 2026-10-11). The two at the heads feed the trickle.
 */
export const OUTFALLS: readonly Outfall[] = [
  { x: -82, z: 62.3, nx: 1, nz: 0, sill: -3.35 }, // the canal, west wall, south of the bridge
  { x: -70, z: 31.0, nx: -1, nz: 0, sill: -3.2 }, // the canal, east wall, by the steps
  { x: -82, z: 147.5, nx: 1, nz: 0, sill: -3.45 }, // the canal, west wall, by the boat yard
  { x: -70, z: 157.0, nx: -1, nz: 0, sill: -3.3 }, // the canal, east wall
  { x: -76, z: 205, nx: 0, nz: -1, sill: -3.6 }, // the canal head
  { x: -142, z: 30.0, nx: -1, nz: 0, sill: -3.3 }, // the vliet, east wall
  { x: -150, z: 49.0, nx: 1, nz: 0, sill: -3.4 }, // the vliet, west wall, north of the bridge
  { x: -146, z: 72, nx: 0, nz: -1, sill: -3.5 }, // the vliet head
];

/** The mouth: the opening's width, the jambs' height to the springing, how far the stone is built out. */
const W = 0.9;
const JAMB = 0.42;
const OUT = 0.3;
const RING = 0.27;

/** A builder of flat-shaded faces in a wall's frame: a along the wall, b up, c out of the wall (metres). */
class Faces {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  constructor(private o: Outfall, private withUv: boolean, private withCol: boolean) {}
  private w(a: number, b: number, c: number): [number, number, number] {
    // along the wall: the wall's tangent with the water to the right of it
    const tx = -this.o.nz;
    const tz = this.o.nx;
    return [this.o.x + tx * a + this.o.nx * c, this.o.sill + b, this.o.z + tz * a + this.o.nz * c];
  }
  /** A quad a, b, c, d (wall-frame points, counter-clockwise seen from its front), one colour per corner. */
  quad(p: number[][], col?: number[][]): void {
    const order = [0, 1, 2, 0, 2, 3];
    for (const i of order) {
      const q = p[i];
      this.pos.push(...this.w(q[0], q[1], q[2]));
      // the coping's picture: 3 m a tile along, its depth across; on a face, the larger two of its extents
      if (this.withUv) this.uv.push((q[0] + q[2] * 0.7) / 0.9, (q[1] + q[2] * 0.4) / 0.9);
      if (this.withCol) this.col.push(...(col ? col[i] : [1, 1, 1]));
    }
  }
}

/**
 * A dressed stone in the wall's frame: its back outline (a list of points a, b round it, counter-clockwise seen
 * from the water) from the wall face back to c0, its front at c1 drawn in by `ch` (the chamfer) toward its middle.
 */
function stone(f: Faces, outline: number[][], c0: number, c1: number, ch: number, skipEdge = -1): void {
  const n = outline.length;
  let ma = 0;
  let mb = 0;
  for (const p of outline) {
    ma += p[0] / n;
    mb += p[1] / n;
  }
  const front = outline.map(([a, b]) => {
    const da = ma - a;
    const db = mb - b;
    const l = Math.hypot(da, db) || 1;
    return [a + (da / l) * ch, b + (db / l) * ch];
  });
  // the front face (a fan from the middle)
  for (let i = 0; i < n; i++) {
    const p = front[i];
    const q = front[(i + 1) % n];
    f.quad([[ma, mb, c1], [p[0], p[1], c1], [q[0], q[1], c1], [ma, mb, c1]]);
  }
  // the sides with the chamfer: back edge at c1 - ch to the front edge at c1
  for (let i = 0; i < n; i++) {
    if (i === skipEdge) continue;
    const p = outline[i];
    const q = outline[(i + 1) % n];
    const fp = front[i];
    const fq = front[(i + 1) % n];
    f.quad([[q[0], q[1], c0], [p[0], p[1], c0], [p[0], p[1], c1 - ch], [q[0], q[1], c1 - ch]]);
    f.quad([[q[0], q[1], c1 - ch], [p[0], p[1], c1 - ch], [fp[0], fp[1], c1], [fq[0], fq[1], c1]]);
  }
}

export interface OutfallParts {
  group: THREE.Group;
}

/** The outfalls' meshes: stones in `stoneMat` (the quay coping's), dark parts in `darkMat` (vertex colours). */
export function buildOutfalls(scene: THREE.Object3D, stoneMat: THREE.Material, darkMat: THREE.Material): OutfallParts {
  const group = new THREE.Group();
  group.name = "outfalls";
  const stones: Faces[] = [];
  const darks: Faces[] = [];
  const decalPos: number[] = [];
  const decalUv: number[] = [];
  const decalCell: number[] = [];
  const decalCol: number[] = [];
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (const o of OUTFALLS) {
    const s = new Faces(o, true, false);
    const d = new Faces(o, false, true);
    stones.push(s);
    darks.push(d);
    const r = W / 2;
    const cy = JAMB; // the arch's centre over the sill
    const back = -0.03; // (a hand into the wall: no gap at the face)
    // the sill: a slab projecting past the mouth, its top at the sill
    stone(s, [[-0.85, -0.17], [0.85, -0.17], [0.85, 0], [-0.85, 0]], back, OUT + 0.12, 0.02);
    // the jambs: two blocks each side
    for (const side of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const b0 = k * (JAMB / 2) + 0.004;
        const b1 = (k + 1) * (JAMB / 2) - 0.004;
        const a0 = side < 0 ? -r - RING - (k ? 0.04 : 0) : r;
        const a1 = side < 0 ? -r : r + RING + (k ? 0.04 : 0);
        stone(s, [[a0, b0], [a1, b0], [a1, b1], [a0, b1]], back, OUT - (rnd() * 0.015), 0.018);
      }
    }
    // the ring: eleven voussoirs, the keystone deeper and a little proud
    const N = 11;
    for (let i = 0; i < N; i++) {
      const g = 0.012; // the joint
      const a0 = Math.PI - (i / N) * Math.PI - g / r;
      const a1 = Math.PI - ((i + 1) / N) * Math.PI + g / r;
      const key = i === (N - 1) / 2;
      const R = r + RING + (key ? 0.06 : 0);
      const pts: number[][] = [];
      const steps = 3;
      for (let k = 0; k <= steps; k++) {
        const a = a0 + ((a1 - a0) * k) / steps;
        pts.push([Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
      for (let k = steps; k >= 0; k--) {
        const a = a0 + ((a1 - a0) * k) / steps;
        pts.push([Math.cos(a) * R, cy + Math.sin(a) * R]);
      }
      // (outline counter-clockwise from the water: the inner edge runs left to right, so reverse it)
      pts.reverse();
      stone(s, pts, back, OUT + (key ? 0.03 : 0) - rnd() * 0.012, 0.016, steps);
    }
    // the dark lining of the barrel: from the front (slimy brown-black) to the back (black), and the back itself
    const front = [0.07, 0.065, 0.05];
    const deep = [0.012, 0.012, 0.01];
    const lining = (p: number[][], c: number[][]) => d.quad(p, c);
    const SEG = 14;
    for (let k = 0; k < SEG; k++) {
      const a0 = Math.PI - (k / SEG) * Math.PI;
      const a1 = Math.PI - ((k + 1) / SEG) * Math.PI;
      const p0 = [Math.cos(a0) * r, cy + Math.sin(a0) * r];
      const p1 = [Math.cos(a1) * r, cy + Math.sin(a1) * r];
      lining([[p0[0], p0[1], OUT], [p1[0], p1[1], OUT], [p1[0], p1[1], 0.004], [p0[0], p0[1], 0.004]], [front, front, deep, deep]);
    }
    for (const side of [-1, 1]) {
      const a = side * r;
      const p = side < 0 ? [[a, 0, 0.004], [a, cy, 0.004], [a, cy, OUT], [a, 0, OUT]] : [[a, 0, OUT], [a, cy, OUT], [a, cy, 0.004], [a, 0, 0.004]];
      lining(p, side < 0 ? [deep, deep, front, front] : [front, front, deep, deep]);
    }
    // the floor of the barrel: wet, a little lighter (the sill's slime) toward the front
    const wet = [0.09, 0.085, 0.06];
    lining([[-r, 0.002, 0.004], [r, 0.002, 0.004], [r, 0.002, OUT], [-r, 0.002, OUT]], [deep, deep, wet, wet]);
    // the back: the opening's shape at the wall face, black
    for (let k = 0; k < SEG; k++) {
      const a0 = Math.PI - (k / SEG) * Math.PI;
      const a1 = Math.PI - ((k + 1) / SEG) * Math.PI;
      lining([[0, cy, 0.006], [Math.cos(a0) * r, cy + Math.sin(a0) * r, 0.006], [Math.cos(a1) * r, cy + Math.sin(a1) * r, 0.006], [0, cy, 0.006]], [deep, deep, deep, deep]);
    }
    lining([[-r, 0, 0.006], [r, 0, 0.006], [r, cy, 0.006], [-r, cy, 0.006]], [deep, deep, deep, deep]);
    // the grating: five rusted bars in a frame, a hand behind the front
    const rust = [0.16, 0.08, 0.045];
    const rustD = [0.09, 0.05, 0.03];
    const bar = (a: number, b0: number, b1: number, c: number, t: number) => {
      // a square bar (t thick) from b0 to b1 at a, depth c
      lining([[a - t, b0, c + t], [a + t, b0, c + t], [a + t, b1, c + t], [a - t, b1, c + t]], [rust, rust, rustD, rustD]);
      lining([[a + t, b0, c + t], [a + t, b0, c - t], [a + t, b1, c - t], [a + t, b1, c + t]], [rustD, rustD, rustD, rustD]);
      lining([[a - t, b0, c - t], [a - t, b0, c + t], [a - t, b1, c + t], [a - t, b1, c - t]], [rustD, rustD, rustD, rustD]);
    };
    const cBar = OUT - 0.07;
    for (let k = 1; k <= 5; k++) {
      const a = -r + (2 * r * k) / 6;
      const top = cy + Math.sqrt(Math.max(0, r * r - a * a)) - 0.01;
      bar(a, 0.004, top, cBar, 0.011);
    }
    // a cross bar, the frame's foot
    lining([[-r, 0.2, cBar + 0.014], [r, 0.2, cBar + 0.014], [r, 0.235, cBar + 0.014], [-r, 0.235, cBar + 0.014]], [rustD, rustD, rust, rust]);
    // the run: black wet slime from the sill down the wall to the mud, a wider faint stain round it
    const decal = (a0: number, a1: number, b0: number, b1: number, cell: [number, number], c: number[], alpha: number, outC: number) => {
      const tx = -o.nz;
      const tz = o.nx;
      const P = (a: number, b: number) => [o.x + tx * a + o.nx * outC, o.sill + b, o.z + tz * a + o.nz * outC];
      const corners = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)];
      const uvs = [[0.001, 0.001], [0.999, 0.001], [0.999, 0.999], [0.001, 0.999]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        decalPos.push(...corners[i]);
        decalUv.push(...uvs[i]);
        decalCell.push(...cell);
        decalCol.push(c[0], c[1], c[2], alpha);
      }
    };
    // (down to under the mud's foot at the wall: the bed's toe lies at about -4.75)
    const down = -4.95 - o.sill;
    decal(-0.75, 0.75, down, -0.16, [0, 0], [0.004, 0.005, 0.003], 0.9, 0.012);
    decal(-1.3, 1.3, down, 0.2, [0, 0], [0.006, 0.007, 0.005], 0.45, 0.009);
  }
  const merge = (list: Faces[]) => {
    const pos: number[] = [];
    const uv: number[] = [];
    const col: number[] = [];
    for (const f of list) {
      pos.push(...f.pos);
      uv.push(...f.uv);
      col.push(...f.col);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    if (uv.length) g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    if (col.length) g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  };
  const stoneMesh = new THREE.Mesh(merge(stones), stoneMat);
  stoneMesh.name = "outfall_stones";
  const darkMesh = new THREE.Mesh(merge(darks), darkMat);
  darkMesh.name = "outfall_dark";
  const dg = new THREE.BufferGeometry();
  dg.setAttribute("position", new THREE.Float32BufferAttribute(decalPos, 3));
  dg.setAttribute("uv", new THREE.Float32BufferAttribute(decalUv, 2));
  dg.setAttribute("cell", new THREE.Float32BufferAttribute(decalCell, 2));
  dg.setAttribute("color", new THREE.Float32BufferAttribute(decalCol, 4));
  dg.computeBoundingSphere();
  const decalMesh = new THREE.Mesh(dg, grimeDecalMaterial(grimeDecals()));
  decalMesh.name = "outfall_runs";
  // (after the walls, before the water: the runs lie on the wall under the water at high tide)
  decalMesh.renderOrder = 1;
  group.add(stoneMesh, darkMesh, decalMesh);
  scene.add(group);
  return { group };
}
