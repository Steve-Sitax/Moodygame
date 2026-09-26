// M7 rendering: occlusion horizons for a first-person city (after Downs, Moller and Sequin,
// "Occlusion Horizons for Driving through Urban Scenery", I3D 2001). The houses of the city are
// closed boxes from the ground up to their eaves (tools/blender/build_city.py: four walls 0..h,
// the roof on top), so seen from above they make a height map: 2.5D. From the eye, each thin
// slice of the view (a "bin", 1024 round the circle) keeps the highest slope any house has reached
// so far along it, out to the far fog. A thing whose top stays under that line in every slice it
// covers, and lies behind those houses, cannot be seen. The same march finds out whether any
// water can be seen at all (the river mirror is skipped when none can).
//
// Conservative by construction: a cell only counts as solid when the whole cell lies inside a
// house (the footprints are shrunk by a cell), and each sample along a slice takes the lowest
// height in a window as wide as the slice there (a gap between two houses is never bridged).
// Landmarks, sheds, boats, cranes and trees never occlude; only the houses of shared/city_build.json.

/** The height map: 1 m cells over the houses, in quarter metres (0 = open). */
export interface Heightfield {
  x0: number;
  z0: number;
  w: number;
  h: number;
  /** levels[k]: the lowest height within WINDOWS[k] cells (square), after the one-cell shrink. */
  levels: Uint8Array[];
  /** 1 where the cell (or a neighbour) is water or outside the map: water can show there. */
  water: Uint8Array;
  /** Lowest eave height of any house (m): below it, the mirrored eye test stays exact. */
  minHeight: number;
}

const UNIT = 0.25;
const WINDOWS = [0, 1, 2, 4, 8, 16, 32];

interface House {
  fp: number[][];
  h: number;
  /** Pulled down (the churches freed, 2026-09-26): not built. */
  gone?: boolean;
}

/**
 * Build the height map from the city plan (shared/city_build.json, loaded on its own so it stays
 * out of the main bundle) and the walk map's water (flags from world/city.ts).
 */
export async function buildHeightfield(flags: (x: number, z: number) => number | undefined, waterBits: number, outsideBits: number): Promise<Heightfield> {
  const plan = (await import("../../../shared/city_build.json")).default as unknown as { houses: House[] };
  const houses = plan.houses.filter((h) => h.fp?.length >= 3 && h.h > 0 && !h.gone);
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const hs of houses)
    for (const [x, z] of hs.fp) {
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
  x0 = Math.floor(x0) - 4;
  z0 = Math.floor(z0) - 4;
  const w = Math.ceil(x1) + 4 - x0;
  const h = Math.ceil(z1) + 4 - z0;
  const raw = new Uint8Array(w * h);
  let minHeight = Infinity;
  for (const hs of houses) {
    const q = Math.min(255, Math.floor(hs.h / UNIT));
    minHeight = Math.min(minHeight, hs.h);
    let bx0 = Infinity;
    let bz0 = Infinity;
    let bx1 = -Infinity;
    let bz1 = -Infinity;
    for (const [x, z] of hs.fp) {
      bx0 = Math.min(bx0, x);
      bz0 = Math.min(bz0, z);
      bx1 = Math.max(bx1, x);
      bz1 = Math.max(bz1, z);
    }
    const fp = hs.fp;
    for (let j = Math.max(0, Math.floor(bz0 - z0)); j <= Math.min(h - 1, Math.ceil(bz1 - z0)); j++) {
      const cz = z0 + j + 0.5;
      for (let i = Math.max(0, Math.floor(bx0 - x0)); i <= Math.min(w - 1, Math.ceil(bx1 - x0)); i++) {
        const cx = x0 + i + 0.5;
        // cell centre inside the footprint (even-odd rule)
        let inside = false;
        for (let a = 0, b = fp.length - 1; a < fp.length; b = a++) {
          const [xa, za] = fp[a];
          const [xb, zb] = fp[b];
          if (za > cz !== zb > cz && cx < ((xb - xa) * (cz - za)) / (zb - za) + xa) inside = !inside;
        }
        if (inside && q > raw[j * w + i]) raw[j * w + i] = q;
      }
    }
  }
  // shrink by one cell: a cell counts only when its neighbours' centres are inside too, so the
  // whole cell square is inside a house (a centre inside is not enough at the walls)
  const base = minFilter(raw, w, h, 1);
  const levels: Uint8Array[] = [base];
  for (let k = 1; k < WINDOWS.length; k++) levels.push(minFilter(levels[k - 1], w, h, WINDOWS[k] - WINDOWS[k - 1]));
  // water: the walk map's water or outside, grown by a cell (a cell partly water counts)
  const wet = new Uint8Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const f = flags(x0 + i + 0.5, z0 + j + 0.5);
      if (f === undefined || (f & (waterBits | outsideBits)) !== 0) wet[j * w + i] = 1;
    }
  const water = new Uint8Array(w * h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let any = 0;
      for (let dj = -1; dj <= 1 && !any; dj++)
        for (let di = -1; di <= 1; di++) {
          const a = i + di;
          const b = j + dj;
          if (a < 0 || b < 0 || a >= w || b >= h || wet[b * w + a]) {
            any = 1;
            break;
          }
        }
      water[j * w + i] = any;
    }
  return { x0, z0, w, h, levels, water, minHeight };
}

