import * as THREE from "three";
import CITY from "../../../shared/city.json";
import { footDirt, psx } from "../retro/psx";
import { modelCollider, modelShape } from "./modelCollision";
import { addProp } from "./propSpots";
import type { Rect } from "./geom";

// The wayside calvary (Steve, 2026-10-11: "this is very low poly. is it jesus? make it high detail"): a Flemish street
// calvary of the 19th century, the one model for every calvary in town. It stands at the foot of the Steen's ramp,
// facing the quay (world/steenlife.ts; the 1880 photograph), and in St James's churchyard (world/townplaces.ts).
//
// A bluestone plinth (footing, die with a sunk panel, cornice, the socket of the cross), an iron railing with spear
// heads in front and at the sides, the oak cross with chamfered beams and moulded ends, a little gabled hood over it,
// the INRI board, and the corpus, painted: the head bowed to his right under the crown of thorns, long hair and a
// beard, the arms out along the beam with the hands nailed, the ribs, the loincloth knotted at the right hip, the
// knees a little bent and the right foot over the left, one nail through both. On the cornice a votive lantern
// (not lit) and a pot of chrysanthemums.
//
// Built once in code (about 15,000 triangles, two draws a copy), two materials with the settings of the Steen's own (world/steenModel.ts:
// steen_blue and steen_metal), so no new shader kind. Its frame: origin at the foot of the plinth's front-to-back
// middle, front toward +z, y up; it fits in 2.1 x 1.8 m (the walk map's wall, tools/city/design.py DECOR calvary).

type V3 = [number, number, number];
type RGB = [number, number, number];

/** Where the Steen's calvary stands (shared/city.json decor.steen_ramp.calvary, as tools/blender/build_steen.py had it). */
export function steenCalvarySpot(): { x: number; z: number; yaw: number } | null {
  const r = (CITY as unknown as { decor?: { steen_ramp?: { calvary?: number[] } } }).decor?.steen_ramp?.calvary;
  if (!r || r.length < 4) return null;
  return { x: (r[0] + r[2]) / 2, z: r[3] - 0.9, yaw: 0 };
}

// ------------------------------------------------------------------ colours (linear, before the light)
const WOOD: RGB = [0.085, 0.06, 0.04]; // dark oiled oak
const ZINC: RGB = [0.3, 0.32, 0.33];
const IRON: RGB = [0.05, 0.06, 0.055];
const SKIN: RGB = [0.62, 0.41, 0.28];
const CLOTH: RGB = [0.78, 0.76, 0.7];
const HAIR: RGB = [0.11, 0.065, 0.04];
const BEARD: RGB = [0.16, 0.095, 0.055];
const BLOOD: RGB = [0.32, 0.03, 0.025];
const THORN: RGB = [0.16, 0.12, 0.06];
const BOARD: RGB = [0.8, 0.78, 0.7];
const LETTER: RGB = [0.04, 0.04, 0.04];
const GLASS: RGB = [0.42, 0.36, 0.22];
const POT: RGB = [0.42, 0.17, 0.08];
const LEAF: RGB = [0.08, 0.16, 0.05];
const STONE: RGB = [1, 1, 1];

/** A steady hash in 0..1 of a point: the weathering is the same on every load. */
function hash(x: number, y: number, z: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return s - Math.floor(s);
}
const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
/** 1 at the middle of a bump of half width w round c, 0 outside it. */
const bump = (x: number, c: number, w: number): number => {
  const d = Math.abs(x - c) / w;
  return d >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d);
};
/** The angle a minus b, folded into -pi..pi. */
const dang = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// ------------------------------------------------------------------ a bag of triangles with their normals and colours
class Part {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  constructor(readonly tile = 0) {}

  /** An indexed piece: smooth normals over shared vertices, or one normal a face. */
  mesh(vs: V3[], cs: RGB[], tris: number[], smoothNormals: boolean): void {
    const vn: V3[] = vs.map(() => [0, 0, 0]);
    const fn: V3[] = [];
    for (let i = 0; i < tris.length; i += 3) {
      const a = vs[tris[i]], b = vs[tris[i + 1]], c = vs[tris[i + 2]];
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
      const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      const n: V3 = [uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx];
      fn.push(n);
      for (const k of [tris[i], tris[i + 1], tris[i + 2]]) {
        vn[k][0] += n[0];
        vn[k][1] += n[1];
        vn[k][2] += n[2];
      }
    }
    const unit = (n: V3): V3 => {
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      return [n[0] / l, n[1] / l, n[2] / l];
    };
    for (let i = 0; i < tris.length; i += 3) {
      const f = unit(fn[i / 3]);
      for (let j = 0; j < 3; j++) {
        const k = tris[i + j];
        const p = vs[k];
        const n = smoothNormals ? unit(vn[k]) : f;
        this.pos.push(p[0], p[1], p[2]);
        this.nor.push(n[0], n[1], n[2]);
        this.col.push(cs[k][0], cs[k][1], cs[k][2], 1);
        if (this.tile) {
          // stone: the picture laid in world metres on the face's main plane
          const ax = Math.abs(f[0]), ay = Math.abs(f[1]), az = Math.abs(f[2]);
          const [u, v] = ay >= ax && ay >= az ? [p[0], p[2]] : ax >= az ? [p[2], p[1]] : [p[0], p[1]];
          this.uv.push(u / this.tile, v / this.tile);
        }
      }
    }
  }

  /** Rings of points (each the same count, closed round), joined into a tube; ends capped with a fan if asked. */
  loft(rings: V3[][], cols: RGB[][], capStart: boolean, capEnd: boolean, smoothNormals = true): void {
    const n = rings[0].length;
    const vs: V3[] = [];
    const cs: RGB[] = [];
    for (let i = 0; i < rings.length; i++) for (let j = 0; j < n; j++) {
      vs.push(rings[i][j]);
      cs.push(cols[i][j]);
    }
    // which way round the rings go: the first quad's normal must point away from the ring's middle
    const mid = (r: V3[]): V3 => {
      const m: V3 = [0, 0, 0];
      for (const p of r) for (let k = 0; k < 3; k++) m[k] += p[k] / r.length;
      return m;
    };
    const c0 = mid(rings[0]);
    const a = rings[0][0], b = rings[0][1 % n], c = rings[1][0];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const out = nx * (a[0] - c0[0]) + ny * (a[1] - c0[1]) + nz * (a[2] - c0[2]) > 0;
    const tris: number[] = [];
    const quad = (p: number, q: number, r: number, s: number) => {
      if (out) tris.push(p, q, r, q, s, r);
      else tris.push(p, r, q, q, r, s);
    };
    for (let i = 0; i + 1 < rings.length; i++)
      for (let j = 0; j < n; j++) quad(i * n + j, i * n + ((j + 1) % n), (i + 1) * n + j, (i + 1) * n + ((j + 1) % n));
    const cap = (ri: number, first: boolean) => {
      const m = mid(rings[ri]);
      // the cap's middle pushed out a little along the tube, so a limb ends round, not flat
      const nb = rings[first ? 1 : ri - 1] ? mid(rings[first ? 1 : ri - 1]) : m;
      const d: V3 = [m[0] - nb[0], m[1] - nb[1], m[2] - nb[2]];
      const k = vs.push([m[0] + d[0] * 0.35, m[1] + d[1] * 0.35, m[2] + d[2] * 0.35]) - 1;
      cs.push(cols[ri][0]);
      for (let j = 0; j < n; j++) {
        const p = ri * n + j, q = ri * n + ((j + 1) % n);
        if (out !== first) tris.push(p, q, k);
        else tris.push(q, p, k);
      }
    };
    if (capStart) cap(0, true);
    if (capEnd) cap(rings.length - 1, false);
    this.mesh(vs, cs, tris, smoothNormals);
  }

