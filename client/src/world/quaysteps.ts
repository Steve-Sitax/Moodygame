import * as THREE from "three";
import { psx } from "../retro/psx";
import type { Rect } from "./geom";
import { DOCK_Y, HW_MAX, LW_MIN, MHW, MID_Y, MLW, WADE, levelAt, regionAt } from "./tide";

// Stone steps down the quay walls to the water, and iron ladders to climb out (Steve, 2026-09-23: "stairs that go
// to water like in some sample images, also ladders to get out"). All built in code from the quay lines of
// shared/city.json: no Blender run needed.
//
// The flights were drawn again on 2026-10-11 (Steve: "quay walls are nicer, but the stairs that go down now stick
// out like a sore thumb. Redesign them to make them high detail, fit in with the rest and better usable"). A flight
// is built like the wall it stands against: the same bluestone in the same material (city.ts quayStoneMaterials),
// its courses at the wall's heights, its colours from the same tide bands. It runs down along the wall face from a
// head wall with a square stone pier at the top, behind a raked parapet with an iron handrail, to a landing of big
// slabs just above half tide; an iron ladder hangs off the landing's end. The treads are bluestone slabs, each
// cut from one stone of the wall's picture: rounded, worn nosings that stand over the riser below, hollowed a
// little in the middle where the feet go, slimy and green below the high-water mark. Over the flight the wall stands out to the face of the
// quay's edge stones, so the coping runs on unbroken over the steps. Mooring rings and a grab chain hang on the
// flight's face. Ladders on the walls have the usual hoop over the edge to grab.

type V3 = [number, number, number];

/** A frame on a quay wall: origin on the wall face, t along the wall, n out over the water. */
export interface Frame {
  ox: number;
  oz: number;
  tx: number;
  tz: number;
  nx: number;
  nz: number;
}

export const frameAt = (ox: number, oz: number, tx: number, tz: number, nx: number, nz: number): Frame => ({ ox, oz, tx, tz, nx, nz });
/** World axes as a frame: s = x, u = z. */
export const WORLD: Frame = frameAt(0, 0, 1, 0, 0, 1);

const onFrame = (f: Frame, s: number, u: number): [number, number] => [f.ox + f.tx * s + f.nx * u, f.oz + f.tz * s + f.nz * u];
const toFrame = (f: Frame, x: number, z: number): [number, number] => {
  const dx = x - f.ox;
  const dz = z - f.oz;
  return [dx * f.tx + dz * f.tz, dx * f.nx + dz * f.nz];
};

