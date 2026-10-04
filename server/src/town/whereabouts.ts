// Where a townsperson is now (the trade plan, docs/trade-plan.md part A). Pure code, like schedule.ts:
// the server's town map and every PC run the same sum, so they agree on where a person is that
// nobody sees, and a player who walks there finds him.
//
// The sum: his day plan (schedule.ts) says what he does now and since when. He left the place of the
// part before at that hour and walks the way (ways.ts, found on the walk map: streets, never through a
// house) to the place of this part, at the unseen pace. Arrived, he is there: indoors at home or at an
// indoor trade, at his stand, or on his round.

import { CART_PACE as CART_MPS, MILLS, runNow, type RunKind, type RunPhase } from "../../../shared/mills.ts";
import { activityAt, type Act, type Now, type Schedule } from "./schedule.ts";
import { pointAlong, wayLength, type Pt } from "./wayfind.ts";

/** What the sum needs of a resident (the server's Resident and the client's TownResident both fit). */
export interface WhereResident {
  id: string;
  /** The mill's man goes by his cart's timetable (shared/mills.ts), not his plan's places. */
  trade?: string;
  /** His pace: the young walk briskly and may run, the old go slower (paceOf). */
  age?: number;
  sex?: string;
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
  residents?: ReadonlyArray<WhereResident>;
  /** Reachable replacements for plan spreads, prepared on the server's walk map. */
  anchors?: Record<string, Record<string, Pt>>;
  places: Record<string, { x: number; z: number; r: number; door?: Pt; out?: Pt }>;
  stalls: ReadonlyArray<{ x: number; z: number }>;
  shops: ReadonlyArray<{ id: string; door: Pt; out: Pt }>;
}

/** Finds the way on foot between two points (null: there is none: he is simply there; undefined: not known yet). */
export type WayOf = (ax: number, az: number, bx: number, bz: number) => Pt[] | null | undefined;

/** Real seconds in a game minute (shared/clock.ts): a pace in m/s is twice that in metres a game minute. */
const REAL_S_PER_MIN = 2;

/**
 * A person's own pace in m/s of real time, the same seen and unseen (Steve 2026-09-27: real walking, and they
 * set off early enough to be there on time; a load does not slow them; the young may run, children most;
 * the old go slower). Fixed per person, and on a leg (`leg`: a key of that walk) he either walks or runs.
 */
export function paceOf(r: Pick<WhereResident, "id" | "age" | "sex" | "trade">, leg = ""): { mps: number; run: boolean } {
  const age = r.age ?? 35;
  const h = (hashId(r.id + ":pace") & 0xffff) / 0x10000; // 0-1, his own
  let walk = age < 13 ? 1.25 : age < 30 ? 1.4 : age < 50 ? (r.sex === "f" ? 1.25 : 1.35) : age < 65 ? 1.15 : 0.95;
  if (r.trade === "soldier" || r.trade === "sentry" || r.trade === "corporal") walk = 1.3; // the marching step
  walk *= 0.92 + h * 0.16;
  const runs = age < 13 ? 0.45 : age < 30 ? 0.3 : age < 45 ? 0.1 : 0;
  const run = leg !== "" && runs > 0 && (hashId(`${r.id}:${leg}`) & 0xffff) / 0x10000 < runs;
  return { mps: run ? (age < 13 ? 2.4 : age < 30 ? 2.7 : 2.3) * (0.95 + h * 0.1) : walk, run };
}

/** A pace in metres a game minute. */
export const perMin = (mps: number): number => mps * REAL_S_PER_MIN;

/** The old unseen pace (6 m/s, 12 m a game minute): kept for tests of the plan's old sum. */
export const UNSEEN_M_PER_MIN = 12;
/**
 * On a round (a patrol, a customs officer's landings, a seller's stops, a docker's sacks between the quay and the
 * door), metres a game minute: a real walk, 1.3 m/s (Steve 2026-09-27: the map showed rounds at 10 m/s).
 */
export const ROUND_M_PER_MIN = 2.6;
/** The fastest walk anyone has (paceOf: 1.4 m/s x 1.08), in metres a game minute: no round goes faster. */
export const WALK_MAX_M_PER_MIN = 1.4 * 1.08 * 2;

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
    // (the shop's door step; `out` is the way out of its wall, a direction, not a point)
    const s = town.shops.find((q) => q.id === w.shop);
    if (s) return { x: s.door[0], z: s.door[1], indoor: false };
  }
  if (w.door) return { x: w.door[0], z: w.door[1], indoor: false };
  const p = town.places[w.place];
  if (p) return { ...spread(r.id, p.x, p.z, p.r), indoor: false };
  return home;
}