  /** A flat polygon (convex, its points in order): its normal from the winding. */
  poly(pts: V3[], c: RGB): void {
    const tris: number[] = [];
    for (let i = 1; i + 1 < pts.length; i++) tris.push(0, i, i + 1);
    this.mesh(pts, pts.map(() => c), tris, false);
  }

  /** A stack of level rectangles (half widths in x and z at heights), joined by flat sides, a lid on top. */
  stack(cx: number, cz: number, levels: Array<[number, number, number]>, col: (p: V3) => RGB, bottom = false): void {
    const rings = levels.map(([hx, hz, y]): V3[] => [[cx - hx, y, cz - hz], [cx + hx, y, cz - hz], [cx + hx, y, cz + hz], [cx - hx, y, cz + hz]]);
    for (let i = 0; i + 1 < rings.length; i++)
      for (let j = 0; j < 4; j++) {
        const a = rings[i][j], b = rings[i][(j + 1) % 4], c = rings[i + 1][(j + 1) % 4], d = rings[i + 1][j];
        if (Math.hypot(a[0] - d[0], a[2] - d[2]) < 1e-6 && Math.hypot(b[0] - c[0], b[2] - c[2]) < 1e-6 && Math.abs(a[1] - d[1]) < 1e-6) continue;
        // (the ring runs anticlockwise seen from above, so a, d, c, b faces out)
        const q: V3[] = [a, d, c, b];
        this.mesh(q, q.map(col), [0, 1, 2, 0, 2, 3], false);
      }
    const top = rings[rings.length - 1];
    const lid: V3[] = [top[0], top[3], top[2], top[1]];
    this.mesh(lid, lid.map(col), [0, 1, 2, 0, 2, 3], false);
    if (bottom) {
      const b = rings[0];
      this.mesh(b, b.map(col), [0, 1, 2, 0, 2, 3], false);
    }
  }

  /** A straight beam from a to b with a chamfered rectangular section (w across "side", h across the other way). */
  beam(a: V3, b: V3, side: V3, w: number, h: number, ch: number, col: (p: V3) => RGB, caps = true): void {
    const t = norm(sub(b, a));
    const s = norm(sub(side, scale(t, dot(side, t))));
    const u = cross(t, s);
    const hw = w / 2, hh = h / 2;
    // the octagon of the chamfered section
    const sec: Array<[number, number]> = [
      [hw - ch, -hh], [hw, -hh + ch], [hw, hh - ch], [hw - ch, hh], [-hw + ch, hh], [-hw, hh - ch], [-hw, -hh + ch], [-hw + ch, -hh],
    ];
    const ring = (o: V3): V3[] => sec.map(([x, y]) => add(o, add(scale(s, x), scale(u, y))));
    const r0 = ring(a), r1 = ring(b);
    const out = dot(cross(sub(r0[1], r0[0]), sub(r1[0], r0[0])), sub(r0[0], a)) > 0;
    for (let j = 0; j < 8; j++) {
      const p = r0[j], q = r0[(j + 1) % 8], r = r1[(j + 1) % 8], o = r1[j];
      const quad: V3[] = out ? [p, q, r, o] : [p, o, r, q];
      this.mesh(quad, quad.map(col), [0, 1, 2, 0, 2, 3], false);
    }
    if (caps) {
      this.poly(out ? [...r1] : [...r1].reverse(), col(b));
      this.poly(out ? [...r0].reverse() : [...r0], col(a));
    }
  }

