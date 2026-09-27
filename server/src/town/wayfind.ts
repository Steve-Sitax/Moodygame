// Ways through the town (the trade plan, docs/trade-plan.md part A). Pure code with no imports, like
// schedule.ts: the server finds the ways on the walk map (ways.ts) and hands them out; both sides then
// walk a person along them by the clock (whereabouts.ts), so a person out of sight is on a street,
// never inside a house, and every PC and the town map agree where he is.
//
// The grid is the walk map's (shared/city.json walk: 0.5 m cells, pixel (col, row) = ((z - z0) / res,
// (x - x0) / res)); `pass` is 1 where a body fits and the start can be reached on foot (walkmap.ts).

export type Pt = [number, number];

export interface WayGrid {
  x0: number;
  z0: number;
  res: number;
  /** Columns (along z). */
  w: number;
  /** Rows (along x). */
  h: number;
  /** 1 = a body can stand here and walk to the start. */
  pass: Uint8Array;
}

/** A little greed in the search: ways at most a few percent longer, found many times faster. */
const GREED = 1.4;
const SQRT2 = Math.SQRT2;

const cellOf = (g: WayGrid, x: number, z: number): number => {
  const c = Math.floor((z - g.z0) / g.res);
  const r = Math.floor((x - g.x0) / g.res);
  return c < 0 || r < 0 || c >= g.w || r >= g.h ? -1 : r * g.w + c;
};

const centre = (g: WayGrid, i: number): Pt => [g.x0 + (Math.floor(i / g.w) + 0.5) * g.res, g.z0 + ((i % g.w) + 0.5) * g.res];

/** The nearest cell a body can stand on, within `max` metres (a ring search), or -1. */
export function nearestPass(g: WayGrid, x: number, z: number, max = 20): number {
  const i0 = cellOf(g, x, z);
  if (i0 >= 0 && g.pass[i0]) return i0;
  const r0 = Math.floor((x - g.x0) / g.res);
  const c0 = Math.floor((z - g.z0) / g.res);
  const R = Math.ceil(max / g.res);
  for (let d = 1; d <= R; d++) {
    let best = -1;
    let bestD = Infinity;
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue;
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= g.h || c >= g.w) continue;
        const i = r * g.w + c;
        if (!g.pass[i]) continue;
        const dd = dr * dr + dc * dc;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/**
 * Is the straight line from the centre of cell a to the centre of cell b all passable? Every cell the line
 * touches counts (a grid walk, not a thin Bresenham line), and through a cell corner both side cells count.
 */
function clear(g: WayGrid, a: number, b: number): boolean {
  let r = Math.floor(a / g.w);
  let c = a % g.w;
  const r1 = Math.floor(b / g.w);
  const c1 = b % g.w;
  const dr = r1 - r;
  const dc = c1 - c;
  const sr = Math.sign(dr);
  const sc = Math.sign(dc);
  // the line's parameter at the next row and column border (centres at +0.5, so the first border is 0.5 away)
  const tdr = dr ? 1 / Math.abs(dr) : Infinity;
  const tdc = dc ? 1 / Math.abs(dc) : Infinity;
  let tr = dr ? 0.5 * tdr : Infinity;
  let tc = dc ? 0.5 * tdc : Infinity;
  for (;;) {
    if (!g.pass[r * g.w + c]) return false;
    if (r === r1 && c === c1) return true;
    if (Math.abs(tr - tc) < 1e-9) {
      // through a corner: both cells beside it must be open
      if (!g.pass[(r + sr) * g.w + c] || !g.pass[r * g.w + c + sc]) return false;
      r += sr;
      c += sc;
      tr += tdr;
      tc += tdc;
    } else if (tr < tc) {
      r += sr;
      tr += tdr;
    } else {
      c += sc;
      tc += tdc;
    }
  }
}

/** A tiny binary heap of cell ids by a float key. */
class Heap {
  ids: Int32Array;
  keys: Float64Array;
  n = 0;
  constructor(cap: number) {
    this.ids = new Int32Array(cap);
    this.keys = new Float64Array(cap);
  }
  push(id: number, k: number): void {
    if (this.n === this.ids.length) {
      const ids = new Int32Array(this.n * 2);
      ids.set(this.ids);
      const keys = new Float64Array(this.n * 2);
      keys.set(this.keys);
      this.ids = ids;
      this.keys = keys;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.ids[i] = this.ids[p];
      this.keys[i] = this.keys[p];
      i = p;
    }
    this.ids[i] = id;
    this.keys[i] = k;
  }
  pop(): number {
    const top = this.ids[0];
    const id = this.ids[--this.n];
    const k = this.keys[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= k) break;
      this.ids[i] = this.ids[c];
      this.keys[i] = this.keys[c];
      i = c;
    }
    this.ids[i] = id;
    this.keys[i] = k;
    return top;
  }
}

