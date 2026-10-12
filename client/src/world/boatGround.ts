import * as THREE from "three";
import { bedAt, draftOf } from "./tide";

// Grounding uses the drawn bottom and mud, including the bilges at a wall. The
// mud is sampled once; fixed moorings reuse their floor until the mesh changes.
const CELL = 0.25;
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
const mud = new Map<string, number>();
const bottoms = new Map<string, THREE.Vector3[]>();
const floors = new Map<string, number>();

export function registerBoatBottom(kind: string, root: THREE.Object3D): void {
  const cells = new Map<string, THREE.Vector3>();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || /_(cap|walk|block|far)(_|$)/.test(m.name)) return;
    const pos = m.geometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (v.y > 0) continue;
      const k = `${Math.round(v.x * 10)},${Math.round(v.z * 10)}`;
      const old = cells.get(k);
      if (!old || v.y < old.y) cells.set(k, v);
    }
  });
  bottoms.set(kind, [...cells.values()]);
  floors.clear();
}

export function registerBoatMud(mesh: THREE.Mesh): void {
  mud.clear();
  floors.clear();
  mesh.updateMatrixWorld(true);
  const p = mesh.geometry.getAttribute("position"), idx = mesh.geometry.index;
  const at = (i: number) => new THREE.Vector3().fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
  for (let i = 0; i < (idx?.count ?? p.count); i += 3) {
    const a = at(i), b = at(i + 1), c = at(i + 2);
    const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(d) < 1e-9) continue;
    for (let x = Math.floor(Math.min(a.x, b.x, c.x) / CELL); x <= Math.floor(Math.max(a.x, b.x, c.x) / CELL); x++)
      for (let z = Math.floor(Math.min(a.z, b.z, c.z) / CELL); z <= Math.floor(Math.max(a.z, b.z, c.z) / CELL); z++) {
        const px = (x + 0.5) * CELL, pz = (z + 0.5) * CELL;
        const u = ((b.z - c.z) * (px - c.x) + (c.x - b.x) * (pz - c.z)) / d;
        const v = ((c.z - a.z) * (px - c.x) + (a.x - c.x) * (pz - c.z)) / d;
        if (u < -1e-4 || v < -1e-4 || 1 - u - v < -1e-4) continue;
        const k = `${x},${z}`, y = u * a.y + v * b.y + (1 - u - v) * c.y;
        mud.set(k, Math.max(mud.get(k) ?? -Infinity, y));
      }
  }
}

/** Lowest waterline supported by the actual hull over the drawn mud. */
export function boatFloor(kind: string, x: number, z: number, yaw: number): number {
  const k = `${kind}:${x}:${z}:${yaw}`;
  const old = floors.get(k);
  if (old !== undefined) return old;
  let floor = -Infinity;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const points = bottoms.get(kind);
  if (points?.length) {
    for (const p of points) {
      const px = x + p.x * c + p.z * s, pz = z - p.x * s + p.z * c;
      const y = mud.get(key(px, pz));
      if (y !== undefined) floor = Math.max(floor, y - p.y);
    }
  } else floor = bedAt(x, z) + draftOf(kind);
  // A centimetre keeps adjacent mesh samples and the grounded hull apart.
  if (Number.isFinite(floor)) floor += 0.01;
  if (floors.size >= 1024) floors.delete(floors.keys().next().value!);
  floors.set(k, floor);
  return floor;
}
