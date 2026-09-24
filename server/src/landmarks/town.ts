import type { DB } from "../db.ts";
import { dropTownCache, town } from "../town/store.ts";
import { houseDoors, type HouseDoor } from "../town/walkmap.ts";
import { TRADES, type TradeId } from "../town/places.ts";
import { tidy, type Resident, type Stats } from "../town/population.ts";
import type { Seg } from "../town/schedule.ts";
import { LANDMARK_DOORS, LANDMARK_LABEL, type LandmarkId } from "../../../shared/landmarks.ts";

// The people who work inside the landmarks (M6 landmark interiors). Runs on every start and
// after a new game (db.ts), in place and once: an older save gets these residents added and
// nothing else changes (every other resident row, memory, relationship, the money). They work
// "inside": the street sees them walk to the landmark's door and go in; the interior shows
// them at their work (server/src/landmarks/life.ts). The town's own priest, sexton and the two
// town-hall clerks stay who they are and are drawn inside too when their hours say so.
// The record is world_state 'landmarks'. Each newcomer gets a house nobody lives in near the
// landmark, or lodges in a house of the town when none is free.

export const LANDMARKS_TOWN_VERSION = 1;
const STATE_KEY = "landmarks";

/** The place id each landmark has in the town's places (for talk and the path check). */
export const LANDMARK_PLACE: Record<LandmarkId, string> = {
  cathedral: "landmark:cathedral",
  townhall: "landmark:townhall",
  vleeshuis: "landmark:vleeshuis",
  steen: "landmark:steen",
  oostershuis: "landmark:oostershuis",
};

interface Newcomer {
  id: string;
  first: string;
  surname: string;
  /** Shown name, if not "first surname" (the curate is "Father Norbert Stessens"). */
  name?: string;
  age: number;
  sex: "m" | "f";
  trade: TradeId;
  kind: string;
  landmark: LandmarkId;
  stats: Stats;
  day: Seg[];
  sunday: Seg[];
  /** The npc row's role, in words. */
  role: string;
}

const S = (honesty: number, temper: number, piety: number, warmth: number, greed: number, courage: number, gossip: number, wealth: number): Stats => ({ honesty, temper, piety, warmth, greed, courage, gossip, wealth });
const CHURCH: Seg = [8.75, 11, "church", "church"];