  /** A box between two corners. */
  box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: (p: V3) => RGB): void {
    this.stack((x0 + x1) / 2, (z0 + z1) / 2, [[(x1 - x0) / 2, (z1 - z0) / 2, y0], [(x1 - x0) / 2, (z1 - z0) / 2, y1]], col, true);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    // (four channels, the alpha 1, as the Steen's glb has them: the same shader programs serve both)
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 4));
    if (this.tile) g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => scale(a, 1 / (Math.hypot(a[0], a[1], a[2]) || 1));
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Catmull-Rom through key points, `per` steps a span: the centres and the key parameter (0..keys-1) of each. */
function spline(keys: V3[], per: number): Array<{ p: V3; k: number }> {
  const out: Array<{ p: V3; k: number }> = [];
  const at = (i: number) => keys[Math.max(0, Math.min(keys.length - 1, i))];
  for (let i = 0; i < keys.length - 1; i++)
    for (let s = 0; s < per; s++) {
      const t = s / per;
      const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
      const t2 = t * t, t3 = t2 * t;
      const p: V3 = [0, 1, 2].map((k) => 0.5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as V3;
      out.push({ p, k: i + t });
    }
  out.push({ p: keys[keys.length - 1], k: keys.length - 1 });
  return out;
}

/** Linear between key values at a key parameter. */
function keyAt(vals: number[], k: number): number {
  const i = Math.min(vals.length - 2, Math.floor(k));
  const t = k - i;
  return vals[i] + (vals[i + 1] - vals[i]) * t;
}

/**
 * A limb: a smooth tube through key points with elliptic sections (ra along the reference direction made square to
 * the tube, rb across), coloured by a function of the point, the key parameter and the angle round.
 */
function limb(part: Part, keys: V3[], ra: number[], rb: number[], ref: V3, n: number, per: number, col: (p: V3, k: number, th: number) => RGB, capStart = false, capEnd = true): void {
  const path = spline(keys, per);
  const rings: V3[][] = [];
  const cols: RGB[][] = [];
  for (let i = 0; i < path.length; i++) {
    const { p, k } = path[i];
    const q = path[Math.min(path.length - 1, i + 1)].p, o = path[Math.max(0, i - 1)].p;
    const t = norm(sub(q, o));
    const a = norm(sub(ref, scale(t, dot(ref, t))));
    const b = cross(t, a);
    const A = keyAt(ra, k), B = keyAt(rb, k);
    const ring: V3[] = [];
    const cr: RGB[] = [];
    for (let j = 0; j < n; j++) {
      const th = (j / n) * Math.PI * 2;
      const v = add(p, add(scale(a, A * Math.cos(th)), scale(b, B * Math.sin(th))));
      ring.push(v);
      cr.push(col(v, k, th));
    }
    rings.push(ring);
    cols.push(cr);
  }
  part.loft(rings, cols, capStart, capEnd);
}

// ------------------------------------------------------------------ the parts

function plinth(st: Part): void {
  const weather = (p: V3): RGB => {
    // darker low down (splash and damp) and in streaks under the cornice, a little mottled
    const k = 0.86 + 0.16 * smooth(0.0, 0.5, p[1]) - 0.08 * hash(Math.round(p[0] * 7), Math.round(p[1] * 7), Math.round(p[2] * 7));
    return mul(STONE, k);
  };
  // the footing, the die's base moulding, the die, the cornice with its chamfered underside, the socket of the cross
  st.stack(0, 0, [[0.8, 0.62, 0], [0.8, 0.62, 0.15], [0.77, 0.59, 0.18]], weather);
  st.stack(0, 0, [[0.66, 0.51, 0.18], [0.66, 0.51, 0.25], [0.62, 0.47, 0.29]], weather);
  st.stack(0, 0, [[0.58, 0.43, 0.29], [0.58, 0.43, 0.92]], weather);
  st.stack(0, 0, [[0.58, 0.43, 0.92], [0.7, 0.55, 0.98], [0.72, 0.57, 0.99], [0.72, 0.57, 1.06], [0.69, 0.54, 1.08]], weather);
  st.stack(0, 0, [[0.22, 0.2, 1.08], [0.22, 0.2, 1.24], [0.18, 0.16, 1.29]], weather);
  // the sunk panel on the front of the die: a raised frame round it, 2 cm proud
  const f = 0.43, w = 0.03;
  st.box(-0.42, 0.42, 0.4, 0.4 + w, f, f + 0.02, weather);
  st.box(-0.42, 0.42, 0.82 - w, 0.82, f, f + 0.02, weather);
  st.box(-0.42, -0.42 + w, 0.4 + w, 0.82 - w, f, f + 0.02, weather);
  st.box(0.42 - w, 0.42, 0.4 + w, 0.82 - w, f, f + 0.02, weather);
  // a carved cross in the panel (raised 1 cm)
  st.box(-0.018, 0.018, 0.47, 0.76, f, f + 0.012, weather);
  st.box(-0.1, 0.1, 0.645, 0.681, f, f + 0.012, weather);
}

function railing(pt: Part): void {
  const iron = (p: V3): RGB => mul(IRON, 0.85 + 0.3 * hash(p[0] * 3, p[1] * 3, p[2] * 3));
  const zf = 0.84, xs = 0.98, zb = -0.62, top = 0.94;
  const post = (x: number, z: number) => {
    pt.box(x - 0.022, x + 0.022, 0, top + 0.04, z - 0.022, z + 0.022, iron);
    // a cast knob on each corner post
    limb(pt, [[x, top + 0.04, z], [x, top + 0.075, z], [x, top + 0.11, z]], [0.022, 0.032, 0.006], [0.022, 0.032, 0.006], [1, 0, 0], 6, 2, () => IRON, false, true);
  };
  const bars = (ax: number, az: number, bx: number, bz: number, count: number) => {
    for (let i = 1; i < count; i++) {
      const t = i / count;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      pt.box(x - 0.011, x + 0.011, 0.02, top, z - 0.011, z + 0.011, iron);
      // the spear head
      const h = top + 0.01;
      pt.stack(x, z, [[0.011, 0.011, h - 0.01], [0.026, 0.012, h + 0.02], [0.001, 0.001, h + 0.075]], iron);
    }
  };
  const rails = (ax: number, az: number, bx: number, bz: number) => {
    for (const y of [0.1, top - 0.1]) {
      const x0 = Math.min(ax, bx) - 0.012, x1 = Math.max(ax, bx) + 0.012, z0 = Math.min(az, bz) - 0.012, z1 = Math.max(az, bz) + 0.012;
      pt.box(x0, x1, y - 0.016, y + 0.016, z0, z1, iron);
    }
  };
  post(-xs, zf);
  post(xs, zf);
  post(-xs, zb);
  post(xs, zb);
  bars(-xs, zf, xs, zf, 13);
  rails(-xs, zf, xs, zf);
  for (const sx of [-xs, xs]) {
    bars(sx, zb, sx, zf, 9);
    rails(sx, zb, sx, zf);
  }
}

/** Oak, oiled dark, greyed where the rain runs and on the tops. */
function oak(p: V3): RGB {
  const grain = 0.82 + 0.3 * hash(Math.round(p[0] * 40), Math.round(p[1] * 6), Math.round(p[2] * 40));
  return mul(WOOD, grain);
}

const POST_W = 0.16, POST_D = 0.14, BEAM_Y = 4.14, BEAM_H = 0.14, BEAM_D = 0.12, ARM = 1.0, POST_TOP = 5.04;
const FRONT = POST_D / 2; // the post's front face

function cross_(pt: Part): void {
  // the post, from the socket up under the hood, and the cross-beam over it
  pt.beam([0, 1.2, 0], [0, POST_TOP, 0], [1, 0, 0], POST_W, POST_D, 0.022, oak);
  pt.beam([-ARM, BEAM_Y, 0], [ARM, BEAM_Y, 0], [0, 1, 0], BEAM_H, BEAM_D, 0.02, oak);
  // moulded ends on the arms and a collar at the crossing
  for (const s of [-1, 1]) {
    pt.beam([s * (ARM - 0.075), BEAM_Y, 0], [s * (ARM + 0.01), BEAM_Y, 0], [0, 1, 0], BEAM_H + 0.035, BEAM_D + 0.03, 0.02, oak);
    pt.beam([s * (ARM + 0.01), BEAM_Y, 0], [s * (ARM + 0.04), BEAM_Y, 0], [0, 1, 0], BEAM_H - 0.02, BEAM_D - 0.02, 0.02, oak);
  }
  pt.beam([0, 1.29, 0], [0, 1.36, 0], [1, 0, 0], POST_W + 0.04, POST_D + 0.04, 0.02, oak);
  // the foot rest the feet are nailed over
  pt.beam([0.02, 2.402, FRONT - 0.005], [0.02, 2.402, FRONT + 0.095], [1, 0, 0], 0.12, 0.035, 0.008, oak);

  // the hood: a gable with its ridge front to back, boards 2 cm thick, bargeboards and a small cross on the front
  const zb = -0.15, zf = 0.42, hw = 0.36, ry = POST_TOP + 0.3, ey = POST_TOP + 0.04, t = 0.022;
  const zinc = (p: V3): RGB => mul(ZINC, 0.85 + 0.25 * hash(p[0] * 9, p[1] * 9, p[2] * 9));
  for (const s of [-1, 1]) {
    const slope: V3[] = [[0, ry, zb], [0, ry, zf], [s * hw, ey, zf], [s * hw, ey, zb]];
    const under: V3[] = slope.map((p) => [p[0], p[1] - t, p[2]]);
    pt.poly(s > 0 ? slope : [...slope].reverse(), ZINC);
    pt.poly(s > 0 ? [...under].reverse() : under, mul(WOOD, 1.2));
    // the boards' edges at the eaves, front and back
    const e: V3[] = [[s * hw, ey, zb], [s * hw, ey, zf], [s * hw, ey - t, zf], [s * hw, ey - t, zb]];
    pt.poly(s > 0 ? e : [...e].reverse(), zinc(e[0]));
    // the bargeboard on the front gable, with a scalloped lower edge (three teeth)
    const L = Math.hypot(hw, ry - ey);
    const dir: V3 = [(s * hw) / L, (ey - ry) / L, 0];
    const down: V3 = norm(cross(dir, [0, 0, s]));
    for (const z of [zf + 0.002, zb - 0.025]) {
      // (the board's middle line 3 cm under the roof's edge, so its top runs along the roof)
      const a: V3 = add([0, ry + 0.01, z], scale(down, 0.03)), b: V3 = add(add([s * hw, ey + 0.01, z], scale(dir, 0.03)), scale(down, 0.03));
      pt.beam(a, b, down, 0.07, 0.024, 0.006, oak);
      if (z > 0) for (let k = 1; k <= 3; k++) {
        const c = lerp3(a, b, k / 4);
        const tip = add(c, scale(down, 0.07));
        pt.poly(s > 0 ? [add(c, scale(dir, -0.03)), add(c, scale(dir, 0.03)), tip] : [add(c, scale(dir, 0.03)), add(c, scale(dir, -0.03)), tip], oak(c));
      }
    }
  }
  // the back gable closed with a board, the front open under the hood
  pt.poly([[-hw, ey - t, zb + 0.001], [0, ry - t, zb + 0.001], [hw, ey - t, zb + 0.001]], mul(WOOD, 1.1));
  pt.poly([[hw, ey - t, zb - 0.001], [0, ry - t, zb - 0.001], [-hw, ey - t, zb - 0.001]], mul(WOOD, 1.1));
  // a ridge roll and a small finial cross on the front apex
  pt.beam([0, ry + 0.005, zb - 0.02], [0, ry + 0.005, zf + 0.02], [1, 0, 0], 0.035, 0.03, 0.01, zinc);
  pt.beam([0, ry, zf + 0.015], [0, ry + 0.2, zf + 0.015], [1, 0, 0], 0.026, 0.026, 0.006, zinc);
  pt.beam([-0.055, ry + 0.135, zf + 0.015], [0.055, ry + 0.135, zf + 0.015], [0, 1, 0], 0.024, 0.024, 0.006, zinc);

  // the INRI board over the crossing: white with black letters, 3 mm proud
  const by0 = BEAM_Y + BEAM_H / 2 + 0.07, by1 = by0 + 0.13, bz = FRONT + 0.018;
  pt.box(-0.16, 0.16, by0, by1, FRONT, bz, (p) => mul(BOARD, 0.9 + 0.1 * hash(p[0] * 50, p[1] * 50, 3)));
  const lz1 = bz + 0.004;
  const sw = 0.013;
  const ly0 = by0 + 0.028, ly1 = by1 - 0.028;
  const stroke = (x0: number, y0: number, x1: number, y1: number) => {
    // a stroke from (x0, y0) to (x1, y1) on the board, sw wide
    const d = norm([x1 - x0, y1 - y0, 0]);
    const nx = -d[1] * (sw / 2), ny = d[0] * (sw / 2);
    const q: V3[] = [[x0 - nx, y0 - ny, lz1], [x1 - nx, y1 - ny, lz1], [x1 + nx, y1 + ny, lz1], [x0 + nx, y0 + ny, lz1]];
    const turn = (d[0] * ny - d[1] * nx) > 0;
    pt.poly(turn ? q : [...q].reverse(), LETTER);
  };
  const lh = ly1 - ly0;
  let x = -0.115;
  // I
  stroke(x, ly0, x, ly1);
  x += 0.04;
  // N
  stroke(x, ly0, x, ly1);
  stroke(x, ly1, x + 0.045, ly0);
  stroke(x + 0.045, ly0, x + 0.045, ly1);
  x += 0.075;
  // R: the stem, the bowl as three strokes, the leg
  stroke(x, ly0, x, ly1);
  stroke(x, ly1 - sw / 2, x + 0.032, ly1 - sw / 2);
  stroke(x + 0.032, ly1, x + 0.04, ly1 - lh * 0.25);
  stroke(x + 0.04, ly1 - lh * 0.25, x + 0.032, ly0 + lh * 0.47);
  stroke(x + 0.032, ly0 + lh * 0.47, x, ly0 + lh * 0.47);
  stroke(x + 0.015, ly0 + lh * 0.47, x + 0.045, ly0);
  x += 0.08;
  // I
  stroke(x, ly0, x, ly1);
}

// The corpus. Its right is -x (it faces +z). Heights for a figure of about 1.65 m, the feet at 2.42 m.
const SWAY = 0.03; // the hips sag to his left, the head falls to his right

function skinAt(p: V3): RGB {
  // the paint a little greyed and worn, darker in the hollows the rain does not reach
  const w = 0.9 + 0.12 * hash(Math.round(p[0] * 60), Math.round(p[1] * 60), Math.round(p[2] * 60));
  return mul(SKIN, w);
}

function torso(pt: Part): void {
  // key heights with half width (x), half depth (z), the middle's x and z
  const keys: Array<[number, number, number, number, number]> = [
    [3.28, 0.15, 0.1, SWAY, 0.18],
    [3.38, 0.158, 0.106, SWAY, 0.183],
    [3.47, 0.132, 0.088, SWAY * 0.7, 0.172],
    [3.55, 0.124, 0.08, SWAY * 0.4, 0.165],
    [3.63, 0.138, 0.1, SWAY * 0.2, 0.178],
    [3.72, 0.152, 0.116, 0.0, 0.19],
    [3.81, 0.158, 0.12, -0.005, 0.195],
    [3.89, 0.165, 0.112, -0.008, 0.19],
    [3.95, 0.158, 0.095, -0.01, 0.182],
    [4.0, 0.115, 0.075, -0.012, 0.172],
    [4.035, 0.058, 0.052, -0.015, 0.175],
    [4.09, 0.05, 0.048, -0.022, 0.182],
  ];
  const ys = keys.map((k) => k[0]);
  const at = (y: number, i: number): number => {
    let j = 0;
    while (j < keys.length - 2 && ys[j + 1] < y) j++;
    const t = Math.min(1, Math.max(0, (y - ys[j]) / (ys[j + 1] - ys[j])));
    const s = t * t * (3 - 2 * t);
    return keys[j][i] + (keys[j + 1][i] - keys[j][i]) * s;
  };
  const N = 28;
  const rings: V3[][] = [];
  const cols: RGB[][] = [];
  for (let y = 3.28; y <= 4.0901; y += 0.012) {
    const hx = at(y, 1), hz = at(y, 2), cx = at(y, 3), cz = at(y, 4);
    const ring: V3[] = [];
    const cr: RGB[] = [];
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2; // 0 = his left side (+x), pi/2 = the front (+z)
      const front = Math.sin(th);
      let r = 1;
      let shade = 1;
      // the back flatter against the post
      if (front < 0) r *= 1 + 0.12 * front;
      // the ribs: four or five ridges on each flank under the chest, sloping down toward the front
      const offMid = Math.abs(dang(th, Math.PI / 2));
      const ribW = smooth(0.42, 0.7, offMid) * (1 - smooth(1.45, 1.75, offMid)) * bump(y, 3.71, 0.1);
      if (ribW > 0) {
        const ph = (y + 0.03 * front - 3.6) / 0.04;
        const rib = 0.5 + 0.5 * Math.cos(ph * Math.PI * 2);
        r += ribW * (0.028 * rib - 0.012);
        shade *= 1 - ribW * 0.14 * (1 - rib);
      }
      // the breastbone a shallow groove, the chest muscles over the ribs, the belly drawn in, the navel
      r -= 0.025 * bump(offMid, 0, 0.16) * bump(y, 3.78, 0.12);
      r += 0.05 * bump(offMid, 0.62, 0.42) * bump(y, 3.87, 0.06) * (front > 0 ? 1 : 0);
      r -= 0.04 * bump(y, 3.55, 0.07) * smooth(0, 0.6, front);
      if (offMid < 0.12 && Math.abs(y - 3.535) < 0.01) shade *= 0.6;
      // the lower edge of the ribcage a soft step over the drawn-in belly
      shade *= 1 - 0.1 * bump(y, 3.625, 0.02) * smooth(0.2, 0.5, offMid) * (1 - smooth(1.3, 1.6, offMid));
      // the hip bones under the cloth's top
      r += 0.04 * bump(offMid, 1.05, 0.3) * bump(y, 3.43, 0.05);
      const p: V3 = [cx + hx * r * Math.cos(th), y, cz + hz * r * Math.sin(th)];
      ring.push(p);
      let c = mul(skinAt(p), shade);
      // the wound in his right side, with a trickle down from it
      const wound = bump(dang(th, Math.PI - 0.6), 0, 0.14) * bump(y, 3.67, 0.025);
      const trickle = bump(dang(th, Math.PI - 0.62), 0, 0.06) * smooth(3.5, 3.55, y) * (1 - smooth(3.66, 3.68, y));
      c = mix(c, BLOOD, Math.min(1, wound * 1.4 + trickle * 0.8));
      cr.push(c);
    }
    rings.push(ring);
    cols.push(cr);
  }
  pt.loft(rings, cols, true, false);
}