/** Square min filter of radius r (cells), separable; outside the grid counts as 0 (open). */
function minFilter(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return src.slice();
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) {
    const row = j * w;
    for (let i = 0; i < w; i++) {
      let m = 255;
      if (i - r < 0 || i + r >= w) m = 0;
      else for (let k = i - r; k <= i + r && m; k++) m = Math.min(m, src[row + k]);
      tmp[row + i] = m;
    }
  }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let m = 255;
      if (j - r < 0 || j + r >= h) m = 0;
      else for (let k = j - r; k <= j + r && m; k++) m = Math.min(m, tmp[k * w + i]);
      out[j * w + i] = m;
    }
  return out;
}

/** Nothing in the city stands higher than this (the cathedral's cross is at about 124 m). */
const TALLEST = 130;

/** The bins round the eye. */
export const BINS = 1024;
const BIN = (2 * Math.PI) / BINS;

/**
 * One occlusion horizon: from one eye, for the slices in view. `hz[b * ns + i]` is the highest
 * slope (height over distance) any house reached along slice b up to sample i.
 */
export class Horizon {
  /** Sample distances, and how far each sample's window reaches (a thing must lie beyond it). */
  private readonly r: Float32Array;
  private readonly reach: Float32Array;
  private readonly lvl: Uint8Array;
  readonly ns: number;
  private readonly hz: Float32Array;
  /** The heights met (quarter metres) per bin and sample, for derive(). */
  private readonly hq: Uint8Array;
  /** The last sample worked out (the horizon stays as it was past it). */
  private last = 0;
  /** Per bin, the sample where the march stopped: from there on everything up to TALLEST is hidden. */
  private readonly stop: Int16Array;
  /** Which bins were worked out (b0 .. b0 + nb - 1, round the circle). */
  private b0 = 0;
  private nb = 0;
  ex = 0;
  ey = 0;
  ez = 0;
  /** Any water within `waterR` that the eye can see (in the bins worked out). */
  waterSeen = false;
  ready = false;
  /** Samples worked out last time (cost). */
  work = 0;

  /**
   * `grow` (m): the houses shrink by this much more, so the horizon holds for any eye within `grow`
   * of the one it was worked out from (M7: worked out again only when the eye has moved that far).
   */
  constructor(maxR = 700, grow = 0) {
    const r: number[] = [];
    const reach: number[] = [];
    const lvl: number[] = [];
    let x = 1.0;
    while (x < maxR) {
      const dr = Math.max(0.5, x * 0.03);
      // the window must cover the whole slice there (half the bin across at the far edge) and
      // the radial step: a square of half-size a round the sample touches cells up to floor(a)+1 off
      const a = (x + dr / 2) * Math.tan(BIN / 2) + dr / 2 + grow;
      const need = Math.floor(a) + 1;
      let k = 0;
      while (k < WINDOWS.length - 1 && WINDOWS[k] < need) k++;
      r.push(x);
      reach.push(x + dr / 2);
      lvl.push(k);
      x += dr;
    }
    this.r = Float32Array.from(r);
    this.reach = Float32Array.from(reach);
    this.lvl = Uint8Array.from(lvl);
    this.ns = r.length;
    this.hz = new Float32Array(BINS * this.ns);
    this.hq = new Uint8Array(BINS * this.ns);
    this.stop = new Int16Array(BINS);
  }

