import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import CITY from "../../../shared/city.json" with { type: "json" };
import INWORLD from "../../../shared/inworld_houses.json" with { type: "json" };
import TOWNPLACES from "../../../shared/townplaces.json" with { type: "json" };
import type { DB } from "../db.ts";
import { shownTrade } from "../town/places.ts";
import type { Resident, Town } from "../town/population.ts";
import { activityAt } from "../town/schedule.ts";
import { cityHouses } from "../town/walkmap.ts";
import { actText, keyOf, moverId, moverPos, placeLabel, plannedSpot, segsOf, type MapClock, type MapModel } from "./model.ts";

// The town map's answers (docs/mapview.md): the drawing of the town (/city), the people and places that
// change only with a new game (/people), the feed's snapshot (/feed), one thing's details (/detail) and its
// history (/history). Read-only: nothing here writes to the save.

type Pt = [number, number];
const r1 = (v: number) => Math.round(v * 10) / 10;
const pt = (p: readonly number[]): Pt => [r1(p[0]), r1(p[1])];
const poly = (ps: ReadonlyArray<readonly number[]>): Pt[] => ps.map(pt);
const flat = (tris: ReadonlyArray<readonly number[]>): number[] => tris.flatMap((t) => t.map(r1));
const fin = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

// ------------------------------------------------------------------ /city: the drawing of the town

interface CityJson {
  area: Pt[];
  blocks: Array<{ outer: Pt[]; holes: Pt[][]; kind: string }>;
  water: Array<{ outer: Pt[]; holes: Pt[][] }>;
  landmarks: Record<string, { fp: Pt[] }>;
  bridges: Record<string, [number, number, number, number]>;
  bridgeKinds: Record<string, string>;
  places: Record<string, { x: number; z: number; kind: string }>;
  quays: Array<[number, number, number, number]>;
  ground: Record<string, number[][]>;
  alleys: { lanes: Pt[][]; yards: Pt[][]; gardens: Pt[][]; courts: Pt[][] };
  decor: {
    trees: Pt[];
    trees_wild: Pt[];
    rails: Array<[number, number, number, number]>;
    crane_rails: Array<[number, number, number, number]>;
    tracks: Array<{ pts: Pt[] }>;
    lamps: Pt[];
    grass: Array<{ outer: Pt[]; holes?: Pt[][] }>;
    offlimits: Pt[][];
    park: { outline: Pt[]; ponds: Array<[number, number, number]>; paths: Pt[][] };
    rampart: {
      trace: Pt[];
      tops: Pt[][];
      bastions: Record<string, Pt[]>;
      towers: Array<{ rect: Pt[] }>;
      gates: Array<{ id: string; name: string; house: Pt[]; passage?: Pt[] }>;
      huts: Pt[][];
      mill?: { x: number; z: number; r: number };
    };
    rampart_solids: Pt[][];
  };
}

const LANDMARK_NAMES: Record<string, string> = {
  cathedral: "Cathedral of Our Lady",
  stadhuis: "Town hall",
  vleeshuis: "Vleeshuis",
  steen: "Het Steen",
  hanzehuis: "Hanseatic House",
  carolus: "Sint-Carolus Borromeus",
  stpaul: "Sint-Pauluskerk",
  stjacob: "Sint-Jacobskerk",
};

let cityMemo: string | null = null;

/** The town as lines and shapes for the page, in world metres (x north, z east), made once. */
export function cityJson(): string {
  if (cityMemo) return cityMemo;
  const c = CITY as unknown as CityJson;
  const tp = TOWNPLACES as unknown as { greens?: Array<{ label: string; grass?: Pt[][]; paths?: Pt[][] }>; rond?: { c: Pt; r_disc: number; label: string } };
  let houses: Array<{ fp: Pt[]; k: string }> = [];
  try {
    const file = fileURLToPath(new URL("../../../shared/city_build.json", import.meta.url));
    const build = JSON.parse(readFileSync(file, "utf8")) as { houses: Array<{ fp: Pt[]; store?: string; gone?: boolean }> };
    houses = build.houses.filter((h) => !h.gone && Array.isArray(h.fp)).map((h) => ({ fp: poly(h.fp), k: h.store === "warehouse" || h.store === "entrepot" ? "w" : "h" }));
  } catch {
    // no houses file: the blocks stand in for them
    houses = c.blocks.map((b) => ({ fp: poly(b.outer), k: b.kind === "houses" ? "h" : "w" }));
  }
  const r = c.decor.rampart;
  const out = {
    area: poly(c.area),
    // the walled town (the fit on load)
    town: { x0: -380, x1: 262, z0: -60, z1: 392 },
    water: c.water.map((w) => ({ outer: poly(w.outer), holes: (w.holes ?? []).map(poly) })),
    fields: c.decor.grass.map((g) => ({ outer: poly(g.outer), holes: (g.holes ?? []).map(poly) })),
    zones: {
      grass: flat(c.ground.grass ?? []),
      earth: flat(c.ground.earth ?? []),
      quay: flat(c.ground.quay ?? []),
      flags: flat(c.ground.flags ?? []),
    },
    houses,
    landmarks: Object.entries(c.landmarks).map(([id, l]) => ({ id, name: LANDMARK_NAMES[id] ?? id, fp: poly(l.fp) })),
    bridges: Object.entries(c.bridges).map(([id, rect]) => ({ id, kind: c.bridgeKinds[id] ?? "bridge", rect: rect.map(r1) })),
    rampart: {
      trace: poly(r.trace),
      tops: r.tops.map(poly),
      bastions: Object.values(r.bastions).map(poly),
      towers: r.towers.map((t) => poly(t.rect)),
      gates: r.gates.map((g) => ({ id: g.id, name: g.name, house: poly(g.house) })),
      solids: c.decor.rampart_solids.map(poly),
      mill: r.mill ? [r1(r.mill.x), r1(r.mill.z), r1(r.mill.r)] : null,
    },
    quays: c.quays.map((q) => q.map(r1)),
    rails: [...c.decor.rails, ...c.decor.tracks.flatMap((t) => t.pts.slice(1).map((p, i) => [...t.pts[i], ...p]))].map((q) => q.map(r1)),
    craneRails: c.decor.crane_rails.map((q) => q.map(r1)),
    trees: [...c.decor.trees, ...c.decor.trees_wild].map(pt),
    lamps: c.decor.lamps.map(pt),
    park: { outline: poly(c.decor.park.outline), ponds: c.decor.park.ponds.map((p) => p.map(r1)), paths: c.decor.park.paths.map(poly) },
    alleys: { lanes: c.alleys.lanes.map(poly), yards: c.alleys.yards.map(poly), gardens: c.alleys.gardens.map(poly), courts: c.alleys.courts.map(poly) },
    greens: (tp.greens ?? []).flatMap((g) => (g.grass ?? []).map(poly)),
    rond: tp.rond ? { c: pt(tp.rond.c), r: r1(tp.rond.r_disc), label: tp.rond.label } : null,
    labels: Object.entries(c.places).map(([name, p]) => ({ name, x: r1(p.x), z: r1(p.z), kind: p.kind })),
  };
  cityMemo = JSON.stringify(out);
  return cityMemo;
}

