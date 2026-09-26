import type { DB } from "../db.ts";
import { dropTownCache, town } from "../town/store.ts";
import { houseDoors, walkMap, type HouseDoor } from "../town/walkmap.ts";
import { inworldHouse, INWORLD_HOUSES } from "../town/kept.ts";
import { TAVERNS, TRADES, type TradeId } from "../town/places.ts";
import { rngFrom, type Resident, type ShopFront, type TownPlace } from "../town/population.ts";
import type { Seg } from "../town/schedule.ts";
import { PAWN_WORTH } from "../paper/pawn.ts";
import { SHOP_PAWN_WORTH } from "./wares.ts";
import { NEW_SHOPS, OLD_SHOP_TRADE, type NewShopDef } from "../../../shared/shops.ts";

// M7 shops (docs/milestones/M7-shops.md): more shops in the town, each in its own house with its inside in
// the world (shared/inworld_houses.json "shop:<id>", client world/shopRooms.ts).
//
// Runs on every start and after a new game; works in place, once per shop:
//  - a NEW shop (shared/shops.ts NEW_SHOPS: the butcher, the colonial goods, the apothecary, the barber, the
//    hatter, the coffee roaster, the printer, the bookseller, the clockmaker) takes its listed house when
//    nobody lives or works there (else the nearest free door by its anchor, and then it has no inside), and
//    its keeper is ADDED as a resident living above the shop, with the shop's hours as his working day;
//  - an OLD shop (server town/places.ts SHOPS) whose house cannot hold an inside (an odd footprint) moves its
//    shop front to its listed house next to it, when that house is free: the door, the table, where the keeper
//    and his wife stand. The family keeps its home; nothing else moves.
// Nothing else in the town is touched. The record is world_state 'shops_m7'.

export interface ShopsRecord {
  v: 1;
  /** New shops added (their ids), and old shop fronts moved to their listed house. */
  added: string[];
  moved: string[];
  /** Shops that could not be placed, with why (for the note and the checks). */
  skipped: Array<{ id: string; why: string }>;
}

// the Berg lends on the watch, the felt hat and the prayer book too (paper/pawn.ts reads PAWN_WORTH)
Object.assign(PAWN_WORTH, SHOP_PAWN_WORTH);

export const SHOPS_KEY = "shops_m7";

export function shopsRecord(db: DB): ShopsRecord | null {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(SHOPS_KEY) as { value_json: string } | undefined;
  return row ? (JSON.parse(row.value_json) as ShopsRecord) : null;
}

const FIRST_M = ["Florimond", "Isidoor", "Achiel", "Gommaar", "Cyriel", "Hippoliet", "Norbert", "Aloïs", "Jozef", "Leopold", "Désiré", "Evarist"];
const SURNAMES = ["Verstraeten", "De Coninck", "Van Dyck", "Moretus", "Huybrechts", "Van Riel", "Schoofs", "De Wolf", "Mortelmans", "Van Aken", "Cools", "Van den Bergh", "Wouters", "Janssens", "De Meyer", "Claes"];

const hash = (s: string) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The keeper's id of a new shop. */
export const keeperId = (shop: string) => `sk_${shop}`;

/** Doors that are someone's: a home, a workplace, a place of the town, another module's door. */
function takenDoors(db: DB): { houses: Set<number>; homes: Set<number>; points: Array<[number, number]> } {
  const t = town(db).town;
  const houses = new Set<number>(INWORLD_HOUSES);
  const homes = new Set<number>();
  const points: Array<[number, number]> = [];
  for (const r of t.residents) {
    if (r.home.house >= 0) {
      houses.add(r.home.house);
      homes.add(r.home.house);
    }
    if (r.work.door) points.push(r.work.door);
  }
  for (const p of Object.values(t.places)) if (p.door) points.push(p.door);
  for (const s of t.shops) points.push(s.door);
  // other modules' doors kept in world_state (the post office, the velocipede maker, the wheelwright, the Logement, the homes to let)
  for (const key of ["press", "veloshop", "cartshop", "emigrants", "homes", "poesje:door"]) {
    const row = db.prepare("SELECT value_json FROM world_state WHERE key = ?").get(key) as { value_json: string } | undefined;
    if (!row) continue;
    for (const m of row.value_json.matchAll(/"(?:step|wall)":\[(-?[\d.]+),(-?[\d.]+)\]/g)) points.push([Number(m[1]), Number(m[2])]);
    for (const m of row.value_json.matchAll(/"house":(\d+)/g)) houses.add(Number(m[1]));
  }
  return { houses, homes, points };
}

function freeDoor(d: HouseDoor, taken: { houses: Set<number>; homes: Set<number>; points: Array<[number, number]> }, own?: number): boolean {
  // its own listed house is kept for it (the in-world houses), but not when a household lives there after all
  if (d.house === own ? taken.homes.has(d.house) : taken.houses.has(d.house)) return false;
  return !taken.points.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 2.2 || Math.hypot(x - d.x, z - d.z) < 2.2);
}