/** Colour by height: green slime at the waterline, a wet dark band above it, dry stone higher up. */
export function slimeShade(waterY: number, dry: V3 = [1, 1, 1]): (y: number) => V3 {
  const stops: Array<[number, V3]> = [
    [waterY - 0.4, [0.24, 0.29, 0.2]],
    [waterY + 0.15, [0.3, 0.37, 0.24]],
    [waterY + 0.8, [0.52, 0.53, 0.47]],
    [waterY + 1.5, dry],
  ];
  return (y) => {
    if (y <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [y1, c1] = stops[i];
      if (y <= y1) {
        const [y0, c0] = stops[i - 1];
        const k = (y - y0) / (y1 - y0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return dry;
  };
}

/** Heights where the slime colours change: tall faces are cut there so the bands stay sharp. */
export const slimeCuts = (waterY: number) => [waterY - 0.4, waterY + 0.15, waterY + 0.8, waterY + 1.5];

/**
 * The tidal wall (M6 tides, world/tide.ts): black mud and weed below low water, green slime up
 * through the tide range, a dark wet band at the high-water mark, dry stone only above the springs.
 */
const TIDE_STOPS: Array<[number, V3]> = [
  // (a little lighter than true wet slime: at low water the walls filled the view nearly black)
  [LW_MIN - 0.3, [0.3, 0.31, 0.24]],
  [MLW + 0.3, [0.39, 0.44, 0.31]],
  [MID_Y, [0.47, 0.53, 0.38]],
  [MHW - 0.25, [0.55, 0.58, 0.47]],
  [MHW + 0.15, [0.7, 0.7, 0.64]],
  [HW_MAX + 0.35, [1, 1, 1]],
];
export function tideShade(dry: V3 = [1, 1, 1]): (y: number) => V3 {
  const stops = TIDE_STOPS.map(([y, c], i): [number, V3] => [y, i === TIDE_STOPS.length - 1 ? dry : c]);
  return (y) => {
    if (y <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      const [y1, c1] = stops[i];
      if (y <= y1) {
        const [y0, c0] = stops[i - 1];
        const k = (y - y0) / (y1 - y0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return dry;
  };
}
/** Where the tidal wall's colours change (cut tall faces there). */
export const tideCuts = (): number[] => TIDE_STOPS.map(([y]) => y);

/**
 * A merged mesh built from boxes and rods, with world-space UVs and a colour per
 * vertex from its height (slime at the waterline). One draw call per material.
 */
export class Geo {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];

  constructor(
    private readonly shade: (y: number) => V3 = () => [1, 1, 1],
    private readonly tile = 2,
    private readonly cuts: number[] = [],
  ) {}

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** Triangles so far. */
  get tris(): number {
    return this.pos.length / 9;
  }

  private vert(p: V3, n: V3, tint?: V3): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nor.push(n[0], n[1], n[2]);
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    const t = this.tile;
    if (ay >= ax && ay >= az) this.uv.push(p[0] / t, p[2] / t);
    else if (ax >= az) this.uv.push(p[2] / t, p[1] / t);
    else this.uv.push(p[0] / t, p[1] / t);
    const c = this.shade(p[1]);
    const k = tint ?? [1, 1, 1];
    this.col.push(c[0] * k[0], c[1] * k[1], c[2] * k[2]);
  }

  /** A flat quad (corners in order round the edge) that faces along n. */
  quad(a: V3, b: V3, c: V3, d: V3, n: V3, tint?: V3): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1];
    const cy = e1[2] * e2[0] - e1[0] * e2[2];
    const cz = e1[0] * e2[1] - e1[1] * e2[0];
    const q = cx * n[0] + cy * n[1] + cz * n[2] >= 0 ? [a, b, c, d] : [a, d, c, b];
    for (const i of [0, 1, 2, 0, 2, 3]) this.vert(q[i], n, tint);
  }

  /** A box in a wall frame: s along the wall, u out over the water, y up. Tall sides are cut at the slime heights. */
  box(f: Frame, s0: number, s1: number, u0: number, u1: number, y0: number, y1: number, tint?: V3, bottom = true): void {
    const P = (s: number, u: number, y: number): V3 => {
      const [x, z] = onFrame(f, s, u);
      return [x, y, z];
    };
    const T: V3 = [f.tx, 0, f.tz];
    const N: V3 = [f.nx, 0, f.nz];
    const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
    this.quad(P(s0, u0, y1), P(s1, u0, y1), P(s1, u1, y1), P(s0, u1, y1), [0, 1, 0], tint);
    if (bottom) this.quad(P(s0, u0, y0), P(s1, u0, y0), P(s1, u1, y0), P(s0, u1, y0), [0, -1, 0], tint);
    const ys = [y0, ...this.cuts.filter((c) => c > y0 + 0.01 && c < y1 - 0.01), y1];
    for (let i = 0; i < ys.length - 1; i++) {
      const a = ys[i];
      const b = ys[i + 1];
      this.quad(P(s0, u0, a), P(s0, u1, a), P(s0, u1, b), P(s0, u0, b), neg(T), tint);
      this.quad(P(s1, u0, a), P(s1, u1, a), P(s1, u1, b), P(s1, u0, b), T, tint);
      this.quad(P(s0, u0, a), P(s1, u0, a), P(s1, u0, b), P(s0, u0, b), neg(N), tint);
      this.quad(P(s0, u1, a), P(s1, u1, a), P(s1, u1, b), P(s0, u1, b), N, tint);
    }
  }

  /** Any three.js geometry (a pile, a brace), placed by a matrix. */
  add(g: THREE.BufferGeometry, m: THREE.Matrix4, tint?: V3): void {
    const flat = (g.index ? g.toNonIndexed() : g).clone().applyMatrix4(m);
    const p = flat.getAttribute("position");
    const n = flat.getAttribute("normal");
    for (let i = 0; i < p.count; i++) this.vert([p.getX(i), p.getY(i), p.getZ(i)], [n.getX(i), n.getY(i), n.getZ(i)], tint);
    flat.dispose();
  }

  /** A round post or beam from a to b. */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, sides = 6, segs = 1, tint?: V3, open = false): void {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, sides, segs, open);
    const m = new THREE.Matrix4().compose(
      a.clone().add(b).multiplyScalar(0.5),
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()),
      new THREE.Vector3(1, 1, 1),
    );
    this.add(g, m, tint);
    g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** One flight: its frame on the wall, the height of its landing and of one riser. */
interface Stair {
  f: Frame;
  landY: number;
  rise: number;
}

// The sizes of a flight (metres), in its frame: s down along the wall from the head of the flight, u out over the
// water from the wall line, y up (the quay at 0). Steve, 2026-10-11: "better usable": 13 risers of about 19 cm and
// a going of 31 cm, a walk 1.37 m wide between the wall and the parapet, a rail you can reach.
const RISERS = 13; // from the edge stones (y 0.06) down to the landing: 18.9 cm each
const GOING = 0.31; // nosing to nosing
const TREADS = RISERS - 1; // the thirteenth step down is the landing
/** At the head a landing level with the quay: you step out onto it from the quay, turn and go down. */
const TOP = 2 * GOING;
/** Where the landing starts: the nosing of the last tread. */
const FLIGHT = TOP + TREADS * GOING;
/** The landing's far end (shared/smallBoats.ts FLIGHT_END, server/src/rowing.ts: the boats lie past it and beside it). */
const END = 6.56;
const COPE_Y = 0.06; // the top of the quay's edge stones (city.ts)
const COPE_FOOT = -0.28; // the foot of their face over the water
/** The face of the quay's edge stones (city.ts: 0.25 - 0.015). Over the flight the wall stands out to it. */
const U0 = 0.235;
/** The treads run from U0 to here, the parapet's inner face. */
const WIDTH = 1.6;
/** The flight's outer face over the water. */
const W = 1.9;
const HEAD = 0.5; // the head wall that closes the top of the flight
const NEWEL = 0.45; // the square piers at the parapet's two ends
const NEWEL_H = 0.84; // their body over the edge stones at the head, over the landing at the foot
const CAP = 0.1; // their cap stone, with a low pyramid on it
const NOSE = 0.03; // a tread's nosing stands this far over the riser below
const SLAB = 0.075; // and is this thick at the front
const PAR_H = 0.5; // the parapet's coping over the line of the nosings
const PAR_COPE = 0.08; // the coping stones of the parapet and the head wall
const HEAD_TOP = 0.44; // the head wall's body, under its coping stone
const ROW = 0.45; // the landing's edge stones
const EDGE = 0.12; // their face over the water
const LIP = 0.03; // how far they and the copings stand out over the face below
const RAIL_H = 0.9; // the iron handrail over the line of the nosings
const RAIL_QUAY = 1.0; // the rail along the quay edge over the flight
const OPEN = TOP + 0.3; // the quay rail leaves the head of the flight open, where you step onto it
/** The foot of the quay walls (city.ts): the masonry's courses lie at the wall's heights. */
const Y0 = LW_MIN - 1.2;
/** The flights' masonry is drawn from here up: below it lies always under water (the wall behind goes on down). */
const FOOT_Y = LW_MIN - 0.35;
/** Walkers keep their middle this far off the parapet's face (the camera never comes within its near plane). */
const WALK_PAR = 0.28;
/** The foot pier starts a hand past the last nosing (no face of it in the plane of the last tread's nose). */
const FOOT0 = FLIGHT + 0.02;
const FOOT1 = FOOT0 + NEWEL;

type V2 = [number, number];
const ONE: V3 = [1, 1, 1];
const UP: V3 = [0, 1, 0];
const DOWN: V3 = [0, -1, 0];
const neg = (v: V3): V3 => [-v[0], -v[1], -v[2]];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/**
 * Where on the quay wall's picture (4 m a tile, 8 courses of half a metre) a slab takes its stone: v of a point m
 * metres into course k, kept inside the course (clear of its mortar joints) for up to 0.41 m.
 */
const course = (k: number, m: number) => 0.125 * (((k % 8) + 8) % 8) + 0.009 + Math.min(0.102, Math.max(0, m) / 4);

/** A corner: where it is, which way it faces, its uv, and a tint on the colour its height gives it. */
interface Pt {
  p: V3;
  n: V3;
  uv: V2;
  k?: V3;
}

/** The part of a polygon above (or below) height y. */
function clipY(poly: V3[], y: number, above: boolean): V3[] {
  const out: V3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ina = above ? a[1] >= y : a[1] <= y;
    const inb = above ? b[1] >= y : b[1] <= y;
    if (ina) out.push(a);
    if (ina !== inb) {
      const t = (y - a[1]) / (b[1] - a[1]);
      out.push([a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/**
 * A merged mesh of faces with their own uv and normals and a colour by height (the tide's bands, as on the wall).
 * Tall faces are cut where the colours change, so the bands stay as sharp as the wall's.
 */
class Mason {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  shade: (y: number) => V3 = () => ONE;
  cuts: number[] = [];

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** Triangles so far. */
  get tris(): number {
    return this.pos.length / 9;
  }

  private vert(a: Pt): void {
    this.pos.push(a.p[0], a.p[1], a.p[2]);
    this.nor.push(a.n[0], a.n[1], a.n[2]);
    this.uv.push(a.uv[0], a.uv[1]);
    const c = this.shade(a.p[1]);
    const k = a.k ?? ONE;
    this.col.push(c[0] * k[0], c[1] * k[1], c[2] * k[2]);
  }

  /** A triangle, wound to face the way its corners' normals point. */
  tri(a: Pt, b: Pt, c: Pt): void {
    const g = cross(sub(b.p, a.p), sub(c.p, a.p));
    const n: V3 = [a.n[0] + b.n[0] + c.n[0], a.n[1] + b.n[1] + c.n[1], a.n[2] + b.n[2] + c.n[2]];
    if (dot(g, n) >= 0) {
      this.vert(a);
      this.vert(b);
      this.vert(c);
    } else {
      this.vert(a);
      this.vert(c);
      this.vert(b);
    }
  }

  /** Four corners in order round the edge. */
  quad(a: Pt, b: Pt, c: Pt, d: Pt): void {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  /** A flat convex polygon (corners in order round its edge) facing n, its uv from `map`. */
  face(pts: V3[], n: V3, map: (p: V3) => V2, k?: V3, cut = true): void {
    const ys = pts.map((p) => p[1]);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    if (hi - lo < 1e-4 && Math.abs(n[1]) < 0.5) return;
    const bands = cut ? [lo, ...this.cuts.filter((c) => c > lo + 0.01 && c < hi - 0.01), hi] : [lo, hi];
    const P = (p: V3): Pt => ({ p, n, uv: map(p), k });
    for (let i = 0; i < bands.length - 1; i++) {
      let poly = pts;
      if (i > 0) poly = clipY(poly, bands[i], true);
      if (i < bands.length - 2) poly = clipY(poly, bands[i + 1], false);
      for (let j = 1; j < poly.length - 1; j++) this.tri(P(poly[0]), P(poly[j]), P(poly[j + 1]));
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** The line of the nosings: the nosing of tread i (at s = TOP + (i + 1) GOING) lies on it; level over the top landing. */
const noseLine = (st: Stair, s: number) => COPE_Y - (Math.max(0, s - TOP) / GOING) * st.rise;
/** The top of the parapet's coping. */
const parTop = (st: Stair, s: number) => noseLine(st, s) + PAR_H;
/** The top of tread i (-1: the top landing; TREADS: the landing). */
const treadY = (st: Stair, i: number) => (i < TREADS ? COPE_Y - (i + 1) * st.rise : st.landY);
/** The middle of the last tread: past it the walking slope goes down onto the landing. */
const S_LAST = TOP + (TREADS - 0.5) * GOING;
/** The walking height down a flight: a smooth slope through the middles of the treads, so the camera glides. */
function slopeY(st: Stair, s: number): number {
  if (s >= FLIGHT) return st.landY;
  if (s <= S_LAST) return Math.min(0, COPE_Y - ((s - TOP) / GOING + 0.5) * st.rise);
  const y = treadY(st, TREADS - 1);
  return y + ((st.landY - y) * (s - S_LAST)) / (FLIGHT - S_LAST);
}
/** Where on the slope the height is y. */
function slopeS(st: Stair, y: number): number {
  const yLast = treadY(st, TREADS - 1);
  if (y >= yLast) return Math.max(0, TOP + ((COPE_Y - y) / st.rise - 0.5) * GOING);
  return S_LAST + ((yLast - y) / (yLast - st.landY)) * (FLIGHT - S_LAST);
}

/** A place to climb out of the water: a ladder rung or the edge of a landing. */
export interface Exit {
  kind: "ladder" | "landing";
  /** Where the swimmer holds on (in the water, in front of the ladder or the landing edge). */
  gx: number;
  gz: number;
  /** Out of the wall, toward the swimmer. */
  nx: number;
  nz: number;
  /** Where you stand when you are out: the quay, the pier deck or the landing. */
  tx: number;
  tz: number;
  ty: number;
}

export interface QuaySteps {
  /** Height of a step or landing under (x, z), or null when not on a flight. `landing` tells which. */
  heightAt(x: number, z: number): { y: number; landing: boolean } | null;
  /**
   * Stone of a flight (steps, parapet, landing) within pad metres: solid for a swimmer. With a water
   * level (M6 tides), stone under more than WADE metres of water is not in the way.
   */
  solidAt(x: number, z: number, pad: number, level?: number): boolean;
  /** The nearest place to climb out within reach at the water level now (tide.ts levelAt), or null. */
  exitNear(x: number, z: number, reach: number): Exit | null;
  /** Rails and ladder hoops on the quay: they block walking. */
  colliders: Rect[];
  /** Every ladder's foot, for the report and the dev hook. */
  ladders: Array<{ x: number; z: number; top: number }>;
  /** Every flight: top of the steps, and the landing's far end. */
  flights: Array<{ top: [number, number]; end: [number, number] }>;
  /** Stone and iron outlines on the water, for the foam along the walls: [x0, z0, x1, z1]. */
  outlines: number[][];
  /** Add a flight of steps down a quay wall: top at (x, z) on the wall line, going down along t, water side n. */
  addFlight(x: number, z: number, tx: number, tz: number, nx: number, nz: number): void;
  /** Add an iron ladder on a wall face (frame f, at s), from under the water up to topY. Climbing out puts you `inset` metres in from the edge. */
  addLadder(f: Frame, s: number, topY: number, inset?: number): void;
  /** Build what was added since the last call into the scene (one mesh per material). */
  flush(scene: THREE.Object3D): void;
}

// the small iron: a mooring ring and its staple, a chain's link (shared by every flight)
const ringGeo = new THREE.TorusGeometry(0.075, 0.013, 4, 8);
const staple = new THREE.BoxGeometry(0.05, 0.035, 0.03);
/** A chain's link: an oval ring, its length along x. */
const link = new THREE.TorusGeometry(0.024, 0.0065, 3, 6).scale(1.75, 1, 1);

/**
 * The flights and the ladders. `wall` is the quay wall's own material (city.ts quayStoneMaterials): every stone of
 * a flight is drawn in it.
 */
export function quaySteps(waterY: number, mats: { wall: THREE.Material; iron: THREE.Texture }): QuaySteps {
  // M6 tides: the stone goes down to the foot of the quay walls, below the lowest spring tide; the landing stays
  // just above half tide (waterY), so it floods at high water and stands high and dry at low water
  const landY = waterY + 0.4;
  const rise = (COPE_Y - landY) / RISERS;

  // every stone of a flight, the treads, slabs and copings too, is drawn in the quay wall's own material (its
  // bluestone picture, one stone of it to each slab): one draw, and no shader program of its own (rendering.md)
  const ironMat = psx(new THREE.MeshLambertMaterial({ map: mats.iron, vertexColors: true }), { affine: 0.3 });
  let wall = new Mason();
  let iron = new Geo(tideShade([0.9, 0.86, 0.82]), 1, tideCuts());

  const stairs: Stair[] = [];
  const exits: Exit[] = [];
  const colliders: Rect[] = [];
  const ladders: QuaySteps["ladders"] = [];
  const flights: QuaySteps["flights"] = [];
  const outlines: number[][] = [];
  /** The triangles of the flights (dev: on the stone mesh's userData, for the frame budget). */
  const flightTris = { stone: 0, iron: 0 };
  let seed = 1873;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  /** A rect on the ground for a stretch of a frame (frames here run along the world axes). */
  const rectOn = (f: Frame, s0: number, s1: number, u0: number, u1: number): Rect => {
    const [ax, az] = onFrame(f, s0, u0);
    const [bx, bz] = onFrame(f, s1, u1);
    return { minX: Math.min(ax, bx), maxX: Math.max(ax, bx), minZ: Math.min(az, bz), maxZ: Math.max(az, bz) };
  };

  function addLadder(f: Frame, s: number, topY: number, inset = 0.9): void {
    const half = 0.23;
    const u0 = 0.11; // stiles stand this far off the wall
    const u1 = 0.16;
    const foot = LW_MIN - 0.7; // below the lowest spring tide
    const top = topY + 0.95; // the hoop over the edge, to grab
    for (const side of [-1, 1]) {
      const sc = s + side * half;
      iron.box(f, sc - 0.025, sc + 0.025, u0, u1, foot, top);
      iron.box(f, sc - 0.025, sc + 0.025, -0.36, u1, top - 0.05, top); // over the edge
      iron.box(f, sc - 0.025, sc + 0.025, -0.36, -0.31, topY, top - 0.05); // down into the stone
      for (let y = foot + 0.5; y < topY; y += 1.1) iron.box(f, sc - 0.02, sc + 0.02, 0, u0, y, y + 0.04); // wall brackets
      colliders.push(rectOn(f, sc - 0.05, sc + 0.05, -0.38, -0.29));
    }
    for (let y = foot + 0.25; y < topY - 0.1; y += 0.3) iron.box(f, s - half, s + half, 0.12, 0.15, y, y + 0.035);
    const [gx, gz] = onFrame(f, s, 0.55);
    const [tx, tz] = onFrame(f, s, -inset);
    exits.push({ kind: "ladder", gx, gz, nx: f.nx, nz: f.nz, tx, tz, ty: topY });
    const [lx, lz] = onFrame(f, s, 0);
    ladders.push({ x: +lx.toFixed(1), z: +lz.toFixed(1), top: topY });
  }

  function addFlight(x: number, z: number, tx: number, tz: number, nx: number, nz: number): void {
    const stone0 = wall.tris;
    const iron0 = iron.tris;
    const f = frameAt(x, z, tx, tz, nx, nz);
    const st: Stair = { f, landY, rise };
    // the Petit Bassin keeps one level (world/tide.ts): its flights take its walls' colours (city.ts dockShade),
    // and nothing is hung on them under its water
    const dock = regionAt(...onFrame(f, END / 2, W + 1.5)) === 1;
    const still = dock ? DOCK_Y : -Infinity;
    const highMark = dock ? DOCK_Y + 0.15 : MHW;
    wall.shade = dock ? slimeShade(DOCK_Y) : tideShade();
    wall.cuts = dock ? slimeCuts(DOCK_Y) : tideCuts();
    const P = (s: number, u: number, y: number): V3 => {
      const [px, pz] = onFrame(f, s, u);
      return [px, y, pz];
    };
    const T: V3 = [f.tx, 0, f.tz];
    const N: V3 = [f.nx, 0, f.nz];
    const nT = neg(T);
    const nN = neg(N);
    // the masonry's picture as on the wall: 4 m a tile, its courses at the wall's heights (city.ts: v = (y - y0) / 4)
    const alongT = (p: V3): V2 => [(p[0] * f.tx + p[2] * f.tz) / 4, (p[1] - Y0) / 4];
    const alongN = (p: V3): V2 => [(p[0] * f.nx + p[2] * f.nz) / 4, (p[1] - Y0) / 4];
    /** A face of masonry at u, from s0 to s1, its foot and top at both ends (sloped tops for the parapet). */
    const faceU = (u: number, s0: number, s1: number, b0: number, t0: number, b1: number, t1: number, n: V3) => {
      if (s1 - s0 < 1e-3) return;
      wall.face([P(s0, u, b0), P(s1, u, b1), P(s1, u, t1), P(s0, u, t0)], n, alongT);
    };
    /** A face of masonry at s, from u0 to u1. */
    const faceS = (s: number, u0: number, u1: number, b: number, t: number, n: V3) => {
      if (u1 - u0 < 1e-3 || t - b < 1e-3) return;
      wall.face([P(s, u0, b), P(s, u1, b), P(s, u1, t), P(s, u0, t)], n, alongN);
    };
    const nl = (s: number) => noseLine(st, s);
    const pt = (s: number) => parTop(st, s);
    const ty = (i: number) => treadY(st, i);
    const headTop = COPE_Y + NEWEL_H;
    const footTop = landY + NEWEL_H;

    // ---- the masonry: the wall's own stone, courses and colours
    // the face over the water: the head pier, under the parapet, the foot pier, under the landing's edge stones
    faceU(W, -HEAD, 0, FOOT_Y, headTop, FOOT_Y, headTop, N);
    faceU(W, 0, FOOT0, FOOT_Y, pt(0) - PAR_COPE, FOOT_Y, pt(FOOT0) - PAR_COPE, N);
    faceU(W, FOOT0, FOOT1, FOOT_Y, footTop, FOOT_Y, footTop, N);
    faceU(W, FOOT1, END, FOOT_Y, landY - EDGE, FOOT_Y, landY - EDGE, N);
    // the landing's end; over the landing the wall stands out to the edge stones' face
    faceS(END, 0, U0, FOOT_Y, COPE_FOOT, T);
    faceS(END, U0, W, FOOT_Y, landY - EDGE, T);
    // the head: its end toward the top of the quay, its back on the quay over the edge stones, its front over the steps
    faceS(-HEAD, 0, W - NEWEL, FOOT_Y, HEAD_TOP, nT);
    faceS(-HEAD, W - NEWEL, W, FOOT_Y, headTop, nT);
    faceU(0, -HEAD, 0, COPE_Y, HEAD_TOP, COPE_Y, HEAD_TOP, nN);
    faceU(W - NEWEL, -HEAD, 0, HEAD_TOP + PAR_COPE, headTop, HEAD_TOP + PAR_COPE, headTop, nN);
    faceS(0, 0, W - NEWEL, COPE_Y, HEAD_TOP, T);
    faceS(0, W - NEWEL, WIDTH, COPE_Y, headTop, T);
    faceS(0, WIDTH, W, pt(0), headTop, T);
    // the foot pier on the landing
    faceS(FOOT0, W - NEWEL, WIDTH, landY, footTop, nT);
    faceS(FOOT0, WIDTH, W, pt(FOOT0), footTop, nT);
    faceS(FOOT1, W - NEWEL, W, landY, footTop, T);
    faceU(W - NEWEL, FOOT0, FOOT1, landY, footTop, landY, footTop, nN);
    // the parapet's inner face over each tread, and the wall over the treads (out to the edge stones' face)
    for (let i = -1; i <= TREADS; i++) {
      const s0 = i === -1 ? 0 : TOP + i * GOING - NOSE;
      const s1 = i < TREADS ? TOP + (i + 1) * GOING - NOSE : FOOT0;
      const y = ty(i);
      faceU(WIDTH, s0, s1, y, pt(s0) - PAR_COPE, y, pt(s1) - PAR_COPE, nN);
      if (y < COPE_FOOT) faceU(U0, s0, i < TREADS ? s1 : END, y, COPE_FOOT, y, COPE_FOOT, N);
    }

    // the corners over the water in big dressed quoins, long and short by turns, a little proud of the face and
    // lighter, laid in the wall's half-metre courses
    const quoins = (sc: number, ds: number, top: number) => {
      const o = 0.015;
      const kk: V3 = [1.07, 1.065, 1.05];
      const sE = sc - ds * o; // the stone's face round the corner stands out past the end
      const along = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)];
      for (let yc = Y0, k = 0; yc < top - 0.05; yc += 0.5, k++) {
        if (yc + 0.5 < FOOT_Y) continue;
        const y = Math.max(yc, FOOT_Y);
        const y1 = Math.min(top, yc + 0.5) - 0.012;
        const sIn = sc + ds * (k % 2 ? 0.34 : 0.72); // long and short by turns along the face over the water
        const uIn = W - (k % 2 ? 0.62 : 0.3); // and the other way round the corner
        const [a0, a1] = along(sE, sIn);
        wall.face([P(a0, W + o, y), P(a1, W + o, y), P(a1, W + o, y1), P(a0, W + o, y1)], N, alongT, kk);
        wall.face([P(sE, uIn, y), P(sE, W + o, y), P(sE, W + o, y1), P(sE, uIn, y1)], ds > 0 ? nT : T, alongN, kk);
        // its thin edges where it stands out of the face
        wall.face([P(sIn, W, y), P(sIn, W + o, y), P(sIn, W + o, y1), P(sIn, W, y1)], ds > 0 ? T : nT, alongN, kk, false);
        wall.face([P(sc, uIn, y), P(sE, uIn, y), P(sE, uIn, y1), P(sc, uIn, y1)], nN, alongT, kk, false);
      }
    };
    quoins(-HEAD, 1, headTop);
    quoins(END, -1, landY - EDGE);

    // ---- the treads: granite slabs with rounded nosings, worn hollow and rounder in the middle
    const us = [U0, U0 + 0.22, (U0 + WIDTH) / 2, WIDTH - 0.22, WIDTH];
    const wear = [0, 0.6, 1, 0.6, 0];
    /** Clean and worn light where the feet go; green slime in the corners below the high-water mark. */
    const tint = (w: number, y: number): V3 => {
      const wet = y < highMark ? 1 : y < highMark + 0.45 ? (highMark + 0.45 - y) / 0.45 : 0;
      const worn = 1 + 0.09 * w * (1 - 0.6 * wet);
      const g = wet * (1 - w);
      return [worn * (1 - 0.18 * g), worn * (1 - 0.05 * g), worn * (1 - 0.3 * g)];
    };
    const tn = (ns: number, ny: number): V3 => [f.tx * ns, ny, f.tz * ns];
    for (let i = -1; i < TREADS; i++) {
      const y = ty(i);
      const yNext = ty(i + 1);
      const sb = i === -1 ? 0 : TOP + i * GOING - NOSE;
      const sf = TOP + (i + 1) * GOING;
      // (the top landing starts past the quay's edge stones, which lie level with it: no face in theirs)
      const uu = i === -1 ? [0.25, ...us.slice(1)] : us;
      const off = rnd() * 4; // where the joint between the tread's two stones falls
      const kTop = Math.floor(rnd() * 8); // which course of the picture its top takes, and its riser
      const kLow = (kTop + 3) % 8;
      // the profile from the back of the tread over the nosing and down the riser: s, y, normal (along s, up), v
      const prof = wear.map((w) => {
        const d = 0.012 * w; // worn hollow
        const dn = i + 1 < TREADS ? d : 0; // (the landing is not)
        const r = 0.025 + 0.02 * w; // worn rounder
        const sj = sf - 0.006 * w;
        const pts: Array<[number, number, number, number, number]> = [
          [sb, y - d, 0, 1, 0],
          [sj - r, y - d, 0, 1, 0],
        ];
        for (let k = 1; k <= 4; k++) {
          const a = (k * Math.PI) / 8;
          pts.push([sj - r + r * Math.sin(a), y - d - r + r * Math.cos(a), Math.sin(a), Math.cos(a), 0]);
        }
        pts.push([sj, y - SLAB, 1, 0, 0]);
        // v: metres round the profile from the back over the nose (one course), then under it and down the riser
        for (let k = 1; k < pts.length; k++) pts[k][4] = pts[k - 1][4] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
        pts.push([sf - NOSE, y - SLAB, 0, -1, 0]);
        pts.push([sf - NOSE, yNext - dn, 1, 0, 0]);
        return pts;
      });
      // each stretch of the profile: from point a to b, with a normal of its own (or the points' own: the round)
      const segs: Array<[number, number, V3 | null]> = [[0, 1, UP], [1, 2, null], [2, 3, null], [3, 4, null], [4, 5, null], [5, 6, T], [6, 7, DOWN], [7, 8, T]];
      for (const [a, b, n] of segs)
        for (let j = 0; j < us.length - 1; j++) {
          const low = a >= 6; // (the underside and the riser)
          const C = (jj: number, k: number): Pt => {
            const q = prof[jj][k];
            const v = low ? course(kLow, k === 6 ? 0 : k === 7 ? NOSE : NOSE + (prof[jj][7][1] - q[1])) : course(kTop, q[4] * Math.min(0.95, 0.4 / prof[jj][6][4]));
            return { p: P(q[0], uu[jj], q[1]), n: n ?? tn(q[2], q[3]), uv: [(uu[jj] + off) / 4, v], k: tint(wear[jj], q[1]) };
          };
          wall.quad(C(j, a), C(j, b), C(j + 1, b), C(j + 1, a));
        }
    }

    // ---- the landing: three rows of big slabs along the wall, edge stones round its open side and its end
    /** A level face from s0 to s1 and u0 to u1 at y, facing up (or down: the undersides where a stone stands out). */
    const flat = (s0: number, s1: number, u0: number, u1: number, y: number, uv: (s: number, u: number) => V2, k?: V3, n: V3 = UP) =>
      wall.quad(
        { p: P(s0, u0, y), n, uv: uv(s0, u0), k },
        { p: P(s1, u0, y), n, uv: uv(s1, u0), k },
        { p: P(s1, u1, y), n, uv: uv(s1, u1), k },
        { p: P(s0, u1, y), n, uv: uv(s0, u1), k },
      );
    const under = () => [0.1, course(2, 0.2)] as V2;
    /** A side of a slab facing n (T or N either way): a rectangle between two corners on the ground plan. */
    const side = (sa: number, ua: number, sb: number, ub: number, y0: number, y1: number, n: V3, len: number) =>
      wall.quad(
        { p: P(sa, ua, y0), n, uv: [0, course(6, 0)] },
        { p: P(sb, ub, y0), n, uv: [len / 4, course(6, 0)] },
        { p: P(sb, ub, y1), n, uv: [len / 4, course(6, y1 - y0)] },
        { p: P(sa, ua, y1), n, uv: [0, course(6, y1 - y0)] },
      );
    const ub = W - ROW;
    for (let r = 0; r < 3; r++) {
      const u0 = U0 + ((ub - U0) * r) / 3;
      const u1 = U0 + ((ub - U0) * (r + 1)) / 3;
      const o = rnd() * 4;
      const kc = Math.floor(rnd() * 8);
      flat(FLIGHT - NOSE, END - ROW, u0, u1, landY, (s, u) => [(s + o) / 4, course(kc, u - u0)], tint(0.5, landY));
    }
    flat(FLIGHT - NOSE, FOOT0, ub, WIDTH, landY, (s, u) => [s / 4, course(5, u - ub)], tint(0.3, landY));
    // the edge stones and the copings are drawn with their real cross-sections: rounded arrises and nosings
    /** A cross-section: across position c, height dy under the stone's top, its normal across and up. */
    type Sec = Array<[number, number, number, number]>;
    /** A quarter round from the top (at c - r, toward +c) down to the face at c, radius r. */
    const roundOut = (c: number, r: number): Sec => {
      const o: Sec = [];
      for (let k = 0; k <= 4; k++) {
        const a = (k * Math.PI) / 8;
        o.push([c - r + r * Math.sin(a), -r + r * Math.cos(a), Math.sin(a), Math.cos(a)]);
      }
      return o;
    };
    /** A slab h thick from c0 to c1 with both top arrises rounded (radius r): from its inner foot round to its outer foot. */
    const slabSec = (c0: number, c1: number, h: number, r: number): Sec => [
      [c0, -h, -1, 0],
      ...roundOut(-c0, r)
        .reverse()
        .map(([c, dy, nc, ny]): [number, number, number, number] => [-c, dy, -nc, ny]),
      ...roundOut(c1, r),
      [c1, -h, 1, 0],
    ];
    /** An edge stone: level from c0 out to a rounded nosing at c1, its face down EDGE, its underside back to cb. */
    const edgeSec = (c0: number, c1: number, cb: number, r: number): Sec => [[c0, 0, 0, 1], ...roundOut(c1, r), [c1, -EDGE, 1, 0], [c1, -EDGE, 0, -1], [cb, -EDGE, 0, -1]];
    /**
     * A stone of cross-section `sec` laid along s (or along u) from a0 to a1, its top at y(a). The picture runs along
     * it, 3 m a tile, and round its section; `caps` closes its ends with the section's outline.
     */
    const run = (a0: number, a1: number, alongS: boolean, y: (a: number) => number, sec: Sec, k: V3 | undefined, off: number, caps: [boolean, boolean] = [false, false]) => {
      const A: V3 = alongS ? T : N;
      const C: V3 = alongS ? N : T;
      const at = (a: number, c: number, dy: number): V3 => (alongS ? P(a, c, y(a) + dy) : P(c, a, y(a) + dy));
      const g = (y(a1) - y(a0)) / (a1 - a0);
      const len = Math.hypot(a1 - a0, y(a1) - y(a0));
      const L = [0];
      for (let i = 1; i < sec.length; i++) L.push(L[i - 1] + Math.hypot(sec[i][0] - sec[i - 1][0], sec[i][1] - sec[i - 1][1]));
      const tot = L[L.length - 1] || 1;
      const kRun = Math.floor(rnd() * 8);
      const nrm = (nc: number, ny: number): V3 => unit([C[0] * nc - A[0] * g * ny, ny, C[2] * nc - A[2] * g * ny]);
      for (let i = 0; i < sec.length - 1; i++) {
        const [ca, ya, na, ma] = sec[i];
        const [cb, yb, nb, mb] = sec[i + 1];
        if (Math.hypot(cb - ca, yb - ya) < 1e-5) continue; // (a corner: the next face turns sharp)
        // a flat face between two corners that turn sharp keeps one normal; the rounds keep their corners'
        const sharp = na * nb + ma * mb < 0.6;
        const nA = sharp ? nrm(nb, mb) : nrm(na, ma);
        const nB = nrm(nb, mb);
        const squeeze = Math.min(1, 0.4 / tot); // (a long section is pressed into one course)
        const va = course(kRun, L[i] * squeeze);
        const vb = course(kRun, L[i + 1] * squeeze);
        wall.quad(
          { p: at(a0, ca, ya), n: nA, uv: [off / 4, va], k },
          { p: at(a1, ca, ya), n: nA, uv: [(off + len) / 4, va], k },
          { p: at(a1, cb, yb), n: nB, uv: [(off + len) / 4, vb], k },
          { p: at(a0, cb, yb), n: nB, uv: [off / 4, vb], k },
        );
      }
      const outline = sec.filter((q, i) => i === 0 || Math.hypot(q[0] - sec[i - 1][0], q[1] - sec[i - 1][1]) > 1e-5);
      // (the ends: the picture laid flat on them, across and down)
      for (const [end, a, n] of [[caps[0], a0, neg(A)], [caps[1], a1, A]] as const)
        if (end) wall.face(outline.map(([c, dy]) => at(a, c, dy)), n, (q) => [(q[0] * C[0] + q[2] * C[2]) / 4, course(kRun, y(a) - q[1])], k, false);
      return len;
    };
    {
      const k = tint(0.2, landY);
      const r = 0.04;
      const e1 = END + LIP;
      const lv = () => landY;
      // the open side, from the foot pier to the end row: a rounded nosing over the face
      run(FOOT1, END - ROW, true, lv, edgeSec(ub, W + LIP, W, r), k, rnd() * 4, [true, false]);
      // where it meets the end row, the end row's back stands over its nosing
      wall.face([P(END - ROW, W + LIP, landY), ...roundOut(W + LIP, r).reverse().map(([c, dy]) => P(END - ROW, c, landY + dy))], nT, () => [0.2, course(1, 0.05)], k, false);
      // the end row, the full width of the landing
      run(U0, W + LIP, false, lv, edgeSec(END - ROW, e1, END, r), k, rnd() * 4, [true, true]);
    }

    // ---- the copings: the raked parapet, the head wall, the piers' caps
    {
      // the parapet's coping stones: level over the top landing, then raked down with the nosings
      const c0 = WIDTH - LIP;
      const c1 = W + LIP;
      const k = tint(0, pt(FOOT0));
      const sec = slabSec(c0, c1, PAR_COPE, 0.025);
      let at = 0;
      for (const [sa, sb] of [[0, TOP], [TOP, FOOT0]] as const) {
        const ya = pt(sa);
        const yb = pt(sb);
        const len = run(sa, sb, true, pt, sec, k, at);
        const [ua, ub2] = [at / 4, (at + len) / 4];
        at += len;
        // its undersides where it stands out over the faces
        for (const [u0, u1] of [[c0, WIDTH], [W, c1]] as const)
          wall.quad(
            { p: P(sa, u0, ya - PAR_COPE), n: DOWN, uv: [ua, course(2, 0.1)], k },
            { p: P(sb, u0, yb - PAR_COPE), n: DOWN, uv: [ub2, course(2, 0.1)], k },
            { p: P(sb, u1, yb - PAR_COPE), n: DOWN, uv: [ub2, course(2, 0.1)], k },
            { p: P(sa, u1, ya - PAR_COPE), n: DOWN, uv: [ua, course(2, 0.1)], k },
          );
      }
      // its ends where it stands out past the piers: the outer part of its section
      const outer = (s0: number, n: V3) =>
        wall.face([P(s0, W, pt(s0)), ...sec.filter(([c]) => c > W).map(([c, dy]) => P(s0, c, pt(s0) + dy)), P(s0, W, pt(s0) - PAR_COPE)], n, () => [0.3, course(1, 0.05)], k, false);
      outer(0, nT);
      outer(FOOT0, T);
    }
    {
      // the head wall's coping stone, standing out over its three open faces, its arrises rounded
      const s0 = -HEAD - LIP;
      const s1 = LIP;
      const u0 = -LIP;
      const u1 = W - NEWEL;
      const y0 = HEAD_TOP;
      run(u0, u1, false, () => HEAD_TOP + PAR_COPE, slabSec(s0, s1, PAR_COPE, 0.025), undefined, rnd() * 4, [true, true]);
      flat(s0, -HEAD, u0, u1, y0, under, undefined, DOWN);
      flat(0, s1, u0, u1, y0, under, undefined, DOWN);
      flat(-HEAD, 0, u0, 0, y0, under, undefined, DOWN);
    }
    /** A pier's cap stone over [s0, s1] x [u0, u1] at y, standing out all round, with a low pyramid on top. */
    const cap = (s0: number, s1: number, u0: number, u1: number, y: number) => {
      const o = 0.04;
      const [a0, a1, b0, b1] = [s0 - o, s1 + o, u0 - o, u1 + o];
      const y1 = y + CAP;
      side(a0, b0, a0, b1, y, y1, nT, b1 - b0);
      side(a1, b0, a1, b1, y, y1, T, b1 - b0);
      side(a0, b0, a1, b0, y, y1, nN, a1 - a0);
      side(a0, b1, a1, b1, y, y1, N, a1 - a0);
      flat(a0, a1, b0, b1, y, under, undefined, DOWN); // its underside (inside the pier, but for the rim)
      const top = P((a0 + a1) / 2, (b0 + b1) / 2, y1 + 0.07);
      const c: V3[] = [P(a0, b0, y1), P(a1, b0, y1), P(a1, b1, y1), P(a0, b1, y1)];
      for (let i = 0; i < 4; i++) {
        const a = c[i];
        const b = c[(i + 1) % 4];
        const n = unit(cross(sub(b, a), sub(top, a)));
        const nn: V3 = n[1] < 0 ? neg(n) : n;
        wall.tri({ p: a, n: nn, uv: [0, course(4, 0)] }, { p: b, n: nn, uv: [0.15, course(4, 0)] }, { p: top, n: nn, uv: [0.075, course(4, 0.36)] });
      }
    };
    cap(-HEAD, 0, W - NEWEL, W, headTop);
    cap(FOOT0, FOOT1, W - NEWEL, W, footTop);

    // ---- iron: the handrail on the parapet, the rail along the quay edge, rings and a grab chain on the face
    {
      const uR = (WIDTH + W) / 2;
      const V = (s0: number) => new THREE.Vector3(...P(s0, uR, nl(s0) + RAIL_H));
      // level over the top landing, then down with the nosings, on posts leaded into the coping
      const r0 = 0.16;
      const r1 = FLIGHT - 0.1;
      const n = Math.max(2, Math.round((r1 - TOP) / 1.05));
      for (const s0 of [r0, ...Array.from({ length: n + 1 }, (_, i) => TOP + ((r1 - TOP) * i) / n)])
        iron.rod(new THREE.Vector3(...P(s0, uR, pt(s0) - 0.02)), V(s0), 0.016, 6, 1, undefined, true);
      iron.rod(V(r0 - 0.03), V(TOP), 0.022, 8);
      iron.rod(V(TOP), V(r1 + 0.03), 0.022, 8);
    }
    {
      // along the quay edge over the flight, open at the top where you step down
      const r0 = OPEN;
      const r1 = END;
      const uR = -0.14;
      const n = Math.max(2, Math.round((r1 - r0) / 1.4));
      for (let i = 0; i <= n; i++) {
        const s = r0 + ((r1 - r0) * i) / n;
        iron.rod(new THREE.Vector3(...P(s, uR, 0.05)), new THREE.Vector3(...P(s, uR, RAIL_QUAY + 0.02)), 0.024, 6, 1, undefined, true);
      }
      for (const y of [0.55, RAIL_QUAY]) iron.rod(new THREE.Vector3(...P(r0 - 0.02, uR, y)), new THREE.Vector3(...P(r1 + 0.02, uR, y)), 0.021, 8);
      colliders.push(rectOn(f, r0 - 0.05, r1 + 0.05, uR - 0.08, uR + 0.08));
    }
    /** An iron ring on a staple, hanging flat against a face: at (s, u, y) on the face, n out of it, t along it. */
    const ring = (s: number, u: number, y: number, n: V3, t: V3) => {
      if (y < still + 0.05) return; // (under the Petit Bassin's water)
      const p = P(s, u, y);
      const out = (k: number) => new THREE.Vector3(p[0] + n[0] * k, p[1], p[2] + n[2] * k);
      iron.add(staple, new THREE.Matrix4().makeBasis(new THREE.Vector3(...t), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n)).setPosition(out(0.02)));
      iron.add(ringGeo, new THREE.Matrix4().makeBasis(new THREE.Vector3(...t), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...n)).setPosition(out(0.03).setY(y - 0.085)));
    };
    /** A chain hung in a swag along a face at u (facing N), from s0 to s1, its ends at y, sagging `sag`. */
    const chain = (s0: number, s1: number, u: number, y: number, sag: number) => {
      if (y - sag < still + 0.05) return;
      const at = (t: number): V3 => P(s0 + (s1 - s0) * t, u + 0.035, y - sag * 4 * t * (1 - t));
      // walk the curve in small steps and drop a link every 8 cm, each turned a quarter to the last
      let prev = at(0);
      let run = 0;
      let i = 0;
      for (let k = 1; k <= 200; k++) {
        const q = at(k / 200);
        run += Math.hypot(q[0] - prev[0], q[1] - prev[1], q[2] - prev[2]);
        prev = q;
        if (run < 0.08) continue;
        run = 0;
        const a = at(Math.max(0, k / 200 - 0.01));
        const b = at(Math.min(1, k / 200 + 0.01));
        const d = new THREE.Vector3(...unit(sub(b, a)));
        const nv = new THREE.Vector3(...N);
        const y2 = new THREE.Vector3().crossVectors(nv, d).normalize();
        const m = i++ % 2 ? new THREE.Matrix4().makeBasis(d, nv, new THREE.Vector3().crossVectors(d, nv)) : new THREE.Matrix4().makeBasis(d, y2, nv);
        iron.add(link, m.setPosition(new THREE.Vector3(...q)));
      }
      for (const s of [s0, s1]) iron.box(f, s - 0.02, s + 0.02, u, u + 0.05, y - 0.02, y + 0.02);
    };
    if (!dock) {
      chain(FOOT1 + 0.15, END - 1.0, W, landY - 0.25, 0.26);
      chain(0.45, FLIGHT - 0.25, W, MLW + 0.7, 0.32);
    }
    ring(END - 0.55, W, landY - 0.3, N, T);
    ring(FLIGHT + 1.2, U0, landY + 0.72, N, T);
    for (const s of [1.4, 2.9]) ring(s, W, pt(s) - PAR_COPE - 0.32, N, T);
    {
      const p = P(END, 0.42, landY - 0.3);
      if (p[1] > still + 0.05) {
        const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...N), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...T));
        iron.add(staple, m.clone().setPosition(new THREE.Vector3(p[0] + T[0] * 0.02, p[1], p[2] + T[2] * 0.02)));
        iron.add(ringGeo, m.setPosition(new THREE.Vector3(p[0] + T[0] * 0.03, p[1] - 0.085, p[2] + T[2] * 0.03)));
      }
    }

    // an iron ladder off the end of the landing, for low water (not in the Petit Bassin: its landings lie under water)
    if (!dock) {
      const endFrame = frameAt(...onFrame(f, END, 0), f.nx, f.nz, f.tx, f.tz);
      addLadder(endFrame, W / 2, landY, 0.8);
    }
    // swimmers climb onto the landing from its open side
    for (const s of [FOOT1 + 0.3, (FOOT1 + END) / 2, END - 0.5]) {
      const [gx, gz] = onFrame(f, s, W + 0.5);
      const [ttx, ttz] = onFrame(f, s, W - 0.6);
      exits.push({ kind: "landing", gx, gz, nx: f.nx, nz: f.nz, tx: ttx, tz: ttz, ty: landY });
    }
    stairs.push(st);
    flights.push({ top: [x, z], end: onFrame(f, END, 0).map((v) => +v.toFixed(1)) as [number, number] });
    flightTris.stone += wall.tris - stone0;
    flightTris.iron += iron.tris - iron0;
    // the outline on the water (for the foam)
    const c = [onFrame(f, -HEAD, 0), onFrame(f, -HEAD, W), onFrame(f, END, W), onFrame(f, END, 0)];
    for (let i = 0; i < 3; i++) outlines.push([...c[i], ...c[i + 1]]);
  }

  function heightAt(x: number, z: number): { y: number; landing: boolean } | null {
    for (const st of stairs) {
      const [s, u] = toFrame(st.f, x, z);
      if (s < 0 || u < 0 || s > END || u > W) continue;
      // between the wall line and U0 the quay's edge stones stand over the flight: the quay's height (you step off
      // them onto the first treads; lower down they are the wall beside you, rijnkaai.ts faceNear)
      if (u < U0) return { y: 0, landing: false };
      if (s <= FLIGHT) {
        // a smooth slope through the middle of the treads: the camera glides down. The parapet is stone.
        if (u <= WIDTH - WALK_PAR) return { y: slopeY(st, s), landing: false };
        continue;
      }
      // the parapet runs on a hand past the last tread, then the foot pier stands on the landing
      if (u > WIDTH && s <= FOOT0) continue;
      if (u > W - NEWEL && s >= FOOT0 && s <= FOOT1) continue;
      return { y: st.landY, landing: true };
    }
    return null;
  }

  /**
   * The top of the stone of a flight near (s, u) in its frame, `pad` metres round: the treads fall along s, so the
   * highest stone lies toward the top; the parapet stands PAR_H over the nosings, the piers higher.
   */
  function stoneTop(st: Stair, s: number, u: number, pad: number): number {
    const s0 = s - pad;
    if (s0 < 0) return COPE_Y + NEWEL_H + CAP + 0.07; // the head of the flight and its pier
    const sp = Math.min(s0, END);
    let top = sp <= FLIGHT ? treadY(st, Math.max(-1, Math.min(TREADS, Math.floor((sp - TOP) / GOING)))) : st.landY;
    if (u - pad < U0) top = Math.max(top, COPE_Y); // the wall over the steps, and the edge stones on it
    if (u + pad > WIDTH) {
      const par = sp <= FOOT0 ? parTop(st, sp) : sp <= FOOT1 ? st.landY + NEWEL_H + CAP + 0.07 : st.landY;
      top = Math.max(top, par);
    }
    return top;
  }

  function solidAt(x: number, z: number, pad: number, level?: number): boolean {
    for (const st of stairs) {
      const [s, u] = toFrame(st.f, x, z);
      if (s > -HEAD - pad && s < END + pad && u > -0.5 && u < W + pad) {
        // M6 tides: with a level given, a flight under deep water is open water for a swimmer
        if (level === undefined || stoneTop(st, s, u, pad) > level - WADE) return true;
      }
    }
    return false;
  }

  /** M6 tides: where a swimmer finds his feet on a flooded flight: the treads at wading depth. */
  function floodExit(st: Stair, level: number): Exit | null {
    const deep = level - WADE; // the tread at this height is where swimming stops
    if (deep <= st.landY + 0.05 || deep >= 0) return null;
    const sLine = slopeS(st, deep);
    const sOut = Math.max(0.3, slopeS(st, level - 0.55)); // knee to thigh deep
    const uMid = (U0 + 0.42 + WIDTH - WALK_PAR) / 2; // the middle of the walk down
    const [gx, gz] = onFrame(st.f, Math.min(END - 0.4, sLine + 0.75), uMid);
    const [tx, tz] = onFrame(st.f, sOut, uMid);
    return { kind: "landing", gx, gz, nx: st.f.tx, nz: st.f.tz, tx, tz, ty: slopeY(st, sOut) };
  }

  function exitNear(x: number, z: number, reach: number): Exit | null {
    let best: Exit | null = null;
    let bd = reach;
    const level = levelAt(x, z);
    for (const e of exits) {
      // a ladder whose top is under water, or a landing that is too deep or too high to climb onto
      if (e.kind === "ladder" ? e.ty < level + 0.3 : level > e.ty + WADE || level < e.ty - 0.9) continue;
      const d = Math.hypot(e.gx - x, e.gz - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    for (const st of stairs) {
      if (level <= st.landY + WADE) continue;
      const e = floodExit(st, level);
      if (!e) continue;
      const d = Math.hypot(e.gx - x, e.gz - z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  function flush(scene: THREE.Object3D): void {
    if (!wall.empty) {
      const mesh = new THREE.Mesh(wall.build(), mats.wall);
      mesh.name = "quay_steps";
      if (flightTris.stone) mesh.userData.flightTris = flightTris;
      scene.add(mesh);
    }
    if (!iron.empty) {
      const mesh = new THREE.Mesh(iron.build(), ironMat);
      mesh.name = "quay_iron";
      scene.add(mesh);
    }
    wall = new Mason();
    iron = new Geo(tideShade([0.9, 0.86, 0.82]), 1, tideCuts());
  }

  return { heightAt, solidAt, exitNear, colliders, ladders, flights, outlines, addFlight, addLadder, flush };
}

/**
 * Distance to the nearest wall on the water, as a texture (R: 0..8 m in 0..1),
 * for the foam and the lighter water along the quays. `box` = x0, z0, width, depth.
 */
export function shoreTexture(segments: number[][], box: [number, number, number, number], res = 0.5): THREE.DataTexture {
  const [x0, z0, w, h] = box;
  const W = Math.ceil(w / res);
  const H = Math.ceil(h / res);
  const MAX = 8;
  const d = new Float32Array(W * H).fill(MAX);
  for (const [ax, az, bx, bz] of segments) {
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - MAX - x0) / res));
    const i1 = Math.min(W - 1, Math.ceil((Math.max(ax, bx) + MAX - x0) / res));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz) - MAX - z0) / res));
    const j1 = Math.min(H - 1, Math.ceil((Math.max(az, bz) + MAX - z0) / res));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const px = x0 + (i + 0.5) * res;
        const pz = z0 + (j + 0.5) * res;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / L2)) : 0;
        const dist = Math.hypot(px - (ax + (bx - ax) * t), pz - (az + (bz - az) * t));
        const k = j * W + i;
        if (dist < d[k]) d[k] = dist;
      }
  }
  const px = new Uint8Array(W * H);
  for (let k = 0; k < px.length; k++) px[k] = Math.round((d[k] / MAX) * 255);
  const t = new THREE.DataTexture(px, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}
