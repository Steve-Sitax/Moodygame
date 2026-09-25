// The garrison and the customs of Antwerp, 1873 (Steve, 2026-09-24). Antwerp was the
// National Redoubt, the kingdom's great fortress: a large garrison of line infantry,
// artillery and Guides lived in its barracks. Customs officers checked the goods landed
// on the quays. In the game they are townspeople like the others (residents, npc rows,
// schedules, talk, rumours), made by the ENGINE from the town's seed, never by a model:
//
// - Sentries: three reliefs of two men at each guard post (the railway gate of the Werf),
//   two hours on, four off in the guard room; the relief walks out half an hour before the
//   hour and waits in front of the old pair until they march in. A corporal of the guard
//   comes out with every relief.
// - Soldiers off duty, in pairs (`mate`): drill in the barracks in the morning, walking out
//   in the afternoon on a round of the town, a tavern in the evening, in by the tattoo.
// - Customs officers on the quays: from one landing of goods to the next (`inspect`),
//   checking the crates and casks and writing in their book.
//
// They walk, stand and talk. They never fight and never arrest anyone: theft is for the
// police alone (police.ts, deeds.ts); a soldier sends Jef to the police post.
//
// The garrison has its own random stream (seed ^ GARRISON_SALT), so adding it leaves the rest
// of a town exactly as it was, and an older save gets the same men a new game would
// (store.ts ensureGarrison).

import { houseDoors, walkMap, WATER, type HouseDoor } from "./walkmap.ts";
import { INWORLD_HOUSES } from "./kept.ts";
import { STATS, TAVERNS, TRADES, type Stat, type TradeId } from "./places.ts";
import { rngFrom, scheduleFor, tidy, type Home, type Pt, type Resident, type Stats, type TownPlace } from "./population.ts";
import type { Seg } from "./schedule.ts";

const GARRISON_SALT = 0x5eed1873;

export const GARRISON_TRADES: readonly TradeId[] = ["soldier", "sentry", "corporal", "customs"];
export const isGarrison = (t: string): boolean => (GARRISON_TRADES as readonly string[]).includes(t);
/** Soldiers of every kind (not the customs). */
export const isSoldier = (t: string): boolean => t === "soldier" || t === "sentry" || t === "corporal";

// ------------------------------------------------------------------ where

export interface GuardPost {
  id: string;
  label: string;
  district: string;
  /** The two sentries: where each stands and which way he faces (yaw: facing (sin, cos)). */
  posts: [[number, number, number], [number, number, number]];
  /** The corporal at a change of the guard: in front of the pair, facing them. */
  front: [number, number, number];
  /** The guard room: the house door nearest this point. */
  room: Pt;
  roomLabel: string;
}

/**
 * The gates the game has (Steve: "sentries at the city gates the game has"): the railway gate
 * of the Werf store (client/src/world/railgate.ts: the facade at x -311, the track at z 4, the
 * leaves sweep x -311..-308.4, z 1.5..6.5, the keeper at (-309.7, 8)). The pair stands on the
 * town side of the track, clear of the leaves, the rails and the lamp, facing down the quay.
 */
export const GUARD_POSTS: GuardPost[] = [
  {
    id: "railgate",
    label: "the railway gate of the Werf",
    district: "werf",
    posts: [
      [-307.6, 7.9, Math.PI / 2],
      [-305.4, 7.9, Math.PI / 2],
    ],
    front: [-304.2, 10.4, -2.3],
    room: [-311.5, 13.1],
    roomLabel: "the guard room by the railway gate",
  },
];

/** The Falcon barracks by the Falconrui, north of the Canal des Brasseurs (a house door stands in for its gate). */
export const BARRACKS = { x: -40, z: 160, label: "the Falcon barracks" };

/** Walking-out rounds of the soldiers off duty: place ids, walked in order. */
const ROUNDS: string[][] = [
  ["canal", "back_lane", "rijnkaai", "vismarkt", "steenplein"],
  ["grote_markt", "handschoenmarkt", "vleeshuis", "vismarkt"],
  ["canal", "vismarkt", "steenplein", "werf", "grote_markt"],
  ["back_lane", "rijnkaai", "bassin", "bassin_south", "canal"],
];