/** Where the keeper stands by the table (as population.ts puts the old shops' keepers), and the wife at the door. */
function standAt(d: HouseDoor, snap: (x: number, z: number) => [number, number]): { keeper: [number, number, number]; wife: [number, number, number] } {
  const side: [number, number] = [-d.out[1], d.out[0]];
  const tx = d.x + side[0] * 1.9 + d.out[0] * 0.6;
  const tz = d.z + side[1] * 1.9 + d.out[1] * 0.6;
  const at = snap(tx + d.out[0] * 0.2, tz + d.out[1] * 0.2);
  const yaw = Math.atan2(d.out[0], d.out[1]);
  return { keeper: [at[0], at[1], yaw], wife: [d.sx, d.sz, yaw] };
}

/** A new shopkeeper's week: the shop's hours, dinner at home between, Sunday mass (or the Sunday hours), sometimes a glass. */
function keeperSched(def: NewShopDef, tavern: string | null, evening: boolean): { day: Seg[]; sunday: Seg[] } {
  const day: Seg[] = def.hours.map(([a, b]) => [a, b, "work"] as Seg);
  const last = def.hours[def.hours.length - 1][1];
  if (evening && tavern && last <= 19.75) day.push([Math.max(20, last + 0.75), 22, "tavern", tavern]);
  const sunday: Seg[] = [];
  for (const [a, b] of def.sunday ?? []) sunday.push([a, b, "work"]);
  const busyAt = (h: number) => sunday.some(([a, b]) => h >= a - 0.25 && h < b + 0.25);
  if (!busyAt(9) && !busyAt(10.5)) sunday.push([8.75, 11, "church", "church"]);
  else sunday.push([11.25, 12.25, "church", "church"]);
  sunday.push([15, 17, "stroll", "play:grote_markt"]);
  sunday.sort((p, q) => p[0] - q[0]);
  return { day, sunday };
}

