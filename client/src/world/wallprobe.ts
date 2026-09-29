import * as THREE from "three";

// A quick look at the real house geometry (city.glb, the landmarks): how far a short level ray
// runs before it meets a wall. Street life asks it before it pastes a sign on a wall (is the wall
// really there, flat, with nothing standing out in front: a gateway arch, a loading door, the next
// house?), and the dev sign check (dev/signcheck.ts) uses it to test every sign in the city.
// The triangles go once into a 2 m grid on the ground; a ray of a metre or so tests a few cells.

export type WallProbe = (x: number, y: number, z: number, dx: number, dz: number, maxD: number) => number | null;

const CELL = 2;

export function buildWallProbe(roots: THREE.Object3D | THREE.Object3D[]): WallProbe {
  const rootList = Array.isArray(roots) ? roots : [roots];
  for (const r of rootList) r.updateMatrixWorld(true);
  const tris: number[] = [];
  const v = new THREE.Vector3();
  for (const root of rootList) root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const g = m.geometry;
    const P = g.getAttribute("position");
    if (!P) return;
    const idx = g.index;
    const n = idx ? idx.count : P.count;
    const M = m.matrixWorld;
    const pts: number[] = new Array(9);
    for (let i = 0; i + 2 < n; i += 3) {
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        v.fromBufferAttribute(P, j).applyMatrix4(M);
        pts[k * 3] = v.x;
        pts[k * 3 + 1] = v.y;
        pts[k * 3 + 2] = v.z;
      }
      // level faces (ground, floors, roof tops) never stop a level ray: leave them out
      const ax = pts[3] - pts[0], ay = pts[4] - pts[1], az = pts[5] - pts[2];
      const bx = pts[6] - pts[0], by = pts[7] - pts[1], bz = pts[8] - pts[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9 || Math.abs(ny) / l > 0.97) continue;
      tris.push(...pts);
    }
  });
  const T = new Float32Array(tris);
  const nT = T.length / 9;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < T.length; i += 3) {
    minX = Math.min(minX, T[i]);
    maxX = Math.max(maxX, T[i]);
    minZ = Math.min(minZ, T[i + 2]);
    maxZ = Math.max(maxZ, T[i + 2]);
  }
  if (!nT) return () => null;
  const gw = Math.floor((maxX - minX) / CELL) + 1;
  const gh = Math.floor((maxZ - minZ) / CELL) + 1;
  const range = (t: number): [number, number, number, number] => {
    const o = t * 9;
    const x0 = Math.min(T[o], T[o + 3], T[o + 6]), x1 = Math.max(T[o], T[o + 3], T[o + 6]);
    const z0 = Math.min(T[o + 2], T[o + 5], T[o + 8]), z1 = Math.max(T[o + 2], T[o + 5], T[o + 8]);
    return [Math.floor((x0 - minX) / CELL), Math.floor((x1 - minX) / CELL), Math.floor((z0 - minZ) / CELL), Math.floor((z1 - minZ) / CELL)];
  };
  const count = new Uint32Array(gw * gh + 1);
  for (let t = 0; t < nT; t++) {
    const [c0, c1, r0, r1] = range(t);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) count[r * gw + c + 1]++;
  }
  for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
  const fill = count.slice(0, gw * gh);
  const list = new Uint32Array(count[gw * gh]);
  for (let t = 0; t < nT; t++) {
    const [c0, c1, r0, r1] = range(t);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) list[fill[r * gw + c]++] = t;
  }

  /** Möller-Trumbore, level ray: distance to triangle t, or Infinity. */
  const hit = (t: number, x: number, y: number, z: number, dx: number, dz: number): number => {
    const o = t * 9;
    const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
    const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
    // p = d x e2 (d = (dx, 0, dz))
    const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) return Infinity;
    const inv = 1 / det;
    const sx = x - T[o], sy = y - T[o + 1], sz = z - T[o + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) return Infinity;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const w = (dx * qx + dz * qz) * inv;
    if (w < 0 || u + w > 1) return Infinity;
    const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
    return d >= 0 ? d : Infinity;
  };

  let stamp = 1;
  const seen = new Uint32Array(nT);
  return (x, y, z, dx, dz, maxD) => {
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const ex = x + dx * maxD, ez = z + dz * maxD;
    const c0 = Math.max(0, Math.floor((Math.min(x, ex) - minX) / CELL)), c1 = Math.min(gw - 1, Math.floor((Math.max(x, ex) - minX) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(z, ez) - minZ) / CELL)), r1 = Math.min(gh - 1, Math.floor((Math.max(z, ez) - minZ) / CELL));
    let best = Infinity;
    stamp++;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * gw + c;
        for (let i = count[k]; i < count[k + 1]; i++) {
          const t = list[i];
          if (seen[t] === stamp) continue;
          seen[t] = stamp;
          const d = hit(t, x, y, z, dx, dz);
          if (d < best) best = d;
        }
      }
    }
    return best <= maxD ? best : null;
  };
}

// ------------------------------------------------------------------ things on walls

