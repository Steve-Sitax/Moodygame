// The lamplighters' rounds (M6 town life). Pure code with no imports: the server builds
// the rounds (lamplighters.ts) and the client imports this file to light each gas lamp when
// its lamplighter reaches it, and to walk him along his round (game/lamplighter.ts).
//
// A round is a real path on the walk map from lamp to lamp. At dusk the lamplighter walks
// it and each lamp lights when he gets there; at dawn he walks it again and puts them out,
// in the same order. The ENGINE owns the times: a round starts at a fixed hour and is walked
// in a fixed span of game time, so any lamp's state is a function of the clock alone.
//
// The game clock runs 30 times faster than life (M7: a game hour is two real minutes): unseen,
// the lamplighter keeps the round's pace (like everyone unseen in the town); seen, the client
// walks him at a real walking pace and holds back the lamps ahead of him until he reaches them.
// M7 lamps (2026-09-25): three rounds, and windows long enough that a lamplighter Jef follows
// from his first lamp finishes his round inside it at a walk (seenPace, followedFinish).

/**
 * Real seconds a game hour takes: shared/clock.ts REAL_S_PER_GAME_HOUR, written out here because the
 * client imports this file and cannot import a path ending in .ts (townlife.test.ts checks the two agree).
 */
export const REAL_S_PER_GAME_HOUR = 120;

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

/**
 * When the rounds run (game hours) and how long they take. Sunday is the same: lamps burn every night.
 * M7 lamps (2026-09-25): a game hour is two real minutes, and a lamplighter Jef follows walks in real
 * time. So the dusk round starts as the light goes (16:45; the sky dims from 17:00 to 18:30), the three
 * rounds 3 minutes apart, and each window closes by 20:33. The dawn round puts them out from 5:00 to
 * 8:42. Was 17:36 + 2.2 h and 5:30 + 1.4 h: followed, at a walk, a round took three times that.
 */
export const DUSK_START = 16.75;
export const DUSK_SPAN_H = 3.7;
/** The rounds' dusk starts, one after another (round i starts at DUSK_START + i * DUSK_STAGGER_H). */
export const DUSK_STAGGER_H = 0.05;
export const DAWN_START = 5;
export const DAWN_SPAN_H = 3.7;
/**
 * Full dark (the sky's night, 21:00) and full day (9:00). A lamplighter Jef follows who is held up past
 * his window (an opening bridge, a crowd) goes on until then, and the lamps ahead wait for him; at these
 * hours the plan takes over. Unseen, every lamp keeps the plan (inside the window).
 */
export const DUSK_LAST = 21;
export const DAWN_LAST = 9;
/** A lamp's stop, counted as this many metres of the round (setting the ladder, the pole up, the flame). */
export const STOP_M = 14;
/**
 * Seen, he walks at Jef's walking pace (m/s) or, when that would not finish his round in the window, a
 * little faster (seenPace): at most a brisk walk (SEEN_PACE_MAX) on a round nothing holds up (the tests
 * check every round). Held up (a boat through an opening bridge keeps him at its end a minute or two of
 * real time), he hurries to make it up, at most SEEN_HURRY: Jef keeps up with his own hurry (3.4 m/s).
 * He stops this long (real seconds) at each lamp: the pole up into the lantern, the flame, the pole down.
 */
export const SEEN_PACE = 1.55;
export const SEEN_PACE_MAX = 1.9;
export const SEEN_HURRY = 2.5;
export const SEEN_STOP_S = 2.4;
/** Seen, he means to be done this long (real seconds) before his window closes. */
export const SEEN_SPARE_S = 12;

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

/** The hour a round's window closes (dusk: its own start + DUSK_SPAN_H; dawn: DAWN_START + DAWN_SPAN_H). */
export function windowEnd(r: LampRound, kind: "dusk" | "dawn"): number {
  return kind === "dusk" ? r.dusk + DUSK_SPAN_H : DAWN_START + DAWN_SPAN_H;
}

/** Past the window but before full dark (dusk) or full day (dawn): a followed lamplighter held up may finish. */
export function inGrace(r: LampRound, kind: "dusk" | "dawn", hour: number): boolean {
  const h = ((hour % 24) + 24) % 24;
  return h >= windowEnd(r, kind) && h < (kind === "dusk" ? DUSK_LAST : DAWN_LAST);
}

/**
 * Seen: the pace (m/s) he walks to lamp `idx` so as to be done with the round before its window closes.
 * `legM` is how far he still has to that lamp's foot; after it, the round's path to the last lamp and a
 * stop at each lamp left. Never below SEEN_PACE (Jef's walk); above SEEN_PACE_MAX (a brisk walk) only
 * when something held him up, and never above SEEN_HURRY.
 */
export function seenPace(r: LampRound, idx: number, legM: number, hour: number, kind: "dusk" | "dawn"): number {
  const n = r.lamps.length;
  if (idx >= n) return SEEN_PACE;
  const h = ((hour % 24) + 24) % 24;
  const left = (windowEnd(r, kind) - h) * REAL_S_PER_GAME_HOUR - SEEN_SPARE_S - (n - idx) * SEEN_STOP_S;
  const rest = Math.max(0, legM) + (r.at[n - 1] - r.at[idx]);
  const want = left > 0 ? rest / left : SEEN_HURRY;
  return Math.min(SEEN_HURRY, Math.max(SEEN_PACE, want));
}

/**
 * Jef follows him from the first lamp at the window's start: the hour the last lamp is lit (dusk) or
 * put out (dawn), walking the round's path at seenPace with SEEN_STOP_S at each lamp; and the fastest
 * pace he walked. (The client walks him the same way; its paths through the crowd run a little longer.)
 */
export function followedFinish(r: LampRound, kind: "dusk" | "dawn"): { done: number; maxPace: number; realS: number } {
  const start = kind === "dusk" ? r.dusk : DAWN_START;
  let h = start;
  let maxPace = 0;
  for (let k = 0; k < r.lamps.length; k++) {
    const leg = k ? r.at[k] - r.at[k - 1] : 0;
    if (leg > 0) {
      const pace = seenPace(r, k, leg, h, kind);
      maxPace = Math.max(maxPace, pace);
      h += leg / pace / REAL_S_PER_GAME_HOUR;
    }
    // the lamp lights (or goes out) halfway through the stop
    h += (SEEN_STOP_S * (k === r.lamps.length - 1 ? 0.5 : 1)) / REAL_S_PER_GAME_HOUR;
  }
  return { done: h, maxPace, realS: (h - start) * REAL_S_PER_GAME_HOUR };
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
