import * as THREE from "three";
import { psx } from "../retro/psx";
import { CANAL_BED, TOE_TOP, regionAt } from "./tide";

// M6 tides: the mud the ebb lays bare. Along the foot of every river and canal wall a bank of grey
// mud slopes away under the water (world/tide.ts TOE_TOP), so at low water a strip of wet mud shows
// under the slimy stone; the beds of the canal and the vliet lie at CANAL_BED and come bare at low
// spring tides, with the boats in them sitting on the mud. One merged mesh, built once: it never moves
// (the water does). Hidden under the water for most of the tide.

/** How far out from the wall the bank runs, and how far it falls over that distance. */
const TOE_OUT = 3.6;
const TOE_DROP = 1.4;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small grey-brown mud picture with wet glints: 32 px, nearest filter. */
function mudTexture(): THREE.DataTexture {
  const n = 32;
  const d = new Uint8Array(n * n * 4);
  const r = rng(73);
  for (let i = 0; i < n * n; i++) {
    const v = 62 + Math.floor(r() * 26);
    const wet = r() < 0.05 ? 34 : 0;
    d[i * 4] = v + wet;
    d[i * 4 + 1] = v - 4 + wet;
    d[i * 4 + 2] = v - 12 + wet;
    d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export interface MudOptions {
  /** Quay wall lines [x0, z0, x1, z1] (shared/city.json quays). */
  quays: number[][];
  /** Inside the water polygons? (to find the water side of a wall) */
  inWater(x: number, z: number): boolean;
  /** The canal and the vliet beds: rectangles on the ground plan. */
  beds: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }>;
}

export function buildTideMud(scene: THREE.Object3D, o: MudOptions): THREE.Mesh {
  const pos: number[] = [];
  const col: number[] = [];
  const uv: number[] = [];
  const r = rng(1873);
  const vert = (x: number, y: number, z: number, k: number) => {
    pos.push(x, y, z);
    col.push(k, k * 0.98, k * 0.94);
    uv.push(x / 3, z / 3);
  };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    // two triangles facing up (a, b, c, d round the edge, either way)
    const ux = b[0] - a[0];
    const uz = b[2] - a[2];
    const vx = d[0] - a[0];
    const vz = d[2] - a[2];
    const up = uz * vx - ux * vz > 0;
    const tri = up ? [a, b, c, a, c, d] : [a, d, c, a, c, b];
    for (const p of tri) vert(p[0], p[1], p[2], p[3]);
  };
  // the bank at the foot of each wall (not in the Petit Bassin: its water never goes down)
  for (const [ax, az, bx, bz] of o.quays) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1) continue;
    if (regionAt((ax + bx) / 2, (az + bz) / 2) === 1) continue;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const [nx, nz] = o.inWater(mx - tz, mz + tx) ? [-tz, tx] : [tz, -tx];
    const n = Math.max(1, Math.ceil(L / 4));
    const lump = Array.from({ length: n + 1 }, () => (r() - 0.5) * 0.3);
    const tone = Array.from({ length: n + 1 }, () => 0.8 + r() * 0.35);
    for (let i = 0; i < n; i++) {
      const s0 = (L * i) / n;
      const s1 = (L * (i + 1)) / n;
      const P = (s: number, u: number, y: number, k: number) => [ax + tx * s + nx * u, y, az + tz * s + nz * u, k];
      // against the wall (a hand out, so it never fights the wall face), then out and down
      quad(
        P(s0, 0.02, TOE_TOP + lump[i] * 0.4, tone[i]),
        P(s1, 0.02, TOE_TOP + lump[i + 1] * 0.4, tone[i + 1]),
        P(s1, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i + 1], tone[i + 1] * 0.9),
        P(s0, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i], tone[i] * 0.9),
      );
      quad(
        P(s0, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i], tone[i] * 0.9),
        P(s1, TOE_OUT * 0.45, TOE_TOP - TOE_DROP * 0.35 + lump[i + 1], tone[i + 1] * 0.9),
        P(s1, TOE_OUT, TOE_TOP - TOE_DROP, 0.7),
        P(s0, TOE_OUT, TOE_TOP - TOE_DROP, 0.7),
      );
    }
  }
  // the canal and vliet beds: soft, a little lower down the middle, in 4 m cells
  for (const b of o.beds) {
    const nxs = Math.max(1, Math.ceil((b.maxX - b.minX) / 4));
    const nzs = Math.max(1, Math.ceil((b.maxZ - b.minZ) / 4));
    const h = (i: number) => {
      const edge = i === 0 || i === nxs ? 0.12 : 0;
      return CANAL_BED + edge - (r() * 0.12);
    };
    const hs: number[][] = [];
    for (let j = 0; j <= nzs; j++) {
      hs.push([]);
      for (let i = 0; i <= nxs; i++) hs[j].push(h(i));
    }
    for (let j = 0; j < nzs; j++)
      for (let i = 0; i < nxs; i++) {
        const X = (k: number) => b.minX + ((b.maxX - b.minX) * k) / nxs;
        const Z = (k: number) => b.minZ + ((b.maxZ - b.minZ) * k) / nzs;
        const k = 0.75 + r() * 0.3;
        quad([X(i), hs[j][i], Z(j), k], [X(i + 1), hs[j][i + 1], Z(j), k], [X(i + 1), hs[j + 1][i + 1], Z(j + 1), k], [X(i), hs[j + 1][i], Z(j + 1), k]);
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = psx(new THREE.MeshPhongMaterial({ map: mudTexture(), vertexColors: true, color: 0xb8b0a4, specular: 0x2a2a26, shininess: 30 }), { affine: 0.3 });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = "tide_mud";
  scene.add(mesh);
  return mesh;
}