/** The engine's newcomers, fixed: names of the time, trades, hours. */
export const NEWCOMERS: Newcomer[] = [
  // the cathedral: the curate who says the weekday masses and hears confession, the organist, the beadle (the "suisse"), the chair woman
  { id: "lm_curate", first: "Norbert", surname: "Stessens", name: "Father Norbert Stessens", age: 38, sex: "m", trade: "priest", kind: "priest", landmark: "cathedral", stats: S(8, 3, 9, 7, 2, 6, 1, 3), day: [[6.5, 12.5, "work"], [14.25, 18.75, "work"]], sunday: [[6.25, 12, "work"], [14.5, 16.5, "work"]], role: "curate of the cathedral" },
  { id: "lm_organist", first: "Lodewijk", surname: "Bosmans", age: 51, sex: "m", trade: "organist", kind: "clerk", landmark: "cathedral", stats: S(7, 5, 7, 5, 3, 3, 4, 3), day: [[13.25, 15.25, "work"]], sunday: [[8.5, 11.25, "work"], [14.5, 16.25, "work"]], role: "organist of the cathedral" },
  { id: "lm_beadle", first: "Pieter", surname: "Dierckx", age: 56, sex: "m", trade: "beadle", kind: "police", landmark: "cathedral", stats: S(7, 7, 7, 3, 3, 6, 5, 2), day: [[6.75, 12, "work"]], sunday: [[6.5, 12, "work"], [14.5, 16.25, "work"]], role: "beadle of the cathedral" },
  { id: "lm_chairs", first: "Trees", surname: "Vinck", age: 63, sex: "f", trade: "chair_woman", kind: "old_woman", landmark: "cathedral", stats: S(6, 5, 8, 5, 5, 3, 8, 1), day: [[6.5, 12, "work"], [14.5, 17.5, "work"]], sunday: [[6.25, 12, "work"], [14.5, 16.25, "work"]], role: "chair woman of the cathedral" },
  // the town hall: the registrar of the civil registry, the alderman who marries couples, a young clerk, the porter
  { id: "lm_registrar", first: "Emiel", surname: "Wuyts", age: 46, sex: "m", trade: "registrar", kind: "clerk", landmark: "townhall", stats: S(8, 4, 5, 4, 3, 3, 3, 4), day: [[8.75, 12.5, "work"], [13.5, 16.25, "work"]], sunday: [CHURCH], role: "clerk of the civil registry" },
  { id: "lm_alderman", first: "Jan-Baptist", surname: "Gevers", age: 58, sex: "m", trade: "alderman", kind: "gentleman", landmark: "townhall", stats: S(6, 5, 6, 5, 5, 5, 4, 8), day: [[10.25, 13, "work"]], sunday: [CHURCH], role: "alderman of the civil registry" },
  { id: "lm_copyclerk", first: "Karel", surname: "Hendrickx", age: 24, sex: "m", trade: "clerk", kind: "clerk", landmark: "townhall", stats: S(6, 4, 4, 6, 4, 4, 7, 3), day: [[9, 12.5, "work"], [13.5, 16, "work"]], sunday: [], role: "clerk at the town hall" },
  { id: "lm_concierge", first: "Gust", surname: "Laureys", age: 61, sex: "m", trade: "concierge", kind: "old_man", landmark: "townhall", stats: S(7, 6, 6, 4, 3, 4, 8, 2), day: [[8.5, 16.5, "work"]], sunday: [CHURCH], role: "porter of the town hall" },
  // the Vleeshuis: Peyrot's cellar master and three cellarmen; a painter who rents a studio upstairs
  { id: "lm_cellarmaster", first: "Constant", surname: "Maes", age: 49, sex: "m", trade: "cellar_master", kind: "shopkeeper", landmark: "vleeshuis", stats: S(6, 5, 4, 5, 6, 4, 5, 4), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [CHURCH], role: "cellar master of Peyrot's wine warehouse" },
  { id: "lm_cellar1", first: "Rik", surname: "Smets", age: 31, sex: "m", trade: "cellarman", kind: "docker_a", landmark: "vleeshuis", stats: S(6, 6, 3, 6, 4, 6, 5, 1), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [], role: "cellarman at Peyrot's" },
  { id: "lm_cellar2", first: "Jozef", surname: "Aerts", age: 27, sex: "m", trade: "cellarman", kind: "docker_b", landmark: "vleeshuis", stats: S(5, 5, 5, 7, 4, 5, 6, 1), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [CHURCH], role: "cellarman at Peyrot's" },
  { id: "lm_cellar3", first: "Staf", surname: "De Backer", age: 38, sex: "m", trade: "cellarman", kind: "docker_c", landmark: "vleeshuis", stats: S(6, 7, 3, 4, 5, 7, 4, 1), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [], role: "cellarman at Peyrot's" },
  { id: "lm_painter", first: "Edmond", surname: "Van Havermaet", age: 34, sex: "m", trade: "painter", kind: "gentleman", landmark: "vleeshuis", stats: S(6, 6, 3, 6, 4, 5, 6, 3), day: [[9, 12.5, "work"], [13.5, 16.5, "work"]], sunday: [], role: "painter with a studio in the Vleeshuis" },
  // the Steen: the attendant who keeps the halls of the Museum of Antiquities
  { id: "lm_custodian", first: "Leonard", surname: "Van Dessel", age: 61, sex: "m", trade: "attendant", kind: "clerk", landmark: "steen", stats: S(8, 4, 6, 6, 2, 3, 6, 2), day: [[9.75, 16.25, "work"]], sunday: [[9.75, 16.25, "work"]], role: "attendant of the Museum of Antiquities" },
  // the Oostershuis: the State's storekeeper and four natie men who carry for him
  { id: "lm_storekeeper", first: "August", surname: "Claessens", age: 52, sex: "m", trade: "storekeeper", kind: "clerk", landmark: "oostershuis", stats: S(7, 6, 5, 4, 4, 4, 4, 4), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [CHURCH], role: "storekeeper of the State warehouse" },
  { id: "lm_porter1", first: "Remi", surname: "Wouters", age: 29, sex: "m", trade: "natie", kind: "docker_sack", landmark: "oostershuis", stats: S(6, 5, 4, 6, 4, 6, 5, 1), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [], role: "natie man at the Oostershuis" },
  { id: "lm_porter2", first: "Louis", surname: "Janssen", age: 35, sex: "m", trade: "natie", kind: "docker_sack", landmark: "oostershuis", stats: S(5, 6, 5, 5, 5, 6, 4, 1), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [CHURCH], role: "natie man at the Oostershuis" },
  { id: "lm_porter3", first: "Cyriel", surname: "Goris", age: 26, sex: "m", trade: "natie", kind: "docker_sack", landmark: "oostershuis", stats: S(6, 4, 4, 7, 3, 5, 6, 1), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [], role: "natie man at the Oostershuis" },
  { id: "lm_porter4", first: "Seppe", surname: "Lambrechts", age: 41, sex: "m", trade: "natie", kind: "docker_sack", landmark: "oostershuis", stats: S(7, 5, 6, 5, 4, 7, 3, 2), day: [[7, 12, "work"], [13, 18, "work"]], sunday: [CHURCH], role: "natie man at the Oostershuis" },
];
export const NEWCOMER_IDS = NEWCOMERS.map((n) => n.id);

