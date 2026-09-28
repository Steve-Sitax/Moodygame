// Where the town's carts with a whole pile are (shared/goods.ts CART_RUNS: the Hessenatie's dray with the casks, the
// handcart with the Rijnkaai's sacks), from the clock alone. Pure: the game draws the cart by it (client
// world/goodsDrays.ts) and the server's town map puts it on the map by it (server/src/town/runs.ts), so both agree.
// (Moved here from goodsDrays.ts for the trade plan's T1, 2026-09-28: the numbers are unchanged.)

import { REAL_S_PER_GAME_MIN } from "./clock.ts";
import type { CartRun } from "./goods.ts";

/** Walking pace of the men (m a real second), and so of the carts. */
export const CART_RUN_PACE = 1.1;
/** Metres a game minute. */
export const CART_RUN_M_PER_MIN = CART_RUN_PACE * REAL_S_PER_GAME_MIN;
/** They stand this many game minutes before a load is taken and after it is set down. */
export const CART_RUN_SLACK = 8;

export type CartPt = [number, number];
export interface CartLeg {
  pts: CartPt[];
  /** Arc length at each point. */
  cum: number[];
  /** Game minutes of the day it starts and ends. */
  t0: number;
  t1: number;
  /** Heading at its start (where the last leg left the cart): before its start the way runs straight back along it. */
  yaw0: number;
}

/** The legs of a day in order, as dayPlan makes them. */
export const CART_LEG_NAMES = ["out", "deliver", "back", "fetch", "bring", "home"] as const;

const heading = (a: CartPt, b: CartPt) => Math.atan2(b[0] - a[0], b[1] - a[1]);

/** Corners cut round (Chaikin), the ends kept. */
function smooth(pts: CartPt[], rounds = 2): CartPt[] {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3) return p;
    const q: CartPt[] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i];
      const [bx, bz] = p[i + 1];
      if (i > 0) q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25]);
      if (i + 2 < p.length) q.push([ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

function legOf(raw: CartPt[], yaw0: number): Omit<CartLeg, "t0" | "t1"> {
  // (points closer than a centimetre dropped: an arc begins where the last line ended)
  const clean: CartPt[] = [];
  for (const p of raw) if (!clean.length || Math.hypot(p[0] - clean[clean.length - 1][0], p[1] - clean[clean.length - 1][1]) > 0.01) clean.push(p);
  const pts = smooth(clean);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum, yaw0 };
}

const endYaw = (l: Omit<CartLeg, "t0" | "t1">) => heading(l.pts[l.pts.length - 2] ?? l.pts[0], l.pts[l.pts.length - 1]);

/** The day's legs of a run, timed: to the pile before `out`, on after it, home after `down`; the same in the afternoon. */
export function dayPlan(r: CartRun): CartLeg[] {
  const L = r.legs;
  const legs: CartLeg[] = [];
  // (the first leg starts where the last one of the day leaves the cart: in the yard, as it came in)
  const last = legOf(L.home, 0);
  let yaw = endYaw(last);
  const add = (raw: CartPt[], when: { arrive?: number; depart?: number }) => {
    const l = legOf(raw, yaw);
    const dur = l.cum[l.cum.length - 1] / CART_RUN_M_PER_MIN;
    const t0 = when.depart ?? when.arrive! - dur;
    legs.push({ ...l, t0, t1: t0 + dur });
    yaw = endYaw(l);
  };
  add(L.out, { arrive: r.out - CART_RUN_SLACK });
  add(L.deliver, { depart: r.out + CART_RUN_SLACK });
  add(L.back, { depart: r.down + CART_RUN_SLACK });
  add(L.fetch, { arrive: r.back - CART_RUN_SLACK });
  add(L.bring, { depart: r.back + CART_RUN_SLACK });
  add(L.home, { depart: r.home + CART_RUN_SLACK });
  return legs;
}

/** On a leg at arc length s: the point and heading; before its start straight back along its first heading, past its end straight on. */
export function along(l: Omit<CartLeg, "t0" | "t1">, s: number, out: { x: number; z: number; yaw: number }): void {
  const L = l.cum[l.cum.length - 1];
  if (s <= 0) {
    out.yaw = l.yaw0;
    out.x = l.pts[0][0] + Math.sin(l.yaw0) * s;
    out.z = l.pts[0][1] + Math.cos(l.yaw0) * s;
    return;
  }
  if (s >= L) {
    const n = l.pts.length - 1;
    out.yaw = heading(l.pts[n - 1], l.pts[n]);
    out.x = l.pts[n][0] + Math.sin(out.yaw) * (s - L);
    out.z = l.pts[n][1] + Math.cos(out.yaw) * (s - L);
    return;
  }
  let i = 1;
  while (i < l.cum.length - 1 && l.cum[i] < s) i++;
  const f = (s - l.cum[i - 1]) / (l.cum[i] - l.cum[i - 1] || 1);
  out.x = l.pts[i - 1][0] + (l.pts[i][0] - l.pts[i - 1][0]) * f;
  out.z = l.pts[i - 1][1] + (l.pts[i][1] - l.pts[i - 1][1]) * f;
  out.yaw = heading(l.pts[i - 1], l.pts[i]);
}

/** Where a run is at game minute t of a day: which leg (the day's last, before the first: in the yard) and how far along it (m). */
export function cartAt(legs: CartLeg[], t: number, sunday: boolean): { leg: number; s: number; moving: boolean } {
  const lastLeg = legs.length - 1;
  const endOf = (k: number) => legs[k].cum[legs[k].cum.length - 1];
  if (sunday || t < legs[0].t0) return { leg: lastLeg, s: endOf(lastLeg), moving: false };
  let k = 0;
  for (let i = 0; i < legs.length; i++) if (t >= legs[i].t0) k = i;
  const s = Math.min(endOf(k), (t - legs[k].t0) * CART_RUN_M_PER_MIN);
  return { leg: k, s, moving: t < legs[k].t1 };
}