  /**
   * Work out the horizon from the eye for the slices round `azimuth` (radians, atan2(z, x)),
   * `half` either side (Math.PI: all round), out to `maxR` metres. Water counts within `waterR`,
   * at the height `waterY` (the highest water, waves included).
   */
  compute(hf: Heightfield, ex: number, ey: number, ez: number, azimuth: number, half: number, maxR: number, waterR: number, waterY: number): void {
    this.ex = ex;
    this.ey = ey;
    this.ez = ez;
    const nb = half >= Math.PI ? BINS : Math.min(BINS, Math.ceil((2 * half) / BIN) + 2);
    const b0 = nb === BINS ? 0 : Math.floor((azimuth - half) / BIN) - 1;
    this.b0 = ((b0 % BINS) + BINS) % BINS;
    this.nb = nb;
    const ns = this.ns;
    let last = 0;
    while (last < ns - 1 && this.r[last] < maxR) last++;
    this.last = last;
    const { x0, z0, w, h, levels, water } = hf;
    const r = this.r;
    const reach = this.reach;
    const lvl = this.lvl;
    const hz = this.hz;
    const hq = this.hq;
    let waterSeen = false;
    let work = 0;
    for (let k = 0; k < nb; k++) {
      const b = (this.b0 + k) % BINS;
      const th = (b + 0.5) * BIN;
      const dx = Math.cos(th);
      const dz = Math.sin(th);
      let best = -Infinity;
      let before = -Infinity; // the horizon two samples back, for the water test
      let prev = -Infinity;
      const row = b * ns;
      let i = 0;
      for (; i <= last; i++) {
        work++;
        const rr = r[i];
        const ci = Math.floor(ex + dx * rr - x0);
        const cj = Math.floor(ez + dz * rr - z0);
        const inGrid = ci >= 0 && cj >= 0 && ci < w && cj < h;
        const q = inGrid ? levels[lvl[i]][cj * w + ci] : 0;
        hq[row + i] = q;
        if (q > 0) {
          const H = q * UNIT - ey;
          // the most careful distance for the slope: far for a wall over the eye, near for one below it
          const s = H / (H > 0 ? reach[i] : Math.max(0.3, rr - (reach[i] - rr)));
          if (s > best) best = s;
        }
        if (!waterSeen && rr <= waterR && (!inGrid || water[cj * w + ci])) {
          // the most visible water point in this sample (the farthest: the least steep down)
          if ((waterY - ey) / reach[i] > before) waterSeen = true;
        }
        before = prev;
        prev = best;
        hz[row + i] = best;
        // nothing up to TALLEST beyond here climbs over this: stop (hides() stops there too)
        if (best > (TALLEST - ey) / reach[i]) break;
      }
      this.stop[b] = Math.min(i, last);
    }
    this.waterSeen = waterSeen;
    this.work = work;
    this.ready = true;
  }

  /**
   * The same slices from another eye height over the same point (the puddles' mirrored eye): the
   * heights the main march found, no second march over the map.
   */
  derive(from: Horizon, ey: number, maxR: number): void {
    this.ex = from.ex;
    this.ey = ey;
    this.ez = from.ez;
    this.b0 = from.b0;
    this.nb = from.nb;
    let last = 0;
    while (last < this.ns - 1 && last < from.last && this.r[last] < maxR) last++;
    this.last = last;
    const ns = this.ns;
    const r = this.r;
    const reach = this.reach;
    const hq = from.hq;
    const hz = this.hz;
    for (let k = 0; k < this.nb; k++) {
      const b = (this.b0 + k) % BINS;
      const row = b * ns;
      let best = -Infinity;
      const end = Math.min(last, from.stop[b]);
      this.stop[b] = end;
      for (let i = 0; i <= end; i++) {
        const q = hq[row + i];
        if (q > 0) {
          const H = q * UNIT - ey;
          const s = H / (H > 0 ? reach[i] : Math.max(0.3, r[i] - (reach[i] - r[i])));
          if (s > best) best = s;
        }
        hz[row + i] = best;
      }
    }
    this.waterSeen = true;
    this.work = 0;
    this.ready = true;
  }

  /**
   * Is a sphere (centre, radius) hidden behind the houses from this eye? Only for spheres whose
   * slices were all worked out; anything else counts as seen.
   */
  hides(cx: number, cy: number, cz: number, radius: number): boolean {
    if (!this.ready) return false;
    const dx = cx - this.ex;
    const dz = cz - this.ez;
    const D = Math.hypot(dx, dz);
    const near = D - radius;
    if (near < 1.5) return false;
    // the last sample wholly in front of the sphere
    const reach = this.reach;
    if (reach[0] >= near) return false;
    let lo = 0;
    let hi = this.ns - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (reach[mid] < near) lo = mid;
      else hi = mid - 1;
    }
    if (lo > this.last) lo = this.last;
    const top = cy + radius - this.ey;
    const slope = top > 0 ? top / near : top / (D + radius);
    const az = Math.atan2(dz, dx);
    const half = Math.asin(Math.min(1, radius / D));
    let a0 = Math.floor((az - half) / BIN);
    const a1 = Math.floor((az + half) / BIN);
    if (a1 - a0 + 1 > this.nb) return false;
    const ns = this.ns;
    for (; a0 <= a1; a0++) {
      const b = ((a0 % BINS) + BINS) % BINS;
      // a bin not worked out: seen
      const k = (b - this.b0 + BINS) % BINS;
      if (k >= this.nb) return false;
      if (!(this.hz[b * ns + Math.min(lo, this.stop[b])] > slope + 1e-4)) return false;
    }
    return true;
  }
}
