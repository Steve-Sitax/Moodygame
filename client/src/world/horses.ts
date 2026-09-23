import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Props } from "./props3d";

// Horses for the quay railway and the omnibus (M3g): the dray horse of props.glb (tr_horse_body
// and its four legs, on the goods atlas), all horses in three InstancedMeshes. A four-beat walk
// or a trot, the same leg swing as the drays in traffic.ts.

const LEGS: Array<[number, number, number, "F" | "H", number]> = [
  // x (left +), hip height, z (ahead +), front or hind, phase in the step cycle
  [0.19, 1.05, 0.62, "F", 0.25],
  [-0.19, 1.05, 0.62, "F", 0.75],
  [0.2, 1.1, -0.62, "H", 0.0],
  [-0.2, 1.1, -0.62, "H", 0.5],
];
/** In a trot the diagonal pairs move together. */
const TROT = [0.0, 0.5, 0.5, 0.0];

function part(props: Props, name: string): THREE.BufferGeometry {
  const geos = props.parts(name).map((p) => p.geometry);
  return geos.length === 1 ? geos[0] : (mergeGeometries(geos, false) ?? geos[0]);
}

export class HorsePool {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  private readonly legF: THREE.InstancedMesh;
  private readonly legH: THREE.InstancedMesh;
  private readonly M = new THREE.Matrix4();
  private readonly Q = new THREE.Quaternion();
  private readonly E = new THREE.Euler();
  private readonly P = new THREE.Vector3();
  private readonly S = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(
    parent: THREE.Object3D,
    props: Props,
    readonly count: number,
  ) {
    const mat = props.materials.goods;
    const inst = (g: THREE.BufferGeometry, n: number, name: string) => {
      const m = new THREE.InstancedMesh(g, mat, n);
      m.name = name;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) m.setMatrixAt(i, this.zero);
      this.group.add(m);
      return m;
    };
    this.body = inst(part(props, "tr_horse_body"), count, "horse_body");
    this.legF = inst(part(props, "tr_leg_front"), count * 2, "horse_leg_front");
    this.legH = inst(part(props, "tr_leg_hind"), count * 2, "horse_leg_hind");
    this.group.name = "horses";
    parent.add(this.group);
  }

  private put(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, yaw: number, pitch = 0): void {
    this.E.set(pitch, yaw, 0, "YXZ");
    this.Q.setFromEuler(this.E);
    this.P.set(x, y, z);
    this.M.compose(this.P, this.Q, this.S);
    m.setMatrixAt(i, this.M);
  }

  /**
   * Horse i at (x, z) looking along yaw (0 = +z), `gait` 0..1 through its step cycle,
   * `amp` 0 (standing) .. 1 (full stride), `trot` for the two-beat gait.
   */
  set(i: number, x: number, z: number, yaw: number, gait: number, amp: number, trot = false): void {
    const bob = (trot ? 0.05 : 0.025) * amp * Math.abs(Math.sin(gait * Math.PI * (trot ? 2 : 4)));
    this.put(this.body, i, x, bob, z, yaw);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    LEGS.forEach(([lx, ly, lz, leg, ph], k) => {
      const phase = (gait + (trot ? TROT[k] : ph)) % 1;
      const stance = trot ? 0.5 : 0.6;
      const u = phase < stance ? 1 - (2 * phase) / stance : -1 + 2 * THREE.MathUtils.smoothstep((phase - stance) / (1 - stance), 0, 1);
      const lift = phase >= stance ? (trot ? 0.12 : 0.05) * Math.sin(((phase - stance) / (1 - stance)) * Math.PI) : 0;
      const swing = -(trot ? 0.45 : 0.36) * u * amp;
      const wx = x + lx * cy + lz * sy;
      const wz = z - lx * sy + lz * cy;
      this.put(leg === "F" ? this.legF : this.legH, i * 2 + (k % 2), wx, ly + bob + lift * amp, wz, yaw, swing);
    });
  }

  private readonly wants = new Set<string>();
  /** Shared by the train and the omnibus: drawn while either wants it (near enough to see). */
  show(who: string, on: boolean): void {
    if (on) this.wants.add(who);
    else this.wants.delete(who);
    this.group.visible = this.wants.size > 0;
  }

  hide(i: number): void {
    this.body.setMatrixAt(i, this.zero);
    for (const k of [0, 1]) {
      this.legF.setMatrixAt(i * 2 + k, this.zero);
      this.legH.setMatrixAt(i * 2 + k, this.zero);
    }
  }

  commit(): void {
    this.body.instanceMatrix.needsUpdate = true;
    this.legF.instanceMatrix.needsUpdate = true;
    this.legH.instanceMatrix.needsUpdate = true;
  }
}
