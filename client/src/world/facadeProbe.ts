import * as THREE from "three";

// What is painted on a house wall at a point (M7 posters, 2026-09-26): a level ray against the house fronts
// as built (city.glb, the facade atlas material), and the atlas texel it meets. The facade atlas
// (world/cityTextures.ts facadeAtlas) marks the plain wall's texels with alpha 0.5; the painted windows,
// sashes, shop windows, doors, lintels, sills and plinths are opaque. So a bill can be kept off a painted
// window that no plan lists (a back wall on a yard, an alley cottage), and the poster check can prove it.
// The facade triangles go once into a 2 m grid on the ground, as world/wallprobe.ts does.

export interface FacadeHit {
  /** How far the ray ran. */
  d: number;
  /** The texel's alpha there (0..255): 128 plain wall, 255 paint. */
  alpha: number;
}

export type FacadeProbe = (x: number, y: number, z: number, dx: number, dz: number, maxD: number) => FacadeHit | null;

const CELL = 2;

/** The facade atlas's pixels, if a material's map is one (a canvas with the plain wall's alpha 0.5). */
function atlasOf(mat: THREE.Material): { data: Uint8ClampedArray; w: number; h: number; n: number } | null {
  const map = (mat as THREE.MeshLambertMaterial).map;
  const img = map?.image as HTMLCanvasElement | undefined;
  if (!img || typeof (img as HTMLCanvasElement).getContext !== "function") return null;
  const g = img.getContext("2d", { willReadFrequently: true });
  if (!g) return null;
  const data = g.getImageData(0, 0, img.width, img.height).data;
  let half = 0;
  for (let i = 3; i < data.length; i += 4 * 7) if (data[i] === 128) half++;
  if (half < 100) return null;
  return { data, w: img.width, h: img.height, n: 8 };
}