function arms(pt: Part): void {
  for (const s of [-1, 1]) {
    // from inside the shoulder out to the fingertips on the beam (the beam's front at z = 0.06)
    const keys: V3[] = [
      [s * 0.1, 3.93, 0.185], [s * 0.18, 3.955, 0.18], [s * 0.3, 3.995, 0.16], [s * 0.46, 4.055, 0.125], [s * 0.6, 4.11, 0.103],
      [s * 0.75, 4.16, 0.088], [s * 0.82, 4.175, 0.08], [s * 0.88, 4.185, 0.076], [s * 0.95, 4.19, 0.074],
    ];
    const ra = [0.062, 0.058, 0.05, 0.038, 0.042, 0.026, 0.042, 0.045, 0.03];
    const rb = [0.06, 0.054, 0.045, 0.034, 0.036, 0.02, 0.016, 0.014, 0.01];
    const nailX = s * 0.865;
    limb(pt, keys, ra, rb, [0, 1, 0], 14, 4, (p, k) => {
      let c = skinAt(p);
      // the blood from the nail running down the heel of the hand and the wrist
      const fromNail = Math.hypot(p[0] - nailX, p[1] - 4.18);
      if (k > 5.2 && fromNail < 0.03) c = mix(c, BLOOD, 0.75);
      if (k > 4.6 && k < 6.2 && p[1] < 4.17 && Math.abs(p[0] - (nailX - s * 0.04)) < 0.03) c = mix(c, BLOOD, 0.45);
      return c;
    });
    // the thumb, lying along the beam's top edge
    limb(pt, [[s * 0.83, 4.19, 0.085], [s * 0.85, 4.215, 0.088], [s * 0.875, 4.228, 0.086]], [0.014, 0.012, 0.009], [0.012, 0.01, 0.008], [0, 0, 1], 6, 2, (p) => skinAt(p));
    // the nail
    pt.stack(nailX, 0.093, [[0.012, 0.012, 4.165], [0.012, 0.012, 4.191]], () => IRON);
    pt.box(nailX - 0.009, nailX + 0.009, 4.169, 4.187, 0.093, 0.104, () => IRON);
  }
}

