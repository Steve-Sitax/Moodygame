import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import { shownTrade, TRADES, type TradeId } from "./places.ts";
import { rngFrom, tidy, type Home, type Pt, type Resident, type Stats, type TownPlace } from "./population.ts";
import type { Seg } from "./schedule.ts";
import { dropTownCache, town } from "./store.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import { INWORLD_HOUSES } from "./kept.ts";

// The people of the town wall (the look pass, 2026-09-26; Steve on the wall walk at dusk: "still looks flat
// here. Take pictures, make it better, also props, people, guards").
//
// In 1873 the old Spanish ramparts were coming down: Brialmont's new ring (1859-64) had made them useless and
// the town was laying out its boulevards on their line, a stretch at a time. The garrison still kept a round
// and sentries on what stood. So the wall has, added once in place to every town (ids "wf01" ...; their own
// random stream, seed ^ WALLFOLK_SALT, so the rest of the town stays as it was):
//
// - the garrison: a round of two soldiers walking the walk by day and another in the evening (side by side,
//   town.ts pair), and a sentry at each of two sentry boxes on the walk, two reliefs each;
// - the town's works: a gang pulling down a stretch of the breastwork (tools/blender/build_wall.py WORKS has the
//   same stretch): two men carry the rubble from the breach to the brick stacks, one at the crab winch of the
//   shear legs, one cleaning bricks, their foreman by the town's notice. Monday to Saturday, 7:00 to 17:30;
// - a retired man walking his dog on the wall morning and afternoon;
// - two lovers who walk the wall at dusk and stand in a quiet corner of it (game/backlife.ts plays "walk" and
//   "lovers:" places; the lovers keep each other's side there, `mate`);
// - a brother and sister with a kite on the north-east bastion's lawn after school and on Sunday afternoon (the
//   client draws the kite from the boy's hand while he is there: world/wallLife.ts KITE_PLACE).
//
// Where: the segments of decor.rampart (shared/city.json), s metres along a segment and o metres out from the
// town face (the walk runs from o 0.47 to o 6.3), each point checked on the walk map (open, reachable, on top).

const WALLFOLK_SALT = 0x0a11f01c;
export const WALLFOLK_ID = /^wf\d+$/;

interface Seg0 {
  name: string;
  o: Pt;
  t: Pt;
  n: Pt;
  len: number;
}
const R = (CITY as unknown as { decor: { rampart?: { t: number; segments: Seg0[]; tops: number[][][] } } }).decor.rampart ?? null;

/** The demolition works: the same stretch as tools/blender/build_wall.py WORKS. */
export const WORKS = { seg: "seg7", s0: 70, s1: 80 };
/** The sentry boxes on the walk that are manned (build_wall.py build_props: seg5 s 112, seg1 s 70, seg8 s 34). */
const BOXES: Array<{ id: string; seg: string; s: number; label: string }> = [
  { id: "wall:post_kipdorp", seg: "seg5", s: 112, label: "the sentry box on the ramparts by the Kipdorppoort" },
  { id: "wall:post_joris", seg: "seg8", s: 34, label: "the sentry box on the ramparts by the Sint-Jorispoort" },
];
const BW_IN = 0.65; // the breastwork's inner face, from the field face
/** The kite place on the north-east bastion's lawn (client world/wallLife.ts KITE_PLACE). */
export const KITE = { x: 226, z: 333, r: 7 };

const inRing = (ring: number[][], x: number, z: number) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const segOf = (name: string) => R?.segments.find((q) => q.name === name) ?? null;
/** A point s along a segment, o out from the town face. */
function at(name: string, s: number, o: number): Pt | null {
  const g = segOf(name);
  if (!g || !R) return null;
  const off = R.t - o;
  return [g.o[0] + g.t[0] * s - g.n[0] * off, g.o[1] + g.t[1] * s - g.n[1] * off];
}
/** Which way the field lies from a segment (yaw, facing (sin, cos)). */
const fieldYaw = (name: string) => {
  const g = segOf(name)!;
  return Math.atan2(g.n[0], g.n[1]);
};
const r1 = (v: number) => Math.round(v * 10) / 10;

