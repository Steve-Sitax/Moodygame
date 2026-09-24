// The lamplighters' rounds (M6 town life). Pure code with no imports: the server builds
// the rounds (lamplighters.ts) and the client imports this file to light each gas lamp when
// its lamplighter reaches it, and to walk him along his round (game/lamplighter.ts).
//
// A round is a real path on the walk map from lamp to lamp. At dusk the lamplighter walks
// it and each lamp lights when he gets there; at dawn he walks it again and puts them out,
// in the same order. The ENGINE owns the times: a round starts at a fixed hour and is walked
// in a fixed span of game time, so any lamp's state is a function of the clock alone.
//
// The game clock runs 180 times faster than life (a game hour is 20 real seconds): unseen,
// the lamplighter keeps the round's pace (like everyone unseen in the town); seen, the client
// walks him at a brisk real pace and holds back the lamps ahead of him until he reaches them.

export type RPt = [number, number];

export interface RoundLamp {
  /** "q0".."q5": the six lamps of the Rijnkaai quay; "d0"..: the city's decor lamps (city.json order). */
  id: string;
  /** The lamp post. */
  x: number;
  z: number;
  /** Where he stands at its foot (open, reachable ground). */
  sx: number;
  sz: number;
}

export interface LampRound {
  id: string;
  /** The resident who walks it. */
  lamplighter: string;
  lamps: RoundLamp[];
  /** The walked path from the first lamp's foot to the last, simplified. */
  path: RPt[];
  /** Metres along the path to each lamp's foot. */
  at: number[];
  /** Length of the path in metres. */
  len: number;
  /** Hour the dusk round starts (the dawn round starts at DAWN_START). */
  dusk: number;
}

/** When the rounds run (game hours) and how long they take. Sunday is the same: lamps burn every night. */
export const DUSK_START = 17.6;
export const DUSK_SPAN_H = 2.2;
export const DAWN_START = 5.5;
export const DAWN_SPAN_H = 1.4;
/** A lamp's stop, counted as this many metres of the round (setting the ladder, the pole up, the flame). */
export const STOP_M = 14;
/** Seen, he walks at this pace (m/s) and stops this long (real seconds) at each lamp. */
export const SEEN_PACE = 1.55;
export const SEEN_STOP_S = 3.2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The round's length counting the stops. */
export function roundEff(r: LampRound): number {
  return r.len + r.lamps.length * STOP_M;
}

/** Where along the round (effective metres, stops counted) lamp k's stop begins. */
export function stopAt(r: LampRound, k: number): number {
  return r.at[k] + k * STOP_M;
}

/** The hour lamp k lights at dusk, and the hour it goes out at dawn. */
export function lampTimes(r: LampRound, k: number): { on: number; off: number } {
  const eff = roundEff(r) || 1;
  const done = (stopAt(r, k) + STOP_M * 0.6) / eff;
  return { on: r.dusk + done * DUSK_SPAN_H, off: DAWN_START + done * DAWN_SPAN_H };
}

/** Is lamp k of the round burning at this hour (0-24, fractions)? */
export function lampLit(r: LampRound, k: number, hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  const t = lampTimes(r, k);
  return h >= t.on || h < t.off;
}

/** Which round window runs at this hour: dusk (lighting), dawn (putting out), or none. u: 0..1 through it. */
export function roundWindow(r: LampRound, hour: number): { kind: "dusk" | "dawn" | null; u: number } {
  const h = ((hour % 24) + 24) % 24;
  if (h >= r.dusk && h < r.dusk + DUSK_SPAN_H) return { kind: "dusk", u: (h - r.dusk) / DUSK_SPAN_H };
  if (h >= DAWN_START && h < DAWN_START + DAWN_SPAN_H) return { kind: "dawn", u: (h - DAWN_START) / DAWN_SPAN_H };
  return { kind: null, u: 0 };
}

/**
 * The planned state of the round at this hour: how many lamps he has done in this window
 * (lit at dusk, put out at dawn), where he is, and whether he stands at a lamp now.
 */
export function roundState(r: LampRound, hour: number): { kind: "dusk" | "dawn" | null; done: number; x: number; z: number; atLamp: number } {
  const w = roundWindow(r, hour);
  if (!w.kind) return { kind: null, done: 0, x: r.lamps[0]?.sx ?? 0, z: r.lamps[0]?.sz ?? 0, atLamp: -1 };
  const e = clamp01(w.u) * roundEff(r);
  let done = 0;
  let atLamp = -1;
  for (let k = 0; k < r.lamps.length; k++) {
    const s = stopAt(r, k);
    if (e >= s + STOP_M * 0.6) done = k + 1;
    if (e >= s && e < s + STOP_M) atLamp = k;
  }
  // along the path: effective metres less the stops already made
  let along: number;
  if (atLamp >= 0) along = r.at[atLamp];
  else {
    let stops = 0;
    for (let k = 0; k < r.lamps.length; k++) if (e >= stopAt(r, k) + STOP_M) stops++;
    along = Math.min(r.len, e - stops * STOP_M);
  }
  const p = pointAlong(r.path, along);
  return { kind: w.kind, done, x: p[0], z: p[1], atLamp };
}

/** The point this many metres along a polyline. */
export function pointAlong(path: RPt[], d: number): RPt {
  if (!path.length) return [0, 0];
  let left = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (left <= L) {
      const k = L > 0 ? left / L : 0;
      return [ax + (bx - ax) * k, az + (bz - az) * k];
    }
    left -= L;
  }
  return path[path.length - 1];
}

/** Metres along the path to the point of it nearest (x, z) (for a lamplighter who was walked by hand). */
export function alongOf(path: RPt[], x: number, z: number): number {
  let best = Infinity;
  let bestAlong = 0;
  let acc = 0;
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const L = Math.sqrt(L2);
    const t = L2 > 0 ? clamp01(((x - ax) * dx + (z - az) * dz) / L2) : 0;
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < best) {
      best = d;
      bestAlong = acc + L * t;
    }
    acc += L;
  }
  return bestAlong;
}
