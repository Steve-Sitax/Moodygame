import { describe, expect, it } from "vitest";
import { clearWalk, groundRound, LocalRound, localWalk, walkVia, type WalkPoint } from "../../shared/localRound.ts";
import { cellBox, cellPacing } from "../../shared/prisonPlan.ts";
import { MARKS, ORGAN, peopleFreeAt } from "../../shared/cathedralPlan.ts";

describe("working rounds stay on reachable ground", () => {
  it("walks around furniture through its aisle, including the return", () => {
    const free = (x: number, z: number) => Math.abs(x) < 5 && Math.abs(z) < 5 && !(x > -.5 && x < .5 && z > -2 && z < 2);
    const home: WalkPoint = [-2, 0], route = localWalk(home, [2, 0], free)!;
    expect(route).not.toBeNull(); expect(route.length).toBeGreaterThan(1);
    const round = new LocalRound(home, [route], 0, .8, 1);
    let moved = false, returned = false, last: WalkPoint = home;
    for (let i = 0; i < 600; i++) {
      round.update(.1, false, free);
      const at: WalkPoint = [round.x, round.z];
      expect(free(...at)).toBe(true); expect(Math.hypot(at[0] - last[0], at[1] - last[1])).toBeLessThanOrEqual(.081);
      if (round.x > 1.9) moved = true;
      if (moved && round.atHome) returned = true;
      last = at;
    }
    expect(moved).toBe(true); expect(returned).toBe(true);
  });
  it("rejects sealed rooms and corners instead of teleporting", () => {
    const sealed = (x: number, z: number) => Math.abs(x) < 4 && Math.abs(z) < 4 && (x < -.1 || x > .1);
    expect(localWalk([-2, 0], [2, 0], sealed)).toBeNull();
    const corner = (x: number, z: number) => !(x > .1 && z < .8) && !(z > .1 && x < .8);
    expect(clearWalk([0, 0], [1, 1], corner)).toBe(false);
    expect(localWalk([0, 0], [1, 1], corner, 1)).toBeNull();
  });
  it("waits for a conversation or an obstructing player, then continues", () => {
    const r = new LocalRound([0, 0], [[[2, 0]]], 0, 1);
    for (let i = 0; i < 60; i++) r.update(.1, true);
    expect(r.x).toBe(0);
    for (let i = 0; i < 55; i++) r.update(.1);
    const x = r.x; expect(x).toBeGreaterThan(0);
    r.update(.1, false, () => false); expect(r.x).toBe(x);
    expect(r.walking).toBe(false);
    r.update(.1, false, () => true); expect(r.x).toBeGreaterThan(x);
    expect(r.walking).toBe(true);
    r.update(.1, true); expect(r.walking).toBe(false);
  });
  it("lets both seated inmates get up and pace without leaving their actual cells", () => {
    for (const [wing, row, k, home, yaw] of [
      ["A", "S", 4, [18, 16.1], Math.PI / 2],
      ["B", "N", 3, [-15.2, 22.4], -Math.PI / 2],
    ] as const) {
      const free = cellPacing(wing, row, k), c = cellBox(wing, row, 0, k);
      const { round: r, free: moveFree } = groundRound({ standFree: free }, [...home], 0, yaw, true, 7, 1.2);
      expect(r.routes.length).toBeGreaterThan(0);
      let moved = false, returned = false;
      for (let i = 0; i < 700; i++) {
        r.update(.1, false, moveFree);
        expect(r.x).toBeGreaterThan(c.x0); expect(r.x).toBeLessThan(c.x1);
        expect(r.z).toBeGreaterThan(c.z0); expect(r.z).toBeLessThan(c.z1);
        if (Math.hypot(r.x - home[0], r.z - home[1]) > .8) moved = true;
        if (moved && r.atHome) returned = true;
      }
      expect(moved).toBe(true); expect(returned).toBe(true);
      expect(free((c.x0 + c.x1) / 2, c.z0 - .2)).toBe(false);
    }
  });
  it("keeps the organist on the loft and behind its railing throughout a round", () => {
    const m = MARKS.organist, free = (x: number, z: number) => peopleFreeAt(x, z, m.y!);
    const { round: r, free: stepFree } = groundRound({ standFree: free }, [m.x, m.z], m.y!, m.yaw, true, 7, 1.8);
    expect(r.routes.length).toBeGreaterThan(0);
    let moved = false;
    for (let i = 0; i < 600; i++) {
      r.update(.1, false, stepFree);
      expect(free(r.x, r.z)).toBe(true);
      if (Math.abs(r.x - m.x) > .5) moved = true;
    }
    expect(moved).toBe(true);
    expect(free(0, ORGAN.balustrade - .1)).toBe(false);
    expect(free(0, ORGAN.z1 + .2)).toBe(false);
    expect(free(0, ORGAN.z0 + 1.3)).toBe(false);
  });
  it("plans a bench exit around a table rather than rejecting the whole break", () => {
    const home: WalkPoint = [.3, 0];
    const free = (x: number, z: number) => x > .22 && x < 4 && Math.abs(z) < 2
      && (x > .7 || Math.hypot(x - home[0], z - home[1]) < 1.3)
      && !(x > .45 && x < 1.45 && z > -.55 && z < .55);
    const via: WalkPoint[] = [[.3, .72], [2, .72]];
    // The obsolete diagonal crosses the tabletop's clearance.
    expect(clearWalk([.5, 0], [.95, .62], free)).toBe(false);
    const route = walkVia(home, via, free)!;
    expect(route).not.toBeNull();
    const r = new LocalRound(home, [route], 0, .8);
    let out = false, back = false;
    for (let i = 0; i < 650; i++) { r.update(.1, false, free); expect(free(r.x, r.z)).toBe(true); if (r.x > 1.8) out = true; if (out && r.atHome) back = true; }
    expect(out).toBe(true); expect(back).toBe(true);
  });
});
