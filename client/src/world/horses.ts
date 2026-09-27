import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Props } from "./props3d";
import { type Coat, LEG_PARTS, coatGeometry, horsePose, legPart, newHorsePose, teamMaterial } from "./horseGait";

// Horses for the quay railway and the omnibus (M3g), the hearse and the fire pump: the draught horse of props.glb
// (tr_horse_body and its legs, each split at the knee or hock, on the team atlas; horseGait.ts), all horses of a pool
// in five InstancedMeshes (the body and the four leg parts), in one coat. A four-beat walk or a trot, the same gait
// as the drays in traffic.ts.

function part(props: Props, name: string): THREE.BufferGeometry {
  const geos = props.parts(name).map((p) => p.geometry);
  return geos.length === 1 ? geos[0] : (mergeGeometries(geos, false) ?? geos[0]);
}

export class HorsePool {
  readonly group = new THREE.Group();
  private readonly body: THREE.InstancedMesh;
  /** Front upper, front lower, hind upper, hind lower: two per horse each. */
  private readonly legs: THREE.InstancedMesh[];
  private readonly pose = newHorsePose();
  private readonly M = new THREE.Matrix4();
  private readonly Q = new THREE.Quaternion();
  private readonly E = new THREE.Euler();
  private readonly P = new THREE.Vector3();
  private readonly S = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Matrix4().makeScale(0, 0, 0);
  /** Each horse's body height as last set (the train's trace chains hang from its hame tugs). */
  private readonly bobs: Float32Array;

  constructor(
    parent: THREE.Object3D,
    props: Props,
    readonly count: number,
    coat: Coat = "bay",
  ) {
    this.bobs = new Float32Array(count);
    const mat = teamMaterial(props);
    const inst = (g: THREE.BufferGeometry, n: number, name: string) => {
      const m = new THREE.InstancedMesh(coatGeometry(g, coat), mat, n);
      m.name = name;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) m.setMatrixAt(i, this.zero);
      this.group.add(m);
      return m;
    };
    this.body = inst(part(props, "tr_horse_body"), count, "horse_body");
    this.legs = LEG_PARTS.map((n) => inst(part(props, n), count * 2, n.replace("tr_", "horse_")));
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
   * `amp` 0 (standing) .. 1 (full stride), `trot` for the two-beat gait; `stride` the metres it goes in one cycle
   * (default horseGait.ts WALK_STRIDE / TROT_STRIDE, as the omnibus and the train move `gait`).
   */
  set(i: number, x: number, z: number, yaw: number, gait: number, amp: number, trot = false, stride?: number): void {
    const pose = horsePose(this.pose, gait, amp, trot, stride);
    this.bobs[i] = pose.bob;
    this.put(this.body, i, x, pose.bob, z, yaw);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    pose.legs.forEach((L, k) => {
      const j = i * 2 + (k % 2);
      this.put(this.legs[legPart(k, false)], j, x + L.x * cy + L.uz * sy, L.uy, z - L.x * sy + L.uz * cy, yaw, L.up);
      this.put(this.legs[legPart(k, true)], j, x + L.x * cy + L.lz * sy, L.ly, z - L.x * sy + L.lz * cy, yaw, L.lp);
    });
  }

  /** Horse i's body height over the ground (as last set). */
  bob(i: number): number {
    return this.bobs[i] ?? 0;
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
    for (const m of this.legs) for (const k of [0, 1]) m.setMatrixAt(i * 2 + k, this.zero);
  }

  commit(): void {
    this.body.instanceMatrix.needsUpdate = true;
    for (const m of this.legs) m.instanceMatrix.needsUpdate = true;
  }
}