/** Where a part of the day is (its act and place, as activityAt gives them). */
export function anchorOf(r: WhereResident, town: WhereTown, act: Act | string, place: string): Anchor {
  const fixed = town.anchors?.[r.id]?.[`${act}:${place}`];
  if (fixed) return { x: fixed[0], z: fixed[1], indoor: false };
  if (act === "home" || place === "home") return { x: r.home.sx, z: r.home.sz, indoor: true };
  if (act === "work" || place === "work") return workAnchor(r, town);
  const p = town.places[place] ?? town.places[place.replace(/^[a-z]+:/, "")];
  if (!p) return { x: r.home.sx, z: r.home.sz, indoor: true };
  // before a tavern's door, as the game stands its drinkers (town.ts goalFor): `out` is the way out, a direction
  if (act === "tavern" && p.door) return { x: p.door[0] + (p.out?.[0] ?? 0) * 2, z: p.door[1] + (p.out?.[1] ?? 0) * 2, indoor: false };
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
  /** On his round: the index of the round's point he walks to (the game's puppet walks on from there). */
  leg?: number;
  /** On his way: running (the young, now and then). */
  run?: boolean;
  /** His pace now (m/s). */
  mps: number;
  /** Which stop of his day as he keeps it (dayRoute) he is at or walks to: the progress reports compare two sums by it. */
  stop: number;
  /** On his way (a walk of his plan, or the mill cart's way): its points, from where he set off. */
  way?: Pt[];
  /** The mill's man on a run with the cart (shared/mills.ts): which mill, what he takes, and the phase. */
  cart?: { mill: string; kind: RunKind; phase: RunPhase };
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
  // his round's legs too (walked on foot, so found ahead)
  const w = workAnchor(r, town);
  if (w.route) for (const [p, q] of roundLegs(w.route, w.loop !== false)) out.push([{ x: p[0], z: p[1], indoor: false }, { x: q[0], z: q[1], indoor: false }]);
  return out;
}

/** The legs of a round: from each point to the next (and back to the first when it is a loop). */
function roundLegs(pts: ReadonlyArray<Pt>, loop: boolean): Array<[Pt, Pt]> {
  const out: Array<[Pt, Pt]> = [];
  for (let i = 0; i < pts.length - (loop ? 0 : 1); i++) out.push([pts[i], pts[(i + 1) % pts.length]]);
  return out;
}

/** A round walked on foot: the ways between its points joined, and where each point's leg starts (metres). */
interface RoundWay {
  pts: Pt[];
  starts: number[];
  total: number;
}

/** Rounds whose every leg was found, by the route array (the town's data keeps the same arrays). */
const roundCache = new WeakMap<ReadonlyArray<Pt>, RoundWay>();

// A shared haul is a work round, with evenly spaced starts at the crew's walking pace. Independent
// arrival times and speeds slowly collapsed the old random offsets into a clump; even a new tree
// changing one worker's route to work could make four men occupy the same pile.
const haulCrews = new WeakMap<WhereTown, Map<string, { fraction:number; mps:number }>>();
function haulStart(r:WhereResident,town:WhereTown):{fraction:number;mps:number}|undefined {
  if(r.work.kind!=="haul"||!town.residents)return;
  let crew=haulCrews.get(town);
  if(!crew) {
    crew=new Map();const routes=new Map<string,WhereResident[]>();
    for(const person of town.residents)if(person.work.kind==="haul"&&person.work.a&&person.work.b) {
      const key=[...person.work.a,...person.work.b].map(n=>n.toFixed(1)).join(",");
      const people=routes.get(key)??[];people.push(person);routes.set(key,people);
    }
    for(const people of routes.values()) {
      people.sort((a,b)=>a.id.localeCompare(b.id));
      const mps=Math.min(...people.map(p=>paceOf(p).mps));
      people.forEach((p,i)=>crew!.set(p.id,{fraction:i/people.length,mps}));
    }
    haulCrews.set(town,crew);
  }
  return crew.get(r.id);
}

/**
 * The round on foot, leg by leg along the ways (Steve 2026-09-27: the map had rounds straight through houses and
 * over canals). A leg with no way yet is a step straight to its end (kept out of the cache until found).
 */