const FIRST_M = ["Jan", "Pieter", "Frans", "Karel", "Hendrik", "Louis", "Constant", "August", "Victor", "Emiel", "Alfons", "Leon", "Jules", "Petrus", "Jozef", "Staf", "Remi", "Cyriel", "Honore", "Seraphin", "Camiel", "Florimond"];
const FIRST_F = ["Maria", "Anna", "Rosalie", "Elisa", "Joanna", "Mathilde", "Celine", "Pelagie", "Ludovica", "Melanie", "Leonie", "Coleta"];
const SUR = ["Verbeeck", "Van Gorp", "De Wit", "Claes", "Wouters", "Van Hove", "Maes", "Jacobs", "Sels", "Nuyts", "Van Roey", "Heylen", "Verheyen", "Thys", "Bosmans", "Luyten", "Van Dessel", "Engelen", "Daems", "Wijns"];
const TAKEN = new Set(["Jef", "Sooi", "Tuur", "Fientje", "Peeters", "Cools", "Verhulst", "Leentje", "Van Dyck"]);
const DOGS = ["Fox", "Pluto", "Bruno", "Tom", "Moor"];

/** The wall's people and places a town still lacks (pure: the same seed and residents give the same people). */
export function generateWallFolk(seed: number, places: Record<string, TownPlace>, residents: readonly Resident[]): { residents: Resident[]; places: Record<string, TownPlace> } {
  const out: Resident[] = [];
  const outPlaces: Record<string, TownPlace> = {};
  if (!R) return { residents: out, places: outPlaces };
  const rng = rngFrom((seed ^ WALLFOLK_SALT) >>> 0);
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const j = (h: number, s = 0.25) => Math.round((h + (rng() * 2 - 1) * s) * 4) / 4;
  const wm = walkMap();
  const tops = R.tops;
  /** On top of the wall, open and reachable: the point, or the nearest such toward the walk's middle. */
  const onWalk = (name: string, s: number, o: number): Pt | null => {
    for (const d of [0, 0.3, -0.3, 0.6, -0.6, 1.0, -1.0, 1.5]) {
      const p = at(name, s, o + d);
      if (!p) return null;
      const [x, z] = [r1(p[0]), r1(p[1])];
      if (tops.some((ring) => inRing(ring, x, z)) && wm.flags(x, z) === 0 && wm.reachable(x, z) && wm.open(x, z, 0.35)) return [x, z];
    }
    return null;
  };
  const usedNames = new Set(residents.map((r) => r.name));
  const usedHouses = new Set([...residents.map((r) => r.home.house).filter((h) => h >= 0), ...INWORLD_HOUSES]);
  let household = residents.reduce((m, r) => Math.max(m, r.household), 0);
  const have = new Set(residents.map((r) => r.id));
  let n = 0;
  const doors = houseDoors();
  const doorNear = (x: number, z: number): HouseDoor => {
    const byD = doors.map((d) => ({ d, k: Math.hypot(d.sx - x, d.sz - z) })).sort((a, b) => a.k - b.k);
    const d = (byD.find((q) => q.k <= 260 && !usedHouses.has(q.d.house)) ?? byD[0]).d;
    usedHouses.add(d.house);
    return d;
  };
  const homeAt = (d: HouseDoor): Home => ({ house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz });
  const statsFor = (trade: TradeId): Stats => {
    const def = TRADES[trade];
    const s = {} as Stats;
    for (const k of ["honesty", "temper", "piety", "warmth", "greed", "courage", "gossip"] as const) {
      const v = 5 + (rng() + rng() + rng() - 1.5) * 4 + (def.bias?.[k] ?? 0);
      s[k] = Math.max(0, Math.min(10, Math.round(v)));
    }
    s.wealth = int(def.wealth[0], def.wealth[1]);
    return s;
  };
  const name = (sex: "m" | "f", family?: string): { first: string; surname: string } => {
    for (let i = 0; i < 80; i++) {
      const first = pick(sex === "m" ? FIRST_M : FIRST_F);
      const surname = family ?? pick(SUR);
      if (TAKEN.has(first) || TAKEN.has(surname) || usedNames.has(`${first} ${surname}`)) continue;
      usedNames.add(`${first} ${surname}`);
      return { first, surname };
    }
    return { first: pick(sex === "m" ? FIRST_M : FIRST_F), surname: `${pick(SUR)}-${n}` };
  };
  const taverns = Object.keys(places).filter((k) => k.startsWith("tavern:"));
  const tavernNear = (x: number, z: number) => [...taverns].sort((a, b) => Math.hypot(places[a].x - x, places[a].z - z) - Math.hypot(places[b].x - x, places[b].z - z))[0] ?? null;
  const add = (o: { trade: TradeId; kind: string; sex?: "m" | "f"; age: number; home: Home; hh?: number; role?: string; surname?: string; work: Resident["work"]; day: Seg[]; sunday: Seg[] }): Resident => {
    const sex = o.sex ?? "m";
    const nm = name(sex, o.surname);
    const r: Resident = {
      id: `wf${String(++n).padStart(2, "0")}`,
      first: nm.first,
      surname: nm.surname,
      name: `${nm.first} ${nm.surname}`,
      age: o.age,
      sex,
      household: o.hh ?? ++household,
      family_role: o.role ?? "single",
      trade: o.trade,
      faction: TRADES[o.trade].faction,
      kind: o.kind,
      home: o.home,
      work: o.work,
      sched: { day: tidy(o.day), sunday: tidy(o.sunday) },
      stats: statsFor(o.trade),
      dog: null,
    };
    if (!have.has(r.id)) out.push(r);
    return r;
  };
  const route = (pts: Array<[string, number, number]>): Pt[] => pts.map(([g, s, o]) => onWalk(g, s, o)).filter((p): p is Pt => !!p);
  const there = (id: string, label: string, p: Pt, r: number, extra: Partial<TownPlace> = {}) => {
    if (!places[id]) outPlaces[id] = { label, x: p[0], z: p[1], r, district: "town", ...extra };
  };
  const barracks = places.barracks;
  const soldierHome: Home | null = barracks ? { house: -1, x: barracks.x, z: barracks.z, sx: barracks.x, sz: barracks.z } : null;

  // --- the garrison's rounds of the walk: by day between the Keizerspoort and the Kipdorppoort, past the mill;
  // in the evening from the Kipdorppoort to the works, round the north-west bastion. There and back.
  const rounds: Array<{ id: string; pts: Array<[string, number, number]>; day: Seg[] }> = [
    { id: "wall:round_day", pts: [["seg4", 72, 3.4], ["seg4", 110, 3.6], ["seg4", 150, 3.4], ["seg5", 12, 3.5], ["seg5", 45, 3.6], ["seg5", 70, 3.4]], day: [[j(7.75), 12, "work"], [13, j(17.75), "work"]] },
    { id: "wall:round_eve", pts: [["seg5", 100, 3.4], ["seg5", 140, 2.6], ["seg5", 175, 3.5], ["seg6", 30, 3.4], ["seg6", 80, 3.5], ["seg7", 20, 3.4], ["seg7", 60, 3.2]], day: [[j(17.75), 23.5, "work"]] },
  ];
  if (soldierHome) {
    for (const rd of rounds) {
      const pts = route(rd.pts);
      if (pts.length < 3) continue;
      const loop = [...pts, ...pts.slice(1, -1).reverse()];
      const mid = pts[Math.floor(pts.length / 2)];
      there(rd.id, "the round of the ramparts", mid, 30);
      const hh = ++household;
      const pair: Resident[] = [];
      for (let k = 0; k < 2; k++) {
        const r = add({ trade: "soldier", kind: "sentry", age: int(20, 27), home: soldierHome, hh, work: { place: rd.id, kind: "roam", route: loop, door: [soldierHome.sx, soldierHome.sz] }, day: rd.day.map((q) => [...q] as Seg), sunday: rd.day.map((q) => [...q] as Seg) });
        pair.push(r);
      }
      pair[0].mate = pair[1].id;
      pair[1].mate = pair[0].id;
    }
  }

  // --- the sentries at the sentry boxes on the walk: two reliefs each, four hours on (a quarter hour over)
  if (soldierHome) {
    for (const b of BOXES) {
      const g = segOf(b.seg);
      if (!g) continue;
      const o = R.t - BW_IN - 0.5 - 0.85; // before the box's open front (build_wall.py sentry_walk)
      const p = onWalk(b.seg, b.s, o);
      if (!p) continue;
      there(b.id, b.label, p, 3);
      const yaw = Math.round((fieldYaw(b.seg) + Math.PI) * 100) / 100; // facing into the walk, the town beyond
      const hh = ++household;
      const tours: Seg[][] = [
        [[5.75, 10, "work"], [13.75, 18, "work"], [21.75, 26, "work"]],
        [[1.75, 6, "work"], [9.75, 14, "work"], [17.75, 22, "work"]],
      ];
      const pair: Resident[] = [];
      for (const t of tours) pair.push(add({ trade: "sentry", kind: "sentry", age: int(20, 26), home: soldierHome, hh, work: { place: b.id, kind: "guard", at: [p[0], p[1], yaw], door: [soldierHome.sx, soldierHome.sz] }, day: t.map((q) => [...q] as Seg), sunday: t.map((q) => [...q] as Seg) }));
      pair[0].mate = pair[1].id;
      pair[1].mate = pair[0].id;
    }
  }

  // --- the town's works: the gang pulling down the breastwork on seg7 (Monday to Saturday)
  {
    const { seg, s0, s1 } = WORKS;
    const g = segOf(seg);
    const heap = onWalk(seg, s0 + 2.5, R.t - BW_IN - 1.25);
    const heap2 = onWalk(seg, s1 - 2.5, R.t - BW_IN - 1.25);
    const stack = onWalk(seg, s0 - 2.3, 1.75);
    const stack2 = onWalk(seg, s1 + 2.2, 1.75);
    const winch = onWalk(seg, (s0 + s1) / 2 + 0.6, R.t - BW_IN - 1.0);
    const sorter = onWalk(seg, s0 - 3.2, 2.1);
    const boss = onWalk(seg, s0 - 5.6, 2.2);
    if (g && heap && heap2 && stack && stack2 && winch && sorter && boss) {
      const mid = at(seg, (s0 + s1) / 2, 3.5)!;
      there("wall:works", "the town's works on the ramparts, where the old wall comes down", [r1(mid[0]), r1(mid[1])], 12);
      const field = fieldYaw(seg);
      const along = Math.atan2(g.t[0], g.t[1]);
      const tav = tavernNear(stack[0], stack[1]);
      const week = (h0: number, h1: number, evening: boolean): Seg[] => [
        [j(h0, 0), 12, "work"],
        [13, j(h1, 0), "work"],
        ...(evening && tav ? [[j(18.5), j(21), "tavern", tav] as Seg] : []),
      ];
      const sunday = (pious: boolean): Seg[] => [...(pious ? [[8.75, 11, "church", "church"] as Seg] : []), ...(tav ? [[j(15), j(18.5), "tavern", tav] as Seg] : [])];
      const home = (p: Pt) => homeAt(doorNear(p[0] + rnd(-40, 40), p[1] + rnd(-60, 20)));
      const fore = add({ trade: "works_foreman", kind: "foreman", age: int(40, 55), home: home(boss), role: "head", work: { place: "wall:works", kind: "post", at: [boss[0], boss[1], Math.round((field - 0.4) * 100) / 100] }, day: week(6.75, 17.75, false), sunday: sunday(true) });
      void fore;
      const kinds = ["docker_a", "docker_c", "docker_b", "docker_a"];
      add({ trade: "navvy", kind: kinds[0], age: int(19, 40), home: home(heap), work: { place: "wall:works", kind: "haul", a: heap, b: stack }, day: week(7, 17.5, true), sunday: sunday(rng() < 0.4) });
      add({ trade: "navvy", kind: kinds[1], age: int(19, 40), home: home(heap2), work: { place: "wall:works", kind: "haul", a: heap2, b: stack2 }, day: week(7, 17.5, true), sunday: sunday(rng() < 0.4) });
      add({ trade: "navvy", kind: kinds[2], age: int(25, 50), home: home(winch), work: { place: "wall:works", kind: "post", at: [winch[0], winch[1], Math.round((field + Math.PI) * 100) / 100], motion: "pull" }, day: week(7, 17.5, false), sunday: sunday(rng() < 0.5) });
      add({ trade: "navvy", kind: kinds[3], age: int(16, 60), home: home(sorter), work: { place: "wall:works", kind: "post", at: [sorter[0], sorter[1], Math.round(along * 100) / 100], motion: "crouch" }, day: week(7, 17.5, true), sunday: sunday(rng() < 0.5) });
    }
  }

  // --- a retired man and his dog: the walk in the morning and the afternoon
  {
    const p = onWalk("seg6", 60, 3.4) ?? [-300, 330];
    const r = add({ trade: "retired", kind: "old_man", age: int(62, 74), home: homeAt(doorNear(p[0] + 30, p[1] - 40)), role: "head", work: { place: "home", kind: "roam", route: [] }, day: [[j(9.5), j(10.75), "stroll", "walk"], [j(15.25), j(16.5), "stroll", "walk"]], sunday: [[8.75, 11, "church", "church"], [j(14.75), j(16.25), "stroll", "walk"]] });
    r.dog = { name: pick(DOGS), look: pick(["dog_brown", "dog_black", "dog_spotted", "dog_grey"]) };
  }

  // --- two lovers: the walk at dusk, then a quiet corner of it, turned to each other (game/backlife.ts)
  {
    const nook = onWalk("seg6", 44, R.t - BW_IN - 0.45);
    if (nook) {
      const g = segOf("seg6")!;
      there("lovers:wall", "a quiet corner of the ramparts, looking out over the fields", nook, 2, { out: [Math.round(g.n[0] * 1000) / 1000, Math.round(g.n[1] * 1000) / 1000] });
      const day: Seg[] = [[j(18, 0), 19, "stroll", "walk"], [19, j(20.25), "loiter", "lovers:wall"]];
      const sunday: Seg[] = [[j(15, 0), 16.5, "stroll", "walk"], [16.5, j(17.5), "loiter", "lovers:wall"]];
      const lad = add({ trade: "clerk", kind: "clerk", age: int(19, 24), home: homeAt(doorNear(nook[0] + 40, nook[1] - 60)), work: { place: "home", kind: "inside", door: undefined }, day: [[8, 12, "work"], [13, 17.5, "work"], ...day], sunday: [[8.75, 11, "church", "church"], ...sunday] });
      const girl = add({ trade: "seamstress", kind: "girl_b", sex: "f", age: int(18, 22), home: homeAt(doorNear(nook[0] + 70, nook[1] - 30)), work: { place: "home", kind: "inside", door: undefined }, day: [[8, 12, "work"], [13, 17.5, "work"], ...day.map((q) => [...q] as Seg)], sunday: [[8.75, 11, "church", "church"], ...sunday.map((q) => [...q] as Seg)] });
      lad.work.door = [lad.home.sx, lad.home.sz];
      girl.work.door = [girl.home.sx, girl.home.sz];
      lad.mate = girl.id;
      girl.mate = lad.id;
    }
  }
  // --- a brother and sister flying a kite on the north-east bastion's lawn
  {
    let spot: Pt | null = null;
    for (let k = 0; k < 24 && !spot; k++) {
      const a = k * 2.4;
      const d = k * 0.25;
      const x = r1(KITE.x + Math.sin(a) * d);
      const z = r1(KITE.z + Math.cos(a) * d);
      if (tops.some((ring) => inRing(ring, x, z)) && wm.flags(x, z) === 0 && wm.reachable(x, z) && wm.open(x, z, 1.2)) spot = [x, z];
    }
    if (spot) {
      there("kite:ne", "the lawn on the north-east bastion, where the children fly their kites", spot, 5);
      const hh = ++household;
      const home = homeAt(doorNear(spot[0] - 40, spot[1] - 50));
      const day: Seg[] = [[j(15.75), j(17.25), "loiter", "kite:ne"]];
      const sunday: Seg[] = [[8.75, 11, "church", "church"], [j(14), j(16.5), "loiter", "kite:ne"]];
      const boy = add({ trade: "child", kind: "boy", age: int(9, 12), home, hh, role: "child", work: { place: "kite:ne", kind: "roam" }, day, sunday });
      add({ trade: "child", kind: "girl", sex: "f", age: int(7, 10), home, hh, role: "child", surname: boy.surname, work: { place: "kite:ne", kind: "roam" }, day: day.map((q) => [...q] as Seg), sunday: sunday.map((q) => [...q] as Seg) });
    }
  }
  return { residents: out, places: outPlaces };
}

/** Give a save the wall's people and their places (once, in place). Returns how many were added. */
export function ensureWallFolk(db: DB): number {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return 0;
  if ((db.prepare("SELECT COUNT(*) AS n FROM resident WHERE id LIKE 'wf%'").get() as { n: number }).n > 0) return 0;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  if (!row) return 0;
  const t = town(db).town;
  const g = generateWallFolk(t.seed, t.places, t.residents);
  if (!g.residents.length) return 0;
  const rest = JSON.parse(row.value_json) as { places: Record<string, TownPlace> };
  const insNpc = db.prepare("INSERT OR IGNORE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let added = 0;
  db.transaction(() => {
    const places = { ...rest.places, ...g.places };
    for (const r of g.residents) {
      if (hasNpc.get(r.id)) continue;
      insNpc.run(r.id, r.name, shownTrade(r), places[r.work.place]?.district ?? "town", r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
      added++;
    }
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places }));
  })();
  dropTownCache(db);
  return added;
}
