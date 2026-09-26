import type { DB } from "../db.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import INWORLD from "../../../shared/inworld_houses.json" with { type: "json" };
import CITY from "../../../shared/city.json" with { type: "json" };
import { HAULS, PLACES, shownTrade, STATS, TRADES, type Stat, type TradeId } from "./places.ts";
import { rngFrom, tidy, type Home, type Pt, type Resident, type Stats, type Town, type TownPlace } from "./population.ts";
import type { Seg } from "./schedule.ts";
import { offLanes } from "./possessions.ts";
import { buildRound } from "./lively.ts";
import { dropTownCache, town } from "./store.ts";

// The back of town (M7 back of town, Steve 2026-09-26: "There are no people in the back of town:
// make sure appropriate people, groups and gangs are there, bringing everything to life").
//
// Why it was empty (measured on a copy of the save, docs/milestones/M7-back-of-town.md): the town was
// made before the angled streets, the alleys and the wall. 678 of the 959 house doors stand in the
// back (inland of z 145, or west of x -300), but only 39 of 293 homes; every workplace, market, play
// place and tavern lies by the river. So nobody had a reason to be there: 0 to 8 people out in the
// whole back at any hour.
//
// The cure, made by the ENGINE from the town's seed (its own random stream: the rest of the town
// stays as it was), like the lively streets (lively.ts):
// - households of the poor quarter round each court pump and each street corner of the back: a
//   washerwoman at the pump, a labourer who walks to the quays, children who play in the court, a
//   lad who hangs about the corner with his mates, an old man on a chair by his door or at cards,
//   an old woman at her door, neighbours who stand and talk;
// - households of the better streets: a clerk who walks to his office and home for dinner, his
//   wife on her errands and in the park, their maid;
// - the parish priests of Sint-Jacob and Sint-Paulus on their rounds of the sick, a doctor on his,
//   beggars at the church doors, the night watch with their lanterns, men too fond of drink,
//   three small taverns (estaminets) on back corners, lovers in the park, Sunday strollers on the
//   ramparts and in the Stadspark.
//
// Everyone has a home, a trade and a day (schedule.ts). What they do at a place of their day is the
// place's kind (its id's prefix): the client (game/backlife.ts) plays it: the pump, the corner, the
// cards, the doorstep, the talk at a door, the park, the walk on the wall.
//
// Save migration (ensureBackTown): an older save gets the same people a new game would, added in
// place after the last resident; every other resident, memory and relationship stays. Runs once.

const BACK_SALT = 0x0bac7011;

export const BACK_TRADES: readonly TradeId[] = ["washerwoman", "loafer", "watchman", "parish_priest", "doctor", "drunkard"];
/** One of the back of town's people ("bk001"...). */
export const isBackId = (id: string): boolean => /^bk\d+$/.test(id);

/** The back of town: inland of the old river town (the angled streets, the alleys, the park, toward the wall), and the west strip by the wall. */
export function inBack(x: number, z: number): boolean {
  return z >= 145 || x <= -300;
}

export { backKind, type BackPlaceKind } from "./backkind.ts";
import { backKind } from "./backkind.ts";

// ------------------------------------------------------------------ fixed things

const PUMPS = ((CITY as unknown as { alleys?: { pumps?: Pt[] } }).alleys?.pumps ?? []) as Pt[];
const LANDMARKS = (CITY as unknown as { landmarks: Record<string, { frame: { c: Pt; n: Pt; W: number; open: number } }> }).landmarks;
const PARK = (CITY as unknown as { decor: { park?: { outline: Pt[]; ponds: Array<[number, number, number]> } } }).decor.park;
/** The wall's line (tools/city/rampart.py TRACE): the walk on top lies just inside it. */
const TRACE: Pt[] = [[215, 0], [230, 92], [236, 205], [222, 318], [118, 352], [-60, 360], [-245, 352], [-360, 318], [-372, 215], [-364, 105], [-355, 0]];
/** The town gates (their passages are at the street's level). */
const GATES: Pt[] = Object.values((CITY as unknown as { places: Record<string, { x: number; z: number; kind: string }> }).places)
  .filter((p) => p.kind === "gate")
  .map((p) => [p.x, p.z] as Pt);
/** The town's middle, for "inward" from the wall. */
const MIDDLE: Pt = [-60, 170];

/** The three churches of the back: their front door (the side the frame opens to). */
const CHURCHES: Array<{ id: string; label: string; key: string; district: string }> = [
  { id: "stjacob", label: "Sint-Jacobskerk", key: "stjacob", district: "canal" },
  { id: "stpaul", label: "Sint-Pauluskerk", key: "stpaul", district: "eilandje" },
  { id: "carolus", label: "Sint-Carolus Borromeus", key: "carolus", district: "vismarkt" },
];

/** The estaminets of the back: small taverns on a corner, a publican at the door, men with a pot before it. */
const KROEGEN = ["In den Hoek", "Het Pijpke", "De Blauwe Hand", "In de Zwaan"];

const MEN = ["Jan", "Pieter", "Frans", "Karel", "Hendrik", "Louis", "Constant", "Victor", "Emiel", "Theofiel", "Alfons", "Cornelis", "Willem", "Remi", "Achiel", "Petrus", "Jozef", "Rik", "Staf", "Lowie", "Toon", "Fons", "Lode", "Ward", "Dries", "Ferdinand", "Gust", "Sus", "Miel", "Nand", "Jules", "Bert", "Mon", "Door", "Flor", "Kamiel", "Jaak", "Seppe", "Tist", "Wannes"];
const WOMEN = ["Maria", "Anna", "Rosalie", "Josephine", "Joanna", "Catharina", "Theresia", "Paulina", "Coleta", "Barbara", "Mathilde", "Sidonie", "Leonie", "Trien", "Mie", "Stans", "Betje", "Nette", "Rosa", "Julie", "Irma", "Fien", "Lize", "Door", "Wiske", "Treze", "Jet", "Mariette", "Zulma", "Romanie", "Pelagie", "Ida"];
const SURNAMES = ["Van Gils", "Peeters", "Verbist", "Schoofs", "Van Asch", "Moorkens", "Dockx", "Goris", "Van Ham", "Bastiaens", "Van Nuffel", "Stoffels", "Hofkens", "Van Looy", "Meeus", "Bruyninckx", "Van Rompaey", "Verheyen", "Leysen", "Wauters", "Keysers", "Proost", "Vervoort", "Van Camp", "De Ridder", "Van Hemelrijck", "Laureys", "Cleymans", "Van Ranst", "Buelens", "Wijns", "Van Oevelen", "Dens", "Engelen", "Hens", "Mariën", "Boeckx", "Tuts", "Nauwelaerts", "Sterckx", "Verachtert", "Van de Velde", "Rombouts", "Kenis", "Pluym"];
const TAKEN = new Set(["Jef", "Sooi", "Tuur", "Fientje", "Peeters", "Cools", "Verhulst", "Leentje", "Van Dyck"]);

export interface BackTown {
  residents: Resident[];
  places: Record<string, TownPlace>;
}

// ------------------------------------------------------------------ where

const D = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Free, reachable ground with room round it, off the omnibus and dray lanes. */
function standable(x: number, z: number, room: number): boolean {
  const wm = walkMap();
  return wm.reachable(x, z) && wm.open(x, z, room) && offLanes(x, z, 0.2);
}

/** Metres of open ground from (x, z) in direction a (radians; +z is 0), up to max. */
function run(x: number, z: number, a: number, max: number): number {
  const wm = walkMap();
  const sx = Math.sin(a);
  const sz = Math.cos(a);
  for (let s = 0.5; s <= max; s += 0.5) if (wm.flags(x + sx * s, z + sz * s) !== 0) return s - 0.5;
  return max;
}

