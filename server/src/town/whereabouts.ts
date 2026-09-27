// Where a townsperson is now (the trade plan, docs/trade-plan.md part A). Pure code, like schedule.ts:
// the server's town map and every PC run the same sum, so they agree on where a person is that
// nobody sees, and a player who walks there finds him.
//
// The sum: his day plan (schedule.ts) says what he does now and since when. He left the place of the
// part before at that hour and walks the way (ways.ts, found on the walk map: streets, never through a
// house) to the place of this part, at the unseen pace. Arrived, he is there: indoors at home or at an
// indoor trade, at his stand, or on his round.

import { MILLS, runNow } from "../../../shared/mills.ts";
import { activityAt, type Act, type Schedule } from "./schedule.ts";
import { pointAlong, wayLength, type Pt } from "./wayfind.ts";

/** What the sum needs of a resident (the server's Resident and the client's TownResident both fit). */
export interface WhereResident {
  id: string;
  /** The mill's man goes by his cart's timetable (shared/mills.ts), not his plan's places. */
  trade?: string;
  home: { x: number; z: number; sx: number; sz: number };
  work: {
    place: string;
    kind: string;
    at?: [number, number, number];
    a?: Pt;
    b?: Pt;
    route?: Pt[];
    door?: Pt;
    stall?: number;
    shop?: string;
  };
  sched: Schedule;
}

/** What the sum needs of the town. */
export interface WhereTown {
  places: Record<string, { x: number; z: number; r: number; door?: Pt; out?: Pt }>;
  stalls: ReadonlyArray<{ x: number; z: number }>;
  shops: ReadonlyArray<{ id: string; door: Pt; out: Pt }>;
}

/** Finds the way on foot between two points (null: not known yet; the sum then goes straight). */
export type WayOf = (ax: number, az: number, bx: number, bz: number) => Pt[] | null;

/**
 * Unseen, people cross town at 6 m/s of real time (town.ts HIDDEN_SPEED: the clock runs 30 times faster than
 * life, so a 600 m walk takes 50 game minutes). In game time: 12 m a game minute.
 */
export const UNSEEN_M_PER_MIN = 12;
/** On a round (a patrol, a customs officer's landings, a seller's stops), metres a game minute. */
export const ROUND_M_PER_MIN = 20;

/** The place of a part of the day: where he goes, whether it is indoors, and a round he walks there. */
export interface Anchor {
  x: number;
  z: number;
  indoor: boolean;
  /** Walked when there (a round, a haul between the quay and a door). */
  route?: Pt[];
  loop?: boolean;
}