// ------------------------------------------------------------------ /people: who lives in the town

/** Changes when the town does (a new game, emigrants come or go): the page fetches /people again. */
export function townKey(town: Town): string {
  return `${town.seed}:${town.residents.length}:${town.residents[town.residents.length - 1]?.id ?? ""}`;
}

/** The residents, the places, the stalls, the homes and the cats' doorsteps: what changes only with the town. */
export function peopleJson(town: Town): string {
  const places = Object.entries(town.places)
    .filter(([id]) => !id.startsWith("play:") && !id.startsWith("market:"))
    .map(([id, p]) => ({ id, label: p.label, x: r1(p.x), z: r1(p.z), r: r1(p.r), district: p.district, kind: id.startsWith("tavern:") ? "tavern" : p.door ? "shop" : "place" }));
  const hs = homesOf(town);
  return JSON.stringify({
    key: townKey(town),
    residents: town.residents.map((r) => {
      const w = workplaceOf(r, town);
      return {
        id: r.id,
        name: r.name,
        label: shownTrade(r),
        age: r.age,
        sex: r.sex,
        household: r.household,
        role: r.family_role,
        dog: r.dog ? r.dog.name : null,
        home: hs.byResident.get(r.id) ?? null,
        mate: r.mate ?? null,
        // the workplace: where, its name, and the place to pin if the town has one
        work: w ? [r1(w.x), r1(w.z)] : null,
        wl: w?.label ?? null,
        wp: w?.place ?? null,
      };
    }),
    places,
    stalls: town.stalls.map((s, i) => ({ i, x: r1(s.x), z: r1(s.z), goods: s.goods, keeper: s.keeper })),
    homes: [...hs.byId.values()].map((h) => ({ id: h.id, fp: h.fp, door: h.step, n: h.members.length, name: h.name, near: h.near, in: h.inworld, hh: h.households })),
    // the cats of the game sit on these doorsteps (client game/town.ts: every third resident's step)
    cats: town.residents.filter((_r, i) => i % 3 === 0).map((r) => [r1(r.home.sx), r1(r.home.sz)]),
  });
}

// ------------------------------------------------------------------ homes and workplaces

/** A house somebody lives in: its outline, its door and who lives there (one household or several). */
export interface HomeInfo {
  /** "h696" (a house of shared/city_build.json) or "d-548_451" (a door with no house on the map). */
  id: string;
  /** The index in shared/city_build.json, or -1. */
  house: number;
  /** Its outline (world metres), or null when there is no house to draw (a door only). */
  fp: Pt[] | null;
  /** The door in the wall and the step in front of it. */
  wall: Pt;
  step: Pt;
  members: Resident[];
  /** The households that live in it, the biggest first. */
  households: number[];
  /** "the Dens family", "Jan Dens", "the Dens family and 2 more households". */
  name: string;
  /** "near the Vismarkt", or null. */
  near: string | null;
  /** The building of the game it is (a tavern, the barracks), if one. */
  inworld: string | null;
}

interface Homes {
  byId: Map<string, HomeInfo>;
  byResident: Map<string, string>;
}

const homesMemo = new WeakMap<Town, Homes>();
const INWORLD_ENTRIES = (INWORLD as unknown as { houses: Array<{ id: string; house: number; door: Pt }> }).houses;