/**
 * Street corners of the back: where three or more streets meet (long runs of open ground in three
 * or more directions), not an open square. Each gives the spot where a group stands: a step out
 * from the nearest wall (the lads lounge by a house corner), and the way to the wall.
 */
export function backCorners(): Array<{ x: number; z: number; wall: number }> {
  if (cornerCache) return cornerCache;
  const cands: Array<{ x: number; z: number; arms: number; k: number }> = [];
  const N = 16;
  for (let x = -366; x <= 232; x += 3)
    for (let z = 60; z <= 356; z += 3) {
      if (!inBack(x, z) || !standable(x, z, 0.9)) continue;
      const runs = Array.from({ length: N }, (_, i) => run(x, z, (i / N) * Math.PI * 2, 22));
      // an open square is no corner
      let openRing = 0;
      for (let i = 0; i < N; i++) if (runs[i] >= 5) openRing++;
      if (openRing >= N - 2) continue;
      // arms: groups of neighbouring long directions
      let arms = 0;
      for (let i = 0; i < N; i++) if (runs[i] >= 14 && runs[(i + N - 1) % N] < 14) arms++;
      if (arms >= 3) cands.push({ x, z, arms, k: runs.reduce((a, b) => a + b, 0) });
    }
  cands.sort((a, b) => b.arms - a.arms || b.k - a.k);
  const picked: Array<{ x: number; z: number; wall: number }> = [];
  for (const c of cands) {
    if (picked.some((p) => D([p.x, p.z], [c.x, c.z]) < 42)) continue;
    // toward the nearest wall, 1.3 m short of it: the lads stand against the house corner
    let best = -1;
    let bd = 99;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const d = run(c.x, c.z, a, 8);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const a = (best / 16) * Math.PI * 2;
    const back = Math.max(0, bd - 1.3);
    const x = r1(c.x + Math.sin(a) * back);
    const z = r1(c.z + Math.cos(a) * back);
    if (!standable(x, z, 0.8)) continue;
    picked.push({ x, z, wall: Math.round(a * 1000) / 1000 });
  }
  cornerCache = picked;
  return picked;
}
let cornerCache: Array<{ x: number; z: number; wall: number }> | null = null;

/** A point near (x, z), within `max`, with `room` round it (rings outward, the same answer for the same point). */
function roomNear(x: number, z: number, room: number, max = 8, avoid: Pt[] = [], keep = 0): Pt | null {
  for (let r = 0; r <= max; r += 0.5)
    for (let i = 0; i < Math.max(1, Math.round(r * 4)); i++) {
      const a = (i / Math.max(1, Math.round(r * 4))) * Math.PI * 2;
      const px = r1(x + Math.sin(a) * r);
      const pz = r1(z + Math.cos(a) * r);
      if (!standable(px, pz, room)) continue;
      if (avoid.some((q) => D(q, [px, pz]) < keep)) continue;
      return [px, pz];
    }
  return null;
}

/** Points along the walk on top of the wall (the first open, reachable ground inward of the wall's line). */
export function wallWalk(): Pt[] {
  if (walkCache) return walkCache;
  const wm = walkMap();
  const out: Pt[] = [];
  for (let i = 0; i < TRACE.length - 1; i++) {
    const [a, b] = [TRACE[i], TRACE[i + 1]];
    const L = D(a, b);
    for (let s = 12; s < L - 8; s += 26) {
      const x = a[0] + ((b[0] - a[0]) * s) / L;
      const z = a[1] + ((b[1] - a[1]) * s) / L;
      const toward = Math.atan2(MIDDLE[0] - x, MIDDLE[1] - z);
      for (let d = -6; d <= 16; d += 0.5) {
        const px = r1(x + Math.sin(toward) * d);
        const pz = r1(z + Math.cos(toward) * d);
        // (not at a gate: its passage is at the street's level, under the walk)
        if (GATES.some((g) => D(g, [px, pz]) < 16)) break;
        if (wm.flags(px, pz) === 0 && wm.reachable(px, pz) && wm.open(px, pz, 0.6)) {
          out.push([px, pz]);
          break;
        }
      }
    }
  }
  walkCache = out;
  return out;
}
let walkCache: Pt[] | null = null;

/** The front door of a church of the back (its frame's open side), on free ground before it. */
function churchDoor(key: string): { at: Pt; face: number } | null {
  const f = LANDMARKS[key]?.frame;
  if (!f) return null;
  const s = f.open >= 0 ? 1 : -1;
  const out: Pt = [f.n[0] * s, f.n[1] * s];
  const x = f.c[0] + out[0] * (f.W / 2 + 2.5);
  const z = f.c[1] + out[1] * (f.W / 2 + 2.5);
  const q = roomNear(x, z, 0.6, 10);
  return q ? { at: q, face: Math.round(Math.atan2(-out[0], -out[1]) * 1000) / 1000 } : null;
}

/** How wide the street is before this door. */
function across(d: HouseDoor): number {
  return run(d.sx, d.sz, Math.atan2(d.out[0], d.out[1]), 24) + D([d.x, d.z], [d.sx, d.sz]);
}

// ------------------------------------------------------------------ the generator

/**
 * The back of town's people for a town: the same town seed and residents always give the same
 * people. `residents` is the town as it is (ids "bk001"..., names unique, homes free house doors).
 * `scale`: about 1 for a town of the Normal size (a smaller town gets fewer, a bigger more).
 */
export function generateBackTown(seed: number, places: Record<string, TownPlace>, residents: Resident[], kept: number[] = []): BackTown {
  const key = `${seed}:${residents.length}:${residents.map((r) => r.id).join(",")}:${kept.join(",")}`;
  const had = memo.get(key);
  if (had) return structuredClone(had);
  const made = makeBackTown(seed, places, residents, kept);
  memo.set(key, made);
  return structuredClone(made);
}
const memo = new Map<string, BackTown>();

