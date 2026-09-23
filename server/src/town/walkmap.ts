import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { ROOT } from "../config.ts";
import CITY from "../../../shared/city.json" with { type: "json" };

// The walk map on the server (M3e). The same picture the client walks on
// (client/public/city/walk.png: R wall, G water, B outside, black open), so the
// engine can put homes, workplaces and job spots only where a body can stand
// and can check that every one of them is reachable on foot from the start.

export const WALL = 1;
export const WATER = 2;
export const OUTSIDE = 4;

interface WalkInfo {
  x0: number;
  z0: number;
  res: number;
  w: number;
  h: number;
  file: string;
}

export interface WalkMap {
  readonly info: WalkInfo;
  /** Flags at a point (0 = open ground). Off the map counts as outside water. */
  flags(x: number, z: number): number;
  /** Open ground with room for a body (radius r) around it. */
  open(x: number, z: number, r?: number): boolean;
  /** Can you walk from the start (the Rijnkaai) to this point? */
  reachable(x: number, z: number): boolean;
  /** The nearest open, reachable point within `max` metres, or null. */
  nearestOpen(x: number, z: number, max?: number): { x: number; z: number } | null;
}

/** Where the game starts (main.ts paths(): reachFrom(10, 12)). */
export const START = { x: 10, z: 12 };

let cached: WalkMap | null = null;

/** Minimal PNG reader: 8-bit RGB or RGBA, not interlaced (what tools/city writes). */
export function readPng(file: string): { w: number; h: number; ch: number; px: Uint8Array } {
  const buf = fs.readFileSync(file);
  let pos = 8;
  let w = 0;
  let h = 0;
  let ch = 3;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      const depth = data[8];
      const color = data[9];
      if (depth !== 8 || (color !== 2 && color !== 6) || data[12] !== 0) throw new Error("walk.png: unsupported PNG");
      ch = color === 6 ? 4 : 3;
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(w * h * ch);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[dst + i - ch] : 0;
      const b = y > 0 ? px[dst - stride + i] : 0;
      const c = y > 0 && i >= ch ? px[dst - stride + i - ch] : 0;
      let v = raw[src + i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[dst + i] = v & 255;
    }
  }
  return { w, h, ch, px };
}