/** Make sure the new shops stand in this town and the old ones in their own houses. Idempotent; returns what it did. */
export function ensureShopsTown(db: DB): { added: number; moved: number } {
  const has = (db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n;
  if (has === 0) return { added: 0, moved: 0 };
  const rec: ShopsRecord = shopsRecord(db) ?? { v: 1, added: [], moved: [], skipped: [] };
  const t = town(db).town;
  const todo = NEW_SHOPS.filter((s) => !t.shops.some((f) => f.id === s.id) && !rec.skipped.some((k) => k.id === s.id));
  const toMove = Object.keys(OLD_SHOP_TRADE).filter((id) => {
    const own = inworldHouse(`shop:${id}`);
    const f = t.shops.find((q) => q.id === id);
    return own !== undefined && f && !rec.moved.includes(id) && !rec.skipped.some((k) => k.id === id);
  });
  if (!todo.length && !toMove.length) return { added: 0, moved: 0 };

  const doors = houseDoors();
  const wm = walkMap();
  const snap = (x: number, z: number): [number, number] => {
    const q = wm.nearestOpen(x, z, 8) ?? { x, z };
    return [q.x, q.z];
  };
  const taken = takenDoors(db);
  const places: Record<string, TownPlace> = { ...t.places };
  const shops: ShopFront[] = t.shops.map((s) => ({ ...s }));
  const byId = new Map(t.residents.map((r) => [r.id, r]));
  const changed = new Map<string, Resident>();
  const addedRows: Resident[] = [];
  const rng = rngFrom((t.seed ^ 0x5409_0873) >>> 0);
  const usedSurnames = new Set(t.residents.map((r) => r.surname));
  let hh = Math.max(0, ...t.residents.map((r) => r.household));
  let moved = 0;

  // 1. the old shops into their own houses (only when the shop's door is not already that house's)
  for (const id of toMove) {
    const own = inworldHouse(`shop:${id}`)!;
    const f = shops.find((q) => q.id === id)!;
    const d = doors.find((q) => q.house === own);
    if (!d) {
      rec.skipped.push({ id, why: `house ${own} has no door in this city` });
      continue;
    }
    if (Math.hypot(f.wall[0] - d.x, f.wall[1] - d.z) < 0.6) {
      rec.moved.push(id); // already there (a new town, or Steve's save for most of them)
      continue;
    }
    // (the shop's own family may live there: a new town put them above the shop's own house)
    const hh = byId.get(f.keeper)?.household;
    const others = t.residents.some((r) => r.home.house === own && r.household !== hh);
    if (others || !freeDoor(d, { ...taken, homes: new Set() }, own)) {
      rec.skipped.push({ id, why: `its own house ${own} is taken in this town` });
      continue;
    }
    f.door = [d.sx, d.sz];
    f.wall = [d.x, d.z];
    f.out = d.out;
    places[id] = { ...(places[id] ?? { label: f.label, r: 3, district: "town" }), x: d.sx, z: d.sz, door: [d.sx, d.sz], out: d.out } as TownPlace;
    const st = standAt(d, snap);
    for (const r of t.residents) {
      if (r.work.shop !== id) continue;
      const nr = changed.get(r.id) ?? { ...r, work: { ...r.work } };
      nr.work.at = r.id === f.keeper ? st.keeper : st.wife;
      changed.set(r.id, nr);
    }
    taken.houses.add(own);
    taken.points.push([d.sx, d.sz]);
    rec.moved.push(id);
    moved++;
  }

  // 2. the new shops and their keepers
  for (const def of todo) {
    const own = inworldHouse(`shop:${def.id}`);
    let d = own !== undefined ? doors.find((q) => q.house === own && freeDoor(q, taken, own)) : undefined;
    if (!d) {
      d = doors
        .filter((q) => !q.alley && freeDoor(q, taken) && Math.hypot(q.sx - def.x, q.sz - def.z) < 45)
        .sort((a, b) => Math.hypot(a.sx - def.x, a.sz - def.z) - Math.hypot(b.sx - def.x, b.sz - def.z))[0];
      if (!d) {
        rec.skipped.push({ id: def.id, why: "no free door near its anchor" });
        continue;
      }
    }
    taken.houses.add(d.house);
    taken.points.push([d.sx, d.sz]);
    const trade = def.trade as TradeId;
    const first = FIRST_M[Math.floor(rng() * FIRST_M.length)];
    const surname = SURNAMES.find((s, i) => !usedSurnames.has(s) && (hash(def.id) + i) % 3 !== 0) ?? SURNAMES.find((s) => !usedSurnames.has(s)) ?? "Claes";
    usedSurnames.add(surname);
    const st = standAt(d, snap);
    // the nearest tavern for an evening glass, now and then
    const tav = TAVERNS.map((q) => `tavern:${q.id}`)
      .filter((k) => places[k]?.door)
      .sort((a, b) => Math.hypot(places[a].x - d!.sx, places[a].z - d!.sz) - Math.hypot(places[b].x - d!.sx, places[b].z - d!.sz))[0];
    const roll = () => Math.round(rng() * 4 - 2);
    const def0 = TRADES[trade];
    const stat = (k: keyof NonNullable<typeof def0.bias>) => Math.max(0, Math.min(10, 5 + roll() + (def0.bias?.[k] ?? 0)));
    const r: Resident = {
      id: keeperId(def.id),
      first,
      surname,
      name: `${first} ${surname}`,
      age: 34 + Math.floor(rng() * 28),
      sex: def.sex,
      household: ++hh,
      family_role: "head",
      trade,
      faction: def0.faction,
      kind: def.kind,
      home: { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz },
      work: { place: def.id, kind: "shop", shop: def.id, at: st.keeper },
      sched: keeperSched(def, tav ?? null, rng() < 0.4),
      stats: {
        honesty: stat("honesty"),
        temper: stat("temper"),
        piety: stat("piety"),
        warmth: stat("warmth"),
        greed: stat("greed"),
        courage: stat("courage"),
        gossip: stat("gossip"),
        wealth: def0.wealth[0] + Math.floor(rng() * (def0.wealth[1] - def0.wealth[0] + 1)),
      },
      dog: null,
    };
    places[def.id] = { label: def.label, x: d.sx, z: d.sz, r: 3, district: "town", door: [d.sx, d.sz], out: d.out };
    shops.push({ id: def.id, label: def.label, door: [d.sx, d.sz], wall: [d.x, d.z], out: d.out, goods: def.goods, keeper: r.id });
    addedRows.push(r);
    rec.added.push(def.id);
  }

  const { residents: _r, ...rest } = t;
  db.transaction(() => {
    const upd = db.prepare("UPDATE resident SET data_json = ? WHERE id = ?");
    for (const r of changed.values()) upd.run(JSON.stringify(r), r.id);
    for (const r of addedRows) {
      if (byId.has(r.id)) continue;
      if (!db.prepare("SELECT 1 FROM npc WHERE id = ?").get(r.id)) {
        db.prepare("INSERT INTO npc (id, name, role, district, faction, persona_json, spot_id, active) VALUES (?, ?, ?, 'town', ?, '{}', NULL, 1)").run(r.id, r.name, TRADES[r.trade].label, r.faction);
      }
      db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(r.id);
      db.prepare("INSERT OR IGNORE INTO resident (id, household, trade, data_json) VALUES (?, ?, ?, ?)").run(r.id, r.household, r.trade, JSON.stringify(r));
    }
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify({ ...rest, places, shops }));
    db.prepare("INSERT INTO world_state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json").run(SHOPS_KEY, JSON.stringify(rec));
  })();
  dropTownCache(db);
  return { added: addedRows.length, moved };
}