function legs(pt: Part): void {
  for (const s of [-1, 1]) {
    const right = s < 0;
    // the right leg crosses in front of the left, its foot over the left foot
    const keys: V3[] = right
      ? [[-0.06 + SWAY, 3.42, 0.18], [-0.058 + SWAY * 0.8, 3.22, 0.205], [-0.042, 3.04, 0.232], [-0.03, 2.96, 0.244], [-0.022, 2.88, 0.234], [-0.012, 2.77, 0.2], [0.0, 2.63, 0.152]]
      : [[0.065 + SWAY, 3.42, 0.178], [0.068 + SWAY * 0.6, 3.22, 0.2], [0.06, 3.04, 0.222], [0.054, 2.96, 0.232], [0.05, 2.88, 0.222], [0.046, 2.77, 0.178], [0.04, 2.63, 0.118]];
    const ra = [0.082, 0.072, 0.052, 0.047, 0.043, 0.046, 0.029];
    const rb = [0.085, 0.076, 0.056, 0.05, 0.047, 0.054, 0.032];
    limb(pt, keys, ra, rb, [1, 0, 0], 14, 4, (p, k) => {
      const c = skinAt(p);
      // the knee cap a little paler, the shin's blood from the feet up a little way
      return k > 2.7 && k < 3.3 ? mul(c, 1.04) : c;
    }, false, false);
    // the foot, pointed down, its sole against the post (the left) or on the left foot (the right)
    const fk: V3[] = right
      ? [[0.0, 2.65, 0.155], [0.008, 2.6, 0.158], [0.02, 2.52, 0.162], [0.032, 2.46, 0.162], [0.038, 2.425, 0.16]]
      : [[0.04, 2.65, 0.12], [0.042, 2.6, 0.104], [0.046, 2.52, 0.1], [0.05, 2.46, 0.104], [0.052, 2.425, 0.108]];
    const fa = [0.03, 0.034, 0.039, 0.036, 0.024];
    const fb = [0.032, 0.03, 0.022, 0.016, 0.01];
    limb(pt, fk, fa, fb, [1, 0, 0], 12, 3, (p) => {
      const c = skinAt(p);
      const nail = Math.hypot(p[0] - 0.03, p[1] - 2.53);
      return nail < 0.035 ? mix(c, BLOOD, 0.7 * (1 - nail / 0.035) + 0.2) : c;
    });
    // the heel, a round knob behind the ankle
    limb(pt, right ? [[0.004, 2.64, 0.13], [0.006, 2.615, 0.128], [0.008, 2.6, 0.13]] : [[0.042, 2.64, 0.094], [0.044, 2.615, 0.086], [0.045, 2.6, 0.088]], [0.022, 0.026, 0.012], [0.02, 0.022, 0.01], [1, 0, 0], 8, 2, (p) => skinAt(p), true, true);
  }
  // one nail through both feet into the post
  pt.stack(0.03, 0.18, [[0.013, 0.013, 2.52], [0.013, 0.013, 2.546]], () => IRON);
  pt.box(0.022, 0.038, 2.524, 2.542, 0.17, 0.188, () => IRON);
}

