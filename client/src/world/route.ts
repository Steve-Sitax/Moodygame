import * as THREE from "three";
import { WATER_Y } from "./rijnkaai";

// A water route for moving boats: a smoothed line through (x, z) points, and a "train" of
// boats that follows it one behind the other (a tug and its tows, or a single boat). Used by
// world/bridges.ts (canal and vliet passages) and world/river.ts (the Schelde traffic).
// WATER_Y is only read inside functions (rijnkaai.ts imports the modules that import this).

export class Route {
  readonly curve: THREE.CatmullRomCurve3;
  readonly length: number;
  private readonly p = new THREE.Vector3();
  private readonly t = new THREE.Vector3();

  constructor(points: Array<[number, number]>) {
    this.curve = new THREE.CatmullRomCurve3(
      points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
      false,
      "centripetal",
    );
    this.length = this.curve.getLength();
  }

  /** Position (x, z) and heading at distance s from the start; dir +1 = travelling toward the end. */
  pose(s: number, dir: number, out: { x: number; z: number; yaw: number }): void {
    const u = THREE.MathUtils.clamp(s / this.length, 0, 1);
    this.curve.getPointAt(u, this.p);
    this.curve.getTangentAt(u, this.t);
    out.x = this.p.x;
    out.z = this.p.z;
    out.yaw = Math.atan2(this.t.x * dir, this.t.z * dir);
  }

  /** Distances along the route where it is inside a rectangle (grown by pad): [enter, leave], or null. */
  span(r: { minX: number; maxX: number; minZ: number; maxZ: number }, pad = 0, steps = 600): [number, number] | null {
    let a = -1;
    let b = -1;
    for (let i = 0; i <= steps; i++) {
      this.curve.getPointAt(i / steps, this.p);
      if (this.p.x > r.minX - pad && this.p.x < r.maxX + pad && this.p.z > r.minZ - pad && this.p.z < r.maxZ + pad) {
        const s = (i / steps) * this.length;
        if (a < 0) a = s;
        b = s;
      }
    }
    return a < 0 ? null : [a, b];
  }
}

export interface TrainPart {
  obj: THREE.Object3D;
  /** Hull length, for spacing and the hawser. */
  len: number;
}

const pose = { x: 0, z: 0, yaw: 0 };

/**
 * Put a train on the route: the first part's middle at s, the others behind it (against the
 * direction of travel), `gap` metres of hawser between hulls. Writes the hawsers (two points per
 * link: tug stern, tow bow) into `hawser` from index `at` (xyz triples); returns the next index.
 */
export function placeTrain(
  route: Route,
  s: number,
  dir: number,
  parts: TrainPart[],
  gap: number,
  hawser?: THREE.BufferAttribute,
  at = 0,
): number {
  let sp = s;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (i > 0) sp -= dir * (parts[i - 1].len / 2 + gap + p.len / 2);
    route.pose(sp, dir, pose);
    p.obj.position.set(pose.x, WATER_Y, pose.z);
    p.obj.rotation.y = pose.yaw;
    if (i > 0 && hawser) {
      const a = parts[i - 1].obj;
      const b = p.obj;
      const la = parts[i - 1].len / 2 - 1.2;
      const lb = p.len / 2 - 0.5;
      hawser.setXYZ(at++, a.position.x - Math.sin(a.rotation.y) * la, WATER_Y + 1.3, a.position.z - Math.cos(a.rotation.y) * la);
      hawser.setXYZ(at++, b.position.x + Math.sin(b.rotation.y) * lb, WATER_Y + 1.1, b.position.z + Math.cos(b.rotation.y) * lb);
    }
  }
  return at;
}

/** Length of a whole train, bow of the first to stern of the last. */
export function trainLength(parts: TrainPart[], gap: number): number {
  return parts.reduce((a, p) => a + p.len, 0) + gap * Math.max(0, parts.length - 1);
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