export function walkMap(): WalkMap {
  if (cached) return cached;
  const info = (CITY as unknown as { walk: WalkInfo }).walk;
  const png = readPng(path.join(ROOT, "client", "public", info.file.replace(/^\//, "")));
  const cells = new Uint8Array(info.w * info.h);
  for (let i = 0; i < cells.length; i++) {
    const r = png.px[i * png.ch];
    const g = png.px[i * png.ch + 1];
    const b = png.px[i * png.ch + 2];
    cells[i] = (r > 127 ? WALL : 0) | (g > 127 ? WATER : 0) | (b > 127 ? OUTSIDE : 0);
  }
  const flags = (x: number, z: number): number => {
    const c = Math.floor((z - info.z0) / info.res);
    const r = Math.floor((x - info.x0) / info.res);
    if (c < 0 || r < 0 || c >= info.w || r >= info.h) return OUTSIDE | WATER;
    return cells[r * info.w + c];
  };
  const open = (x: number, z: number, r = 0.45): boolean => {
    if (flags(x, z) !== 0) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      if (flags(x + Math.cos(a) * r, z + Math.sin(a) * r) !== 0) return false;
    }
    return true;
  };
  // flood fill from the start over cells a body fits in (as the client's path check)
  const seen = new Uint8Array(info.w * info.h);
  const cellOf = (x: number, z: number) => {
    const c = Math.floor((z - info.z0) / info.res);
    const r = Math.floor((x - info.x0) / info.res);
    return c < 0 || r < 0 || c >= info.w || r >= info.h ? -1 : r * info.w + c;
  };
  const centre = (i: number) => ({ x: info.x0 + (Math.floor(i / info.w) + 0.5) * info.res, z: info.z0 + ((i % info.w) + 0.5) * info.res });
  const passable = new Uint8Array(info.w * info.h);
  for (let i = 0; i < passable.length; i++) {
    const p = centre(i);
    passable[i] = open(p.x, p.z) ? 1 : 0;
  }
  const s0 = cellOf(START.x, START.z);
  const stack = [s0];
  seen[s0] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const r = Math.floor(i / info.w);
    const c = i % info.w;
    for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= info.h || cc >= info.w) continue;
      const j = rr * info.w + cc;
      if (!seen[j] && passable[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  const reachable = (x: number, z: number) => {
    const i = cellOf(x, z);
    return i >= 0 && seen[i] === 1;
  };
  const nearestOpen = (x: number, z: number, max = 6) => {
    if (reachable(x, z)) return { x, z };
    for (let d = info.res; d <= max; d += info.res) {
      let best: { x: number; z: number } | null = null;
      let bestD = Infinity;
      const k = Math.ceil((2 * Math.PI * d) / info.res);
      for (let i = 0; i < k; i++) {
        const a = (i / k) * Math.PI * 2;
        const q = { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
        if (reachable(q.x, q.z)) {
          const dd = Math.hypot(q.x - x, q.z - z);
          if (dd < bestD) {
            bestD = dd;
            best = q;
          }
        }
      }
      if (best) return { x: Math.round(best.x * 10) / 10, z: Math.round(best.z * 10) / 10 };
    }
    return null;
  };
  cached = { info, flags, open, reachable, nearestOpen };
  return cached;
}

// ------------------------------------------------------------------ house doors

export interface HouseDoor {
  /** Index of the house in shared/city_build.json. */
  house: number;
  /** The door in the front wall. */
  x: number;
  z: number;
  /** Unit vector out of the house, into the street. */
  out: [number, number];
  /** Where a person stands to go in: a step out from the door, on reachable ground. */
  sx: number;
  sz: number;
  storeys: number;
}

interface House {
  rect: boolean;
  store?: string | null;
  fp: number[][];
  o: number[];
  u: number[];
  n: number[];
  s: number[];
  t: number[];
  st: number;
  street: number[];
}

let doorsCache: HouseDoor[] | null = null;

/**
 * Front doors of the city's houses, as tools/blender/build_props.py puts them
 * (the middle 3 m bay of the street front), each with a reachable step outside.
 * Warehouses and the Entrepot are left out: nobody lives there.
 */
export function houseDoors(): HouseDoor[] {
  if (doorsCache) return doorsCache;
  const wm = walkMap();
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "city_build.json"), "utf8")) as { houses: House[] };
  const out: HouseDoor[] = [];
  build.houses.forEach((h, i) => {
    if (h.store) return;
    let a: [number, number];
    let b: [number, number];
    if (h.rect) {
      if (!h.street[0]) return;
      const [ox, oz] = h.o;
      const [ux, uz] = h.u;
      const [nx, nz] = h.n;
      const [s0, s1] = h.s;
      const t0 = h.t[0];
      a = [ox + ux * s0 + nx * t0, oz + uz * s0 + nz * t0];
      b = [ox + ux * s1 + nx * t0, oz + uz * s1 + nz * t0];
    } else {
      const fp = h.fp;
      const n = fp.length;
      let best = -1;
      let bestL = 2;
      for (let k = 0; k < n; k++) {
        const L = Math.hypot(fp[(k + 1) % n][0] - fp[k][0], fp[(k + 1) % n][1] - fp[k][1]) * (h.street[k] ?? 0);
        if (L > bestL) {
          bestL = L;
          best = k;
        }
      }
      if (best < 0) return;
      a = fp[best] as [number, number];
      b = fp[(best + 1) % n] as [number, number];
    }
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bays = Math.max(1, Math.round(L / 3));
    const f = (Math.floor(bays / 2) + 0.5) / bays;
    const x = a[0] + (b[0] - a[0]) * f;
    const z = a[1] + (b[1] - a[1]) * f;
    // out of the house: the side of the wall line with open ground
    const ex = (b[0] - a[0]) / L;
    const ez = (b[1] - a[1]) / L;
    let o: [number, number] = [-ez, ex];
    if (!wm.open(x + o[0] * 1.2, z + o[1] * 1.2, 0.3)) o = [ez, -ex];
    for (const d of [0.9, 1.2, 1.6, 2.0]) {
      const sx = x + o[0] * d;
      const sz = z + o[1] * d;
      if (wm.reachable(sx, sz)) {
        out.push({ house: i, x: round1(x), z: round1(z), out: [round2(o[0]), round2(o[1])], sx: round1(sx), sz: round1(sz), storeys: h.st });
        return;
      }
    }
  });
  doorsCache = out;
  return out;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;
