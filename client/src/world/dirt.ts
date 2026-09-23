import * as THREE from "three";
import { psxUniforms } from "../retro/psx";

// Dirt (Steve: "more worn streets or filth, it is way too clean"; "real dirt is often more
// uneven: track grooves, bigger marks"). A map of the whole city, one pixel per 0.5 m:
// grime in the gutter along every wall, uneven, with runs and stains; ragged patches of mud;
// muddy cart tracks with two wheel lines and dung between them (the cart roads of
// world/ruts.ts); now and then a big stain of ash, oil or dung. The paving shader
// (retro/psx.ts option `vary`) darkens and browns the stones by it.

type Flags = (x: number, z: number) => number | undefined;
type P = [number, number];

const X0 = -340;
const Z0 = -80;
const RES = 0.5; // metres per pixel
const W = 1080;
const H = 760;
const WALL = 1;

let field: Float32Array | null = null;
/** Cart roads handed in before the map was made: laid in when it is. */
let pending: P[][][] = [];
let tex: THREE.DataTexture | null = null;
/** The cart roads handed to dirtAlong (world/ruts.ts), for the litter layer (world/litter.ts). */
const roads: P[][] = [];
const roadWaiters: Array<(r: P[][]) => void> = [];
/** Stamps handed in before the map was made (dirtStamp). */
let pendingStamps: Array<[number, number, number, number]> = [];

function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

/** Smooth value noise over the pixel grid, `cell` pixels per noise cell. */
function valueNoise(seed: number, cell: number): (i: number, j: number) => number {
  const r = rand(seed);
  const gw = Math.ceil(W / cell) + 2;
  const gh = Math.ceil(H / cell) + 2;
  const g = Float32Array.from({ length: gw * gh }, r);
  return (i, j) => {
    const fx = i / cell;
    const fy = j / cell;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const u = fx - x0;
    const v = fy - y0;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = g[y0 * gw + x0] + (g[y0 * gw + x0 + 1] - g[y0 * gw + x0]) * su;
    const b = g[(y0 + 1) * gw + x0] + (g[(y0 + 1) * gw + x0 + 1] - g[(y0 + 1) * gw + x0]) * su;
    return a + (b - a) * sv;
  };
}

function upload(): void {
  if (!field) return;
  const data = new Uint8Array(W * H * 4);
  for (let k = 0; k < W * H; k++) {
    const v = Math.round(Math.min(1, Math.max(0, field[k])) * 255);
    data[k * 4] = data[k * 4 + 1] = data[k * 4 + 2] = v;
    data[k * 4 + 3] = 255;
  }
  if (!tex) {
    tex = new THREE.DataTexture(data, W, H);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    psxUniforms.uDirt.value = tex;
    psxUniforms.uDirtBox.value.set(X0, Z0, W * RES, H * RES);
  } else {
    tex.image.data = data;
  }
  tex.needsUpdate = true;
}

export function applyDirt(flags: Flags, seed = 1873): void {
  const r = rand(seed);
  const n1 = valueNoise(seed + 1, 6); // 3 m: unevenness of the gutter grime
  const n2 = valueNoise(seed + 2, 24); // 12 m: where mud lies
  const n3 = valueNoise(seed + 3, 5); // 2.5 m: ragged edges of the mud
  const n4 = valueNoise(seed + 4, 2); // 1 m: small speckle
  const n5 = valueNoise(seed + 5, 6); // how heavy the gutter grime is, stretch by stretch
  const n6 = valueNoise(seed + 6, 2);
  // distance to the nearest wall, in pixels (breadth first from every wall pixel)
  const d = new Float32Array(W * H).fill(99);
  const q: number[] = [];
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const f = flags(X0 + (i + 0.5) * RES, Z0 + (j + 0.5) * RES);
      if (f !== undefined && (f & WALL) !== 0) {
        d[j * W + i] = 0;
        q.push(j * W + i);
      }
    }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    if (d[c] >= 8) continue;
    const i = c % W;
    const j = (c / W) | 0;
    const n = d[c] + 1;
    if (i > 0 && d[c - 1] > n) (d[c - 1] = n), q.push(c - 1);
    if (i < W - 1 && d[c + 1] > n) (d[c + 1] = n), q.push(c + 1);
    if (j > 0 && d[c - W] > n) (d[c - W] = n), q.push(c - W);
    if (j < H - 1 && d[c + W] > n) (d[c + W] = n), q.push(c + W);
  }
  field = new Float32Array(W * H);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const m = d[k] * RES; // metres from the wall
      // the gutter: thick at the foot, fading over 1-3 m, heavier in some stretches than others
      const reach = 1.5 + 2.5 * n1(i, j);
      const gutter = m >= 49 ? 0 : Math.max(0, 1 - (m - 0.3) / reach) * (0.5 + 0.7 * n5(i, j));
      // mud: ragged patches where the big noise is high, torn at the edges
      const mudN = n2(i, j) * 0.75 + n3(i, j) * 0.25;
      const mud = Math.max(0, Math.min(1, (mudN - 0.5) / 0.16)) * (0.55 + 0.35 * n4(i, j));
      // and everywhere a little: no stone in a port town of 1873 is clean
      const base = 0.18 + 0.2 * n2(i + 7, j) * n4(i, j);
      field[k] = Math.max(gutter, mud, base) * (0.85 + 0.3 * n6(i, j));
    }
  // big stains: ash by a door, oil by a store, a heap of dung swept aside
  for (let s = 0; s < 260; s++) {
    const cx = r() * W;
    const cz = r() * H;
    const rad = (0.8 + r() * 2.2) / RES;
    const a = 0.55 + r() * 0.4;
    const sq = 0.6 + r() * 0.8; // stretched
    for (let j = Math.max(0, Math.floor(cz - rad)); j < Math.min(H, Math.ceil(cz + rad)); j++)
      for (let i = Math.max(0, Math.floor(cx - rad)); i < Math.min(W, Math.ceil(cx + rad)); i++) {
        const t = 1 - Math.hypot((i - cx) * sq, j - cz) / rad;
        if (t > 0) {
          const k = j * W + i;
          field[k] = Math.max(field[k], a * Math.min(1, t * 2) * (0.6 + 0.4 * n4(i, j)));
        }
      }
  }
  upload();
  const later = pending;
  pending = [];
  for (const lines of later) paintAlong(lines);
  if (later.length) upload();
  const stamps = pendingStamps;
  pendingStamps = [];
  if (stamps.length) dirtStamp(stamps);
}

