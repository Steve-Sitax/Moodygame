import * as THREE from "three";
import type { Props } from "./props3d";

// The draught horse's rig and gaits (the detail pass of 2026-09-27, docs/milestones/vehicle-detail.md). The horse of
// props.glb (tools/blender/build_props.py horse()) is a body and eight leg parts: each leg is split at the knee (front)
// or the hock (hind). The upper part hangs from a pivot hidden in the shoulder or the hip, the lower part from the
// joint. horsePose() bends them with two-bone IK: a hoof on the ground stays where it stands and rolls from heel to toe
// (the body sinks a little where the legs spread, as a walking horse's does), a lifted hoof folds under the knee or
// hock. Used by horses.ts (the omnibus, the train, the hearse, the fire pump) and traffic.ts (the drays).
// KEEP IN STEP with build_props.py HORSE_RIG, HORSE_GAITS and horse_pose (the previews use that one).

interface Rig {
  /** The leg's x (left +) and its pivot, joint and sole's middle as (z forward, y up) in the horse's frame. */
  x: number;
  pz: number;
  py: number;
  jz: number;
  jy: number;
  sz: number;
  toe: number;
  heel: number;
  L1: number;
  L2: number;
  /** The rest angles of the upper and lower part (from straight down, + forward). */
  rest1: number;
  rest2: number;
  /** +1: the joint bends forward (the knee), -1: backward (the hock). */
  bend: number;
}

function rig(x: number, pivot: [number, number], joint: [number, number], sole: number, bend: number): Rig {
  const [pz, py] = pivot;
  const [jz, jy] = joint;
  return {
    x,
    pz,
    py,
    jz,
    jy,
    sz: sole,
    toe: 0.11,
    heel: 0.08,
    L1: Math.hypot(jz - pz, jy - py),
    L2: Math.hypot(sole - jz, jy),
    rest1: Math.atan2(jz - pz, py - jy),
    rest2: Math.atan2(sole - jz, jy),
    bend,
  };
}

const FRONT = rig(0.19, [0.62, 1.4], [0.645, 0.5], 0.67, 1);
const HIND = rig(0.2, [-0.62, 1.38], [-0.76, 0.58], -0.67, -1);

/** The four legs: left fore, right fore, left hind, right hind; their phase in the walk (left hind, left fore, right
 * hind, right fore: a four-beat walk) and in the trot (the diagonal pairs together). */
const LEGS = [
  { rig: FRONT, side: 1, walk: 0.25, trot: 0.0 },
  { rig: FRONT, side: -1, walk: 0.75, trot: 0.5 },
  { rig: HIND, side: 1, walk: 0.0, trot: 0.5 },
  { rig: HIND, side: -1, walk: 0.5, trot: 0.0 },
];
/** The share of the step a hoof is on the ground, how high the front and hind hooves lift, the body's lift. */
const GAITS = {
  walk: { stance: 0.62, liftF: 0.16, liftH: 0.12, body: 0 },
  trot: { stance: 0.38, liftF: 0.26, liftH: 0.2, body: 0.03 },
};
/** Metres of ground in one step cycle when the caller does not say (the omnibus and the train: v / 1.35 x 0.95). */
export const WALK_STRIDE = 1.42;
export const TROT_STRIDE = 2.8;
/** Where the breath comes out: the nostrils, in the horse's frame (x, y up, z forward). */
export const HORSE_NOSE: [number, number, number] = [0, 1.68, 1.56];

/** A leg's two parts in the horse's frame: x; the upper part at (uy, uz) pitched by up, the lower at (ly, lz) by lp
 * (pitch > 0 swings a part back, as three's Euler x in YXZ order). */
export interface LegPose {
  x: number;
  uy: number;
  uz: number;
  up: number;
  ly: number;
  lz: number;
  lp: number;
}
export interface HorsePose {
  /** The body's height over the ground (a few cm down where the legs spread, up in the trot's float). */
  bob: number;
  legs: LegPose[];
}

export function newHorsePose(): HorsePose {
  return { bob: 0, legs: LEGS.map(() => ({ x: 0, uy: 0, uz: 0, up: 0, ly: 0, lz: 0, lp: 0 })) };
}

const ik = { a1: 0, jz: 0, jy: 0, a2: 0 };
function solve(r: Rig, py: number, tz: number, ty: number): typeof ik {
  const dz = tz - r.pz;
  const dy = ty - py;
  const D = Math.min(Math.max(Math.hypot(dz, dy), Math.abs(r.L1 - r.L2) + 1e-4), r.L1 + r.L2 - 1e-5);
  const a = Math.acos(THREE.MathUtils.clamp((r.L1 * r.L1 + D * D - r.L2 * r.L2) / (2 * r.L1 * D), -1, 1));
  ik.a1 = Math.atan2(dz, -dy) + r.bend * a;
  ik.jz = r.pz + r.L1 * Math.sin(ik.a1);
  ik.jy = py - r.L1 * Math.cos(ik.a1);
  ik.a2 = Math.atan2(tz - ik.jz, ik.jy - ty);
  return ik;
}

