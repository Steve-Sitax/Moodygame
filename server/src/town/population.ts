// The residents of Scheldemist (M3e). Made once per new game by the ENGINE,
// never by a model: names, ages, families, homes (real house doors), trades,
// workplaces, daily schedules, stats and looks, all from one seeded random
// stream, so a seed always gives the same town.

import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import {
  HAUNTS,
  HAULS,
  MARKETS,
  PATROLS,
  PLACES,
  PLAY,
  SHOPS,
  STALLS,
  STATS,
  TAVERNS,
  TOWN_EMPLOYERS,
  TRADES,
  type Stat,
  type TradeId,
  type WorkKind,
} from "./places.ts";
import type { Schedule, Seg } from "./schedule.ts";
import { generateGarrison } from "./garrison.ts";
import { TOWN_SIZES, type TownSize } from "../config.ts";
import SPOTS from "../../../shared/spots.json" with { type: "json" };
import CITY from "../../../shared/city.json" with { type: "json" };

export type Pt = [number, number];

export interface WorkSpec {
  /** Workplace id (PLACES), shop id, tavern id, or "home" for work done at home. */
  place: string;
  kind: WorkKind;
  /** Where to stand and which way to face (x, z, yaw), for stall, shop, tavern, post, beg. */
  at?: [number, number, number];
  /** Haul: the quay end and the door end. */
  a?: Pt;
  b?: Pt;
  /** Patrol and roam: the points of the round (soldiers: their walking-out round; customs: the landings of goods). */
  route?: Pt[];
  /** Inspect (customs): which way to face at each point of the route (yaw, facing (sin, cos)). */
  faces?: number[];
  /** Inside: the door to go in at (a step outside it). */
  door?: Pt;
  /** Stall index in the town's stall list, or the shop id. */
  stall?: number;
  shop?: string;
  /** Wait (M6 emigrants): sit at `at` (on the family's chest), else stand there. */
  seat?: boolean;
}

export interface Stats {
  honesty: number;
  temper: number;
  piety: number;
  warmth: number;
  greed: number;
  courage: number;
  gossip: number;
  wealth: number;
}

export interface Home {
  house: number;
  /** The door, and the step in front of it. */
  x: number;
  z: number;
  sx: number;
  sz: number;
}

export interface Resident {
  id: string;
  first: string;
  surname: string;
  name: string;
  age: number;
  sex: "m" | "f";
  household: number;
  /** head, wife, husband, son, daughter, widow, widower, lodger, single */
  family_role: string;
  trade: TradeId;
  faction: string | null;
  kind: string;
  home: Home;
  work: WorkSpec;
  sched: Schedule;
  stats: Stats;
  dog: { name: string; look: string } | null;
  /** The garrison (garrison.ts): the comrade he walks out or stands guard with. */
  mate?: string;
  /** The garrison and the customs: the town or village he comes from. */
  origin?: string;
  /** M6 emigrants (emigrants.ts): the family's number in the arrivals; the story is on the family. */
  emigrant?: number;
}

export interface TownPlace {
  label: string;
  x: number;
  z: number;
  r: number;
  district: string;
  /** A door (shops and taverns): the step to stand on. */
  door?: Pt;
  out?: Pt;
}

export interface Stall {
  place: string;
  x: number;
  z: number;
  face: Pt;
  goods: string;
  keeper: string | null;
}

export interface ShopFront {
  id: string;
  label: string;
  door: Pt;
  wall: Pt;
  out: Pt;
  goods: string | null;
  keeper: string;
}

export interface Town {
  seed: number;
  /** M6 population: the size it was made at (Settings, for a new game); older towns have none (normal). */
  size?: TownSize;
  places: Record<string, TownPlace>;
  stalls: Stall[];
  shops: ShopFront[];
  residents: Resident[];
}

// ------------------------------------------------------------------ random

export function rngFrom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ names (plain Flemish names of the time)

const MEN = [
  "Jan", "Pieter", "Frans", "Karel", "Hendrik", "Louis", "Constant", "Camille", "August", "Victor", "Emiel", "Theofiel",
  "Alfons", "Leon", "Gustaaf", "Cornelis", "Willem", "Remi", "Jules", "Florent", "Achiel", "Petrus", "Jozef", "Rik",
  "Staf", "Lowie", "Toon", "Fons", "Lode", "Ward", "Dries", "Bernard", "Edward", "Hubert", "Ferdinand", "Adriaan",
];
const WOMEN = [
  "Maria", "Anna", "Rosalie", "Josephine", "Elisabeth", "Joanna", "Catharina", "Theresia", "Paulina", "Ludovica", "Coleta",
  "Barbara", "Mathilde", "Clementina", "Octavie", "Sidonie", "Leonie", "Virginie", "Melanie", "Hortense", "Eugenie",
  "Stephanie", "Trien", "Mie", "Stans", "Lisa", "Betje", "Nette", "Rosa", "Julie", "Marie", "Irma", "Lucie", "Emma",
];
const SURNAMES = [
  "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens", "Wouters", "De Smet", "Van den Bergh",
  "Hermans", "Aerts", "Vermeulen", "Verstraeten", "Michiels", "Smets", "Hendrickx", "Verhoeven", "Dierckx", "Geerts",
  "Van Hove", "Mols", "Segers", "Thys", "Lenaerts", "De Wilde", "Nuyts", "Bogaerts", "Stevens", "Van Gorp", "Wuyts",
  "Luyten", "De Backer", "Van Roey", "Verbruggen", "Somers", "Pauwels", "Lambrechts", "Heylen", "Van Loock", "Sels",
  "Vermeiren", "De Groof", "Van Dessel", "Cuypers", "Joris", "Nijs", "Coppens", "Van Hoof", "De Bock",
];
/** Names the game already uses for its own people: residents do not get them. */
const TAKEN = new Set(["Jef", "Sooi", "Tuur", "Fientje", "Peeters", "Cools", "Verhulst", "Leentje", "Van Dyck"]);
const DOGS = ["Bello", "Fik", "Moor", "Rakker", "Nero", "Tom", "Keeske", "Sultan", "Turk", "Castor", "Mira", "Blek", "Wolf", "Lou"];
const DOG_LOOKS = ["dog_brown", "dog_black", "dog_spotted", "dog_grey"];