function loincloth(pt: Part): void {
  const N = 30;
  const rings: V3[][] = [];
  const cols: RGB[][] = [];
  const S = 10;
  for (let i = 0; i <= S; i++) {
    const s = i / S; // 0 the hem, 1 the waist roll
    const ring: V3[] = [];
    const cr: RGB[] = [];
    for (let j = 0; j < N; j++) {
      const th = (j / N) * Math.PI * 2;
      // the hem lower on his right side, where the cloth is knotted, higher on the left
      const hem = 3.17 + 0.05 * (0.5 + 0.5 * Math.cos(th)) + 0.03 * Math.sin(th);
      const y = hem + (3.47 - hem) * s;
      const fold = Math.sin(8 * th + 1.7 * s + 0.6) * 0.5 + Math.sin(13 * th - 0.8) * 0.25;
      let r = 1 + 0.07 * fold * (1 - s) ** 0.7;
      if (s > 0.85) r += 0.06 * bump(s, 0.95, 0.12);
      const front = Math.sin(th);
      if (front < 0) r *= 1 + 0.1 * front;
      const hx = 0.178 - 0.01 * s, hz = 0.128 - 0.006 * s;
      const p: V3 = [SWAY + hx * r * Math.cos(th), y, 0.182 + hz * r * Math.sin(th)];
      ring.push(p);
      // the folds' hollows darker, the cloth weathered a little at the hem
      cr.push(mul(CLOTH, (0.86 + 0.14 * fold * (1 - s)) * (0.88 + 0.12 * s) * (0.95 + 0.08 * hash(j, i, 2))));
    }
    rings.push(ring);
    cols.push(cr);
  }
  pt.loft(rings, cols, false, false);
  // the knot at his right hip and the end hanging from it
  const knot = (p: V3): RGB => mul(CLOTH, 0.85 + 0.15 * hash(p[0] * 80, p[1] * 80, p[2] * 80));
  limb(pt, [[-0.1 + SWAY, 3.435, 0.262], [-0.13 + SWAY, 3.43, 0.27], [-0.155 + SWAY, 3.415, 0.258]], [0.03, 0.04, 0.026], [0.026, 0.034, 0.022], [0, 1, 0], 10, 3, knot, true, true);
  // (its width lies along the cloth at his right side)
  limb(pt, [[-0.15 + SWAY, 3.42, 0.25], [-0.168 + SWAY, 3.3, 0.243], [-0.178 + SWAY, 3.18, 0.232], [-0.18 + SWAY, 3.07, 0.226]], [0.042, 0.048, 0.036, 0.012], [0.011, 0.011, 0.009, 0.005], [0.52, 0, 0.86], 10, 3, (p) => mul(knot(p), 0.95), true, true);
}

