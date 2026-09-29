import * as THREE from "three";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";

// Climbers on the town wall (2026-09-30, the park look pass; Steve: "also make park look even better"). The wall's
// inner face ran bare brick for a kilometre: along the Stadspark and the streets behind it. Old town walls carried
// ivy, and the Virginia creeper the parks had just brought in, red in October. Patches of both hang on the inner face
// here: flat cards 4 cm off the brick, rooted at the foot, ragged at the top, never over a stair, a gate or a tower.
// One material (the same program as the wall's fallen-leaf patches: an alpha-tested lambert), one mesh per 100 m of
// wall, hidden beyond the fog.

type P = [number, number];
interface Rampart {
  h: number;
  inner_line: P[];
  stairs?: Array<{ a: P; b: P }>;
  gates?: Array<{ house: P[] }>;
  towers?: Array<{ rect: P[] }>;
}
const R = (CITY as unknown as { decor?: { rampart?: Rampart } }).decor?.rampart;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Four climbers side by side (128 x 256 px each): dark ivy, a lighter ivy, the creeper in red, in orange and red. */
function atlas(): THREE.CanvasTexture {
  const W = 128;
  const H = 256;
  const c = document.createElement("canvas");
  c.width = W * 4;
  c.height = H;
  const g = c.getContext("2d")!;
  const kinds: Array<{ leaf: string[]; size: number; stem: string }> = [
    { leaf: ["#243a1c", "#2d4722", "#1c3016", "#35502a"], size: 3.2, stem: "#3a3226" },
    { leaf: ["#35532a", "#436634", "#2c4722", "#556f3a"], size: 3.2, stem: "#3a3226" },
    { leaf: ["#8a1c12", "#a42a16", "#6e1810", "#b8401c", "#5a2a14"], size: 3.8, stem: "#4a3424" },
    { leaf: ["#b8501c", "#c86a22", "#9a2c14", "#7a3a18", "#d4822a"], size: 3.8, stem: "#4a3424" },
  ];
  kinds.forEach((k, ci) => {
    const r = rng(1873 + ci * 17);
    const x0 = ci * W;
    // the stems: from the foot, up and out, forking; the leaves along them, thick at the foot, few at the top
    const tips: Array<[number, number, number]> = [];
    for (let s = 0; s < 5; s++) tips.push([x0 + W * (0.3 + r() * 0.4), H - 1, -Math.PI / 2 + (r() - 0.5) * 1.1]);
    const leaves: Array<[number, number]> = [];
    while (tips.length) {
      const [sx, sy, a0] = tips.pop()!;
      let x = sx;
      let y = sy;
      let a = a0;
      const len = 40 + r() * (H * 0.85);
      g.strokeStyle = k.stem;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      for (let d = 0; d < len && y > 4; d += 3) {
        a += (r() - 0.5) * 0.35;
        a = Math.max(-Math.PI + 0.35, Math.min(-0.35, a));
        x = Math.max(x0 + W * 0.14, Math.min(x0 + W * 0.86, x + Math.cos(a) * 3));
        y += Math.sin(a) * 3;
        g.lineTo(x, y);
        const up = 1 - y / H; // 0 at the foot, 1 at the top
        // (2026-09-30, the first look: a solid green block) thinner, so the brick shows between the sprays
        if (r() < 0.62 - up * 0.45) leaves.push([x + (r() - 0.5) * 10, y + (r() - 0.5) * 8]);
        if (r() < 0.03 && tips.length < 16) tips.push([x, y, a + (r() < 0.5 ? -0.7 : 0.7)]);
      }
      g.stroke();
    }
    for (const [x, y] of leaves) {
      const n = 1 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const lx = x + (r() - 0.5) * 6;
        if (lx < x0 + 2 || lx > x0 + W - 2) continue;
        const ly = y + (r() - 0.5) * 5;
        const s = k.size * (0.7 + r() * 0.6);
        g.fillStyle = k.leaf[Math.floor(r() * k.leaf.length)];
        g.beginPath();
        // a leaf: three points round a middle (ivy's lobes, the creeper's leaflets), a pixel or two across
        const ra = r() * Math.PI;
        for (let q = 0; q < 5; q++) {
          const aa = ra + (q / 5) * Math.PI * 2;
          const rr = q % 2 ? s * 0.55 : s;
          const px = lx + Math.cos(aa) * rr;
          const py = ly + Math.sin(aa) * rr;
          if (q) g.lineTo(px, py);
          else g.moveTo(px, py);
        }
        g.closePath();
        g.fill();
      }
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

export interface WallClimbers {
  update(camera: THREE.Camera, far: number): void;
  info(): { patches: number; meshes: number };
}

export function buildWallClimbers(scene: THREE.Scene): WallClimbers {
  const none = { update() {}, info: () => ({ patches: 0, meshes: 0 }) };
  if (!R || R.inner_line.length < 2) return none;
  const line = R.inner_line;
  // the town's middle: the inner face looks toward it
  const mid: P = [line.reduce((a, p) => a + p[0], 0) / line.length, line.reduce((a, p) => a + p[1], 0) / line.length - 150];
  const keepOut: Array<[number, number, number]> = [];
  for (const s of R.stairs ?? []) {
    keepOut.push([s.a[0], s.a[1], 4], [s.b[0], s.b[1], 4], [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, 4]);
  }
  for (const g of R.gates ?? []) keepOut.push([g.house.reduce((a, p) => a + p[0], 0) / g.house.length, g.house.reduce((a, p) => a + p[1], 0) / g.house.length, 9]);
  for (const t of R.towers ?? []) keepOut.push([t.rect.reduce((a, p) => a + p[0], 0) / t.rect.length, t.rect.reduce((a, p) => a + p[1], 0) / t.rect.length, 5]);
  const free = (x: number, z: number, half: number) => !keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr + half);

  const mat = psx(new THREE.MeshLambertMaterial({ map: atlas(), alphaTest: 0.5, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), {
    affine: 0,
    noSnap: true,
  });
  mat.name = "wall_climbers";
  const r = rng(99173);
  const CHUNK = 100;
  const chunks = new Map<string, { pos: number[]; nor: number[]; uv: number[]; col: number[]; idx: number[] }>();
  let patches = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 4) continue;
    const tx = (bx - ax) / L;
    const tz = (bz - az) / L;
    let nx = -tz;
    let nz = tx;
    // toward the town
    if ((mid[0] - ax) * nx + (mid[1] - az) * nz < 0) {
      nx = -nx;
      nz = -nz;
    }
    for (let s = 2 + r() * 6; s < L - 2; ) {
      const w = 2.2 + r() * 3.2;
      const x = ax + tx * (s + w / 2);
      const z = az + tz * (s + w / 2);
      if (s + w < L - 1 && free(x, z, w / 2) && r() < 0.95) {
        const h = Math.min(R.h - 0.4, 2.2 + r() * 4.2);
        const cell = r() < 0.45 ? Math.floor(r() * 2) : 2 + Math.floor(r() * 2);
        const tint = 0.85 + r() * 0.3;
        const key = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
        let c = chunks.get(key);
        if (!c) chunks.set(key, (c = { pos: [], nor: [], uv: [], col: [], idx: [] }));
        const base = c.pos.length / 3;
        const ox = x + nx * 0.04;
        const oz = z + nz * 0.04;
        const hx = (tx * w) / 2;
        const hz = (tz * w) / 2;
        const y0 = -0.25;
        // (flipped half the time: no two patches alike)
        const flip = r() < 0.5;
        const u0 = cell / 4 + (flip ? 0.25 : 0);
        const u1 = cell / 4 + (flip ? 0 : 0.25);
        // the whole climber on every patch: rooted at the foot, thinning to single sprays at its top
        const vTop = 1;
        for (const [px, py, pz, u, v] of [
          [ox - hx, y0, oz - hz, u0, 0],
          [ox + hx, y0, oz + hz, u1, 0],
          [ox + hx, h, oz + hz, u1, vTop],
          [ox - hx, h, oz - hz, u0, vTop],
        ] as Array<[number, number, number, number, number]>) {
          c.pos.push(px, py, pz);
          c.nor.push(nx, 0, nz);
          c.uv.push(u, v);
          c.col.push(tint, tint, tint);
        }
        // facing the town: wound so its front is toward n
        if (tz * nx - tx * nz > 0) c.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
        else c.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        patches++;
      }
      s += w + 0.3 + r() * 2.5;
    }
  }
  const meshes: Array<{ m: THREE.Mesh; c: THREE.Vector3; r: number }> = [];
  for (const [key, c] of chunks) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(c.pos, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(c.nor, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(c.uv, 2));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(c.col, 3));
    geo.setIndex(c.idx);
    geo.computeBoundingSphere();
    const m = new THREE.Mesh(geo, mat);
    m.name = `wall_climbers_${key}`;
    m.matrixAutoUpdate = false;
    scene.add(m);
    meshes.push({ m, c: geo.boundingSphere!.center.clone(), r: geo.boundingSphere!.radius });
  }
  return {
    update(camera, far) {
      const cp = camera.position;
      for (const { m, c, r: rad } of meshes) m.visible = Math.hypot(c.x - cp.x, c.z - cp.z) - rad < far + 20;
    },
    info: () => ({ patches, meshes: meshes.length }),
  };
}
