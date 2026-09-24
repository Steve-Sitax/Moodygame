import type { DB } from "../db.ts";
import { dropTownCache, town } from "../town/store.ts";
import { houseDoors, walkMap, type HouseDoor } from "../town/walkmap.ts";
import { TRADES } from "../town/places.ts";
import { rngFrom, type Resident } from "../town/population.ts";
import { CLASSES, HOME_CLASSES, type HomeClass } from "../../../shared/homes.ts";

// Homes to rent in the town (M6 homes). Runs on every start and after a new game. For an
// older save it works in place, once: five house doors that nobody lives or works behind
// become homes to let (a cellar room, a garret, a small house in an alley, a merchant's
// upper floor on the quay), a NEW resident widow in a free house lets her spare room, and a
// NEW resident second-hand dealer keeps a shop with furniture out on the pavement.
// Everyone else, their memories and relationships, stay as they were. The record is
// world_state 'homes'. The tables are made by db.ts (HOMES_SCHEMA).

export const HOMES_SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS home_lease (
  id INTEGER PRIMARY KEY,
  home TEXT NOT NULL,
  since_day INTEGER NOT NULL,
  paid_through INTEGER NOT NULL,
  warned_day INTEGER NOT NULL DEFAULT 0,
  ended TEXT
);
CREATE TABLE IF NOT EXISTS home_item (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pocket','arms','stored','placed','gone')),
  home TEXT,
  gx INTEGER, gz INTEGER, rot INTEGER NOT NULL DEFAULT 0,
  day INTEGER NOT NULL
);
`;
export const HOMES_TABLES = ["home_item", "home_lease"];

export interface HomeDef {
  id: HomeClass;
  cls: HomeClass;
  /** "the garret in the Schipperskwartier" */
  label: string;
  house: number;
  /** The step outside, the door in the wall, out of the house. */
  step: [number, number];
  wall: [number, number];
  out: [number, number];
  landlord: string;
}

export interface Dealer {
  id: string;
  label: string;
  step: [number, number];
  wall: [number, number];
  out: [number, number];
  /** Where he stands, and his furniture on the pavement (world). */
  at: [number, number, number];
}

export interface HomesTown {
  v: 1;
  homes: HomeDef[];
  dealer: Dealer | null;
  widow: string | null;
}

/** Where each kind of home is looked for (world metres), and what the house must be. */
const WANT: Record<HomeClass, { anchor: [number, number]; where: string; ok: (d: HouseDoor, lane: number) => boolean }> = {
  // the sailors' quarter north of the Vleeshuis: tall houses with rooms under the roof
  garret: { anchor: [-120, 117], where: "in the Schipperskwartier", ok: (d) => d.storeys >= 4 },
  // down by the canal, a cellar door beside the steps
  cellar: { anchor: [-90, 133], where: "by the Canal des Brasseurs", ok: (d) => d.storeys >= 2 },
  // a narrow lane between two rows of house fronts: a "gang"
  alley: { anchor: [-307, 284], where: "behind the cathedral", ok: (d, lane) => lane < 5 && d.storeys <= 3 },
  // the Rijnkaai, facing the river, over a counting house
  merchant: { anchor: [-16, 45], where: "on the Rijnkaai", ok: (d) => d.storeys >= 3 && d.out[1] < -0.7 },
  // the widow's own house: between the Vismarkt and the Grote Markt
  widow: { anchor: [-175, 75], where: "near the Vismarkt", ok: (d) => d.storeys >= 2 && d.storeys <= 4 },
};
const DEALER_ANCHOR: [number, number] = [-207, 69];
export const DEALER_ID = "dealer";
export const WIDOW_ID = "widow_landlady";

export function homesTown(db: DB): HomesTown | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'homes'").get() as { value_json: string } | undefined;
  if (!row) return null;
  const h = JSON.parse(row.value_json) as HomesTown;
  // the label is always today's words (a save keeps the door, not the wording)
  for (const d of h.homes) d.label = `${CLASSES[d.cls].label} ${WANT[d.cls].where}`;
  return h;
}

function saveHomes(db: DB, h: HomesTown): void {
  db.prepare("INSERT INTO world_state (key, value_json) VALUES ('homes', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(JSON.stringify(h));
}

export function homeDef(db: DB, id: string): HomeDef | undefined {
  return homesTown(db)?.homes.find((h) => h.id === id);
}

/** How far the lane runs out from a door before a wall: an alley is narrow. */
function laneWidth(d: HouseDoor): number {
  const wm = walkMap();
  let w = 0;
  for (let s = 0; s < 40; s += 0.25) {
    if (!wm.open(d.sx + d.out[0] * s, d.sz + d.out[1] * s, 0.1)) break;
    w = s;
  }
  return w + Math.hypot(d.sx - d.x, d.sz - d.z);
}

/** Doors nobody lives or works behind, and that no place, shop, the Poesje or the post office uses. */
function freeDoors(db: DB, extraTaken: Array<[number, number]>): HouseDoor[] {
  const t = town(db).town;
  const houses = new Set(t.residents.map((r) => r.home.house));
  const taken: Array<[number, number]> = [...extraTaken];
  for (const r of t.residents) {
    taken.push([r.home.sx, r.home.sz]);
    if (r.work.door) taken.push(r.work.door);
  }
  for (const p of Object.values(t.places)) if (p.door) taken.push(p.door);
  for (const s of t.shops) taken.push(s.door);
  for (const key of ["poesje:door", "press"]) {
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
    if (!row) continue;
    const v = JSON.parse(row.value_json) as { sx?: number; sz?: number; post?: { step: [number, number] } | null; corners?: Array<{ x: number; z: number }> };
    if (typeof v.sx === "number" && typeof v.sz === "number") taken.push([v.sx, v.sz]);
    if (v.post) taken.push(v.post.step);
    for (const c of v.corners ?? []) taken.push([c.x, c.z]);
  }
  return houseDoors().filter((d) => !houses.has(d.house) && !taken.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 4));
}

function nearest(doors: HouseDoor[], anchor: [number, number], ok: (d: HouseDoor) => boolean): HouseDoor | null {
  let best: HouseDoor | null = null;
  let bd = Infinity;
  for (const d of doors) {
    if (!ok(d)) continue;
    const k = Math.hypot(d.sx - anchor[0], d.sz - anchor[1]);
    if (k < bd) [best, bd] = [d, k];
  }
  return best;
}

function district(x: number, z: number): string {
  if (x > 40) return "eilandje";
  if (x > -40) return "rijnkaai";
  if (x > -150) return z > 60 ? "canal" : "vismarkt";
  return z > 60 ? "grote-markt" : "steenplein";
}

const hashStr = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

function nearestKey(places: Record<string, { x: number; z: number }>, prefix: string, p: [number, number], def: string): string {
  let best = def;
  let bd = Infinity;
  for (const [k, v] of Object.entries(places)) {
    if (!k.startsWith(prefix)) continue;
    const d = Math.hypot(v.x - p[0], v.z - p[1]);
    if (d < bd) [best, bd] = [k, d];
  }
  return best;
}

function addResident(db: DB, r: Resident, role: string, dist: string): boolean {
  if (db.prepare("SELECT 1 FROM npc WHERE id = ?").get(r.id)) return false;
  db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, ?, ?, '{}', NULL, 1)").run(r.id, r.name, role, dist, r.faction);
  db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(r.id);
  db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)").run(r.id, r.household, r.trade, JSON.stringify(r));
  return true;
}

/**
 * An early build could name the dealer "Door" (Theodoor): in English it reads as a door.
 * Such a save gets "Dolf" instead, once, in his row, his npc row and the shop's label.
 */
function renameDoor(db: DB, h: HomesTown | null): void {
  const r = h?.dealer ? town(db).byId.get(h.dealer.id) : undefined;
  if (!h?.dealer || !r || r.first !== "Door") return;
  const fixed: Resident = { ...r, first: "Dolf", name: `Dolf ${r.surname}` };
  db.transaction(() => {
    db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(fixed), r.id);
    db.prepare("UPDATE npc SET name = ? WHERE id = ?").run(fixed.name, r.id);
    h.dealer!.label = `${fixed.name}'s second-hand shop`;
    saveHomes(db, h);
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
    if (row) {
      const rest = JSON.parse(row.value_json) as { places: Record<string, { label?: string }> };
      if (rest.places.dealer_shop) rest.places.dealer_shop.label = h.dealer!.label;
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
    }
  })();
  dropTownCache(db);
}