/** The head, in its own frame (origin at the top of the neck, face toward +z), then bowed into place. */
function head(pt: Part): void {
  const bow = new THREE.Matrix4()
    .makeTranslation(-0.024, 4.07, 0.185)
    .multiply(new THREE.Matrix4().makeRotationZ(0.42)) // to his right
    .multiply(new THREE.Matrix4().makeRotationX(0.42)); // and forward
  const v = new THREE.Vector3();
  const place = (p: V3): V3 => {
    v.set(p[0], p[1], p[2]).applyMatrix4(bow);
    return [v.x, v.y, v.z];
  };
  // the skull: a sphere pushed into a head, by latitude (psi, -pi/2 the chin) and azimuth (phi, 0 the face)
  const C: V3 = [0, 0.105, 0.012];
  const RX = 0.074, RY = 0.106, RZ = 0.095;
  const LAT = 30, LON = 40;
  const rings: V3[][] = [];
  const cols: RGB[][] = [];
  for (let i = 1; i < LAT; i++) {
    const psi = -Math.PI / 2 + (i / LAT) * Math.PI;
    const ring: V3[] = [];
    const cr: RGB[] = [];
    for (let j = 0; j < LON; j++) {
      const phi = (j / LON) * Math.PI * 2;
      const face = Math.cos(phi); // 1 straight ahead
      const side = Math.sin(phi);
      const sp = Math.sin(psi), cp = Math.cos(psi);
      let rx = RX, rz = RZ, dy = 0;
      // the jaw narrower, the back of the skull fuller
      rx *= 1 - 0.22 * smooth(0, 0.9, -sp);
      if (face < 0) rz *= 1 + 0.08 * -face * smooth(-0.3, 0.4, sp);
      let out = 0;
      const offFace = Math.abs(dang(phi, 0));
      // the nose (higher toward its tip), the brow, the hollows of the closed eyes, the cheek bones
      const nose = smooth(0.24, -0.18, psi) * (1 - smooth(-0.2, -0.3, psi)) * bump(offFace, 0, 0.22);
      out += 0.026 * nose;
      out += 0.011 * bump(offFace, 0, 0.85) * bump(psi, 0.3, 0.11);
      const eye = bump(offFace, 0.4, 0.2) * bump(psi, 0.17, 0.11);
      out -= 0.016 * eye;
      out += 0.007 * bump(offFace, 0.8, 0.3) * bump(psi, -0.02, 0.16);
      // the beard: on the jaw and the chin, with a moustache, the cheeks above it bare; a forked point under the chin
      const jaw = smooth(-0.12, -0.32, psi + 0.12 * smooth(0.4, 1.0, offFace)) * (1 - smooth(1.25, 1.6, offFace));
      const moustache = bump(psi, -0.3, 0.06) * (1 - smooth(0.3, 0.5, offFace));
      const beardZone = Math.max(jaw, moustache);
      out += jaw * 0.014 + 0.024 * bump(offFace, 0, 0.55) * bump(psi, -1.0, 0.35);
      if (psi < -0.9) dy = -0.016 * bump(offFace, 0, 0.6);
      const dir: V3 = [side * cp, sp, face * cp];
      const p: V3 = [C[0] + rx * side * cp + out * dir[0], C[1] + RY * sp + dy, C[2] + rz * face * cp + out * dir[2]];
      ring.push(place(p));
      // the paint: skin on the face, the hair dark on the top and back, the beard, the eyes' shadow, blood from the thorns
      let c = skinAt(p);
      // (the hair line high on the brow, lower at the temples; parted in the middle)
      const line = 0.6 - 0.3 * smooth(0.25, 1.0, offFace);
      const hairZone = Math.max(smooth(line - 0.04, line + 0.04, psi), smooth(1.2, 1.35, offFace));
      c = mix(c, mul(HAIR, 0.9 + 0.2 * hash(i, j, 1)), hairZone);
      c = mix(c, mul(BEARD, 0.9 + 0.2 * hash(i, j, 6)), beardZone * (1 - hairZone));
      c = mul(c, 1 - 0.5 * eye);
      if (Math.abs(psi + 0.4) < 0.035 && offFace < 0.22) c = mul(HAIR, 0.5); // the mouth
      const drop = bump(psi, 0.42, 0.1) * Math.max(bump(offFace, 0.15, 0.06), bump(offFace, 0.55, 0.06));
      c = mix(c, BLOOD, drop * 0.9);
      cr.push(c);
    }
    rings.push(ring);
    cols.push(cr);
  }
  pt.loft(rings, cols, true, true);

  // the long hair falling behind and at the sides to the shoulders (the face left open), a lock forward on his right
  const HL = 12, HN = 14;
  const hr: V3[][] = [];
  const hc: RGB[][] = [];
  for (let i = 0; i <= HL; i++) {
    const t = i / HL; // 0 high on the head, 1 the ends on the shoulders
    const y = C[1] + 0.07 - t * 0.27;
    const ring: V3[] = [];
    const cr: RGB[] = [];
    for (let j = 0; j <= HN; j++) {
      // from his left temple round the back to his right temple
      const phi = 1.05 + (j / HN) * (2 * Math.PI - 2.1);
      const k = y > C[1] ? Math.sqrt(Math.max(0.05, 1 - ((y - C[1]) / RY) ** 2)) : 1;
      const flare = 1.07 + 0.16 * smooth(0.45, 1, t) + 0.02 * Math.sin(j * 2.3 + i);
      let px = C[0] + RX * k * flare * Math.sin(phi);
      let pz = C[2] + RZ * k * flare * Math.cos(phi) - 0.025 * t;
      // the strands narrow toward the face's sides as they fall
      if (Math.cos(phi) > 0) px *= 1 - 0.15 * t;
      if (Math.cos(phi) > 0 && Math.sin(phi) < 0) pz += 0.03 * t; // the lock over his right shoulder
      ring.push(place([px, y, pz]));
      cr.push(mul(HAIR, 0.8 + 0.3 * hash(j, i, 4)));
    }
    hr.push(ring);
    hc.push(cr);
  }
  // an open sheet, not a closed ring: joined by hand
  {
    const vs: V3[] = [];
    const cs: RGB[] = [];
    const tris: number[] = [];
    const W = HN + 1;
    for (let i = 0; i <= HL; i++) for (let j = 0; j <= HN; j++) {
      vs.push(hr[i][j]);
      cs.push(hc[i][j]);
    }
    for (let i = 0; i < HL; i++) for (let j = 0; j < HN; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      tris.push(a, c, b, b, c, d);
    }
    pt.mesh(vs, cs, tris, true);
  }

  // the crown of thorns: two twisted strands round the head over the brow, and thorns standing out of them
  const CR = 40;
  const cy = C[1] + 0.05;
  const ringAt = (a: number, lift: number, outR: number): V3 => {
    const k = 0.97;
    return [C[0] + (RX * k + outR) * Math.sin(a), cy + lift + 0.012 * Math.cos(a), C[2] + (RZ * k + outR) * Math.cos(a)];
  };
  for (const ph of [0, Math.PI]) {
    const keys: V3[] = [];
    for (let i = 0; i <= CR; i++) {
      const a = (i / CR) * Math.PI * 2;
      const tw = 7 * a + ph;
      keys.push(place(ringAt(a, 0.007 * Math.sin(tw), 0.007 * Math.cos(tw))));
    }
    const rr = keys.map(() => 0.0075);
    limb(pt, keys, rr, rr, [0, 1, 0], 5, 1, (p) => mul(THORN, 0.8 + 0.4 * hash(p[0] * 99, p[1] * 99, p[2] * 99)), false, false);
  }
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * Math.PI * 2 + 0.3 * hash(i, 1, 1);
    const base = ringAt(a, 0, 0.006);
    const outward = norm([Math.sin(a), 0.5 * (hash(i, 2, 2) - 0.3), Math.cos(a)]);
    const tip = add(base, scale(outward, 0.022 + 0.012 * hash(i, 3, 3)));
    const side = norm(cross(outward, [0, 1, 0]));
    const up = cross(side, outward);
    const b0 = add(base, scale(side, 0.004)), b1 = add(base, scale(side, -0.004)), b2 = add(base, scale(up, 0.005));
    const P = [b0, b1, b2, tip].map(place);
    pt.poly([P[0], P[2], P[3]], THORN);
    pt.poly([P[2], P[1], P[3]], THORN);
    pt.poly([P[1], P[0], P[3]], THORN);
  }
}

