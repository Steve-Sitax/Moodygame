import type { DB } from "../db.ts";
import { dropTownCache, town } from "./store.ts";
import { houseDoors, walkMap, type HouseDoor } from "./walkmap.ts";
import type { Resident, Stats } from "./population.ts";
import type { Schedule } from "./schedule.ts";
import type { TradeId } from "./places.ts";

// People who are not of the town (M6 surprises): Madame Zelie, the fortune teller with her
// little table and cards on the Grote Markt by day, and five places kept for strangers off
// the ships (a sailor, a merchant, a runaway, a preacher, a gambler). A stranger's place is a
// resident row whose day is all "home" (out of sight, in a lodging by the quays) until the
// engine lets someone arrive (director/surprises.ts gives them a name, a story and a day
// about the town); when they leave, the day is "home" again. The ENGINE makes these rows;
// a model only words a stranger's name and story later.
//
// Runs on every start and after a new game (db.ts), in place and once, like the post clerk:
// rows are added, nothing else is touched. No imports from the director (db.ts imports this).

export const FORTUNE_ID = "fortune";
export const STRANGER_KINDS = ["sailor", "merchant", "runaway", "preacher", "gambler"] as const;
export type StrangerKind = (typeof STRANGER_KINDS)[number];
export const strangerId = (k: StrangerKind) => `stranger_${k}`;
export const STRANGER_IDS = STRANGER_KINDS.map(strangerId);

/** What a visitor carries in the resident row (not part of the town's own Resident type). */
export interface Visitor {
  role: "fortune" | "stranger";
  kind?: StrangerKind;
  /** The label the client shows ("a stranger off the ships"), instead of the trade's. */
  label: string;
  /** Strangers: here or away; the day they came and the day they leave. */
  here?: boolean;
  came?: number;
  leaves?: number;
  /** A stranger's story (model words, checked; or the engine's). The secret is never shown to Jef. */
  story?: string;
  goal?: string;
  secret?: string;
  greeting?: string;
  origin?: string;
}
export type VisitorResident = Resident & { visitor?: Visitor };

export function visitorOf(r: Resident | undefined | null): Visitor | null {
  return (r as VisitorResident | undefined)?.visitor ?? null;
}

/** A stranger whose place is empty now (not arrived, or gone): nobody may use them for anything. */
export function isAwayVisitor(r: Resident | undefined | null): boolean {
  const v = visitorOf(r);
  return !!v && v.role === "stranger" && !v.here;
}

/** Away all day: indoors at the lodging. */
export const AWAY: Schedule = { day: [[0, 24, "home"]], sunday: [[0, 24, "home"]] };

/** Where Madame Zelie sets her table: the east side of the Grote Markt, facing into the square. */
const FORTUNE_AT: [number, number] = [-240, 101];
const FORTUNE_LOOK: [number, number] = [-254, 94];
/** The strangers' lodging: a house by the Steenplein and the Werf (sailors' lodging houses stood there). */
const LODGING_AT: [number, number] = [-200, 34];

const STRANGER_SEED: Record<StrangerKind, { sex: "m" | "f"; age: number; trade: TradeId; model: string; label: string; stats: Stats }> = {
  sailor: { sex: "m", age: 34, trade: "sailor", model: "sailor", label: "a stranger off the ships, a sailor", stats: { honesty: 5, temper: 6, piety: 3, warmth: 6, greed: 5, courage: 7, gossip: 7, wealth: 3 } },
  merchant: { sex: "m", age: 47, trade: "merchant", model: "gentleman", label: "a stranger off the ships, a merchant", stats: { honesty: 5, temper: 4, piety: 5, warmth: 5, greed: 7, courage: 5, gossip: 5, wealth: 8 } },
  runaway: { sex: "f", age: 17, trade: "maid", model: "maid", label: "a stranger, a girl with a bundle", stats: { honesty: 6, temper: 4, piety: 5, warmth: 6, greed: 3, courage: 4, gossip: 3, wealth: 1 } },
  preacher: { sex: "m", age: 52, trade: "retired", model: "clerk", label: "a stranger, a travelling preacher", stats: { honesty: 7, temper: 5, piety: 10, warmth: 5, greed: 2, courage: 7, gossip: 6, wealth: 2 } },
  gambler: { sex: "m", age: 39, trade: "sailor", model: "stranger", label: "a stranger off the ships, a card player", stats: { honesty: 2, temper: 5, piety: 1, warmth: 7, greed: 8, courage: 6, gossip: 6, wealth: 5 } },
};

/** The names a place keeps while nobody fills it (the engine's; a stranger gets their own on arrival). */
const PLACEHOLDER: Record<StrangerKind, [string, string]> = {
  sailor: ["Hendrik", "Aalders"],
  merchant: ["Arnold", "Brugmann"],
  runaway: ["Mietje", "Claes"],
  preacher: ["Josephus", "Terlinck"],
  gambler: ["Victor", "Delorme"],
};

