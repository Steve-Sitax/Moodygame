import * as THREE from "three";
import CITY from "../../../shared/city.json";
import { psx } from "../retro/psx";
import { water } from "./tide";
import type { WallDressing } from "./rampart";

// The town wall, pass 2 (Steve, 2026-09-25, picture 7: "the moat with reeds and water plants along its banks,
// autumn trees on the berm and fallen leaves"). A small kit of painted cards, mixed by seeded dice and merged per
// 60 m chunk (one draw call per chunk and kind), hidden past the fog and past a reach of their own:
//
//   reed beds    along the moat's walls: a bank of mud against the wall (under water at high tide, bare at low)
//                with reeds, bulrushes and sedge on it, in stretches with gaps; never under a gate's bridge
//   bank edge    sedge, long grass and a bush now and then on the berm's and the far bank's edge over the water
//   water lilies pads in patches on the moat, riding the tide (water.river)
//   wall foot    bushes and tufts along the foot of the wall on the berm (not on the gate roads)
//   leaves       fallen leaves under the trees outside the wall, and blown against both parapets of the walk
//
// Nothing here is solid: nobody walks outside the wall, and the leaves on the walk lie flat.

type Ring = number[][];

interface RampartData {
  h: number;
  t: number;
  trace: Ring;
  inner_line: Ring;
  segments: Array<{ name: string; o: [number, number]; t: [number, number]; n: [number, number]; len: number }>;
  towers: Array<{ seg: string; s: number }>;
  gates: Array<{ seg: string; s: number; bridge: Ring; road: Ring; far_road: Ring }>;
  stairs: Array<{ seg: string; s: number; dir: number }>;
}

const C = CITY as unknown as {
  water: Array<{ outer: Ring }>;
  quays: number[][];
  decor?: { rampart?: RampartData; trees_wild?: Array<[number, number]> };
};
const R = C.decor?.rampart ?? null;

