import { afterEach, describe, expect, it, vi } from "vitest";
import { openDb, resetDb, type DB } from "../src/db.ts";
import { auditSave } from "../src/town/audit.ts";
import type { Resident } from "../src/town/population.ts";
import { houseDoors, walkMap } from "../src/town/walkmap.ts";
import { inworldHouse } from "../src/town/kept.ts";
import { setTownSize } from "../src/town/popsettings.ts";

// The save audit (town/audit.ts, 2026-09-26): a new game fits the current map; a record that
// points at an old spot (no door there, in a wall, on the water) is listed.

const residents = (db: DB) => (db.prepare("SELECT id, data_json FROM resident ORDER BY id").all() as Array<{ id: string; data_json: string }>).map((r) => JSON.parse(r.data_json) as Resident);
const put = (db: DB, r: Resident) => db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(r), r.id);
const townOf = (db: DB) => JSON.parse((db.prepare("SELECT value_json FROM world_state WHERE key = 'town'").get() as { value_json: string }).value_json);
const putTown = (db: DB, t: unknown) => db.prepare("UPDATE world_state SET value_json = ? WHERE key = 'town'").run(JSON.stringify(t));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("save audit", () => {
  it("a new game lists nothing (the test seed and two random ones)", () => {
    const db = openDb(":memory:");
    expect(auditSave(db)).toEqual([]);
    for (const r of [0.137, 0.861]) {
      // a real new game rolls its seed (store.ts newSeed); under test it is fixed unless VITEST is off
      vi.stubEnv("VITEST", "");
      vi.spyOn(Math, "random").mockReturnValueOnce(r);
      resetDb(db);
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
      const seed = townOf(db).seed;
      expect(seed).toBe(Math.floor(r * 2 ** 31));
      expect(auditSave(db), `seed ${seed}`).toEqual([]);
    }
  }, 120_000);

  it("each tavern stands in the house whose rooms the world draws for it (De Vliet stood a house off)", () => {
    const db = openDb(":memory:");
    const t = townOf(db);
    for (const id of ["tavern:ankere", "tavern:schipke", "tavern:vliet", "tavern:engel", "tavern:bassin"]) {
      const d = houseDoors().find((q) => q.house === inworldHouse(id))!;
      expect(t.places[id].door, id).toEqual([d.sx, d.sz]);
    }
  });

  it("a very large town keeps the in-world houses and the homes to let for their own use (seed 543218927)", () => {
    // before 2026-09-26 a boatman's family took the merchant's floor (house 808) and a milk woman the house it fell back to
    const db = openDb(":memory:");
    setTownSize(db, "very_large");
    vi.stubEnv("VITEST", "");
    vi.spyOn(Math, "random").mockReturnValueOnce((543218927 + 0.5) / 2 ** 31);
    resetDb(db);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    expect(townOf(db).seed).toBe(543218927);
    expect(auditSave(db)).toEqual([]);
    const homes = JSON.parse((db.prepare("SELECT value_json FROM world_state WHERE key = 'homes'").get() as { value_json: string }).value_json) as { homes: Array<{ id: string; house: number }> };
    for (const h of homes.homes) expect(h.house, h.id).toBe(inworldHouse(`home:${h.id}`));
  }, 180_000);

  it("lists a home whose step is in the open street, a house with no door, a shop door in a wall, a stall on the water", () => {
    const db = openDb(":memory:");
    const wm = walkMap();
    const doors = houseDoors();
    const all = residents(db);
    // an old-map home: the step moved 6 m along the street, onto open ground with no door
    const a = all.find((r) => r.home.house >= 0 && r.id.startsWith("r"))!;
    const d = doors.find((q) => q.house === a.home.house)!;
    let open: { x: number; z: number } | null = null;
    for (const k of [6, -6, 8, -8, 10, -10]) {
      const x = d.sx - d.out[1] * k;
      const z = d.sz + d.out[0] * k;
      if (wm.reachable(x, z) && !doors.some((q) => Math.hypot(q.sx - x, q.sz - z) <= 1)) {
        open = { x, z };
        break;
      }
    }
    expect(open).not.toBeNull();
    put(db, { ...a, home: { ...a.home, sx: open!.x, sz: open!.z } });
    // a house number the map no longer has (pulled down, or an index past the end)
    const b = all.find((r) => r.home.house >= 0 && r.home.house !== a.home.house && r.id.startsWith("r"))!;
    put(db, { ...b, home: { ...b.home, house: 999_999 } });
    // a shop door inside a wall, a stall on the river
    const t = townOf(db);
    let wall: [number, number] | null = null;
    for (let x = -200; x < 0 && !wall; x += 0.5) if (wm.flags(x, 80) & 1 && !wm.nearestOpen(x, 80, 3)) wall = [x, 80]; // deep in a block
    t.shops[0].door = wall;
    t.stalls[0].x = 0;
    t.stalls[0].z = -40;
    expect(wm.flags(0, -40) & 2).toBeTruthy();
    putTown(db, t);

    const f = auditSave(db);
    const of = (kind: string, id: string) => f.filter((x) => x.kind === kind && x.label.includes(id));
    expect(of("home", `${a.id},`)[0]?.why).toMatch(/no door at the step \(in the open street\)/);
    expect(of("home", `${b.id},`)[0]?.why).toMatch(/house 999999 has no door now/);
    expect(of("shop door", t.shops[0].id)[0]?.why).toMatch(/inside a wall/);
    expect(f.find((x) => x.kind === "stall")?.why).toBe("on the water");
    // nothing else: the rest of the town still fits
    expect(f.filter((x) => !(x.kind === "home" && (x.label.includes(`${a.id},`) || x.label.includes(`${b.id},`))) && x.kind !== "shop door" && x.kind !== "stall")).toEqual([]);
  }, 60_000);
});