// ------------------------------------------------------------------ the generator

export const POPULATION_TARGET = 190;
/**
 * M6 population: house doors the generator leaves free in a big town, for the people other
 * parts add in place (the post, rooms to let, the visitors' lodging, the Logement...). Once
 * only this many are left, a new household shares a house with one near it (a tenement:
 * families on each floor, as in the working streets of 1873).
 */
export const DOORS_KEPT_FREE = 90;

interface Job {
  trade: TradeId;
  place: string;
}

/**
 * Adult jobs the town needs, with where they are done. Order is the order of housing.
 * M6 population: `scale` grows or shrinks the town's work with its size (1 = the town as it
 * was, to the job). The one priest and the lamplighter stay one; the police never fall below
 * the four the quays need.
 */
function jobList(scale = 1): Job[] {
  const k2 = (k: number, min = 1) => (scale === 1 ? k : Math.max(min, Math.round(k * scale)));
  const n = (trade: TradeId, place: string, k: number, fixed = false): Job[] => Array.from({ length: fixed ? k : k2(k) }, () => ({ trade, place }));
  if (scale !== 1) {
    // police: at least the four of today, more for a bigger town
    const police = Math.max(4, Math.round(4 * scale));
    const beat = ["quays", "town", "quays", "werf"];
    return [
      ...n("docker", "rijnkaai", 7), ...n("docker", "werf", 4), ...n("docker", "bassin", 4), ...n("docker", "bassin_south", 2),
      ...n("natie", "hessenatie", 5), ...n("natie", "entrepot", 6),
      ...n("porter", "rijnkaai", 2), ...n("porter", "werf", 1),
      ...n("carter", "rijnkaai", 1), ...n("carter", "grote_markt", 1), ...n("carter", "canal", 1),
      ...n("boatman", "werf", 2), ...n("boatman", "vismarkt", 2), ...n("boatman", "canal", 2),
      ...n("sailor", "rijnkaai", 3), ...n("sailor", "bassin", 2), ...n("sailor", "werf", 2),
      ...Array.from({ length: police }, (_, i) => ({ trade: "police" as TradeId, place: beat[i % beat.length] })),
      ...n("priest", "cathedral", 1, true), ...n("lamplighter", "lamps", 1, true),
      ...n("beggar", "cathedral", 1), ...n("beggar", "steenplein", 1), ...n("beggar", "canal", 1),
      ...n("thief", "night", 5),
      ...n("clerk", "entrepot", 1), ...n("clerk", "town_hall", 2), ...n("merchant", "grote_markt", 2),
      ...n("retired", "home", 4),
      ...n("fishwife", "vismarkt", 6), ...n("market_woman", "grote_markt", 6),
      ...n("maid", "grote_markt", 4), ...n("laundress", "canal", 3), ...n("seamstress", "home", 2),
    ];
  }
  return [
    ...n("docker", "rijnkaai", 7), ...n("docker", "werf", 4), ...n("docker", "bassin", 4), ...n("docker", "bassin_south", 2),
    ...n("natie", "hessenatie", 5), ...n("natie", "entrepot", 6),
    ...n("porter", "rijnkaai", 2), ...n("porter", "werf", 1),
    ...n("carter", "rijnkaai", 1), ...n("carter", "grote_markt", 1), ...n("carter", "canal", 1),
    ...n("boatman", "werf", 2), ...n("boatman", "vismarkt", 2), ...n("boatman", "canal", 2),
    ...n("sailor", "rijnkaai", 3), ...n("sailor", "bassin", 2), ...n("sailor", "werf", 2),
    ...n("police", "quays", 2), ...n("police", "town", 1), ...n("police", "werf", 1),
    ...n("priest", "cathedral", 1), ...n("lamplighter", "lamps", 1),
    ...n("beggar", "cathedral", 1), ...n("beggar", "steenplein", 1), ...n("beggar", "canal", 1),
    ...n("thief", "night", 5),
    ...n("clerk", "entrepot", 1), ...n("clerk", "town_hall", 2), ...n("merchant", "grote_markt", 2),
    ...n("retired", "home", 4),
    ...n("fishwife", "vismarkt", 6), ...n("market_woman", "grote_markt", 6),
    ...n("maid", "grote_markt", 4), ...n("laundress", "canal", 3), ...n("seamstress", "home", 2),
  ];
}

const FEMALE_TRADES = new Set<TradeId>(["fishwife", "market_woman", "maid", "laundress", "seamstress", "housewife", "shopwife"]);

