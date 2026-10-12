import { describe, expect, it } from "vitest";
import { FleetNames, shipType, vessel, vessels } from "../../shared/fleet.ts";
import { demoBoats } from "../src/mapview/fleet.ts";
import { writeHarbour } from "../src/paper/newspaper.ts";
import { blankSave } from "./blank-save.ts";
import ATLAS from "../../client/public/models/boat_names.json" with { type: "json" };

describe("hull names in the town's text", () => {
  it("every registered hull has its own name and port cells, including the small craft", () => {
    const cells = ATLAS.vessels as Record<string, { bow: number; stern: number; box?: number }>;
    for (const hull of vessels.filter((v) => v.kind !== "pontoon_section")) {
      expect(hull.name).toBeTruthy(); expect(hull.port).toBeTruthy();
      expect(ATLAS.cells[cells[hull.id].bow].text.join(" ")).toContain(hull.name!);
      expect(ATLAS.cells[cells[hull.id].stern].text.join(" ")).toContain(hull.port!);
      if (["paddle_tug", "ferry"].includes(hull.kind)) expect(cells[hull.id].box).toBeDefined();
    }
  });
  it("the map demo gives each model the identity on its hull", () => {
    for (const boat of demoBoats((a) => a)) {
      expect(boat.name).toBe(vessel(boat.id).name);
      expect(boat.kind).toBe(vessel(boat.id).kind);
    }
  });
  it("the paper's arrivals and departures use registered ocean ships and their kinds", () => {
    const db = blankSave();
    try {
      for (let day = 1; day <= 14; day++) {
        const ships = writeHarbour(db, day);
        expect(new Set(ships.map((s) => s.name)).size).toBe(ships.length);
        for (const ship of ships) {
          const hull = vessels.find((v) => v.name === ship.name)!;
          expect(hull).toBeDefined(); expect(ship.type).toBe(shipType(hull.kind));
        }
      }
    } finally { db.close(); }
  });
  it("placing keys survive hull resizing, and growing pools use distinct spare names", () => {
    const names = new FleetNames();
    expect(names.take("tug", "row", 999, 999, 6, 0).id).toBe("hercules");
    const pool = Array.from({ length: 8 }, () => names.take("steamer_line", "river", 600, -400));
    expect(pool[0].id).toBe("stad_antwerpen");
    expect(new Set(pool.map((v) => v.name)).size).toBe(pool.length);
    expect(vessel("germania").kind).toBe("barque_grain");
  });
});