/** The votive lantern (not lit) and the pot of chrysanthemums on the cornice. */
function cornice(pt: Part): void {
  const top = 1.08;
  // the lantern: a square iron frame with glass sides, a pyramid roof and a ring
  const lx = 0.44, lz = 0.36, h = 0.22, hw = 0.06;
  const iron = () => IRON;
  pt.box(lx - hw - 0.01, lx + hw + 0.01, top, top + 0.025, lz - hw - 0.01, lz + hw + 0.01, iron);
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pt.box(lx + sx * hw - 0.008, lx + sx * hw + 0.008, top + 0.025, top + h, lz + sz * hw - 0.008, lz + sz * hw + 0.008, iron);
  pt.stack(lx, lz, [[hw - 0.004, hw - 0.004, top + 0.025], [hw - 0.004, hw - 0.004, top + h]], (p) => mul(GLASS, 0.9 + 0.2 * hash(p[0] * 30, p[1] * 30, p[2] * 30)));
  pt.stack(lx, lz, [[hw + 0.016, hw + 0.016, top + h], [hw + 0.016, hw + 0.016, top + h + 0.015], [0.006, 0.006, top + h + 0.09]], iron);
  limb(pt, [[lx, top + h + 0.085, lz - 0.02], [lx, top + h + 0.115, lz], [lx, top + h + 0.085, lz + 0.02]], [0.005, 0.005, 0.005], [0.005, 0.005, 0.005], [1, 0, 0], 5, 3, iron, true, true);
  // a stub of candle inside
  pt.box(lx - 0.012, lx + 0.012, top + 0.025, top + 0.08, lz - 0.012, lz + 0.012, () => [0.7, 0.66, 0.55]);

  // the flower pot: terracotta, a rim, earth, and chrysanthemums for All Saints
  const px = -0.42, pz = 0.34;
  const pot: V3[][] = [];
  const pc: RGB[][] = [];
  const prof: Array<[number, number]> = [[0.065, 0], [0.085, 0.13], [0.096, 0.135], [0.096, 0.165], [0.082, 0.165]];
  for (const [r, y] of prof) {
    const ring: V3[] = [];
    const cr: RGB[] = [];
    for (let j = 0; j < 14; j++) {
      const a = (j / 14) * Math.PI * 2;
      ring.push([px + r * Math.cos(a), top + y, pz + r * Math.sin(a)]);
      cr.push(mul(POT, 0.85 + 0.25 * hash(j, y * 10, 5)));
    }
    pot.push(ring);
    pc.push(cr);
  }
  pt.loft(pot, pc, true, true);
  const flowers: RGB[] = [[0.82, 0.8, 0.72], [0.78, 0.6, 0.12], [0.82, 0.8, 0.72], [0.55, 0.12, 0.16]];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, rr = 0.025 + 0.05 * hash(i, 7, 7);
    const fx = px + rr * Math.cos(a), fz = pz + rr * Math.sin(a), fy = top + 0.2 + 0.07 * hash(i, 8, 8);
    // a stem with two leaves, a round head
    pt.beam([px + rr * 0.4 * Math.cos(a), top + 0.15, pz + rr * 0.4 * Math.sin(a)], [fx, fy, fz], [1, 0, 0], 0.008, 0.008, 0.002, () => LEAF, false);
    for (const s of [-1, 1]) {
      const m: V3 = [px + rr * 0.7 * Math.cos(a), top + 0.17 + 0.02 * s, pz + rr * 0.7 * Math.sin(a)];
      const tip: V3 = [m[0] + 0.045 * Math.cos(a + s), m[1] + 0.01, m[2] + 0.045 * Math.sin(a + s)];
      const w: V3 = [-0.012 * Math.sin(a + s), 0.004, 0.012 * Math.cos(a + s)];
      pt.poly([sub(m, w), tip, add(m, w)], LEAF);
      pt.poly([add(m, w), tip, sub(m, w)], LEAF);
    }
    const fc = mul(flowers[i % flowers.length], 0.9 + 0.2 * hash(i, 9, 9));
    limb(pt, [[fx, fy - 0.012, fz], [fx, fy + 0.008, fz], [fx, fy + 0.02, fz]], [0.012, 0.03, 0.014], [0.012, 0.03, 0.014], [1, 0, 0], 8, 2, (p) => mul(fc, 0.85 + 0.25 * hash(p[0] * 300, p[1] * 300, p[2] * 300)), true, true);
  }
}

// ------------------------------------------------------------------ the model, built once and shared by every copy

interface CalvaryModel {
  stone: THREE.BufferGeometry;
  paint: THREE.BufferGeometry;
  stoneMat: THREE.Material;
  paintMat: THREE.Material;
  shape: ReturnType<typeof modelShape>;
}
let model: CalvaryModel | null = null;

function picture(url: string, colour: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = colour ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  return t;
}

/** The two geometries of the model in its own frame: the stone (with uv) and the painted parts. */
export function calvaryGeometry(): { stone: THREE.BufferGeometry; paint: THREE.BufferGeometry } {
  const st = new Part(1.5);
  const pt = new Part();
  plinth(st);
  railing(pt);
  cross_(pt);
  torso(pt);
  arms(pt);
  legs(pt);
  loincloth(pt);
  head(pt);
  cornice(pt);
  return { stone: st.geometry(), paint: pt.geometry() };
}

function build(): CalvaryModel {
  if (model) return model;
  const { stone, paint } = calvaryGeometry();
  // the Steen's bluestone and painted-metal settings (world/steenModel.ts), so the same shaders serve
  const stoneMat = psx(
    new THREE.MeshLambertMaterial({ map: picture("/textures/steen_blue.jpg", true), color: new THREE.Color(1.1, 1.1, 1.1), vertexColors: true, side: THREE.DoubleSide }),
    { fogReach: 2.2, affine: 0 },
  );
  stoneMat.name = "calvary_stone";
  footDirt(stoneMat, 0.6);
  stoneMat.bumpMap = picture("/textures/steen_blue_h.png", false);
  stoneMat.bumpScale = 0.5;
  const paintMat = psx(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 });
  paintMat.name = "calvary_paint";
  const shape = modelShape(stone, () => [stone.getAttribute("position").array, paint.getAttribute("position").array]);
  model = { stone, paint, stoneMat, paintMat, shape };
  return model;
}

/**
 * Put a calvary at (x, y, z), its front turned by yaw (0 = toward +z), under parent. Returns its walk collider
 * (the exact shape: the railing and the plinth block, the gaps between the bars do not).
 */
export function addCalvary(parent: THREE.Object3D, x: number, y: number, z: number, yaw: number, src: string): Rect {
  const m = build();
  const g = new THREE.Group();
  g.name = "calvary";
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  for (const [geo, mat, name] of [[m.stone, m.stoneMat, "calvary_stone"], [m.paint, m.paintMat, "calvary_paint"]] as const) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    g.add(mesh);
  }
  g.updateMatrix();
  g.matrixAutoUpdate = false;
  parent.add(g);
  // (the prop check: dev/propcheck.ts)
  addProp({ src, name: "calvary", x, y, z, yaw, s: [1, 1, 1], pts: [m.stone.getAttribute("position").array, m.paint.getAttribute("position").array] });
  return modelCollider(m.shape, x, z, yaw, y);
}

/** Dev: the triangle count of one calvary. */
export function calvaryTriangles(): number {
  const m = build();
  return (m.stone.getAttribute("position").count + m.paint.getAttribute("position").count) / 3;
}
