import { describe, expect, it } from "vitest";
import { openDb, type DB } from "../src/db.ts";
import { dropTownCache, town } from "../src/town/store.ts";
import { houseDoors, type HouseDoor } from "../src/town/walkmap.ts";
import { INWORLD_HOUSES, inworldHouse } from "../src/town/kept.ts";
import { auditSave } from "../src/town/audit.ts";
import { emigrantTown, ensureEmigrants, KEEPER_ID } from "../src/town/emigrants.ts";
import { ensureShopsTown, keeperId } from "../src/shops/town.ts";
import type { Resident } from "../src/town/population.ts";
import INWORLD from "../../shared/inworld_houses.json" with { type: "json" };

// Empty fronts (docs/milestones/M7-empty-fronts.md): every house listed in shared/inworld_houses.json stands cut
// open in city.glb (its door without a leaf, its windows without painted glass). The client draws a room there only
// when the house's own use (the shop, the tavern, the Poesje, the home to let) has its door at that house. So in
// every town, new or old, each listed house must be its own use's door, and nobody else's: else it shows a void.

const LIST = (INWORLD as { houses: Array<{ id: string; kind: string; house: number }> }).houses;
const shopEntries = LIST.filter((e) => e.kind === "shop");

function shopAtItsHouse(db: DB): string[] {
  const t = town(db).town;
  const doors = houseDoors();
  const bad: string[] = [];
  for (const e of shopEntries) {
    const d = doors.find((q) => q.house === e.house)!;
    const s = t.shops.find((q) => `shop:${q.id}` === e.id);
    if (!s || Math.hypot(s.wall[0] - d.x, s.wall[1] - d.z) > 0.6) bad.push(e.id);
  }
  return bad;
}

const KEPT = new Set(["shop taken", "home to let taken", "inside elsewhere"]);

/** A door of the city nobody lives or works behind, not listed in the world, away from every place. */
function freeDoor(db: DB, near: [number, number], skip: Set<number>): HouseDoor {
  const t = town(db).town;
  const homes = new Set(t.residents.map((r) => r.home.house));
  const pts: Array<[number, number]> = [...t.shops.map((s) => s.door), ...Object.values(t.places).flatMap((p) => (p.door ? [p.door as [number, number]] : []))];
  return houseDoors()
    .filter((d) => !d.alley && !homes.has(d.house) && !INWORLD_HOUSES.has(d.house) && !skip.has(d.house) && !pts.some(([x, z]) => Math.hypot(x - d.sx, z - d.sz) < 4))
    .sort((a, b) => Math.hypot(a.sx - near[0], a.sz - near[1]) - Math.hypot(b.sx - near[0], b.sz - near[1]))[0];
}

function writeTown(db: DB, fn: (rest: { places: Record<string, { door?: [number, number]; x: number; z: number; out?: [number, number] }>; shops: Array<{ id: string; door: [number, number]; wall: [number, number]; out: [number, number] }> }) => void): void {
  const row = db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string };
  const rest = JSON.parse(row.value_json);
  fn(rest);
  db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(rest));
}

function editResident(db: DB, id: string, fn: (r: Resident) => void): void {
  const row = db.prepare("SELECT data_json FROM resident WHERE id = ?").get(id) as { data_json: string };
  const r = JSON.parse(row.data_json) as Resident;
  fn(r);
  db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(r), id);
}

const homeAt = (d: HouseDoor) => ({ house: d.house, x: d.x, z: d.z, sx: d.sx, sz: d.sz });

/** Move a shop and its keeper (home and post) to another door, as an older build placed it. */
function shopElsewhere(db: DB, id: string, d: HouseDoor): void {
  writeTown(db, (rest) => {
    const s = rest.shops.find((q) => q.id === id)!;
    s.door = [d.sx, d.sz];
    s.wall = [d.x, d.z];
    s.out = d.out;
    rest.places[id] = { ...rest.places[id], x: d.sx, z: d.sz, door: [d.sx, d.sz], out: d.out };
  });
  editResident(db, keeperId(id), (r) => {
    r.home = homeAt(d);
    r.work.at = [d.sx, d.sz, 0];
  });
  dropTownCache(db);
}

