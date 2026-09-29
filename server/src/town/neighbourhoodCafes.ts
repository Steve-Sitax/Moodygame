import type { DB } from "../db.ts";
import { NEIGHBOURHOOD_CAFES, GANG_CAFE } from "../../../shared/neighbourhoodCafes.ts";
import { inworldHouse } from "./kept.ts";
import { dropTownCache, town } from "./store.ts";
import { houseDoors, walkMap } from "./walkmap.ts";
import type { Resident } from "./population.ts";

/** Adds businesses and their residents to existing saves without moving anybody's home. */
export function ensureNeighbourhoodCafes(db: DB): number {
  if (!(db.prepare("SELECT COUNT(*) AS n FROM resident").get() as { n: number }).n) return 0;
  const t = town(db).town, places = { ...t.places }, doors = houseDoors(), wm = walkMap();
  const rows: Resident[] = [], ids = new Set(t.residents.map(r => r.id));
  const usedSurnames = new Set(t.residents.map(r => r.surname));
  let household = Math.max(0, ...t.residents.map(r => r.household));
  const snap = (x: number, z: number): [number, number] => { const p = wm.nearestOpen(x, z, 8); return p ? [p.x, p.z] : [x, z]; };
  for (const c of NEIGHBOURHOOD_CAFES) {
    const place = `tavern:${c.id}`, d = doors.find(q => q.house === inworldHouse(place));
    if (!d) throw new Error(`${place}: listed café has no house door`);
    const had = places[place];
    if (!had && t.residents.some(r => r.home.house === d.house)) throw new Error(`${place}: listed café house is occupied`);
    places[place] ??= { label: c.label, x: d.sx, z: d.sz, r: 4, district: "town", door: [d.sx, d.sz], out: d.out };
    const rough = place === GANG_CAFE;
    const keeper = t.residents.some(r => r.trade === "publican" && r.work.place === place);
    const family = ++household;
    const surname = [rough ? "Van Gils" : "De Wilde", "Vervoort", "Van Riel", "De Keersmaecker", "Verbrugge", "Van Mechelen", "De Schutter", "Bogaert"]
      .find(n => !usedSurnames.has(n)) ?? `Van ${c.id === "linde" ? "Linden" : "Cattem"}`;
    usedSurnames.add(surname);
    for (let i = keeper ? 1 : 0; i < 4; i++) {
      const id = `cafe_${c.id}_${i}`;
      if (ids.has(id)) continue;
      const first = (rough ? ["Gust", "Louis", "Karel", "Jan"] : ["Pieter", "Marie", "Victor", "Rosalie"])[i];
      const sex = !rough && i % 2 ? "f" as const : "m" as const;
      const out = snap(d.sx + d.out[0] * 1.5, d.sz + d.out[1] * 1.5);
      const q = snap(out[0] + d.out[1] * 4, out[1] - d.out[0] * 4);
      const r: Resident = {
        id, first, surname, name: `${first} ${surname}`,
        sex, age: 28 + i * 9, household: family, family_role: i === 0 ? "head" : "lodger",
        trade: i === 0 ? "publican" : "retired", faction: rough ? "smokkelaars" : null,
        kind: i === 0 ? "shopkeeper" : sex === "f" ? "wife_b" : i === 2 ? "old_man" : "docker_b",
        home: { house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz },
        work: i === 0 ? { place, kind: "tavern", at: [out[0], out[1], Math.atan2(d.out[0], d.out[1])] }
          : { place, kind: "roam", route: [out, q] },
        sched: i === 0
          ? { day: [[6, 8, "home"], [8, 24, "work"]], sunday: [[6, 9, "home"], [9, 24, "work"]] }
          : { day: [[7, 10, "work"], [10, 14, "tavern", place], [14, 17, "work"], [17, 23.5, "tavern", place]], sunday: [[9, 12, "work"], [12, 23, "tavern", place]] },
        stats: { honesty: rough ? 2 : 6, temper: rough ? 7 : 3, piety: rough ? 2 : 5, warmth: rough ? 2 : 7, greed: 5, courage: rough ? 8 : 4, gossip: 7, wealth: i === 0 ? 4 : 2 },
        dog: null,
      };
      rows.push(r); ids.add(id);
    }
  }
  if (!rows.length && NEIGHBOURHOOD_CAFES.every(c => t.places[`tavern:${c.id}`])) return 0;
  const { residents: _residents, ...rest } = t;
  db.transaction(() => {
    for (const r of rows) {
      db.prepare("INSERT OR IGNORE INTO npc (id,name,role,district,faction,persona_json,spot_id,active) VALUES (?,?,?,'town',?,'{}',NULL,1)").run(r.id, r.name, r.trade === "publican" ? "publican" : "café regular", r.faction);
      db.prepare("INSERT OR IGNORE INTO npc_relationship (npc_id) VALUES (?)").run(r.id);
      db.prepare("INSERT INTO resident (id,household,trade,data_json) VALUES (?,?,?,?)").run(r.id, r.household, r.trade, JSON.stringify(r));
    }
    db.prepare("UPDATE world_state SET value_json=? WHERE key='town'").run(JSON.stringify({ ...rest, places }));
  })();
  dropTownCache(db); return rows.length;
}
