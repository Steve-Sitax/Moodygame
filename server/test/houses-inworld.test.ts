import { describe, expect, it } from "vitest";
import * as HP from "../../shared/hallPlan.ts";
import type { Rect } from "../../shared/hallPlan.ts";
import { housePlan, houseFrame, REVEAL, SILL, type CityHouse, type HousePlan, type InworldEntry } from "../../shared/housePlan.ts";
import { CLASSES, type HomeClass } from "../../shared/homes.ts";
import BUILD from "../../shared/city_build.json" with { type: "json" };
import LIST from "../../shared/inworld_houses.json" with { type: "json" };
import SPEC from "../../shared/inworld_build.json" with { type: "json" };
import { houseDoors } from "../src/town/walkmap.ts";

// M7 taverns and homes in the world (docs/milestones/M7-taverns-homes-inworld.md): the five taverns, the
// Poesje's cellar and the five homes stand inside their own city houses. For each house:
//  - its door is the town's door of that house (server walkmap.ts houseDoors), and the Blender build's spec
//    (shared/inworld_build.json) is what the plan says now;
//  - the rooms fit inside the house's faces (0.2 m in), the upstairs rooms under the house's eaves and the
//    garret over them; only a cellar may reach under its neighbours;
//  - the walk in: from the step through the door to the room, up (or down) every flight to a home's room,
//    and nothing past a shut door; the threshold runs from 0 on the step to over a half inside.

const build = BUILD as unknown as { houses: CityHouse[]; ground_h: number; storey_h: number };
const entries = (LIST as unknown as { houses: InworldEntry[] }).houses;
const plans: HousePlan[] = entries.map((e) => housePlan(e, build.houses[e.house], build.ground_h, build.storey_h, e.cls ? CLASSES[e.cls as HomeClass] : undefined));
const byId = (id: string) => plans.find((p) => p.id === (id as never))!;

function inPoly(fp: number[][], x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) {
    const [xi, zi] = fp[i];
    const [xj, zj] = fp[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function edgeDist(fp: number[][], x: number, z: number): number {
  let d = Infinity;
  for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) {
    const [ax, az] = fp[j];
    const [bx, bz] = fp[i];
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2;
    const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2)) : 0;
    d = Math.min(d, Math.hypot(x - (ax + t * (bx - ax)), z - (az + t * (bz - az))));
  }
  return d;
}
/** Corners of local rects that are not inside the house's footprint at least m from its edges. */
function outside(p: HousePlan, rects: Rect[], m = REVEAL): string[] {
  // a rect house is built as its rectangle (tools/blender/build_city.py rect_house), not its trimmed footprint
  const h = build.houses[p.entry.house];
  const P = (a: number, t: number) => [h.o[0] + h.u[0] * a + h.n[0] * t, h.o[1] + h.u[1] * a + h.n[1] * t];
  const fp = h.rect ? [P(h.s[0], h.t[0]), P(h.s[1], h.t[0]), P(h.s[1], h.t[1]), P(h.s[0], h.t[1])] : h.fp;
  const bad: string[] = [];
  for (const r of rects)
    for (const [x, z] of [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]] as Array<[number, number]>) {
      const [wx, wz] = HP.toWorld(p, x, z);
      if (!inPoly(fp, wx, wz) || edgeDist(fp, wx, wz) < m - 1e-6) bad.push(`${p.id} ${x.toFixed(2)},${z.toFixed(2)}`);
    }
  return bad;
}

describe("the in-world houses are the town's houses", () => {
  it("each listed door is its house's door, as the town finds it", () => {
    const doors = houseDoors();
    for (const e of entries) {
      const f = houseFrame(build.houses[e.house]);
      expect(Math.hypot(f.origin.x - e.door[0], f.origin.z - e.door[1]), e.id).toBeLessThan(0.25);
      const d = doors.find((q) => q.house === e.house);
      expect(d, e.id).toBeTruthy();
      expect(Math.hypot(d!.x - f.origin.x, d!.z - f.origin.z), e.id).toBeLessThan(0.15);
      // the way out of the plan is the town's way out
      const [ox, oz] = HP.toWorld(byId(e.id), 0, -1);
      expect(Math.hypot(ox - f.origin.x - d!.out[0], oz - f.origin.z - d!.out[1]), e.id).toBeLessThan(0.05);
    }
  });

  it("the Blender build's spec is the plan's (node tools/city/inworld.mts after a change)", () => {
    const spec = (SPEC as unknown as { houses: Array<{ id: string; house: number; door: unknown; holes: unknown }> }).houses;
    expect(spec.map((s) => s.id)).toEqual(entries.map((e) => e.id));
    for (const p of plans) {
      const s = spec.find((q) => q.id === p.id)!;
      expect(s.house).toBe(p.entry.house);
      expect(s.door).toEqual(p.door);
      expect(s.holes).toEqual(p.holes);
    }
  });

  it("every tavern has its front window cut, and the holes are the painted glass inside the walls", () => {
    for (const p of plans.filter((q) => q.kind === "tavern")) {
      expect(p.holes.some((h) => h.wall === 0), p.id).toBe(true);
      for (const h of p.holes) {
        expect(h.y0).toBeGreaterThan(0.5);
        expect(h.y1).toBeLessThan(build.ground_h);
        expect(h.s1 - h.s0).toBeGreaterThan(1.0);
      }
    }
  });
});