describe("empty fronts: every house cut open in the city is its own use's door", () => {
  it("in a new town: every listed shop at its house, and no listed house taken by another use", () => {
    const db = openDb(":memory:");
    expect(shopAtItsHouse(db)).toEqual([]);
    const e = emigrantTown(db)!;
    expect(INWORLD_HOUSES.has(e.logement.house)).toBe(false);
    expect(auditSave(db).filter((f) => KEPT.has(f.kind))).toEqual([]);
  });

  it("in an older save (Steve's): the Logement in the barber's house and a lodger in the colonial goods shop's; they move, the shops move in", () => {
    const db = openDb(":memory:");
    const doors = houseDoors();
    const barberH = inworldHouse("shop:barber_lane")!;
    const colonialH = inworldHouse("shop:colonial_steen")!;
    const b = doors.find((q) => q.house === barberH)!;
    const c = doors.find((q) => q.house === colonialH)!;
    // the barber and the colonial goods shop at other doors (their houses were homes when they came)
    const skip = new Set<number>();
    const fb = freeDoor(db, [b.sx, b.sz + 30], skip);
    skip.add(fb.house);
    shopElsewhere(db, "barber_lane", fb);
    const fc = freeDoor(db, [c.sx, c.sz + 10], skip);
    shopElsewhere(db, "colonial_steen", fc);
    // the Logement, its keeper and the families in the barber's house
    const e = emigrantTown(db)!;
    const oldStep = e.logement.step;
    const lodgers = town(db).town.residents.filter((r) => Math.hypot(r.home.sx - oldStep[0], r.home.sz - oldStep[1]) < 0.5).map((r) => r.id);
    expect(lodgers).toContain(KEEPER_ID);
    e.logement = { ...e.logement, house: b.house, step: [b.sx, b.sz], wall: [b.x, b.z], out: b.out };
    db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'emigrants'").run(JSON.stringify(e));
    for (const id of lodgers) editResident(db, id, (r) => (r.home = homeAt(b)));
    writeTown(db, (rest) => (rest.places.logement = { ...rest.places.logement, x: b.sx, z: b.sz, door: [b.sx, b.sz], out: b.out }));
    // a single man lodging in the colonial goods shop's house
    const single = town(db).town.residents.find((r) => r.family_role === "single" && r.home.house >= 0 && !INWORLD_HOUSES.has(r.home.house) && !r.work.door)!;
    editResident(db, single.id, (r) => (r.home = homeAt(c)));
    dropTownCache(db);
    expect(shopAtItsHouse(db).sort()).toEqual(["shop:barber_lane", "shop:colonial_steen"]);

    // the load repairs, in the order db.ts runs them
    ensureEmigrants(db);
    const r = ensureShopsTown(db);
    expect(r.moved).toBe(2);
    expect(shopAtItsHouse(db)).toEqual([]);
    const e2 = emigrantTown(db)!;
    expect(INWORLD_HOUSES.has(e2.logement.house)).toBe(false);
    const t = town(db).town;
    // the Logement's people went with it; the lodger to a house of his own, not listed in the world
    for (const id of lodgers) expect(t.residents.find((q) => q.id === id)!.home.house, id).toBe(e2.logement.house);
    const s2 = t.residents.find((q) => q.id === single.id)!;
    expect(s2.home.house).not.toBe(colonialH);
    expect(INWORLD_HOUSES.has(s2.home.house)).toBe(false);
    // the keepers live above their shops again, and stand in them
    for (const id of ["barber_lane", "colonial_steen"]) {
      const k = t.residents.find((q) => q.id === keeperId(id))!;
      expect(k.home.house, id).toBe(inworldHouse(`shop:${id}`));
      const d = doors.find((q) => q.house === k.home.house)!;
      expect(Math.hypot(k.work.at![0] - d.sx, k.work.at![1] - d.sz), id).toBeLessThan(4);
    }
    expect(auditSave(db).filter((f) => KEPT.has(f.kind))).toEqual([]);
    // once is enough
    expect(ensureShopsTown(db)).toEqual({ added: 0, moved: 0 });
  });

  it("a shop does not move into its house when another place's door is there", () => {
    const db = openDb(":memory:");
    const doors = houseDoors();
    const b = doors.find((q) => q.house === inworldHouse("shop:barber_lane")!)!;
    const fb = freeDoor(db, [b.sx, b.sz + 30], new Set());
    shopElsewhere(db, "barber_lane", fb);
    // a town place at that door (not a record the load repairs move)
    writeTown(db, (rest) => (rest.places.test_office = { x: b.sx, z: b.sz, door: [b.sx, b.sz], out: b.out }));
    dropTownCache(db);
    expect(ensureShopsTown(db).moved).toBe(0);
    expect(shopAtItsHouse(db)).toEqual(["shop:barber_lane"]);
  });
});