/** Which landmark a newcomer works in (the town's own priest, sexton and clerks come from their work place). */
export function newcomerLandmark(id: string): LandmarkId | null {
  return NEWCOMERS.find((n) => n.id === id)?.landmark ?? null;
}

function mainDoor(id: LandmarkId) {
  return LANDMARK_DOORS.find((d) => d.landmark === id)!;
}

function district(x: number, z: number): string {
  if (x > 40) return "eilandje";
  if (x > -40) return "rijnkaai";
  if (x > -150) return z > 60 ? "canal" : "vismarkt";
  return z > 60 ? "grote-markt" : "steenplein";
}

/** A house nobody lives or works behind, near the anchor (not a shop, a place, a home to let). */
function freeHouse(db: DB, anchor: [number, number], skip: Set<number>): HouseDoor | null {
  const t = town(db).town;
  const houses = new Set(t.residents.map((r) => r.home.house));
  const taken: Array<[number, number]> = [];
  for (const r of t.residents) {
    taken.push([r.home.sx, r.home.sz]);
    if (r.work.door) taken.push(r.work.door);
  }
  for (const p of Object.values(t.places)) if (p.door) taken.push(p.door);
  for (const s of t.shops) taken.push(s.door);
  // the homes to let, the Poesje, the post office and the newsboys' corners keep their doors
  for (const key of ["homes", "poesje:door", "press"]) {
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
    if (!row) continue;
    const v = JSON.parse(row.value_json) as { sx?: number; sz?: number; homes?: Array<{ step: [number, number]; house: number }>; dealer?: { step: [number, number] } | null; post?: { step: [number, number] } | null; corners?: Array<{ x: number; z: number }> };
    if (typeof v.sx === "number" && typeof v.sz === "number") taken.push([v.sx, v.sz]);
    for (const h of v.homes ?? []) {
      taken.push(h.step);
      skip.add(h.house);
    }
    if (v.dealer) taken.push(v.dealer.step);
    if (v.post) taken.push(v.post.step);
    for (const c of v.corners ?? []) taken.push([c.x, c.z]);
  }
  const free = houseDoors().filter((d) => !houses.has(d.house) && !skip.has(d.house) && !taken.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 4));
  free.sort((a, b) => Math.hypot(a.sx - anchor[0], a.sz - anchor[1]) - Math.hypot(b.sx - anchor[0], b.sz - anchor[1]));
  const d = free[0];
  return d && Math.hypot(d.sx - anchor[0], d.sz - anchor[1]) < 220 ? d : null;
}