function roundWay(pts: ReadonlyArray<Pt>, loop: boolean, way: WayOf): RoundWay {
  const hit = roundCache.get(pts);
  if (hit) return hit;
  const out: Pt[] = [];
  const starts: number[] = [];
  let whole = true;
  let d = 0;
  for (const [a, b] of roundLegs(pts, loop)) {
    const w = way(a[0], a[1], b[0], b[1]);
    if (!w) whole = false;
    const leg: Pt[] = w ?? [a, b];
    starts.push(d);
    if (out.length) d += Math.hypot(leg[0][0] - out[out.length - 1][0], leg[0][1] - out[out.length - 1][1]);
    out.push(...leg);
    d += wayLength(leg);
  }
  const rw = { pts: out, starts, total: wayLength(out) };
  if (whole) roundCache.set(pts, rw);
  return rw;
}

/** A point `d` metres along a round (looped, or there and back), and the index of the point he walks to. */
function onRound(pts: ReadonlyArray<Pt>, d0: number, loop: boolean, way: WayOf, startFrac = 0): { x: number; z: number; yaw: number; leg: number } {
  const rw = roundWay(pts, loop, way);
  if (rw.total <= 0) return { x: pts[0][0], z: pts[0][1], yaw: 0, leg: 0 };
  // (each man starts the round at his own point of it: the men of one round spread along it, never in one clump)
  const d = d0 + startFrac * (loop ? rw.total : 2 * rw.total);
  const legAt = (s: number) => {
    let i = 0;
    while (i + 1 < rw.starts.length && rw.starts[i + 1] <= s) i++;
    return i;
  };
  if (loop) {
    const s = ((d % rw.total) + rw.total) % rw.total;
    return { ...pointAlong(rw.pts, s), leg: (legAt(s) + 1) % pts.length };
  }
  const u = ((d % (2 * rw.total)) + 2 * rw.total) % (2 * rw.total);
  if (u <= rw.total) return { ...pointAlong(rw.pts, u), leg: 1 };
  const back = pointAlong(rw.pts, 2 * rw.total - u);
  return { ...back, yaw: back.yaw + Math.PI, leg: 0 };
}

/**
 * The mill's man on a run (M7 mills, as client game/mills.ts walks him): along the cart's way on the way out and
 * back, at the stop while loading or unloading, at the cart's stand in the store. Null when he is not on a run.
 */
function millRun(r: WhereResident, day: number, hour: number): { x: number; z: number; yaw: number; moving: boolean; walked: number; total: number; way?: Pt[]; cart: NonNullable<Where["cart"]> } | null {
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
    const total = wayLength(way);
    const p = pointAlong(way, f * total);
    return { ...p, moving: true, walked: f * total, total, way, cart: { mill: m.id, kind, phase: run.phase } };
  }
  const at = (kind === "flour" && run.phase === "load") || (kind === "grain" && run.phase === "store") ? m.park : kind === "flour" ? m.stops.bakery : m.stops.dock;
  return { x: at[0], z: at[1], yaw: 0, moving: false, walked: 0, total: 0, cart: { mill: m.id, kind, phase: run.phase } };
}

/** Where the sum puts a resident at this clock (day 1 = Monday; hour fractional). */
/**
 * The part of the day at an hour that may run past midnight or before it (hours relative to `day`), with its true
 * start and end. Hours no part covers are at home (as activityAt has it), from the end of the part before to the
 * start of the next.
 */
function partAt(r: WhereResident, day: number, h: number): Now & { start: number; end: number } {
  const segsOf = (d: number) => (((d % 7) + 7) % 7 === 0 ? r.sched.sunday : r.sched.day);
  const base = Math.floor(h / 24);
  const list: Array<{ a: number; b: number; act: Act; place: string }> = [];
  for (let k = base - 1; k <= base + 1; k++) {
    for (const [a, b, act, where] of segsOf(day + k)) list.push({ a: a + 24 * k, b: b + 24 * k, act, place: where ?? (act === "work" ? "work" : "home") });
  }
  const hit = list.filter((q) => h >= q.a && h < q.b).sort((p, q) => q.a - p.a)[0];
  if (hit) return { act: hit.act, place: hit.place, since: h - hit.a, left: hit.b - h, start: hit.a, end: hit.b };
  const start = Math.max(h - 24, ...list.filter((q) => q.b <= h).map((q) => q.b));
  const end = Math.min(h + 24, ...list.filter((q) => q.a > h).map((q) => q.a));
  return { act: "home", place: "home", since: h - start, left: end - h, start, end };
}

const same = (a: Anchor, b: Anchor) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.z - b.z) < 0.5;

