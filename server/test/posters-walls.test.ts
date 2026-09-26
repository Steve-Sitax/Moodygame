import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.ts";
import { ROOT } from "../src/config.ts";
import { posterSpots } from "../src/ideas/posters.ts";
import { walkMap, WALL } from "../src/town/walkmap.ts";
import { AI_BILL, blankRuns, districtOf, houseWalls, wallOpenings, type BuildData, type PosterWall } from "../../shared/posterWalls.ts";

// M7 posters (Steve 2026-09-26: "posters are also over windows and even a poster over a passage where we
// can walk through"): the engine's bills go on plain wall only. The client's check (__scheldemist.posters())
// tests them against the houses as built; this tests the plan's side.

const build = JSON.parse(fs.readFileSync(path.join(ROOT, "shared", "city_build.json"), "utf8")) as BuildData;
const walls = houseWalls(build);

/** The wall a spot lies on (its plane, facing the same way, within its length). */
function wallOf(x: number, z: number, out: [number, number]): PosterWall | undefined {
  return walls.find((w) => {
    if (w.ox * out[0] + w.oz * out[1] < 0.98) return false;
    const d = Math.abs((x - w.ax) * w.ox + (z - w.az) * w.oz);
    const s = (x - w.ax) * w.tx + (z - w.az) * w.tz;
    return d < 0.05 && s > 0 && s < w.L;
  });
}

describe("poster walls", () => {
  it("finds the house walls open to the street, with the backs on the yards and the alley cottages' windows", () => {
    expect(walls.length).toBeGreaterThan(1000);
    const yards = walls.filter((w) => w.kind === 1 && w.windows !== "none");
    expect(yards.length).toBeGreaterThan(20); // (street life once took these for blind walls)
    for (const w of yards.slice(0, 20)) expect(wallOpenings(w).some((o) => o.what === "window")).toBe(true);
    const cottages = walls.filter((w) => w.windows === "cottage");
    expect(cottages.length).toBeGreaterThan(20);
    expect(cottages.filter((w) => wallOpenings(w).some((o) => o.what === "window")).length).toBeGreaterThan(cottages.length / 2);
    expect(walls.filter((w) => w.poort).length).toBeGreaterThan(5);
  });

  it("leaves a doorway, the windows and a passage's mouth out of the blank stretches", () => {
    for (const w of walls) {
      for (const [r0, r1] of blankRuns(w, 0.3, 1.0, 1.9)) {
        for (const s of [r0, (r0 + r1) / 2, r1]) {
          for (const o of wallOpenings(w)) {
            if (o.y1 <= 1.0 || o.y0 >= 1.9) continue;
            expect(s + 0.3 <= o.s0 || s - 0.3 >= o.s1).toBe(true);
          }
        }
      }
    }
  });

  it("puts the engine's bills on plain house wall by the busy places, the street open before them", () => {
    const db = openDb(":memory:");
    const spots = posterSpots(db);
    expect(spots.length).toBeGreaterThanOrEqual(14);
    const wm = walkMap();
    for (const s of spots) {
      const w = wallOf(s.x, s.z, s.out);
      expect(w, s.id).toBeDefined();
      const at = (s.x - w!.ax) * w!.tx + (s.z - w!.az) * w!.tz;
      const hu = AI_BILL.w / 2;
      for (const o of wallOpenings(w!)) {
        if (o.y1 <= AI_BILL.y - AI_BILL.h / 2 || o.y0 >= AI_BILL.y + AI_BILL.h / 2) continue;
        expect(at + hu <= o.s0 || at - hu >= o.s1, `${s.id} over a ${o.what}`).toBe(true);
      }
      expect(at - hu).toBeGreaterThan(0.5);
      expect(at + hu).toBeLessThan(w!.L - 0.5);
      expect(wm.flags(s.x - s.out[0] * 0.3, s.z - s.out[1] * 0.3) & WALL).toBeTruthy();
      expect(wm.flags(s.x + s.out[0] * 0.6, s.z + s.out[1] * 0.6)).toBe(0);
      expect(w!.inWorld).toBe(false);
    }
  });

  it("tells the parts of town apart", () => {
    const w = walls.find((q) => q.kind === 0 && !q.store && !q.alley)!;
    const base = { wall: w, width: 10, water: false, quay: 100 };
    expect(districtOf(-340, 200, base)).toBe("police");
    expect(districtOf(-254, 94, base)).toBe("fine");
    expect(districtOf(-254, 94, { ...base, width: 4 })).toBe("middle");
    expect(districtOf(20, 40, { ...base, quay: 10 })).toBe("quay");
    expect(districtOf(103, 266, base)).toBe("church");
    expect(districtOf(150, 150, { ...base, width: 4 })).toBe("poor");
    expect(districtOf(150, 150, base)).toBe("middle");
  });
});