/** Which people.glb model a resident wears. */
function kindFor(trade: TradeId, sex: "m" | "f", age: number, rng: () => number): string {
  const pick = <T>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
  if (age < 12) return sex === "m" ? (trade === "street_child" ? "urchin" : "boy") : pick(["girl", "girl_b"]);
  if (age < 15) return sex === "m" ? (trade === "street_child" ? "urchin" : "boy") : pick(["girl", "girl_b"]);
  const old = age >= 60;
  if (sex === "f") {
    if (trade === "fishwife") return pick(["fishwife_a", "fishwife_b"]);
    if (trade === "maid") return "maid";
    if (trade === "shopwife" || trade === "fish_merchant") return "shopwife";
    if (trade === "thief") return "wife_b";
    if (old) return "old_woman";
    if (trade === "market_woman") return pick(["wife_a", "wife_b", "fishwife_b"]);
    return pick(["wife_a", "wife_b"]);
  }
  switch (trade) {
    case "docker":
      return pick(["docker_a", "docker_b", "docker_c", "docker_sack"]);
    case "natie":
      return pick(["docker_a", "docker_b", "docker_c", "docker_sack"]);
    case "porter":
      return "porter";
    case "carter":
      return "carter";
    case "boatman":
    case "sailor":
      return "sailor_b";
    case "baker":
      return "baker";
    case "grocer":
    case "chandler":
    case "tobacconist":
    case "cobbler":
    case "draper":
      return "shopkeeper";
    case "pawnbroker":
      return "clerk";
    case "publican":
    case "brewer":
      return "publican";
    case "clerk":
      return "clerk";
    case "merchant":
      return "gentleman";
    case "police":
    case "water_bailiff":
      return "police";
    case "priest":
      return "priest";
    case "sexton":
      return "old_man";
    case "foreman":
      return "foreman";
    case "beggar":
      return "beggar";
    case "thief":
      return "thief";
    case "lamplighter":
      return "docker_c";
    case "retired":
      return "old_man";
    default:
      return old ? "old_man" : pick(["docker_a", "docker_b", "docker_c"]);
  }
}