const CHUNK = 60;
/** How far each kind is drawn at most (m, past its chunk's edge): the leaves are small, the reeds show further. */
const REACH: Record<string, number> = { plants: 150, reedbank: 110, lilies: 110, leaves: 55 };
/** The walk's parapets (build_wall.py TOWN_T, BW_O + BW_T): the leaves lie against their feet. */
const TOWN_T = 0.42;
const BW_IN = 0.65;
/** The reed bank against a moat wall: its top against the wall, how far out, its foot (under the lowest water). */
const BANK_TOP = -2.35;
const BANK_OUT = 3.0;
const BANK_FOOT = -5.7;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inRing = (ring: Ring, x: number, z: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

/** Smooth 1-D noise along a line (for stretches and gaps), 0..1. */
function noise1(seed: number): (s: number) => number {
  const r = rng(seed);
  const v = Array.from({ length: 4096 }, r);
  return (s: number) => {
    const f = s / 7.0;
    const i = Math.floor(f);
    const k = f - i;
    const a = v[((i % 4096) + 4096) % 4096];
    const b = v[(((i + 1) % 4096) + 4096) % 4096];
    const e = k * k * (3 - 2 * k);
    return a + (b - a) * e;
  };
}

// ------------------------------------------------------------------ the pictures

const CELL_W = 32;
const CELL_H = 64;
/** Cards: reed, bulrush, sedge, bush (u = cell / 4). */
enum Card {
  Reed = 0,
  Rush = 1,
  Sedge = 2,
  Bush = 3,
}

function canvasTex(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  return t;
}

/** The plants, painted side by side: 4 cells of 32 x 64 px, bottom of each cell at the bottom. */
function plantAtlas(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = CELL_W * 4;
  c.height = CELL_H;
  const g = c.getContext("2d")!;
  const r = rng(1873);
  const stroke = (x0: number, y0: number, x1: number, y1: number, col: string, w = 1, bend = 0) => {
    g.strokeStyle = col;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(x0, y0);
    g.quadraticCurveTo((x0 + x1) / 2 + bend, (y0 + y1) / 2, x1, y1);
    g.stroke();
  };
  // reeds (Phragmites in October): straw and tan stems, grey-green leaves going brown, purple-brown plumes
  {
    const ox = 0;
    for (let i = 0; i < 20; i++) {
      const x = ox + 3 + r() * 26;
      const top = 4 + r() * 18;
      const lean = (r() - 0.5) * 6;
      const k = r();
      const col = k < 0.45 ? `rgb(${168 + r() * 30},${140 + r() * 24},${86 + r() * 20})` : k < 0.8 ? `rgb(${118 + r() * 20},${112 + r() * 18},${70 + r() * 14})` : `rgb(${96 + r() * 16},${104 + r() * 14},${66})`;
      stroke(x, CELL_H, x + lean, top, col, 1, lean * 0.4);
      // two leaves off the stem
      for (let j = 0; j < 2; j++) {
        const yy = top + 12 + r() * (CELL_H - top - 18);
        const xx = x + (lean * (CELL_H - yy)) / (CELL_H - top);
        const d = r() < 0.5 ? -1 : 1;
        stroke(xx, yy, xx + d * (4 + r() * 5), yy + 3 + r() * 6, `rgb(${120 + r() * 30},${118 + r() * 20},${72})`, 1, d * 2);
      }
      if (r() < 0.75) {
        // the plume, drooping to one side
        g.fillStyle = r() < 0.5 ? `rgb(${112 + r() * 16},${92 + r() * 12},${80 + r() * 10})` : `rgb(${146 + r() * 20},${126 + r() * 16},${98})`;
        const px = x + lean;
        for (let q = 0; q < 6; q++) g.fillRect(Math.round(px + q * 0.35 * Math.sign(lean || 1)), Math.round(top + q), 1, 1);
      }
    }
  }
  // bulrushes: broad blades, green going ochre, brown velvet heads on a few stems
  {
    const ox = CELL_W;
    for (let i = 0; i < 12; i++) {
      const x = ox + 3 + r() * 26;
      const top = 14 + r() * 22;
      const lean = (r() - 0.5) * 10;
      g.strokeStyle = r() < 0.5 ? `rgb(${92 + r() * 20},${104 + r() * 18},${52})` : `rgb(${150 + r() * 26},${130 + r() * 20},${64})`;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, CELL_H);
      g.quadraticCurveTo(x + lean * 0.2, (CELL_H + top) / 2, x + lean, top);
      g.stroke();
    }
    for (let i = 0; i < 4; i++) {
      const x = ox + 6 + r() * 20;
      const top = 6 + r() * 10;
      stroke(x, CELL_H, x + (r() - 0.5) * 2, top, "rgb(104,110,64)", 1);
      g.fillStyle = `rgb(${76 + r() * 14},${50 + r() * 8},${30})`;
      g.fillRect(Math.round(x - 1), Math.round(top + 2), 3, 8);
    }
  }
  // sedge and long grass: a low tuft, bent over, green and straw
  {
    const ox = CELL_W * 2;
    for (let i = 0; i < 18; i++) {
      const x = ox + 4 + r() * 24;
      const hgt = 16 + r() * 34;
      const lean = (r() - 0.5) * 16;
      const v = r();
      stroke(x, CELL_H, x + lean, CELL_H - hgt, v < 0.5 ? `rgb(${82 + r() * 26},${100 + r() * 26},${46 + r() * 16})` : `rgb(${150 + r() * 34},${136 + r() * 26},${76 + r() * 18})`, 1, lean * 0.5);
    }
  }
  // a bush in autumn: twigs, a crown of rust and ochre leaves, some bare
  {
    const ox = CELL_W * 3;
    const twig = (x: number, y: number, a: number, len: number, w: number, depth: number) => {
      const x2 = x + Math.cos(a) * len;
      const y2 = y - Math.sin(a) * len;
      stroke(x, y, x2, y2, `rgb(${58 + r() * 18},${46 + r() * 10},${34})`, w);
      if (depth > 0) for (let k = 0; k < 2; k++) twig(x2, y2, a + (r() - 0.5) * 1.2, len * (0.62 + r() * 0.2), Math.max(1, w - 1), depth - 1);
      else {
        const cols = ["#9a5a1e", "#b8862c", "#7a3c14", "#8a6a24", "#6e7a30"];
        for (let q = 0; q < 5; q++) {
          if (r() < 0.25) continue;
          g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.fillRect(Math.round(x2 + (r() - 0.5) * 6), Math.round(y2 + (r() - 0.5) * 6), 2, 2);
        }
      }
    };
    for (let i = 0; i < 5; i++) twig(ox + 12 + r() * 8, CELL_H, Math.PI / 2 + (r() - 0.5) * 1.1, 12 + r() * 6, 2, 4);
  }
  return canvasTex(c);
}