describe("the rooms fit their houses", () => {
  it("the taverns' taprooms and the ground-floor corridors stand 0.2 m inside the faces", () => {
    for (const p of plans.filter((q) => q.kind === "tavern")) expect(outside(p, [p.room.rect], REVEAL - 1e-3)).toEqual([]);
    for (const p of plans.filter((q) => q.kind === "home" && q.roomFrame?.doorWall === 0 && q.entry.cls !== "cellar")) {
      expect(outside(p, [p.room.rect, ...p.landings.map((l) => l.rect), ...p.flights.map((f) => f.rect)], REVEAL - 1e-3)).toEqual([]);
    }
  });

  it("the upstairs rooms are on their storeys, under the house's top; the garret is under the roof", () => {
    const merchant = byId("home:merchant");
    expect(merchant.room.y).toBe(build.ground_h);
    const garret = byId("home:garret");
    const h = build.houses[garret.entry.house];
    expect(garret.room.y).toBeCloseTo(h.h, 5);
    expect(garret.flights.length).toBe(h.st);
    for (const f of garret.flights) expect(f.y1 - f.y0).toBeLessThan(build.ground_h + 0.01);
    const cellar = byId("home:cellar");
    expect(cellar.room.y).toBeLessThan(-2);
    expect(byId("poesje").room.y).toBeLessThan(-2);
  });

  it("the ground-floor homes' windows are in their own house's front", () => {
    for (const id of ["home:widow", "home:alley"]) {
      const p = byId(id);
      expect(p.holes.length).toBeGreaterThan(0);
      for (const h of p.holes) {
        expect(h.s0).toBeGreaterThan(0.1);
        expect(h.s1).toBeLessThan(p.frame.L - 0.1);
      }
    }
  });
});

describe("walking in", () => {
  const open = () => true;
  const shut = () => false;

  it("into each taproom from its step, and not past its shut door", () => {
    for (const p of plans.filter((q) => q.kind === "tavern")) {
      const reach = HP.flood(p, [0, -0.45], 0.25, 0.3, open);
      const r = p.room.rect;
      // the middle of the room and its four quarters (the furniture is the client's)
      const mid = [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];
      expect(reach(mid[0], mid[1], 0, 1.2), `${p.id} middle`).toBe(true);
      expect(reach(r.minX + 0.6, r.maxZ - 0.6, 0, 0.8), `${p.id} back corner`).toBe(true);
      const barred = HP.flood(p, [0, -0.45], 0.25, 0.3, shut);
      expect(barred(mid[0], mid[1], 0, 1.2), `${p.id} barred`).toBe(false);
      // the threshold
      expect(HP.insideness(p, 0, -1.2)).toBe(0);
      expect(HP.insideness(p, mid[0], mid[1])).toBeGreaterThan(0.5);
    }
  });

  it("down the Poesje's flight into the cellar, to the far end of the hall", () => {
    const p = byId("poesje");
    const reach = HP.flood(p, [0, -0.45], 0.25, 0.3, open);
    const r = p.room.rect;
    expect(reach((r.minX + r.maxX) / 2, r.maxZ - 1.0, 1, 1.0)).toBe(true);
    // and never under the flight
    const fl = p.flights[0].rect;
    expect(reach((fl.minX + fl.maxX) / 2, (fl.minZ + fl.maxZ) / 2 - 0.5, 1, 0.3)).toBe(false);
  });

  it("up (or down) every flight to each home's room, through its door in the back wall", () => {
    for (const p of plans.filter((q) => q.kind === "home")) {
      // the ground storey's flight is steep (a narrow house's stair, 0.19 m treads): a finer grid than the halls, off the treads
      const reach = HP.flood(p, [0, -0.45], 0.15, 0.3, open);
      const rf = p.roomFrame!;
      const r = p.room.rect;
      const level = p.levels.length - 1;
      expect(reach((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, level, 1.0), p.id).toBe(true);
      expect(Math.abs(HP.floorAt(p, (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, rf.y) - rf.y), p.id).toBeLessThan(1e-6);
      const barred = HP.flood(p, [0, -0.45], 0.15, 0.3, shut);
      expect(barred((r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2, level, 1.0), `${p.id} barred`).toBe(false);
    }
  });

  it("a flight is climbed a step at a time; the corridor under a room is the ground floor's", () => {
    const p = byId("home:merchant");
    const f = p.flights[0];
    const x = (f.rect.minX + f.rect.maxX) / 2;
    let feet = SILL;
    const n = 40;
    for (let i = 0; i <= n; i++) {
      const z = f.foot + ((f.head - f.foot) * i) / n;
      const y = HP.floorAt(p, x, z, feet);
      expect(Math.abs(y - feet)).toBeLessThanOrEqual(HP.STEP + 1e-6);
      feet = y;
    }
    expect(feet).toBeCloseTo(build.ground_h, 5);
    // under the room, on the ground floor, the floor is the corridor's
    expect(HP.floorAt(p, 0, 1.0, SILL)).toBeCloseTo(SILL, 5);
    expect(HP.levelAt(p, 0, 1.0, SILL)).toBe(0);
  });
});