const tz = [0, 0, 0, 0];
const ty = [0, 0, 0, 0];
const tw = [0, 0, 0, 0];
/**
 * Where the hooves go at `gait` (into tz, ty, tw) and the highest the body may be so every hoof on the ground (or about
 * to be) can reach it. That height has sharp corners (a hoof landing far forward pulls the body down at once), so
 * horsePose does not use it as it is: see bobCurve.
 */
function reach(gait: number, amp: number, trot: boolean, stride: number | undefined): number {
  const g = trot ? GAITS.trot : GAITS.walk;
  const S = (stride ?? (trot ? TROT_STRIDE : WALK_STRIDE)) * g.stance * amp;
  LEGS.forEach((L, k) => {
    const p = (((gait + (trot ? L.trot : L.walk)) % 1) + 1) % 1;
    const n = L.rig.sz;
    if (p < g.stance) {
      // on the ground: the hoof goes back under the body as fast as the body goes on
      tz[k] = n + S * (0.5 - p / g.stance);
      ty[k] = 0;
      tw[k] = 1;
    } else {
      // in the air: forward again, lifted, folded
      const q = (p - g.stance) / (1 - g.stance);
      tz[k] = n - S / 2 + S * q * q * (3 - 2 * q);
      ty[k] = (L.rig === FRONT ? g.liftF : g.liftH) * amp * Math.sin(Math.PI * q);
      tw[k] = Math.max(0, 1 - q / 0.14, (q - 0.86) / 0.14);
    }
  });
  let off = g.body * amp;
  // the hoof rolls over its heel and its toe: lift the sole's middle so its edge is on the ground
  LEGS.forEach((L, k) => {
    const r = solve(L.rig, L.rig.py + off, tz[k], ty[k]);
    const d = r.a2 - L.rig.rest2;
    ty[k] += (d > 0 ? L.rig.heel : L.rig.toe) * Math.sin(Math.abs(d)) * tw[k];
  });
  // the body sinks until every hoof on the ground (or about to be) can reach it
  LEGS.forEach((L, k) => {
    const Lr = (L.rig.L1 + L.rig.L2) * 0.9995;
    const dz = tz[k] - L.rig.pz;
    const c = Math.sqrt(Math.max(0, Lr * Lr - dz * dz)) - L.rig.py + ty[k];
    off = Math.min(off, c + (1 - tw[k]) * 0.5);
  });
  return off;
}

/**
 * The body's height through one step cycle, smooth (Steve, 2026-09-27: the horses "jitter up and down, not natural
 * movement": reach() drops 5 to 10 cm in a hundredth of a step where a hoof lands and climbs back, a saw). The lowest
 * of reach() over an eighth of the cycle round each point, then that averaged over the same eighth (two box blurs of
 * half of it): a smooth wave that is never higher than reach() anywhere, so a planted hoof still stands on the ground.
 * Cached per gait, amp step and stride; horsePose reads it between two amp steps.
 */
const BOB_N = 240;
const BOB_W = BOB_N / 8;
const AMP_STEPS = 10;
const bobCache = new Map<string, Float32Array>();
function bobCurve(trot: boolean, a: number, stride: number | undefined): Float32Array {
  const key = `${trot ? 1 : 0}|${a}|${stride === undefined ? "-" : Math.round(stride * 50)}`;
  let c = bobCache.get(key);
  if (c) return c;
  const amp = a / AMP_STEPS;
  const st = stride === undefined ? undefined : Math.round(stride * 50) / 50;
  const env = new Float32Array(BOB_N);
  for (let i = 0; i < BOB_N; i++) env[i] = reach(i / BOB_N, amp, trot, st);
  const low = new Float32Array(BOB_N);
  for (let i = 0; i < BOB_N; i++) {
    let m = Infinity;
    for (let d = -BOB_W; d <= BOB_W; d++) m = Math.min(m, env[(i + d + BOB_N) % BOB_N]);
    low[i] = m;
  }
  const blur = (src: Float32Array, r: number): Float32Array => {
    const out = new Float32Array(BOB_N);
    for (let i = 0; i < BOB_N; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) s += src[(i + d + BOB_N) % BOB_N];
      out[i] = s / (2 * r + 1);
    }
    return out;
  };
  c = blur(blur(low, BOB_W / 2), BOB_W / 2);
  bobCache.set(key, c);
  return c;
}

function smoothBob(gait: number, amp: number, trot: boolean, stride: number | undefined): number {
  const x = Math.min(Math.max(amp, 0), 1) * AMP_STEPS;
  const a0 = Math.floor(x);
  const a1 = Math.min(a0 + 1, AMP_STEPS);
  const t = x - a0;
  const u = ((((gait % 1) + 1) % 1) * BOB_N) % BOB_N;
  const i0 = Math.floor(u);
  const i1 = (i0 + 1) % BOB_N;
  const f = u - i0;
  const at = (a: number) => {
    const c = bobCurve(trot, a, stride);
    return c[i0] + (c[i1] - c[i0]) * f;
  };
  return at(a0) + (at(a1) - at(a0)) * t;
}

