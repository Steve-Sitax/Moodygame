import { describe, expect, it } from "vitest";
import * as HP from "../../shared/hallPlan.ts";
import type { HallPlan, Rect } from "../../shared/hallPlan.ts";
import * as TH from "../../shared/townhallPlan.ts";
import * as THS from "../../shared/stadhuisShell.ts";
import { inFrame } from "../../shared/shellOpening.ts";
import { LANDMARK_DOORS } from "../../shared/landmarks.ts";
import CITY from "../../shared/city.json" with { type: "json" };

// M7 halls (docs/milestones/M7-halls-inworld.md): the town hall, the Vleeshuis, the Oostershuis and the
// Steen stand in the world inside their Blender shells, as the cathedral does. For each plan:
//  - it fits inside the shell (every wall and floor at least 0.2 m inside the shell's faces and the
//    footprint of shared/city.json), and its doorway is the shell's door;
//  - the walk in: from the street door's step through the doorway to every place of the hall's life,
//    upstairs by the stairs too; nothing past a shut door; no walking under a flight or off a gallery;
//  - the threshold blend runs from 0 on the step to over a half in the hall.

type Fp = number[][];
const LM = (CITY as unknown as { landmarks: Record<string, { fp: Fp }> }).landmarks;

function inPoly(fp: Fp, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = fp.length - 1; i < fp.length; j = i++) {
    const [xi, zi] = fp[i];
    const [xj, zj] = fp[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** Distance from (x, z) to the polygon's edges. */
function edgeDist(fp: Fp, x: number, z: number): number {
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
const corners = (r: Rect): Array<[number, number]> => [[r.minX, r.minZ], [r.maxX, r.minZ], [r.maxX, r.maxZ], [r.minX, r.maxZ]];

/** Every corner of these (local) rects inside the footprint, at least `m` from its edges. */
function outsideFp(p: HallPlan, fp: Fp, rects: Rect[], m = 0.2): string[] {
  const bad: string[] = [];
  for (const r of rects)
    for (const [x, z] of corners(r)) {
      const [wx, wz] = HP.toWorld(p, x, z);
      if (!inPoly(fp, wx, wz) || edgeDist(fp, wx, wz) < m - 1e-6) bad.push(`${x.toFixed(2)},${z.toFixed(2)} (world ${wx.toFixed(2)},${wz.toFixed(2)})`);
    }
  return bad;
}

/** The plan's inside floors (not the porch and the doorway, which reach out through the shell by design). */
const insideFloors = (p: HallPlan, from: number) => p.levels.flatMap((L) => L.floors.filter((f) => f.minZ >= from));

describe("the town hall's plan fits its shell", () => {
  const P = TH.PLAN;
  const S = TH.SHELL;

  it("its walls and floors stand 0.2 m inside the shell's faces", () => {
    const rects = [...TH.wallRects(), ...insideFloors(P, TH.FRONT.z1 - 0.01)];
    const bad: string[] = [];
    for (const r of rects) {
      if (Math.max(Math.abs(r.minX), Math.abs(r.maxX)) > S.halfL - 0.2 + 1e-6) bad.push(`side ${JSON.stringify(r)}`);
      if (r.minZ < S.face + 0.2 - 1e-6) bad.push(`front ${JSON.stringify(r)}`);
      const inBlock = Math.max(Math.abs(r.minX), Math.abs(r.maxX)) <= S.stairBlock.hw - 0.2 + 1e-6;
      if (r.maxZ > (inBlock ? S.stairBlock.back : S.back) - 0.2 + 1e-6) bad.push(`back ${JSON.stringify(r)}`);
    }
    expect(bad).toEqual([]);
    // the front wall's outer face 0.2 behind the wings' face; the heights under the roof's lead
    expect(TH.FRONT.z0).toBeGreaterThanOrEqual(S.face + 0.2 - 1e-9);
    expect(TH.GLASS_Y + TH.FLOOR_Y + 0.5).toBeLessThan(S.top);
    expect(TH.CEIL1 + TH.FLOOR_Y + 0.3).toBeLessThan(S.top);
    // the first floor at the ground floor's string course
    expect(TH.UP + TH.FLOOR_Y).toBeCloseTo(S.groundStorey, 5);
  });

  it("every corner of them lies inside the town hall's footprint (city.json)", () => {
    const fp = LM.stadhuis.fp;
    expect(outsideFp(P, fp, [...TH.wallRects(), ...insideFloors(P, TH.FRONT.z1 - 0.01)], 0)).toEqual([]);
  });

  it("the doorway is the shell's main door: behind the portal, its width, under the lintel", () => {
    const d = P.doors[0];
    const door = LANDMARK_DOORS.find((q) => q.id === d.id)!;
    const [wx, wz] = HP.toWorld(P, d.x, d.z);
    // build_landmarks.py: the frame's c (-257, 48), W 27.78; the portal 1.2 deep behind the frontispiece's face
    expect(wx).toBeCloseTo(-257, 5);
    expect(wz).toBeCloseTo(48 + 27.78 / 2 - 1.2, 1);
    expect(door.step[0]).toBeCloseTo(wx, 5);
    expect(d.hw).toBe(S.portal.hw);
    expect(d.h + P.floorY).toBeCloseTo(S.portal.lintel, 5);
    // the step on the square is on the plan's porch, below the door
    const [sx, sz] = HP.toLocal(P, door.step[0], door.step[1]);
    expect(HP.walkable(P, sx, sz, -P.floorY)).toBe(true);
    expect(HP.floorAt(P, sx, sz, -P.floorY)).toBeCloseTo(-P.floorY, 5);
    // the frontispiece's side doors stand before the vestibule's front wall, not in a room
    for (const x of S.sideDoors) expect(Math.abs(x)).toBeLessThan(TH.VEST.maxX);
  });

  it("issue #10: a part of the hall stands behind every window of the shell, every part has a window, and all stay inside it", () => {
    const rows = inFrame(THS.SHELL_OPENINGS, P.origin, P.yaw);
    const miss: string[] = [];
    const seen = new Set<string>();
    for (const o of rows) {
      // a point 1.3 m behind the reveal's back, at the opening's middle height
      const d = o.depth + 1.3;
      const part = TH.partAt(o.x - o.nx * d, o.z - o.nz * d, (o.yb + o.yt) / 2 - TH.FLOOR_Y);
      if (!part) miss.push(o.label);
      else seen.add(part.id);
    }
    expect(miss).toEqual([]);
    expect(TH.PARTS.filter((p) => !seen.has(p.id)).map((p) => p.id)).toEqual([]);
    // the main door is the plan's door; the shell's door and the plan's door are the same doorway
    const door = rows.find((o) => o.kind === "door")!;
    expect(Math.abs(door.x - P.doors[0].x)).toBeLessThan(0.01);
    expect(door.hw).toBeCloseTo(P.doors[0].hw, 5);
    // the parts inside the shell's faces (the wings' front, the sides, the back; the frontispiece's rooms behind its face)
    const bad: string[] = [];
    for (const p of TH.PARTS)
      for (const r of p.rects) {
        if (Math.max(Math.abs(r.minX), Math.abs(r.maxX)) > S.halfL - 0.5) bad.push(`${p.id} side`);
        const fronti = Math.max(Math.abs(r.minX), Math.abs(r.maxX)) < 6.4 - 0.2;
        if (r.minZ < (fronti ? S.frontispiece + 0.5 : S.face + 0.5)) bad.push(`${p.id} front`);
        const inBlock = Math.max(Math.abs(r.minX), Math.abs(r.maxX)) <= S.stairBlock.hw - 0.2;
        if (r.maxZ > (inBlock ? S.stairBlock.back : S.back) - 0.3) bad.push(`${p.id} back`);
      }
    expect(bad).toEqual([]);
    // no two parts of one storey overlap
    const over: string[] = [];
    for (const a of TH.PARTS)
      for (const b of TH.PARTS)
        if (a.id < b.id && a.level === b.level)
          for (const p of a.rects) for (const q of b.rects) if (p.minX < q.maxX - 1e-6 && q.minX < p.maxX - 1e-6 && p.minZ < q.maxZ - 1e-6 && q.minZ < p.maxZ - 1e-6) over.push(`${a.id} ${b.id}`);
    expect(over).toEqual([]);
  });

  it("issue #28: the 54 dormers of the roof: 40 big ones before the attic, 14 small ones before its loft", () => {
    const rows = inFrame(THS.SHELL_OPENINGS, P.origin, P.yaw);
    const n: Record<string, number> = {};
    for (const o of rows) {
      const d = o.depth + 1.3;
      const part = TH.partAt(o.x - o.nx * d, o.z - o.nz * d, (o.yb + o.yt) / 2 - TH.FLOOR_Y);
      if (part && (part.id === "attic" || part.id === "loft")) n[part.id] = (n[part.id] ?? 0) + 1;
    }
    expect(n).toEqual({ attic: 40, loft: 14 });
    // the dormers' insides: one bay each, behind its window, under the ridge
    expect(THS.SHELL_BAYS.length).toBe(54);
    for (const b of THS.SHELL_BAYS) expect(b.yc).toBeLessThan(THS.SHELL_ROOF.ridge);
  });
});

describe("walking into the town hall", () => {
  const P = TH.PLAN;
  const step = P.doors[0].step;
  const reach = HP.flood(P, [step.x, step.z]);
  // the people walk where Jef may not (behind the counter) and stand at their desks and in the lodge
  const people = HP.flood(P, [step.x, step.z], 0.25, 0.25, () => true, false);

  it("from the step on the square through the door to every place of its life, upstairs by the great stair", () => {
    const miss: string[] = [];
    for (const [k, m] of Object.entries(P.marks)) {
      const level = (m.y ?? 0) > 1 ? 1 : 0;
      if (!people(m.x, m.z, level, 1.3)) miss.push(`mark ${k}`);
    }
    for (const [k, list] of Object.entries(P.sets)) list.forEach((m, i) => {
      const level = (m.y ?? 0) > 1 ? 1 : 0;
      if (!people(m.x, m.z, level, 1.3)) miss.push(`${k}[${i}]`);
    });
    // the rooms: the court, the office, the landing, the galleries, the wedding hall, the aldermen's room, the Leys hall
    const rooms: Array<[string, number, number, number]> = [
      ["vestibule", 0, 5, 0],
      ["court", -4.5, 16, 0],
      ["office", 10.5, 10, 0],
      ["landing", 0, 24.5, 1],
      ["gallery", 6.7, 15, 1],
      ["wedding hall", 16, 4, 1],
      ["aldermen's room", 12, 19.5, 1],
      ["Leys hall", -14, 4, 1],
    ];
    for (const [n, x, z, L] of rooms) if (!reach(x, z, L, 0.8)) miss.push(n);
    expect(miss).toEqual([]);
  });

  it("the people's walking graph stands on free floor, and their marks downstairs too", () => {
    const bad = P.nodes.filter(([x, z]) => !HP.freeAt(P, x, z, 0.25, false));
    expect(bad).toEqual([]);
  });

  it("never under the stair, never off a gallery, not behind the counter; a shut door keeps him out", () => {
    // under the landing and under the flight on the ground floor
    expect(reach(0, 20, 0, 0.5)).toBe(false);
    expect(reach(-5, 24, 0, 0.8)).toBe(false);
    // off the gallery's edge into the court from upstairs: no floor within a step
    expect(HP.walkable(P, 3, 15, TH.UP)).toBe(false);
    // behind the counter (the clerks' side) Jef does not go
    expect(reach(14.1, 12.5, 0, 0.5)).toBe(false);
    // the door shut at night: nothing inside from the step
    const shut = HP.flood(P, [step.x, step.z], 0.25, 0.3, () => false);
    expect(shut(0, 5, 0, 1.5)).toBe(false);
    expect(shut(step.x, step.z, 0, 0.5)).toBe(true);
  });

  it("climbs the stair a step at a time and stands on the storey the feet are on", () => {
    // at the foot the floor is the ground's; half way up it is the flight's; at the head the landing's
    expect(HP.floorAt(P, 0, 10, 0)).toBe(0);
    const mid = HP.footing(P, 0, 16.8, 3.3)!;
    expect(mid.stair).toBe(0);
    expect(Math.abs(mid.y - 3.3)).toBeLessThan(0.36);
    expect(HP.levelAt(P, 0, 24.5, TH.UP)).toBe(1);
    // the wedding hall is over the office: the feet say which one
    expect(HP.levelAt(P, 14, 8, 0)).toBe(0);
    expect(HP.levelAt(P, 14, 8, TH.UP)).toBe(1);
  });

  it("the threshold: 0 on the square, over a half at the doorway's inner face, 1 in the hall", () => {
    expect(HP.insideness(P, step.x, step.z)).toBe(0);
    expect(HP.insideness(P, 0, TH.FRONT.z1 + 0.05)).toBeGreaterThan(0.5);
    expect(HP.insideness(P, 0, 12)).toBe(1);
    expect(HP.insideness(P, 16, 4)).toBeGreaterThan(0.5);
    // it rises without a step along the way in
    let last = -1;
    for (let z = -2.5; z <= 4; z += 0.1) {
      const k = HP.insideness(P, 0, z);
      expect(k).toBeGreaterThanOrEqual(last - 1e-9);
      last = k;
    }
  });
});

// ------------------------------------------------------------------ the Vleeshuis

import * as VH from "../../shared/vleeshuisPlan.ts";

describe("the Vleeshuis's plan fits its shell", () => {
  const P = VH.PLAN;
  const S = VH.SHELL;

  it("its walls and floors stand 0.2 m inside the shell's faces, under the eaves", () => {
    const rects = [...VH.wallRects(), ...P.levels.flatMap((L) => L.floors.filter((f) => f.minZ >= VH.IN.south - 0.01 && f.maxZ <= VH.IN.north + 0.01))];
    const bad: string[] = [];
    for (const r of rects) {
      if (r.minX < S.east + 0.2 - 1e-6 || r.maxX > S.west - 0.2 + 1e-6) bad.push(`end ${JSON.stringify(r)}`);
      if (r.minZ < S.south + 0.2 - 1e-6 || r.maxZ > S.north - 0.2 + 1e-6) bad.push(`side ${JSON.stringify(r)}`);
    }
    expect(bad).toEqual([]);
    expect(VH.CEIL1 + VH.FLOOR_Y + 0.4).toBeLessThan(S.eaves);
    expect(VH.VAULT.spring + VH.VAULT.rise).toBeLessThan(VH.UP - 0.3);
    // the upper floor over the drip course between the storeys
    expect(VH.UP + VH.FLOOR_Y).toBeGreaterThanOrEqual(S.dripCourse);
  });

  it("every corner of them lies inside the Vleeshuis's footprint (city.json)", () => {
    expect(outsideFp(P, LM.vleeshuis.fp, VH.wallRects(), 0)).toEqual([]);
  });

  it("the doorways are the shell's two long-side doors: at the back of their reveals, their width, under the arch", () => {
    for (const d of P.doors) {
      const door = LANDMARK_DOORS.find((q) => q.id === d.id)!;
      const [wx] = HP.toWorld(P, d.x, d.z);
      expect(door.step[0]).toBeCloseTo(wx, 0);
      expect(d.hw).toBe(S.door.hw);
      expect(d.h + P.floorY).toBeCloseTo(S.door.spring, 5);
      // the reveal: the door's plane 0.9 behind the face
      expect(Math.abs(d.z - (d.dir > 0 ? S.south : S.north))).toBeCloseTo(S.door.depth, 5);
      // the street's step before the door is on the plan's porch
      const [sx, sz] = HP.toLocal(P, door.step[0], door.step[1]);
      expect(HP.inArea(P, sx, sz) || Math.abs(sz - d.z) > 4).toBe(true);
    }
    // build_landmarks.py prints them at (-122.0, 92.4) and (-115.7, 107.1)
    const [mx, mz] = HP.toWorld(P, 0, 0);
    expect(Math.abs(mx + 122)).toBeLessThan(0.06);
    expect(mz).toBeCloseTo(92.4, 5);
    const [nx, nz] = HP.toWorld(P, S.north_door_x, P.doors[1].z);
    expect(Math.abs(nx + 115.7)).toBeLessThan(0.06);
    expect(nz).toBeCloseTo(107.1, 5);
  });
});

describe("walking into the Vleeshuis", () => {
  const P = VH.PLAN;
  const south = P.doors[0].step;
  const north = P.doors[1].step;
  const reach = HP.flood(P, [south.x, south.z]);
  const people = HP.flood(P, [south.x, south.z], 0.25, 0.25, () => true, false);

  it("from the south door to the wine hall's aisles, the north door, and up the long stair to the theatre and the studio", () => {
    const miss: string[] = [];
    for (const [k, m] of Object.entries(P.marks)) if (!people(m.x, m.z, (m.y ?? 0) > 1 ? 1 : 0, 1.3)) miss.push(`mark ${k}`);
    for (const [k, list] of Object.entries(P.sets))
      list.forEach((m, i) => {
        // the actors on the stage: reached from the hall's floor in front of it (they appear there)
        if (k === "stage") return;
        if (!people(m.x, m.z, (m.y ?? 0) > 1 ? 1 : 0, 1.3)) miss.push(`${k}[${i}]`);
      });
    const rooms: Array<[string, number, number, number]> = [
      ["the south aisle", -12, 3, 0],
      ["the middle aisle", 20, 7.35, 0],
      ["the north aisle", -12, 11.6, 0],
      ["the north door's step", north.x, north.z, 0],
      ["the landing", 9.7, 12.5, 1],
      ["the theatre", -5, 7.35, 1],
      ["the studio", 20, 6, 1],
    ];
    for (const [n, x, z, L] of rooms) if (!reach(x, z, L, 0.8)) miss.push(n);
    expect(miss).toEqual([]);
  });

  it("the people's walking graph stands on free floor", () => {
    expect(P.nodes.filter(([x, z]) => !HP.freeAt(P, x, z, 0.25, false))).toEqual([]);
  });

  it("through the north door as through the south one; nothing past shut doors; never under the stair", () => {
    const fromNorth = HP.flood(P, [north.x, north.z]);
    expect(fromNorth(0, 3, 0, 0.8)).toBe(true);
    const shut = HP.flood(P, [south.x, south.z], 0.25, 0.3, () => false);
    expect(shut(0, 3, 0, 1.5)).toBe(false);
    expect(reach(18, 13.2, 0, 0.4)).toBe(false);
    expect(HP.walkable(P, 15, 13.2, VH.UP)).toBe(false);
  });

  it("the threshold: 0 on the street, over a half past each doorway, 1 in the hall", () => {
    expect(HP.insideness(P, south.x, south.z)).toBe(0);
    expect(HP.insideness(P, north.x, north.z)).toBe(0);
    expect(HP.insideness(P, 0, VH.IN.south + 0.05)).toBeGreaterThan(0.5);
    expect(HP.insideness(P, VH.SHELL.north_door_x, VH.IN.north - 0.05)).toBeGreaterThan(0.5);
    expect(HP.insideness(P, 10, 7)).toBe(1);
  });

  it("issue #28: up the attic stair from the studio to every part of the attic; never into its well", () => {
    const miss: string[] = [];
    const attic: Array<[string, number, number]> = [
      ["the head of the attic stair", 25.2, 11.3],
      ["the attic's east end", -13.5, 7.35],
      ["the attic's west end", 26.5, 7.35],
      ["under the south slope", 0, 1.2],
      ["under the north slope", 0, 13.4],
    ];
    for (const [n, x, z] of attic) if (!reach(x, z, 2, 0.8)) miss.push(n);
    expect(miss).toEqual([]);
    // the well: no floor on the attic's storey; the stair's side is a wall from there
    expect(HP.walkable(P, 20, 11.3, VH.ATTIC)).toBe(false);
    expect(HP.levelAt(P, 25.2, 11.3, VH.ATTIC)).toBe(2);
  });
});

import * as VS from "../../shared/vleeshuisShell.ts";
import { inConvex, towersInFrame } from "../../shared/shellAttic.ts";

describe("issue #28: a real space of the Vleeshuis behind every window of its shell", () => {
  const P = VH.PLAN;
  const rows = inFrame(VS.SHELL_OPENINGS, P.origin, P.yaw);
  const towers = towersInFrame(VS.SHELL_TOWERS, P.origin, P.yaw);

  it("the hall's two floors, the attic, or a tower's shaft or top room, just behind each", () => {
    const miss: string[] = [];
    const count: Record<string, number> = {};
    for (const o of rows) {
      if (o.kind === "door") continue;
      const d = o.depth + 0.05;
      const x = o.x - o.nx * d;
      const z = o.z - o.nz * d;
      const y = (o.yb + o.yt) / 2;
      const tower = towers.find((t) => (y < t.ys ? inConvex(t.ring, x, z) : inConvex(t.top, x, z)));
      const inBody = x > VH.SHELL.east && x < VH.SHELL.west && z > VH.SHELL.south && z < VH.SHELL.north;
      const zone = tower ? `tower ${tower.id}` : !inBody ? null : y > VH.FLOOR_Y + VH.ATTIC ? "attic" : "hall";
      if (!zone) miss.push(o.label);
      else count[zone] = (count[zone] ?? 0) + 1;
    }
    expect(miss).toEqual([]);
    // the attic: 20 in the gables, 14 wall dormers, 35 in the roof; the turrets' slits and windows; the stair tower's 10
    expect(count.attic).toBe(69);
    expect(count["tower stair"]).toBe(10);
    expect(count["tower se"]).toBe(7);
    for (const t of ["ne", "nw", "sw"]) expect(count[`tower ${t}`]).toBe(5);
  });

  it("each tower's shaft keeps a wall off the hall, and its room stands inside its walls", () => {
    for (const t of towers) {
      for (const [x, z] of t.shaft) expect(x > VH.IN.east - 0.1 && x < VH.IN.west + 0.1 && z > VH.IN.south - 0.1 && z < VH.IN.north + 0.1).toBe(false);
      for (const [x, z] of t.room) expect(inConvex(t.top, x, z)).toBe(true);
      expect(t.ys).toBeGreaterThan(VH.FLOOR_Y + VH.UP);
    }
  });
});

// ------------------------------------------------------------------ the Oostershuis

import * as OH from "../../shared/oostershuisPlan.ts";

describe("the Oostershuis's plan fits its shell", () => {
  const P = OH.PLAN;
  const S = OH.SHELL;

  it("its walls and floors stand 0.2 m inside the front wing's faces, under the first floor", () => {
    const rects = [...OH.wallRects(), ...P.levels[0].floors.filter((f) => f.minZ >= OH.IN.front - 0.01)];
    const bad: string[] = [];
    for (const r of rects) {
      if (Math.max(Math.abs(r.minX), Math.abs(r.maxX)) > S.halfL - 0.2 + 1e-6) bad.push(`end ${JSON.stringify(r)}`);
      if (r.minZ < S.front + 0.2 - 1e-6 || r.maxZ > S.court - 0.2 + 1e-6) bad.push(`side ${JSON.stringify(r)}`);
    }
    expect(bad).toEqual([]);
    expect(OH.CEIL + OH.FLOOR_Y).toBeLessThan(S.groundStorey + 0.01);
  });

  it("every corner of them lies inside the Oostershuis's footprint (city.json)", () => {
    expect(outsideFp(P, LM.hanzehuis.fp, OH.wallRects(), 0)).toEqual([]);
  });

  it("the gateway is the shell's gate: at the back of its portal, its width, under the lintel", () => {
    const d = P.doors[0];
    const door = LANDMARK_DOORS.find((q) => q.id === d.id)!;
    const [wx, wz] = HP.toWorld(P, d.x, d.z);
    // build_landmarks.py prints the gate at (120.0, 123.9)
    expect(wx).toBeCloseTo(120, 5);
    expect(wz).toBeCloseTo(123.9, 5);
    expect(door.step[0]).toBeCloseTo(wx, 5);
    expect(d.hw).toBe(S.gate.hw);
    expect(d.h + P.floorY).toBeCloseTo(S.gate.lintel - S.gate.band, 5);
    const [sx, sz] = HP.toLocal(P, door.step[0], door.step[1]);
    expect(HP.walkable(P, sx, sz, 0)).toBe(true);
  });
});

describe("walking into the Oostershuis", () => {
  const P = OH.PLAN;
  const step = P.doors[0].step;
  const reach = HP.flood(P, [step.x, step.z]);
  const people = HP.flood(P, [step.x, step.z], 0.25, 0.25, () => true, false);

  it("from the quay through the gate and the passage into both halls, to every place of its life", () => {
    const miss: string[] = [];
    for (const [k, m] of Object.entries(P.marks)) if (!people(m.x, m.z, 0, 1.3)) miss.push(`mark ${k}`);
    for (const [k, list] of Object.entries(P.sets)) list.forEach((m, i) => (people(m.x, m.z, 0, 1.3) ? 0 : miss.push(`${k}[${i}]`)));
    for (const [n, x, z] of [["the passage", 0, 8.4], ["the west hall", -29, 5.3], ["the east hall", 29, 5.3], ["the scale", OH.SCALE.x - 1.1, OH.SCALE.z], ["under the hatch", OH.HATCH.x + 1.0, OH.HATCH.z]] as Array<[string, number, number]>)
      if (!reach(x, z, 0, 0.8)) miss.push(n);
    expect(miss).toEqual([]);
  });

  it("the people's walking graph stands on free floor; the gate shut keeps him out", () => {
    expect(P.nodes.filter(([x, z]) => !HP.freeAt(P, x, z, 0.25, false))).toEqual([]);
    const shut = HP.flood(P, [step.x, step.z], 0.25, 0.3, () => false);
    expect(shut(0, 5, 0, 1.5)).toBe(false);
  });

  it("the threshold: 0 on the quay, over a half past the gateway, 1 in the halls", () => {
    expect(HP.insideness(P, step.x, step.z)).toBe(0);
    expect(HP.insideness(P, 0, OH.IN.front + 0.05)).toBeGreaterThan(0.5);
    expect(HP.insideness(P, -20, 5)).toBe(1);
  });
});

// ------------------------------------------------------------------ the Steen

import * as ST from "../../shared/steenPlan.ts";

describe("the Steen's plan fits its shell", () => {
  const P = ST.PLAN;
  const S = ST.SHELL;

  it("its walls and floors stand 0.2 m inside the lane range's faces, the cell over the mass's foot", () => {
    const rects = [...ST.wallRects(), ...P.levels.flatMap((L) => L.floors.filter((f) => f.minZ >= ST.IN.front - 0.01))];
    const bad: string[] = [];
    for (const r of rects) {
      if (r.maxX > S.west - 0.2 + 1e-6 || r.minX < S.east + 0.2 - 1e-6) bad.push(`end ${JSON.stringify(r)}`);
      if (r.minZ < S.face + 0.2 - 1e-6 || r.maxZ > S.back - 0.2 + 1e-6) bad.push(`side ${JSON.stringify(r)}`);
    }
    expect(bad).toEqual([]);
    expect(ST.CEIL + ST.FLOOR_Y).toBeLessThan(S.eaves);
    // the cell's floor over the shell's foot (its masses start a metre under the street)
    expect(ST.DOWN + ST.FLOOR_Y).toBeGreaterThan(-1.0);
    expect(ST.CELL_CEIL).toBeLessThan(0);
  });

  it("every corner of them lies inside the Steen's footprint (city.json)", () => {
    expect(outsideFp(P, LM.steen.fp, ST.wallRects(), 0)).toEqual([]);
  });

  it("the doorway is the museum door on the courtyard: its place, its width, the courtyard's height", () => {
    const d = P.doors[0];
    const door = LANDMARK_DOORS.find((q) => q.id === d.id)!;
    const [wx, wz] = HP.toWorld(P, d.x, d.z);
    // build_landmarks.py prints the museum door at (-183.5, -23.0) on the face at v 8 (world z -23.25)
    expect(wx).toBeCloseTo(-183.5, 5);
    expect(wz).toBeCloseTo(-23.25, 5);
    expect(door.step[0]).toBeCloseTo(wx, 5);
    expect(door.y).toBeCloseTo(P.floorY, 5);
    expect(d.hw).toBe(S.door.hw);
    const [sx, sz] = HP.toLocal(P, door.step[0], door.step[1]);
    expect(HP.walkable(P, sx, sz, 0)).toBe(true);
  });
});

describe("walking into the Steen", () => {
  const P = ST.PLAN;
  const step = P.doors[0].step;
  const reach = HP.flood(P, [step.x, step.z]);
  const people = HP.flood(P, [step.x, step.z], 0.25, 0.25, () => true, false);

  it("from the courtyard through the gatehouse into the hall of antiquities, and down the stair to the cell", () => {
    const miss: string[] = [];
    for (const [k, list] of Object.entries(P.sets)) list.forEach((m, i) => (people(m.x, m.z, 0, 1.3) ? 0 : miss.push(`${k}[${i}]`)));
    for (const [n, x, z, L] of [["the gatehouse", 0.5, 3.6, 0], ["the hall", -8.2, 3.2, 0], ["the hall's east end", -12.8, 3.2, 0], ["the stair's head", -8.6, 6.6, 0], ["the cell", -12.5, 3.0, 1], ["the cell's far end", -9, 2.2, 1]] as Array<[string, number, number, number]>)
      if (!reach(x, z, L, 0.8)) miss.push(n);
    expect(miss).toEqual([]);
  });

  it("Jef's own body (0.32 m, as firstPerson walks) goes down to the cell and climbs back out to the door", () => {
    // walkthrough west 2026-09-25: the back case and the stairwell's rail left no way onto the stair head at
    // 0.32 (the 0.3 flood slipped through a gap of width 0), and from the cell the hall's floor ahead of the
    // top steps was a wall for the body's ring: Jef was shut in the cell
    const down = HP.flood(P, [step.x, step.z], 0.1, 0.32);
    expect(down(-12.5, 3.0, 1, 0.5)).toBe(true);
    // up the flight from its foot as the world walks it: the feet on the step under them, the ring 0.47 round
    // the body all on floor within a step (or a flight's drop), no solid within 0.32
    let feet = ST.DOWN;
    const stuck: string[] = [];
    for (let x = ST.STAIR.foot + 0.1; x <= ST.STAIR.head + 0.25; x += 0.05) {
      const z = 6.65;
      const f = HP.footing(P, x, z, feet);
      if (!f) {
        stuck.push(`no footing at ${x.toFixed(2)}`);
        break;
      }
      feet = f.y;
      const ringOk = [...Array(8).keys()].every((i) => HP.walkable(P, x + Math.cos((i * Math.PI) / 4) * 0.47, z + Math.sin((i * Math.PI) / 4) * 0.47, feet));
      if (!ringOk || HP.hits(P, x, z, 0.32, feet)) stuck.push(`${x.toFixed(2)} at ${feet.toFixed(2)}`);
    }
    expect(stuck).toEqual([]);
    expect(feet).toBe(0);
  });

  it("the people's walking graph stands on free floor; the door shut keeps him out; never into the stairwell", () => {
    expect(P.nodes.filter(([x, z]) => !HP.freeAt(P, x, z, 0.25, false))).toEqual([]);
    const shut = HP.flood(P, [step.x, step.z], 0.25, 0.3, () => false);
    expect(shut(0, 3, 0, 1.5)).toBe(false);
    expect(HP.walkable(P, -11, 6.6, 0)).toBe(false);
  });

  it("the threshold: 0 on the courtyard, over a half past the doorway, 1 in the hall", () => {
    expect(HP.insideness(P, step.x, step.z)).toBe(0);
    expect(HP.insideness(P, 0, ST.IN.front + 0.05)).toBeGreaterThan(0.5);
    expect(HP.insideness(P, -8, 4)).toBe(1);
  });
});
