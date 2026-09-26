import { describe, expect, it } from "vitest";
import * as HP from "../../shared/hallPlan.ts";
import * as CP from "../../shared/carolusPlan.ts";
import CITY from "../../shared/city.json" with { type: "json" };

// M7 Carolus (docs/milestones/M7-carolus.md): Sint-Carolus Borromeus stands in the world inside its Blender
// shell (build_churches.py), walked into through its main door by its plan (shared/carolusPlan.ts):
//  - the hall's walls stand inside the landmark's rectangle (the shell fills it), and its door is the shell's;
//  - the walk in: from the terrace through the door to every place the path check and the life know;
//    not past the rails; nothing past the shut door;
//  - the threshold blend runs from 0 on the terrace to 1 in the nave; the terrace's steps and railing.

const FR = (CITY as unknown as { landmarks: Record<string, { frame: { c: [number, number]; L: number; W: number } }> }).landmarks.carolus.frame;
const P = CP.PLAN;

describe("Carolus: the plan fits the shell", () => {
  it("every wall corner lies inside the landmark's rectangle, 0.1 m in", () => {
    const [cx, cz] = FR.c;
    for (const r of CP.wallRects())
      for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]] as Array<[number, number]>) {
        const [wx, wz] = HP.toWorld(P, x, z);
        expect(Math.abs(wx - cx)).toBeLessThan(FR.L / 2 - 0.1);
        expect(Math.abs(wz - cz)).toBeLessThan(FR.W / 2 - 0.1);
      }
  });
  it("the door is the shell's: its plane on the front's face, 3.4 m wide, springing 5.5 m over the sill", () => {
    const d = P.doors[0];
    expect(P.origin.z).toBeCloseTo(CP.ORIGIN.z + CP.FRONT.face, 5);
    expect(d.hw * 2).toBeCloseTo(CP.FRONT.door.w, 5);
    expect(P.floorY).toBeCloseTo(CP.TERRACE.Y0, 5);
    expect(d.h + d.hw).toBeCloseTo(CP.FRONT.door.h, 5);
  });
});

describe("Carolus: walking in", () => {
  const from: [number, number] = [0, -1.0];
  const reach = HP.flood(P, from);
  it("reaches the nave, the chairs' ends, the pulpit, the confessionals, the rail, the side altars and the Lady Chapel", () => {
    // (the door's mark is the step on the terrace, the street's ground outside the plan)
    for (const [name, m] of Object.entries(P.marks)) if (name !== "door") expect(reach(m.x, m.z, 0, 1.0), name).toBe(true);
    expect(reach(5.45, 12.5, 0, 1.0), "a row's end").toBe(true);
    expect(reach(-10.3, 11.4, 0, 1.0), "a confessional").toBe(true);
    expect(reach(9.2, 24.4, 0, 1.0), "a side altar").toBe(true);
    expect(reach(-9.3, 4.4, 0, 1.0), "the font").toBe(true);
  });
  it("does not let Jef into the choir or behind the Lady Chapel's rail", () => {
    expect(reach(0, 29.0, 0, 0.5)).toBe(false);
    expect(reach(16.8, 22.6, 0, 0.5)).toBe(false);
  });
  it("lets nobody past the shut door", () => {
    const shut = HP.flood(P, from, 0.25, 0.3, () => false);
    expect(shut(0, 5, 0, 1.0)).toBe(false);
  });
  it("the threshold runs from 0 before the door to 1 in the nave", () => {
    expect(HP.insideness(P, 0, -1.5)).toBe(0);
    expect(HP.insideness(P, 0, 1.0)).toBeGreaterThan(0.3);
    expect(HP.insideness(P, 0, 6)).toBe(1);
    expect(HP.insideness(P, 16.8, 16)).toBe(1);
  });
});

describe("Carolus: the terrace before the front", () => {
  it("is 0.6 m up, reached by 0.15 m steps, and the railing stands on its edge", () => {
    const [x, z] = CP.toWorld(0, -1.0);
    expect(CP.frontFloor(x, z)).toBeCloseTo(0.6, 5);
    const steps = [-3.0, -2.7, -2.4].map((a) => CP.frontFloor(...CP.toWorld(0, a)));
    steps.forEach((y, i) => expect(y).toBeCloseTo(0.15 * (i + 1), 5));
    expect(CP.frontFloor(...CP.toWorld(5, -3.0))).toBeNull();
    expect(CP.frontSolids().length).toBe(4);
  });
});
