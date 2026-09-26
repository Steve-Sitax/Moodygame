import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { dropTownCache, rehomeLost, town } from "../src/town/store.ts";
import { goneHouses, houseDoors, walkMap } from "../src/town/walkmap.ts";

// The churches freed (2026-09-26): houses pulled down round St Paul's and St James' (shared/city_build.json
// "gone": the entries stay, so every house index still points at the same house). Squares before their doors.

describe("the churches freed", () => {
  it("a house marked gone has no door, and the rest keep theirs", () => {
    const gone = goneHouses();
    expect(gone.size).toBeGreaterThan(0);
    for (const i of [197, 198, 493, 465]) expect(gone.has(i)).toBe(true);
    const doors = houseDoors();
    expect(doors.some((d) => gone.has(d.house))).toBe(false);
    // no two doors for one house
    expect(new Set(doors.map((d) => d.house)).size).toBe(doors.length);
  });

  it("the churches' doors open onto reachable ground: the west doors and the transept doors", () => {
    const wm = walkMap();
    // (a step out from each doorway: the church fills its outline's rectangle, the walk map makes that wall)
    const steps: Array<[string, number, number]> = [
      ["St Paul's west door", 142.2, 266],
      ["St Paul's north transept door", 95, 245.2],
      ["St James' west door", -54.0, 305],
      ["St James' south transept door", -106.5, 334.6],
    ];
    for (const [name, x, z] of steps) expect(wm.reachable(x, z), name).toBe(true);
    // and the square before each west door is open ground 12 m out, across the door
    for (const [x, z] of [[152, 266], [146, 256], [146, 278], [-44, 305], [-49, 294], [-49, 317], [-30, 308]] as Array<[number, number]>)
      expect(wm.reachable(x, z), `${x}, ${z}`).toBe(true);
  });

  it("a home in a house pulled down moves to a free house, though its old step now lies on the square", () => {
    const db = openDb(":memory:");
    expect(rehomeLost(db)).toBe(0);
    const hh = town(db).town.residents.find((r) => r.household < 9000 && r.work.place === "home" && r.home.house >= 0)!.household;
    const members = town(db).town.residents.filter((r) => r.household === hh).map((r) => r.id);
    const old = { house: 197, x: 141.6, z: 266.5, sx: 142.8, sz: 266.5 }; // before St Paul's west door, now the square
    expect(walkMap().reachable(old.sx, old.sz)).toBe(true);
    for (const id of members) {
      const r = town(db).byId.get(id)!;
      r.home = { ...old };
      db.prepare("UPDATE resident SET data_json = ? WHERE id = ?").run(JSON.stringify(r), id);
    }
    dropTownCache(db);
    expect(rehomeLost(db)).toBe(members.length);
    const homes = members.map((id) => town(db).byId.get(id)!);
    expect(new Set(homes.map((r) => r.home.house)).size).toBe(1);
    expect(goneHouses().has(homes[0].home.house)).toBe(false);
    expect(houseDoors().some((d) => d.house === homes[0].home.house)).toBe(true);
    expect(rehomeLost(db)).toBe(0);
  });
});