/** The customs beats: where goods are landed and laid out (props3d.ts rows and heaps), per quay. */
const CUSTOMS_BEATS: Array<{ place: string; pts: Pt[] }> = [
  // the Rijnkaai, by the ships at the start
  { place: "rijnkaai", pts: [[-28, 14], [-6, 15], [18, 14], [44, 14]] },
  // the Werf: wine and stone laid out between the trees, on the town side of the railway
  { place: "werf", pts: [[-296, 12.8], [-272, 12.8], [-250, 12.8], [-230, 12.8]] },
  // beyond the lock and the casks on the open quay at the north end of the Rijnkaai
  { place: "bassin", pts: [[76, 12], [92, 24], [140, 9.5], [160, 9.5]] },
  // the south quay of the Petit Bassin: cotton weighed in front of the Hanseatic House
  { place: "bassin_south", pts: [[92, 117], [112, 117], [132, 117], [150, 115]] },
];

// ------------------------------------------------------------------ who

const FIRST_FL = ["Jan", "Pieter", "Frans", "Karel", "Hendrik", "Louis", "Constant", "Camille", "August", "Victor", "Emiel", "Alfons", "Leon", "Gustaaf", "Remi", "Jules", "Achiel", "Petrus", "Jozef", "Staf", "Lode", "Ward", "Dries", "Bernard"];
const FIRST_WA = ["Joseph", "Henri", "Emile", "Octave", "Alphonse", "Arthur", "Eugene", "Hubert", "Firmin", "Adolphe", "Gaspard", "Leopold"];
const SUR_FL = ["Vermeulen", "Van Aken", "De Ridder", "Verlinden", "Wouters", "Claessens", "Van Tongel", "Hoeben", "Mariens", "Van Olmen", "Ceulemans", "Bosmans", "Van Camp", "Luyckx", "Daems", "Wijns", "Van Genechten", "Diels", "Laenen"];
const SUR_WA = ["Dubois", "Lambert", "Dupont", "Renard", "Leclercq", "Collard", "Delvaux", "Masson", "Gilson", "Lejeune", "Remy", "Piron", "Lemaire", "Hardy", "Mathieu", "Jacquet"];
const FROM_FL = ["Lier", "Turnhout", "Geel", "Mol", "Herentals", "Aalst", "Lokeren", "Tielt", "Hasselt", "Tongeren", "Diest", "Mechelen", "Boom", "Duffel", "Hoogstraten", "the Kempen"];
const FROM_WA = ["Namur", "Charleroi", "Dinant", "Mons", "Arlon", "Huy", "Nivelles", "Tournai", "Verviers"];

/** Names the game already uses for its own people. */
const TAKEN = new Set(["Jef", "Sooi", "Tuur", "Fientje", "Peeters", "Cools", "Verhulst", "Leentje", "Van Dyck"]);

export interface Garrison {
  residents: Resident[];
  places: Record<string, TownPlace>;
}

/**
 * The garrison and the customs for a town: the same town seed and residents always give the
 * same men. `residents` is the town as it is (new ids follow the last one, names stay unique,
 * the customs take free house doors).
 */