/** Make sure the homes, the widow and the dealer exist in this town. Idempotent; returns what it added. */
export function ensureHomesTown(db: DB): { homes: number; widow: boolean; dealer: boolean } {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (has === 0) return { homes: 0, widow: false, dealer: false };
  const before = homesTown(db);
  renameDoor(db, before);
  if (before?.v === 1 && before.homes.length === HOME_CLASSES.length && before.dealer) return { homes: 0, widow: false, dealer: false };

  const t = town(db).town;
  const rng = rngFrom((t.seed ^ 0x40_4e_73) >>> 0);
  const wm = walkMap();
  const snap = (x: number, z: number): [number, number] => {
    const q = wm.nearestOpen(x, z, 8) ?? { x, z };
    return [q.x, q.z];
  };
  const rec: HomesTown = before ?? { v: 1, homes: [], dealer: null, widow: null };
  const added = { homes: 0, widow: false, dealer: false };
  const usedSurnames = new Set(t.residents.map((r) => r.surname));
  const surname = (list: string[]) => list.find((s) => !usedSurnames.has(s)) ?? list[0];
  let hh = Math.max(0, ...t.residents.map((r) => r.household));

  db.transaction(() => {
    const taken: Array<[number, number]> = [...rec.homes.map((h) => h.step)];
    if (rec.dealer) taken.push(rec.dealer.step);
    // the landlords of the houses to let: the town's men of property, one per house by the seed
    const owners = t.residents
      .filter((r) => r.age >= 30 && (r.trade === "merchant" || r.trade === "brewer" || r.trade === "fish_merchant" || r.stats.wealth >= 6))
      .sort((a, b) => hashStr(a.id + t.seed) - hashStr(b.id + t.seed));
    let ownerAt = 0;

    for (const cls of HOME_CLASSES) {
      if (rec.homes.some((h) => h.cls === cls)) continue;
      const want = WANT[cls];
      const d = nearest(freeDoors(db, taken), want.anchor, (q) => want.ok(q, laneWidth(q)));
      if (!d) continue;
      taken.push([d.sx, d.sz]);
      let landlord = owners.length ? owners[ownerAt++ % owners.length].id : "";
      if (cls === "widow") {
        // a NEW resident: a widow who lives in this house alone and lets its front room
        const first = ["Rosalie", "Mathilde", "Coleta", "Barbara", "Joanna"][Math.floor(rng() * 5)];
        const sn = surname(["Verlinden", "Van Hoof", "Goossens", "Mertens", "Wouters"]);
        const w: Resident = {
          id: WIDOW_ID,
          first,
          surname: sn,
          name: `${first} ${sn}`,
          age: 58 + Math.floor(rng() * 10),
          sex: "f",
          household: ++hh,
          family_role: "widow",
          trade: "seamstress",
          faction: TRADES.seamstress.faction,
          kind: "old_woman",
          home: { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz },
          work: { place: "home", kind: "inside", door: [d.sx, d.sz] },
          sched: {
            day: [[9, 10.25, "market", nearestKey(t.places, "market:", [d.sx, d.sz], "market:vismarkt")]],
            sunday: [[8.75, 11, "church", "church"]],
          },
          stats: { honesty: 7, temper: 4, piety: 7, warmth: 6, greed: 4, courage: 3, gossip: 7, wealth: 3 },
          dog: null,
        };
        added.widow = addResident(db, w, "widow who lets a room", district(d.sx, d.sz));
        landlord = w.id;
        rec.widow = w.id;
      }
      rec.homes.push({
        id: cls,
        cls,
        label: `${CLASSES[cls].label} ${want.where}`,
        house: d.house,
        step: [d.sx, d.sz],
        wall: [d.x, d.z],
        out: d.out,
        landlord,
      });
      added.homes++;
    }

    if (!rec.dealer) {
      const d = nearest(freeDoors(db, taken), DEALER_ANCHOR, (q) => q.storeys >= 2);
      if (d) {
        const at = snap(d.sx + d.out[0] * 0.8, d.sz + d.out[1] * 0.8);
        const yaw = Math.atan2(d.out[0], d.out[1]);
        const first = ["Rik", "Sus", "Fons", "Staf", "Lowie"][Math.floor(rng() * 5)];
        const sn = surname(["Van Ooteghem", "Cuypers", "Nuyts", "Bogaerts", "Sels"]);
        const r: Resident = {
          id: DEALER_ID,
          first,
          surname: sn,
          name: `${first} ${sn}`,
          age: 50 + Math.floor(rng() * 12),
          sex: "m",
          household: ++hh,
          family_role: "single",
          trade: "dealer",
          faction: TRADES.dealer.faction,
          kind: "shopkeeper",
          home: { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz },
          work: { place: "dealer_shop", kind: "post", at: [at[0], at[1], yaw] },
          sched: { day: [[8, 12.5, "work"], [13.5, 18, "work"]], sunday: [[8.75, 11, "church", "church"]] },
          stats: { honesty: 5, temper: 4, piety: 4, warmth: 6, greed: 7, courage: 4, gossip: 7, wealth: 3 },
          dog: null,
        };
        added.dealer = addResident(db, r, TRADES.dealer.label, district(d.sx, d.sz));
        rec.dealer = { id: r.id, label: `${r.first} ${r.surname}'s second-hand shop`, step: [d.sx, d.sz], wall: [d.x, d.z], out: d.out, at: [at[0], at[1], yaw] };
      }
    }

    // the town's own record: the dealer's shop as a place (for talk and the path check)
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string } | undefined;
    if (row && rec.dealer) {
      const rest = JSON.parse(row.value_json) as { places: Record<string, unknown> };
      rest.places.dealer_shop = { label: rec.dealer.label, x: rec.dealer.step[0], z: rec.dealer.step[1], r: 3, district: district(rec.dealer.step[0], rec.dealer.step[1]), door: rec.dealer.step, out: rec.dealer.out };
      db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
    }
    saveHomes(db, rec);
  })();
  dropTownCache(db);
  return added;
}