export function generateTown(seed: number, size: TownSize = "normal"): Town {
  let rng = rngFrom(seed);
  const target = TOWN_SIZES[size]?.target ?? POPULATION_TARGET;
  const scale = size === "normal" ? 1 : target / POPULATION_TARGET;
  const rnd = (a: number, b: number) => a + rng() * (b - a);
  const int = (a: number, b: number) => Math.floor(rnd(a, b + 1));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rng() * xs.length)];
  const chance = (p: number) => rng() < p;
  const wm = walkMap();
  const snap = (x: number, z: number): Pt => {
    const q = wm.nearestOpen(x, z, 8) ?? { x, z };
    return [q.x, q.z];
  };
  const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // --- places
  const places: Record<string, TownPlace> = {};
  for (const p of PLACES) {
    const [x, z] = snap(p.x, p.z);
    places[p.id] = { label: p.label, x, z, r: p.r, district: p.district };
  }
  const spots = SPOTS as unknown as Record<string, { x: number; z: number; label: string }>;
  const free: HouseDoor[] = houseDoors().slice();
  const used = new Set<number>();
  const takeDoorNear = (x: number, z: number, maxD: number, spread = 1): HouseDoor | null => {
    // a big town keeps doors free for what is added later; the town as it was never gets near this
    if (scale > 1 && free.length - used.size <= DOORS_KEPT_FREE) return null;
    const near = free
      .filter((d) => !used.has(d.house))
      .map((d) => ({ d, k: Math.hypot(d.sx - x, d.sz - z) }))
      .filter((o) => o.k <= maxD)
      .sort((a, b) => a.k - b.k)
      .slice(0, spread);
    if (!near.length) return null;
    const d = pick(near).d;
    used.add(d.house);
    return d;
  };
  const shops: ShopFront[] = [];
  const shopDoor: Record<string, HouseDoor> = {};
  /** Shops and taverns: nobody else moves in above them. */
  const shopHouses = new Set<number>();
  for (const s of SHOPS) {
    const d = takeDoorNear(s.x, s.z, 35);
    if (!d) continue;
    shopDoor[s.id] = d;
    shopHouses.add(d.house);
    places[s.id] = { label: s.label, x: d.sx, z: d.sz, r: 3, district: "town", door: [d.sx, d.sz], out: d.out };
  }
  for (const t of TAVERNS) {
    const d = takeDoorNear(t.x, t.z, 35);
    if (!d) continue;
    places[`tavern:${t.id}`] = { label: t.label, x: d.sx, z: d.sz, r: 4, district: "town", door: [d.sx, d.sz], out: d.out };
  }
  for (const id of PLAY) places[`play:${id}`] = { ...places[id] };
  for (const id of MARKETS) places[`market:${id}`] = { ...places[id] };
  places.church = { label: "the cathedral", x: spots.cathedral_door.x, z: spots.cathedral_door.z, r: 3, district: "grote-markt" };
  const stalls: Stall[] = STALLS.map((s) => {
    const [x, z] = snap(s.x, s.z);
    return { place: s.place, x, z, face: s.face, goods: s.goods, keeper: null };
  });
  const taverns = Object.keys(places).filter((k) => k.startsWith("tavern:"));
  const nearest = (keys: string[], p: Pt) => keys.reduce((best, k) => (dist([places[k].x, places[k].z], p) < dist([places[best].x, places[best].z], p) ? k : best), keys[0]);
  const lamps = ((CITY as unknown as { decor?: { lamps?: Pt[] } }).decor?.lamps ?? []).map(([x, z]) => snap(x, z + 1.2));

  // --- people
  const residents: Resident[] = [];
  const usedNames = new Set<string>();
  let household = 0;
  let nextId = 1;

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
  const nameFor = (sex: "m" | "f", surname: string): string => {
    for (let i = 0; i < 40; i++) {
      const first = pick(sex === "m" ? MEN : WOMEN);
      if (TAKEN.has(first)) continue;
      const full = `${first} ${surname}`;
      if (!usedNames.has(full)) {
        usedNames.add(full);
        return first;
      }
    }
    return pick(sex === "m" ? MEN : WOMEN);
  };
  const surnameFree = () => {
    for (let i = 0; i < 20; i++) {
      const s = pick(SURNAMES);
      if (!TAKEN.has(s)) return s;
    }
    return pick(SURNAMES);
  };

  const makeHome = (d: HouseDoor): Home => ({ house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz });
  /** A big town with few doors left: a household moves into a house near here that already has one (at most three a house). */
  const shareHouse = (x: number, z: number): Home | null => {
    const per = new Map<number, { home: Home; hh: Set<number> }>();
    for (const r of residents) {
      if (r.home.house < 0 || shopHouses.has(r.home.house)) continue;
      const e = per.get(r.home.house) ?? { home: r.home, hh: new Set<number>() };
      e.hh.add(r.household);
      per.set(r.home.house, e);
    }
    let best: Home | null = null;
    let bestD = Infinity;
    for (const e of per.values()) {
      if (e.hh.size >= 3) continue;
      const d = Math.hypot(e.home.sx - x, e.home.sz - z) + e.hh.size * 25;
      if (d < bestD) {
        bestD = d;
        best = e.home;
      }
    }
    return best ? { ...best } : null;
  };

  const add = (
    p: { id?: string; sex: "m" | "f"; age: number; trade: TradeId; role: string; surname: string; home: Home; work: WorkSpec; hh: number },
  ): Resident => {
    const first = nameFor(p.sex, p.surname);
    const r: Resident = {
      id: p.id ?? `r${String(nextId++).padStart(3, "0")}`,
      first,
      surname: p.surname,
      name: `${first} ${p.surname}`,
      age: p.age,
      sex: p.sex,
      household: p.hh,
      family_role: p.role,
      trade: p.trade,
      faction: TRADES[p.trade].faction,
      kind: kindFor(p.trade, p.sex, p.age, rng),
      home: p.home,
      work: p.work,
      sched: { day: [], sunday: [] },
      stats: statsFor(p.trade, p.age),
      dog: null,
    };
    residents.push(r);
    return r;
  };

  // work specs ---------------------------------------------------------------
  const face = (from: Pt, to: Pt) => Math.atan2(to[0] - from[0], to[1] - from[1]);
  const workSpec = (trade: TradeId, place: string, home: Home): WorkSpec => {
    const kind = TRADES[trade].work;
    const pl = places[place];
    switch (kind) {
      case "haul": {
        const routes = HAULS[place] ?? HAULS.rijnkaai;
        const r = pick(routes);
        return { place, kind, a: snap(...r.a), b: snap(...r.b) };
      }
      case "patrol": {
        if (place === "lamps") return { place: "lamps", kind, route: lamps.slice() };
        return { place, kind, route: (PATROLS[place] ?? PATROLS.quays).map(([x, z]) => snap(x, z)) };
      }
      case "roam": {
        if (trade === "thief") return { place: "night", kind, route: shuffle(HAUNTS.map(([x, z]) => snap(x, z))).slice(0, 4) };
        const c = pl ?? places.rijnkaai;
        const pts: Pt[] = [];
        for (let i = 0; i < 12 && pts.length < 4; i++) {
          const a = rng() * Math.PI * 2;
          const q = wm.nearestOpen(c.x + Math.cos(a) * c.r * 0.7, c.z + Math.sin(a) * c.r * 0.7, 6);
          if (q) pts.push([q.x, q.z]);
        }
        if (!pts.length) pts.push([c.x, c.z]);
        return { place: place in places ? place : "rijnkaai", kind, route: pts };
      }
      case "beg": {
        const c = pl ?? places.steenplein;
        const at = snap(c.x + rnd(-2, 2), c.z + rnd(-2, 2));
        return { place, kind, at: [at[0], at[1], rng() * Math.PI * 2] };
      }
      case "inside": {
        if (place === "home") return { place: "home", kind, door: [home.sx, home.sz] };
        const d = takeDoorNear(pl?.x ?? home.sx, pl?.z ?? home.sz, 45, 4);
        return { place, kind, door: d ? [d.sx, d.sz] : [home.sx, home.sz] };
      }
      default:
        return { place, kind };
    }
  };
  const shuffle = <T>(xs: T[]): T[] => {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [xs[i], xs[j]] = [xs[j], xs[i]];
    }
    return xs;
  };

  // families ----------------------------------------------------------------
  /** Wife, children and maybe a lodger round a head of household. */
  const family = (head: Resident, opts: { wifeTrade?: TradeId; wifeWork?: WorkSpec; noKids?: boolean } = {}) => {
    const hh = head.household;
    const home = head.home;
    if (head.sex === "m" && head.age >= 20 && chance(head.age > 60 ? 0.5 : 0.72)) {
      const age = Math.max(18, head.age + int(-8, 2));
      const trade = opts.wifeTrade ?? (femaleJob(home) ?? "housewife");
      const place = opts.wifeTrade ? (opts.wifeWork?.place ?? "home") : (pendingPlace.get(trade) ?? "home");
      add({ sex: "f", age, trade, role: "wife", surname: head.surname, home, work: opts.wifeWork ?? workSpec(trade, place, home), hh });
      if (!opts.noKids) kids(head, age);
    } else if (head.sex === "f" && head.age >= 20 && chance(0.55) && head.family_role !== "widow") {
      const age = head.age + int(-2, 8);
      const job = maleJob(home);
      if (job) add({ sex: "m", age, trade: job.trade, role: "husband", surname: head.surname, home, work: workSpec(job.trade, job.place, home), hh });
      else add({ sex: "m", age, trade: "docker", role: "husband", surname: head.surname, home, work: workSpec("docker", pick(["rijnkaai", "werf", "bassin"]), home), hh });
      if (!opts.noKids) kids(head, head.age);
    } else if (!opts.noKids && head.age >= 28 && head.age < 60 && chance(0.35)) {
      head.family_role = head.sex === "f" ? "widow" : "widower";
      kids(head, head.age);
    }
    if (chance(0.12)) {
      const job = maleJob(home) ?? { trade: "sailor" as TradeId, place: "rijnkaai" };
      add({ sex: "m", age: int(19, 45), trade: job.trade, role: "lodger", surname: surnameFree(), home, work: workSpec(job.trade, job.place, home), hh });
    }
  };
  const kids = (parent: Resident, motherAge: number) => {
    const n = motherAge > 44 ? int(0, 2) : int(0, 4);
    for (let i = 0; i < n; i++) {
      const age = Math.max(1, Math.min(motherAge - 17, int(1, 15)));
      if (age < 1) continue;
      const sex = chance(0.5) ? "m" : "f";
      const trade: TradeId = age < 5 ? "infant" : age >= 12 && sex === "m" ? "errand_boy" : "child";
      const home = parent.home;
      const play = nearest(PLAY.map((p) => `play:${p}`), [home.sx, home.sz]);
      const work: WorkSpec = trade === "errand_boy" ? workSpec("errand_boy", parent.work.place in places ? parent.work.place : "rijnkaai", home) : { place: play, kind: trade === "infant" ? "inside" : "roam" };
      add({ sex, age, trade, role: sex === "m" ? "son" : "daughter", surname: parent.surname, home, work, hh: parent.household });
    }
  };

  // quotas: take the nearest open job of a kind for a spouse or lodger
  const pending: Job[] = shuffleJobs(jobList(scale), rng);
  /** Jobs a town of another size must fill even past its target (one of every trade, the police). */
  const must = new Set<Job>();
  if (scale !== 1) {
    // another size: one of every trade and all the police first, so a small town still has them all
    const firsts: Job[] = [];
    const seen = new Set<TradeId>();
    for (const j of pending) {
      if (j.trade === "police" || !seen.has(j.trade)) firsts.push(j);
      seen.add(j.trade);
    }
    const rest = pending.filter((j) => !firsts.includes(j));
    pending.splice(0, pending.length, ...firsts, ...rest);
    for (const j of firsts) must.add(j);
  }
  const pendingPlace = new Map<TradeId, string>();
  const takeJob = (pred: (j: Job) => boolean, home: Home): Job | null => {
    let best = -1;
    let bestD = Infinity;
    pending.forEach((j, i) => {
      if (!pred(j)) return;
      const pl = places[j.place];
      const d = pl ? dist([pl.x, pl.z], [home.sx, home.sz]) : 100;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    if (best < 0) return null;
    return pending.splice(best, 1)[0];
  };
  const femaleJob = (home: Home): TradeId | null => {
    if (!chance(0.4)) return null;
    const j = takeJob((j) => FEMALE_TRADES.has(j.trade) && j.trade !== "maid", home);
    if (!j) return null;
    pendingPlace.set(j.trade, j.place);
    return j.trade;
  };
  const maleJob = (home: Home): Job | null => (chance(0.8) ? takeJob((j) => !FEMALE_TRADES.has(j.trade) && !["thief", "beggar", "priest", "police", "lamplighter", "retired"].includes(j.trade), home) : null);

  // 1. the board's employers, at fixed ids, living near their post
  for (const e of TOWN_EMPLOYERS) {
    const sp = spots[e.spot];
    const d = takeDoorNear(sp.x, sp.z, 120, 3) ?? takeDoorNear(sp.x, sp.z, 1e9, 1)!;
    const home = makeHome(d);
    const hh = ++household;
    const surname = surnameFree();
    const at = snap(sp.x + 1.2, sp.z + 1.2);
    const head = add({ id: e.id, sex: e.sex, age: int(38, 58), trade: e.trade, role: "head", surname, home, hh, work: { place: e.spot, kind: "post", at: [at[0], at[1], face(at, [sp.x, sp.z])] } });
    family(head);
  }

  // 2. shops: the shopkeeper and his wife behind the table, the family above
  for (const s of SHOPS) {
    const d = shopDoor[s.id];
    if (!d) continue;
    const home = makeHome(d);
    const hh = ++household;
    const surname = surnameFree();
    const wall: Pt = [d.x, d.z];
    const side: Pt = [-d.out[1], d.out[0]];
    // the table stands beside the door, the keeper behind it
    const tx = d.x + side[0] * 1.9 + d.out[0] * 0.6;
    const tz = d.z + side[1] * 1.9 + d.out[1] * 0.6;
    const at = snap(tx + d.out[0] * 0.2, tz + d.out[1] * 0.2);
    const headSex: "m" | "f" = s.trade === "draper" && chance(0.5) ? "f" : "m";
    const headTrade: TradeId = headSex === "f" ? "shopwife" : s.trade;
    const head = add({ sex: headSex, age: int(30, 62), trade: headTrade, role: "head", surname, home, hh, work: { place: s.id, kind: "shop", shop: s.id, at: [at[0], at[1], Math.atan2(d.out[0], d.out[1])] } });
    shops.push({ id: s.id, label: s.label, door: [d.sx, d.sz], wall, out: d.out, goods: s.goods, keeper: head.id });
    if (headSex === "m") family(head, { wifeTrade: "shopwife", wifeWork: { place: s.id, kind: "shop", shop: s.id, at: [d.sx, d.sz, Math.atan2(d.out[0], d.out[1])] } });
    else family(head);
  }

  // 3. taverns: the publican at his door
  for (const t of TAVERNS) {
    const pl = places[`tavern:${t.id}`];
    if (!pl?.door) continue;
    const home: Home = { house: -1, x: pl.door[0], z: pl.door[1], sx: pl.door[0], sz: pl.door[1] };
    const hh = ++household;
    const surname = surnameFree();
    const at = snap(pl.door[0] + (pl.out?.[0] ?? 0) * 0.8, pl.door[1] + (pl.out?.[1] ?? 0) * 0.8);
    const head = add({ sex: "m", age: int(32, 60), trade: "publican", role: "head", surname, home, hh, work: { place: `tavern:${t.id}`, kind: "tavern", at: [at[0], at[1], Math.atan2(pl.out?.[0] ?? 0, pl.out?.[1] ?? -1)] } });
    family(head);
  }

  // 4. everyone else: house each open job near its workplace, with a family round it
  let stallNext = 0;
  const stallFor = (place: string): number | null => {
    for (let k = 0; k < stalls.length; k++) {
      const i = (stallNext + k) % stalls.length;
      if (stalls[i].place === place && !stalls[i].keeper) {
        stallNext = i + 1;
        return i;
      }
    }
    return null;
  };
  while (pending.length && (residents.length < target || pending.some((j) => must.has(j)))) {
    const j = pending.shift()!;
    if (residents.length >= target && !must.has(j)) continue;
    const full = residents.length >= target;
    const anchor = places[j.place] ?? (j.place === "night" ? places.vismarkt : j.place === "lamps" ? places.steenplein : places.rijnkaai);
    const d = takeDoorNear(anchor.x, anchor.z, 160, 6) ?? takeDoorNear(anchor.x, anchor.z, 1e9, 3);
    const home = d ? makeHome(d) : scale > 1 ? shareHouse(anchor.x, anchor.z) : null;
    if (!home) break;
    const hh = ++household;
    const female = FEMALE_TRADES.has(j.trade) || (j.trade === "beggar" && chance(0.3)) || (j.trade === "thief" && chance(0.2));
    const sex: "m" | "f" = female ? "f" : "m";
    const age = j.trade === "retired" ? int(62, 76) : j.trade === "maid" ? int(15, 24) : j.trade === "beggar" ? int(40, 72) : j.trade === "thief" ? int(16, 34) : int(19, 56);
    const head = add({ sex, age, trade: j.trade, role: j.trade === "maid" ? "single" : "head", surname: surnameFree(), home, hh, work: workSpec(j.trade, j.place, home) });
    if (j.trade === "fishwife" || j.trade === "market_woman") {
      const i = stallFor(j.place);
      if (i !== null) {
        const s = stalls[i];
        stalls[i].keeper = head.id;
        // the seller stands behind the table, facing the customers
        const at = snap(s.x - s.face[0] * 1.0, s.z - s.face[1] * 1.0);
        head.work = { place: j.place, kind: "stall", stall: i, at: [at[0], at[1], Math.atan2(s.face[0], s.face[1])] };
      } else head.work = workSpec("laundress", j.place, home);
    }
    if (j.trade === "priest") {
      const c = spots.cathedral_door;
      const at = snap(c.x + 1.5, c.z - 0.6);
      head.work = { place: "cathedral", kind: "post", at: [at[0], at[1], Math.PI] };
      head.family_role = "single";
      continue;
    }
    if (j.trade === "maid" || j.trade === "thief" || j.trade === "beggar") continue; // live alone
    if (full) continue; // a small town past its number: the last trades it must have live alone
    family(head);
  }

  // 5. a few street children with nobody, in a cellar by the Vismarkt (a bigger town: a second
  // band in a cellar by the Werf, a third by the Bassin)
  const bands = scale > 1.3 ? (scale > 2 ? 3 : 2) : 1;
  for (const [k, where] of (["vismarkt", "werf", "bassin"] as const).slice(0, bands).entries()) {
    const pl = places[where] ?? places.vismarkt;
    const play = places[`play:${where}`] ? `play:${where}` : "play:vismarkt";
    const d = takeDoorNear(pl.x, pl.z, 200, 4);
    const home = d ? makeHome(d) : k > 0 ? shareHouse(pl.x, pl.z) : null;
    if (home) {
      const hh = ++household;
      const surname = surnameFree();
      for (let i = 0; i < 3; i++) {
        const sex = i === 2 ? "f" : "m";
        add({ sex, age: int(8, 13), trade: "street_child", role: sex === "m" ? "son" : "daughter", surname, home, hh, work: { place: play, kind: "roam" } });
      }
    }
  }

  // sellers who came in as wives or husbands: a free stall at their market, else they sell from a basket
  for (const r of residents) {
    if ((r.trade !== "fishwife" && r.trade !== "market_woman") || r.work.stall !== undefined) continue;
    const place = r.work.place in places ? r.work.place : r.trade === "fishwife" ? "vismarkt" : "grote_markt";
    const i = stallFor(place);
    if (i === null) {
      r.work = workSpec("laundress", place, r.home);
      continue;
    }
    const s = stalls[i];
    s.keeper = r.id;
    const at = snap(s.x - s.face[0] * 1.0, s.z - s.face[1] * 1.0);
    r.work = { place, kind: "stall", stall: i, at: [at[0], at[1], Math.atan2(s.face[0], s.face[1])] };
  }

  // stalls nobody took: a wife from nearby takes it (the town needs its market)
  for (let i = 0; i < stalls.length; i++) {
    const s = stalls[i];
    if (s.keeper) continue;
    const trade: TradeId = s.goods === "fish" ? "fishwife" : "market_woman";
    let wife = residents
      .filter((r) => r.trade === "housewife" && r.age >= 20 && r.age < 62)
      .sort((a, b) => Math.hypot(a.home.sx - s.x, a.home.sz - s.z) - Math.hypot(b.home.sx - s.x, b.home.sz - s.z))[0];
    if (!wife) {
      // (M6 population) a small town short of wives: a widow living near the market keeps it
      const d = takeDoorNear(s.x, s.z, 200, 4) ?? takeDoorNear(s.x, s.z, 1e9, 1);
      const home = d ? makeHome(d) : shareHouse(s.x, s.z);
      if (!home) break;
      wife = add({ sex: "f", age: int(34, 60), trade, role: "widow", surname: surnameFree(), home, hh: ++household, work: { place: s.place, kind: "stall" } });
    }
    wife.trade = trade;
    wife.faction = TRADES[trade].faction;
    wife.kind = kindFor(trade, "f", wife.age, rng);
    s.keeper = wife.id;
    const at = snap(s.x - s.face[0] * 1.0, s.z - s.face[1] * 1.0);
    wife.work = { place: s.place, kind: "stall", stall: i, at: [at[0], at[1], Math.atan2(s.face[0], s.face[1])] };
  }

  // 6. (M6 population) whatever the seed and the size, the town has its priest and at least four
  // police agents. Some seeds used up the job list before them. Any that are missing come now,
  // from a random stream of their own, so a town that has them all stays exactly as it was.
  {
    const police = residents.filter((r) => r.trade === "police").length;
    const needPriest = !residents.some((r) => r.trade === "priest");
    if (needPriest || police < 4) {
      rng = rngFrom((seed ^ 0x2f6e1873) >>> 0);
      const beats = ["quays", "town", "werf", "quays"];
      for (let i = police; i < 4; i++) {
        const pl = places[beats[i]] ?? places.rijnkaai;
        const d = takeDoorNear(pl.x, pl.z, 200, 4) ?? takeDoorNear(pl.x, pl.z, 1e9, 1);
        const home = d ? makeHome(d) : shareHouse(pl.x, pl.z);
        if (!home) break;
        const head = add({ sex: "m", age: int(24, 50), trade: "police", role: "head", surname: surnameFree(), home, hh: ++household, work: workSpec("police", beats[i], home) });
        family(head, { noKids: residents.length >= target });
      }
      if (needPriest) {
        const c = spots.cathedral_door;
        const d = takeDoorNear(c.x, c.z, 200, 3) ?? takeDoorNear(c.x, c.z, 1e9, 1);
        const home = d ? makeHome(d) : shareHouse(c.x, c.z);
        if (home) {
          const at = snap(c.x + 1.5, c.z - 0.6);
          add({ sex: "m", age: int(38, 64), trade: "priest", role: "single", surname: surnameFree(), home, hh: ++household, work: { place: "cathedral", kind: "post", at: [at[0], at[1], Math.PI] } });
        }
      }
    }
  }

  // --- schedules, dogs
  for (const r of residents) r.sched = scheduleFor(r, places, taverns, rng);
  const hhs = new Map<number, Resident[]>();
  for (const r of residents) hhs.set(r.household, [...(hhs.get(r.household) ?? []), r]);
  const DOG_OWNERS = new Set<TradeId>(["docker", "carter", "boatman", "retired", "beggar", "brewer", "lamplighter", "porter", "natie"]);
  for (const members of hhs.values()) {
    const owner = members.find((m) => DOG_OWNERS.has(m.trade));
    if (owner && chance(owner.trade === "beggar" ? 0.6 : 0.18)) owner.dog = { name: pick(DOGS), look: pick(DOG_LOOKS) };
  }
  // the garrison and the customs (garrison.ts): their own random stream, so the rest stays as it was
  const g = generateGarrison(seed, places, residents);
  Object.assign(places, g.places);
  residents.push(...g.residents);
  return { seed, ...(size !== "normal" ? { size } : {}), places, stalls, shops, residents };

  function shuffleJobs(xs: Job[], r: () => number): Job[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const k = Math.floor(r() * (i + 1));
      [xs[i], xs[k]] = [xs[k], xs[i]];
    }
    return xs;
  }
}