export function generateGarrison(seed: number, places: Record<string, TownPlace>, residents: Resident[]): Garrison {
  const rng = rngFrom((seed ^ GARRISON_SALT) >>> 0);
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const chance = (p: number) => rng() < p;
  const wm = walkMap();
  /** A point on ground reachable from the start, to 0.1 m (walkmap's nearestOpen rounds after it checks). */
  const onGround = (x: number, z: number): Pt | null => {
    for (let d = 0; d <= 0.61; d += 0.1)
      for (const [dx, dz] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]]) {
        const rx = Math.round((x + dx) * 10) / 10;
        const rz = Math.round((z + dz) * 10) / 10;
        if (wm.reachable(rx, rz)) return [rx, rz];
      }
    return null;
  };
  const snapOr = (x: number, z: number, max = 12): Pt | null => {
    const q = wm.nearestOpen(x, z, max);
    return q ? onGround(q.x, q.z) : null;
  };
  const snap = (x: number, z: number, max = 8): Pt => snapOr(x, z, max) ?? [x, z];
  const r1 = (n: number) => Math.round(n * 100) / 100;

  const outPlaces: Record<string, TownPlace> = {};
  const all = (id: string) => outPlaces[id] ?? places[id];
  const out: Resident[] = [];
  const usedNames = new Set(residents.map((r) => r.name));
  // (the in-world houses, kept.ts, are kept for their tavern, the Poesje, the homes to let)
  const usedHouses = new Set([...residents.map((r) => r.home.house).filter((h) => h >= 0), ...INWORLD_HOUSES]);
  let nextId = residents.reduce((m, r) => Math.max(m, /^r\d+$/.test(r.id) ? Number(r.id.slice(1)) : 0), 0) + 1;
  let household = residents.reduce((m, r) => Math.max(m, r.household), 0);
  const doors = houseDoors();

  /** A house door near a point: a free one within `maxD` if there is one, else the nearest. */
  const doorNear = (x: number, z: number, maxD: number, take: boolean): HouseDoor => {
    const byD = doors.map((d) => ({ d, k: Math.hypot(d.sx - x, d.sz - z) })).sort((a, b) => a.k - b.k);
    const free = byD.find((o) => o.k <= maxD && !usedHouses.has(o.d.house));
    const d = (free ?? byD[0]).d;
    if (take) usedHouses.add(d.house);
    return d;
  };
  const homeAt = (d: HouseDoor): Home => ({ house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz });

  const statsFor = (trade: TradeId, age: number): Stats => {
    const def = TRADES[trade];
    const s = {} as Stats;
    for (const k of STATS) {
      let v = 5 + (rng() + rng() + rng() - 1.5) * 4 + (def.bias?.[k as Stat] ?? 0);
      if (age < 25 && k === "courage") v += 1;
      s[k as Stat] = Math.max(0, Math.min(10, Math.round(v)));
    }
    s.wealth = int(def.wealth[0], def.wealth[1]);
    return s;
  };
  const surnames = new Set<string>();
  const nameFor = (walloon: boolean): { first: string; surname: string } => {
    for (let i = 0; i < 60; i++) {
      const first = pick(walloon ? FIRST_WA : FIRST_FL);
      const surname = pick(walloon ? SUR_WA : SUR_FL);
      if (TAKEN.has(first) || TAKEN.has(surname)) continue;
      if (surnames.has(surname) && i < 40) continue; // men from all over the country: no two of a name if it can be helped
      surnames.add(surname);
      const full = `${first} ${surname}`;
      if (!usedNames.has(full)) {
        usedNames.add(full);
        return { first, surname };
      }
    }
    const first = `${pick(FIRST_FL)}`;
    const surname = `${pick(SUR_FL)} ${nextId}`;
    usedNames.add(`${first} ${surname}`);
    return { first, surname };
  };
  const add = (p: { trade: TradeId; age: number; kind: string; home: Home; work: Resident["work"]; hh: number; role?: string; sex?: "m" | "f"; surname?: string; walloon?: boolean }): Resident => {
    const walloon = p.walloon ?? chance(0.3);
    const nm = p.surname ? { first: "", surname: p.surname } : nameFor(walloon);
    let first = nm.first;
    if (p.surname) {
      // a wife: a woman's name, unique with the husband's surname
      const WOMEN = ["Maria", "Anna", "Rosalie", "Josephine", "Elisabeth", "Joanna", "Catharina", "Paulina", "Mathilde", "Leonie", "Virginie", "Melanie", "Julie", "Marie", "Emma", "Lucie"];
      for (let i = 0; i < 30; i++) {
        first = pick(WOMEN);
        if (!usedNames.has(`${first} ${p.surname}`)) break;
      }
      usedNames.add(`${first} ${p.surname}`);
    }
    const r: Resident = {
      id: `r${String(nextId++).padStart(3, "0")}`,
      first,
      surname: nm.surname,
      name: `${first} ${nm.surname}`,
      age: p.age,
      sex: p.sex ?? "m",
      household: p.hh,
      family_role: p.role ?? "single",
      trade: p.trade,
      faction: TRADES[p.trade].faction,
      kind: p.kind,
      home: p.home,
      work: p.work,
      sched: { day: [], sunday: [] },
      stats: statsFor(p.trade, p.age),
      dog: null,
    };
    if (p.trade !== "housewife") r.origin = walloon ? pick(FROM_WA) : pick(FROM_FL);
    out.push(r);
    return r;
  };
  const j = (h: number, s = 0.25) => Math.round((h + (rng() * 2 - 1) * s) * 4) / 4;

  // --- the barracks: every soldier off duty lives behind its gate
  const bd = doorNear(BARRACKS.x, BARRACKS.z, 60, true);
  const barracks = homeAt(bd);
  outPlaces.barracks = { label: BARRACKS.label, x: bd.sx, z: bd.sz, r: 4, district: "canal", door: [bd.sx, bd.sz], out: bd.out };

  // --- the guard posts: three reliefs of two, and a corporal
  for (const gp of GUARD_POSTS) {
    const rd = doorNear(gp.room[0], gp.room[1], 20, false);
    const room = homeAt(rd);
    outPlaces[`guardroom:${gp.id}`] = { label: gp.roomLabel, x: rd.sx, z: rd.sz, r: 3, district: gp.district, door: [rd.sx, rd.sz], out: rd.out };
    const mid: Pt = [(gp.posts[0][0] + gp.posts[1][0]) / 2, (gp.posts[0][1] + gp.posts[1][1]) / 2];
    outPlaces[`post:${gp.id}`] = { label: gp.label, x: mid[0], z: mid[1], r: 3, district: gp.district };
    const hh = ++household;
    for (let k = 0; k < 3; k++) {
      const starts = [0, 1, 2, 3].map((i) => (2 * k + 6 * i) % 24);
      const tours: Seg[] = starts.map((s) => (s === 0 ? [23.5, 26, "work"] : [s - 0.5, s + 2, "work"]) as Seg);
      const pair: Resident[] = [];
      for (let side = 0; side < 2; side++) {
        const [x, z, yaw] = gp.posts[side];
        const r = add({ trade: "sentry", age: int(20, 26), kind: "sentry", home: room, hh, work: { place: `post:${gp.id}`, kind: "guard", at: [x, z, yaw], door: [rd.sx, rd.sz] } });
        r.sched = { day: tidy(tours.map((s) => [...s] as Seg)), sunday: tidy(tours.map((s) => [...s] as Seg)) };
        pair.push(r);
      }
      pair[0].mate = pair[1].id;
      pair[1].mate = pair[0].id;
    }
    const [fx, fz, fyaw] = gp.front;
    const corp = add({ trade: "corporal", age: int(23, 31), kind: "soldier_b", home: room, hh, work: { place: `post:${gp.id}`, kind: "guard", at: [fx, fz, fyaw], door: [rd.sx, rd.sz] } });
    const changes: Seg[] = [];
    for (let s = 0; s < 24; s += 2) changes.push(s === 0 ? [23.5, 24.25, "work"] : [s - 0.5, s + 0.25, "work"]);
    corp.sched = { day: tidy(changes.map((s) => [...s] as Seg)), sunday: tidy(changes.map((s) => [...s] as Seg)) };
  }

  // --- soldiers off duty, in pairs
  const taverns = TAVERNS.map((t) => `tavern:${t.id}`).filter((k) => all(k));
  const nearestTavern = (p: Pt) => taverns.reduce((b, k) => (Math.hypot(all(k).x - p[0], all(k).z - p[1]) < Math.hypot(all(b).x - p[0], all(b).z - p[1]) ? k : b), taverns[0]);
  ROUNDS.forEach((round, i) => {
    const hh = ++household;
    const route: Pt[] = round
      .map((id) => all(id))
      .filter((pl): pl is TownPlace => !!pl)
      .map((pl) => {
        const a = rng() * Math.PI * 2;
        const d = rng() * pl.r * 0.45;
        // a point off the ground (in the water, in a house) falls back to the place's own anchor
        return snapOr(pl.x + Math.cos(a) * d, pl.z + Math.sin(a) * d) ?? snapOr(pl.x, pl.z);
      })
      .filter((q): q is Pt => !!q);
    const tavern = taverns.length ? nearestTavern(route[route.length - 1] ?? [barracks.sx, barracks.sz]) : null;
    // the pairs keep different hours: two walk out after dinner, one late, one only to the tavern
    const walkFrom = [j(13.75), j(15.5), j(14.25), 0][i % 4];
    const walkTo = [j(17.25), j(18.25), j(17.75), 0][i % 4];
    const tattoo = 21; // the tattoo (taptoe: the taps shut): back in barracks. The Belgian hour is not known; 21:00 is our choice for autumn
    const day: Seg[] = [[j(6, 0), 12.5, "work"]];
    if (walkFrom) day.push([walkFrom, walkTo, "stroll", round[0]]);
    if (i % 4 === 3) day.push([13.5, j(17.5), "work"]);
    if (tavern) day.push([Math.max(walkTo || 0, j(18.25)), tattoo, "tavern", tavern]);
    const pair: Resident[] = [];
    for (let k = 0; k < 2; k++) {
      const r = add({ trade: "soldier", age: int(20, 27), kind: "soldier", home: barracks, hh, work: { place: "barracks", kind: "inside", door: [barracks.sx, barracks.sz], route } });
      const pious = r.stats.piety >= 5;
      const sunday: Seg[] = [...(pious || k === 1 ? [[8.75, 11, "church", "church"] as Seg] : []), [13, j(17.5), "stroll", round[0]]];
      if (tavern) sunday.push([17.75, tattoo, "tavern", tavern]);
      r.sched = { day: tidy(day.map((s) => [...s] as Seg)), sunday: tidy(sunday) };
      pair.push(r);
    }
    // the pair keeps one day: the second man goes where the first goes
    pair[1].sched = { day: pair[0].sched.day.map((s) => [...s] as Seg), sunday: pair[0].sched.sunday.map((s) => [...s] as Seg) };
    pair[0].mate = pair[1].id;
    pair[1].mate = pair[0].id;
  });

  // --- customs officers on the quays, living in town, some married
  for (const beat of CUSTOMS_BEATS) {
    const pl = all(beat.place);
    const anchor: Pt = pl ? [pl.x, pl.z] : beat.pts[0];
    const d = doorNear(anchor[0], anchor[1], 160, true);
    const home = homeAt(d);
    const hh = ++household;
    const route = beat.pts.map(([x, z]) => snap(x, z));
    const faces = route.map(([x, z]) => r1(faceWater(x, z, anchor)));
    const officer = add({ trade: "customs", age: int(29, 54), kind: "customs", home, hh, role: "head", walloon: chance(0.35), work: { place: beat.place, kind: "inspect", route, faces } });
    officer.sched = {
      day: tidy([[j(7), 12, "work"], [13, j(18), "work"]]),
      // the port works on Sundays too: the customs keep a morning at the quays
      sunday: tidy([[j(8), 12, "work"]]),
    };
    if (chance(0.6)) {
      const wife = add({ trade: "housewife", age: Math.max(22, officer.age + int(-8, 1)), kind: pick(["wife_a", "wife_b"]), sex: "f", home, hh, role: "wife", surname: officer.surname, work: { place: "home", kind: "inside", door: [home.sx, home.sz] } });
      wife.sched = scheduleFor(wife, { ...places, ...outPlaces }, taverns, rng);
    }
  }
  return { residents: out, places: outPlaces };

  /** The way to the nearest open water within 14 m (the goods lie between him and the ships); else away from the anchor. */
  function faceWater(x: number, z: number, anchor: Pt): number {
    let best: number | null = null;
    let bd2 = Infinity;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      for (let dd = 1; dd <= 14; dd += 0.5) {
        if (wm.flags(x + Math.sin(a) * dd, z + Math.cos(a) * dd) & WATER) {
          if (dd < bd2) {
            bd2 = dd;
            best = a;
          }
          break;
        }
      }
    }
    return best ?? Math.atan2(x - anchor[0], z - anchor[1]);
  }
}