function freeDoor(residents: Resident[], places: Record<string, { door?: [number, number] }>, anchor: [number, number], skip: Set<number>): HouseDoor | null {
  const houses = new Set(residents.map((r) => r.home.house));
  const taken: Array<[number, number]> = [];
  for (const r of residents) {
    taken.push([r.home.sx, r.home.sz]);
    if (r.work.door) taken.push(r.work.door);
  }
  for (const p of Object.values(places)) if (p.door) taken.push(p.door);
  const free = houseDoors().filter((d) => !houses.has(d.house) && !skip.has(d.house) && !taken.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 4));
  free.sort((a, b) => Math.hypot(a.sx - anchor[0], a.sz - anchor[1]) - Math.hypot(b.sx - anchor[0], b.sz - anchor[1]));
  return free[0] ?? null;
}

/** Make sure Madame Zelie and the five strangers' places exist. Idempotent; returns how many rows it added. */
export function ensureVisitors(db: DB): number {
  const n = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (n === 0) return 0;
  const want = [FORTUNE_ID, ...STRANGER_IDS];
  const have = new Set((db.prepare(`SELECT id FROM resident WHERE id IN (${want.map(() => "?").join(", ")})`).all(...want) as Array<{ id: string }>).map((r) => r.id));
  if (have.size === want.length) return 0;
  const t = town(db).town;
  const wm = walkMap();
  const snap = (x: number, z: number): [number, number] => {
    const q = wm.nearestOpen(x, z, 8) ?? { x, z };
    return [q.x, q.z];
  };
  const hasNpc = db.prepare("SELECT 1 FROM npc WHERE id = ?");
  const insNpc = db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, NULL, '{}', NULL, 1)");
  const insRel = db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)");
  const insRes = db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)");
  let hh = Math.max(0, ...t.residents.map((r) => r.household)) + 1;
  const usedHouses = new Set<number>();
  let added = 0;
  const add = (r: VisitorResident, district: string) => {
    if (have.has(r.id) || hasNpc.get(r.id)) return;
    insNpc.run(r.id, r.name, r.visitor!.label, district);
    insRel.run(r.id);
    insRes.run(r.id, r.household, r.trade, JSON.stringify(r));
    added++;
  };
  db.transaction(() => {
    // Madame Zelie, the fortune teller: her table by day on the Grote Markt, her room nearby
    if (!have.has(FORTUNE_ID)) {
      const door = freeDoor(t.residents, t.places, [-230, 112], usedHouses);
      const [x, z] = snap(FORTUNE_AT[0], FORTUNE_AT[1]);
      if (door) usedHouses.add(door.house);
      const home = door ?? houseDoors()[0];
      add(
        {
          id: FORTUNE_ID,
          first: "Zelie",
          surname: "Vermandel",
          name: "Madame Zelie",
          age: 58,
          sex: "f",
          household: hh++,
          family_role: "widow",
          trade: "retired",
          faction: null,
          kind: "old_woman",
          home: { house: home.house, x: home.x, z: home.z, sx: home.sx, sz: home.sz },
          work: { place: "grote_markt", kind: "post", at: [x, z, Math.atan2(FORTUNE_LOOK[0] - x, FORTUNE_LOOK[1] - z)] },
          sched: { day: [[9.5, 12.5, "work"], [13.25, 17.5, "work"]], sunday: [[13.5, 17, "work"]] },
          stats: { honesty: 4, temper: 3, piety: 4, warmth: 6, greed: 6, courage: 6, gossip: 9, wealth: 2 },
          dog: null,
          visitor: { role: "fortune", label: "a fortune teller with cards" },
        },
        "grote-markt",
      );
    }
    // the strangers' places: one lodging house by the Steenplein, all away until the engine brings one
    const lodging = freeDoor(t.residents, t.places, LODGING_AT, usedHouses) ?? houseDoors()[0];
    const lhh = hh++;
    for (const k of STRANGER_KINDS) {
      const s = STRANGER_SEED[k];
      const [first, surname] = PLACEHOLDER[k];
      add(
        {
          id: strangerId(k),
          first,
          surname,
          name: `${first} ${surname}`,
          age: s.age,
          sex: s.sex,
          household: lhh,
          family_role: "lodger",
          trade: s.trade,
          faction: null,
          kind: s.model,
          home: { house: lodging.house, x: lodging.x, z: lodging.z, sx: lodging.sx, sz: lodging.sz },
          work: { place: "visitor", kind: "roam", route: [[lodging.sx, lodging.sz]] },
          sched: AWAY,
          stats: { ...s.stats },
          dog: null,
          visitor: { role: "stranger", kind: k, label: s.label, here: false },
        },
        "steenplein",
      );
    }
  })();
  if (added) dropTownCache(db);
  return added;
}

/** Write a visitor's row back (a stranger arrives or leaves). The town cache is dropped. */
export function saveVisitor(db: DB, r: VisitorResident): void {
  db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(r), r.id);
  db.prepare("UPDATE npc SET name = ?, role = ? WHERE id = ?").run(r.name, r.visitor?.label ?? "", r.id);
  dropTownCache(db);
}