// ------------------------------------------------------------------ schedules

const q = (h: number) => Math.round(h * 4) / 4;

export function scheduleFor(r: Resident, places: Record<string, TownPlace>, taverns: string[], rng: () => number): Schedule {
  const j = (h: number, s = 0.5) => q(h + (rng() * 2 - 1) * s);
  const home: [number, number] = [r.home.sx, r.home.sz];
  const near = (keys: string[], p: [number, number]) =>
    keys.reduce((b, k) => (Math.hypot(places[k].x - p[0], places[k].z - p[1]) < Math.hypot(places[b].x - p[0], places[b].z - p[1]) ? k : b), keys[0]);
  const wp = places[r.work.place] ?? places.rijnkaai;
  const workAt: [number, number] = r.work.at ? [r.work.at[0], r.work.at[1]] : r.work.a ?? [wp.x, wp.z];
  const tavernWork = near(taverns, workAt);
  const tavernHome = near(taverns, home);
  const play = near(PLAY.map((p) => `play:${p}`), home);
  const market = near(MARKETS.map((m) => `market:${m}`), home);
  const pious = r.stats.piety >= 5 && rng() < 0.8;
  const drinker = r.stats.piety <= 5 && rng() < 0.6;
  const church: Seg[] = pious ? [[j(8.75, 0.25), j(11, 0.25), "church", "church"]] : [];
  const sundayStroll: Seg[] = [[j(14.5), j(17), "stroll", play]];
  const day: Seg[] = [];
  let sunday: Seg[] = [...church, ...sundayStroll];
  switch (r.trade) {
    case "docker":
    case "natie":
    case "boatman": {
      day.push([j(6, 0.25), 12, "work"]);
      day.push(drinker ? [12, 13, "tavern", tavernWork] : [12, 13, "home"]);
      day.push([13, j(18.5), "work"]);
      if (drinker) day.push([j(19), j(21.5, 1), "tavern", tavernHome]);
      break;
    }
    case "porter":
    case "carter":
    case "errand_boy":
      day.push([j(6.5), 12, "work"], [13, j(18), "work"]);
      if (drinker && r.age > 16) day.push([j(19), j(21), "tavern", tavernHome]);
      break;
    case "sailor":
      day.push([j(8), 12, "loiter", r.work.place], [12, j(17), "work"], [j(17.5), j(23.5, 0.5), "tavern", near(taverns, workAt)]);
      sunday = [[j(10), 13, "loiter", r.work.place], [j(16), j(23.5, 0.5), "tavern", near(taverns, workAt)]];
      break;
    case "fishwife":
    case "market_woman":
      day.push([j(6, 0.25), j(17), "work"]);
      if (r.stats.gossip >= 6) day.push([j(18), j(19.5), "loiter", play]);
      break;
    case "baker":
      day.push([j(5.5, 0.25), 13, "work"], [14, j(18.5), "work"]);
      break;
    case "grocer":
    case "chandler":
    case "tobacconist":
    case "pawnbroker":
    case "cobbler":
    case "draper":
    case "shopwife":
      day.push([j(7, 0.25), 12.5, "work"], [13.5, j(19), "work"]);
      if (drinker && r.sex === "m") day.push([j(20), j(22), "tavern", tavernHome]);
      break;
    case "publican":
      day.push([j(9.5), 26, "work"]);
      sunday = [...church, [j(12), 26, "work"]];
      break;
    case "clerk":
    case "merchant":
      day.push([j(8), 12.5, "work"], [13.5, j(18), "work"]);
      if (r.trade === "merchant") day.push([j(19), j(20.5), "stroll", "play:grote_markt"]);
      else if (drinker) day.push([j(18.5), j(20.5), "tavern", tavernHome]);
      break;
    case "maid":
      day.push([j(6.5), 9, "work"], [9, j(10.5), "market", market], [10.5, j(20), "work"]);
      sunday = [...church, [j(15), j(17.5), "stroll", play]];
      break;
    case "laundress":
      day.push([j(7), 12, "work"], [13, j(16.5), "work"], [j(17), j(18), "market", market]);
      break;
    case "seamstress":
    case "housewife":
      day.push([j(9, 0.75), j(10.5), "market", market]);
      if (r.stats.gossip >= 5 || rng() < 0.4) day.push([j(16.5), j(18), "loiter", play]);
      break;
    case "police": {
      const night = r.id.charCodeAt(r.id.length - 1) % 2 === 0;
      if (night) day.push([j(18, 0.25), 30, "work"]);
      else day.push([6, 13, "work"], [14, j(19, 0.25), "work"]);
      sunday = day.slice();
      break;
    }
    case "priest":
      day.push([7, 12, "work"], [14, 18, "work"]);
      sunday = [[6.5, 13, "work"], [15, 18, "work"]];
      break;
    case "sexton":
    case "foreman":
    case "fish_merchant":
    case "water_bailiff":
    case "brewer":
      // the board's employers: at their post from dawn until late (work can be taken till the bell at night)
      day.push([6, 22, "work"]);
      sunday = [...(r.trade === "sexton" ? [] : church), [11, 22, "work"]];
      if (r.trade === "sexton") sunday = [[6, 22, "work"]];
      break;
    case "lamplighter":
      day.push([5.5, 7, "work"], [j(17, 0.25), 19.5, "work"]);
      sunday = day.slice();
      break;
    case "beggar":
      day.push([j(8), j(19), "work"]);
      sunday = [[7.5, 13, "work"], [14, 19, "work"]];
      break;
    case "thief":
      day.push([j(11), j(17), "loiter", market], [j(18), 21, "tavern", near(taverns, home)], [21, j(28, 0.5), "work"]);
      sunday = day.slice();
      break;
    case "retired":
      day.push([j(9), j(11.5), "loiter", play], [j(14), j(16.5), "loiter", near(["play:steenplein", "play:vismarkt", "play:bassin_south", "play:back_lane"], home)]);
      if (drinker) day.push([j(19), j(21), "tavern", tavernHome]);
      break;
    case "child":
    case "street_child":
      if (r.trade === "street_child") day.push([j(7), 12, "play", r.work.place], [12, j(17), "loiter", market], [j(17), j(20.5), "play", r.work.place]);
      else day.push([j(8.5), 12, "play", play], [j(13.5), j(17.5), "play", play]);
      sunday = r.trade === "street_child" ? day.slice() : [...church, [j(14), j(17.5), "play", play]];
      break;
    case "infant":
      sunday = [];
      break;
  }
  return { day: tidy(day), sunday: tidy(sunday) };
}

/** In order, no overlaps (the jitter may push an evening before the end of work). */
export function tidy(segs: Seg[]): Seg[] {
  segs.sort((a, b) => a[0] - b[0]);
  const out: Seg[] = [];
  for (const s of segs) {
    const prev = out[out.length - 1];
    const from = prev ? Math.max(s[0], prev[1]) : s[0];
    if (s[1] - from >= 0.25) out.push([from, s[1], s[2], ...(s[3] !== undefined ? [s[3]] : [])] as Seg);
  }
  return out;
}