/** Flat things: fallen leaves (cell 0) and a patch of water-lily pads (cell 1), 64 x 64 each. */
function flatAtlas(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 64;
  const g = c.getContext("2d")!;
  const r = rng(1874);
  const cols = ["#8a4a18", "#a86a20", "#6e3a14", "#b88a30", "#7a3010", "#9a7a2a", "#5e3a1a"];
  for (let i = 0; i < 230; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.pow(r(), 0.7) * 30;
    g.fillStyle = cols[Math.floor(r() * cols.length)];
    const w = r() < 0.4 ? 3 : 2;
    g.fillRect(Math.round(32 + Math.cos(a) * d), Math.round(32 + Math.sin(a) * d), w, r() < 0.5 ? 1 : 2);
  }
  // lily pads: round, a notch, dark green going yellow at the edge, a few already brown
  for (let i = 0; i < 9; i++) {
    const cx = 64 + 10 + r() * 44;
    const cy = 10 + r() * 44;
    const rad = 5 + r() * 5;
    const k = r();
    g.fillStyle = k < 0.5 ? `rgb(${64 + r() * 16},${96 + r() * 18},${40})` : k < 0.85 ? `rgb(${128 + r() * 24},${124 + r() * 16},${50})` : `rgb(${128},${84},${40})`;
    const n0 = r() * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx, cy);
    g.arc(cx, cy, rad, n0 + 0.35, n0 + Math.PI * 2 - 0.05);
    g.closePath();
    g.fill();
    g.fillStyle = "rgba(20,30,12,0.5)";
    g.fillRect(Math.round(cx - 1), Math.round(cy - 1), 1, 1);
  }
  return canvasTex(c);
}

// ------------------------------------------------------------------ merged chunks

class Bucket {
  pos: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  sway: number[] = [];
  idx: number[] = [];
  n = 0;
  quad(p: number[][], uv: number[][], shade: number, sway: number[] = [0, 0, 0, 0]): void {
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i][0], p[i][1], p[i][2]);
      this.uv.push(uv[i][0], uv[i][1]);
      this.col.push(shade, shade, shade);
      this.sway.push(sway[i]);
    }
    const b = this.n;
    this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    this.n += 4;
  }
  geometry(normalUp: boolean): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute("sway", new THREE.Float32BufferAttribute(this.sway, 1));
    g.setIndex(this.idx);
    if (normalUp) g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(this.n).fill([0, 1, 0]).flat(), 3));
    else g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

interface Chunk {
  cards: Bucket;
  flats: Bucket;
  lilies: Bucket;
  mud: Bucket;
}

export interface RampartNature {
  update(camera: THREE.Camera, far: number): void;
  info(): { chunks: number; cards: number; flats: number; lilies: number };
}

/** psx() plus a slow sway of the tops in the wind (more in a storm: uSea); `sway` is 0 at the foot, 1 at the top. */
function swayMaterial<T extends THREE.Material>(mat: T): T {
  psx(mat, { affine: 0 });
  const base = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader, renderer) => {
    base.call(mat, shader, renderer);
    shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nattribute float sway;").replace(
      "#include <begin_vertex>",
      /* glsl */ `#include <begin_vertex>
{
  float ph = position.x * 0.37 + position.z * 0.29;
  float wind = 0.5 + 0.5 * uSea;
  float s = sway * sway * wind;
  transformed.x += (sin(uTime * 1.1 + ph) + 0.4 * sin(uTime * 2.7 + ph * 1.9)) * 0.11 * s;
  transformed.z += sin(uTime * 0.83 + ph * 1.3) * 0.07 * s;
}`,
    );
  };
  mat.customProgramCacheKey = () => key.call(mat) + "-rampartsway";
  return mat;
}