/** Scratch arrays, kept between searches (one grid at a time). */
let scratch: { g: WayGrid; cost: Float32Array; from: Int32Array; stamp: Uint32Array; closed: Uint32Array; run: number } | null = null;

/**
 * The way on foot from a to b: points in world metres (cell centres), the first near a and the last near b,
 * straight between them over open ground. Null when either end is off the walkable town or they do not connect.
 */
export function findWay(g: WayGrid, ax: number, az: number, bx: number, bz: number): Pt[] | null {
  const s = nearestPass(g, ax, az);
  const t = nearestPass(g, bx, bz);
  if (s < 0 || t < 0) return null;
  if (s === t) return [round(centre(g, s)), round(centre(g, t))];
  const n = g.w * g.h;
  if (!scratch || scratch.g !== g) scratch = { g, cost: new Float32Array(n), from: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), run: 0 };
  const S = scratch;
  const run = ++S.run;
  const tr = Math.floor(t / g.w);
  const tc = t % g.w;
  const hOf = (i: number) => {
    const dr = Math.abs(Math.floor(i / g.w) - tr);
    const dc = Math.abs((i % g.w) - tc);
    return (Math.max(dr, dc) + (SQRT2 - 1) * Math.min(dr, dc)) * GREED;
  };
  const heap = new Heap(4096);
  S.stamp[s] = run;
  S.cost[s] = 0;
  S.from[s] = -1;
  heap.push(s, hOf(s));
  let found = false;
  while (heap.n) {
    const i = heap.pop();
    if (S.closed[i] === run) continue;
    S.closed[i] = run;
    if (i === t) {
      found = true;
      break;
    }
    const r = Math.floor(i / g.w);
    const c = i % g.w;
    const ci = S.cost[i];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= g.h || cc >= g.w) continue;
        const j = rr * g.w + cc;
        if (!g.pass[j] || S.closed[j] === run) continue;
        // no cutting a corner
        if (dr && dc && (!g.pass[r * g.w + cc] || !g.pass[rr * g.w + c])) continue;
        const nc = ci + (dr && dc ? SQRT2 : 1);
        if (S.stamp[j] === run && S.cost[j] <= nc) continue;
        S.stamp[j] = run;
        S.cost[j] = nc;
        S.from[j] = i;
        heap.push(j, nc + hOf(j));
      }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let i = t; i >= 0; i = S.from[i]) cells.push(i);
  cells.reverse();
  // pull the string tight: keep only the corners a straight walk needs
  const keep: number[] = [cells[0]];
  let a = 0;
  while (a < cells.length - 1) {
    // the farthest cell along the way still in a clear line from a
    let b = a + 1;
    while (b + 1 < cells.length && clear(g, cells[a], cells[b + 1])) b++;
    keep.push(cells[b]);
    a = b;
  }
  return keep.map((i) => round(centre(g, i)));
}

/** Cell centres lie on 0.25 m steps: two decimals keep them exact (a rounder point could graze a wall). */
const round = (p: Pt): Pt => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

/** The length of a way in metres. */
export function wayLength(pts: ReadonlyArray<Pt>): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

/** The point `d` metres along a way (clamped to its ends), and which way he faces there (yaw = atan2(dx, dz)). */
export function pointAlong(pts: ReadonlyArray<Pt>, d: number): { x: number; z: number; yaw: number } {
  if (!pts.length) return { x: 0, z: 0, yaw: 0 };
  if (pts.length === 1 || d <= 0) {
    const b = pts[1] ?? pts[0];
    return { x: pts[0][0], z: pts[0][1], yaw: Math.atan2(b[0] - pts[0][0], b[1] - pts[0][1]) };
  }
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= len) {
      const f = len ? d / len : 0;
      return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
    }
    d -= len;
  }
  const a = pts[pts.length - 2];
  const b = pts[pts.length - 1];
  return { x: b[0], z: b[1], yaw: Math.atan2(b[0] - a[0], b[1] - a[1]) };
}

/** The key a way is kept under: both ends on a 1 m grid (so near-same asks share one way). */
export function wayKey(ax: number, az: number, bx: number, bz: number): string {
  return `${Math.round(ax)},${Math.round(az)}>${Math.round(bx)},${Math.round(bz)}`;
}
