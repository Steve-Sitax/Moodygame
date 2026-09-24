// The rules for Jef's handcart in the street (M6 handcart), pure (no three.js): the server's
// tests run them with stubs (server/test/handcart.test.ts). game/handcart.ts plays them.
//
// Jef walks behind the cart with both hands on the grips. The cart points the way he faces (it
// swings round after him when he turns, a little behind); its axle is REACH ahead of the grips.
// Every step is tried first: the whole cart (bed, wheels, shafts) must stand on flat open ground
// of the walk map, clear of walls, the water's edge, steps, things and people. If the step and
// the turn do not fit, the step alone is tried, then the turn alone; else he stands where he is.

/** The grips are this far ahead of Jef's middle; the axle this far ahead of the grips (traffic.ts PushCart: GRIP_Z 2.15 at rest). */
export const GRIP_AHEAD = 0.5;
export const REACH = 2.1;
/** The bed round the axle: half its length and half its width (traffic.ts PushCart rects[0]). */
export const BED_HL = 0.95;
export const BED_HW = 0.72;
/** How fast the cart swings round after him (rad/s): walking, and standing. */
export const TURN_WALK = 1.8;
export const TURN_STAND = 0.9;
/** Anything higher or lower than this under the cart (m) is not flat: steps, a slope, a deck. */
export const FLAT_M = 0.08;
/** Any part of the cart over open water: never, however wedged it is. */
const WATER = 99;

export interface CartPose {
  /** Jef's feet. */
  px: number;
  pz: number;
  /** The way the cart points (a yaw: forward = (sin, cos)). */
  dir: number;
}

/** Where the grips and the axle are for Jef at (px, pz) with the cart pointing `dir`. */
export function cartPoints(p: CartPose): { gx: number; gz: number; ax: number; az: number } {
  const sx = Math.sin(p.dir);
  const cz = Math.cos(p.dir);
  const gx = p.px + sx * GRIP_AHEAD;
  const gz = p.pz + cz * GRIP_AHEAD;
  return { gx, gz, ax: gx + sx * REACH, az: gz + cz * REACH };
}

/**
 * Circles that cover the cart (x, z, radius): the bed in three rows of three, the shafts in two.
 * The wheels are at the bed's sides by the axle.
 */
export function footprint(p: CartPose): Array<[number, number, number]> {
  const { ax, az, gx, gz } = cartPoints(p);
  const fx = Math.sin(p.dir);
  const fz = Math.cos(p.dir);
  const rx = fz; // to the side
  const rz = -fx;
  const out: Array<[number, number, number]> = [];
  for (const a of [-0.62, 0, 0.62])
    for (const s of [-0.42, 0, 0.42]) out.push([ax + fx * a + rx * s, az + fz * a + rz * s, 0.32]);
  // the shafts, from the bed back toward the grips (Jef's own body stands at the grips)
  for (const t of [0.35, 0.7]) out.push([ax + (gx - ax) * t, az + (gz - az) * t, 0.3]);
  return out;
}

export interface CartWorld {
  /** Open ground for a body of radius r (walls, water, steps, things; the cart's own rects are out of the way). */
  free(x: number, z: number, r: number): boolean;
  /** Height of the ground to stand on (0 on the flat quays and streets). */
  base(x: number, z: number): number;
  /** People in the street now. */
  people(): Iterable<{ x: number; z: number }>;
  /** Open water (off the quay edge): the cart never goes there, not even a wheel's width. */
  water?(x: number, z: number): boolean;
}

/** Does the whole cart fit here, on flat open ground, with nobody in the way? */
export function cartFits(p: CartPose, w: CartWorld, ground = 0): boolean {
  return misfit(p, w, ground) === 0;
}

/** How many parts of the cart do not fit here (0: it fits). Steps and water count double. */
export function misfit(p: CartPose, w: CartWorld, ground = 0, stop = Infinity): number {
  const pts = footprint(p);
  let n = 0;
  for (const [x, z, r] of pts) {
    // (the whole round of each part, not just its middle: no part of the bed hangs over the edge)
    if (w.water && (w.water(x, z) || w.water(x + r, z) || w.water(x - r, z) || w.water(x, z + r) || w.water(x, z - r))) return WATER;
    if (Math.abs(w.base(x, z) - ground) > FLAT_M) n += 2;
    else if (!w.free(x, z, r)) n++;
    if (n >= stop) return n;
  }
  for (const q of w.people()) {
    for (const [x, z, r] of pts) if (Math.hypot(q.x - x, q.z - z) < r + 0.25) n++;
  }
  return n;
}

const angDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/** The cart swings toward the way Jef faces (`face`, a cart yaw), at its own pace. */
export function swing(dir: number, face: number, dt: number, moving: boolean): number {
  const d = angDiff(face, dir);
  const max = (moving ? TURN_WALK : TURN_STAND) * dt;
  return dir + Math.max(-max, Math.min(max, d));
}

/**
 * One step: Jef wants to go from `from` to (nx, nz) (the walk rules already let him), the cart
 * swinging toward `face`. Returns what fits: the step and the turn, the step alone, the turn
 * alone, or nothing (he stands, the cart as it was). `moved` says whether he got anywhere.
 */
export function stepCart(from: CartPose, nx: number, nz: number, face: number, dt: number, w: CartWorld, ground = 0): CartPose & { moved: boolean; blocked: boolean } {
  const moving = Math.hypot(nx - from.px, nz - from.pz) > 1e-4;
  const dir = swing(from.dir, face, dt, moving);
  const tries: CartPose[] = [
    { px: nx, pz: nz, dir },
    { px: nx, pz: nz, dir: from.dir },
    { px: from.px, pz: from.pz, dir },
  ];
  // wedged already (someone stepped up against it, a wall at the turn): he may work it free, by a
  // move that makes it better, or by pulling it back the way it came without making it worse;
  // never deeper in
  const now = misfit(from, w, ground);
  for (const t of tries) {
    if (t.px === from.px && t.pz === from.pz && t.dir === from.dir) continue;
    const m = misfit(t, w, ground, now + 1);
    const back = (t.px - from.px) * Math.sin(from.dir) + (t.pz - from.pz) * Math.cos(from.dir) < -1e-4 && t.dir === from.dir;
    if (m === 0 || (now > 0 && (m < now || (back && m <= now)) && (m < WATER || back))) return { ...t, moved: t.px !== from.px || t.pz !== from.pz, blocked: t !== tries[0] };
  }
  return { ...from, moved: false, blocked: moving || dir !== from.dir };
}

// ------------------------------------------------------------------ vehicles going round (world/traffic.ts)

/** A dray or a handcart of the quay traffic held up this long by Jef or a thing goes round it. */
export const GO_ROUND_AFTER_S = 6;
/** How far to the side it goes (m), and how fast it moves over (m/s). */
export const GO_ROUND_OFF = 1.7;
export const GO_ROUND_PACE = 0.7;
/** It comes back to its lane this far (m) past the place it went round. */
export const GO_ROUND_BACK_M = 10;

export interface GoRound {
  /** Seconds held up. */
  wait: number;
  /** Lateral offset now, and the one it is going to (m; + to the left of its way). */
  off: number;
  want: number;
  /** Metres gone since it moved over. */
  gone: number;
}

/**
 * Each frame for a vehicle on a fixed round: `blocked` by Jef or a thing (not by the vehicle
 * ahead of it on the round: that one it follows), `clear(off)` whether that side lane is open
 * ahead, `moved` metres along its round. Moves `g.off` toward where it should be; returns it.
 */
export function goRound(g: GoRound, dt: number, blocked: boolean, clear: (off: number) => boolean, moved: number): number {
  if (blocked) g.wait += dt;
  else g.wait = 0;
  if (g.want === 0 && g.wait > GO_ROUND_AFTER_S) {
    // the side lane that is clear: the right-hand one first (as on the street), then the left
    for (const side of [-GO_ROUND_OFF, GO_ROUND_OFF]) {
      if (clear(side)) {
        g.want = side;
        g.gone = 0;
        g.wait = 0;
        break;
      }
    }
  } else if (g.want !== 0) {
    g.gone += moved;
    // past it: back into the lane; held up on the side lane as well: back into the lane, and think again
    if ((g.gone > GO_ROUND_BACK_M && clear(0)) || g.wait > GO_ROUND_AFTER_S) {
      g.want = 0;
      g.wait = 0;
    }
  }
  const d = g.want - g.off;
  const step = GO_ROUND_PACE * dt;
  g.off = Math.abs(d) <= step ? g.want : g.off + Math.sign(d) * step;
  return g.off;
}
