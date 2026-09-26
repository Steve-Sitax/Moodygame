import * as THREE from "three";

/** Re-map UVs from local positions so textures tile per metre, not per face. */
export function worldUV(geo: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = geo.getAttribute("position");
  const nor = geo.getAttribute("normal");
  const uv = geo.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ax = Math.abs(nor.getX(i));
    const ay = Math.abs(nor.getY(i));
    const az = Math.abs(nor.getZ(i));
    if (ay >= ax && ay >= az) uv.setXY(i, x / tile, z / tile);
    else if (ax >= az) uv.setXY(i, z / tile, y / tile);
    else uv.setXY(i, x / tile, y / tile);
  }
  uv.needsUpdate = true;
  return geo;
}

/** Box with ~2 m segments (less affine swim) and per-metre UVs. */
export function boxGeo(w: number, h: number, d: number, tile = 2): THREE.BufferGeometry {
  const seg = (v: number) => Math.max(1, Math.ceil(v / 2));
  return worldUV(new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d)), tile);
}

export function box(
  w: number,
  h: number,
  d: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  tile = 2,
): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo(w, h, d, tile), mat);
  m.position.set(x, y, z);
  return m;
}

export function cyl(
  rTop: number,
  rBot: number,
  h: number,
  sides: number,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, sides, Math.max(1, Math.ceil(h / 2))), mat);
  m.position.set(x, y, z);
  return m;
}

/** A thin rod between two points (rigging, ropes, tie bars). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 4, 1), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  return m;
}

/** Axis-aligned box on the ground plane, for collision. */
export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** Height of its top. Missing = a wall you cannot climb. */
  top?: number;
  /** Narrow phase from the visible model; bounds remain useful for placement and the spatial grid. */
  surface?: {
    blocks(x: number, z: number, radius: number, feet: number, step: number): boolean;
    topAt(x: number, z: number, radius: number, ceiling: number): number;
  };
}

export function rectAround(x: number, z: number, hw: number, hd: number, top?: number): Rect {
  return { minX: x - hw, maxX: x + hw, minZ: z - hd, maxZ: z + hd, top };
}

export function inRect(r: Rect, x: number, z: number, pad = 0): boolean {
  return x > r.minX - pad && x < r.maxX + pad && z > r.minZ - pad && z < r.maxZ + pad;
}