/** A small fixed number for an id (a spread over a place that stays put). */
export function hashId(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function spread(id: string, x: number, z: number, r: number): { x: number; z: number } {
  const h = hashId(id);
  const a = ((h & 0xffff) / 0x10000) * Math.PI * 2;
  const d = Math.sqrt(((h >>> 16) & 0xffff) / 0x10000) * Math.max(0, r) * 0.7;
  return { x: x + Math.cos(a) * d, z: z + Math.sin(a) * d };
}

function workAnchor(r: WhereResident, town: WhereTown): Anchor {
  const w = r.work;
  const home: Anchor = { x: r.home.sx, z: r.home.sz, indoor: true };
  if (w.place === "home") return home;
  if (w.kind === "inside") {
    const d = w.door ?? town.places[w.place]?.door;
    if (d) return { x: d[0], z: d[1], indoor: true };
    const p = town.places[w.place];
    return p ? { x: p.x, z: p.z, indoor: true } : home;
  }
  if (w.kind === "haul" && w.a && w.b) return { x: w.a[0], z: w.a[1], indoor: false, route: [w.a, w.b], loop: false };
  if (w.route && w.route.length && (w.kind === "patrol" || w.kind === "roam" || w.kind === "inspect" || w.kind === "round")) {
    return { x: w.route[0][0], z: w.route[0][1], indoor: false, route: w.route, loop: w.kind === "patrol" };
  }
  if (w.at) return { x: w.at[0], z: w.at[1], indoor: false };
  if (typeof w.stall === "number" && town.stalls[w.stall]) return { x: town.stalls[w.stall].x, z: town.stalls[w.stall].z, indoor: false };
  if (w.shop) {
    const s = town.shops.find((q) => q.id === w.shop);
    if (s) return { x: s.out?.[0] ?? s.door[0], z: s.out?.[1] ?? s.door[1], indoor: false };
  }
  if (w.door) return { x: w.door[0], z: w.door[1], indoor: false };
  const p = town.places[w.place];
  if (p) return { ...spread(r.id, p.x, p.z, p.r), indoor: false };
  return home;
}

/** Where a part of the day is (its act and place, as activityAt gives them). */
export function anchorOf(r: WhereResident, town: WhereTown, act: Act | string, place: string): Anchor {
  if (act === "home" || place === "home") return { x: r.home.sx, z: r.home.sz, indoor: true };
  if (act === "work" || place === "work") return workAnchor(r, town);
  const p = town.places[place] ?? town.places[place.replace(/^[a-z]+:/, "")];
  if (!p) return { x: r.home.sx, z: r.home.sz, indoor: true };
  if (act === "tavern" && p.door) return { x: p.out?.[0] ?? p.door[0], z: p.out?.[1] ?? p.door[1], indoor: false };
  if (act === "church") return { x: p.door?.[0] ?? p.x, z: p.door?.[1] ?? p.z, indoor: true };
  return { ...spread(r.id, p.x, p.z, p.r), indoor: false };
}

export interface Where {
  x: number;
  z: number;
  yaw: number;
  /** In a building (home, an indoor trade, mass): not in the street. */
  indoor: boolean;
  /** On his way from the last place to this one. */
  moving: boolean;
  act: Act;
  place: string;
  /** Where he came from and where he goes (the part's place). */
  from: Anchor;
  to: Anchor;
  /** Metres walked of the way, and its length. */
  walked: number;
  total: number;
  /** Hours since this part of the day began, and hours left in it. */
  since: number;
  left: number;
}

/** The act and place of the part of the day just before the one that began at `start` (hours, may be < 0). */
function partBefore(r: WhereResident, day: number, start: number): { act: Act; place: string } {
  const e = 1 / 240; // a quarter of a game minute before
  let d = day;
  let h = start - e;
  if (h < 0) {
    d = day - 1;
    h += 24;
  }
  const p = activityAt(r.sched, d, h);
  return { act: p.act, place: p.place };
}

/** The pairs of places a resident walks between in his plan (the ways the server finds ahead). */
export function planLegs(r: WhereResident, town: WhereTown): Array<[Anchor, Anchor]> {
  const out: Array<[Anchor, Anchor]> = [];
  const seen = new Set<string>();
  // a week: every part of every day, with the one before it (Monday's first after Sunday's last)
  for (let day = 1; day <= 7; day++) {
    const segs = day % 7 === 0 ? r.sched.sunday : r.sched.day;
    for (const seg of segs) {
      const now = activityAt(r.sched, day, seg[0] % 24);
      const before = partBefore(r, day, seg[0] % 24);
      const a = anchorOf(r, town, before.act, before.place);
      const b = anchorOf(r, town, now.act, now.place);
      const k = `${a.x.toFixed(1)},${a.z.toFixed(1)}>${b.x.toFixed(1)},${b.z.toFixed(1)}`;
      if (seen.has(k) || (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5)) continue;
      seen.add(k);
      out.push([a, b]);
    }
  }
  return out;
}

/** A point `d` metres along a round (looped, or there and back). */
function onRound(pts: ReadonlyArray<Pt>, d: number, loop: boolean): { x: number; z: number; yaw: number } {
  const way = loop ? [...pts, pts[0]] : [...pts];
  const total = wayLength(way);
  if (total <= 0) return { x: pts[0][0], z: pts[0][1], yaw: 0 };
  if (loop) return pointAlong(way, ((d % total) + total) % total);
  const u = ((d % (2 * total)) + 2 * total) % (2 * total);
  if (u <= total) return pointAlong(way, u);
  const back = pointAlong(way, 2 * total - u);
  return { ...back, yaw: back.yaw + Math.PI };
}

/**
 * The mill's man on a run (M7 mills, as client game/mills.ts walks him): along the cart's way on the way out and
 * back, at the stop while loading or unloading, at the cart's stand in the store. Null when he is not on a run.
 */
function millRun(r: WhereResident, day: number, hour: number): { x: number; z: number; yaw: number; moving: boolean } | null {
  if (r.trade !== "miller_man") return null;
  const m = MILLS.find((q) => q.id === r.work.place);
  if (!m) return null;
  const run = runNow(m, day, hour);
  if (!run) return null;
  const kind = run.run.kind;
  if (run.phase === "go" || run.phase === "back") {
    const route = m.routes[kind === "flour" ? "bakery" : "dock"];
    const way = (run.phase === "back" ? route.slice().reverse() : route) as Pt[];
    const f = run.since / Math.max(1e-6, run.since + run.left);
    const p = pointAlong(way, f * wayLength(way));
    return { ...p, moving: true };
  }
  const at = (kind === "flour" && run.phase === "load") || (kind === "grain" && run.phase === "store") ? m.park : kind === "flour" ? m.stops.bakery : m.stops.dock;
  return { x: at[0], z: at[1], yaw: 0, moving: false };
}

/** Where the sum puts a resident at this clock (day 1 = Monday; hour fractional). */
export function whereAt(r: WhereResident, town: WhereTown, day: number, hour: number, way: WayOf): Where {
  const now = activityAt(r.sched, day, hour);
  const start = hour - now.since;
  const before = partBefore(r, day, start);
  const from = anchorOf(r, town, before.act, before.place);
  const to = anchorOf(r, town, now.act, now.place);
  const pts = Math.abs(from.x - to.x) < 0.5 && Math.abs(from.z - to.z) < 0.5 ? null : (way(from.x, from.z, to.x, to.z) ?? ([[from.x, from.z], [to.x, to.z]] as Pt[]));
  const total = pts ? wayLength(pts) : 0;
  const walked = now.since * 60 * UNSEEN_M_PER_MIN;
  const base = { act: now.act, place: now.place, from, to, walked: Math.min(walked, total), total, since: now.since, left: now.left };
  const mill = now.act === "work" ? millRun(r, day, hour) : null;
  if (mill) return { ...base, ...mill, indoor: false };
  if (pts && walked < total) {
    const p = pointAlong(pts, walked);
    return { ...base, x: p.x, z: p.z, yaw: p.yaw, indoor: false, moving: true };
  }
  if (to.route && to.route.length > 1) {
    // on his round since he got there
    const p = onRound(to.route, ((walked - total) / UNSEEN_M_PER_MIN) * ROUND_M_PER_MIN, to.loop !== false);
    return { ...base, x: p.x, z: p.z, yaw: p.yaw, indoor: false, moving: true };
  }
  return { ...base, x: to.x, z: to.z, yaw: 0, indoor: to.indoor, moving: false };
}