/** A proper name for a place of the map: "the Vismarkt", "the Sint-Jansplein", but "Het Steen" as it is. */
const properName = (n: string) => (/^(the|het|de|den|'t)\b/i.test(n) ? n : `the ${n}`);

/** The names worth saying "near" of: the squares, quays and buildings, and the town's own places. */
function namedSpots(town: Town): Array<{ name: string; x: number; z: number }> {
  const out: Array<{ name: string; x: number; z: number }> = [];
  const tp = TOWNPLACES as unknown as { places?: Record<string, { x: number; z: number; kind: string }> };
  for (const [name, p] of [...Object.entries((CITY as unknown as CityJson).places), ...Object.entries(tp.places ?? {})]) {
    if (p.kind === "water") continue;
    out.push({ name: properName(LANDMARK_NAMES[name] ?? name), x: p.x, z: p.z });
  }
  for (const [id, p] of Object.entries(town.places)) {
    const main = !id.includes(":") || /^(tavern|church|landmark):/.test(id);
    if (!main || /^an? /i.test(p.label) || p.r > 35) continue;
    out.push({ name: p.label, x: p.x, z: p.z });
  }
  return out;
}

/** "De Vliet", "the bakery behind the Rijnkaai", "the Poesje", "rooms to let (garret)". */
function inworldLabel(town: Town, id: string): string {
  const bare = id.replace(/^[a-z]+:/, "");
  const p = town.places[id] ?? town.places[bare];
  if (p) return p.label;
  if (id.startsWith("home:")) return `rooms to let (${bare})`;
  return properName(bare.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()));
}

/** The household(s) of a house in a few words. */
function familyName(members: Resident[], households: number[]): string {
  const first = members.filter((r) => r.household === households[0]);
  const head = first.find((r) => r.family_role === "head") ?? first[0];
  const one = first.length === 1 ? head.name : `the ${head.surname} family`;
  const more = households.length - 1;
  return more ? `${one} and ${more} more household${more > 1 ? "s" : ""}` : one;
}

/** The homes of the town, made once per town: every resident's house, with its outline if the map has one. */
export function homesOf(town: Town): Homes {
  const memo = homesMemo.get(town);
  if (memo) return memo;
  let houses: Array<{ fp: number[][]; gone?: boolean }> = [];
  try {
    houses = cityHouses();
  } catch {
    // no houses file: doors only
  }
  const inworldByHouse = new Map(INWORLD_ENTRIES.map((e) => [e.house, e]));
  const byId = new Map<string, HomeInfo>();
  const byResident = new Map<string, string>();
  for (const r of town.residents) {
    let house = r.home.house;
    // a home in a building of the game (a tavern, the barracks) that the town gave no house number: its door says which
    if (house < 0) {
      const e = INWORLD_ENTRIES.find((q) => Math.hypot(q.door[0] - r.home.x, q.door[1] - r.home.z) < 3 || Math.hypot(q.door[0] - r.home.sx, q.door[1] - r.home.sz) < 3);
      if (e) house = e.house;
    }
    const fpRaw = house >= 0 ? houses[house] : undefined;
    const id = house >= 0 ? `h${house}` : `d${Math.round(r.home.sx * 10)}_${Math.round(r.home.sz * 10)}`;
    byResident.set(r.id, id);
    let h = byId.get(id);
    if (!h) {
      const iw = house >= 0 ? inworldByHouse.get(house) : undefined;
      h = {
        id,
        house,
        fp: fpRaw && !fpRaw.gone && Array.isArray(fpRaw.fp) ? poly(fpRaw.fp) : null,
        wall: pt([r.home.x, r.home.z]),
        step: pt([r.home.sx, r.home.sz]),
        members: [],
        households: [],
        name: "",
        near: null,
        inworld: iw ? inworldLabel(town, iw.id) : null,
      };
      byId.set(id, h);
    }
    h.members.push(r);
  }
  const spots = namedSpots(town);
  for (const h of byId.values()) {
    const size = new Map<number, number>();
    for (const r of h.members) size.set(r.household, (size.get(r.household) ?? 0) + 1);
    h.households = [...size.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map((e) => e[0]);
    h.name = familyName(h.members, h.households);
    let best: string | null = null;
    let bestD = 90;
    for (const s of spots) {
      const d = Math.hypot(s.x - h.step[0], s.z - h.step[1]);
      if (d < bestD) ((bestD = d), (best = s.name));
    }
    h.near = best ? `near ${best}` : null;
  }
  const out = { byId, byResident };
  homesMemo.set(town, out);
  return out;
}

export function homeOf(town: Town, r: Resident): HomeInfo | undefined {
  const hs = homesOf(town);
  const id = hs.byResident.get(r.id);
  return id ? hs.byId.get(id) : undefined;
}

/** Where a resident works, if somewhere else than at home: the spot, its name, and the town's place to pin if one. */
export function workplaceOf(r: Resident, town: Town): { x: number; z: number; label: string; place: string | null } | null {
  const w = r.work;
  // at home, a child's play, an emigrant's waiting: no workplace
  if (w.place === "home" || w.place.startsWith("play:") || w.kind === "wait") return null;
  const place = town.places[w.place] ? w.place : w.shop && town.places[w.shop] ? w.shop : null;
  const label = placeLabel(r, town, "work", "work");
  const p = place ? town.places[place] : undefined;
  let at: readonly number[] | undefined;
  if (w.at) at = w.at;
  else if (typeof w.stall === "number" && town.stalls[w.stall]) at = [town.stalls[w.stall].x, town.stalls[w.stall].z];
  else if (w.shop) {
    const s = town.shops.find((q) => q.id === w.shop);
    at = s ? (s.out ?? s.door) : undefined;
  }
  if (!at && w.kind === "inside" && w.door) at = w.door;
  if (!at && p) at = [p.x, p.z];
  if (!at && w.door) at = w.door;
  if (!at && w.kind === "haul" && w.a) at = w.a;
  if (!at && w.route?.length) at = w.route[0];
  if (!at || !fin(at[0]) || !fin(at[1])) return null;
  return { x: at[0], z: at[1], label, place };
}

// ------------------------------------------------------------------ what the database says now (once a second)

export interface DbNow {
  at: number;
  actions: Map<string, string>;
  events: Array<{ id: number; title: string; place: string; x: number; z: number; r: number; status: string; stage: number }>;
}

function hasTable(db: DB, name: string): boolean {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
  } catch {
    return false;
  }
}

export function readDbNow(db: DB, day: number): DbNow {
  const now: DbNow = { at: Date.now(), actions: new Map(), events: [] };
  try {
    if (hasTable(db, "npc_action")) {
      const rows = db.prepare("SELECT npc_id, kind, target, reason FROM npc_action WHERE status = 'active' ORDER BY id").all() as Array<{ npc_id: string; kind: string; target: string; reason: string }>;
      for (const a of rows) now.actions.set(a.npc_id, `${a.kind}${a.target ? ` ${a.target}` : ""}${a.reason ? ` (${a.reason})` : ""}`);
    }
    if (hasTable(db, "town_event")) {
      now.events = (
        db.prepare("SELECT id, title, place, x, z, r, status, stage FROM town_event WHERE status IN ('planned', 'running') AND day = ? ORDER BY start_m").all(day) as DbNow["events"]
      ).map((e) => ({ ...e, x: r1(e.x), z: r1(e.z), r: r1(e.r) }));
    }
  } catch {
    /* a save being loaded or closed: nothing this second */
  }
  return now;
}

// ------------------------------------------------------------------ /feed: the snapshot, four times a second

export function snapshot(model: MapModel, town: Town | null, clock: MapClock | null, dbNow: DbNow | null): Record<string, unknown> {
  const walks = model.walkCounts();
  const players = model.playerList().map((p) => ({
    id: p.id,
    name: p.name,
    host: p.host,
    x: r1(p.x),
    z: r1(p.z),
    y: r1(p.y),
    yaw: Math.round(p.yaw * 100) / 100,
    v: fin(p.vx) && fin(p.vz) ? r1(Math.hypot(p.vx, p.vz)) : null,
    mode: p.mode,
    away: p.away,
    online: p.online,
    walks: walks.get(p.id) ?? 0,
  }));
  const people: Array<Record<string, unknown>> = [];
  const liveIds = new Set<string>();
  for (const l of model.liveList()) {
    liveIds.add(l.id);
    const r = town ? residentOf(town, l.id) : undefined;
    const plan = r && town && clock ? plannedSpot(r, town, clock) : null;
    people.push({
      id: l.id,
      x: r1(l.x),
      z: r1(l.z),
      yaw: Math.round(l.yaw * 100) / 100,
      live: 1,
      o: l.owner,
      m: l.motion,
      s: r1(l.speed),
      sit: l.sit ? 1 : 0,
      lan: l.lantern ? 1 : 0,
      sack: l.sack ? 1 : 0,
      buy: l.bought ?? undefined,
      veh: l.vehicle == null ? undefined : typeof l.vehicle === "string" ? l.vehicle : l.vehicle.kind,
      a: plan?.act,
      p: plan?.label,
      n: plan?.next ? `${actText(plan.next.act)} ${plan.next.label} at ${hhmm(plan.next.from)}` : undefined,
      act: dbNow?.actions.get(l.id),
    });
  }
  if (town && clock) {
    for (const r of town.residents) {
      if (liveIds.has(r.id)) continue;
      const s = plannedSpot(r, town, clock);
      people.push({
        id: r.id,
        x: r1(s.x),
        z: r1(s.z),
        live: 0,
        in: s.indoor ? 1 : 0,
        o: model.ownerOf(r.id) || undefined,
        a: s.act,
        p: s.label,
        left: Math.round(s.left * 60),
        // the trade plan: on the way between two parts of his day (the sum every PC walks him by), metres to go
        mv: s.moving ? 1 : undefined,
        wl: s.moving && s.walkLeft > 0 ? s.walkLeft : undefined,
        n: s.next ? `${actText(s.next.act)} ${s.next.label} at ${hhmm(s.next.from)}` : undefined,
        act: dbNow?.actions.get(r.id),
      });
    }
  }
  const w = model.worldState();
  return {
    type: "snap",
    t: model.now(),
    clock,
    key: town ? townKey(town) : null,
    players,
    people,
    world: w ? { t: w.t, age: model.now() - w.at, d: w.d } : null,
    events: dbNow?.events ?? [],
  };
}

const residentIndex = new WeakMap<Town, Map<string, Resident>>();
function residentOf(town: Town, id: string): Resident | undefined {
  let m = residentIndex.get(town);
  if (!m) residentIndex.set(town, (m = new Map(town.residents.map((r) => [r.id, r]))));
  return m.get(id);
}

// ------------------------------------------------------------------ /detail and /history

const pad = (n: number) => String(n).padStart(2, "0");
/** 13.5 -> "13:30"; hours past 24 wrap. */
export function hhmm(h: number): string {
  const m = Math.round((((h % 24) + 24) % 24) * 60);
  return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
}
const when = (day: number, hour: number, minute = 0) => `day ${day}, ${pad(hour)}:${pad(minute)}`;
/** An absolute game minute (deeds.ts gameMinute: (day - 1) * 1440 + ...). */
const whenMin = (m: number) => when(Math.floor(m / 1440) + 1, Math.floor((m % 1440) / 60), m % 60);

type Row = [string, string];
interface Section {
  title: string;
  rows: Row[];
}
interface Link {
  /** What a click pins (resident, dog, house, place...); "spot": nothing to pin, the map only goes there. */
  kind: string;
  id: string;
  name: string;
  why?: string;
  /** The heading the page puts it under ("Family", "Home and work"); none: the card's usual one. */
  group?: string;
  /** Where the map goes on a click (a home, a workplace). */
  at?: { x: number; z: number };
}
export interface Detail {
  kind: string;
  id: string;
  title: string;
  sub: string;
  sections: Section[];
  links: Link[];
  plan?: { weekday: string; segs: Array<{ from: string; to: string; act: string; place: string; now: boolean }> };
  at?: { x: number; z: number } | null;
}

export interface ViewDeps {
  model: MapModel;
  db: DB;
  town: Town | null;
  clock: MapClock | null;
}

function all<T>(db: DB, table: string, sql: string, ...args: unknown[]): T[] {
  if (!hasTable(db, table)) return [];
  try {
    return db.prepare(sql).all(...args) as T[];
  } catch {
    return [];
  }
}

function one<T>(db: DB, table: string, sql: string, ...args: unknown[]): T | undefined {
  if (!hasTable(db, table)) return undefined;
  try {
    return db.prepare(sql).get(...args) as T | undefined;
  } catch {
    return undefined;
  }
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function detail(v: ViewDeps, kind: string, id: string): Detail | null {
  const { model, db, town, clock } = v;
  if (kind === "resident" || kind === "dog") {
    const r = town ? residentOf(town, id) : undefined;
    if (!r || !town) return null;
    if (kind === "dog") {
      if (!r.dog) return null;
      const live = model.live(r.id);
      const at = live ?? (clock ? plannedSpot(r, town, clock) : null);
      return {
        kind,
        id,
        title: r.dog.name,
        sub: `${r.name}'s dog`,
        sections: [{ title: "Now", rows: [["Looks", r.dog.look.replace(/_/g, " ")], ["With", r.name], ["Seen", live ? "live, at his owner's heel" : "by the day plan, not seen live"]] }],
        links: [{ kind: "resident", id: r.id, name: r.name, why: "owner" }],
        at: at ? { x: at.x, z: at.z } : null,
      };
    }
    const live = model.live(r.id);
    const plan = clock ? plannedSpot(r, town, clock) : null;
    const now: Row[] = [];
    if (live) {
      now.push(["Seen", `live, walked by ${model.ownerName(live.owner)}`]);
      now.push(["Motion", `${live.motion}${live.sit ? ", sitting" : ""}`]);
      now.push(["Speed", `${live.speed.toFixed(1)} m/s`]);
      const veh = live.vehicle == null ? null : typeof live.vehicle === "string" ? live.vehicle : live.vehicle.kind;
      const carry = [live.lantern ? "a lantern" : "", live.sack ? "a sack" : "", live.bought ? String(live.bought) : "", veh ? `a ${veh}` : ""].filter(Boolean);
      if (carry.length) now.push(["Has", carry.join(", ")]);
    } else now.push(["Seen", plan?.indoor ? "by the day plan, not seen live (indoors)" : "by the day plan, not seen live"]);
    if (plan) {
      now.push(["Day plan", `${actText(plan.act)} ${plan.label}${plan.left > 0 ? ` for ${Math.round(plan.left * 60)} min more` : ""}`]);
      // the trade plan: on his way there (the sum every PC walks him by)
      if (!live && plan.moving && plan.walkLeft > 0) now.push(["On the way", `to ${plan.label}, ${plan.walkLeft} m to go`]);
      if (plan.next) now.push(["Then", `${actText(plan.next.act)} ${plan.next.label} at ${hhmm(plan.next.from)}`]);
    }
    const action = one<{ kind: string; target: string; reason: string; source: string; phase: string; until: number }>(
      db,
      "npc_action",
      "SELECT kind, target, reason, source, phase, until FROM npc_action WHERE npc_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
      r.id,
    );
    if (action) now.push(["Acting", `${action.kind}${action.target ? ` ${action.target}` : ""}, ${action.phase} (${action.source}${action.reason ? `: ${action.reason}` : ""}), till ${whenMin(action.until)}`]);
    const pos = live ?? plan;
    if (pos) now.push(["Where", `x ${pos.x.toFixed(1)}, z ${pos.z.toFixed(1)}`]);
    const owner = model.ownerOf(r.id);
    if (owner && !live) now.push(["Owner", `${model.ownerName(owner)} (no batch lately)`]);

    const trade = shownTrade(r);
    const home = homeOf(town, r);
    const work = workplaceOf(r, town);
    const who: Row[] = [
      ["Trade", trade === r.trade.replace(/_/g, " ") ? trade : `${trade} (engine: ${r.trade})`],
      ["Age", `${r.age}, ${r.sex === "f" ? "woman" : "man"}`],
      ["Household", `no. ${r.household}, ${r.family_role}`],
      ["Home", `${home?.inworld ? `${home.inworld}, ` : r.home.house >= 0 ? `house ${r.home.house}, ` : ""}${home?.near ?? ""} (x ${r.home.x.toFixed(0)}, z ${r.home.z.toFixed(0)})`],
      ["Work", `${r.work.kind} at ${placeLabel(r, town, "work", "work")}`],
    ];
    if (r.faction) who.push(["Faction", r.faction]);
    if (r.dog) who.push(["Dog", `${r.dog.name} (${r.dog.look.replace(/_/g, " ")})`]);
    if (r.origin) who.push(["From", r.origin]);
    const persona = one<{ persona: string }>(db, "resident", "SELECT persona FROM resident WHERE id = ?", r.id)?.persona;
    if (persona) who.push(["Persona", persona]);
    const st = r.stats;
    who.push(["Nature", `honesty ${st.honesty}, temper ${st.temper}, piety ${st.piety}, warmth ${st.warmth}, greed ${st.greed}, courage ${st.courage}, gossip ${st.gossip}, wealth ${st.wealth}`]);

    const sections: Section[] = [
      { title: "Now", rows: now },
      { title: "Who", rows: who },
    ];
    const rel = one<{ trust: number; affection: number; respect: number; fear: number; times_met: number; last_seen_day: number | null; last_place: string | null; view_of_player: string }>(
      db,
      "npc_relationship",
      "SELECT trust, affection, respect, fear, times_met, last_seen_day, last_place, view_of_player FROM npc_relationship WHERE npc_id = ?",
      r.id,
    );
    if (rel) {
      const rows: Row[] = [["Feelings", `trust ${rel.trust}, affection ${rel.affection}, respect ${rel.respect}, fear ${rel.fear}`], ["Met", `${rel.times_met} time(s)${rel.last_seen_day ? `, last on day ${rel.last_seen_day}` : ""}${rel.last_place ? ` at ${rel.last_place}` : ""}`]];
      if (rel.view_of_player) rows.push(["Thinks", rel.view_of_player]);
      sections.push({ title: "With the host's player", rows });
    }
    const links: Link[] = [];
    if (home) links.push({ kind: "house", id: home.id, name: "Home", why: home.inworld ?? home.near ?? home.name, group: "Home and work", at: { x: home.step[0], z: home.step[1] } });
    if (work) links.push({ kind: work.place ? "place" : "spot", id: work.place ?? `${r1(work.x)},${r1(work.z)}`, name: "Workplace", why: work.label, group: "Home and work", at: { x: r1(work.x), z: r1(work.z) } });
    for (const o of town.residents) if (o.household === r.household && o.id !== r.id) links.push({ kind: "resident", id: o.id, name: o.name, why: o.family_role, group: "Family" });
    if (r.mate) {
      const m = residentOf(town, r.mate);
      if (m) links.push({ kind: "resident", id: m.id, name: m.name, why: "mate", group: "Family" });
    }
    if (r.dog) links.push({ kind: "dog", id: r.id, name: r.dog.name, why: "dog", group: "Family" });
    let planOut: Detail["plan"];
    if (clock) {
      const h = clock.hour + clock.minute / 60;
      const cur = activityAt(r.sched, clock.day, h);
      const segs = segsOf(r.sched, clock.day);
      planOut = {
        weekday: clock.weekday ?? WEEKDAYS[(clock.day - 1) % 7],
        segs: segs.map(([a, b, act, where]) => {
          const place = where ?? (act === "work" ? "work" : "home");
          const nowSeg = act === cur.act && place === cur.place && ((h >= a && h < b) || (h + 24 >= a && h + 24 < b));
          return { from: hhmm(a), to: hhmm(b), act: actText(act), place: placeLabel(r, town, act, place), now: nowSeg };
        }),
      };
    }
    return { kind, id, title: r.name, sub: `${trade}, ${r.age}`, sections, links, plan: planOut, at: pos ? { x: pos.x, z: pos.z } : null };
  }

  if (kind === "house") {
    const h = town ? homesOf(town).byId.get(id) : undefined;
    if (!h || !town) return null;
    const near = (x: number, z: number) => Math.hypot(x - h.wall[0], z - h.wall[1]) < 3 || Math.hypot(x - h.step[0], z - h.step[1]) < 3;
    const living: Link[] = [];
    const inside: Link[] = [];
    let nIn = 0;
    let nLive = 0;
    for (const r of h.members) {
      const live = model.live(r.id);
      const plan = clock ? plannedSpot(r, town, clock) : null;
      let where = "?";
      if (live) {
        nLive++;
        where = "in the street, seen live";
      } else if (plan) {
        const home = plan.act === "home" || plan.place === "home" || (plan.indoor && near(plan.x, plan.z));
        if (home) {
          nIn++;
          inside.push({ kind: "resident", id: r.id, name: r.name, why: r.family_role, group: "Inside now, by the day plan" });
        }
        where = home ? (plan.act === "work" ? "working inside, by the plan" : "at home, by the plan") : `${actText(plan.act)} ${plan.label}, by the plan`;
      }
      living.push({ kind: "resident", id: r.id, name: r.name, why: `${r.family_role}: ${where}`, group: "Living here" });
    }
    // others the plan has inside at this door (a servant, the tavern's help)
    if (clock) {
      for (const r of town.residents) {
        if (h.members.includes(r) || model.live(r.id)) continue;
        const plan = plannedSpot(r, town, clock);
        if (plan.indoor && near(plan.x, plan.z)) inside.push({ kind: "resident", id: r.id, name: r.name, why: `${actText(plan.act)}, lives elsewhere`, group: "Inside now, by the day plan" });
      }
    }
    const hhRows = h.households.map((hh) => {
      const m = h.members.filter((r) => r.household === hh);
      const head = m.find((r) => r.family_role === "head") ?? m[0];
      return m.length === 1 ? `${head.name} (${head.family_role})` : `the ${head.surname} family (${m.length}, head ${head.name})`;
    });
    const rows: Row[] = [];
    if (h.near) rows.push(["Near", h.near.replace(/^near /, "")]);
    rows.push(["Building", h.inworld ? h.inworld : h.house >= 0 ? `house no. ${h.house} of the map` : "a door with no house on the map"]);
    rows.push(["Households", hhRows.join("; ")]);
    rows.push(["Now", clock ? `${nIn} of ${h.members.length} inside by the day plan, ${nLive} seen live in the street, ${h.members.length - nIn - nLive} out` : `${h.members.length} live here`]);
    rows.push(["Door", `x ${h.step[0].toFixed(1)}, z ${h.step[1].toFixed(1)}`]);
    return {
      kind,
      id,
      title: `Home of ${h.name}`,
      sub: `${h.members.length} ${h.members.length === 1 ? "person" : "people"}${h.near ? `, ${h.near}` : ""}`,
      sections: [{ title: "The house", rows }],
      links: [...living, ...inside],
      at: { x: h.step[0], z: h.step[1] },
    };
  }

  if (kind === "player") {
    const pid = Number(id);
    const p = model.player(pid);
    const rows: Row[] = [];
    if (p) {
      rows.push(["Seen", p.online ? (p.away ? "online, away from the keys" : "online") : "connection lost"]);
      rows.push(["Doing", String(p.mode)]);
      if (fin(p.vx) && fin(p.vz)) rows.push(["Speed", `${Math.hypot(p.vx, p.vz).toFixed(1)} m/s`]);
      rows.push(["Where", `x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)}, height ${p.y.toFixed(1)}`]);
    } else rows.push(["Seen", "not in the town now"]);
    rows.push(["Walks", `${model.walkCounts().get(pid) ?? 0} townspeople on his PC`]);
    const sections: Section[] = [{ title: "Now", rows }];
    if (pid === 1) {
      const me = one<{ money_c: number; food: number; warmth: number; health: number; sleep: number; district: string; rent_paid_until: number }>(
        db,
        "player",
        "SELECT money_c, food, warmth, health, sleep, district, rent_paid_until FROM player WHERE id = 1",
      );
      if (me)
        sections.push({
          title: "The host's man",
          rows: [
            ["Money", `${(me.money_c / 100).toFixed(2)} fr`],
            ["Needs", `food ${me.food}, warmth ${me.warmth}, health ${me.health}, sleep ${me.sleep}`],
            ["District", me.district],
            ["Rent paid", `to day ${me.rent_paid_until}`],
          ],
        });
      const jobs = all<{ title: string; status: string; day: number }>(db, "job", "SELECT title, status, day FROM job WHERE status IN ('taken', 'done', 'failed') ORDER BY id DESC LIMIT 6");
      if (jobs.length) sections.push({ title: "Jobs", rows: jobs.map((j) => [`day ${j.day}, ${j.status}`, j.title]) });
    } else {
      const g = one<{ name: string; admin: number; created_at: string; seen_at: string | null }>(db, "mp_player", "SELECT name, admin, created_at, seen_at FROM mp_player WHERE id = ?", pid);
      if (g) sections.push({ title: "Guest", rows: [["Joined", g.created_at], ["Last seen", g.seen_at ?? "-"], ["Admin", g.admin ? "yes" : "no"]] });
    }
    return { kind, id, title: p?.name ?? `Player ${pid}`, sub: pid === 1 || p?.host ? "the host" : "a guest", sections, links: [], at: p ? { x: p.x, z: p.z } : null };
  }

  if (kind === "world") {
    const w = model.worldState();
    const [key, ...rest] = id.split(":");
    const mid = rest.join(":");
    const list = w?.d[key];
    if (!Array.isArray(list)) return null;
    const idx = list.findIndex((o, i) => moverId(o, i) === mid);
    if (idx < 0) return null;
    const o = list[idx] as Record<string, unknown>;
    const rows: Row[] = Object.entries(o)
      .filter(([, val]) => val !== null && val !== undefined)
      .slice(0, 30)
      .map(([k, val]) => [k, typeof val === "number" ? String(Math.round(val * 100) / 100) : typeof val === "string" || typeof val === "boolean" ? String(val) : JSON.stringify(val).slice(0, 120)]);
    const p = moverPos(o);
    return { kind, id, title: typeof o.name === "string" ? o.name.slice(0, 60) : `${key} ${mid}`, sub: `the moving world, sent by the world PC ${w ? `${((model.now() - w.at) / 1000).toFixed(1)} s ago` : ""}`, sections: [{ title: "Now", rows }], links: [], at: p };
  }

  if (kind === "place") {
    const p = town?.places[id];
    if (!p || !town) return null;
    const rows: Row[] = [
      ["District", p.district],
      ["Spread", `${p.r} m`],
      ["Where", `x ${p.x.toFixed(1)}, z ${p.z.toFixed(1)}`],
    ];
    const here: Link[] = [];
    if (clock) {
      for (const r of town.residents) {
        const live = model.live(r.id);
        if (live) {
          if (Math.hypot(live.x - p.x, live.z - p.z) <= p.r + 6) here.push({ kind: "resident", id: r.id, name: r.name, why: "here, live" });
          continue;
        }
        const s = plannedSpot(r, town, clock);
        if (s.place === id || (s.act === "work" && r.work.place === id) || (s.act === "work" && r.work.shop === id)) here.push({ kind: "resident", id: r.id, name: r.name, why: `${actText(s.act)}, by the plan` });
      }
    }
    rows.push(["People", `${here.length} here now`]);
    return { kind, id, title: p.label, sub: id.startsWith("tavern:") ? "a tavern" : p.door ? "a shop" : "a place of the town", sections: [{ title: "Now", rows }], links: here.slice(0, 60), at: { x: p.x, z: p.z } };
  }

  if (kind === "event") {
    const e = one<{ id: number; day: number; title: string; template: string; place: string; x: number; z: number; r: number; start_m: number; end_m: number; stage: number; stages_json: string; people_json: string; status: string; source: string; notice: string; why: string }>(
      db,
      "town_event",
      "SELECT * FROM town_event WHERE id = ?",
      Number(id),
    );
    if (!e) return null;
    let people: string[] = [];
    try {
      people = JSON.parse(e.people_json) as string[];
    } catch {
      /* none */
    }
    const rows: Row[] = [
      ["Status", `${e.status}, stage ${e.stage + 1}`],
      ["When", `${whenMin(e.start_m)} to ${whenMin(e.end_m)}`],
      ["Where", e.place],
      ["Made by", `${e.source} (${e.template})`],
    ];
    if (e.notice) rows.push(["Notice", e.notice]);
    if (e.why) rows.push(["Why", e.why]);
    const links = people.map((pid) => {
      const r = town ? residentOf(town, pid) : undefined;
      return { kind: "resident", id: pid, name: r?.name ?? pid, why: "in it" };
    });
    return { kind, id, title: e.title, sub: "a town event", sections: [{ title: "Now", rows }], links, at: { x: e.x, z: e.z } };
  }
  return null;
}

export interface History {
  trail: Array<[number, number, number]>;
  changes: Array<{ at: number; game: string | null; text: string }>;
  db: Array<{ when: string; kind: string; text: string }>;
}

/** The thing's trail and changes kept by the model, and what the save remembers of it. */
export function history(v: ViewDeps, kind: string, id: string): History {
  const { model, db } = v;
  const trail = model.trail(kind === "dog" ? "resident" : kind, id).map(([t, x, z]) => [t, r1(x), r1(z)] as [number, number, number]);
  const changes = model.changes(kind === "dog" ? "resident" : kind, id).slice(0, 100);
  const out: History["db"] = [];
  const push = (w: string, k: string, text: string) => out.push({ when: w, kind: k, text: text.slice(0, 400) });
  if (kind === "resident") {
    for (const e of all<{ day: number; hour: number; minute: number; kind: string; verb: string; text: string }>(
      db,
      "world_event",
      `SELECT day, hour, minute, kind, verb, text FROM world_event
        WHERE id IN (SELECT event_id FROM world_event_who WHERE who = ?) OR actor = ? OR target = ?
        ORDER BY id DESC LIMIT 25`,
      id,
      id,
      id,
    ))
      push(when(e.day, e.hour, e.minute), e.kind === e.verb ? e.kind : `${e.kind}: ${e.verb}`, e.text);
    for (const m of all<{ day: number; text: string; source: string; weight: number; gist: string | null }>(db, "npc_memory", "SELECT day, text, source, weight, gist FROM npc_memory WHERE npc_id = ? ORDER BY id DESC LIMIT 15", id))
      push(`day ${m.day}`, `memory (${m.source}, weight ${m.weight})`, m.gist ? `${m.text} [rumour: ${m.gist}]` : m.text);
    for (const a of all<{ kind: string; target: string; reason: string; source: string; status: string; started: number; outcome: string | null }>(
      db,
      "npc_action",
      "SELECT kind, target, reason, source, status, started, outcome FROM npc_action WHERE npc_id = ? ORDER BY id DESC LIMIT 10",
      id,
    ))
      push(whenMin(a.started), `action ${a.status}`, `${a.kind}${a.target ? ` ${a.target}` : ""} (${a.source}${a.reason ? `: ${a.reason}` : ""})${a.outcome ? ` - ${a.outcome}` : ""}`);
    for (const f of all<{ day: number; minute: number; teller: string; listener: string; gist: string; status: string; reaction: string | null }>(
      db,
      "family_news",
      "SELECT day, minute, teller, listener, gist, status, reaction FROM family_news WHERE teller = ? OR listener = ? ORDER BY id DESC LIMIT 8",
      id,
      id,
    ))
      push(when(f.day, Math.floor(f.minute / 60) % 24, f.minute % 60), `family news (${f.status})`, `${f.teller === id ? "told" : "heard"}: ${f.gist}${f.reaction ? ` (${f.reaction})` : ""}`);
    for (const d of all<{ day: number; hour: number; minute: number; thing: string; item: string; status: string; seen: number }>(
      db,
      "deed",
      "SELECT day, hour, minute, thing, item, status, seen FROM deed WHERE owner = ? ORDER BY id DESC LIMIT 8",
      id,
    ))
      push(when(d.day, d.hour, d.minute), "taken from him", `${d.item} from ${d.thing} (${d.status}${d.seen ? ", seen" : ""})`);
    for (const e of all<{ day: number; title: string; status: string }>(db, "town_event", "SELECT day, title, status FROM town_event WHERE people_json LIKE ? ORDER BY id DESC LIMIT 8", `%"${id.replace(/[%_"]/g, "")}"%`))
      push(`day ${e.day}`, `town event (${e.status})`, e.title);
  } else if (kind === "house") {
    const h = v.town ? homesOf(v.town).byId.get(id) : undefined;
    if (h) {
      const ids = h.members.map((r) => r.id);
      const name = new Map(h.members.map((r) => [r.id, r.name]));
      const who = (rid: string) => name.get(rid) ?? (v.town ? residentOf(v.town, rid)?.name : undefined) ?? rid;
      const q = ids.map(() => "?").join(", ");
      for (const e of all<{ day: number; hour: number; minute: number; kind: string; verb: string; text: string }>(
        db,
        "world_event",
        `SELECT day, hour, minute, kind, verb, text FROM world_event
          WHERE id IN (SELECT event_id FROM world_event_who WHERE who IN (${q})) OR actor IN (${q}) OR target IN (${q})
          ORDER BY id DESC LIMIT 30`,
        ...ids,
        ...ids,
        ...ids,
      ))
        push(when(e.day, e.hour, e.minute), e.kind === e.verb ? e.kind : `${e.kind}: ${e.verb}`, e.text);
      for (const f of all<{ day: number; minute: number; teller: string; listener: string; gist: string; status: string; reaction: string | null }>(
        db,
        "family_news",
        `SELECT day, minute, teller, listener, gist, status, reaction FROM family_news WHERE teller IN (${q}) OR listener IN (${q}) ORDER BY id DESC LIMIT 15`,
        ...ids,
        ...ids,
      ))
        push(when(f.day, Math.floor(f.minute / 60) % 24, f.minute % 60), `family news (${f.status})`, `${who(f.teller)} to ${who(f.listener)}: ${f.gist}${f.reaction ? ` (${f.reaction})` : ""}`);
      for (const d of all<{ day: number; hour: number; minute: number; owner: string; thing: string; item: string; status: string }>(
        db,
        "deed",
        `SELECT day, hour, minute, owner, thing, item, status FROM deed WHERE owner IN (${q}) ORDER BY id DESC LIMIT 10`,
        ...ids,
      ))
        push(when(d.day, d.hour, d.minute), "taken from the house", `${d.item} from ${d.thing}, ${who(d.owner)}'s (${d.status})`);
    }
  } else if (kind === "player" && id === "1") {
    for (const e of all<{ day: number; hour: number; minute: number; kind: string; verb: string; text: string }>(
      db,
      "world_event",
      "SELECT day, hour, minute, kind, verb, text FROM world_event WHERE actor = 'player' OR target = 'player' ORDER BY id DESC LIMIT 30",
    ))
      push(when(e.day, e.hour, e.minute), e.kind === e.verb ? e.kind : `${e.kind}: ${e.verb}`, e.text);
  } else if (kind === "place") {
    for (const e of all<{ day: number; hour: number; minute: number; kind: string; verb: string; text: string }>(
      db,
      "world_event",
      "SELECT day, hour, minute, kind, verb, text FROM world_event WHERE place = ? ORDER BY id DESC LIMIT 20",
      id,
    ))
      push(when(e.day, e.hour, e.minute), e.kind, e.text);
  }
  return { trail, changes, db: out };
}

/** For tests and the page: the key the model files a thing under. */
export { keyOf };