export function buildRampartNature(scene: THREE.Scene, d: WallDressing): RampartNature {
  const group = new THREE.Group();
  group.name = "rampart_nature";
  scene.add(group);
  const chunks = new Map<string, Chunk>();
  const chunkAt = (x: number, z: number): Chunk => {
    const k = `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;
    let c = chunks.get(k);
    if (!c) chunks.set(k, (c = { cards: new Bucket(), flats: new Bucket(), lilies: new Bucket(), mud: new Bucket() }));
    return c;
  };
  if (!R) return { update() {}, info: () => ({ chunks: 0, cards: 0, flats: 0, lilies: 0 }) };

  // ---- where things may go
  const town: Ring = [[R.inner_line[0][0], -60], ...R.inner_line, [R.inner_line[R.inner_line.length - 1][0], -60]];
  const outside = (x: number, z: number) => !inRing(town, x, z);
  const inWater = (x: number, z: number) => C.water.some((w) => inRing(w.outer, x, z));
  const boxOf = (ring: Ring, m: number) => ({
    minX: Math.min(...ring.map((p) => p[0])) - m,
    maxX: Math.max(...ring.map((p) => p[0])) + m,
    minZ: Math.min(...ring.map((p) => p[1])) - m,
    maxZ: Math.max(...ring.map((p) => p[1])) + m,
  });
  const keepOff = R.gates.flatMap((g) => [boxOf(g.bridge, 4), boxOf(g.road, 2.5), boxOf(g.far_road, 2.5)]);
  const offBridges = (x: number, z: number) => !keepOff.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  const distTrace = (x: number, z: number) => {
    let best = Infinity;
    for (let i = 0; i < R.trace.length - 1; i++) {
      const [ax, az] = R.trace[i];
      const [bx, bz] = R.trace[i + 1];
      const dx = bx - ax;
      const dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
    }
    return best;
  };

  // ---- the kit
  let nCards = 0;
  /** An upright plant of two crossed cards, foot at (x, y, z). */
  const plant = (x: number, y: number, z: number, kind: Card, h: number, w: number, yaw: number, shade: number) => {
    const c = chunkAt(x, z);
    const u0 = kind / 4 + 0.5 / (CELL_W * 4);
    const u1 = (kind + 1) / 4 - 0.5 / (CELL_W * 4);
    const uv = [
      [u0, 0],
      [u1, 0],
      [u1, 1],
      [u0, 1],
    ];
    const sw = kind === Card.Bush ? 0.25 : kind === Card.Sedge ? 0.5 : 1;
    for (const a of [yaw, yaw + Math.PI / 2]) {
      const dx = (Math.cos(a) * w) / 2;
      const dz = (Math.sin(a) * w) / 2;
      const p = [
        [x - dx, y, z - dz],
        [x + dx, y, z + dz],
        [x + dx, y + h, z + dz],
        [x - dx, y + h, z - dz],
      ];
      c.cards.quad(p, uv, shade, [0, 0, sw, sw]);
      c.cards.quad([p[1], p[0], p[3], p[2]], [uv[1], uv[0], uv[3], uv[2]], shade * 0.92, [0, 0, sw, sw]);
    }
    nCards++;
  };
  /** A flat patch (leaves: cell 0, lilies: cell 1) centred at (x, y, z), size s, turned by a. */
  let layer = 0;
  const flat = (b: Bucket, x: number, y0: number, z: number, s: number, a: number, cell: number, shade: number) => {
    // each patch a few millimetres over or under its neighbours: two that overlap never lie in one plane
    const y = y0 + (layer++ % 7) * 0.004;
    const ca = (Math.cos(a) * s) / 2;
    const sa = (Math.sin(a) * s) / 2;
    const u0 = cell / 2;
    const u1 = (cell + 1) / 2;
    b.quad(
      [
        [x - ca + sa, y, z - sa - ca],
        [x - ca - sa, y, z - sa + ca],
        [x + ca - sa, y, z + sa + ca],
        [x + ca + sa, y, z + sa - ca],
      ],
      [
        [u0, 0],
        [u0, 1],
        [u1, 1],
        [u1, 0],
      ],
      shade,
    );
  };

  // ---- the moat's walls: reed banks in stretches, the bank's edge over them, lilies on the water
  const r = rng(18731);
  const reedsAt = noise1(71);
  const liliesAt = noise1(72);
  const edgeAt = noise1(73);
  let run = 0;
  for (const q of C.quays) {
    const [x0, z0, x1, z1] = q;
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.5) continue;
    const mx = (x0 + x1) / 2;
    const mz = (z0 + z1) / 2;
    const dt = distTrace(mx, mz);
    if (mz < 25 || dt < 10 || dt > 80 || !outside(mx, mz)) continue;
    const tx = (x1 - x0) / L;
    const tz = (z1 - z0) / L;
    // the water side of this wall
    let nx = -tz;
    let nz = tx;
    if (!inWater(mx + nx * 1.5, mz + nz * 1.5)) {
      nx = -nx;
      nz = -nz;
      if (!inWater(mx + nx * 1.5, mz + nz * 1.5)) continue;
    }
    const steps = Math.max(1, Math.floor(L / 0.5));
    for (let i = 0; i < steps; i++) {
      const s = (i + 0.5) * (L / steps);
      const px = x0 + tx * s;
      const pz = z0 + tz * s;
      const along = run + s;
      if (!offBridges(px, pz)) continue;
      const rn = reedsAt(along);
      // the reed bank: where the dice say so, as wide as the stretch is thick in the middle
      if (rn > 0.5) {
        const wBank = BANK_OUT * Math.min(1, (rn - 0.5) * 5);
        const c = chunkAt(px, pz);
        if (i % 2 === 0 && wBank > 0.3) {
          // the mud, a strip 1 m along: from the wall down and out under the water
          const s1 = Math.min(L, s + 1.0);
          const qx = x0 + tx * s1;
          const qz = z0 + tz * s1;
          const w2 = BANK_OUT * Math.min(1, (reedsAt(run + s1) - 0.5) * 5);
          if (w2 > 0.3) {
            const e = 0.04; // off the wall's face
            c.mud.quad(
              [
                [px + nx * e, BANK_TOP, pz + nz * e],
                [px + nx * (wBank + 0.6), BANK_FOOT, pz + nz * (wBank + 0.6)],
                [qx + nx * (w2 + 0.6), BANK_FOOT, qz + nz * (w2 + 0.6)],
                [qx + nx * e, BANK_TOP, qz + nz * e],
              ],
              [
                [0, 0],
                [0, (wBank + 0.6) / 2],
                [s1 / 2 - s / 2, (w2 + 0.6) / 2],
                [s1 / 2 - s / 2, 0],
              ],
              0.55 + r() * 0.15,
            );
          }
        }
        for (let k = 0; k < 2; k++) {
          const off = 0.25 + r() * Math.max(0.1, wBank * 0.8);
          const y = BANK_TOP + ((BANK_FOOT - BANK_TOP) * off) / (wBank + 0.6) - 0.1;
          const ox = px + nx * off + tx * (r() - 0.5) * 0.5;
          const oz = pz + nz * off + tz * (r() - 0.5) * 0.5;
          const pick = r();
          const kind = pick < 0.62 ? Card.Reed : pick < 0.85 ? Card.Rush : Card.Sedge;
          const h = kind === Card.Reed ? 2.5 + r() * 0.9 : kind === Card.Rush ? 1.8 + r() * 0.6 : 1.1 + r() * 0.5;
          plant(ox, y, oz, kind, h, 1.0 + r() * 0.5, r() * Math.PI, 0.8 + r() * 0.3);
        }
      }
      // lilies on the water a little out, where no reeds stand
      if (rn < 0.42 && liliesAt(along) > 0.62 && i % 3 === 0 && r() < 0.8) {
        const off = 1.2 + r() * 4.0;
        const ox = px + nx * off;
        const oz = pz + nz * off;
        if (inWater(ox, oz)) flat(chunkAt(ox, oz).lilies, ox, 0.02, oz, 2.0 + r() * 1.4, r() * Math.PI * 2, 1, 0.9 + r() * 0.3);
      }
      // the bank's edge over the water: sedge and long grass, a bush now and then (on the land side)
      if (i % 3 === 0 && edgeAt(along) > 0.35 && r() < 0.7) {
        const off = -(0.35 + r() * 0.9);
        const ox = px + nx * off;
        const oz = pz + nz * off;
        if (!inWater(ox, oz)) {
          const bush = r() < 0.05;
          const reed = !bush && r() < 0.2;
          plant(ox, -0.02, oz, bush ? Card.Bush : reed ? Card.Reed : Card.Sedge, bush ? 1.3 + r() * 0.6 : reed ? 1.4 + r() * 0.6 : 0.7 + r() * 0.5, bush ? 1.5 : 0.55 + r() * 0.3, r() * Math.PI, 0.85 + r() * 0.25);
        }
      }
    }
    run += L + 3;
  }

  // ---- the wall's foot on the berm: bushes and tufts in clumps
  const footAt = noise1(74);
  for (const sg of R.segments) {
    const gates = R.gates.filter((g) => g.seg === sg.name).map((g) => g.s);
    const towers = R.towers.filter((t) => t.seg === sg.name).map((t) => t.s);
    for (let s = 3; s < sg.len - 3; s += 1.3) {
      if (gates.some((g) => Math.abs(s - g) < 14) || towers.some((t) => Math.abs(s - t) < 4.5)) continue;
      const nv = footAt(s + sg.o[0] * 0.7 + sg.o[1] * 0.3);
      if (nv < 0.45 || r() > 0.75) continue;
      const out = 0.5 + r() * 1.6;
      const x = sg.o[0] + sg.t[0] * s + sg.n[0] * out;
      const z = sg.o[1] + sg.t[1] * s + sg.n[1] * out;
      if (z < 4 || !offBridges(x, z) || inWater(x, z)) continue;
      const bush = nv > 0.72 && r() < 0.35;
      plant(x, -0.02, z, bush ? Card.Bush : Card.Sedge, bush ? 1.2 + r() * 0.8 : 0.6 + r() * 0.5, bush ? 1.4 + r() * 0.5 : 0.6 + r() * 0.25, r() * Math.PI, 0.8 + r() * 0.25);
    }
  }

  // ---- fallen leaves under the trees outside the wall
  for (const [tx, tz] of C.decor?.trees_wild ?? []) {
    if (!outside(tx, tz) || distTrace(tx, tz) > 90) continue;
    const n = 2 + Math.floor(r() * 3);
    for (let k = 0; k < n; k++) {
      const a = r() * Math.PI * 2;
      const dd = 0.4 + r() * 3.2;
      const x = tx + Math.cos(a) * dd;
      const z = tz + Math.sin(a) * dd;
      if (inWater(x, z) || !offBridges(x, z)) continue;
      flat(chunkAt(x, z).flats, x, 0.03, z, 1.4 + r() * 1.4, r() * Math.PI * 2, 0, 0.75 + r() * 0.35);
    }
  }

  // ---- leaves blown against both parapets of the walk (not in the gate towers, not on a stair's landing gap)
  const hw = R.h + 0.015;
  const walkAt = noise1(75);
  for (const sg of R.segments) {
    const gates = R.gates.filter((g) => g.seg === sg.name).map((g) => g.s);
    const stairs = R.stairs.filter((st) => st.seg === sg.name).map((st) => {
      const e = st.s + st.dir * 14.1;
      return [Math.min(st.s, e), Math.max(st.s, e)];
    });
    const ox = sg.o[0] - sg.n[0] * R.t;
    const oz = sg.o[1] - sg.n[1] * R.t;
    for (let s = 4; s < sg.len - 4; s += 0.9) {
      if (gates.some((g) => Math.abs(s - g) < 13)) continue;
      for (const town of [true, false]) {
        const nv = walkAt(s * 1.3 + (town ? 0 : 500) + sg.len);
        if (nv < 0.5 || r() > 0.8) continue;
        if (town && stairs.some(([a, b]) => s > a - 1.5 && s < b + 1.5)) continue;
        const size = 0.7 + r() * 0.8;
        const o = town ? TOWN_T + size * 0.32 + r() * 0.35 : R.t - BW_IN - size * 0.32 - r() * 0.35;
        const x = ox + sg.t[0] * s + sg.n[0] * o;
        const z = oz + sg.t[1] * s + sg.n[1] * o;
        flat(chunkAt(x, z).flats, x, hw, z, size, r() * Math.PI * 2, 0, 0.7 + r() * 0.3);
      }
      // now and then one out in the walk
      if (r() < 0.06) {
        const o = 1.5 + r() * (R.t - 3.5);
        const x = ox + sg.t[0] * s + sg.n[0] * o;
        const z = oz + sg.t[1] * s + sg.n[1] * o;
        flat(chunkAt(x, z).flats, x, hw, z, 0.5 + r() * 0.4, r() * Math.PI * 2, 0, 0.7 + r() * 0.3);
      }
    }
  }
  // a few round the mills' feet
  for (const m of d.mills) {
    for (let k = 0; k < 8; k++) {
      const a = r() * Math.PI * 2;
      const dd = m.r + 0.4 + r() * 2.5;
      const x = m.x + Math.cos(a) * dd;
      const z = m.z + Math.sin(a) * dd;
      flat(chunkAt(x, z).flats, x, hw, z, 0.8 + r() * 0.6, r() * Math.PI * 2, 0, 0.7 + r() * 0.3);
    }
  }

  // ---- the lawns on the land bastions (the look pass, 2026-09-26: "a flat green rectangle with a hard edge"): tussocks
  // along their edges and in clumps over them (never on the trodden path), leaves blown into drifts
  for (const lw of d.lawns ?? []) {
    const onLawn = (x: number, z: number) => inRing(lw.ring, x, z) && !lw.paved.some((q) => inRing(q, x, z));
    const offPath = (x: number, z: number) => {
      for (let i = 0; i < lw.path.length - 1; i++) {
        const [ax, az] = lw.path[i];
        const [bx, bz] = lw.path[i + 1];
        const dx = bx - ax;
        const dz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
        if (Math.hypot(x - ax - t * dx, z - az - t * dz) < 0.8) return false;
      }
      return true;
    };
    const edges: Array<[number[], number[]]> = [];
    const addRing = (q: number[][]) => q.forEach((p, i) => edges.push([p, q[(i + 1) % q.length]]));
    addRing(lw.ring);
    lw.paved.forEach(addRing);
    for (const [a, b] of edges) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const tx = (b[0] - a[0]) / L;
      const tz = (b[1] - a[1]) / L;
      for (let s = r() * 0.5; s < L; s += 0.45 + r() * 0.55) {
        const mx = a[0] + tx * s;
        const mz = a[1] + tz * s;
        const sg = onLawn(mx - tz * 0.3, mz + tx * 0.3) ? 1 : onLawn(mx + tz * 0.3, mz - tx * 0.3) ? -1 : 0;
        if (!sg) continue;
        const k = 0.04 + r() * 0.3;
        const x = mx - tz * k * sg;
        const z = mz + tx * k * sg;
        if (!offPath(x, z)) continue;
        plant(x, R.h, z, Card.Sedge, 0.28 + r() * 0.34, 0.4 + r() * 0.3, r() * Math.PI, 0.72 + r() * 0.3);
        if (r() < 0.35) flat(chunkAt(x, z).flats, x - tz * 0.25 * sg, hw, z + tx * 0.25 * sg, 0.5 + r() * 0.5, r() * Math.PI * 2, 0, 0.7 + r() * 0.3);
      }
    }
    const xs = lw.ring.map((p) => p[0]);
    const zs = lw.ring.map((p) => p[1]);
    const clumpAt = noise1(77 + Math.round(xs[0]));
    for (let x0 = Math.min(...xs); x0 < Math.max(...xs); x0 += 1.3)
      for (let z0 = Math.min(...zs); z0 < Math.max(...zs); z0 += 1.3) {
        const x = x0 + r() * 1.3;
        const z = z0 + r() * 1.3;
        if (!onLawn(x, z) || !offPath(x, z)) continue;
        const v = clumpAt(x * 0.37 + z * 0.61);
        if (v > 0.6) for (let k = 0; k < 1 + Math.floor(r() * 3); k++) plant(x + (r() - 0.5) * 0.7, R.h, z + (r() - 0.5) * 0.7, Card.Sedge, 0.22 + r() * 0.3, 0.35 + r() * 0.3, r() * Math.PI, 0.7 + r() * 0.3);
        else if (v < 0.22 && r() < 0.5) flat(chunkAt(x, z).flats, x, hw, z, 0.6 + r() * 0.7, r() * Math.PI * 2, 0, 0.7 + r() * 0.3);
      }
  }

  // ---- the meshes: one per chunk and kind
  const plantMap = plantAtlas();
  const flatMap = flatAtlas();
  const cardMat = swayMaterial(new THREE.MeshLambertMaterial({ map: plantMap, alphaTest: 0.5, vertexColors: true }));
  cardMat.name = "rampart_plants";
  const flatMat = psx(
    new THREE.MeshLambertMaterial({ map: flatMap, alphaTest: 0.5, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    { affine: 0, noSnap: true },
  );
  flatMat.name = "rampart_leaves";
  // (flat patches write no depth: two that overlap blend instead of fighting; drawn after the ground, renderOrder 1)
  flatMat.depthWrite = false;
  // the lilies after the water (renderOrder 2, see-through): theirs 3
  const lilyMat = psx(
    new THREE.MeshLambertMaterial({ map: flatMap, alphaTest: 0.5, vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    { affine: 0, noSnap: true },
  );
  lilyMat.name = "rampart_lilies";
  const mudTex = (() => {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d")!;
    const rr = rng(1875);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const v = 60 + rr() * 26;
        const wet = rr() < 0.05 ? 30 : 0;
        g.fillStyle = `rgb(${v + wet},${v - 5 + wet},${v - 14 + wet})`;
        g.fillRect(x, y, 1, 1);
      }
    const t = canvasTex(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  })();
  const mudMat = psx(new THREE.MeshLambertMaterial({ map: mudTex, vertexColors: true, side: THREE.DoubleSide }), { affine: 0, noSnap: true, wet: true });
  mudMat.name = "rampart_reedbank";
  const meshes: Array<{ m: THREE.Mesh; c: THREE.Vector3; r: number; reach: number }> = [];
  const lilyMeshes: THREE.Mesh[] = [];
  let nFlats = 0;
  let nLilies = 0;
  for (const [key, c] of chunks) {
    for (const [b, mat, up, kind] of [
      [c.cards, cardMat, true, "plants"],
      [c.flats, flatMat, true, "leaves"],
      [c.lilies, lilyMat, true, "lilies"],
      [c.mud, mudMat, false, "reedbank"],
    ] as Array<[Bucket, THREE.Material, boolean, string]>) {
      if (!b.n) continue;
      const m = new THREE.Mesh(b.geometry(up), mat);
      m.name = `rampart_${kind}_${key}`;
      m.matrixAutoUpdate = kind === "lilies";
      m.renderOrder = kind === "lilies" ? 3 : kind === "leaves" ? 1 : 0;
      m.updateMatrix();
      group.add(m);
      const bs = m.geometry.boundingSphere!;
      meshes.push({ m, c: bs.center.clone(), r: bs.radius + (kind === "lilies" ? 6 : 0), reach: REACH[kind] });
      if (kind === "lilies") {
        lilyMeshes.push(m);
        nLilies += b.n / 4;
      } else if (kind === "leaves") nFlats += b.n / 4;
    }
  }
  return {
    update(camera, far) {
      const cp = camera.position;
      for (const { m, c, r: rad, reach } of meshes) m.visible = Math.hypot(c.x - cp.x, c.y - cp.y, c.z - cp.z) - rad < Math.min(far + 20, reach);
      // the lilies ride the moat's water (it has the river's tide)
      const y = water.river;
      for (const m of lilyMeshes) m.position.y = y;
    },
    info: () => ({ chunks: chunks.size, cards: nCards, flats: nFlats, lilies: nLilies }),
  };
}