/** A walk between two places at a pace: its way and length (null: none on foot, or not known yet). */
interface Walk {
  pts: Pt[];
  total: number;
  mps: number;
  run: boolean;
  hours: number;
}

/** One place of his day as he really keeps it: the part, when he gets there and leaves, and the walk there. */
interface Stop {
  part: Now & { start: number; end: number };
  at: Anchor;
  arrive: number;
  leave: number;
  /** The walk that brought him here, and when he set off. */
  walk: (Walk & { dep: number }) | null;
  /**
   * Where he stands once there: the walk's end (on ground a body reaches) for a place in the street, as a place's
   * middle may lie in a house block (the back town's corners and courts, 2026-09-27); the place itself when indoors.
   */
  stand: Pt;
}

/**
 * A stay shorter than this (hours, or half the part if that is less) is not worth the walk: he skips that part of
 * his day and goes on to the next (Steve 2026-09-27: real walking in a day 30 times faster than life).
 */
const MIN_STAY_H = 0.5;
/** The day's route is worked out from this long before midnight (so a night part is followed in). */
const LEAD_H = 6;

/** Days' routes worked out, per resident's plan and day (only when every way was known). */
const routeCache = new WeakMap<Schedule, Map<string, Stop[]>>();
/** Dev: routes worked out and routes found in the cache (the client's frame profiler reads them). */
export const routeStats = { made: 0, hits: 0, unknown: 0 };
/**
 * Routes worked out while a way was not known yet (2026-09-28, the slow frames: the client worked out ~300 such
 * routes every frame for the first minute, and again each new day). Kept for the same way function until it
 * learns new ways (waysLearnt); a caller that never says so gets them worked out afresh each time, as before.
 */
const partialCache = new WeakMap<Schedule, { key: string; way: WayOf; gen: number; stops: Stop[] }>();
let wayGen = 0;
/** The way function knows more ways now: routes worked out without them are worked out again. */
export function waysLearnt(): void {
  wayGen++;
}
const learners = new WeakSet<WayOf>();
/** This way function says when it learns ways (waysLearnt): its routes with unknown ways may be kept meanwhile. */
export function waySaysWhenLearnt<W extends WayOf>(way: W): W {
  learners.add(way);
  return way;
}

/**
 * His day as he keeps it: he sets off early enough to be at the next part at its hour, at his pace (paceOf); a
 * young one late for it runs; a part he would reach too late to stay is skipped and he goes on to the one after.
 * Hours relative to `day`, from LEAD_H before its midnight to LEAD_H after the next.
 */
function dayRoute(r: WhereResident, town: WhereTown, day: number, way: WayOf): Stop[] {
  const key = `${day}`;
  const hit = routeCache.get(r.sched)?.get(key);
  if (hit) {
    routeStats.hits++;
    return hit;
  }
  const part = partialCache.get(r.sched);
  if (part && part.key === key && part.way === way && part.gen === wayGen) {
    routeStats.hits++;
    return part.stops;
  }
  routeStats.made++;
  let known = true;
  const walkOf = (a: Anchor, b: Anchor, leg: string, run: boolean): Walk | null => {
    if (same(a, b)) return null;
    const pts = way(a.x, a.z, b.x, b.z);
    if (pts === undefined) known = false;
    if (!pts) return null;
    const total = wayLength(pts);
    const p = paceOf(r, leg);
    const mps = run && !p.run ? runPace(r) ?? p.mps : p.mps;
    return { pts, total, mps, run: p.run || mps > p.mps, hours: total / perMin(mps) / 60 };
  };
  // the parts in order
  const parts: Array<Now & { start: number; end: number }> = [];
  for (let h = -LEAD_H; h < 24 + LEAD_H; ) {
    const q = partAt(r, day, h);
    parts.push(q);
    h = q.end > h ? q.end + 1e-6 : h + 0.25;
  }
  const stops: Stop[] = [];
  const first = parts[0];
  const at0 = anchorOf(r, town, first.act, first.place);
  stops.push({ part: first, at: at0, arrive: first.start, leave: Infinity, walk: null, stand: [at0.x, at0.z] });
  for (const q of parts.slice(1)) {
    const cur = stops[stops.length - 1];
    const at = anchorOf(r, town, q.act, q.place);
    const leg = `${day}:${Math.round(q.start * 60)}`;
    let w = walkOf(cur.at, at, leg, false);
    const minStay = Math.min(MIN_STAY_H, (q.end - q.start) / 2);
    let dep = w ? Math.max(cur.arrive, q.start - w.hours) : q.start;
    let arrive = w ? dep + w.hours : Math.max(cur.arrive, q.start);
    if (w && q.end - arrive < minStay) {
      // late: a young one runs for it
      const fast = walkOf(cur.at, at, leg, true);
      if (fast && fast.mps > w.mps) {
        const d2 = Math.max(cur.arrive, q.start - fast.hours);
        if (q.end - (d2 + fast.hours) >= minStay) {
          w = fast;
          dep = d2;
          arrive = d2 + fast.hours;
        }
      }
    }
    if (q.end - arrive < minStay && !same(cur.at, at)) continue; // not worth it: on to the next part
    if (same(cur.at, at)) {
      // the same place: he stays (the part changes, the place does not)
      stops.push({ part: q, at, arrive: Math.max(cur.arrive, q.start), leave: Infinity, walk: null, stand: cur.stand });
      cur.leave = Math.max(cur.arrive, q.start);
      continue;
    }
    cur.leave = dep;
    const end = w ? w.pts[w.pts.length - 1] : null;
    stops.push({ part: q, at, arrive, leave: Infinity, walk: w ? { ...w, dep } : null, stand: end && !at.indoor ? [end[0], end[1]] : [at.x, at.z] });
  }
  if (!known) {
    routeStats.unknown++;
    if (learners.has(way)) partialCache.set(r.sched, { key, way, gen: wayGen, stops });
  }
  if (known) {
    let m = routeCache.get(r.sched);
    if (!m) routeCache.set(r.sched, (m = new Map()));
    if (m.size > 8) m.clear();
    m.set(key, stops);
  }
  return stops;
}

