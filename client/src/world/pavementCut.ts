import * as THREE from "three";

// A real hole in the pavement (issue #28, the cellar home's light well: "interiors are real"). The kerb's top (a city
// chunk of city.glb, tools/blender/build_city.py build_kerbs) and the cobbles (world/city.ts ground_*) are one face
// each over many metres; where a light well opens under them, the triangles of their level faces over its mouth are cut
// away, once, when those meshes are in: every other triangle stays as it was. What is left of a cut triangle is kept
// whole (its uv, colour and the rest of its attributes as they were at those points), its winding too.
//
// The mouth is a rectangle in a frame of its own (a house's: origin, yaw, as shared/hallPlan.ts turns it), and only
// faces that look up, lying between y0 and y1 (world), are cut.

export interface PavementHole {
  label: string;
  origin: { x: number; z: number };
  yaw: number;
  /** The mouth in that frame. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** The levels cut (world y). */
  y0: number;
  y1: number;
}

type Poly = Array<[number, number, number]>; // barycentric weights on the triangle's three corners

/** Clip a convex polygon (weights) against a half-plane, given each weight's value of the plane's function (>= 0 kept). */
function clip(poly: Poly, f: (w: [number, number, number]) => number): Poly {
  const out: Poly = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/** Cut the hole into one mesh; returns how many triangles it cut. */
function cutMesh(mesh: THREE.Mesh, hole: PavementHole): number {
  const g = mesh.geometry;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  if (!pos) return 0;
  mesh.updateWorldMatrix(true, false);
  const M = mesh.matrixWorld;
  const c = Math.cos(hole.yaw);
  const s = Math.sin(hole.yaw);
  // world -> the hole's frame (hallPlan toLocal)
  const loc = (wx: number, wz: number): [number, number] => {
    const dx = wx - hole.origin.x;
    const dz = wz - hole.origin.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const idx = g.index;
  const nTri = (idx ? idx.count : pos.count) / 3;
  const vi = (t: number, k: number) => (idx ? idx.getX(t * 3 + k) : t * 3 + k);
  const w = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cut: Array<{ t: number; pieces: Poly[] }> = [];
  for (let t = 0; t < nTri; t++) {
    for (let k = 0; k < 3; k++) w[k].fromBufferAttribute(pos, vi(t, k)).applyMatrix4(M);
    if (Math.min(w[0].y, w[1].y, w[2].y) < hole.y0 || Math.max(w[0].y, w[1].y, w[2].y) > hole.y1) continue;
    const n = e1.subVectors(w[1], w[0]).cross(e2.subVectors(w[2], w[0]));
    if (n.y <= 0.9 * n.length()) continue;
    const L = w.map((p) => loc(p.x, p.z));
    if (Math.max(L[0][0], L[1][0], L[2][0]) <= hole.x0 || Math.min(L[0][0], L[1][0], L[2][0]) >= hole.x1) continue;
    if (Math.max(L[0][1], L[1][1], L[2][1]) <= hole.z0 || Math.min(L[0][1], L[1][1], L[2][1]) >= hole.z1) continue;
    // the local u, v of a weighted point
    const u = (q: [number, number, number]) => q[0] * L[0][0] + q[1] * L[1][0] + q[2] * L[2][0];
    const v = (q: [number, number, number]) => q[0] * L[0][1] + q[1] * L[1][1] + q[2] * L[2][1];
    const tri: Poly = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    // the four parts of the plane round the mouth: left of it, right of it, and between them before and behind it
    const pieces = [
      clip(tri, (q) => hole.x0 - u(q)),
      clip(tri, (q) => u(q) - hole.x1),
      clip(clip(clip(tri, (q) => u(q) - hole.x0), (q) => hole.x1 - u(q)), (q) => hole.z0 - v(q)),
      clip(clip(clip(tri, (q) => u(q) - hole.x0), (q) => hole.x1 - u(q)), (q) => v(q) - hole.z1),
    ].filter((p) => p.length >= 3);
    cut.push({ t, pieces });
  }
  if (!cut.length) return 0;
  // new vertices: every attribute weighted from the triangle's corners; the cut triangles emptied, the pieces added
  const names = Object.keys(g.attributes);
  const add: Array<{ t: number; w: [number, number, number] }> = [];
  const tris: number[] = [];
  const base = pos.count;
  for (const { t, pieces } of cut)
    for (const p of pieces) {
      const first = base + add.length;
      for (const q of p) add.push({ t, w: q });
      for (let k = 1; k + 1 < p.length; k++) tris.push(first, first + k, first + k + 1);
    }
  g.dispose();
  for (const name of names) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    const n = a.itemSize;
    const src = a as THREE.BufferAttribute;
    const Arr = (a as THREE.BufferAttribute).array?.constructor as { new (n: number): THREE.TypedArray } | undefined;
    const out = Arr && !(a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute ? new Arr((base + add.length) * n) : new Float32Array((base + add.length) * n);
    // (get and set work in the attribute's own terms: a normalized colour as 0..1 both ways; whole numbers rounded)
    const whole = !a.normalized && !(out instanceof Float32Array) && !(out instanceof Float64Array);
    const na = new THREE.BufferAttribute(out, n, a.normalized);
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
      for (let i = 0; i < base; i++) for (let k = 0; k < n; k++) na.setComponent(i, k, src.getComponent(i, k));
    } else out.set(src.array.subarray(0, base * n) as never);
    add.forEach(({ t, w: q }, j) => {
      for (let k = 0; k < n; k++) {
        let val = 0;
        for (let m = 0; m < 3; m++) val += q[m] * src.getComponent(vi(t, m), k);
        na.setComponent(base + j, k, whole ? Math.round(val) : val);
      }
    });
    g.setAttribute(name, na);
  }
  // the index: the cut triangles gone, the pieces added
  const gone = new Set(cut.map((q) => q.t));
  const index: number[] = [];
  for (let t = 0; t < nTri; t++) if (!gone.has(t)) index.push(vi(t, 0), vi(t, 1), vi(t, 2));
  index.push(...tris);
  g.setIndex(index);
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return cut.length;
}

/**
 * Cut the hole into the pavement and the cobbles under it as soon as they are in the scene (the city's chunks load late):
 * the meshes named city_* (not the near-only details) and ground_* whose box reaches over the mouth. Tries again every
 * second until both kinds have been found (at most two minutes); `done(n)` gets the triangles cut.
 */
export function cutPavement(scene: THREE.Scene, hole: PavementHole, done?: (n: number) => void): void {
  const c = Math.cos(hole.yaw);
  const s = Math.sin(hole.yaw);
  const world = (x: number, z: number) => new THREE.Vector3(hole.origin.x + x * c + z * s, 0, hole.origin.z - x * s + z * c);
  const mouth = new THREE.Box3();
  for (const [x, z] of [[hole.x0, hole.z0], [hole.x1, hole.z0], [hole.x1, hole.z1], [hole.x0, hole.z1]]) mouth.expandByPoint(world(x, z));
  mouth.min.y = hole.y0;
  mouth.max.y = hole.y1;
  const doneMeshes = new Set<THREE.Mesh>();
  let city = false;
  let ground = false;
  let total = 0;
  let tries = 0;
  const bb = new THREE.Box3();
  const attempt = () => {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || doneMeshes.has(m) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
      const isCity = /^city_/.test(m.name) && !m.userData.near;
      const isGround = /^ground_/.test(m.name);
      if (!isCity && !isGround) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      m.updateWorldMatrix(true, false);
      bb.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld);
      if (!bb.intersectsBox(mouth)) return;
      doneMeshes.add(m);
      const n = cutMesh(m, hole);
      total += n;
      if (n && isCity) city = true;
      if (n && isGround) ground = true;
    });
    if ((!city || !ground) && ++tries < 120) setTimeout(attempt, 1000);
    else {
      if (!city || !ground) console.warn(`[pavementCut] ${hole.label}: ${city ? "" : "no pavement"} ${ground ? "" : "no cobbles"} found over the mouth`);
      done?.(total);
    }
  };
  attempt();
}