/**
 * A thing on a wall as a box standing on the ground plan: centre (cx, y, cz), u along the wall,
 * n out of it (unit), half sizes hu along and hn out, from y0 to y1. `flat`: a sign, a plate or a
 * bill that must lie flat on its wall (the others, brackets, awnings, Madonnas, stand out of it).
 */
export interface WallBox {
  kind: string;
  name: string;
  flat: boolean;
  cx: number;
  cz: number;
  ux: number;
  uz: number;
  nx: number;
  nz: number;
  hu: number;
  hn: number;
  y0: number;
  y1: number;
}

/** Local bounds [x0, y0, z0, x1, y1, z1] of a model whose front looks along +z, placed at (x, y, z) turned by yaw, stretched sx along x and sy up. */
export function wallBox(kind: string, name: string, flat: boolean, b: number[], x: number, y: number, z: number, yaw: number, sx = 1, sy = 1): WallBox {
  const ux = Math.cos(yaw), uz = -Math.sin(yaw);
  const nx = Math.sin(yaw), nz = Math.cos(yaw);
  const lx = ((b[0] + b[3]) / 2) * sx;
  const lz = (b[2] + b[5]) / 2;
  return {
    kind, name, flat,
    cx: x + lx * ux + lz * nx,
    cz: z + lx * uz + lz * nz,
    ux, uz, nx, nz,
    hu: (Math.abs(b[3] - b[0]) / 2) * Math.abs(sx),
    hn: Math.abs(b[5] - b[2]) / 2,
    y0: y + b[1] * sy,
    y1: y + b[4] * sy,
  };
}

/** Do two wall things overlap (pad: how far they may touch before it counts)? */
export function boxesOverlap(a: WallBox, b: WallBox, pad = 0.01): boolean {
  if (a.y0 >= b.y1 - pad || b.y0 >= a.y1 - pad) return false;
  const dx = b.cx - a.cx, dz = b.cz - a.cz;
  for (const [kx, kz] of [[a.ux, a.uz], [a.nx, a.nz], [b.ux, b.uz], [b.nx, b.nz]]) {
    const ra = a.hu * Math.abs(a.ux * kx + a.uz * kz) + a.hn * Math.abs(a.nx * kx + a.nz * kz);
    const rb = b.hu * Math.abs(b.ux * kx + b.uz * kz) + b.hn * Math.abs(b.nx * kx + b.nz * kz);
    if (Math.abs(dx * kx + dz * kz) >= ra + rb - pad) return false;
  }
  return true;
}

/** How far past the ends of a flat sign its wall must go on (from a corner, a gateway, the next house). */
export const SIGN_MARGIN = 0.12;

/**
 * Is a flat sign flat on a real wall? Level rays from half a metre out, at its corners, middle and
 * edges and a margin past its ends, must meet the wall right behind its back. Returns what is
 * wrong, or null.
 */
export function signOnWall(b: WallBox, probe: WallProbe): string | null {
  const bx = b.cx - b.nx * b.hn, bz = b.cz - b.nz * b.hn; // the middle of its back
  const ny = Math.max(2, Math.ceil((b.y1 - b.y0) / 0.25));
  const ys: number[] = [];
  for (let i = 0; i <= ny; i++) ys.push(b.y0 + 0.03 + ((b.y1 - b.y0 - 0.06) * i) / ny);
  // every 0.2 m or closer (a door's jamb is 0.2 m wide), and a margin past each end
  const n = Math.max(2, Math.ceil((2 * b.hu) / 0.2));
  const along = [-b.hu - SIGN_MARGIN, b.hu + SIGN_MARGIN];
  for (let i = 0; i <= n; i++) along.push(-b.hu + 0.01 + ((2 * b.hu - 0.02) * i) / n);
  for (const s of along) {
    for (const y of ys) {
      const x = bx + b.ux * s + b.nx * 0.5, z = bz + b.uz * s + b.nz * 0.5;
      const d = probe(x, y, z, -b.nx, -b.nz, 1.2);
      const where = Math.abs(s) > b.hu ? "past its end" : "behind it";
      if (d === null) return `no wall ${where} (${s.toFixed(2)} m along, ${y.toFixed(2)} m up)`;
      const gap = d - 0.5;
      if (gap > 0.035) return `off the wall ${where} by ${gap.toFixed(2)} m (${s.toFixed(2)} m along, ${y.toFixed(2)} m up)`;
      if (gap < -0.02) return `something stands out of the wall ${where} (${(-gap).toFixed(2)} m, ${s.toFixed(2)} m along, ${y.toFixed(2)} m up)`;
    }
  }
  return null;
}

/** The groups of the scene that are buildings as built: the houses and landmarks (city.glb), the churches, the prison, the Steen, the Vleeshuis, the town hall, the cathedral, the town wall. */
export const BUILDING_GROUPS = ["city", "churches", "prison", "steen", "vleeshuis", "stadhuis", "cathedral_outside", "town_wall"];