export function buildFacadeProbe(root: THREE.Object3D): FacadeProbe | null {
  root.updateMatrixWorld(true);
  const pos: number[] = [];
  const uvs: number[] = [];
  const cells: number[] = [];
  let atlas: ReturnType<typeof atlasOf> = null;
  const seenMat = new Map<THREE.Material, boolean>();
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry || Array.isArray(m.material)) return;
    const g = m.geometry;
    const P = g.getAttribute("position");
    const U = g.getAttribute("uv");
    const Cc = g.getAttribute("cell");
    if (!P || !U || !Cc) return;
    let ok = seenMat.get(m.material);
    if (ok === undefined) {
      const a = atlasOf(m.material);
      ok = !!a;
      if (a && !atlas) atlas = a;
      seenMat.set(m.material, ok);
    }
    if (!ok) return;
    const idx = g.index;
    const n = idx ? idx.count : P.count;
    const M = m.matrixWorld;
    for (let i = 0; i + 2 < n; i += 3) {
      const tri: number[] = [];
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        v.fromBufferAttribute(P, j).applyMatrix4(M);
        tri.push(v.x, v.y, v.z);
      }
      // level faces never meet a level ray
      const ax = tri[3] - tri[0], ay = tri[4] - tri[1], az = tri[5] - tri[2];
      const bx = tri[6] - tri[0], by = tri[7] - tri[1], bz = tri[8] - tri[2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      const l = Math.hypot(nx, ny, nz);
      if (l < 1e-9 || Math.abs(ny) / l > 0.97) continue;
      pos.push(...tri);
      for (let k = 0; k < 3; k++) {
        const j = idx ? idx.getX(i + k) : i + k;
        uvs.push(U.getX(j), U.getY(j));
      }
      const j0 = idx ? idx.getX(i) : i;
      cells.push(Cc.getX(j0), Cc.getY(j0));
    }
  });
  const A = atlas as ReturnType<typeof atlasOf>;
  if (!A || !pos.length) return null;
  const T = new Float32Array(pos);
  const nT = T.length / 9;
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < T.length; i += 3) {
    minX = Math.min(minX, T[i]);
    maxX = Math.max(maxX, T[i]);
    minZ = Math.min(minZ, T[i + 2]);
    maxZ = Math.max(maxZ, T[i + 2]);
  }
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
  const UV = new Float32Array(uvs);
  const CE = new Float32Array(cells);

  let stamp = 1;
  const seen = new Uint32Array(nT);
  return (x, y, z, dx, dz, maxD) => {
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    const ex = x + dx * maxD, ez = z + dz * maxD;
    const c0 = Math.max(0, Math.floor((Math.min(x, ex) - minX) / CELL)), c1 = Math.min(gw - 1, Math.floor((Math.max(x, ex) - minX) / CELL));
    const r0 = Math.max(0, Math.floor((Math.min(z, ez) - minZ) / CELL)), r1 = Math.min(gh - 1, Math.floor((Math.max(z, ez) - minZ) / CELL));
    let best = Infinity, bt = -1, bu = 0, bw = 0;
    stamp++;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = r * gw + c;
        for (let i = count[k]; i < count[k + 1]; i++) {
          const t = list[i];
          if (seen[t] === stamp) continue;
          seen[t] = stamp;
          // Möller-Trumbore, level ray
          const o = t * 9;
          const e1x = T[o + 3] - T[o], e1y = T[o + 4] - T[o + 1], e1z = T[o + 5] - T[o + 2];
          const e2x = T[o + 6] - T[o], e2y = T[o + 7] - T[o + 1], e2z = T[o + 8] - T[o + 2];
          const px = -dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y;
          const det = e1x * px + e1y * py + e1z * pz;
          if (Math.abs(det) < 1e-12) continue;
          const inv = 1 / det;
          const sx = x - T[o], sy = y - T[o + 1], sz = z - T[o + 2];
          const u = (sx * px + sy * py + sz * pz) * inv;
          if (u < 0 || u > 1) continue;
          const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
          const w = (dx * qx + dz * qz) * inv;
          if (w < 0 || u + w > 1) continue;
          const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
          if (d >= 0 && d < best) {
            best = d;
            bt = t;
            bu = u;
            bw = w;
          }
        }
      }
    }
    if (bt < 0 || best > maxD) return null;
    // the uv there, into the atlas as the psx shader does: (cell + fract(uv)) / 8, the canvas upside down
    const o = bt * 6;
    const uu = UV[o] * (1 - bu - bw) + UV[o + 2] * bu + UV[o + 4] * bw;
    const vv = UV[o + 1] * (1 - bu - bw) + UV[o + 3] * bu + UV[o + 5] * bw;
    const fu = uu - Math.floor(uu), fv = vv - Math.floor(vv);
    const au = (CE[bt * 2] + fu) / A.n;
    const av = (CE[bt * 2 + 1] + fv) / A.n;
    const px = Math.min(A.w - 1, Math.max(0, Math.floor(au * A.w)));
    const py = Math.min(A.h - 1, Math.max(0, Math.floor((1 - av) * A.h)));
    return { d: best, alpha: A.data[(py * A.w + px) * 4 + 3] };
  };
}

/** How many points of a flat thing (centre cx, cz; along u; out n; y0..y1; half width hu) meet paint, of how many that met a facade. */
export function paintUnder(probe: FacadeProbe, b: { cx: number; cz: number; ux: number; uz: number; nx: number; nz: number; hn: number; hu: number; y0: number; y1: number }, margin = 0.04, step = 0.08): { painted: number; hits: number; of: number } {
  const bx = b.cx - b.nx * b.hn, bz = b.cz - b.nz * b.hn;
  const nu = Math.max(3, Math.ceil((2 * (b.hu + margin)) / step));
  const nv = Math.max(3, Math.ceil((b.y1 - b.y0 + 2 * margin) / step));
  let painted = 0, hits = 0, of = 0;
  for (let i = 0; i <= nu; i++) {
    const s = -b.hu - margin + ((2 * (b.hu + margin)) * i) / nu;
    for (let j = 0; j <= nv; j++) {
      const y = b.y0 - margin + ((b.y1 - b.y0 + 2 * margin) * j) / nv;
      of++;
      const h = probe(bx + b.ux * s + b.nx * 0.4, y, bz + b.uz * s + b.nz * 0.4, -b.nx, -b.nz, 0.8);
      if (!h) continue;
      hits++;
      if (h.alpha > 200) painted++;
    }
  }
  return { painted, hits, of };
}
