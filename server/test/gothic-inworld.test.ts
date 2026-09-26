import { describe, expect, it } from "vitest";
import * as HP from "../../shared/hallPlan.ts";
import { GOTHIC, JAMES, PAUL, type GothicHall } from "../../shared/gothicPlan.ts";
import CITY from "../../shared/city.json" with { type: "json" };

// M7 St Paul and St James (docs/milestones/M7-paul-james.md): both churches stand in the world inside their
// Blender shells (build_churches.py stpaul(), stjacob()), walked into through the west door by their plans
// (shared/gothicPlan.ts):
//  - every floor lies inside the landmark's rectangle (the shell fills it), the porch excepted;
//  - the walk in reaches every mark and every place the path check knows; not past the communion rail or the
//    choir screen; nothing past the shut door;
//  - the threshold blend runs from 0 in the porch to 1 in the nave.

type Frame = { c: [number, number]; L: number; W: number };
const FR = (id: string) => (CITY as unknown as { landmarks: Record<string, { frame: Frame }> }).landmarks[id].frame;

for (const g of GOTHIC) {
  const P = g.plan;
  describe(`${g.label}: the plan fits the shell`, () => {
    it("every floor's corners lie inside the landmark's rectangle, 0.1 m in (the porch is the street's)", () => {
      const f = FR(g.id);
      for (const r of P.levels[0].floors) {
        if (r.maxZ <= 0.001) continue;
        for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]] as Array<[number, number]>) {
          const [wx, wz] = HP.toWorld(P, x, z);
          expect(Math.abs(wx - f.c[0]), `${x},${z}`).toBeLessThan(f.L / 2 - 0.1);
          expect(Math.abs(wz - f.c[1]), `${x},${z}`).toBeLessThan(f.W / 2 - 0.1);
        }
      }
    });
    it("has one west door, its step outside in the porch", () => {
      expect(P.doors.length).toBe(1);
      const d = P.doors[0];
      expect(d.hw).toBeCloseTo(g.door.hw, 5);
      expect(d.step.z).toBeLessThan(0);
    });
  });

  describe(`${g.label}: walking in`, () => {
    // (in the porch, a metre before the door: the step itself is at the porch's street edge)
    const from: [number, number] = [0, -1.0];
    const reach = HP.flood(P, from);
    it("reaches every mark and every place of the path check", () => {
      for (const [name, m] of Object.entries(P.marks)) if (name !== "door") expect(reach(m.x, m.z, 0, 1.0), name).toBe(true);
      for (const p of g.points) expect(reach(p.x, p.z, 0, p.reach), p.label).toBe(true);
    });
    it("reaches the pulpit's foot and every confessional's front", () => {
      expect(reach(g.F.pulpit.x + 1.1, g.F.pulpit.z - 1.0, 0, 1.0), "pulpit").toBe(true);
      for (const c of g.F.confessionals) expect(reach(c.x - c.side * 1.3, c.z, 0, 1.0), `confessional ${c.x},${c.z}`).toBe(true);
    });
    it("lets nobody past the shut door", () => {
      const shut = HP.flood(P, from, 0.25, 0.3, () => false);
      expect(shut(0, 6, 0, 1.0)).toBe(false);
    });
    it("the threshold runs from 0 in the porch to 1 in the nave", () => {
      expect(HP.insideness(P, 0, P.doors[0].step.z)).toBe(0);
      expect(HP.insideness(P, 0, from[1])).toBeLessThan(0.05);
      expect(HP.insideness(P, 0, 12)).toBe(1);
    });
  });
}

const reachOf = (g: GothicHall) => HP.flood(g.plan, [0, -1.0]);

describe("St Paul's: the choir", () => {
  it("keeps Jef on the nave's side of the communion rail (the stalls and the high altar are the friars')", () => {
    const reach = reachOf(PAUL);
    expect(reach(0, PAUL.F.rail.z - 0.9, 0, 1.0)).toBe(true);
    expect(reach(0, PAUL.F.rail.z + 2.0, 0, 0.5)).toBe(false);
  });
});

describe("St James's: the choir screen and the ambulatory", () => {
  const reach = reachOf(JAMES);
  it("keeps Jef out of the choir behind the screen", () => {
    expect(reach(0, JAMES.L.tx[1] + 3.0, 0, 0.5)).toBe(false);
  });
  it("lets him round the choir by its aisles to Rubens's chapel behind the high altar", () => {
    expect(reach(-9.4, JAMES.L.tx[1] + 3.0, 0, 1.0)).toBe(true);
    expect(reach(9.4, JAMES.L.tx[1] + 3.0, 0, 1.0)).toBe(true);
    expect(reach(0, JAMES.L.apse.z + 9.3, 0, 1.2)).toBe(true);
  });
  it("walls off the south's first bay (the baptistery stands there)", () => {
    expect(reach(17.0, JAMES.L.chapels[1].z0 - 1.0, 0, 0.3)).toBe(false);
  });
});
