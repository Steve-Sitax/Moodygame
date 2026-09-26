import * as THREE from "three";
import CITY_DATA from "../../../shared/city.json";
import { HULLS, type SmallKind } from "../../../shared/smallBoats";
import { ropeMaterial } from "../world/boats";
import { TOE_TOP, bedAt, regionAt } from "../world/tide";
import { psx } from "../retro/psx";

// The small boats' moorings (M7 boats): the iron rings in the coping stones, the bow and stern lines
// from each boat to her rings (they sag at high water and draw taut at low), and the mud under a boat
// that lies close to a wall (world/tidemud.ts: the bank at the foot of the river and canal walls comes
// bare at low water; a boat moored there sits on it with a small list). game/rowing.ts uses this.

/** world/tidemud.ts: the bank runs this far out from the wall and falls this much over that distance. */
const TOE_OUT = 3.6;
const TOE_DROP = 1.4;

const QUAYS = (CITY_DATA as unknown as { quays: number[][] }).quays;

/** Distance from (x, z) to the nearest quay wall line (m). */
export function wallDistance(x: number, z: number): number {
  let best = Infinity;
  for (const [ax, az, bx, bz] of QUAYS) {
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** The mud under (x, z): the canal and vliet beds, the bank at the foot of a river or canal wall; -Infinity where it is deep. */
export function mudAt(x: number, z: number): number {
  const bed = bedAt(x, z);
  if (regionAt(x, z) !== 0) return bed;
  const d = wallDistance(x, z);
  const toe = d < TOE_OUT ? TOE_TOP - (TOE_DROP * d) / TOE_OUT : -Infinity;
  return Math.max(bed, toe);
}

/**
 * The lowest the waterline of a boat of this kind lying here can go: she sits on the mud under her keel
 * (the deepest point under her hull, as she lies along the wall: her outer side is further out).
 */
export function floorOf(kind: SmallKind, x: number, z: number, yaw: number): number {
  const h = HULLS[kind];
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  let mud = -Infinity;
  // the keel line: her middle and her two ends (the mud is highest right at the wall)
  for (const f of [-0.7, 0, 0.7]) mud = Math.max(mud, mudAt(x + s * h.half * f, z + c * h.half * f));
  return mud + h.draft;
}

/** Ropes drawn at once at most (two a boat). */
const MAX_ROPES = 64;
/** Segments of one rope. */
const SEG = 6;

export interface RopeEnd {
  /** The boat's live matrix (her inner, bobbing frame). */
  m: THREE.Matrix4;
  kind: SmallKind;
  rings: [[number, number], [number, number]];
  /** Quay top at the rings. */
  top: number;
}

export class Moorings {
  private readonly lines: THREE.LineSegments;
  private readonly pos: Float32Array;
  private rings: THREE.InstancedMesh | null = null;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly scene: THREE.Object3D) {
    this.pos = new Float32Array(MAX_ROPES * SEG * 2 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setDrawRange(0, 0);
    this.lines = new THREE.LineSegments(g, ropeMaterial(0x2a2319));
    this.lines.name = "mooring_ropes";
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  /** The iron rings in the coping stones, once: [x, z, quay top y]. */
  setRings(list: Array<[number, number, number]>, iron: THREE.Material): void {
    if (this.rings) {
      this.rings.removeFromParent();
      this.rings.dispose();
    }
    // a ring lying flat on the coping, and the iron staple it hangs from
    const ring = new THREE.TorusGeometry(0.075, 0.016, 4, 8).rotateX(Math.PI / 2);
    const staple = new THREE.BoxGeometry(0.05, 0.05, 0.05).translate(0, 0.01, 0.07);
    const g = mergeTwo(ring, staple);
    const m = new THREE.InstancedMesh(g, iron, Math.max(1, list.length));
    const M = new THREE.Matrix4();
    list.forEach(([x, z, y], i) => m.setMatrixAt(i, M.makeTranslation(x, y + 0.02, z)));
    m.count = list.length;
    m.computeBoundingSphere();
    m.name = "mooring_rings";
    this.rings = m;
    this.scene.add(m);
  }

  /** Where a boat's bow (0) or stern (1) line is made fast, in the world. */
  cleat(e: RopeEnd, end: 0 | 1, out: THREE.Vector3): THREE.Vector3 {
    const h = HULLS[e.kind];
    const p = end === 0 ? h.bow : h.stern;
    return out.set(p[0], p[1], p[2]).applyMatrix4(e.m);
  }

  /** Draw the lines of these boats (the nearest few: the caller picks them). */
  update(ends: RopeEnd[]): void {
    let n = 0;
    const a = this.tmp;
    for (const e of ends) {
      for (const end of [0, 1] as const) {
        if (n >= MAX_ROPES) break;
        this.cleat(e, end, a);
        const [rx, rz] = e.rings[end];
        const ry = e.top + 0.03;
        const d = Math.hypot(rx - a.x, ry - a.y, rz - a.z);
        // slack hangs lower the more of it there is: at high water the line is long for the drop
        const sag = Math.min(0.9, 0.12 + 0.35 * Math.max(0, 1 - Math.abs(ry - a.y) / Math.max(0.5, d)) * Math.min(1, d / 3));
        let px = a.x;
        let py = a.y;
        let pz = a.z;
        for (let k = 1; k <= SEG; k++) {
          const f = k / SEG;
          const x = a.x + (rx - a.x) * f;
          const z = a.z + (rz - a.z) * f;
          const y = a.y + (ry - a.y) * f - sag * 4 * f * (1 - f);
          const o = (n * SEG + k - 1) * 6;
          this.pos[o] = px;
          this.pos[o + 1] = py;
          this.pos[o + 2] = pz;
          this.pos[o + 3] = x;
          this.pos[o + 4] = y;
          this.pos[o + 5] = z;
          px = x;
          py = y;
          pz = z;
        }
        n++;
      }
    }
    const g = this.lines.geometry;
    g.setDrawRange(0, n * SEG * 2);
    (g.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
  }
}

function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const A = a.toNonIndexed();
  const B = b.toNonIndexed();
  const g = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "uv"]) {
    const x = A.getAttribute(name) as THREE.BufferAttribute;
    const y = B.getAttribute(name) as THREE.BufferAttribute;
    const arr = new Float32Array(x.array.length + y.array.length);
    arr.set(x.array as Float32Array, 0);
    arr.set(y.array as Float32Array, x.array.length);
    g.setAttribute(name, new THREE.BufferAttribute(arr, x.itemSize));
  }
  return g;
}

/** A plain iron for the rings when the world has none handy. */
export function ironMaterial(): THREE.Material {
  return psx(new THREE.MeshLambertMaterial({ color: 0x2b2826 }));
}