/** Lodging: the house of an older resident of the town nearest the anchor (a room let to a lodger). */
function lodgingHouse(db: DB, anchor: [number, number]): Resident | null {
  const t = town(db).town;
  let best: Resident | null = null;
  let bd = Infinity;
  for (const r of t.residents) {
    if (r.age < 40 || r.work.kind === "wait" || r.id.startsWith("stranger_") || r.id === "fortune") continue;
    const d = Math.hypot(r.home.sx - anchor[0], r.home.sz - anchor[1]);
    if (d < bd) [best, bd] = [r, d];
  }
  return best;
}

export interface LandmarksTown {
  v: number;
  added: string[];
}

/** Make sure the landmarks' people and places are in this town. Idempotent; returns the ids it added. */
export function ensureLandmarksTown(db: DB): string[] {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return [];
  const have = new Set((db.prepare(`SELECT id FROM resident WHERE id IN (${NEWCOMER_IDS.map(() => "?").join(", ")})`).all(...NEWCOMER_IDS) as Array<{ id: string }>).map((r) => r.id));
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(STATE_KEY) as { value_json: string } | undefined;
  const rec: LandmarksTown = row ? (JSON.parse(row.value_json) as LandmarksTown) : { v: LANDMARKS_TOWN_VERSION, added: [] };
  const placesDone = (() => {
    const places = town(db).town.places;
    return Object.values(LANDMARK_PLACE).every((k) => k in places);
  })();
  if (have.size === NEWCOMERS.length && placesDone && rec.v === LANDMARKS_TOWN_VERSION && row) return [];

  const added: string[] = [];
  db.transaction(() => {
    // the landmarks as places of the town: their door step (talk says where people work; the path check reaches them)
    const trow = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
    if (trow) {
      const rest = JSON.parse(trow.value_json) as { places: Record<string, unknown> };
      for (const [id, key] of Object.entries(LANDMARK_PLACE) as Array<[LandmarkId, string]>) {
        if (rest.places[key]) continue;
        const d = mainDoor(id);
        rest.places[key] = { label: LANDMARK_LABEL[id], x: d.step[0], z: d.step[1], r: 3, district: district(d.step[0], d.step[1]), door: d.step, out: d.out };
      }
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
      dropTownCache(db);
    }

    const t = town(db).town;
    let hh = Math.max(0, ...t.residents.map((r) => r.household));
    const skip = new Set<number>();
    const insNpc = db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)");
    const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
    const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
    const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
    for (const nc of NEWCOMERS) {
      if (have.has(nc.id) || hasNpc.get(nc.id)) continue;
      const d = mainDoor(nc.landmark);
      const anchor: [number, number] = [d.step[0], d.step[1]];
      const house = freeHouse(db, anchor, skip);
      let home: Resident["home"];
      let family = "single";
      const household = ++hh;
      if (house) {
        skip.add(house.house);
        home = { house: house.house, x: house.x, z: house.z, sx: house.sx, sz: house.sz };
      } else {
        const host = lodgingHouse(db, anchor)!;
        home = { ...host.home };
        family = "lodger";
      }
      const r: Resident = {
        id: nc.id,
        first: nc.first,
        surname: nc.surname,
        name: nc.name ?? `${nc.first} ${nc.surname}`,
        age: nc.age,
        sex: nc.sex,
        household,
        family_role: family,
        trade: nc.trade,
        faction: TRADES[nc.trade].faction,
        kind: nc.kind,
        home,
        work: { place: LANDMARK_PLACE[nc.landmark], kind: "inside", door: [d.step[0], d.step[1]] },
        sched: { day: tidy(nc.day.map((s) => [...s] as Seg)), sunday: tidy(nc.sunday.map((s) => [...s] as Seg)) },
        stats: nc.stats,
        dog: null,
      };
      insNpc.run(r.id, r.name, nc.role, district(home.sx, home.sz), r.faction);
      insRel.run(r.id);
      insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
      added.push(r.id);
      // the town cache must see this one's house before the next looks for a free one
      dropTownCache(db);
    }
    rec.v = LANDMARKS_TOWN_VERSION;
    rec.added = [...new Set([...rec.added, ...added])];
    db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(STATE_KEY, JSON.stringify(rec));
  })();
  dropTownCache(db);
  return added;
}