/** The building groups in the scene now (and the alleys' back walls, world/clutter.ts, once they are built). */
export function buildingRoots(scene: THREE.Object3D): THREE.Object3D[] {
  const roots = scene.children.filter((c) => BUILDING_GROUPS.includes(c.name));
  scene.traverse((o) => {
    if (o.name === "clutter_backwalls" || o.name === "clutter_backwalls_dark") roots.push(o);
  });
  return roots;
}

/**
 * Where the kerb before a street wall ends, as built (city.glb: 0.7 m of stone slabs, 0.12 m high, along the
 * street fronts, none on a yard's or a gang's wall nor through a covered passage): metres out from the point
 * (x, z) on the wall's plan line, along its outward normal (ox, oz); null where no kerb is built. A level ray
 * at 6 cm, in from the street, meets the kerb's front face.
 */
export function kerbFront(probe: WallProbe, x: number, z: number, ox: number, oz: number): number | null {
  const d = probe(x + ox * 1.4, 0.06, z + oz * 1.4, -ox, -oz, 1.5);
  if (d === null) return null;
  const out = 1.4 - d;
  return out > 0.3 && out < 1.2 ? out : null;
}

/**
 * The ground as built under a point: the highest level face (the street, a kerb, a step, a quay's top,
 * a square's plinth) at or under `yTop`, from the same buildings and the town's ground (city.glb).
 * Only faces within 2.5 m of the street are kept. Null: no face there.
 */
export type GroundProbe = (x: number, z: number, yTop: number) => number | null;
export function buildGroundProbe(roots: THREE.Object3D[], maxHeight=2.5): GroundProbe {
  const tris: number[] = [];
  const v = new THREE.Vector3();
  const p: number[] = new Array(9);
  for (const root of roots) {
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry || !m.visible && m.name.startsWith("landmark_")) return;
      const P = m.geometry.getAttribute("position");
      if (!P) return;
      const idx = m.geometry.index;
      const n = idx ? idx.count : P.count;
      for (let i = 0; i + 2 < n; i += 3) {
        let low = Infinity;
        for (let k = 0; k < 3; k++) {
          v.fromBufferAttribute(P, idx ? idx.getX(i + k) : i + k).applyMatrix4(m.matrixWorld);
          p[k * 3] = v.x;
          p[k * 3 + 1] = v.y;
          p[k * 3 + 2] = v.z;
          low = Math.min(low, v.y);
        }
        if (low > maxHeight || low < -1.5) continue;
        const ax = p[3] - p[0], ay = p[4] - p[1], az = p[5] - p[2];
        const bx = p[6] - p[0], by = p[7] - p[1], bz = p[8] - p[2];
        const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-9 || Math.abs(ny) / l < 0.7) continue;
        tris.push(...p);
      }
    });
  }
  const G = 2;
  const grid = new Map<string, number[]>();
  for (let t = 0; t < tris.length / 9; t++) {
    const o = t * 9;
    const x0 = Math.floor(Math.min(tris[o], tris[o + 3], tris[o + 6]) / G), x1 = Math.floor(Math.max(tris[o], tris[o + 3], tris[o + 6]) / G);
    const z0 = Math.floor(Math.min(tris[o + 2], tris[o + 5], tris[o + 8]) / G), z1 = Math.floor(Math.max(tris[o + 2], tris[o + 5], tris[o + 8]) / G);
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > 4000) {
      // a big face of the ground: in a list of its own, tested everywhere
      const k = "big";
      let l = grid.get(k);
      if (!l) grid.set(k, (l = []));
      l.push(t);
      continue;
    }
    for (let i = x0; i <= x1; i++) {
      for (let j = z0; j <= z1; j++) {
        const k = `${i},${j}`;
        let l = grid.get(k);
        if (!l) grid.set(k, (l = []));
        l.push(t);
      }
    }
  }
  const probe: GroundProbe = (x, z, yTop) => {
    let best: number | null = null;
    for (const t of [...(grid.get(`${Math.floor(x / G)},${Math.floor(z / G)}`) ?? []), ...(grid.get("big") ?? [])]) {
      const o = t * 9;
      const x0 = tris[o], z0 = tris[o + 2], x1 = tris[o + 3], z1 = tris[o + 5], x2 = tris[o + 6], z2 = tris[o + 8];
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-12) continue;
      const a = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
      const b = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      const c = 1 - a - b;
      // (1 cm over an edge still counts: two kerb slabs or two faces of the ground that meet leave a seam
      // no point falls in, and the face under them both showed through)
      const ad = Math.abs(d);
      if (a < (-0.01 * Math.hypot(x1 - x2, z1 - z2)) / ad || b < (-0.01 * Math.hypot(x2 - x0, z2 - z0)) / ad || c < (-0.01 * Math.hypot(x0 - x1, z0 - z1)) / ad) continue;
      const y = a * tris[o + 1] + b * tris[o + 4] + c * tris[o + 7];
      if (y <= yTop + 1e-4 && (best === null || y > best)) best = y;
    }
    return best;
  };
  return probe;
}