/** His running pace, if he is one who runs at all (the young and children), else null. */
function runPace(r: WhereResident): number | null {
  const age = r.age ?? 35;
  if (age >= 45) return null;
  const h = (hashId(r.id + ":pace") & 0xffff) / 0x10000;
  return (age < 13 ? 2.4 : age < 30 ? 2.7 : 2.3) * (0.95 + h * 0.1);
}

/**
 * Where the sum puts a resident at this clock (day 1 = Monday; hour fractional): on his day's route (dayRoute),
 * walking or running between two places, or at one (indoors, at his stand, on his round since he got there).
 * `act`, `place`, `since` and `left` are those of the part he is at or walking to (the game sets his goal by them).
 */
export function whereAt(r: WhereResident, town: WhereTown, day: number, hour: number, way: WayOf): Where {
  const stops = dayRoute(r, town, day, way);
  let k = stops.length - 1;
  for (let i = 1; i < stops.length; i++) {
    const dep = stops[i].walk ? stops[i].walk!.dep : stops[i].arrive;
    if (hour < dep) {
      k = i - 1;
      break;
    }
  }
  // stop k: he is there, or it is the last he left; stop k + 1 is the one he walks to once he set off
  const here = stops[k];
  const part = (p: Stop["part"]) => ({ act: p.act, place: p.place, since: Math.max(0, hour - p.start), left: Math.max(0, p.end - hour) });
  // (the mill's man keeps the cart's timetable to its end: he sets off for the evening's place after the sacks are in,
  // not early as the day plan would have him; millRun is null outside the runs, which lie inside his work)
  const mill = millRun(r, day, hour);
  if (mill) return { ...part(here.part), from: here.at, to: here.at, ...mill, indoor: false, mps: mill.moving ? CART_MPS : 0, stop: k };
  const w = here.walk;
  if (w && hour < here.arrive) {
    const prev = stops[k - 1]?.at ?? here.at;
    const walked = Math.max(0, Math.min(w.total, (hour - w.dep) * 60 * perMin(w.mps)));
    const p = pointAlong(w.pts, walked);
    return { ...part(here.part), from: prev, to: here.at, walked, total: w.total, x: p.x, z: p.z, yaw: p.yaw, indoor: false, moving: true, run: w.run, mps: w.mps, stop: k, way: w.pts };
  }
  const total = w?.total ?? 0;
  const base = { ...part(here.part), from: stops[k - 1]?.at ?? here.at, to: here.at, walked: total, total, stop: k };
  const A = here.at;
  if (A.route && A.route.length > 1) {
    // on his round since he got there, at his walk
    const crew=haulStart(r,town),walk=crew?.mps??paceOf(r).mps;
    // (Steve 2026-09-28: "not bunching like 100 people in one job spot/pile": his own start point on the round)
    const p = onRound(A.route, (hour - (crew?here.part.start:here.arrive)) * 60 * perMin(walk), A.loop !== false, way, crew?.fraction??(hashId(r.id + ":round") & 0xffff) / 0x10000);
    return { ...base, x: p.x, z: p.z, yaw: p.yaw, indoor: false, moving: true, leg: p.leg, mps: walk };
  }
  return { ...base, x: here.stand[0], z: here.stand[1], yaw: 0, indoor: A.indoor, moving: false, mps: 0 };
}