function makeBackTown(seed: number, places: Record<string, TownPlace>, residents: Resident[], kept: number[]): BackTown {
  const rng = rngFrom((seed ^ BACK_SALT) >>> 0);
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const chance = (p: number) => rng() < p;
  const j = (h: number, s = 0.25) => Math.round((h + (rng() * 2 - 1) * s) * 4) / 4;
  // a Normal town (about 290 with everyone added in place) gets the full back; a small one fewer
  const scale = Math.max(0.55, Math.min(1.5, residents.length / 290));

  const outPlaces: Record<string, TownPlace> = {};
  const all = (id: string) => outPlaces[id] ?? places[id];
  const out: Resident[] = [];
  const usedNames = new Set(residents.map((r) => r.name));
  const usedHouses = new Set(residents.map((r) => r.home.house).filter((h) => h >= 0));
  for (const e of (INWORLD as { houses: Array<{ house: number }> }).houses) usedHouses.add(e.house);
  for (const h of kept) usedHouses.add(h);
  // doors people already step out of or work at (a hash of 3 m cells: the look-up is asked thousands of times)
  const taken = new Map<string, Pt[]>();
  const cell = (x: number, z: number) => `${Math.floor(x / 3)},${Math.floor(z / 3)}`;
  const take = (p: Pt) => {
    const k = cell(p[0], p[1]);
    const l = taken.get(k) ?? [];
    l.push(p);
    taken.set(k, l);
  };
  const takenNear = (x: number, z: number): boolean => {
    const cx = Math.floor(x / 3);
    const cz = Math.floor(z / 3);
    for (let i = -1; i <= 1; i++)
      for (let k = -1; k <= 1; k++) for (const [tx, tz] of taken.get(`${cx + i},${cz + k}`) ?? []) if (Math.hypot(tx - x, tz - z) < 2.5) return true;
    return false;
  };
  const takenPts = { push: take };
  for (const r of residents) {
    takenPts.push([r.home.sx, r.home.sz]);
    if (r.work.door) takenPts.push(r.work.door);
  }
  for (const p of Object.values(places)) if (p.door) takenPts.push(p.door);
  let nextId = residents.reduce((m, r) => Math.max(m, isBackId(r.id) ? Number(r.id.slice(2)) : 0), 0) + 1;
  let household = residents.reduce((m, r) => Math.max(m, r.household), 0);
  // (a door's step is rounded to 10 cm: a few land a hair inside a wall cell; those are left out)
  const doors = houseDoors().filter((d) => walkMap().reachable(d.sx, d.sz));
  const backDoors = doors.filter((d) => inBack(d.sx, d.sz));
  const districtAt = (x: number, z: number): string => {
    let best = PLACES[0];
    for (const p of PLACES) if (D([p.x, p.z], [x, z]) < D([best.x, best.z], [x, z])) best = p;
    return best.district;
  };

  /** A free back door near a point (nobody lives there; `pred` for the kind of house); null when none within `max`. */
  const freeDoorNear = (x: number, z: number, max: number, pred: (d: HouseDoor) => boolean = () => true): HouseDoor | null => {
    let best: HouseDoor | null = null;
    let bd = max;
    for (const d of backDoors) {
      if (usedHouses.has(d.house) || !pred(d)) continue;
      const k = D([d.sx, d.sz], [x, z]);
      if (k >= bd) continue;
      if (takenNear(d.sx, d.sz)) continue;
      bd = k;
      best = d;
    }
    if (best) {
      usedHouses.add(best.house);
      take([best.sx, best.sz]);
    }
    return best;
  };
  const homeAt = (d: HouseDoor): Home => ({ house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz });

  const statsFor = (trade: TradeId, age: number): Stats => {
    const def = TRADES[trade];
    const s = {} as Stats;
    for (const k of STATS) {
      let v = 5 + (rng() + rng() + rng() - 1.5) * 4 + (def.bias?.[k as Stat] ?? 0);
      if (age >= 55 && (k === "piety" || k === "gossip")) v += 1;
      if (age < 25 && k === "courage") v += 1;
      if (age < 15 && k === "gossip") v -= 2;
      s[k as Stat] = Math.max(0, Math.min(10, Math.round(v)));
    }
    s.wealth = int(def.wealth[0], def.wealth[1]);
    return s;
  };
  const surnameFree = () => {
    for (let i = 0; i < 30; i++) {
      const s = pick(SURNAMES);
      if (!TAKEN.has(s)) return s;
    }
    return pick(SURNAMES);
  };
  const nameFor = (sex: "m" | "f", surname: string): { first: string; surname: string } => {
    for (let i = 0; i < 60; i++) {
      const first = pick(sex === "m" ? MEN : WOMEN);
      if (TAKEN.has(first) || usedNames.has(`${first} ${surname}`)) continue;
      return { first, surname };
    }
    return { first: pick(sex === "m" ? MEN : WOMEN), surname: `${surname} ${nextId}` };
  };
  const add = (p: { trade: TradeId; kind: string; sex: "m" | "f"; age: number; home: Home; hh: number; role: string; surname: string; work: Resident["work"]; sched: { day: Seg[]; sunday: Seg[] }; first?: string; full?: string }): Resident => {
    const nm = p.first ? { first: p.first, surname: p.surname } : nameFor(p.sex, p.surname);
    const full = p.full ?? `${nm.first} ${nm.surname}`;
    usedNames.add(full);
    const r: Resident = {
      id: `bk${String(nextId++).padStart(3, "0")}`,
      first: nm.first,
      surname: nm.surname,
      name: full,
      age: p.age,
      sex: p.sex,
      household: p.hh,
      family_role: p.role,
      trade: p.trade,
      faction: TRADES[p.trade].faction,
      kind: p.kind,
      home: p.home,
      work: p.work,
      sched: { day: tidy(p.sched.day), sunday: tidy(p.sched.sunday) },
      stats: statsFor(p.trade, p.age),
      dog: null,
    };
    out.push(r);
    return r;
  };
  const place = (id: string, label: string, x: number, z: number, r: number, extra: Partial<TownPlace> = {}): string => {
    outPlaces[id] = { label, x: r1(x), z: r1(z), r, district: districtAt(x, z), ...extra };
    return id;
  };
  const nearestKey = (keys: string[], p: Pt): string => keys.reduce((b, k) => (D([all(k).x, all(k).z], p) < D([all(b).x, all(b).z], p) ? k : b), keys[0]);
  const markets = Object.keys(places).filter((k) => k.startsWith("market:"));
  const churchOf = (r: { stats: Stats }, from: number, to: number, where = "church"): Seg[] => (r.stats.piety >= 5 ? [[j(from), j(to), "church", where]] : []);

  // ---- the hubs: the court pumps and the corners of the back streets
  interface Hub {
    key: string;
    x: number;
    z: number;
    pump: string | null;
    corner: string | null;
    cards: string | null;
    gossip: string | null;
    play: string | null;
    lanes?: string;
  }
  const hubs: Hub[] = [];
  PUMPS.forEach(([px, pz], i) => {
    // (the pump's post is solid: free ground a step from it, in its own court: a court shut off from the
    // streets has no washing, and a point beyond its wall is not the court)
    const at = roomNear(px, pz, 0.45, 2.5);
    if (!at) return;
    const id = place(`pump:${i}`, "the pump in the court", px, pz, 3);
    hubs.push({ key: `p${i}`, x: px, z: pz, pump: id, corner: null, cards: null, gossip: null, play: null });
  });
  const corners = backCorners();
  corners.forEach((c, i) => {
    const id = place(`corner:${i}`, "a street corner in the back streets", c.x, c.z, 2.5, { out: [Math.sin(c.wall), Math.cos(c.wall)] });
    // a corner near a pump belongs to that court's people
    const near = hubs.find((h) => h.pump && !h.corner && D([h.x, h.z], [c.x, c.z]) < 45);
    if (near) near.corner = id;
    else hubs.push({ key: `c${i}`, x: c.x, z: c.z, pump: null, corner: id, cards: null, gossip: null, play: null });
  });
  // and the streets between: a point every 30 m or so of the back's streets with houses round it, so that
  // people live (and stand at their doors, and walk their errands) all through the back, not only by a pump
  {
    let si = 0;
    for (let x = -366; x <= 232; x += 30)
      for (let z = 150; z <= 356; z += 30) {
        const q = roomNear(x, z, 0.8, 9);
        if (!q || !inBack(q[0], q[1]) || hubs.some((h) => D([h.x, h.z], q) < 26)) continue;
        if (backDoors.filter((d) => D([d.sx, d.sz], q) < 25).length < 4) continue;
        hubs.push({ key: `s${si++}`, x: q[0], z: q[1], pump: null, corner: null, cards: null, gossip: null, play: null });
      }
  }
  // what each hub has: a card game on a step, a door where the neighbours talk, a place where the children play
  // (kept clear of the washing round each pump)
  const groupPts: Pt[] = hubs.filter((h) => h.pump).map((h) => [h.x, h.z] as Pt);
  for (const h of hubs) {
    const c = h.key.startsWith("s") ? null : roomNear(h.x + 5, h.z + 4, 1.5, 12, groupPts, 5.5);
    if (c) {
      groupPts.push(c);
      h.cards = place(`cards:${h.key}`, "a game of cards on a doorstep", c[0], c[1], 1.5);
    }
    const pl = h.key.startsWith("s") ? null : roomNear(h.x - 3, h.z - 5, 2.5, 14, groupPts, 6);
    if (pl) {
      groupPts.push(pl);
      h.play = place(`play:bk${h.key}`, "a court where the children play", pl[0], pl[1], 7);
    }
    // the lanes round about: out along each street from here and back (up to 45 m), for errands and a turn
    // about the neighbourhood; the way is walked on the streets (the crowd's grid), passing the hub each time
    const mid = roomNear(h.x, h.z, 0.5, 4);
    const spokes: Pt[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const L = run(h.x, h.z, a, 45);
      if (L < 10) continue;
      const q = roomNear(h.x + Math.sin(a) * L * 0.85, h.z + Math.cos(a) * L * 0.85, 0.5, 3);
      if (q && !spokes.some((o) => D(o, q) < 9)) spokes.push(q);
    }
    if (mid && spokes.length >= 2) h.lanes = place(`lanes:${h.key}`, "the lanes round about", mid[0], mid[1], 45, { route: spokes.flatMap((q) => [q, mid]) });
  }
  // the park and the wall walk, the lovers' places by the ponds
  const parkC = PARK?.outline.length ? PARK.outline.reduce((a, p) => [a[0] + p[0] / PARK.outline.length, a[1] + p[1] / PARK.outline.length] as Pt, [0, 0] as Pt) : ([-300, 312] as Pt);
  const parkAt = roomNear(parkC[0], parkC[1] - 14, 0.8, 16) ?? parkC;
  // the park's gravel paths, a point every 6 m or so on free ground: the way the strollers walk
  const parkRoute: Pt[] = [];
  const PARK_PATHS = ((CITY as unknown as { decor: { park?: { paths?: Pt[][] } } }).decor.park?.paths ?? []) as Pt[][];
  // (the park pass, 2026-09-26: the paths' middle lines, tools/city/park.py, where there are: a point on the gravel's
  // edge may lie a hand's breadth from a bench or the hedge)
  const PARK_LINES = ((CITY as unknown as { decor: { park?: { lines?: Array<{ pts: Pt[] }> } } }).decor.park?.lines ?? []).map((l) => l.pts);
  for (const path of PARK_LINES.length ? PARK_LINES : PARK_PATHS)
    for (const q of path) {
      if (parkRoute.length && D(parkRoute[parkRoute.length - 1], q) < 6) continue;
      if (standable(q[0], q[1], 0.5)) parkRoute.push([r1(q[0]), r1(q[1])]);
    }
  place("park", "the Stadspark", parkAt[0], parkAt[1], 26, parkRoute.length >= 4 ? { route: parkRoute } : {});
  const walk = wallWalk();
  const walkMid = walk.length ? walk[Math.floor(walk.length / 2)] : ([-60, 352] as Pt);
  place("walk", "the walk on the ramparts", walkMid[0], walkMid[1], 40, walk.length >= 4 ? { route: walk } : {});
  const lovers: string[] = [];
  (PARK?.ponds ?? []).forEach(([px, pz, pr], i) => {
    for (const a of [Math.PI, Math.PI * 0.5, Math.PI * 1.5, 0]) {
      const q = roomNear(px + Math.sin(a) * (pr + 2), pz + Math.cos(a) * (pr + 2), 0.8, 4);
      if (q) {
        lovers.push(place(`lovers:${i}`, "the edge of the pond in the Stadspark", q[0], q[1], 1.5, { out: [px - q[0], pz - q[1]] }));
        break;
      }
    }
  });
  // the churches' doors
  const churchPlace: Record<string, { id: string; face: number }> = {};
  for (const c of CHURCHES) {
    const d = churchDoor(c.key);
    if (!d) continue;
    churchPlace[c.id] = { id: place(`church:${c.id}`, `the door of the ${c.label}`, d.at[0], d.at[1], 4), face: d.face };
  }
  const nearestChurch = (p: Pt): string => {
    const ids = Object.values(churchPlace).map((c) => c.id);
    return ids.length ? nearestKey(ids, p) : "church";
  };
  // the estaminets: a door on a corner with room before it
  const kroegen: string[] = [];
  const kroegHubs = hubs.filter((h) => h.corner).sort((a, b) => a.x - b.x);
  for (let i = 0; i < KROEGEN.length && kroegHubs.length; i++) {
    const h = kroegHubs[Math.floor(((i + 0.5) / KROEGEN.length) * kroegHubs.length)];
    const d = freeDoorNear(h.x, h.z, 30, (q) => !q.alley && across(q) >= 5 && standable(q.sx + q.out[0] * 1.8, q.sz + q.out[1] * 1.8, 0.6));
    if (!d) continue;
    kroegen.push(place(`kroeg:${i}`, KROEGEN[i], d.sx, d.sz, 4, { door: [d.sx, d.sz], out: d.out }));
    const hh = ++household;
    const surname = surnameFree();
    const age = int(34, 62);
    const at: [number, number, number] = [r1(d.sx + d.out[0] * 0.8), r1(d.sz + d.out[1] * 0.8), Math.round(Math.atan2(d.out[0], d.out[1]) * 1000) / 1000];
    const keeper = add({ trade: "publican", kind: "publican", sex: "m", age, home: homeAt(d), hh, role: "head", surname, work: { place: `kroeg:${i}`, kind: "tavern", at }, sched: { day: [[j(10), 25, "work"]], sunday: [[j(11.5), 25, "work"]] } });
    keeper.stats.gossip = Math.max(keeper.stats.gossip, 6);
    // his wife works the counter indoors; she stands at the door with a word now and then
    add({ trade: "housewife", kind: pick(["wife_a", "wife_b"]), sex: "f", age: Math.max(24, age - int(0, 8)), home: homeAt(d), hh, role: "wife", surname, work: { place: "home", kind: "inside", door: [d.sx, d.sz] }, sched: { day: [[j(9), j(10.25), "market", nearestKey(markets, [d.sx, d.sz])]], sunday: [[j(8.75), j(10), "church", nearestChurch([d.sx, d.sz])]] } });
  }
  const kroegNear = (p: Pt): string | null => (kroegen.length ? nearestKey(kroegen, p) : null);

  // ---- the households of the poor quarter, round each hub
  const quays = ["rijnkaai", "werf", "bassin", "bassin_south", "entrepot", "canal", "vismarkt"].filter((k) => HAULS[k]?.length && places[k]);
  /** At most five women wash at one pump (the ring round it is full then). */
  const washers = new Map<string, number>();
  const pumpNear = (p: Pt): string | null => {
    const ps = hubs.filter((h) => h.pump && D([h.x, h.z], p) < 130 && (washers.get(h.pump) ?? 0) < 5).map((h) => h.pump!);
    return ps.length ? nearestKey(ps, p) : null;
  };
  // a court's pump has three households round it, a corner two (a small town one each; the back has only so
  // many doors, so a bigger town gets no more here than a Normal one)
  const perHub = (h: Hub, i: number) => (h.pump ? (scale >= 0.85 ? 3 : 1) : h.corner ? (scale >= 0.85 ? 2 : i % 2) : scale >= 0.85 ? 1 : i % 2);
  // the groups: a few corners have a gang (three to five lads), a few doorsteps a card game (up to five),
  // and the women of neighbouring houses stand at one door (up to four); everyone to the nearest with room
  const counts = new Map<string, number>();
  const join = (k: string | null) => {
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  const withRoom = (keys: string[], p: Pt, cap: number, maxD = 1e9): string | null => {
    const ks = keys.filter((k) => (counts.get(k) ?? 0) < cap && D([all(k).x, all(k).z], p) < maxD);
    return ks.length ? nearestKey(ks, p) : null;
  };
  /** n of these places spread over the back (each the farthest from those already taken). */
  const spread = (keys: string[], n: number): string[] => {
    const out: string[] = keys.length ? [keys[0]] : [];
    while (out.length < Math.min(n, keys.length)) {
      let best = "";
      let bd = -1;
      for (const k of keys) {
        if (out.includes(k)) continue;
        const d = Math.min(...out.map((o) => D([all(o).x, all(o).z], [all(k).x, all(k).z])));
        if (d > bd) {
          bd = d;
          best = k;
        }
      }
      out.push(best);
    }
    return out;
  };
  const gangCorners = spread(hubs.filter((h) => h.corner).map((h) => h.corner!), Math.max(3, Math.round(8 * scale)));
  const cardSites = spread(hubs.filter((h) => h.cards).map((h) => h.cards!), Math.max(3, Math.round(10 * scale)));
  // the other corners: the men not taken on at the gates stand there in a knot and talk (casual men found
  // work two or three days a week, docs/milestones/M6-townlife.md research): the same spot, a knot of men
  const knots: string[] = [];
  for (const h of hubs) {
    if (!h.corner || gangCorners.includes(h.corner)) continue;
    const c = all(h.corner);
    knots.push(place(`knot:${h.key}`, "a street corner where the men out of work stand", c.x, c.z, 2, { out: c.out }));
  }
  const gossipSites: string[] = [];
  // the courts first, then the corners and streets in a shuffled order, up to a number of households (the
  // same for any map: a map with more doors does not make a bigger town)
  const maxHouseholds = scale >= 1.2 ? 150 : scale >= 0.85 ? 135 : 30;
  const order = hubs.map((h) => ({ h, k: h.pump ? -1 : rng() })).sort((a, b) => a.k - b.k).map((o) => o.h);
  let households = 0;
  let hubNo = 0;
  for (const h of order) {
    const n = perHub(h, hubNo++);
    for (let k = 0; k < n && households < maxHouseholds; k++) {
      const d = freeDoorNear(h.x, h.z, 60, (q) => !!q.alley) ?? freeDoorNear(h.x, h.z, 60, (q) => across(q) < 9);
      if (!d) continue;
      const home = homeAt(d);
      const hp: Pt = [home.sx, home.sz];
      const hh = ++household;
      households++;
      const surname = surnameFree();
      const pump = h.pump && (washers.get(h.pump) ?? 0) < 5 ? h.pump : pumpNear(hp);
      const corner = withRoom(gangCorners, hp, 5);
      const cards = withRoom(cardSites, hp, 5, 140);
      let gossip = withRoom(gossipSites, hp, 3, 30);
      if (!gossip) {
        // a new knot of neighbours, before this door
        gossip = `gossip:${h.key}${k ? `_${k}` : ""}`;
        const g = roomNear(home.sx + d.out[0] * 1.6, home.sz + d.out[1] * 1.6, 1.0, 4, groupPts, 3) ?? hp;
        groupPts.push(g);
        place(gossip, "a neighbour's door", g[0], g[1], 1.5, { out: d.out });
        gossipSites.push(gossip);
      }
      const lanes = h.lanes ?? null;
      const play = h.play ?? nearestKey(Object.keys(outPlaces).filter((x) => x.startsWith("play:bk")), hp);
      const market = nearestKey(markets, hp);
      // (an estaminet's door holds the drinkers of seven households or so; the rest drink nowhere near)
      const kroeg = withRoom(kroegen, hp, 7, 220);
      join(kroeg);
      const church = nearestChurch(hp);
      const widow = chance(0.18);
      // the man of the house: a labourer at the quays, now and then one who drinks his wage
      const manAge = int(26, 52);
      let man: Resident | null = null;
      if (!widow) {
        const drunk = chance(0.12);
        if (drunk) {
          // his round of the back streets: from the estaminet by corners and doors, home at last
          const pts: Pt[] = [];
          for (let t = 0; t < 5; t++) {
            const q = roomNear(h.x + rnd(-40, 40), h.z + rnd(-40, 40), 0.9, 10); // (open ground, not a nook a crate may shut)
            if (q) pts.push(q);
          }
          const route = pts.length >= 2 ? pts : [hp, hp];
          const did = place(`drunk:${hh}`, "the back streets", route[0][0], route[0][1], 30);
          const bar = kroeg ?? market;
          man = add({ trade: "drunkard", kind: pick(["docker_a", "docker_b", "docker_c"]), sex: "m", age: manAge, home, hh, role: "head", surname, work: { place: did, kind: "roam", route }, sched: {
            day: [[j(10.5), j(13), "tavern", bar], [13, j(15), "work"], [j(15), j(21.5), "tavern", bar], [j(21.75), j(24.5), "work"]],
            sunday: [[j(11), j(14), "tavern", bar], [14, j(16), "work"], [j(16), j(22), "tavern", bar], [j(22.25), j(24.75), "work"]],
          } });
          man.stats.piety = Math.min(man.stats.piety, 2);
          man.stats.temper = Math.max(man.stats.temper, 5);
        } else {
          const q = pick(quays);
          const haul = pick(HAULS[q]);
          const trade: TradeId = chance(0.7) ? "docker" : "porter";
          const drinker = chance(0.55);
          // not taken on today: at the gate at dawn, then back in his own streets (the knot at the corner, the
          // lanes, the estaminet's door, cards)
          const knot = chance(0.45) ? withRoom(knots, hp, 5, 120) : null;
          join(knot);
          // a Sunday afternoon at cards, while there is a crate free at the table
          const sunCards = cards && (counts.get(cards) ?? 0) < 5 ? cards : null;
          join(sunCards);
          man = add({ trade, kind: trade === "porter" ? "porter" : pick(["docker_a", "docker_b", "docker_c"]), sex: "m", age: manAge, home, hh, role: "head", surname, work: trade === "docker" ? { place: q, kind: "haul", a: haul.a, b: haul.b } : { place: q, kind: "roam", route: [haul.a, haul.b] }, sched: {
            day: knot
              ? [[j(5.5, 0.2), j(6.75), "work"], [j(8), j(10.5), "loiter", knot], ...(lanes ? [[j(10.5), j(11.5), "stroll", lanes] as Seg] : []), ...(kroeg ? [[j(11.5), j(12.25), "tavern", kroeg] as Seg] : []), [j(12.25), j(13), "home"], [j(13), j(16), "loiter", knot], ...(cards ? [[j(16), j(18), "loiter", cards] as Seg] : []), ...(kroeg ? [[j(18.5), j(22, 0.5), "tavern", kroeg] as Seg] : [])]
              : [[j(6, 0.2), j(12), "work"], [j(12), j(12.75), "home"], [j(12.75), j(18.25), "work"], ...(drinker && kroeg ? [[j(19), j(22, 0.5), "tavern", kroeg] as Seg] : [])],
            sunday: [...(chance(0.4) ? [[j(8.75), j(10), "church", church] as Seg] : []), ...(sunCards ? [[j(14.5), j(18), "loiter", sunCards] as Seg] : []), ...(drinker && kroeg ? [[j(18.5), j(22), "tavern", kroeg] as Seg] : [])],
          } });
        }
      }
      // the woman of the house: washing for the better houses at the pump, or at home with her work
      const womanAge = widow ? int(36, 60) : Math.max(22, manAge - int(0, 8));
      const washes = !!pump && chance(0.6);
      if (washes && pump) washers.set(pump, (washers.get(pump) ?? 0) + 1);
      join(gossip);
      const wife = add({ trade: washes ? "washerwoman" : chance(0.3) ? "seamstress" : "housewife", kind: pick(["wife_a", "wife_b", "wife_b", "fishwife_b"]), sex: "f", age: womanAge, home, hh, role: widow ? "widow" : "wife", surname, work: washes && pump ? { place: pump, kind: "post", at: [...(roomNear(all(pump).x, all(pump).z, 0.45, 2.5) ?? [all(pump).x, all(pump).z]), 0] as [number, number, number] } : { place: "home", kind: "inside", door: [home.sx, home.sz] }, sched: { day: [], sunday: [] } });
      if (washes) {
        wife.sched = {
          day: tidy([[j(7), j(11.75), "work"], [j(11.75), j(12.75), "home"], [j(12.75), j(16.25), "work"], [j(16.5), j(17.75), "loiter", gossip], [j(17.75), j(18.5), "market", market]]),
          sunday: tidy([...churchOf(wife, 8.75, 10, church), [j(10.5), j(13.25), "loiter", gossip], [j(15), j(17.25), "stroll", chance(0.5) ? "park" : "walk"]]),
        };
      } else {
        wife.sched = {
          day: tidy([lanes && chance(0.5) ? [j(8.5), j(9.75), "stroll", lanes] : [j(8.5), j(9.75), "market", market], [j(10.25), j(11.75), "loiter", gossip], ...(lanes ? [[j(13.5), j(14.75), "stroll", lanes] as Seg] : []), [j(15), j(16.25), "loiter", gossip], [j(16.5), j(17.75), "stroll", chance(0.5) ? "park" : play]]),
          sunday: tidy([...churchOf(wife, 8.75, 10, church), [j(10.5), j(13.25), "loiter", gossip], [j(15), j(17.25), "stroll", chance(0.5) ? "park" : "walk"]]),
        };
      }
      // the children play in the court from morning to supper; the little ones are kept in
      const kids = int(0, 2) + (chance(0.25) ? 1 : 0);
      // (and in the street before their own door: the little ones are kept near the house)
      let door: string = play;
      if (kids) {
        const q = roomNear(home.sx + d.out[0] * 1.8, home.sz + d.out[1] * 1.8, 1.2, 4);
        if (q) door = place(`play:bkh${hh}`, "the street before their door", q[0], q[1], 5);
      }
      for (let c = 0; c < kids; c++) {
        const age = int(4, 13);
        const sex = chance(0.5) ? "m" : "f";
        add({ trade: "child", kind: age < 6 && chance(0.5) ? (sex === "m" ? "boy" : "girl") : sex === "m" ? pick(["boy", "urchin"]) : pick(["girl", "girl_b"]), sex, age, home, hh, role: sex === "m" ? "son" : "daughter", surname, work: { place: play, kind: "roam" }, sched: {
          day: [[j(8), j(10), "play", door], [j(10), 12, "play", play], [j(12.75), j(15), "play", play], [j(15), j(18.5), "play", door]],
          sunday: [...(chance(0.5) ? [[j(8.75), j(10), "church", church] as Seg] : []), [j(10.5), j(12.25), "play", door], [j(13.25), j(15.5), "play", play], [j(15.5), j(18.25), "play", door]],
        } });
      }
      // a lad of the house: out of work, with his mates at the corner (menacing, not a fighter by day)
      if (corner && chance(0.65)) {
        join(corner);
        const age = int(16, 21);
        const lad = add({ trade: "loafer", kind: pick(["docker_a", "docker_c", "docker_c", "thief"]), sex: "m", age, home, hh, role: "son", surname, work: { place: corner, kind: "roam", route: [[all(corner).x, all(corner).z]] }, sched: {
          day: [[j(10), j(12.5), "loiter", corner], [j(12.5), j(13.5), "home"], ...(lanes ? [[j(13.5), j(15), "stroll", lanes] as Seg] : []), [j(15), j(18.75), "loiter", corner], [j(19.25), j(23.5, 0.5), "loiter", corner]],
          sunday: [[j(11), j(14), "loiter", corner], [j(14.75), j(23.5, 0.5), "loiter", corner]],
        } });
        lad.stats.courage = Math.max(lad.stats.courage, 6);
      }
      // the old one of the house: grandfather on a chair by the door and at cards; grandmother at her door
      if (chance(0.55)) {
        const old = int(60, 79);
        if (chance(0.6)) {
          join(cards);
          const step = `step:${hh}`;
          place(step, "a chair by the door", home.sx, home.sz, 1.5, { door: [home.sx, home.sz], out: d.out });
          // (not the "old_man" figure: his stick is in his hand and swings across him when he sits or talks)
          const pa = add({ trade: "retired", kind: pick(["ragman", "beggar", "docker_b"]), sex: "m", age: old, home, hh, role: "father", surname, work: { place: step, kind: "roam" }, sched: {
            day: [[j(8.5), j(11), "loiter", step], ...(lanes ? [[j(11), j(11.75), "stroll", lanes] as Seg] : []), [j(12.75), j(14), "loiter", step], ...(cards ? [[j(14), j(18), "loiter", cards] as Seg] : [[j(14), j(17.5), "loiter", step] as Seg]), ...(kroeg && chance(0.5) ? [[j(19), j(21), "tavern", kroeg] as Seg] : [])],
            sunday: [...(chance(0.6) ? [[j(8.75), j(10), "church", church] as Seg] : []), [j(10.5), j(13.75), "loiter", step], ...(cards ? [[j(14), j(18), "loiter", cards] as Seg] : [])],
          } });
          pa.stats.gossip = Math.max(pa.stats.gossip, 5);
        } else {
          // (door life gives her the knitting or the lace at her door: doorlife.ts, a retired woman at home)
          join(gossip);
          add({ trade: "retired", kind: "old_woman", sex: "f", age: old, home, hh, role: "mother", surname, work: { place: "home", kind: "inside", door: [home.sx, home.sz] }, sched: {
            day: [[j(10.5), j(11.75), "loiter", gossip], ...(lanes ? [[j(14), j(15.25), "stroll", lanes] as Seg] : []), [j(16.25), j(17.5), "loiter", gossip]],
            sunday: [[j(8.75), j(10), "church", church], [j(10.5), j(13.25), "loiter", gossip]],
          } });
        }
      }
    }
  }

  // ---- the better streets: a clerk's household in a wide street
  const middleDoors = doors.filter((d) => !inBack(d.sx, d.sz) && d.sz > 50);
  const nBetter = Math.round(10 * scale);
  const better = backDoors.filter((d) => !d.alley && d.storeys >= 3 && across(d) >= 7).sort((a, b) => a.house - b.house);
  for (let i = 0; i < nBetter && better.length; i++) {
    const cand = better[Math.floor(rng() * better.length)];
    const d = freeDoorNear(cand.sx, cand.sz, 30, (q) => !q.alley && q.storeys >= 3);
    if (!d) continue;
    const home = homeAt(d);
    const hp: Pt = [home.sx, home.sz];
    const hh = ++household;
    const surname = surnameFree();
    const office = pick(middleDoors);
    const church = nearestChurch(hp);
    const market = nearestKey(markets, hp);
    const clerkAge = int(30, 58);
    add({ trade: "clerk", kind: "clerk", sex: "m", age: clerkAge, home, hh, role: "head", surname, work: { place: "grote_markt", kind: "inside", door: [office.sx, office.sz] }, sched: {
      // to the office, home to dinner at noon (the town's way), back, home at six
      day: [[j(7.75), j(12), "work"], [j(12), j(13), "home"], [j(13.25), j(18), "work"], ...(chance(0.4) ? [[j(19.5), j(20.75), "stroll", "park"] as Seg] : [])],
      sunday: [[j(8.75), j(10.25), "church", church], [j(14.5), j(17), "stroll", chance(0.5) ? "walk" : "park"]],
    } });
    const wife = add({ trade: "housewife", kind: pick(["wife_a", "shopwife"]), sex: "f", age: Math.max(24, clerkAge - int(0, 10)), home, hh, role: "wife", surname, work: { place: "home", kind: "inside", door: [home.sx, home.sz] }, sched: {
      day: [[j(10), j(11.5), "market", market], [j(15), j(16.75), "stroll", "park"]],
      sunday: [[j(8.75), j(10.25), "church", church], [j(14.5), j(17), "stroll", "walk"]],
    } });
    wife.stats.wealth = Math.max(wife.stats.wealth, 3);
    // the maid: the step in the morning (door life), the errands, a Sunday afternoon of her own
    add({ trade: "maid", kind: "maid", sex: "f", age: int(16, 30), home, hh, role: "servant", surname: surnameFree(), work: { place: "home", kind: "inside", door: [home.sx, home.sz] }, sched: {
      day: [[j(6.5), 9, "work"], [9, j(10.5), "market", market], [10.5, j(19.5), "work"]],
      sunday: [[j(7.25), j(8.5), "church", church], [j(15), j(17.5), "stroll", "park"]],
    } });
    const kids = int(0, 2);
    for (let c = 0; c < kids; c++) {
      const age = int(5, 12);
      const sex = chance(0.5) ? "m" : "f";
      add({ trade: "child", kind: sex === "m" ? "boy" : pick(["girl", "girl_b"]), sex, age, home, hh, role: sex === "m" ? "son" : "daughter", surname, work: { place: "park", kind: "roam" }, sched: {
        day: [[j(14), j(17), "play", "park"]],
        sunday: [[j(8.75), j(10.25), "church", church], [j(14.5), j(17), "stroll", "walk"]],
      } });
    }
  }

  // ---- the parish priests of the back's churches, on their round of the sick
  const roundOf = (at: Pt, n: number, reach: number): { route: Pt[]; faces: number[] } => {
    const route: Pt[] = [];
    const faces: number[] = [];
    const cands = backDoors.filter((d) => D([d.sx, d.sz], at) < reach).sort((a, b) => a.house - b.house);
    for (let t = 0; t < n * 4 && route.length < n && cands.length; t++) {
      const d = cands[Math.floor(rng() * cands.length)];
      const side = chance(0.5) ? 1 : -1;
      const x = r1(d.sx + d.out[0] * 0.6 - d.out[1] * side * 1.3);
      const z = r1(d.sz + d.out[1] * 0.6 + d.out[0] * side * 1.3);
      if (!standable(x, z, 0.4) || route.some((q) => D(q, [x, z]) < 12)) continue;
      route.push([x, z]);
      faces.push(Math.round(Math.atan2(d.x - x, d.z - z) * 1000) / 1000);
    }
    // walking order: nearest first
    const order: number[] = [];
    let cur = at;
    const left = route.map((_, i) => i);
    while (left.length) {
      let bi = 0;
      for (let q = 1; q < left.length; q++) if (D(route[left[q]], cur) < D(route[left[bi]], cur)) bi = q;
      const [i] = left.splice(bi, 1);
      order.push(i);
      cur = route[i];
    }
    return { route: order.map((i) => route[i]), faces: order.map((i) => faces[i]) };
  };
  for (const c of CHURCHES.slice(0, 2)) {
    const cp = churchPlace[c.id];
    if (!cp) continue;
    const door = all(cp.id);
    const d = freeDoorNear(door.x, door.z, 50, (q) => !q.alley) ?? freeDoorNear(door.x, door.z, 90);
    if (!d) continue;
    const rd = roundOf([door.x, door.z], 7, 110);
    const rid = place(`visits:${c.id}`, `the sick of the parish of ${c.label}`, rd.route[0]?.[0] ?? door.x, rd.route[0]?.[1] ?? door.z, 110);
    const p = add({ trade: "parish_priest", kind: "priest", sex: "m", age: int(42, 68), home: homeAt(d), hh: ++household, role: "single", surname: surnameFree(), work: { place: rid, kind: "round", route: rd.route, faces: rd.faces }, sched: {
      // (his own masses and vespers are inside: the church's door, then the round of the sick)
      day: [[j(7, 0), j(8.25), "church", cp.id], [j(9.5), 12, "work"], [j(14.5), j(16.75), "work"], [j(17, 0), j(18, 0), "church", cp.id]],
      sunday: [[6.5, 12.5, "church", cp.id], [j(15, 0), j(16.5, 0), "church", cp.id]],
    } });
    p.stats.piety = Math.max(p.stats.piety, 8);
    p.name = `Father ${p.surname}`;
  }
  // ---- a second knife grinder and a second rag-and-bone man, for the far lanes (the lively streets' own
  // rounds keep to the old town): the same trades, rounds and cries (lively.ts buildRound, game/lively.ts)
  {
    const usedRound = new Set<number>();
    const usedStops: Pt[] = residents.flatMap((r) => (r.work.kind === "round" ? (r.work.route ?? []) : []));
    const sellers: Array<{ key: string; trade: TradeId; kind: string; at: Pt; label: string; room: number }> = [
      { key: "grinder", trade: "grinder", kind: "grinder", at: [70, 262], label: "the lanes toward the Sint-Pauluskerk", room: 0.5 },
      { key: "ragman", trade: "ragman", kind: "ragman", at: [-255, 290], label: "the lanes by the Stadspark", room: 1.1 },
    ];
    for (const sp of sellers) {
      const d = freeDoorNear(sp.at[0], sp.at[1], 90, (q) => !!q.alley) ?? freeDoorNear(sp.at[0], sp.at[1], 140);
      if (!d) continue;
      const rd = buildRound(sp.at, 95, 9, [d.sx, d.sz], rng, usedRound, sp.room, usedStops);
      if (rd.route.length < 3) continue;
      for (const hs of rd.houses) usedRound.add(hs);
      usedStops.push(...rd.route);
      const pid = place(`visits:${sp.key}`, sp.label, rd.route[0][0], rd.route[0][1], 95);
      const kroeg = kroegNear([d.sx, d.sz]);
      const r = add({ trade: sp.trade, kind: sp.kind, sex: "m", age: int(38, 68), home: homeAt(d), hh: ++household, role: "head", surname: surnameFree(), work: { place: pid, kind: "round", route: rd.route, faces: rd.faces }, sched: {
        day: [[j(8.75), 12, "work"], [j(13.25), j(16.75), "work"], ...(kroeg ? [[j(18.5), j(21), "tavern", kroeg] as Seg] : [])],
        sunday: [...(kroeg ? [[j(15), j(19), "tavern", kroeg] as Seg] : [])],
      } });
      r.stats.gossip = Math.max(r.stats.gossip, 5);
    }
  }
  // ---- the doctor, on his round of the patients of the back
  {
    const at: Pt = [-40, 250];
    const d = freeDoorNear(at[0], at[1], 120, (q) => !q.alley && q.storeys >= 3);
    if (d) {
      const rd = roundOf([d.sx, d.sz], 8, 170);
      const rid = place("visits:doctor", "his patients in the back streets", rd.route[0]?.[0] ?? d.sx, rd.route[0]?.[1] ?? d.sz, 170);
      const doc = add({ trade: "doctor", kind: "gentleman", sex: "m", age: int(40, 62), home: homeAt(d), hh: ++household, role: "head", surname: surnameFree(), work: { place: rid, kind: "round", route: rd.route, faces: rd.faces }, sched: {
        day: [[j(9), 12, "work"], [j(14), j(17), "work"]],
        sunday: [[j(8.75), j(10.25), "church", nearestChurch([d.sx, d.sz])], [j(15), j(16.5), "work"]],
      } });
      doc.name = `Doctor ${doc.surname}`;
    }
  }
  // ---- beggars at the church doors of the back
  for (const c of CHURCHES) {
    const cp = churchPlace[c.id];
    if (!cp) continue;
    const door = all(cp.id);
    const at = roomNear(door.x + Math.cos(cp.face) * 2.6, door.z - Math.sin(cp.face) * 2.6, 0.5, 3);
    if (!at) continue;
    const d = freeDoorNear(door.x, door.z, 160, (q) => !!q.alley) ?? freeDoorNear(door.x, door.z, 200);
    if (!d) continue;
    const female = chance(0.5);
    add({ trade: "beggar", kind: female ? "old_woman" : "beggar", sex: female ? "f" : "m", age: int(46, 78), home: homeAt(d), hh: ++household, role: female ? "widow" : "single", surname: surnameFree(), work: { place: cp.id, kind: "beg", at: [at[0], at[1], cp.face + Math.PI] }, sched: {
      day: [[j(7.5), 12, "work"], [j(12.75), j(18.5), "work"]],
      sunday: [[6.5, 13, "work"], [14, j(18), "work"]],
    } });
  }
  // ---- the night watch: rounds of the back streets from 21:00 to 5:00, a lantern and the hour called at each corner
  const nWatch = Math.max(2, Math.round(3 * scale));
  const cornerPts = hubs.filter((h) => h.corner).map((h) => [all(h.corner!).x, all(h.corner!).z] as Pt).sort((a, b) => a[0] - b[0]);
  for (let w = 0; w < nWatch && cornerPts.length >= 3; w++) {
    const band = cornerPts.filter((_, i) => Math.floor((i / cornerPts.length) * nWatch) === w);
    if (band.length < 2) continue;
    const c0 = band[0];
    const d = freeDoorNear(c0[0], c0[1], 80, (q) => !!q.alley) ?? freeDoorNear(c0[0], c0[1], 140);
    if (!d) continue;
    // the corners of his band in walking order, with a step off each (not in the lads' ring)
    const route = band.map(([x, z]) => roomNear(x + 2.5, z + 2.5, 0.5, 4) ?? ([x, z] as Pt));
    const wid = place(`watch:${w}`, "the night round of the back streets", route[0][0], route[0][1], 80);
    add({ trade: "watchman", kind: pick(["docker_b", "docker_c"]), sex: "m", age: int(40, 64), home: homeAt(d), hh: ++household, role: "head", surname: surnameFree(), work: { place: wid, kind: "patrol", route }, sched: {
      day: [[21, 29, "work"]],
      sunday: [[21, 29, "work"]],
    } });
  }
  // ---- lovers: a lad and a girl of two households, by the pond on a fine evening and on Sunday afternoon
  const girls = out.filter((r) => r.sex === "f" && r.age >= 16 && r.age <= 24 && (r.trade === "maid" || r.trade === "washerwoman" || r.trade === "seamstress"));
  const lads = out.filter((r) => r.sex === "m" && r.age >= 17 && r.age <= 26 && r.trade !== "drunkard" && r.trade !== "loafer");
  const extraLads = lads.length < lovers.length ? out.filter((r) => r.trade === "loafer") : [];
  for (let i = 0; i < lovers.length; i++) {
    const g = girls[i];
    const b = lads[i] ?? extraLads[i];
    if (!g || !b || g.household === b.household) continue;
    const spot = lovers[i];
    const eve: Seg = [j(19.5), j(21.25), "loiter", spot];
    const sun: Seg = [j(15.5), j(17.5), "loiter", spot];
    for (const r of [g, b]) {
      // their own evening and Sunday afternoon are given up for it (the rest of their day stays)
      r.sched = {
        day: tidy([...r.sched.day.filter(([a, e]) => e <= eve[0] || a >= eve[1]), eve]),
        sunday: tidy([...r.sched.sunday.filter(([a, e]) => e <= sun[0] || a >= sun[1]), sun]),
      };
      r.mate = r === g ? b.id : g.id;
    }
  }
  return { residents: out, places: outPlaces };
}

// ------------------------------------------------------------------ the save

/**
 * Give a save the back of town's people (once): the same people a new game with this town's seed
 * would have, added after the last resident, and their places. Adds rows only (npc,
 * npc_relationship, resident); every other resident, memory, relationship and Jef stay as they were.
 * Returns how many were added.
 */
export function ensureBackTown(db: DB): number {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return 0;
  if ((db.prepare("SELECT COUNT(*) AS n FROM resident WHERE id LIKE 'bk%'").get() as { n: number }).n > 0) return 0;
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
  if (!row) return 0;
  const rest = JSON.parse(row.value_json) as Omit<Town, "residents">;
  const residents = town(db).town.residents;
  const homes = db.prepare("SELECT value_json FROM world_state WHERE key = 'homes'").get() as { value_json: string } | undefined;
  const kept = homes ? ((JSON.parse(homes.value_json) as { homes?: Array<{ house: number }> }).homes?.map((h) => h.house) ?? []) : [];
  const g = generateBackTown(rest.seed, rest.places, residents, kept);
  const insNpc = db.prepare("INSERT OR IGNORE INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  let added = 0;
  db.transaction(() => {
    const places = { ...rest.places, ...g.places };
    for (const r of g.residents) {
      if (hasNpc.get(r.id)) continue;
      const district = places[r.work.place]?.district ?? "town";
      insNpc.run(r.id, r.name, shownTrade(r), district, r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
      added++;
    }
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places }));
  })();
  dropTownCache(db);
  return added;
}

/** What a back-of-town person is doing now, in words (town/talk.ts). */
export function backDoing(r: Resident, place: string): string | null {
  const k = backKind(place);
  switch (k) {
    case "pump":
      return "washing linen for the better houses at the court pump, with the other women";
    case "corner":
      return "hanging about the street corner with your mates, watching who goes by";
    case "cards":
      return "playing cards on a doorstep with the other old men";
    case "gossip":
      return "standing at a neighbour's door, talking";
    case "knot":
      return "standing at the corner with the other men who were not taken on at the gates today";
    case "lanes":
      return "going about your errands in the lanes round your house";
    case "step":
      return "sitting on a chair by your door, watching the street";
    case "lovers":
      return "walking out with your sweetheart by the pond in the park";
    case "park":
      return "taking a turn in the Stadspark";
    case "walk":
      return "walking on the ramparts, as the town does on a Sunday";
    case "watch":
      return "on the night round of the back streets with your lantern, calling the hour";
    case "drunk":
      return "wandering the back streets with drink in you";
    default:
      if (r.trade === "parish_priest") return "on your round of the sick of the parish";
      if (r.trade === "doctor") return "on your round of the patients in the back streets";
      return null;
  }
}