/** The cart roads as the ruts found them (smoothed lines): resolves once world/ruts.ts has laid them. */
export function cartRoads(): Promise<P[][]> {
  if (roads.length) return Promise.resolve(roads);
  return new Promise((res) => roadWaiters.push(res));
}

/**
 * M3j litter: darken the map in soft ragged spots [x, z, radius m, strength 0..1] (the muck
 * where horses stand, the gutters' wet, the ground round a refuse heap). Max-blended.
 */
export function dirtStamp(spots: Array<[number, number, number, number]>, seed = 11): void {
  if (!field) {
    pendingStamps.push(...spots);
    return;
  }
  const n = valueNoise(seed, 2);
  for (const [x, z, rad, a] of spots) {
    const cx = (x - X0) / RES;
    const cz = (z - Z0) / RES;
    const r = rad / RES;
    for (let j = Math.max(0, Math.floor(cz - r)); j < Math.min(H, Math.ceil(cz + r)); j++)
      for (let i = Math.max(0, Math.floor(cx - r)); i < Math.min(W, Math.ceil(cx + r)); i++) {
        const t = 1 - Math.hypot(i - cx, j - cz) / r;
        if (t <= 0) continue;
        const k = j * W + i;
        field[k] = Math.max(field[k], a * Math.min(1, t * 2.5) * (0.65 + 0.35 * n(i, j)));
      }
  }
  upload();
}

/**
 * Muddy cart tracks along the given lines (world/ruts.ts calls this with its cart roads):
 * two dark wheel lines 1.5 m apart, dung and trodden mud between them, soft at the sides.
 */
export function dirtAlong(lines: P[][], seed = 7): void {
  roads.push(...lines);
  for (const w of roadWaiters.splice(0)) w(roads);
  if (!field) {
    pending.push(lines);
    return;
  }
  paintAlong(lines, seed);
  upload();
}

function paintAlong(lines: P[][], seed = 7): void {
  if (!field) return;
  const r = rand(seed);
  const n = valueNoise(seed, 3);
  const n2 = valueNoise(seed + 1, 3);
  for (const line of lines) {
    for (let s = 0; s < line.length - 1; s++) {
      const [ax, az] = line[s];
      const [bx, bz] = line[s + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      const ux = (bx - ax) / L;
      const uz = (bz - az) / L;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - 1.6 - X0) / RES));
      const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + 1.6 - X0) / RES));
      const j0 = Math.max(0, Math.floor((Math.min(az, bz) - 1.6 - Z0) / RES));
      const j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + 1.6 - Z0) / RES));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = X0 + (i + 0.5) * RES - ax;
          const z = Z0 + (j + 0.5) * RES - az;
          const along = x * ux + z * uz;
          if (along < -0.3 || along > L + 0.3) continue;
          const across = Math.abs(x * -uz + z * ux);
          if (across > 1.5) continue;
          const wheel = Math.max(0, 1 - Math.abs(across - 0.75) / 0.3); // the two wheel lines
          const middle = across < 0.35 ? 0.5 : 0; // the horse's line: dung and mud
          const side = 1 - across / 1.5;
          const v = (0.25 * side + 0.6 * wheel + middle * (0.5 + 0.5 * n(i, j))) * (0.7 + 0.5 * n2(i, j));
          const k = j * W + i;
          field[k] = Math.max(field[k], v);
        }
    }
    // dung now and then in the middle of the road
    for (let s = 0; s < line.length; s += 3) {
      if (r() > 0.35) continue;
      const [x, z] = line[s];
      const ci = Math.floor((x - X0) / RES);
      const cj = Math.floor((z - Z0) / RES);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const k = (cj + dj) * W + ci + di;
          if (k >= 0 && k < W * H) field[k] = Math.max(field[k], 0.95);
        }
    }
  }
}