// ------------------------------------------------------------------ progress reports (the trade plan, part A)
//
// Near a player a townsperson is walked by the game, and a crowd, a cart or the player himself may slow him. When he
// leaves the player's view the sum would have him further on than he got: he would jump ahead, and the map's dot with
// him. So the PC that walks him reports how far behind the sum he is (his lag, in game hours): his clock runs that much
// late from then on (whereAt at hour - lag), until he stops at a place of his day where the sum without the lag has him
// too; then the lag is gone. The server keeps every lag (town/lags.ts) for the map and the other PCs.

/** A lag is never more than this (game hours): a man held up longer has lost his way and goes by the plain sum. */
export const LAG_MAX_H = 1;
/** Behind or ahead by less than this many metres: no change (the crowd's own steering). */
const LAG_SLACK_M = 1.5;
/** Farther than this from the way the sum walks (a detour of the crowd's own): no report. */
const LAG_OFF_WAY_M = 6;

/** The sum with his lag: his day as he keeps it, that much late. */
export function whereLate(r: WhereResident, town: WhereTown, day: number, hour: number, way: WayOf, lagH: number): Where {
  return whereAt(r, town, day, hour - (lagH > 0 ? Math.min(lagH, LAG_MAX_H) : 0), way);
}

/** The metres along a way of the point on it nearest (x, z), and how far off it that point is. */
export function projectOn(pts: ReadonlyArray<Pt>, x: number, z: number): { s: number; off: number } {
  let best = { s: 0, off: Infinity };
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1];
    const [bx, bz] = pts[i];
    const dx = bx - ax;
    const dz = bz - az;
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    const off = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (off < best.off) best = { s: acc + Math.sqrt(L2) * t, off };
    acc += Math.sqrt(L2);
  }
  return best;
}

/**
 * A lag kept or let go: gone when he is at a place of his day and the plain sum has him at the same stop, not
 * walking (he got there, late or not, and the day goes on as planned); gone too past LAG_MAX_H.
 */
export function settleLag(r: WhereResident, town: WhereTown, day: number, hour: number, way: WayOf, lagH: number): number {
  // (at the most, too: every lag is clamped to LAG_MAX_H, so "past" it never came and a man an hour behind stayed an
  // hour late all day, M7 sweep 2026-09-29: after a jump of the clock, sleep or a skip)
  if (!(lagH > 0) || lagH >= LAG_MAX_H) return 0;
  const late = whereLate(r, town, day, hour, way, lagH);
  if (late.moving) return lagH;
  const plain = whereAt(r, town, day, hour, way);
  return !plain.moving && plain.stop === late.stop ? 0 : lagH;
}

/**
 * The progress report of a person the game walks (at x, z): his new lag. On his way, he is compared with the sum at
 * his lag: behind it, the lag grows by the time the missing metres take at his pace; ahead of it, it shrinks (never
 * below the plain sum). Not on his way, or off the way it walks: the lag as it was (settled, see settleLag).
 */
export function reportLag(r: WhereResident, town: WhereTown, day: number, hour: number, way: WayOf, lagH: number, x: number, z: number): number {
  const lag = Math.max(0, Math.min(LAG_MAX_H, lagH || 0));
  const w = whereLate(r, town, day, hour, way, lag);
  // (the mill's man keeps the cart's timetable: the engine moves the sacks by it, so he is never late by the sum)
  if (w.cart) return 0;
  if (!w.moving || !w.way || w.leg !== undefined || !(w.mps > 0)) return settleLag(r, town, day, hour, way, lag);
  const p = projectOn(w.way, x, z);
  if (p.off > LAG_OFF_WAY_M) return lag;
  const behind = w.walked - p.s;
  if (Math.abs(behind) < LAG_SLACK_M) return lag;
  const next = lag + behind / perMin(w.mps) / 60;
  // (an hour or more behind: he has lost his way and goes by the plain sum, as settleLag)
  return next >= LAG_MAX_H ? 0 : Math.max(0, next);
}
