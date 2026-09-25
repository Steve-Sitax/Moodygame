import type * as THREE from "three";
import type { FirstPerson } from "../player/firstPerson";
import type { Action } from "./runs";

// E only for what Jef looks at (Steve 2026-09-25: "No E to talk or interact if we do not look at
// the object or person"). Every action names the thing it is about (`at`, world x/z, y when known:
// a person's chest, a thing's middle, a door's middle); game/jobs.ts findActions offers it only when
// that point is in front of the view, and among several picks the one nearest the crosshair
// (angle first, distance second). Keys that are about Jef himself or the spot ahead of him carry
// `self: true` instead and need no looking (node tools/facing-audit.mjs --self lists them):
//   set it down / stack it / let it fall into the Schelde, fill your pockets   the spot ahead, his hands
//   get off the velocipede, let go of the handcart, unload the cart here       Jef himself, where he stands
//   leave the furniture here, set it down here (R turns it), leave it where it was, put up (from the pile)
//   stand up (tavern chair, pew, omnibus), climb down from the roof, climb up to the roof seat
//   sit down here (omnibus: the seat is already the one under the crosshair)
//   get off at the stop / jump off (omnibus), get out of the boat (its one key)   Jef himself
//   go out into the street / up the cellar steps / by the north door (a room's exit)   leaving a room
//   climb down the ladder (a crane's gallery)                                   climbing off a ladder
//   step out of the bucket chain, stand with the men to be hired                where he stands
// The thief who just robbed you keeps a wide cone (70 degrees, `cone`) so a grab stays playable;
// "shout at him" (the watch job's thief in the fog) 50 degrees.
// Audit: `node tools/facing-audit.mjs` lists every action written without `at` or `self`; in dev
// the prompt also warns once per text it meets without either.

/** A point an action is about: world x, z, and its height when known. */
export interface Target {
  x: number;
  y?: number;
  z: number;
}

const DEG = Math.PI / 180;
/** Half the cone in front (horizontal), and wider right up close. */
const CONE = 35 * DEG;
const CONE_CLOSE = 50 * DEG;
const CLOSE = 1.2;
/** Closer than this (horizontal) the direction means little: in reach, whatever the angle. */
const ON_TOP = 0.45;
/** Up and down: how far the point may be above or below the look. */
const TILT = 45 * DEG;
const TILT_CLOSE = 60 * DEG;
/** Score: a degree off the crosshair weighs like 0.3 m of distance (angle first). */
const PER_RAD = 0.3 / DEG;

let view: FirstPerson | null = null;

/** game/jobs.ts binds the player once. */
export function bindView(p: FirstPerson): void {
  view = p;
}

/**
 * How far off the crosshair a point is (radians, the larger of horizontal and vertical by weight),
 * or null when it is out of view. `cone` widens the horizontal half-angle (degrees).
 */
export function aim(at: Target, cone?: number): number | null {
  const p = view;
  if (!p) return 0;
  const eye = p.camera.position;
  const dx = at.x - eye.x;
  const dz = at.z - eye.z;
  const h = Math.hypot(dx, dz);
  const close = h < CLOSE;
  let off = 0;
  if (h > ON_TOP) {
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    off = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / h)));
    const lim = cone !== undefined ? Math.max(cone * DEG, close ? CONE_CLOSE : CONE) : close ? CONE_CLOSE : CONE;
    if (off > lim) return null;
  }
  if (at.y !== undefined) {
    const up = Math.atan2(at.y - eye.y, Math.max(h, 0.05));
    const tilt = Math.abs(up - p.pitch);
    if (tilt > (close ? TILT_CLOSE : TILT)) return null;
    // looking well above or below counts a little against it too
    off += Math.max(0, tilt - 15 * DEG) * 0.5;
  }
  return off;
}

/** An action may be offered now: it has no target, or its target is in view. */
export function inView(a: Action): boolean {
  return !a.at || aim(a.at, a.cone) !== null;
}

/** Its rank among options (lower first), or null when out of view. `d` is the provider's distance/priority. */
export function rank(a: Action, d: number): number | null {
  if (!a.at) return d;
  const off = aim(a.at, a.cone);
  return off === null ? null : d + off * PER_RAD;
}

/** The best of [distance, action] options: in view, nearest the crosshair. */
export function best(options: Array<[number, Action]>): Action | null {
  let top: Action | null = null;
  let bs = Infinity;
  for (const [d, a] of options) {
    const s = rank(a, d);
    if (s !== null && s < bs) [top, bs] = [a, s];
  }
  return top;
}

/** Of things in reach, the one in view nearest the crosshair (for finders that used to take the nearest). */
export function pick<T>(list: Iterable<T>, where: (t: T) => { at: Target; d: number } | null, cone?: number): { it: T; d: number; at: Target } | null {
  let top: { it: T; d: number; at: Target } | null = null;
  let bs = Infinity;
  for (const t of list) {
    const w = where(t);
    if (!w) continue;
    const off = aim(w.at, cone);
    if (off === null) continue;
    const s = w.d + off * PER_RAD;
    if (s < bs) [top, bs] = [{ it: t, d: w.d, at: w.at }, s];
  }
  return top;
}

/** A person's chest from their model (group at the feet). */
export function chest(o: THREE.Object3D, h = 1.3): Target {
  return { x: o.position.x, y: o.position.y + h, z: o.position.z };
}

// ---- dev: keys shown without a target and without `self`
const warned = new Set<string>();
export function auditShown(list: Action[]): void {
  for (const a of list) {
    if (a.at || a.self || warned.has(a.text)) continue;
    warned.add(a.text);
    console.warn(`[facing] a key without a target: "${a.text}"`);
  }
}
export function unaimed(): string[] {
  return [...warned];
}

/** Of several points on one long thing (a cart, a boat), the one nearest the crosshair: its target. */
export function nearestAim(points: Target[]): Target {
  let top = points[0];
  let bs = Infinity;
  for (const t of points) {
    const off = aim(t);
    if (off !== null && off < bs) [top, bs] = [t, off];
  }
  return top;
}