/** The body's height at `gait` in one gait, the hooves' targets left in tz, ty: the smooth wave, and reach() only where
 * the wave, read between its samples and amp steps, would still be a hair high. (smoothBob first: filling its cache
 * runs reach() over the cycle; the reach() last sets this gait's hooves.) */
function bodyAt(gait: number, amp: number, trot: boolean, stride: number | undefined): number {
  const wave = smoothBob(gait, amp, trot, stride);
  return Math.min(wave, reach(gait, amp, trot, stride));
}

const wz = [0, 0, 0, 0];
const wy = [0, 0, 0, 0];
/**
 * The pose at `gait` 0..1 through the step cycle, `amp` 0 (standing) .. 1 (full stride), in a walk or a `trot`.
 * `stride`: metres the horse goes in one cycle (as its caller moves `gait`), so a planted hoof keeps still.
 * `trot` may be a number 0 (walk) .. 1 (trot): between them the hooves' targets and the body's height are blended, so
 * a horse changing gait eases into the new one (Steve, 2026-09-27: the omnibus's horses jumped 7 cm at 1.9 m/s);
 * `stride` is then the trot's and the walk's is its own (WALK_STRIDE).
 */
export function horsePose(out: HorsePose, gait: number, amp: number, trot: boolean | number = false, stride?: number): HorsePose {
  const m = typeof trot === "number" ? Math.min(Math.max(trot, 0), 1) : trot ? 1 : 0;
  let off: number;
  if (m <= 0) off = bodyAt(gait, amp, false, stride);
  else if (m >= 1 || typeof trot === "boolean") off = bodyAt(gait, amp, true, stride);
  else {
    const offW = bodyAt(gait, amp, false, undefined);
    for (let k = 0; k < 4; k++) {
      wz[k] = tz[k];
      wy[k] = ty[k];
    }
    const offT = bodyAt(gait, amp, true, stride);
    const e = m * m * (3 - 2 * m);
    for (let k = 0; k < 4; k++) {
      tz[k] = wz[k] + (tz[k] - wz[k]) * e;
      ty[k] = wy[k] + (ty[k] - wy[k]) * e;
    }
    off = offW + (offT - offW) * e;
  }
  out.bob = off;
  LEGS.forEach((L, k) => {
    const r = solve(L.rig, L.rig.py + off, tz[k], ty[k]);
    const o = out.legs[k];
    o.x = L.side * L.rig.x;
    o.uy = L.rig.py + off;
    o.uz = L.rig.pz;
    o.up = -(r.a1 - L.rig.rest1);
    o.ly = r.jy;
    o.lz = r.jz;
    o.lp = -(r.a2 - L.rig.rest2);
  });
  return out;
}

/** The leg parts in props.glb, in the order of the legs' parts: front upper, front lower, hind upper, hind lower. */
export const LEG_PARTS = ["tr_leg_front", "tr_leg_front_lo", "tr_leg_hind", "tr_leg_hind_lo"] as const;
/** Which of LEG_PARTS each leg's upper and lower part is (legs 0, 1 front; 2, 3 hind). */
export const legPart = (k: number, lower: boolean): number => (k < 2 ? 0 : 2) + (lower ? 1 : 0);

// ---- coats: the mesh is painted bay on the team atlas; another coat points the coat cells elsewhere
// (build_props.py TEAM_CELLS: 0 bay, 1 chestnut, 2 black, 3 roan, 4 black hair, 5 flaxen hair, ... 14 white)
export type Coat = "bay" | "chestnut" | "black" | "roan";
const COATS: Record<Coat, Record<number, number>> = {
  bay: {},
  chestnut: { 0: 1, 2: 1, 4: 5 }, // the coat, the points and the mane
  black: { 0: 2, 14: 2 }, // no white on the hearse's horses
  roan: { 0: 3 },
};
const coated = new WeakMap<THREE.BufferGeometry, Map<Coat, THREE.BufferGeometry>>();
/** The geometry in another coat (a copy with its cells moved; cached, shared: do not dispose). */
export function coatGeometry(g: THREE.BufferGeometry, coat: Coat): THREE.BufferGeometry {
  const map = COATS[coat];
  if (!Object.keys(map).length) return g;
  let byCoat = coated.get(g);
  if (!byCoat) coated.set(g, (byCoat = new Map()));
  const hit = byCoat.get(coat);
  if (hit) return hit;
  const c = g.clone();
  const cell = c.getAttribute("cell") as THREE.BufferAttribute | undefined;
  if (cell) {
    const a = new Float32Array(cell.count * 2);
    for (let i = 0; i < cell.count; i++) {
      const k = Math.round(cell.getY(i)) * 4 + Math.round(cell.getX(i));
      const to = map[k] ?? k;
      a[i * 2] = to % 4;
      a[i * 2 + 1] = Math.floor(to / 4);
    }
    c.setAttribute("cell", new THREE.BufferAttribute(a, 2));
  }
  byCoat.set(coat, c);
  return c;
}

/** The team atlas material the horse's parts are drawn with (props3d: "goods_team", the goods atlas's psx settings). */
export function teamMaterial(props: Props): THREE.Material {
  return props.parts("tr_horse_body")[0]?.material ?? props.materials.goods_team ?? props.materials.goods;
}
